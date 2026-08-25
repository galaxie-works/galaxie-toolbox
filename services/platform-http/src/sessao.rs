//! Extractor de sessão da borda — a **condição 6 do @Altair** aterrissando: o principal (quem é
//! o solicitante e o que ele alcança) vem SEMPRE da sessão viva no servidor, NUNCA do caminho, do
//! payload ou de um header que o cliente controle. A borda transforma "um cookie" em "uma `Sessao`"
//! aqui, num lugar só; um handler que queira o solicitante pede [`SessaoAtual`] e recebe o que o
//! servidor resolveu — não tem como um handler ler identidade de outra fonte.

use std::sync::{Arc, Mutex};

use axum::extract::FromRequestParts;
use axum::http::header;
use axum::http::request::Parts;
use axum::response::Response;

use galaxie_platform_back_office::Auditor;
use galaxie_platform_identity::armazem::{ArmazemMembro, ArmazemOrg};
use galaxie_platform_identity::sessao::ArmazemMemoria;
use galaxie_platform_identity::Sessao;
use galaxie_platform_web::contrato::CodigoErro;
use galaxie_platform_web::tocar_sessao_do_cookie;

use crate::erro::resposta_de_erro;

/// Estado compartilhado da borda.
///
/// O armazém fica atrás de um `Mutex` porque TODO request autenticado é o caminho de ATIVIDADE
/// (`tocar`, #1512): ele desliza a janela de ociosidade, e `tocar` precisa de `&mut`. O `Mutex`
/// existe exatamente pra isso. O **relógio é injetável** (`agora`) porque a expiração (#1504
/// absoluto / #1512 ocioso) é time-aware: os testes controlam o tempo em vez de dormir, e a prod
/// passa `SystemTime`.
///
/// O **`auditor` é OBRIGATÓRIO** (não `Option`, nem default no-op): a cond. 4 (@Altair) exige que
/// a autz de back-office emita sempre, e um default silencioso deixaria a prod esquecer — o mesmo
/// furo do "handler esquece", movido pra montagem. `Arc<dyn …>` pra o axum compartilhar entre
/// threads e os testes inspecionarem o mesmo sink por um clone.
pub struct Borda {
    pub armazem: Mutex<ArmazemMemoria>,
    pub agora: fn() -> u64,
    pub auditor: Arc<dyn Auditor + Send + Sync>,
    /// Armazéns de domínio (persistência #1505 (a)) — a borda os CONSOME, não os define. `Arc<dyn>`
    /// pra o axum compartilhar e a impl (memória agora, Postgres depois) trocar sem tocar a borda.
    pub orgs: Arc<dyn ArmazemOrg + Send + Sync>,
    pub membros: Arc<dyn ArmazemMembro + Send + Sync>,
}

impl Borda {
    /// Constrói o estado: armazém de sessão + relógio + auditor + os armazéns de domínio. Envolve
    /// em `Arc` para o axum clonar barato entre handlers.
    pub fn nova(
        armazem: ArmazemMemoria,
        agora: fn() -> u64,
        auditor: Arc<dyn Auditor + Send + Sync>,
        orgs: Arc<dyn ArmazemOrg + Send + Sync>,
        membros: Arc<dyn ArmazemMembro + Send + Sync>,
    ) -> Arc<Self> {
        Arc::new(Borda {
            armazem: Mutex::new(armazem),
            agora,
            auditor,
            orgs,
            membros,
        })
    }
}

/// O tipo de estado que o `Router` carrega.
pub type EstadoBorda = Arc<Borda>;

/// Resolve a sessão viva do request e **DESLIZA a janela de ociosidade** (`tocar`, #1512),
/// COMPARTILHADO pelos dois extractors. A diferença entre eles é SÓ a resposta de rejeição.
///
/// **#1512 (defeito achado pelo @Altair — "teste não é consumidor"):** este extractor É o
/// consumidor de `tocar_sessao_do_cookie`. Antes chamava `sessao_do_cookie` (read-only, só
/// `validar`), e como NENHUM caminho de produção deslizava, o `IDLE_TTL_SEG` virava um 2º teto
/// absoluto — todo mundo deslogado aos 30 min, trabalhando ou não. Agora todo request autenticado
/// desliza o ocioso pra `agora + IDLE_TTL_SEG` (capado no absoluto pelo armazém): a atividade
/// mantém a sessão viva; só a INATIVIDADE a mata. O teto absoluto (#1504) segue inviolável.
fn resolver_sessao(parts: &Parts, estado: &EstadoBorda) -> Option<Sessao> {
    // Header ausente ou não-UTF8 vira string vazia ⇒ `tocar_sessao_do_cookie` devolve `None`.
    let header_cookie = parts
        .headers
        .get(header::COOKIE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    let agora = (estado.agora)();
    let mut armazem = estado
        .armazem
        .lock()
        .expect("armazém de sessão não deve estar envenenado");
    // Clona pra soltar o lock/borrow do armazém antes de o handler rodar.
    tocar_sessao_do_cookie(&mut *armazem, header_cookie, agora).cloned()
}

/// A sessão VIVA do request, extraída do cookie `__Host-gx_sess` e validada no armazém do
/// SERVIDOR (invariante 6). Um handler que peça `SessaoAtual` só roda se a sessão existir e
/// estiver viva; ele nunca vê "quem o cliente diz ser".
///
/// Sem cookie de sessão, cookie duplicado (semântica exatamente-um do #1501) ou sessão
/// revogada/expirada ⇒ **401 uniforme** (`NaoAutenticado`) — a rejeição NÃO distingue "não mandou"
/// de "expirou" de "revogada", senão viraria um oráculo do estado da sessão alheia.
///
/// **Use este em superfícies cuja EXISTÊNCIA não é segredo** (`/me`, `/orgs/{org}/...`): dizer
/// "autentique-se" (401) não revela nada que o cliente já não saiba. Para o back-office, cuja
/// existência É o segredo, use [`SessaoOculta`].
pub struct SessaoAtual(pub Sessao);

impl FromRequestParts<EstadoBorda> for SessaoAtual {
    type Rejection = Response;

    async fn from_request_parts(
        parts: &mut Parts,
        estado: &EstadoBorda,
    ) -> Result<Self, Self::Rejection> {
        match resolver_sessao(parts, estado) {
            Some(sessao) => Ok(SessaoAtual(sessao)),
            None => Err(resposta_de_erro(CodigoErro::NaoAutenticado)),
        }
    }
}

/// Como [`SessaoAtual`], mas para superfícies **OCULTAS** (`/admin/*`, back-office): sem sessão
/// devolve **404**, NÃO 401. Achado do @Altair na fatia 2: um 401 já revela que a rota existe, e
/// no back-office a EXISTÊNCIA é o segredo (invariante 1). O 404 do não-staff autenticado sem o
/// 404 do NÃO-autenticado é "fechar a porta e deixar a janela" — um atacante sem sessão ainda
/// descobriria o back-office. Aqui o não-autenticado cai no MESMO 404 de uma rota inexistente.
///
/// **A autenticação é o que este extractor decide; a AUTORIZAÇÃO (é staff?) segue no handler** via
/// `autorizar_back_office` (invariante 5: toda autz passa pela função de autorização, não por um
/// `eh_staff` solto aqui). Non-staff autenticado ⇒ 404 no handler; sem sessão ⇒ 404 aqui. Custo
/// nomeado (aceito): um staff com sessão expirada recebe 404 e não sabe que era só relogar.
pub struct SessaoOculta(pub Sessao);

impl FromRequestParts<EstadoBorda> for SessaoOculta {
    type Rejection = Response;

    async fn from_request_parts(
        parts: &mut Parts,
        estado: &EstadoBorda,
    ) -> Result<Self, Self::Rejection> {
        match resolver_sessao(parts, estado) {
            Some(sessao) => Ok(SessaoOculta(sessao)),
            // 404 (não 401): a existência do back-office não vaza nem pro não-autenticado.
            None => Err(resposta_de_erro(CodigoErro::NaoEncontrado)),
        }
    }
}
