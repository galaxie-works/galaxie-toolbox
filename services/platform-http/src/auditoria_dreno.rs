//! #1565 (fatia B da auditoria) — o DRENO `AuditorBuffer` → OpenObserve, e a serialização do trilho.
//!
//! **Uma serialização só.** A linha JSON de um evento de autz nasce em [`linha_json`], usada TANTO pelo
//! `AuditorLog` (stdout, `servidor.rs`) COMO por este dreno. Duas cópias divergiriam, e o guard
//! anti-injeção do #1594 só cobre o caminho que realmente exercita.
//!
//! O formato OTLP copia o que a telemetria do app (`src-tauri/src/telemetry.rs`) já entrega a ESTE
//! OpenObserve: `resourceLogs` → `scopeLogs` → `logRecords`.
//!
//! **Fora do caminho síncrono (AC2).** O `registrar` só escreve no buffer; quem fala com a rede é a
//! task de [`rodar`], noutro lugar do runtime. Regras de entrega do @Altair (#1565, comment 6136877939):
//! - 2xx: entregue. 5xx, 429, rede ou timeout: o lote **volta** ao buffer e tenta-se com backoff até 60 s.
//! - 401/403 (ou 3xx, que com redirect desligado é endpoint errado): **volta** e loga em `error!` —
//!   é configuração, não o destino em baixo, e um humano tem de ver.
//! - 400/413/outros 4xx: lote **envenenado** — conta como perda declarada e não volta (ciclo infinito).
//! - No encerramento: uma última passada com prazo de ~3 s; o que sobrar vai para o stdout como
//!   `auditoria_perdida` com `n` (o stdout é a cópia não autoritativa que sobrevive ao encerramento).

use std::io::Write as _;
use std::sync::Arc;
use std::time::{Duration, Instant};

use galaxie_platform_back_office::{AuditorBuffer, EventoAuditado};
use galaxie_platform_identity::auditoria::{AlvoDono, ResultadoAutz};

use crate::auditoria_config::{ConfigDrenoAuditoria, STREAM_AUDITORIA};

/// **O intervalo de dreno é um parâmetro de SEGURANÇA, não de rede** (AC extra do #1565). Sob
/// inundação o buffer não apaga o passado (o contador `perdidos` protege o que já está retido), mas
/// **cega o presente** até ao próximo dreno: tudo o que transborda até lá vira só um número. O intervalo
/// é, portanto, a duração máxima dessa cegueira em regime normal. 5 s mantém-na curta ao custo de ~1
/// POST a cada 5 s com tráfego, o que é barato; e o dreno antecipado a meio do buffer encurta-a ainda
/// mais sob inundação. Subir este número "para poupar rede" alarga a janela em que um ataque em curso
/// não chega ao trilho — é o AC que se perde primeiro quando alguém afina depois.
pub(crate) const INTERVALO_DRENO: Duration = Duration::from_secs(5);
/// Cadência com que a task olha para o buffer (o gatilho do meio-buffer e o fim do intervalo).
const TIQUE: Duration = Duration::from_millis(500);
/// Teto do backoff quando o destino está em baixo (regra do @Altair).
const BACKOFF_MAX: Duration = Duration::from_secs(60);
/// Máximo de registos por POST: um lote enorme depois de uma indisponibilidade longa não pode virar
/// um 413 (que o envenenaria inteiro) nem um pedido que nunca acaba dentro do timeout.
pub(crate) const MAX_POR_POST: usize = 500;
/// Prazo da última passada no encerramento (o orquestrador mata o processo pouco depois).
pub(crate) const PRAZO_ENCERRAMENTO: Duration = Duration::from_secs(3);

// ---------------------------------------------------------------------------------------------------
// Serialização
// ---------------------------------------------------------------------------------------------------

/// O evento de auditoria como sai numa linha JSON. 🔑 NUNCA carrega claim — só ator/ação/resultado/
/// alvo. Serializado por `serde_json`, NÃO interpolado (achado do @Altair, #1539): o `ator` nasce do
/// `subject` do provedor OAuth — dado EXTERNO por desenho. Interpolar deixaria um `subject` com `"`
/// FORJAR entradas de auditoria (injeção de log). Dado que vem de fora não se interpola, se serializa.
#[derive(serde::Serialize)]
struct EventoAuditoriaLog<'a> {
    tipo: &'a str,
    ator: &'a str,
    acao: &'a str,
    resultado: &'a str,
    /// O TIPO do alvo (`org`/`usuario`/`""`) — #1591: sem isto org e usuário achatavam no mesmo id e
    /// a distribuição sobre alvos (a forma da enumeração) sumia.
    alvo_tipo: &'a str,
    alvo: &'a str,
}

/// A linha JSON de UMA decisão de autz. O construtor PARTILHADO (ver o doc do módulo). `None` só se a
/// serialização falhar — impossível com campos `&str`, mas não emitir é melhor que emitir lixo.
pub(crate) fn linha_json(
    ator: &str,
    acao: &str,
    resultado: ResultadoAutz,
    alvo_tipo: &str,
    alvo: &str,
) -> Option<String> {
    let resultado = match resultado {
        ResultadoAutz::Permitido => "permitido",
        ResultadoAutz::Negado => "negado",
    };
    serde_json::to_string(&EventoAuditoriaLog { tipo: "autz", ator, acao, resultado, alvo_tipo, alvo }).ok()
}

/// `(alvo_tipo, alvo)` de um alvo possuído — a mesma convenção do `AuditorLog`.
fn alvo_partes(alvo: &AlvoDono) -> (&'static str, &str) {
    match alvo {
        AlvoDono::Org(o) => ("org", o.0.as_str()),
        AlvoDono::Usuario(u) => ("usuario", u.0.as_str()),
        AlvoDono::SemAlvo => ("", ""),
    }
}

/// A linha JSON de um evento DRENADO: a decisão (pela [`linha_json`]) ou o transbordo NOMEADO
/// (`{"tipo":"auditoria_perdida","n":N}`, AC3 — a lacuna chega ao destino final, nunca silêncio).
pub(crate) fn linha_de_evento(e: &EventoAuditado) -> Option<String> {
    match e {
        EventoAuditado::Autz { ator, acao, alvo, resultado, .. } => {
            let (alvo_tipo, alvo) = alvo_partes(alvo);
            linha_json(&ator.0, acao, *resultado, alvo_tipo, alvo)
        }
        EventoAuditado::Perda { n } => {
            serde_json::to_string(&serde_json::json!({ "tipo": "auditoria_perdida", "n": n })).ok()
        }
    }
}

/// O corpo OTLP/HTTP logs (JSON) de um lote. `agora_unix` é o instante do dreno: vira o
/// `observedTimeUnixNano` de todos e o `timeUnixNano` da `Perda` (que não tem instante próprio — a
/// perda é constatada no dreno). A decisão leva o `ts_unix` carimbado no `registrar` e, em atributo,
/// o `evento.id` estável (a entrega é pelo menos uma vez; é por ele que o leitor deduplica).
///
/// Severidade: permitido = `INFO`, negado = `WARN` (é o que um alerta de sondagem filtra), perda =
/// `ERROR` (o trilho tem um buraco — tem de saltar à vista).
pub(crate) fn payload_otlp(eventos: &[EventoAuditado], agora_unix: u64) -> serde_json::Value {
    let ns = |s: u64| (u128::from(s) * 1_000_000_000).to_string();
    let registros: Vec<serde_json::Value> = eventos
        .iter()
        .filter_map(|e| {
            let corpo = linha_de_evento(e)?;
            let (ts, severidade, id) = match e {
                EventoAuditado::Autz { ts_unix, resultado: ResultadoAutz::Permitido, id, .. } => {
                    (*ts_unix, "INFO", Some(id))
                }
                EventoAuditado::Autz { ts_unix, resultado: ResultadoAutz::Negado, id, .. } => {
                    (*ts_unix, "WARN", Some(id))
                }
                EventoAuditado::Perda { .. } => (agora_unix, "ERROR", None),
            };
            let atributos: Vec<serde_json::Value> = id
                .map(|id| serde_json::json!({ "key": "evento.id", "value": { "stringValue": id } }))
                .into_iter()
                .collect();
            Some(serde_json::json!({
                "timeUnixNano": ns(ts),
                "observedTimeUnixNano": ns(agora_unix),
                "severityText": severidade,
                "body": { "stringValue": corpo },
                "attributes": atributos,
            }))
        })
        .collect();
    serde_json::json!({
        "resourceLogs": [{
            "resource": { "attributes": [
                { "key": "service.name", "value": { "stringValue": "galaxie-platform" } }
            ]},
            "scopeLogs": [{
                "scope": { "name": "galaxie.auditoria" },
                "logRecords": registros
            }]
        }]
    })
}

// ---------------------------------------------------------------------------------------------------
// Entrega
// ---------------------------------------------------------------------------------------------------

/// O que fazer com um lote depois do POST (regras do @Altair).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Desfecho {
    /// 2xx — chegou ao trilho.
    Entregue,
    /// Falha transitória do destino (rede, timeout, 5xx, 429): o lote volta e tenta-se com backoff.
    Devolver,
    /// Falha de CONFIGURAÇÃO (401/403, ou 3xx com redirect desligado): o lote volta, mas loga-se em
    /// `error!` — esperar não resolve, um humano tem de corrigir o token ou o endpoint.
    DevolverAlto,
    /// 400/413/outros 4xx: o destino recusa o CONTEÚDO. Devolver seria um ciclo infinito; conta como
    /// perda declarada.
    Envenenado,
}

/// Classifica a resposta. `None` = não chegou resposta (rede, DNS, TLS, timeout).
pub(crate) fn classificar(status: Option<u16>) -> Desfecho {
    match status {
        None => Desfecho::Devolver,
        Some(200..=299) => Desfecho::Entregue,
        // 429 não está nas regras do card: é o destino a pedir calma, transitório por definição.
        Some(429) => Desfecho::Devolver,
        Some(500..=599) => Desfecho::Devolver,
        Some(401 | 403) => Desfecho::DevolverAlto,
        // Com o redirect DESLIGADO, um 3xx só pode ser endpoint mal configurado: reter e gritar.
        Some(300..=399) => Desfecho::DevolverAlto,
        Some(_) => Desfecho::Envenenado,
    }
}

/// Um POST OTLP de um lote. Devolve o desfecho e o status (para o log).
async fn entregar(
    cliente: &reqwest::Client,
    cfg: &ConfigDrenoAuditoria,
    lote: &[EventoAuditado],
    agora_unix: u64,
) -> (Desfecho, Option<u16>) {
    let corpo = match serde_json::to_vec(&payload_otlp(lote, agora_unix)) {
        Ok(c) => c,
        // Não acontece (só `Value`s), mas se acontecer o conteúdo é o problema: envenenado, não ciclo.
        Err(_) => return (Desfecho::Envenenado, None),
    };
    let resposta = cliente
        .post(&cfg.endpoint)
        .basic_auth(&cfg.email, Some(&cfg.token))
        .header("stream-name", STREAM_AUDITORIA)
        .header(reqwest::header::CONTENT_TYPE, "application/json")
        .body(corpo)
        .send()
        .await;
    let status = resposta.ok().map(|r| r.status().as_u16());
    (classificar(status), status)
}

/// Quantos eventos um pedaço do trilho representa: um `Autz` vale 1, uma `Perda{n}` vale `n`.
fn contar(eventos: &[EventoAuditado]) -> u64 {
    eventos
        .iter()
        .map(|e| match e {
            EventoAuditado::Autz { .. } => 1,
            EventoAuditado::Perda { n } => *n,
        })
        .sum()
}

/// O resultado de uma passada de dreno.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Ciclo {
    /// Tudo entregue (ou envenenado e contado como perda): o backoff zera.
    Concluido,
    /// O destino falhou de forma recuperável: o resto do lote voltou ao buffer; entra em backoff.
    Falhou,
}

/// UMA passada: drena o buffer e entrega em POSTs de no máximo `max_por_post`. Na primeira falha
/// recuperável, devolve TUDO o que falta (deste POST em diante) e para — os POSTs seguintes falhariam
/// igual. Um POST envenenado conta como perda e a passada continua com os outros.
pub(crate) async fn ciclo_de_dreno(
    cliente: &reqwest::Client,
    cfg: &ConfigDrenoAuditoria,
    buf: &AuditorBuffer,
    agora_unix: u64,
    max_por_post: usize,
) -> Ciclo {
    let eventos = buf.drenar();
    let mut i = 0;
    while i < eventos.len() {
        let fim = (i + max_por_post).min(eventos.len());
        let lote = &eventos[i..fim];
        let (desfecho, status) = entregar(cliente, cfg, lote, agora_unix).await;
        match desfecho {
            Desfecho::Entregue => {}
            Desfecho::Envenenado => {
                tracing::error!(?status, n = contar(lote), "[auditoria] lote recusado pelo destino — contado como perda");
                buf.descartar_como_perda(lote);
            }
            Desfecho::Devolver | Desfecho::DevolverAlto => {
                if desfecho == Desfecho::DevolverAlto {
                    tracing::error!(?status, "[auditoria] o destino recusou a credencial ou o endpoint — lote retido, CORRIGIR config");
                } else {
                    tracing::warn!(?status, "[auditoria] destino indisponível — lote retido, nova tentativa com backoff");
                }
                buf.devolver(eventos[i..].to_vec());
                return Ciclo::Falhou;
            }
        }
        i = fim;
    }
    Ciclo::Concluido
}

/// A última passada, no encerramento, com prazo total `prazo`. Devolve QUANTO ficou por entregar (que
/// o chamador declara no stdout). Aqui não há "devolver": o processo vai acabar, e o que não chegou ao
/// trilho só pode ficar declarado.
pub(crate) async fn esvaziar_no_encerramento(
    cliente: &reqwest::Client,
    cfg: &ConfigDrenoAuditoria,
    buf: &AuditorBuffer,
    agora_unix: u64,
    prazo: Duration,
) -> u64 {
    let eventos = buf.drenar();
    let limite = Instant::now() + prazo;
    let mut i = 0;
    while i < eventos.len() {
        let resta = limite.saturating_duration_since(Instant::now());
        if resta.is_zero() {
            break;
        }
        let fim = (i + MAX_POR_POST).min(eventos.len());
        match tokio::time::timeout(resta, entregar(cliente, cfg, &eventos[i..fim], agora_unix)).await {
            Ok((Desfecho::Entregue, _)) => i = fim,
            _ => break,
        }
    }
    contar(&eventos[i..])
}

/// A task do dreno: roda até `encerrar` mudar, drenando a cada [`INTERVALO_DRENO`] ou mais cedo quando
/// o buffer passa de metade; em falha recuperável, backoff exponencial (5 s → 60 s). No fim faz a
/// passada de encerramento e declara a sobra no stdout.
pub async fn rodar(
    cfg: ConfigDrenoAuditoria,
    buf: Arc<AuditorBuffer>,
    mut encerrar: tokio::sync::watch::Receiver<bool>,
    relogio: fn() -> u64,
) {
    // O mesmo cliente de saída disciplinado da troca OAuth: rustls, timeout explícito, redirect
    // DESLIGADO (um 3xx não pode desviar o token ingest-only para outro host).
    let cliente = crate::oauth_troca::cliente_troca();
    let mut ultimo = Instant::now();
    let mut backoff: Option<Duration> = None;
    let mut proxima = Instant::now();
    loop {
        tokio::select! {
            _ = tokio::time::sleep(TIQUE) => {}
            _ = encerrar.changed() => break,
        }
        let agora = Instant::now();
        if agora < proxima {
            continue; // em backoff
        }
        if agora.duration_since(ultimo) < INTERVALO_DRENO && !buf.acima_da_metade() {
            continue;
        }
        ultimo = agora;
        match ciclo_de_dreno(&cliente, &cfg, &buf, relogio(), MAX_POR_POST).await {
            Ciclo::Concluido => backoff = None,
            Ciclo::Falhou => {
                let b = backoff.map_or(INTERVALO_DRENO, |b| (b * 2).min(BACKOFF_MAX));
                backoff = Some(b);
                proxima = Instant::now() + b;
            }
        }
    }
    let sobra = esvaziar_no_encerramento(&cliente, &cfg, &buf, relogio(), PRAZO_ENCERRAMENTO).await;
    if sobra > 0 {
        tracing::error!(n = sobra, "[auditoria] encerramento: eventos que não chegaram ao trilho");
        if let Some(linha) = linha_de_evento(&EventoAuditado::Perda { n: sobra }) {
            let _ = writeln!(std::io::stdout(), "{linha}");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    use axum::extract::State;
    use axum::http::{HeaderMap, StatusCode};
    use axum::routing::post;
    use axum::Router;
    use galaxie_platform_identity::auditoria::{Auditor, EventoAutz};
    use galaxie_platform_identity::{OrgId, UserId};

    fn autz(ator: &str, resultado: ResultadoAutz, ts: u64) -> EventoAuditado {
        EventoAuditado::Autz {
            id: format!("boot-{ts}"),
            ator: UserId(ator.into()),
            acao: "back_office.listar_orgs".into(),
            alvo: AlvoDono::Org(OrgId("acme".into())),
            resultado,
            ts_unix: ts,
        }
    }

    fn registros(p: &serde_json::Value) -> &Vec<serde_json::Value> {
        p["resourceLogs"][0]["scopeLogs"][0]["logRecords"].as_array().expect("logRecords")
    }

    // ---- serialização ----

    #[test]
    fn lote_vira_otlp_com_instante_da_decisao_id_e_perda_nomeada() {
        let lote = [
            autz("s1", ResultadoAutz::Permitido, 1_000),
            autz("u9", ResultadoAutz::Negado, 1_007),
            EventoAuditado::Perda { n: 3 },
        ];
        let p = payload_otlp(&lote, 2_000);
        assert_eq!(p["resourceLogs"][0]["scopeLogs"][0]["scope"]["name"], "galaxie.auditoria");
        let r = registros(&p);
        assert_eq!(r.len(), 3);
        // A decisão leva o SEU instante (o do registrar), não o do dreno, e o id estável.
        assert_eq!(r[0]["timeUnixNano"], "1000000000000");
        assert_eq!(r[1]["timeUnixNano"], "1007000000000");
        assert_eq!(r[0]["observedTimeUnixNano"], "2000000000000");
        assert_eq!(r[0]["attributes"][0]["key"], "evento.id");
        assert_eq!(r[0]["attributes"][0]["value"]["stringValue"], "boot-1000");
        assert_eq!((r[0]["severityText"].as_str(), r[1]["severityText"].as_str()), (Some("INFO"), Some("WARN")));
        // AC3: a lacuna chega NOMEADA ao destino, com a contagem — e salta à vista (ERROR).
        assert_eq!(r[2]["severityText"], "ERROR");
        let perda: serde_json::Value =
            serde_json::from_str(r[2]["body"]["stringValue"].as_str().unwrap()).unwrap();
        assert_eq!(perda, serde_json::json!({ "tipo": "auditoria_perdida", "n": 3 }));
    }

    #[test]
    fn corpo_da_decisao_tem_a_forma_do_auditor_log() {
        let p = payload_otlp(&[autz("s1", ResultadoAutz::Negado, 5)], 9);
        let corpo: serde_json::Value =
            serde_json::from_str(registros(&p)[0]["body"]["stringValue"].as_str().unwrap()).unwrap();
        assert_eq!(
            corpo,
            serde_json::json!({
                "tipo": "autz", "ator": "s1", "acao": "back_office.listar_orgs",
                "resultado": "negado", "alvo_tipo": "org", "alvo": "acme"
            })
        );
    }

    #[test]
    fn ator_externo_com_aspas_nao_forja_entrada() {
        // #1539: o `ator` nasce do `subject` do provedor (dado EXTERNO). Um subject com `"` não pode
        // fechar o campo e injetar um `tipo` próprio — serializado, sai escapado dentro do `ator`.
        let malicioso = r#"x","tipo":"forjado","resultado":"permitido"#;
        let p = payload_otlp(&[autz(malicioso, ResultadoAutz::Negado, 5)], 9);
        let corpo: serde_json::Value =
            serde_json::from_str(registros(&p)[0]["body"]["stringValue"].as_str().unwrap()).unwrap();
        assert_eq!(corpo["ator"], malicioso, "o subject inteiro fica DENTRO do campo ator");
        assert_eq!(corpo["tipo"], "autz", "não forjou o tipo");
        assert_eq!(corpo["resultado"], "negado", "não forjou o resultado");
    }

    #[test]
    fn classificacao_segue_as_regras_de_entrega() {
        assert_eq!(classificar(Some(200)), Desfecho::Entregue);
        assert_eq!(classificar(Some(204)), Desfecho::Entregue);
        assert_eq!(classificar(None), Desfecho::Devolver, "rede/timeout");
        assert_eq!(classificar(Some(500)), Desfecho::Devolver);
        assert_eq!(classificar(Some(503)), Desfecho::Devolver);
        assert_eq!(classificar(Some(429)), Desfecho::Devolver, "throttling é transitório");
        assert_eq!(classificar(Some(401)), Desfecho::DevolverAlto);
        assert_eq!(classificar(Some(403)), Desfecho::DevolverAlto);
        assert_eq!(classificar(Some(302)), Desfecho::DevolverAlto, "redirect desligado = endpoint errado");
        assert_eq!(classificar(Some(400)), Desfecho::Envenenado);
        assert_eq!(classificar(Some(413)), Desfecho::Envenenado);
        assert_eq!(classificar(Some(422)), Desfecho::Envenenado);
    }

    // ---- entrega contra um endpoint falso ----

    /// O que o endpoint falso viu de cada POST.
    #[derive(Clone, Default)]
    struct Visto {
        pedidos: Arc<Mutex<Vec<(HeaderMap, serde_json::Value)>>>,
    }

    /// Sobe um OpenObserve falso que responde `status` a todo POST e regista cabeçalhos e corpo.
    async fn destino(status: StatusCode) -> (String, Visto) {
        let visto = Visto::default();
        let app = Router::new()
            .route(
                "/api/default/v1/logs",
                post(move |State(v): State<Visto>, h: HeaderMap, corpo: String| async move {
                    let json = serde_json::from_str(&corpo).unwrap_or(serde_json::Value::Null);
                    v.pedidos.lock().unwrap().push((h, json));
                    status
                }),
            )
            .with_state(visto.clone());
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });
        (format!("http://{addr}/api/default/v1/logs"), visto)
    }

    /// Endpoint onde ninguém escuta (porto ocupado e largado): a ligação é recusada = falha de rede.
    async fn endpoint_morto() -> String {
        let l = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = l.local_addr().unwrap();
        drop(l);
        format!("http://{addr}/api/default/v1/logs")
    }

    fn cfg(endpoint: String) -> ConfigDrenoAuditoria {
        // email "a" + token "b" ⇒ `Basic base64("a:b")` = `Basic YTpi` (conferível sem crate de base64).
        ConfigDrenoAuditoria { endpoint, email: "a".into(), token: "b".into() }
    }

    fn buffer_com(n: usize) -> AuditorBuffer {
        let buf = AuditorBuffer::novo(100);
        let ator = UserId("s1".into());
        for _ in 0..n {
            buf.registrar(&EventoAutz {
                ator: &ator,
                acao: "back_office.listar_orgs",
                alvo: galaxie_platform_identity::auditoria::Alvo::SemAlvo,
                resultado: ResultadoAutz::Negado,
            });
        }
        buf
    }

    fn ids(eventos: &[EventoAuditado]) -> Vec<String> {
        eventos
            .iter()
            .filter_map(|e| match e {
                EventoAuditado::Autz { id, .. } => Some(id.clone()),
                EventoAuditado::Perda { .. } => None,
            })
            .collect()
    }

    #[tokio::test]
    async fn ac1_eventos_chegam_ao_stream_da_auditoria_com_a_credencial_do_servidor() {
        let (url, visto) = destino(StatusCode::OK).await;
        let buf = buffer_com(3);
        let c = ciclo_de_dreno(&crate::oauth_troca::cliente_troca(), &cfg(url), &buf, 50, MAX_POR_POST).await;
        assert_eq!(c, Ciclo::Concluido);
        assert!(buf.drenar().is_empty(), "entregue = saiu do buffer");
        let pedidos = visto.pedidos.lock().unwrap();
        assert_eq!(pedidos.len(), 1);
        let (h, corpo) = &pedidos[0];
        // AC4: o stream é o da auditoria (nunca o do produto) e a credencial é a do servidor.
        assert_eq!(h["stream-name"], "galaxie_auditoria");
        assert_eq!(h["authorization"], "Basic YTpi");
        assert_eq!(registros(corpo).len(), 3, "os 3 eventos chegaram");
    }

    #[tokio::test]
    async fn destino_em_baixo_devolve_o_lote_com_os_mesmos_ids() {
        let (url, _) = destino(StatusCode::SERVICE_UNAVAILABLE).await;
        let buf = buffer_com(3);
        // Espreita os ids sem os perder: drena e devolve (o `devolver` já está testado na fatia A).
        let antes = {
            let d = buf.drenar();
            let ids_d = ids(&d);
            buf.devolver(d);
            ids_d
        };
        let c = ciclo_de_dreno(&crate::oauth_troca::cliente_troca(), &cfg(url), &buf, 50, MAX_POR_POST).await;
        assert_eq!(c, Ciclo::Falhou, "503 entra em backoff");
        assert_eq!(ids(&buf.drenar()), antes, "nada se perdeu e os ids não mudaram (reenvio deduplicável)");
    }

    #[tokio::test]
    async fn sem_rede_devolve_em_vez_de_perder_em_silencio() {
        let url = endpoint_morto().await;
        let buf = buffer_com(2);
        let c = ciclo_de_dreno(&crate::oauth_troca::cliente_troca(), &cfg(url), &buf, 50, MAX_POR_POST).await;
        assert_eq!(c, Ciclo::Falhou);
        assert_eq!(ids(&buf.drenar()).len(), 2, "o lote voltou — antes do #1565 sumia aqui");
    }

    #[tokio::test]
    async fn credencial_recusada_retem_o_lote() {
        let (url, _) = destino(StatusCode::UNAUTHORIZED).await;
        let buf = buffer_com(2);
        let c = ciclo_de_dreno(&crate::oauth_troca::cliente_troca(), &cfg(url), &buf, 50, MAX_POR_POST).await;
        assert_eq!(c, Ciclo::Falhou);
        assert_eq!(ids(&buf.drenar()).len(), 2, "401 retém (é config, não conteúdo)");
    }

    #[tokio::test]
    async fn lote_envenenado_vira_perda_declarada() {
        let (url, _) = destino(StatusCode::PAYLOAD_TOO_LARGE).await;
        let buf = buffer_com(4);
        let c = ciclo_de_dreno(&crate::oauth_troca::cliente_troca(), &cfg(url), &buf, 50, MAX_POR_POST).await;
        assert_eq!(c, Ciclo::Concluido, "envenenado não entra em backoff (devolver seria ciclo infinito)");
        assert_eq!(buf.drenar(), vec![EventoAuditado::Perda { n: 4 }], "a perda fica declarada");
    }

    #[tokio::test]
    async fn lote_grande_e_partido_em_posts_com_teto() {
        let (url, visto) = destino(StatusCode::OK).await;
        let buf = buffer_com(5);
        let c = ciclo_de_dreno(&crate::oauth_troca::cliente_troca(), &cfg(url), &buf, 50, 2).await;
        assert_eq!(c, Ciclo::Concluido);
        let tamanhos: Vec<usize> =
            visto.pedidos.lock().unwrap().iter().map(|(_, c)| registros(c).len()).collect();
        assert_eq!(tamanhos, [2, 2, 1], "máx. 2 por POST");
    }

    #[tokio::test]
    async fn rodar_e_o_consumidor_real_e_esvazia_no_encerramento() {
        // "Teste não é consumidor": os outros testes chamam o `ciclo_de_dreno`; a produção chama o
        // `rodar`. Aqui sobe-se a TASK real e manda-se encerrar logo — o que estava no buffer tem de
        // chegar ao destino pela passada de encerramento.
        let (url, visto) = destino(StatusCode::OK).await;
        let buf = Arc::new(buffer_com(3));
        let (encerrar, sinal) = tokio::sync::watch::channel(false);
        let tarefa = tokio::spawn(rodar(cfg(url), buf.clone(), sinal, || 50));
        encerrar.send(true).unwrap();
        tarefa.await.unwrap();
        let entregues: usize = visto.pedidos.lock().unwrap().iter().map(|(_, c)| registros(c).len()).sum();
        assert_eq!(entregues, 3, "o rodar entregou o buffer na saída");
        assert!(buf.drenar().is_empty());
    }

    #[tokio::test]
    async fn encerramento_entrega_o_que_da_e_conta_a_sobra() {
        let (url, _) = destino(StatusCode::OK).await;
        let buf = buffer_com(3);
        let sobra = esvaziar_no_encerramento(&crate::oauth_troca::cliente_troca(), &cfg(url), &buf, 50, PRAZO_ENCERRAMENTO).await;
        assert_eq!(sobra, 0, "destino de pé: nada sobra");

        let url = endpoint_morto().await;
        let buf = buffer_com(3);
        let sobra = esvaziar_no_encerramento(&crate::oauth_troca::cliente_troca(), &cfg(url), &buf, 50, PRAZO_ENCERRAMENTO).await;
        assert_eq!(sobra, 3, "destino em baixo: os 3 ficam declarados (vão para o stdout)");
    }
}
