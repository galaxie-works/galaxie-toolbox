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
    /// Teto do bitrate adaptativo (#1182): o valor FIXO histórico (12 Mbps) virou
    /// o TETO. O encoder começa conservador (ver [`Self::bitrate_inicial_bps`]) e o
    /// BWE do transporte sobe até aqui conforme a banda dá folga.
    pub bitrate_max_bps: u32,
    /// Piso do bitrate adaptativo: o encoder nunca cai abaixo disto (degrada, mas
    /// não congela) num link estreito.
    pub bitrate_min_bps: u32,
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
            bitrate_max_bps: 12_000_000,
            bitrate_min_bps: 300_000,
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
    #[error("bitrate_min_bps deve ser <= bitrate_max_bps")]
    InvalidBitrateRange,
}

impl PipelineConfig {
    /// Bitrate (bps) com que o encoder INICIA — conservador, pra não estourar a
    /// fila no primeiro segundo de um link estreito. O BWE do transporte sobe daí
    /// até `bitrate_max_bps`. Um quarto do teto, nunca abaixo do piso nem acima do
    /// teto (default: 12 Mbps/4 = 3 Mbps).
    #[must_use]
    pub fn bitrate_inicial_bps(&self) -> u32 {
        (self.bitrate_max_bps / 4).clamp(self.bitrate_min_bps, self.bitrate_max_bps)
    }

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
        if self.bitrate_max_bps < 64_000 || self.bitrate_min_bps < 64_000 {
            return Err(ConfigError::InvalidBitrate);
        }
        if self.bitrate_min_bps > self.bitrate_max_bps {
            return Err(ConfigError::InvalidBitrateRange);
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
    fn initial_bitrate_is_conservative_and_within_bounds() {
        let config = PipelineConfig::default();
        let inicial = config.bitrate_inicial_bps();
        assert!(inicial >= config.bitrate_min_bps && inicial <= config.bitrate_max_bps);
        assert!(inicial < config.bitrate_max_bps, "deve começar abaixo do teto");
    }

    #[test]
    fn rejects_inverted_bitrate_range() {
        let config = PipelineConfig {
            bitrate_min_bps: 8_000_000,
            bitrate_max_bps: 1_000_000,
            ..PipelineConfig::default()
        };
        assert_eq!(config.validate(), Err(ConfigError::InvalidBitrateRange));
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
