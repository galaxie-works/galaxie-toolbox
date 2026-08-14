//! Backend de config na nuvem do Google (PS4, #697): lê/grava um JSON privado no
//! `appDataFolder` do Google Drive — pasta OCULTA do app, cabe no scope
//! `drive.file` (non-sensitive, não é Drive-browse). Espelha o `onedrive_settings`
//! do `graph.rs`, mas o appDataFolder é mais simples (sem criar pastas).
//!
//! O token vem da sessão Google (PS3, #696). Se a conta ativa não é Google ou o
//! Drive falha, o comando retorna Err e o front cai pra local-only (graceful).

use crate::auth::{self, Provider};

const DRIVE_FILES: &str = "https://www.googleapis.com/drive/v3/files";
const DRIVE_UPLOAD: &str = "https://www.googleapis.com/upload/drive/v3/files";
const SETTINGS_NAME: &str = "toolbox.json";

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GDriveSettingsReadResult {
    pub content: Option<String>,
    /// `headRevisionId` — token de versão (a reconciliação usa como eTag).
    pub revision: Option<String>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GDriveSettingsWriteResult {
    pub revision: Option<String>,
}

/// Access token da conta Google ativa (refresh silencioso via GoogleProvider).
fn google_token() -> Result<String, String> {
    let (provider, tenant, rt) = auth::ler_sessao().ok_or("sem sessão Google salva")?;
    if provider != Provider::Google {
        return Err("a conta ativa não é Google — sem backend de Drive".into());
    }
    Ok(auth::provider_de(provider).access_token(&tenant, &rt)?.access_token)
}

/// Acha o `toolbox.json` no appDataFolder → (fileId, headRevisionId). None no 1º uso.
fn achar_arquivo(
    client: &reqwest::blocking::Client,
    token: &str,
) -> Result<Option<(String, Option<String>)>, String> {
    let resp = client
        .get(DRIVE_FILES)
        .bearer_auth(token)
        .query(&[
            ("spaces", "appDataFolder"),
            ("q", "name = 'toolbox.json' and trashed = false"),
            ("fields", "files(id,headRevisionId)"),
            ("pageSize", "1"),
        ])
        .send()
        .map_err(|e| format!("falha ao listar appDataFolder: {e}"))?;
    if !resp.status().is_success() {
        let s = resp.status();
        return Err(format!(
            "listar appDataFolder retornou {s}: {}",
            resp.text().unwrap_or_default()
        ));
    }
    let v: serde_json::Value = resp.json().map_err(|e| e.to_string())?;
    match v["files"].as_array().and_then(|a| a.first()) {
        Some(file) => {
            let id = file["id"].as_str().ok_or("arquivo do Drive sem id")?.to_string();
            let rev = file["headRevisionId"].as_str().map(str::to_owned);
            Ok(Some((id, rev)))
        }
        None => Ok(None),
    }
}

/// Lê o JSON de config do appDataFolder. Sem arquivo (1º uso) = `content: None`.
pub fn gdrive_settings_read() -> Result<GDriveSettingsReadResult, String> {
    let token = google_token()?;
    let client = reqwest::blocking::Client::new();
    let Some((id, revision)) = achar_arquivo(&client, &token)? else {
        return Ok(GDriveSettingsReadResult { content: None, revision: None });
    };
    let resp = client
        .get(format!("{DRIVE_FILES}/{id}"))
        .bearer_auth(&token)
        .query(&[("alt", "media")])
        .send()
        .map_err(|e| format!("falha ao baixar config do Drive: {e}"))?;
    if resp.status().as_u16() == 404 {
        return Ok(GDriveSettingsReadResult { content: None, revision: None });
    }
    if !resp.status().is_success() {
        let s = resp.status();
        return Err(format!(
            "download da config do Drive retornou {s}: {}",
            resp.text().unwrap_or_default()
        ));
    }
    let content = resp.text().map_err(|e| e.to_string())?;
    Ok(GDriveSettingsReadResult { content: Some(content), revision })
}

/// Grava o snapshot no appDataFolder (update se existe, create multipart senão).
/// appDataFolder é single-user → concorrência é rara; o `revision` volta pra
/// bookkeeping mas não força If-Match (o OneDrive é quem mantém eTag estrito).
pub fn gdrive_settings_write(
    content: &str,
    _revision: Option<&str>,
) -> Result<GDriveSettingsWriteResult, String> {
    let token = google_token()?;
    let client = reqwest::blocking::Client::new();
    let resp = match achar_arquivo(&client, &token)? {
        // Já existe: substitui o conteúdo (uploadType=media no PATCH).
        Some((id, _)) => client
            .patch(format!("{DRIVE_UPLOAD}/{id}"))
            .bearer_auth(&token)
            .query(&[("uploadType", "media"), ("fields", "headRevisionId")])
            .header("Content-Type", "application/json; charset=utf-8")
            .body(content.as_bytes().to_vec())
            .send(),
        // 1º uso: cria com metadata (parents=[appDataFolder]) + media, multipart.
        None => {
            let meta =
                serde_json::json!({ "name": SETTINGS_NAME, "parents": ["appDataFolder"] })
                    .to_string();
            let b = "galaxie-boundary-7e3f2a";
            let corpo = format!(
                "--{b}\r\nContent-Type: application/json; charset=utf-8\r\n\r\n{meta}\r\n\
                 --{b}\r\nContent-Type: application/json; charset=utf-8\r\n\r\n{content}\r\n--{b}--\r\n"
            );
            client
                .post(DRIVE_UPLOAD)
                .bearer_auth(&token)
                .query(&[("uploadType", "multipart"), ("fields", "headRevisionId")])
                .header("Content-Type", format!("multipart/related; boundary={b}"))
                .body(corpo.into_bytes())
                .send()
        }
    }
    .map_err(|e| format!("falha ao gravar config no Drive: {e}"))?;

    if !resp.status().is_success() {
        let s = resp.status();
        return Err(format!(
            "gravação da config no Drive retornou {s}: {}",
            resp.text().unwrap_or_default()
        ));
    }
    let v: serde_json::Value = resp.json().map_err(|e| e.to_string())?;
    Ok(GDriveSettingsWriteResult {
        revision: v["headRevisionId"].as_str().map(str::to_owned),
    })
}
