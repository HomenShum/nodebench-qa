use benchpress_core::types::{CrawlSnapshot, DiffCrawlResult, DiffType, PageDiff};
use benchpress_core::Result;

/// Compare two crawl snapshots and produce a diff
pub fn diff_snapshots(before: &CrawlSnapshot, after: &CrawlSnapshot) -> Vec<PageDiff> {
    let mut diffs = Vec::new();

    let before_urls: std::collections::HashSet<&str> =
        before.pages.iter().map(|p| p.url.as_str()).collect();
    let after_urls: std::collections::HashSet<&str> =
        after.pages.iter().map(|p| p.url.as_str()).collect();

    // Pages added
    for url in after_urls.difference(&before_urls) {
        diffs.push(PageDiff {
            url: url.to_string(),
            diff_type: DiffType::Added,
            detail: "New page discovered in after crawl".into(),
        });
    }

    // Pages removed
    for url in before_urls.difference(&after_urls) {
        diffs.push(PageDiff {
            url: url.to_string(),
            diff_type: DiffType::Removed,
            detail: "Page no longer accessible in after crawl".into(),
        });
    }

    // Pages with changed status
    for after_page in &after.pages {
        if let Some(before_page) = before.pages.iter().find(|p| p.url == after_page.url) {
            if before_page.status != after_page.status {
                diffs.push(PageDiff {
                    url: after_page.url.clone(),
                    diff_type: DiffType::StatusChanged,
                    detail: format!(
                        "Status changed from {} to {}",
                        before_page.status, after_page.status
                    ),
                });
            }
            if before_page.title != after_page.title {
                diffs.push(PageDiff {
                    url: after_page.url.clone(),
                    diff_type: DiffType::ContentChanged,
                    detail: format!(
                        "Title changed from {:?} to {:?}",
                        before_page.title, after_page.title
                    ),
                });
            }
        }
    }

    diffs
}

/// Run a diff crawl: crawl now, compare against stored baseline
pub async fn run_diff_crawl(url: &str, _baseline_id: Option<&str>) -> Result<DiffCrawlResult> {
    let now = chrono::Utc::now();

    // Crawl current state
    let current = crate::crawl::crawl_sitemap(url, 2, 20).await?;

    let after = CrawlSnapshot {
        timestamp: now,
        pages: current.pages.clone(),
    };

    // TODO: Load baseline from storage by baseline_id
    // For now, use empty baseline (all pages show as "added")
    let before = CrawlSnapshot {
        timestamp: now,
        pages: vec![],
    };

    let diffs = diff_snapshots(&before, &after);
    let summary = format!(
        "{} changes: {} added, {} removed, {} changed",
        diffs.len(),
        diffs.iter().filter(|d| matches!(d.diff_type, DiffType::Added)).count(),
        diffs.iter().filter(|d| matches!(d.diff_type, DiffType::Removed)).count(),
        diffs.iter().filter(|d| matches!(d.diff_type, DiffType::StatusChanged | DiffType::ContentChanged)).count(),
    );

    Ok(DiffCrawlResult {
        url: url.to_string(),
        before,
        after,
        diffs,
        summary,
    })
}
