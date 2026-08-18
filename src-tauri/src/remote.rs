//! `Galaxie.Remote.App.v1` — fronteira congelada entre o Remote Rust e a UI.
//!
//! O runtime mantém uma única sessão ativa, dirige o `str0m` sans-I/O numa
//! thread dedicada, envia eventos pequenos como JSON e vídeo H.264 Annex-B como
//! bytes crus. O signaling continua na ponte TS/S0; credenciais TURN, SDP e ICE
//! jamais são logados aqui.

use std::collections::HashSet;
use std::net::{IpAddr, SocketAddr, ToSocketAddrs, UdpSocket};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, SyncSender, TryRecvError, TrySendError};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use galaxie_remote_transport::stun::{build_binding_request, parse_xor_mapped_address};
use galaxie_remote_transport::turn::{
    build_allocate_request, build_allocate_request_auth, derive_key, parse_allocate_success,
    parse_error_unauthorized,
};
use galaxie_remote_transport::{
    canal_de_comandos, decode, encode_input, CommandReceiver as TransportCommandReceiver,
    EncoderCommand as TransportEncoderCommand, EventoSessao, Frame as ControlFrame, IceServer,
    InputEvent, Papel, Passo, ScreenInfo, SessionConfig, SignalMessage, Transport,
};
use rand::Rng;
use serde::{Deserialize, Serialize};
use tauri::ipc::{Channel, InvokeResponseBody, Response};

const VIDEO_HEADER_LEN: usize = 17;
const VIDEO_VERSION: u8 = 1;
const VIDEO_KEYFRAME: u64 = 1;
const MAX_SESSION_ID: usize = 128;
const MAX_SIGNAL: usize = 256 * 1024;
const MAX_VIDEO_FRAME: usize = 16 * 1024 * 1024;
const COMMAND_CAPACITY: usize = 64;
const VIDEO_CAPACITY: usize = 2;
const NETWORK_TICK: Duration = Duration::from_millis(10);
const STATS_INTERVAL: Duration = Duration::from_secs(1);
/// #1108 Parte 2: orçamento total de espera pela resposta STUN de CADA servidor no
/// gathering srflx. Curto de propósito — srflx é aditivo e o startup não pode
/// travar esperando um STUN inalcançável (dev/LAN sem coturn).
const SRFLX_GATHER_TIMEOUT: Duration = Duration::from_millis(800);
/// Intervalo de sleep entre `recv_from` no socket NONBLOCKING durante o gathering.
const SRFLX_POLL_INTERVAL: Duration = Duration::from_millis(10);
/// #1130 fatia 2: orçamento de espera por CADA resposta do coturn no handshake
/// Allocate (o fluxo tem 2 round-trips: 401 Unauthorized + Success). Curto de
/// propósito — relay é aditivo e o startup não pode travar esperando um coturn
/// inalcançável. Reusa o `SRFLX_POLL_INTERVAL` no recv NONBLOCKING.
const RELAY_ALLOCATE_TIMEOUT: Duration = Duration::from_millis(1200);

#[derive(Default)]
pub struct RemoteRuntime {
    active: Mutex<Option<ActiveSession>>,
}

struct ActiveSession {
    session_id: String,
    role: RemoteRole,
    capabilities: RemoteCapabilities,
    commands: SyncSender<RuntimeCommand>,
    worker: Option<JoinHandle<()>>,
    finished: Arc<AtomicBool>,
}

impl ActiveSession {
    fn stop(mut self, reason: String) {
        let _ = self.commands.send(RuntimeCommand::End { reason });
        if let Some(worker) = self.worker.take() {
            let _ = worker.join();
        }
    }
}

impl Drop for RemoteRuntime {
    fn drop(&mut self) {
        if let Ok(active) = self.active.get_mut() {
            if let Some(session) = active.take() {
                session.stop("app_shutdown".to_owned());
            }
        }
    }
}

#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum RemoteRole {
    Host,
    Controller,
}

impl RemoteRole {
    fn papel(self) -> Papel {
        match self {
            Self::Host => Papel::Host,
            Self::Controller => Papel::Controlador,
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteSessionStartRequest {
    pub role: RemoteRole,
    pub session_id: String,
    pub signaling: RemoteSignalingBinding,
    #[serde(default)]
    pub ice_servers: Vec<IceServer>,
    pub capabilities: RemoteCapabilities,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteSignalingBinding {
    pub endpoint: String,
    pub peer_id: String,
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteCapabilities {
    pub screen: bool,
    pub input: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteSessionStartResponse {
    pub session_id: String,
    pub state: RemoteSessionState,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum RemoteSessionState {
    Connecting,
    Connected,
    Reconnecting,
    Ended,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", content = "payload", rename_all = "snake_case")]
pub enum RemoteSignal {
    Offer(String),
    Answer(String),
    IceCandidate(String),
}

impl From<SignalMessage> for RemoteSignal {
    fn from(signal: SignalMessage) -> Self {
        match signal {
            SignalMessage::Offer { sdp } => Self::Offer(sdp),
            SignalMessage::Answer { sdp } => Self::Answer(sdp),
            SignalMessage::IceCandidate { candidate } => Self::IceCandidate(candidate),
        }
    }
}

impl From<RemoteSignal> for SignalMessage {
    fn from(signal: RemoteSignal) -> Self {
        match signal {
            RemoteSignal::Offer(sdp) => Self::Offer { sdp },
            RemoteSignal::Answer(sdp) => Self::Answer { sdp },
            RemoteSignal::IceCandidate(candidate) => Self::IceCandidate { candidate },
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum RemoteSessionEvent {
    State {
        state: RemoteSessionState,
        #[serde(skip_serializing_if = "Option::is_none")]
        code: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        message: Option<String>,
    },
    Signal {
        signal: RemoteSignal,
    },
    Screen {
        info: ScreenInfo,
    },
    Stats {
        #[serde(rename = "rttMs")]
        rtt_ms: Option<f64>,
        #[serde(rename = "bitrateBps")]
        bitrate_bps: f64,
        frames: u64,
    },
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteSessionSignalRequest {
    pub session_id: String,
    pub signal: RemoteSignal,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteSessionInputRequest {
    pub session_id: String,
    pub event: InputEvent,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteSessionEndRequest {
    pub session_id: String,
    #[serde(default = "default_end_reason")]
    pub reason: String,
}

fn default_end_reason() -> String {
    "requested".to_owned()
}

#[derive(Debug, thiserror::Error)]
pub(crate) enum RemoteError {
    #[error("session_id inválido")]
    InvalidSessionId,
    #[error("binding de signaling inválido")]
    InvalidSignaling,
    #[error("já existe uma sessão remota ativa")]
    SessionConflict,
    #[error("sessão remota não encontrada")]
    SessionNotFound,
    #[error("comando permitido somente ao controlador")]
    ControllerOnly,
    #[error("capability de input desabilitada")]
    InputDisabled,
    #[error("evento de input não é válido nessa direção")]
    InvalidInputDirection,
    #[error("signal excede o limite")]
    SignalTooLarge,
    #[error("canal da sessão foi encerrado")]
    ChannelClosed,
    #[error("falha no transporte: {0}")]
    Transport(String),
    #[error("falha de rede: {0}")]
    Network(String),
}

impl Serialize for RemoteError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

enum RuntimeCommand {
    Signal(SignalMessage),
    Input(InputEvent),
    End { reason: String },
}

struct RuntimeSession {
    role: RemoteRole,
    capabilities: RemoteCapabilities,
    on_event: Channel<RemoteSessionEvent>,
    video_frames: Option<SyncSender<galaxie_remote_transport::CodedFrame>>,
    video_failed: Arc<AtomicBool>,
    video_worker: Option<JoinHandle<()>>,
    commands: Receiver<RuntimeCommand>,
    transport: Transport,
    socket: UdpSocket,
    local_addr: SocketAddr,
    next_timeout: Option<Instant>,
    last_stats: Instant,
    pressed_keys: HashSet<galaxie_remote_transport::Tecla>,
    pressed_buttons: HashSet<galaxie_remote_transport::BotaoMouse>,
    injector: Option<galaxie_remote_transport::Injector>,
    capture_frames: Option<Receiver<galaxie_remote_capture::CodedFrame>>,
    transport_encoder_commands: TransportCommandReceiver,
    capture_encoder_commands: Option<galaxie_remote_capture::contract::CommandChannel>,
    capture_worker: Option<JoinHandle<()>>,
    terminal_sent: bool,
}

#[tauri::command]
pub fn remote_session_start(
    request: RemoteSessionStartRequest,
    on_event: Channel<RemoteSessionEvent>,
    on_video: Channel<Response>,
    runtime: tauri::State<'_, RemoteRuntime>,
) -> Result<RemoteSessionStartResponse, RemoteError> {
    validate_start(&request)?;
    let mut active = runtime
        .active
        .lock()
        .map_err(|_| RemoteError::ChannelClosed)?;
    if active
        .as_ref()
        .is_some_and(|session| session.finished.load(Ordering::Acquire))
    {
        if let Some(session) = active.take() {
            session.stop("worker_finished".to_owned());
        }
    } else if active.is_some() {
        return Err(RemoteError::SessionConflict);
    }

    let session_id = request.session_id.clone();
    let role = request.role;
    let capabilities = request.capabilities;
    let response = RemoteSessionStartResponse {
        session_id: session_id.clone(),
        state: RemoteSessionState::Connecting,
    };
    let (commands, receiver) = mpsc::sync_channel(COMMAND_CAPACITY);
    let finished = Arc::new(AtomicBool::new(false));
    let finished_worker = Arc::clone(&finished);
    let worker = std::thread::Builder::new()
        .name(format!("remote-{}", thread_label(&session_id)))
        .spawn(move || {
            run_session(request, on_event, on_video, receiver);
            finished_worker.store(true, Ordering::Release);
        })
        .map_err(|e| RemoteError::Transport(e.to_string()))?;
    *active = Some(ActiveSession {
        session_id,
        role,
        capabilities,
        commands,
        worker: Some(worker),
        finished,
    });
    Ok(response)
}

#[tauri::command]
pub fn remote_session_signal(
    request: RemoteSessionSignalRequest,
    runtime: tauri::State<'_, RemoteRuntime>,
) -> Result<(), RemoteError> {
    let signal: SignalMessage = request.signal.into();
    validate_signal(&signal)?;
    send_to_session(
        &runtime,
        &request.session_id,
        RuntimeCommand::Signal(signal),
    )
}

#[tauri::command]
pub fn remote_session_input(
    request: RemoteSessionInputRequest,
    runtime: tauri::State<'_, RemoteRuntime>,
) -> Result<(), RemoteError> {
    if matches!(request.event, InputEvent::Screen { .. }) {
        return Err(RemoteError::InvalidInputDirection);
    }
    let active = runtime
        .active
        .lock()
        .map_err(|_| RemoteError::ChannelClosed)?;
    let session = active.as_ref().ok_or(RemoteError::SessionNotFound)?;
    if session.session_id != request.session_id {
        return Err(RemoteError::SessionNotFound);
    }
    if session.role != RemoteRole::Controller {
        return Err(RemoteError::ControllerOnly);
    }
    if !session.capabilities.input {
        return Err(RemoteError::InputDisabled);
    }
    session
        .commands
        .try_send(RuntimeCommand::Input(request.event))
        .map_err(|_| RemoteError::ChannelClosed)
}

#[tauri::command]
pub fn remote_session_end(
    request: RemoteSessionEndRequest,
    runtime: tauri::State<'_, RemoteRuntime>,
) -> Result<(), RemoteError> {
    let session = {
        let mut active = runtime
            .active
            .lock()
            .map_err(|_| RemoteError::ChannelClosed)?;
        match active.as_ref() {
            None => return Ok(()),
            Some(session) if session.session_id != request.session_id => {
                return Err(RemoteError::SessionNotFound)
            }
            Some(_) => active.take().expect("active checked"),
        }
    };
    session.stop(sanitize_reason(request.reason));
    Ok(())
}

fn send_to_session(
    runtime: &RemoteRuntime,
    session_id: &str,
    command: RuntimeCommand,
) -> Result<(), RemoteError> {
    let active = runtime
        .active
        .lock()
        .map_err(|_| RemoteError::ChannelClosed)?;
    let session = active.as_ref().ok_or(RemoteError::SessionNotFound)?;
    if session.session_id != session_id {
        return Err(RemoteError::SessionNotFound);
    }
    session
        .commands
        .try_send(command)
        .map_err(|_| RemoteError::ChannelClosed)
}

fn validate_start(request: &RemoteSessionStartRequest) -> Result<(), RemoteError> {
    if request.session_id.is_empty()
        || request.session_id.len() > MAX_SESSION_ID
        || !request
            .session_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
    {
        return Err(RemoteError::InvalidSessionId);
    }
    if request.signaling.endpoint.is_empty()
        || request.signaling.endpoint.len() > 2048
        || request.signaling.peer_id.is_empty()
        || request.signaling.peer_id.len() > MAX_SESSION_ID
    {
        return Err(RemoteError::InvalidSignaling);
    }
    Ok(())
}

fn validate_signal(signal: &SignalMessage) -> Result<(), RemoteError> {
    let len = match signal {
        SignalMessage::Offer { sdp } | SignalMessage::Answer { sdp } => sdp.len(),
        SignalMessage::IceCandidate { candidate } => candidate.len(),
    };
    if len == 0 || len > MAX_SIGNAL {
        Err(RemoteError::SignalTooLarge)
    } else {
        Ok(())
    }
}

fn run_session(
    request: RemoteSessionStartRequest,
    on_event: Channel<RemoteSessionEvent>,
    on_video: Channel<Response>,
    commands: Receiver<RuntimeCommand>,
) {
    let error_events = on_event.clone();
    match RuntimeSession::new(request, on_event, on_video, commands) {
        Ok(mut session) => {
            if let Err(error) = session.run() {
                let message = error.to_string();
                session.emit_error("runtime_error", message.clone());
                log::warn!("[remote] sessão encerrada com erro: {message}");
            }
        }
        Err(error) => {
            let message = error.to_string();
            let _ = error_events.send(RemoteSessionEvent::State {
                state: RemoteSessionState::Error,
                code: Some("startup_error".to_owned()),
                message: Some(message.clone()),
            });
            log::warn!("[remote] sessão não iniciou: {message}");
        }
    }
}

impl RuntimeSession {
    fn new(
        request: RemoteSessionStartRequest,
        on_event: Channel<RemoteSessionEvent>,
        on_video: Channel<Response>,
        commands: Receiver<RuntimeCommand>,
    ) -> Result<Self, RemoteError> {
        let socket =
            UdpSocket::bind("0.0.0.0:0").map_err(|e| RemoteError::Network(e.to_string()))?;
        socket
            .set_nonblocking(true)
            .map_err(|e| RemoteError::Network(e.to_string()))?;
        let local_addr = socket
            .local_addr()
            .map_err(|e| RemoteError::Network(e.to_string()))?;
        let injector = if request.role == RemoteRole::Host && request.capabilities.input {
            Some(
                galaxie_remote_transport::Injector::novo(host_screen_info())
                    .map_err(|e| RemoteError::Transport(e.to_string()))?,
            )
        } else {
            None
        };
        let (encoder_commands, transport_encoder_commands) = canal_de_comandos();
        let video_failed = Arc::new(AtomicBool::new(false));
        let (video_frames, video_worker) =
            if request.role == RemoteRole::Controller && request.capabilities.screen {
                let (sender, receiver) = mpsc::sync_channel(VIDEO_CAPACITY);
                let failed = Arc::clone(&video_failed);
                let worker = std::thread::Builder::new()
                    .name(format!(
                        "remote-video-{}",
                        thread_label(&request.session_id)
                    ))
                    .spawn(move || {
                        while let Ok(frame) = receiver.recv() {
                            let Ok(bytes) = encode_video_frame(&frame) else {
                                continue;
                            };
                            if on_video
                                .send(Response::new(InvokeResponseBody::Raw(bytes)))
                                .is_err()
                            {
                                failed.store(true, Ordering::Release);
                                break;
                            }
                        }
                    })
                    .map_err(|e| RemoteError::Transport(e.to_string()))?;
                (Some(sender), Some(worker))
            } else {
                (None, None)
            };
        let (capture_frames, capture_encoder_commands, capture_worker) =
            if request.role == RemoteRole::Host && request.capabilities.screen {
                let (frame_sender, frame_receiver) =
                    galaxie_remote_capture::contract::canal_de_frames(8);
                let (capture_commands, capture_receiver) =
                    galaxie_remote_capture::contract::canal_de_comandos();
                let capture_name = request.session_id.chars().take(16).collect::<String>();
                let worker = std::thread::Builder::new()
                    .name(format!("remote-capture-{capture_name}"))
                    .spawn(move || {
                        #[cfg(windows)]
                        if let Err(error) = galaxie_remote_capture::windows::run_pipeline(
                            galaxie_remote_capture::PipelineConfig::default(),
                            frame_sender,
                            capture_receiver,
                        ) {
                            log::warn!("[remote] pipeline de captura encerrou: {error}");
                        }
                    })
                    .map_err(|e| RemoteError::Transport(e.to_string()))?;
                (Some(frame_receiver), Some(capture_commands), Some(worker))
            } else {
                (None, None, None)
            };
        // #1108 Parte 2 (Confucius): resolve os STUN servers em `SocketAddr` ANTES de
        // mover `request.ice_servers` pro `SessionConfig` — vamos precisar deles pro
        // gathering de candidato srflx logo abaixo (o `SessionConfig` consome o Vec).
        let stun_alvos = resolver_stun_addrs(&request.ice_servers);
        // #1130 fatia 2 (Confucius): resolve os TURN servers UDP em
        // `(SocketAddr, username, credential)` ANTES de mover `ice_servers` pro
        // `SessionConfig` (que consome o Vec) — mesmo motivo do `stun_alvos`. O
        // segredo (`credential`) vai no tuple SÓ pra alimentar o `derive_key` do
        // handshake; NUNCA é logado (aqui nem no `gather_relay`).
        let turn_alvos = resolver_turn_alvos(&request.ice_servers);
        // #1108 (sondagem TURN, Ref): diagnóstico de infra pra decidir o relay — o coturn
        // de prod já entrega credencial TURN efêmera no `ice_servers`, ou os campos vêm
        // vazios (provisionamento pendente no VPS)? Loga SÓ contagem + presença; o
        // `username`/`credential` (o segredo efêmero HMAC) NUNCA é logado. Um servidor
        // conta como "TURN utilizável" só se tem url `turn:`/`turns:` E credencial não-vazia.
        {
            let total = request.ice_servers.len();
            let com_turn_utilizavel = request
                .ice_servers
                .iter()
                .filter(|s| s.tem_turn() && !s.credential.is_empty() && !s.username.is_empty())
                .count();
            let com_stun = request
                .ice_servers
                .iter()
                .filter(|s| s.urls.iter().any(|u| u.starts_with("stun:")))
                .count();
            log::info!(
                "[remote] ice_servers recebidos: {total} servidor(es) ({com_stun} com STUN, \
                 {com_turn_utilizavel} com TURN+credencial preenchida) — segredo NÃO logado \
                 (sondagem #1108: TURN {})",
                if com_turn_utilizavel > 0 { "PRONTO p/ relay" } else { "sem credencial (relay bloqueado)" }
            );
        }
        // #1182: limites do bitrate adaptativo nos defaults (300 kbps..12 Mbps,
        // início 3 Mbps). O BWE do str0m sobe daí conforme a banda dá folga.
        let mut transport = Transport::novo(
            SessionConfig::new(request.role.papel(), request.ice_servers),
            encoder_commands,
        );
        // #1108: o BIND fica em `0.0.0.0` (recebe em todas as interfaces), mas o
        // endereço do bind NÃO é um candidato — só a PORTA importa. Um candidato ICE
        // host tem que carregar um IP de interface REAL; `0.0.0.0` é rejeitado pelo
        // str0m ("invalid ip 0.0.0.0") e mata a sessão no transporte (P0 em prod).
        let porta = local_addr.port();
        let ips_locais = descobrir_ips_locais();
        if ips_locais.is_empty() {
            return Err(RemoteError::Network(
                "nenhum IP de interface válido pra candidato ICE host (só unspecified/loopback)"
                    .to_owned(),
            ));
        }
        // Registra 1 candidato host por IP real (não só o primeiro). O erro nomeia o
        // IP/tipo tentado (AC #1108) via `TransportError::Candidato` do session.rs.
        for ip in &ips_locais {
            let addr = SocketAddr::new(*ip, porta);
            transport.candidato_local(addr).map_err(transport_error)?;
        }

        // #1108 Parte 2: gathering de candidato srflx (server-reflexive) via STUN.
        // O str0m é sans-I/O e NÃO faz esse passo — o app manda o Binding no socket e
        // alimenta o candidato. Rodamos AQUI (DEPOIS dos host, ANTES do offer): o
        // socket ainda está quieto (o ICE do str0m nem começou), então o Binding não
        // colide com o tráfego do str0m. A `base` é um IP de interface REAL com a
        // porta do bind (o 1º IP válido do P1). srflx é ADITIVO e NÃO-fatal: STUN
        // inalcançável (dev/LAN sem coturn) → `gather_srflx` volta vazio e a sessão
        // segue com host-only, exatamente como antes do #1108 Parte 2.
        let base_srflx = SocketAddr::new(ips_locais[0], porta);
        let srflx = gather_srflx(&socket, &stun_alvos, base_srflx);
        for (mapeado, base) in &srflx {
            transport
                .candidato_srflx(*mapeado, *base)
                .map_err(transport_error)?;
        }

        // #1130 fatia 2: PROBE do relay — roda o handshake Allocate no coturn (via o
        // MESMO socket quieto, como o srflx) pra PROVAR que o relay aloca. Espelha o
        // srflx e é NÃO-fatal (sem TURN/credencial/timeout → custa zero, host/srflx
        // seguem). O `gather_relay` loga o `relayed` alocado (diagnóstico de runtime).
        //
        // NÃO anuncia o candidato relay ainda, DE PROPÓSITO: a str0m 0.6 é sans-I/O e
        // NÃO faz o data-path do relay (embrulhar `Transmit{source=relayed}` em TURN
        // ChannelData/Send + CreatePermission por peer). Sem isso — a FATIA 3 — o
        // candidato seria INERTE: anunciá-lo só geraria checagens ICE mortas e faria a
        // str0m emitir `Transmit{source=relayed}` que sairia CRU pelo socket errado.
        // O candidato (`candidato_relay`) + trickle entram JUNTO com o data-path na
        // fatia 3. Aqui a entrega é o handshake provado + a fundação.
        let base_relay = SocketAddr::new(ips_locais[0], porta);
        for (turn_server, username, credential) in &turn_alvos {
            let _ = gather_relay(&socket, *turn_server, username, credential, base_relay);
        }

        let mut session = Self {
            role: request.role,
            capabilities: request.capabilities,
            on_event,
            video_frames,
            video_failed,
            video_worker,
            commands,
            transport,
            socket,
            local_addr,
            next_timeout: None,
            last_stats: Instant::now(),
            pressed_keys: HashSet::new(),
            pressed_buttons: HashSet::new(),
            injector,
            capture_frames,
            transport_encoder_commands,
            capture_encoder_commands,
            capture_worker,
            terminal_sent: false,
        };
        session.emit_state(RemoteSessionState::Connecting, None, None)?;
        // #1108: trickle-ICE — envia 1 `IceCandidate` por IP de interface válido (N
        // candidatos, não mais só o endereço do bind). Cada SDP carrega um IP REAL;
        // nenhum é `0.0.0.0`/`::` (a fonte do bug em prod).
        for ip in &ips_locais {
            let addr = SocketAddr::new(*ip, porta);
            session.send_event(RemoteSessionEvent::Signal {
                signal: SignalMessage::IceCandidate {
                    candidate: Transport::candidato_local_sdp(addr).map_err(transport_error)?,
                }
                .into(),
            })?;
        }
        // #1108 Parte 2: trickle dos candidatos srflx — DEPOIS dos host (ordem
        // host-primeiro preservada). Cada SDP carrega o IP:porta público visto pelo
        // STUN. Se o gather voltou vazio, este loop não emite nada (host-only).
        for (mapeado, base) in &srflx {
            session.send_event(RemoteSessionEvent::Signal {
                signal: SignalMessage::IceCandidate {
                    candidate: Transport::candidato_srflx_sdp(*mapeado, *base)
                        .map_err(transport_error)?,
                }
                .into(),
            })?;
        }
        // #1130 fatia 2: NÃO faz trickle do candidato relay — ele não é anunciado até a
        // fatia 3 (data-path). Ver o comentário do PROBE acima e `Transport::candidato_relay`.
        if session.role == RemoteRole::Controller {
            let offer = session.transport.criar_offer().map_err(transport_error)?;
            session.send_event(RemoteSessionEvent::Signal {
                signal: offer.into(),
            })?;
        }
        Ok(session)
    }

    fn run(&mut self) -> Result<(), RemoteError> {
        loop {
            match self.commands.recv_timeout(NETWORK_TICK) {
                Ok(RuntimeCommand::Signal(signal)) => self.apply_signal(signal)?,
                Ok(RuntimeCommand::Input(event)) => self.send_input(event)?,
                Ok(RuntimeCommand::End { reason }) => {
                    self.emit_terminal(None, Some(sanitize_reason(reason)));
                    return Ok(());
                }
                Err(RecvTimeoutError::Disconnected) => {
                    self.emit_terminal(Some("channel_closed"), None);
                    return Ok(());
                }
                Err(RecvTimeoutError::Timeout) => {}
            }

            while let Ok(command) = self.commands.try_recv() {
                match command {
                    RuntimeCommand::Signal(signal) => self.apply_signal(signal)?,
                    RuntimeCommand::Input(event) => self.send_input(event)?,
                    RuntimeCommand::End { reason } => {
                        self.emit_terminal(None, Some(sanitize_reason(reason)));
                        return Ok(());
                    }
                }
            }

            self.receive_udp()?;
            self.drain_capture()?;
            self.forward_encoder_commands();
            if self
                .next_timeout
                .is_some_and(|deadline| deadline <= Instant::now())
            {
                self.transport
                    .atender_timeout(Instant::now())
                    .map_err(transport_error)?;
                self.next_timeout = None;
            }
            if self.drain_transport()? {
                return Ok(());
            }
            self.emit_stats_if_due()?;
        }
    }

    fn apply_signal(&mut self, signal: SignalMessage) -> Result<(), RemoteError> {
        validate_signal(&signal)?;
        match signal {
            SignalMessage::Offer { sdp } => {
                if self.role != RemoteRole::Host {
                    return Err(RemoteError::ControllerOnly);
                }
                let answer = self
                    .transport
                    .responder_offer(&sdp)
                    .map_err(transport_error)?;
                self.send_event(RemoteSessionEvent::Signal {
                    signal: answer.into(),
                })?;
            }
            SignalMessage::Answer { sdp } => {
                if self.role != RemoteRole::Controller {
                    return Err(RemoteError::ControllerOnly);
                }
                self.transport
                    .aceitar_answer(&sdp)
                    .map_err(transport_error)?;
            }
            SignalMessage::IceCandidate { candidate } => {
                self.transport
                    .candidato_remoto_sdp(&candidate)
                    .map_err(transport_error)?;
            }
        }
        Ok(())
    }

    fn send_input(&mut self, event: InputEvent) -> Result<(), RemoteError> {
        if self.role != RemoteRole::Controller {
            return Err(RemoteError::ControllerOnly);
        }
        if !self.capabilities.input {
            return Err(RemoteError::InputDisabled);
        }
        if matches!(event, InputEvent::Screen { .. }) {
            return Err(RemoteError::InvalidInputDirection);
        }
        self.transport
            .enviar_controle(&encode_input(&event))
            .map_err(transport_error)
    }

    fn receive_udp(&mut self) -> Result<(), RemoteError> {
        let mut buffer = [0u8; 65_536];
        loop {
            match self.socket.recv_from(&mut buffer) {
                Ok((len, source)) => self
                    .transport
                    .receber_udp(source, self.local_addr, &buffer[..len])
                    .map_err(transport_error)?,
                Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => return Ok(()),
                Err(error) => return Err(RemoteError::Network(error.to_string())),
            }
        }
    }

    fn drain_capture(&mut self) -> Result<(), RemoteError> {
        let Some(frames) = self.capture_frames.as_ref() else {
            return Ok(());
        };
        if !self.transport.video_pronto() {
            return Ok(());
        }
        for _ in 0..8 {
            match frames.try_recv() {
                Ok(frame) if frame.is_empty() || frame.len() > MAX_VIDEO_FRAME => {
                    if let Some(commands) = self.capture_encoder_commands.as_ref() {
                        commands.pedir_keyframe();
                    }
                }
                Ok(frame) => self
                    .transport
                    .escrever_frame(&galaxie_remote_transport::CodedFrame::new(
                        frame.data,
                        frame.timestamp_us,
                        frame.keyframe,
                    ))
                    .map_err(transport_error)?,
                Err(TryRecvError::Empty) => return Ok(()),
                Err(TryRecvError::Disconnected) => {
                    return Err(RemoteError::Transport(
                        "pipeline de captura encerrado".to_owned(),
                    ))
                }
            }
        }
        Ok(())
    }

    fn forward_encoder_commands(&mut self) {
        let Some(capture_commands) = self.capture_encoder_commands.as_ref() else {
            return;
        };
        while let Some(command) = self.transport_encoder_commands.tentar_receber() {
            if command == TransportEncoderCommand::RequestKeyframe {
                capture_commands.pedir_keyframe();
            }
        }
    }

    fn drain_transport(&mut self) -> Result<bool, RemoteError> {
        for _ in 0..256 {
            match self.transport.passo().map_err(transport_error)? {
                Passo::Transmitir { destino, dados } => {
                    self.socket
                        .send_to(&dados, destino)
                        .map_err(|e| RemoteError::Network(e.to_string()))?;
                }
                Passo::Aguardar(at) => {
                    self.next_timeout = Some(at);
                    return Ok(false);
                }
                Passo::Evento(event) => self.handle_event(event)?,
                Passo::Fim => {
                    self.emit_terminal(None, None);
                    return Ok(true);
                }
            }
        }
        Ok(false)
    }

    fn handle_event(&mut self, event: EventoSessao) -> Result<(), RemoteError> {
        match event {
            EventoSessao::Conectada => {
                self.emit_state(RemoteSessionState::Connected, None, None)?;
            }
            EventoSessao::Desconectada => {
                self.emit_state(RemoteSessionState::Reconnecting, None, None)?;
            }
            EventoSessao::ControleAberto => {
                if self.role == RemoteRole::Host {
                    let info = host_screen_info();
                    self.transport
                        .enviar_controle(&encode_input(&InputEvent::Screen { info }))
                        .map_err(transport_error)?;
                }
            }
            EventoSessao::Video(frame) => self.send_video(frame)?,
            EventoSessao::Controle(bytes) => self.handle_control(bytes)?,
        }
        Ok(())
    }

    fn handle_control(&mut self, bytes: Vec<u8>) -> Result<(), RemoteError> {
        match decode(&bytes).map_err(|e| RemoteError::Transport(e.to_string()))? {
            ControlFrame::Input(InputEvent::Screen { info }) => {
                if self.role != RemoteRole::Controller {
                    return Err(RemoteError::InvalidInputDirection);
                }
                self.send_event(RemoteSessionEvent::Screen { info })?;
            }
            ControlFrame::Input(event) => self.apply_host_input(event)?,
            ControlFrame::Control(_) | ControlFrame::Chunk { .. } => {}
        }
        Ok(())
    }

    fn apply_host_input(&mut self, event: InputEvent) -> Result<(), RemoteError> {
        if self.role != RemoteRole::Host {
            return Err(RemoteError::InvalidInputDirection);
        }
        if !self.capabilities.input {
            return Err(RemoteError::InputDisabled);
        }
        let injector = self.injector.as_mut().ok_or(RemoteError::InputDisabled)?;
        injector
            .aplicar(&event)
            .map_err(|e| RemoteError::Transport(e.to_string()))?;
        track_pressed(&mut self.pressed_keys, &mut self.pressed_buttons, &event);
        Ok(())
    }

    fn send_video(
        &mut self,
        frame: galaxie_remote_transport::CodedFrame,
    ) -> Result<(), RemoteError> {
        if self.role != RemoteRole::Controller {
            return Err(RemoteError::ControllerOnly);
        }
        if !self.capabilities.screen {
            return Ok(());
        }
        if frame.is_empty() || frame.len() > MAX_VIDEO_FRAME {
            self.transport
                .pedir_keyframe_remoto()
                .map_err(transport_error)?;
            return Ok(());
        }
        if self.video_failed.load(Ordering::Acquire) {
            return Err(RemoteError::ChannelClosed);
        }
        let Some(video_frames) = self.video_frames.as_ref() else {
            return Err(RemoteError::ControllerOnly);
        };
        match video_frames.try_send(frame) {
            Ok(()) => Ok(()),
            Err(TrySendError::Full(_)) => {
                self.transport
                    .pedir_keyframe_remoto()
                    .map_err(transport_error)?;
                Ok(())
            }
            Err(TrySendError::Disconnected(_)) => {
                self.transport
                    .pedir_keyframe_remoto()
                    .map_err(transport_error)?;
                Err(RemoteError::ChannelClosed)
            }
        }
    }

    fn emit_stats_if_due(&mut self) -> Result<(), RemoteError> {
        if self.last_stats.elapsed() < STATS_INTERVAL {
            return Ok(());
        }
        self.last_stats = Instant::now();
        let stats = self.transport.stats().snapshot();
        self.send_event(RemoteSessionEvent::Stats {
            rtt_ms: stats.rtt_ms,
            bitrate_bps: stats.bitrate_bps,
            frames: stats.frames,
        })
    }

    fn send_event(&self, event: RemoteSessionEvent) -> Result<(), RemoteError> {
        self.on_event
            .send(event)
            .map_err(|_| RemoteError::ChannelClosed)
    }

    fn emit_state(
        &self,
        state: RemoteSessionState,
        code: Option<&str>,
        message: Option<String>,
    ) -> Result<(), RemoteError> {
        self.send_event(RemoteSessionEvent::State {
            state,
            code: code.map(str::to_owned),
            message,
        })
    }

    fn emit_terminal(&mut self, code: Option<&str>, message: Option<String>) {
        if self.terminal_sent {
            return;
        }
        self.terminal_sent = true;
        self.release_pressed();
        let _ = self.emit_state(RemoteSessionState::Ended, code, message);
    }

    fn emit_error(&mut self, code: &str, message: String) {
        if self.terminal_sent {
            return;
        }
        self.terminal_sent = true;
        self.release_pressed();
        let _ = self.emit_state(RemoteSessionState::Error, Some(code), Some(message));
    }

    fn release_pressed(&mut self) {
        let Some(injector) = self.injector.as_mut() else {
            return;
        };
        for tecla in self.pressed_keys.drain() {
            let _ = injector.aplicar(&InputEvent::Key {
                tecla,
                pressed: false,
            });
        }
        for botao in self.pressed_buttons.drain() {
            let _ = injector.aplicar(&InputEvent::MouseButton {
                botao,
                pressed: false,
            });
        }
    }
}

impl Drop for RuntimeSession {
    fn drop(&mut self) {
        self.emit_terminal(Some("runtime_stopped"), None);
        self.capture_frames.take();
        self.video_frames.take();
        if let Some(worker) = self.video_worker.take() {
            let _ = worker.join();
        }
        if let Some(worker) = self.capture_worker.take() {
            let _ = worker.join();
        }
    }
}

fn encode_video_frame(
    frame: &galaxie_remote_transport::CodedFrame,
) -> Result<Vec<u8>, RemoteError> {
    if frame.data.len() > MAX_VIDEO_FRAME {
        return Err(RemoteError::Transport(
            "frame de vídeo excede o limite".to_owned(),
        ));
    }
    let mut bytes = Vec::with_capacity(VIDEO_HEADER_LEN + frame.data.len());
    bytes.push(VIDEO_VERSION);
    bytes.extend_from_slice(&frame.timestamp_us.to_le_bytes());
    let flags = if frame.keyframe { VIDEO_KEYFRAME } else { 0 };
    bytes.extend_from_slice(&flags.to_le_bytes());
    bytes.extend_from_slice(&frame.data);
    Ok(bytes)
}

fn track_pressed(
    keys: &mut HashSet<galaxie_remote_transport::Tecla>,
    buttons: &mut HashSet<galaxie_remote_transport::BotaoMouse>,
    event: &InputEvent,
) {
    match event {
        InputEvent::Key { tecla, pressed } => {
            if *pressed {
                keys.insert(tecla.clone());
            } else {
                keys.remove(tecla);
            }
        }
        InputEvent::MouseButton { botao, pressed } => {
            if *pressed {
                buttons.insert(*botao);
            } else {
                buttons.remove(botao);
            }
        }
        _ => {}
    }
}

fn transport_error(error: impl std::fmt::Display) -> RemoteError {
    RemoteError::Transport(error.to_string())
}

/// `true` se `ip` é link-local — IPv4 `169.254.0.0/16` ou IPv6 `fe80::/10`. Esses
/// raramente roteiam entre peers e só poluem o gathering ICE, então saem junto
/// com unspecified/loopback. (O teste do `fe80::/10` é por prefixo pra não depender
/// de API instável de `Ipv6Addr`.)
fn is_link_local(ip: &IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => v4.is_link_local(),
        IpAddr::V6(v6) => (v6.segments()[0] & 0xffc0) == 0xfe80,
    }
}

/// Filtra os IPs de interface BRUTOS, descartando o que NUNCA pode virar candidato
/// ICE host: unspecified (`0.0.0.0`/`::` — o endereço do BIND, que o str0m rejeita
/// com "invalid ip 0.0.0.0"), loopback (`127.0.0.1`/`::1`, inalcançável pelo peer)
/// e link-local. Sobram só IPs de interface REAIS; deduplica preservando a ordem
/// pra emitir 1 candidato por IP sem repetição.
///
/// Fn PURA (não toca a rede): é o ponto testável do #1108 — a regra de que um IP
/// unspecified jamais escapa pro gathering é provada aqui, sem interface/socket.
fn ips_de_interface_validos(brutos: &[IpAddr]) -> Vec<IpAddr> {
    let mut vistos = HashSet::new();
    brutos
        .iter()
        .copied()
        .filter(|ip| !ip.is_unspecified() && !ip.is_loopback() && !is_link_local(ip))
        .filter(|ip| vistos.insert(*ip))
        .collect()
}

/// Descobre os IPs de interface REAIS desta máquina (todas as interfaces up) e
/// devolve só os válidos pra candidato ICE host. Isola o toque na rede
/// (`if_addrs::get_if_addrs`) da regra pura `ips_de_interface_validos`. Falha de
/// enumeração vira lista vazia (o chamador trata como "sem candidato host").
fn descobrir_ips_locais() -> Vec<IpAddr> {
    let brutos: Vec<IpAddr> = match if_addrs::get_if_addrs() {
        Ok(ifaces) => ifaces.into_iter().map(|iface| iface.ip()).collect(),
        Err(error) => {
            log::warn!("[remote] enumeração de interfaces falhou: {error}");
            Vec::new()
        }
    };
    ips_de_interface_validos(&brutos)
}

/// #1108 Parte 2: resolve os STUN servers dos `IceServer` em `SocketAddr`. Pega
/// TODA url com prefixo `stun:` (sem credencial), tira o prefixo, corta um eventual
/// `?transport=...` e resolve `host:porta` via `ToSocketAddrs` (DNS + IPv4/IPv6).
/// Deduplica preservando a ordem. Falha de resolução é NÃO-fatal (loga e pula): o
/// gathering srflx é aditivo. Relay/TURN fica de fora (bloqueado: credencial +
/// coturn + #1049).
fn resolver_stun_addrs(ice_servers: &[IceServer]) -> Vec<SocketAddr> {
    let mut vistos = HashSet::new();
    let mut addrs = Vec::new();
    for server in ice_servers {
        for url in &server.urls {
            let Some(hostport) = url.strip_prefix("stun:") else {
                continue;
            };
            let hostport = hostport.split('?').next().unwrap_or(hostport);
            match hostport.to_socket_addrs() {
                Ok(resolvidos) => {
                    for addr in resolvidos {
                        if vistos.insert(addr) {
                            addrs.push(addr);
                        }
                    }
                }
                Err(error) => {
                    log::warn!("[remote] STUN '{hostport}' não resolveu: {error} — srflx pulado");
                }
            }
        }
    }
    addrs
}

/// #1108 Parte 2: faz o gathering de candidatos srflx. Pra cada STUN server, gera um
/// `txid` aleatório, envia um STUN Binding Request pelo `socket` (o MESMO socket da
/// sessão) e faz poll-recv com deadline curto (o socket é NONBLOCKING): lê
/// `recv_from` até `SRFLX_GATHER_TIMEOUT`, tratando `WouldBlock` com um `sleep`
/// curto. Ao chegar um pacote, tenta casar o `txid` via `parse_xor_mapped_address`;
/// se casar, o IP:porta público é o `mapeado` (par `(mapeado, base)`); senão o
/// pacote é ignorado (pode ser outro tráfego) e o laço segue. Devolve os pares
/// únicos. NÃO-fatal: timeout/erro/STUN inalcançável → vetor vazio (host-only).
///
/// Sans-I/O: o str0m não descobre srflx; este é o passo de runtime que o app faz por
/// ele. Chamado ANTES do offer, com o socket ainda quieto, pra o Binding não colidir
/// com o ICE do str0m.
fn gather_srflx(
    socket: &UdpSocket,
    stun_alvos: &[SocketAddr],
    base: SocketAddr,
) -> Vec<(SocketAddr, SocketAddr)> {
    let mut resultados: Vec<(SocketAddr, SocketAddr)> = Vec::new();
    let mut vistos = HashSet::new();
    let mut buf = [0u8; 512];
    for &stun in stun_alvos {
        let mut txid = [0u8; 12];
        rand::thread_rng().fill(&mut txid[..]);
        let req = build_binding_request(&txid);
        if let Err(error) = socket.send_to(&req, stun) {
            log::warn!("[remote] STUN Binding não enviou: {error} — srflx pulado");
            continue;
        }
        let deadline = Instant::now() + SRFLX_GATHER_TIMEOUT;
        loop {
            if Instant::now() >= deadline {
                log::warn!("[remote] STUN sem resposta (timeout) — srflx pulado deste servidor");
                break;
            }
            match socket.recv_from(&mut buf) {
                Ok((len, _origem)) => {
                    // O `txid` no parse é a prova de identidade; um pacote que não
                    // casa (outro tráfego chegando no socket) é ignorado e o laço
                    // segue até a resposta certa ou o deadline.
                    if let Some(mapeado) = parse_xor_mapped_address(&buf[..len], &txid) {
                        if vistos.insert((mapeado, base)) {
                            resultados.push((mapeado, base));
                        }
                        break;
                    }
                }
                Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                    std::thread::sleep(SRFLX_POLL_INTERVAL);
                }
                Err(error) => {
                    log::warn!("[remote] STUN recv falhou: {error} — srflx pulado deste servidor");
                    break;
                }
            }
        }
    }
    resultados
}

/// #1130 fatia 2: resolve os TURN servers UDP dos `IceServer` em
/// `(SocketAddr, username, credential)`. Só entra servidor com `username` E
/// `credential` NÃO-vazios (o coturn de prod entrega credencial efêmera; sem ela o
/// relay é impossível — nem tentamos o handshake) E que exponha ao menos um endpoint
/// `turn:` UDP (`IceServer::turn_udp_endpoints` — `turns:`/`transport=tcp` ficam de
/// fora, o Allocate aqui é UDP). Deduplica por `SocketAddr` preservando a ordem.
/// Falha de resolução DNS é NÃO-fatal (loga o HOST e pula). O `credential` (o
/// segredo) É CARREGADO no retorno pra o `derive_key`, mas NUNCA aparece em log.
fn resolver_turn_alvos(ice_servers: &[IceServer]) -> Vec<(SocketAddr, String, String)> {
    let mut vistos = HashSet::new();
    let mut alvos = Vec::new();
    for server in ice_servers {
        if server.username.is_empty() || server.credential.is_empty() {
            continue; // sem credencial → relay impossível (não tenta)
        }
        for endpoint in server.turn_udp_endpoints() {
            match endpoint.to_socket_addrs() {
                Ok(resolvidos) => {
                    for addr in resolvidos {
                        if vistos.insert(addr) {
                            alvos.push((
                                addr,
                                server.username.clone(),
                                server.credential.clone(),
                            ));
                        }
                    }
                }
                Err(error) => {
                    log::warn!("[remote] TURN '{endpoint}' não resolveu: {error} — relay pulado");
                }
            }
        }
    }
    alvos
}

/// #1130 fatia 2: envia `req` pro `turn_server` e faz poll-recv NONBLOCKING até o
/// `parse` casar ou o `RELAY_ALLOCATE_TIMEOUT` vencer (mesmo padrão de recv do
/// `gather_srflx`). Um pacote que não casa (ex.: resposta STUN de srflx atrasada, ou
/// outro tráfego chegando no socket compartilhado) é ignorado e o laço segue. Erro
/// de envio/recv ou timeout → `None`. O `parse` é quem prova a identidade (txid).
fn relay_troca<T>(
    socket: &UdpSocket,
    turn_server: SocketAddr,
    req: &[u8],
    parse: impl Fn(&[u8]) -> Option<T>,
) -> Option<T> {
    if let Err(error) = socket.send_to(req, turn_server) {
        log::warn!("[remote] TURN request não enviou: {error} — relay pulado");
        return None;
    }
    let mut buf = [0u8; 1024];
    let deadline = Instant::now() + RELAY_ALLOCATE_TIMEOUT;
    loop {
        if Instant::now() >= deadline {
            return None;
        }
        match socket.recv_from(&mut buf) {
            Ok((len, _origem)) => {
                if let Some(valor) = parse(&buf[..len]) {
                    return Some(valor);
                }
            }
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(SRFLX_POLL_INTERVAL);
            }
            Err(error) => {
                log::warn!("[remote] TURN recv falhou: {error} — relay pulado");
                return None;
            }
        }
    }
}

/// #1130 fatia 2: gathering de UM candidato relay (RELAY/TURN) via handshake
/// Allocate no coturn (RFC 5766 §6). Espelha o `gather_srflx`: usa o MESMO socket da
/// sessão, com poll-recv NONBLOCKING e deadline curto. Fluxo:
///   1. Allocate SEM auth → coturn responde `401 Unauthorized` com REALM/NONCE.
///   2. deriva a chave long-term (`derive_key(user, realm, credential)`) e reenvia o
///      Allocate autenticado (novo txid).
///   3. lê o Allocate Success → `(relayed, lifetime)`.
/// NÃO-fatal: qualquer timeout/erro/resposta inesperada → `None` (a sessão segue sem
/// relay, exatamente como sem TURN). Devolve `(relayed, base, lifetime)`, onde `base`
/// é o endereço local real do bind (repassado pelo chamador) — o triplo é o que a
/// FATIA 3 precisa pro data-path/refresh. O `credential` alimenta o `derive_key` e
/// NUNCA é logado (nem o `Debug` de `IceServer` é usado aqui).
fn gather_relay(
    socket: &UdpSocket,
    turn_server: SocketAddr,
    username: &str,
    credential: &str,
    base: SocketAddr,
) -> Option<(SocketAddr, SocketAddr, u32)> {
    // Passo 1: Allocate sem auth → espera 401 Unauthorized com REALM/NONCE.
    let mut txid = [0u8; 12];
    rand::thread_rng().fill(&mut txid[..]);
    let req = build_allocate_request(&txid);
    let Some((realm, nonce)) =
        relay_troca(socket, turn_server, &req, |resp| parse_error_unauthorized(resp, &txid))
    else {
        log::warn!("[remote] TURN Allocate sem 401 (timeout/erro) — relay pulado");
        return None;
    };

    // Passo 2: Allocate autenticado (long-term credential). Novo txid pro retry.
    let key = derive_key(username, &realm, credential);
    let mut txid_auth = [0u8; 12];
    rand::thread_rng().fill(&mut txid_auth[..]);
    let req_auth = build_allocate_request_auth(&txid_auth, username, &realm, &nonce, &key);
    let Some((relayed, lifetime)) = relay_troca(socket, turn_server, &req_auth, |resp| {
        parse_allocate_success(resp, &txid_auth)
    }) else {
        log::warn!("[remote] TURN Allocate autenticado sem sucesso (timeout/erro) — relay pulado");
        return None;
    };

    log::info!(
        "[remote] relay TURN alocado via {turn_server}: relayed={relayed} lifetime={lifetime}s \
         (data-path/refresh = fatia 3; segredo NÃO logado)"
    );
    Some((relayed, base, lifetime))
}

fn sanitize_reason(reason: String) -> String {
    reason
        .chars()
        .filter(|ch| !ch.is_control())
        .take(160)
        .collect::<String>()
}

fn thread_label(session_id: &str) -> String {
    session_id.chars().take(16).collect()
}

fn host_screen_info() -> ScreenInfo {
    #[cfg(windows)]
    if let Ok(monitors) = galaxie_remote_capture::windows::enumerate_monitors() {
        if let Some(monitor) = monitors
            .iter()
            .find(|monitor| monitor.primary)
            .or(monitors.first())
        {
            return ScreenInfo {
                origin_x: monitor.geometry.origin_x,
                origin_y: monitor.geometry.origin_y,
                width: monitor.geometry.width,
                height: monitor.geometry.height,
                device_pixel_ratio: monitor.geometry.device_pixel_ratio,
            };
        }
    }
    ScreenInfo {
        origin_x: 0,
        origin_y: 0,
        width: 1920,
        height: 1080,
        device_pixel_ratio: 1.0,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use galaxie_remote_transport::{BotaoMouse, CodedFrame, Tecla};
    use std::net::{Ipv4Addr, Ipv6Addr};

    #[test]
    fn filtro_de_ip_descarta_unspecified_loopback_e_link_local() {
        // #1108: entrada com o endereço do BIND (`0.0.0.0`), loopback, link-local e
        // IPs de interface reais → só os reais sobram.
        let brutos = vec![
            IpAddr::V4(Ipv4Addr::UNSPECIFIED),               // 0.0.0.0 (bind)
            IpAddr::V4(Ipv4Addr::LOCALHOST),                 // 127.0.0.1
            IpAddr::V4(Ipv4Addr::new(169, 254, 3, 4)),       // link-local v4
            IpAddr::V4(Ipv4Addr::new(192, 168, 1, 5)),       // LAN real
            IpAddr::V6(Ipv6Addr::UNSPECIFIED),               // ::
            IpAddr::V6(Ipv6Addr::LOCALHOST),                 // ::1
            IpAddr::V6(Ipv6Addr::new(0xfe80, 0, 0, 0, 0, 0, 0, 1)), // link-local v6
            IpAddr::V6(Ipv6Addr::new(0x2001, 0xdb8, 0, 0, 0, 0, 0, 1)), // global v6
        ];
        let validos = ips_de_interface_validos(&brutos);
        assert_eq!(
            validos,
            vec![
                IpAddr::V4(Ipv4Addr::new(192, 168, 1, 5)),
                IpAddr::V6(Ipv6Addr::new(0x2001, 0xdb8, 0, 0, 0, 0, 0, 1)),
            ],
            "só IPs de interface reais podem virar candidato host"
        );
        // DoD: NENHUM unspecified/loopback pode escapar pro gathering.
        assert!(validos
            .iter()
            .all(|ip| !ip.is_unspecified() && !ip.is_loopback()));
    }

    #[test]
    fn resolver_turn_alvos_exige_credencial_e_carrega_segredo() {
        // #1130 fatia 2: só servidor com username E credential preenchidos entra; o
        // sem credencial e o `stun:` puro são pulados. Usa IP numérico (127.0.0.1) pra
        // o `to_socket_addrs` resolver sem DNS. O segredo é carregado no tuple (pro
        // `derive_key`), nunca logado.
        let servers = vec![
            IceServer {
                urls: vec!["turn:127.0.0.1:3478".into()],
                username: String::new(),
                credential: String::new(),
            },
            IceServer {
                urls: vec!["turn:127.0.0.1:3479?transport=udp".into()],
                username: "u".into(),
                credential: "segredo".into(),
            },
            IceServer {
                urls: vec!["stun:127.0.0.1:3478".into()],
                username: String::new(),
                credential: String::new(),
            },
        ];
        let alvos = resolver_turn_alvos(&servers);
        assert_eq!(alvos.len(), 1, "só o servidor com credencial vira alvo");
        assert_eq!(alvos[0].0, "127.0.0.1:3479".parse().unwrap());
        assert_eq!(alvos[0].1, "u");
        assert_eq!(alvos[0].2, "segredo");
    }

    #[test]
    fn filtro_deduplica_ips_repetidos() {
        let ip = IpAddr::V4(Ipv4Addr::new(10, 0, 0, 7));
        let validos = ips_de_interface_validos(&[ip, ip]);
        assert_eq!(validos, vec![ip], "1 candidato por IP, sem repetição");
    }

    #[test]
    fn unspecified_nunca_vira_candidato_local() {
        // Prova o caminho de emissão do #1108: todo IP que passa pelo filtro produz
        // um SDP de candidato host, e nenhum é `0.0.0.0`/`::` (a fonte do P0). Se o
        // filtro deixasse o endereço do bind passar, este SDP conteria "0.0.0.0" e o
        // str0m rejeitaria no `add_local_candidate` — aqui garantimos que o
        // unspecified sequer chega a ser montado como candidato.
        let brutos = vec![
            IpAddr::V4(Ipv4Addr::UNSPECIFIED),
            IpAddr::V4(Ipv4Addr::new(10, 0, 0, 7)),
        ];
        let validos = ips_de_interface_validos(&brutos);
        assert!(!validos.is_empty(), "deve sobrar ≥1 candidato host real");
        assert!(
            !validos.contains(&IpAddr::V4(Ipv4Addr::UNSPECIFIED)),
            "candidato com IP unspecified é o bug do #1108"
        );
        for ip in &validos {
            let addr = SocketAddr::new(*ip, 55000);
            let sdp = Transport::candidato_local_sdp(addr).expect("SDP do candidato host");
            assert!(
                !sdp.contains("0.0.0.0") && !sdp.contains("typ host :: "),
                "SDP de candidato não pode carregar IP unspecified: {sdp}"
            );
        }
    }

    #[test]
    fn video_raw_tem_header_congelado_de_17_bytes() {
        let frame = CodedFrame::new(vec![0, 0, 0, 1, 0x65], 42, true);
        let bytes = encode_video_frame(&frame).unwrap();
        assert_eq!(bytes.len(), VIDEO_HEADER_LEN + frame.len());
        assert_eq!(bytes[0], 1);
        assert_eq!(u64::from_le_bytes(bytes[1..9].try_into().unwrap()), 42);
        assert_eq!(u64::from_le_bytes(bytes[9..17].try_into().unwrap()), 1);
        assert_eq!(&bytes[17..], frame.data.as_slice());
    }

    #[test]
    fn tracking_permite_release_deterministico_no_teardown() {
        let mut keys = HashSet::new();
        let mut buttons = HashSet::new();
        track_pressed(
            &mut keys,
            &mut buttons,
            &InputEvent::Key {
                tecla: Tecla::Control,
                pressed: true,
            },
        );
        track_pressed(
            &mut keys,
            &mut buttons,
            &InputEvent::MouseButton {
                botao: BotaoMouse::Left,
                pressed: true,
            },
        );
        assert!(keys.contains(&Tecla::Control));
        assert!(buttons.contains(&BotaoMouse::Left));
        track_pressed(
            &mut keys,
            &mut buttons,
            &InputEvent::Key {
                tecla: Tecla::Control,
                pressed: false,
            },
        );
        assert!(!keys.contains(&Tecla::Control));
    }

    /// #1071 (RB2): contrato de shape dos comandos remote_* contra as structs REAIS
    /// deste módulo (compila só sob `--features remote`, NÃO o remote_stub). O Tauri v2
    /// desserializa cada parâmetro nomeado a partir da chave homônima no objeto de args
    /// do invoke; como as 3 assinaturas recebem um único `request: T`, o front TEM que
    /// enviar `{ "request": {...} }`. O payload ACHATADO que o remote.ts enviava antes
    /// (`{ "sessionId":.., "signal":.. }`) não tem a chave `request` → o parâmetro não
    /// desserializa e a sessão trava em "connecting". Reproduz ANTES (achatado = Err) /
    /// passa DEPOIS (aninhado = Ok).
    #[test]
    fn contrato_remote_cmds_exige_payload_aninhado_em_request() {
        use serde_json::json;

        // Replica o que o Tauri v2 faz: pega args["request"] e desserializa em T.
        fn param_request<T: serde::de::DeserializeOwned>(
            args: serde_json::Value,
        ) -> Result<T, String> {
            let inner = args
                .get("request")
                .ok_or("faltou a chave `request` no objeto de args")?
                .clone();
            serde_json::from_value(inner).map_err(|e| e.to_string())
        }

        // signal
        assert!(
            param_request::<RemoteSessionSignalRequest>(
                json!({ "sessionId": "s1", "signal": { "kind": "answer", "payload": "sdp" } })
            )
            .is_err(),
            "payload achatado (front antigo) tem que FALHAR — reproduz a sessão travada"
        );
        let sig: RemoteSessionSignalRequest = param_request(json!({
            "request": { "sessionId": "s1", "signal": { "kind": "answer", "payload": "sdp" } }
        }))
        .expect("shape novo do signal (o que o remote.ts envia agora)");
        assert_eq!(sig.session_id, "s1");
        assert!(matches!(sig.signal, RemoteSignal::Answer(_)));

        // input
        assert!(param_request::<RemoteSessionInputRequest>(
            json!({ "sessionId": "s1", "event": { "e": "mouseMove", "x": 0.0, "y": 0.0 } })
        )
        .is_err());
        let inp: RemoteSessionInputRequest = param_request(json!({
            "request": { "sessionId": "s1", "event": { "e": "mouseMove", "x": 0.25, "y": 0.75 } }
        }))
        .expect("shape novo do input");
        assert_eq!(inp.session_id, "s1");
        assert!(matches!(inp.event, InputEvent::MouseMove { .. }));

        // end
        assert!(param_request::<RemoteSessionEndRequest>(
            json!({ "sessionId": "s1", "reason": "requested" })
        )
        .is_err());
        let end: RemoteSessionEndRequest =
            param_request(json!({ "request": { "sessionId": "s1", "reason": "requested" } }))
                .expect("shape novo do end");
        assert_eq!(end.session_id, "s1");
        assert_eq!(end.reason, "requested");
    }

    #[test]
    fn valida_ids_e_signal_bounded() {
        let request = RemoteSessionStartRequest {
            role: RemoteRole::Controller,
            session_id: "session_123".to_owned(),
            signaling: RemoteSignalingBinding {
                endpoint: "wss://remote.example/v1/ws".to_owned(),
                peer_id: "peer-1".to_owned(),
            },
            ice_servers: Vec::new(),
            capabilities: RemoteCapabilities {
                screen: true,
                input: true,
            },
        };
        assert!(validate_start(&request).is_ok());
        assert!(validate_signal(&SignalMessage::Offer { sdp: "v=0".into() }).is_ok());
        assert!(validate_signal(&SignalMessage::Answer { sdp: String::new() }).is_err());
    }

    #[test]
    fn signal_publico_usa_kind_e_payload_congelados() {
        let json = serde_json::to_value(RemoteSignal::IceCandidate("candidate:1".into())).unwrap();
        assert_eq!(json["kind"], "ice_candidate");
        assert_eq!(json["payload"], "candidate:1");
        assert_eq!(json.as_object().unwrap().len(), 2);
    }
}
