//! `galaxie-remote-transport` — transporte WebRTC do GALAXIE Remote (S2, épico
//! #682). str0m sans-I/O: ICE via nosso coturn (STUN/TURN do S0), media track de
//! vídeo H.264 (do encoder S1) + DataChannel de controle, E2E DTLS-SRTP.
//!
//! Fronteiras:
//! - **encoder (S1) ↔ transporte (S2):** contrato [`CodedFrame`] (congelado).
//! - **transporte ↔ signaling (S0):** [`SignalingChannel`] + [`SignalMessage`].
//! - **transporte ↔ rede:** sans-I/O — o app faz o UDP; o [`Transport`] só diz o
//!   que transmitir/quando ([`Passo`]).

pub mod bridge;
pub mod command;
pub mod control;
pub mod frame;
pub mod input;
pub mod signaling;
pub mod stats;
pub mod transfer;

// Injeção de input (S3) — puxa o enigo; a UI/host liga a feature `input`.
#[cfg(feature = "input")]
pub mod injector;

// A sessão str0m depende de OpenSSL (DTLS) — atrás da feature `webrtc` (default).
// Sem ela, o crate compila só o núcleo (contrato/signaling/stats), útil em
// ambiente sem toolchain OpenSSL.
#[cfg(feature = "webrtc")]
pub mod session;

pub use bridge::{FrameBridge, FrameFim};
pub use command::{canal_de_comandos, CommandChannel, CommandReceiver, EncoderCommand};
pub use control::{
    decode, encode_chunk, encode_control, CapabilityPolicy, ControlError, ControlMessage, Frame,
};
pub use frame::{canal_de_frames, CodedFrame, CodedFrameSource, DummyFrameSource, FrameSender};
pub use input::{BotaoMouse, InputEvent, ScreenInfo, Tecla};

#[cfg(feature = "input")]
pub use injector::{InjectError, Injector};
pub use signaling::{
    IceServer, RecordingSignaling, SignalMessage, SignalingChannel, SignalingError,
};
pub use stats::{Stats, StatsSnapshot};
pub use transfer::{resolver_conflito, FileReceiver, FileSender};

#[cfg(feature = "webrtc")]
pub use session::{EventoSessao, Papel, Passo, SessionConfig, Transport, TransportError};
