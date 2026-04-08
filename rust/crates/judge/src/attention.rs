//! Context attention tracking — measures how closely the replay model
//! followed the expected workflow's event sequence.

use benchpress_workflow::CanonicalEvent;

use crate::diff::compare_events;
use crate::types::{AttentionEntry, AttentionMap, AttentionStatus};

/// Build an attention map from expected vs actual event streams.
///
/// For each expected event:
/// - If a matching actual event exists at the same position → Followed
/// - If a matching actual event exists at a different position → Followed (reordered)
/// - If no matching actual event exists anywhere → Skipped
/// - If the actual event at that position is a different variant → Diverged
pub fn build_attention_map(
    expected: &[CanonicalEvent],
    actual: &[CanonicalEvent],
) -> AttentionMap {
    let mut entries = Vec::with_capacity(expected.len());

    for (i, exp) in expected.iter().enumerate() {
        // Check same-position match first.
        if i < actual.len() && compare_events(exp, &actual[i]).is_none() {
            entries.push(AttentionEntry {
                event_index: i,
                status: AttentionStatus::Followed,
                detail: format!("Matched at position {}", i),
            });
            continue;
        }

        // Check reordered match — scan all of actual for a match.
        let found_elsewhere = actual
            .iter()
            .enumerate()
            .any(|(j, act)| j != i && compare_events(exp, act).is_none());

        if found_elsewhere {
            entries.push(AttentionEntry {
                event_index: i,
                status: AttentionStatus::Followed,
                detail: format!(
                    "Matched at different position (reordered from expected position {})",
                    i,
                ),
            });
            continue;
        }

        // No match found. Determine if it was a variant-type divergence or a skip.
        if i < actual.len() {
            // There IS an actual event at this position, but it doesn't match.
            entries.push(AttentionEntry {
                event_index: i,
                status: AttentionStatus::Diverged,
                detail: format!(
                    "Expected {} but got different event at position {}",
                    event_variant_name(exp),
                    i,
                ),
            });
        } else {
            // No actual event at this position — the replay was shorter.
            entries.push(AttentionEntry {
                event_index: i,
                status: AttentionStatus::Skipped,
                detail: format!(
                    "Expected {} at position {} but replay ended before reaching it",
                    event_variant_name(exp),
                    i,
                ),
            });
        }
    }

    AttentionMap { entries }
}

/// Calculate attention score (0.0 - 100.0): what percentage of expected events
/// were followed (either in-order or reordered).
///
/// Returns 100.0 for a perfect replay, 0.0 if nothing was followed.
pub fn attention_score(map: &AttentionMap) -> f64 {
    if map.entries.is_empty() {
        return 100.0; // vacuously perfect
    }

    let followed = map
        .entries
        .iter()
        .filter(|e| matches!(e.status, AttentionStatus::Followed))
        .count();

    (followed as f64 / map.entries.len() as f64) * 100.0
}

/// Get the variant name of a CanonicalEvent for display.
fn event_variant_name(event: &CanonicalEvent) -> &'static str {
    match event {
        CanonicalEvent::Think { .. } => "Think",
        CanonicalEvent::ToolCall { .. } => "ToolCall",
        CanonicalEvent::Decision { .. } => "Decision",
        CanonicalEvent::FileEdit { .. } => "FileEdit",
        CanonicalEvent::FileCreate { .. } => "FileCreate",
        CanonicalEvent::Search { .. } => "Search",
        CanonicalEvent::Navigate { .. } => "Navigate",
        CanonicalEvent::Assert { .. } => "Assert",
        CanonicalEvent::Checkpoint { .. } => "Checkpoint",
        CanonicalEvent::Nudge { .. } => "Nudge",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tool_call(tool: &str) -> CanonicalEvent {
        CanonicalEvent::ToolCall {
            tool: tool.into(),
            args: serde_json::json!({}),
            result: serde_json::json!(null),
            duration_ms: 100,
        }
    }

    fn think(content: &str) -> CanonicalEvent {
        CanonicalEvent::Think {
            content: content.into(),
            duration_ms: 50,
        }
    }

    #[test]
    fn perfect_replay_is_100_percent() {
        let events = vec![think("plan"), tool_call("Read"), tool_call("Edit")];
        let map = build_attention_map(&events, &events);
        assert_eq!(attention_score(&map), 100.0);
        assert!(map.entries.iter().all(|e| e.status == AttentionStatus::Followed));
    }

    #[test]
    fn empty_expected_is_vacuously_perfect() {
        let map = build_attention_map(&[], &[tool_call("Read")]);
        assert_eq!(attention_score(&map), 100.0);
    }

    #[test]
    fn completely_different_is_zero() {
        let expected = vec![tool_call("Read"), tool_call("Edit")];
        let actual = vec![tool_call("Write"), tool_call("Bash")];
        let map = build_attention_map(&expected, &actual);
        assert_eq!(attention_score(&map), 0.0);
        assert!(map.entries.iter().all(|e| e.status == AttentionStatus::Diverged));
    }

    #[test]
    fn shorter_replay_marks_missing_as_skipped() {
        let expected = vec![tool_call("Read"), tool_call("Edit"), tool_call("Bash")];
        let actual = vec![tool_call("Read")];
        let map = build_attention_map(&expected, &actual);
        assert_eq!(map.entries[0].status, AttentionStatus::Followed);
        assert_eq!(map.entries[2].status, AttentionStatus::Skipped);
    }

    #[test]
    fn reordered_events_still_count_as_followed() {
        let expected = vec![tool_call("Read"), tool_call("Edit")];
        let actual = vec![tool_call("Edit"), tool_call("Read")];
        let map = build_attention_map(&expected, &actual);
        // Both should be Followed (found at different position)
        assert!(map.entries.iter().all(|e| e.status == AttentionStatus::Followed));
        assert_eq!(attention_score(&map), 100.0);
    }
}
