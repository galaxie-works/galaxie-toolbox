//! **platform-oauth** — o fluxo OAuth federado (fatia 3 do #1505), lado DOMÍNIO.
//!
//! A fronteira (desenho do @Altair) é **I/O vs decisão**: a borda (`platform-http`) BUSCA bytes (o
//! redirect do provedor, a troca do `code`); ESTE crate DECIDE o que eles significam. Nada de HTTP,
//! nada de segredo aqui — puro e testável exatamente onde a segurança mora.
//!
//! Fatia A: a raiz de quem entra ([`Provedor`] com allowlist), o [`Pkce`] (S256 por TIPO), o estado
//! do fluxo ([`ArmazemEstadoOAuth`]: prazo + uso único atômico + amarra ao browser) e a
//! [`RedirectAllowlist`] EXATA. B = o handler `/auth/{provedor}`; C = o callback + troca do `code`
//! (a validação do token vive AQUI, devolvendo um `(Provedor, Subject)` verificado por construção).

#![forbid(unsafe_code)]

use std::collections::HashMap;

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use rand::rngs::OsRng;
use rand::RngCore;
use sha2::{Digest, Sha256};

/// Bytes de entropia de um segredo do fluxo (state, amarra, PKCE verifier). 32 = 256 bits.
const BYTES_SEGREDO: usize = 32;

fn segredo_url_safe() -> String {
    let mut bytes = [0u8; BYTES_SEGREDO];
    OsRng.fill_bytes(&mut bytes);
    URL_SAFE_NO_PAD.encode(bytes)
}

/// Os provedores federados (allowlist do contrato §2). Enum FECHADO: `{provedor}` fora daqui ⇒ o
/// handler devolve a **falha uniforme** (não confirma quais existem — invariante 6).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Provedor {
    Microsoft,
    MicrosoftPersonal,
    Google,
}

impl Provedor {
    /// Resolve o `{provedor}` do caminho contra a allowlist. Desconhecido ⇒ `None` (falha uniforme).
    #[must_use]
    pub fn da_rota(s: &str) -> Option<Provedor> {
        match s {
            "microsoft" => Some(Provedor::Microsoft),
            "microsoft-personal" => Some(Provedor::MicrosoftPersonal),
            "google" => Some(Provedor::Google),
            _ => None,
        }
    }

    #[must_use]
    pub fn slug(&self) -> &'static str {
        match self {
            Provedor::Microsoft => "microsoft",
            Provedor::MicrosoftPersonal => "microsoft-personal",
            Provedor::Google => "google",
        }
    }

    /// Se o e-mail asserido por este provedor é confiável pra **ligar um convite** (invariante 4
    /// completada, @Altair): o convite nasce por e-mail, e vincular `(provedor,subject)→UserId` por
    /// e-mail SÓ vale se o provedor VERIFICA o e-mail. `match` EXAUSTIVO — provedor novo OBRIGA a
    /// decidir por ele, não herda um default.
    ///
    /// ⚠️ **`microsoft-personal` é `false`**: conta pessoal com e-mail definido pelo dono é a
    /// garantia mais fraca; deixá-la ligar convite permitiria asserir um e-mail arbitrário e roubar
    /// o convite de outra pessoa. A regra vive NO TIPO, não num `if` esquecível.
    #[must_use]
    pub fn elegivel_para_ligar_convite(&self) -> bool {
        match self {
            Provedor::Microsoft | Provedor::Google => true,
            Provedor::MicrosoftPersonal => false,
        }
    }

    /// A **authority** do endpoint Microsoft — o eixo de segurança do #1683/#1549 (desenho do
    /// @Altair). A rota `microsoft` SÓ aceita conta de organização (`/organizations`); a
    /// `microsoft-personal` só pessoal (`/consumers`). **NUNCA `/common`**: `/common` aceita as
    /// duas, e uma conta pessoal a entrar pela rota `microsoft` seria tratada como e-mail forte
    /// (elegível a ligar convite, ver [`Provedor::elegivel_para_ligar_convite`]) quando NÃO é — a
    /// garantia passaria a ser falsa sem nada falhar. Google não usa este eixo (`None`). A regra
    /// vive NO TIPO, não num `if` esquecível.
    #[must_use]
    pub fn authority_microsoft(&self) -> Option<&'static str> {
        match self {
            Provedor::Microsoft => Some("organizations"),
            Provedor::MicrosoftPersonal => Some("consumers"),
            Provedor::Google => None,
        }
    }

    /// O endpoint de autorização do provedor (base, sem query). Microsoft embute a authority
    /// SEGURA (nunca `/common`); Google tem endpoint único.
    #[must_use]
    pub fn endpoint_autorizacao(&self) -> String {
        match self {
            Provedor::Microsoft | Provedor::MicrosoftPersonal => {
                let authority = self
                    .authority_microsoft()
                    .expect("provedor Microsoft tem authority");
                format!("https://login.microsoftonline.com/{authority}/oauth2/v2.0/authorize")
            }
            Provedor::Google => "https://accounts.google.com/o/oauth2/v2/auth".to_string(),
        }
    }

    /// O endpoint de TOKEN do provedor (troca `code`→token, fatia C). Microsoft embute a MESMA
    /// authority SEGURA do autorizar (nunca `/common`) — a troca tem de bater com a authority que
    /// iniciou o fluxo, senão uma conta pessoal poderia trocar um `code` emitido pela rota de
    /// organização. Google tem endpoint único.
    #[must_use]
    pub fn endpoint_token(&self) -> String {
        match self {
            Provedor::Microsoft | Provedor::MicrosoftPersonal => {
                let authority = self
                    .authority_microsoft()
                    .expect("provedor Microsoft tem authority");
                format!("https://login.microsoftonline.com/{authority}/oauth2/v2.0/token")
            }
            Provedor::Google => "https://oauth2.googleapis.com/token".to_string(),
        }
    }
}

/// PKCE — **só `S256`** (o `plain` é recusado por TIPO: não existe construtor que o produza). O
/// `verifier` é segredo (fica no servidor, no fluxo pendente); o `challenge` vai pro provedor.
pub struct Pkce {
    verifier: String,
    challenge: String,
}

impl Pkce {
    /// Gera um par novo: `verifier` = 256 bits CSPRNG (base64url); `challenge` = base64url(SHA256(verifier)).
    #[must_use]
    pub fn gerar() -> Pkce {
        let verifier = segredo_url_safe();
        let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
        Pkce {
            verifier,
            challenge,
        }
    }

    /// O `code_verifier` (segredo do servidor; vai no fluxo pendente, nunca pro cliente).
    #[must_use]
    pub fn verifier(&self) -> &str {
        &self.verifier
    }

    /// O `code_challenge` (vai pro provedor na iniciação, com `method=S256`).
    #[must_use]
    pub fn challenge(&self) -> &str {
        &self.challenge
    }

    /// O method — SEMPRE `S256`. Constante, não campo: não há como pedir `plain`.
    #[must_use]
    pub fn metodo() -> &'static str {
        "S256"
    }
}

/// O `state` OAuth: token opaco (CSPRNG) que amarra o início do fluxo ao callback.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct Estado(pub String);

impl Estado {
    #[must_use]
    pub fn gerar() -> Estado {
        Estado(segredo_url_safe())
    }
}

/// Amarra ao BROWSER (invariante 2 completada, @Altair): o `/auth` põe este nonce num cookie curto,
/// e o callback confere. Uso único não basta — quem obteve um `state` (visível no redirect) o
/// completaria; a amarra exige "foi ESTE browser que começou", e o browser só tem o cookie se ele
/// iniciou o fluxo.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AmarraNavegador(pub String);

impl AmarraNavegador {
    #[must_use]
    pub fn gerar() -> AmarraNavegador {
        AmarraNavegador(segredo_url_safe())
    }
}

/// O que o `/auth/{provedor}` guarda pra o callback consumir.
#[derive(Debug, Clone)]
pub struct FluxoPendente {
    pub provedor: Provedor,
    pub verificador_pkce: String,
    pub amarra: AmarraNavegador,
    /// Prazo CURTO (epoch seg): um fluxo OAuth é de segundos/minutos, não horas. Além dele, `consumir`
    /// recusa — mesmo que o `state` reapareça, o CSRF de login não pode ficar aberto indefinidamente.
    pub expira_unix: u64,
}

/// Falha de INFRA do armazém — NÃO de auth. O backing em memória nunca falha, mas a assinatura
/// devolve `Result` desde o dia 1 (regra do @Altair, já aplicada ao `ArmazemOrg`): quando o backing
/// real entrar — e ele PRECISA entrar antes de haver 2ª instância da borda, senão o callback não
/// acha o `state` entre requests — muda UMA linha na trait, não toda assinatura + todo consumidor.
///
/// E aqui a distinção MUDA a resposta (review do @Altair no #1543): `Err` (armazém fora do ar) vira
/// **falha de INFRA** (`resposta_de_falha` na borda), distinta de `Ok(None)` (state inválido/vencido/
/// amarra errada = **falha uniforme de AUTH**). Conflar as duas — uma queda virar "login inválido" —
/// é seguro pro cliente e CEGO pra nós: ninguém vê incidente e o log não distingue queda de ataque.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ErroArmazem {
    /// Armazém indisponível (backing real fora do ar). Nunca ocorre na impl em memória.
    Indisponivel,
}

/// Armazém dos fluxos OAuth EM CURSO, indexado pelo `state`. `iniciar` grava; `consumir` valida e
/// REMOVE — uso único **atômico**: o mesmo `state` não completa duas vezes, nem em corrida. Ambos
/// devolvem `Result` (ver [`ErroArmazem`]): `Err` é queda de infra, nunca "auth negada".
pub trait ArmazemEstadoOAuth {
    /// Grava um fluxo pendente sob o seu `state` (chamado por `/auth/{provedor}`). `Err` só em queda
    /// de infra do backing real.
    fn iniciar(&mut self, state: Estado, fluxo: FluxoPendente) -> Result<(), ErroArmazem>;

    /// Consome o `state` (chamado pelo callback): sai do armazém SEMPRE (uso único — o `state` é
    /// queimado ao ser tocado) e devolve o fluxo SÓ se não venceu **E** a amarra do browser confere.
    /// `Ok(None)` = inexistente / vencido / amarra errada — o handler transforma em **falha uniforme
    /// de auth**. `Err` = armazém indisponível — o handler transforma em **falha de infra**, distinta.
    fn consumir(
        &mut self,
        state: &Estado,
        amarra: &AmarraNavegador,
        agora_unix: u64,
    ) -> Result<Option<FluxoPendente>, ErroArmazem>;
}

/// Primeira impl: em memória. O `remove` é o ponto ATÔMICO do uso único — exatamente um chamador
/// tira o fluxo; um 2º `consumir` do mesmo `state` já não o acha.
#[derive(Debug, Default)]
pub struct ArmazemMemoria {
    fluxos: HashMap<Estado, FluxoPendente>,
}

impl ArmazemMemoria {
    #[must_use]
    pub fn novo() -> Self {
        Self::default()
    }
}

impl ArmazemEstadoOAuth for ArmazemMemoria {
    fn iniciar(&mut self, state: Estado, fluxo: FluxoPendente) -> Result<(), ErroArmazem> {
        self.fluxos.insert(state, fluxo);
        Ok(()) // memória nunca cai; o `Result` é a assinatura à prova do backing real
    }

    fn consumir(
        &mut self,
        state: &Estado,
        amarra: &AmarraNavegador,
        agora_unix: u64,
    ) -> Result<Option<FluxoPendente>, ErroArmazem> {
        // Tira SEMPRE (uso único queima o state ao ser tocado); só então valida prazo + amarra.
        // `Ok(None)` nos três casos de auth (inexistente/vencido/amarra) — indistinguíveis por
        // design; `Err` ficaria reservado à queda de infra (impossível em memória, daí só `Ok`).
        let Some(fluxo) = self.fluxos.remove(state) else {
            return Ok(None); // inexistente (ou já queimado)
        };
        if agora_unix >= fluxo.expira_unix {
            return Ok(None); // vencido
        }
        if fluxo.amarra != *amarra {
            return Ok(None); // outro browser
        }
        Ok(Some(fluxo))
    }
}

/// Allowlist EXATA de `redirect_uri` (invariante 3): correspondência byte-a-byte, **sem prefixo nem
/// sufixo** — o furo clássico (prefixo/sufixo permitem desviar o `code` pra um host do atacante). O
/// handler só monta a URL de autorização com um `redirect_uri` que esteja AQUI.
pub struct RedirectAllowlist {
    permitidos: Vec<String>,
}

impl RedirectAllowlist {
    #[must_use]
    pub fn nova(permitidos: Vec<String>) -> Self {
        Self { permitidos }
    }

    /// `true` só se `uri` for IGUAL (byte-a-byte) a um da lista — jamais `starts_with`/`ends_with`.
    #[must_use]
    pub fn permite(&self, uri: &str) -> bool {
        self.permitidos.iter().any(|p| p == uri)
    }
}

/// Erro ao montar a URL de autorização (fatia B/AC1).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ErroAutorizacao {
    /// O `redirect_uri` pedido NÃO está na allowlist EXATA (invariante 3) — nunca redirecionar.
    RedirectNaoPermitido,
}

/// Escopos OIDC: identidade, NÃO recurso. `openid` (traz o id_token) + `email` + `profile`.
const ESCOPOS_OIDC: &str = "openid email profile";

/// Percent-encode de UM valor de query pela regra ESTRITA do RFC 3986: mantém os `unreserved`
/// (`A-Z a-z 0-9 - . _ ~`) e encoda todo o resto (`%XX`). Sem dep — o crate é puro; e ser estrito
/// (encodar tudo o que não é unreserved) nunca sub-encoda um separador (`&`, `=`, `:`, `/`).
fn encode_query(valor: &str) -> String {
    let mut out = String::with_capacity(valor.len());
    for b in valor.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => {
                out.push(b as char);
            }
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

/// Monta a URL de autorização — o destino do redirect de `GET /auth/{provedor}` (AC1). Amarra:
/// authority SEGURA (nunca `/common`, via [`Provedor::endpoint_autorizacao`]), `code_challenge`
/// (S256) que prova a posse do verifier no callback, `state` que amarra o fluxo ao browser, e
/// `redirect_uri` **conferido byte-a-byte** na allowlist (senão o `code` desviava pra um host do
/// atacante). NUNCA embute segredo — o `client_secret` só entra na troca do `code`, server-side
/// (fatia C). `client_id` é público (Actions variable), entra por parâmetro (não hardcode).
pub fn montar_url_autorizacao(
    provedor: Provedor,
    client_id: &str,
    redirect_uri: &str,
    allowlist: &RedirectAllowlist,
    challenge: &str,
    state: &str,
) -> Result<String, ErroAutorizacao> {
    if !allowlist.permite(redirect_uri) {
        return Err(ErroAutorizacao::RedirectNaoPermitido);
    }
    let base = provedor.endpoint_autorizacao();
    let params = [
        ("client_id", client_id),
        ("response_type", "code"),
        ("redirect_uri", redirect_uri),
        ("response_mode", "query"),
        ("scope", ESCOPOS_OIDC),
        ("state", state),
        ("code_challenge", challenge),
        ("code_challenge_method", "S256"),
    ];
    let query = params
        .iter()
        .map(|(k, v)| format!("{k}={}", encode_query(v)))
        .collect::<Vec<_>>()
        .join("&");
    Ok(format!("{base}?{query}"))
}

/// Prazo CURTO default de um fluxo OAuth em curso (#1695 fatia B): 10 min. Um login federado é de
/// segundos a poucos minutos; além disto o `state` (um CSRF de login) não pode ficar aberto. Vale
/// pro `FluxoPendente::expira_unix` E pro `Max-Age` do cookie de amarra — os dois pela MESMA grandeza
/// (duração), nunca por um instante absoluto (a lição do #1681/#1527: medir por duração é imune a skew).
pub const TTL_FLUXO_OAUTH_SEG: u64 = 10 * 60;

/// O que iniciar um fluxo produz — tudo o que a borda (`/auth/{provedor}`) precisa: o que GRAVAR
/// (o `state` como chave + o `fluxo`), a `amarra` a SETAR no cookie curto do browser, e o destino
/// do 302 (`url_autorizacao`). A DECISÃO (gerar segredos, montar a URL segura, prazo do fluxo) vive
/// AQUI; a borda só grava, seta o cookie e redireciona — não escolhe nada de segurança.
pub struct InicioFluxo {
    /// Chave do fluxo no armazém (== `state` OAuth; vai também na query da URL de autorização).
    pub state: Estado,
    /// O fluxo pendente a gravar sob `state` (PKCE verifier + amarra + prazo curto).
    pub fluxo: FluxoPendente,
    /// A amarra a SETAR no cookie curto do browser — o callback confere que foi ESTE browser.
    pub amarra: AmarraNavegador,
    /// O destino do redirect (302) pro provedor.
    pub url_autorizacao: String,
}

/// Inicia um fluxo OAuth (fatia B do #1695): gera PKCE(S256) + `state` + `amarra` (todos CSPRNG),
/// monta a URL de autorização (authority SEGURA, `redirect_uri` conferido byte-a-byte na allowlist) e
/// prepara o [`FluxoPendente`] com prazo CURTO (`agora + ttl_seg`). **Puro** — nenhum I/O, nenhum
/// segredo do cofre (o `client_secret` só entra na troca do `code`, fatia C).
///
/// `Err(RedirectNaoPermitido)` só se o `redirect_uri` configurado não estiver na allowlist — é uma
/// misconfig NOSSA (a borda a trata como falha de infra e NUNCA redireciona), não uma falha de auth.
///
/// 🔑 **`saturating_add`**: se `agora_unix` vier saturado (`u64::MAX` — o fallback fail-closed do
/// relógio morto, ver `servidor.rs`), `expira` fica em `MAX` e o `consumir` do callback recusa na hora
/// (`agora >= expira`). Um relógio quebrado torna o fluxo inutilizável — fail-CLOSED, nunca imortal.
pub fn iniciar_fluxo(
    provedor: Provedor,
    client_id: &str,
    redirect_uri: &str,
    allowlist: &RedirectAllowlist,
    agora_unix: u64,
    ttl_seg: u64,
) -> Result<InicioFluxo, ErroAutorizacao> {
    let pkce = Pkce::gerar();
    let state = Estado::gerar();
    let amarra = AmarraNavegador::gerar();
    // Monta a URL ANTES de gravar: se o redirect não passar a allowlist, falha sem deixar fluxo órfão.
    let url_autorizacao = montar_url_autorizacao(
        provedor,
        client_id,
        redirect_uri,
        allowlist,
        pkce.challenge(),
        &state.0,
    )?;
    let fluxo = FluxoPendente {
        provedor,
        verificador_pkce: pkce.verifier().to_string(),
        amarra: amarra.clone(),
        expira_unix: agora_unix.saturating_add(ttl_seg),
    };
    Ok(InicioFluxo {
        state,
        fluxo,
        amarra,
        url_autorizacao,
    })
}

/// Erro da troca `code`→token (fatia C). Distingue "o provedor RECUSOU" (erro OAuth legítimo, ex.
/// `invalid_grant` — `code` vencido/reusado/amarrado a outro verifier) de "resposta que não se pode
/// confiar" (não-JSON, sem `id_token`). As duas ABORTAM o login; a distinção alimenta o log sem
/// confiar em bytes inválidos (a mesma família do `Err`-infra ≠ `Ok(None)`-auth do armazém).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ErroTroca {
    /// O token-endpoint respondeu um erro OAuth (`{"error": ...}`). Carrega o código do `error`.
    ProvedorRecusou(String),
    /// Resposta não-JSON, ou JSON sem `id_token` string não-vazia. Não confiar — abortar (nunca
    /// "meio-login"): um `id_token` ausente/vazio NUNCA vira sessão.
    RespostaInvalida,
}

/// Monta o CORPO `application/x-www-form-urlencoded` da troca `code`→token — a DECISÃO de o que se
/// envia: `grant_type=authorization_code`, o `code`, o `redirect_uri` (tem de bater byte-a-byte o do
/// autorizar, senão o provedor recusa), o `client_id`, e o `code_verifier` que PROVA a posse do PKCE
/// (fecha o par com o `code_challenge` da fatia B).
///
/// ⚠️ **O `client_secret` entra por PARÂMETRO** — este crate PURO não o lê do cofre nem o guarda
/// (isso é a borda, fatia 5); só o formata. **O resultado contém o segredo e o `code`**: a borda
/// POSTa sobre TLS e **nunca o loga**. (Fronteira de segurança FLAGADA ao @Altair: se preferires o
/// segredo inteiramente fora do crate puro, movo o append do `client_secret` pra `platform-http`.)
#[must_use]
pub fn montar_corpo_troca(
    code: &str,
    redirect_uri: &str,
    client_id: &str,
    client_secret: &str,
    code_verifier: &str,
) -> String {
    let params = [
        ("grant_type", "authorization_code"),
        ("code", code),
        ("redirect_uri", redirect_uri),
        ("client_id", client_id),
        ("client_secret", client_secret),
        ("code_verifier", code_verifier),
    ];
    params
        .iter()
        .map(|(k, v)| format!("{k}={}", encode_query(v)))
        .collect::<Vec<_>>()
        .join("&")
}

/// Extrai o `id_token` (a asserção de identidade OIDC) do CORPO da resposta do token-endpoint —
/// **só** daqui, NUNCA do front-channel/redirect (invariante do @Altair: o token de identidade vem
/// da resposta direta sobre TLS, não de algo que passou pelo browser). Um `{"error":...}` vira
/// `ProvedorRecusou` (erro do provedor); sem `id_token` string não-vazia, ou não-JSON, vira
/// `RespostaInvalida`. Só o `id_token` importa — o `access_token` é pra chamar APIs, que não fazemos.
///
/// ⚠️ Devolve o JWT **CRU, ainda NÃO verificado** — a validação da assinatura (JWKS/RS256) + claims
/// é a próxima fatia; nada que saia daqui vira sessão antes disso.
pub fn extrair_id_token(resposta: &str) -> Result<String, ErroTroca> {
    let v: serde_json::Value =
        serde_json::from_str(resposta).map_err(|_| ErroTroca::RespostaInvalida)?;
    // `error` ANTES de `id_token`: uma resposta de erro é recusa do provedor, não "inválida nossa".
    if let Some(err) = v.get("error").and_then(|e| e.as_str()) {
        return Err(ErroTroca::ProvedorRecusou(err.to_string()));
    }
    match v.get("id_token").and_then(|t| t.as_str()) {
        Some(tok) if !tok.is_empty() => Ok(tok.to_string()),
        _ => Err(ErroTroca::RespostaInvalida),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // --- #1695 fatia B (AC1): authority segura + authorize-URL builder ---------

    #[test]
    fn authority_microsoft_nunca_common() {
        // Eixo de segurança do #1683/#1549: microsoft→organizations, personal→consumers, e
        // NUNCA /common (que deixaria conta pessoal passar por e-mail forte na rota microsoft).
        assert_eq!(
            Provedor::Microsoft.authority_microsoft(),
            Some("organizations")
        );
        assert_eq!(
            Provedor::MicrosoftPersonal.authority_microsoft(),
            Some("consumers")
        );
        assert_eq!(Provedor::Google.authority_microsoft(), None);
        for p in [
            Provedor::Microsoft,
            Provedor::MicrosoftPersonal,
            Provedor::Google,
        ] {
            assert!(
                !p.endpoint_autorizacao().contains("/common"),
                "{p:?} nunca usa /common"
            );
        }
    }

    #[test]
    fn authorize_url_recusa_redirect_fora_da_allowlist() {
        let allow = RedirectAllowlist::nova(vec![
            "https://platform.thegalaxie.cloud/api/v1/auth/microsoft/callback".to_string(),
        ]);
        // redirect alheio ⇒ recusa (invariante 3: nunca desviar o `code`).
        let r = montar_url_autorizacao(
            Provedor::Microsoft,
            "cid",
            "https://evil.example/callback",
            &allow,
            "chal",
            "st",
        );
        assert_eq!(r, Err(ErroAutorizacao::RedirectNaoPermitido));
    }

    #[test]
    fn authorize_url_monta_com_authority_pkce_state_e_redirect_encodado() {
        let redir = "http://localhost:8080/api/v1/auth/microsoft/callback";
        let allow = RedirectAllowlist::nova(vec![redir.to_string()]);
        let url = montar_url_autorizacao(
            Provedor::Microsoft,
            "cid-123",
            redir,
            &allow,
            "CHAL",
            "STATE",
        )
        .expect("redirect permitido monta");
        assert!(
            url.starts_with(
                "https://login.microsoftonline.com/organizations/oauth2/v2.0/authorize?"
            ),
            "authority organizations no path: {url}"
        );
        assert!(url.contains("response_type=code"));
        assert!(url.contains("code_challenge=CHAL"));
        assert!(url.contains("code_challenge_method=S256"));
        assert!(url.contains("state=STATE"));
        assert!(url.contains("client_id=cid-123"));
        // redirect_uri percent-encodado (os `:` e `/` viram %3A/%2F — nunca sub-encodar).
        assert!(
            url.contains("redirect_uri=http%3A%2F%2Flocalhost%3A8080"),
            "redirect encodado: {url}"
        );
        // scope com espaço encodado.
        assert!(url.contains("scope=openid%20email%20profile"));
        // personal usa /consumers.
        let allow2 = RedirectAllowlist::nova(vec![redir.to_string()]);
        let url2 =
            montar_url_autorizacao(Provedor::MicrosoftPersonal, "c", redir, &allow2, "c", "s")
                .unwrap();
        assert!(
            url2.contains("/consumers/oauth2/"),
            "personal usa consumers: {url2}"
        );
    }

    #[test]
    fn allowlist_de_provedor_recusa_desconhecido() {
        assert_eq!(Provedor::da_rota("microsoft"), Some(Provedor::Microsoft));
        assert_eq!(Provedor::da_rota("google"), Some(Provedor::Google));
        assert_eq!(
            Provedor::da_rota("microsoft-personal"),
            Some(Provedor::MicrosoftPersonal)
        );
        // Desconhecido ⇒ None (o handler vira falha uniforme, não confirma quais existem).
        assert_eq!(Provedor::da_rota("facebook"), None);
        assert_eq!(Provedor::da_rota(""), None);
        assert_eq!(
            Provedor::da_rota("MICROSOFT"),
            None,
            "case-sensitive: só o slug exato"
        );
    }

    #[test]
    fn so_provedor_de_email_verificado_liga_convite() {
        assert!(Provedor::Microsoft.elegivel_para_ligar_convite());
        assert!(Provedor::Google.elegivel_para_ligar_convite());
        // ⚠️ microsoft-personal NÃO — e-mail fraco; ligar convite aqui seria roubo de conta.
        assert!(!Provedor::MicrosoftPersonal.elegivel_para_ligar_convite());
    }

    #[test]
    fn pkce_e_s256_e_o_challenge_e_o_sha256_do_verifier() {
        let p = Pkce::gerar();
        assert_eq!(Pkce::metodo(), "S256");
        // challenge == base64url(sha256(verifier)) — reproduz e confere.
        let esperado = URL_SAFE_NO_PAD.encode(Sha256::digest(p.verifier().as_bytes()));
        assert_eq!(p.challenge(), esperado);
        // dois pares diferem (CSPRNG); verifier é URL-safe e não-trivial.
        assert_ne!(Pkce::gerar().verifier(), Pkce::gerar().verifier());
        assert!(p.verifier().len() >= 40);
    }

    fn fluxo(amarra: &AmarraNavegador, expira: u64) -> FluxoPendente {
        FluxoPendente {
            provedor: Provedor::Google,
            verificador_pkce: "v".into(),
            amarra: amarra.clone(),
            expira_unix: expira,
        }
    }

    #[test]
    fn consumir_e_uso_unico_atomico() {
        let mut a = ArmazemMemoria::novo();
        let state = Estado::gerar();
        let amarra = AmarraNavegador::gerar();
        a.iniciar(state.clone(), fluxo(&amarra, 1000)).unwrap();

        // 1º consumo confere (dentro do prazo, amarra certa). `.unwrap()` prova que é `Ok` (não
        // `Err` de infra) e `.is_some()` que achou o fluxo.
        assert!(a.consumir(&state, &amarra, 500).unwrap().is_some());
        // 2º consumo do MESMO state ⇒ Ok(None): já foi queimado (uso único). `.unwrap()` prova `Ok`
        // (não `Err` de infra) e `.is_none()` que não achou — "não achei" é falha de AUTH, não de infra.
        assert!(
            a.consumir(&state, &amarra, 500).unwrap().is_none(),
            "state não completa duas vezes"
        );
    }

    #[test]
    fn consumir_recusa_vencido_e_browser_errado() {
        let amarra = AmarraNavegador::gerar();
        let outra = AmarraNavegador::gerar();

        // Vencido: agora >= expira ⇒ None.
        let mut a = ArmazemMemoria::novo();
        let s1 = Estado::gerar();
        a.iniciar(s1.clone(), fluxo(&amarra, 1000)).unwrap();
        assert!(
            a.consumir(&s1, &amarra, 1000).unwrap().is_none(),
            "vencido recusa"
        );

        // Amarra errada (outro browser) ⇒ Ok(None), mesmo dentro do prazo.
        let mut b = ArmazemMemoria::novo();
        let s2 = Estado::gerar();
        b.iniciar(s2.clone(), fluxo(&amarra, 1000)).unwrap();
        assert!(
            b.consumir(&s2, &outra, 500).unwrap().is_none(),
            "browser errado recusa"
        );
        // E queimou (uso único ao tocar): nem o browser certo completa depois.
        assert!(
            b.consumir(&s2, &amarra, 500).unwrap().is_none(),
            "tocar queima o state"
        );
    }

    #[test]
    fn redirect_allowlist_e_exata() {
        let a = RedirectAllowlist::nova(vec![
            "https://platform.thegalaxie.cloud/api/v1/auth/google/callback".into(),
        ]);
        assert!(a.permite("https://platform.thegalaxie.cloud/api/v1/auth/google/callback"));
        // prefixo/sufixo NÃO passam (o furo clássico de desvio do code).
        assert!(!a.permite("https://platform.thegalaxie.cloud/api/v1/auth/google/callback/../evil"));
        assert!(!a.permite(
            "https://evil.com/https://platform.thegalaxie.cloud/api/v1/auth/google/callback"
        ));
        assert!(!a.permite("https://platform.thegalaxie.cloud/api/v1/auth/google/callback?x=1"));
    }

    // --- #1695 fatia B: iniciar_fluxo (orquestração pura do início) ------------

    #[test]
    fn iniciar_fluxo_amarra_pkce_state_amarra_e_url() {
        let redir = "https://platform.thegalaxie.cloud/api/v1/auth/microsoft/callback";
        let allow = RedirectAllowlist::nova(vec![redir.to_string()]);
        let inicio = iniciar_fluxo(Provedor::Microsoft, "cid-1", redir, &allow, 1_000, 600)
            .expect("redirect permitido inicia");

        // Prazo = agora + ttl (duração, não instante — imune a skew, #1681/#1527).
        assert_eq!(inicio.fluxo.expira_unix, 1_600);
        // O provedor do fluxo é o pedido.
        assert_eq!(inicio.fluxo.provedor, Provedor::Microsoft);
        // A amarra devolvida (pro cookie) é a MESMA gravada no fluxo (pro callback conferir).
        assert_eq!(inicio.fluxo.amarra, inicio.amarra);
        // A URL leva o `state` devolvido (base64url = unreserved, não é reencodado) e a authority segura.
        assert!(inicio.url_autorizacao.contains(&format!("state={}", inicio.state.0)));
        assert!(inicio
            .url_autorizacao
            .starts_with("https://login.microsoftonline.com/organizations/oauth2/v2.0/authorize?"));
        // 🔑 PKCE fim-a-fim: o `code_challenge` da URL == base64url(sha256(verificador GRAVADO)).
        let esperado =
            URL_SAFE_NO_PAD.encode(Sha256::digest(inicio.fluxo.verificador_pkce.as_bytes()));
        assert!(
            inicio.url_autorizacao.contains(&format!("code_challenge={esperado}")),
            "challenge da URL prova posse do verifier gravado: {}",
            inicio.url_autorizacao
        );
        assert!(inicio.url_autorizacao.contains("code_challenge_method=S256"));
    }

    #[test]
    fn iniciar_fluxo_recusa_redirect_fora_da_allowlist_sem_deixar_orfao() {
        // redirect NÃO listado ⇒ Err, e nada a gravar (a borda nunca redireciona nem cria fluxo).
        let allow = RedirectAllowlist::nova(vec!["https://ok.example/cb".to_string()]);
        let r = iniciar_fluxo(Provedor::Google, "cid", "https://evil.example/cb", &allow, 0, 600);
        assert_eq!(r.err(), Some(ErroAutorizacao::RedirectNaoPermitido));
    }

    #[test]
    fn iniciar_fluxo_gera_segredos_distintos_a_cada_chamada() {
        let redir = "https://ok.example/cb";
        let allow = RedirectAllowlist::nova(vec![redir.to_string()]);
        let a = iniciar_fluxo(Provedor::Google, "c", redir, &allow, 0, 600).unwrap();
        let b = iniciar_fluxo(Provedor::Google, "c", redir, &allow, 0, 600).unwrap();
        assert_ne!(a.state.0, b.state.0, "state CSPRNG por fluxo");
        assert_ne!(a.amarra.0, b.amarra.0, "amarra CSPRNG por fluxo");
        assert_ne!(
            a.fluxo.verificador_pkce, b.fluxo.verificador_pkce,
            "verifier CSPRNG por fluxo"
        );
    }

    #[test]
    fn iniciar_fluxo_relogio_saturado_nasce_vencido() {
        // Relógio morto (u64::MAX, fail-closed): saturating_add mantém MAX ⇒ o fluxo já nasce no teto,
        // e um consumir com o mesmo MAX recusa (agora >= expira). Nunca imortal.
        let redir = "https://ok.example/cb";
        let allow = RedirectAllowlist::nova(vec![redir.to_string()]);
        let inicio = iniciar_fluxo(Provedor::Google, "c", redir, &allow, u64::MAX, 600).unwrap();
        assert_eq!(inicio.fluxo.expira_unix, u64::MAX, "saturou, não deu wrap pra baixo");
        let mut arm = ArmazemMemoria::novo();
        arm.iniciar(inicio.state.clone(), inicio.fluxo.clone()).unwrap();
        assert!(
            arm.consumir(&inicio.state, &inicio.amarra, u64::MAX).unwrap().is_none(),
            "relógio saturado ⇒ fluxo inutilizável (fail-closed)"
        );
    }

    // --- #1695 fatia C: troca code→token (decisões puras) ----------------------

    #[test]
    fn endpoint_token_usa_authority_segura_nunca_common() {
        assert_eq!(
            Provedor::Microsoft.endpoint_token(),
            "https://login.microsoftonline.com/organizations/oauth2/v2.0/token"
        );
        assert_eq!(
            Provedor::MicrosoftPersonal.endpoint_token(),
            "https://login.microsoftonline.com/consumers/oauth2/v2.0/token"
        );
        assert_eq!(Provedor::Google.endpoint_token(), "https://oauth2.googleapis.com/token");
        for p in [Provedor::Microsoft, Provedor::MicrosoftPersonal, Provedor::Google] {
            assert!(!p.endpoint_token().contains("/common"), "{p:?} nunca /common no token");
        }
    }

    #[test]
    fn corpo_troca_leva_os_campos_e_encoda_o_segredo() {
        let corpo = montar_corpo_troca("cod3", "https://p.example/cb", "cid", "s3cr+t/=", "verif");
        assert!(corpo.contains("grant_type=authorization_code"));
        assert!(corpo.contains("code=cod3"));
        assert!(corpo.contains("client_id=cid"));
        assert!(corpo.contains("code_verifier=verif"));
        // redirect_uri percent-encodado (`:`/`/` -> %3A/%2F).
        assert!(corpo.contains("redirect_uri=https%3A%2F%2Fp.example%2Fcb"), "{corpo}");
        // ⚠️ o segredo com `+ / =` (chars reservados) tem de ir ESCAPADO, senão parte o form-body.
        assert!(corpo.contains("client_secret=s3cr%2Bt%2F%3D"), "segredo escapado: {corpo}");
    }

    #[test]
    fn extrai_id_token_do_corpo_e_so_do_corpo() {
        // Sucesso: pega o id_token (ignora o access_token, que e pra API, nao identidade).
        assert_eq!(
            extrair_id_token(r#"{"access_token":"AT","id_token":"eyJ.JWT.crua","token_type":"Bearer"}"#),
            Ok("eyJ.JWT.crua".to_string())
        );
        // Erro OAuth do provedor -> ProvedorRecusou(code), distinto de "inválida nossa".
        assert_eq!(
            extrair_id_token(r#"{"error":"invalid_grant","error_description":"code expired"}"#),
            Err(ErroTroca::ProvedorRecusou("invalid_grant".to_string()))
        );
        // `error` VENCE `id_token` se ambos vierem (nao confiar num token servido junto a um erro).
        assert_eq!(
            extrair_id_token(r#"{"error":"invalid_client","id_token":"x"}"#),
            Err(ErroTroca::ProvedorRecusou("invalid_client".to_string()))
        );
        // Sem id_token / vazio / nao-JSON -> RespostaInvalida (nunca vira sessao).
        assert_eq!(extrair_id_token(r#"{"access_token":"AT"}"#), Err(ErroTroca::RespostaInvalida));
        assert_eq!(extrair_id_token(r#"{"id_token":""}"#), Err(ErroTroca::RespostaInvalida));
        assert_eq!(extrair_id_token("nao sou json"), Err(ErroTroca::RespostaInvalida));
    }
}
