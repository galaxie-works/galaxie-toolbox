//! Autenticacao delegada com a Microsoft via Authorization Code Flow + PKCE,
//! usando um redirect de loopback (http://localhost:PORT). O app NUNCA ve a
//! senha: quem coleta credenciais/MFA e a pagina oficial da Microsoft aberta
//! no navegador. O que volta pro app e um authorization code, trocado por
//! tokens.

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use rand::Rng;
use sha2::{Digest, Sha256};
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use crate::config;

const GRAPH_ME: &str =
    "https://graph.microsoft.com/v1.0/me?$select=displayName,mail,userPrincipalName,companyName";

// ── Identidade multi-provider (#693, épico #692 App público) ─────────────────
// PS0: os EIXOS da identidade (provider/tipo de conta/status org) + capabilities
// derivadas dos scopes. Só a impl Microsoft está ativa; Google entra no PS3.

/// Provedor de identidade da conta.
#[derive(Clone, Copy, PartialEq, Eq, Debug, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Provider {
    Microsoft,
    Google,
}

/// Conta de trabalho (org/tenant) ou pessoal (live/hotmail/gmail).
#[derive(Clone, Copy, PartialEq, Eq, Debug, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum AccountKind {
    Work,
    Personal,
}

/// Situação da org perante a GALAXIE: cliente contratado, org não-cliente, ou
/// conta pessoal (sem org).
#[derive(Clone, Copy, PartialEq, Eq, Debug, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum OrgStatus {
    Contracted,
    /// Org que ainda não é cliente. O onboarding público (PS8/#701) constrói
    /// este estado quando detectar o não-cliente; PS0 só define o eixo.
    #[allow(dead_code)]
    Uncontracted,
    None,
}

/// O que uma conta PODE fazer, em termos de produto — a UI checa capability, não
/// scope cru. Cada provider mapeia seus scopes pra este vocabulário comum.
#[derive(Clone, Copy, PartialEq, Eq, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Capability {
    Identity,
    MailRead,
    MailReadWrite,
    MailSend,
    Calendar,
    Contacts,
    Tasks,
    FilePicker,
    FilesReadAll,
    DirectoryRead,
    OrgAdmin,
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Account {
    pub display_name: String,
    pub email: String,
    pub initials: String,
    /// Foto do perfil como data URI. None = sem foto (usa as iniciais).
    pub photo: Option<String>,
    /// Nome da organizacao, pro topo da sidebar. Vem do companyName do perfil;
    /// sem ele, cai no dominio do e-mail (nao exige escopo extra).
    pub organizacao: Option<String>,
    // #693: eixos de identidade multi-provider.
    pub provider: Provider,
    pub account_kind: AccountKind,
    pub org_status: OrgStatus,
    /// Domínio da org (só work). None em conta pessoal.
    pub domain: Option<String>,
    /// Tenant do Entra (só work). None em conta pessoal.
    pub tenant_id: Option<String>,
    /// Capabilities concedidas neste token (derivadas dos scopes).
    pub capabilities: Vec<Capability>,
}

#[derive(Clone)]
pub struct Tokens {
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub expires_at: u64, // unix secs
    pub account: Account,
    /// Tenant usado nesta sessao - o refresh precisa da mesma authority.
    pub tenant: String,
    /// Escopos delegados que o Entra ID DE FATO concedeu neste token (campo
    /// `scope` da resposta OAuth). Guardado para sinalizar quando um escopo novo
    /// da `config::SCOPES` (ex.: Mail.Read.Shared, #111) ainda nao esta no token
    /// porque a sessao foi aberta antes de ele entrar no pedido — nesse caso o
    /// app pede "faca login novamente" em vez de tratar o 403 como falta de
    /// acesso a caixa.
    pub scopes: String,
}

/// Classifica a conta a partir do tenant + e-mail: tipo (work/personal), status
/// da org e domínio/tenant (só work). MS pessoal = tenant sintético fixo.
///
/// PS0: toda conta de TRABALHO é tratada como `Contracted` — os usuários de hoje
/// são clientes contratados e o login org atual não pode mudar de comportamento.
/// O onboarding público (PS8/#701) refina pra `Uncontracted` quando detectar uma
/// org que ainda não é cliente.
fn classificar(
    tenant: &str,
    email: &str,
) -> (AccountKind, OrgStatus, Option<String>, Option<String>) {
    let pessoal = tenant.eq_ignore_ascii_case(config::MS_PERSONAL_TENANT)
        || tenant.eq_ignore_ascii_case("consumers");
    if pessoal {
        (AccountKind::Personal, OrgStatus::None, None, None)
    } else {
        let domain = email
            .rsplit('@')
            .next()
            .filter(|d| !d.is_empty())
            .map(|d| d.to_lowercase());
        (
            AccountKind::Work,
            OrgStatus::Contracted,
            domain,
            Some(tenant.to_string()),
        )
    }
}

/// Mapeia os scopes concedidos da Microsoft pras capabilities de produto. `scope`
/// é o campo cru da resposta OAuth (lista separada por espaço).
fn ms_capabilities(scopes: &str) -> Vec<Capability> {
    let s = scopes.to_ascii_lowercase();
    let tem = |needle: &str| s.contains(needle);
    let mut caps = vec![Capability::Identity]; // openid/User.Read sempre presentes
    if tem("mail.send") {
        caps.push(Capability::MailSend);
    }
    if tem("mail.readwrite") {
        caps.push(Capability::MailReadWrite);
    }
    if tem("mail.read") {
        caps.push(Capability::MailRead);
    }
    if tem("calendars.") {
        caps.push(Capability::Calendar);
    }
    if tem("contacts.") || tem("people.read") {
        caps.push(Capability::Contacts);
    }
    if tem("tasks.") {
        caps.push(Capability::Tasks);
    }
    if tem("files.readwrite") || tem("files.read") {
        caps.push(Capability::FilePicker);
    }
    if tem("files.read.all") || tem("sites.read.all") {
        caps.push(Capability::FilesReadAll);
    }
    if tem("directory.read.all") {
        caps.push(Capability::DirectoryRead);
    }
    if tem("orgsettings") || tem("application.read.all") {
        caps.push(Capability::OrgAdmin);
    }
    caps
}

/// Abstração comum de provedor de identidade. Um `impl` por provider esconde os
/// detalhes (endpoints, scopes, formato do token) atrás desta interface — a UI e
/// o resto do app falam com capabilities, não com MS/Google direto.
pub trait IdentityProvider {
    /// Login interativo. No MS é o loopback (begin+complete fundidos num passo).
    fn authenticate(&self, tenant: &str, login_hint: &str, idioma: &str)
        -> Result<Tokens, String>;
    /// Refresh silencioso a partir do refresh token (escolhe o endpoint certo).
    fn access_token(&self, tenant: &str, refresh_token: &str) -> Result<Tokens, String>;
    /// Capabilities concedidas, derivadas dos scopes do token.
    fn capabilities(&self, scopes: &str) -> Vec<Capability>;
    /// Revoga/limpa a sessão local desta conta.
    fn revoke(&self);
}

pub struct MicrosoftProvider;

impl IdentityProvider for MicrosoftProvider {
    fn authenticate(
        &self,
        tenant: &str,
        login_hint: &str,
        idioma: &str,
    ) -> Result<Tokens, String> {
        interactive_login(tenant, login_hint, idioma)
    }
    fn access_token(&self, tenant: &str, refresh_token: &str) -> Result<Tokens, String> {
        refresh(tenant, refresh_token)
    }
    fn capabilities(&self, scopes: &str) -> Vec<Capability> {
        ms_capabilities(scopes)
    }
    fn revoke(&self) {
        limpar_refresh();
    }
}

/// Provider Google (PS3, #696): Auth Code + PKCE + loopback, scopes sensitive $0.
/// Client "Desktop app" tratado como público (o secret não é fronteira; o Google
/// só exige ele no token endpoint do fluxo desktop). Reusa a máquina de loopback.
pub struct GoogleProvider;

impl IdentityProvider for GoogleProvider {
    fn authenticate(&self, _tenant: &str, login_hint: &str, idioma: &str) -> Result<Tokens, String> {
        google_interactive_login(login_hint, idioma)
    }
    fn access_token(&self, _tenant: &str, refresh_token: &str) -> Result<Tokens, String> {
        google_refresh(refresh_token)
    }
    fn capabilities(&self, scopes: &str) -> Vec<Capability> {
        google_capabilities(scopes)
    }
    fn revoke(&self) {
        limpar_refresh(); // sessão é single-file (um provider,tenant,refresh)
    }
}

/// Capabilities Google: mapeia os scopes concedidos pro vocabulário comum. Sem
/// Gmail-read (restricted, PS8) → nunca promete MailRead. `gmail.send` = MailSend;
/// `drive.file` (picker) = FilePicker.
///
/// #696: casa por TOKEN EXATO (o campo `scope` é separado por espaço), NÃO por
/// substring — `gmail.send.extra`/`drive.file.backup` não podem conceder MailSend
/// nem FilePicker por conterem o nome de um scope válido.
fn google_capabilities(scopes: &str) -> Vec<Capability> {
    let concedidos: std::collections::HashSet<&str> = scopes.split_whitespace().collect();
    let tem = |scope: &str| concedidos.contains(scope);
    let mut caps = vec![Capability::Identity]; // openid/email/profile
    if tem("https://www.googleapis.com/auth/calendar") {
        caps.push(Capability::Calendar);
    }
    if tem("https://www.googleapis.com/auth/contacts") {
        caps.push(Capability::Contacts);
    }
    if tem("https://www.googleapis.com/auth/directory.readonly") {
        caps.push(Capability::DirectoryRead);
    }
    if tem("https://www.googleapis.com/auth/gmail.send") {
        caps.push(Capability::MailSend);
    }
    if tem("https://www.googleapis.com/auth/drive.file") {
        caps.push(Capability::FilePicker);
    }
    caps
}

/// Login interativo Google: loopback + PKCE (S256), abre a página oficial do
/// Google e espera o redirect com o code. `access_type=offline` + `prompt=consent`
/// garantem o refresh_token. Bloqueante — rodar em spawn_blocking.
fn google_interactive_login(login_hint: &str, idioma: &str) -> Result<Tokens, String> {
    let cid = config::GOOGLE_CLIENT_ID;
    let (verifier, challenge) = pkce();
    let state = random_string(24);

    let server = tiny_http::Server::http("127.0.0.1:0")
        .map_err(|e| format!("falha ao abrir loopback: {e}"))?;
    let port = server
        .server_addr()
        .to_ip()
        .map(|a| a.port())
        .ok_or("sem porta de loopback")?;
    let redirect_uri = format!("http://localhost:{port}");

    let hint = if login_hint.is_empty() {
        String::new()
    } else {
        format!("&login_hint={}", urlencoding::encode(login_hint))
    };
    let auth_url = format!(
        "{endpoint}?client_id={cid}&response_type=code&redirect_uri={ruri}\
         &scope={scope}&state={state}&code_challenge={chal}&code_challenge_method=S256\
         &access_type=offline&prompt=consent{hint}",
        endpoint = config::GOOGLE_AUTH_ENDPOINT,
        cid = urlencoding::encode(cid),
        ruri = urlencoding::encode(&redirect_uri),
        scope = urlencoding::encode(config::GOOGLE_SCOPES),
        state = urlencoding::encode(&state),
        chal = urlencoding::encode(&challenge),
    );

    open::that(&auth_url).map_err(|e| format!("nao consegui abrir o navegador: {e}"))?;

    let code = esperar_code_loopback(&server, &state, idioma)?;
    google_exchange_code(&code, &verifier, &redirect_uri)
}

/// Troca o authorization code por tokens no endpoint do Google (com client_secret,
/// exigido no fluxo desktop mesmo sendo client público).
fn google_exchange_code(code: &str, verifier: &str, redirect_uri: &str) -> Result<Tokens, String> {
    let client = reqwest::blocking::Client::new();
    let params = [
        ("client_id", config::GOOGLE_CLIENT_ID),
        ("client_secret", config::GOOGLE_CLIENT_SECRET),
        ("code", code),
        ("grant_type", "authorization_code"),
        ("redirect_uri", redirect_uri),
        ("code_verifier", verifier),
    ];
    let resp = client
        .post(config::GOOGLE_TOKEN_ENDPOINT)
        .form(&params)
        .send()
        .map_err(|e| format!("falha na troca de token Google: {e}"))?;
    let status = resp.status();
    let v: serde_json::Value = resp.json().map_err(|e| e.to_string())?;
    if !status.is_success() {
        let desc = v["error_description"].as_str().unwrap_or("erro desconhecido");
        return Err(format!("token endpoint Google {}: {}", status, desc));
    }
    build_tokens_google(v, None)
}

/// Renova a partir do refresh_token. O Google normalmente NÃO devolve um novo
/// refresh_token no refresh — preservamos o atual.
fn google_refresh(refresh_token: &str) -> Result<Tokens, String> {
    let client = reqwest::blocking::Client::new();
    let params = [
        ("client_id", config::GOOGLE_CLIENT_ID),
        ("client_secret", config::GOOGLE_CLIENT_SECRET),
        ("grant_type", "refresh_token"),
        ("refresh_token", refresh_token),
    ];
    let resp = client
        .post(config::GOOGLE_TOKEN_ENDPOINT)
        .form(&params)
        .send()
        .map_err(|e| format!("falha no refresh Google: {e}"))?;
    let status = resp.status();
    let v: serde_json::Value = resp.json().map_err(|e| e.to_string())?;
    if !status.is_success() {
        let desc = v["error_description"].as_str().unwrap_or("erro desconhecido");
        return Err(format!("refresh Google {}: {}", status, desc));
    }
    build_tokens_google(v, Some(refresh_token))
}

/// Monta os `Tokens` da resposta do Google. `refresh_anterior` cobre o refresh
/// (Google costuma omitir o refresh_token na renovação).
fn build_tokens_google(v: serde_json::Value, refresh_anterior: Option<&str>) -> Result<Tokens, String> {
    let access_token = v["access_token"]
        .as_str()
        .ok_or("resposta Google sem access_token")?
        .to_string();
    let refresh_token = v["refresh_token"]
        .as_str()
        .map(|s| s.to_string())
        .or_else(|| refresh_anterior.map(|s| s.to_string()));
    let expires_in = v["expires_in"].as_u64().unwrap_or(3600);
    let escopos = v["scope"].as_str().unwrap_or(config::GOOGLE_SCOPES).to_string();
    let account = fetch_account_google(&access_token, &escopos)?;
    if let Some(rt) = refresh_token.as_deref() {
        salvar_sessao(Provider::Google, config::GOOGLE_TENANT, rt);
    } else {
        log::error!("[sessao] Google sem refresh_token — access_type=offline/prompt=consent?");
    }
    Ok(Tokens {
        access_token,
        refresh_token,
        expires_at: now_secs() + expires_in,
        account,
        tenant: config::GOOGLE_TENANT.to_string(),
        scopes: escopos,
    })
}

/// Perfil da conta Google via UserInfo OIDC (equivalente ao /me do Graph). Conta
/// Google = sempre pessoal (accountKind personal, sem org/tenant).
fn fetch_account_google(access_token: &str, scopes: &str) -> Result<Account, String> {
    let client = reqwest::blocking::Client::new();
    let resp = client
        .get(config::GOOGLE_USERINFO)
        .bearer_auth(access_token)
        .send()
        .map_err(|e| format!("falha ao consultar userinfo Google: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("userinfo Google retornou {}", resp.status()));
    }
    let v: serde_json::Value = resp.json().map_err(|e| e.to_string())?;
    let display_name = v["name"].as_str().unwrap_or("").to_string();
    let email = v["email"].as_str().unwrap_or("").to_string();
    let initials = initials_from(&display_name);
    let photo = v["picture"].as_str().map(|s| s.to_string());
    let organizacao = nome_pelo_dominio(&email);
    let conta = Account {
        display_name,
        email,
        initials,
        photo,
        organizacao,
        provider: Provider::Google,
        account_kind: AccountKind::Personal,
        org_status: OrgStatus::None,
        domain: None,
        tenant_id: None,
        capabilities: google_capabilities(scopes),
    };
    crate::estado::salvar_identidade(&conta.display_name, &conta.initials);
    Ok(conta)
}

/// Fábrica: provider ativo por enum. Total (nunca entra em pânico).
pub fn provider_de(p: Provider) -> Box<dyn IdentityProvider> {
    match p {
        Provider::Microsoft => Box::new(MicrosoftProvider),
        Provider::Google => Box::new(GoogleProvider),
    }
}

fn provider_str(p: Provider) -> &'static str {
    match p {
        Provider::Microsoft => "microsoft",
        Provider::Google => "google",
    }
}

fn provider_de_str(s: &str) -> Provider {
    if s.eq_ignore_ascii_case("google") {
        Provider::Google
    } else {
        Provider::Microsoft
    }
}

/// Escopos Graph do conjunto `wanted` (o pedido desta conta — BASE ou BASE+ORG)
/// ausentes no token em memória.
///
/// `openid`, `profile` e `offline_access` controlam autenticação/sessão e podem
/// não aparecer no campo `scope` de um access token mesmo quando o login está
/// correto. Compará-los como permissões de recurso falso-positivaria o aviso.
///
/// #694: `wanted` vem de `config::scopes_para(tenant)` — org checa BASE+ORG,
/// conta pessoal (common) checa só BASE, sem falso pedido de relogin de scope org.
pub fn required_resource_scopes_missing(actual_scopes: &str, wanted: &str) -> Vec<String> {
    let presentes = actual_scopes
        .split_ascii_whitespace()
        .map(str::to_ascii_lowercase)
        .collect::<Vec<_>>();

    wanted
        .split_ascii_whitespace()
        .filter(|scope| {
            !matches!(
                scope.to_ascii_lowercase().as_str(),
                "openid" | "profile" | "offline_access"
            )
        })
        .filter(|scope| {
            !presentes
                .iter()
                .any(|atual| atual.eq_ignore_ascii_case(scope))
        })
        .map(str::to_string)
        .collect()
}

/// Resultado da deteccao de tenant a partir do e-mail.
#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TenantInfo {
    pub tenant_id: String,
    pub dominio: String,
}

/// Descobre o tenant pelo dominio do e-mail, lendo o documento OIDC publico.
/// O `issuer` devolvido contem o GUID real do tenant.
pub fn detectar_tenant(email: &str) -> Result<TenantInfo, String> {
    // #695: o e-mail/login_hint é OPCIONAL. Vazio (ou sem domínio válido) NÃO é
    // erro — segue pelo caminho comum (pessoal/Google entram por /common; o
    // usuário digita o e-mail na própria página do provider).
    let Some(dominio) = email
        .rsplit('@')
        .next()
        .map(str::trim)
        .filter(|d| !d.is_empty() && d.contains('.'))
        .map(str::to_lowercase)
    else {
        return Ok(TenantInfo {
            tenant_id: config::COMMON_AUTHORITY.to_string(),
            dominio: String::new(),
        });
    };

    let client = reqwest::blocking::Client::new();
    let resp = client
        .get(config::discovery_url(&dominio))
        .send()
        .map_err(|e| format!("falha ao consultar o dominio: {e}"))?;
    // #694 (PS1): domínio não-M365 NÃO é mais parede — roteia pro caminho `common`
    // (pessoal/Google entram por lá; org contratada segue no tenant GUID). Só o
    // erro de rede acima ainda falha (não dá pra decidir sem consultar).
    if !resp.status().is_success() {
        log::info!("[auth] '{dominio}' não é M365 → roteando pra /common");
        return Ok(TenantInfo { tenant_id: config::COMMON_AUTHORITY.to_string(), dominio });
    }
    let v: serde_json::Value = resp.json().map_err(|e| e.to_string())?;
    let issuer = v["issuer"].as_str().unwrap_or("");
    // issuer: https://login.microsoftonline.com/{tenantId}/v2.0
    let tenant_id = issuer
        .trim_end_matches("/v2.0")
        .rsplit('/')
        .next()
        .unwrap_or("")
        .to_string();
    if tenant_id.is_empty() {
        // Documento OIDC sem tenant reconhecível → também cai no comum.
        return Ok(TenantInfo { tenant_id: config::COMMON_AUTHORITY.to_string(), dominio });
    }
    Ok(TenantInfo { tenant_id, dominio })
}

/// Estado gerenciado pelo Tauri. Guarda os tokens em memoria (nao em disco).
#[derive(Default)]
pub struct TokenStore {
    pub inner: Mutex<Option<Tokens>>,
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn random_string(n: usize) -> String {
    const CHARS: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    let mut rng = rand::thread_rng();
    (0..n)
        .map(|_| CHARS[rng.gen_range(0..CHARS.len())] as char)
        .collect()
}

fn pkce() -> (String, String) {
    let verifier = random_string(64);
    let mut hasher = Sha256::new();
    hasher.update(verifier.as_bytes());
    let challenge = URL_SAFE_NO_PAD.encode(hasher.finalize());
    (verifier, challenge)
}

fn initials_from(name: &str) -> String {
    let parts: Vec<&str> = name.split_whitespace().collect();
    match parts.as_slice() {
        [] => "?".into(),
        [one] => one.chars().take(2).collect::<String>().to_uppercase(),
        _ => {
            let first = parts.first().and_then(|s| s.chars().next());
            let last = parts.last().and_then(|s| s.chars().next());
            [first, last].into_iter().flatten().collect::<String>().to_uppercase()
        }
    }
}

/// Le displayName/email do usuario logado. `tenant`/`scopes` alimentam os eixos
/// de identidade (#693): tipo de conta, status da org e capabilities.
fn fetch_account(access_token: &str, tenant: &str, scopes: &str) -> Result<Account, String> {
    let client = reqwest::blocking::Client::new();
    let resp = client
        .get(GRAPH_ME)
        .bearer_auth(access_token)
        .send()
        .map_err(|e| format!("falha ao consultar /me: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("/me retornou {}", resp.status()));
    }
    let v: serde_json::Value = resp.json().map_err(|e| e.to_string())?;
    let display_name = v["displayName"].as_str().unwrap_or("").to_string();
    let email = v["mail"]
        .as_str()
        .or_else(|| v["userPrincipalName"].as_str())
        .unwrap_or("")
        .to_string();
    let initials = initials_from(&display_name);

    let organizacao = v["companyName"]
        .as_str()
        .filter(|s| !s.trim().is_empty())
        .map(|s| s.to_string())
        .or_else(|| nome_pelo_dominio(&email));

    // Foto: reaproveita o cache pra nao pagar a chamada em todo refresh.
    let photo = match crate::estado::ler_foto() {
        Some(f) => Some(f),
        None => {
            let f = buscar_foto(access_token);
            if let Some(ref d) = f {
                crate::estado::salvar_foto(d);
            }
            f
        }
    };

    let (account_kind, org_status, domain, tenant_id) = classificar(tenant, &email);
    let capabilities = MicrosoftProvider.capabilities(scopes);
    let conta = Account {
        display_name,
        email,
        initials,
        photo,
        organizacao,
        provider: Provider::Microsoft,
        account_kind,
        org_status,
        domain,
        tenant_id,
        capabilities,
    };
    crate::estado::salvar_identidade(&conta.display_name, &conta.initials);
    Ok(conta)
}

/// "wagner@voaz.builders" -> "Voaz". Melhor que mostrar o dominio cru quando o
/// perfil nao traz companyName.
fn nome_pelo_dominio(email: &str) -> Option<String> {
    let dominio = email.rsplit('@').next()?;
    let base = dominio.split('.').next()?;
    if base.is_empty() {
        return None;
    }
    let mut c = base.chars();
    let primeira = c.next()?.to_uppercase().to_string();
    Some(primeira + c.as_str())
}

/// Busca a foto do perfil do usuario logado e devolve como data URI.
/// `/me/photo` exige apenas User.Read (foto do PROPRIO usuario) - confirmado
/// em teste: sem foto responde 404, e faltando permissao seria 403.
///
/// Pede uma versao REDUZIDA: a original pode ter centenas de KB e vira base64
/// (+33%) que e gravado em disco e injetado no HTML a cada render. O avatar
/// tem 36px no header e 72px na tela de carregamento, entao 240x240 sobra ate
/// em tela 2x. Se o tamanho nao existir, cai na original.
fn buscar_foto(access_token: &str) -> Option<String> {
    const URLS: [&str; 2] = [
        "https://graph.microsoft.com/v1.0/me/photos/240x240/$value",
        "https://graph.microsoft.com/v1.0/me/photo/$value",
    ];
    for url in URLS {
        if let Some(d) = tentar_foto(access_token, url) {
            return Some(d);
        }
    }
    None
}

fn tentar_foto(access_token: &str, url: &str) -> Option<String> {
    let client = reqwest::blocking::Client::new();
    let resp = client.get(url).bearer_auth(access_token).send().ok()?;

    let st = resp.status();
    if !st.is_success() {
        // 404 = sem foto nesse tamanho (normal). 403 = faltou permissao.
        log::info!("[foto] {url} retornou {st}");
        return None;
    }
    let mime = resp
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("image/jpeg")
        .to_string();
    let bytes = resp.bytes().ok()?;
    if bytes.is_empty() {
        return None;
    }
    use base64::engine::general_purpose::STANDARD;
    let b64 = STANDARD.encode(&bytes);
    log::info!("[foto] obtida ({} bytes, {mime}) de {url}", bytes.len());
    Some(format!("data:{mime};base64,{b64}"))
}

/// Troca um authorization code por tokens.
fn exchange_code(
    tenant: &str,
    code: &str,
    verifier: &str,
    redirect_uri: &str,
) -> Result<Tokens, String> {
    let client = reqwest::blocking::Client::new();
    let cid = config::client_id_para(tenant);
    let scopes = config::scopes_para(tenant); // BASE (pessoal) ou BASE+ORG (org)
    let params = [
        ("client_id", cid.as_str()),
        ("grant_type", "authorization_code"),
        ("code", code),
        ("redirect_uri", redirect_uri),
        ("code_verifier", verifier),
        ("scope", scopes.as_str()),
    ];
    let resp = client
        .post(config::token_endpoint(tenant))
        .form(&params)
        .send()
        .map_err(|e| format!("falha na troca de token: {e}"))?;
    let status = resp.status();
    let v: serde_json::Value = resp.json().map_err(|e| e.to_string())?;
    if !status.is_success() {
        let desc = v["error_description"].as_str().unwrap_or("erro desconhecido");
        return Err(format!("token endpoint {}: {}", status, desc));
    }
    build_tokens(v, tenant)
}

/// Renova os tokens a partir de um refresh_token (mesma authority do login).
pub fn refresh(tenant: &str, refresh_token: &str) -> Result<Tokens, String> {
    let client = reqwest::blocking::Client::new();
    let cid = config::client_id_para(tenant);
    let scopes = config::scopes_para(tenant); // #694: BASE (common) ou BASE+ORG (tenant)
    let params = [
        ("client_id", cid.as_str()),
        ("grant_type", "refresh_token"),
        ("refresh_token", refresh_token),
        ("scope", scopes.as_str()),
    ];
    let resp = client
        .post(config::token_endpoint(tenant))
        .form(&params)
        .send()
        .map_err(|e| format!("falha no refresh: {e}"))?;
    let status = resp.status();
    let v: serde_json::Value = resp.json().map_err(|e| e.to_string())?;
    if !status.is_success() {
        let desc = v["error_description"].as_str().unwrap_or("erro desconhecido");
        return Err(format!("refresh {}: {}", status, desc));
    }
    build_tokens(v, tenant)
}

// --- Sessao persistente -----------------------------------------------------
// A sessao {tenant, refresh} vai num arquivo cifrado com DPAPI em
// %LOCALAPPDATA%. E o mesmo esquema que o MSAL usa no Windows.
//
// POR QUE NAO O COFRE DE CREDENCIAIS: o Credential Manager limita o blob a
// 2560 bytes e o Windows guarda em UTF-16 (2 bytes/char). O refresh token da
// Microsoft passa de 1500 chars -> ~3150 bytes -> estoura. A gravacao chegava
// a responder "ok" e nada era persistido. DPAPI nao tem esse limite.
//
// DPAPI cifra com a credencial do usuario do Windows: outro usuario da mesma
// maquina nao consegue decifrar, e o arquivo sozinho nao serve pra nada.

fn caminho_sessao() -> Option<std::path::PathBuf> {
    let base = std::env::var("LOCALAPPDATA").ok()?;
    let dir = std::path::Path::new(&base).join("GALAXIE");
    std::fs::create_dir_all(&dir).ok()?;
    Some(dir.join("sessao.bin"))
}

#[cfg(windows)]
pub(crate) mod dpapi {
    use std::ptr;
    use winapi::um::dpapi::{CryptProtectData, CryptUnprotectData};
    use winapi::um::winbase::LocalFree;
    use winapi::um::wincrypt::DATA_BLOB;

    fn saida_para_vec(out: &DATA_BLOB) -> Vec<u8> {
        let v = unsafe { std::slice::from_raw_parts(out.pbData, out.cbData as usize).to_vec() };
        unsafe { LocalFree(out.pbData as *mut _) };
        v
    }

    pub fn cifrar(dados: &[u8]) -> Option<Vec<u8>> {
        let mut entrada = dados.to_vec();
        let mut inb = DATA_BLOB { cbData: entrada.len() as u32, pbData: entrada.as_mut_ptr() };
        let mut outb = DATA_BLOB { cbData: 0, pbData: ptr::null_mut() };
        let ok = unsafe {
            CryptProtectData(&mut inb, ptr::null(), ptr::null_mut(), ptr::null_mut(),
                             ptr::null_mut(), 0, &mut outb)
        };
        if ok == 0 { return None; }
        Some(saida_para_vec(&outb))
    }

    pub fn decifrar(dados: &[u8]) -> Option<Vec<u8>> {
        let mut entrada = dados.to_vec();
        let mut inb = DATA_BLOB { cbData: entrada.len() as u32, pbData: entrada.as_mut_ptr() };
        let mut outb = DATA_BLOB { cbData: 0, pbData: ptr::null_mut() };
        let ok = unsafe {
            CryptUnprotectData(&mut inb, ptr::null_mut(), ptr::null_mut(), ptr::null_mut(),
                               ptr::null_mut(), 0, &mut outb)
        };
        if ok == 0 { return None; }
        Some(saida_para_vec(&outb))
    }
}

#[cfg(not(windows))]
mod dpapi {
    pub fn cifrar(d: &[u8]) -> Option<Vec<u8>> { Some(d.to_vec()) }
    pub fn decifrar(d: &[u8]) -> Option<Vec<u8>> { Some(d.to_vec()) }
}

/// Guarda {provider, tenant, refresh} — a chave do vault é (provider, conta).
/// Sem o tenant nao da pra renovar; o provider decide o endpoint no restore.
pub fn salvar_sessao(provider: Provider, tenant: &str, token: &str) {
    let Some(caminho) = caminho_sessao() else {
        log::error!("[sessao] sem LOCALAPPDATA - nao da pra persistir");
        return;
    };
    let payload = serde_json::json!({
        "provider": provider_str(provider),
        "tenant": tenant,
        "refresh": token,
    })
    .to_string();
    match dpapi::cifrar(payload.as_bytes()) {
        Some(cifrado) => match std::fs::write(&caminho, &cifrado) {
            Ok(_) => log::info!(
                "[sessao] gravada ({} bytes claros -> {} cifrados) em {}",
                payload.len(), cifrado.len(), caminho.display()
            ),
            Err(e) => log::error!("[sessao] FALHA ao gravar arquivo: {e}"),
        },
        None => log::error!("[sessao] FALHA no DPAPI ao cifrar"),
    }
}

pub fn ler_sessao() -> Option<(Provider, String, String)> {
    let caminho = caminho_sessao()?;
    let cifrado = std::fs::read(&caminho).ok()?;
    let claro = dpapi::decifrar(&cifrado)?;
    let v: serde_json::Value = serde_json::from_slice(&claro).ok()?;
    // Backward-compat: sessão gravada antes do #693 não tem "provider" → Microsoft.
    let provider = v["provider"].as_str().map(provider_de_str).unwrap_or(Provider::Microsoft);
    let tenant = v["tenant"].as_str()?.to_string();
    let refresh = v["refresh"].as_str()?.to_string();
    Some((provider, tenant, refresh))
}

pub fn limpar_refresh() {
    if let Some(caminho) = caminho_sessao() {
        let _ = std::fs::remove_file(caminho);
    }
}

/// Retoma a sessao a partir do que esta no cofre. Sem interacao.
pub fn restaurar() -> Result<Tokens, String> {
    let (provider, tenant, rt) = match ler_sessao() {
        Some(x) => {
            log::info!("[sessao] encontrada em disco (provider={}, tenant={})", provider_str(x.0), x.1);
            x
        }
        None => {
            log::warn!("[sessao] nada salvo - vai pedir login");
            return Err("sem sessao salva".into());
        }
    };
    // Roteia o refresh pelo provider persistido (#693) — MS agora, Google no PS3.
    match provider_de(provider).access_token(&tenant, &rt) {
        Ok(t) => {
            log::info!("[sessao] restaurada com sucesso");
            Ok(t)
        }
        Err(e) => {
            log::error!("[sessao] refresh recusado: {e}");
            Err(e)
        }
    }
}

fn build_tokens(v: serde_json::Value, tenant: &str) -> Result<Tokens, String> {
    let access_token = v["access_token"]
        .as_str()
        .ok_or("resposta sem access_token")?
        .to_string();
    let refresh_token = v["refresh_token"].as_str().map(|s| s.to_string());
    let expires_in = v["expires_in"].as_u64().unwrap_or(3600);
    // Diagnostico: sem refresh_token nao ha sessao persistente possivel.
    // Quase sempre significa que 'offline_access' nao veio no consent.
    let escopos = v["scope"].as_str().unwrap_or("(sem campo scope)");
    match refresh_token.as_deref() {
        Some(_) => log::info!("[sessao] refresh_token RECEBIDO | scope={escopos}"),
        None => log::error!(
            "[sessao] SEM refresh_token na resposta - offline_access nao concedido? scope={escopos}"
        ),
    }
    let account = fetch_account(&access_token, tenant, escopos)?;
    // guarda o refresh mais recente (rotativo) junto do tenant + provider (#693).
    if let Some(rt) = refresh_token.as_deref() {
        salvar_sessao(Provider::Microsoft, tenant, rt);
    }
    Ok(Tokens {
        access_token,
        refresh_token,
        expires_at: now_secs() + expires_in,
        account,
        tenant: tenant.to_string(),
        // `escopos` = campo `scope` da resposta (ou marcador se ausente). Usado
        // por `graph::mail_shared_disponivel` pra decidir se pede relogin (#111).
        scopes: escopos.to_string(),
    })
}

/// Login interativo: sobe o loopback, abre a pagina oficial da Microsoft e
/// espera o redirect com o code. Bloqueante — rodar em spawn_blocking.
pub fn interactive_login(
    tenant: &str,
    login_hint: &str,
    idioma: &str,
) -> Result<Tokens, String> {
    let cid = config::client_id_para(tenant);
    if cid.is_empty() || cid == "REPLACE_WITH_CLIENT_ID" {
        return Err(
            "App ainda nao registrado: preencha o CLIENT_ID em config.rs. \
             Veja REGISTRO-APP.md."
                .into(),
        );
    }

    let (verifier, challenge) = pkce();
    let state = random_string(24);

    let server = tiny_http::Server::http("127.0.0.1:0")
        .map_err(|e| format!("falha ao abrir loopback: {e}"))?;
    let port = server
        .server_addr()
        .to_ip()
        .map(|a| a.port())
        .ok_or("sem porta de loopback")?;
    let redirect_uri = format!("http://localhost:{port}");

    // login_hint pre-preenche o e-mail na pagina da Microsoft.
    let auth_url = format!(
        "{endpoint}?client_id={cid}&response_type=code&redirect_uri={ruri}\
         &response_mode=query&scope={scope}&state={state}\
         &code_challenge={chal}&code_challenge_method=S256&prompt=select_account\
         &login_hint={hint}",
        endpoint = config::authorize_endpoint(tenant),
        cid = urlencoding::encode(&cid),
        ruri = urlencoding::encode(&redirect_uri),
        scope = urlencoding::encode(&config::scopes_para(tenant)),
        state = urlencoding::encode(&state),
        chal = urlencoding::encode(&challenge),
        hint = urlencoding::encode(login_hint),
    );

    open::that(&auth_url).map_err(|e| format!("nao consegui abrir o navegador: {e}"))?;

    let code = esperar_code_loopback(&server, &state, idioma)?;
    exchange_code(tenant, &code, &verifier, &redirect_uri)
}

/// Aguarda o redirect do OAuth no loopback e devolve o authorization code.
/// Compartilhado por MS e Google: valida `state` (anti-CSRF), serve a página de
/// retorno no idioma escolhido e ignora requests de favicon. Timeout total 300s.
fn esperar_code_loopback(
    server: &tiny_http::Server,
    state: &str,
    idioma: &str,
) -> Result<String, String> {
    let deadline = SystemTime::now() + Duration::from_secs(300);
    loop {
        let remaining = deadline
            .duration_since(SystemTime::now())
            .map_err(|_| "tempo esgotado aguardando o login".to_string())?;
        let req = match server.recv_timeout(remaining).map_err(|e| e.to_string())? {
            Some(r) => r,
            None => return Err("tempo esgotado aguardando o login".into()),
        };

        let url = req.url().to_string();
        // Ignora pedidos de favicon etc.
        if !url.contains("code=") && !url.contains("error=") {
            let _ = req.respond(tiny_http::Response::from_string("aguardando..."));
            continue;
        }

        let query = url.splitn(2, '?').nth(1).unwrap_or("");
        let mut code = None;
        let mut got_state = None;
        let mut err = None;
        for pair in query.split('&') {
            let mut it = pair.splitn(2, '=');
            let k = it.next().unwrap_or("");
            let val = it.next().unwrap_or("");
            let decoded = urlencoding::decode(val).map(|c| c.into_owned()).unwrap_or_default();
            match k {
                "code" => code = Some(decoded),
                "state" => got_state = Some(decoded),
                "error_description" => err = Some(decoded),
                "error" if err.is_none() => err = Some(decoded),
                _ => {}
            }
        }

        // A pagina de retorno e servida por este loopback, fora do React, entao
        // os textos dela vivem aqui. O idioma vem da escolha feita na tela de
        // login, para nao dar "Você entrou" a quem selecionou ingles.
        let en = idioma.starts_with("en");
        let body_ok = if en {
            html_page(
                idioma,
                "You're in",
                "The universe is in your hands. You can close this window and go back to the app.",
            )
        } else {
            html_page(
                idioma,
                "Você entrou",
                "O universo está em suas mãos. Pode fechar esta janela e continuar no aplicativo.",
            )
        };
        let body_err = if en {
            html_page(
                idioma,
                "Sign-in failed",
                "Close this window and try again in GALAXIE.",
            )
        } else {
            html_page(
                idioma,
                "Login falhou",
                "Feche esta janela e tente novamente na GALAXIE.",
            )
        };

        if let Some(e) = err {
            let _ = req.respond(html_response(&body_err));
            return Err(format!("login negado: {e}"));
        }
        if got_state.as_deref() != Some(state) {
            let _ = req.respond(html_response(&body_err));
            return Err("state divergente (possivel CSRF); login abortado".into());
        }
        let code = match code {
            Some(c) => c,
            None => {
                let _ = req.respond(html_response(&body_err));
                return Err("redirect sem authorization code".into());
            }
        };
        let _ = req.respond(html_response(&body_ok));
        return Ok(code);
    }
}

fn html_response(body: &str) -> tiny_http::Response<std::io::Cursor<Vec<u8>>> {
    let header = tiny_http::Header::from_bytes(&b"Content-Type"[..], &b"text/html; charset=utf-8"[..])
        .unwrap();
    tiny_http::Response::from_string(body).with_header(header)
}

/// Logo embutido no binario: a pagina de retorno e servida pelo loopback e
/// nao tem de onde buscar arquivo, entao vai como data URI (favicon + logo).
const LOGO_PNG: &[u8] = include_bytes!("../assets/galaxie.png");

fn logo_data_uri() -> String {
    use base64::engine::general_purpose::STANDARD;
    format!("data:image/png;base64,{}", STANDARD.encode(LOGO_PNG))
}

fn html_page(idioma: &str, titulo: &str, msg: &str) -> String {
    let logo = logo_data_uri();
    format!(
        "<!doctype html><html lang=\"{idioma}\"><head><meta charset=\"utf-8\">\
         <title>GALAXIE</title>\
         <link rel=\"icon\" type=\"image/png\" href=\"{logo}\">\
         </head>\
         <body style=\"margin:0;height:100vh;display:grid;place-items:center;\
         font-family:Segoe UI,system-ui,sans-serif;background:#0a0a0a;color:#fafafa\">\
         <div style=\"text-align:center;max-width:420px;padding:24px\">\
         <img src=\"{logo}\" alt=\"\" width=\"72\" height=\"72\" style=\"margin-bottom:20px\">\
         <h1 style=\"font-weight:600;font-size:26px;margin:0 0 10px\">{titulo}</h1>\
         <p style=\"color:#a1a1a1;font-size:15px;line-height:1.6;margin:0\">{msg}</p>\
         </div></body></html>"
    )
}

#[cfg(test)]
mod tests {
    use super::required_resource_scopes_missing;
    use super::*;

    #[test]
    fn classifica_conta_pessoal_pelo_tenant_sintetico() {
        let (kind, org, dom, tid) = classificar(config::MS_PERSONAL_TENANT, "alguem@outlook.com");
        assert_eq!(kind, AccountKind::Personal);
        assert_eq!(org, OrgStatus::None);
        assert!(dom.is_none() && tid.is_none());
        // "consumers" também é pessoal.
        assert_eq!(classificar("consumers", "x@live.com").0, AccountKind::Personal);
    }

    #[test]
    fn login_hint_vazio_rota_para_authority_comum() {
        let info = detectar_tenant("")
            .expect("o e-mail e login_hint opcional; vazio deve seguir pelo caminho comum");

        assert_eq!(info.tenant_id, config::COMMON_AUTHORITY);
        assert!(info.dominio.is_empty());
    }

    // ── PS3 #696: GoogleProvider ────────────────────────────────────────────

    #[test]
    fn google_capabilities_mapeia_scopes_concedidos() {
        let caps = google_capabilities(config::GOOGLE_SCOPES);
        for esperada in [
            Capability::Identity,
            Capability::Calendar,
            Capability::Contacts,
            Capability::DirectoryRead,
            Capability::MailSend,
            Capability::FilePicker,
        ] {
            assert!(caps.contains(&esperada), "faltou {esperada:?}");
        }
        // Sem Gmail-read → NUNCA promete MailRead (restricted fica no PS8).
        assert!(!caps.contains(&Capability::MailRead));
        assert!(!caps.contains(&Capability::MailReadWrite));
    }

    #[test]
    fn google_capabilities_so_identity_com_scope_minimo() {
        let caps = google_capabilities("openid email profile");
        assert_eq!(caps, vec![Capability::Identity]);
    }

    #[test]
    fn google_capabilities_nao_aceita_nomes_de_scope_apenas_parecidos() {
        let caps = google_capabilities(
            "openid https://www.googleapis.com/auth/gmail.send.extra \
             https://www.googleapis.com/auth/drive.file.backup",
        );

        assert_eq!(
            caps,
            vec![Capability::Identity],
            "capabilities devem vir de tokens de scope exatos, nao de substring"
        );
    }

    #[test]
    fn google_scopes_nao_pede_restricted() {
        // $0: nada de Gmail-read nem Drive-browse (restricted → CASA anual, PS8).
        let s = config::GOOGLE_SCOPES;
        assert!(!s.contains("gmail.readonly"));
        assert!(!s.contains("gmail.modify"));
        assert!(!s.contains("auth/drive "));
        assert!(!s.ends_with("auth/drive"));
        assert!(s.contains("drive.file")); // picker non-sensitive
    }

    #[test]
    fn classifica_conta_trabalho_com_dominio_e_tenant() {
        let (kind, org, dom, tid) =
            classificar("029575b8-d93d-49e3-8017-56a3eb414f48", "Wagner@Voaz.Builders");
        assert_eq!(kind, AccountKind::Work);
        assert_eq!(org, OrgStatus::Contracted);
        assert_eq!(dom.as_deref(), Some("voaz.builders")); // minúsculo
        assert_eq!(tid.as_deref(), Some("029575b8-d93d-49e3-8017-56a3eb414f48"));
    }

    #[test]
    fn capabilities_mapeiam_scopes() {
        let caps = ms_capabilities("openid profile Mail.Send Mail.ReadWrite Calendars.ReadWrite Contacts.ReadWrite Files.ReadWrite");
        assert!(caps.contains(&Capability::Identity));
        assert!(caps.contains(&Capability::MailSend));
        assert!(caps.contains(&Capability::MailReadWrite));
        assert!(caps.contains(&Capability::MailRead)); // readwrite implica read
        assert!(caps.contains(&Capability::Calendar));
        assert!(caps.contains(&Capability::Contacts));
        assert!(caps.contains(&Capability::FilePicker));
        // Sem esses scopes, sem essas capabilities.
        assert!(!caps.contains(&Capability::DirectoryRead));
        assert!(!caps.contains(&Capability::OrgAdmin));

        // Token magro (só login) → só Identity.
        let magro = ms_capabilities("openid profile offline_access");
        assert_eq!(magro, vec![Capability::Identity]);
    }

    #[test]
    fn provider_serializa_e_round_trip() {
        assert_eq!(
            serde_json::to_value(Provider::Microsoft).unwrap(),
            serde_json::json!("microsoft")
        );
        assert_eq!(serde_json::to_value(OrgStatus::None).unwrap(), serde_json::json!("none"));
        assert_eq!(
            serde_json::to_value(Capability::MailReadWrite).unwrap(),
            serde_json::json!("mailReadWrite")
        );
        assert_eq!(provider_de_str("google"), Provider::Google);
        assert_eq!(provider_de_str("desconhecido"), Provider::Microsoft); // default seguro
        assert_eq!(provider_str(Provider::Google), "google");
    }

    /// Pedido de uma conta org (BASE+ORG), como o `scopes_para` de um tenant GUID.
    fn org_scopes() -> String {
        crate::config::scopes_para("029575b8-d93d-49e3-8017-56a3eb414f48")
    }

    #[test]
    fn scopes_por_authority_base_vs_org() {
        // Comum (pessoal) só pede BASE; org (tenant) pede BASE+ORG.
        let comum = crate::config::scopes_para("common");
        assert!(comum.contains("Mail.ReadWrite") && comum.contains("offline_access"));
        assert!(!comum.contains("Sites.Read.All") && !comum.contains("OrgSettings"));
        let org = org_scopes();
        assert!(org.contains("Mail.ReadWrite")); // BASE incluso
        assert!(org.contains("Sites.Read.All") && org.contains("MultiTenantOrganization.Read.All"));
        assert!(crate::config::eh_org("029575b8-d93d-49e3-8017-56a3eb414f48"));
        assert!(!crate::config::eh_org("common"));
        assert!(!crate::config::eh_org("consumers"));
    }

    #[test]
    fn compara_escopos_de_recurso_sem_diferenciar_caixa() {
        let alvo = org_scopes();
        let atuais = alvo
            .split_ascii_whitespace()
            .filter(|scope| !matches!(*scope, "openid" | "profile" | "offline_access"))
            .map(str::to_ascii_uppercase)
            .collect::<Vec<_>>()
            .join(" ");

        assert!(required_resource_scopes_missing(&atuais, &alvo).is_empty());
    }

    #[test]
    fn devolve_apenas_o_escopo_graph_realmente_ausente() {
        let alvo = org_scopes();
        let atuais = alvo
            .split_ascii_whitespace()
            .filter(|scope| *scope != "Contacts.ReadWrite")
            .collect::<Vec<_>>()
            .join(" ");

        assert_eq!(
            required_resource_scopes_missing(&atuais, &alvo),
            vec!["Contacts.ReadWrite"]
        );
    }

    #[test]
    fn nao_exige_escopos_de_autenticacao_no_access_token() {
        let alvo = org_scopes();
        let atuais = alvo
            .split_ascii_whitespace()
            .filter(|scope| !matches!(*scope, "openid" | "profile" | "offline_access"))
            .collect::<Vec<_>>()
            .join(" ");

        let ausentes = required_resource_scopes_missing(&atuais, &alvo);
        assert!(!ausentes
            .iter()
            .any(|scope| { matches!(scope.as_str(), "openid" | "profile" | "offline_access") }));
    }
}
