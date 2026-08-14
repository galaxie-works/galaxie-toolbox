//! Captura de desktop e encode H.264 de baixa latência para o Remote.
//!
//! A fronteira pública replica o contrato congelado entre #684 (S1) e #685
//! (S2). O módulo Windows escolhe WGC primeiro, cai para Desktop Duplication
//! quando necessário e escolhe Media Foundation hardware antes do OpenH264.

pub mod annexb;
pub mod config;
pub mod contract;
pub mod monitor;
pub mod stats;

#[cfg(windows)]
pub mod software;
#[cfg(windows)]
pub mod windows;

pub use config::{CaptureBackendPreference, EncoderPreference, PipelineConfig};
pub use contract::{CodedFrame, EncoderCommand, FrameSender};
pub use monitor::{
    MONITOR_TODOS, MonitorControlMessage, MonitorController, MonitorHostControl, MonitorInfo,
    MonitorSelectionError, ScreenInfo, canal_de_monitores, monitor_control_channel,
};
pub use stats::{LatencySnapshot, PipelineStats};
