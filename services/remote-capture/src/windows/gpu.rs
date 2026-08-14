//! Conversao BGRA -> NV12 inteiramente na GPU via D3D11 VideoProcessor.

use std::mem::ManuallyDrop;
use windows::Win32::Graphics::Direct3D11::{
    D3D11_BIND_RENDER_TARGET, D3D11_BIND_SHADER_RESOURCE, D3D11_TEX2D_VPIV, D3D11_TEX2D_VPOV,
    D3D11_TEXTURE2D_DESC, D3D11_USAGE_DEFAULT, D3D11_VIDEO_FRAME_FORMAT_PROGRESSIVE,
    D3D11_VIDEO_PROCESSOR_CONTENT_DESC, D3D11_VIDEO_PROCESSOR_INPUT_VIEW_DESC,
    D3D11_VIDEO_PROCESSOR_INPUT_VIEW_DESC_0, D3D11_VIDEO_PROCESSOR_OUTPUT_VIEW_DESC,
    D3D11_VIDEO_PROCESSOR_OUTPUT_VIEW_DESC_0, D3D11_VIDEO_PROCESSOR_STREAM,
    D3D11_VIDEO_USAGE_OPTIMAL_SPEED, D3D11_VPIV_DIMENSION_TEXTURE2D,
    D3D11_VPOV_DIMENSION_TEXTURE2D, ID3D11Device, ID3D11DeviceContext, ID3D11Texture2D,
    ID3D11VideoContext, ID3D11VideoDevice, ID3D11VideoProcessor, ID3D11VideoProcessorEnumerator,
    ID3D11VideoProcessorOutputView,
};
use windows::Win32::Graphics::Dxgi::Common::{DXGI_FORMAT_NV12, DXGI_RATIONAL, DXGI_SAMPLE_DESC};
use windows::core::Interface;

pub struct GpuNv12Converter {
    context: ID3D11VideoContext,
    video_device: ID3D11VideoDevice,
    enumerator: ID3D11VideoProcessorEnumerator,
    processor: ID3D11VideoProcessor,
    output: ID3D11Texture2D,
    output_view: ID3D11VideoProcessorOutputView,
}

impl GpuNv12Converter {
    pub fn new(
        device: &ID3D11Device,
        context: &ID3D11DeviceContext,
        input_width: u32,
        input_height: u32,
        output_width: u32,
        output_height: u32,
        fps: u32,
    ) -> windows::core::Result<Self> {
        let video_device: ID3D11VideoDevice = device.cast()?;
        let video_context: ID3D11VideoContext = context.cast()?;
        let content = D3D11_VIDEO_PROCESSOR_CONTENT_DESC {
            InputFrameFormat: D3D11_VIDEO_FRAME_FORMAT_PROGRESSIVE,
            InputFrameRate: DXGI_RATIONAL {
                Numerator: fps,
                Denominator: 1,
            },
            InputWidth: input_width,
            InputHeight: input_height,
            OutputFrameRate: DXGI_RATIONAL {
                Numerator: fps,
                Denominator: 1,
            },
            OutputWidth: output_width,
            OutputHeight: output_height,
            Usage: D3D11_VIDEO_USAGE_OPTIMAL_SPEED,
        };
        // SAFETY: descritor totalmente inicializado e interfaces validas.
        let enumerator = unsafe { video_device.CreateVideoProcessorEnumerator(&content)? };
        let processor = unsafe { video_device.CreateVideoProcessor(&enumerator, 0)? };
        let texture_desc = D3D11_TEXTURE2D_DESC {
            Width: output_width,
            Height: output_height,
            MipLevels: 1,
            ArraySize: 1,
            Format: DXGI_FORMAT_NV12,
            SampleDesc: DXGI_SAMPLE_DESC {
                Count: 1,
                Quality: 0,
            },
            Usage: D3D11_USAGE_DEFAULT,
            BindFlags: D3D11_BIND_RENDER_TARGET.0 as u32 | D3D11_BIND_SHADER_RESOURCE.0 as u32,
            CPUAccessFlags: 0,
            MiscFlags: 0,
        };
        let mut output = None;
        // SAFETY: ponteiro de saida valido e sem dados iniciais.
        unsafe { device.CreateTexture2D(&texture_desc, None, Some(&mut output))? };
        let output = output.ok_or_else(|| {
            windows::core::Error::new(
                windows::core::HRESULT(0x80004003u32 as i32),
                "CreateTexture2D returned null",
            )
        })?;
        let output_desc = D3D11_VIDEO_PROCESSOR_OUTPUT_VIEW_DESC {
            ViewDimension: D3D11_VPOV_DIMENSION_TEXTURE2D,
            Anonymous: D3D11_VIDEO_PROCESSOR_OUTPUT_VIEW_DESC_0 {
                Texture2D: D3D11_TEX2D_VPOV { MipSlice: 0 },
            },
        };
        let mut output_view = None;
        // SAFETY: textura NV12 e enumerador pertencem ao mesmo dispositivo.
        unsafe {
            video_device.CreateVideoProcessorOutputView(
                &output,
                &enumerator,
                &output_desc,
                Some(&mut output_view),
            )?
        };
        let output_view = output_view.ok_or_else(|| {
            windows::core::Error::new(
                windows::core::HRESULT(0x80004003u32 as i32),
                "CreateVideoProcessorOutputView returned null",
            )
        })?;
        Ok(Self {
            context: video_context,
            video_device,
            enumerator,
            processor,
            output,
            output_view,
        })
    }

    pub fn convert(&self, source: &ID3D11Texture2D) -> windows::core::Result<&ID3D11Texture2D> {
        let input_desc = D3D11_VIDEO_PROCESSOR_INPUT_VIEW_DESC {
            FourCC: 0,
            ViewDimension: D3D11_VPIV_DIMENSION_TEXTURE2D,
            Anonymous: D3D11_VIDEO_PROCESSOR_INPUT_VIEW_DESC_0 {
                Texture2D: D3D11_TEX2D_VPIV {
                    MipSlice: 0,
                    ArraySlice: 0,
                },
            },
        };
        let mut input_view = None;
        // SAFETY: origem e enumerador pertencem ao mesmo dispositivo.
        unsafe {
            self.video_device.CreateVideoProcessorInputView(
                source,
                &self.enumerator,
                &input_desc,
                Some(&mut input_view),
            )?
        };
        let input_view = input_view.ok_or_else(|| {
            windows::core::Error::new(
                windows::core::HRESULT(0x80004003u32 as i32),
                "CreateVideoProcessorInputView returned null",
            )
        })?;
        let mut stream = D3D11_VIDEO_PROCESSOR_STREAM {
            Enable: true.into(),
            pInputSurface: ManuallyDrop::new(Some(input_view)),
            ..Default::default()
        };
        // SAFETY: todas as views permanecem vivas durante a operacao.
        let result = unsafe {
            self.context
                .VideoProcessorBlt(&self.processor, &self.output_view, 0, &[stream.clone()])
        };
        // SAFETY: libera a unica referencia COM armazenada no campo ManuallyDrop.
        unsafe { ManuallyDrop::drop(&mut stream.pInputSurface) };
        result?;
        Ok(&self.output)
    }
}
