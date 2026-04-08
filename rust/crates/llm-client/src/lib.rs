//! attrition-llm-client: Multi-provider LLM API client
//!
//! Typed HTTP client supporting Anthropic (Claude), OpenAI, and OpenAI-compatible
//! endpoints. Supports text generation, vision (screenshot analysis), token
//! tracking, and retry with exponential backoff for rate limits.

pub mod client;
pub mod types;

pub use client::{ClaudeClient, LlmClient};
pub use types::*;
