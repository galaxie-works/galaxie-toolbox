//! Frozen network boundary for GALAXIE Remote unattended access (S8).
//!
//! `Galaxie.Remote.Net.v2` is independent from the local S7 broker pipe. It
//! carries enrollment/authentication/session control only. Media and input stay
//! on the existing WebRTC/DataChannel path.

pub mod identity;
pub mod opaque;
pub mod protocol;
pub mod ticket;

#[cfg(windows)]
pub mod windows_secret;

pub const PROTOCOL_NAME: &str = "Galaxie.Remote.Net.v2";
pub const PROTOCOL_VERSION: u16 = 2;
pub const MAX_MESSAGE_BYTES: usize = 64 * 1024;
