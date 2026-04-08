use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// Top-level application configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    pub server: ServerConfig,
    pub qa: QaConfig,
    pub agents: AgentConfig,
    pub telemetry: TelemetryConfig,
    pub mcp: McpConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ServerConfig {
    pub host: String,
    pub port: u16,
    pub cors_origins: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QaConfig {
    pub default_timeout_ms: u64,
    pub max_concurrent_crawls: usize,
    pub screenshot_quality: u8,
    pub viewport_width: u32,
    pub viewport_height: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentConfig {
    pub coordinator_model: String,
    pub fallback_model: String,
    pub max_concurrent_agents: usize,
    pub agent_timeout_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TelemetryConfig {
    pub enabled: bool,
    pub endpoint: Option<String>,
    pub sample_rate: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct McpConfig {
    pub enabled: bool,
    pub port: u16,
    pub auth_token: Option<String>,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            server: ServerConfig {
                host: "0.0.0.0".into(),
                port: 8100,
                cors_origins: vec!["http://localhost:5173".into()],
            },
            qa: QaConfig {
                default_timeout_ms: 30_000,
                max_concurrent_crawls: 5,
                screenshot_quality: 80,
                viewport_width: 1280,
                viewport_height: 800,
            },
            agents: AgentConfig {
                coordinator_model: "claude-sonnet-4-6".into(),
                fallback_model: "claude-haiku-4-5".into(),
                max_concurrent_agents: 4,
                agent_timeout_ms: 120_000,
            },
            telemetry: TelemetryConfig {
                enabled: true,
                endpoint: None,
                sample_rate: 1.0,
            },
            mcp: McpConfig {
                enabled: true,
                port: 8101,
                auth_token: None,
            },
        }
    }
}

impl AppConfig {
    /// Load config from file, env, and defaults (in that priority order)
    pub fn load() -> crate::Result<Self> {
        let config_dir = Self::config_dir();
        let config_path = config_dir.join("config.toml");

        if config_path.exists() {
            let contents = std::fs::read_to_string(&config_path)?;
            let cfg: AppConfig = toml_from_str(&contents)?;
            Ok(cfg)
        } else {
            Ok(Self::default())
        }
    }

    /// Platform-specific config directory: ~/.benchpress/
    pub fn config_dir() -> PathBuf {
        directories::BaseDirs::new()
            .map(|d| d.home_dir().join(".benchpress"))
            .unwrap_or_else(|| PathBuf::from(".benchpress"))
    }

    /// Data directory for SQLite, caches, etc.
    pub fn data_dir() -> PathBuf {
        Self::config_dir().join("data")
    }
}

fn toml_from_str(s: &str) -> crate::Result<AppConfig> {
    toml::from_str(s).map_err(|e| crate::Error::Config(e.to_string()))
}
