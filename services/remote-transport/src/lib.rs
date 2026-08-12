//! `galaxie-remote-transport` — transporte WebRTC do GALAXIE Remote (S2, épico
//! #682). str0m sans-I/O: ICE via nosso coturn (STUN/TURN do S0), media track de
//! vídeo H.264 (do encoder S1) + DataChannel de controle, E2E DTLS-SRTP.
//!
//! Fronteiras:
//! - **encoder (S1) ↔ transporte (S2):** contrato [`CodedFrame`] (congelado).
//! - **transporte ↔ signaling (S0):** [`SignalingChannel`] + [`SignalMessage`].
//! - **transporte ↔ rede:** sans-I/O — o app faz o UDP; o [`Transport`] só diz o
//!   que transmitir/quando ([`Passo`]).

pub mod frame;
pub mod signaling;
pub mod stats;

// A sessão str0m depende de OpenSSL (DTLS) — atrás da feature `webrtc` (default).
// Sem ela, o crate compila só o núcleo (contrato/signaling/stats), útil em
// ambiente sem toolchain OpenSSL.
#[cfg(feature = "webrtc")]
pub mod session;

pub use frame::{CodedFrame, CodedFrameSource, DummyFrameSource};
pub use signaling::{
    IceServer, RecordingSignaling, SignalMessage, SignalingChannel, SignalingError,
};
pub use stats::{Stats, StatsSnapshot};

#[cfg(feature = "webrtc")]
pub use session::{EventoSessao, Papel, Passo, SessionConfig, Transport, TransportError};
