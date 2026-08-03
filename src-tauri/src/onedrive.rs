//! Sonda LOCAL de sync do OneDrive (#186, Atoms S4). NÃO é Graph — lê o estado
//! do cliente OneDrive na máquina (registry das contas + processo rodando).
//!
//! Honesto por design (spec §2.5): só reporta um PROBLEMA que dá pra detectar
//! com confiança (contas configuradas mas o OneDrive.exe não está rodando =
//! sync parado). Nunca finge "check verde" — quando está tudo ok o front
//! esconde o widget. O sinal fino (pausado-pela-UI / erro / arquivos pendentes)
//! exige a Cloud Files API (spike mais fundo) — deixado como follow-up, não
//! inventado aqui.

use serde::Serialize;

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct OneDriveSync {
    /// "ok" (rodando) · "pausado" (contas mas processo fora) · "naoConfigurado".
    pub estado: String,
    /// Quantas contas OneDrive estão configuradas no registry.
    pub contas: usize,
    /// Último erro conhecido (reservado; exige Cloud Files — None por ora).
    pub ultimo_erro: Option<String>,
}

impl OneDriveSync {
    fn nao_configurado() -> Self {
        Self {
            estado: "naoConfigurado".to_string(),
            contas: 0,
            ultimo_erro: None,
        }
    }
}

/// Lê o estado local do OneDrive. Fora do Windows (ou sem contas) → naoConfigurado.
pub fn sondar() -> OneDriveSync {
    #[cfg(windows)]
    {
        let contas = contas_configuradas();
        if contas == 0 {
            return OneDriveSync::nao_configurado();
        }
        OneDriveSync {
            estado: if processo_rodando() { "ok" } else { "pausado" }.to_string(),
            contas,
            ultimo_erro: None,
        }
    }
    #[cfg(not(windows))]
    {
        OneDriveSync::nao_configurado()
    }
}

/// Contas OneDrive configuradas: subchaves de HKCU\Software\Microsoft\OneDrive\
/// Accounts com um `UserFolder` (a raiz de sync local). Best-effort.
#[cfg(windows)]
fn contas_configuradas() -> usize {
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;

    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let Ok(accounts) = hkcu.open_subkey(r"Software\Microsoft\OneDrive\Accounts") else {
        return 0;
    };
    accounts
        .enum_keys()
        .flatten()
        .filter(|nome| {
            accounts
                .open_subkey(nome)
                .and_then(|c| c.get_value::<String, _>("UserFolder"))
                .map(|p| !p.trim().is_empty())
                .unwrap_or(false)
        })
        .count()
}

/// OneDrive.exe está rodando? Usa `tasklist` (sem unsafe/COM). Best-effort: se a
/// consulta falhar, assume rodando (não alarme falso).
#[cfg(windows)]
fn processo_rodando() -> bool {
    use std::process::Command;

    let saida = Command::new("tasklist")
        .args(["/FI", "IMAGENAME eq OneDrive.exe", "/NH"])
        .output();
    match saida {
        Ok(o) => {
            let txt = String::from_utf8_lossy(&o.stdout).to_ascii_lowercase();
            txt.contains("onedrive.exe")
        }
        // Sem conseguir consultar: não gera alarme falso (assume ok).
        Err(_) => true,
    }
}
