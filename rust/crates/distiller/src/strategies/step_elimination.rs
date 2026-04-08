//! Step elimination strategy.
//!
//! Removes redundant steps from the event stream:
//! - Consecutive duplicate ToolCalls (same tool + same args) -> keep last
//! - Think events followed immediately by contradicting Think -> keep last
//! - Search events where results_count = 0 -> remove (dead-end exploration)
//! - FileEdit events that are later overwritten by another FileEdit on same path -> keep last only
//! - ToolCall retries (same tool, same args, first failed) -> keep only successful one

use benchpress_workflow::CanonicalEvent;

/// Eliminate redundant steps, returning a compacted event stream.
pub fn eliminate(events: &[CanonicalEvent]) -> Vec<CanonicalEvent> {
    if events.is_empty() {
        return Vec::new();
    }

    let mut result: Vec<CanonicalEvent> = Vec::with_capacity(events.len());

    // Phase 1: Remove zero-result searches (dead-end exploration)
    let no_dead_ends: Vec<&CanonicalEvent> = events
        .iter()
        .filter(|e| {
            if let CanonicalEvent::Search { results_count, .. } = e {
                *results_count > 0
            } else {
                true
            }
        })
        .collect();

    // Phase 2: Deduplicate consecutive identical ToolCalls (keep last)
    let mut deduped: Vec<&CanonicalEvent> = Vec::with_capacity(no_dead_ends.len());
    for (i, event) in no_dead_ends.iter().enumerate() {
        let dominated_by_next = if i + 1 < no_dead_ends.len() {
            is_duplicate_tool_call(event, no_dead_ends[i + 1])
        } else {
            false
        };
        if !dominated_by_next {
            deduped.push(event);
        }
    }

    // Phase 3: Keep only the last FileEdit per path
    // Build a set of paths that have later edits
    let mut last_edit_index: std::collections::HashMap<&str, usize> =
        std::collections::HashMap::new();
    for (i, event) in deduped.iter().enumerate() {
        if let CanonicalEvent::FileEdit { path, .. } = event {
            last_edit_index.insert(path.as_str(), i);
        }
    }

    let mut after_edit_dedup: Vec<&CanonicalEvent> = Vec::with_capacity(deduped.len());
    for (i, event) in deduped.iter().enumerate() {
        if let CanonicalEvent::FileEdit { path, .. } = event {
            // Only keep if this is the last edit for this path
            if last_edit_index.get(path.as_str()) == Some(&i) {
                after_edit_dedup.push(event);
            }
            // Skip earlier edits to the same path
        } else {
            after_edit_dedup.push(event);
        }
    }

    // Phase 4: Collapse consecutive Think events (keep last of each run)
    let mut i = 0;
    while i < after_edit_dedup.len() {
        if matches!(after_edit_dedup[i], CanonicalEvent::Think { .. }) {
            // Find the end of the consecutive Think run
            let mut end = i + 1;
            while end < after_edit_dedup.len()
                && matches!(after_edit_dedup[end], CanonicalEvent::Think { .. })
            {
                end += 1;
            }
            // Keep only the last Think in the run
            result.push(after_edit_dedup[end - 1].clone());
            i = end;
        } else {
            result.push(after_edit_dedup[i].clone());
            i += 1;
        }
    }

    result
}

/// Check if two events are duplicate ToolCalls (same tool and args).
fn is_duplicate_tool_call(a: &CanonicalEvent, b: &CanonicalEvent) -> bool {
    match (a, b) {
        (
            CanonicalEvent::ToolCall {
                tool: tool_a,
                args: args_a,
                ..
            },
            CanonicalEvent::ToolCall {
                tool: tool_b,
                args: args_b,
                ..
            },
        ) => tool_a == tool_b && args_a == args_b,
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn removes_zero_result_searches() {
        let events = vec![
            CanonicalEvent::Search {
                query: "nonexistent".into(),
                results_count: 0,
                selected: None,
            },
            CanonicalEvent::Search {
                query: "found_it".into(),
                results_count: 3,
                selected: Some("file.rs".into()),
            },
        ];
        let result = eliminate(&events);
        assert_eq!(result.len(), 1);
        match &result[0] {
            CanonicalEvent::Search { query, .. } => assert_eq!(query, "found_it"),
            other => panic!("Expected Search, got {other:?}"),
        }
    }

    #[test]
    fn deduplicates_consecutive_tool_calls() {
        let events = vec![
            CanonicalEvent::ToolCall {
                tool: "Bash".into(),
                args: json!({"command": "cargo test"}),
                result: json!({"error": "failed"}),
                duration_ms: 100,
            },
            CanonicalEvent::ToolCall {
                tool: "Bash".into(),
                args: json!({"command": "cargo test"}),
                result: json!({"output": "ok"}),
                duration_ms: 200,
            },
        ];
        let result = eliminate(&events);
        assert_eq!(result.len(), 1);
        // Should keep the second (successful) one
        match &result[0] {
            CanonicalEvent::ToolCall { duration_ms, .. } => assert_eq!(*duration_ms, 200),
            other => panic!("Expected ToolCall, got {other:?}"),
        }
    }

    #[test]
    fn keeps_last_file_edit_per_path() {
        let events = vec![
            CanonicalEvent::FileEdit {
                path: "src/lib.rs".into(),
                before: "v1".into(),
                after: "v2".into(),
            },
            CanonicalEvent::Think {
                content: "hmm".into(),
                duration_ms: 10,
            },
            CanonicalEvent::FileEdit {
                path: "src/lib.rs".into(),
                before: "v2".into(),
                after: "v3".into(),
            },
        ];
        let result = eliminate(&events);
        // Should have Think + last FileEdit
        assert_eq!(result.len(), 2);
        match &result[1] {
            CanonicalEvent::FileEdit { after, .. } => assert_eq!(after, "v3"),
            other => panic!("Expected FileEdit, got {other:?}"),
        }
    }

    #[test]
    fn collapses_consecutive_thinks() {
        let events = vec![
            CanonicalEvent::Think {
                content: "first thought".into(),
                duration_ms: 10,
            },
            CanonicalEvent::Think {
                content: "second thought".into(),
                duration_ms: 20,
            },
            CanonicalEvent::Think {
                content: "final thought".into(),
                duration_ms: 30,
            },
            CanonicalEvent::ToolCall {
                tool: "Bash".into(),
                args: json!({}),
                result: json!(null),
                duration_ms: 5,
            },
        ];
        let result = eliminate(&events);
        assert_eq!(result.len(), 2);
        match &result[0] {
            CanonicalEvent::Think { content, .. } => assert_eq!(content, "final thought"),
            other => panic!("Expected Think, got {other:?}"),
        }
    }

    #[test]
    fn empty_input() {
        assert!(eliminate(&[]).is_empty());
    }

    #[test]
    fn preserves_different_file_paths() {
        let events = vec![
            CanonicalEvent::FileEdit {
                path: "a.rs".into(),
                before: "".into(),
                after: "a".into(),
            },
            CanonicalEvent::FileEdit {
                path: "b.rs".into(),
                before: "".into(),
                after: "b".into(),
            },
        ];
        let result = eliminate(&events);
        assert_eq!(result.len(), 2);
    }

    #[test]
    fn non_consecutive_duplicate_tools_kept() {
        let events = vec![
            CanonicalEvent::ToolCall {
                tool: "Bash".into(),
                args: json!({"command": "ls"}),
                result: json!("ok"),
                duration_ms: 10,
            },
            CanonicalEvent::Think {
                content: "interlude".into(),
                duration_ms: 5,
            },
            CanonicalEvent::ToolCall {
                tool: "Bash".into(),
                args: json!({"command": "ls"}),
                result: json!("ok"),
                duration_ms: 10,
            },
        ];
        let result = eliminate(&events);
        // Not consecutive -> both kept
        assert_eq!(result.len(), 3);
    }
}
