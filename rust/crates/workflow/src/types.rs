use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use uuid::Uuid;

// ── Canonical Event Stream ─────────────────────────────────────────────────

/// A complete captured workflow from a coding agent session.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Workflow {
    pub id: Uuid,
    pub name: String,
    pub source_model: String,
    pub captured_at: DateTime<Utc>,
    pub events: Vec<CanonicalEvent>,
    pub metadata: WorkflowMetadata,
    pub fingerprint: String,
}

impl Workflow {
    /// Create a new workflow with auto-computed fingerprint.
    pub fn new(
        name: String,
        source_model: String,
        events: Vec<CanonicalEvent>,
        metadata: WorkflowMetadata,
    ) -> Self {
        let fingerprint = Self::compute_fingerprint(&events);
        Self {
            id: Uuid::new_v4(),
            name,
            source_model,
            captured_at: Utc::now(),
            events,
            metadata,
            fingerprint,
        }
    }

    /// Compute a SHA-256 fingerprint over the serialized event stream.
    /// Two workflows with identical event sequences produce the same fingerprint.
    pub fn compute_fingerprint(events: &[CanonicalEvent]) -> String {
        let mut hasher = Sha256::new();
        for event in events {
            let json = serde_json::to_string(event).unwrap_or_default();
            hasher.update(json.as_bytes());
        }
        format!("{:x}", hasher.finalize())
    }
}

/// Every action a coding agent can take, normalized into a canonical form.
///
/// Tagged enum — serializes with `"type": "think"`, `"type": "tool_call"`, etc.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum CanonicalEvent {
    /// Free-form reasoning / chain-of-thought
    Think {
        content: String,
        duration_ms: u64,
    },

    /// Any tool invocation (Bash, Read, custom MCP tools, etc.)
    ToolCall {
        tool: String,
        args: serde_json::Value,
        result: serde_json::Value,
        duration_ms: u64,
    },

    /// An explicit decision point with alternatives considered
    Decision {
        question: String,
        choice: String,
        alternatives: Vec<String>,
        reasoning: String,
    },

    /// Modification of an existing file
    FileEdit {
        path: String,
        before: String,
        after: String,
    },

    /// Creation of a new file
    FileCreate {
        path: String,
        content: String,
    },

    /// Code/file search
    Search {
        query: String,
        results_count: usize,
        selected: Option<String>,
    },

    /// Navigation between files, URLs, or contexts
    Navigate {
        from: String,
        to: String,
        reason: String,
    },

    /// A verification assertion
    Assert {
        condition: String,
        passed: bool,
        evidence: String,
    },

    /// A labeled state checkpoint for replay verification
    Checkpoint {
        label: String,
        state_hash: String,
    },

    /// A correction or hint (from judge or human)
    Nudge {
        from_judge: bool,
        message: String,
        correction: Option<String>,
    },
}

/// Metadata about the capture session.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowMetadata {
    pub adapter: String,
    pub session_id: Option<String>,
    pub project_path: Option<String>,
    pub total_tokens: TokenCost,
    pub duration_ms: u64,
    pub task_description: String,
}

/// Token usage and estimated cost for a workflow or segment.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct TokenCost {
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub total_tokens: u64,
    pub estimated_cost_usd: f64,
}

/// Lightweight summary for listing workflows without loading full event data.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowSummary {
    pub id: Uuid,
    pub name: String,
    pub source_model: String,
    pub event_count: usize,
    pub captured_at: DateTime<Utc>,
    pub fingerprint: String,
}
