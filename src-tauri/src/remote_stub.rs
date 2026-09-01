//! #809/#834: stub do backend Remote quando a feature `remote` está OFF (build
//! default, sem toolchain OpenSSL). Expõe a MESMA superfície que o `remote.rs`
//! real — `RemoteRuntime` (managed state) + os 4 comandos `remote_*` — mas cada
//! comando responde "não compilado". O front (#687-UI) trata o erro e degrada
//! gracioso (mostra "Remote indisponível neste build"), em vez de "command not
//! found". Assim o app compila e roda em qualquer máquina; o Remote de verdade só
//! entra em builds `--features remote` (com OpenSSL), pro passe de 2 máquinas.

/// Placeholder do estado gerenciado — o `.manage()` no setup vale pros dois modos.
#[derive(Default)]
pub struct RemoteRuntime;

const REMOTE_OFF: &str =
    "GALAXIE Remote não está compilado neste build (feature `remote` desligada).";

#[tauri::command]
pub async fn remote_session_start() -> Result<(), String> {
    Err(REMOTE_OFF.to_owned())
}

#[tauri::command]
pub async fn remote_session_signal() -> Result<(), String> {
    Err(REMOTE_OFF.to_owned())
}

#[tauri::command]
pub async fn remote_session_input() -> Result<(), String> {
    Err(REMOTE_OFF.to_owned())
}

#[tauri::command]
pub async fn remote_session_end() -> Result<(), String> {
    Err(REMOTE_OFF.to_owned())
}

#[tauri::command]
pub async fn remote_session_renew_ice() -> Result<(), String> {
    Err(REMOTE_OFF.to_owned())
}
