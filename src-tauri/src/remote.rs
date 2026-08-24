//! `Galaxie.Remote.App.v1` — fronteira congelada entre o Remote Rust e a UI.
//!
//! O runtime mantém uma única sessão ativa, dirige o `str0m` sans-I/O numa
//! thread dedicada, envia eventos pequenos como JSON e vídeo H.264 Annex-B como
//! bytes crus. O signaling continua na ponte TS/S0; credenciais TURN, SDP e ICE
//! jamais são logados aqui.

use std::collections::{HashMap, HashSet};
use std::net::{IpAddr, SocketAddr, ToSocketAddrs, UdpSocket};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, SyncSender, TryRecvError, TrySendError};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use galaxie_remote_transport::stun::{build_binding_request, parse_xor_mapped_address};
use galaxie_remote_transport::turn::{
    build_allocate_request, build_allocate_request_auth, build_create_permission_request,
    build_refresh_request, build_send_indication, derive_key, parse_allocate_success,
    parse_data_indication, parse_error_unauthorized, parse_refresh_success, parse_stale_nonce,
};
use galaxie_remote_net::protocol::Capabilities;
use galaxie_remote_transport::{
    canal_de_comandos, decode, encode_input, CapabilityPolicy, ControlMessage,
    CommandReceiver as TransportCommandReceiver, EncoderCommand as TransportEncoderCommand,
    EventoSessao, Frame as ControlFrame, IceServer, InputEvent, Papel, Passo, ScreenInfo,
    SessionConfig, SignalMessage, Transport,
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
/// #1130 fatia 3c: a permissão de peer do coturn expira em ~300s (RFC 5766 §8).
/// Reemitimos a 3/4 disso (225s) pra nunca deixar lapsar durante a sessão.
const PERM_REFRESH: Duration = Duration::from_secs(225);

/// Quando reenviar o Refresh da alocação: a 3/4 do lifetime concedido, com piso de
/// 60s (se o coturn conceder um lifetime absurdamente curto, não martelamos o
/// servidor). #1130 fatia 3c.
fn intervalo_refresh(lifetime_s: u32) -> Duration {
    let tres_quartos = u64::from(lifetime_s).saturating_mul(3) / 4;
    Duration::from_secs(tres_quartos).max(Duration::from_secs(60))
}

#[derive(Default)]
pub struct RemoteRuntime {
    active: Mutex<Option<ActiveSession>>,
}

struct ActiveSession {
    session_id: String,
    role: RemoteRole,
    capabilities: Capabilities,
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
    /// #1070 RB8: INFORMATIVO — é validado (formato/tamanho) mas o `RuntimeSession`
    /// NÃO o consome. O signaling real (offer/answer/ICE) roda na ponte TS/S0 (o
    /// front fala com o servidor de signaling); o runtime Rust só dirige o str0m e
    /// recebe os `SignalMessage` já roteados via `RuntimeCommand::Signal`. Mantido no
    /// contrato pra validação de entrada e diagnóstico, não como fonte de verdade.
    pub signaling: RemoteSignalingBinding,
    #[serde(default)]
    pub ice_servers: Vec<IceServer>,
    pub capabilities: Capabilities,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteSignalingBinding {
    pub endpoint: String,
    pub peer_id: String,
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

/// #1130 fatia 3: estado do relay TURN alocado, pra servir o data-path. Só existe se
/// o `gather_relay` alocou (senão a sessão é host/srflx puro). `key`/`nonce` derivam
/// da credencial efêmera do coturn e NUNCA são logados.
struct RelayState {
    /// Onde mandar as Send indications: o próprio servidor coturn.
    turn_server: SocketAddr,
    /// XOR-RELAYED-ADDRESS = o candidato local `relay`. `Passo::Transmitir` com
    /// `origem == relayed` sai embrulhado pelo relay.
    relayed: SocketAddr,
    username: String,
    realm: String,
    nonce: String,
    key: [u8; 16],
    /// #1130 fatia 3c: lifetime (s) da alocação — usado pra reagendar o Refresh.
    lifetime_s: u32,
    /// Quando reenviar o Refresh da alocação (antes do lifetime expirar) — senão o
    /// coturn libera o relay e a sessão CAI.
    refresh_em: Instant,
    /// Peers com CreatePermission instalada → quando REEMITIR (a permissão do coturn
    /// expira em ~300s; sem reemitir, o relay dropa o peer no meio da sessão). Chave =
    /// IP do peer (a permissão é por IP, RFC 5766 §9).
    permitidos: HashMap<IpAddr, Instant>,
    /// txid do ÚLTIMO request TURN (Refresh/CreatePermission) enviado. A manutenção
    /// manda no máximo 1 por tick, então um `438 Stale Nonce` sempre casa com ESTE
    /// txid — daí renovamos o nonce sem corrida.
    ultimo_txid: [u8; 12],
}

/// #1000 (AC1/AC3) — veredito de autorização de UM frame de controle no host.
/// A DECISÃO mora aqui (pura, testável); o `handle_control` só executa o efeito.
#[derive(Debug, PartialEq)]
enum FrameAcao {
    /// `Screen` (host→controlador): o controlador recebe a geometria da tela.
    EmitirScreen(ScreenInfo),
    /// Input real (mouse/teclado) → o host injeta (o executor reconfere role/caps).
    AplicarInput(InputEvent),
    /// AC1: anúncio de `Capabilities` do CONTROLADOR — o host IGNORA, sempre.
    IgnorarAnuncioDeCapabilities,
    /// Controle (clipboard/file) permitido pela capability da sessão.
    ControlePermitido(ControlMessage),
    /// Controle negado pela capability — logado, nunca processado.
    ControleBloqueado,
    /// Chunk de arquivo COM oferta aceita (transfer_id no accepted-set) E capability.
    ChunkPermitido,
    /// Chunk com `file_transfer` desligado — rejeitado.
    ChunkBloqueado,
    /// #1000 AC2: chunk cujo `transfer_id` NÃO tem oferta aceita (accepted-set) —
    /// rejeitado ANTES e INDEPENDENTE da capability (chunk órfão = escrita por índice).
    /// Negativa DISTINTA de `ChunkBloqueado`: nenhuma substitui a outra.
    ChunkOrfao,
}

/// #1000 — política de autorização por-frame do host, PURA (sem `RuntimeSession`)
/// e testável. É a matriz do design do `altair` (canon v1.1 §2) em código:
///
/// - **AC1:** o anúncio de `Capabilities` do controlador é um braço EXPLÍCITO que
///   o host ignora, ANTES de qualquer aplicação. Sem ele, quando o #688 ligar o
///   `aplicar`, o controlador se auto-promoveria pelas capabilities do wire.
/// - **AC3:** `Input(Screen)` é host→controlador; no host, aceitar reescreveria a
///   geometria do mapeamento de coordenadas → barrado por direção.
/// - **AC2** (chunk órfão): um `Chunk` cujo `transfer_id` NÃO está no accepted-set
///   (`transfers_aceitos`) é recusado (`ChunkOrfao`) ANTES e INDEPENDENTE da
///   capability `file_transfer` — duas negativas distintas. O conjunto nasce VAZIO
///   por construção (quem RECEBE `Chunk` é quem EMITIU `FileAccept`; popular do
///   frame que chega deixaria o peer autorizar a si próprio — classe #1310, dir. do
///   Altair). Vazio ⇒ todo `Chunk` é órfão hoje ⇒ recusado (fail-closed; #691
///   omissão = lista vazia). O ponto de inserção — quando o HOST emite `FileAccept`
///   — é o card do fluxo de recebimento, que depende DESTE portão, não o contrário.
fn autorizar_frame(
    role: RemoteRole,
    capabilities: Capabilities,
    frame: &ControlFrame,
    transfers_aceitos: &HashSet<u32>,
) -> Result<FrameAcao, RemoteError> {
    match frame {
        ControlFrame::Input(InputEvent::Screen { info }) => {
            if role != RemoteRole::Controller {
                return Err(RemoteError::InvalidInputDirection);
            }
            Ok(FrameAcao::EmitirScreen(*info))
        }
        // Input real (mouse/teclado) é controlador→host: só o HOST injeta, e só
        // com `caps.input`. A AUTORIZAÇÃO mora aqui — `AplicarInput` só sai quando
        // já autorizado, senão `autorizar_frame` mentiria por omissão sobre input.
        // `apply_host_input` mantém o MESMO par de checagens (cinto-e-suspensórios:
        // se alguém chamar o applier por outro caminho, ele ainda segura).
        ControlFrame::Input(event) => {
            if role != RemoteRole::Host {
                return Err(RemoteError::InvalidInputDirection);
            }
            if !capabilities.input {
                return Err(RemoteError::InputDisabled);
            }
            Ok(FrameAcao::AplicarInput(event.clone()))
        }
        ControlFrame::Control(ControlMessage::Capabilities { .. }) => {
            Ok(FrameAcao::IgnorarAnuncioDeCapabilities)
        }
        ControlFrame::Control(msg) => {
            if CapabilityPolicy::nova(capabilities).permite(msg).is_err() {
                Ok(FrameAcao::ControleBloqueado)
            } else {
                Ok(FrameAcao::ControlePermitido(msg.clone()))
            }
        }
        ControlFrame::Chunk { transfer_id, .. } => {
            // AC2 (dir. Altair): DUAS negativas distintas, nenhuma substitui a outra.
            // (1) órfão — transfer_id sem oferta aceita — checado ANTES e INDEPENDENTE
            //     da capability (capability ligada + oferta não aceita ⇒ ainda recusa).
            // O accepted-set é VAZIO por construção hoje ⇒ todo Chunk é órfão.
            if !transfers_aceitos.contains(transfer_id) {
                Ok(FrameAcao::ChunkOrfao)
            } else if capabilities.file_transfer {
                Ok(FrameAcao::ChunkPermitido)
            } else {
                Ok(FrameAcao::ChunkBloqueado)
            }
        }
    }
}

struct RuntimeSession {
    role: RemoteRole,
    capabilities: Capabilities,
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
    /// #1130 fatia 3: relay TURN alocado (data-path), ou `None` (host/srflx puro).
    relay: Option<RelayState>,
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
pub async fn remote_session_end(
    request: RemoteSessionEndRequest,
    runtime: tauri::State<'_, RemoteRuntime>,
) -> Result<(), RemoteError> {
    // #1070 RB9: `session.stop()` faz `worker.join()` — BLOQUEIA até a thread do worker
    // (que ainda junta captura/vídeo) encerrar. Num comando SÍNCRONO isso rodava na
    // thread do IPC e TRAVAVA a UI no "Encerrar" (mesma classe do P0 #834). Agora o
    // comando é async e o join sai pra `spawn_blocking`, fora da thread do IPC.
    //
    // O lock é solto ANTES do await (o guard vive só neste bloco): não seguramos o
    // Mutex do runtime através do ponto de espera.
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
    let reason = sanitize_reason(request.reason);
    tauri::async_runtime::spawn_blocking(move || session.stop(reason))
        .await
        .map_err(|_| RemoteError::ChannelClosed)?;
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
        logar_sondagem_ice_servers(&request.ice_servers);
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

        // #1130 fatia 3: aloca o relay E anuncia o candidato. Diferente da fatia 2
        // (que só PROBAVA o Allocate), agora o data-path existe — o `drain_transport`
        // embrulha `origem==relayed` numa Send indication e o `receive_udp`
        // desembrulha a Data indication do coturn — então anunciar o candidato relay é
        // ÚTIL, não inerte. Fica com o PRIMEIRO relay que alocar (um basta; vários
        // coturn seriam fallback, improvável no MVP). NÃO-fatal: sem relay a sessão
        // segue host/srflx, exatamente como antes.
        let mut relay: Option<RelayState> = None;
        for (turn_server, username, credential) in &turn_alvos {
            if let Some(estado) = gather_relay(&socket, *turn_server, username, credential) {
                transport
                    .candidato_relay(estado.relayed)
                    .map_err(transport_error)?;
                relay = Some(estado);
                break;
            }
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
            relay,
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
        // #1130 fatia 3: trickle do candidato relay (se alocou) — DEPOIS de host+srflx
        // (ordem host-primeiro preservada). Só emite se o `gather_relay` alocou.
        if let Some(relayed) = session.relay.as_ref().map(|r| r.relayed) {
            session.send_event(RemoteSessionEvent::Signal {
                signal: SignalMessage::IceCandidate {
                    candidate: Transport::candidato_relay_sdp(relayed).map_err(transport_error)?,
                }
                .into(),
            })?;
        }
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
            self.manutencao_relay()?;
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
        // #1130 fatia 3: snapshot Copy do (turn_server, relayed) pra demultiplexar sem
        // segurar `&self.relay` enquanto chamamos `&mut self.transport`. O recv NÃO
        // muta o relay (a permissão é instalada no caminho de ENVIO).
        let relay_io = self.relay.as_ref().map(|r| (r.turn_server, r.relayed));
        loop {
            match self.socket.recv_from(&mut buffer) {
                Ok((len, source)) => {
                    let pacote = &buffer[..len];
                    // Tráfego vindo do coturn: só a Data indication interessa ao str0m
                    // (é o pacote do peer embrulhado). O resto (CreatePermission
                    // Success, Refresh…) é controle TURN e não vai pro str0m. Um pacote
                    // do peer chega ao str0m como vindo do `peer` no candidato `relayed`.
                    if let Some((turn_server, relayed)) = relay_io {
                        if source == turn_server {
                            if let Some((peer, dados)) = parse_data_indication(pacote) {
                                self.transport
                                    .receber_udp(peer, relayed, &dados)
                                    .map_err(transport_error)?;
                            } else {
                                // Não é dado de peer: é controle TURN (resposta a um
                                // Refresh/CreatePermission nosso). #1130 fatia 3c.
                                self.tratar_controle_relay(pacote);
                            }
                            continue;
                        }
                    }
                    self.transport
                        .receber_udp(source, self.local_addr, pacote)
                        .map_err(transport_error)?;
                }
                Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => return Ok(()),
                Err(error) => return Err(RemoteError::Network(error.to_string())),
            }
        }
    }

    /// #1130 fatia 3: caminho de SAÍDA de um datagrama do str0m. Host/srflx (`origem`
    /// = base local) → UDP direto ao `destino`, como sempre. Relay (`origem` ==
    /// `relayed`) → embrulha numa Send indication endereçada ao servidor TURN, com
    /// CreatePermission instalada pro peer ANTES na 1ª vez (o coturn dropa tráfego de
    /// peer sem permissão). `txid` aleatório: indication não tem resposta a casar.
    fn enviar_datagrama(
        &mut self,
        origem: SocketAddr,
        destino: SocketAddr,
        dados: &[u8],
    ) -> Result<(), RemoteError> {
        if let Some(relay) = self.relay.as_mut() {
            if origem == relay.relayed {
                if !relay.permitidos.contains_key(&destino.ip()) {
                    let mut txid = [0u8; 12];
                    rand::thread_rng().fill(&mut txid[..]);
                    let perm = build_create_permission_request(
                        &txid,
                        destino,
                        &relay.username,
                        &relay.realm,
                        &relay.nonce,
                        &relay.key,
                    );
                    self.socket
                        .send_to(&perm, relay.turn_server)
                        .map_err(|e| RemoteError::Network(e.to_string()))?;
                    relay.ultimo_txid = txid;
                    relay
                        .permitidos
                        .insert(destino.ip(), Instant::now() + PERM_REFRESH);
                }
                let mut txid = [0u8; 12];
                rand::thread_rng().fill(&mut txid[..]);
                let ind = build_send_indication(&txid, destino, dados);
                return Self::enviar_best_effort(&self.socket, &ind, relay.turn_server);
            }
        }
        Self::enviar_best_effort(&self.socket, dados, destino)
    }

    /// #1070 RB1: envia um datagrama do data-path tratando `WouldBlock` (buffer de
    /// saída cheio) como NÃO-fatal — o MESMO comportamento do `IoDriver`
    /// (`services/remote-transport/src/driver.rs`) usado pelo harness E2E. Sob carga de
    /// vídeo o buffer enche normalmente; derrubar a sessão por isso (o `?` que existia
    /// aqui) era a divergência silenciosa do RB1. ICE/RTP/o próprio TURN retransmitem.
    fn enviar_best_effort(
        socket: &UdpSocket,
        dados: &[u8],
        destino: SocketAddr,
    ) -> Result<(), RemoteError> {
        match socket.send_to(dados, destino) {
            Ok(_) => Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => Ok(()),
            Err(e) => Err(RemoteError::Network(e.to_string())),
        }
    }

    /// #1130 fatia 3c: reação a uma resposta de controle TURN (não-Data) do coturn.
    /// Casa pelo `ultimo_txid` (a manutenção manda 1 req/tick, então sem corrida):
    /// - `438 Stale Nonce` → adota o nonce novo e força reemissão IMEDIATA (refresh +
    ///   todas as permissões) com o nonce fresco, senão a alocação/permissões CAEM.
    /// - Refresh Success → reagenda pelo lifetime REALMENTE concedido (o coturn pode
    ///   conceder menos do que pedimos).
    fn tratar_controle_relay(&mut self, pacote: &[u8]) {
        let Some(relay) = self.relay.as_mut() else {
            return;
        };
        if let Some(nonce_novo) = parse_stale_nonce(pacote, &relay.ultimo_txid) {
            relay.nonce = nonce_novo;
            let agora = Instant::now();
            relay.refresh_em = agora; // refaz o refresh já, com o nonce fresco
            for prazo in relay.permitidos.values_mut() {
                *prazo = agora; // e reemite todas as permissões
            }
        } else if let Some(lifetime) = parse_refresh_success(pacote, &relay.ultimo_txid) {
            relay.lifetime_s = lifetime;
            relay.refresh_em = Instant::now() + intervalo_refresh(lifetime);
        }
    }

    /// #1130 fatia 3c: mantém a alocação e as permissões do relay VIVAS ("não cai").
    /// Manda no MÁXIMO 1 request por tick (refresh tem prioridade; senão a 1ª permissão
    /// vencida), pra que um `438 Stale Nonce` sempre case com o `ultimo_txid`. No-op se
    /// a sessão é host/srflx puro.
    fn manutencao_relay(&mut self) -> Result<(), RemoteError> {
        let Some(relay) = self.relay.as_mut() else {
            return Ok(());
        };
        let agora = Instant::now();
        // 1. Refresh da alocação antes do lifetime expirar.
        if agora >= relay.refresh_em {
            let mut txid = [0u8; 12];
            rand::thread_rng().fill(&mut txid[..]);
            let req = build_refresh_request(
                &txid,
                relay.lifetime_s,
                &relay.username,
                &relay.realm,
                &relay.nonce,
                &relay.key,
            );
            self.socket
                .send_to(&req, relay.turn_server)
                .map_err(|e| RemoteError::Network(e.to_string()))?;
            relay.ultimo_txid = txid;
            // Reagenda otimista; a Success (recv) ajusta pelo lifetime concedido.
            relay.refresh_em = agora + intervalo_refresh(relay.lifetime_s);
            return Ok(());
        }
        // 2. Reemite UMA permissão vencida (a próxima entra no tick seguinte).
        let vencida = relay
            .permitidos
            .iter()
            .find(|(_, prazo)| agora >= **prazo)
            .map(|(ip, _)| *ip);
        if let Some(ip) = vencida {
            let mut txid = [0u8; 12];
            rand::thread_rng().fill(&mut txid[..]);
            // A permissão é por IP (RFC 5766 §9); a porta do XOR-PEER-ADDRESS é ignorada.
            let peer = SocketAddr::new(ip, 0);
            let perm = build_create_permission_request(
                &txid,
                peer,
                &relay.username,
                &relay.realm,
                &relay.nonce,
                &relay.key,
            );
            self.socket
                .send_to(&perm, relay.turn_server)
                .map_err(|e| RemoteError::Network(e.to_string()))?;
            relay.ultimo_txid = txid;
            relay.permitidos.insert(ip, agora + PERM_REFRESH);
        }
        Ok(())
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
                Passo::Transmitir {
                    origem,
                    destino,
                    dados,
                } => {
                    self.enviar_datagrama(origem, destino, &dados)?;
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
        let frame = decode(&bytes).map_err(|e| RemoteError::Transport(e.to_string()))?;
        // #1000 (AC1/AC3): a DECISÃO de autorização por-frame mora em `autorizar_frame`
        // (pura, testável — a matriz do design do Altair). Aqui só EXECUTAMOS o
        // veredito; sem política enterrada no caminho de efeito.
        // #1000 AC2: accepted-set VAZIO por construção — nada o popula ainda (o ponto
        // de inserção é quando o HOST emite `FileAccept`, no card do fluxo de
        // recebimento). Vazio ⇒ todo `Chunk` é órfão ⇒ recusado (fail-closed).
        match autorizar_frame(self.role, self.capabilities, &frame, &HashSet::new())? {
            FrameAcao::EmitirScreen(info) => {
                self.send_event(RemoteSessionEvent::Screen { info })?;
            }
            FrameAcao::AplicarInput(event) => self.apply_host_input(event)?,
            // #1000 AC1: o anúncio de Capabilities do CONTROLADOR é ignorado pelo host.
            FrameAcao::IgnorarAnuncioDeCapabilities => {}
            // #1070 RB6: o gate já decidiu. O frame permitido de clipboard/file ainda
            // não é processado (S5-front não existe no app), mas o gate já vale e o
            // negado já aparece no log. NUNCA logamos o conteúdo — só o veredito.
            FrameAcao::ControlePermitido(_msg) => {}
            FrameAcao::ControleBloqueado => {
                log::warn!(
                    "[remote] frame de controle BLOQUEADO por capability \
                     (clipboard/file desligado na sessão)"
                );
            }
            // #1000 AC2: chunk com oferta ACEITA (transfer_id no accepted-set) E
            // capability. Sem consumidor ainda (o fluxo de recebimento é outro card);
            // trocar "permitido e ignorado" por gate NÃO regride comportamento.
            FrameAcao::ChunkPermitido => {}
            FrameAcao::ChunkBloqueado => {
                log::warn!(
                    "[remote] chunk de arquivo BLOQUEADO: capability file_transfer \
                     desligada na sessão"
                );
            }
            // #1000 AC2: chunk órfão (transfer_id sem oferta aceita) — negativa
            // distinta da capability; NUNCA logamos o conteúdo, só o veredito.
            FrameAcao::ChunkOrfao => {
                log::warn!(
                    "[remote] chunk de arquivo BLOQUEADO: transfer_id sem oferta \
                     aceita (chunk órfão = escrita por índice)"
                );
            }
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

/// Sondagem #1108: diagnóstico de infra pra decidir o relay — o coturn de produção
/// já entrega credencial TURN efêmera no `ice_servers`, ou os campos vêm vazios
/// (provisionamento pendente no VPS)?
///
/// **Loga SÓ contagem e presença.** O `username`/`credential` (o segredo efêmero
/// HMAC) nunca entra na linha.
///
/// #1130 — extraída do meio de `iniciar_sessao` para virar AFIRMÁVEL. O card exige
/// *"Dado o segredo TURN, Então ele nunca aparece em log"*, e isso era só um
/// comentário: o `remote.rs` não tinha **uma única** asserção de log. Comentário
/// não segura refactor; teste segura.
fn logar_sondagem_ice_servers(ice_servers: &[IceServer]) {
    let total = ice_servers.len();
    let com_turn_utilizavel = ice_servers
        .iter()
        .filter(|s| s.tem_turn() && !s.credential.is_empty() && !s.username.is_empty())
        .count();
    let com_stun = ice_servers
        .iter()
        .filter(|s| s.urls.iter().any(|u| u.starts_with("stun:")))
        .count();
    log::info!(
        "[remote] ice_servers recebidos: {total} servidor(es) ({com_stun} com STUN, {com_turn_utilizavel} com TURN+credencial preenchida) — segredo NÃO logado (sondagem #1108: TURN {})",
        if com_turn_utilizavel > 0 {
            "PRONTO p/ relay"
        } else {
            "sem credencial (relay bloqueado)"
        }
    );
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
) -> Option<RelayState> {
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
         (renovação do lifetime = fatia 3c; segredo NÃO logado)"
    );
    // Guarda a credencial pro data-path (Send indication + CreatePermission) e agenda
    // o 1º Refresh a 3/4 do lifetime (#1130 fatia 3c — "não cai").
    Some(RelayState {
        turn_server,
        relayed,
        username: username.to_owned(),
        realm,
        nonce,
        key,
        lifetime_s: lifetime,
        refresh_em: Instant::now() + intervalo_refresh(lifetime),
        permitidos: HashMap::new(),
        ultimo_txid: [0u8; 12],
    })
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

    // ---- #1000 (AC1/AC3): autorização por-frame do host -----------------------
    // A matriz do design do `altair` (canon v1.1 §2), exercitada pela fn PURA
    // `autorizar_frame` — sem montar `RuntimeSession`.

    fn tela() -> ScreenInfo {
        ScreenInfo {
            origin_x: 0,
            origin_y: 0,
            width: 1920,
            height: 1080,
            device_pixel_ratio: 1.0,
        }
    }

    /// AC3 — `Input(Screen)` é host→controlador. No HOST, aceitar reescreveria a
    /// geometria do mapeamento de coordenadas: barrado por direção.
    #[test]
    fn ac3_input_screen_no_host_e_barrado_por_direcao() {
        let frame = ControlFrame::Input(InputEvent::Screen { info: tela() });
        // Todas as capabilities LIGADAS: a barreira é de DIREÇÃO, não de capability.
        let caps = Capabilities {
            screen: true,
            input: true,
            file_transfer: true,
            clipboard: true,
            audio: true,
        };
        assert!(
            matches!(
                autorizar_frame(RemoteRole::Host, caps, &frame, &HashSet::new()),
                Err(RemoteError::InvalidInputDirection)
            ),
            "Screen no host tem que ser barrado mesmo com todas as caps ligadas (#1000 AC3)",
        );
    }

    /// AC3 (contraparte) — no CONTROLADOR, `Input(Screen)` é a geometria legítima
    /// que ele recebe do host.
    #[test]
    fn ac3_input_screen_no_controlador_emite_geometria() {
        let frame = ControlFrame::Input(InputEvent::Screen { info: tela() });
        assert_eq!(
            autorizar_frame(RemoteRole::Controller, Capabilities::default(), &frame, &HashSet::new()).ok(),
            Some(FrameAcao::EmitirScreen(tela())),
        );
    }

    /// AC1 — o anúncio de `Capabilities` do controlador é SEMPRE ignorado pelo
    /// host: nunca vira aplicação. É o braço explícito que impede a auto-promoção
    /// pelo wire quando o #688 ligar o `aplicar`. Vale mesmo com tudo desligado
    /// (não é "bloqueado", é "ignorado" — categorias diferentes).
    #[test]
    fn ac1_anuncio_de_capabilities_do_controlador_e_ignorado() {
        let anuncio = ControlFrame::Control(ControlMessage::Capabilities {
            clipboard: true,
            file_transfer: true,
        });
        for caps in [
            Capabilities::default(),
            Capabilities {
                screen: true,
                input: true,
                file_transfer: true,
                clipboard: true,
                audio: true,
            },
        ] {
            assert_eq!(
                autorizar_frame(RemoteRole::Host, caps, &anuncio, &HashSet::new()).ok(),
                Some(FrameAcao::IgnorarAnuncioDeCapabilities),
                "o host NUNCA aplica o anúncio de Capabilities do controlador (#1000 AC1)",
            );
        }
    }

    /// Controle de clipboard/file segue o gate de capability (RB6): negado quando
    /// desligado, permitido quando ligado — e o gate NÃO é o braço da AC1.
    #[test]
    fn controle_clipboard_respeita_o_gate_de_capability() {
        let clip = ControlFrame::Control(ControlMessage::ClipboardText {
            text: "x".to_owned(),
        });
        assert_eq!(
            autorizar_frame(RemoteRole::Host, Capabilities::default(), &clip, &HashSet::new()).ok(),
            Some(FrameAcao::ControleBloqueado),
        );
        let caps = Capabilities {
            clipboard: true,
            ..Default::default()
        };
        assert_eq!(
            autorizar_frame(RemoteRole::Host, caps, &clip, &HashSet::new()).ok(),
            Some(FrameAcao::ControlePermitido(ControlMessage::ClipboardText {
                text: "x".to_owned()
            })),
        );
    }

    /// #1000 AC2 — o accepted-set VAZIO barra TODO chunk (órfão), ANTES e INDEPENDENTE
    /// da capability: `file_transfer` ligado NÃO salva um chunk sem oferta aceita.
    /// Documenta o estado de hoje (nada popula o conjunto ⇒ vazio por construção).
    /// **Mutação:** trocar `!transfers_aceitos.contains` por `false` faz este teste
    /// virar `ChunkPermitido` e ficar vermelho.
    #[test]
    fn chunk_orfao_recusado_mesmo_com_file_transfer_ligado() {
        let chunk = ControlFrame::Chunk {
            transfer_id: 7,
            offset: 0,
            data: vec![1, 2, 3],
        };
        let com_file = Capabilities {
            file_transfer: true,
            ..Default::default()
        };
        // conjunto VAZIO + file_transfer LIGADO ⇒ órfão (a capability não salva).
        assert_eq!(
            autorizar_frame(RemoteRole::Host, com_file, &chunk, &HashSet::new()).ok(),
            Some(FrameAcao::ChunkOrfao),
        );
        // conjunto VAZIO + file_transfer DESLIGADO ⇒ órfão (checado ANTES da capability).
        assert_eq!(
            autorizar_frame(RemoteRole::Host, Capabilities::default(), &chunk, &HashSet::new()).ok(),
            Some(FrameAcao::ChunkOrfao),
        );
    }

    /// #1000 AC2 — com a oferta ACEITA (transfer_id no conjunto), o chunk volta a
    /// seguir a capability: as duas negativas (órfão × capability) são independentes.
    #[test]
    fn chunk_com_oferta_aceita_segue_a_capability() {
        let chunk = ControlFrame::Chunk {
            transfer_id: 7,
            offset: 0,
            data: vec![1, 2, 3],
        };
        let aceitos: HashSet<u32> = [7].into_iter().collect();
        // aceito + SEM capability ⇒ bloqueado por CAPABILITY (não órfão).
        assert_eq!(
            autorizar_frame(RemoteRole::Host, Capabilities::default(), &chunk, &aceitos).ok(),
            Some(FrameAcao::ChunkBloqueado),
        );
        // aceito + COM capability ⇒ permitido.
        let com_file = Capabilities {
            file_transfer: true,
            ..Default::default()
        };
        assert_eq!(
            autorizar_frame(RemoteRole::Host, com_file, &chunk, &aceitos).ok(),
            Some(FrameAcao::ChunkPermitido),
        );
        // chunk de OUTRO transfer_id (fora do conjunto) ⇒ órfão, mesmo com conjunto não-vazio.
        let outro = ControlFrame::Chunk {
            transfer_id: 9,
            offset: 0,
            data: vec![9],
        };
        assert_eq!(
            autorizar_frame(RemoteRole::Host, com_file, &outro, &aceitos).ok(),
            Some(FrameAcao::ChunkOrfao),
        );
    }

    /// Input real (mouse/teclado) no host COM `caps.input` → `AplicarInput`. O
    /// executor (`apply_host_input`) reconfere role/caps/injector (cinto-e-
    /// suspensórios), mas a autorização já é dada aqui.
    #[test]
    fn input_real_no_host_com_caps_input_autoriza_aplicar() {
        let frame = ControlFrame::Input(InputEvent::Key {
            tecla: Tecla::Enter,
            pressed: true,
        });
        let caps = Capabilities {
            input: true,
            ..Default::default()
        };
        assert_eq!(
            autorizar_frame(RemoteRole::Host, caps, &frame, &HashSet::new()).ok(),
            Some(FrameAcao::AplicarInput(InputEvent::Key {
                tecla: Tecla::Enter,
                pressed: true
            })),
        );
    }

    /// #1000 (revisão do `altair`, PR #1313): `autorizar_frame` tem que AUTORIZAR
    /// input, não só classificá-lo — senão o gate de `caps.input` some quando o
    /// pump aplicar o input pelo próprio caminho. Host SEM `caps.input` → o input
    /// NÃO é autorizado (`InputDisabled`), nunca `AplicarInput`.
    #[test]
    fn input_no_host_sem_caps_input_nao_e_autorizado() {
        let frame = ControlFrame::Input(InputEvent::Key {
            tecla: Tecla::Enter,
            pressed: true,
        });
        let acao = autorizar_frame(RemoteRole::Host, Capabilities::default(), &frame, &HashSet::new());
        assert!(
            matches!(acao, Err(RemoteError::InputDisabled)),
            "host sem caps.input não pode obter AplicarInput (funil de autorização, #1000)",
        );
    }

    /// Input real é controlador→host: no CONTROLADOR é direção inválida, mesmo com
    /// todas as capabilities ligadas (não vira `AplicarInput`).
    #[test]
    fn input_real_no_controlador_e_direcao_invalida() {
        let frame = ControlFrame::Input(InputEvent::Key {
            tecla: Tecla::Enter,
            pressed: true,
        });
        let caps = Capabilities {
            input: true,
            ..Default::default()
        };
        assert!(matches!(
            autorizar_frame(RemoteRole::Controller, caps, &frame, &HashSet::new()),
            Err(RemoteError::InvalidInputDirection)
        ));
    }

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
            capabilities: Capabilities {
                screen: true,
                input: true,
                ..Default::default()
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

    // ── #1130: o AC "o segredo TURN nunca aparece em log" ganha guarda ───────
    //
    // O card exige, literalmente: *"Dado o segredo TURN, Então ele nunca aparece
    // em log"*. Isso vinha sendo sustentado por COMENTÁRIO — `remote.rs:697` e
    // `:1562` dizem "NUNCA é logado" — e o arquivo inteiro não tinha uma única
    // asserção de log (`grep capturar_logs` voltava vazio).
    //
    // Comentário não segura refactor. Quem acrescentar um `{server:?}` numa linha
    // de diagnóstico derruba o AC sem que nada fique vermelho, e a credencial
    // efêmera HMAC vai pro arquivo de log do cliente.
    //
    // Nota de método: `assert_nao_logou` exige um nível, e um segredo vaza em
    // QUALQUER nível. Por isso a varredura abaixo é por nível nenhum — olha todos
    // os registros capturados.

    /// O segredo não pode aparecer em nível nenhum. `assert_nao_logou` pergunta
    /// por um nível só; aqui a pergunta é "apareceu em algum lugar?".
    fn nenhum_registro_contem(registros: &[crate::teste_log::Registro], agulha: &str) -> bool {
        !registros.iter().any(|r| r.msg.contains(agulha))
    }

    const SEGREDO: &str = "SEGREDO-EFEMERO-NAO-PODE-VAZAR";

    fn ice_server_com_segredo(url: &str) -> IceServer {
        IceServer {
            urls: vec![url.to_string()],
            username: "usuario-efemero".into(),
            credential: SEGREDO.into(),
        }
    }

    #[test]
    fn sondagem_de_ice_servers_nao_loga_o_segredo() {
        let servers = vec![
            ice_server_com_segredo("turn:127.0.0.1:3478?transport=udp"),
            IceServer {
                urls: vec!["stun:127.0.0.1:3478".into()],
                username: String::new(),
                credential: String::new(),
            },
        ];

        let logs = crate::teste_log::capturar_logs(|| logar_sondagem_ice_servers(&servers));

        // Par positivo: a sondagem TEM de logar. Sem isto, apagar a linha inteira
        // faria o teste passar — e a sondagem #1108 existe justamente pra dizer
        // se o coturn já entrega credencial.
        crate::teste_log::assert_logou(
            &logs,
            log::Level::Info,
            "ice_servers recebidos: 2 servidor(es)",
        );
        crate::teste_log::assert_logou(&logs, log::Level::Info, "PRONTO p/ relay");

        // E o par negativo, que é o AC do card.
        assert!(
            nenhum_registro_contem(&logs, SEGREDO),
            "o segredo TURN VAZOU para o log — AC do #1130. Capturado: {logs:?}",
        );
        assert!(
            nenhum_registro_contem(&logs, "usuario-efemero"),
            "o username efemero tambem identifica a credencial e nao deve ir pro log",
        );
    }

    /// O caminho de FALHA é onde diagnóstico costuma vazar segredo: alguém quer
    /// "ver o servidor inteiro" e imprime a struct. Aqui o host não resolve, então
    /// o ramo de erro roda de verdade.
    #[test]
    fn resolver_turn_alvos_nao_loga_o_segredo_quando_o_host_nao_resolve() {
        let servers = vec![ice_server_com_segredo(
            "turn:host-que-nao-existe.invalid:3478?transport=udp",
        )];

        let logs = crate::teste_log::capturar_logs(|| {
            let alvos = resolver_turn_alvos(&servers);
            assert!(alvos.is_empty(), "host inexistente nao vira alvo");
        });

        // Par positivo: o ramo de erro tem de FALAR (senão o relay some calado).
        crate::teste_log::assert_logou(&logs, log::Level::Warn, "relay pulado");

        assert!(
            nenhum_registro_contem(&logs, SEGREDO),
            "o segredo TURN vazou no caminho de FALHA — que e exatamente onde \
             alguem imprime a struct inteira pra 'ver o que veio'. Capturado: {logs:?}",
        );
    }

}
