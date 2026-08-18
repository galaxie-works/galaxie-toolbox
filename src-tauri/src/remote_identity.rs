//! L1 do #1129 (migração `/v2/ws`): custódia da identidade Ed25519 do device.
//!
//! A CHAVE PRIVADA do device vive AQUI, no Rust, e **nunca** cruza pro WebView.
//! O TS só PEDE (a) a chave pública + device_id ou (b) uma assinatura de
//! registro (PoP). Nenhum comando desta camada devolve `secret_bytes` — essa é
//! a invariante L1 (ver os testes anti-vazamento em `tests`).
//!
//! ## Reuso (sem reimplementar wire crítico)
//! Toda a criptografia vem do crate `galaxie-remote-net` (núcleo LEVE, default
//! features — sem async/openssl):
//!   * `identity::DeviceIdentity` — geração/serialização da chave e o formato de
//!     assinatura de registro (`sign_registration`, domínio-separado). NÃO
//!     reimplementamos `registration_bytes`: drift = falha de auth no server.
//!   * `windows_secret::{protect_machine, unprotect_machine}` — DPAPI-NG
//!     (`LOCAL=machine`) pra cifrar o segredo em repouso.
//!
//! ## DPAPI: por que `protect_machine`/`unprotect_machine` e NÃO `persist_machine_blob`
//! O `windows_secret` (issue #1054) tem DOIS níveis:
//!   1. `protect_machine`/`unprotect_machine` — cifra/decifra com DPAPI-NG
//!      `LOCAL=machine`. Funciona em QUALQUER processo da máquina, inclusive o
//!      app rodando como o usuário interativo (não-elevado). É o que usamos.
//!   2. `persist_machine_blob`/`read_machine_blob` — gravam/leem o blob com uma
//!      DACL fixa SYSTEM+Administrators (fail-closed `AclTooWide`). Foi desenhado
//!      pro **worker SYSTEM** do S8: um processo de usuário não-elevado grava
//!      (o criador ganha acesso no `CREATE_NEW`), mas o `read_machine_blob`
//!      subsequente bate `ERROR_ACCESS_DENIED` porque o token do usuário não é
//!      SYSTEM/Admin — a leitura de volta falharia em todo boot. Por isso NÃO
//!      usamos esse par aqui; ver "Limitações" no relatório da fatia.
//!
//! O blob cifrado é gravado em `%LOCALAPPDATA%\GALAXIE\` (mesma convenção do
//! `auth.rs`/`estado.rs`), cuja DACL de perfil já restringe a leitura ao próprio
//! usuário + SYSTEM + Admins. Camadas: DPAPI-NG (machine-bound) + ACL de perfil
//! (user-scoped em repouso).

use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

use base64::Engine as _;
use base64::engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD};
use galaxie_remote_net::identity::DeviceIdentity;
use rand::RngCore;

const KEY_FILE: &str = "remote-device-key.bin";
const ID_FILE: &str = "remote-device-id";
const DEVICE_ID_RANDOM_BYTES: usize = 16;
const NONCE_RANDOM_BYTES: usize = 32;

/// Identidade PÚBLICA do device — o que o WebView pode ver. NUNCA carrega o
/// segredo (garantido pelo teste `retorno_publico_nao_contem_segredo`).
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DevicePublicIdentity {
    /// Identificador estável e público do device (base64url de 16 bytes random).
    pub device_id: String,
    /// Chave pública Ed25519 em base64 (STANDARD).
    pub public_key: String,
}

/// Prova de posse (PoP) assinada pra o registro `/v2`. O `nonce` e o `timestamp`
/// são gerados AQUI no Rust (anti-replay: o WebView não escolhe o desafio) e a
/// assinatura cobre `(device_id, nonce, timestamp)` no formato congelado do
/// `DeviceIdentity::sign_registration`. Sem nenhum campo de segredo.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SignedRegistration {
    pub device_id: String,
    pub public_key: String,
    pub nonce: String,
    pub timestamp: u64,
    pub signature: String,
}

#[derive(Debug, thiserror::Error)]
pub enum RemoteIdentityError {
    #[error("sem diretório de dados do app (LOCALAPPDATA ausente)")]
    NoAppDataDir,
    #[error("falha de I/O na custódia da chave do device: {0}")]
    Io(String),
    #[error("DPAPI-NG falhou ao proteger/recuperar a chave do device: {0}")]
    Dpapi(String),
    // Fail-closed: blob presente porém ilegível/incompatível. NUNCA geramos uma
    // chave nova por cima — o device_id no server ficaria órfão da chave certa.
    #[error(
        "estado da identidade do device corrompido ou incompleto ({0}); \
         recuse em vez de sobrescrever a chave"
    )]
    Corrupt(&'static str),
    #[error("relógio do sistema antes da época Unix")]
    Clock,
}

/// Estado carregado uma única vez. `DeviceIdentity` é `Send + Sync` (SigningKey
/// do ed25519-dalek), então pode viver `'static` e ser compartilhado.
struct DeviceState {
    device_id: String,
    identity: DeviceIdentity,
}

// Cache de sucesso + trava de inicialização (double-checked). A trava evita a
// corrida em que duas chamadas concorrentes gerariam DUAS chaves e a segunda
// sobrescreveria o blob da primeira.
static STATE: OnceLock<DeviceState> = OnceLock::new();
static INIT_LOCK: Mutex<()> = Mutex::new(());

fn state() -> Result<&'static DeviceState, RemoteIdentityError> {
    if let Some(s) = STATE.get() {
        return Ok(s);
    }
    let _guard = INIT_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(s) = STATE.get() {
        return Ok(s);
    }
    let loaded = load_or_create(&galaxie_dir()?)?;
    // Só perde a corrida se outra thread setou primeiro entre o check e aqui —
    // impossível sob a trava, mas o `let _` mantém a lógica robusta.
    let _ = STATE.set(loaded);
    Ok(STATE.get().expect("estado setado sob a trava"))
}

fn galaxie_dir() -> Result<PathBuf, RemoteIdentityError> {
    let base = std::env::var("LOCALAPPDATA").map_err(|_| RemoteIdentityError::NoAppDataDir)?;
    let dir = Path::new(&base).join("GALAXIE");
    std::fs::create_dir_all(&dir).map_err(|e| RemoteIdentityError::Io(e.to_string()))?;
    Ok(dir)
}

/// Carrega a identidade persistida ou, na primeira vez, gera + persiste.
/// Fail-closed: qualquer inconsistência (blob ilegível, par key/id incompleto)
/// vira erro — nunca gera uma chave nova por cima de um estado existente.
fn load_or_create(dir: &Path) -> Result<DeviceState, RemoteIdentityError> {
    let key_path = dir.join(KEY_FILE);
    let id_path = dir.join(ID_FILE);
    let key_exists = key_path.exists();
    let id_exists = id_path.exists();

    match (key_exists, id_exists) {
        (true, true) => {
            let blob = std::fs::read(&key_path).map_err(|e| RemoteIdentityError::Io(e.to_string()))?;
            let secret = unprotect(&blob)?;
            let identity = DeviceIdentity::from_secret(zeroize::Zeroizing::new(secret))
                .map_err(|_| RemoteIdentityError::Corrupt("segredo com tamanho/forma inválidos"))?;
            let device_id = std::fs::read_to_string(&id_path)
                .map_err(|e| RemoteIdentityError::Io(e.to_string()))?
                .trim()
                .to_owned();
            if device_id.is_empty() {
                return Err(RemoteIdentityError::Corrupt("device_id vazio no disco"));
            }
            Ok(DeviceState { device_id, identity })
        }
        // Estado meio-gravado: um dos dois arquivos sumiu. Não dá pra recuperar o
        // par (device_id, chave) que o server já pode ter vinculado → recuse.
        (true, false) => Err(RemoteIdentityError::Corrupt("blob da chave presente sem device_id")),
        (false, true) => Err(RemoteIdentityError::Corrupt("device_id presente sem blob da chave")),
        (false, false) => {
            let identity = DeviceIdentity::generate();
            let device_id = gerar_device_id();
            // Persiste PRIMEIRO o segredo cifrado, depois o id. Escrita atômica
            // (tmp + rename) pra não deixar arquivo parcial.
            let blob = protect(identity.secret_bytes().as_slice())?;
            escrever_atomico(&key_path, &blob)?;
            escrever_atomico(&id_path, device_id.as_bytes())?;
            Ok(DeviceState { device_id, identity })
        }
    }
}

fn escrever_atomico(path: &Path, bytes: &[u8]) -> Result<(), RemoteIdentityError> {
    let tmp = path.with_extension("tmp");
    std::fs::write(&tmp, bytes).map_err(|e| RemoteIdentityError::Io(e.to_string()))?;
    std::fs::rename(&tmp, path).map_err(|e| RemoteIdentityError::Io(e.to_string()))
}

fn gerar_device_id() -> String {
    let mut bytes = [0u8; DEVICE_ID_RANDOM_BYTES];
    rand::rngs::OsRng.fill_bytes(&mut bytes);
    URL_SAFE_NO_PAD.encode(bytes)
}

fn gerar_nonce() -> String {
    let mut bytes = [0u8; NONCE_RANDOM_BYTES];
    rand::rngs::OsRng.fill_bytes(&mut bytes);
    STANDARD.encode(bytes)
}

fn agora_unix() -> Result<u64, RemoteIdentityError> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .map_err(|_| RemoteIdentityError::Clock)
}

// ── DPAPI-NG (reuso do windows_secret; ver o cabeçalho do módulo) ──
// No Windows real, cifra/decifra `LOCAL=machine`. Fora do Windows (não é alvo de
// build, mas mantém o crate portável pra `cargo check` de outras plataformas), a
// custódia falha-fechada em vez de gravar segredo em claro.

#[cfg(windows)]
fn protect(secret: &[u8]) -> Result<Vec<u8>, RemoteIdentityError> {
    galaxie_remote_net::windows_secret::protect_machine(secret)
        .map_err(|e| RemoteIdentityError::Dpapi(e.to_string()))
}

#[cfg(windows)]
fn unprotect(blob: &[u8]) -> Result<Vec<u8>, RemoteIdentityError> {
    galaxie_remote_net::windows_secret::unprotect_machine(blob)
        .map_err(|e| RemoteIdentityError::Dpapi(e.to_string()))
}

#[cfg(not(windows))]
fn protect(_secret: &[u8]) -> Result<Vec<u8>, RemoteIdentityError> {
    Err(RemoteIdentityError::Dpapi(
        "custódia DPAPI-NG só existe no Windows".to_owned(),
    ))
}

#[cfg(not(windows))]
fn unprotect(_blob: &[u8]) -> Result<Vec<u8>, RemoteIdentityError> {
    Err(RemoteIdentityError::Dpapi(
        "custódia DPAPI-NG só existe no Windows".to_owned(),
    ))
}

// ── API interna (mapeada pra String pelos comandos) ──

/// device_id + chave pública. Carrega/gera a identidade na 1ª chamada.
pub fn public_identity() -> Result<DevicePublicIdentity, RemoteIdentityError> {
    let st = state()?;
    Ok(DevicePublicIdentity {
        device_id: st.device_id.clone(),
        public_key: st.identity.public_key_base64(),
    })
}

/// Assina `(device_id, nonce, timestamp)` — nonce e timestamp gerados no Rust.
pub fn sign_registration() -> Result<SignedRegistration, RemoteIdentityError> {
    let st = state()?;
    let nonce = gerar_nonce();
    let timestamp = agora_unix()?;
    let signature = st.identity.sign_registration(&st.device_id, &nonce, timestamp);
    Ok(SignedRegistration {
        device_id: st.device_id.clone(),
        public_key: st.identity.public_key_base64(),
        nonce,
        timestamp,
        signature,
    })
}

// ── Comandos Tauri (sempre compilados; L1 não depende da feature `remote`) ──

/// Devolve o device_id + a chave pública do device. NUNCA o segredo.
#[tauri::command]
pub async fn remote_device_public_key() -> Result<DevicePublicIdentity, String> {
    tauri::async_runtime::spawn_blocking(|| public_identity().map_err(|e| e.to_string()))
        .await
        .map_err(|e| e.to_string())?
}

/// Assina um desafio de registro `(device_id, nonce, timestamp)` e devolve a
/// PoP. O nonce e o timestamp são cunhados no Rust (anti-replay). NUNCA o segredo.
#[tauri::command]
pub async fn remote_sign_register() -> Result<SignedRegistration, String> {
    tauri::async_runtime::spawn_blocking(|| sign_registration().map_err(|e| e.to_string()))
        .await
        .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use galaxie_remote_net::identity::verify_registration;

    // Diretório de teste isolado (não depende de LOCALAPPDATA nem colide entre
    // testes rodando em paralelo).
    fn dir_temp(tag: &str) -> PathBuf {
        let mut p = std::env::temp_dir();
        p.push(format!("gt-1129-{}-{}", tag, std::process::id()));
        let _ = std::fs::remove_dir_all(&p);
        std::fs::create_dir_all(&p).unwrap();
        p
    }

    /// DoD (anti-vazamento): a superfície pública dos comandos NÃO expõe o
    /// segredo. Serializamos os dois structs de retorno e provamos que o
    /// base64 da chave privada não aparece em lugar nenhum.
    #[test]
    fn retorno_publico_nao_contem_segredo() {
        let identity = DeviceIdentity::generate();
        let segredo_b64 = STANDARD.encode(identity.secret_bytes().as_slice());

        let publico = DevicePublicIdentity {
            device_id: "dev-teste".into(),
            public_key: identity.public_key_base64(),
        };
        let assinado = SignedRegistration {
            device_id: "dev-teste".into(),
            public_key: identity.public_key_base64(),
            nonce: gerar_nonce(),
            timestamp: 1_700_000_000,
            signature: identity.sign_registration("dev-teste", "nonce-fixo", 1_700_000_000),
        };

        let json_pub = serde_json::to_string(&publico).unwrap();
        let json_sig = serde_json::to_string(&assinado).unwrap();

        assert!(
            !json_pub.contains(&segredo_b64),
            "DevicePublicIdentity vazou o segredo"
        );
        assert!(
            !json_sig.contains(&segredo_b64),
            "SignedRegistration vazou o segredo"
        );
        // E os campos são exatamente os públicos esperados (sem um campo secret
        // renomeado escondido).
        assert!(json_pub.contains("deviceId") && json_pub.contains("publicKey"));
        assert!(!json_pub.to_lowercase().contains("secret"));
        assert!(!json_sig.to_lowercase().contains("secret"));
    }

    /// Ancora o WIRE FORMAT contra drift: a assinatura produzida por
    /// `sign_registration` verifica com a `verifying key` derivada da chave
    /// pública (PoP correta). Se alguém mexer no formato de `registration_bytes`,
    /// este teste quebra.
    #[test]
    fn assinatura_verifica_com_a_chave_publica() {
        let identity = DeviceIdentity::generate();
        let (device_id, nonce, ts) = ("device-xyz", "nonce-abc", 1_700_000_123u64);
        let sig = identity.sign_registration(device_id, nonce, ts);
        // now dentro da janela de 60s do timestamp.
        assert!(
            verify_registration(
                &identity.public_key_base64(),
                device_id,
                nonce,
                ts,
                ts + 5,
                &sig,
            )
            .is_ok(),
            "PoP não verificou — wire format do registro divergiu"
        );
    }

    /// Round-trip DPAPI (Windows): gera → persiste → recarrega de OUTRO estado
    /// reproduz a MESMA chave pública e uma assinatura válida. Prova que o
    /// segredo sobrevive ao ciclo protect→disk→unprotect→from_secret.
    #[cfg(windows)]
    #[test]
    fn round_trip_persiste_e_recarrega_a_mesma_chave() {
        let dir = dir_temp("roundtrip");

        let first = load_or_create(&dir).expect("primeira geração + persist");
        let pk1 = first.identity.public_key_base64();
        let id1 = first.device_id.clone();

        // Segunda carga (arquivos já existem) → mesma identidade.
        let second = load_or_create(&dir).expect("recarga do disco");
        assert_eq!(second.device_id, id1, "device_id não é estável");
        assert_eq!(second.identity.public_key_base64(), pk1, "chave pública mudou");

        // Assinatura da recarga verifica com a chave pública original.
        let sig = second.identity.sign_registration(&id1, "n1", 1_700_000_000);
        assert!(
            verify_registration(&pk1, &id1, "n1", 1_700_000_000, 1_700_000_010, &sig).is_ok(),
            "chave recarregada não assina compatível com a original"
        );

        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Fail-closed: blob presente sem device_id (estado meio-gravado) é RECUSADO,
    /// não silenciosamente sobrescrito por uma chave nova.
    #[cfg(windows)]
    #[test]
    fn estado_incompleto_falha_fechado() {
        let dir = dir_temp("incompleto");
        // Cria só o blob da chave (sem o id).
        let identity = DeviceIdentity::generate();
        let blob = protect(identity.secret_bytes().as_slice()).unwrap();
        std::fs::write(dir.join(KEY_FILE), &blob).unwrap();

        match load_or_create(&dir) {
            Err(RemoteIdentityError::Corrupt(_)) => {}
            Err(other) => panic!("esperava Corrupt, veio {other:?}"),
            Ok(_) => panic!("estado incompleto NÃO pode carregar/sobrescrever"),
        }
        // E não criou nada por cima.
        assert!(!dir.join(ID_FILE).exists(), "não pode ter gerado id novo");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
