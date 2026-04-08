//! benchpress-llm-client: Anthropic Messages API client
//!
//! Typed HTTP client for the Claude family of models. Supports text generation,
//! vision (screenshot analysis), token tracking, and retry with exponential
//! backoff for rate limits.

pub mod client;
pub mod types;

pub use client::ClaudeClient;
pub use types::*;
