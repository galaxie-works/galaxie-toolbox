//! Privileged interactive-session worker bootstrap for Remote S7.
//!
//! The Delphi broker owns SCM/session/IPC. This worker verifies that it still
//! runs as LocalSystem in the requested session, attaches its capture thread to
//! the selected input desktop, and exposes deterministic state transitions for
//! the capture/transport driver. The S8 session owner supplies signaling/session
//! material later; no credential crosses the S7 broker pipe.

use std::str::FromStr;

/// Canal de sessão worker↔owner (S7 #690, passo 2 §9) — handshake + autoridade.
pub mod session_channel;

/// Servidor do named pipe de sessão + DACL + presença local (S7 #690, passo 2b-io).
pub mod pipe_server;

/// Enforcement de capability por-frame, fail-closed (S7 #690, passo 3 — porteiro).
pub mod autorizacao;

/// Porteiro de comandos do pipe SYSTEM pós-`helloAck`, default-deny (S7.1 #1456, AC6).
pub mod comando;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum DesktopMode {
    Auto,
    Default,
    Winlogon,
}

impl DesktopMode {
    pub const fn wire_name(self) -> &'static str {
        match self {
            Self::Auto => "auto",
            Self::Default => "default",
            Self::Winlogon => "winlogon",
        }
    }
}

impl FromStr for DesktopMode {
    type Err = AgentError;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "auto" => Ok(Self::Auto),
            "default" => Ok(Self::Default),
            "winlogon" => Ok(Self::Winlogon),
            other => Err(AgentError::Argument(format!(
                "desktop must be auto|default|winlogon, got {other}"
            ))),
        }
    }
}

#[derive(Debug, Eq, PartialEq)]
pub struct AgentArgs {
    pub session_id: u32,
    pub desktop: DesktopMode,
    pub stop_event: String,
}

impl AgentArgs {
    pub fn parse<I, S>(args: I) -> Result<Self, AgentError>
    where
        I: IntoIterator<Item = S>,
        S: Into<String>,
    {
        let mut args = args.into_iter().map(Into::into);
        let mut session_id = None;
        let mut desktop = None;
        let mut stop_event = None;
        while let Some(flag) = args.next() {
            let value = args
                .next()
                .ok_or_else(|| AgentError::Argument(format!("missing value for {flag}")))?;
            match flag.as_str() {
                "--session-id" => {
                    session_id =
                        Some(value.parse().map_err(|_| {
                            AgentError::Argument("session id must be a u32".into())
                        })?);
                }
                "--desktop" => desktop = Some(value.parse()?),
                "--stop-event" => stop_event = Some(value),
                _ => return Err(AgentError::Argument(format!("unknown argument: {flag}"))),
            }
        }
        Ok(Self {
            session_id: session_id
                .ok_or_else(|| AgentError::Argument("--session-id is required".into()))?,
            desktop: desktop.ok_or_else(|| AgentError::Argument("--desktop is required".into()))?,
            stop_event: stop_event
                .filter(|value| !value.is_empty())
                .ok_or_else(|| AgentError::Argument("--stop-event is required".into()))?,
        })
    }
}

#[derive(Debug, thiserror::Error)]
pub enum AgentError {
    #[error("argument: {0}")]
    Argument(String),
    #[error("worker must run as LocalSystem")]
    NotSystem,
    #[error("worker session mismatch: expected {expected}, actual {actual}")]
    SessionMismatch { expected: u32, actual: u32 },
    #[error("Windows: {0}")]
    Windows(String),
    #[error("desktop name is not valid UTF-16")]
    DesktopName,
}

#[cfg(windows)]
pub mod windows_runtime {
    use std::ffi::c_void;
    use std::mem;
    use std::time::Duration;

    use serde::Serialize;
    use windows::Win32::Foundation::{CloseHandle, HANDLE, WAIT_OBJECT_0};
    use windows::Win32::Security::{
        GetTokenInformation, IsWellKnownSid, TOKEN_QUERY, TOKEN_USER, TokenUser, WinLocalSystemSid,
    };
    use windows::Win32::System::RemoteDesktop::ProcessIdToSessionId;
    use windows::Win32::System::StationsAndDesktops::{
        CloseDesktop, DESKTOP_CONTROL_FLAGS, DESKTOP_CREATEWINDOW, DESKTOP_ENUMERATE,
        DESKTOP_READOBJECTS, DESKTOP_SWITCHDESKTOP, DESKTOP_WRITEOBJECTS,
        GetUserObjectInformationW, HDESK, OpenDesktopW, OpenInputDesktop, SetThreadDesktop,
        UOI_NAME,
    };
    use windows::Win32::System::Threading::{
        GetCurrentProcess, GetCurrentProcessId, OpenEventW, OpenProcessToken,
        SYNCHRONIZATION_ACCESS_RIGHTS, WaitForSingleObject,
    };
    use windows::core::PCWSTR;

    use crate::{AgentArgs, AgentError, DesktopMode};

    const POLL_INTERVAL: Duration = Duration::from_millis(250);

    #[derive(Debug, Serialize)]
    #[serde(rename_all = "camelCase")]
    pub struct DesktopState<'a> {
        pub event: &'a str,
        pub session_id: u32,
        pub desktop: &'a str,
        pub system: bool,
    }

    struct DesktopHandle(HDESK);

    impl Drop for DesktopHandle {
        fn drop(&mut self) {
            unsafe {
                let _ = CloseDesktop(self.0);
            }
        }
    }

    struct KernelHandle(HANDLE);

    impl Drop for KernelHandle {
        fn drop(&mut self) {
            unsafe {
                let _ = CloseHandle(self.0);
            }
        }
    }

    fn win_error(error: windows::core::Error) -> AgentError {
        AgentError::Windows(error.to_string())
    }

    fn verify_system_identity() -> Result<(), AgentError> {
        let mut token = HANDLE::default();
        unsafe { OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &raw mut token) }
            .map_err(win_error)?;
        let token = KernelHandle(token);
        let mut needed = 0;
        let _ = unsafe { GetTokenInformation(token.0, TokenUser, None, 0, &raw mut needed) };
        if needed < u32::try_from(mem::size_of::<TOKEN_USER>()).unwrap_or(u32::MAX) {
            return Err(AgentError::NotSystem);
        }
        let mut buffer = vec![0u8; usize::try_from(needed).map_err(|_| AgentError::NotSystem)?];
        unsafe {
            GetTokenInformation(
                token.0,
                TokenUser,
                Some(buffer.as_mut_ptr().cast::<c_void>()),
                needed,
                &raw mut needed,
            )
        }
        .map_err(win_error)?;
        let user = unsafe { &*buffer.as_ptr().cast::<TOKEN_USER>() };
        if unsafe { IsWellKnownSid(user.User.Sid, WinLocalSystemSid) }.as_bool() {
            Ok(())
        } else {
            Err(AgentError::NotSystem)
        }
    }

    fn verify_session(expected: u32) -> Result<(), AgentError> {
        let mut actual = 0;
        unsafe { ProcessIdToSessionId(GetCurrentProcessId(), &raw mut actual) }
            .map_err(win_error)?;
        if actual == expected {
            Ok(())
        } else {
            Err(AgentError::SessionMismatch { expected, actual })
        }
    }

    fn desktop_access() -> u32 {
        DESKTOP_CREATEWINDOW.0
            | DESKTOP_ENUMERATE.0
            | DESKTOP_READOBJECTS.0
            | DESKTOP_SWITCHDESKTOP.0
            | DESKTOP_WRITEOBJECTS.0
    }

    fn open_desktop(mode: DesktopMode) -> Result<DesktopHandle, AgentError> {
        let desktop = match mode {
            DesktopMode::Auto => unsafe {
                OpenInputDesktop(
                    DESKTOP_CONTROL_FLAGS(0),
                    false,
                    windows::Win32::System::StationsAndDesktops::DESKTOP_ACCESS_FLAGS(
                        desktop_access(),
                    ),
                )
            },
            DesktopMode::Default | DesktopMode::Winlogon => {
                let name: Vec<u16> = match mode {
                    DesktopMode::Default => "default",
                    DesktopMode::Winlogon => "winlogon",
                    DesktopMode::Auto => unreachable!(),
                }
                .encode_utf16()
                .chain(Some(0))
                .collect();
                unsafe {
                    OpenDesktopW(
                        PCWSTR(name.as_ptr()),
                        DESKTOP_CONTROL_FLAGS(0),
                        false,
                        desktop_access(),
                    )
                }
            }
        }
        .map_err(win_error)?;
        Ok(DesktopHandle(desktop))
    }

    fn desktop_name(desktop: HDESK) -> Result<String, AgentError> {
        let mut needed = 0;
        let _ = unsafe {
            GetUserObjectInformationW(HANDLE(desktop.0), UOI_NAME, None, 0, Some(&raw mut needed))
        };
        if needed < 2 {
            return Err(AgentError::DesktopName);
        }
        let mut buffer = vec![0u16; usize::try_from(needed.div_ceil(2)).unwrap_or(0)];
        unsafe {
            GetUserObjectInformationW(
                HANDLE(desktop.0),
                UOI_NAME,
                Some(buffer.as_mut_ptr().cast()),
                needed,
                Some(&raw mut needed),
            )
        }
        .map_err(win_error)?;
        let end = buffer
            .iter()
            .position(|unit| *unit == 0)
            .unwrap_or(buffer.len());
        String::from_utf16(&buffer[..end]).map_err(|_| AgentError::DesktopName)
    }

    /// Loop do worker LocalSystem: valida identidade/sessão, troca de desktop e
    /// mantém o contexto de captura vivo até o `stop_event`.
    ///
    /// ⚠️ #1070 RB4: este `run` **NÃO cria o pipe de sessão nem verifica o ticket** —
    /// o [`crate::pipe_server::PipeServer`] existe, é testado, e fica **não-integrado**
    /// (marcado no doc dele) até o wiring do worker↔owner do S7 #690. Não confundir a
    /// ausência do fio com abandono: é espera.
    pub fn run(args: &AgentArgs) -> Result<(), AgentError> {
        verify_system_identity()?;
        verify_session(args.session_id)?;

        let stop_event: Vec<u16> = args.stop_event.encode_utf16().chain(Some(0)).collect();
        let stop = unsafe {
            OpenEventW(
                SYNCHRONIZATION_ACCESS_RIGHTS(0x0010_0000),
                false,
                PCWSTR(stop_event.as_ptr()),
            )
        }
        .map(KernelHandle)
        .map_err(win_error)?;

        let mut current_name = String::new();
        let mut current_desktop: Option<DesktopHandle> = None;
        loop {
            if unsafe { WaitForSingleObject(stop.0, 0) } == WAIT_OBJECT_0 {
                return Ok(());
            }
            let desktop = open_desktop(args.desktop)?;
            let name = desktop_name(desktop.0)?;
            if name != current_name {
                unsafe { SetThreadDesktop(desktop.0) }.map_err(win_error)?;
                current_name.clone_from(&name);
                current_desktop = Some(desktop);
                println!(
                    "{}",
                    serde_json::to_string(&DesktopState {
                        event: "desktop.changed",
                        session_id: args.session_id,
                        desktop: &name,
                        system: true,
                    })
                    .map_err(|error| AgentError::Windows(error.to_string()))?
                );
                // The capture driver is initialized on this same thread after
                // the desktop attach. S8 supplies the authenticated session.
            }
            let _ = &current_desktop;
            std::thread::sleep(POLL_INTERVAL);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_fixed_arguments() {
        let args = AgentArgs::parse([
            "--session-id",
            "7",
            "--desktop",
            "auto",
            "--stop-event",
            r"Global\Galaxie.Remote.Agent.Stop.7",
        ])
        .unwrap();
        assert_eq!(args.session_id, 7);
        assert_eq!(args.desktop, DesktopMode::Auto);
    }

    #[test]
    fn rejects_arbitrary_arguments() {
        let error = AgentArgs::parse(["--exec", "cmd.exe"]).unwrap_err();
        assert!(error.to_string().contains("unknown argument"));
    }

    #[test]
    fn desktop_mode_is_closed_enum() {
        assert!(matches!("winlogon".parse(), Ok(DesktopMode::Winlogon)));
        assert!("secure".parse::<DesktopMode>().is_err());
    }
}
