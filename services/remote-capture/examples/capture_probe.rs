#[cfg(windows)]
fn main() -> Result<(), Box<dyn std::error::Error>> {
    use std::time::Duration;

    use galaxie_remote_capture::contract::{command_channel, frame_channel};
    use galaxie_remote_capture::windows::run_pipeline;
    use galaxie_remote_capture::{CaptureBackendPreference, EncoderPreference, PipelineConfig};

    let encoders = galaxie_remote_capture::windows::probe_hardware_h264_encoders()?;
    println!(
        "Media Foundation H.264 hardware encoders: {}",
        encoders.len()
    );
    for encoder in encoders {
        println!("- {}", encoder.name);
    }

    let (frame_sender, frame_receiver) = frame_channel(8);
    let (command_sender, command_receiver) = command_channel();
    let consumer = std::thread::spawn(move || {
        let mut count = 0u64;
        let mut keyframes = 0u64;
        let mut annex_b = true;
        let mut parameterized_idrs = true;
        while let Ok(frame) = frame_receiver.recv() {
            count += 1;
            keyframes += u64::from(frame.keyframe);
            annex_b &= frame.data.starts_with(&[0, 0, 0, 1]);
            let types = annex_b_nal_types(&frame.data);
            parameterized_idrs &=
                !frame.keyframe || (types.contains(&5) && types.contains(&7) && types.contains(&8));
        }
        (count, keyframes, annex_b, parameterized_idrs)
    });
    let requester = std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(700));
        command_sender.pedir_keyframe();
    });
    let requested_encoder = match std::env::args().nth(1).as_deref() {
        Some("software") => EncoderPreference::OpenH264Software,
        Some("hardware") => EncoderPreference::MediaFoundationHardware,
        _ => EncoderPreference::Auto,
    };
    let requested_capture = match std::env::args().nth(2).as_deref() {
        Some("dxgi") => CaptureBackendPreference::DesktopDuplication,
        Some("wgc") => CaptureBackendPreference::WindowsGraphicsCapture,
        _ => CaptureBackendPreference::Auto,
    };
    let config = PipelineConfig {
        encoder: requested_encoder,
        capture_backend: requested_capture,
        dirty_regions: std::env::var_os("GALAXIE_PROBE_NO_DIRTY").is_none(),
        stop_after: Some(Duration::from_secs(3)),
        ..PipelineConfig::default()
    };
    let outcome = run_pipeline(config, frame_sender, command_receiver)?;
    requester.join().map_err(|_| "requester thread panicked")?;
    let (received, keyframes, annex_b, parameterized_idrs) =
        consumer.join().map_err(|_| "consumer thread panicked")?;
    println!(
        "Capture: {:?}; encoder: {}; {}x{}; {:.1} fps; captured: {}; encoded: {}; received: {}; keyframes: {}; Annex-B: {}; SPS+PPS+IDR: {}; encode avg/p95/max: {:.2}/{:.2}/{:.2} ms",
        outcome.capture_backend,
        outcome.encoder_name,
        outcome.width,
        outcome.height,
        outcome.effective_fps(),
        outcome.frames_captured,
        outcome.frames_encoded,
        received,
        keyframes,
        annex_b,
        parameterized_idrs,
        outcome.encode_latency.average_ms,
        outcome.encode_latency.p95_ms,
        outcome.encode_latency.maximum_ms,
    );
    Ok(())
}

#[cfg(windows)]
fn annex_b_nal_types(data: &[u8]) -> Vec<u8> {
    let mut types = Vec::new();
    let mut index = 0usize;
    while index + 4 < data.len() {
        let length = if data[index..].starts_with(&[0, 0, 0, 1]) {
            4
        } else if data[index..].starts_with(&[0, 0, 1]) {
            3
        } else {
            index += 1;
            continue;
        };
        if let Some(header) = data.get(index + length) {
            types.push(header & 0x1f);
        }
        index += length;
    }
    types
}

#[cfg(not(windows))]
fn main() {
    eprintln!("capture_probe só roda no Windows");
}
