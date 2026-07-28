//! PIN local da tela de bloqueio (#122).
//!
//! O PIN nunca e persistido. Guardamos apenas um PHC Argon2id com salt aleatorio,
//! dentro de um blob DPAPI ligado ao usuario do Windows. Tentativas e cooldown
//! vivem somente em memoria e nao sao logados.

use argon2::{
    password_hash::{rand_core::OsRng, PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
    Argon2,
};
use serde::{Deserialize, Serialize};
use std::{
    path::PathBuf,
    sync::{Mutex, OnceLock},
    time::{Duration, Instant},
};

const MAX_TENTATIVAS: u8 = 5;
const COOLDOWN: Duration = Duration::from_secs(30);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LockStatus {
    pub enabled: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PinResult {
    pub ok: bool,
    pub remaining_attempts: u8,
    pub retry_after_seconds: u64,
}

#[derive(Serialize, Deserialize)]
struct PinPersistido {
    hash: String,
}

#[derive(Default)]
struct Tentativas {
    falhas: u8,
    bloqueado_ate: Option<Instant>,
}

static TENTATIVAS: OnceLock<Mutex<Tentativas>> = OnceLock::new();

fn tentativas() -> &'static Mutex<Tentativas> {
    TENTATIVAS.get_or_init(|| Mutex::new(Tentativas::default()))
}

fn caminho_pin() -> Option<PathBuf> {
    let base = std::env::var("LOCALAPPDATA").ok()?;
    let dir = std::path::Path::new(&base).join("GALAXIE Toolbox");
    std::fs::create_dir_all(&dir).ok()?;
    Some(dir.join("pin.bin"))
}

fn validar_formato(pin: &str) -> Result<(), String> {
    if (4..=8).contains(&pin.len()) && pin.bytes().all(|b| b.is_ascii_digit()) {
        Ok(())
    } else {
        Err("O PIN deve conter de 4 a 8 digitos.".into())
    }
}

#[cfg(windows)]
mod dpapi {
    use std::ptr;
    use winapi::um::dpapi::{CryptProtectData, CryptUnprotectData};
    use winapi::um::winbase::LocalFree;
    use winapi::um::wincrypt::DATA_BLOB;

    fn saida_para_vec(out: &DATA_BLOB) -> Vec<u8> {
        let bytes = unsafe { std::slice::from_raw_parts(out.pbData, out.cbData as usize).to_vec() };
        unsafe { LocalFree(out.pbData as *mut _) };
        bytes
    }

    pub fn cifrar(dados: &[u8]) -> Option<Vec<u8>> {
        let mut entrada = dados.to_vec();
        let mut inb = DATA_BLOB {
            cbData: entrada.len() as u32,
            pbData: entrada.as_mut_ptr(),
        };
        let mut outb = DATA_BLOB {
            cbData: 0,
            pbData: ptr::null_mut(),
        };
        let ok = unsafe {
            CryptProtectData(
                &mut inb,
                ptr::null(),
                ptr::null_mut(),
                ptr::null_mut(),
                ptr::null_mut(),
                0,
                &mut outb,
            )
        };
        (ok != 0).then(|| saida_para_vec(&outb))
    }

    pub fn decifrar(dados: &[u8]) -> Option<Vec<u8>> {
        let mut entrada = dados.to_vec();
        let mut inb = DATA_BLOB {
            cbData: entrada.len() as u32,
            pbData: entrada.as_mut_ptr(),
        };
        let mut outb = DATA_BLOB {
            cbData: 0,
            pbData: ptr::null_mut(),
        };
        let ok = unsafe {
            CryptUnprotectData(
                &mut inb,
                ptr::null_mut(),
                ptr::null_mut(),
                ptr::null_mut(),
                ptr::null_mut(),
                0,
                &mut outb,
            )
        };
        (ok != 0).then(|| saida_para_vec(&outb))
    }
}

#[cfg(not(windows))]
mod dpapi {
    // Fora do Windows o arquivo contem apenas o hash Argon2id, nunca o PIN.
    pub fn cifrar(dados: &[u8]) -> Option<Vec<u8>> {
        Some(dados.to_vec())
    }
    pub fn decifrar(dados: &[u8]) -> Option<Vec<u8>> {
        Some(dados.to_vec())
    }
}

fn ler_hash() -> Option<String> {
    let bytes = std::fs::read(caminho_pin()?).ok()?;
    let claro = dpapi::decifrar(&bytes)?;
    let salvo: PinPersistido = serde_json::from_slice(&claro).ok()?;
    Some(salvo.hash)
}

/// A existência do blob é a fonte de verdade para o bloqueio.
///
/// Não use `ler_hash().is_some()` aqui: se o arquivo for corrompido ou não
/// puder ser decifrado, tratar o PIN como desabilitado abriria o app. Mantendo
/// `enabled = true`, a verificação falha fechada e o usuário recupera via logout
/// + novo login Microsoft, que remove o blob.
fn configurado() -> bool {
    caminho_pin().is_some_and(|caminho| caminho.is_file())
}

fn gravar_hash(hash: String) -> Result<(), String> {
    let payload = serde_json::to_vec(&PinPersistido { hash })
        .map_err(|_| "Falha ao preparar o PIN.".to_string())?;
    let cifrado = dpapi::cifrar(&payload).ok_or_else(|| "Falha ao proteger o PIN.".to_string())?;
    std::fs::write(
        caminho_pin().ok_or_else(|| "Diretorio local indisponivel.".to_string())?,
        cifrado,
    )
    .map_err(|_| "Falha ao salvar o PIN.".to_string())
}

fn hash_pin(pin: &str) -> Result<String, String> {
    validar_formato(pin)?;
    let salt = SaltString::generate(&mut OsRng);
    Argon2::default()
        .hash_password(pin.as_bytes(), &salt)
        .map(|hash| hash.to_string())
        .map_err(|_| "Falha ao proteger o PIN.".to_string())
}

fn confere_hash(pin: &str, hash: &str) -> bool {
    PasswordHash::new(hash).ok().is_some_and(|parsed| {
        Argon2::default()
            .verify_password(pin.as_bytes(), &parsed)
            .is_ok()
    })
}

pub fn status() -> LockStatus {
    LockStatus {
        enabled: configurado(),
    }
}

pub fn verificar(pin: &str) -> PinResult {
    let Ok(mut estado) = tentativas().lock() else {
        return PinResult {
            ok: false,
            remaining_attempts: 0,
            retry_after_seconds: COOLDOWN.as_secs(),
        };
    };

    if let Some(ate) = estado.bloqueado_ate {
        if ate > Instant::now() {
            return PinResult {
                ok: false,
                remaining_attempts: 0,
                retry_after_seconds: ate.duration_since(Instant::now()).as_secs().max(1),
            };
        }
        *estado = Tentativas::default();
    }

    let ok = ler_hash()
        .as_deref()
        .is_some_and(|hash| confere_hash(pin, hash));
    if ok {
        *estado = Tentativas::default();
        return PinResult {
            ok: true,
            remaining_attempts: MAX_TENTATIVAS,
            retry_after_seconds: 0,
        };
    }

    estado.falhas = estado.falhas.saturating_add(1);
    let restantes = MAX_TENTATIVAS.saturating_sub(estado.falhas);
    if restantes == 0 {
        estado.bloqueado_ate = Some(Instant::now() + COOLDOWN);
    }
    PinResult {
        ok: false,
        remaining_attempts: restantes,
        retry_after_seconds: if restantes == 0 {
            COOLDOWN.as_secs()
        } else {
            0
        },
    }
}

pub fn definir(pin: &str, atual: Option<&str>) -> Result<(), String> {
    if configurado() {
        let atual = atual.ok_or_else(|| "Informe o PIN atual.".to_string())?;
        if !verificar(atual).ok {
            return Err("PIN atual incorreto.".into());
        }
    }
    gravar_hash(hash_pin(pin)?)?;
    if let Ok(mut estado) = tentativas().lock() {
        *estado = Tentativas::default();
    }
    Ok(())
}

pub fn desabilitar(pin: &str) -> Result<(), String> {
    if !verificar(pin).ok {
        return Err("PIN atual incorreto.".into());
    }
    resetar()
}

/// Usado pelo logout: relogar pela Microsoft e a recuperacao documentada.
pub fn resetar() -> Result<(), String> {
    if let Some(caminho) = caminho_pin() {
        match std::fs::remove_file(caminho) {
            Ok(()) => {}
            Err(erro) if erro.kind() == std::io::ErrorKind::NotFound => {}
            Err(_) => return Err("Falha ao remover o PIN protegido.".into()),
        }
    }
    if let Ok(mut estado) = tentativas().lock() {
        *estado = Tentativas::default();
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{confere_hash, hash_pin, validar_formato};

    #[test]
    fn aceita_apenas_quatro_a_oito_digitos() {
        assert!(validar_formato("1234").is_ok());
        assert!(validar_formato("12345678").is_ok());
        assert!(validar_formato("123").is_err());
        assert!(validar_formato("123456789").is_err());
        assert!(validar_formato("12a4").is_err());
    }

    #[test]
    fn hash_argon2id_nunca_contem_o_pin_e_verifica_localmente() {
        let pin = "482913";
        let hash = hash_pin(pin).expect("hash Argon2id");

        assert!(hash.starts_with("$argon2id$"));
        assert!(!hash.contains(pin));
        assert!(confere_hash(pin, &hash));
        assert!(!confere_hash("482914", &hash));
    }

    #[test]
    fn cada_pin_recebe_um_salt_aleatorio() {
        let primeiro = hash_pin("482913").expect("primeiro hash");
        let segundo = hash_pin("482913").expect("segundo hash");

        assert_ne!(primeiro, segundo);
        assert!(confere_hash("482913", &primeiro));
        assert!(confere_hash("482913", &segundo));
    }

    #[cfg(windows)]
    #[test]
    fn dpapi_cifra_e_decifra_o_blob_para_o_usuario_windows() {
        let claro = b"$argon2id$v=19$m=19456,t=2,p=1$hash-de-teste";
        let cifrado = super::dpapi::cifrar(claro).expect("CryptProtectData");

        assert_ne!(cifrado, claro);
        assert_eq!(
            super::dpapi::decifrar(&cifrado).expect("CryptUnprotectData"),
            claro
        );
    }
}
