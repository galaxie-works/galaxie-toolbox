//! Cliente Rust do **broker pipe congelado** do S7 —
//! `\\.\pipe\Galaxie.Remote.System.v1` (#690, passo 1 da §9 do design
//! worker↔owner). É o lado **owner** (Tauri): fala o protocolo v1 com o broker
//! Delphi pra bootstrap do worker privilegiado. NÃO carrega mídia/signaling.
//!
//! O núcleo (protocolo + [`BrokerClient`] sobre [`BrokerTransport`]) é
//! platform-agnostic e testável sem broker (mock). O transporte de named pipe
//! real fica em [`windows_pipe`], atrás de `cfg(windows)`.
//!
//! **Postura de parsing (do design §5):** nossas REQUESTS são estritas; as
//! RESPOSTAS do broker são lidas **tolerantes a campos novos** (é fronteira de
//! outro time — o Delphi do Wagner), inclusive o campo aditivo `{workerPipe,
//! nonce, workerPid}` do `agent.ensure` que ainda não landou no lado Delphi (§10).
//!
//! ⚠️ **NÃO INTEGRADO (#1070 RB5 — decisão do `Altair` no #1234).** Este crate é
//! **compilado e testado no CI**, mas tem **ZERO consumidor no repo inteiro** (busca em
//! `.rs`/`.toml` fora do próprio crate): o lado owner (Tauri) ainda não chama o
//! `BrokerClient` pra bootstrapar o worker. É código **verificado esperando um fio** (o
//! wiring do S7 #690, cujo design #937 já está CLOSED — tem destino, é espera, não
//! abandono), NÃO código morto — por isso é MARCADO, não apagado.

use serde::{Deserialize, Serialize};

/// Nome do pipe congelado do broker (message-mode, JSON UTF-8, 64 KiB).
pub const BROKER_PIPE: &str = r"\\.\pipe\Galaxie.Remote.System.v1";
pub const PROTOCOL_VERSION: u16 = 1;
pub const MAX_MESSAGE_BYTES: usize = 64 * 1024;

/// Desktop alvo do worker — espelha o `DesktopMode` do `remote-system-agent`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
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

// ───────────────────────── envelope ─────────────────────────

#[derive(Debug, Serialize)]
struct RequestEnvelope<'a> {
    v: u16,
    id: String,
    #[serde(rename = "type")]
    kind: &'a str, // sempre "request"
    method: &'a str,
    payload: serde_json::Value,
}

/// Resposta do broker — **tolerante** (sem `deny_unknown_fields`): o Delphi pode
/// crescer o `result`/campos sem quebrar o owner.
#[derive(Debug, Deserialize)]
struct ResponseEnvelope {
    #[serde(rename = "type")]
    kind: String,
    #[serde(default)]
    ok: bool,
    #[serde(default)]
    result: serde_json::Value,
    #[serde(default)]
    error: Option<BrokerErrorBody>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct BrokerErrorBody {
    pub code: String,
    #[serde(default)]
    pub message: String,
    #[serde(default)]
    pub retryable: bool,
}

// ───────────────────────── resultados tipados ─────────────────────────

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct HelloAck {
    nonce: String,
}

/// `service.status` do broker (`RemoteSystem.Session.pas`). Tolerante a campos novos.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceStatus {
    pub service: String,
    #[serde(default)]
    pub agent_running: bool,
    pub agent_session_id: Option<u32>,
    pub active_session_id: Option<u32>,
    #[serde(default)]
    pub desktop_mode: String,
    #[serde(default)]
    pub worker_pid: u32,
    #[serde(default)]
    pub last_error: String,
}

/// `agent.ensure` — as **coordenadas do canal de sessão** (§4.2). O campo aditivo
/// (`workerPipe`/`nonce`/`workerPid`) é a extensão do Delphi da §10 do design, que
/// **ainda não landou** — por isso `Option`: o cliente lê tolerante e sinaliza
/// quando ausente. Os demais campos do `result` (agentSessionId etc.) são ignorados.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentEnsure {
    #[serde(default)]
    pub worker_pipe: Option<String>,
    #[serde(default)]
    pub nonce: Option<String>,
    #[serde(default)]
    pub worker_pid: Option<u32>,
}

impl AgentEnsure {
    /// `true` quando o broker já devolve as coordenadas do canal (Delphi da §10 landou).
    pub fn tem_coordenadas(&self) -> bool {
        self.worker_pipe.is_some() && self.nonce.is_some()
    }
}

// ───────────────────────── erros ─────────────────────────

#[derive(Debug, thiserror::Error)]
pub enum BrokerClientError {
    #[error("i/o do pipe: {0}")]
    Io(String),
    #[error("mensagem excede 64 KiB ({0} bytes)")]
    TooLarge(usize),
    #[error("json: {0}")]
    Json(String),
    #[error("broker recusou [{code}]: {message} (retryable={retryable})")]
    Broker {
        code: String,
        message: String,
        retryable: bool,
    },
    #[error("handshake: broker não refletiu o nonce (esperado {esperado}, veio {veio:?})")]
    NonceMismatch {
        esperado: String,
        veio: Option<String>,
    },
    #[error("resposta inesperada do broker: {0}")]
    Unexpected(String),
    #[error("chame hello() antes deste método (handshake não feito)")]
    SemHandshake,
}

// ───────────────────────── transporte ─────────────────────────

/// Transporte message-mode: cada `send` é uma mensagem, cada `recv` devolve uma.
/// O broker pipe é `PIPE_TYPE_MESSAGE`; o teste usa um duplo em memória.
pub trait BrokerTransport {
    fn send(&mut self, msg: &[u8]) -> Result<(), BrokerClientError>;
    fn recv(&mut self) -> Result<Vec<u8>, BrokerClientError>;
}

// ───────────────────────── cliente ─────────────────────────

fn novo_id() -> String {
    format!("{:032x}", rand::random::<u128>())
}

/// Cliente do broker sobre um [`BrokerTransport`]. Faz o `hello` uma vez, depois
/// os métodos da allowlist. Nada bloqueia por decisão de PO (design §9, passo 1).
pub struct BrokerClient<T: BrokerTransport> {
    transport: T,
    handshake_ok: bool,
}

impl<T: BrokerTransport> BrokerClient<T> {
    pub fn novo(transport: T) -> Self {
        Self {
            transport,
            handshake_ok: false,
        }
    }

    fn request(
        &mut self,
        method: &str,
        payload: serde_json::Value,
    ) -> Result<serde_json::Value, BrokerClientError> {
        let env = RequestEnvelope {
            v: PROTOCOL_VERSION,
            id: novo_id(),
            kind: "request",
            method,
            payload,
        };
        let raw = serde_json::to_vec(&env).map_err(|e| BrokerClientError::Json(e.to_string()))?;
        if raw.len() > MAX_MESSAGE_BYTES {
            return Err(BrokerClientError::TooLarge(raw.len()));
        }
        self.transport.send(&raw)?;
        let resp_raw = self.transport.recv()?;
        if resp_raw.len() > MAX_MESSAGE_BYTES {
            return Err(BrokerClientError::TooLarge(resp_raw.len()));
        }
        let resp: ResponseEnvelope =
            serde_json::from_slice(&resp_raw).map_err(|e| BrokerClientError::Json(e.to_string()))?;
        if resp.kind != "response" {
            return Err(BrokerClientError::Unexpected(format!(
                "type={} (esperava response)",
                resp.kind
            )));
        }
        if !resp.ok {
            let e = resp.error.unwrap_or(BrokerErrorBody {
                code: "unknown".into(),
                message: String::new(),
                retryable: false,
            });
            return Err(BrokerClientError::Broker {
                code: e.code,
                message: e.message,
                retryable: e.retryable,
            });
        }
        Ok(resp.result)
    }

    fn exigir_handshake(&self) -> Result<(), BrokerClientError> {
        if self.handshake_ok {
            Ok(())
        } else {
            Err(BrokerClientError::SemHandshake)
        }
    }

    /// Primeira request obrigatória: `hello {clientPid, sessionId, nonce}`. O broker
    /// reflete o nonce no `helloAck`; validamos que bate (anti-replay/erro de rota).
    /// `client_pid`/`session_id` vêm do OS (ver [`windows_pipe::identidade_local`]).
    pub fn hello(&mut self, client_pid: u32, session_id: u32) -> Result<(), BrokerClientError> {
        let nonce = novo_id();
        let result = self.request(
            "hello",
            serde_json::json!({ "clientPid": client_pid, "sessionId": session_id, "nonce": nonce }),
        )?;
        let ack: HelloAck =
            serde_json::from_value(result).map_err(|e| BrokerClientError::Json(e.to_string()))?;
        if ack.nonce != nonce {
            return Err(BrokerClientError::NonceMismatch {
                esperado: nonce,
                veio: Some(ack.nonce),
            });
        }
        self.handshake_ok = true;
        Ok(())
    }

    pub fn service_status(&mut self) -> Result<ServiceStatus, BrokerClientError> {
        self.exigir_handshake()?;
        let r = self.request("service.status", serde_json::json!({}))?;
        serde_json::from_value(r).map_err(|e| BrokerClientError::Json(e.to_string()))
    }

    /// Garante o worker na sessão (ou na ativa se `None`) e devolve as coordenadas
    /// do canal de sessão (§4.2). Enquanto o Delphi da §10 não landar o campo
    /// aditivo, `AgentEnsure::tem_coordenadas()` volta `false`.
    pub fn agent_ensure(
        &mut self,
        session_id: Option<u32>,
    ) -> Result<AgentEnsure, BrokerClientError> {
        self.exigir_handshake()?;
        let payload = match session_id {
            Some(s) => serde_json::json!({ "sessionId": s }),
            None => serde_json::json!({}),
        };
        let r = self.request("agent.ensure", payload)?;
        serde_json::from_value(r).map_err(|e| BrokerClientError::Json(e.to_string()))
    }

    pub fn agent_stop(&mut self, session_id: u32) -> Result<(), BrokerClientError> {
        self.exigir_handshake()?;
        self.request("agent.stop", serde_json::json!({ "sessionId": session_id }))?;
        Ok(())
    }

    pub fn desktop_set_mode(
        &mut self,
        session_id: u32,
        mode: DesktopMode,
    ) -> Result<(), BrokerClientError> {
        self.exigir_handshake()?;
        self.request(
            "desktop.setMode",
            serde_json::json!({ "sessionId": session_id, "mode": mode.wire_name() }),
        )?;
        Ok(())
    }
}

// ───────────────────────── transporte real (Windows) ─────────────────────────

#[cfg(windows)]
pub mod windows_pipe {
    use super::{BrokerClientError, BrokerTransport, BROKER_PIPE, MAX_MESSAGE_BYTES};
    use windows::core::PCWSTR;
    use windows::Win32::Foundation::{CloseHandle, HANDLE};
    use windows::Win32::Storage::FileSystem::{
        CreateFileW, ReadFile, WriteFile, FILE_GENERIC_READ, FILE_GENERIC_WRITE, FILE_SHARE_NONE,
        OPEN_EXISTING,
    };
    use windows::Win32::System::Pipes::{SetNamedPipeHandleState, NAMED_PIPE_MODE, PIPE_READMODE_MESSAGE};
    use windows::Win32::System::RemoteDesktop::ProcessIdToSessionId;
    use windows::Win32::System::Threading::GetCurrentProcessId;

    /// PID + session id do processo atual — pro `hello` do broker.
    pub fn identidade_local() -> Result<(u32, u32), BrokerClientError> {
        let pid = unsafe { GetCurrentProcessId() };
        let mut session = 0u32;
        unsafe { ProcessIdToSessionId(pid, &mut session) }
            .map_err(|e| BrokerClientError::Io(e.to_string()))?;
        Ok((pid, session))
    }

    fn to_wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(std::iter::once(0)).collect()
    }

    /// Transporte de named pipe cliente (message-mode) pro broker congelado.
    pub struct PipeTransport {
        handle: HANDLE,
    }

    impl PipeTransport {
        /// Abre o pipe do broker e coloca em modo mensagem.
        pub fn conectar() -> Result<Self, BrokerClientError> {
            let wide = to_wide(BROKER_PIPE);
            let handle = unsafe {
                CreateFileW(
                    PCWSTR(wide.as_ptr()),
                    (FILE_GENERIC_READ | FILE_GENERIC_WRITE).0,
                    FILE_SHARE_NONE,
                    None,
                    OPEN_EXISTING,
                    Default::default(),
                    None,
                )
            }
            .map_err(|e| BrokerClientError::Io(format!("CreateFileW: {e}")))?;

            let mode = NAMED_PIPE_MODE(PIPE_READMODE_MESSAGE.0);
            unsafe { SetNamedPipeHandleState(handle, Some(&mode), None, None) }
                .map_err(|e| BrokerClientError::Io(format!("SetNamedPipeHandleState: {e}")))?;

            Ok(Self { handle })
        }
    }

    impl Drop for PipeTransport {
        fn drop(&mut self) {
            unsafe {
                let _ = CloseHandle(self.handle);
            }
        }
    }

    impl BrokerTransport for PipeTransport {
        fn send(&mut self, msg: &[u8]) -> Result<(), BrokerClientError> {
            if msg.len() > MAX_MESSAGE_BYTES {
                return Err(BrokerClientError::TooLarge(msg.len()));
            }
            let mut written = 0u32;
            unsafe { WriteFile(self.handle, Some(msg), Some(&mut written), None) }
                .map_err(|e| BrokerClientError::Io(format!("WriteFile: {e}")))?;
            Ok(())
        }

        fn recv(&mut self) -> Result<Vec<u8>, BrokerClientError> {
            let mut buf = vec![0u8; MAX_MESSAGE_BYTES];
            let mut read = 0u32;
            unsafe { ReadFile(self.handle, Some(&mut buf), Some(&mut read), None) }
                .map_err(|e| BrokerClientError::Io(format!("ReadFile: {e}")))?;
            buf.truncate(read as usize);
            Ok(buf)
        }
    }
}

// ───────────────────────── testes ─────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::VecDeque;

    /// Duplo do broker: uma fila de respostas cruas + guarda as requests recebidas.
    struct MockBroker {
        respostas: VecDeque<Vec<u8>>,
        enviadas: Vec<serde_json::Value>,
    }

    impl MockBroker {
        fn novo() -> Self {
            Self {
                respostas: VecDeque::new(),
                enviadas: Vec::new(),
            }
        }
        fn responder(&mut self, v: serde_json::Value) {
            self.respostas.push_back(serde_json::to_vec(&v).unwrap());
        }
    }

    impl BrokerTransport for MockBroker {
        fn send(&mut self, msg: &[u8]) -> Result<(), BrokerClientError> {
            self.enviadas.push(serde_json::from_slice(msg).unwrap());
            Ok(())
        }
        fn recv(&mut self) -> Result<Vec<u8>, BrokerClientError> {
            self.respostas
                .pop_front()
                .ok_or_else(|| BrokerClientError::Io("mock sem resposta".into()))
        }
    }

    fn ok(id_reflete: bool, result: serde_json::Value) -> serde_json::Value {
        // o broker real ecoa o id; o cliente não valida id, então tanto faz aqui
        let _ = id_reflete;
        serde_json::json!({ "v": 1, "id": "x", "type": "response", "ok": true, "result": result })
    }

    /// Broker que reflete o nonce enviado no `hello` (caminho feliz do handshake).
    struct RefletidorNonce {
        ultimo_nonce: Option<String>,
    }
    impl BrokerTransport for RefletidorNonce {
        fn send(&mut self, msg: &[u8]) -> Result<(), BrokerClientError> {
            let v: serde_json::Value = serde_json::from_slice(msg).unwrap();
            if v["method"] == "hello" {
                self.ultimo_nonce = Some(v["payload"]["nonce"].as_str().unwrap().to_string());
            }
            Ok(())
        }
        fn recv(&mut self) -> Result<Vec<u8>, BrokerClientError> {
            let nonce = self.ultimo_nonce.clone().unwrap();
            Ok(serde_json::to_vec(&serde_json::json!({
                "v":1,"type":"response","ok":true,"result":{"nonce":nonce}
            }))
            .unwrap())
        }
    }

    #[test]
    fn hello_valida_o_nonce_refletido() {
        let mut c = BrokerClient::novo(RefletidorNonce { ultimo_nonce: None });
        c.hello(1234, 1).expect("hello feliz");
    }

    #[test]
    fn hello_rejeita_nonce_errado() {
        let mut broker = MockBroker::novo();
        broker.responder(ok(true, serde_json::json!({ "nonce": "nonce-que-nao-bate" })));
        let mut c = BrokerClient::novo(broker);
        let e = c.hello(1234, 1).unwrap_err();
        assert!(matches!(e, BrokerClientError::NonceMismatch { .. }));
    }

    #[test]
    fn metodos_exigem_handshake() {
        let broker = MockBroker::novo();
        let mut c = BrokerClient::novo(broker);
        assert!(matches!(
            c.service_status().unwrap_err(),
            BrokerClientError::SemHandshake
        ));
    }

    #[test]
    fn service_status_parseia_a_forma_do_delphi() {
        struct B(VecDeque<serde_json::Value>);
        impl BrokerTransport for B {
            fn send(&mut self, msg: &[u8]) -> Result<(), BrokerClientError> {
                let v: serde_json::Value = serde_json::from_slice(msg).unwrap();
                if v["method"] == "hello" {
                    let n = v["payload"]["nonce"].as_str().unwrap().to_string();
                    self.0
                        .push_front(serde_json::json!({"v":1,"type":"response","ok":true,"result":{"nonce":n}}));
                }
                Ok(())
            }
            fn recv(&mut self) -> Result<Vec<u8>, BrokerClientError> {
                Ok(serde_json::to_vec(&self.0.pop_front().unwrap()).unwrap())
            }
        }
        // service.status enfileirado; o hello injeta o helloAck refletido na frente.
        let mut fila = VecDeque::new();
        fila.push_back(ok(
            true,
            serde_json::json!({
                "service":"running","agentRunning":true,"agentSessionId":2,
                "activeSessionId":2,"desktopMode":"default","workerPid":4242,
                "lastError":"","campoNovoDoFuturo":123
            }),
        ));
        let mut c = BrokerClient::novo(B(fila));
        c.hello(1, 1).unwrap();
        let st = c.service_status().unwrap();
        assert_eq!(st.service, "running");
        assert!(st.agent_running);
        assert_eq!(st.agent_session_id, Some(2));
        assert_eq!(st.worker_pid, 4242);
    }

    #[test]
    fn agent_ensure_tolera_ausencia_das_coordenadas() {
        // Delphi ainda não landou o aditivo → sem workerPipe/nonce; não quebra.
        let ae: AgentEnsure =
            serde_json::from_value(serde_json::json!({ "agentSessionId": 3, "workerPid": 9 }))
                .unwrap();
        assert!(!ae.tem_coordenadas());
        // Com o aditivo presente:
        let ae2: AgentEnsure = serde_json::from_value(serde_json::json!({
            "workerPipe": r"\\.\pipe\Galaxie.Remote.Worker.2.abcd", "nonce": "abcd", "workerPid": 9
        }))
        .unwrap();
        assert!(ae2.tem_coordenadas());
    }

    #[test]
    fn erro_do_broker_vira_erro_tipado() {
        struct B;
        impl BrokerTransport for B {
            fn send(&mut self, _msg: &[u8]) -> Result<(), BrokerClientError> {
                Ok(())
            }
            fn recv(&mut self) -> Result<Vec<u8>, BrokerClientError> {
                Ok(serde_json::to_vec(&serde_json::json!({
                    "v":1,"type":"response","ok":false,
                    "error":{"code":"not_allowed","message":"método bloqueado","retryable":false}
                }))
                .unwrap())
            }
        }
        let mut c = BrokerClient::novo(B);
        // força handshake pra chegar no request de status
        c.handshake_ok = true;
        let e = c.service_status().unwrap_err();
        match e {
            BrokerClientError::Broker { code, .. } => assert_eq!(code, "not_allowed"),
            outro => panic!("esperava Broker, veio {outro:?}"),
        }
    }
}
