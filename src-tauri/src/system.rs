//! Integracoes com o Windows: habilitar caminhos longos (>260) no registro e
//! abrir a biblioteca no Explorer.

// --- Decisoes puras (cross-platform, testaveis sem registro/Explorer) -------

/// Predicado de match de conta OneDrive: casa por e-mail (case-insensitive) ou,
/// se o e-mail estiver vazio, por tenant. Extraido de `onedrive_root` pra ser
/// testavel sem HKCU. Mesma semantica do `if` inline original.
pub(crate) fn conta_casa(email: &str, tenant: &str, mail: &str, tid: &str) -> bool {
    (!email.is_empty() && mail.eq_ignore_ascii_case(email))
        || (!tenant.is_empty() && tid.eq_ignore_ascii_case(tenant))
}

/// Escolhe o alvo a abrir no Explorer: a pasta da biblioteca se ela existe,
/// senao a raiz do OneDrive. `alvo_existe` e o `target.exists()` calculado pelo
/// caller (mantem esta funcao pura). Extraido de `open_in_explorer`.
pub(crate) fn escolher_alvo(
    base: &std::path::Path,
    name: &str,
    alvo_existe: bool,
) -> std::path::PathBuf {
    if alvo_existe {
        base.join(name)
    } else {
        base.to_path_buf()
    }
}

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

        if conta_casa(email, tenant, &mail, &tid) {
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
    let existe = target.exists();
    let to_open = escolher_alvo(&base, name, existe);
    open::that(to_open).map_err(|e| format!("falha ao abrir o Explorer: {e}"))
}

/// Abre um arquivo com o aplicativo padrao do Windows.
///
/// #1046 (SEC2): ANTES usava `cmd /C start "" <path>`. O `cmd.exe` reinterpreta
/// metacaracteres de shell (`&`, `|`, `^`, `>`), entao um `path` hostil como
/// `arquivo & calc.exe` executava um comando extra (injecao de comando). Agora
/// usa `open::that`, que entrega o caminho como ARGUMENTO UNICO ao ShellExecute
/// (sem montar linha de shell) — a injecao deixa de existir por construcao.
#[cfg(windows)]
pub fn abrir_caminho(path: &str) -> Result<(), String> {
    open::that(path).map_err(|e| format!("falha ao abrir o arquivo: {e}"))
}

/// Abre o Explorer com o arquivo selecionado e a pasta em foco.
///
/// #1046 (SEC2): ANTES montava `explorer /select,"<path>"` concatenando as aspas
/// à mão via `raw_arg` — um `path` contendo `"` quebrava o argumento (injeção de
/// argumento pro `explorer`). Agora usa a API COM do Shell
/// (`SHOpenFolderAndSelectItems`): o caminho vira um PIDL, sem NENHUMA linha de
/// comando nem aspas pra escapar. Mesmo resultado visual do #639 (item
/// selecionado, pasta em foco), sem o vetor de aspas.
#[cfg(windows)]
pub fn revelar_no_explorer(path: &str) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;
    use windows::core::PCWSTR;
    use windows::Win32::Foundation::RPC_E_CHANGED_MODE;
    use windows::Win32::System::Com::{
        CoInitializeEx, CoUninitialize, COINIT_APARTMENTTHREADED,
    };
    use windows::Win32::UI::Shell::{ILCreateFromPathW, ILFree, SHOpenFolderAndSelectItems};

    // Caminho -> UTF-16 terminado em NUL pra PCWSTR (mantido vivo durante a chamada).
    let wide: Vec<u16> = std::ffi::OsStr::new(path)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();

    unsafe {
        // Inicializa COM neste thread (STA). RPC_E_CHANGED_MODE = COM já estava
        // inicializado em outro modo → toleramos e seguimos. Só desfazemos com
        // CoUninitialize se ESTE código inicializou (S_OK/S_FALSE), pra não
        // desbalancear a contagem de quem já tinha COM montado.
        let hr = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        if hr.is_err() && hr != RPC_E_CHANGED_MODE {
            return Err(format!("falha ao inicializar COM: {hr:?}"));
        }
        let deve_uninit = hr.is_ok();

        // ILCreateFromPathW aloca um PIDL absoluto pro caminho.
        let pidl = ILCreateFromPathW(PCWSTR(wide.as_ptr()));
        if pidl.is_null() {
            if deve_uninit {
                CoUninitialize();
            }
            return Err("caminho inválido ou inexistente ao revelar no Explorer".into());
        }

        // apidl=None + dwflags=0 → seleciona o próprio item apontado pelo PIDL
        // dentro da pasta-pai (abre a pasta e foca o arquivo).
        let r = SHOpenFolderAndSelectItems(pidl, None, 0);

        ILFree(Some(pidl));
        if deve_uninit {
            CoUninitialize();
        }

        r.map_err(|e| format!("falha ao abrir o Explorer: {e}"))
    }
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    #[test]
    fn conta_casa_por_email_exato_case_insensitive() {
        assert!(conta_casa("wagner@voaz.com", "", "wagner@voaz.com", "tid-1"));
        // caixa diferente nos dois lados -> ainda casa
        assert!(conta_casa("A@B.com", "", "a@b.COM", ""));
    }

    #[test]
    fn conta_casa_por_tenant_quando_email_vazio() {
        assert!(conta_casa("", "TENANT-123", "outro@x.com", "tenant-123"));
    }

    #[test]
    fn conta_casa_falha_sem_criterio_ou_com_valores_diferentes() {
        // email e tenant vazios -> nunca casa
        assert!(!conta_casa("", "", "qualquer@x.com", "tid"));
        // mail/tid diferentes do procurado -> nao casa
        assert!(!conta_casa("wagner@voaz.com", "tid-1", "outro@x.com", "tid-2"));
    }

    #[test]
    fn escolher_alvo_usa_subpasta_se_existe_senao_a_base() {
        let base = Path::new("C:/OneDrive");
        assert_eq!(escolher_alvo(base, "Biblioteca", true), base.join("Biblioteca"));
        assert_eq!(escolher_alvo(base, "Biblioteca", false), base.to_path_buf());
    }
}
