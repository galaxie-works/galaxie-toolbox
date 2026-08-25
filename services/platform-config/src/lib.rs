//! Config do uso do app (prefs owner-scoped + allowlist) — #1471 (épico #1265).
//! Depende da fundação #1469 (`galaxie-platform-identity`).
//!
//! Duas guardas independentes (delta do @Altair):
//!  1. **Prefs owner-scoped** — o escopo vem da SESSÃO (fundação regra 5), nunca de um id
//!     no payload. Pref de outro usuário responde **404 (não 403 — não enumerar)**. Mesmo
//!     padrão do `/me` (#1473).
//!  2. **Allowlist explícita** do que a WEB pode configurar — NÃO "toda chave de pref". Se a
//!     plataforma pudesse gravar qualquer pref, viraria caminho de escalada (mexer em pref
//!     interna). Só as chaves de [`CHAVES_WEB`] são graváveis pela web; fora dela ⇒ recusa.
//!
//! Domínio PURO (como a fundação): a decisão é testável sem I/O. A borda HTTP e a
//! persistência das prefs são fatias seguintes que CHAMAM esta lógica.

#![forbid(unsafe_code)]

use galaxie_platform_identity::{Principal, Sessao, UserId};

/// Chaves de pref de USO DO APP que a plataforma web pode configurar — **allowlist
/// explícita** (regra 2 do delta). NÃO é "toda pref": é o conjunto seguro de expor à web.
/// Prefixo `app.` deixa claro que é uso do app (não pref interna/privilegiada). Crescer aqui
/// é uma decisão explícita — o default (fora da lista) é recusar.
pub const CHAVES_WEB: &[&str] = &[
    "app.tema",
    "app.idioma",
    "app.densidade",
    "app.notificacoes",
    "app.tela_inicial",
];

/// Erro de uma operação de pref. `NaoEncontrado` = 404 (pref de outro — não enumera);
/// `ChaveNaoPermitida` = a chave não está na allowlist da web (não é "toda pref").
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ConfigErro {
    NaoEncontrado,
    ChaveNaoPermitida,
}

/// `true` se `chave` está na allowlist da web ([`CHAVES_WEB`]) — a única coisa gravável pela
/// plataforma. Default-deny: qualquer chave fora da lista é recusada (AC2).
#[must_use]
pub fn chave_configuravel(chave: &str) -> bool {
    CHAVES_WEB.contains(&chave)
}

/// O `UserId` do humano dono da sessão — é daqui que sai o escopo das prefs (regra 5),
/// nunca de um id/payload do cliente.
fn usuario_da_sessao(sessao: &Sessao) -> &UserId {
    match sessao.principal() {
        Principal::UsuarioFinal { usuario, .. }
        | Principal::AdminOrg { usuario, .. }
        | Principal::Staff { usuario } => usuario,
    }
}

/// Resolve o dono das prefs a LER/escrever. `alvo_na_rota` é um id que eventualmente veio na
/// rota; `None` = prefs da própria sessão.
///
/// - `None` ⇒ o próprio usuário (AC1).
/// - `Some(id)` == usuário da sessão ⇒ ok.
/// - `Some(id)` != usuário da sessão ⇒ **`NaoEncontrado` (404, AC1/AC3)** — pref de outro não
///   vira 403 (não confirma existência); um id/owner de payload não amplia o escopo.
#[must_use = "a decisão de escopo tem de ser respeitada — ignorá-la expõe pref alheia"]
pub fn resolver_pref_propria<'a>(
    sessao: &'a Sessao,
    alvo_na_rota: Option<&UserId>,
) -> Result<&'a UserId, ConfigErro> {
    let eu = usuario_da_sessao(sessao);
    match alvo_na_rota {
        None => Ok(eu),
        Some(id) if id == eu => Ok(eu),
        Some(_) => Err(ConfigErro::NaoEncontrado),
    }
}

/// Autoriza uma ESCRITA de pref: duas guardas, na ordem que não vaza. Devolve o dono (o
/// usuário da sessão) quando permitido.
///
/// 1. **Owner-scope** ([`resolver_pref_propria`]) — pref de outro ⇒ 404 ANTES de olhar a
///    chave (não revela a política de chaves pra um recurso alheio; AC1/AC3).
/// 2. **Allowlist** ([`chave_configuravel`]) — chave fora da lista ⇒ `ChaveNaoPermitida` (AC2).
#[must_use = "a decisão de escrita tem de ser respeitada — ignorá-la grava pref alheia ou fora da allowlist"]
pub fn autorizar_escrita_pref<'a>(
    sessao: &'a Sessao,
    alvo_na_rota: Option<&UserId>,
    chave: &str,
) -> Result<&'a UserId, ConfigErro> {
    let dono = resolver_pref_propria(sessao, alvo_na_rota)?; // 404 primeiro (AC1/AC3)
    if !chave_configuravel(chave) {
        return Err(ConfigErro::ChaveNaoPermitida); // AC2
    }
    Ok(dono)
}

#[cfg(test)]
mod tests {
    use super::*;
    use galaxie_platform_identity::{Escopo, OrgId, Principal, Sessao, UserId};

    fn sessao_de(user: &str) -> Sessao {
        Sessao::estabelecer(
            Principal::UsuarioFinal {
                usuario: UserId(user.into()),
                org: OrgId("orgA".into()),
            },
            Escopo::vazio(),
        )
    }

    // AC1 — ler/escrever pref sem id resolve pro próprio usuário; pref de OUTRO = 404.
    #[test]
    fn ac1_pref_owner_scoped_outro_e_404() {
        let s = sessao_de("A");
        assert_eq!(resolver_pref_propria(&s, None), Ok(&UserId("A".into())));
        assert_eq!(
            resolver_pref_propria(&s, Some(&UserId("B".into()))),
            Err(ConfigErro::NaoEncontrado)
        );
        // escrita numa chave permitida, mas pref de B ⇒ 404 (owner-scope ANTES da allowlist).
        assert_eq!(
            autorizar_escrita_pref(&s, Some(&UserId("B".into())), "app.tema"),
            Err(ConfigErro::NaoEncontrado)
        );
    }

    // AC2 — chave FORA da allowlist ⇒ recusada (não é "toda pref"), mesmo na própria conta.
    #[test]
    fn ac2_chave_fora_da_allowlist_e_recusada() {
        let s = sessao_de("A");
        assert!(!chave_configuravel("app.interna_privilegiada"));
        assert_eq!(
            autorizar_escrita_pref(&s, None, "app.interna_privilegiada"),
            Err(ConfigErro::ChaveNaoPermitida)
        );
        assert_eq!(
            autorizar_escrita_pref(&s, None, "qualquer.coisa"),
            Err(ConfigErro::ChaveNaoPermitida)
        );
        // chave DA allowlist, própria conta ⇒ ok.
        assert_eq!(autorizar_escrita_pref(&s, None, "app.idioma"), Ok(&UserId("A".into())));
    }

    // AC3 — id/owner de payload não amplia o escopo: qualquer id != sessão ⇒ 404, mesmo com
    // chave permitida. A única fonte do escopo é a sessão.
    #[test]
    fn ac3_id_de_payload_nao_amplia() {
        let s = sessao_de("A");
        for forjado in ["B", "admin", ""] {
            assert_eq!(
                autorizar_escrita_pref(&s, Some(&UserId(forjado.into())), "app.tema"),
                Err(ConfigErro::NaoEncontrado),
                "id de rota {forjado:?} não pode ampliar o escopo além da sessão"
            );
        }
    }

    // A allowlist é fronteira de segurança: TRAVA o conjunto por afirmação positiva, não só
    // o mecanismo. Acrescentar/remover chave em CHAVES_WEB QUEBRA aqui de propósito — uma pref
    // de segurança entrando por engano falha, não passa em silêncio (achado da Lúmen no #1471;
    // o `for k in CHAVES_WEB` anterior era tautológico: `chave_configuravel(k)` É
    // `CHAVES_WEB.contains(k)` e `k` vinha da própria lista).
    #[test]
    fn allowlist_trava_o_conjunto_nao_so_o_mecanismo() {
        assert_eq!(
            CHAVES_WEB,
            &["app.tema", "app.idioma", "app.densidade", "app.notificacoes", "app.tela_inicial"],
            "mudou a allowlist da web: isto é fronteira de segurança — atualize aqui de propósito"
        );
    }

    #[test]
    fn chave_configuravel_rejeita_prefixo_e_vazio() {
        assert!(!chave_configuravel("app.")); // prefixo não basta
        assert!(!chave_configuravel("")); // vazio nunca
    }
}
