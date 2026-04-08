use benchpress_core::Result;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// A QA pipeline stage
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PipelineStage {
    Crawl,
    Analyze,
    TestGenerate,
    Execute,
    Verify,
    Report,
}

/// A complete pipeline run with multiple stages
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PipelineRun {
    pub id: Uuid,
    pub url: String,
    pub stages: Vec<StageResult>,
    pub status: PipelineStatus,
    pub started_at: chrono::DateTime<chrono::Utc>,
    pub completed_at: Option<chrono::DateTime<chrono::Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StageResult {
    pub stage: PipelineStage,
    pub status: StageStatus,
    pub duration_ms: u64,
    pub output: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PipelineStatus {
    Running,
    Completed,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StageStatus {
    Pending,
    Running,
    Completed,
    Failed,
    Skipped,
}

/// Run the full QA pipeline: crawl → analyze → generate tests → execute → verify → report
pub async fn run_pipeline(url: &str) -> Result<PipelineRun> {
    let run = PipelineRun {
        id: Uuid::new_v4(),
        url: url.to_string(),
        stages: vec![],
        status: PipelineStatus::Running,
        started_at: chrono::Utc::now(),
        completed_at: None,
    };

    // Stage 1: Crawl
    let crawl_result = benchpress_engine::crawl::crawl_sitemap(url, 2, 20).await?;
    let mut stages = vec![StageResult {
        stage: PipelineStage::Crawl,
        status: StageStatus::Completed,
        duration_ms: crawl_result.crawl_duration_ms,
        output: serde_json::to_value(&crawl_result).unwrap_or_default(),
    }];

    // Stage 2: Analyze each page
    let qa_result = benchpress_engine::qa::run_qa_check(url, 30_000).await?;
    stages.push(StageResult {
        stage: PipelineStage::Analyze,
        status: StageStatus::Completed,
        duration_ms: qa_result.duration_ms,
        output: serde_json::json!({
            "score": qa_result.score.overall,
            "issues": qa_result.issues.len(),
        }),
    });

    // Stage 3: UX Audit
    let audit_result = benchpress_engine::audit::run_ux_audit(url).await?;
    stages.push(StageResult {
        stage: PipelineStage::Verify,
        status: StageStatus::Completed,
        duration_ms: audit_result.duration_ms,
        output: serde_json::json!({
            "score": audit_result.score,
            "rules_passed": audit_result.rules_passed,
            "rules_checked": audit_result.rules_checked,
        }),
    });

    // Stage 4: Report
    stages.push(StageResult {
        stage: PipelineStage::Report,
        status: StageStatus::Completed,
        duration_ms: 0,
        output: serde_json::json!({
            "qa_score": qa_result.score.overall,
            "ux_score": audit_result.score,
            "pages_crawled": crawl_result.total_pages,
            "total_issues": qa_result.issues.len(),
        }),
    });

    Ok(PipelineRun {
        stages,
        status: PipelineStatus::Completed,
        completed_at: Some(chrono::Utc::now()),
        ..run
    })
}
