//! Anthropic Messages API types — request/response structures for Claude models.

use serde::{Deserialize, Serialize};

// ── Request Types ──────────────────────────────────────────────────────────

/// Top-level request body for the Anthropic Messages API.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MessageRequest {
    pub model: String,
    pub max_tokens: u32,
    pub messages: Vec<Message>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub system: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub temperature: Option<f64>,
}

/// A single message in the conversation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Message {
    pub role: String, // "user" or "assistant"
    pub content: Vec<ContentBlock>,
}

/// Content block within a message — text, image, tool use, or tool result.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ContentBlock {
    Text {
        text: String,
    },
    Image {
        source: ImageSource,
    },
    ToolUse {
        id: String,
        name: String,
        input: serde_json::Value,
    },
    ToolResult {
        tool_use_id: String,
        content: String,
    },
}

/// Base64-encoded image source for vision requests.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImageSource {
    #[serde(rename = "type")]
    pub source_type: String, // "base64"
    pub media_type: String, // "image/png", "image/jpeg", "image/gif", "image/webp"
    pub data: String,
}

// ── Response Types ─────────────────────────────────────────────────────────

/// Response from the Anthropic Messages API.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MessageResponse {
    pub id: String,
    pub model: String,
    pub content: Vec<ContentBlock>,
    pub stop_reason: Option<String>,
    pub usage: Usage,
}

/// Token usage breakdown.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Usage {
    pub input_tokens: u64,
    pub output_tokens: u64,
}

// ── Error Response ─────────────────────────────────────────────────────────

/// Error response body from the Anthropic API.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApiErrorResponse {
    #[serde(rename = "type")]
    pub error_type: String,
    pub error: ApiErrorDetail,
}

/// Detail within an API error response.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApiErrorDetail {
    #[serde(rename = "type")]
    pub error_type: String,
    pub message: String,
}

// ── Model Configuration ────────────────────────────────────────────────────

/// Named model tiers for the benchpress pipeline.
#[derive(Debug, Clone)]
pub struct ModelConfig {
    /// Default workhorse model.
    pub primary: String,
    /// Top-tier model for complex judgment / distillation.
    pub frontier: String,
    /// Fast/cheap model for replay and validation.
    pub fast: String,
}

impl Default for ModelConfig {
    fn default() -> Self {
        Self {
            primary: "claude-sonnet-4-6".into(),
            frontier: "claude-opus-4-6".into(),
            fast: "claude-haiku-4-5".into(),
        }
    }
}

impl ModelConfig {
    /// Get model string by tier name. Falls back to primary for unknown tiers.
    pub fn get(&self, tier: &str) -> &str {
        match tier {
            "frontier" | "opus" => &self.frontier,
            "fast" | "haiku" => &self.fast,
            _ => &self.primary,
        }
    }
}
