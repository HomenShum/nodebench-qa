use axum::{extract::State, http::StatusCode, response::IntoResponse, routing::post, Json, Router};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use crate::state::AppState;

// ── Request types ───────────────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct QaCheckRequest {
    pub url: String,
    #[serde(default = "default_timeout")]
    pub timeout_ms: u64,
}

fn default_timeout() -> u64 { 30_000 }

#[derive(Deserialize)]
pub struct SitemapRequest {
    pub url: String,
    #[serde(default = "default_max_depth")]
    pub max_depth: u8,
    #[serde(default = "default_max_pages")]
    pub max_pages: usize,
}

fn default_max_depth() -> u8 { 3 }
fn default_max_pages() -> usize { 50 }

#[derive(Deserialize)]
pub struct UxAuditRequest {
    pub url: String,
}

#[derive(Deserialize)]
pub struct DiffCrawlRequest {
    pub url: String,
    pub baseline_id: Option<String>,
}

// ── Full response types matching frontend expectations ──────────────────────

#[derive(Serialize)]
pub struct FullQaResponse {
    pub id: String,
    pub url: String,
    pub score: u8,
    pub duration_ms: u64,
    pub timestamp: String,
    pub dimensions: Dimensions,
    pub issues: Vec<IssueResponse>,
}

#[derive(Serialize)]
pub struct Dimensions {
    pub js_errors: u8,
    pub accessibility: u8,
    pub performance: u8,
    pub layout: u8,
    pub seo: u8,
    pub security: u8,
}

#[derive(Serialize)]
pub struct IssueResponse {
    pub severity: String,
    pub title: String,
    pub description: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub selector: Option<String>,
}

#[derive(Serialize)]
pub struct FullSitemapResponse {
    pub url: String,
    pub pages: Vec<SitemapPageResponse>,
    pub total_pages: usize,
    pub crawl_duration_ms: u64,
    pub timestamp: String,
}

#[derive(Serialize)]
pub struct SitemapPageResponse {
    pub url: String,
    pub title: String,
    pub status: u16,
    pub depth: u8,
    pub links: usize,
}

#[derive(Serialize)]
pub struct FullAuditResponse {
    pub url: String,
    pub score: u8,
    pub rules: Vec<AuditRuleResponse>,
    pub duration_ms: u64,
    pub timestamp: String,
}

#[derive(Serialize)]
pub struct AuditRuleResponse {
    pub id: String,
    pub name: String,
    pub status: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub recommendation: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<String>,
}

#[derive(Serialize)]
pub struct FullDiffResponse {
    pub url: String,
    pub baseline_pages: usize,
    pub current_pages: usize,
    pub added: Vec<String>,
    pub removed: Vec<String>,
    pub changed: Vec<DiffChangeResponse>,
    pub timestamp: String,
}

#[derive(Serialize)]
pub struct DiffChangeResponse {
    pub url: String,
    pub field: String,
    pub before: String,
    pub after: String,
}

#[derive(Serialize)]
struct ApiError {
    error: String,
    status: u16,
}

fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339()
}

// ── Handlers ────────────────────────────────────────────────────────────────

async fn qa_check(
    State(state): State<Arc<AppState>>,
    Json(req): Json<QaCheckRequest>,
) -> Result<Json<FullQaResponse>, impl IntoResponse> {
    state.increment_requests();

    let result = benchpress_engine::qa::run_qa_check(&req.url, req.timeout_ms).await;

    match result {
        Ok(r) => {
            let issues: Vec<IssueResponse> = r.issues.iter().map(|i| IssueResponse {
                severity: format!("{:?}", i.severity).to_lowercase(),
                title: i.title.clone(),
                description: i.description.clone(),
                selector: i.selector.clone(),
            }).collect();

            Ok(Json(FullQaResponse {
                id: r.id.to_string(),
                url: r.url.clone(),
                score: r.score.overall,
                duration_ms: r.duration_ms,
                timestamp: r.timestamp.to_rfc3339(),
                dimensions: Dimensions {
                    js_errors: r.score.dimensions.js_errors,
                    accessibility: r.score.dimensions.accessibility,
                    performance: r.score.dimensions.performance,
                    layout: r.score.dimensions.layout,
                    seo: r.score.dimensions.seo,
                    security: r.score.dimensions.security,
                },
                issues,
            }))
        }
        Err(e) => Err((
            StatusCode::BAD_GATEWAY,
            Json(ApiError { error: e.to_string(), status: 502 }),
        )),
    }
}

async fn sitemap(
    State(state): State<Arc<AppState>>,
    Json(req): Json<SitemapRequest>,
) -> Result<Json<FullSitemapResponse>, impl IntoResponse> {
    state.increment_requests();

    let result = benchpress_engine::crawl::crawl_sitemap(&req.url, req.max_depth, req.max_pages).await;

    match result {
        Ok(r) => {
            let pages: Vec<SitemapPageResponse> = r.pages.iter().map(|p| SitemapPageResponse {
                url: p.url.clone(),
                title: p.title.clone().unwrap_or_default(),
                status: p.status,
                depth: p.depth,
                links: p.links_to.len(),
            }).collect();

            Ok(Json(FullSitemapResponse {
                url: r.root_url,
                pages,
                total_pages: r.total_pages,
                crawl_duration_ms: r.crawl_duration_ms,
                timestamp: now_iso(),
            }))
        }
        Err(e) => Err((
            StatusCode::BAD_GATEWAY,
            Json(ApiError { error: e.to_string(), status: 502 }),
        )),
    }
}

async fn ux_audit(
    State(state): State<Arc<AppState>>,
    Json(req): Json<UxAuditRequest>,
) -> Result<Json<FullAuditResponse>, impl IntoResponse> {
    state.increment_requests();

    let result = benchpress_engine::audit::run_ux_audit(&req.url).await;

    match result {
        Ok(r) => {
            let rules: Vec<AuditRuleResponse> = r.findings.iter().map(|f| {
                let status = if f.passed { "pass" }
                    else if f.detail.contains("requires browser") { "skip" }
                    else { "fail" };
                AuditRuleResponse {
                    id: f.rule_id.clone(),
                    name: f.rule_name.clone(),
                    status,
                    recommendation: f.recommendation.clone(),
                    details: Some(f.detail.clone()),
                }
            }).collect();

            Ok(Json(FullAuditResponse {
                url: r.url,
                score: r.score,
                rules,
                duration_ms: r.duration_ms,
                timestamp: now_iso(),
            }))
        }
        Err(e) => Err((
            StatusCode::BAD_GATEWAY,
            Json(ApiError { error: e.to_string(), status: 502 }),
        )),
    }
}

async fn diff_crawl(
    State(state): State<Arc<AppState>>,
    Json(req): Json<DiffCrawlRequest>,
) -> Result<Json<FullDiffResponse>, impl IntoResponse> {
    state.increment_requests();

    let result = benchpress_engine::diff::run_diff_crawl(&req.url, req.baseline_id.as_deref()).await;

    match result {
        Ok(r) => {
            let added: Vec<String> = r.diffs.iter()
                .filter(|d| matches!(d.diff_type, benchpress_core::types::DiffType::Added))
                .map(|d| d.url.clone()).collect();
            let removed: Vec<String> = r.diffs.iter()
                .filter(|d| matches!(d.diff_type, benchpress_core::types::DiffType::Removed))
                .map(|d| d.url.clone()).collect();
            let changed: Vec<DiffChangeResponse> = r.diffs.iter()
                .filter(|d| matches!(d.diff_type, benchpress_core::types::DiffType::StatusChanged | benchpress_core::types::DiffType::ContentChanged))
                .map(|d| DiffChangeResponse {
                    url: d.url.clone(),
                    field: format!("{:?}", d.diff_type),
                    before: String::new(),
                    after: d.detail.clone(),
                }).collect();

            Ok(Json(FullDiffResponse {
                url: r.url,
                baseline_pages: r.before.pages.len(),
                current_pages: r.after.pages.len(),
                added,
                removed,
                changed,
                timestamp: now_iso(),
            }))
        }
        Err(e) => Err((
            StatusCode::BAD_GATEWAY,
            Json(ApiError { error: e.to_string(), status: 502 }),
        )),
    }
}

// ── Router ──────────────────────────────────────────────────────────────────

pub fn routes() -> Router<Arc<AppState>> {
    Router::new()
        .route("/check", post(qa_check))
        .route("/sitemap", post(sitemap))
        .route("/ux-audit", post(ux_audit))
        .route("/diff-crawl", post(diff_crawl))
}
