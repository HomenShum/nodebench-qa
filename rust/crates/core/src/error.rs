use thiserror::Error;

/// Unified error type for benchpress
#[derive(Error, Debug)]
pub enum Error {
    #[error("Configuration error: {0}")]
    Config(String),

    #[error("QA engine error: {0}")]
    QaEngine(String),

    #[error("Browser automation error: {0}")]
    Browser(String),

    #[error("Agent orchestration error: {0}")]
    Agent(String),

    #[error("MCP protocol error: {0}")]
    Mcp(String),

    #[error("HTTP request error: {0}")]
    Http(#[from] reqwest::Error),

    #[error("JSON serialization error: {0}")]
    Json(#[from] serde_json::Error),

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("Timeout after {0}ms")]
    Timeout(u64),

    #[error("Not found: {0}")]
    NotFound(String),

    #[error("Rate limited: retry after {retry_after_ms}ms")]
    RateLimited { retry_after_ms: u64 },

    #[error("Authentication failed: {0}")]
    Auth(String),

    #[error("Internal error: {0}")]
    Internal(String),
}

pub type Result<T> = std::result::Result<T, Error>;
