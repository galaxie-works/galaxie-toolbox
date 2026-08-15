//! Frozen network boundary for GALAXIE Remote unattended access (S8).
//!
//! `Galaxie.Remote.Net.v2` is independent from the local S7 broker pipe. It
//! carries enrollment/authentication/session control only. Media and input stay
//! on the existing WebRTC/DataChannel path.

// Núcleo leve (default): protocol/ticket/identity + windows_secret. O worker
// SYSTEM consome só isto. authority/opaque atrás de `authority` (S0); worker/
// transport atrás de `client` (daemon #691) — ver [features] no Cargo.toml (D1-bis).
#[cfg(feature = "authority")]
pub mod authority;
pub mod identity;
#[cfg(feature = "authority")]
pub mod opaque;
pub mod protocol;
pub mod ticket;
#[cfg(feature = "client")]
pub mod transport;
#[cfg(feature = "client")]
pub mod worker;

#[cfg(windows)]
pub mod windows_secret;

pub const PROTOCOL_NAME: &str = "Galaxie.Remote.Net.v2";
pub const PROTOCOL_VERSION: u16 = 2;
pub const MAX_MESSAGE_BYTES: usize = 64 * 1024;
