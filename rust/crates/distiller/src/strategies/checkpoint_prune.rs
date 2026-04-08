//! Checkpoint extraction strategy.
//!
//! Extracts verification checkpoints from the event stream:
//! - Assert events -> automatic checkpoints
//! - FileCreate/FileEdit -> checkpoint after (verify file exists/matches)
//! - ToolCall with side effects (Bash commands) -> checkpoint after

use benchpress_workflow::CanonicalEvent;
use serde::{Deserialize, Serialize};

/// A verification checkpoint that can be used during replay to ensure
/// the replayed workflow is on track.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Checkpoint {
    /// Event index this checkpoint should be verified after.
    pub after_event: usize,
    /// Human-readable description of what to verify.
    pub label: String,
    /// Expected state description or hash.
    pub expected_state: String,
    /// Optional shell command or function to run for verification.
    pub verification_fn: Option<String>,
}

/// Bash subcommands that have side effects and warrant checkpoints.
const SIDE_EFFECT_COMMANDS: &[&str] = &[
    "npm install",
    "yarn add",
    "pip install",
    "cargo build",
    "cargo test",
    "make",
    "cmake",
    "docker",
    "git commit",
    "git push",
    "git checkout",
    "git merge",
    "mkdir",
    "rm ",
    "mv ",
    "cp ",
    "chmod",
    "chown",
    "apt ",
    "brew ",
    "npx ",
];

/// Extract checkpoints from the event stream.
pub fn extract(events: &[CanonicalEvent]) -> Vec<Checkpoint> {
    let mut checkpoints = Vec::new();

    for (i, event) in events.iter().enumerate() {
        match event {
            // Assert events are natural checkpoints
            CanonicalEvent::Assert {
                condition,
                passed,
                evidence,
            } => {
                checkpoints.push(Checkpoint {
                    after_event: i,
                    label: format!("Assert: {condition}"),
                    expected_state: if *passed {
                        format!("PASS: {evidence}")
                    } else {
                        format!("FAIL: {evidence}")
                    },
                    verification_fn: None,
                });
            }

            // Explicit Checkpoint events pass through
            CanonicalEvent::Checkpoint { label, state_hash } => {
                checkpoints.push(Checkpoint {
                    after_event: i,
                    label: label.clone(),
                    expected_state: state_hash.clone(),
                    verification_fn: None,
                });
            }

            // FileCreate -> verify file exists with expected content
            CanonicalEvent::FileCreate { path, content } => {
                let content_preview = if content.len() > 50 {
                    format!("{}...", &content[..50])
                } else {
                    content.clone()
                };
                checkpoints.push(Checkpoint {
                    after_event: i,
                    label: format!("File created: {path}"),
                    expected_state: format!("file exists with content starting: {content_preview}"),
                    verification_fn: Some(format!("test -f '{path}'")),
                });
            }

            // FileEdit -> verify file was modified
            CanonicalEvent::FileEdit { path, after, .. } => {
                let after_preview = if after.len() > 50 {
                    format!("{}...", &after[..50])
                } else {
                    after.clone()
                };
                checkpoints.push(Checkpoint {
                    after_event: i,
                    label: format!("File edited: {path}"),
                    expected_state: format!("file contains: {after_preview}"),
                    verification_fn: Some(format!("grep -q '{}' '{path}'", escape_for_grep(&after_preview))),
                });
            }

            // ToolCall with side effects -> verify command succeeded
            CanonicalEvent::ToolCall { tool, args, .. } => {
                if tool == "Bash" || tool == "bash" {
                    if let Some(cmd) = args
                        .get("command")
                        .and_then(|c| c.as_str())
                    {
                        if has_side_effects(cmd) {
                            checkpoints.push(Checkpoint {
                                after_event: i,
                                label: format!("Side-effect command: {}", truncate_cmd(cmd)),
                                expected_state: "command completed successfully".into(),
                                verification_fn: infer_verification(cmd),
                            });
                        }
                    }
                }
            }

            _ => {}
        }
    }

    checkpoints
}

/// Check if a bash command likely has side effects.
fn has_side_effects(cmd: &str) -> bool {
    let lower = cmd.to_lowercase();
    SIDE_EFFECT_COMMANDS.iter().any(|prefix| lower.contains(prefix))
}

/// Infer a verification command for a side-effect bash command.
fn infer_verification(cmd: &str) -> Option<String> {
    let lower = cmd.to_lowercase();

    if lower.contains("cargo build") {
        return Some("test -f target/debug/*.d || test -f target/release/*.d".into());
    }
    if lower.contains("cargo test") {
        return Some("cargo test --no-run 2>/dev/null".into());
    }
    if lower.contains("npm install") || lower.contains("yarn add") {
        return Some("test -d node_modules".into());
    }
    if lower.contains("pip install") {
        return Some("pip check 2>/dev/null".into());
    }
    if lower.contains("git commit") {
        return Some("git log -1 --oneline".into());
    }
    if lower.starts_with("mkdir") {
        // Extract the directory path
        let parts: Vec<&str> = cmd.split_whitespace().collect();
        if let Some(dir) = parts.last() {
            return Some(format!("test -d '{dir}'"));
        }
    }

    None
}

/// Truncate a command for display in labels.
fn truncate_cmd(cmd: &str) -> String {
    if cmd.len() > 60 {
        format!("{}...", &cmd[..57])
    } else {
        cmd.to_string()
    }
}

/// Escape single quotes for use inside grep patterns.
fn escape_for_grep(s: &str) -> String {
    s.replace('\'', "'\\''")
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn extracts_assert_checkpoints() {
        let events = vec![CanonicalEvent::Assert {
            condition: "compiles".into(),
            passed: true,
            evidence: "cargo check OK".into(),
        }];
        let checkpoints = extract(&events);
        assert_eq!(checkpoints.len(), 1);
        assert_eq!(checkpoints[0].after_event, 0);
        assert!(checkpoints[0].label.contains("compiles"));
        assert!(checkpoints[0].expected_state.contains("PASS"));
    }

    #[test]
    fn extracts_file_create_checkpoints() {
        let events = vec![CanonicalEvent::FileCreate {
            path: "src/main.rs".into(),
            content: "fn main() {}".into(),
        }];
        let checkpoints = extract(&events);
        assert_eq!(checkpoints.len(), 1);
        assert!(checkpoints[0].label.contains("src/main.rs"));
        assert!(checkpoints[0].verification_fn.is_some());
    }

    #[test]
    fn extracts_file_edit_checkpoints() {
        let events = vec![CanonicalEvent::FileEdit {
            path: "lib.rs".into(),
            before: "old".into(),
            after: "new content".into(),
        }];
        let checkpoints = extract(&events);
        assert_eq!(checkpoints.len(), 1);
        assert!(checkpoints[0].label.contains("lib.rs"));
    }

    #[test]
    fn extracts_bash_side_effect_checkpoints() {
        let events = vec![CanonicalEvent::ToolCall {
            tool: "Bash".into(),
            args: json!({"command": "cargo build --release"}),
            result: json!({"output": "ok"}),
            duration_ms: 5000,
        }];
        let checkpoints = extract(&events);
        assert_eq!(checkpoints.len(), 1);
        assert!(checkpoints[0].label.contains("cargo build"));
        assert!(checkpoints[0].verification_fn.is_some());
    }

    #[test]
    fn skips_non_side_effect_bash() {
        let events = vec![CanonicalEvent::ToolCall {
            tool: "Bash".into(),
            args: json!({"command": "echo hello"}),
            result: json!("hello"),
            duration_ms: 10,
        }];
        let checkpoints = extract(&events);
        assert!(checkpoints.is_empty());
    }

    #[test]
    fn skips_non_bash_tools() {
        let events = vec![CanonicalEvent::ToolCall {
            tool: "Read".into(),
            args: json!({"path": "file.rs"}),
            result: json!("contents"),
            duration_ms: 10,
        }];
        let checkpoints = extract(&events);
        assert!(checkpoints.is_empty());
    }

    #[test]
    fn preserves_explicit_checkpoints() {
        let events = vec![CanonicalEvent::Checkpoint {
            label: "after-refactor".into(),
            state_hash: "abc123".into(),
        }];
        let checkpoints = extract(&events);
        assert_eq!(checkpoints.len(), 1);
        assert_eq!(checkpoints[0].label, "after-refactor");
        assert_eq!(checkpoints[0].expected_state, "abc123");
    }

    #[test]
    fn event_indices_are_correct() {
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
            CanonicalEvent::Assert {
                condition: "ok".into(),
                passed: true,
                evidence: "yes".into(),
            },
        ];
        let checkpoints = extract(&events);
        assert_eq!(checkpoints.len(), 2);
        assert_eq!(checkpoints[0].after_event, 1); // FileCreate
        assert_eq!(checkpoints[1].after_event, 3); // Assert
    }

    #[test]
    fn empty_input() {
        assert!(extract(&[]).is_empty());
    }
}
