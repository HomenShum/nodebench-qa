//! benchpress-distiller: Workflow distillation engine
//!
//! Takes a captured frontier-model workflow and distills it for cheaper replay:
//! 1. Eliminates redundant steps (retries, dead-end searches, overwritten edits)
//! 2. Extracts deterministic copy-paste blocks (file contents, data lookups)
//! 3. Compresses verbose reasoning (truncate, merge, remove summaries)
//! 4. Extracts verification checkpoints for replay validation

pub mod strategies;

use benchpress_workflow::{CanonicalEvent, TokenCost, Workflow};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

pub use strategies::checkpoint_prune::Checkpoint;
pub use strategies::copy_paste_block::CopyBlock;

/// A distilled workflow ready for cheaper replay on a target model.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DistilledWorkflow {
    /// Unique ID for this distilled version.
    pub id: Uuid,
    /// ID of the original workflow that was distilled.
    pub original_id: Uuid,
    /// Model that originally produced the workflow.
    pub original_model: String,
    /// Model this distillation targets for replay.
    pub target_model: String,
    /// Compressed event stream.
    pub events: Vec<CanonicalEvent>,
    /// Deterministic content blocks that can be injected without LLM regeneration.
    pub copy_blocks: Vec<CopyBlock>,
    /// Verification checkpoints for replay validation.
    pub checkpoints: Vec<Checkpoint>,
    /// Ratio of distilled events to original (< 1.0 means compression).
    pub compression_ratio: f64,
    /// Estimated token cost for replaying the distilled workflow.
    pub estimated_cost: TokenCost,
    /// When this distillation was performed.
    pub distilled_at: chrono::DateTime<Utc>,
}

/// Distill a workflow for replay on a target model.
///
/// Applies all four strategies in sequence:
/// 1. Step elimination (remove redundant steps)
/// 2. Copy-paste block extraction (identify deterministic outputs)
/// 3. Context compression (shrink reasoning blocks)
/// 4. Checkpoint extraction (insert verification points)
///
/// Returns a `DistilledWorkflow` with compressed events, extracted blocks,
/// and a cost estimate for the target model.
pub fn distill(workflow: &Workflow, target_model: &str) -> DistilledWorkflow {
    let original_event_count = workflow.events.len();

    // Strategy 1: Eliminate redundant steps
    let after_elimination = strategies::step_elimination::eliminate(&workflow.events);

    // Strategy 2: Extract copy-paste blocks (before compression, for full fidelity)
    let copy_blocks = strategies::copy_paste_block::extract(&after_elimination);

    // Strategy 3: Compress context (Think blocks)
    let events = strategies::context_compress::compress(&after_elimination);

    // Strategy 4: Extract checkpoints from the final event stream
    let checkpoints = strategies::checkpoint_prune::extract(&events);

    // Compute compression ratio (0.0 = eliminated everything, 1.0 = no change)
    let compression_ratio = if original_event_count > 0 {
        events.len() as f64 / original_event_count as f64
    } else {
        1.0
    };

    DistilledWorkflow {
        id: Uuid::new_v4(),
        original_id: workflow.id,
        original_model: workflow.source_model.clone(),
        target_model: target_model.to_string(),
        events,
        copy_blocks,
        checkpoints,
        compression_ratio,
        estimated_cost: estimate_cost(&workflow.metadata.total_tokens, compression_ratio),
        distilled_at: Utc::now(),
    }
}

/// Estimate replay cost based on original token cost and compression ratio.
fn estimate_cost(original: &TokenCost, ratio: f64) -> TokenCost {
    TokenCost {
        input_tokens: (original.input_tokens as f64 * ratio) as u64,
        output_tokens: (original.output_tokens as f64 * ratio) as u64,
        total_tokens: (original.total_tokens as f64 * ratio) as u64,
        estimated_cost_usd: original.estimated_cost_usd * ratio,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use benchpress_workflow::WorkflowMetadata;
    use serde_json::json;

    fn make_test_workflow() -> Workflow {
        let events = vec![
            // Redundant search (0 results) — should be eliminated
            CanonicalEvent::Search {
                query: "nonexistent_function".into(),
                results_count: 0,
                selected: None,
            },
            // Useful search
            CanonicalEvent::Search {
                query: "main function".into(),
                results_count: 3,
                selected: Some("src/main.rs".into()),
            },
            // Chain of thinks — should be merged
            CanonicalEvent::Think {
                content: "First, I need to understand the codebase".into(),
                duration_ms: 100,
            },
            CanonicalEvent::Think {
                content: "To summarize what I've found so far".into(),
                duration_ms: 50,
            },
            CanonicalEvent::Think {
                content: "Now I'll implement the solution".into(),
                duration_ms: 80,
            },
            // Duplicate tool calls — should keep last
            CanonicalEvent::ToolCall {
                tool: "Bash".into(),
                args: json!({"command": "cargo test"}),
                result: json!({"error": "compilation failed"}),
                duration_ms: 2000,
            },
            CanonicalEvent::ToolCall {
                tool: "Bash".into(),
                args: json!({"command": "cargo test"}),
                result: json!({"output": "test result: ok"}),
                duration_ms: 3000,
            },
            // File operations — should generate checkpoints + copy blocks
            CanonicalEvent::FileCreate {
                path: "src/lib.rs".into(),
                content: "pub fn hello() -> &'static str { \"world\" }".into(),
            },
            // Overwritten edit — first should be eliminated
            CanonicalEvent::FileEdit {
                path: "Cargo.toml".into(),
                before: "v1".into(),
                after: "v2".into(),
            },
            CanonicalEvent::FileEdit {
                path: "Cargo.toml".into(),
                before: "v2".into(),
                after: "v3-final".into(),
            },
            // Assertion
            CanonicalEvent::Assert {
                condition: "cargo test passes".into(),
                passed: true,
                evidence: "all 5 tests passed".into(),
            },
        ];

        Workflow::new(
            "test-distillation".into(),
            "claude-opus-4-20250514".into(),
            events,
            WorkflowMetadata {
                adapter: "test".into(),
                session_id: Some("sess_test".into()),
                project_path: Some("/tmp/test".into()),
                total_tokens: TokenCost {
                    input_tokens: 10000,
                    output_tokens: 5000,
                    total_tokens: 15000,
                    estimated_cost_usd: 0.30,
                },
                duration_ms: 30000,
                task_description: "Test workflow for distillation".into(),
            },
        )
    }

    #[test]
    fn distill_reduces_event_count() {
        let workflow = make_test_workflow();
        let original_count = workflow.events.len();
        let distilled = distill(&workflow, "claude-sonnet-4-20250514");

        assert!(
            distilled.events.len() < original_count,
            "Distilled should have fewer events: {} vs {}",
            distilled.events.len(),
            original_count
        );
    }

    #[test]
    fn distill_produces_compression_ratio_under_one() {
        let workflow = make_test_workflow();
        let distilled = distill(&workflow, "claude-haiku-4-20250514");

        assert!(
            distilled.compression_ratio < 1.0,
            "Compression ratio should be < 1.0, got {}",
            distilled.compression_ratio
        );
    }

    #[test]
    fn distill_extracts_copy_blocks() {
        let workflow = make_test_workflow();
        let distilled = distill(&workflow, "gpt-4o-mini");

        assert!(
            !distilled.copy_blocks.is_empty(),
            "Should extract at least one copy block from FileCreate"
        );
        // FileCreate should produce a confidence-1.0 block
        let has_full_confidence = distilled
            .copy_blocks
            .iter()
            .any(|b| (b.confidence - 1.0).abs() < f64::EPSILON);
        assert!(has_full_confidence, "FileCreate should produce confidence 1.0 block");
    }

    #[test]
    fn distill_extracts_checkpoints() {
        let workflow = make_test_workflow();
        let distilled = distill(&workflow, "claude-sonnet-4-20250514");

        assert!(
            !distilled.checkpoints.is_empty(),
            "Should extract checkpoints from Assert and file operations"
        );
        // Should have a checkpoint for the Assert event
        let has_assert_checkpoint = distilled
            .checkpoints
            .iter()
            .any(|c| c.label.contains("Assert"));
        assert!(has_assert_checkpoint, "Should have Assert checkpoint");
    }

    #[test]
    fn distill_reduces_estimated_cost() {
        let workflow = make_test_workflow();
        let distilled = distill(&workflow, "claude-haiku-4-20250514");

        assert!(
            distilled.estimated_cost.total_tokens < workflow.metadata.total_tokens.total_tokens,
            "Distilled cost should be lower"
        );
        assert!(
            distilled.estimated_cost.estimated_cost_usd
                < workflow.metadata.total_tokens.estimated_cost_usd,
            "Estimated USD cost should decrease"
        );
    }

    #[test]
    fn distill_preserves_ids() {
        let workflow = make_test_workflow();
        let distilled = distill(&workflow, "target-model");

        assert_eq!(distilled.original_id, workflow.id);
        assert_ne!(distilled.id, workflow.id);
        assert_eq!(distilled.original_model, "claude-opus-4-20250514");
        assert_eq!(distilled.target_model, "target-model");
    }

    #[test]
    fn distill_empty_workflow() {
        let workflow = Workflow::new(
            "empty".into(),
            "model".into(),
            vec![],
            WorkflowMetadata {
                adapter: "test".into(),
                session_id: None,
                project_path: None,
                total_tokens: TokenCost::default(),
                duration_ms: 0,
                task_description: "empty".into(),
            },
        );
        let distilled = distill(&workflow, "target");
        assert!(distilled.events.is_empty());
        assert!(distilled.copy_blocks.is_empty());
        assert!(distilled.checkpoints.is_empty());
        assert!((distilled.compression_ratio - 1.0).abs() < f64::EPSILON);
    }

    #[test]
    fn roundtrip_serialization() {
        let workflow = make_test_workflow();
        let distilled = distill(&workflow, "target");
        let json = serde_json::to_string(&distilled).unwrap();
        let restored: DistilledWorkflow = serde_json::from_str(&json).unwrap();
        assert_eq!(restored.id, distilled.id);
        assert_eq!(restored.events.len(), distilled.events.len());
        assert_eq!(restored.copy_blocks.len(), distilled.copy_blocks.len());
        assert_eq!(restored.checkpoints.len(), distilled.checkpoints.len());
    }
}
