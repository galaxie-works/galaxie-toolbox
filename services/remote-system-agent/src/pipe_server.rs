//! Servidor do named pipe de sessão worker↔owner (S7 #690, **passo 2b-io**).
//!
//! O núcleo de handshake ([`crate::session_channel`]) é puro e já decide
//! aceitar/recusar a partir de OUTCOMES. Este módulo é o **I/O que produz esses
//! outcomes**: cria o pipe com a **DACL restrita** (§4.1), aceita o owner, lê o
//! `hello` (teto 64 KiB), e resolve a [`PresencaLocal`] (PID→sessão +
//! Authenticode). A conectividade real (owner assinado conectando) é runtime do
//! Wagner — aqui o que é testável é o **construtor da DACL** (SDDL), e o resto é
//! `cfg(windows)` compilado.

use crate::session_channel::PresencaLocal;

/// Logon SID recusado por não casar `^S-1-[0-9-]+$` (#1073 RB13).
#[derive(Debug, PartialEq, Eq)]
pub struct SidInvalido(pub String);

impl std::fmt::Display for SidInvalido {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "logon SID malformado (esperado ^S-1-[0-9-]+$): {:?}", self.0)
    }
}

impl std::error::Error for SidInvalido {}

/// #1073 (RB13): valida o formato do SID ANTES de interpolar no SDDL. Casa
/// `^S-1-[0-9-]+$` — só o prefixo `S-1-` seguido de dígitos e hífens. Barra qualquer
/// metacaractere de SDDL (`)`, `(`, `;`, espaço, …) que fecharia o nosso ACE e
/// injetaria outro (ex.: abrir pra `WD`/Everyone). Sem regex (crate sem essa dep).
fn sid_valido(sid: &str) -> bool {
    match sid.strip_prefix("S-1-") {
        Some(resto) => !resto.is_empty() && resto.bytes().all(|b| b.is_ascii_digit() || b == b'-'),
        None => false,
    }
}

/// SDDL da DACL do pipe (§4.1): **SYSTEM + o Logon SID da sessão ativa APENAS**,
/// protegida (`P` = sem herança). Sem ACE pra rede/outras sessões ⇒ negado por
/// omissão. `GA` = GENERIC_ALL (o worker é dono; o owner precisa ler/escrever).
///
/// #1073 (RB13): `Result` — `logon_sid` malformado é RECUSADO (anti-injeção de DACL),
/// nunca interpolado cru.
pub fn dacl_sddl(logon_sid: &str) -> Result<String, SidInvalido> {
    if !sid_valido(logon_sid) {
        return Err(SidInvalido(logon_sid.to_string()));
    }
    Ok(format!("D:P(A;;GA;;;SY)(A;;GA;;;{logon_sid})"))
}

#[cfg(windows)]
pub use win::*;

#[cfg(windows)]
mod win {
    use super::{dacl_sddl, PresencaLocal};
    use crate::session_channel::{parse_mensagem, Hello, MAX_MESSAGE_BYTES};
    use std::io;
    use windows::core::{PCWSTR, PWSTR};
    use windows::Win32::Foundation::{CloseHandle, HANDLE, LocalFree, HLOCAL};
    use windows::Win32::Security::Authorization::{
        ConvertStringSecurityDescriptorToSecurityDescriptorW, SDDL_REVISION_1,
    };
    use windows::Win32::Security::PSECURITY_DESCRIPTOR;
    use windows::Win32::Security::SECURITY_ATTRIBUTES;
    use windows::Win32::Security::WinTrust::{
        WinVerifyTrust, WINTRUST_ACTION_GENERIC_VERIFY_V2, WINTRUST_DATA, WINTRUST_FILE_INFO,
        WTD_CHOICE_FILE, WTD_REVOKE_NONE, WTD_STATEACTION_CLOSE, WTD_STATEACTION_VERIFY,
        WTD_UI_NONE,
    };
    use windows::Win32::Storage::FileSystem::{ReadFile, PIPE_ACCESS_DUPLEX};
    use windows::Win32::System::Pipes::{
        ConnectNamedPipe, CreateNamedPipeW, GetNamedPipeClientProcessId, PIPE_READMODE_MESSAGE,
        PIPE_REJECT_REMOTE_CLIENTS, PIPE_TYPE_MESSAGE, PIPE_WAIT,
    };
    use windows::Win32::System::RemoteDesktop::ProcessIdToSessionId;
    use windows::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_FORMAT, PROCESS_QUERY_LIMITED_INFORMATION,
    };

    fn to_wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(std::iter::once(0)).collect()
    }

    fn last_err(ctx: &str) -> io::Error {
        io::Error::new(io::ErrorKind::Other, format!("{ctx}: {}", io::Error::last_os_error()))
    }

    /// Descritor de segurança do SDDL, dono do buffer (LocalFree no Drop).
    struct SecDesc(PSECURITY_DESCRIPTOR);
    impl Drop for SecDesc {
        fn drop(&mut self) {
            if !self.0 .0.is_null() {
                unsafe {
                    let _ = LocalFree(Some(HLOCAL(self.0 .0)));
                }
            }
        }
    }

    /// Servidor do pipe de sessão: cria com a DACL da §4.1 e serve UMA conexão.
    pub struct PipeServer {
        handle: HANDLE,
        _sd: SecDesc,
    }

    impl PipeServer {
        /// Cria o pipe `\\.\pipe\Galaxie.Remote.Worker.<sid>.<nonce>` com a DACL
        /// SYSTEM+LogonSID, message-mode, sem clientes remotos, teto 64 KiB.
        pub fn criar(nome_pipe: &str, logon_sid: &str) -> io::Result<Self> {
            // #1073 (RB13): SID validado ANTES do SDDL — malformado vira erro, não DACL.
            let sddl_str = dacl_sddl(logon_sid)
                .map_err(|e| io::Error::new(io::ErrorKind::InvalidInput, e.to_string()))?;
            let sddl = to_wide(&sddl_str);
            let mut psd = PSECURITY_DESCRIPTOR::default();
            unsafe {
                ConvertStringSecurityDescriptorToSecurityDescriptorW(
                    PCWSTR(sddl.as_ptr()),
                    SDDL_REVISION_1,
                    &mut psd,
                    None,
                )
            }
            .map_err(|e| io::Error::new(io::ErrorKind::Other, format!("SDDL: {e}")))?;
            let sd = SecDesc(psd);

            let sa = SECURITY_ATTRIBUTES {
                nLength: u32::try_from(std::mem::size_of::<SECURITY_ATTRIBUTES>()).unwrap_or(0),
                lpSecurityDescriptor: psd.0,
                bInheritHandle: false.into(),
            };
            let nome = to_wide(nome_pipe);
            let handle = unsafe {
                CreateNamedPipeW(
                    PCWSTR(nome.as_ptr()),
                    PIPE_ACCESS_DUPLEX,
                    PIPE_TYPE_MESSAGE | PIPE_READMODE_MESSAGE | PIPE_WAIT | PIPE_REJECT_REMOTE_CLIENTS,
                    1, // uma instância: uma sessão, um owner
                    MAX_MESSAGE_BYTES as u32,
                    MAX_MESSAGE_BYTES as u32,
                    0,
                    Some(&sa),
                )
            };
            if handle.is_invalid() {
                return Err(last_err("CreateNamedPipeW"));
            }
            Ok(Self { handle, _sd: sd })
        }

        /// Bloqueia até o owner conectar.
        pub fn aceitar(&self) -> io::Result<()> {
            unsafe { ConnectNamedPipe(self.handle, None) }
                .map_err(|e| io::Error::new(io::ErrorKind::Other, format!("ConnectNamedPipe: {e}")))
        }

        /// Lê UMA mensagem (teto 64 KiB) e desserializa o `hello` (estrito).
        pub fn ler_hello(&self) -> io::Result<Hello> {
            let mut buf = vec![0u8; MAX_MESSAGE_BYTES];
            let mut lidos = 0u32;
            unsafe { ReadFile(self.handle, Some(&mut buf), Some(&mut lidos), None) }
                .map_err(|e| io::Error::new(io::ErrorKind::Other, format!("ReadFile: {e}")))?;
            buf.truncate(lidos as usize);
            parse_mensagem::<Hello>(&buf)
                .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e.to_string()))
        }

        /// PID do cliente conectado.
        pub fn client_pid(&self) -> io::Result<u32> {
            let mut pid = 0u32;
            unsafe { GetNamedPipeClientProcessId(self.handle, &mut pid) }
                .map_err(|e| io::Error::new(io::ErrorKind::Other, format!("GetNamedPipeClientProcessId: {e}")))?;
            Ok(pid)
        }

        /// Resolve a [`PresencaLocal`] do owner conectado: sessão do PID +
        /// Authenticode da imagem. É o OUTCOME que o `validar_hello` consome.
        pub fn presenca_local(&self) -> io::Result<PresencaLocal> {
            let pid = self.client_pid()?;
            let mut session = 0u32;
            unsafe { ProcessIdToSessionId(pid, &mut session) }
                .map_err(|e| io::Error::new(io::ErrorKind::Other, format!("ProcessIdToSessionId: {e}")))?;
            Ok(PresencaLocal {
                owner_session_id: session,
                authenticode_ok: authenticode_ok(pid),
            })
        }
    }

    impl Drop for PipeServer {
        fn drop(&mut self) {
            unsafe {
                let _ = CloseHandle(self.handle);
            }
        }
    }

    /// Caminho da imagem do processo (`QueryFullProcessImageNameW`).
    fn caminho_imagem(pid: u32) -> io::Result<Vec<u16>> {
        let proc = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) }
            .map_err(|e| io::Error::new(io::ErrorKind::Other, format!("OpenProcess: {e}")))?;
        let mut buf = vec![0u16; 32_768];
        let mut tam = buf.len() as u32;
        let r = unsafe {
            QueryFullProcessImageNameW(proc, PROCESS_NAME_FORMAT(0), PWSTR(buf.as_mut_ptr()), &mut tam)
        };
        unsafe {
            let _ = CloseHandle(proc);
        }
        r.map_err(|e| io::Error::new(io::ErrorKind::Other, format!("QueryFullProcessImageNameW: {e}")))?;
        buf.truncate(tam as usize + 1);
        Ok(buf)
    }

    /// Authenticode do binário do owner (`WinVerifyTrust`), **fail-closed**: erro
    /// pra resolver o caminho ou verificar ⇒ `false`. É o gate de que o cliente é
    /// um binário GALAXIE assinado, não um processo qualquer do usuário.
    pub fn authenticode_ok(pid: u32) -> bool {
        let Ok(caminho) = caminho_imagem(pid) else {
            return false;
        };
        let mut file_info = WINTRUST_FILE_INFO {
            cbStruct: u32::try_from(std::mem::size_of::<WINTRUST_FILE_INFO>()).unwrap_or(0),
            pcwszFilePath: PCWSTR(caminho.as_ptr()),
            hFile: Default::default(),
            pgKnownSubject: std::ptr::null_mut(),
        };
        let mut data = WINTRUST_DATA {
            cbStruct: u32::try_from(std::mem::size_of::<WINTRUST_DATA>()).unwrap_or(0),
            dwUIChoice: WTD_UI_NONE,
            fdwRevocationChecks: WTD_REVOKE_NONE,
            dwUnionChoice: WTD_CHOICE_FILE,
            dwStateAction: WTD_STATEACTION_VERIFY,
            ..Default::default()
        };
        data.Anonymous.pFile = &mut file_info;
        let mut action = WINTRUST_ACTION_GENERIC_VERIFY_V2;
        let status = unsafe {
            WinVerifyTrust(
                Default::default(),
                &mut action,
                &mut data as *mut _ as *mut core::ffi::c_void,
            )
        };
        // fecha o estado (obrigatório após VERIFY).
        data.dwStateAction = WTD_STATEACTION_CLOSE;
        unsafe {
            let _ = WinVerifyTrust(
                Default::default(),
                &mut action,
                &mut data as *mut _ as *mut core::ffi::c_void,
            );
        }
        status == 0 // ERROR_SUCCESS = assinatura confiável
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sddl_tem_system_e_o_logon_sid_e_nega_o_resto() {
        let sid = "S-1-5-5-0-1234567";
        let s = dacl_sddl(sid).expect("SID bem-formado");
        assert_eq!(s, format!("D:P(A;;GA;;;SY)(A;;GA;;;{sid})"));
        assert!(s.contains(";;SY)"), "tem SYSTEM");
        assert!(s.contains(&format!(";;{sid})")), "tem o Logon SID da sessão");
        // protegida (sem herança) e SEM Everyone/World/Authenticated-Users.
        assert!(s.starts_with("D:P"), "DACL protegida (P)");
        for aberto in [";;WD)", ";;AU)", ";;BU)"] {
            assert!(!s.contains(aberto), "não pode ter ACE aberta {aberto}");
        }
    }

    /// #1073 (RB13, adversarial): SID com metacaractere de SDDL é RECUSADO — nunca
    /// gera DACL malformada/injetada. É a prova de que a validação fecha a injeção.
    #[test]
    fn sid_malformado_e_rejeitado_sem_gerar_sddl() {
        for ruim in [
            "S-1-5-21)(A;;GA;;;WD",       // fecha nosso ACE e injeta Everyone
            "S-1-5-21;;GA;;;WD",          // `;` quebra o campo do ACE
            "S-1-5-21 1177238915",        // espaço
            "S-1-5-(21)",                 // parênteses
            "S-1-5-21\t512",              // tab
            "WD",                          // não começa com S-1-
            "S-1-",                        // vazio após o prefixo
            "",                            // vazio
            "s-1-5-21",                    // minúsculo
            "X-1-5-21",                    // prefixo errado
            "S-1-5-21;",                   // termina com `;`
        ] {
            assert!(
                dacl_sddl(ruim).is_err(),
                "{ruim:?} devia ser recusado (anti-injeção de DACL)"
            );
        }

        // SID legítimo (com vários hífens) passa e gera a DACL protegida, sem ACE aberta.
        let ok = dacl_sddl("S-1-5-21-1004336348-1177238915-682003330-512")
            .expect("SID bem-formado deve passar");
        assert!(ok.starts_with("D:P("), "DACL protegida");
        assert!(!ok.contains(";;WD)"), "sem Everyone");
    }
}
