//! #1565 (fatia B da auditoria) — a serialização do trilho para OTLP/HTTP logs (JSON).
//!
//! **Uma serialização só.** A linha JSON de um evento de autz nasce em [`linha_json`], usada TANTO pelo
//! `AuditorLog` (stdout, `servidor.rs`) COMO pelo dreno para o OpenObserve. Duas cópias divergiriam, e o
//! guard anti-injeção do #1594 só cobre o caminho que realmente exercita — por isso é um construtor
//! partilhado, não um segundo `format!`.
//!
//! O formato OTLP copia o que a telemetria do app (`src-tauri/src/telemetry.rs`) já entrega a ESTE
//! OpenObserve: `resourceLogs` → `scopeLogs` → `logRecords`, com `timeUnixNano`, `severityText` e
//! `body.stringValue`.

use galaxie_platform_back_office::EventoAuditado;
use galaxie_platform_identity::auditoria::{AlvoDono, ResultadoAutz};

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

/// O corpo OTLP/HTTP logs (JSON) de um lote drenado. `agora_unix` é o instante do dreno: vira o
/// `observedTimeUnixNano` de todos e o `timeUnixNano` da `Perda` (que não tem instante próprio — a
/// perda é constatada no dreno). A decisão leva o `ts_unix` carimbado no `registrar`.
///
/// Severidade: permitido = `INFO`, negado = `WARN` (é o que um alerta de sondagem filtra), perda =
/// `ERROR` (o trilho tem um buraco — tem de saltar à vista).
pub(crate) fn payload_otlp(eventos: &[EventoAuditado], agora_unix: u64) -> serde_json::Value {
    let ns = |s: u64| (u128::from(s) * 1_000_000_000).to_string();
    let registros: Vec<serde_json::Value> = eventos
        .iter()
        .filter_map(|e| {
            let corpo = linha_de_evento(e)?;
            let (ts, severidade) = match e {
                EventoAuditado::Autz { ts_unix, resultado: ResultadoAutz::Permitido, .. } => (*ts_unix, "INFO"),
                EventoAuditado::Autz { ts_unix, resultado: ResultadoAutz::Negado, .. } => (*ts_unix, "WARN"),
                EventoAuditado::Perda { .. } => (agora_unix, "ERROR"),
            };
            Some(serde_json::json!({
                "timeUnixNano": ns(ts),
                "observedTimeUnixNano": ns(agora_unix),
                "severityText": severidade,
                "body": { "stringValue": corpo },
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

#[cfg(test)]
mod tests {
    use super::*;
    use galaxie_platform_identity::{OrgId, UserId};

    fn autz(ator: &str, resultado: ResultadoAutz, ts: u64) -> EventoAuditado {
        EventoAuditado::Autz {
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

    #[test]
    fn lote_vira_otlp_com_instante_da_decisao_e_perda_nomeada() {
        let lote = [
            autz("s1", ResultadoAutz::Permitido, 1_000),
            autz("u9", ResultadoAutz::Negado, 1_007),
            EventoAuditado::Perda { n: 3 },
        ];
        let p = payload_otlp(&lote, 2_000);
        assert_eq!(p["resourceLogs"][0]["scopeLogs"][0]["scope"]["name"], "galaxie.auditoria");
        let r = registros(&p);
        assert_eq!(r.len(), 3);
        // A decisão leva o SEU instante (o do registrar), não o do dreno.
        assert_eq!(r[0]["timeUnixNano"], "1000000000000");
        assert_eq!(r[1]["timeUnixNano"], "1007000000000");
        assert_eq!(r[0]["observedTimeUnixNano"], "2000000000000");
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
}
