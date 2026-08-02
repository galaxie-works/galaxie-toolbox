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

/// Escopos Graph pedidos pela versão atual mas ausentes no token em memória.
///
/// `openid`, `profile` e `offline_access` controlam autenticação/sessão e podem
/// não aparecer no campo `scope` de um access token mesmo quando o login está
/// correto. Compará-los como permissões de recurso falso-positivaria o aviso.
pub fn required_resource_scopes_missing(actual_scopes: &str) -> Vec<String> {
    let presentes = actual_scopes
        .split_ascii_whitespace()
        .map(str::to_ascii_lowercase)
        .collect::<Vec<_>>();

    config::SCOPES
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
    let dominio = email
        .rsplit('@')
        .next()
        .filter(|d| !d.is_empty() && d.contains('.'))
        .ok_or("e-mail invalido")?
        .trim()
        .to_lowercase();

    let client = reqwest::blocking::Client::new();
    let resp = client
        .get(config::discovery_url(&dominio))
        .send()
        .map_err(|e| format!("falha ao consultar o dominio: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!(
            "'{dominio}' nao e um dominio Microsoft 365 (ou nao existe)."
        ));
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
        return Err("nao consegui identificar o tenant desse dominio".into());
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

/// Le displayName/email do usuario logado.
fn fetch_account(access_token: &str) -> Result<Account, String> {
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

    let conta = Account { display_name, email, initials, photo, organizacao };
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
    let cid = config::client_id();
    let params = [
        ("client_id", cid.as_str()),
        ("grant_type", "authorization_code"),
        ("code", code),
        ("redirect_uri", redirect_uri),
        ("code_verifier", verifier),
        ("scope", config::SCOPES),
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
    let cid = config::client_id();
    let params = [
        ("client_id", cid.as_str()),
        ("grant_type", "refresh_token"),
        ("refresh_token", refresh_token),
        ("scope", config::SCOPES),
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
    let dir = std::path::Path::new(&base).join("GALAXIE Toolbox");
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

/// Guarda {tenant, refresh}: sem o tenant nao da pra renovar.
pub fn salvar_sessao(tenant: &str, token: &str) {
    let Some(caminho) = caminho_sessao() else {
        log::error!("[sessao] sem LOCALAPPDATA - nao da pra persistir");
        return;
    };
    let payload = serde_json::json!({ "tenant": tenant, "refresh": token }).to_string();
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

pub fn ler_sessao() -> Option<(String, String)> {
    let caminho = caminho_sessao()?;
    let cifrado = std::fs::read(&caminho).ok()?;
    let claro = dpapi::decifrar(&cifrado)?;
    let v: serde_json::Value = serde_json::from_slice(&claro).ok()?;
    let tenant = v["tenant"].as_str()?.to_string();
    let refresh = v["refresh"].as_str()?.to_string();
    Some((tenant, refresh))
}

pub fn limpar_refresh() {
    if let Some(caminho) = caminho_sessao() {
        let _ = std::fs::remove_file(caminho);
    }
}

/// Retoma a sessao a partir do que esta no cofre. Sem interacao.
pub fn restaurar() -> Result<Tokens, String> {
    let (tenant, rt) = match ler_sessao() {
        Some(x) => {
            log::info!("[sessao] encontrada em disco (tenant={})", x.0);
            x
        }
        None => {
            log::warn!("[sessao] nada salvo - vai pedir login");
            return Err("sem sessao salva".into());
        }
    };
    match refresh(&tenant, &rt) {
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
    let account = fetch_account(&access_token)?;
    // guarda o refresh mais recente (rotativo) junto do tenant
    if let Some(rt) = refresh_token.as_deref() {
        salvar_sessao(tenant, rt);
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
    let cid = config::client_id();
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
        cid = urlencoding::encode(&config::client_id()),
        ruri = urlencoding::encode(&redirect_uri),
        scope = urlencoding::encode(config::SCOPES),
        state = urlencoding::encode(&state),
        chal = urlencoding::encode(&challenge),
        hint = urlencoding::encode(login_hint),
    );

    open::that(&auth_url).map_err(|e| format!("nao consegui abrir o navegador: {e}"))?;

    // Espera o redirect (com timeout total).
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
                "Close this window and try again in GALAXIE Toolbox.",
            )
        } else {
            html_page(
                idioma,
                "Login falhou",
                "Feche esta janela e tente novamente no GALAXIE Toolbox.",
            )
        };

        if let Some(e) = err {
            let _ = req.respond(html_response(&body_err));
            return Err(format!("login negado: {e}"));
        }
        if got_state.as_deref() != Some(state.as_str()) {
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
        return exchange_code(tenant, &code, &verifier, &redirect_uri);
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
         <title>GALAXIE Toolbox</title>\
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

    #[test]
    fn compara_escopos_de_recurso_sem_diferenciar_caixa() {
        let atuais = crate::config::SCOPES
            .split_ascii_whitespace()
            .filter(|scope| !matches!(*scope, "openid" | "profile" | "offline_access"))
            .map(str::to_ascii_uppercase)
            .collect::<Vec<_>>()
            .join(" ");

        assert!(required_resource_scopes_missing(&atuais).is_empty());
    }

    #[test]
    fn devolve_apenas_o_escopo_graph_realmente_ausente() {
        let atuais = crate::config::SCOPES
            .split_ascii_whitespace()
            .filter(|scope| *scope != "Contacts.ReadWrite")
            .collect::<Vec<_>>()
            .join(" ");

        assert_eq!(
            required_resource_scopes_missing(&atuais),
            vec!["Contacts.ReadWrite"]
        );
    }

    #[test]
    fn nao_exige_escopos_de_autenticacao_no_access_token() {
        let atuais = crate::config::SCOPES
            .split_ascii_whitespace()
            .filter(|scope| !matches!(*scope, "openid" | "profile" | "offline_access"))
            .collect::<Vec<_>>()
            .join(" ");

        let ausentes = required_resource_scopes_missing(&atuais);
        assert!(!ausentes
            .iter()
            .any(|scope| { matches!(scope.as_str(), "openid" | "profile" | "offline_access") }));
    }
}
