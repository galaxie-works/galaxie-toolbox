//! Medição de latência (RTT) + bitrate da sessão, reportada pela UI (S3+).

use std::time::Instant;

use serde::Serialize;

pub struct Stats {
    bytes: u64,
    frames: u64,
    ultimo_rtt_ms: Option<f64>,
    inicio: Instant,
}

impl Default for Stats {
    fn default() -> Self {
        Self::new()
    }
}

impl Stats {
    pub fn new() -> Self {
        Self {
            bytes: 0,
            frames: 0,
            ultimo_rtt_ms: None,
            inicio: Instant::now(),
        }
    }
    pub fn registrar_frame(&mut self, bytes: usize) {
        self.bytes += bytes as u64;
        self.frames += 1;
    }
    pub fn registrar_rtt(&mut self, ms: f64) {
        self.ultimo_rtt_ms = Some(ms);
    }
    pub fn frames(&self) -> u64 {
        self.frames
    }
    pub fn bytes(&self) -> u64 {
        self.bytes
    }
    pub fn rtt_ms(&self) -> Option<f64> {
        self.ultimo_rtt_ms
    }
    pub fn bitrate_bps(&self) -> f64 {
        let s = self.inicio.elapsed().as_secs_f64();
        if s <= 0.0 {
            0.0
        } else {
            (self.bytes as f64 * 8.0) / s
        }
    }
    pub fn snapshot(&self) -> StatsSnapshot {
        StatsSnapshot {
            bitrate_bps: self.bitrate_bps(),
            rtt_ms: self.ultimo_rtt_ms,
            frames: self.frames,
            bytes: self.bytes,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatsSnapshot {
    pub bitrate_bps: f64,
    pub rtt_ms: Option<f64>,
    pub frames: u64,
    pub bytes: u64,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn acumula_frames_bytes_e_rtt() {
        let mut s = Stats::new();
        s.registrar_frame(1000);
        s.registrar_frame(500);
        s.registrar_rtt(12.5);
        assert_eq!(s.frames(), 2);
        assert_eq!(s.bytes(), 1500);
        assert_eq!(s.rtt_ms(), Some(12.5));
        let snap = s.snapshot();
        assert_eq!(snap.frames, 2);
        assert!(snap.bitrate_bps >= 0.0);
    }
}
