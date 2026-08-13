//! Domain-claim (PS7 #700): prova de POSSE de domínio — o gate pra absorver
//! usuários pessoais/uncontracted daquele domínio numa org contratada. A absorção
//! é SEMPRE gateada em domínio VERIFICADO, nunca pelo sufixo cru do e-mail.
//!
//! Slice 1 (billing-independente): o desafio (token + registro esperado) + a
//! lógica PURA de match. O fetch real da prova (DNS TXT vs well-known HTTP — método
//! a confirmar com o Polaris) e o "marcar org contratada" + JIT auto-join + migração
//! de config (seam #555) entram na slice 2, quando houver billing de org.

use rand::Rng;

/// Prefixo do registro de verificação (padrão `nome=valor`, estilo Google/MS).
pub const PREFIXO_VERIFICACAO: &str = "galaxie-verify";

/// Desafio de posse: o que o admin precisa publicar pra provar que controla o domínio.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesafioDominio {
    /// Domínio reivindicado, normalizado (minúsculo, sem `@`/espaços).
    pub dominio: String,
    /// Token opaco desta tentativa (single-use por reivindicação).
    pub token: String,
    /// Valor EXATO a publicar (registro DNS TXT do domínio OU arquivo well-known).
    pub registro: String,
}

/// Normaliza o domínio: trim, minúsculo, sem `@` na frente.
fn normalizar_dominio(bruto: &str) -> String {
    bruto.trim().trim_start_matches('@').to_ascii_lowercase()
}

fn token_aleatorio() -> String {
    const ALFABETO: &[u8] = b"abcdefghijklmnopqrstuvwxyz0123456789";
    let mut rng = rand::thread_rng();
    (0..32)
        .map(|_| ALFABETO[rng.gen_range(0..ALFABETO.len())] as char)
        .collect()
}

/// Cria o desafio de verificação pro domínio. Puro (sem I/O). A checagem real
/// (slice 2) consulta o DNS/well-known e compara os valores via [`registro_confere`].
pub fn iniciar_desafio(dominio: &str) -> Result<DesafioDominio, String> {
    let dominio = normalizar_dominio(dominio);
    // Domínio precisa de ao menos um ponto (label.tld); sem isso não é reivindicável.
    if dominio.is_empty() || !dominio.contains('.') || dominio.starts_with('.') || dominio.ends_with('.') {
        return Err("domínio inválido".into());
    }
    let token = token_aleatorio();
    let registro = format!("{PREFIXO_VERIFICACAO}={token}");
    Ok(DesafioDominio { dominio, token, registro })
}

/// Posse PROVADA se ALGUM registro publicado bate EXATAMENTE o valor esperado
/// (`galaxie-verify=<token>`). Tolera aspas (TXT costuma vir aspado) e espaços em
/// volta; NÃO casa por substring/prefixo — posse é match exato do token, senão um
/// domínio poderia forjar a posse com um valor "parecido".
pub fn registro_confere(publicados: &[String], esperado: &str) -> bool {
    let esperado = esperado.trim();
    if esperado.is_empty() {
        return false;
    }
    publicados
        .iter()
        .any(|r| r.trim().trim_matches('"').trim() == esperado)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn iniciar_desafio_normaliza_e_gera_registro() {
        let d = iniciar_desafio("  @Voaz.Builders ").unwrap();
        assert_eq!(d.dominio, "voaz.builders");
        assert_eq!(d.token.len(), 32);
        assert_eq!(d.registro, format!("galaxie-verify={}", d.token));
    }

    #[test]
    fn iniciar_desafio_rejeita_dominio_invalido() {
        assert!(iniciar_desafio("").is_err());
        assert!(iniciar_desafio("   ").is_err());
        assert!(iniciar_desafio("semponto").is_err());
        assert!(iniciar_desafio(".com").is_err());
        assert!(iniciar_desafio("voaz.").is_err());
    }

    #[test]
    fn tokens_sao_distintos_por_tentativa() {
        let a = iniciar_desafio("exemplo.com").unwrap();
        let b = iniciar_desafio("exemplo.com").unwrap();
        assert_ne!(a.token, b.token);
    }

    #[test]
    fn registro_confere_exige_match_exato() {
        let esperado = "galaxie-verify=abc123";
        // presente (com aspas, como o DNS TXT costuma devolver) → confere
        assert!(registro_confere(
            &["v=spf1 -all".into(), "\"galaxie-verify=abc123\"".into()],
            esperado
        ));
        // ausente → não confere
        assert!(!registro_confere(&["outra-coisa".into()], esperado));
        // substring/prefixo NÃO conta (anti-forja)
        assert!(!registro_confere(&["galaxie-verify=abc123extra".into()], esperado));
        assert!(!registro_confere(&["galaxie-verify=abc".into()], esperado));
        // token errado → não confere
        assert!(!registro_confere(&["galaxie-verify=zzz".into()], esperado));
        // esperado vazio nunca confere
        assert!(!registro_confere(&["galaxie-verify=".into()], ""));
    }
}
