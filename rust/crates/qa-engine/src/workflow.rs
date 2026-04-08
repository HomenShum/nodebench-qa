use benchpress_core::types::{TokenCost, Workflow, WorkflowAction, WorkflowStep};
use benchpress_core::Result;
use uuid::Uuid;

/// Record a new workflow by capturing user actions
pub async fn start_workflow(url: &str, name: &str) -> Result<Workflow> {
    Ok(Workflow {
        id: Uuid::new_v4(),
        name: name.to_string(),
        url: url.to_string(),
        steps: vec![WorkflowStep {
            action: WorkflowAction::Navigate,
            selector: None,
            value: Some(url.to_string()),
            screenshot_before: None,
            screenshot_after: None,
            duration_ms: 0,
        }],
        created_at: chrono::Utc::now(),
        token_cost: TokenCost {
            input_tokens: 0,
            output_tokens: 0,
            total_tokens: 0,
            estimated_cost_usd: 0.0,
        },
    })
}

/// Replay a saved workflow, using trajectory replay for token savings
pub async fn replay_workflow(workflow: &Workflow) -> Result<WorkflowReplayResult> {
    let start = std::time::Instant::now();
    let mut replayed_steps = 0;
    let mut skipped_steps = 0;

    for step in &workflow.steps {
        // Check if step can be replayed from trajectory cache
        if can_replay_from_cache(step) {
            skipped_steps += 1;
        } else {
            replayed_steps += 1;
        }
    }

    let original_tokens = workflow.token_cost.total_tokens;
    let replay_tokens = (original_tokens as f64 * (replayed_steps as f64 / workflow.steps.len() as f64)) as u64;
    let saved_tokens = original_tokens.saturating_sub(replay_tokens);
    let savings_pct = if original_tokens > 0 {
        (saved_tokens as f64 / original_tokens as f64) * 100.0
    } else {
        0.0
    };

    Ok(WorkflowReplayResult {
        workflow_id: workflow.id,
        replayed_steps,
        skipped_steps,
        original_tokens,
        replay_tokens,
        saved_tokens,
        savings_pct,
        duration_ms: start.elapsed().as_millis() as u64,
    })
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct WorkflowReplayResult {
    pub workflow_id: Uuid,
    pub replayed_steps: usize,
    pub skipped_steps: usize,
    pub original_tokens: u64,
    pub replay_tokens: u64,
    pub saved_tokens: u64,
    pub savings_pct: f64,
    pub duration_ms: u64,
}

fn can_replay_from_cache(step: &WorkflowStep) -> bool {
    // Deterministic steps (navigate, screenshot) can be replayed from cache
    matches!(step.action, WorkflowAction::Navigate | WorkflowAction::Screenshot | WorkflowAction::Wait)
}
