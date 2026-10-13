//! #1565 (fatia B da auditoria) — config do DRENO buffer → OpenObserve, lida do AMBIENTE do servidor.
//!
//! Contrato de ingestão medido pelo @Altair (#1565): OTLP/HTTP logs JSON, `Authorization: Basic
//! base64("<email>:<token>")`, header `stream-name`. O token é **ingest-only e vive SÓ no servidor**
//! (AC4) — vem do cofre por `_FILE`, nunca do código, nunca de um artefacto de cliente.
//!
//! Mesmas regras do `oauth_config` (#1723): os 3 campos (endpoint + email + token) todos presentes
//! (liga o dreno) ou todos ausentes (dreno desligado); o meio-termo ABORTA o boot (fail-closed). Vazio
//! ou só-espaços conta como ausente. O endpoint tem de ser `https://` (ou `http://localhost` em dev).

use anyhow::{bail, Context, Result};

use crate::oauth_config::{ler_var, url_https_ou_localhost};

/// O stream do trilho de auditoria — **CONSTANTE no código, não variável de ambiente** (reforço do
/// AC4, @Altair). O token de telemetria de PRODUTO está embutido no instalador de todos os
/// utilizadores e escreve no `galaxie_toolbox`; se o stream da auditoria fosse configurável, uma env mal
/// posta apontava o trilho para um stream onde qualquer cliente injeta linhas — falsificação, não fuga.
/// Fixo aqui, o único jeito de o mudar é uma PR revista.
pub const STREAM_AUDITORIA: &str = "galaxie_auditoria";

/// Prefixo das variáveis de ambiente do dreno.
const PFX: &str = "GALAXIE_AUDITORIA_OTLP";

/// Config do dreno ligado. **Sem `Debug`/`Clone`** de propósito: guarda o token ingest-only, que não
/// pode ser imprimível nem copiado por acidente para um log.
pub struct ConfigDrenoAuditoria {
    /// URL completa do endpoint OTLP de logs (ex. `https://…/api/default/v1/logs`).
    pub endpoint: String,
    /// O e-mail da conta de ingestão (metade do `Basic`).
    pub email: String,
    /// O token ingest-only (a outra metade do `Basic`). Só sai daqui para o header de autorização.
    pub token: String,
}

/// Lê a config do ambiente REAL (env + ficheiro do cofre). `Ok(None)` = dreno desligado.
pub fn do_ambiente() -> Result<Option<ConfigDrenoAuditoria>> {
    carregar(|k| std::env::var(k).ok(), |p| std::fs::read_to_string(p))
}

/// Núcleo testável (I/O injetado, sem tocar no ambiente global do processo).
pub fn carregar(
    env: impl Fn(&str) -> Option<String>,
    ler_arquivo: impl Fn(&str) -> std::io::Result<String>,
) -> Result<Option<ConfigDrenoAuditoria>> {
    let endpoint = ler_var(&env, &format!("{PFX}_ENDPOINT"));
    let email = ler_var(&env, &format!("{PFX}_EMAIL"));
    let token = ler_token(&env, &ler_arquivo)?;

    match (endpoint, email, token) {
        (None, None, None) => Ok(None),
        (Some(endpoint), Some(email), Some(token)) => {
            if !url_https_ou_localhost(&endpoint) {
                bail!("{PFX}_ENDPOINT tem de ser https:// (ou http://localhost em dev) — recebido: {endpoint}");
            }
            Ok(Some(ConfigDrenoAuditoria { endpoint, email, token }))
        }
        _ => bail!(
            "{PFX}: config do dreno de auditoria PARCIAL — exige ENDPOINT + EMAIL + (TOKEN | TOKEN_FILE), \
             ou NENHUM dos três. Meio-dreno recusa subir (fail-closed)."
        ),
    }
}

/// O token, preferindo `<PFX>_TOKEN_FILE` (caminho do cofre; apara só o `\n`/`\r` final) sobre
/// `<PFX>_TOKEN`. Conteúdo vazio conta como ausente. `_FILE` ilegível é `Err` com contexto — nunca se
/// mascara em "ausente" (seria fail-open silencioso).
fn ler_token(
    env: &impl Fn(&str) -> Option<String>,
    ler_arquivo: &impl Fn(&str) -> std::io::Result<String>,
) -> Result<Option<String>> {
    if let Some(caminho) = ler_var(env, &format!("{PFX}_TOKEN_FILE")) {
        let conteudo = ler_arquivo(&caminho)
            .with_context(|| format!("{PFX}_TOKEN_FILE: não consegui ler {caminho}"))?;
        let token = conteudo.trim_end_matches(['\n', '\r']).to_string();
        return Ok(Some(token).filter(|t| !t.trim().is_empty()));
    }
    Ok(ler_var(env, &format!("{PFX}_TOKEN")))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    fn carregar_de(
        vars: &[(&str, &str)],
        arquivos: &[(&str, &str)],
    ) -> Result<Option<ConfigDrenoAuditoria>> {
        let vars: HashMap<String, String> = vars.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect();
        let arquivos: HashMap<String, String> =
            arquivos.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect();
        carregar(
            |k| vars.get(k).cloned(),
            |p| arquivos.get(p).cloned().ok_or_else(|| std::io::Error::new(std::io::ErrorKind::NotFound, p.to_string())),
        )
    }

    /// Extrai o `Err` sem exigir `Debug` no `Ok` (a config guarda o token e não é `Debug`).
    fn erro_de(r: Result<Option<ConfigDrenoAuditoria>>) -> String {
        match r {
            Ok(_) => panic!("esperava Err, veio Ok"),
            Err(e) => format!("{e:#}"),
        }
    }

    const ENDPOINT: &str = "https://telemetry.example/api/default/v1/logs";

    #[test]
    fn nada_definido_desliga_o_dreno() {
        assert!(carregar_de(&[], &[]).unwrap().is_none());
    }

    #[test]
    fn completo_com_token_file_liga_e_apara_newline() {
        let cfg = carregar_de(
            &[
                ("GALAXIE_AUDITORIA_OTLP_ENDPOINT", ENDPOINT),
                ("GALAXIE_AUDITORIA_OTLP_EMAIL", "auditoria@galaxie.test"),
                ("GALAXIE_AUDITORIA_OTLP_TOKEN", "valor-direto-ignorado"),
                ("GALAXIE_AUDITORIA_OTLP_TOKEN_FILE", "/run/secrets/aud"),
            ],
            &[("/run/secrets/aud", "tok-do-cofre\n")],
        )
        .unwrap()
        .expect("dreno ligado");
        assert_eq!(cfg.endpoint, ENDPOINT);
        assert_eq!(cfg.email, "auditoria@galaxie.test");
        assert_eq!(cfg.token, "tok-do-cofre", "_FILE vence o valor direto e apara o \\n final");
    }

    #[test]
    fn parcial_aborta_o_boot() {
        let msg = erro_de(carregar_de(
            &[("GALAXIE_AUDITORIA_OTLP_ENDPOINT", ENDPOINT), ("GALAXIE_AUDITORIA_OTLP_EMAIL", "a@b.test")],
            &[],
        ));
        assert!(msg.contains("PARCIAL"), "meio-dreno recusa subir: {msg}");
    }

    #[test]
    fn variavel_vazia_conta_como_ausente() {
        // `${VAR}` em falta no compose vira "" — os 3 vazios = desligado (não "ligado com vazio").
        let r = carregar_de(
            &[
                ("GALAXIE_AUDITORIA_OTLP_ENDPOINT", ""),
                ("GALAXIE_AUDITORIA_OTLP_EMAIL", " "),
                ("GALAXIE_AUDITORIA_OTLP_TOKEN", ""),
            ],
            &[],
        );
        assert!(r.unwrap().is_none());
        // E um token vazio com o resto presente = parcial (aborta), nunca liga com token "".
        let msg = erro_de(carregar_de(
            &[
                ("GALAXIE_AUDITORIA_OTLP_ENDPOINT", ENDPOINT),
                ("GALAXIE_AUDITORIA_OTLP_EMAIL", "a@b.test"),
                ("GALAXIE_AUDITORIA_OTLP_TOKEN_FILE", "/run/secrets/vazio"),
            ],
            &[("/run/secrets/vazio", "\n")],
        ));
        assert!(msg.contains("PARCIAL"), "token vazio ⇒ parcial: {msg}");
    }

    #[test]
    fn endpoint_http_arbitrario_e_recusado() {
        let msg = erro_de(carregar_de(
            &[
                ("GALAXIE_AUDITORIA_OTLP_ENDPOINT", "http://telemetry.example/api/default/v1/logs"),
                ("GALAXIE_AUDITORIA_OTLP_EMAIL", "a@b.test"),
                ("GALAXIE_AUDITORIA_OTLP_TOKEN", "tok"),
            ],
            &[],
        ));
        assert!(msg.contains("https://"), "http arbitrário recusado: {msg}");
    }

    #[test]
    fn stream_da_auditoria_nunca_e_o_do_produto() {
        // AC4: o trilho NÃO pode partilhar o stream onde o token de produto (embutido em todos os
        // clientes) escreve. Fixo no código — este teste é o canário se alguém o "unificar".
        assert_eq!(STREAM_AUDITORIA, "galaxie_auditoria");
        assert_ne!(STREAM_AUDITORIA, "galaxie_toolbox", "auditoria no stream do produto = falsificável");
    }
}
