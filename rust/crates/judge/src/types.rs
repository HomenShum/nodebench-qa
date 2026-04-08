use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use benchpress_workflow::CanonicalEvent;

// ── Verdict ────────────────────────────────────────────────────────────────

/// The final judgment on a workflow replay.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "verdict", rename_all = "snake_case")]
pub enum Verdict {
    Correct,
    Partial {
        score: f64,
        divergences: Vec<Divergence>,
    },
    Escalate {
        reason: String,
    },
    Failed {
        reason: String,
    },
}

// ── Divergence ─────────────────────────────────────────────────────────────

/// A single point where actual replay diverged from the expected workflow.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Divergence {
    pub event_index: usize,
    pub expected: CanonicalEvent,
    pub actual: CanonicalEvent,
    pub severity: DivergenceSeverity,
    pub suggestion: String,
}

/// How bad is a divergence?
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "lowercase")]
pub enum DivergenceSeverity {
    Minor,
    Major,
    Critical,
}

// ── Judge Session ──────────────────────────────────────────────────────────

/// Full state for one judge session — tracks expected vs actual events,
/// checkpoint results, nudges issued, and the final verdict.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JudgeSession {
    pub id: Uuid,
    pub workflow_id: Uuid,
    pub replay_model: String,
    pub events_expected: Vec<CanonicalEvent>,
    pub events_actual: Vec<CanonicalEvent>,
    pub checkpoints: Vec<CheckpointResult>,
    pub verdict: Option<Verdict>,
    pub nudges: Vec<Nudge>,
    pub started_at: DateTime<Utc>,
    pub completed_at: Option<DateTime<Utc>>,
}

// ── Checkpoint ─────────────────────────────────────────────────────────────

/// Result of verifying a single checkpoint during replay.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CheckpointResult {
    pub checkpoint_index: usize,
    pub passed: bool,
    pub drift_score: f64,
    pub detail: String,
}

// ── Nudge ──────────────────────────────────────────────────────────────────

/// A correction hint issued by the judge when divergence is detected.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Nudge {
    pub at_event: usize,
    pub message: String,
    pub accepted: bool,
    pub timestamp: DateTime<Utc>,
}

// ── Attention Map ──────────────────────────────────────────────────────────

/// Tracks which expected events were followed, skipped, or diverged during replay.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AttentionMap {
    pub entries: Vec<AttentionEntry>,
}

/// Status of a single expected event in the attention map.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AttentionEntry {
    pub event_index: usize,
    pub status: AttentionStatus,
    pub detail: String,
}

/// Whether the replay model followed, skipped, or diverged from an expected event.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum AttentionStatus {
    Followed,
    Skipped,
    Diverged,
}
