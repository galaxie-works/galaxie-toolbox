use std::collections::VecDeque;
use std::time::Duration;

const LATENCY_WINDOW: usize = 600;

#[derive(Debug, Clone, Copy, Default, PartialEq)]
pub struct LatencySnapshot {
    pub samples: usize,
    pub average_ms: f64,
    pub p95_ms: f64,
    pub maximum_ms: f64,
}

#[derive(Debug, Default)]
pub struct PipelineStats {
    frames_captured: u64,
    frames_encoded: u64,
    frames_dropped: u64,
    encode_latencies: VecDeque<Duration>,
}

impl PipelineStats {
    pub fn record_capture(&mut self) {
        self.frames_captured += 1;
    }

    pub fn record_encode(&mut self, latency: Duration) {
        self.frames_encoded += 1;
        if self.encode_latencies.len() == LATENCY_WINDOW {
            self.encode_latencies.pop_front();
        }
        self.encode_latencies.push_back(latency);
    }

    pub fn record_drop(&mut self) {
        self.frames_dropped += 1;
    }

    #[must_use]
    pub const fn frames_captured(&self) -> u64 {
        self.frames_captured
    }

    #[must_use]
    pub const fn frames_encoded(&self) -> u64 {
        self.frames_encoded
    }

    #[must_use]
    pub const fn frames_dropped(&self) -> u64 {
        self.frames_dropped
    }

    #[must_use]
    pub fn latency(&self) -> LatencySnapshot {
        if self.encode_latencies.is_empty() {
            return LatencySnapshot::default();
        }
        let mut millis = self
            .encode_latencies
            .iter()
            .map(|duration| duration.as_secs_f64() * 1_000.0)
            .collect::<Vec<_>>();
        millis.sort_by(f64::total_cmp);
        let sum = millis.iter().sum::<f64>();
        let p95_index = ((millis.len() as f64 * 0.95).ceil() as usize)
            .saturating_sub(1)
            .min(millis.len() - 1);
        LatencySnapshot {
            samples: millis.len(),
            average_ms: sum / millis.len() as f64,
            p95_ms: millis[p95_index],
            maximum_ms: *millis.last().unwrap_or(&0.0),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reports_average_p95_and_maximum() {
        let mut stats = PipelineStats::default();
        for milliseconds in 1..=100 {
            stats.record_encode(Duration::from_millis(milliseconds));
        }
        let latency = stats.latency();
        assert_eq!(latency.samples, 100);
        assert_eq!(latency.average_ms, 50.5);
        assert_eq!(latency.p95_ms, 95.0);
        assert_eq!(latency.maximum_ms, 100.0);
    }
}
