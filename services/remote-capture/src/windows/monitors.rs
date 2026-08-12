//! Enumeração Windows de monitores com identidade opaca e geometria física.

use std::mem;

use windows::Win32::Graphics::Gdi::{
    DISPLAY_DEVICEW, EnumDisplayDevicesW, GetMonitorInfoW, HMONITOR, MONITORINFO,
};
use windows::Win32::UI::HiDpi::{GetDpiForMonitor, MDT_EFFECTIVE_DPI};
use windows::core::{HSTRING, PCWSTR};
use windows_capture::monitor::Monitor;

use crate::monitor::{MonitorInfo, ScreenInfo};

const EDD_GET_DEVICE_INTERFACE_NAME: u32 = 0x0000_0001;
const MONITORINFOF_PRIMARY: u32 = 0x0000_0001;

#[derive(Debug, thiserror::Error)]
pub enum MonitorError {
    #[error("monitor: {0}")]
    Capture(#[from] windows_capture::monitor::Error),
    #[error("GetMonitorInfoW falhou para {0}")]
    Geometry(String),
    #[error("nenhum monitor ativo encontrado")]
    Empty,
}

#[derive(Clone, Debug)]
pub(crate) struct CaptureMonitor {
    pub handle: Monitor,
    pub info: MonitorInfo,
}

/// Lista todos os monitores anexados ao desktop, sem expor `HMONITOR`.
pub fn enumerate_monitors() -> Result<Vec<MonitorInfo>, MonitorError> {
    Ok(enumerate_capture_monitors()?
        .into_iter()
        .map(|monitor| monitor.info)
        .collect())
}

pub(crate) fn enumerate_capture_monitors() -> Result<Vec<CaptureMonitor>, MonitorError> {
    let monitors = Monitor::enumerate()?;
    if monitors.is_empty() {
        return Err(MonitorError::Empty);
    }
    monitors.into_iter().map(descriptor).collect()
}

pub(crate) fn initial_monitor(index: usize) -> Result<CaptureMonitor, MonitorError> {
    let monitors = enumerate_capture_monitors()?;
    monitors
        .get(index.saturating_sub(1))
        .cloned()
        .or_else(|| {
            monitors
                .iter()
                .find(|monitor| monitor.info.primary)
                .cloned()
        })
        .ok_or(MonitorError::Empty)
}

/// Resolve uma seleção opaca. IDs ausentes e `*` (ainda não suportado) caem
/// graciosamente no primário, conforme o freeze da #732.
pub(crate) fn select_monitor(id: &str) -> Result<CaptureMonitor, MonitorError> {
    let monitors = enumerate_capture_monitors()?;
    if id != crate::monitor::MONITOR_TODOS
        && let Some(found) = monitors.iter().find(|monitor| monitor.info.id == id)
    {
        return Ok(found.clone());
    }
    monitors
        .iter()
        .find(|monitor| monitor.info.primary)
        .cloned()
        .or_else(|| monitors.first().cloned())
        .ok_or(MonitorError::Empty)
}

fn descriptor(handle: Monitor) -> Result<CaptureMonitor, MonitorError> {
    let device_name = handle.device_name()?;
    let geometry = geometry(handle, &device_name)?;
    let id = interface_id(&device_name).unwrap_or_else(|| device_name.clone());
    let label = handle
        .name()
        .ok()
        .filter(|name| !name.trim().is_empty())
        .or_else(|| handle.device_string().ok())
        .filter(|name| !name.trim().is_empty())
        .unwrap_or_else(|| device_name.clone());
    let primary = is_primary(handle, &device_name)?;
    Ok(CaptureMonitor {
        handle,
        info: MonitorInfo {
            id,
            label,
            geometry,
            primary,
        },
    })
}

fn monitor_info(handle: Monitor, device_name: &str) -> Result<MONITORINFO, MonitorError> {
    let mut info = MONITORINFO {
        cbSize: u32::try_from(mem::size_of::<MONITORINFO>()).expect("MONITORINFO size fits u32"),
        ..MONITORINFO::default()
    };
    let hmonitor = HMONITOR(handle.as_raw_hmonitor());
    if unsafe { !GetMonitorInfoW(hmonitor, &raw mut info).as_bool() } {
        return Err(MonitorError::Geometry(device_name.to_owned()));
    }
    Ok(info)
}

fn geometry(handle: Monitor, device_name: &str) -> Result<ScreenInfo, MonitorError> {
    let info = monitor_info(handle, device_name)?;
    let width = u32::try_from(info.rcMonitor.right - info.rcMonitor.left)
        .map_err(|_| MonitorError::Geometry(device_name.to_owned()))?;
    let height = u32::try_from(info.rcMonitor.bottom - info.rcMonitor.top)
        .map_err(|_| MonitorError::Geometry(device_name.to_owned()))?;
    let mut dpi_x = 96;
    let mut dpi_y = 96;
    if unsafe {
        GetDpiForMonitor(
            HMONITOR(handle.as_raw_hmonitor()),
            MDT_EFFECTIVE_DPI,
            &raw mut dpi_x,
            &raw mut dpi_y,
        )
    }
    .is_err()
    {
        dpi_x = 96;
    }
    Ok(ScreenInfo {
        origin_x: info.rcMonitor.left,
        origin_y: info.rcMonitor.top,
        width,
        height,
        device_pixel_ratio: f64::from(dpi_x) / 96.0,
    })
}

fn is_primary(handle: Monitor, device_name: &str) -> Result<bool, MonitorError> {
    Ok(monitor_info(handle, device_name)?.dwFlags & MONITORINFOF_PRIMARY != 0)
}

fn interface_id(device_name: &str) -> Option<String> {
    let device_name = HSTRING::from(device_name);
    let mut device = DISPLAY_DEVICEW {
        cb: u32::try_from(mem::size_of::<DISPLAY_DEVICEW>())
            .expect("DISPLAY_DEVICEW size fits u32"),
        ..DISPLAY_DEVICEW::default()
    };
    let found = unsafe {
        EnumDisplayDevicesW(
            PCWSTR(device_name.as_ptr()),
            0,
            &raw mut device,
            EDD_GET_DEVICE_INTERFACE_NAME,
        )
    }
    .as_bool();
    if !found {
        return None;
    }
    wide_string(&device.DeviceID).filter(|id| !id.trim().is_empty())
}

fn wide_string<const N: usize>(value: &[u16; N]) -> Option<String> {
    let end = value.iter().position(|unit| *unit == 0).unwrap_or(N);
    String::from_utf16(&value[..end]).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wide_string_para_no_nul() {
        let mut value = [0u16; 8];
        value[..4].copy_from_slice(&[68, 69, 76, 76]);
        assert_eq!(wide_string(&value).as_deref(), Some("DELL"));
    }

    #[test]
    #[ignore = "requer desktop Windows interativo; coberto pelo monitor_probe"]
    fn enumera_ao_menos_um_monitor_na_maquina_windows() {
        let monitors = enumerate_monitors().expect("Windows deve enumerar monitores ativos");
        assert!(!monitors.is_empty());
        assert!(monitors.iter().any(|monitor| monitor.primary));
        assert!(monitors.iter().all(|monitor| !monitor.id.is_empty()));
        assert!(monitors.iter().all(|monitor| monitor.geometry.width > 0));
    }
}
