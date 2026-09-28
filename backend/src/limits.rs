//! Tiny in-memory fixed-window rate limiter.
//! Per instance: with several instances behind a load balancer each keeps its own
//! counters, which is fine for abuse protection (swap for Redis if exact limits matter).

use std::{
    collections::HashMap,
    sync::Mutex,
    time::{Duration, Instant},
};

pub struct RateLimiter {
    max: u32,
    window: Duration,
    hits: Mutex<HashMap<String, (Instant, u32)>>,
}

impl RateLimiter {
    pub fn new(max: u32, window: Duration) -> Self {
        Self { max, window, hits: Mutex::new(HashMap::new()) }
    }

    /// Counts one hit for `key`; false when the key is over its limit.
    pub fn check(&self, key: &str) -> bool {
        let now = Instant::now();
        let mut hits = self.hits.lock().unwrap();
        if hits.len() > 50_000 {
            hits.retain(|_, (start, _)| now.duration_since(*start) < self.window);
        }
        let entry = hits.entry(key.to_string()).or_insert((now, 0));
        if now.duration_since(entry.0) >= self.window {
            *entry = (now, 0);
        }
        entry.1 += 1;
        entry.1 <= self.max
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn limits_per_key() {
        let l = RateLimiter::new(2, Duration::from_secs(60));
        assert!(l.check("a"));
        assert!(l.check("a"));
        assert!(!l.check("a"));
        assert!(l.check("b"));
    }
}
