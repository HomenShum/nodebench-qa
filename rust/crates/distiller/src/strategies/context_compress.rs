//! Context compression strategy.
//!
//! Reduces token cost by compressing verbose Think events:
//! - Think blocks > 500 chars -> truncate to first 200 + "..." + last 100
//! - Sequential Think blocks -> merge into one
//! - Think blocks that just summarize prior steps -> remove

use benchpress_workflow::CanonicalEvent;

/// Maximum length for a Think block before it gets truncated.
const MAX_THINK_LEN: usize = 500;

/// Characters to keep from the beginning when truncating.
const KEEP_HEAD: usize = 200;

/// Characters to keep from the end when truncating.
const KEEP_TAIL: usize = 100;

/// Phrases that indicate a Think block is just summarizing prior steps.
const SUMMARY_INDICATORS: &[&str] = &[
    "to summarize",
    "in summary",
    "so far i have",
    "so far we have",
    "let me recap",
    "to recap",
    "i've already",
    "i have already",
    "as mentioned above",
    "as i said",
    "as noted earlier",
    "steps completed",
    "what i did",
    "what we did",
];

/// Compress Think events in the event stream to reduce token cost.
pub fn compress(events: &[CanonicalEvent]) -> Vec<CanonicalEvent> {
    if events.is_empty() {
        return Vec::new();
    }

    let mut result: Vec<CanonicalEvent> = Vec::with_capacity(events.len());

    // Phase 1: Remove summary-only Think blocks
    let non_summary: Vec<CanonicalEvent> = events
        .iter()
        .filter(|e| {
            if let CanonicalEvent::Think { content, .. } = e {
                !is_summary_only(content)
            } else {
                true
            }
        })
        .cloned()
        .collect();

    // Phase 2: Merge consecutive Think blocks
    let mut i = 0;
    while i < non_summary.len() {
        if let CanonicalEvent::Think {
            content,
            duration_ms,
        } = &non_summary[i]
        {
            let mut merged_content = content.clone();
            let mut merged_duration = *duration_ms;
            let mut end = i + 1;

            while end < non_summary.len() {
                if let CanonicalEvent::Think {
                    content: next_content,
                    duration_ms: next_duration,
                } = &non_summary[end]
                {
                    merged_content.push('\n');
                    merged_content.push_str(next_content);
                    merged_duration += next_duration;
                    end += 1;
                } else {
                    break;
                }
            }

            // Phase 3: Truncate if too long
            let compressed = truncate_if_needed(&merged_content);
            result.push(CanonicalEvent::Think {
                content: compressed,
                duration_ms: merged_duration,
            });
            i = end;
        } else {
            result.push(non_summary[i].clone());
            i += 1;
        }
    }

    result
}

/// Truncate a string to `KEEP_HEAD + "..." + KEEP_TAIL` if it exceeds `MAX_THINK_LEN`.
fn truncate_if_needed(content: &str) -> String {
    if content.len() <= MAX_THINK_LEN {
        return content.to_string();
    }

    // Find safe char boundaries
    let head_end = find_char_boundary(content, KEEP_HEAD);
    let tail_start = find_char_boundary_reverse(content, KEEP_TAIL);

    if tail_start <= head_end {
        // Overlap — just take the head
        let end = find_char_boundary(content, MAX_THINK_LEN);
        return format!("{}...", &content[..end]);
    }

    format!("{}...{}", &content[..head_end], &content[tail_start..])
}

/// Find the nearest char boundary at or before `target` byte offset.
fn find_char_boundary(s: &str, target: usize) -> usize {
    if target >= s.len() {
        return s.len();
    }
    let mut pos = target;
    while pos > 0 && !s.is_char_boundary(pos) {
        pos -= 1;
    }
    pos
}

/// Find the byte offset that is `keep` bytes from the end, on a char boundary.
fn find_char_boundary_reverse(s: &str, keep: usize) -> usize {
    if keep >= s.len() {
        return 0;
    }
    let mut pos = s.len() - keep;
    while pos < s.len() && !s.is_char_boundary(pos) {
        pos += 1;
    }
    pos
}

/// Check if a Think block is purely summarizing prior steps.
fn is_summary_only(content: &str) -> bool {
    let lower = content.to_lowercase();
    SUMMARY_INDICATORS
        .iter()
        .any(|indicator| lower.contains(indicator))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn merges_consecutive_thinks() {
        let events = vec![
            CanonicalEvent::Think {
                content: "thought 1".into(),
                duration_ms: 10,
            },
            CanonicalEvent::Think {
                content: "thought 2".into(),
                duration_ms: 20,
            },
            CanonicalEvent::ToolCall {
                tool: "Bash".into(),
                args: json!({}),
                result: json!(null),
                duration_ms: 5,
            },
        ];
        let result = compress(&events);
        assert_eq!(result.len(), 2);
        match &result[0] {
            CanonicalEvent::Think {
                content,
                duration_ms,
            } => {
                assert!(content.contains("thought 1"));
                assert!(content.contains("thought 2"));
                assert_eq!(*duration_ms, 30);
            }
            other => panic!("Expected Think, got {other:?}"),
        }
    }

    #[test]
    fn truncates_long_thinks() {
        let long_content = "a".repeat(1000);
        let events = vec![CanonicalEvent::Think {
            content: long_content,
            duration_ms: 100,
        }];
        let result = compress(&events);
        assert_eq!(result.len(), 1);
        match &result[0] {
            CanonicalEvent::Think { content, .. } => {
                assert!(content.len() < 1000);
                assert!(content.contains("..."));
            }
            other => panic!("Expected Think, got {other:?}"),
        }
    }

    #[test]
    fn removes_summary_thinks() {
        let events = vec![
            CanonicalEvent::Think {
                content: "Let me recap what I've done so far".into(),
                duration_ms: 10,
            },
            CanonicalEvent::Think {
                content: "Now I need to implement the parser".into(),
                duration_ms: 20,
            },
        ];
        let result = compress(&events);
        assert_eq!(result.len(), 1);
        match &result[0] {
            CanonicalEvent::Think { content, .. } => {
                assert!(content.contains("implement the parser"));
            }
            other => panic!("Expected Think, got {other:?}"),
        }
    }

    #[test]
    fn preserves_non_think_events() {
        let events = vec![
            CanonicalEvent::FileCreate {
                path: "test.rs".into(),
                content: "code".into(),
            },
            CanonicalEvent::Assert {
                condition: "compiles".into(),
                passed: true,
                evidence: "ok".into(),
            },
        ];
        let result = compress(&events);
        assert_eq!(result.len(), 2);
    }

    #[test]
    fn short_think_not_truncated() {
        let events = vec![CanonicalEvent::Think {
            content: "short".into(),
            duration_ms: 5,
        }];
        let result = compress(&events);
        match &result[0] {
            CanonicalEvent::Think { content, .. } => assert_eq!(content, "short"),
            other => panic!("Expected Think, got {other:?}"),
        }
    }

    #[test]
    fn empty_input() {
        assert!(compress(&[]).is_empty());
    }

    #[test]
    fn multiple_summary_thinks_all_removed() {
        let events = vec![
            CanonicalEvent::Think {
                content: "To summarize the work done".into(),
                duration_ms: 10,
            },
            CanonicalEvent::Think {
                content: "In summary, I have already completed everything".into(),
                duration_ms: 10,
            },
        ];
        let result = compress(&events);
        assert!(result.is_empty());
    }
}
