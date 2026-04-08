//! Generic pre-structured JSON adapter.
//!
//! Accepts JSON that already conforms to the canonical event schema:
//! ```json
//! { "events": [CanonicalEvent, ...] }
//! ```
//! This is the simplest adapter — it just deserializes.

use crate::adapters::WorkflowAdapter;
use crate::CanonicalEvent;
use benchpress_core::Result;
use serde::Deserialize;

/// Accepts pre-structured canonical events. No transformation needed.
pub struct GenericAdapter;

#[derive(Deserialize)]
struct GenericInput {
    events: Vec<CanonicalEvent>,
}

impl WorkflowAdapter for GenericAdapter {
    fn parse(input: &[u8]) -> Result<Vec<CanonicalEvent>> {
        let text = std::str::from_utf8(input).map_err(|e| {
            benchpress_core::Error::Internal(format!("Invalid UTF-8: {e}"))
        })?;
        let parsed: GenericInput = serde_json::from_str(text)?;
        Ok(parsed.events)
    }

    fn source_name() -> &'static str {
        "generic"
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_pre_structured_events() {
        let input = serde_json::json!({
            "events": [
                {"type": "think", "content": "reasoning", "duration_ms": 100},
                {"type": "file_create", "path": "test.rs", "content": "fn main() {}"},
                {"type": "assert", "condition": "file exists", "passed": true, "evidence": "checked"}
            ]
        });
        let bytes = serde_json::to_vec(&input).unwrap();
        let events = GenericAdapter::parse(&bytes).unwrap();
        assert_eq!(events.len(), 3);
        assert!(matches!(&events[0], CanonicalEvent::Think { .. }));
        assert!(matches!(&events[1], CanonicalEvent::FileCreate { .. }));
        assert!(matches!(&events[2], CanonicalEvent::Assert { passed: true, .. }));
    }

    #[test]
    fn parse_all_event_types() {
        let input = serde_json::json!({
            "events": [
                {"type": "think", "content": "hmm", "duration_ms": 50},
                {"type": "tool_call", "tool": "bash", "args": {"cmd": "ls"}, "result": {"out": "ok"}, "duration_ms": 10},
                {"type": "decision", "question": "what framework?", "choice": "axum", "alternatives": ["actix", "warp"], "reasoning": "fastest"},
                {"type": "file_edit", "path": "lib.rs", "before": "old", "after": "new"},
                {"type": "file_create", "path": "new.rs", "content": "// new file"},
                {"type": "search", "query": "fn main", "results_count": 3, "selected": "src/main.rs"},
                {"type": "navigate", "from": "lib.rs", "to": "main.rs", "reason": "check imports"},
                {"type": "assert", "condition": "compiles", "passed": true, "evidence": "cargo check OK"},
                {"type": "checkpoint", "label": "after-refactor", "state_hash": "abc123"},
                {"type": "nudge", "from_judge": true, "message": "check edge case", "correction": null}
            ]
        });
        let bytes = serde_json::to_vec(&input).unwrap();
        let events = GenericAdapter::parse(&bytes).unwrap();
        assert_eq!(events.len(), 10);
    }

    #[test]
    fn empty_events_array() {
        let input = serde_json::json!({"events": []});
        let bytes = serde_json::to_vec(&input).unwrap();
        let events = GenericAdapter::parse(&bytes).unwrap();
        assert!(events.is_empty());
    }

    #[test]
    fn missing_events_key_errors() {
        let input = serde_json::json!({"data": []});
        let bytes = serde_json::to_vec(&input).unwrap();
        let result = GenericAdapter::parse(&bytes);
        assert!(result.is_err());
    }

    #[test]
    fn invalid_event_type_errors() {
        let input = serde_json::json!({
            "events": [{"type": "nonexistent_event", "foo": "bar"}]
        });
        let bytes = serde_json::to_vec(&input).unwrap();
        let result = GenericAdapter::parse(&bytes);
        assert!(result.is_err());
    }
}
