//! Claude Code JSONL session file adapter.
//!
//! Claude Code writes session logs as JSONL (one JSON object per line).
//! Each line has a `"type"` field — we care about `"assistant"` messages
//! whose `message.content` array contains text blocks and tool_use blocks.

use crate::adapters::WorkflowAdapter;
use crate::CanonicalEvent;
use benchpress_core::Result;
use serde_json::Value;

/// Parses Claude Code `.jsonl` session files into canonical events.
pub struct ClaudeCodeAdapter;

impl WorkflowAdapter for ClaudeCodeAdapter {
    fn parse(input: &[u8]) -> Result<Vec<CanonicalEvent>> {
        let text = std::str::from_utf8(input).map_err(|e| {
            benchpress_core::Error::Internal(format!("Invalid UTF-8 in JSONL: {e}"))
        })?;

        let mut events = Vec::new();
        // Collect tool results keyed by tool_use_id so we can attach them
        let mut tool_results: std::collections::HashMap<String, Value> =
            std::collections::HashMap::new();

        // First pass: collect tool results from user messages
        for line in text.lines() {
            let line = line.trim();
            if line.is_empty() {
                continue;
            }
            let obj: Value = match serde_json::from_str(line) {
                Ok(v) => v,
                Err(_) => continue, // skip malformed lines
            };

            if obj.get("type").and_then(|t| t.as_str()) == Some("user") {
                if let Some(content) = obj
                    .get("message")
                    .and_then(|m| m.get("content"))
                    .and_then(|c| c.as_array())
                {
                    for block in content {
                        if block.get("type").and_then(|t| t.as_str()) == Some("tool_result") {
                            if let Some(tool_use_id) =
                                block.get("tool_use_id").and_then(|id| id.as_str())
                            {
                                let result_content = block
                                    .get("content")
                                    .cloned()
                                    .unwrap_or(Value::Null);
                                tool_results
                                    .insert(tool_use_id.to_string(), result_content);
                            }
                        }
                    }
                }
            }
        }

        // Second pass: parse assistant messages into canonical events
        for line in text.lines() {
            let line = line.trim();
            if line.is_empty() {
                continue;
            }
            let obj: Value = match serde_json::from_str(line) {
                Ok(v) => v,
                Err(_) => continue,
            };

            if obj.get("type").and_then(|t| t.as_str()) != Some("assistant") {
                continue;
            }

            let duration_ms = obj
                .get("duration_ms")
                .and_then(|d| d.as_u64())
                .unwrap_or(0);

            let content = match obj
                .get("message")
                .and_then(|m| m.get("content"))
                .and_then(|c| c.as_array())
            {
                Some(arr) => arr,
                None => continue,
            };

            // Count content blocks to distribute duration evenly
            let block_count = content.len().max(1) as u64;
            let per_block_ms = duration_ms / block_count;

            for block in content {
                let block_type = block.get("type").and_then(|t| t.as_str()).unwrap_or("");

                match block_type {
                    "text" => {
                        let text_content = block
                            .get("text")
                            .and_then(|t| t.as_str())
                            .unwrap_or("")
                            .to_string();
                        if !text_content.is_empty() {
                            events.push(CanonicalEvent::Think {
                                content: text_content,
                                duration_ms: per_block_ms,
                            });
                        }
                    }
                    "tool_use" => {
                        let tool_name = block
                            .get("name")
                            .and_then(|n| n.as_str())
                            .unwrap_or("unknown")
                            .to_string();
                        let input = block
                            .get("input")
                            .cloned()
                            .unwrap_or(Value::Object(Default::default()));
                        let tool_use_id = block
                            .get("id")
                            .and_then(|id| id.as_str())
                            .unwrap_or("");
                        let result = tool_results
                            .get(tool_use_id)
                            .cloned()
                            .unwrap_or(Value::Null);

                        let event =
                            map_tool_to_event(&tool_name, &input, &result, per_block_ms);
                        events.push(event);
                    }
                    _ => {
                        // Unknown block type — store as a generic think
                        if let Some(text) = block.get("text").and_then(|t| t.as_str()) {
                            if !text.is_empty() {
                                events.push(CanonicalEvent::Think {
                                    content: text.to_string(),
                                    duration_ms: per_block_ms,
                                });
                            }
                        }
                    }
                }
            }
        }

        Ok(events)
    }

    fn source_name() -> &'static str {
        "claude-code"
    }
}

/// Map a Claude Code tool invocation to the appropriate canonical event variant.
fn map_tool_to_event(
    tool: &str,
    input: &Value,
    result: &Value,
    duration_ms: u64,
) -> CanonicalEvent {
    match tool {
        "Edit" => {
            let path = input
                .get("file_path")
                .and_then(|p| p.as_str())
                .unwrap_or("unknown")
                .to_string();
            let before = input
                .get("old_string")
                .and_then(|s| s.as_str())
                .unwrap_or("")
                .to_string();
            let after = input
                .get("new_string")
                .and_then(|s| s.as_str())
                .unwrap_or("")
                .to_string();
            CanonicalEvent::FileEdit {
                path,
                before,
                after,
            }
        }

        "Write" => {
            let path = input
                .get("file_path")
                .and_then(|p| p.as_str())
                .unwrap_or("unknown")
                .to_string();
            let content = input
                .get("content")
                .and_then(|c| c.as_str())
                .unwrap_or("")
                .to_string();
            CanonicalEvent::FileCreate { path, content }
        }

        "Grep" | "Glob" => {
            let query = input
                .get("pattern")
                .or_else(|| input.get("query"))
                .and_then(|q| q.as_str())
                .unwrap_or("")
                .to_string();
            // Attempt to extract result count from the result
            let results_count = extract_results_count(result);
            let selected = extract_first_result(result);
            CanonicalEvent::Search {
                query,
                results_count,
                selected,
            }
        }

        "Read" => CanonicalEvent::ToolCall {
            tool: "Read".into(),
            args: input.clone(),
            result: result.clone(),
            duration_ms,
        },

        "Bash" => CanonicalEvent::ToolCall {
            tool: "Bash".into(),
            args: input.clone(),
            result: result.clone(),
            duration_ms,
        },

        _ => CanonicalEvent::ToolCall {
            tool: tool.to_string(),
            args: input.clone(),
            result: result.clone(),
            duration_ms,
        },
    }
}

/// Try to count how many results a search tool returned.
fn extract_results_count(result: &Value) -> usize {
    // Result might be a string with newline-separated paths, or an array
    if let Some(arr) = result.as_array() {
        return arr.len();
    }
    if let Some(text) = result.as_str() {
        return text.lines().filter(|l| !l.trim().is_empty()).count();
    }
    // Might be nested: { "content": [{ "text": "..." }] }
    if let Some(content) = result.get("content").and_then(|c| c.as_array()) {
        if let Some(first) = content.first() {
            if let Some(text) = first.get("text").and_then(|t| t.as_str()) {
                return text.lines().filter(|l| !l.trim().is_empty()).count();
            }
        }
    }
    0
}

/// Extract the first result path/line from a search result.
fn extract_first_result(result: &Value) -> Option<String> {
    if let Some(arr) = result.as_array() {
        return arr.first().and_then(|v| v.as_str()).map(|s| s.to_string());
    }
    if let Some(text) = result.as_str() {
        return text.lines().next().map(|l| l.trim().to_string());
    }
    if let Some(content) = result.get("content").and_then(|c| c.as_array()) {
        if let Some(first) = content.first() {
            if let Some(text) = first.get("text").and_then(|t| t.as_str()) {
                return text.lines().next().map(|l| l.trim().to_string());
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_assistant_text_block() {
        let jsonl = r#"{"type":"assistant","message":{"content":[{"type":"text","text":"Let me think about this"}]},"duration_ms":1000}"#;
        let events = ClaudeCodeAdapter::parse(jsonl.as_bytes()).unwrap();
        assert_eq!(events.len(), 1);
        match &events[0] {
            CanonicalEvent::Think { content, .. } => {
                assert_eq!(content, "Let me think about this");
            }
            other => panic!("Expected Think, got {other:?}"),
        }
    }

    #[test]
    fn parse_edit_tool() {
        let jsonl = concat!(
            r#"{"type":"assistant","message":{"content":[{"type":"tool_use","id":"tu_1","name":"Edit","input":{"file_path":"src/main.rs","old_string":"old","new_string":"new"}}]},"duration_ms":500}"#,
            "\n",
            r#"{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"tu_1","content":"ok"}]}}"#
        );
        let events = ClaudeCodeAdapter::parse(jsonl.as_bytes()).unwrap();
        assert_eq!(events.len(), 1);
        match &events[0] {
            CanonicalEvent::FileEdit {
                path,
                before,
                after,
            } => {
                assert_eq!(path, "src/main.rs");
                assert_eq!(before, "old");
                assert_eq!(after, "new");
            }
            other => panic!("Expected FileEdit, got {other:?}"),
        }
    }

    #[test]
    fn parse_write_tool() {
        let jsonl = r#"{"type":"assistant","message":{"content":[{"type":"tool_use","id":"tu_2","name":"Write","input":{"file_path":"new.rs","content":"fn main() {}"}}]},"duration_ms":200}"#;
        let events = ClaudeCodeAdapter::parse(jsonl.as_bytes()).unwrap();
        assert_eq!(events.len(), 1);
        match &events[0] {
            CanonicalEvent::FileCreate { path, content } => {
                assert_eq!(path, "new.rs");
                assert_eq!(content, "fn main() {}");
            }
            other => panic!("Expected FileCreate, got {other:?}"),
        }
    }

    #[test]
    fn parse_grep_tool() {
        let jsonl = r#"{"type":"assistant","message":{"content":[{"type":"tool_use","id":"tu_3","name":"Grep","input":{"pattern":"fn main"}}]},"duration_ms":100}"#;
        let events = ClaudeCodeAdapter::parse(jsonl.as_bytes()).unwrap();
        assert_eq!(events.len(), 1);
        match &events[0] {
            CanonicalEvent::Search { query, .. } => {
                assert_eq!(query, "fn main");
            }
            other => panic!("Expected Search, got {other:?}"),
        }
    }

    #[test]
    fn parse_bash_tool() {
        let jsonl = concat!(
            r#"{"type":"assistant","message":{"content":[{"type":"tool_use","id":"tu_4","name":"Bash","input":{"command":"cargo build"}}]},"duration_ms":3000}"#,
            "\n",
            r#"{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"tu_4","content":"ok"}]}}"#
        );
        let events = ClaudeCodeAdapter::parse(jsonl.as_bytes()).unwrap();
        assert_eq!(events.len(), 1);
        match &events[0] {
            CanonicalEvent::ToolCall { tool, .. } => {
                assert_eq!(tool, "Bash");
            }
            other => panic!("Expected ToolCall, got {other:?}"),
        }
    }

    #[test]
    fn skips_malformed_lines() {
        let jsonl = "not json\n{\"type\":\"assistant\",\"message\":{\"content\":[{\"type\":\"text\",\"text\":\"ok\"}]},\"duration_ms\":1}\nalso not json\n";
        let events = ClaudeCodeAdapter::parse(jsonl.as_bytes()).unwrap();
        assert_eq!(events.len(), 1);
    }

    #[test]
    fn empty_input_returns_empty() {
        let events = ClaudeCodeAdapter::parse(b"").unwrap();
        assert!(events.is_empty());
    }

    #[test]
    fn mixed_content_blocks() {
        let jsonl = r#"{"type":"assistant","message":{"content":[{"type":"text","text":"thinking"},{"type":"tool_use","id":"tu_5","name":"Bash","input":{"command":"ls"}},{"type":"text","text":"more thinking"}]},"duration_ms":900}"#;
        let events = ClaudeCodeAdapter::parse(jsonl.as_bytes()).unwrap();
        assert_eq!(events.len(), 3);
        assert!(matches!(&events[0], CanonicalEvent::Think { .. }));
        assert!(matches!(&events[1], CanonicalEvent::ToolCall { .. }));
        assert!(matches!(&events[2], CanonicalEvent::Think { .. }));
    }
}
