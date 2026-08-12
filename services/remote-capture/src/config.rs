use std::time::Duration;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CaptureBackendPreference {
    Auto,
    WindowsGraphicsCapture,
    DesktopDuplication,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EncoderPreference {
    Auto,
    MediaFoundationHardware,
    OpenH264Software,
}

#[derive(Debug, Clone)]
pub struct PipelineConfig {
    pub monitor_index: usize,
    pub width: u32,
    pub height: u32,
    pub fps: u32,
    pub bitrate_bps: u32,
    pub include_cursor: bool,
    pub dirty_regions: bool,
    pub frame_channel_capacity: usize,
    pub capture_backend: CaptureBackendPreference,
    pub encoder: EncoderPreference,
    /// Probe/teste pode encerrar automaticamente; produção usa `None`.
    pub stop_after: Option<Duration>,
}

impl Default for PipelineConfig {
    fn default() -> Self {
        Self {
            monitor_index: 1,
            width: 1920,
            height: 1080,
            fps: 60,
            bitrate_bps: 12_000_000,
            include_cursor: true,
            dirty_regions: true,
            frame_channel_capacity: 8,
            capture_backend: CaptureBackendPreference::Auto,
            encoder: EncoderPreference::Auto,
            stop_after: None,
        }
    }
}

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum ConfigError {
    #[error("monitor_index deve ser >= 1")]
    InvalidMonitorIndex,
    #[error("resolução deve ser positiva e par para I420/NV12")]
    InvalidDimensions,
    #[error("fps deve ficar entre 1 e 240")]
    InvalidFps,
    #[error("bitrate deve ser >= 64 kbps")]
    InvalidBitrate,
}

impl PipelineConfig {
    pub fn validate(&self) -> Result<(), ConfigError> {
        if self.monitor_index == 0 {
            return Err(ConfigError::InvalidMonitorIndex);
        }
        if self.width == 0
            || self.height == 0
            || !self.width.is_multiple_of(2)
            || !self.height.is_multiple_of(2)
        {
            return Err(ConfigError::InvalidDimensions);
        }
        if !(1..=240).contains(&self.fps) {
            return Err(ConfigError::InvalidFps);
        }
        if self.bitrate_bps < 64_000 {
            return Err(ConfigError::InvalidBitrate);
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_remote_profile_is_1080p60_low_latency() {
        let config = PipelineConfig::default();
        assert_eq!((config.width, config.height, config.fps), (1920, 1080, 60));
        assert_eq!(config.frame_channel_capacity, 8);
        config.validate().expect("default config must be valid");
    }

    #[test]
    fn rejects_odd_dimensions() {
        let config = PipelineConfig {
            width: 1919,
            ..PipelineConfig::default()
        };
        assert_eq!(config.validate(), Err(ConfigError::InvalidDimensions));
    }
}
