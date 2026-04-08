//! benchpress-telemetry: Observability, tracing, and metrics
//!
//! Provides structured logging, distributed tracing, and metrics collection
//! for all benchpress operations.

use tracing_subscriber::{fmt, EnvFilter};

/// Initialize the telemetry subsystem with structured logging
pub fn init() {
    init_with_level("info");
}

/// Initialize with an explicit minimum log level (avoids unsafe set_var)
pub fn init_with_level(level: &str) {
    let filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new(format!("{},benchpress=debug", level)));

    fmt()
        .with_env_filter(filter)
        .with_target(true)
        .with_thread_ids(true)
        .with_file(true)
        .with_line_number(true)
        .init();
}

/// Initialize with JSON output (for production)
pub fn init_json() {
    let filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new("info"));

    fmt()
        .with_env_filter(filter)
        .json()
        .init();
}

/// Span timing helper
pub struct SpanTimer {
    name: String,
    start: std::time::Instant,
}

impl SpanTimer {
    pub fn new(name: &str) -> Self {
        tracing::debug!(span = name, "starting");
        Self {
            name: name.to_string(),
            start: std::time::Instant::now(),
        }
    }
}

impl Drop for SpanTimer {
    fn drop(&mut self) {
        let duration_ms = self.start.elapsed().as_millis();
        tracing::debug!(span = %self.name, duration_ms = %duration_ms, "completed");
    }
}
