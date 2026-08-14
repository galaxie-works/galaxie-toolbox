//! Pipeline Windows. Captura e encoder concreto entram neste módulo.

pub mod capture;
mod gpu;
pub mod media_foundation;
pub mod monitors;

pub use capture::{
    CaptureBackend, PipelineError, PipelineOutcome, run_pipeline, run_pipeline_with_monitors,
};
pub use media_foundation::{HardwareEncoderInfo, probe_hardware_h264_encoders};
pub use monitors::{MonitorError, enumerate_monitors};
