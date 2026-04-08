//! Anthropic Messages API client with retry, token tracking, and vision support.

use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use benchpress_core::error::{Error, Result};
use reqwest::header::{HeaderMap, HeaderValue, CONTENT_TYPE};
use tracing::{debug, warn};

use crate::types::{
    ApiErrorResponse, ContentBlock, ImageSource, Message, MessageRequest, MessageResponse,
};

/// Maximum number of retries for retryable errors (429/529).
const MAX_RETRIES: u32 = 3;

/// Base backoff duration in milliseconds. Doubles each retry: 1s, 2s, 4s.
const BASE_BACKOFF_MS: u64 = 1000;

/// Default request timeout.
const REQUEST_TIMEOUT: Duration = Duration::from_secs(120);

/// Anthropic API version header value.
const API_VERSION: &str = "2023-06-01";

/// HTTP client for the Anthropic Messages API.
///
/// Tracks cumulative token usage across all calls for cost accounting.
/// Retries on 429 (rate limited) and 529 (overloaded) with exponential backoff.
pub struct ClaudeClient {
    api_key: String,
    api_endpoint: String,
    model: String,
    client: reqwest::Client,
    total_input_tokens: AtomicU64,
    total_output_tokens: AtomicU64,
}

impl ClaudeClient {
    /// Create a new client targeting the Anthropic API.
    pub fn new(api_key: &str, model: &str) -> Self {
        let client = reqwest::Client::builder()
            .timeout(REQUEST_TIMEOUT)
            .build()
            .expect("Failed to build HTTP client");

        Self {
            api_key: api_key.to_string(),
            api_endpoint: "https://api.anthropic.com".to_string(),
            model: model.to_string(),
            client,
            total_input_tokens: AtomicU64::new(0),
            total_output_tokens: AtomicU64::new(0),
        }
    }

    /// Override the API endpoint (e.g. for proxies or testing).
    pub fn with_endpoint(mut self, endpoint: &str) -> Self {
        self.api_endpoint = endpoint.trim_end_matches('/').to_string();
        self
    }

    /// Override the request timeout.
    pub fn with_timeout(self, timeout: Duration) -> Self {
        let client = reqwest::Client::builder()
            .timeout(timeout)
            .build()
            .expect("Failed to build HTTP client");
        Self { client, ..self }
    }

    /// Generate a text completion.
    ///
    /// Sends a single user message to the Messages API and returns the
    /// assistant's text response. Tracks token usage atomically.
    pub async fn generate(
        &self,
        prompt: &str,
        system: Option<&str>,
        max_tokens: u32,
    ) -> Result<String> {
        let request = MessageRequest {
            model: self.model.clone(),
            max_tokens,
            messages: vec![Message {
                role: "user".into(),
                content: vec![ContentBlock::Text {
                    text: prompt.to_string(),
                }],
            }],
            system: system.map(|s| s.to_string()),
            temperature: None,
        };

        let response = self.send_request(&request).await?;
        self.track_usage(&response);
        extract_text(&response)
    }

    /// Generate with vision — analyze a PNG screenshot alongside a text prompt.
    ///
    /// The image bytes are base64-encoded and sent as an Image content block.
    pub async fn vision(
        &self,
        prompt: &str,
        image_png: &[u8],
        max_tokens: u32,
    ) -> Result<String> {
        use base64::Engine as _;
        let encoded = base64::engine::general_purpose::STANDARD.encode(image_png);

        let request = MessageRequest {
            model: self.model.clone(),
            max_tokens,
            messages: vec![Message {
                role: "user".into(),
                content: vec![
                    ContentBlock::Image {
                        source: ImageSource {
                            source_type: "base64".into(),
                            media_type: "image/png".into(),
                            data: encoded,
                        },
                    },
                    ContentBlock::Text {
                        text: prompt.to_string(),
                    },
                ],
            }],
            system: None,
            temperature: None,
        };

        let response = self.send_request(&request).await?;
        self.track_usage(&response);
        extract_text(&response)
    }

    /// Get cumulative tokens used across all calls: (input, output).
    pub fn tokens_used(&self) -> (u64, u64) {
        (
            self.total_input_tokens.load(Ordering::Relaxed),
            self.total_output_tokens.load(Ordering::Relaxed),
        )
    }

    /// Reset the token counters to zero.
    pub fn reset_token_counters(&self) {
        self.total_input_tokens.store(0, Ordering::Relaxed);
        self.total_output_tokens.store(0, Ordering::Relaxed);
    }

    /// Current model name.
    pub fn model(&self) -> &str {
        &self.model
    }

    // ── Internal ───────────────────────────────────────────────────────────

    /// Send a MessageRequest with retry on 429/529.
    async fn send_request(&self, request: &MessageRequest) -> Result<MessageResponse> {
        let url = format!("{}/v1/messages", self.api_endpoint);
        let headers = self.build_headers()?;
        let body = serde_json::to_string(request)?;

        let mut last_error: Option<Error> = None;

        for attempt in 0..=MAX_RETRIES {
            if attempt > 0 {
                let backoff_ms = BASE_BACKOFF_MS * (1 << (attempt - 1));
                debug!(attempt, backoff_ms, "Retrying after backoff");
                tokio::time::sleep(Duration::from_millis(backoff_ms)).await;
            }

            let result = self
                .client
                .post(&url)
                .headers(headers.clone())
                .body(body.clone())
                .send()
                .await;

            match result {
                Ok(resp) => {
                    let status = resp.status();

                    if status.is_success() {
                        let response_body = resp.text().await.map_err(|e| {
                            Error::Internal(format!("Failed to read response body: {}", e))
                        })?;

                        let msg_response: MessageResponse =
                            serde_json::from_str(&response_body).map_err(|e| {
                                Error::Internal(format!(
                                    "Failed to parse API response: {}. Body: {}",
                                    e,
                                    truncate(&response_body, 200),
                                ))
                            })?;

                        return Ok(msg_response);
                    }

                    // Read error body for diagnostics.
                    let error_body = resp.text().await.unwrap_or_default();

                    // Retryable: 429 (rate limited), 529 (overloaded).
                    if status.as_u16() == 429 || status.as_u16() == 529 {
                        warn!(
                            status = status.as_u16(),
                            attempt,
                            "Retryable API error"
                        );
                        last_error = Some(Error::RateLimited {
                            retry_after_ms: BASE_BACKOFF_MS * (1 << attempt),
                        });
                        continue;
                    }

                    // 401 — bad API key.
                    if status.as_u16() == 401 {
                        return Err(Error::Auth(
                            "Invalid API key. Check your ANTHROPIC_API_KEY.".into(),
                        ));
                    }

                    // 400 — bad request (non-retryable).
                    if status.as_u16() == 400 {
                        let detail = parse_error_message(&error_body);
                        return Err(Error::Internal(format!(
                            "Bad request (400): {}",
                            detail,
                        )));
                    }

                    // Other errors — don't retry.
                    let detail = parse_error_message(&error_body);
                    return Err(Error::Internal(format!(
                        "API error {}: {}",
                        status.as_u16(),
                        detail,
                    )));
                }
                Err(e) => {
                    // Network errors — retryable.
                    if e.is_timeout() {
                        warn!(attempt, "Request timed out");
                        last_error =
                            Some(Error::Timeout(REQUEST_TIMEOUT.as_millis() as u64));
                        continue;
                    }
                    if e.is_connect() {
                        warn!(attempt, "Connection failed");
                        last_error = Some(Error::Internal(format!(
                            "Connection to {} failed: {}",
                            self.api_endpoint, e,
                        )));
                        continue;
                    }

                    // Non-retryable network error.
                    return Err(Error::Http(e));
                }
            }
        }

        // All retries exhausted.
        Err(last_error.unwrap_or_else(|| {
            Error::Internal("All retries exhausted with no error captured".into())
        }))
    }

    /// Build the required headers for the Anthropic API.
    fn build_headers(&self) -> Result<HeaderMap> {
        let mut headers = HeaderMap::new();

        headers.insert(
            CONTENT_TYPE,
            HeaderValue::from_static("application/json"),
        );

        headers.insert(
            "x-api-key",
            HeaderValue::from_str(&self.api_key).map_err(|e| {
                Error::Auth(format!("Invalid API key format: {}", e))
            })?,
        );

        headers.insert(
            "anthropic-version",
            HeaderValue::from_static(API_VERSION),
        );

        Ok(headers)
    }

    /// Atomically accumulate token usage.
    fn track_usage(&self, response: &MessageResponse) {
        self.total_input_tokens
            .fetch_add(response.usage.input_tokens, Ordering::Relaxed);
        self.total_output_tokens
            .fetch_add(response.usage.output_tokens, Ordering::Relaxed);
    }
}

/// Extract concatenated text from a MessageResponse's content blocks.
fn extract_text(response: &MessageResponse) -> Result<String> {
    let mut texts = Vec::new();
    for block in &response.content {
        if let ContentBlock::Text { text } = block {
            texts.push(text.as_str());
        }
    }

    if texts.is_empty() {
        return Err(Error::Internal(
            "API response contained no text content blocks".into(),
        ));
    }

    Ok(texts.join(""))
}

/// Try to parse a structured error message from the API error body.
fn parse_error_message(body: &str) -> String {
    if let Ok(err_resp) = serde_json::from_str::<ApiErrorResponse>(body) {
        format!("{}: {}", err_resp.error.error_type, err_resp.error.message)
    } else {
        truncate(body, 300).to_string()
    }
}

/// Truncate a string, appending "..." if it exceeds `max` characters.
fn truncate(s: &str, max: usize) -> &str {
    if s.len() <= max {
        s
    } else {
        // Find a safe UTF-8 boundary.
        let mut end = max;
        while end > 0 && !s.is_char_boundary(end) {
            end -= 1;
        }
        &s[..end]
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::{ContentBlock, MessageResponse, Usage};

    #[test]
    fn extract_text_from_response() {
        let response = MessageResponse {
            id: "msg_test".into(),
            model: "claude-sonnet-4-6".into(),
            content: vec![
                ContentBlock::Text {
                    text: "Hello ".into(),
                },
                ContentBlock::Text {
                    text: "World".into(),
                },
            ],
            stop_reason: Some("end_turn".into()),
            usage: Usage {
                input_tokens: 10,
                output_tokens: 5,
            },
        };

        let text = extract_text(&response).unwrap();
        assert_eq!(text, "Hello World");
    }

    #[test]
    fn extract_text_empty_content_is_error() {
        let response = MessageResponse {
            id: "msg_test".into(),
            model: "claude-sonnet-4-6".into(),
            content: vec![],
            stop_reason: None,
            usage: Usage {
                input_tokens: 0,
                output_tokens: 0,
            },
        };

        assert!(extract_text(&response).is_err());
    }

    #[test]
    fn token_tracking() {
        let client = ClaudeClient::new("test-key", "test-model");
        assert_eq!(client.tokens_used(), (0, 0));

        // Simulate tracking.
        let response = MessageResponse {
            id: "msg_1".into(),
            model: "test".into(),
            content: vec![],
            stop_reason: None,
            usage: Usage {
                input_tokens: 100,
                output_tokens: 50,
            },
        };
        client.track_usage(&response);
        assert_eq!(client.tokens_used(), (100, 50));

        client.track_usage(&response);
        assert_eq!(client.tokens_used(), (200, 100));

        client.reset_token_counters();
        assert_eq!(client.tokens_used(), (0, 0));
    }

    #[test]
    fn parse_error_message_structured() {
        let body = r#"{"type":"error","error":{"type":"invalid_request_error","message":"max_tokens must be positive"}}"#;
        let msg = parse_error_message(body);
        assert!(msg.contains("invalid_request_error"));
        assert!(msg.contains("max_tokens"));
    }

    #[test]
    fn parse_error_message_unstructured() {
        let body = "Internal Server Error";
        let msg = parse_error_message(body);
        assert_eq!(msg, "Internal Server Error");
    }

    #[test]
    fn model_config_defaults() {
        let config = crate::types::ModelConfig::default();
        assert_eq!(config.primary, "claude-sonnet-4-6");
        assert_eq!(config.frontier, "claude-opus-4-6");
        assert_eq!(config.fast, "claude-haiku-4-5");
        assert_eq!(config.get("frontier"), "claude-opus-4-6");
        assert_eq!(config.get("haiku"), "claude-haiku-4-5");
        assert_eq!(config.get("unknown"), "claude-sonnet-4-6");
    }

    #[test]
    fn headers_built_correctly() {
        let client = ClaudeClient::new("sk-ant-test-key", "claude-sonnet-4-6");
        let headers = client.build_headers().unwrap();
        assert_eq!(
            headers.get("content-type").unwrap(),
            "application/json"
        );
        assert_eq!(
            headers.get("x-api-key").unwrap(),
            "sk-ant-test-key"
        );
        assert_eq!(
            headers.get("anthropic-version").unwrap(),
            "2023-06-01"
        );
    }
}
