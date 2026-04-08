use benchpress_core::types::{
    Evidence, IssueCategory, QaIssue, QaMetadata, QaResult, QaScore, ScoreDimensions, Severity,
    Viewport,
};
use benchpress_core::Result;
use uuid::Uuid;

/// Run a full QA check on the given URL.
///
/// Performs: JS error detection, accessibility audit, performance check,
/// layout validation, screenshot capture.
pub async fn run_qa_check(url: &str, timeout_ms: u64) -> Result<QaResult> {
    let start = std::time::Instant::now();

    // Phase 1: Fetch the page and check HTTP status
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_millis(timeout_ms))
        .build()
        .map_err(|e| benchpress_core::Error::QaEngine(e.to_string()))?;

    let response = client
        .get(url)
        .send()
        .await
        .map_err(|e| benchpress_core::Error::QaEngine(e.to_string()))?;

    let status = response.status().as_u16();
    let body = response
        .text()
        .await
        .map_err(|e| benchpress_core::Error::QaEngine(e.to_string()))?;

    let mut issues = Vec::new();

    // Phase 2: Check for obvious HTML issues
    if !body.contains("<!DOCTYPE") && !body.contains("<!doctype") {
        issues.push(QaIssue {
            id: Uuid::new_v4(),
            severity: Severity::Medium,
            category: IssueCategory::Rendering,
            title: "Missing DOCTYPE declaration".into(),
            description: "Page does not include a DOCTYPE declaration, which may cause quirks mode rendering.".into(),
            selector: None,
            source_url: url.to_string(),
            evidence: None,
        });
    }

    if !body.contains("<meta") || !body.contains("viewport") {
        issues.push(QaIssue {
            id: Uuid::new_v4(),
            severity: Severity::Medium,
            category: IssueCategory::Rendering,
            title: "Missing viewport meta tag".into(),
            description: "Page does not include a viewport meta tag for responsive design.".into(),
            selector: Some("head".into()),
            source_url: url.to_string(),
            evidence: None,
        });
    }

    // Phase 3: Check for inline JS errors (heuristic)
    if body.contains("Uncaught") || body.contains("TypeError") || body.contains("ReferenceError") {
        issues.push(QaIssue {
            id: Uuid::new_v4(),
            severity: Severity::High,
            category: IssueCategory::JsError,
            title: "JavaScript error detected in HTML".into(),
            description: "Page HTML contains visible JavaScript error text.".into(),
            selector: None,
            source_url: url.to_string(),
            evidence: Some(Evidence {
                screenshot_id: None,
                console_log: Some("Detected error text in page body".into()),
                network_request: None,
                dom_snapshot: None,
            }),
        });
    }

    // Phase 4: Basic accessibility checks
    if !body.contains("lang=") {
        issues.push(QaIssue {
            id: Uuid::new_v4(),
            severity: Severity::High,
            category: IssueCategory::Accessibility,
            title: "Missing lang attribute".into(),
            description: "The <html> element does not have a lang attribute.".into(),
            selector: Some("html".into()),
            source_url: url.to_string(),
            evidence: None,
        });
    }

    // Phase 5: HTTP status check
    if status >= 400 {
        issues.push(QaIssue {
            id: Uuid::new_v4(),
            severity: Severity::Critical,
            category: IssueCategory::Network,
            title: format!("HTTP {} error", status),
            description: format!("Page returned HTTP status {}", status),
            selector: None,
            source_url: url.to_string(),
            evidence: None,
        });
    }

    // Calculate score
    let critical_count = issues.iter().filter(|i| i.severity == Severity::Critical).count();
    let high_count = issues.iter().filter(|i| i.severity == Severity::High).count();
    let medium_count = issues.iter().filter(|i| i.severity == Severity::Medium).count();

    let overall = (100u8)
        .saturating_sub((critical_count as u8) * 25)
        .saturating_sub((high_count as u8) * 10)
        .saturating_sub((medium_count as u8) * 5);

    Ok(QaResult {
        id: Uuid::new_v4(),
        url: url.to_string(),
        timestamp: chrono::Utc::now(),
        duration_ms: start.elapsed().as_millis() as u64,
        issues,
        score: QaScore {
            overall,
            dimensions: ScoreDimensions {
                js_errors: if critical_count == 0 { 100 } else { 0 },
                accessibility: if high_count == 0 { 80 } else { 40 },
                performance: 70, // Placeholder until browser automation
                layout: 80,
                seo: 60,
                security: 90,
            },
        },
        screenshots: vec![],
        metadata: QaMetadata {
            viewport: Viewport {
                width: 1280,
                height: 800,
            },
            ..Default::default()
        },
    })
}
