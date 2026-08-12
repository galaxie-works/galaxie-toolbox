//! Captura de áudio do sistema do host via **WASAPI loopback** (Windows, S6). Só
//! sob a feature `audio` + Windows. É live-QA (precisa de placa de som real); o
//! pipeline (encode Opus, audio track) é testado sem ela via `CapturaSilencio`.
//!
//! Loopback = capturar o que TOCA no dispositivo de render (o áudio do sistema),
//! não o microfone. Formato: PCM float 32-bit no sample rate/canais da config.
//! O cliente WASAPI é COM apartment-threaded — este struct vive na thread de
//! áudio (criado nela, não movido), por isso [`CapturaAudio`] não exige `Send`.

use std::collections::VecDeque;
use std::time::Duration;

use wasapi::{initialize_mta, DeviceEnumerator, Direction, SampleType, StreamMode, WaveFormat};

use crate::audio::{AudioConfig, CapturaAudio};

pub struct CapturaWasapi {
    cfg: AudioConfig,
    // Mantido vivo: o capture client depende do audio client.
    _audio_client: wasapi::AudioClient,
    capture: wasapi::AudioCaptureClient,
    bytes: VecDeque<u8>,
    bytes_por_frame: usize,
    amostras_frame: usize,
}

impl CapturaWasapi {
    pub fn novo(cfg: AudioConfig) -> Result<Self, String> {
        initialize_mta().ok().map_err(|e| e.to_string())?;
        let enumerator = DeviceEnumerator::new().map_err(|e| e.to_string())?;
        let device = enumerator
            .get_default_device(&Direction::Render)
            .map_err(|e| e.to_string())?;
        let mut audio_client = device.get_iaudioclient().map_err(|e| e.to_string())?;
        let format = WaveFormat::new(
            32,
            32,
            &SampleType::Float,
            cfg.sample_rate as usize,
            cfg.channels as usize,
            None,
        );
        let (default_period, _min_period) = audio_client
            .get_device_period()
            .map_err(|e| e.to_string())?;
        // LOOPBACK: pedir Direction::Capture num device RENDER faz o wasapi setar
        // o AUDCLNT_STREAMFLAGS_LOOPBACK — captura o áudio do SISTEMA. `autoconvert`
        // deixa o engine converter pro formato pedido (48k/f32).
        let stream_mode = StreamMode::PollingShared {
            autoconvert: true,
            buffer_duration_hns: default_period,
        };
        audio_client
            .initialize_client(&format, &Direction::Capture, &stream_mode)
            .map_err(|e| e.to_string())?;
        let capture = audio_client
            .get_audiocaptureclient()
            .map_err(|e| e.to_string())?;
        audio_client.start_stream().map_err(|e| e.to_string())?;
        let amostras_frame = cfg.amostras_por_frame();
        Ok(Self {
            cfg,
            _audio_client: audio_client,
            capture,
            bytes: VecDeque::new(),
            bytes_por_frame: amostras_frame * 4, // f32 = 4 bytes
            amostras_frame,
        })
    }
}

impl CapturaAudio for CapturaWasapi {
    fn proximo_frame(&mut self) -> Option<Vec<f32>> {
        while self.bytes.len() < self.bytes_por_frame {
            match self.capture.read_from_device_to_deque(&mut self.bytes) {
                Ok(_info) => {
                    if self.bytes.len() < self.bytes_por_frame {
                        std::thread::sleep(Duration::from_millis(3));
                    }
                }
                Err(_) => return None,
            }
        }
        let raw: Vec<u8> = self.bytes.drain(..self.bytes_por_frame).collect();
        let frame: Vec<f32> = raw
            .chunks_exact(4)
            .map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]]))
            .collect();
        debug_assert_eq!(frame.len(), self.amostras_frame);
        Some(frame)
    }

    fn config(&self) -> AudioConfig {
        self.cfg
    }
}
