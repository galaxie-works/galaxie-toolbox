#[cfg(windows)]
fn main() -> Result<(), Box<dyn std::error::Error>> {
    use std::sync::Arc;
    use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
    use std::time::{Duration, Instant};

    use galaxie_remote_capture::contract::{canal_de_comandos, canal_de_frames};
    use galaxie_remote_capture::windows::{enumerate_monitors, run_pipeline_with_monitors};
    use galaxie_remote_capture::{
        CaptureBackendPreference, MonitorControlMessage, PipelineConfig, canal_de_monitores,
    };

    tracing_subscriber::fmt()
        .with_env_filter("galaxie_remote_capture=info,warn")
        .init();
    let backend = match std::env::args().nth(1).as_deref() {
        Some("dxgi") => CaptureBackendPreference::DesktopDuplication,
        Some("wgc") => CaptureBackendPreference::WindowsGraphicsCapture,
        _ => CaptureBackendPreference::Auto,
    };

    let monitors = enumerate_monitors()?;
    println!("Monitores enumerados: {}", monitors.len());
    for monitor in &monitors {
        println!(
            "- id={:?}; label={:?}; primary={}; origin=({}, {}); {}x{}; dpr={:.2}",
            monitor.id,
            monitor.label,
            monitor.primary,
            monitor.geometry.origin_x,
            monitor.geometry.origin_y,
            monitor.geometry.width,
            monitor.geometry.height,
            monitor.geometry.device_pixel_ratio,
        );
    }

    let target = monitors
        .iter()
        .find(|monitor| !monitor.primary)
        .or_else(|| monitors.first())
        .ok_or("nenhum monitor")?
        .id
        .clone();
    let expected_initial = monitors.first().ok_or("nenhum monitor")?.id.clone();

    let (frame_tx, frame_rx) = canal_de_frames(8);
    let (_encoder_tx, encoder_rx) = canal_de_comandos();
    let (controller, host_control) = canal_de_monitores(8);
    let observed_frames = Arc::new(AtomicUsize::new(0));
    let last_timestamp_us = Arc::new(AtomicU64::new(0));
    let timestamps_monotonic = Arc::new(AtomicBool::new(true));
    let frame_counter = observed_frames.clone();
    let timestamp_counter = last_timestamp_us.clone();
    let monotonic_guard = timestamps_monotonic.clone();
    let frame_drain = std::thread::spawn(move || {
        frame_rx
            .into_iter()
            .inspect(|frame| {
                let previous = timestamp_counter.swap(frame.timestamp_us, Ordering::Relaxed);
                if previous != 0 && frame.timestamp_us <= previous {
                    monotonic_guard.store(false, Ordering::Relaxed);
                }
                frame_counter.fetch_add(1, Ordering::Relaxed);
            })
            .count()
    });
    let pipeline = std::thread::spawn(move || {
        run_pipeline_with_monitors(
            PipelineConfig {
                capture_backend: backend,
                stop_after: Some(Duration::from_secs(12)),
                ..PipelineConfig::default()
            },
            frame_tx,
            encoder_rx,
            host_control,
        )
    });

    let deadline = Instant::now() + Duration::from_secs(3);
    let mut initial_active = None;
    while Instant::now() < deadline && initial_active.is_none() {
        if let Some(MonitorControlMessage::MonitorActive { id, info }) =
            controller.receber_timeout(Duration::from_millis(250))?
        {
            println!(
                "Ativo inicial: {:?}; origin=({}, {}); {}x{}",
                id, info.origin_x, info.origin_y, info.width, info.height
            );
            initial_active = Some(id);
        }
    }
    let initial_active = initial_active.ok_or("host nao publicou MonitorActive inicial")?;
    if initial_active != expected_initial {
        return Err(format!(
            "ativo inicial inesperado: esperado {expected_initial:?}, recebido {initial_active:?}"
        )
        .into());
    }

    let deadline = Instant::now() + Duration::from_secs(5);
    while Instant::now() < deadline && observed_frames.load(Ordering::Relaxed) == 0 {
        std::thread::sleep(Duration::from_millis(50));
    }
    let frames_before_switch = observed_frames.load(Ordering::Relaxed);
    let timestamp_before_switch = last_timestamp_us.load(Ordering::Relaxed);
    if frames_before_switch == 0 {
        return Err("captura inicial nao produziu frame antes da troca".into());
    }

    controller.selecionar(target.clone())?;
    let deadline = Instant::now() + Duration::from_secs(5);
    let mut switched = None;
    while Instant::now() < deadline && switched.is_none() {
        if let Some(MonitorControlMessage::MonitorActive { id, info }) =
            controller.receber_timeout(Duration::from_millis(250))?
            && id == target
        {
            println!(
                "Ativo apos selecao: {:?}; origin=({}, {}); {}x{}",
                id, info.origin_x, info.origin_y, info.width, info.height
            );
            switched = Some(id);
        }
    }
    switched.ok_or("host nao confirmou a selecao antes do timeout")?;
    let deadline = Instant::now() + Duration::from_secs(5);
    while Instant::now() < deadline
        && observed_frames.load(Ordering::Relaxed) <= frames_before_switch
    {
        std::thread::sleep(Duration::from_millis(50));
    }
    if observed_frames.load(Ordering::Relaxed) <= frames_before_switch {
        return Err("monitor selecionado nao produziu frame codificado".into());
    }
    if last_timestamp_us.load(Ordering::Relaxed) <= timestamp_before_switch {
        return Err("timestamp reiniciou ou nao avancou apos a troca".into());
    }

    let outcome = pipeline.join().map_err(|_| "pipeline entrou em panic")??;
    let frames = frame_drain.join().map_err(|_| "drain entrou em panic")?;
    if !timestamps_monotonic.load(Ordering::Relaxed) {
        return Err("timestamps deixaram de ser monotônicos durante a troca".into());
    }
    println!(
        "Troca confirmada; backend={:?}; frames={}; encoded={}; {:.1} fps; timestamps monotônicos até {} us",
        outcome.capture_backend,
        frames,
        outcome.frames_encoded,
        outcome.effective_fps(),
        last_timestamp_us.load(Ordering::Relaxed),
    );
    Ok(())
}

#[cfg(not(windows))]
fn main() {
    eprintln!("monitor_probe requer Windows");
}
