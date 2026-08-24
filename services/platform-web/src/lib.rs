//! Borda web da plataforma — fatia 3 do #1469 (épico #1265).
//!
//! A fatia 1/2 (`platform-identity`) é domínio PURO e deixou duas coisas de fora, de
//! propósito, porque a fundação não deve escolher fonte de aleatoriedade nem falar HTTP:
//!   1. **Gerar o `SessaoId`** — precisa de um CSPRNG (aqui: `OsRng`, o padrão da casa).
//!   2. **Ler o cookie do request** — parse do header `Cookie`.
//!
//! Este crate provê essas duas peças + o helper de EMISSÃO (gera id → persiste → cookie).
//! O `Router` axum e as rotas `login`/`logout` montam EM CIMA disto — ver nota de escopo
//! no fim: a resolução do principal via M365-web é UPSTREAM e hoje não tem card.
//!
//! Segurança: o `SessaoId` é segredo (quem o tem é a sessão), então é gerado com o CSPRNG
//! do SO e tem 256 bits de entropia — inadivinhável. Nunca logar o valor.

#![forbid(unsafe_code)]

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use rand::rngs::OsRng;
use rand::RngCore;

use galaxie_platform_identity::sessao::{
    montar_cookie_expurgo, montar_cookie_sessao, ArmazemSessao, SessaoId, NOME_COOKIE_SESSAO,
};
use galaxie_platform_identity::Sessao;

/// Bytes de entropia do id de sessão. 32 = 256 bits: inadivinhável por força bruta.
const BYTES_ID_SESSAO: usize = 32;

/// Gera um `SessaoId` novo com o CSPRNG do sistema (`OsRng`), URL-safe. É a fonte de
/// aleatoriedade que a fundação (pura) não tem — mora aqui, na borda.
pub fn gerar_sessao_id() -> SessaoId {
    let mut bytes = [0u8; BYTES_ID_SESSAO];
    OsRng.fill_bytes(&mut bytes);
    SessaoId(URL_SAFE_NO_PAD.encode(bytes))
}

/// Emite uma sessão no login: gera um id FRESCO (rotação — nunca reaproveita um id que o
/// cliente poderia ter plantado), persiste a sessão sob ele e devolve o `Set-Cookie`.
/// O `principal` e o `escopo` de `sessao` já vêm resolvidos PELO SERVIDOR (fatia 1/2).
/// Devolve `(id, Set-Cookie)` — a borda põe o header na resposta.
pub fn emitir_sessao<A: ArmazemSessao>(armazem: &mut A, sessao: Sessao) -> (SessaoId, String) {
    let id = gerar_sessao_id();
    armazem.estabelecer(id.clone(), sessao);
    let cookie = montar_cookie_sessao(&id);
    (id, cookie)
}

/// Encerra a sessão no logout: invalida no SERVIDOR (fato) e devolve o `Set-Cookie` de
/// expurgo (apaga no cliente). Os dois juntos — invalidar sem expurgar deixa lixo no
/// browser; expurgar sem invalidar deixa a sessão viva pra quem copiou o valor.
pub fn encerrar_sessao<A: ArmazemSessao>(armazem: &mut A, id: &SessaoId) -> String {
    armazem.invalidar(id);
    montar_cookie_expurgo()
}

/// Extrai o `SessaoId` do header `Cookie` do request (ex.: `gx_sess=abc; outro=1`).
/// Devolve `None` se o cookie de sessão não está presente — e aí a borda trata como
/// não-autenticado (default-deny; nunca "sessão vazia = todos").
pub fn sessao_id_do_cookie(header_cookie: &str) -> Option<SessaoId> {
    header_cookie
        .split(';')
        .filter_map(|par| {
            let par = par.trim();
            let (nome, valor) = par.split_once('=')?;
            if nome.trim() == NOME_COOKIE_SESSAO {
                let v = valor.trim();
                if v.is_empty() {
                    None
                } else {
                    Some(SessaoId(v.to_string()))
                }
            } else {
                None
            }
        })
        .next()
}

/// Resolve a sessão viva a partir do header `Cookie`: parse do id + `validar` no armazém.
/// É o ponto onde a borda transforma "um cookie" em "um principal" — e só a sessão viva
/// no servidor conta (um id revogado devolve `None`, mesmo com cookie presente).
pub fn sessao_do_cookie<'a, A: ArmazemSessao>(
    armazem: &'a A,
    header_cookie: &str,
) -> Option<&'a Sessao> {
    let id = sessao_id_do_cookie(header_cookie)?;
    armazem.validar(&id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use galaxie_platform_identity::sessao::ArmazemMemoria;
    use galaxie_platform_identity::{Escopo, OrgId, Principal, UserId};

    fn sessao_admin(user: &str, org: &str) -> Sessao {
        Sessao::estabelecer(
            Principal::AdminOrg {
                usuario: UserId(user.into()),
                org: OrgId(org.into()),
            },
            Escopo::de_orgs([OrgId(org.into())]),
        )
    }

    // O id tem entropia real e não repete: dois sorteios seguidos diferem, e o valor é
    // URL-safe (sem '=', '+', '/'). 256 bits ⇒ colisão é improvável por construção.
    #[test]
    fn gerar_id_e_unico_e_url_safe() {
        let a = gerar_sessao_id();
        let b = gerar_sessao_id();
        assert_ne!(a, b, "dois ids sorteados não podem colidir");
        for c in a.0.chars() {
            assert!(
                c.is_ascii_alphanumeric() || c == '-' || c == '_',
                "id deve ser URL-safe, achei {c:?}"
            );
        }
        assert!(a.0.len() >= 40, "256 bits em base64 dão ~43 chars");
    }

    // Emitir no login: a sessão passa a valer sob o id novo, e o cookie carrega esse id
    // com a política de segurança (HttpOnly etc., herdada da fatia 2).
    #[test]
    fn emitir_persiste_e_devolve_cookie() {
        let mut a = ArmazemMemoria::novo();
        let (id, cookie) = emitir_sessao(&mut a, sessao_admin("u1", "orgA"));
        assert!(a.validar(&id).is_some(), "sessão vive sob o id emitido");
        assert!(cookie.contains(&format!("{NOME_COOKIE_SESSAO}={}", id.0)));
        assert!(cookie.contains("HttpOnly") && cookie.contains("Secure"));
    }

    // Logout: invalida no servidor E devolve o expurgo. Depois, o mesmo cookie não resolve.
    #[test]
    fn encerrar_invalida_e_expurga() {
        let mut a = ArmazemMemoria::novo();
        let (id, _) = emitir_sessao(&mut a, sessao_admin("u1", "orgA"));
        let cookie_req = format!("{NOME_COOKIE_SESSAO}={}", id.0);
        assert!(sessao_do_cookie(&a, &cookie_req).is_some());
        let expurgo = encerrar_sessao(&mut a, &id);
        assert!(expurgo.contains("Max-Age=0"));
        assert!(
            sessao_do_cookie(&a, &cookie_req).is_none(),
            "sessão morta não resolve mais, mesmo com o cookie"
        );
    }

    // Parse do cookie: acha o gx_sess entre outros, ignora ausência/vazio.
    #[test]
    fn parse_do_cookie() {
        assert_eq!(
            sessao_id_do_cookie(&format!("outro=1; {NOME_COOKIE_SESSAO}=abc123; z=2")),
            Some(SessaoId("abc123".into()))
        );
        assert_eq!(sessao_id_do_cookie("outro=1; z=2"), None, "sem gx_sess = None");
        assert_eq!(
            sessao_id_do_cookie(&format!("{NOME_COOKIE_SESSAO}=")),
            None,
            "cookie vazio = None (não-autenticado, nunca 'todos')"
        );
    }

    // O escopo vem da sessão emitida, não do cookie: o cookie só carrega o id opaco.
    #[test]
    fn cookie_carrega_so_o_id_nao_o_escopo() {
        let mut a = ArmazemMemoria::novo();
        let (id, cookie) = emitir_sessao(&mut a, sessao_admin("u1", "orgA"));
        assert!(!cookie.contains("orgA"), "o cookie não vaza escopo/org, só o id");
        assert!(cookie.contains(&id.0));
    }
}
