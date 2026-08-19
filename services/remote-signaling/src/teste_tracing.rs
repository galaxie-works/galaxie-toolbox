//! #1301 — captura e asserção de log em teste (crate `tracing`).
//!
//! Par do `teste_log` do `src-tauri`, **de propósito com a mesma ergonomia**:
//! `capturar_tracing(|| …) -> Vec<Registro>` + `assert_logou(...)`. Quem troca
//! de crate não deve ter de reaprender a afirmar log.
//!
//! Mesmas restrições e mesmas escolhas: o subscriber global do `tracing` só
//! aceita UMA instalação por processo (`set_global_default`), e `cargo test`
//! roda em paralelo na mesma binária — então o destino é **thread-local** e só
//! existe dentro do escopo. Fora dele, o layer descarta.
//!
//! **PII:** só memória. Nada de disco, nada de stdout — nem em CI.

use std::cell::RefCell;
use std::sync::Once;

use tracing::field::{Field, Visit};
use tracing::{Event, Level, Subscriber};
use tracing_subscriber::layer::{Context, Layer};
use tracing_subscriber::prelude::*;

/// Uma linha capturada. Espelha o `Registro` do `teste_log` do `src-tauri`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Registro {
    pub level: Level,
    pub target: String,
    pub msg: String,
}

thread_local! {
    static SINK: RefCell<Option<Vec<Registro>>> = const { RefCell::new(None) };
}

/// Junta o campo `message` e os demais campos num texto único, para que
/// `assert_logou(..., "device_id")` funcione tanto na mensagem quanto num campo
/// estruturado — é assim que o código real loga (`tracing::warn!(device_id = …)`).
#[derive(Default)]
struct Coletor {
    texto: String,
}

impl Visit for Coletor {
    fn record_debug(&mut self, field: &Field, value: &dyn std::fmt::Debug) {
        if !self.texto.is_empty() {
            self.texto.push(' ');
        }
        if field.name() == "message" {
            self.texto.push_str(&format!("{value:?}").trim_matches('"').to_string());
        } else {
            self.texto.push_str(&format!("{}={:?}", field.name(), value));
        }
    }

    fn record_str(&mut self, field: &Field, value: &str) {
        if !self.texto.is_empty() {
            self.texto.push(' ');
        }
        if field.name() == "message" {
            self.texto.push_str(value);
        } else {
            self.texto.push_str(&format!("{}={}", field.name(), value));
        }
    }
}

struct LayerDeTeste;

impl<S: Subscriber> Layer<S> for LayerDeTeste {
    fn on_event(&self, event: &Event<'_>, _ctx: Context<'_, S>) {
        SINK.with(|sink| {
            let Ok(mut b) = sink.try_borrow_mut() else {
                return;
            };
            let Some(registros) = b.as_mut() else {
                return;
            };
            let mut coletor = Coletor::default();
            event.record(&mut coletor);
            registros.push(Registro {
                level: *event.metadata().level(),
                target: event.metadata().target().to_string(),
                msg: coletor.texto,
            });
        });
    }
}

static INSTALACAO: Once = Once::new();
static INSTALADO: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

fn garantir_subscriber() {
    INSTALACAO.call_once(|| {
        let ok = tracing_subscriber::registry()
            .with(LayerDeTeste)
            .try_init()
            .is_ok();
        INSTALADO.store(ok, std::sync::atomic::Ordering::SeqCst);
    });

    assert!(
        INSTALADO.load(std::sync::atomic::Ordering::SeqCst),
        "#1301: outro subscriber de tracing já estava instalado neste processo; \
         a captura NÃO funcionaria. Falho alto de propósito — devolver lista \
         vazia faria um assert de 'não logou' passar por engano."
    );
}

/// Roda `f` capturando os eventos de `tracing` emitidos **nesta thread**.
pub fn capturar_tracing(f: impl FnOnce()) -> Vec<Registro> {
    garantir_subscriber();

    let anterior = SINK.with(|s| s.borrow_mut().replace(Vec::new()));
    f();
    SINK.with(|s| {
        let mut b = s.borrow_mut();
        let capturado = b.take().unwrap_or_default();
        *b = anterior;
        capturado
    })
}

pub fn logou(registros: &[Registro], nivel: Level, trecho: &str) -> bool {
    registros
        .iter()
        .any(|r| r.level == nivel && (r.msg.contains(trecho) || r.target.contains(trecho)))
}

#[track_caller]
pub fn assert_logou(registros: &[Registro], nivel: Level, trecho: &str) {
    assert!(
        logou(registros, nivel, trecho),
        "esperava evento {nivel} contendo {trecho:?}, mas capturei {n} linha(s):\n{lista}",
        n = registros.len(),
        lista = formatar(registros),
    );
}

#[track_caller]
pub fn assert_nao_logou(registros: &[Registro], nivel: Level, trecho: &str) {
    assert!(
        !logou(registros, nivel, trecho),
        "NÃO esperava evento {nivel} contendo {trecho:?}, mas capturei:\n{lista}",
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
    fn captura_nivel_e_mensagem() {
        let logs = capturar_tracing(|| {
            tracing::error!("registro recusado: PoP ausente");
        });
        assert_eq!(logs.len(), 1);
        assert_eq!(logs[0].level, Level::ERROR);
        assert_logou(&logs, Level::ERROR, "PoP ausente");
    }

    /// O código real loga com campo estruturado (`warn!(device_id = %x, "…")`).
    /// Se o coletor só lesse `message`, afirmar sobre o campo falharia.
    #[test]
    fn captura_campo_estruturado_alem_da_mensagem() {
        let logs = capturar_tracing(|| {
            tracing::warn!(device_id = "dev-42", "registro recusado");
        });
        assert_logou(&logs, Level::WARN, "registro recusado");
        assert_logou(&logs, Level::WARN, "dev-42");
    }

    #[test]
    fn fora_do_escopo_nao_captura() {
        tracing::error!("fora do escopo");
        let logs = capturar_tracing(|| {});
        assert!(logs.is_empty(), "o escopo tem de começar limpo");
    }

    #[test]
    fn isolada_por_thread() {
        let (tx, rx) = std::sync::mpsc::channel();
        let desta = capturar_tracing(|| {
            let t = std::thread::spawn(move || {
                tx.send(capturar_tracing(|| tracing::error!("DA OUTRA"))).ok();
            });
            tracing::error!("DESTA");
            t.join().ok();
        });
        let da_outra = rx.recv().expect("a outra thread devolveu");

        assert!(logou(&desta, Level::ERROR, "DESTA"));
        assert!(
            !logou(&desta, Level::ERROR, "DA OUTRA"),
            "vazou evento de outra thread — captura não isolada"
        );
        assert!(logou(&da_outra, Level::ERROR, "DA OUTRA"));
    }
}
