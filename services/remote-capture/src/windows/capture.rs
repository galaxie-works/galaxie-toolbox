use std::error::Error as StdError;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use windows::Win32::Graphics::Direct3D11::{ID3D11Device, ID3D11DeviceContext};
use windows_capture::capture::{Context, GraphicsCaptureApiHandler};
use windows_capture::dxgi_duplication_api::{
    DxgiDuplicationApi, DxgiDuplicationFormat, Error as DxgiError,
};
use windows_capture::frame::Frame;
use windows_capture::graphics_capture_api::InternalCaptureControl;
use windows_capture::monitor::Monitor;
use windows_capture::settings::{
    ColorFormat, CursorCaptureSettings, DirtyRegionSettings, DrawBorderSettings,
    MinimumUpdateIntervalSettings, SecondaryWindowSettings, Settings,
};

use crate::config::{CaptureBackendPreference, EncoderPreference, PipelineConfig};
use crate::contract::{CommandReceiver, EncoderCommand, FrameSender};
use crate::software::SoftwareEncoder;
use crate::stats::{LatencySnapshot, PipelineStats};

use super::media_foundation::{MediaFoundationH264Encoder, probe_hardware_h264_encoders};

type HandlerError = Box<dyn StdError + Send + Sync>;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CaptureBackend {
    WindowsGraphicsCapture,
    DesktopDuplication,
}

#[derive(Debug, Clone)]
pub struct PipelineOutcome {
    pub capture_backend: CaptureBackend,
    pub encoder_name: String,
    pub width: u32,
    pub height: u32,
    pub elapsed: Duration,
    pub frames_captured: u64,
    pub frames_encoded: u64,
    pub frames_dropped: u64,
    pub encode_latency: LatencySnapshot,
}

impl PipelineOutcome {
    #[must_use]
    pub fn effective_fps(&self) -> f64 {
        self.frames_encoded as f64 / self.elapsed.as_secs_f64().max(f64::EPSILON)
    }
}

#[derive(Debug, thiserror::Error)]
pub enum PipelineError {
    #[error("configuração: {0}")]
    Config(#[from] crate::config::ConfigError),
    #[error("monitor: {0}")]
    Monitor(#[from] windows_capture::monitor::Error),
    #[error("captura WGC: {0}")]
    Wgc(String),
    #[error("Desktop Duplication: {0}")]
    Dxgi(#[from] DxgiError),
    #[error("encoder: {0}")]
    Encoder(String),
    #[error("o encoder hardware foi exigido, mas nenhum MFT H.264 está disponível")]
    HardwareEncoderUnavailable,
    #[error("o consumidor de frames foi desconectado")]
    FrameConsumerDisconnected,
}

#[derive(Debug, Default)]
struct SharedState {
    stats: PipelineStats,
    encoder_name: String,
    width: u32,
    height: u32,
}

#[derive(Clone)]
struct WgcFlags {
    config: PipelineConfig,
    source_size: (u32, u32),
    frames: FrameSender,
    commands: Arc<Mutex<CommandReceiver>>,
    state: Arc<Mutex<SharedState>>,
}

struct WgcCapture {
    config: PipelineConfig,
    frames: FrameSender,
    commands: Arc<Mutex<CommandReceiver>>,
    state: Arc<Mutex<SharedState>>,
    encoder: Option<ActiveEncoder>,
    encoder_source_size: Option<(u32, u32)>,
    packed: Vec<u8>,
    started: Instant,
    first_capture_ticks: Option<i64>,
    next_output_us: Option<u64>,
}

enum ActiveEncoder {
    Hardware(MediaFoundationH264Encoder),
    Software(Box<SoftwareEncoder>),
}

impl ActiveEncoder {
    fn request_keyframe(&mut self) -> Result<(), HandlerError> {
        match self {
            Self::Hardware(encoder) => encoder.request_keyframe()?,
            Self::Software(encoder) => encoder.request_keyframe(),
        }
        Ok(())
    }
}

impl GraphicsCaptureApiHandler for WgcCapture {
    type Flags = WgcFlags;
    type Error = HandlerError;

    fn new(context: Context<Self::Flags>) -> Result<Self, Self::Error> {
        let encoder = create_encoder(
            &context.flags.config,
            &context.device,
            &context.device_context,
            context.flags.source_size.0,
            context.flags.source_size.1,
            &context.flags.state,
        )?;
        Ok(Self {
            config: context.flags.config,
            frames: context.flags.frames,
            commands: context.flags.commands,
            state: context.flags.state,
            encoder: Some(encoder),
            encoder_source_size: Some(context.flags.source_size),
            packed: Vec::new(),
            started: Instant::now(),
            first_capture_ticks: None,
            next_output_us: None,
        })
    }

    fn on_frame_arrived(
        &mut self,
        frame: &mut Frame,
        control: InternalCaptureControl,
    ) -> Result<(), Self::Error> {
        if self
            .config
            .stop_after
            .is_some_and(|duration| self.started.elapsed() >= duration)
        {
            control.stop();
            return Ok(());
        }

        let timestamp_us = monotonic_wgc_timestamp(frame, &mut self.first_capture_ticks)
            .unwrap_or_else(|_| self.started.elapsed().as_micros() as u64);
        let interval_us = 1_000_000u64 / u64::from(self.config.fps);
        // WGC e dirigido pelo compositor. Pedimos updates acima do alvo e
        // fazemos pacing pelos timestamps para nao cair num divisor abaixo de
        // 60 fps em monitores de alta taxa, nem publicar acima do configurado.
        if let Some(next_output_us) = self.next_output_us
            && timestamp_us < next_output_us
        {
            if let Ok(mut state) = self.state.lock() {
                state.stats.record_capture();
                state.stats.record_drop();
            }
            return Ok(());
        }
        let mut next_output_us = self.next_output_us.unwrap_or(timestamp_us);
        while next_output_us <= timestamp_us {
            next_output_us = next_output_us.saturating_add(interval_us);
        }
        self.next_output_us = Some(next_output_us);
        drain_keyframe_requests(&self.commands, self.encoder.as_mut())?;

        let encode_started = Instant::now();
        let width = frame.width();
        let height = frame.height();
        if self.encoder.is_none() || self.encoder_source_size != Some((width, height)) {
            self.encoder = Some(create_encoder(
                &self.config,
                frame.device(),
                frame.device_context(),
                width,
                height,
                &self.state,
            )?);
            self.encoder_source_size = Some((width, height));
        }
        let encoded = self.encode_frame(frame, timestamp_us)?;

        let mut state = self.state.lock().map_err(|_| "pipeline state poisoned")?;
        state.stats.record_capture();
        match encoded {
            Some(frame) => {
                self.frames
                    .send(frame)
                    .map_err(|_| "frame consumer disconnected")?;
                state.stats.record_encode(encode_started.elapsed());
            }
            None => state.stats.record_drop(),
        }
        Ok(())
    }
}

impl WgcCapture {
    fn encode_frame(
        &mut self,
        frame: &mut Frame,
        timestamp_us: u64,
    ) -> Result<Option<crate::contract::CodedFrame>, HandlerError> {
        let mut encoder = self.encoder.take().ok_or("encoder did not initialize")?;
        if let ActiveEncoder::Software(software) = &mut encoder {
            let buffer = frame.buffer()?;
            let encoded =
                software.encode_bgra(buffer.as_nopadding_buffer(&mut self.packed), timestamp_us)?;
            self.encoder = Some(encoder);
            return Ok(encoded);
        }

        let ActiveEncoder::Hardware(hardware) = &mut encoder else {
            unreachable!()
        };
        match hardware.encode_texture(frame.as_raw_texture(), timestamp_us) {
            Ok(encoded) => {
                self.encoder = Some(encoder);
                Ok(encoded)
            }
            Err(error) if self.config.encoder == EncoderPreference::Auto => {
                tracing::warn!(%error, "encoder Media Foundation falhou; alternando para OpenH264");
                let mut software = SoftwareEncoder::new(
                    frame.width(),
                    frame.height(),
                    self.config.fps,
                    self.config.bitrate_bps,
                )?;
                let fallback_width = frame.width();
                let fallback_height = frame.height();
                let buffer = frame.buffer()?;
                let encoded = software
                    .encode_bgra(buffer.as_nopadding_buffer(&mut self.packed), timestamp_us)?;
                if let Ok(mut state) = self.state.lock() {
                    state.encoder_name = "OpenH264 software (fallback runtime)".to_owned();
                    state.width = fallback_width;
                    state.height = fallback_height;
                }
                self.encoder = Some(ActiveEncoder::Software(Box::new(software)));
                Ok(encoded)
            }
            Err(error) => Err(Box::new(error)),
        }
    }
}

fn monotonic_wgc_timestamp(
    frame: &Frame<'_>,
    first_ticks: &mut Option<i64>,
) -> Result<u64, windows_capture::frame::Error> {
    let ticks = frame.timestamp()?.Duration;
    let start = first_ticks.get_or_insert(ticks);
    Ok(ticks.saturating_sub(*start) as u64 / 10)
}

fn drain_keyframe_requests(
    commands: &Arc<Mutex<CommandReceiver>>,
    encoder: Option<&mut ActiveEncoder>,
) -> Result<(), HandlerError> {
    let Some(encoder) = encoder else {
        return Ok(());
    };
    let Ok(commands) = commands.lock() else {
        return Ok(());
    };
    while let Some(EncoderCommand::RequestKeyframe) = commands.try_receive() {
        encoder.request_keyframe()?;
    }
    Ok(())
}

fn create_encoder(
    config: &PipelineConfig,
    device: &ID3D11Device,
    context: &ID3D11DeviceContext,
    width: u32,
    height: u32,
    state: &Arc<Mutex<SharedState>>,
) -> Result<ActiveEncoder, HandlerError> {
    if config.encoder != EncoderPreference::OpenH264Software {
        match MediaFoundationH264Encoder::new(
            device,
            context,
            (width, height),
            (config.width, config.height),
            config.fps,
            config.bitrate_bps,
        ) {
            Ok(encoder) => {
                if let Ok(mut state) = state.lock() {
                    state.encoder_name = encoder.name().to_owned();
                    state.width = config.width;
                    state.height = config.height;
                }
                return Ok(ActiveEncoder::Hardware(encoder));
            }
            Err(error) if config.encoder == EncoderPreference::MediaFoundationHardware => {
                return Err(Box::new(error));
            }
            Err(error) => tracing::warn!(%error, "Media Foundation indisponivel; usando OpenH264"),
        }
    }
    let encoder = SoftwareEncoder::new(width, height, config.fps, config.bitrate_bps)?;
    if let Ok(mut state) = state.lock() {
        state.encoder_name = "OpenH264 software".to_owned();
        state.width = width;
        state.height = height;
    }
    Ok(ActiveEncoder::Software(Box::new(encoder)))
}

fn monitor(config: &PipelineConfig) -> Result<Monitor, PipelineError> {
    Ok(Monitor::from_index(config.monitor_index)?)
}

fn shared_outcome(
    backend: CaptureBackend,
    state: &Arc<Mutex<SharedState>>,
    elapsed: Duration,
) -> Result<PipelineOutcome, PipelineError> {
    let state = state
        .lock()
        .map_err(|_| PipelineError::Encoder("pipeline state poisoned".to_owned()))?;
    Ok(PipelineOutcome {
        capture_backend: backend,
        encoder_name: state.encoder_name.clone(),
        width: state.width,
        height: state.height,
        elapsed,
        frames_captured: state.stats.frames_captured(),
        frames_encoded: state.stats.frames_encoded(),
        frames_dropped: state.stats.frames_dropped(),
        encode_latency: state.stats.latency(),
    })
}

fn run_wgc(
    config: &PipelineConfig,
    frames: FrameSender,
    commands: Arc<Mutex<CommandReceiver>>,
    state: Arc<Mutex<SharedState>>,
) -> Result<PipelineOutcome, PipelineError> {
    let started = Instant::now();
    let monitor = monitor(config)?;
    let source_size = (monitor.width()?, monitor.height()?);
    let cursor = if config.include_cursor {
        CursorCaptureSettings::WithCursor
    } else {
        CursorCaptureSettings::WithoutCursor
    };
    let dirty_regions = if config.dirty_regions {
        DirtyRegionSettings::ReportOnly
    } else {
        DirtyRegionSettings::Default
    };
    let settings = Settings::new(
        monitor,
        cursor,
        DrawBorderSettings::WithoutBorder,
        SecondaryWindowSettings::Default,
        MinimumUpdateIntervalSettings::Custom(Duration::from_secs_f64(
            1.0 / (f64::from(config.fps) * 4.0),
        )),
        dirty_regions,
        ColorFormat::Bgra8,
        WgcFlags {
            config: config.clone(),
            source_size,
            frames,
            commands,
            state: state.clone(),
        },
    );
    WgcCapture::start(settings).map_err(|error| PipelineError::Wgc(error.to_string()))?;
    let elapsed = config.stop_after.unwrap_or_else(|| started.elapsed());
    shared_outcome(CaptureBackend::WindowsGraphicsCapture, &state, elapsed)
}

fn run_dxgi(
    config: &PipelineConfig,
    frames: FrameSender,
    commands: Arc<Mutex<CommandReceiver>>,
    state: Arc<Mutex<SharedState>>,
) -> Result<PipelineOutcome, PipelineError> {
    let monitor = monitor(config)?;
    let mut capture = DxgiDuplicationApi::new_options(monitor, &[DxgiDuplicationFormat::Bgra8])?;
    let mut encoder = create_encoder(
        config,
        capture.device(),
        capture.device_context(),
        capture.width(),
        capture.height(),
        &state,
    )
    .map_err(|error| PipelineError::Encoder(error.to_string()))?;
    let started = Instant::now();
    let frame_interval = Duration::from_secs_f64(1.0 / f64::from(config.fps));
    let mut next_frame_at = started;
    let timeout_ms = (1_000 / config.fps).max(1);
    let mut packed = Vec::new();

    loop {
        if config
            .stop_after
            .is_some_and(|duration| started.elapsed() >= duration)
        {
            break;
        }
        if let Ok(commands) = commands.lock() {
            while let Some(EncoderCommand::RequestKeyframe) = commands.try_receive() {
                encoder
                    .request_keyframe()
                    .map_err(|error| PipelineError::Encoder(error.to_string()))?;
            }
        }
        let now = Instant::now();
        if now < next_frame_at {
            std::thread::sleep(next_frame_at - now);
        }
        next_frame_at = Instant::now() + frame_interval;
        let mut frame = match capture.acquire_next_frame(timeout_ms) {
            Ok(frame) => frame,
            Err(DxgiError::Timeout) => continue,
            Err(DxgiError::AccessLost) => {
                capture = capture.recreate_options(&[DxgiDuplicationFormat::Bgra8])?;
                encoder = create_encoder(
                    config,
                    capture.device(),
                    capture.device_context(),
                    capture.width(),
                    capture.height(),
                    &state,
                )
                .map_err(|error| PipelineError::Encoder(error.to_string()))?;
                continue;
            }
            Err(error) => return Err(error.into()),
        };
        let timestamp_us = started.elapsed().as_micros() as u64;
        let encode_started = Instant::now();
        let hardware_result = if let ActiveEncoder::Hardware(hardware) = &mut encoder {
            Some(hardware.encode_texture(frame.texture(), timestamp_us))
        } else {
            None
        };
        let encoded = if let Some(result) = hardware_result {
            match result {
                Ok(encoded) => encoded,
                Err(error) if config.encoder == EncoderPreference::Auto => {
                    tracing::warn!(%error, "encoder Media Foundation falhou no DXGI; alternando para OpenH264");
                    let mut software = SoftwareEncoder::new(
                        frame.width(),
                        frame.height(),
                        config.fps,
                        config.bitrate_bps,
                    )
                    .map_err(|error| PipelineError::Encoder(error.to_string()))?;
                    let fallback_width = frame.width();
                    let fallback_height = frame.height();
                    let buffer = frame.buffer()?;
                    let encoded = software
                        .encode_bgra(buffer.as_nopadding_buffer(&mut packed), timestamp_us)
                        .map_err(|error| PipelineError::Encoder(error.to_string()))?;
                    encoder = ActiveEncoder::Software(Box::new(software));
                    if let Ok(mut state) = state.lock() {
                        state.encoder_name = "OpenH264 software (fallback runtime)".to_owned();
                        state.width = fallback_width;
                        state.height = fallback_height;
                    }
                    encoded
                }
                Err(error) => return Err(PipelineError::Encoder(error.to_string())),
            }
        } else {
            let ActiveEncoder::Software(software) = &mut encoder else {
                unreachable!()
            };
            let buffer = frame.buffer()?;
            software
                .encode_bgra(buffer.as_nopadding_buffer(&mut packed), timestamp_us)
                .map_err(|error| PipelineError::Encoder(error.to_string()))?
        };
        let mut state = state
            .lock()
            .map_err(|_| PipelineError::Encoder("pipeline state poisoned".to_owned()))?;
        state.stats.record_capture();
        match encoded {
            Some(frame) => {
                frames
                    .send(frame)
                    .map_err(|_| PipelineError::FrameConsumerDisconnected)?;
                state.stats.record_encode(encode_started.elapsed());
            }
            None => state.stats.record_drop(),
        }
    }

    shared_outcome(
        CaptureBackend::DesktopDuplication,
        &state,
        started.elapsed(),
    )
}

fn select_encoder(config: &PipelineConfig) -> Result<String, PipelineError> {
    match config.encoder {
        EncoderPreference::OpenH264Software => Ok("OpenH264 software".to_owned()),
        EncoderPreference::MediaFoundationHardware => {
            let available = probe_hardware_h264_encoders()
                .map_err(|error| PipelineError::Encoder(error.to_string()))?;
            available
                .first()
                .map(|encoder| encoder.name.clone())
                .ok_or(PipelineError::HardwareEncoderUnavailable)
        }
        EncoderPreference::Auto => {
            let available = probe_hardware_h264_encoders().unwrap_or_default();
            if available.is_empty() {
                Ok("OpenH264 software (hardware indisponível)".to_owned())
            } else {
                Ok("Media Foundation hardware (inicializando)".to_owned())
            }
        }
    }
}

pub fn run_pipeline(
    config: PipelineConfig,
    frames: FrameSender,
    commands: CommandReceiver,
) -> Result<PipelineOutcome, PipelineError> {
    config.validate()?;
    let commands = Arc::new(Mutex::new(commands));
    let state = Arc::new(Mutex::new(SharedState {
        stats: PipelineStats::default(),
        encoder_name: select_encoder(&config)?,
        width: 0,
        height: 0,
    }));

    match config.capture_backend {
        CaptureBackendPreference::WindowsGraphicsCapture => {
            run_wgc(&config, frames, commands, state)
        }
        CaptureBackendPreference::DesktopDuplication => run_dxgi(&config, frames, commands, state),
        CaptureBackendPreference::Auto => {
            match run_wgc(&config, frames.clone(), commands.clone(), state.clone()) {
                Ok(outcome) => Ok(outcome),
                Err(error) => {
                    let emitted_frames = state
                        .lock()
                        .map(|state| state.stats.frames_captured())
                        .unwrap_or(1);
                    if emitted_frames == 0 {
                        tracing::warn!(%error, "WGC nao iniciou; alternando para Desktop Duplication");
                        run_dxgi(&config, frames, commands, state)
                    } else {
                        Err(error)
                    }
                }
            }
        }
    }
}
