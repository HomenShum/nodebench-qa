use benchpress_core::types::{SitemapPage, SitemapResult};
use benchpress_core::Result;
use std::collections::{HashSet, VecDeque};

/// Crawl a website and produce a sitemap
pub async fn crawl_sitemap(root_url: &str, max_depth: u8, max_pages: usize) -> Result<SitemapResult> {
    let start = std::time::Instant::now();
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .redirect(reqwest::redirect::Policy::limited(5))
        .build()
        .map_err(|e| benchpress_core::Error::QaEngine(e.to_string()))?;

    let mut visited: HashSet<String> = HashSet::new();
    let mut queue: VecDeque<(String, u8)> = VecDeque::new();
    let mut pages: Vec<SitemapPage> = Vec::new();

    queue.push_back((root_url.to_string(), 0));

    while let Some((url, depth)) = queue.pop_front() {
        if visited.contains(&url) || depth > max_depth || pages.len() >= max_pages {
            continue;
        }
        visited.insert(url.clone());

        let response = match client.get(&url).send().await {
            Ok(r) => r,
            Err(_) => continue,
        };

        let status = response.status().as_u16();
        let body = match response.text().await {
            Ok(b) => b,
            Err(_) => continue,
        };

        // Extract title
        let title = extract_title(&body);

        // Extract links (simple href extraction)
        let links = extract_links(&body, root_url);

        for link in &links {
            if !visited.contains(link) && depth + 1 <= max_depth {
                queue.push_back((link.clone(), depth + 1));
            }
        }

        pages.push(SitemapPage {
            url: url.clone(),
            title,
            status,
            depth,
            links_to: links,
            screenshot: None,
        });
    }

    let total_pages = pages.len();

    Ok(SitemapResult {
        root_url: root_url.to_string(),
        pages,
        total_pages,
        crawl_duration_ms: start.elapsed().as_millis() as u64,
    })
}

fn extract_title(html: &str) -> Option<String> {
    let start = html.find("<title>")?;
    let end = html.find("</title>")?;
    if end > start + 7 {
        Some(html[start + 7..end].trim().to_string())
    } else {
        None
    }
}

fn extract_links(html: &str, base_url: &str) -> Vec<String> {
    let mut links = Vec::new();
    let base = base_url.trim_end_matches('/');

    // Simple regex-free href extraction
    for chunk in html.split("href=\"") {
        if let Some(end) = chunk.find('"') {
            let href = &chunk[..end];
            let resolved = if href.starts_with("http://") || href.starts_with("https://") {
                // Only include same-origin links
                if href.starts_with(base) {
                    Some(href.to_string())
                } else {
                    None
                }
            } else if href.starts_with('/') {
                Some(format!("{}{}", base, href))
            } else {
                None
            };

            if let Some(url) = resolved {
                // Skip anchors, mailto, tel, javascript
                if !url.contains('#')
                    && !url.contains("mailto:")
                    && !url.contains("tel:")
                    && !url.contains("javascript:")
                {
                    links.push(url);
                }
            }
        }
    }

    links.sort();
    links.dedup();
    links
}
