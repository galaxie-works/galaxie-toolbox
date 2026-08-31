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

use galaxie_platform_identity::auditoria::Auditor;
use galaxie_platform_conta::ArmazemPerfil;
use galaxie_platform_config::{ArmazemPref, RegistroFormas};
use galaxie_platform_identity::armazem::{ArmazemDominio, ArmazemMembro, ArmazemOrg};
use galaxie_platform_identity::sessao::ArmazemMemoria;
use galaxie_platform_identity::Sessao;
use galaxie_platform_web::contrato::CodigoErro;
use galaxie_platform_web::tocar_sessao_do_cookie;

use galaxie_platform_oauth::{ArmazemEstadoOAuth, Provedor, RedirectAllowlist};

use crate::erro::resposta_de_erro;

/// Config de UM provedor federado ligado (fatia B do #1695). O `client_id` é PÚBLICO (Actions
/// variable), entra por config — não hardcode. O `redirect_uri` é o NOSSO callback, conferido
/// byte-a-byte na allowlist. ⚠️ **O `client_secret` NÃO mora aqui** — só entra na troca do `code`
/// (fatia C), server-side, lido do cofre (fatia 5). Um provedor SEM entrada aqui é indistinguível de
/// slug desconhecido (falha uniforme — invariante 6).
pub struct ConfigProvedor {
    pub client_id: String,
    pub redirect_uri: String,
}

/// Estado do fluxo OAuth injetado na borda: o armazém dos fluxos EM CURSO (atrás de `Mutex` como o de
/// sessão — `iniciar`/`consumir` pedem `&mut`), a config por provedor (só os LIGADOS), a allowlist
/// EXATA de redirects (derivada dos redirects configurados, nunca desalinhada deles) e o prazo CURTO
/// do fluxo.
///
/// Na [`Borda`] é `Option`: **produção sem OAuth configurado ⇒ `/auth/{provedor}` é 404 pra todo
/// provedor** (a rota "não existe" pra quem não a ligou — o binário serve o que EXISTE, como os stores
/// vazios da fatia 1). O `dev-server` injeta `Some`; a prod real liga na fatia 5 (secret do cofre).
pub struct EstadoOAuth {
    armazem: Mutex<Box<dyn ArmazemEstadoOAuth + Send + Sync>>,
    microsoft: Option<ConfigProvedor>,
    microsoft_personal: Option<ConfigProvedor>,
    google: Option<ConfigProvedor>,
    allowlist: RedirectAllowlist,
    ttl_fluxo_seg: u64,
}

impl EstadoOAuth {
    /// Monta o estado a partir dos provedores LIGADOS. A allowlist nasce dos `redirect_uri`
    /// configurados — não há como listar um redirect que não seja o de um provedor ligado (a
    /// invariante fica no construtor, não na disciplina de quem chama).
    pub fn nova(
        armazem: Box<dyn ArmazemEstadoOAuth + Send + Sync>,
        provedores: Vec<(Provedor, ConfigProvedor)>,
        ttl_fluxo_seg: u64,
    ) -> Self {
        let allowlist =
            RedirectAllowlist::nova(provedores.iter().map(|(_, c)| c.redirect_uri.clone()).collect());
        let (mut microsoft, mut microsoft_personal, mut google) = (None, None, None);
        for (p, c) in provedores {
            match p {
                Provedor::Microsoft => microsoft = Some(c),
                Provedor::MicrosoftPersonal => microsoft_personal = Some(c),
                Provedor::Google => google = Some(c),
            }
        }
        EstadoOAuth {
            armazem: Mutex::new(armazem),
            microsoft,
            microsoft_personal,
            google,
            allowlist,
            ttl_fluxo_seg,
        }
    }

    /// A config do provedor, se ele estiver LIGADO. `None` ⇒ o handler devolve o 404 uniforme (não
    /// revela se o slug é desconhecido ou só não-configurado). `match` EXAUSTIVO: provedor novo OBRIGA
    /// a mapear o seu campo — não herda um default.
    pub fn config_de(&self, provedor: Provedor) -> Option<&ConfigProvedor> {
        match provedor {
            Provedor::Microsoft => self.microsoft.as_ref(),
            Provedor::MicrosoftPersonal => self.microsoft_personal.as_ref(),
            Provedor::Google => self.google.as_ref(),
        }
    }

    /// A allowlist EXATA de redirects (leitura pro handler passar ao `iniciar_fluxo`).
    pub fn allowlist(&self) -> &RedirectAllowlist {
        &self.allowlist
    }

    /// O prazo curto do fluxo (segundos) — vale pro `expira_unix` do fluxo E pro `Max-Age` do cookie.
    pub fn ttl_fluxo_seg(&self) -> u64 {
        self.ttl_fluxo_seg
    }

    /// Grava um fluxo pendente sob o seu `state` (chamado por `/auth`). Encapsula o `lock` — o handler
    /// não toca no `Mutex`. `Err` = armazém indisponível (a borda vira falha de infra, distinta do 404).
    pub fn iniciar(
        &self,
        state: galaxie_platform_oauth::Estado,
        fluxo: galaxie_platform_oauth::FluxoPendente,
    ) -> Result<(), galaxie_platform_oauth::ErroArmazem> {
        self.armazem
            .lock()
            .expect("armazém OAuth não deve estar envenenado")
            .iniciar(state, fluxo)
    }

    /// Consome o `state` (chamado pelo callback, fatia C): uso único atômico + prazo + amarra. Exposto
    /// já aqui para o callback não tocar no `Mutex`; a fatia B não o usa (só `iniciar`).
    pub fn consumir(
        &self,
        state: &galaxie_platform_oauth::Estado,
        amarra: &galaxie_platform_oauth::AmarraNavegador,
        agora_unix: u64,
    ) -> Result<Option<galaxie_platform_oauth::FluxoPendente>, galaxie_platform_oauth::ErroArmazem> {
        self.armazem
            .lock()
            .expect("armazém OAuth não deve estar envenenado")
            .consumir(state, amarra, agora_unix)
    }
}

/// Nome do cookie de AMARRA do fluxo OAuth (#1695 fatia B). `__Host-` pela MESMA imposição do
/// navegador que o de sessão (só aceito se `Secure` + `Path=/` + sem `Domain`): um subdomínio não
/// planta uma amarra que sombreie a nossa. Curto e específico do fluxo.
pub const NOME_COOKIE_AMARRA_OAUTH: &str = "__Host-gx_oauth";

/// Valor do `Set-Cookie` da amarra: `HttpOnly` (o callback lê server-side; script nunca precisa) +
/// `Secure` + `SameSite=Lax` + `Path=/` + `Max-Age` = o prazo do fluxo (some sozinho quando vence).
///
/// 🔑 **`Lax`, NÃO `Strict`:** o callback volta por uma NAVEGAÇÃO top-level vinda do provedor
/// (cross-site) — e só `Lax` manda o cookie numa navegação top-level cross-site. `Strict` mataria a
/// amarra exatamente no retorno e o fluxo nunca fecharia. Mesma política do cookie de sessão.
pub fn montar_cookie_amarra_oauth(amarra: &str, max_age_seg: u64) -> String {
    format!("{NOME_COOKIE_AMARRA_OAUTH}={amarra}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age={max_age_seg}")
}

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
    pub dominios: Arc<dyn ArmazemDominio + Send + Sync>,
    /// Perfil do humano (`GET /me`, #1505/#1473). Mesmo padrão: a borda consome, a impl troca sem
    /// tocar aqui. O perfil real nasce no callback OAuth; hoje o dev-server semeia pro e2e do FE.
    pub perfis: Arc<dyn ArmazemPerfil + Send + Sync>,
    /// Prefs de config do usuário (`GET /me/config`, #1505/#1563). A borda consome; a impl (memória
    /// agora, Postgres depois) troca sem tocar aqui. O dev-server semeia pro e2e do FE.
    pub prefs: Arc<dyn ArmazemPref + Send + Sync>,
    /// Registro chave→forma (`PATCH /me/config`, #1588). A forma é SERVER-SIDE: o PATCH constrói o
    /// `ConfigItem` pela forma que o SERVIDOR conhece, nunca por um `tipo` do cliente (senão forjaria
    /// `Opcao→Texto` e furaria as opções). A impl real virá da config do PO; hoje o dev-server semeia.
    pub registro_formas: Arc<dyn RegistroFormas + Send + Sync>,
    /// Fluxo OAuth federado (#1695 fatia B). `Option`: a maioria das costuras (e a prod da fatia 1)
    /// não configura OAuth ⇒ `None` ⇒ `/auth/{provedor}` é 404. Injetado (`Some`) só onde há login
    /// federado a exercer (o `dev-server`; a prod real na fatia 5). Ver [`EstadoOAuth`].
    pub oauth: Option<EstadoOAuth>,
}

impl Borda {
    /// Constrói o estado: armazém de sessão + relógio + auditor + os armazéns de domínio. Envolve
    /// em `Arc` para o axum clonar barato entre handlers.
    ///
    /// `too_many_arguments` é ESPERADO e DECLARADO: a borda consome um armazém por domínio (orgs,
    /// membros, domínios, perfis, prefs, …) e cada costura vertical acrescenta o seu — a lista cresce
    /// por desenho. O `nova` é o ÚNICO ponto onde convergem, e posicional-explícito faz cada call site
    /// listar o que injeta (memória nos testes, real na prod). O refactor pra um builder é plano, não
    /// defeito — cardado à parte; até lá, o `allow` marca a intenção em vez de um smell silencioso.
    #[allow(clippy::too_many_arguments)]
    pub fn nova(
        armazem: ArmazemMemoria,
        agora: fn() -> u64,
        auditor: Arc<dyn Auditor + Send + Sync>,
        orgs: Arc<dyn ArmazemOrg + Send + Sync>,
        membros: Arc<dyn ArmazemMembro + Send + Sync>,
        dominios: Arc<dyn ArmazemDominio + Send + Sync>,
        perfis: Arc<dyn ArmazemPerfil + Send + Sync>,
        prefs: Arc<dyn ArmazemPref + Send + Sync>,
        registro_formas: Arc<dyn RegistroFormas + Send + Sync>,
    ) -> Arc<Self> {
        Self::montar(
            armazem, agora, auditor, orgs, membros, dominios, perfis, prefs, registro_formas, None,
        )
    }

    /// Como [`Borda::nova`], mas COM o fluxo OAuth ligado (`/auth/{provedor}` funciona). Construtor
    /// SEPARADO em vez de um 10º parâmetro em `nova` de propósito: só o `dev-server` (e, na fatia 5, a
    /// prod) liga OAuth; forçar os >20 call sites que NÃO fazem OAuth a passar `None` seria ruído, não
    /// sinal. Quem liga OAuth diz `nova_com_oauth`; quem não liga usa `nova` (OAuth = `None` implícito).
    /// Ambos convergem em [`Borda::montar`] — o struct literal vive num lugar só.
    #[allow(clippy::too_many_arguments)]
    pub fn nova_com_oauth(
        armazem: ArmazemMemoria,
        agora: fn() -> u64,
        auditor: Arc<dyn Auditor + Send + Sync>,
        orgs: Arc<dyn ArmazemOrg + Send + Sync>,
        membros: Arc<dyn ArmazemMembro + Send + Sync>,
        dominios: Arc<dyn ArmazemDominio + Send + Sync>,
        perfis: Arc<dyn ArmazemPerfil + Send + Sync>,
        prefs: Arc<dyn ArmazemPref + Send + Sync>,
        registro_formas: Arc<dyn RegistroFormas + Send + Sync>,
        oauth: EstadoOAuth,
    ) -> Arc<Self> {
        Self::montar(
            armazem,
            agora,
            auditor,
            orgs,
            membros,
            dominios,
            perfis,
            prefs,
            registro_formas,
            Some(oauth),
        )
    }

    /// O ÚNICO ponto onde o struct da borda é montado (os dois construtores públicos convergem aqui).
    /// Um campo novo entra em UM lugar, não em cada construtor.
    #[allow(clippy::too_many_arguments)]
    fn montar(
        armazem: ArmazemMemoria,
        agora: fn() -> u64,
        auditor: Arc<dyn Auditor + Send + Sync>,
        orgs: Arc<dyn ArmazemOrg + Send + Sync>,
        membros: Arc<dyn ArmazemMembro + Send + Sync>,
        dominios: Arc<dyn ArmazemDominio + Send + Sync>,
        perfis: Arc<dyn ArmazemPerfil + Send + Sync>,
        prefs: Arc<dyn ArmazemPref + Send + Sync>,
        registro_formas: Arc<dyn RegistroFormas + Send + Sync>,
        oauth: Option<EstadoOAuth>,
    ) -> Arc<Self> {
        Arc::new(Borda {
            armazem: Mutex::new(armazem),
            agora,
            auditor,
            orgs,
            membros,
            dominios,
            perfis,
            prefs,
            registro_formas,
            oauth,
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
