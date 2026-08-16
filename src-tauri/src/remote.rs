//! `Galaxie.Remote.App.v1` — fronteira congelada entre o Remote Rust e a UI.
//!
//! O runtime mantém uma única sessão ativa, dirige o `str0m` sans-I/O numa
//! thread dedicada, envia eventos pequenos como JSON e vídeo H.264 Annex-B como
//! bytes crus. O signaling continua na ponte TS/S0; credenciais TURN, SDP e ICE
//! jamais são logados aqui.

use std::collections::HashSet;
use std::net::{SocketAddr, UdpSocket};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, SyncSender, TryRecvError, TrySendError};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use galaxie_remote_transport::{
    canal_de_comandos, decode, encode_input, CommandReceiver as TransportCommandReceiver,
    EncoderCommand as TransportEncoderCommand, EventoSessao, Frame as ControlFrame, IceServer,
    InputEvent, Papel, Passo, ScreenInfo, SessionConfig, SignalMessage, Transport,
};
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
        let mut transport = Transport::novo(
            SessionConfig {
                papel: request.role.papel(),
                ice_servers: request.ice_servers,
            },
            encoder_commands,
        );
        transport
            .candidato_local(local_addr)
            .map_err(transport_error)?;

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
        session.send_event(RemoteSessionEvent::Signal {
            signal: SignalMessage::IceCandidate {
                candidate: Transport::candidato_local_sdp(local_addr).map_err(transport_error)?,
            }
            .into(),
        })?;
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
