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
use galaxie_platform_conta::usuario_da_sessao;
use galaxie_platform_config::{configs_do_usuario, ConfigErro, ConfigItem};
use galaxie_platform_identity::armazem::{Dominio, ErroArmazem, EstadoDominio, Membro};
use galaxie_platform_identity::sessao::ArmazemSessao;
use galaxie_platform_identity::{EstadoOrg, OrgId, Papel, UserId};
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

/// Inverso de [`papel_str`] — a ALLOWLIST de papéis que o cliente pode ESCREVER (`PATCH` papel). Fora
/// dela ⇒ `None` (o handler ⇒ 400): o servidor não aceita um papel que não conhece (nem "staff" nem
/// um valor forjado). `match` exaustivo — papel novo no domínio obriga a decidir se é escrevível.
fn papel_de_str(s: &str) -> Option<Papel> {
    match s {
        "member" => Some(Papel::Member),
        "org_admin" => Some(Papel::OrgAdmin),
        _ => None,
    }
}

/// Corpo do `PATCH /orgs/{org}/membros/{uid}`: só o papel novo. Campo faltando/tipo errado ⇒ falha
/// de desserialização ⇒ 400 (o handler não adivinha).
#[derive(serde::Deserialize)]
struct MudarPapelReq {
    papel: String,
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
    match autorizar_acao_admin(&sessao, &AcaoAdminOrg::ListarMembros, &org, &*estado.auditor) {
        Err(AdminErro::NaoEncontrada) => return resposta_de_erro(CodigoErro::NaoEncontrado),
        Err(AdminErro::Suspensa) => return resposta_de_erro(CodigoErro::OrgSuspensa),
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

/// Carrega o `Org` e AUTORIZA a `acao` sobre ele — o pré-âmbulo comum das rotas org-scoped (mesma
/// ordem visibilidade→suspensão→papel do `listar_membros`). `Ok` = autorizado; `Err(resp)` = a
/// resposta pronta (404/403/`org_suspensa`/500) pra o handler devolver.
async fn org_autorizada(
    estado: &EstadoBorda,
    sessao: &galaxie_platform_identity::Sessao,
    acao: &AcaoAdminOrg,
    org_id: &OrgId,
) -> Result<(), Response> {
    let org = match estado.orgs.buscar(org_id) {
        Err(ErroArmazem::Indisponivel) => return Err(resposta_de_falha(Visibilidade::Visivel)),
        Ok(None) => return Err(resposta_de_erro(CodigoErro::NaoEncontrado)),
        Ok(Some(o)) => o,
    };
    match autorizar_acao_admin(sessao, acao, &org, &*estado.auditor) {
        Err(AdminErro::NaoEncontrada) => Err(resposta_de_erro(CodigoErro::NaoEncontrado)),
        Err(AdminErro::Suspensa) => Err(resposta_de_erro(CodigoErro::OrgSuspensa)),
        Err(AdminErro::Negado) => Err(resposta_de_erro(CodigoErro::Negado)),
        Ok(()) => Ok(()),
    }
}

/// `DELETE /api/v1/orgs/{org}/membros/{uid}` (contrato §4.3) — remove um membro. Autz: só `org_admin`
/// da org (visibilidade→suspensão→papel). `204` se removeu; `404` se o `uid` não era membro (a admin
/// PODE ver os membros, então não é oráculo).
///
/// 🔑 **A remoção REVOGA o acesso NA HORA (#1545):** ao remover, invalida TODAS as sessões vivas do
/// alvo no servidor — o botão CORTA, não só registra. `Principal`/`Escopo` estão congelados na sessão,
/// então cortar exige REVOGAR (não dá pra checar por request como a suspensão). ⚠️ Colateral NOMEADO
/// e aceito (@Altair): invalidar todas as sessões desloga o alvo das OUTRAS orgs também — sobre-revogar
/// é o lado seguro (o custo é relogar; revogação cirúrgica exigiria mutar sessão viva, mecanismo novo
/// pra ganho pequeno). Só revoga se REMOVEU de fato (não em não-membro).
async fn remover_membro(
    State(estado): State<EstadoBorda>,
    SessaoAtual(sessao): SessaoAtual,
    Path((org, uid)): Path<(String, String)>,
) -> Response {
    let org_id = OrgId(org);
    let alvo = UserId(uid);
    if let Err(resp) = org_autorizada(&estado, &sessao, &AcaoAdminOrg::RemoverMembro, &org_id).await {
        return resp;
    }
    match estado.membros.remover(&org_id, &alvo) {
        Err(ErroArmazem::Indisponivel) => resposta_de_falha(Visibilidade::Visivel),
        Ok(true) => {
            // #1545: revoga NA HORA — mata todas as sessões do alvo (colateral aceito acima).
            estado
                .armazem
                .lock()
                .expect("armazém de sessão não deve estar envenenado")
                .invalidar_do_usuario(&alvo);
            Response::builder()
                .status(StatusCode::NO_CONTENT)
                .body(Body::empty())
                .expect("resposta 204 é sempre construível")
        }
        Ok(false) => resposta_de_erro(CodigoErro::NaoEncontrado), // `uid` não era membro
    }
}

/// `PATCH /api/v1/orgs/{org}/membros/{uid}` (contrato §4.3) — muda o papel. Autz igual; papel fora da
/// allowlist ⇒ `400`; `uid` não-membro ⇒ `404`; senão `200` com o membro atualizado.
///
/// 🔑 **Mudar o papel REVOGA a sessão do alvo NA HORA (#1545):** como `Principal`/`Escopo` estão
/// congelados na sessão, o papel novo não valeria até o próximo login — então a escrita invalida as
/// sessões vivas do alvo, forçando o relogin que carrega o papel novo. Mesmo colateral aceito do
/// `remover` (desloga das outras orgs). Só revoga se a mudança ACONTECEU (não em não-membro).
async fn mudar_papel_membro(
    State(estado): State<EstadoBorda>,
    SessaoAtual(sessao): SessaoAtual,
    Path((org, uid)): Path<(String, String)>,
    corpo: axum::body::Bytes,
) -> Response {
    let org_id = OrgId(org);
    // Autz ANTES de processar o corpo: quem não pode não tem o payload lido/aplicado.
    if let Err(resp) = org_autorizada(&estado, &sessao, &AcaoAdminOrg::MudarPapelMembro, &org_id).await {
        return resp;
    }
    // Papel do corpo — allowlist (fora dela = 400, nunca "papel novo silencioso").
    let papel = match serde_json::from_slice::<MudarPapelReq>(&corpo).ok().and_then(|r| papel_de_str(&r.papel)) {
        Some(p) => p,
        None => return resposta_de_erro(CodigoErro::PayloadInvalido),
    };
    let alvo = UserId(uid);
    match estado.membros.mudar_papel(&org_id, &alvo, papel) {
        Err(ErroArmazem::Indisponivel) => resposta_de_falha(Visibilidade::Visivel),
        Ok(None) => resposta_de_erro(CodigoErro::NaoEncontrado), // `uid` não era membro
        Ok(Some(m)) => {
            // #1545: revoga NA HORA — o papel novo vale no relogin forçado.
            estado
                .armazem
                .lock()
                .expect("armazém de sessão não deve estar envenenado")
                .invalidar_do_usuario(&alvo);
            let corpo = serde_json::to_string(&MembroDto::from(&m)).expect("MembroDto serializa sempre");
            Response::builder()
                .status(StatusCode::OK)
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(corpo))
                .expect("resposta 200 é sempre construível")
        }
    }
}

/// O estado do domínio como o contrato §4.3 o projeta no fio. Explícito, não `derive` — o valor de
/// contrato não muda se alguém renomear a variante Rust.
fn estado_dominio_str(estado: &EstadoDominio) -> &'static str {
    match estado {
        EstadoDominio::Pendente => "pendente",
        EstadoDominio::Verificado => "verificado",
    }
}

/// Domínio como sai no fio (contrato §4.3: `{ dominio, estado: "pendente"|"verificado" }`).
#[derive(serde::Serialize)]
struct DominioDto<'a> {
    dominio: &'a str,
    estado: &'a str,
}

impl<'a> From<&'a Dominio> for DominioDto<'a> {
    fn from(d: &'a Dominio) -> Self {
        DominioDto { dominio: &d.dominio, estado: estado_dominio_str(&d.estado) }
    }
}

/// `GET /api/v1/orgs/{org}/dominios` (contrato §4.3) — lista os domínios da org com seu estado de
/// verificação. Mesmo esqueleto do `listar_membros` (o padrão ratificado no #1536): 404 antes de
/// 403, `resposta_de_falha` no lugar único, DTO na borda. A leitura é autorizada IGUAL à escrita de
/// domínio (`autorizar_acao_admin` com `ListarDominios`).
async fn listar_dominios(
    State(estado): State<EstadoBorda>,
    SessaoAtual(sessao): SessaoAtual,
    Path(org): Path<String>,
) -> Response {
    let org_id = OrgId(org);

    // (1) Carrega o Org pra autz. Infra ⇒ 500 (visível); NÃO existe ⇒ 404 (alheia/inexistente).
    let org = match estado.orgs.buscar(&org_id) {
        Err(ErroArmazem::Indisponivel) => return resposta_de_falha(Visibilidade::Visivel),
        Ok(None) => return resposta_de_erro(CodigoErro::NaoEncontrado),
        Ok(Some(o)) => o,
    };

    // (2) Autz: 404 (alheia) antes de 403 (própria sem papel).
    match autorizar_acao_admin(&sessao, &AcaoAdminOrg::ListarDominios, &org, &*estado.auditor) {
        Err(AdminErro::NaoEncontrada) => return resposta_de_erro(CodigoErro::NaoEncontrado),
        Err(AdminErro::Suspensa) => return resposta_de_erro(CodigoErro::OrgSuspensa),
        Err(AdminErro::Negado) => return resposta_de_erro(CodigoErro::Negado),
        Ok(()) => {}
    }

    // (3) Dados.
    match estado.dominios.listar(&org_id) {
        Err(ErroArmazem::Indisponivel) => resposta_de_falha(Visibilidade::Visivel),
        Ok(dominios) => {
            let dto: Vec<DominioDto> = dominios.iter().map(DominioDto::from).collect();
            let corpo = serde_json::to_string(&dto).expect("Vec<DominioDto> serializa sempre");
            Response::builder()
                .status(StatusCode::OK)
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(corpo))
                .expect("resposta 200 é sempre construível")
        }
    }
}

/// O perfil como sai no fio (contrato §4.1: `{ nome, email, idioma? }`). DTO na borda; `idioma`
/// some do JSON quando ausente (`idioma?` — o cliente cai no default). Domínio fica serde-free.
#[derive(serde::Serialize)]
struct PerfilDto<'a> {
    nome: &'a str,
    email: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    idioma: Option<&'a str>,
}

/// `GET /api/v1/me` (contrato §4.1) — o perfil do PRÓPRIO principal. **User-scoped:** o `uid` vem
/// da SESSÃO (`usuario_da_sessao`, delta do @Altair "a conta é sua e só sua"), NUNCA da rota —
/// não há como pedir o perfil de outro. `401` sem sessão (extractor visível: `/me` não é segredo).
/// Perfil ausente para um autenticado = **inconsistência de infra** (`resposta_de_falha`, 500), não
/// 404: a sessão é válida, então o perfil DEVERIA existir (nasce no callback OAuth).
async fn get_me(State(estado): State<EstadoBorda>, SessaoAtual(sessao): SessaoAtual) -> Response {
    let uid = usuario_da_sessao(&sessao);
    match estado.perfis.buscar(uid) {
        // Infra fora do ar: falha nossa, transitória.
        Err(ErroArmazem::Indisponivel) => resposta_de_falha(Visibilidade::Visivel),
        // INVARIANTE: sessão ⟹ perfil (ambos nascem no callback OAuth; o dev-server semeia os dois).
        // `Ok(None)` — sessão VÁLIDA sem perfil — é INCONSISTÊNCIA de dado, NÃO infra caída. É a mesma
        // conflação que o `Result` do armazém OAuth desfaz uma camada abaixo (@Altair, review do #1543),
        // e ela não pode voltar aqui: um incidente de infra e um dado inconsistente têm de ser
        // DISTINGUÍVEIS no log/alerta. O HTTP é o mesmo 500 (o cliente não conserta nenhum — não há
        // 2º construtor de erro, a regra anti-oráculo segue), mas o LOG diz qual é.
        Ok(None) => {
            tracing::error!(uid = %uid.0, "GET /me: sessão válida sem perfil — invariante (sessão ⟹ perfil) violada");
            resposta_de_falha(Visibilidade::Visivel)
        }
        Ok(Some(perfil)) => {
            let dto = PerfilDto {
                nome: &perfil.nome,
                email: &perfil.email,
                idioma: perfil.idioma.as_deref(),
            };
            let corpo = serde_json::to_string(&dto).expect("PerfilDto serializa sempre");
            Response::builder()
                .status(StatusCode::OK)
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(corpo))
                .expect("resposta 200 é sempre construível")
        }
    }
}

/// Projeta um [`ConfigItem`] (domínio, validado por construção pelo #1563) na forma plana do
/// contrato §4.4: `{ chave, valor: bool|string, tipo, opcoes? }`. `match` EXAUSTIVO — variante nova
/// de `ConfigItem` (ex.: um tipo de valor futuro) OBRIGA a decidir a projeção aqui, não compila sem.
/// **`rotulo` é OMITIDO** (opcional no §4.4; é conteúdo de produto/labels, entra quando o PO definir —
/// o FE do @Castor renderiza data-driven sem ele).
fn config_item_para_fio(item: &ConfigItem) -> serde_json::Value {
    use serde_json::json;
    match item {
        ConfigItem::Booleano(b) => json!({ "chave": b.chave(), "valor": b.valor(), "tipo": "bool" }),
        ConfigItem::Texto(t) => json!({ "chave": t.chave(), "valor": t.valor(), "tipo": "texto" }),
        ConfigItem::Opcao(o) => json!({ "chave": o.chave(), "valor": o.valor(), "tipo": "opcao", "opcoes": o.opcoes() }),
    }
}

/// `GET /api/v1/me/config` (contrato §4.4) — as prefs de config do PRÓPRIO principal. User-scoped: o
/// `uid` vem da SESSÃO; `configs_do_usuario` (#1563) aplica owner-scope + allowlist + validação por
/// construção. **Survive-list (#1544):** NÃO passa pela autz de org (config é pref do USUÁRIO, não
/// recurso de org) ⇒ sobrevive à suspensão — guardado por `me_config_sobrevive_a_suspensao`.
async fn get_me_config(State(estado): State<EstadoBorda>, SessaoAtual(sessao): SessaoAtual) -> Response {
    let uid = usuario_da_sessao(&sessao);
    let prefs_brutas = match estado.prefs.prefs_do_usuario(uid) {
        Err(ErroArmazem::Indisponivel) => return resposta_de_falha(Visibilidade::Visivel),
        Ok(p) => p,
    };
    // O domínio decide (owner-scope/allowlist/validação). A borda NÃO achata as variantes (2 achados
    // do @Altair na PR #1579): cada uma tem a sua direção segura, e o log NÃO pode afirmar uma causa
    // pelas três.
    // ⚠️ SE ALGUÉM TROCAR ESTE `None` POR `Some(alvo)` — a rota cross-user (`/users/{id}/config`) —
    // LEIA ISTO PRIMEIRO. É aqui que a config deixa de ser só a própria, e duas precondições passam
    // a valer. Estão neste comentário e não num card porque **esta linha é a que é impossível não
    // editar** para as violar; um card, quem chega aqui não sabe que existe.
    //
    //  - **#1589 (FEITO):** o ramo NEGADO já emite auditoria pelo funil da crate. Ao passar
    //    `Some(alvo)`, pedir a config alheia passa a deixar rasto sem esta rota fazer nada — a
    //    sondagem é auditada por construção, não por o handler se lembrar.
    //  - **#1591 (POR FAZER):** o `EventoAutz.alvo` é `Option<&OrgId>` e **não consegue exprimir o
    //    UTILIZADOR alvejado** — hoje o evento sai com `alvo: None`. Enquanto assim for, a trilha
    //    regista QUEM sondou e não CONTRA QUEM: `A` a tentar 1 e `A` a tentar 500 ficam idênticos,
    //    e a forma da sondagem é justamente a distribuição sobre alvos. **Faça o #1591 antes desta
    //    rota** — trilha que não diz contra quem é pior que trilha vazia, porque parece cobertura.
    let itens = match configs_do_usuario(&sessao, None, prefs_brutas, &*estado.auditor) {
        Ok(itens) => itens,
        // `NaoEncontrado` = owner-scope: config de OUTRO principal. **Hoje LATENTE** (passo `None` como
        // alvo ⇒ o scope resolve pro próprio e nunca nega), mas a borda PROPAGA o 404 anti-oráculo do
        // domínio em vez de o converter em 500 — senão, quando `/users/{id}/config` existir, pedir a
        // config alheia viraria oráculo pela DIFERENÇA de status. Rejeição uniforme, cliente-causada.
        Err(ConfigErro::NaoEncontrado) => return resposta_de_erro(CodigoErro::NaoEncontrado),
        // As outras = INCONSISTÊNCIA de dado no read path (pref gravada fora do tipo; ou `ChaveNaoPermitida`,
        // que só o write path emite — inalcançável aqui, mas o `match` é EXAUSTIVO por desenho): o cliente
        // não conserta ⇒ 500. O log NOMEIA a variante (`erro = ?e`), não afirma UMA causa pelas três
        // (a lição do "diagnóstico ≠ falha") — e não confunde dado ruim com infra fora.
        Err(e @ (ConfigErro::ValorInvalido | ConfigErro::ChaveNaoPermitida)) => {
            tracing::error!(uid = %uid.0, erro = ?e, "GET /me/config: pref inconsistente com o registro (dado, não infra)");
            return resposta_de_falha(Visibilidade::Visivel);
        }
    };
    let fio: Vec<serde_json::Value> = itens.iter().map(config_item_para_fio).collect();
    let corpo = serde_json::to_string(&fio).expect("Vec<Value> serializa sempre");
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(corpo))
        .expect("resposta 200 é sempre construível")
}

/// O `estado` da org como o contrato §4.5/v1.4 o projeta no fio. Explícito (não `Debug`/derive):
/// o valor é PARTE DO CONTRATO — a tela do FE lê "suspensa" pra mostrar "fale com o admin".
fn estado_org_str(estado: EstadoOrg) -> &'static str {
    match estado {
        EstadoOrg::Provisionada => "provisionada",
        EstadoOrg::Suspensa => "suspensa",
    }
}

/// Uma org do principal como sai no fio (contrato v1.4: `{ org, papel, estado }`). O `estado`
/// entrou no v1.4 (#1544): é daqui que a tela tira o nome + o estado da org suspensa (por isso
/// `/me/orgs` SOBREVIVE à suspensão — ver `me_orgs_sobrevive_a_suspensao`).
#[derive(serde::Serialize)]
struct OrgDoUsuarioDto<'a> {
    org: &'a str,
    papel: &'a str,
    estado: &'static str,
}

/// `GET /api/v1/me/orgs` (contrato v1.4) — as orgs do PRÓPRIO principal, com o papel E o `estado`
/// em cada (o `estado` entrou no v1.4/#1544: a tela de org suspensa lê daqui).
///
/// É a rota pela qual a UI **DESCOBRE o `{org}`** — sem ela, mesmo com sessão, o cliente não sabe
/// qual org pedir e nenhuma das outras rotas é alcançável (lacuna do `{org}` que o @Altair fechou
/// no v1.3; achado do @Pollux medindo a borda real). **User-scoped:** o `uid` vem da SESSÃO
/// (invariante 6), NUNCA do caminho — não há como pedir as orgs de outro. Sem autz de org (o
/// principal só vê o PRÓPRIO pertencimento); 401 sem sessão (extractor), 500 se o store cair.
/// O `papel` diz o que a UI mostra, jamais o que o servidor permite.
async fn listar_minhas_orgs(
    State(estado): State<EstadoBorda>,
    SessaoAtual(sessao): SessaoAtual,
) -> Response {
    // NÃO passa por `autorizar_acao_admin`: /me/orgs SOBREVIVE à suspensão de propósito (senão o
    // usuário de org suspensa fica sem a tela que explica, e conclui que a CONTA quebrou). O
    // `me_orgs_sobrevive_a_suspensao` GUARDA essa propriedade — se alguém "harmonizar" e meter a
    // autz aqui, aquele teste fica vermelho.
    let orgs = match estado.membros.orgs_do_usuario(sessao.principal().usuario()) {
        Err(ErroArmazem::Indisponivel) => return resposta_de_falha(Visibilidade::Visivel),
        Ok(orgs) => orgs,
    };
    // O `estado` (contrato v1.4) vem do armazém de orgs — join por pertencimento. Uma org que o
    // usuário É membro mas o store de orgs não tem é INCONSISTÊNCIA de infra ⇒ falha (não invento
    // estado nem escondo a org da lista). No caminho normal (stores coerentes) roda limpo.
    let mut dto: Vec<OrgDoUsuarioDto> = Vec::with_capacity(orgs.len());
    for (org_id, papel) in &orgs {
        let estado_str = match estado.orgs.buscar(org_id) {
            Err(ErroArmazem::Indisponivel) => return resposta_de_falha(Visibilidade::Visivel),
            Ok(Some(org)) => estado_org_str(org.estado()),
            Ok(None) => return resposta_de_falha(Visibilidade::Visivel),
        };
        dto.push(OrgDoUsuarioDto { org: &org_id.0, papel: papel_str(papel), estado: estado_str });
    }
    let corpo = serde_json::to_string(&dto).expect("Vec<OrgDoUsuarioDto> serializa sempre");
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(corpo))
        .expect("resposta 200 é sempre construível")
}

/// Monta o `Router` da borda com o estado (armazéns + relógio + auditor) já resolvido.
pub fn rotas(estado: EstadoBorda) -> Router {
    Router::new()
        .route("/api/v1/admin/orgs", get(listar_orgs))
        .route("/api/v1/me", get(get_me))
        .route("/api/v1/me/config", get(get_me_config))
        .route("/api/v1/me/orgs", get(listar_minhas_orgs))
        .route("/api/v1/orgs/{org}/membros", get(listar_membros))
        .route(
            "/api/v1/orgs/{org}/membros/{uid}",
            delete(remover_membro).patch(mudar_papel_membro),
        )
        .route("/api/v1/orgs/{org}/dominios", get(listar_dominios))
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
    use galaxie_platform_identity::auditoria::{Auditor, EventoAutz, ResultadoAutz};
    use galaxie_platform_identity::armazem::{
        ArmazemDominio, ArmazemDominioMemoria, ArmazemMembro, ArmazemMembroMemoria, ArmazemOrg,
        ArmazemOrgMemoria, Dominio, ErroArmazem, EstadoDominio, Membro,
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
    fn sem_dominios() -> Arc<dyn ArmazemDominio + Send + Sync> {
        Arc::new(ArmazemDominioMemoria::novo())
    }
    fn sem_perfis() -> Arc<dyn galaxie_platform_conta::ArmazemPerfil + Send + Sync> {
        Arc::new(galaxie_platform_conta::ArmazemPerfilMemoria::novo())
    }
    fn sem_prefs() -> Arc<dyn galaxie_platform_config::ArmazemPref + Send + Sync> {
        Arc::new(galaxie_platform_config::ArmazemPrefMemoria::novo())
    }
    use galaxie_platform_conta::{ArmazemPerfilMemoria, Perfil};

    /// Borda com o perfil de `u1` semeado + sessão viva de `u1`. `idioma` controlável pra provar o
    /// `idioma?` (some do JSON quando `None`).
    fn borda_com_perfil(idioma: Option<&str>) -> (EstadoBorda, String) {
        let mut armazem = ArmazemMemoria::novo();
        let sessao = galaxie_platform_identity::Sessao::estabelecer(
            Principal::UsuarioFinal { usuario: UserId("u1".into()), org: OrgId("orgA".into()) },
            Escopo::vazio(),
        );
        let (id, _c) = emitir_sessao(&mut armazem, sessao, AGORA);
        let cookie = format!("{NOME_COOKIE_SESSAO}={}", id.0);
        let mut perfis = ArmazemPerfilMemoria::novo();
        perfis.inserir(
            UserId("u1".into()),
            Perfil { nome: "Ana".into(), email: "ana@x.com".into(), idioma: idioma.map(str::to_owned) },
        );
        let borda = Borda::nova(armazem, relogio_fixo, nulo(), sem_orgs(), sem_membros(), sem_dominios(), Arc::new(perfis), sem_prefs());
        (borda, cookie)
    }

    /// GET /me devolve o perfil do PRÓPRIO principal (uid da sessão, nunca da rota).
    #[tokio::test]
    async fn get_me_devolve_o_perfil_do_principal() {
        let (estado, cookie) = borda_com_perfil(Some("pt-BR"));
        let (status, _h, corpo) = resposta_crua(estado, &cookie, "/api/v1/me").await;
        assert_eq!(status, StatusCode::OK);
        let json: serde_json::Value = serde_json::from_slice(&corpo).unwrap();
        assert_eq!(json["nome"], "Ana");
        assert_eq!(json["email"], "ana@x.com");
        assert_eq!(json["idioma"], "pt-BR");
    }

    /// `idioma?` — ausente no perfil ⇒ o campo SOME do JSON (não vira `null`), pro cliente cair no default.
    #[tokio::test]
    async fn get_me_omite_idioma_quando_ausente() {
        let (estado, cookie) = borda_com_perfil(None);
        let (status, _h, corpo) = resposta_crua(estado, &cookie, "/api/v1/me").await;
        assert_eq!(status, StatusCode::OK);
        let json: serde_json::Value = serde_json::from_slice(&corpo).unwrap();
        assert!(json.get("idioma").is_none(), "idioma ausente some do JSON: {corpo:?}");
    }

    /// **#1544 — GET /me na SURVIVE-LIST (gêmeo do `me_orgs_sobrevive`, pedido do @Altair).** REGRA
    /// que a lista significa: toda rota da survive-list (`/me`, `/me/orgs`, logout) NASCE com o seu
    /// teste de sobrevivência. `u1` é membro da orgA SUSPENSA e tem perfil ⇒ `/me` = 200 com o perfil
    /// (não passa pela autz de org). Se alguém "harmonizar" e meter a suspensão no caminho do `/me`,
    /// acharia orgA suspensa ⇒ 403, e SÓ este teste fica vermelho.
    #[tokio::test]
    async fn me_sobrevive_a_suspensao() {
        let mut armazem = ArmazemMemoria::novo();
        let sessao = galaxie_platform_identity::Sessao::estabelecer(
            Principal::UsuarioFinal { usuario: UserId("u1".into()), org: OrgId("orgA".into()) },
            Escopo::vazio(),
        );
        let (id, _c) = emitir_sessao(&mut armazem, sessao, AGORA);
        let cookie = format!("{NOME_COOKIE_SESSAO}={}", id.0);
        let mut perfis = ArmazemPerfilMemoria::novo();
        perfis.inserir(UserId("u1".into()), Perfil { nome: "Ana".into(), email: "ana@x.com".into(), idioma: None });
        let mut orgs = ArmazemOrgMemoria::novo();
        let mut org = Org::nova(OrgId("orgA".into()), Default::default(), None);
        org.suspender();
        orgs.inserir(org);
        let estado = Borda::nova(armazem, relogio_fixo, nulo(), Arc::new(orgs), sem_membros(), sem_dominios(), Arc::new(perfis), sem_prefs());
        let (status, _h, corpo) = resposta_crua(estado, &cookie, "/api/v1/me").await;
        assert_eq!(status, StatusCode::OK, "/me SOBREVIVE à suspensão (survive-list #1544)");
        assert!(String::from_utf8_lossy(&corpo).contains("Ana"), "com o perfil, pra tela poder explicar");
    }

    /// GET /me sem sessão ⇒ 401 (superfície visível; `/me` não é segredo).
    #[tokio::test]
    async fn get_me_sem_sessao_e_401() {
        let estado = Borda::nova(ArmazemMemoria::novo(), relogio_fixo, nulo(), sem_orgs(), sem_membros(), sem_dominios(), sem_perfis(), sem_prefs());
        let (status, ..) = resposta_crua(estado, "", "/api/v1/me").await;
        assert_eq!(status, StatusCode::UNAUTHORIZED);
    }

    /// Borda com 2 prefs allowlisted semeadas pro `u1` (uma `Opcao`, uma `Booleano`) + sessão viva.
    fn borda_com_prefs() -> (EstadoBorda, String) {
        use galaxie_platform_config::{ArmazemPrefMemoria, FormaDaChave};
        let mut armazem = ArmazemMemoria::novo();
        let sessao = galaxie_platform_identity::Sessao::estabelecer(
            Principal::UsuarioFinal { usuario: UserId("u1".into()), org: OrgId("orgA".into()) },
            Escopo::vazio(),
        );
        let (id, _c) = emitir_sessao(&mut armazem, sessao, AGORA);
        let cookie = format!("{NOME_COOKIE_SESSAO}={}", id.0);
        let mut prefs = ArmazemPrefMemoria::novo();
        prefs.semear(
            UserId("u1".into()),
            vec![
                (
                    "app.tema".into(),
                    "escuro".into(),
                    FormaDaChave::Opcao { opcoes: vec!["claro".into(), "escuro".into(), "sistema".into()] },
                ),
                ("app.notificacoes".into(), "true".into(), FormaDaChave::Booleano),
            ],
        );
        let borda = Borda::nova(armazem, relogio_fixo, nulo(), sem_orgs(), sem_membros(), sem_dominios(), sem_perfis(), Arc::new(prefs));
        (borda, cookie)
    }

    /// GET /me/config devolve as prefs do PRÓPRIO principal (uid da sessão), mapeadas pro fio pelo
    /// tipo: `Opcao` carrega `opcoes`; `Booleano` carrega `valor` bool. `rotulo` é opcional (§4.4) e
    /// OMITIDO — é conteúdo de produto, não contrato da borda.
    #[tokio::test]
    async fn get_me_config_devolve_as_prefs_do_principal() {
        let (estado, cookie) = borda_com_prefs();
        let (status, _h, corpo) = resposta_crua(estado, &cookie, "/api/v1/me/config").await;
        assert_eq!(status, StatusCode::OK);
        let json: serde_json::Value = serde_json::from_slice(&corpo).unwrap();
        let itens = json.as_array().expect("corpo é um array de itens de config");
        assert_eq!(itens.len(), 2, "as 2 prefs allowlisted semeadas: {corpo:?}");
        let tema = itens.iter().find(|i| i["chave"] == "app.tema").expect("app.tema presente");
        assert_eq!(tema["valor"], "escuro");
        assert_eq!(tema["tipo"], "opcao");
        assert_eq!(tema["opcoes"], serde_json::json!(["claro", "escuro", "sistema"]));
        assert!(tema.get("rotulo").is_none(), "rotulo omitido (§4.4, opcional)");
        let notif = itens.iter().find(|i| i["chave"] == "app.notificacoes").expect("app.notificacoes presente");
        assert_eq!(notif["valor"], true);
        assert_eq!(notif["tipo"], "bool");
    }

    /// **#1544 — GET /me/config na SURVIVE-LIST (regra do @Altair: toda rota da survive-list nasce
    /// com seu teste de sobrevivência).** `u1` é membro da orgA SUSPENSA e tem prefs ⇒ `/me/config` =
    /// 200 com as prefs (config é pref do USUÁRIO, não recurso de org — não passa pela autz de org).
    /// Se alguém "harmonizar" e meter a suspensão no caminho do `/me/config`, SÓ este teste fica vermelho.
    #[tokio::test]
    async fn me_config_sobrevive_a_suspensao() {
        use galaxie_platform_config::{ArmazemPrefMemoria, FormaDaChave};
        let mut armazem = ArmazemMemoria::novo();
        let sessao = galaxie_platform_identity::Sessao::estabelecer(
            Principal::UsuarioFinal { usuario: UserId("u1".into()), org: OrgId("orgA".into()) },
            Escopo::vazio(),
        );
        let (id, _c) = emitir_sessao(&mut armazem, sessao, AGORA);
        let cookie = format!("{NOME_COOKIE_SESSAO}={}", id.0);
        let mut prefs = ArmazemPrefMemoria::novo();
        prefs.semear(
            UserId("u1".into()),
            vec![("app.notificacoes".into(), "true".into(), FormaDaChave::Booleano)],
        );
        let mut orgs = ArmazemOrgMemoria::novo();
        let mut org = Org::nova(OrgId("orgA".into()), Default::default(), None);
        org.suspender();
        orgs.inserir(org);
        let estado = Borda::nova(armazem, relogio_fixo, nulo(), Arc::new(orgs), sem_membros(), sem_dominios(), sem_perfis(), Arc::new(prefs));
        let (status, _h, corpo) = resposta_crua(estado, &cookie, "/api/v1/me/config").await;
        assert_eq!(status, StatusCode::OK, "/me/config SOBREVIVE à suspensão (survive-list #1544)");
        let json: serde_json::Value = serde_json::from_slice(&corpo).unwrap();
        assert_eq!(json.as_array().map(Vec::len), Some(1), "a pref do usuário volta com a org suspensa: {corpo:?}");
    }

    /// **Achado do @Altair na #1579 (arm de dado-inconsistente).** Pref gravada que NÃO cabe no tipo da
    /// chave (`app.notificacoes` é `Booleano`, mas o store tem `"sim"`) ⇒ `configs_do_usuario` devolve
    /// `ValorInvalido` = INCONSISTÊNCIA de DADO (não falha do cliente, não infra) ⇒ a borda responde 500
    /// e loga a variante nomeada. Guarda a direção segura: dado ruim é 500, não um item ilegal no fio nem
    /// um panic. (O arm `NaoEncontrado`→404 anti-oráculo é LATENTE via `/me/config` — só o alcança uma
    /// rota com alvo na path; nasce com o teste dela quando `/users/{id}/config` existir.)
    #[tokio::test]
    async fn me_config_pref_inconsistente_da_500() {
        use galaxie_platform_config::{ArmazemPrefMemoria, FormaDaChave};
        let mut armazem = ArmazemMemoria::novo();
        let sessao = galaxie_platform_identity::Sessao::estabelecer(
            Principal::UsuarioFinal { usuario: UserId("u1".into()), org: OrgId("orgA".into()) },
            Escopo::vazio(),
        );
        let (id, _c) = emitir_sessao(&mut armazem, sessao, AGORA);
        let cookie = format!("{NOME_COOKIE_SESSAO}={}", id.0);
        let mut prefs = ArmazemPrefMemoria::novo();
        // `"sim"` não é `"true"`/`"false"`: o construtor de `Booleano` recusa ⇒ `ValorInvalido`.
        prefs.semear(
            UserId("u1".into()),
            vec![("app.notificacoes".into(), "sim".into(), FormaDaChave::Booleano)],
        );
        let estado = Borda::nova(armazem, relogio_fixo, nulo(), sem_orgs(), sem_membros(), sem_dominios(), sem_perfis(), Arc::new(prefs));
        let (status, ..) = resposta_crua(estado, &cookie, "/api/v1/me/config").await;
        assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR, "pref fora do tipo = dado inconsistente ⇒ 500");
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
        eventos: MutexStd<Vec<(UserId, String, ResultadoAutz)>>,
    }
    impl Auditor for AuditorEspiao {
        fn registrar(&self, e: &EventoAutz) {
            self.eventos
                .lock()
                .unwrap()
                .push((e.ator.clone(), e.acao.to_string(), e.resultado));
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
        (Borda::nova(armazem, relogio_fixo, nulo(), sem_orgs(), sem_membros(), sem_dominios(), sem_perfis(), sem_prefs()), cookie_req)
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

    /// Borda com o admin `u1` de `orgA` + a org no store (suspensa ou não) + `u1` como membro
    /// admin. `orgA` ativa ⇒ o admin lista; suspensa ⇒ o acesso é cortado.
    fn borda_admin_org(suspensa: bool) -> (EstadoBorda, String) {
        let mut armazem = ArmazemMemoria::novo();
        let sessao = galaxie_platform_identity::Sessao::estabelecer(
            Principal::AdminOrg { usuario: UserId("u1".into()), org: OrgId("orgA".into()) },
            Escopo::de_orgs([OrgId("orgA".into())]),
        );
        let (id, _c) = emitir_sessao(&mut armazem, sessao, AGORA);
        let cookie = format!("{NOME_COOKIE_SESSAO}={}", id.0);

        let mut orgs = ArmazemOrgMemoria::novo();
        let mut org = Org::nova(OrgId("orgA".into()), Default::default(), None);
        if suspensa {
            org.suspender();
        }
        orgs.inserir(org);

        let mut membros = ArmazemMembroMemoria::novo();
        membros.inserir(
            OrgId("orgA".into()),
            Membro { uid: UserId("u1".into()), nome: "U1".into(), email: "u1@a.com".into(), papel: Papel::OrgAdmin },
        );

        let borda = Borda::nova(armazem, relogio_fixo, nulo(), Arc::new(orgs), Arc::new(membros), sem_dominios(), sem_perfis(), sem_prefs());
        (borda, cookie)
    }

    /// **#1544 ponta a ponta: org suspensa CORTA o acesso, pela borda.** O MESMO admin, na MESMA
    /// rota org-scoped: org ativa ⇒ `200`; org suspensa ⇒ `403 org_suspensa`. Sem a fiação em
    /// `autorizar_acao_admin`, o suspenso também daria `200` (a suspensão decorativa que o @Altair
    /// pegou no #1551 v1) — e um mutante que remova o `if esta_suspensa` faz este teste devolver 200.
    #[tokio::test]
    async fn org_suspensa_corta_acesso_pela_borda() {
        // Ativa: o admin lista os membros ⇒ 200.
        let (ativa, cookie) = borda_admin_org(false);
        let r_ativa = resposta_crua(ativa, &cookie, "/api/v1/orgs/orgA/membros").await;
        assert_eq!(r_ativa.0, StatusCode::OK, "org ativa: o admin lista os membros");

        // Suspensa: MESMO admin, MESMA rota ⇒ 403 com o slug PRÓPRIO no corpo (não `negado`).
        let (suspensa, cookie2) = borda_admin_org(true);
        let r_susp = resposta_crua(suspensa, &cookie2, "/api/v1/orgs/orgA/membros").await;
        assert_eq!(r_susp.0, StatusCode::FORBIDDEN, "org suspensa: acesso CORTADO");
        let corpo = String::from_utf8_lossy(&r_susp.2);
        assert!(corpo.contains("org_suspensa"), "slug org_suspensa no corpo, não negado: {corpo}");
    }

    /// **#1544 — o GÊMEO invertido (pedido do @Altair): a survive-list é GUARDADA, não acidental.**
    /// `/me/orgs` SOBREVIVE à suspensão (⇒ 200, org na lista, `estado: "suspensa"`) — senão o usuário
    /// de org suspensa fica sem a tela que explica e conclui que a CONTA quebrou. Hoje sobrevive por
    /// ESTRUTURA (`listar_minhas_orgs` não chama `autorizar_acao_admin`); este teste DECLARA que deve.
    /// O mutante que "harmoniza" e mete a suspensão no caminho do `/me/orgs` faz SÓ este teste cair.
    #[tokio::test]
    async fn me_orgs_sobrevive_a_suspensao() {
        // MESMA montagem do corta-acesso (orgA suspensa), asserção INVERTIDA: /me/orgs não é cortado.
        let (suspensa, cookie) = borda_admin_org(true);
        let r = resposta_crua(suspensa, &cookie, "/api/v1/me/orgs").await;
        assert_eq!(r.0, StatusCode::OK, "/me/orgs SOBREVIVE à suspensão (a tela precisa alcançá-lo)");
        let corpo = String::from_utf8_lossy(&r.2);
        assert!(corpo.contains("orgA"), "a org suspensa continua na lista: {corpo}");
        assert!(corpo.contains("\"estado\":\"suspensa\""), "com estado marcado pra tela: {corpo}");
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
        let estado = Borda::nova(armazem, relogio_fixo, nulo(), sem_orgs(), sem_membros(), sem_dominios(), sem_perfis(), sem_prefs());

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
        let estado = Borda::nova(armazem, relogio_desliza, nulo(), sem_orgs(), sem_membros(), sem_dominios(), sem_perfis(), sem_prefs());

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
        let estado = Borda::nova(armazem, relogio_depois, nulo(), sem_orgs(), sem_membros(), sem_dominios(), sem_perfis(), sem_prefs());

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
        let estado = Borda::nova(armazem, relogio_fixo, nulo(), sem_orgs(), sem_membros(), sem_dominios(), sem_perfis(), sem_prefs());

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
        let estado = Borda::nova(ar, relogio_fixo, espiao.clone(), sem_orgs(), sem_membros(), sem_dominios(), sem_perfis(), sem_prefs());
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
            (UserId("u1".into()), "back_office.listar_orgs".to_string(), ResultadoAutz::Negado),
            "não-staff → negado auditado, com o ator que tentou (não some)"
        );
    }

    // ---- GET /orgs/{org}/membros (1º handler de DADOS, contrato §4.3) ----

    fn org_teste(id: &str) -> Org {
        Org::nova(OrgId(id.into()), Default::default(), None)
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
            sem_dominios(),
            sem_perfis(),
            sem_prefs(),
        );
        (estado, cookie)
    }

    /// Request com MÉTODO + corpo (as escritas: DELETE/PATCH). Devolve status + corpo.
    async fn requisicao(estado: EstadoBorda, metodo: &str, caminho: &str, cookie: &str, corpo: &str) -> (StatusCode, Vec<u8>) {
        let req = Request::builder()
            .method(metodo)
            .uri(caminho)
            .header(header::COOKIE, cookie)
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(corpo.to_owned()))
            .unwrap();
        let resp = rotas(estado).oneshot(req).await.unwrap();
        let status = resp.status();
        let corpo = resp.into_body().collect().await.unwrap().to_bytes().to_vec();
        (status, corpo)
    }

    fn borda_acme_com_u2(papel_u2: Papel) -> (EstadoBorda, String) {
        borda_membros(
            admin_de("acme"),
            vec![org_teste("acme")],
            vec![
                (OrgId("acme".into()), membro_teste("adm", Papel::OrgAdmin)),
                (OrgId("acme".into()), membro_teste("u2", papel_u2)),
            ],
        )
    }

    // #1505 escrita — DELETE remove o membro (204) e ele SOME da lista.
    #[tokio::test]
    async fn remover_membro_204_e_some_da_lista() {
        let (estado, cookie) = borda_acme_com_u2(Papel::Member);
        let (s, _) = requisicao(estado.clone(), "DELETE", "/api/v1/orgs/acme/membros/u2", &cookie, "").await;
        assert_eq!(s, StatusCode::NO_CONTENT, "removeu ⇒ 204");
        let (s2, corpo) = requisicao(estado, "GET", "/api/v1/orgs/acme/membros", &cookie, "").await;
        assert_eq!(s2, StatusCode::OK);
        assert!(!String::from_utf8_lossy(&corpo).contains("\"u2\""), "u2 saiu da lista: {}", String::from_utf8_lossy(&corpo));
    }

    // DELETE de um uid que NÃO é membro ⇒ 404 (à admin, que pode ver — não é oráculo).
    #[tokio::test]
    async fn remover_nao_membro_e_404() {
        let (estado, cookie) = borda_acme_com_u2(Papel::Member);
        let (s, _) = requisicao(estado, "DELETE", "/api/v1/orgs/acme/membros/fantasma", &cookie, "").await;
        assert_eq!(s, StatusCode::NOT_FOUND);
    }

    // PATCH muda o papel (200 + membro atualizado) e a mudança PERSISTE.
    #[tokio::test]
    async fn mudar_papel_200_e_persiste() {
        let (estado, cookie) = borda_acme_com_u2(Papel::Member);
        let (s, corpo) = requisicao(estado.clone(), "PATCH", "/api/v1/orgs/acme/membros/u2", &cookie, r#"{"papel":"org_admin"}"#).await;
        assert_eq!(s, StatusCode::OK);
        assert!(String::from_utf8_lossy(&corpo).contains("org_admin"), "devolve o membro com papel novo");
        let (_, lista) = requisicao(estado, "GET", "/api/v1/orgs/acme/membros", &cookie, "").await;
        let json: serde_json::Value = serde_json::from_slice(&lista).unwrap();
        let u2 = json.as_array().unwrap().iter().find(|m| m["uid"] == "u2").unwrap();
        assert_eq!(u2["papel"], "org_admin", "a mudança persistiu no store");
    }

    // PATCH de um uid que NÃO é membro ⇒ 404 (Ok(None) do store).
    #[tokio::test]
    async fn mudar_papel_de_nao_membro_e_404() {
        let (estado, cookie) = borda_acme_com_u2(Papel::Member);
        let (s, _) = requisicao(estado, "PATCH", "/api/v1/orgs/acme/membros/fantasma", &cookie, r#"{"papel":"org_admin"}"#).await;
        assert_eq!(s, StatusCode::NOT_FOUND);
    }

    // Papel FORA da allowlist ⇒ 400 (não aceita "staff" nem valor forjado).
    #[tokio::test]
    async fn mudar_papel_fora_da_allowlist_e_400() {
        let (estado, cookie) = borda_acme_com_u2(Papel::Member);
        let (s, _) = requisicao(estado, "PATCH", "/api/v1/orgs/acme/membros/u2", &cookie, r#"{"papel":"staff"}"#).await;
        assert_eq!(s, StatusCode::BAD_REQUEST);
    }

    // Escrita de quem NÃO é admin da org ⇒ 403 (default-deny; o member não administra).
    #[tokio::test]
    async fn escrita_de_nao_admin_e_403() {
        let (estado, cookie) = borda_membros(
            membro_de("acme"), // sessão de MEMBER, não admin
            vec![org_teste("acme")],
            vec![(OrgId("acme".into()), membro_teste("u2", Papel::Member))],
        );
        let (s, _) = requisicao(estado, "DELETE", "/api/v1/orgs/acme/membros/u2", &cookie, "").await;
        assert_eq!(s, StatusCode::FORBIDDEN);
    }

    // Escrita em org SUSPENSA ⇒ 403 org_suspensa (o enforcement #1544 vale nas escritas também,
    // porque passa pelo MESMO `autorizar_acao_admin`).
    #[tokio::test]
    async fn escrita_em_org_suspensa_e_403_org_suspensa() {
        let mut org = org_teste("acme");
        org.suspender();
        let (estado, cookie) = borda_membros(
            admin_de("acme"),
            vec![org],
            vec![(OrgId("acme".into()), membro_teste("u2", Papel::Member))],
        );
        let (s, corpo) = requisicao(estado, "DELETE", "/api/v1/orgs/acme/membros/u2", &cookie, "").await;
        assert_eq!(s, StatusCode::FORBIDDEN);
        assert!(String::from_utf8_lossy(&corpo).contains("org_suspensa"));
    }

    /// Borda com sessão do ADMIN + sessão VIVA do alvo `u2` (member de acme). Devolve as duas cookies.
    fn borda_admin_e_alvo() -> (EstadoBorda, String, String) {
        let mut armazem = ArmazemMemoria::novo();
        let (id_adm, _) = emitir_sessao(&mut armazem, admin_de("acme"), AGORA);
        let cookie_adm = format!("{NOME_COOKIE_SESSAO}={}", id_adm.0);
        let sessao_u2 = galaxie_platform_identity::Sessao::estabelecer(
            Principal::UsuarioFinal { usuario: UserId("u2".into()), org: OrgId("acme".into()) },
            Escopo::de_orgs([OrgId("acme".into())]),
        );
        let (id_u2, _) = emitir_sessao(&mut armazem, sessao_u2, AGORA);
        let cookie_u2 = format!("{NOME_COOKIE_SESSAO}={}", id_u2.0);
        let mut orgs = ArmazemOrgMemoria::novo();
        orgs.inserir(org_teste("acme"));
        let mut membros = ArmazemMembroMemoria::novo();
        membros.inserir(OrgId("acme".into()), membro_teste("adm", Papel::OrgAdmin));
        membros.inserir(OrgId("acme".into()), membro_teste("u2", Papel::Member));
        let estado = Borda::nova(armazem, relogio_fixo, nulo(), Arc::new(orgs), Arc::new(membros), sem_dominios(), sem_perfis(), sem_prefs());
        (estado, cookie_adm, cookie_u2)
    }

    // #1545 — REMOVER revoga a sessão do alvo NA HORA (não em 12h). u2 logado ⇒ /me/orgs 200; admin
    // remove u2 ⇒ /me/orgs de u2 vira 401. Mutante que pule `invalidar_do_usuario` deixa u2 em 200 ⇒ morre.
    #[tokio::test]
    async fn remover_revoga_a_sessao_do_alvo_na_hora() {
        let (estado, cookie_adm, cookie_u2) = borda_admin_e_alvo();
        let (antes, ..) = resposta_crua(estado.clone(), &cookie_u2, "/api/v1/me/orgs").await;
        assert_eq!(antes, StatusCode::OK, "u2 está logado ANTES da remoção");
        let (del, _) = requisicao(estado.clone(), "DELETE", "/api/v1/orgs/acme/membros/u2", &cookie_adm, "").await;
        assert_eq!(del, StatusCode::NO_CONTENT);
        let (depois, ..) = resposta_crua(estado, &cookie_u2, "/api/v1/me/orgs").await;
        assert_eq!(depois, StatusCode::UNAUTHORIZED, "a remoção REVOGOU a sessão do u2 imediatamente");
    }

    // #1545 — MUDAR PAPEL também revoga (força o relogin que carrega o papel novo).
    #[tokio::test]
    async fn mudar_papel_revoga_a_sessao_do_alvo() {
        let (estado, cookie_adm, cookie_u2) = borda_admin_e_alvo();
        let (antes, ..) = resposta_crua(estado.clone(), &cookie_u2, "/api/v1/me/orgs").await;
        assert_eq!(antes, StatusCode::OK);
        let (patch, _) = requisicao(estado.clone(), "PATCH", "/api/v1/orgs/acme/membros/u2", &cookie_adm, r#"{"papel":"org_admin"}"#).await;
        assert_eq!(patch, StatusCode::OK);
        let (depois, ..) = resposta_crua(estado, &cookie_u2, "/api/v1/me/orgs").await;
        assert_eq!(depois, StatusCode::UNAUTHORIZED, "a mudança de papel revogou a sessão do u2");
    }

    // #1545 — remover NÃO-MEMBRO (404) NÃO revoga ninguém (não invalida quem não removeu).
    #[tokio::test]
    async fn remover_nao_membro_nao_revoga() {
        let (estado, cookie_adm, cookie_u2) = borda_admin_e_alvo();
        let (del, _) = requisicao(estado.clone(), "DELETE", "/api/v1/orgs/acme/membros/fantasma", &cookie_adm, "").await;
        assert_eq!(del, StatusCode::NOT_FOUND);
        // u2 (que NÃO foi tocado) segue logado.
        let (u2, ..) = resposta_crua(estado, &cookie_u2, "/api/v1/me/orgs").await;
        assert_eq!(u2, StatusCode::OK, "remover fantasma não derruba u2");
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
            sem_dominios(),
            sem_perfis(),
            sem_prefs(),
        );
        let (status, ..) = resposta_crua(estado, &cookie, "/api/v1/orgs/acme/membros").await;
        assert_eq!(
            status,
            StatusCode::INTERNAL_SERVER_ERROR,
            "store fora do ar em superfície visível é 500 (tratado, não panic)"
        );
    }

    // ---- GET /orgs/{org}/dominios (2º handler de DADOS, contrato §4.3) ----

    /// Borda com sessão + store de orgs + store de dominios semeados (membros vazio).
    fn borda_dominios(
        sessao: galaxie_platform_identity::Sessao,
        orgs: Vec<Org>,
        dominios: Vec<(OrgId, Dominio)>,
    ) -> (EstadoBorda, String) {
        let mut armazem = ArmazemMemoria::novo();
        let (id, _) = emitir_sessao(&mut armazem, sessao, AGORA);
        let cookie = format!("{NOME_COOKIE_SESSAO}={}", id.0);
        let mut org_store = ArmazemOrgMemoria::novo();
        for o in orgs {
            org_store.inserir(o);
        }
        let mut dom_store = ArmazemDominioMemoria::novo();
        for (org, d) in dominios {
            dom_store.inserir(org, d);
        }
        let estado = Borda::nova(
            armazem,
            relogio_fixo,
            nulo(),
            Arc::new(org_store),
            sem_membros(),
            Arc::new(dom_store),
            sem_perfis(),
            sem_prefs(),
        );
        (estado, cookie)
    }

    fn dom(nome: &str, estado: EstadoDominio) -> Dominio {
        Dominio { dominio: nome.into(), estado }
    }

    /// Happy: org_admin → 200 com `[{dominio, estado}]`, estado projetado como o contrato
    /// (`pendente`/`verificado`).
    #[tokio::test]
    async fn dominios_200_com_estado_projetado() {
        let (estado, cookie) = borda_dominios(
            admin_de("acme"),
            vec![org_teste("acme")],
            vec![
                (OrgId("acme".into()), dom("acme.com", EstadoDominio::Verificado)),
                (OrgId("acme".into()), dom("acme.io", EstadoDominio::Pendente)),
            ],
        );
        let (status, _h, corpo) = resposta_crua(estado, &cookie, "/api/v1/orgs/acme/dominios").await;
        assert_eq!(status, StatusCode::OK);
        let json: serde_json::Value = serde_json::from_slice(&corpo).unwrap();
        let arr = json.as_array().unwrap();
        assert_eq!(arr.len(), 2);
        assert_eq!(arr[0]["dominio"], "acme.com");
        assert_eq!(arr[0]["estado"], "verificado", "estado projetado como o contrato");
        assert_eq!(arr[1]["estado"], "pendente");
    }

    /// Org alheia ⇒ 404 (não 403) — mesma ordem 404-antes-de-403 do membros (padrão ratificado).
    #[tokio::test]
    async fn dominios_org_alheia_e_404() {
        let (estado, cookie) = borda_dominios(
            admin_de("acme"),
            vec![org_teste("acme"), org_teste("globex")],
            vec![(OrgId("globex".into()), dom("globex.com", EstadoDominio::Verificado))],
        );
        let (status, ..) = resposta_crua(estado, &cookie, "/api/v1/orgs/globex/dominios").await;
        assert_eq!(status, StatusCode::NOT_FOUND, "org alheia é 404, não 403");
    }

    /// Própria org, member (sem papel org_admin) ⇒ 403.
    #[tokio::test]
    async fn dominios_propria_org_sem_papel_e_403() {
        let (estado, cookie) = borda_dominios(
            membro_de("acme"),
            vec![org_teste("acme")],
            vec![(OrgId("acme".into()), dom("acme.com", EstadoDominio::Verificado))],
        );
        let (status, ..) = resposta_crua(estado, &cookie, "/api/v1/orgs/acme/dominios").await;
        assert_eq!(status, StatusCode::FORBIDDEN);
    }

    // ---- GET /me/orgs (achado do @Pollux: a UI descobre o {org} por aqui) ----

    /// Happy: o principal (uid da sessão) recebe SUAS orgs com o papel em cada — `[{org,papel}]`.
    /// O uid vem da SESSÃO, não do caminho: não há como pedir as orgs de outro (invariante 6).
    #[tokio::test]
    async fn me_orgs_200_com_as_orgs_do_principal() {
        // admin_de("acme") tem usuario "adm"; semeio o pertencimento dele em acme (admin) e globex.
        let (estado, cookie) = borda_membros(
            admin_de("acme"),
            vec![org_teste("acme"), org_teste("globex")],
            vec![
                (OrgId("acme".into()), {
                    let mut m = membro_teste("x", Papel::Member);
                    m.uid = UserId("adm".into());
                    m.papel = Papel::OrgAdmin;
                    m
                }),
                (OrgId("globex".into()), {
                    let mut m = membro_teste("y", Papel::Member);
                    m.uid = UserId("adm".into());
                    m
                }),
                // membro de outro user — NÃO pode vazar pro /me/orgs do adm.
                (OrgId("acme".into()), membro_teste("outro", Papel::Member)),
            ],
        );
        let (status, _h, corpo) = resposta_crua(estado, &cookie, "/api/v1/me/orgs").await;
        assert_eq!(status, StatusCode::OK);
        let json: serde_json::Value = serde_json::from_slice(&corpo).unwrap();
        let arr = json.as_array().unwrap();
        assert_eq!(arr.len(), 2, "só as 2 orgs do adm, não a do outro user");
        assert_eq!(arr[0]["org"], "acme");
        assert_eq!(arr[0]["papel"], "org_admin");
        assert_eq!(arr[1]["org"], "globex");
        assert_eq!(arr[1]["papel"], "member");
    }

    /// Principal sem pertencimento ⇒ 200 `[]` (não erro) — sessão válida, zero orgs.
    #[tokio::test]
    async fn me_orgs_sem_pertencimento_e_200_vazio() {
        let (estado, cookie) = borda_membros(admin_de("acme"), vec![], vec![]);
        let (status, _h, corpo) = resposta_crua(estado, &cookie, "/api/v1/me/orgs").await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(&corpo, b"[]");
    }

    /// Sem sessão ⇒ 401 (superfície visível user-scoped: dizer "autentique-se" não revela nada).
    #[tokio::test]
    async fn me_orgs_sem_sessao_e_401() {
        let (estado, _cookie) = borda_membros(admin_de("acme"), vec![], vec![]);
        let (status, ..) = resposta_crua(estado, "", "/api/v1/me/orgs").await;
        assert_eq!(status, StatusCode::UNAUTHORIZED);
    }
}
