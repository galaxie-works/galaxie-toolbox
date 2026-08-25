//! O `Router` da borda — onde as condições do @Altair viram runtime sobre o contrato (#1503).
//!
//! Esta fatia (2/N) entrega o ESQUELETO seguro:
//!  - o **fallback anti-oráculo** (condição 1 ponta a ponta: rota inexistente devolve o MESMO 404
//!    que um recurso-alheio — o único jeito de o invariante 1 valer no fio, não só na tabela);
//!  - a primeira rota autenticada (`GET /admin/orgs`), que prova o extractor de sessão (condição 6)
//!    e o 404 do back-office (não-staff não descobre que ele existe).
//!
//! Fatias seguintes: handlers de dados (conta/org/config), sink de auditoria de staff (condição 4),
//! rotas OAuth. O corpo de sucesso do back-office é `[]` até a fatia de persistência (ver o handler).

use axum::body::Body;
use axum::http::{header, StatusCode};
use axum::response::Response;
use axum::routing::get;
use axum::Router;

use galaxie_platform_back_office::{autorizar_back_office, AcaoBackOffice};
use galaxie_platform_web::contrato::CodigoErro;

use crate::erro::resposta_de_erro;
use crate::sessao::{EstadoBorda, SessaoAtual};

/// Fallback do `Router` — a peça que o @Altair **travou** para a fatia 2. Sem ele, uma rota
/// inexistente cai no fallback PADRÃO do axum (corpo vazio, sem content-type) ≠ o meu 404 de
/// recurso-alheio: a diferença de corpo vira um oráculo de LOCALIZAÇÃO ("aqui não há rota" vs
/// "aqui há, mas não é sua"). Roteando o fallback por `resposta_de_erro`, os dois 404 são a MESMA
/// resposta byte-a-byte — o invariante 1 vale no fio, não só na tabela `contrato.rs`.
async fn fallback_nao_encontrado() -> Response {
    resposta_de_erro(CodigoErro::NaoEncontrado)
}

/// `GET /api/v1/admin/orgs` — lista as orgs (staff-only, contrato §4.5).
///
/// Não-staff recebe **404** (o back-office não se anuncia): `autorizar_back_office` devolve
/// `Negado`, que o mapa erro→HTTP (fatia 1) colapsa no MESMO 404 de uma rota inexistente. É o
/// "recurso-alheio 404" do teste do anti-oráculo.
///
/// O corpo de sucesso é `[]` **por ora**: carregar as orgs exige a camada de persistência (fatia
/// própria) e HOJE não há store de org — então zero orgs é a resposta correta, não um stub que
/// mente. Quando o repositório existir, o `Ok` troca `[]` pela lista `[{org,dominios,estado}]`
/// (contrato v1.3), e a autorização/rota já estarão provadas aqui.
async fn listar_orgs(SessaoAtual(sessao): SessaoAtual) -> Response {
    match autorizar_back_office(&sessao, &AcaoBackOffice::ListarOrgs) {
        Ok(()) => Response::builder()
            .status(StatusCode::OK)
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from("[]"))
            .expect("resposta 200 é sempre construível"),
        // `Negado` → 404 (não 403): quem não é staff não fica sabendo que o back-office existe.
        Err(_) => resposta_de_erro(CodigoErro::NaoEncontrado),
    }
}

/// Monta o `Router` da borda com o estado (armazém de sessão + relógio) já resolvido.
pub fn rotas(estado: EstadoBorda) -> Router {
    Router::new()
        .route("/api/v1/admin/orgs", get(listar_orgs))
        .fallback(fallback_nao_encontrado)
        .with_state(estado)
}

#[cfg(test)]
mod tests {
    use super::*;
    use http_body_util::BodyExt;
    use tower::ServiceExt; // oneshot

    use axum::http::Request;
    use galaxie_platform_identity::sessao::{ArmazemMemoria, NOME_COOKIE_SESSAO};
    use galaxie_platform_identity::{Escopo, OrgId, Principal, UserId};
    use galaxie_platform_web::emitir_sessao;

    use crate::sessao::Borda;

    const AGORA: u64 = 1_000_000;

    fn relogio_fixo() -> u64 {
        AGORA
    }

    /// Uma sessão VIVA de um principal-cliente (admin de org) — o mais elevado que NÃO é staff.
    /// Prova que "autenticado" não é "autorizado no back-office": a sessão vale, mas não é staff.
    fn borda_com_sessao_admin() -> (EstadoBorda, String) {
        let mut armazem = ArmazemMemoria::novo();
        let sessao = galaxie_platform_identity::Sessao::estabelecer(
            Principal::AdminOrg {
                usuario: UserId("u1".into()),
                org: OrgId("orgA".into()),
            },
            Escopo::de_orgs([OrgId("orgA".into())]),
        );
        let (id, _set_cookie) = emitir_sessao(&mut armazem, sessao, AGORA);
        let cookie_req = format!("{NOME_COOKIE_SESSAO}={}", id.0);
        (Borda::nova(armazem, relogio_fixo), cookie_req)
    }

    async fn resposta_crua(estado: EstadoBorda, cookie: &str, caminho: &str) -> (StatusCode, Vec<(String, String)>, Vec<u8>) {
        let req = Request::builder()
            .uri(caminho)
            .header(header::COOKIE, cookie)
            .body(Body::empty())
            .unwrap();
        let resp = rotas(estado).oneshot(req).await.unwrap();
        let status = resp.status();
        let mut headers: Vec<(String, String)> = resp
            .headers()
            .iter()
            .map(|(n, v)| (n.to_string(), v.to_str().unwrap_or("").to_string()))
            .collect();
        headers.sort();
        let corpo = resp.into_body().collect().await.unwrap().to_bytes().to_vec();
        (status, headers, corpo)
    }

    /// **O teste travado pelo @Altair (AC do #1505):** a resposta INTEIRA — status + headers + CORPO
    /// — de uma ROTA INEXISTENTE tem de ser IDÊNTICA à de um RECURSO-ALHEIO (404 do back-office pra
    /// não-staff). É o único que prova o invariante 1 ponta a ponta: só assim "não existe" e "existe
    /// mas não é seu" são indistinguíveis no fio. Se alguém trocar o fallback pelo padrão do axum
    /// (corpo vazio) ou mapear o back-office pra 403, este teste morre.
    #[tokio::test]
    async fn rota_inexistente_e_recurso_alheio_sao_a_mesma_resposta() {
        let (estado, cookie) = borda_com_sessao_admin();

        // recurso-alheio: o back-office existe, mas o admin-de-org não é staff ⇒ 404.
        let alheio = resposta_crua(estado.clone(), &cookie, "/api/v1/admin/orgs").await;
        // rota que não existe ⇒ fallback ⇒ 404.
        let inexistente = resposta_crua(estado, &cookie, "/api/v1/isto/nao/existe").await;

        assert_eq!(alheio.0, StatusCode::NOT_FOUND, "back-office pra não-staff é 404");
        assert_eq!(inexistente.0, StatusCode::NOT_FOUND, "rota inexistente é 404");
        assert_eq!(
            alheio, inexistente,
            "resposta INTEIRA (status+headers+corpo) tem de ser idêntica — senão é oráculo de localização"
        );
    }

    /// Condição 6: sem cookie de sessão, a rota autenticada rejeita com **401** (não 404 — aqui o
    /// que falta é autenticar; a rota `/admin/orgs` existe pra quem tem sessão). O extractor barra
    /// ANTES do handler: nenhum principal ⇒ nenhuma autorização a fazer.
    #[tokio::test]
    async fn sem_sessao_a_rota_autenticada_da_401() {
        let (estado, _cookie) = borda_com_sessao_admin();
        let sem = resposta_crua(estado, "", "/api/v1/admin/orgs").await;
        assert_eq!(sem.0, StatusCode::UNAUTHORIZED);
    }

    /// Staff passa: a MESMA rota que dá 404 pro admin-de-org devolve 200 `[]` pra staff — provando
    /// que o 404 é autorização, não ausência de rota (o oráculo seria os dois lados verem a mesma
    /// coisa OU o não-staff ver o 200).
    #[tokio::test]
    async fn staff_ve_200_lista_vazia() {
        let mut armazem = ArmazemMemoria::novo();
        let sessao = galaxie_platform_identity::Sessao::estabelecer(
            Principal::Staff { usuario: UserId("s1".into()) },
            Escopo::vazio(),
        );
        let (id, _c) = emitir_sessao(&mut armazem, sessao, AGORA);
        let cookie = format!("{NOME_COOKIE_SESSAO}={}", id.0);
        let estado = Borda::nova(armazem, relogio_fixo);

        let (status, _h, corpo) = resposta_crua(estado, &cookie, "/api/v1/admin/orgs").await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(&corpo, b"[]", "sem store de org ainda, a lista é vazia (correto, não stub)");
    }
}
