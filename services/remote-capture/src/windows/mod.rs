//! Pipeline Windows. Captura e encoder concreto entram neste módulo.

pub mod capture;
mod gpu;
pub mod media_foundation;

pub use capture::{CaptureBackend, PipelineError, PipelineOutcome, run_pipeline};
pub use media_foundation::{HardwareEncoderInfo, probe_hardware_h264_encoders};
