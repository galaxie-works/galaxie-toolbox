//! Contrato HTTP da configuração do Remote — #1683 (desbloqueia o painel #1472).
//!
//! ⚠️ **Guarda, não aplica.** Estas rotas gravam e leem a configuração; nada a leva às sessões
//! Remote. Quem aplica é a ponte #1729. O painel do #1472 mostra "salvo, ainda não aplicado".
//!
//! Três superfícies, três donos (desenho do @Altair — o perigo aponta em direções OPOSTAS):
//!
//! | rota | dono | autz |
//! |---|---|---|
//! | `GET/PUT /api/v1/orgs/{org}/remoto/politica` | a ORG | `org_admin` (`DefinirPoliticaDeSessao`) |
//! | `GET/POST /api/v1/orgs/{org}/remoto/concessoes`, `DELETE …/{id}` | a ORG | `org_admin` (`GerirAcessoRemotoDaOrg`) |
//! | `GET /api/v1/me/remoto/dispositivos`, `PUT/DELETE …/{device_id}` | o UTILIZADOR | `ConfigurarProprioDispositivo` |
//!
//! - As rotas da org passam pelo MESMO funil das outras ações de admin (`autz_base_mutacao`):
//!   visibilidade → suspensão → papel, auditado nos dois ramos. **404 antes de 403**; org suspensa ⇒
//!   403 `org_suspensa`, **menos a revogação**, que atravessa a suspensão (regra 3 do Altair).
//! - A autz corre **ANTES** de ler o corpo: quem não pode não consegue sondar a validação.
//! - O **sujeito** de uma concessão confere-se na escrita (tem de ser membro da org, senão 404). O
//!   **objeto** (device) é um id opaco: a plataforma não sabe se existe nem de quem é (a conferência é
//!   da ponte — decisão do Altair, comment 6137098546).
//! - `/me` não passa pela autz de org: é do utilizador, sobrevive à suspensão (survive-list #1544).
//! - O vocabulário das capacidades é o `remote_capabilities::Capabilities` TAL COMO É (5 campos,
//!   camelCase, `deny_unknown_fields`) — o canário do AC6 no fio.

use std::sync::Arc;

use axum::body::{Body, Bytes};
use axum::extract::{Path, State};
use axum::http::{header, StatusCode};
use axum::response::Response;
use galaxie_platform_identity::armazem::ErroArmazem;
use galaxie_platform_identity::{autorizar, Decisao, Operacao, OrgId};
use galaxie_platform_org_admin::AcaoAdminOrg;
use galaxie_platform_remoto::{
    ArmazemConcessoesRemotas, ArmazemPoliticaRemota, ArmazemRestricoesDispositivo, Capabilities,
    ConcessaoDeAcesso, ConcessaoId, ConcessoesRemotasMemoria, DeviceId, ErroRemoto, ModoAprovacao,
    NovaConcessao, ObjetoRemoto, PoliticaRemotaMemoria, PoliticaSessaoRemota, RestricaoDispositivo,
    RestricoesDispositivoMemoria, SujeitoRemoto,
};
use galaxie_platform_web::contrato::CodigoErro;

use crate::erro::{resposta_de_erro, resposta_de_falha, Visibilidade};
use crate::router::autz_base_mutacao;
use crate::sessao::{EstadoBorda, SessaoAtual};

/// Os três armazéns da config do Remote, na `Borda`.
pub struct ArmazensRemoto {
    pub politicas: Arc<dyn ArmazemPoliticaRemota + Send + Sync>,
    pub concessoes: Arc<dyn ArmazemConcessoesRemotas + Send + Sync>,
    pub restricoes: Arc<dyn ArmazemRestricoesDispositivo + Send + Sync>,
}

impl ArmazensRemoto {
    /// Os três em memória e vazios (como os outros armazéns da plataforma hoje).
    #[must_use]
    pub fn memoria() -> Self {
        ArmazensRemoto {
            politicas: Arc::new(PoliticaRemotaMemoria::default()),
            concessoes: Arc::new(ConcessoesRemotasMemoria::default()),
            restricoes: Arc::new(RestricoesDispositivoMemoria::default()),
        }
    }
}

// ---------------------------------------------------------------------------------------------------
// DTOs (o contrato no fio). Os tipos de domínio ficam serde-free; o mapeamento vive aqui.
// ---------------------------------------------------------------------------------------------------

/// `modo_aprovacao` no fio — strings ESTÁVEIS, mapeadas à mão (o valor de contrato não pode mudar se
/// alguém renomear a variante Rust).
#[derive(serde::Serialize, serde::Deserialize, Clone, Copy)]
#[serde(rename_all = "snake_case")]
enum ModoAprovacaoDto {
    Clique,
    Senha,
    SenhaOuClique,
}

impl From<ModoAprovacao> for ModoAprovacaoDto {
    fn from(m: ModoAprovacao) -> Self {
        match m {
            ModoAprovacao::Clique => ModoAprovacaoDto::Clique,
            ModoAprovacao::Senha => ModoAprovacaoDto::Senha,
            ModoAprovacao::SenhaOuClique => ModoAprovacaoDto::SenhaOuClique,
        }
    }
}

impl From<ModoAprovacaoDto> for ModoAprovacao {
    fn from(m: ModoAprovacaoDto) -> Self {
        match m {
            ModoAprovacaoDto::Clique => ModoAprovacao::Clique,
            ModoAprovacaoDto::Senha => ModoAprovacao::Senha,
            ModoAprovacaoDto::SenhaOuClique => ModoAprovacao::SenhaOuClique,
        }
    }
}

/// O teto da org (GET e PUT usam a mesma forma; o PUT é a substituição INTEIRA — sem campos
/// opcionais, para um PUT parcial não apagar uma restrição em silêncio).
#[derive(serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct PoliticaDto {
    capacidades_maximas: Capabilities,
    modo_aprovacao: ModoAprovacaoDto,
    permitir_nao_supervisionado: bool,
}

impl From<PoliticaSessaoRemota> for PoliticaDto {
    fn from(p: PoliticaSessaoRemota) -> Self {
        PoliticaDto {
            capacidades_maximas: p.capacidades_maximas,
            modo_aprovacao: p.modo_aprovacao.into(),
            permitir_nao_supervisionado: p.permitir_nao_supervisionado,
        }
    }
}

/// Quem recebe — etiquetado por `tipo`, para os grupos (D2) entrarem como variante nova sem partir o
/// contrato.
#[derive(serde::Serialize, serde::Deserialize)]
#[serde(tag = "tipo", rename_all = "snake_case", deny_unknown_fields)]
enum SujeitoDto {
    Utilizador { uid: String },
}

/// Sobre o quê — idem.
#[derive(serde::Serialize, serde::Deserialize)]
#[serde(tag = "tipo", rename_all = "snake_case", deny_unknown_fields)]
enum ObjetoDto {
    Dispositivo { id: String },
}

/// Uma concessão no fio.
#[derive(serde::Serialize)]
struct ConcessaoDto {
    id: String,
    sujeito: SujeitoDto,
    objeto: ObjetoDto,
    capacidades: Capabilities,
    concedida_por: String,
    concedida_em: u64,
    revogada_em: Option<u64>,
    ativa: bool,
}

impl From<&ConcessaoDeAcesso> for ConcessaoDto {
    fn from(c: &ConcessaoDeAcesso) -> Self {
        ConcessaoDto {
            id: c.id.0.clone(),
            sujeito: match &c.sujeito {
                SujeitoRemoto::Utilizador(u) => SujeitoDto::Utilizador { uid: u.0.clone() },
            },
            objeto: match &c.objeto {
                ObjetoRemoto::Dispositivo(d) => ObjetoDto::Dispositivo { id: d.como_str().to_string() },
            },
            capacidades: c.capacidades,
            concedida_por: c.concedida_por.0.clone(),
            concedida_em: c.concedida_em,
            revogada_em: c.revogada_em,
            ativa: c.ativa(),
        }
    }
}

/// O corpo do `POST …/concessoes`.
#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct NovaConcessaoDto {
    sujeito: SujeitoDto,
    objeto: ObjetoDto,
    capacidades: Capabilities,
}

/// A restrição do device no fio (`/me`).
#[derive(serde::Serialize)]
struct RestricaoDto {
    dispositivo_id: String,
    capacidades: Capabilities,
}

impl From<&RestricaoDispositivo> for RestricaoDto {
    fn from(r: &RestricaoDispositivo) -> Self {
        RestricaoDto { dispositivo_id: r.dispositivo.como_str().to_string(), capacidades: r.capacidades }
    }
}

/// O corpo do `PUT /me/remoto/dispositivos/{device_id}`.
#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct RestricaoEntradaDto {
    capacidades: Capabilities,
}

// ---------------------------------------------------------------------------------------------------
// Utilitários
// ---------------------------------------------------------------------------------------------------

fn json<T: serde::Serialize>(status: StatusCode, valor: &T) -> Response {
    let corpo = serde_json::to_string(valor).expect("DTO do contrato serializa sempre");
    Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(corpo))
        .expect("resposta JSON é sempre construível")
}

fn sem_conteudo() -> Response {
    Response::builder()
        .status(StatusCode::NO_CONTENT)
        .body(Body::empty())
        .expect("resposta 204 é sempre construível")
}

/// Falha de armazém → HTTP. As rotas daqui são VISÍVEIS (o chamador já passou a autz), logo infra ⇒
/// 500; o teto atingido ⇒ 409.
fn erro_remoto(e: ErroRemoto) -> Response {
    match e {
        ErroRemoto::Indisponivel => resposta_de_falha(Visibilidade::Visivel),
        ErroRemoto::LimiteAtingido => resposta_de_erro(CodigoErro::Conflito),
    }
}

// ---------------------------------------------------------------------------------------------------
// Org: teto (session-policy)
// ---------------------------------------------------------------------------------------------------

/// `GET /api/v1/orgs/{org}/remoto/politica` — o teto da org (o default, se nunca foi gravado).
pub(crate) async fn ver_politica(
    State(estado): State<EstadoBorda>,
    SessaoAtual(sessao): SessaoAtual,
    Path(org): Path<String>,
) -> Response {
    let org = OrgId(org);
    if let Err(r) = autz_base_mutacao(&estado, &sessao, &AcaoAdminOrg::VerPoliticaRemota, &org).await {
        return r;
    }
    match estado.remoto.politicas.obter(&org) {
        Ok(p) => json(StatusCode::OK, &PoliticaDto::from(p)),
        Err(e) => erro_remoto(e),
    }
}

/// `PUT /api/v1/orgs/{org}/remoto/politica` — substitui o teto INTEIRO. Autz ANTES do corpo.
pub(crate) async fn definir_politica(
    State(estado): State<EstadoBorda>,
    SessaoAtual(sessao): SessaoAtual,
    Path(org): Path<String>,
    corpo: Bytes,
) -> Response {
    let org = OrgId(org);
    if let Err(r) = autz_base_mutacao(&estado, &sessao, &AcaoAdminOrg::DefinirPoliticaRemota, &org).await {
        return r;
    }
    let Ok(dto) = serde_json::from_slice::<PoliticaDto>(&corpo) else {
        return resposta_de_erro(CodigoErro::PayloadInvalido);
    };
    let politica = PoliticaSessaoRemota {
        capacidades_maximas: dto.capacidades_maximas,
        modo_aprovacao: dto.modo_aprovacao.into(),
        permitir_nao_supervisionado: dto.permitir_nao_supervisionado,
    };
    match estado.remoto.politicas.definir(&org, politica) {
        Ok(()) => json(StatusCode::OK, &PoliticaDto::from(politica)),
        Err(e) => erro_remoto(e),
    }
}

// ---------------------------------------------------------------------------------------------------
// Org: concessões
// ---------------------------------------------------------------------------------------------------

/// `GET /api/v1/orgs/{org}/remoto/concessoes` — ativas E revogadas (o rasto fica visível ao admin).
pub(crate) async fn listar_concessoes(
    State(estado): State<EstadoBorda>,
    SessaoAtual(sessao): SessaoAtual,
    Path(org): Path<String>,
) -> Response {
    let org = OrgId(org);
    if let Err(r) = autz_base_mutacao(&estado, &sessao, &AcaoAdminOrg::ListarConcessoesRemotas, &org).await {
        return r;
    }
    match estado.remoto.concessoes.listar(&org) {
        Ok(lista) => json(StatusCode::OK, &lista.iter().map(ConcessaoDto::from).collect::<Vec<_>>()),
        Err(e) => erro_remoto(e),
    }
}

/// `POST /api/v1/orgs/{org}/remoto/concessoes` — cria uma concessão. Ordem: autz → corpo → `DeviceId`
/// → o SUJEITO tem de ser membro da org (senão 404: não confirma que o utilizador existe noutro sítio)
/// → grava (teto ⇒ 409).
pub(crate) async fn conceder(
    State(estado): State<EstadoBorda>,
    SessaoAtual(sessao): SessaoAtual,
    Path(org): Path<String>,
    corpo: Bytes,
) -> Response {
    let org = OrgId(org);
    if let Err(r) = autz_base_mutacao(&estado, &sessao, &AcaoAdminOrg::ConcederAcessoRemoto, &org).await {
        return r;
    }
    let Ok(dto) = serde_json::from_slice::<NovaConcessaoDto>(&corpo) else {
        return resposta_de_erro(CodigoErro::PayloadInvalido);
    };
    let ObjetoDto::Dispositivo { id } = dto.objeto;
    let Ok(dispositivo) = DeviceId::novo(&id) else {
        return resposta_de_erro(CodigoErro::PayloadInvalido);
    };
    let SujeitoDto::Utilizador { uid } = dto.sujeito;
    // O sujeito confere-se NA ESCRITA (regra do Altair): tem de ser membro DESTA org.
    let e_membro = match estado.membros.listar(&org) {
        Err(ErroArmazem::Indisponivel) => return resposta_de_falha(Visibilidade::Visivel),
        Ok(membros) => membros.iter().any(|m| m.uid.0 == uid),
    };
    if !e_membro {
        return resposta_de_erro(CodigoErro::NaoEncontrado);
    }
    let nova = NovaConcessao {
        sujeito: SujeitoRemoto::Utilizador(galaxie_platform_identity::UserId(uid)),
        objeto: ObjetoRemoto::Dispositivo(dispositivo),
        capacidades: dto.capacidades,
        concedida_por: sessao.principal().usuario().clone(),
        concedida_em: (estado.agora)(),
    };
    match estado.remoto.concessoes.conceder(&org, nova) {
        Ok(c) => json(StatusCode::CREATED, &ConcessaoDto::from(&c)),
        Err(e) => erro_remoto(e),
    }
}

/// `DELETE /api/v1/orgs/{org}/remoto/concessoes/{id}` — revoga. **Atravessa a suspensão** (o funil da
/// autz trata disso). Concessão de outra org ⇒ 404. Revogar outra vez ⇒ 204 (idempotente).
pub(crate) async fn revogar(
    State(estado): State<EstadoBorda>,
    SessaoAtual(sessao): SessaoAtual,
    Path((org, id)): Path<(String, String)>,
) -> Response {
    let org = OrgId(org);
    if let Err(r) = autz_base_mutacao(&estado, &sessao, &AcaoAdminOrg::RevogarAcessoRemoto, &org).await {
        return r;
    }
    match estado.remoto.concessoes.revogar(&org, &ConcessaoId(id), (estado.agora)()) {
        Ok(Some(_)) => sem_conteudo(),
        Ok(None) => resposta_de_erro(CodigoErro::NaoEncontrado),
        Err(e) => erro_remoto(e),
    }
}

// ---------------------------------------------------------------------------------------------------
// /me: restrição do próprio device
// ---------------------------------------------------------------------------------------------------

/// A autz do `/me` (`negado_me`): `ConfigurarProprioDispositivo` — qualquer principal autenticado sobre o SEU device
/// (não deriva de `org()`, para o `SemVinculo` não o perder). O dono é SEMPRE o da sessão, nunca um id
/// do pedido. Chamada mesmo sendo hoje sempre `Permitido`: se a política mudar, a rota segue-a.
/// Devolve a resposta de negação, se houver (`Option`, não `Result<(), Response>`: o `Err` seria grande).
fn negado_me(sessao: &galaxie_platform_identity::Sessao) -> Option<Response> {
    match autorizar(sessao, &Operacao::ConfigurarProprioDispositivo) {
        Decisao::Permitido => None,
        Decisao::Negado => Some(resposta_de_erro(CodigoErro::Negado)),
    }
}

/// `GET /api/v1/me/remoto/dispositivos` — as restrições que o utilizador pôs nos SEUS devices.
pub(crate) async fn minhas_restricoes(
    State(estado): State<EstadoBorda>,
    SessaoAtual(sessao): SessaoAtual,
) -> Response {
    if let Some(r) = negado_me(&sessao) {
        return r;
    }
    match estado.remoto.restricoes.do_dono(sessao.principal().usuario()) {
        Ok(lista) => json(StatusCode::OK, &lista.iter().map(RestricaoDto::from).collect::<Vec<_>>()),
        Err(e) => erro_remoto(e),
    }
}

/// `PUT /api/v1/me/remoto/dispositivos/{device_id}` — grava a restrição do utilizador para esse device.
/// Só restringe (entra por interseção); a chave é (dono da sessão, device).
pub(crate) async fn definir_restricao(
    State(estado): State<EstadoBorda>,
    SessaoAtual(sessao): SessaoAtual,
    Path(device_id): Path<String>,
    corpo: Bytes,
) -> Response {
    if let Some(r) = negado_me(&sessao) {
        return r;
    }
    let Ok(dispositivo) = DeviceId::novo(&device_id) else {
        return resposta_de_erro(CodigoErro::PayloadInvalido);
    };
    let Ok(dto) = serde_json::from_slice::<RestricaoEntradaDto>(&corpo) else {
        return resposta_de_erro(CodigoErro::PayloadInvalido);
    };
    match estado.remoto.restricoes.definir(sessao.principal().usuario(), dispositivo, dto.capacidades) {
        Ok(r) => json(StatusCode::OK, &RestricaoDto::from(&r)),
        Err(e) => erro_remoto(e),
    }
}

/// `DELETE /api/v1/me/remoto/dispositivos/{device_id}` — tira a restrição (o device volta ao neutro).
/// Não havia ⇒ 404 (é o espaço do próprio utilizador: não é oráculo de nada alheio).
pub(crate) async fn remover_restricao(
    State(estado): State<EstadoBorda>,
    SessaoAtual(sessao): SessaoAtual,
    Path(device_id): Path<String>,
) -> Response {
    if let Some(r) = negado_me(&sessao) {
        return r;
    }
    let Ok(dispositivo) = DeviceId::novo(&device_id) else {
        return resposta_de_erro(CodigoErro::PayloadInvalido);
    };
    match estado.remoto.restricoes.remover(sessao.principal().usuario(), &dispositivo) {
        Ok(true) => sem_conteudo(),
        Ok(false) => resposta_de_erro(CodigoErro::NaoEncontrado),
        Err(e) => erro_remoto(e),
    }
}
