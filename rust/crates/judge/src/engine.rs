//! Judge engine — the core enforcement loop.
//!
//! Manages judge sessions: tracks expected vs actual events as they arrive,
//! issues nudges on divergence, verifies checkpoints, and produces final verdicts.

use std::collections::HashMap;

use chrono::Utc;
use uuid::Uuid;

use benchpress_core::error::{Error, Result};
use benchpress_workflow::CanonicalEvent;

use crate::diff::compare_events;
use crate::types::{
    CheckpointResult, DivergenceSeverity, JudgeSession, Nudge, Verdict,
};

/// The judge engine holds all active sessions and drives the comparison loop.
pub struct JudgeEngine {
    sessions: HashMap<Uuid, JudgeSession>,
}

impl JudgeEngine {
    pub fn new() -> Self {
        Self {
            sessions: HashMap::new(),
        }
    }

    /// Start a new judge session for a workflow replay.
    ///
    /// `expected_events` is the canonical event stream from the captured workflow.
    /// `replay_model` identifies which model is being evaluated (e.g. "claude-haiku-4-5").
    ///
    /// Returns the session ID.
    pub fn start_session(
        &mut self,
        workflow_id: Uuid,
        expected_events: Vec<CanonicalEvent>,
        replay_model: &str,
    ) -> Uuid {
        let id = Uuid::new_v4();
        let session = JudgeSession {
            id,
            workflow_id,
            replay_model: replay_model.to_string(),
            events_expected: expected_events,
            events_actual: Vec::new(),
            checkpoints: Vec::new(),
            verdict: None,
            nudges: Vec::new(),
            started_at: Utc::now(),
            completed_at: None,
        };
        self.sessions.insert(id, session);
        id
    }

    /// Report an actual event during replay.
    ///
    /// Compares against the expected event at the current index.
    /// Returns `Some(Nudge)` if divergence warrants a correction hint.
    /// Returns `None` if the event matches or divergence is too minor to nudge.
    pub fn on_event(
        &mut self,
        session_id: Uuid,
        actual_event: CanonicalEvent,
    ) -> Result<Option<Nudge>> {
        let session = self
            .sessions
            .get_mut(&session_id)
            .ok_or_else(|| Error::NotFound(format!("Judge session {}", session_id)))?;

        if session.verdict.is_some() {
            return Err(Error::Internal(
                "Session already finalized — cannot accept more events".into(),
            ));
        }

        let current_index = session.events_actual.len();
        session.events_actual.push(actual_event.clone());

        // If we've gone beyond the expected stream, no comparison to make.
        let Some(expected_event) = session.events_expected.get(current_index) else {
            return Ok(None);
        };

        // Compare expected vs actual at this position.
        let Some(divergence) = compare_events(expected_event, &actual_event) else {
            // Perfect match — no nudge needed.
            return Ok(None);
        };

        match divergence.severity {
            DivergenceSeverity::Minor => {
                // Minor divergences are recorded but don't produce nudges.
                // The replay model is allowed some freedom.
                Ok(None)
            }
            DivergenceSeverity::Major => {
                let nudge = Nudge {
                    at_event: current_index,
                    message: divergence.suggestion.clone(),
                    accepted: false,
                    timestamp: Utc::now(),
                };
                session.nudges.push(nudge.clone());
                Ok(Some(nudge))
            }
            DivergenceSeverity::Critical => {
                let nudge = Nudge {
                    at_event: current_index,
                    message: format!(
                        "CRITICAL: {}. Continuing on this path will likely produce incorrect results.",
                        divergence.suggestion,
                    ),
                    accepted: false,
                    timestamp: Utc::now(),
                };
                session.nudges.push(nudge.clone());
                Ok(Some(nudge))
            }
        }
    }

    /// Check a checkpoint during replay.
    ///
    /// Finds the nth Checkpoint event in the expected stream, compares the
    /// `actual_state` hash against the expected `state_hash`.
    /// Returns pass/fail plus a drift score (0.0 = exact match, 1.0 = completely different).
    pub fn check_checkpoint(
        &mut self,
        session_id: Uuid,
        checkpoint_index: usize,
        actual_state: &str,
    ) -> Result<CheckpointResult> {
        let session = self
            .sessions
            .get_mut(&session_id)
            .ok_or_else(|| Error::NotFound(format!("Judge session {}", session_id)))?;

        // Find the nth Checkpoint event in expected.
        let checkpoints: Vec<(usize, &CanonicalEvent)> = session
            .events_expected
            .iter()
            .enumerate()
            .filter(|(_, e)| matches!(e, CanonicalEvent::Checkpoint { .. }))
            .collect();

        let Some(&(event_idx, checkpoint_event)) = checkpoints.get(checkpoint_index) else {
            return Err(Error::NotFound(format!(
                "Checkpoint index {} (only {} checkpoints in workflow)",
                checkpoint_index,
                checkpoints.len(),
            )));
        };

        let (expected_label, expected_hash) = match checkpoint_event {
            CanonicalEvent::Checkpoint { label, state_hash } => (label.clone(), state_hash.clone()),
            _ => unreachable!("filtered for Checkpoint variant"),
        };

        // Drift score: character-level similarity between expected and actual hash.
        let drift_score = compute_drift(&expected_hash, actual_state);
        let passed = drift_score < 0.3; // Allow up to 30% drift for a pass.

        let detail = if passed {
            format!(
                "Checkpoint '{}' (event {}) passed with drift {:.2}",
                expected_label, event_idx, drift_score,
            )
        } else {
            format!(
                "Checkpoint '{}' (event {}) FAILED — drift {:.2} exceeds threshold 0.30. \
                 Expected state hash prefix: {}, actual: {}",
                expected_label,
                event_idx,
                drift_score,
                &expected_hash[..expected_hash.len().min(12)],
                &actual_state[..actual_state.len().min(12)],
            )
        };

        let result = CheckpointResult {
            checkpoint_index,
            passed,
            drift_score,
            detail,
        };

        session.checkpoints.push(result.clone());
        Ok(result)
    }

    /// Finalize the session and produce a verdict.
    ///
    /// Scoring logic:
    /// - 0 divergences + all checkpoints pass → `Correct`
    /// - Only minor divergences + score > 0.8 → `Partial` with high score
    /// - Any critical divergence → `Failed`
    /// - Too many major divergences → `Escalate`
    pub fn finalize(&mut self, session_id: Uuid) -> Result<Verdict> {
        let session = self
            .sessions
            .get_mut(&session_id)
            .ok_or_else(|| Error::NotFound(format!("Judge session {}", session_id)))?;

        if session.verdict.is_some() {
            return Err(Error::Internal("Session already finalized".into()));
        }

        // Compute divergences across the full streams.
        let divergences = crate::diff::diff_events(
            &session.events_expected,
            &session.events_actual,
        );

        let critical_count = divergences
            .iter()
            .filter(|d| d.severity == DivergenceSeverity::Critical)
            .count();
        let major_count = divergences
            .iter()
            .filter(|d| d.severity == DivergenceSeverity::Major)
            .count();
        let minor_count = divergences
            .iter()
            .filter(|d| d.severity == DivergenceSeverity::Minor)
            .count();
        let total_divergences = divergences.len();

        let all_checkpoints_pass = session.checkpoints.iter().all(|c| c.passed);
        let expected_count = session.events_expected.len().max(1) as f64;

        // Score: 1.0 means perfect, decays with divergences weighted by severity.
        let penalty = (critical_count as f64 * 0.3)
            + (major_count as f64 * 0.15)
            + (minor_count as f64 * 0.03);
        let score = (1.0 - (penalty / expected_count)).clamp(0.0, 1.0);

        let verdict = if total_divergences == 0 && all_checkpoints_pass {
            Verdict::Correct
        } else if critical_count > 0 {
            Verdict::Failed {
                reason: format!(
                    "{} critical divergence(s) detected. The replay produced incorrect results.",
                    critical_count,
                ),
            }
        } else if major_count > expected_count as usize / 3 {
            Verdict::Escalate {
                reason: format!(
                    "{} major divergences out of {} expected events ({} minor). \
                     Score: {:.2}. Human review recommended.",
                    major_count,
                    session.events_expected.len(),
                    minor_count,
                    score,
                ),
            }
        } else {
            Verdict::Partial {
                score,
                divergences,
            }
        };

        session.verdict = Some(verdict.clone());
        session.completed_at = Some(Utc::now());
        Ok(verdict)
    }

    /// Get current session state (read-only).
    pub fn get_session(&self, session_id: Uuid) -> Option<&JudgeSession> {
        self.sessions.get(&session_id)
    }

    /// Get mutable session reference (for external nudge acceptance).
    pub fn get_session_mut(&mut self, session_id: Uuid) -> Option<&mut JudgeSession> {
        self.sessions.get_mut(&session_id)
    }

    /// Number of active sessions.
    pub fn session_count(&self) -> usize {
        self.sessions.len()
    }
}

impl Default for JudgeEngine {
    fn default() -> Self {
        Self::new()
    }
}

/// Compute drift score between two strings.
/// 0.0 = identical, 1.0 = completely different.
///
/// Uses byte-level comparison: counts matching bytes at each position,
/// penalizes length differences.
fn compute_drift(expected: &str, actual: &str) -> f64 {
    if expected == actual {
        return 0.0;
    }
    if expected.is_empty() && actual.is_empty() {
        return 0.0;
    }
    if expected.is_empty() || actual.is_empty() {
        return 1.0;
    }

    let exp_bytes = expected.as_bytes();
    let act_bytes = actual.as_bytes();
    let max_len = exp_bytes.len().max(act_bytes.len());
    let min_len = exp_bytes.len().min(act_bytes.len());

    let mut matching = 0usize;
    for i in 0..min_len {
        if exp_bytes[i] == act_bytes[i] {
            matching += 1;
        }
    }

    1.0 - (matching as f64 / max_len as f64)
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

    fn checkpoint(label: &str, hash: &str) -> CanonicalEvent {
        CanonicalEvent::Checkpoint {
            label: label.into(),
            state_hash: hash.into(),
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
    fn perfect_replay_produces_correct_verdict() {
        let mut engine = JudgeEngine::new();
        let wf_id = Uuid::new_v4();
        let events = vec![
            think("planning"),
            tool_call("Read", "foo.rs"),
            tool_call("Edit", "foo.rs"),
        ];

        let sid = engine.start_session(wf_id, events.clone(), "test-model");

        for event in &events {
            let nudge = engine.on_event(sid, event.clone()).unwrap();
            assert!(nudge.is_none());
        }

        let verdict = engine.finalize(sid).unwrap();
        assert!(matches!(verdict, Verdict::Correct));
    }

    #[test]
    fn critical_divergence_produces_failed_verdict() {
        let mut engine = JudgeEngine::new();
        let wf_id = Uuid::new_v4();
        let expected = vec![assert_event("tests pass", true)];
        let actual = vec![assert_event("tests pass", false)];

        let sid = engine.start_session(wf_id, expected, "test-model");
        let nudge = engine.on_event(sid, actual[0].clone()).unwrap();
        assert!(nudge.is_some()); // Critical should produce a nudge.

        let verdict = engine.finalize(sid).unwrap();
        assert!(matches!(verdict, Verdict::Failed { .. }));
    }

    #[test]
    fn minor_divergence_produces_partial_verdict() {
        let mut engine = JudgeEngine::new();
        let wf_id = Uuid::new_v4();
        let expected = vec![
            tool_call("Read", "foo.rs"),
            tool_call("Edit", "foo.rs"),
        ];
        let actual = vec![
            tool_call("Read", "bar.rs"), // same tool, different arg = Minor
            tool_call("Edit", "foo.rs"),
        ];

        let sid = engine.start_session(wf_id, expected, "test-model");
        for event in &actual {
            engine.on_event(sid, event.clone()).unwrap();
        }

        let verdict = engine.finalize(sid).unwrap();
        match verdict {
            Verdict::Partial { score, .. } => {
                assert!(score > 0.5, "Score should be high for minor divergence, got {}", score);
            }
            other => panic!("Expected Partial, got {:?}", other),
        }
    }

    #[test]
    fn checkpoint_pass_and_fail() {
        let mut engine = JudgeEngine::new();
        let wf_id = Uuid::new_v4();
        let expected = vec![
            think("plan"),
            checkpoint("build-ok", "abc123def456"),
        ];

        let sid = engine.start_session(wf_id, expected, "test-model");

        // Pass — same hash.
        let result = engine.check_checkpoint(sid, 0, "abc123def456").unwrap();
        assert!(result.passed);
        assert!(result.drift_score < 0.01);

        // Create a second session to test failure.
        let sid2 = engine.start_session(wf_id, vec![checkpoint("state", "aaaa")], "test-model");
        let result2 = engine.check_checkpoint(sid2, 0, "zzzz").unwrap();
        assert!(!result2.passed);
        assert!(result2.drift_score > 0.5);
    }

    #[test]
    fn double_finalize_is_error() {
        let mut engine = JudgeEngine::new();
        let sid = engine.start_session(Uuid::new_v4(), vec![], "test");
        engine.finalize(sid).unwrap();
        assert!(engine.finalize(sid).is_err());
    }

    #[test]
    fn event_after_finalize_is_error() {
        let mut engine = JudgeEngine::new();
        let sid = engine.start_session(Uuid::new_v4(), vec![], "test");
        engine.finalize(sid).unwrap();
        assert!(engine.on_event(sid, think("late")).is_err());
    }

    #[test]
    fn drift_score_computation() {
        assert_eq!(compute_drift("abc", "abc"), 0.0);
        assert_eq!(compute_drift("", ""), 0.0);
        assert_eq!(compute_drift("abc", ""), 1.0);
        assert_eq!(compute_drift("", "abc"), 1.0);

        let drift = compute_drift("abcdef", "abcxyz");
        assert!(drift > 0.0 && drift < 1.0, "drift={}", drift);
    }
}
