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
use axum::extract::State;
use axum::http::{header, HeaderMap, StatusCode};
use axum::response::Response;
use axum::routing::{delete, get};
use axum::Router;

use galaxie_platform_back_office::{autorizar_back_office, AcaoBackOffice};
use galaxie_platform_web::contrato::CodigoErro;
use galaxie_platform_web::encerrar_sessoes_do_cookie;

use crate::erro::resposta_de_erro;
use crate::sessao::{EstadoBorda, SessaoOculta};

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
async fn listar_orgs(SessaoOculta(sessao): SessaoOculta) -> Response {
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

/// `DELETE /api/v1/session` — logout. **Não-autenticada e IDEMPOTENTE** (contrato §4.1): NÃO usa o
/// extractor de sessão (que exigiria uma sessão viva e daria 401), porque deslogar de uma sessão
/// já morta/ausente tem de dar o MESMO 204 — o estado desejado (nenhuma sessão viva no cliente) já
/// vale, e um 401 aqui só vazaria se o cookie era válido.
///
/// Invalida no SERVIDOR o que houver (fato) **E** devolve o cookie de expurgo (apaga no cliente).
/// Os dois juntos, sempre: invalidar sem expurgar deixa lixo no browser; expurgar sem invalidar
/// deixa a sessão viva pra quem copiou o valor do cookie (o servidor é a fonte da verdade).
///
/// **#1526 (fix @Altair): cookie DUPLICADO ⇒ invalida TODOS os candidatos**, não nenhum. A leitura
/// recusa a ambiguidade (fail-closed); a revogação a resolve agindo, senão o logout seria fail-open
/// (usuário "sai", sessão vive). Por isso usa `encerrar_sessoes_do_cookie`, não `sessao_id_do_cookie`.
async fn encerrar(State(estado): State<EstadoBorda>, headers: HeaderMap) -> Response {
    let header_cookie = headers
        .get(header::COOKIE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    let expurgo = {
        let mut armazem = estado
            .armazem
            .lock()
            .expect("armazém de sessão não deve estar envenenado");
        encerrar_sessoes_do_cookie(&mut *armazem, header_cookie)
    };
    Response::builder()
        .status(StatusCode::NO_CONTENT)
        .header(header::SET_COOKIE, expurgo)
        .body(Body::empty())
        .expect("resposta 204 é sempre construível")
}

/// Monta o `Router` da borda com o estado (armazém de sessão + relógio) já resolvido.
pub fn rotas(estado: EstadoBorda) -> Router {
    Router::new()
        .route("/api/v1/admin/orgs", get(listar_orgs))
        .route("/api/v1/session", delete(encerrar))
        .fallback(fallback_nao_encontrado)
        .with_state(estado)
}

#[cfg(test)]
mod tests {
    use super::*;
    use http_body_util::BodyExt;
    use tower::ServiceExt; // oneshot

    use axum::http::Request;
    use galaxie_platform_identity::sessao::{ArmazemMemoria, ArmazemSessao, SessaoId, NOME_COOKIE_SESSAO};
    use galaxie_platform_identity::{Escopo, OrgId, Principal, UserId};
    use galaxie_platform_web::emitir_sessao;

    use crate::sessao::{Borda, SessaoAtual};

    /// Extrai o `SessaoId` de um cookie de request `__Host-gx_sess=<id>` (só nos testes).
    fn id_do_cookie(cookie: &str) -> SessaoId {
        let valor = cookie
            .strip_prefix(&format!("{NOME_COOKIE_SESSAO}="))
            .expect("cookie de teste começa com o nome da sessão");
        SessaoId(valor.to_owned())
    }

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

    /// Superfície VISÍVEL (`SessaoAtual`): sem cookie de sessão rejeita com **401** — aqui o que
    /// falta é autenticar, e dizer "autentique-se" não revela nada (a rota `/me` e afins não são
    /// segredo). Rota de teste (o `/me` real é fatia 3) só pra exercitar o extractor visível.
    #[tokio::test]
    async fn sem_sessao_em_rota_visivel_da_401() {
        async fn visivel(SessaoAtual(_): SessaoAtual) -> Response {
            Response::builder()
                .status(StatusCode::OK)
                .body(Body::from("ok"))
                .unwrap()
        }
        let (estado, _cookie) = borda_com_sessao_admin();
        let router = Router::new()
            .route("/api/v1/visivel", get(visivel))
            .fallback(fallback_nao_encontrado)
            .with_state(estado);
        let req = Request::builder()
            .uri("/api/v1/visivel")
            .body(Body::empty())
            .unwrap();
        let resp = router.oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
    }

    /// **Achado do @Altair na fatia 2 — o oráculo no nível NÃO-AUTENTICADO:** superfície OCULTA
    /// (`/admin/*`, `SessaoOculta`) sem sessão devolve **404 IDÊNTICO** ao de uma rota inexistente —
    /// não 401. Um 401 aqui revelaria a existência do back-office pra um atacante sem sessão ("fechar
    /// a porta e deixar a janela"). Prova comparando a resposta INTEIRA, igual ao caso autenticado.
    #[tokio::test]
    async fn sem_sessao_no_back_office_e_404_identico_a_rota_inexistente() {
        let (estado, _cookie) = borda_com_sessao_admin();
        // SEM cookie nos dois: back-office oculto vs rota que não existe.
        let oculto = resposta_crua(estado.clone(), "", "/api/v1/admin/orgs").await;
        let inexistente = resposta_crua(estado, "", "/api/v1/isto/nao/existe").await;
        assert_eq!(oculto.0, StatusCode::NOT_FOUND, "back-office sem sessão é 404, não 401");
        assert_eq!(
            oculto, inexistente,
            "não-autenticado no back-office tem de ser indistinguível de rota inexistente"
        );
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

    use std::sync::atomic::{AtomicU64, Ordering};
    // Relógio VARIÁVEL só deste teste (single-consumer; os demais usam `relogio_fixo`). Um `fn`
    // ponteiro não captura estado, então o tempo mora num `static` que o teste avança entre requests.
    static RELOGIO_DESLIZA: AtomicU64 = AtomicU64::new(AGORA);
    fn relogio_desliza() -> u64 {
        RELOGIO_DESLIZA.load(Ordering::SeqCst)
    }

    /// **#1512 — o defeito do @Altair, provado pelo CONSUMIDOR (não pela função):** a atividade
    /// DESLIZA a janela de ociosidade, testado ATRAVÉS da borda (requests de verdade). Uma sessão
    /// emitida em `AGORA` venceria de ociosidade em `AGORA + IDLE_TTL_SEG`. Um request no meio dá
    /// vida nova (desliza o ocioso), e um 2º request DEPOIS do prazo ORIGINAL ainda passa. Com a
    /// fiação antiga (read-only `validar`), o 2º request seria **401** — é o mutante que este teste
    /// mata. "Teste não é consumidor": aqui o consumidor é o extractor, exercido pelo Router.
    #[tokio::test]
    async fn atividade_desliza_o_ocioso_pela_borda() {
        use galaxie_platform_identity::sessao::IDLE_TTL_SEG;

        let mut armazem = ArmazemMemoria::novo();
        let sessao = galaxie_platform_identity::Sessao::estabelecer(
            Principal::AdminOrg { usuario: UserId("u1".into()), org: OrgId("orgA".into()) },
            Escopo::de_orgs([OrgId("orgA".into())]),
        );
        RELOGIO_DESLIZA.store(AGORA, Ordering::SeqCst);
        let (id, _c) = emitir_sessao(&mut armazem, sessao, AGORA);
        let cookie = format!("{NOME_COOKIE_SESSAO}={}", id.0);
        let estado = Borda::nova(armazem, relogio_desliza);

        async fn bater(estado: EstadoBorda, cookie: &str) -> StatusCode {
            async fn visivel(SessaoAtual(_): SessaoAtual) -> Response {
                Response::builder().status(StatusCode::OK).body(Body::from("ok")).unwrap()
            }
            let router = Router::new()
                .route("/api/v1/visivel", get(visivel))
                .fallback(fallback_nao_encontrado)
                .with_state(estado);
            let req = Request::builder()
                .uri("/api/v1/visivel")
                .header(header::COOKIE, cookie)
                .body(Body::empty())
                .unwrap();
            router.oneshot(req).await.unwrap().status()
        }

        // Request 1 ANTES do prazo original: vivo, E desliza o ocioso pra t1 + IDLE_TTL_SEG.
        let t1 = AGORA + IDLE_TTL_SEG - 100;
        RELOGIO_DESLIZA.store(t1, Ordering::SeqCst);
        assert_eq!(bater(estado.clone(), &cookie).await, StatusCode::OK, "vivo antes do prazo ocioso");

        // Request 2 DEPOIS do prazo ORIGINAL (AGORA+IDLE_TTL_SEG), antes do NOVO (t1+IDLE_TTL_SEG):
        // só passa porque o request 1 deslizou. Sem a fiação (#1512), aqui seria 401.
        let t2 = AGORA + IDLE_TTL_SEG + 100;
        RELOGIO_DESLIZA.store(t2, Ordering::SeqCst);
        assert_eq!(
            bater(estado, &cookie).await,
            StatusCode::OK,
            "a atividade do request 1 deslizou o ocioso além do prazo original"
        );
    }

    /// Controle do #1512: SEM atividade no meio, a sessão morre de ociosidade no prazo — o deslize
    /// não vira "sessão imortal". Emite em AGORA e só bate DEPOIS de `AGORA + IDLE_TTL_SEG` ⇒ 401.
    #[tokio::test]
    async fn sem_atividade_a_sessao_morre_no_prazo_ocioso() {
        use galaxie_platform_identity::sessao::IDLE_TTL_SEG;

        async fn visivel(SessaoAtual(_): SessaoAtual) -> Response {
            Response::builder().status(StatusCode::OK).body(Body::from("ok")).unwrap()
        }
        let mut armazem = ArmazemMemoria::novo();
        let sessao = galaxie_platform_identity::Sessao::estabelecer(
            Principal::AdminOrg { usuario: UserId("u2".into()), org: OrgId("orgB".into()) },
            Escopo::de_orgs([OrgId("orgB".into())]),
        );
        // relógio fixo bem depois do prazo ocioso — nenhuma atividade prévia deslizou nada.
        const DEPOIS: u64 = AGORA + IDLE_TTL_SEG + 1;
        fn relogio_depois() -> u64 {
            DEPOIS
        }
        let (id, _c) = emitir_sessao(&mut armazem, sessao, AGORA);
        let cookie = format!("{NOME_COOKIE_SESSAO}={}", id.0);
        let estado = Borda::nova(armazem, relogio_depois);

        let router = Router::new()
            .route("/api/v1/visivel", get(visivel))
            .fallback(fallback_nao_encontrado)
            .with_state(estado);
        let req = Request::builder()
            .uri("/api/v1/visivel")
            .header(header::COOKIE, &cookie)
            .body(Body::empty())
            .unwrap();
        assert_eq!(
            router.oneshot(req).await.unwrap().status(),
            StatusCode::UNAUTHORIZED,
            "sem atividade, o ocioso mata a sessão no prazo (o deslize não a torna imortal)"
        );
    }

    async fn deletar(estado: EstadoBorda, cookie: Option<&str>) -> Response {
        let mut req = Request::builder().method("DELETE").uri("/api/v1/session");
        if let Some(c) = cookie {
            req = req.header(header::COOKIE, c);
        }
        rotas(estado)
            .oneshot(req.body(Body::empty()).unwrap())
            .await
            .unwrap()
    }

    /// `DELETE /session` (logout): invalida no SERVIDOR **e** expurga o cookie no cliente. O ponto
    /// de segurança é a invalidação no servidor — checo que, após o logout, a MESMA `SessaoId` não
    /// revalida (uma cópia do cookie não ressuscita a sessão). Se o handler só expurgasse (sem
    /// `invalidar`), este assert do `validar` pós-logout falharia.
    #[tokio::test]
    async fn logout_invalida_no_servidor_e_expurga_o_cookie() {
        let (estado, cookie) = borda_com_sessao_admin();
        let id = id_do_cookie(&cookie);
        assert!(
            estado.armazem.lock().unwrap().validar(&id, AGORA).is_some(),
            "pré-condição: a sessão vale antes do logout"
        );

        let resp = deletar(estado.clone(), Some(&cookie)).await;
        assert_eq!(resp.status(), StatusCode::NO_CONTENT);
        let set = resp
            .headers()
            .get(header::SET_COOKIE)
            .expect("logout devolve Set-Cookie de expurgo")
            .to_str()
            .unwrap();
        assert!(set.starts_with(NOME_COOKIE_SESSAO));
        assert!(set.contains("Max-Age=0"), "expurga o cookie no cliente");

        assert!(
            estado.armazem.lock().unwrap().validar(&id, AGORA).is_none(),
            "logout invalida no servidor — cópia do cookie não revalida"
        );
    }

    /// Idempotente e sem-auth (contrato §4.1): deslogar SEM cookie de sessão é o MESMO 204 com
    /// expurgo — o resultado desejado (nenhuma sessão viva no cliente) já vale, e um 401 aqui só
    /// existiria se a rota exigisse sessão, o que ela não faz.
    #[tokio::test]
    async fn logout_sem_cookie_e_204_com_expurgo() {
        let (estado, _cookie) = borda_com_sessao_admin();
        let resp = deletar(estado, None).await;
        assert_eq!(resp.status(), StatusCode::NO_CONTENT, "deslogar sem sessão é 204 igual");
        let set = resp.headers().get(header::SET_COOKIE).unwrap().to_str().unwrap();
        assert!(set.contains("Max-Age=0"), "expurga mesmo sem sessão a invalidar");
    }

    /// **#1526 (fix @Altair — o fail-open que ele pegou):** logout com cookie DUPLICADO invalida
    /// TODOS os candidatos, não nenhum. Antes, `sessao_id_do_cookie` devolvia `None` na ambiguidade
    /// e o `encerrar` só expurgava: 204 com as DUAS sessões VIVAS no servidor (o usuário "sai" e não
    /// sai — falha silenciosa). Prova pelo consumidor: bate no handler com dois `__Host-gx_sess` e
    /// exige que as duas morram. Mutante (voltar pra `sessao_id_do_cookie`/exatamente-um) MATA isto.
    #[tokio::test]
    async fn logout_com_cookie_duplicado_invalida_todos() {
        let mut armazem = ArmazemMemoria::novo();
        let nova = || {
            galaxie_platform_identity::Sessao::estabelecer(
                Principal::AdminOrg { usuario: UserId("u".into()), org: OrgId("o".into()) },
                Escopo::de_orgs([OrgId("o".into())]),
            )
        };
        let (id1, _) = emitir_sessao(&mut armazem, nova(), AGORA);
        let (id2, _) = emitir_sessao(&mut armazem, nova(), AGORA);
        // header com DOIS cookies de sessão (shadowing/injeção na própria origem).
        let cookie = format!("{NOME_COOKIE_SESSAO}={}; {NOME_COOKIE_SESSAO}={}", id1.0, id2.0);
        let estado = Borda::nova(armazem, relogio_fixo);

        assert!(estado.armazem.lock().unwrap().validar(&id1, AGORA).is_some());
        assert!(estado.armazem.lock().unwrap().validar(&id2, AGORA).is_some());

        let resp = deletar(estado.clone(), Some(&cookie)).await;
        assert_eq!(resp.status(), StatusCode::NO_CONTENT);

        assert!(
            estado.armazem.lock().unwrap().validar(&id1, AGORA).is_none(),
            "1º candidato invalidado no logout"
        );
        assert!(
            estado.armazem.lock().unwrap().validar(&id2, AGORA).is_none(),
            "2º candidato invalidado — logout duplicado não deixa sessão viva (não é fail-open)"
        );
    }
}
