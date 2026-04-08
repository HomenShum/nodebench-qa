//! Event diff analyzer — compares expected vs actual canonical event streams.
//!
//! Uses a variant-aware alignment algorithm to produce per-event divergences
//! with severity classification and human-readable suggestions.

use benchpress_workflow::CanonicalEvent;

use crate::types::{Divergence, DivergenceSeverity};

/// Compare two canonical event streams and return all divergences.
///
/// Algorithm:
/// 1. Walk both streams in parallel using a two-pointer approach.
/// 2. For each position, compare events using [`compare_events`].
/// 3. If the expected event is missing from actual, scan ahead in actual
///    to find it (reordered) — if found, emit Minor divergences for the
///    extras; if not found, emit Major for the skip.
/// 4. Extra events in actual (exploration) are Minor.
pub fn diff_events(expected: &[CanonicalEvent], actual: &[CanonicalEvent]) -> Vec<Divergence> {
    let mut divergences = Vec::new();
    let mut exp_idx = 0;
    let mut act_idx = 0;

    while exp_idx < expected.len() && act_idx < actual.len() {
        let exp = &expected[exp_idx];
        let act = &actual[act_idx];

        match compare_events(exp, act) {
            None => {
                // Exact or close-enough match — advance both
                exp_idx += 1;
                act_idx += 1;
            }
            Some(div) => {
                // Events don't match. Try to find the expected event later in actual
                // (handles reordering).
                if let Some(offset) = find_matching_event(exp, &actual[act_idx..], 5) {
                    // The expected event exists ahead — the intervening actual events are
                    // extra exploration (Minor).
                    for extra_i in 0..offset {
                        let extra_act = &actual[act_idx + extra_i];
                        divergences.push(Divergence {
                            event_index: exp_idx,
                            expected: exp.clone(),
                            actual: extra_act.clone(),
                            severity: DivergenceSeverity::Minor,
                            suggestion: format!(
                                "Extra exploration step: {}. This is acceptable but adds latency.",
                                event_summary(extra_act),
                            ),
                        });
                    }
                    act_idx += offset + 1; // skip to after the match
                    exp_idx += 1;
                } else {
                    // Expected event not found ahead — record the divergence at its
                    // severity and advance both pointers.
                    divergences.push(Divergence {
                        event_index: exp_idx,
                        expected: exp.clone(),
                        actual: act.clone(),
                        severity: div.severity,
                        suggestion: div.suggestion,
                    });
                    exp_idx += 1;
                    act_idx += 1;
                }
            }
        }
    }

    // Remaining expected events that were never matched → Major (skipped steps).
    for i in exp_idx..expected.len() {
        let exp = &expected[i];
        divergences.push(Divergence {
            event_index: i,
            expected: exp.clone(),
            actual: CanonicalEvent::Think {
                content: "<missing>".into(),
                duration_ms: 0,
            },
            severity: DivergenceSeverity::Major,
            suggestion: format!(
                "Expected event was skipped entirely: {}. The replay model missed this step.",
                event_summary(exp),
            ),
        });
    }

    // Extra actual events beyond expected are Minor (exploration is ok).
    // We don't emit divergences for these since they have no expected counterpart,
    // but we note them if there are many.
    let extra_actual = actual.len().saturating_sub(act_idx);
    if extra_actual > expected.len() / 2 && expected.len() > 2 {
        // Too many extra steps — the replay went off-script significantly.
        // We flag the first extra as Major to surface this.
        if act_idx < actual.len() {
            divergences.push(Divergence {
                event_index: expected.len(),
                expected: CanonicalEvent::Think {
                    content: "<end of expected>".into(),
                    duration_ms: 0,
                },
                actual: actual[act_idx].clone(),
                severity: DivergenceSeverity::Major,
                suggestion: format!(
                    "Replay produced {} extra events beyond the expected workflow. \
                     This suggests significant divergence from the intended path.",
                    extra_actual,
                ),
            });
        }
    }

    divergences
}

/// Compare two individual events. Returns `None` if they match (same variant
/// and key fields), or `Some(Divergence)` with severity + suggestion.
pub fn compare_events(expected: &CanonicalEvent, actual: &CanonicalEvent) -> Option<Divergence> {
    use CanonicalEvent::*;

    match (expected, actual) {
        // Think vs Think — always Minor at worst; thinking differently is fine.
        (Think { .. }, Think { .. }) => None,

        // ToolCall: same tool = Minor if args differ; different tool = Critical.
        (
            ToolCall {
                tool: exp_tool,
                args: exp_args,
                ..
            },
            ToolCall {
                tool: act_tool,
                args: act_args,
                ..
            },
        ) => {
            if exp_tool == act_tool {
                if exp_args == act_args {
                    None
                } else {
                    Some(Divergence {
                        event_index: 0, // caller will set the real index
                        expected: expected.clone(),
                        actual: actual.clone(),
                        severity: DivergenceSeverity::Minor,
                        suggestion: format!(
                            "Tool '{}' called with different arguments. Expected args: {}, got: {}.",
                            exp_tool,
                            truncate_json(exp_args, 80),
                            truncate_json(act_args, 80),
                        ),
                    })
                }
            } else {
                Some(Divergence {
                    event_index: 0,
                    expected: expected.clone(),
                    actual: actual.clone(),
                    severity: DivergenceSeverity::Critical,
                    suggestion: format!(
                        "Expected tool call to '{}' but got '{}'. Consider using {} for this step.",
                        exp_tool, act_tool, exp_tool,
                    ),
                })
            }
        }

        // FileEdit: same path = compare content; different path = Major.
        (
            FileEdit {
                path: exp_path,
                after: exp_after,
                ..
            },
            FileEdit {
                path: act_path,
                after: act_after,
                ..
            },
        ) => {
            if exp_path == act_path {
                if exp_after == act_after {
                    None
                } else {
                    Some(Divergence {
                        event_index: 0,
                        expected: expected.clone(),
                        actual: actual.clone(),
                        severity: DivergenceSeverity::Minor,
                        suggestion: format!(
                            "File '{}' edited differently. The result content diverges from expected.",
                            exp_path,
                        ),
                    })
                }
            } else {
                Some(Divergence {
                    event_index: 0,
                    expected: expected.clone(),
                    actual: actual.clone(),
                    severity: DivergenceSeverity::Major,
                    suggestion: format!(
                        "Expected edit to '{}' but got edit to '{}'. Wrong file targeted.",
                        exp_path, act_path,
                    ),
                })
            }
        }

        // FileCreate: same path = compare content; different path = Major.
        (
            FileCreate {
                path: exp_path,
                content: exp_content,
            },
            FileCreate {
                path: act_path,
                content: act_content,
            },
        ) => {
            if exp_path == act_path {
                if exp_content == act_content {
                    None
                } else {
                    Some(Divergence {
                        event_index: 0,
                        expected: expected.clone(),
                        actual: actual.clone(),
                        severity: DivergenceSeverity::Minor,
                        suggestion: format!(
                            "File '{}' created with different content than expected.",
                            exp_path,
                        ),
                    })
                }
            } else {
                Some(Divergence {
                    event_index: 0,
                    expected: expected.clone(),
                    actual: actual.clone(),
                    severity: DivergenceSeverity::Major,
                    suggestion: format!(
                        "Expected to create '{}' but created '{}' instead.",
                        exp_path, act_path,
                    ),
                })
            }
        }

        // Search: different query = Minor; search is exploratory.
        (Search { .. }, Search { .. }) => None,

        // Navigate: different target = Major.
        (Navigate { to: exp_to, .. }, Navigate { to: act_to, .. }) => {
            if exp_to == act_to {
                None
            } else {
                Some(Divergence {
                    event_index: 0,
                    expected: expected.clone(),
                    actual: actual.clone(),
                    severity: DivergenceSeverity::Major,
                    suggestion: format!(
                        "Expected navigation to '{}' but went to '{}' instead.",
                        exp_to, act_to,
                    ),
                })
            }
        }

        // Assert: different result = Critical (correctness gate).
        (
            Assert {
                passed: exp_passed,
                condition: exp_cond,
                ..
            },
            Assert {
                passed: act_passed, ..
            },
        ) => {
            if exp_passed == act_passed {
                None
            } else {
                Some(Divergence {
                    event_index: 0,
                    expected: expected.clone(),
                    actual: actual.clone(),
                    severity: DivergenceSeverity::Critical,
                    suggestion: format!(
                        "Assertion '{}' expected {} but got {}. This is a correctness failure.",
                        exp_cond,
                        if *exp_passed { "PASS" } else { "FAIL" },
                        if *act_passed { "PASS" } else { "FAIL" },
                    ),
                })
            }
        }

        // Checkpoint: different state hash = Major.
        (
            Checkpoint {
                label: exp_label,
                state_hash: exp_hash,
            },
            Checkpoint {
                state_hash: act_hash,
                ..
            },
        ) => {
            if exp_hash == act_hash {
                None
            } else {
                Some(Divergence {
                    event_index: 0,
                    expected: expected.clone(),
                    actual: actual.clone(),
                    severity: DivergenceSeverity::Major,
                    suggestion: format!(
                        "Checkpoint '{}' state drifted. Expected hash {}, got {}.",
                        exp_label,
                        &exp_hash[..exp_hash.len().min(12)],
                        &act_hash[..act_hash.len().min(12)],
                    ),
                })
            }
        }

        // Decision: different choice = Major.
        (
            Decision {
                choice: exp_choice,
                question: exp_q,
                ..
            },
            Decision {
                choice: act_choice, ..
            },
        ) => {
            if exp_choice == act_choice {
                None
            } else {
                Some(Divergence {
                    event_index: 0,
                    expected: expected.clone(),
                    actual: actual.clone(),
                    severity: DivergenceSeverity::Major,
                    suggestion: format!(
                        "For decision '{}', expected choice '{}' but got '{}'.",
                        exp_q, exp_choice, act_choice,
                    ),
                })
            }
        }

        // Nudge events are meta — always match.
        (Nudge { .. }, Nudge { .. }) => None,

        // Completely different variant types → Critical.
        _ => Some(Divergence {
            event_index: 0,
            expected: expected.clone(),
            actual: actual.clone(),
            severity: DivergenceSeverity::Critical,
            suggestion: format!(
                "Expected {} but got {}. Completely different event type.",
                event_variant_name(expected),
                event_variant_name(actual),
            ),
        }),
    }
}

/// Scan ahead in `events` (up to `max_lookahead`) for an event matching `target`.
/// Returns the offset if found.
fn find_matching_event(
    target: &CanonicalEvent,
    events: &[CanonicalEvent],
    max_lookahead: usize,
) -> Option<usize> {
    let limit = events.len().min(max_lookahead);
    for i in 0..limit {
        if compare_events(target, &events[i]).is_none() {
            return Some(i);
        }
    }
    None
}

/// Human-readable one-line summary of an event.
fn event_summary(event: &CanonicalEvent) -> String {
    match event {
        CanonicalEvent::Think { content, .. } => {
            format!("Think: \"{}\"", truncate(content, 50))
        }
        CanonicalEvent::ToolCall { tool, .. } => format!("ToolCall: {}", tool),
        CanonicalEvent::Decision { question, choice, .. } => {
            format!("Decision: {} -> {}", truncate(question, 30), choice)
        }
        CanonicalEvent::FileEdit { path, .. } => format!("FileEdit: {}", path),
        CanonicalEvent::FileCreate { path, .. } => format!("FileCreate: {}", path),
        CanonicalEvent::Search { query, .. } => format!("Search: {}", truncate(query, 40)),
        CanonicalEvent::Navigate { to, .. } => format!("Navigate: {}", to),
        CanonicalEvent::Assert { condition, passed, .. } => {
            format!("Assert: {} ({})", truncate(condition, 40), if *passed { "pass" } else { "fail" })
        }
        CanonicalEvent::Checkpoint { label, .. } => format!("Checkpoint: {}", label),
        CanonicalEvent::Nudge { message, .. } => format!("Nudge: {}", truncate(message, 40)),
    }
}

/// Get the variant name of a CanonicalEvent for error messages.
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

/// Truncate a string to `max` characters, appending "..." if truncated.
fn truncate(s: &str, max: usize) -> String {
    if s.len() <= max {
        s.to_string()
    } else {
        format!("{}...", &s[..max])
    }
}

/// Truncate a serde_json::Value to a short string representation.
fn truncate_json(val: &serde_json::Value, max: usize) -> String {
    let s = val.to_string();
    truncate(&s, max)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tool_call(tool: &str, arg: &str) -> CanonicalEvent {
        CanonicalEvent::ToolCall {
            tool: tool.into(),
            args: serde_json::json!({ "arg": arg }),
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

    fn assert_event(cond: &str, passed: bool) -> CanonicalEvent {
        CanonicalEvent::Assert {
            condition: cond.into(),
            passed,
            evidence: "test".into(),
        }
    }

    #[test]
    fn identical_streams_produce_no_divergences() {
        let events = vec![
            think("planning"),
            tool_call("Read", "foo.rs"),
            tool_call("Edit", "foo.rs"),
        ];
        let divs = diff_events(&events, &events);
        assert!(divs.is_empty());
    }

    #[test]
    fn different_tool_is_critical() {
        let expected = vec![tool_call("Edit", "foo.rs")];
        let actual = vec![tool_call("Write", "foo.rs")];
        let divs = diff_events(&expected, &actual);
        assert_eq!(divs.len(), 1);
        assert_eq!(divs[0].severity, DivergenceSeverity::Critical);
    }

    #[test]
    fn same_tool_different_args_is_minor() {
        let expected = vec![tool_call("Read", "foo.rs")];
        let actual = vec![tool_call("Read", "bar.rs")];
        let divs = diff_events(&expected, &actual);
        assert_eq!(divs.len(), 1);
        assert_eq!(divs[0].severity, DivergenceSeverity::Minor);
    }

    #[test]
    fn missing_expected_events_are_major() {
        let expected = vec![
            tool_call("Read", "a"),
            tool_call("Edit", "b"),
            tool_call("Bash", "c"),
        ];
        let actual = vec![tool_call("Read", "a")];
        let divs = diff_events(&expected, &actual);
        // The last 2 expected events should be Major (skipped)
        assert!(divs.iter().any(|d| d.severity == DivergenceSeverity::Major));
    }

    #[test]
    fn assert_result_flip_is_critical() {
        let expected = vec![assert_event("tests pass", true)];
        let actual = vec![assert_event("tests pass", false)];
        let divs = diff_events(&expected, &actual);
        assert_eq!(divs.len(), 1);
        assert_eq!(divs[0].severity, DivergenceSeverity::Critical);
    }

    #[test]
    fn think_events_never_diverge() {
        let expected = vec![think("approach A")];
        let actual = vec![think("approach B entirely different")];
        let divs = diff_events(&expected, &actual);
        assert!(divs.is_empty());
    }
}
