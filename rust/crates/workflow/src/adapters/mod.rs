//! Adapters parse raw session data from various agent formats into canonical events.

pub mod claude_code;
pub mod generic;
pub mod raw_api;

use crate::CanonicalEvent;
use benchpress_core::Result;

/// Trait for parsing agent session data into the canonical event stream.
///
/// Each adapter knows how to read one specific format (Claude Code JSONL,
/// Anthropic Messages API, pre-structured JSON, etc.) and normalize it.
pub trait WorkflowAdapter {
    /// Parse raw bytes into a sequence of canonical events.
    fn parse(input: &[u8]) -> Result<Vec<CanonicalEvent>>;

    /// Human-readable name identifying this adapter.
    fn source_name() -> &'static str;
}
