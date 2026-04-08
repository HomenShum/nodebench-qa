//! Copy-paste block extraction strategy.
//!
//! Identifies deterministic outputs that can be injected directly without
//! LLM regeneration during replay:
//! - FileCreate events -> content IS the copy block (confidence 1.0)
//! - FileEdit with large `after` strings -> reusable output (confidence 0.9)
//! - ToolCall results that are data lookups -> reusable (confidence 0.8)

use benchpress_workflow::CanonicalEvent;
use serde::{Deserialize, Serialize};

/// A block of content that can be copy-pasted during replay instead of
/// regenerating it with an LLM. Higher confidence = safer to inject verbatim.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CopyBlock {
    /// Index of the source event in the event stream.
    pub event_index: usize,
    /// The content to inject.
    pub content: String,
    /// How confident we are this can be reused verbatim (0.0-1.0).
    pub confidence: f64,
}

/// Minimum character length for a FileEdit `after` to qualify as a copy block.
const MIN_EDIT_CONTENT_LEN: usize = 50;

/// Minimum character length for a ToolCall result to qualify as a data lookup.
const MIN_TOOL_RESULT_LEN: usize = 100;

/// Extract copy-paste blocks from the event stream.
pub fn extract(events: &[CanonicalEvent]) -> Vec<CopyBlock> {
    let mut blocks = Vec::new();

    for (i, event) in events.iter().enumerate() {
        match event {
            // FileCreate: the entire file content is deterministic
            CanonicalEvent::FileCreate { content, .. } => {
                if !content.is_empty() {
                    blocks.push(CopyBlock {
                        event_index: i,
                        content: content.clone(),
                        confidence: 1.0,
                    });
                }
            }

            // FileEdit: large `after` blocks are likely reusable
            CanonicalEvent::FileEdit { after, .. } => {
                if after.len() >= MIN_EDIT_CONTENT_LEN {
                    blocks.push(CopyBlock {
                        event_index: i,
                        content: after.clone(),
                        confidence: 0.9,
                    });
                }
            }

            // ToolCall: data lookup results (Read, Search results) are reusable
            CanonicalEvent::ToolCall { tool, result, .. } => {
                if is_data_lookup_tool(tool) {
                    let result_str = result_to_string(result);
                    if result_str.len() >= MIN_TOOL_RESULT_LEN {
                        blocks.push(CopyBlock {
                            event_index: i,
                            content: result_str,
                            confidence: 0.8,
                        });
                    }
                }
            }

            _ => {}
        }
    }

    blocks
}

/// Tools whose results are data lookups (deterministic reads).
fn is_data_lookup_tool(tool: &str) -> bool {
    matches!(
        tool.to_lowercase().as_str(),
        "read" | "grep" | "glob" | "cat" | "find" | "search" | "list"
    )
}

/// Convert a serde_json::Value result into a flat string for extraction.
fn result_to_string(value: &serde_json::Value) -> String {
    match value {
        serde_json::Value::String(s) => s.clone(),
        serde_json::Value::Array(arr) => arr
            .iter()
            .filter_map(|v| v.as_str())
            .collect::<Vec<_>>()
            .join("\n"),
        _ => {
            // For objects / nested structures, try to extract text content
            if let Some(content) = value.get("content") {
                return result_to_string(content);
            }
            if let Some(text) = value.get("text").and_then(|t| t.as_str()) {
                return text.to_string();
            }
            if let Some(output) = value.get("output").and_then(|o| o.as_str()) {
                return output.to_string();
            }
            serde_json::to_string(value).unwrap_or_default()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn extracts_file_create_blocks() {
        let events = vec![CanonicalEvent::FileCreate {
            path: "main.rs".into(),
            content: "fn main() { println!(\"hello\"); }".into(),
        }];
        let blocks = extract(&events);
        assert_eq!(blocks.len(), 1);
        assert_eq!(blocks[0].event_index, 0);
        assert!((blocks[0].confidence - 1.0).abs() < f64::EPSILON);
    }

    #[test]
    fn extracts_large_file_edits() {
        let long_after = "x".repeat(100);
        let events = vec![CanonicalEvent::FileEdit {
            path: "lib.rs".into(),
            before: "old".into(),
            after: long_after.clone(),
        }];
        let blocks = extract(&events);
        assert_eq!(blocks.len(), 1);
        assert_eq!(blocks[0].content, long_after);
        assert!((blocks[0].confidence - 0.9).abs() < f64::EPSILON);
    }

    #[test]
    fn skips_small_file_edits() {
        let events = vec![CanonicalEvent::FileEdit {
            path: "lib.rs".into(),
            before: "a".into(),
            after: "b".into(),
        }];
        let blocks = extract(&events);
        assert!(blocks.is_empty());
    }

    #[test]
    fn extracts_data_lookup_results() {
        let long_result = "a".repeat(150);
        let events = vec![CanonicalEvent::ToolCall {
            tool: "Read".into(),
            args: json!({"path": "file.rs"}),
            result: json!(long_result),
            duration_ms: 10,
        }];
        let blocks = extract(&events);
        assert_eq!(blocks.len(), 1);
        assert!((blocks[0].confidence - 0.8).abs() < f64::EPSILON);
    }

    #[test]
    fn skips_non_data_tools() {
        let long_result = "a".repeat(150);
        let events = vec![CanonicalEvent::ToolCall {
            tool: "Bash".into(),
            args: json!({"command": "rm -rf /"}),
            result: json!(long_result),
            duration_ms: 10,
        }];
        let blocks = extract(&events);
        assert!(blocks.is_empty());
    }

    #[test]
    fn skips_empty_file_create() {
        let events = vec![CanonicalEvent::FileCreate {
            path: "empty.rs".into(),
            content: String::new(),
        }];
        let blocks = extract(&events);
        assert!(blocks.is_empty());
    }

    #[test]
    fn event_indices_correct() {
        let events = vec![
            CanonicalEvent::Think {
                content: "thinking".into(),
                duration_ms: 10,
            },
            CanonicalEvent::FileCreate {
                path: "a.rs".into(),
                content: "code".into(),
            },
            CanonicalEvent::Think {
                content: "more".into(),
                duration_ms: 10,
            },
            CanonicalEvent::FileCreate {
                path: "b.rs".into(),
                content: "more code".into(),
            },
        ];
        let blocks = extract(&events);
        assert_eq!(blocks.len(), 2);
        assert_eq!(blocks[0].event_index, 1);
        assert_eq!(blocks[1].event_index, 3);
    }
}
