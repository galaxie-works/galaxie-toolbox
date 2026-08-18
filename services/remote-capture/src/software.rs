//! Fallback CPU OpenH264. O caminho hardware fica em `windows::media_foundation`.

use openh264::OpenH264API;
use openh264::encoder::{
    BitRate, Encoder, EncoderConfig, FrameRate, FrameType, IntraFramePeriod, RateControlMode,
    UsageType, VuiConfig,
};
use openh264::formats::{BgraSliceU8, YUVBuffer};

use crate::annexb::{AnnexBError, AnnexBNormalizer};
use crate::contract::CodedFrame;

#[derive(Debug, thiserror::Error)]
pub enum SoftwareEncoderError {
    #[error("dimensões BGRA inválidas")]
    InvalidDimensions,
    #[error("buffer BGRA não corresponde à resolução")]
    InvalidBufferLength,
    #[error("OpenH264: {0}")]
    OpenH264(#[from] openh264::Error),
    #[error("normalização Annex-B: {0}")]
    AnnexB(#[from] AnnexBError),
}

pub struct SoftwareEncoder {
    encoder: Encoder,
    yuv: YUVBuffer,
    width: usize,
    height: usize,
    /// Guardados pra recriar o encoder ao mudar o bitrate em runtime (ver `set_bitrate`).
    fps: u32,
    bitrate_bps: u32,
    normalizer: AnnexBNormalizer,
    force_first_keyframe: bool,
}

/// Monta o `EncoderConfig` low-latency de screen content. Reusado por `new` e por
/// `set_bitrate` (recriação) pra os dois caminhos ficarem SEMPRE idênticos exceto
/// pelo bitrate.
fn build_config(fps: u32, bitrate_bps: u32) -> EncoderConfig {
    EncoderConfig::new()
        .bitrate(BitRate::from_bps(bitrate_bps))
        .max_frame_rate(FrameRate::from_hz(fps as f32))
        .rate_control_mode(RateControlMode::Bitrate)
        .usage_type(UsageType::ScreenContentRealTime)
        .intra_frame_period(IntraFramePeriod::from_num_frames(fps.saturating_mul(2)))
        .skip_frames(true)
        .scene_change_detect(true)
        .long_term_reference(false)
        .vui(VuiConfig::srgb())
}

impl SoftwareEncoder {
    pub fn new(
        width: u32,
        height: u32,
        fps: u32,
        bitrate_bps: u32,
    ) -> Result<Self, SoftwareEncoderError> {
        if width == 0 || height == 0 || !width.is_multiple_of(2) || !height.is_multiple_of(2) {
            return Err(SoftwareEncoderError::InvalidDimensions);
        }
        let encoder =
            Encoder::with_api_config(OpenH264API::from_source(), build_config(fps, bitrate_bps))?;
        let width = width as usize;
        let height = height as usize;
        Ok(Self {
            encoder,
            yuv: YUVBuffer::new(width, height),
            width,
            height,
            fps,
            bitrate_bps,
            normalizer: AnnexBNormalizer::default(),
            force_first_keyframe: true,
        })
    }

    pub fn request_keyframe(&mut self) {
        self.encoder.force_intra_frame();
    }

    /// Muda o bitrate-alvo em RUNTIME (#1182: comando `SetBitrate` do BWE).
    ///
    /// CUSTO HONESTO: o crate `openh264` 0.9.8 NÃO expõe um `set_bitrate` público —
    /// o `SetOption(ENCODER_OPTION_BITRATE)` da libopenh264 fica atrás do campo
    /// `raw_api` PRIVADO do `Encoder`, inacessível de fora do crate. Então RECRIAMOS
    /// o encoder com um `EncoderConfig` novo (só o bitrate muda) e forçamos um IDR no
    /// próximo frame (`force_first_keyframe`). Isso PERDE o estado inter-frame e gera
    /// um keyframe (pico de banda pontual). Por isso o `AplicadorBitrate` (no
    /// transporte) aplica histerese: trocas de bitrate são RARAS, não a cada amostra
    /// do BWE — o custo do IDR fica amortizado. (O caminho hardware/Media Foundation
    /// muda o bitrate SEM recriar, via `ICodecAPI::SetValue(AVEncCommonMeanBitRate)`.)
    pub fn set_bitrate(&mut self, bitrate_bps: u32) -> Result<(), SoftwareEncoderError> {
        if bitrate_bps == self.bitrate_bps {
            return Ok(());
        }
        self.encoder = Encoder::with_api_config(
            OpenH264API::from_source(),
            build_config(self.fps, bitrate_bps),
        )?;
        self.bitrate_bps = bitrate_bps;
        // Encoder novo não tem referência anterior → o próximo frame TEM que ser IDR.
        self.force_first_keyframe = true;
        Ok(())
    }

    pub fn encode_bgra(
        &mut self,
        packed_bgra: &[u8],
        timestamp_us: u64,
    ) -> Result<Option<CodedFrame>, SoftwareEncoderError> {
        let expected = self.width * self.height * 4;
        if packed_bgra.len() != expected {
            return Err(SoftwareEncoderError::InvalidBufferLength);
        }
        if self.force_first_keyframe {
            self.encoder.force_intra_frame();
            self.force_first_keyframe = false;
        }

        self.yuv
            .read_bgra8(BgraSliceU8::new(packed_bgra, (self.width, self.height)));
        let bitstream = self.encoder.encode(&self.yuv)?;
        if bitstream.frame_type() == FrameType::Skip {
            return Ok(None);
        }
        let mut data = Vec::with_capacity(expected / 16);
        bitstream.write_vec(&mut data);
        let normalized = self.normalizer.normalize(&data)?;
        Ok(Some(CodedFrame::new(
            normalized.data,
            timestamp_us,
            normalized.keyframe,
        )))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // #1182: mudar o bitrate em runtime recria o encoder e força um IDR no próximo
    // frame (prova que a taxa MUDA e que o receptor recebe um keyframe pra decodar).
    #[test]
    fn set_bitrate_recria_e_forca_idr() {
        let (w, h) = (64u32, 64u32);
        let mut enc = SoftwareEncoder::new(w, h, 30, 2_000_000).expect("encoder");
        let bgra = vec![0u8; (w * h * 4) as usize];

        // Primeiro frame: já é keyframe (force_first_keyframe).
        let f0 = enc.encode_bgra(&bgra, 0).expect("encode0").expect("frame0");
        assert!(f0.keyframe, "primeiro frame deve ser IDR");

        // Troca o bitrate → recria o encoder.
        enc.set_bitrate(500_000).expect("set_bitrate");

        // Próximo frame após a troca DEVE ser um novo IDR (encoder recriado).
        let f1 = enc
            .encode_bgra(&bgra, 33_000)
            .expect("encode1")
            .expect("frame1");
        assert!(f1.keyframe, "frame após set_bitrate deve ser IDR");
    }

    #[test]
    fn set_bitrate_igual_e_noop() {
        let mut enc = SoftwareEncoder::new(64, 64, 30, 2_000_000).expect("encoder");
        // Mesmo valor → não recria (retorna Ok sem forçar keyframe extra).
        enc.set_bitrate(2_000_000).expect("noop");
    }
}
