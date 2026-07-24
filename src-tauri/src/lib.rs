mod auth;
mod config;
mod estado;
mod graph;
mod system;

use std::sync::Arc;
use tauri::State;

use auth::{Account, TokenStore};

type Store = Arc<TokenStore>;

/// Detecta o tenant pelo dominio do e-mail (sem logar).
#[tauri::command]
async fn detect_tenant(email: String) -> Result<auth::TenantInfo, String> {
    tauri::async_runtime::spawn_blocking(move || auth::detectar_tenant(&email))
        .await
        .map_err(|e| e.to_string())?
}

/// Login interativo: detecta o tenant pelo e-mail e abre a pagina oficial da
/// Microsoft (com o e-mail ja preenchido).
#[tauri::command]
async fn login(state: State<'_, Store>, email: String) -> Result<Account, String> {
    let store = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let info = auth::detectar_tenant(&email)?;
        let tokens = auth::interactive_login(&info.tenant_id, &email)?;
        let account = tokens.account.clone();
        *store.inner.lock().map_err(|_| "estado de token corrompido".to_string())? = Some(tokens);
        Ok::<Account, String>(account)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn logout(state: State<'_, Store>) -> Result<(), String> {
    let store = state.inner().clone();
    *store.inner.lock().map_err(|_| "estado de token corrompido".to_string())? = None;
    auth::limpar_refresh();
    estado::limpar_identidade();
    Ok(())
}

/// Identidade em cache (foto/iniciais) pra pintar a tela de carregamento
/// antes de qualquer chamada de rede. Nao faz I/O de rede.
#[tauri::command]
async fn cached_identity() -> Result<Option<estado::Identidade>, String> {
    Ok(estado::ler_identidade())
}

/// Retoma a sessao guardada no cofre do Windows (sem abrir o navegador).
/// Devolve None quando nao ha sessao valida - ai a tela de login aparece.
#[tauri::command]
async fn restore_session(state: State<'_, Store>) -> Result<Option<Account>, String> {
    let store = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        {
            let guard = store.inner.lock().map_err(|_| "estado de token corrompido".to_string())?;
            if let Some(t) = guard.as_ref() {
                return Ok::<Option<Account>, String>(Some(t.account.clone()));
            }
        }
        match auth::restaurar() {
            Ok(tokens) => {
                let account = tokens.account.clone();
                *store.inner.lock().map_err(|_| "estado de token corrompido".to_string())? = Some(tokens);
                Ok(Some(account))
            }
            Err(_) => Ok(None), // sem sessao salva ou expirada: login normal
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Conta atualmente logada, se houver (sessao vive so em memoria).
#[tauri::command]
async fn current_account(state: State<'_, Store>) -> Result<Option<Account>, String> {
    let store = state.inner().clone();
    let guard = store.inner.lock().map_err(|_| "estado de token corrompido".to_string())?;
    Ok(guard.as_ref().map(|t| t.account.clone()))
}

/// Sites do tenant que o usuario acessa, com status de conexao.
#[tauri::command]
async fn list_sites(state: State<'_, Store>) -> Result<Vec<graph::SiteDto>, String> {
    let store = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || graph::list_sites(&store))
        .await
        .map_err(|e| e.to_string())?
}

/// Tamanho e contagens de uma biblioteca (chamado por site, depois da lista).
#[tauri::command]
async fn site_details(
    state: State<'_, Store>,
    site_id: String,
    web_url: String,
) -> Result<graph::SiteDetalhes, String> {
    let store = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || graph::site_details(&store, &site_id, &web_url))
        .await
        .map_err(|e| e.to_string())?
}

/// Cria o atalho da biblioteca no OneDrive do usuario (idempotente).
#[tauri::command]
async fn connect_site(
    state: State<'_, Store>,
    site_id: String,
    name: String,
    web_url: String,
) -> Result<(), String> {
    let store = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        graph::connect_site(&store, &site_id, &name, &web_url)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Remove o atalho do OneDrive (usa o id guardado na criacao).
#[tauri::command]
async fn disconnect_site(state: State<'_, Store>, site_id: String) -> Result<(), String> {
    let store = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || graph::disconnect_site(&store, &site_id))
        .await
        .map_err(|e| e.to_string())?
}

/// Abre a biblioteca conectada no Explorer, na pasta da conta logada
/// (importante quando ha mais de um OneDrive corporativo na maquina).
#[tauri::command]
async fn open_in_explorer(state: State<'_, Store>, name: String) -> Result<(), String> {
    let store = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let (email, tenant) = {
            let g = store.inner.lock().map_err(|_| "estado de token corrompido".to_string())?;
            match g.as_ref() {
                Some(t) => (t.account.email.clone(), t.tenant.clone()),
                None => (String::new(), String::new()),
            }
        };
        system::open_in_explorer(&name, &email, &tenant)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Abre uma URL no navegador padrao (menu do usuario: Microsoft 365, SharePoint).
#[tauri::command]
async fn open_url(url: String) -> Result<(), String> {
    // So http(s): evita abrir esquemas arbitrarios vindos da interface.
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err("endereco invalido".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        open::that(&url).map_err(|e| format!("falha ao abrir o navegador: {e}"))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Liga LongPathsEnabled (>260 caracteres) via UAC.
#[tauri::command]
async fn enable_long_paths() -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(system::enable_long_paths)
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn long_paths_status() -> Result<bool, String> {
    Ok(system::long_paths_enabled())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(Arc::new(TokenStore::default()))
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            login,
            logout,
            current_account,
            restore_session,
            detect_tenant,
            cached_identity,
            list_sites,
            site_details,
            connect_site,
            disconnect_site,
            open_in_explorer,
            open_url,
            enable_long_paths,
            long_paths_status,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
