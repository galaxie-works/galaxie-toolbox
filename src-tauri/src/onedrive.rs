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

/// Decide o OneDriveSync a partir dos dois sinais brutos (contas + processo).
/// Pura, cross-platform: sem contas → naoConfigurado; com contas → ok/pausado
/// conforme o processo. Extraida de `sondar` pra ser testavel sem registry.
fn montar_estado(contas: usize, rodando: bool) -> OneDriveSync {
    if contas == 0 {
        return OneDriveSync::nao_configurado();
    }
    OneDriveSync {
        estado: if rodando { "ok" } else { "pausado" }.to_string(),
        contas,
        ultimo_erro: None,
    }
}

/// Lê o estado local do OneDrive. Fora do Windows (ou sem contas) → naoConfigurado.
pub fn sondar() -> OneDriveSync {
    #[cfg(windows)]
    {
        // Preserva o short-circuit: so consulta o processo se ha contas.
        let contas = contas_configuradas();
        let rodando = contas > 0 && processo_rodando();
        montar_estado(contas, rodando)
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn montar_estado_sem_contas_e_nao_configurado() {
        // borda: 0 contas -> naoConfigurado (ignora o sinal de processo).
        let s = montar_estado(0, true);
        assert_eq!(s.estado, "naoConfigurado");
        assert_eq!(s.contas, 0);
        assert!(s.ultimo_erro.is_none());
    }

    #[test]
    fn montar_estado_com_contas_reflete_o_processo() {
        // processo rodando -> ok; parado -> pausado; contas preservado.
        let ok = montar_estado(2, true);
        assert_eq!(ok.estado, "ok");
        assert_eq!(ok.contas, 2);

        let pausado = montar_estado(2, false);
        assert_eq!(pausado.estado, "pausado");
        assert_eq!(pausado.contas, 2);
    }
}
