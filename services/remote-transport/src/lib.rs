//! `galaxie-remote-transport` — transporte WebRTC do GALAXIE Remote (S2, épico
//! #682). str0m sans-I/O: ICE via nosso coturn (STUN/TURN do S0), media track de
//! vídeo H.264 (do encoder S1) + DataChannel de controle, E2E DTLS-SRTP.
//!
//! Fronteiras:
//! - **encoder (S1) ↔ transporte (S2):** contrato [`CodedFrame`] (congelado).
//! - **transporte ↔ signaling (S0):** [`SignalingChannel`] + [`SignalMessage`].
//! - **transporte ↔ rede:** sans-I/O — o app faz o UDP; o [`Transport`] só diz o
//!   que transmitir/quando ([`Passo`]).

// Controle de bitrate adaptativo (#1182) — PURO (BWE→encoder, sem str0m); fica no
// núcleo pra o `cargo test` default exercitar sem OpenSSL.
pub mod bitrate;
pub mod bridge;
pub mod command;
pub mod control;
pub mod frame;
pub mod input;
pub mod signaling;
pub mod stats;
// Codec STUN Binding (RFC 5389) do gathering srflx — PURO (sem str0m/OpenSSL);
// fica no núcleo pra o `cargo test` default do CI exercitar sem toolchain. #1108.
pub mod stun;
// Codec TURN (RFC 5766) do candidato relay — PURO (sem str0m/OpenSSL), espelha o
// stun.rs e reusa o XOR-address dele. Só o codec; o I/O é a fatia 2. #1130.
pub mod turn;
pub mod transfer;

// Injeção de input (S3) — puxa o enigo; a UI/host liga a feature `input`.
#[cfg(feature = "input")]
pub mod injector;

// Áudio (S6) — encode Opus (puxa audiopus); a captura WASAPI é só Windows.
#[cfg(feature = "audio")]
pub mod audio;
#[cfg(all(feature = "audio", windows))]
pub mod capture_wasapi;

// A sessão str0m depende de OpenSSL (DTLS) — atrás da feature `webrtc` (default).
// Sem ela, o crate compila só o núcleo (contrato/signaling/stats), útil em
// ambiente sem toolchain OpenSSL.
#[cfg(feature = "webrtc")]
pub mod session;

// Driver de I/O (casa o Transport sans-I/O com um UdpSocket real) — precisa do
// `session`, logo também atrás de `webrtc`.
#[cfg(feature = "webrtc")]
pub mod driver;

pub use bitrate::AplicadorBitrate;
pub use bridge::{FrameBridge, FrameFim};
pub use command::{canal_de_comandos, CommandChannel, CommandReceiver, EncoderCommand};
pub use control::{
    decode, encode_chunk, encode_control, encode_input, CapabilityPolicy, ControlError,
    ControlMessage, Frame,
};
pub use frame::{canal_de_frames, CodedFrame, CodedFrameSource, DummyFrameSource, FrameSender};
pub use input::{BotaoMouse, InputEvent, ScreenInfo, Tecla};

#[cfg(feature = "input")]
pub use injector::{InjectError, Injector};

#[cfg(feature = "audio")]
pub use audio::{AudioConfig, AudioError, CapturaAudio, CapturaSilencio, OpusEncoder};
pub use signaling::{
    IceServer, RecordingSignaling, SignalMessage, SignalingChannel, SignalingError,
};
pub use stats::{Stats, StatsSnapshot};
pub use transfer::{resolver_conflito, FileReceiver, FileSender};

#[cfg(feature = "webrtc")]
pub use session::{EventoSessao, Papel, Passo, SessionConfig, Transport, TransportError};
