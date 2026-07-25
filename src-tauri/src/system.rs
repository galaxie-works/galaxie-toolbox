//! Integracoes com o Windows: habilitar caminhos longos (>260) no registro e
//! abrir a biblioteca no Explorer.

/// Le se LongPathsEnabled ja esta ligado (leitura de HKLM nao exige admin).
#[cfg(windows)]
pub fn long_paths_enabled() -> bool {
    use winreg::enums::HKEY_LOCAL_MACHINE;
    use winreg::RegKey;
    let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
    hklm.open_subkey(r"SYSTEM\CurrentControlSet\Control\FileSystem")
        .and_then(|k| k.get_value::<u32, _>("LongPathsEnabled"))
        .map(|v| v == 1)
        .unwrap_or(false)
}

/// Liga LongPathsEnabled. Escrever em HKLM exige elevacao, entao dispara um
/// `reg add` elevado (UAC). Espera terminar e reconfere o valor.
#[cfg(windows)]
pub fn enable_long_paths() -> Result<String, String> {
    if long_paths_enabled() {
        return Ok("already".into());
    }
    let ps = r#"Start-Process -FilePath reg.exe -Verb RunAs -Wait -ArgumentList 'add "HKLM\SYSTEM\CurrentControlSet\Control\FileSystem" /v LongPathsEnabled /t REG_DWORD /d 1 /f'"#;
    let status = std::process::Command::new("powershell")
        .args(["-NoProfile", "-WindowStyle", "Hidden", "-Command", ps])
        .status()
        .map_err(|e| format!("falha ao elevar: {e}"))?;
    if !status.success() {
        return Err("elevacao cancelada ou falhou".into());
    }
    if long_paths_enabled() {
        Ok("enabled".into())
    } else {
        Err("o valor nao foi aplicado (UAC negado?)".into())
    }
}

/// Descobre a pasta local do OneDrive DA CONTA CERTA.
///
/// A variavel %OneDriveCommercial% aponta pra uma unica conta - quando a
/// pessoa tem mais de um OneDrive corporativo sincronizado (comum em quem
/// atende varios clientes), ela abre a errada. O Windows registra cada conta
/// em HKCU\Software\Microsoft\OneDrive\Accounts\BusinessN com UserEmail,
/// ConfiguredTenantId e UserFolder - da pra casar com quem esta logado no app.
#[cfg(windows)]
pub fn onedrive_root(email: &str, tenant: &str) -> Option<std::path::PathBuf> {
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;

    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let contas = hkcu.open_subkey(r"Software\Microsoft\OneDrive\Accounts").ok()?;
    let mut reserva: Option<std::path::PathBuf> = None;

    for nome in contas.enum_keys().flatten() {
        let Ok(k) = contas.open_subkey(&nome) else { continue };
        let Ok(pasta) = k.get_value::<String, _>("UserFolder") else { continue };
        let mail = k.get_value::<String, _>("UserEmail").unwrap_or_default();
        let tid = k.get_value::<String, _>("ConfiguredTenantId").unwrap_or_default();

        if (!email.is_empty() && mail.eq_ignore_ascii_case(email))
            || (!tenant.is_empty() && tid.eq_ignore_ascii_case(tenant))
        {
            log::info!("[explorer] conta '{nome}' casou ({mail}) -> {pasta}");
            return Some(std::path::PathBuf::from(pasta));
        }
        if reserva.is_none() && nome.starts_with("Business") {
            reserva = Some(std::path::PathBuf::from(pasta));
        }
    }
    if reserva.is_some() {
        log::warn!("[explorer] nenhuma conta casou com {email} - usando a primeira Business");
    }
    reserva
}

/// Abre a biblioteca conectada no Explorer. Se a pasta ainda nao sincronizou,
/// abre a raiz do OneDrive daquela conta.
#[cfg(windows)]
pub fn open_in_explorer(name: &str, email: &str, tenant: &str) -> Result<(), String> {
    let base = onedrive_root(email, tenant)
        .or_else(|| std::env::var("OneDriveCommercial").ok().map(Into::into))
        .or_else(|| std::env::var("OneDrive").ok().map(Into::into))
        .ok_or("nao encontrei a pasta do OneDrive desta conta")?;
    let target = base.join(name);
    let to_open = if target.exists() { target } else { base };
    open::that(to_open).map_err(|e| format!("falha ao abrir o Explorer: {e}"))
}

/// Abre um arquivo com o aplicativo padrao do Windows. O "" e o argumento de
/// titulo do `start` (sem ele, um caminho entre aspas seria lido como titulo).
#[cfg(windows)]
pub fn abrir_caminho(path: &str) -> Result<(), String> {
    std::process::Command::new("cmd")
        .args(["/C", "start", "", path])
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("falha ao abrir o arquivo: {e}"))
}

/// Abre o Explorer com o arquivo selecionado. O `/select,<path>` (sem espaco
/// apos a virgula) abre a pasta e destaca o arquivo.
#[cfg(windows)]
pub fn revelar_no_explorer(path: &str) -> Result<(), String> {
    std::process::Command::new("explorer")
        .arg(format!("/select,{path}"))
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("falha ao abrir o Explorer: {e}"))
}

// --- Stubs para plataformas nao-Windows (dev/CI) ---

#[cfg(not(windows))]
pub fn long_paths_enabled() -> bool {
    false
}

#[cfg(not(windows))]
pub fn enable_long_paths() -> Result<String, String> {
    Err("disponivel apenas no Windows".into())
}

#[cfg(not(windows))]
pub fn open_in_explorer(_name: &str, _email: &str, _tenant: &str) -> Result<(), String> {
    Err("disponivel apenas no Windows".into())
}

#[cfg(not(windows))]
pub fn abrir_caminho(_path: &str) -> Result<(), String> {
    Err("disponivel apenas no Windows".into())
}

#[cfg(not(windows))]
pub fn revelar_no_explorer(_path: &str) -> Result<(), String> {
    Err("disponivel apenas no Windows".into())
}
