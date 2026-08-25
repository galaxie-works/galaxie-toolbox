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
use axum::extract::{Path, State};
use axum::http::{header, HeaderMap, StatusCode};
use axum::response::Response;
use axum::routing::{delete, get};
use axum::Router;

use galaxie_platform_back_office::{autorizar_back_office, AcaoBackOffice};
use galaxie_platform_identity::armazem::{ErroArmazem, Membro};
use galaxie_platform_identity::{OrgId, Papel};
use galaxie_platform_org_admin::{autorizar_acao_admin, AcaoAdminOrg, AdminErro};
use galaxie_platform_web::contrato::CodigoErro;
use galaxie_platform_web::encerrar_sessoes_do_cookie;

use crate::erro::{resposta_de_erro, resposta_de_falha, Visibilidade};
use crate::sessao::{EstadoBorda, SessaoAtual, SessaoOculta};

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
async fn listar_orgs(
    State(estado): State<EstadoBorda>,
    SessaoOculta(sessao): SessaoOculta,
) -> Response {
    // Autz + AUDITORIA num passo (cond. 4): `autorizar_back_office` emite o evento (permitido E
    // negado) pelo auditor da borda — o handler não decide auditar, só passa o sink.
    match autorizar_back_office(&sessao, &AcaoBackOffice::ListarOrgs, &*estado.auditor) {
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

/// O `papel` como o contrato §4.3 o projeta no fio. Explícito (não `Debug`/derive): o valor de
/// contrato não pode mudar sozinho se alguém renomear a variante Rust.
fn papel_str(papel: &Papel) -> &'static str {
    match papel {
        Papel::Member => "member",
        Papel::OrgAdmin => "org_admin",
    }
}

/// O membro como sai no fio (contrato §4.3: `{ uid, nome, email, papel }`). DTO na borda (com
/// `serde`) — o tipo de domínio [`Membro`] fica serde-free. `serde_json` cuida do escaping de
/// `nome`/`email` (dado de usuário) — por isso não é hand-roll como o corpo de erro.
#[derive(serde::Serialize)]
struct MembroDto<'a> {
    uid: &'a str,
    nome: &'a str,
    email: &'a str,
    papel: &'a str,
}

impl<'a> From<&'a Membro> for MembroDto<'a> {
    fn from(m: &'a Membro) -> Self {
        MembroDto { uid: &m.uid.0, nome: &m.nome, email: &m.email, papel: papel_str(&m.papel) }
    }
}

/// `GET /api/v1/orgs/{org}/membros` (contrato §4.3) — lista os membros da org.
///
/// Ordem que É a segurança (fundação #1469): **404 antes de 403**. Carrega o `Org` (o
/// `autorizar_acao_admin` precisa dele pra resolver visibilidade); se o store não vê a org
/// (`Ok(None)`) ⇒ **404** (não existe / é alheia — invariante 1). Se vê, a autz decide: org alheia
/// ⇒ **404** (`NaoEncontrada`), própria org sem papel `org_admin` ⇒ **403** (`Negado`). Só então os
/// dados. O `papel` que volta decide o que a UI MOSTRA, jamais o que o servidor permite.
async fn listar_membros(
    State(estado): State<EstadoBorda>,
    SessaoAtual(sessao): SessaoAtual,
    Path(org): Path<String>,
) -> Response {
    let org_id = OrgId(org);

    // (1) Carrega o Org pra autz. Infra caiu ⇒ 500 (superfície visível). NÃO existe ⇒ 404.
    let org = match estado.orgs.buscar(&org_id) {
        Err(ErroArmazem::Indisponivel) => return resposta_de_falha(Visibilidade::Visivel),
        Ok(None) => return resposta_de_erro(CodigoErro::NaoEncontrado),
        Ok(Some(o)) => o,
    };

    // (2) Autz: 404 (alheia) antes de 403 (própria sem papel) — o `autorizar_acao_admin` faz a ordem.
    match autorizar_acao_admin(&sessao, &AcaoAdminOrg::ListarMembros, &org) {
        Err(AdminErro::NaoEncontrada) => return resposta_de_erro(CodigoErro::NaoEncontrado),
        Err(AdminErro::Negado) => return resposta_de_erro(CodigoErro::Negado),
        Ok(()) => {}
    }

    // (3) Dados. Infra caiu ⇒ 500; senão 200 com a projeção do contrato.
    match estado.membros.listar(&org_id) {
        Err(ErroArmazem::Indisponivel) => resposta_de_falha(Visibilidade::Visivel),
        Ok(membros) => {
            let dto: Vec<MembroDto> = membros.iter().map(MembroDto::from).collect();
            let corpo = serde_json::to_string(&dto).expect("Vec<MembroDto> serializa sempre");
            Response::builder()
                .status(StatusCode::OK)
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(corpo))
                .expect("resposta 200 é sempre construível")
        }
    }
}

/// Monta o `Router` da borda com o estado (armazéns + relógio + auditor) já resolvido.
pub fn rotas(estado: EstadoBorda) -> Router {
    Router::new()
        .route("/api/v1/admin/orgs", get(listar_orgs))
        .route("/api/v1/orgs/{org}/membros", get(listar_membros))
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
    use galaxie_platform_identity::{Escopo, Org, OrgId, Principal, UserId};
    use galaxie_platform_web::emitir_sessao;

    use crate::sessao::{Borda, SessaoAtual};
    use galaxie_platform_back_office::{Auditor, EventoAutz, ResultadoAutz};
    use galaxie_platform_identity::armazem::{
        ArmazemMembro, ArmazemMembroMemoria, ArmazemOrg, ArmazemOrgMemoria, ErroArmazem, Membro,
    };
    use galaxie_platform_identity::Papel;
    use std::sync::{Arc, Mutex as MutexStd};

    /// Armazéns de domínio VAZIOS pros testes que não exercem dados (a maioria).
    fn sem_orgs() -> Arc<dyn ArmazemOrg + Send + Sync> {
        Arc::new(ArmazemOrgMemoria::novo())
    }
    fn sem_membros() -> Arc<dyn ArmazemMembro + Send + Sync> {
        Arc::new(ArmazemMembroMemoria::novo())
    }

    /// Auditor no-op pros testes que não checam a emissão.
    struct AuditorNulo;
    impl Auditor for AuditorNulo {
        fn registrar(&self, _e: &EventoAutz) {}
    }
    fn nulo() -> Arc<dyn Auditor + Send + Sync> {
        Arc::new(AuditorNulo)
    }

    /// Auditor que CAPTURA (Mutex — é `Send + Sync` pro estado da borda) pros testes da cond. 4.
    #[derive(Default)]
    struct AuditorEspiao {
        eventos: MutexStd<Vec<(UserId, AcaoBackOffice, ResultadoAutz)>>,
    }
    impl Auditor for AuditorEspiao {
        fn registrar(&self, e: &EventoAutz) {
            self.eventos
                .lock()
                .unwrap()
                .push((e.ator.clone(), e.acao.clone(), e.resultado));
        }
    }

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
        (Borda::nova(armazem, relogio_fixo, nulo(), sem_orgs(), sem_membros()), cookie_req)
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
        let estado = Borda::nova(armazem, relogio_fixo, nulo(), sem_orgs(), sem_membros());

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
        let estado = Borda::nova(armazem, relogio_desliza, nulo(), sem_orgs(), sem_membros());

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
        let estado = Borda::nova(armazem, relogio_depois, nulo(), sem_orgs(), sem_membros());

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
        let estado = Borda::nova(armazem, relogio_fixo, nulo(), sem_orgs(), sem_membros());

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

    /// **Cond. 4 pelo CONSUMIDOR (a borda):** `GET /admin/orgs` faz `autorizar_back_office` EMITIR
    /// pelo auditor da borda — staff→permitido, não-staff→negado, os DOIS capturados. Prova que a
    /// borda passa o sink (a emissão em si é testada no back-office). Trocar o auditor por `nulo()`
    /// some com os eventos aqui; tirar o `State` do handler nem compila.
    #[tokio::test]
    async fn a_borda_audita_admin_orgs_permitido_e_negado() {
        let espiao = Arc::new(AuditorEspiao::default());
        let mut ar = ArmazemMemoria::novo();
        let (id_staff, _) = emitir_sessao(
            &mut ar,
            galaxie_platform_identity::Sessao::estabelecer(
                Principal::Staff { usuario: UserId("s1".into()) },
                Escopo::vazio(),
            ),
            AGORA,
        );
        let (id_admin, _) = emitir_sessao(
            &mut ar,
            galaxie_platform_identity::Sessao::estabelecer(
                Principal::AdminOrg { usuario: UserId("u1".into()), org: OrgId("o".into()) },
                Escopo::de_orgs([OrgId("o".into())]),
            ),
            AGORA,
        );
        let estado = Borda::nova(ar, relogio_fixo, espiao.clone(), sem_orgs(), sem_membros());
        let cookie_staff = format!("{NOME_COOKIE_SESSAO}={}", id_staff.0);
        let cookie_admin = format!("{NOME_COOKIE_SESSAO}={}", id_admin.0);

        assert_eq!(
            resposta_crua(estado.clone(), &cookie_staff, "/api/v1/admin/orgs").await.0,
            StatusCode::OK
        );
        assert_eq!(
            resposta_crua(estado.clone(), &cookie_admin, "/api/v1/admin/orgs").await.0,
            StatusCode::NOT_FOUND
        );

        let ev = espiao.eventos.lock().unwrap();
        assert_eq!(ev.len(), 2, "a borda audita as DUAS decisões — permitido e negado");
        assert_eq!(ev[0].2, ResultadoAutz::Permitido, "staff → permitido auditado");
        assert_eq!(
            ev[1],
            (UserId("u1".into()), AcaoBackOffice::ListarOrgs, ResultadoAutz::Negado),
            "não-staff → negado auditado, com o ator que tentou (não some)"
        );
    }

    // ---- GET /orgs/{org}/membros (1º handler de DADOS, contrato §4.3) ----

    fn org_teste(id: &str) -> Org {
        Org { id: OrgId(id.into()), dominios: Default::default(), tenant_m365: None }
    }
    fn membro_teste(uid: &str, papel: Papel) -> Membro {
        Membro {
            uid: UserId(uid.into()),
            nome: format!("Nome {uid}"),
            email: format!("{uid}@acme.com"),
            papel,
        }
    }
    fn admin_de(org: &str) -> galaxie_platform_identity::Sessao {
        galaxie_platform_identity::Sessao::estabelecer(
            Principal::AdminOrg { usuario: UserId("adm".into()), org: OrgId(org.into()) },
            Escopo::de_orgs([OrgId(org.into())]),
        )
    }
    fn membro_de(org: &str) -> galaxie_platform_identity::Sessao {
        galaxie_platform_identity::Sessao::estabelecer(
            Principal::UsuarioFinal { usuario: UserId("mem".into()), org: OrgId(org.into()) },
            Escopo::de_orgs([OrgId(org.into())]),
        )
    }

    /// Borda com sessão + stores semeados. `orgs`/`membros` já prontos pro handler consumir.
    fn borda_membros(
        sessao: galaxie_platform_identity::Sessao,
        orgs: Vec<Org>,
        membros: Vec<(OrgId, Membro)>,
    ) -> (EstadoBorda, String) {
        let mut armazem = ArmazemMemoria::novo();
        let (id, _) = emitir_sessao(&mut armazem, sessao, AGORA);
        let cookie = format!("{NOME_COOKIE_SESSAO}={}", id.0);
        let mut org_store = ArmazemOrgMemoria::novo();
        for o in orgs {
            org_store.inserir(o);
        }
        let mut membro_store = ArmazemMembroMemoria::novo();
        for (org, m) in membros {
            membro_store.inserir(org, m);
        }
        let estado = Borda::nova(
            armazem,
            relogio_fixo,
            nulo(),
            Arc::new(org_store),
            Arc::new(membro_store),
        );
        (estado, cookie)
    }

    /// Happy path: org_admin da própria org → 200 com a projeção §4.3 `[{uid,nome,email,papel}]`,
    /// papel serializado como o contrato (`org_admin`/`member`), escaping de dado de usuário via serde.
    #[tokio::test]
    async fn membros_200_com_a_projecao_do_contrato() {
        let (estado, cookie) = borda_membros(
            admin_de("acme"),
            vec![org_teste("acme")],
            vec![
                (OrgId("acme".into()), membro_teste("u1", Papel::OrgAdmin)),
                (OrgId("acme".into()), membro_teste("u2", Papel::Member)),
            ],
        );
        let (status, _h, corpo) = resposta_crua(estado, &cookie, "/api/v1/orgs/acme/membros").await;
        assert_eq!(status, StatusCode::OK);
        let json: serde_json::Value = serde_json::from_slice(&corpo).unwrap();
        let arr = json.as_array().unwrap();
        assert_eq!(arr.len(), 2);
        assert_eq!(arr[0]["uid"], "u1");
        assert_eq!(arr[0]["papel"], "org_admin", "papel projetado como o contrato");
        assert_eq!(arr[0]["email"], "u1@acme.com");
        assert_eq!(arr[1]["papel"], "member");
    }

    /// Org que NÃO existe no store ⇒ 404 (`Ok(None)`), antes de qualquer autz — indistinguível de
    /// org alheia (invariante 1).
    #[tokio::test]
    async fn membros_org_inexistente_e_404() {
        let (estado, cookie) = borda_membros(admin_de("acme"), vec![], vec![]);
        let (status, ..) = resposta_crua(estado, &cookie, "/api/v1/orgs/acme/membros").await;
        assert_eq!(status, StatusCode::NOT_FOUND);
    }

    /// Org ALHEIA (existe, mas não é a do solicitante) ⇒ **404**, não 403 — pedir org de outro não
    /// revela que ela existe (AC2 da fundação). É a ordem 404-antes-de-403.
    #[tokio::test]
    async fn membros_org_alheia_e_404_nao_403() {
        // admin de "acme" pede "globex" (que existe) → 404.
        let (estado, cookie) = borda_membros(
            admin_de("acme"),
            vec![org_teste("acme"), org_teste("globex")],
            vec![(OrgId("globex".into()), membro_teste("x", Papel::Member))],
        );
        let (status, ..) = resposta_crua(estado, &cookie, "/api/v1/orgs/globex/membros").await;
        assert_eq!(status, StatusCode::NOT_FOUND, "org alheia é 404, não 403");
    }

    /// Própria org, mas o solicitante é `member` (não `org_admin`) ⇒ **403**: ele VÊ a org (por isso
    /// não é 404), só não pode gerir. A distinção 403≠404 vale porque a org é visível a ele.
    #[tokio::test]
    async fn membros_propria_org_sem_papel_e_403() {
        let (estado, cookie) = borda_membros(
            membro_de("acme"),
            vec![org_teste("acme")],
            vec![(OrgId("acme".into()), membro_teste("u1", Papel::Member))],
        );
        let (status, ..) = resposta_crua(estado, &cookie, "/api/v1/orgs/acme/membros").await;
        assert_eq!(status, StatusCode::FORBIDDEN, "própria org sem papel org_admin é 403");
    }

    /// Sem sessão ⇒ 401 (superfície VISÍVEL: `/orgs/{org}` não é segredo, dizer "autentique-se" não
    /// revela nada). O extractor barra antes de tocar store algum.
    #[tokio::test]
    async fn membros_sem_sessao_e_401() {
        let (estado, _cookie) = borda_membros(admin_de("acme"), vec![org_teste("acme")], vec![]);
        let (status, ..) = resposta_crua(estado, "", "/api/v1/orgs/acme/membros").await;
        assert_eq!(status, StatusCode::UNAUTHORIZED);
    }

    /// Armazém INDISPONÍVEL (infra) numa superfície visível ⇒ **500**, não 200 nem panic — a borda
    /// TRATA o `Err` do `Result` (a razão de o `Result` existir desde já). Store-duplo que falha.
    #[tokio::test]
    async fn membros_store_indisponivel_e_500() {
        struct OrgsFalho;
        impl ArmazemOrg for OrgsFalho {
            fn listar(&self) -> Result<Vec<Org>, ErroArmazem> {
                Err(ErroArmazem::Indisponivel)
            }
            fn buscar(&self, _id: &OrgId) -> Result<Option<Org>, ErroArmazem> {
                Err(ErroArmazem::Indisponivel)
            }
        }
        let mut armazem = ArmazemMemoria::novo();
        let (id, _) = emitir_sessao(&mut armazem, admin_de("acme"), AGORA);
        let cookie = format!("{NOME_COOKIE_SESSAO}={}", id.0);
        let estado = Borda::nova(
            armazem,
            relogio_fixo,
            nulo(),
            Arc::new(OrgsFalho),
            sem_membros(),
        );
        let (status, ..) = resposta_crua(estado, &cookie, "/api/v1/orgs/acme/membros").await;
        assert_eq!(
            status,
            StatusCode::INTERNAL_SERVER_ERROR,
            "store fora do ar em superfície visível é 500 (tratado, não panic)"
        );
    }
}
