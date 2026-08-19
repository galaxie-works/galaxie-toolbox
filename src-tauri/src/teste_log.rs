//! #1301 — captura e asserção de log em teste (crate `log`).
//!
//! **O problema que isto resolve:** o repo tem 137 chamadas `log::{info,warn,
//! error,debug}!` em `src-tauri/src` e nenhum teste conseguia afirmar que uma
//! delas aconteceu. Resultado prático: ACs do tipo *"a falha não morre em
//! silêncio → loga"* (#1296, #1238) eram promessa, não teste. A `lumen` gatava
//! isso na mão.
//!
//! **A restrição que manda no desenho:** `log::set_logger` só aceita UMA
//! instalação por processo, e `cargo test` roda os testes **em paralelo dentro
//! da mesma binária**. Um buffer global mutável faria um teste enxergar o log de
//! outro — falha intermitente, o pior tipo. Então:
//!
//! - **um** logger instalado uma única vez (`Once`), que nunca imprime nada;
//! - o destino é **thread-local** e só existe dentro do escopo de
//!   [`capturar_logs`]. Fora dele, o logger descarta silenciosamente.
//!
//! Cada teste vê exatamente o que ele mesmo logou, mesmo com N testes correndo
//! ao mesmo tempo.
//!
//! **PII (lição RB do #1076):** os registros ficam **só em memória**. Este
//! logger não escreve em disco nem imprime em stdout/stderr — nem em CI. O que
//! for capturado morre no fim do teste.
//!
//! **Produção não é afetada:** o módulo inteiro é `cfg(test)`, então o
//! `tauri-plugin-log` do binário real nunca disputa o `set_logger` com ele.

use std::cell::RefCell;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, Once};

use log::{Level, LevelFilter, Log, Metadata, Record};

/// Uma linha de log capturada.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Registro {
    pub level: Level,
    pub target: String,
    pub msg: String,
}

thread_local! {
    /// `None` = esta thread não está capturando (o logger descarta).
    static SINK: RefCell<Option<Vec<Registro>>> = const { RefCell::new(None) };
}

/// Destino GLOBAL (todas as threads), usado só por [`capturar_logs_globais`].
static SINK_GLOBAL: Mutex<Option<Vec<Registro>>> = Mutex::new(None);
/// Serializa as capturas globais entre si (duas ao mesmo tempo se misturariam).
static TRAVA_GLOBAL: Mutex<()> = Mutex::new(());

struct LoggerDeTeste;

impl Log for LoggerDeTeste {
    fn enabled(&self, _metadata: &Metadata) -> bool {
        true
    }

    fn log(&self, record: &Record) {
        SINK.with(|sink| {
            // `try_borrow_mut`: um `Display` que logasse durante o próprio log
            // causaria reentrância. Nesse caso perdemos a linha em vez de dar
            // panic dentro do logger — panic aqui derrubaria o teste com um
            // erro que não tem nada a ver com o que ele está verificando.
            let registro = Registro {
                level: record.level(),
                target: record.target().to_string(),
                msg: record.args().to_string(),
            };
            // 1) escopo desta thread, se houver
            if let Ok(mut b) = sink.try_borrow_mut() {
                if let Some(registros) = b.as_mut() {
                    registros.push(registro.clone());
                    return;
                }
            }
            // 2) senão, escopo global (se algum teste o abriu) — é o que
            //    alcança log emitido por thread que o código sob teste spawna.
            if let Ok(mut g) = SINK_GLOBAL.lock() {
                if let Some(registros) = g.as_mut() {
                    registros.push(registro);
                }
            }
        });
    }

    fn flush(&self) {}
}

static LOGGER: LoggerDeTeste = LoggerDeTeste;
static INSTALACAO: Once = Once::new();
// `AtomicBool` e nao `static mut`: mesma garantia sem `unsafe` nenhum. (O par
// deste modulo no signaling usa a mesma forma — helper de teste nao e lugar de
// gastar orcamento de `unsafe`.)
static INSTALADO: AtomicBool = AtomicBool::new(false);

fn garantir_logger() {
    INSTALACAO.call_once(|| {
        let ok = log::set_logger(&LOGGER).is_ok();
        if ok {
            log::set_max_level(LevelFilter::Trace);
        }
        INSTALADO.store(ok, Ordering::SeqCst);
    });

    assert!(
        INSTALADO.load(Ordering::SeqCst),
        "#1301: outro logger já estava instalado neste processo de teste; \
         a captura NÃO funcionaria. Falho alto de propósito: devolver uma lista \
         vazia faria um `assert` de 'não logou' passar por engano."
    );
}

/// Roda `f` capturando **todo** log emitido **nesta thread** durante a chamada.
///
/// Aninhamento é seguro: a captura de dentro não rouba as linhas da de fora —
/// o escopo interno devolve o buffer anterior ao terminar (as linhas do escopo
/// interno ficam só com ele, que é o comportamento útil num teste).
pub fn capturar_logs(f: impl FnOnce()) -> Vec<Registro> {
    garantir_logger();

    let anterior = SINK.with(|s| s.borrow_mut().replace(Vec::new()));
    f();
    let capturado = SINK.with(|s| {
        let mut b = s.borrow_mut();
        let capturado = b.take().unwrap_or_default();
        *b = anterior;
        capturado
    });
    capturado
}

/// Como [`capturar_logs`], mas alcança **todas as threads** — inclusive as que
/// o código sob teste spawna. Necessário para provar log de worker de fundo.
///
/// **Trade-off, explícito:** enquanto este escopo está aberto, log de OUTROS
/// testes rodando em paralelo também cai aqui. Chamadas concorrentes deste
/// helper são serializadas entre si, mas não contra o resto da suíte. Portanto:
///
/// - use para afirmar **presença** (`assert_logou`) — ruído alheio não causa
///   falso negativo;
/// - **não** use para afirmar **ausência** (`assert_nao_logou`) — aí o ruído
///   viraria falha intermitente. Para ausência, use [`capturar_logs`].
pub fn capturar_logs_globais(f: impl FnOnce()) -> Vec<Registro> {
    garantir_logger();
    let _trava = TRAVA_GLOBAL.lock().unwrap_or_else(|e| e.into_inner());

    if let Ok(mut g) = SINK_GLOBAL.lock() {
        *g = Some(Vec::new());
    }
    f();
    let capturado = SINK_GLOBAL
        .lock()
        .map(|mut g| g.take().unwrap_or_default())
        .unwrap_or_default();
    capturado
}

/// Espia o buffer global SEM fechá-lo. Existe para esperar log de thread de
/// fundo sem `sleep` cego: o teste pergunta "já apareceu?" até um prazo.
pub fn espiar_globais() -> Vec<Registro> {
    SINK_GLOBAL
        .lock()
        .map(|g| g.clone().unwrap_or_default())
        .unwrap_or_default()
}

/// Espera até `prazo` por uma linha `nivel` contendo `trecho` no buffer global.
/// Devolve `true` se apareceu. Sem isto, testar worker vira `sleep` chutado —
/// que ou é lento demais ou falha em máquina carregada.
pub fn esperar_log_global(nivel: Level, trecho: &str, prazo: std::time::Duration) -> bool {
    let ate = std::time::Instant::now() + prazo;
    loop {
        if logou(&espiar_globais(), nivel, trecho) {
            return true;
        }
        if std::time::Instant::now() >= ate {
            return false;
        }
        std::thread::sleep(std::time::Duration::from_millis(10));
    }
}

/// Alguma linha capturada tem esse nível E contém `trecho` (na mensagem ou no
/// target)?
pub fn logou(registros: &[Registro], nivel: Level, trecho: &str) -> bool {
    registros
        .iter()
        .any(|r| r.level == nivel && (r.msg.contains(trecho) || r.target.contains(trecho)))
}

/// Falha o teste se nenhuma linha do nível `nivel` contiver `trecho`.
///
/// A mensagem de falha lista o que FOI capturado — sem isso, "esperava um erro
/// e não veio" manda quem está depurando adivinhar.
#[track_caller]
pub fn assert_logou(registros: &[Registro], nivel: Level, trecho: &str) {
    assert!(
        logou(registros, nivel, trecho),
        "esperava log {nivel} contendo {trecho:?}, mas capturei {n} linha(s):\n{lista}",
        n = registros.len(),
        lista = formatar(registros),
    );
}

/// Falha o teste se ALGUMA linha do nível `nivel` contiver `trecho`.
/// (O par negativo importa: sem ele não dá pra provar que um caminho feliz
/// NÃO loga erro.)
#[track_caller]
pub fn assert_nao_logou(registros: &[Registro], nivel: Level, trecho: &str) {
    assert!(
        !logou(registros, nivel, trecho),
        "NÃO esperava log {nivel} contendo {trecho:?}, mas capturei:\n{lista}",
        lista = formatar(registros),
    );
}

fn formatar(registros: &[Registro]) -> String {
    if registros.is_empty() {
        return "  (nenhuma)".to_string();
    }
    registros
        .iter()
        .map(|r| format!("  [{}] {}: {}", r.level, r.target, r.msg))
        .collect::<Vec<_>>()
        .join("\n")
}

#[cfg(test)]
mod testes {
    use super::*;

    #[test]
    fn captura_nivel_target_e_mensagem() {
        let logs = capturar_logs(|| {
            log::error!("falha ao gravar fila: disco cheio");
        });

        assert_eq!(logs.len(), 1);
        assert_eq!(logs[0].level, Level::Error);
        assert!(logs[0].msg.contains("disco cheio"));
        assert_logou(&logs, Level::Error, "gravar fila");
    }

    #[test]
    fn fora_do_escopo_nao_captura_nada() {
        log::error!("esta linha acontece FORA de capturar_logs");
        let logs = capturar_logs(|| {});
        assert!(
            logs.is_empty(),
            "o escopo tem de começar limpo; senão um teste herda o lixo do anterior"
        );
    }

    #[test]
    fn assert_nao_logou_pega_o_caminho_feliz() {
        let logs = capturar_logs(|| log::info!("tudo certo"));
        assert_nao_logou(&logs, Level::Error, "qualquer coisa");
    }

    /// O ponto do desenho: `cargo test` roda em paralelo. Se o sink fosse
    /// global, esta thread veria o log da outra.
    #[test]
    fn captura_e_isolada_por_thread() {
        let (tx, rx) = std::sync::mpsc::channel();

        let logs_desta = capturar_logs(|| {
            let t = std::thread::spawn(move || {
                let logs_da_outra = capturar_logs(|| log::error!("SOU DA OUTRA THREAD"));
                tx.send(logs_da_outra).ok();
            });
            log::error!("SOU DESTA THREAD");
            t.join().ok();
        });

        let logs_da_outra = rx.recv().expect("a outra thread devolveu seus logs");

        assert!(logou(&logs_desta, Level::Error, "SOU DESTA THREAD"));
        assert!(
            !logou(&logs_desta, Level::Error, "SOU DA OUTRA THREAD"),
            "vazou log de outra thread — a captura não está isolada"
        );
        assert!(logou(&logs_da_outra, Level::Error, "SOU DA OUTRA THREAD"));
        assert!(!logou(&logs_da_outra, Level::Error, "SOU DESTA THREAD"));
    }

    #[test]
    fn aninhar_nao_rouba_o_buffer_de_fora() {
        let externo = capturar_logs(|| {
            log::warn!("de fora, antes");
            let interno = capturar_logs(|| log::warn!("de dentro"));
            assert!(logou(&interno, Level::Warn, "de dentro"));
            assert!(!logou(&interno, Level::Warn, "de fora"));
            log::warn!("de fora, depois");
        });

        assert!(logou(&externo, Level::Warn, "de fora, antes"));
        assert!(logou(&externo, Level::Warn, "de fora, depois"));
    }
}
