//! Anthropic Messages API response adapter.
//!
//! Parses the standard Messages API response format: an array of message
//! objects, each with a `role` and `content` array of typed blocks.

use crate::adapters::WorkflowAdapter;
use crate::CanonicalEvent;
use benchpress_core::Result;
use serde_json::Value;

/// Parses Anthropic Messages API responses into canonical events.
///
/// Expects JSON input shaped as:
/// ```json
/// {
///   "messages": [
///     { "role": "assistant", "content": [...] },
///     { "role": "user", "content": [...] }
///   ]
/// }
/// ```
/// Or a bare array of message objects.
pub struct RawApiAdapter;

impl WorkflowAdapter for RawApiAdapter {
    fn parse(input: &[u8]) -> Result<Vec<CanonicalEvent>> {
        let text = std::str::from_utf8(input).map_err(|e| {
            benchpress_core::Error::Internal(format!("Invalid UTF-8: {e}"))
        })?;
        let root: Value = serde_json::from_str(text)?;

        let messages = extract_messages(&root)?;
        let mut events = Vec::new();

        // Build tool result lookup from user messages
        let mut tool_results: std::collections::HashMap<String, Value> =
            std::collections::HashMap::new();
        for msg in &messages {
            if msg.get("role").and_then(|r| r.as_str()) == Some("user") {
                if let Some(content) = msg.get("content").and_then(|c| c.as_array()) {
                    for block in content {
                        if block.get("type").and_then(|t| t.as_str()) == Some("tool_result") {
                            if let Some(id) = block.get("tool_use_id").and_then(|i| i.as_str()) {
                                let result = block
                                    .get("content")
                                    .cloned()
                                    .unwrap_or(Value::Null);
                                tool_results.insert(id.to_string(), result);
                            }
                        }
                    }
                }
            }
        }

        // Parse assistant messages
        for msg in &messages {
            if msg.get("role").and_then(|r| r.as_str()) != Some("assistant") {
                continue;
            }

            let content = match msg.get("content").and_then(|c| c.as_array()) {
                Some(arr) => arr,
                None => continue,
            };

            for block in content {
                let block_type = block.get("type").and_then(|t| t.as_str()).unwrap_or("");
                match block_type {
                    "text" => {
                        let text = block
                            .get("text")
                            .and_then(|t| t.as_str())
                            .unwrap_or("")
                            .to_string();
                        if !text.is_empty() {
                            events.push(CanonicalEvent::Think {
                                content: text,
                                duration_ms: 0,
                            });
                        }
                    }
                    "tool_use" => {
                        let tool = block
                            .get("name")
                            .and_then(|n| n.as_str())
                            .unwrap_or("unknown")
                            .to_string();
                        let args = block
                            .get("input")
                            .cloned()
                            .unwrap_or(Value::Object(Default::default()));
                        let id = block.get("id").and_then(|i| i.as_str()).unwrap_or("");
                        let result = tool_results.get(id).cloned().unwrap_or(Value::Null);

                        events.push(CanonicalEvent::ToolCall {
                            tool,
                            args,
                            result,
                            duration_ms: 0,
                        });
                    }
                    _ => {}
                }
            }
        }

        Ok(events)
    }

    fn source_name() -> &'static str {
        "raw-api"
    }
}

/// Extract the messages array from either `{ "messages": [...] }` or a bare array.
fn extract_messages(root: &Value) -> Result<Vec<Value>> {
    // Try { "messages": [...] }
    if let Some(msgs) = root.get("messages").and_then(|m| m.as_array()) {
        return Ok(msgs.clone());
    }
    // Try bare array
    if let Some(arr) = root.as_array() {
        return Ok(arr.clone());
    }
    // Try single message response (from a single API call)
    if root.get("role").is_some() && root.get("content").is_some() {
        return Ok(vec![root.clone()]);
    }
    Err(benchpress_core::Error::Internal(
        "Expected messages array, bare array, or single message object".into(),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_messages_wrapper() {
        let input = serde_json::json!({
            "messages": [
                {
                    "role": "assistant",
                    "content": [
                        {"type": "text", "text": "Hello world"}
                    ]
                }
            ]
        });
        let bytes = serde_json::to_vec(&input).unwrap();
        let events = RawApiAdapter::parse(&bytes).unwrap();
        assert_eq!(events.len(), 1);
        match &events[0] {
            CanonicalEvent::Think { content, .. } => assert_eq!(content, "Hello world"),
            other => panic!("Expected Think, got {other:?}"),
        }
    }

    #[test]
    fn parse_bare_array() {
        let input = serde_json::json!([
            {
                "role": "assistant",
                "content": [
                    {"type": "text", "text": "thinking"},
                    {"type": "tool_use", "id": "tu_1", "name": "bash", "input": {"cmd": "ls"}}
                ]
            },
            {
                "role": "user",
                "content": [
                    {"type": "tool_result", "tool_use_id": "tu_1", "content": "output"}
                ]
            }
        ]);
        let bytes = serde_json::to_vec(&input).unwrap();
        let events = RawApiAdapter::parse(&bytes).unwrap();
        assert_eq!(events.len(), 2);
        assert!(matches!(&events[0], CanonicalEvent::Think { .. }));
        assert!(matches!(&events[1], CanonicalEvent::ToolCall { tool, .. } if tool == "bash"));
    }

    #[test]
    fn parse_single_message() {
        let input = serde_json::json!({
            "role": "assistant",
            "content": [{"type": "text", "text": "solo response"}]
        });
        let bytes = serde_json::to_vec(&input).unwrap();
        let events = RawApiAdapter::parse(&bytes).unwrap();
        assert_eq!(events.len(), 1);
    }

    #[test]
    fn tool_results_attached() {
        let input = serde_json::json!({
            "messages": [
                {
                    "role": "assistant",
                    "content": [
                        {"type": "tool_use", "id": "tu_99", "name": "read", "input": {"path": "f.rs"}}
                    ]
                },
                {
                    "role": "user",
                    "content": [
                        {"type": "tool_result", "tool_use_id": "tu_99", "content": "file contents here"}
                    ]
                }
            ]
        });
        let bytes = serde_json::to_vec(&input).unwrap();
        let events = RawApiAdapter::parse(&bytes).unwrap();
        assert_eq!(events.len(), 1);
        match &events[0] {
            CanonicalEvent::ToolCall { result, .. } => {
                assert_eq!(result.as_str().unwrap(), "file contents here");
            }
            other => panic!("Expected ToolCall, got {other:?}"),
        }
    }

    #[test]
    fn invalid_format_errors() {
        let input = serde_json::json!({"foo": "bar"});
        let bytes = serde_json::to_vec(&input).unwrap();
        let result = RawApiAdapter::parse(&bytes);
        assert!(result.is_err());
    }
}
