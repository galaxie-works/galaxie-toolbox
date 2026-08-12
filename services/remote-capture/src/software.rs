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
    normalizer: AnnexBNormalizer,
    force_first_keyframe: bool,
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
        let config = EncoderConfig::new()
            .bitrate(BitRate::from_bps(bitrate_bps))
            .max_frame_rate(FrameRate::from_hz(fps as f32))
            .rate_control_mode(RateControlMode::Bitrate)
            .usage_type(UsageType::ScreenContentRealTime)
            .intra_frame_period(IntraFramePeriod::from_num_frames(fps.saturating_mul(2)))
            .skip_frames(true)
            .scene_change_detect(true)
            .long_term_reference(false)
            .vui(VuiConfig::srgb());
        let encoder = Encoder::with_api_config(OpenH264API::from_source(), config)?;
        let width = width as usize;
        let height = height as usize;
        Ok(Self {
            encoder,
            yuv: YUVBuffer::new(width, height),
            width,
            height,
            normalizer: AnnexBNormalizer::default(),
            force_first_keyframe: true,
        })
    }

    pub fn request_keyframe(&mut self) {
        self.encoder.force_intra_frame();
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
