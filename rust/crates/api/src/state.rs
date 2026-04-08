use benchpress_core::AppConfig;
use std::sync::atomic::{AtomicU64, Ordering};

/// Shared application state across all request handlers
pub struct AppState {
    pub config: AppConfig,
    pub request_count: AtomicU64,
    pub start_time: std::time::Instant,
}

impl AppState {
    pub fn new(config: AppConfig) -> Self {
        Self {
            config,
            request_count: AtomicU64::new(0),
            start_time: std::time::Instant::now(),
        }
    }

    pub fn increment_requests(&self) -> u64 {
        self.request_count.fetch_add(1, Ordering::Relaxed)
    }

    pub fn uptime_secs(&self) -> u64 {
        self.start_time.elapsed().as_secs()
    }
}
