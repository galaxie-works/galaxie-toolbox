//! Descoberta e encode H.264 por Media Foundation.

use std::ffi::c_void;
use std::mem::ManuallyDrop;
use std::ptr;

use windows::Win32::Graphics::Direct3D11::{ID3D11Device, ID3D11DeviceContext, ID3D11Texture2D};
use windows::Win32::Media::MediaFoundation::{
    CODECAPI_AVEncCommonMeanBitRate, CODECAPI_AVEncCommonRateControlMode,
    CODECAPI_AVEncMPVDefaultBPictureCount, CODECAPI_AVEncVideoForceKeyFrame,
    CODECAPI_AVEncVideoMaxNumRefFrame, CODECAPI_AVLowLatencyMode, ICodecAPI, IMFActivate,
    IMFDXGIDeviceManager, IMFMediaEventGenerator, IMFTransform,
    MEDIA_EVENT_GENERATOR_GET_EVENT_FLAGS, METransformHaveOutput, METransformNeedInput,
    MF_E_TRANSFORM_NEED_MORE_INPUT, MF_LOW_LATENCY, MF_MT_AVG_BITRATE, MF_MT_FRAME_RATE,
    MF_MT_FRAME_SIZE, MF_MT_INTERLACE_MODE, MF_MT_MAJOR_TYPE, MF_MT_PIXEL_ASPECT_RATIO,
    MF_MT_SUBTYPE, MF_TRANSFORM_ASYNC_UNLOCK, MF_VERSION, MFCreateDXGIDeviceManager,
    MFCreateDXGISurfaceBuffer, MFCreateMediaType, MFCreateMemoryBuffer, MFCreateSample,
    MFMediaType_Video, MFSTARTUP_FULL, MFShutdown, MFStartup, MFT_CATEGORY_VIDEO_ENCODER,
    MFT_ENUM_FLAG_HARDWARE, MFT_ENUM_FLAG_SORTANDFILTER, MFT_FRIENDLY_NAME_Attribute,
    MFT_MESSAGE_NOTIFY_BEGIN_STREAMING, MFT_MESSAGE_NOTIFY_END_OF_STREAM,
    MFT_MESSAGE_NOTIFY_END_STREAMING, MFT_MESSAGE_NOTIFY_START_OF_STREAM,
    MFT_MESSAGE_SET_D3D_MANAGER, MFT_OUTPUT_DATA_BUFFER, MFT_OUTPUT_STREAM_PROVIDES_SAMPLES,
    MFT_REGISTER_TYPE_INFO, MFTEnumEx, MFVideoFormat_H264, MFVideoFormat_NV12,
    MFVideoInterlace_Progressive, eAVEncCommonRateControlMode_CBR,
};
use windows::Win32::System::Com::{
    COINIT_MULTITHREADED, CoInitializeEx, CoTaskMemFree, CoUninitialize,
};
use windows::Win32::System::Variant::VARIANT;
use windows::core::Interface;

use crate::annexb::{AnnexBError, AnnexBNormalizer};
use crate::contract::CodedFrame;

use super::gpu::GpuNv12Converter;

/// Informações do MFT de hardware encontrado em runtime.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HardwareEncoderInfo {
    pub name: String,
}

struct MediaFoundationRuntime;

struct ComApartment;

impl ComApartment {
    fn initialize() -> Result<Self, windows::core::Error> {
        // SAFETY: inicializa COM para a thread atual e a guarda balanceia com
        // CoUninitialize. `None` é o valor obrigatório para pvReserved.
        unsafe { CoInitializeEx(None, COINIT_MULTITHREADED).ok()? };
        Ok(Self)
    }
}

impl Drop for ComApartment {
    fn drop(&mut self) {
        // SAFETY: a guarda só é construída depois de CoInitializeEx ter sucesso.
        unsafe { CoUninitialize() };
    }
}

impl MediaFoundationRuntime {
    fn start() -> Result<Self, windows::core::Error> {
        // SAFETY: MFStartup é balanceado por MFShutdown no Drop desta guarda.
        unsafe { MFStartup(MF_VERSION, MFSTARTUP_FULL)? };
        Ok(Self)
    }
}

impl Drop for MediaFoundationRuntime {
    fn drop(&mut self) {
        // SAFETY: esta guarda só existe após MFStartup ter retornado sucesso.
        let _ = unsafe { MFShutdown() };
    }
}

fn take_activations(raw: *mut Option<IMFActivate>, count: u32) -> Vec<Option<IMFActivate>> {
    if raw.is_null() || count == 0 {
        return Vec::new();
    }
    let mut activations = Vec::with_capacity(count as usize);
    for index in 0..count as usize {
        // SAFETY: MFTEnumEx devolve `count` entradas contíguas inicializadas.
        activations.push(unsafe { ptr::read(raw.add(index)) });
    }
    // SAFETY: o array externo pertence ao COM task allocator. As referências
    // COM internas foram movidas para `activations` e serão liberadas por Drop.
    unsafe { CoTaskMemFree(Some(raw.cast::<c_void>())) };
    activations
}

fn enumerate_hardware_activations() -> Result<Vec<IMFActivate>, windows::core::Error> {
    let output = MFT_REGISTER_TYPE_INFO {
        guidMajorType: MFMediaType_Video,
        guidSubtype: MFVideoFormat_H264,
    };
    let mut raw = ptr::null_mut::<Option<IMFActivate>>();
    let mut count = 0u32;
    // SAFETY: ponteiros de saida validos; o array e liberado por take_activations.
    unsafe {
        MFTEnumEx(
            MFT_CATEGORY_VIDEO_ENCODER,
            MFT_ENUM_FLAG_HARDWARE | MFT_ENUM_FLAG_SORTANDFILTER,
            None,
            Some(&output),
            &mut raw,
            &mut count,
        )?;
    }
    Ok(take_activations(raw, count).into_iter().flatten().collect())
}

fn friendly_name(activation: &IMFActivate) -> Result<String, windows::core::Error> {
    // SAFETY: `activation` é um IMFAttributes válido e o buffer possui
    // `length + 1` u16, conforme contrato de GetString.
    let length = unsafe { activation.GetStringLength(&MFT_FRIENDLY_NAME_Attribute)? };
    let mut utf16 = vec![0u16; length as usize + 1];
    let mut written = 0u32;
    unsafe {
        activation.GetString(&MFT_FRIENDLY_NAME_Attribute, &mut utf16, Some(&mut written))?;
    }
    Ok(String::from_utf16_lossy(
        &utf16[..(written as usize).min(utf16.len())],
    ))
}

/// Enumera somente MFTs H.264 marcados como hardware. A ordem já vem filtrada
/// pelo mérito/preferência do sistema e é a ordem usada pela seleção runtime.
pub fn probe_hardware_h264_encoders() -> Result<Vec<HardwareEncoderInfo>, windows::core::Error> {
    let _apartment = ComApartment::initialize()?;
    let _runtime = MediaFoundationRuntime::start()?;
    enumerate_hardware_activations()?
        .into_iter()
        .map(|activation| {
            Ok(HardwareEncoderInfo {
                name: friendly_name(&activation)?,
            })
        })
        .collect()
}

#[derive(Debug, thiserror::Error)]
pub enum HardwareEncoderError {
    #[error("Windows/Media Foundation: {0}")]
    Windows(#[from] windows::core::Error),
    #[error("nenhum MFT H.264 de hardware disponivel")]
    Unavailable,
    #[error("saida H.264 invalida: {0}")]
    AnnexB(#[from] AnnexBError),
    #[error("Media Foundation retornou uma interface nula: {0}")]
    Null(&'static str),
}

/// Encoder assíncrono MFT com entrada NV12 em textura D3D11. A textura BGRA
/// nunca e mapeada para CPU; somente o bitstream final e copiado.
pub struct MediaFoundationH264Encoder {
    name: String,
    transform: IMFTransform,
    events: IMFMediaEventGenerator,
    codec: ICodecAPI,
    _manager: IMFDXGIDeviceManager,
    converter: GpuNv12Converter,
    input_stream: u32,
    output_stream: u32,
    output_provides_samples: bool,
    output_size: u32,
    frame_duration_100ns: i64,
    normalizer: AnnexBNormalizer,
    _runtime: MediaFoundationRuntime,
    _apartment: ComApartment,
}

// O handler de captura exige `Send`, mas constroi, usa e descarta este encoder
// exclusivamente dentro da propria thread MTA. Nenhuma interface COM e
// compartilhada ou chamada de outra thread.
unsafe impl Send for MediaFoundationH264Encoder {}

impl MediaFoundationH264Encoder {
    pub fn new(
        device: &ID3D11Device,
        context: &ID3D11DeviceContext,
        input_size: (u32, u32),
        output_size: (u32, u32),
        fps: u32,
        bitrate_bps: u32,
    ) -> Result<Self, HardwareEncoderError> {
        let (input_width, input_height) = input_size;
        let (output_width, output_height) = output_size;
        let apartment = ComApartment::initialize()?;
        let runtime = MediaFoundationRuntime::start()?;
        let activation = enumerate_hardware_activations()?
            .into_iter()
            .next()
            .ok_or(HardwareEncoderError::Unavailable)?;
        let name = friendly_name(&activation)?;
        // SAFETY: a ativacao foi retornada por MFTEnumEx para a categoria encoder.
        let transform: IMFTransform = unsafe { activation.ActivateObject()? };
        let attributes = unsafe { transform.GetAttributes()? };
        unsafe {
            attributes.SetUINT32(&MF_TRANSFORM_ASYNC_UNLOCK, 1)?;
            attributes.SetUINT32(&MF_LOW_LATENCY, 1)?;
        }

        let mut reset_token = 0u32;
        let mut manager = None;
        // SAFETY: ponteiros de saida validos.
        unsafe { MFCreateDXGIDeviceManager(&mut reset_token, &mut manager)? };
        let manager = manager.ok_or(HardwareEncoderError::Null("IMFDXGIDeviceManager"))?;
        unsafe {
            manager.ResetDevice(device, reset_token)?;
            transform.ProcessMessage(
                MFT_MESSAGE_SET_D3D_MANAGER,
                Interface::as_raw(&manager) as usize,
            )?;
        }

        let (input_stream, output_stream) = stream_ids(&transform);
        let output_type = media_type(
            MFVideoFormat_H264,
            output_width,
            output_height,
            fps,
            Some(bitrate_bps),
        )?;
        let input_type = media_type(MFVideoFormat_NV12, output_width, output_height, fps, None)?;
        unsafe {
            transform.SetOutputType(output_stream, &output_type, 0)?;
            transform.SetInputType(input_stream, &input_type, 0)?;
        }

        let codec: ICodecAPI = transform.cast()?;
        set_codec_value(&codec, &CODECAPI_AVLowLatencyMode, VARIANT::from(true));
        set_codec_value(
            &codec,
            &CODECAPI_AVEncCommonRateControlMode,
            VARIANT::from(eAVEncCommonRateControlMode_CBR.0),
        );
        set_codec_value(
            &codec,
            &CODECAPI_AVEncCommonMeanBitRate,
            VARIANT::from(bitrate_bps),
        );
        set_codec_value(
            &codec,
            &CODECAPI_AVEncMPVDefaultBPictureCount,
            VARIANT::from(0u32),
        );
        set_codec_value(
            &codec,
            &CODECAPI_AVEncVideoMaxNumRefFrame,
            VARIANT::from(1u32),
        );

        let stream_info = unsafe { transform.GetOutputStreamInfo(output_stream)? };
        let events: IMFMediaEventGenerator = transform.cast()?;
        unsafe {
            transform.ProcessMessage(MFT_MESSAGE_NOTIFY_BEGIN_STREAMING, 0)?;
            transform.ProcessMessage(MFT_MESSAGE_NOTIFY_START_OF_STREAM, 0)?;
        }

        Ok(Self {
            name,
            transform,
            events,
            codec,
            _manager: manager,
            converter: GpuNv12Converter::new(
                device,
                context,
                input_width,
                input_height,
                output_width,
                output_height,
                fps,
            )?,
            input_stream,
            output_stream,
            output_provides_samples: stream_info.dwFlags
                & MFT_OUTPUT_STREAM_PROVIDES_SAMPLES.0 as u32
                != 0,
            output_size: stream_info.cbSize.max(1),
            frame_duration_100ns: 10_000_000i64 / i64::from(fps),
            normalizer: AnnexBNormalizer::default(),
            _runtime: runtime,
            _apartment: apartment,
        })
    }

    pub fn name(&self) -> &str {
        &self.name
    }

    pub fn request_keyframe(&self) -> Result<(), HardwareEncoderError> {
        let value = VARIANT::from(true);
        // SAFETY: GUID e VARIANT validos durante a chamada.
        unsafe {
            self.codec
                .SetValue(&CODECAPI_AVEncVideoForceKeyFrame, &value)?
        };
        Ok(())
    }

    /// Muda o bitrate-alvo em RUNTIME (#1182). O MFT expoe o bitrate via `ICodecAPI`
    /// (`AVEncCommonMeanBitRate`), entao muda SEM recriar o encoder nem perder estado
    /// — custo baixo (ao contrario do caminho software OpenH264, que recria). Nao
    /// forca IDR: o rate control absorve a nova taxa nos proximos frames.
    pub fn set_bitrate(&self, bitrate_bps: u32) -> Result<(), HardwareEncoderError> {
        let value = VARIANT::from(bitrate_bps);
        // SAFETY: GUID e VARIANT validos durante a chamada.
        unsafe {
            self.codec
                .SetValue(&CODECAPI_AVEncCommonMeanBitRate, &value)?
        };
        Ok(())
    }

    pub fn encode_texture(
        &mut self,
        texture: &ID3D11Texture2D,
        timestamp_us: u64,
    ) -> Result<Option<CodedFrame>, HardwareEncoderError> {
        self.wait_for(METransformNeedInput)?;
        let nv12 = self.converter.convert(texture)?;
        let sample = unsafe { MFCreateSample()? };
        let buffer = unsafe { MFCreateDXGISurfaceBuffer(&ID3D11Texture2D::IID, nv12, 0, false)? };
        unsafe {
            sample.AddBuffer(&buffer)?;
            sample.SetSampleTime((timestamp_us as i64).saturating_mul(10))?;
            sample.SetSampleDuration(self.frame_duration_100ns)?;
            self.transform.ProcessInput(self.input_stream, &sample, 0)?;
        }
        self.wait_for(METransformHaveOutput)?;
        self.read_output(timestamp_us)
    }

    fn wait_for(
        &self,
        expected: windows::Win32::Media::MediaFoundation::MF_EVENT_TYPE,
    ) -> Result<(), HardwareEncoderError> {
        loop {
            let event = unsafe {
                self.events
                    .GetEvent(MEDIA_EVENT_GENERATOR_GET_EVENT_FLAGS(0))?
            };
            unsafe { event.GetStatus()?.ok()? };
            if unsafe { event.GetType()? } == expected.0 as u32 {
                return Ok(());
            }
        }
    }

    fn read_output(
        &mut self,
        timestamp_us: u64,
    ) -> Result<Option<CodedFrame>, HardwareEncoderError> {
        let provided = if self.output_provides_samples {
            None
        } else {
            let sample = unsafe { MFCreateSample()? };
            let buffer = unsafe { MFCreateMemoryBuffer(self.output_size)? };
            unsafe { sample.AddBuffer(&buffer)? };
            Some(sample)
        };
        let mut output = MFT_OUTPUT_DATA_BUFFER {
            dwStreamID: self.output_stream,
            pSample: ManuallyDrop::new(provided),
            ..Default::default()
        };
        let mut status = 0u32;
        let result = unsafe {
            self.transform
                .ProcessOutput(0, std::slice::from_mut(&mut output), &mut status)
        };
        let sample = (*output.pSample).clone();
        unsafe {
            ManuallyDrop::drop(&mut output.pSample);
            ManuallyDrop::drop(&mut output.pEvents);
        }
        if let Err(error) = result {
            if error.code() == MF_E_TRANSFORM_NEED_MORE_INPUT {
                return Ok(None);
            }
            return Err(error.into());
        }
        let sample = sample.ok_or(HardwareEncoderError::Null("IMFSample de saida"))?;
        let buffer = unsafe { sample.ConvertToContiguousBuffer()? };
        let mut data = ptr::null_mut();
        let mut length = 0u32;
        unsafe { buffer.Lock(&mut data, None, Some(&mut length))? };
        // SAFETY: Lock fornece `length` bytes validos ate Unlock.
        let bytes = unsafe { std::slice::from_raw_parts(data, length as usize) }.to_vec();
        unsafe { buffer.Unlock()? };
        let normalized = self.normalizer.normalize(&bytes)?;
        Ok(Some(CodedFrame::new(
            normalized.data,
            timestamp_us,
            normalized.keyframe,
        )))
    }
}

impl Drop for MediaFoundationH264Encoder {
    fn drop(&mut self) {
        unsafe {
            let _ = self
                .transform
                .ProcessMessage(MFT_MESSAGE_NOTIFY_END_OF_STREAM, 0);
            let _ = self
                .transform
                .ProcessMessage(MFT_MESSAGE_NOTIFY_END_STREAMING, 0);
        }
    }
}

fn stream_ids(transform: &IMFTransform) -> (u32, u32) {
    let mut input = [0u32];
    let mut output = [0u32];
    if unsafe { transform.GetStreamIDs(&mut input, &mut output) }.is_ok() {
        (input[0], output[0])
    } else {
        (0, 0)
    }
}

fn media_type(
    subtype: windows::core::GUID,
    width: u32,
    height: u32,
    fps: u32,
    bitrate: Option<u32>,
) -> Result<windows::Win32::Media::MediaFoundation::IMFMediaType, windows::core::Error> {
    let media_type = unsafe { MFCreateMediaType()? };
    unsafe {
        media_type.SetGUID(&MF_MT_MAJOR_TYPE, &MFMediaType_Video)?;
        media_type.SetGUID(&MF_MT_SUBTYPE, &subtype)?;
        media_type.SetUINT64(
            &MF_MT_FRAME_SIZE,
            (u64::from(width) << 32) | u64::from(height),
        )?;
        media_type.SetUINT64(&MF_MT_FRAME_RATE, u64::from(fps) << 32 | 1)?;
        media_type.SetUINT64(&MF_MT_PIXEL_ASPECT_RATIO, 1u64 << 32 | 1)?;
        media_type.SetUINT32(&MF_MT_INTERLACE_MODE, MFVideoInterlace_Progressive.0 as u32)?;
        if let Some(bitrate) = bitrate {
            media_type.SetUINT32(&MF_MT_AVG_BITRATE, bitrate)?;
        }
    }
    Ok(media_type)
}

fn set_codec_value(codec: &ICodecAPI, key: &windows::core::GUID, value: VARIANT) {
    // Configuracoes opcionais variam entre vendors; falha aqui nao invalida o MFT.
    let _ = unsafe { codec.SetValue(key, &value) };
}
