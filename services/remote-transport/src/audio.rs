//! Áudio da sessão remota (S6, #689) — captura do sistema do host (WASAPI
//! loopback) → **Opus** → audio track no WebRTC (str0m). Só a metade ÁUDIO é
//! minha; multi-monitor (lado captura) é do Orion.
//!
//! Este módulo é o pipeline de encode + a config. A captura WASAPI real fica no
//! `capture_wasapi` (Windows). Atrás da feature `audio` (puxa `audiopus`).

use audiopus::coder::Encoder;
use audiopus::{Application, Channels, SampleRate};

/// Config do áudio. WebRTC/Opus roda bem em 48 kHz; frame de 20 ms é o padrão
/// (baixa latência, overhead de pacote OK).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AudioConfig {
    pub sample_rate: u32,
    pub channels: u8,
    /// Duração do frame em ms (10/20/40/60 — o Opus aceita esses).
    pub frame_ms: u32,
}

impl Default for AudioConfig {
    fn default() -> Self {
        Self {
            sample_rate: 48_000,
            channels: 2,
            frame_ms: 20,
        }
    }
}

impl AudioConfig {
    /// Amostras POR CANAL num frame (ex.: 48000 * 20 / 1000 = 960).
    pub fn amostras_por_canal(&self) -> usize {
        (self.sample_rate as usize * self.frame_ms as usize) / 1000
    }
    /// Total de amostras num frame interleaved (por canal × canais).
    pub fn amostras_por_frame(&self) -> usize {
        self.amostras_por_canal() * self.channels as usize
    }
}

#[derive(Debug, thiserror::Error)]
pub enum AudioError {
    #[error("config de áudio inválida: {0}")]
    Config(String),
    #[error("falha no encoder Opus: {0}")]
    Opus(String),
    #[error("frame com tamanho errado: {esperado} esperado, {real} recebido")]
    Frame { esperado: usize, real: usize },
}

/// Encoder Opus: PCM interleaved f32 (do WASAPI) → bytes Opus (pro audio track).
pub struct OpusEncoder {
    enc: Encoder,
    cfg: AudioConfig,
}

impl OpusEncoder {
    pub fn novo(cfg: AudioConfig) -> Result<Self, AudioError> {
        let sr = match cfg.sample_rate {
            8_000 => SampleRate::Hz8000,
            12_000 => SampleRate::Hz12000,
            16_000 => SampleRate::Hz16000,
            24_000 => SampleRate::Hz24000,
            48_000 => SampleRate::Hz48000,
            outro => {
                return Err(AudioError::Config(format!(
                    "sample rate {outro} não suportado"
                )))
            }
        };
        let ch = match cfg.channels {
            1 => Channels::Mono,
            2 => Channels::Stereo,
            n => return Err(AudioError::Config(format!("{n} canais não suportado"))),
        };
        // Application::Audio = qualidade (vs VoIP); áudio de sistema é música/geral.
        let enc = Encoder::new(sr, ch, Application::Audio)
            .map_err(|e| AudioError::Opus(e.to_string()))?;
        Ok(Self { enc, cfg })
    }

    pub fn config(&self) -> AudioConfig {
        self.cfg
    }

    /// Codifica UM frame de PCM interleaved f32 (tamanho = `amostras_por_frame`).
    /// Devolve os bytes Opus.
    pub fn encode(&mut self, pcm: &[f32]) -> Result<Vec<u8>, AudioError> {
        let esperado = self.cfg.amostras_por_frame();
        if pcm.len() != esperado {
            return Err(AudioError::Frame {
                esperado,
                real: pcm.len(),
            });
        }
        let mut out = vec![0u8; 4000]; // teto seguro pra um frame Opus
        let n = self
            .enc
            .encode_float(pcm, &mut out)
            .map_err(|e| AudioError::Opus(e.to_string()))?;
        out.truncate(n);
        Ok(out)
    }
}

/// Fonte de PCM do host (WASAPI loopback no Windows). Abstrata pra testar o
/// pipeline sem placa de som.
///
/// SEM `Send`: o cliente WASAPI é COM apartment-threaded (não cruza threads). O
/// padrão é a thread de áudio CRIAR a captura nela mesma e rodar o loop ali —
/// nunca mover a captura entre threads.
pub trait CapturaAudio {
    /// Próximo frame de PCM interleaved f32 (`amostras_por_frame`), ou `None` no
    /// fim. Bloqueante (a thread de áudio drena e passa pro encoder → track).
    fn proximo_frame(&mut self) -> Option<Vec<f32>>;
    fn config(&self) -> AudioConfig;
}

/// Gera silêncio (ou um tom) pra exercitar o encode sem WASAPI real.
pub struct CapturaSilencio {
    cfg: AudioConfig,
    restantes: u32,
}

impl CapturaSilencio {
    pub fn novo(cfg: AudioConfig, frames: u32) -> Self {
        Self {
            cfg,
            restantes: frames,
        }
    }
}

impl CapturaAudio for CapturaSilencio {
    fn proximo_frame(&mut self) -> Option<Vec<f32>> {
        if self.restantes == 0 {
            return None;
        }
        self.restantes -= 1;
        Some(vec![0.0f32; self.cfg.amostras_por_frame()])
    }
    fn config(&self) -> AudioConfig {
        self.cfg
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn frame_math_48k_stereo_20ms() {
        let cfg = AudioConfig::default();
        assert_eq!(cfg.amostras_por_canal(), 960); // 48000*20/1000
        assert_eq!(cfg.amostras_por_frame(), 1920); // 960 * 2 canais
    }

    #[test]
    fn encoder_opus_codifica_frame() {
        let cfg = AudioConfig::default();
        let mut enc = OpusEncoder::novo(cfg).unwrap();
        // um frame de silêncio → Opus codifica (bytes > 0)
        let pcm = vec![0.0f32; cfg.amostras_por_frame()];
        let opus = enc.encode(&pcm).unwrap();
        assert!(!opus.is_empty());
        // tamanho errado é rejeitado
        assert!(matches!(
            enc.encode(&[0.0f32; 10]).unwrap_err(),
            AudioError::Frame { .. }
        ));
    }

    #[test]
    fn captura_silencio_respeita_config_e_limite() {
        let cfg = AudioConfig::default();
        let mut cap = CapturaSilencio::novo(cfg, 3);
        let mut n = 0;
        while let Some(f) = cap.proximo_frame() {
            assert_eq!(f.len(), cfg.amostras_por_frame());
            n += 1;
        }
        assert_eq!(n, 3);
    }
}
