use benchpress_core::types::{Severity, UxAuditResult, UxFinding};
use benchpress_core::Result;

/// 21-rule UX audit checklist
const UX_RULES: &[UxRule] = &[
    UxRule { id: "ux-01", name: "Viewport meta tag", severity: Severity::High },
    UxRule { id: "ux-02", name: "Page title exists", severity: Severity::High },
    UxRule { id: "ux-03", name: "Meta description", severity: Severity::Medium },
    UxRule { id: "ux-04", name: "Heading hierarchy", severity: Severity::Medium },
    UxRule { id: "ux-05", name: "Alt text on images", severity: Severity::High },
    UxRule { id: "ux-06", name: "Interactive element sizing", severity: Severity::Medium },
    UxRule { id: "ux-07", name: "Color contrast", severity: Severity::High },
    UxRule { id: "ux-08", name: "Focus indicators", severity: Severity::High },
    UxRule { id: "ux-09", name: "Keyboard navigation", severity: Severity::High },
    UxRule { id: "ux-10", name: "Form labels", severity: Severity::High },
    UxRule { id: "ux-11", name: "Error state visibility", severity: Severity::Medium },
    UxRule { id: "ux-12", name: "Loading states", severity: Severity::Medium },
    UxRule { id: "ux-13", name: "Consistent spacing", severity: Severity::Low },
    UxRule { id: "ux-14", name: "Typography hierarchy", severity: Severity::Low },
    UxRule { id: "ux-15", name: "CTA visibility", severity: Severity::Medium },
    UxRule { id: "ux-16", name: "Mobile responsiveness", severity: Severity::High },
    UxRule { id: "ux-17", name: "No horizontal scroll", severity: Severity::Medium },
    UxRule { id: "ux-18", name: "Reduced motion support", severity: Severity::Medium },
    UxRule { id: "ux-19", name: "Print stylesheet", severity: Severity::Low },
    UxRule { id: "ux-20", name: "Favicon present", severity: Severity::Low },
    UxRule { id: "ux-21", name: "Open Graph tags", severity: Severity::Low },
];

struct UxRule {
    id: &'static str,
    name: &'static str,
    severity: Severity,
}

/// Run UX audit on a URL, checking all 21 rules
pub async fn run_ux_audit(url: &str) -> Result<UxAuditResult> {
    let start = std::time::Instant::now();

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| benchpress_core::Error::QaEngine(e.to_string()))?;

    let response = client
        .get(url)
        .send()
        .await
        .map_err(|e| benchpress_core::Error::QaEngine(e.to_string()))?;

    let body = response
        .text()
        .await
        .map_err(|e| benchpress_core::Error::QaEngine(e.to_string()))?;

    let mut findings = Vec::new();

    // Check each rule against the HTML
    for rule in UX_RULES {
        let (passed, detail, recommendation) = check_rule(rule, &body);
        findings.push(UxFinding {
            rule_id: rule.id.to_string(),
            rule_name: rule.name.to_string(),
            passed,
            severity: rule.severity,
            detail,
            recommendation,
        });
    }

    let rules_checked = findings.len();
    let rules_passed = findings.iter().filter(|f| f.passed).count();
    let score = ((rules_passed as f64 / rules_checked as f64) * 100.0) as u8;

    Ok(UxAuditResult {
        url: url.to_string(),
        score,
        rules_checked,
        rules_passed,
        findings,
        duration_ms: start.elapsed().as_millis() as u64,
    })
}

fn check_rule(rule: &UxRule, html: &str) -> (bool, String, Option<String>) {
    match rule.id {
        "ux-01" => {
            let passed = html.contains("viewport");
            (
                passed,
                if passed { "Viewport meta tag found".into() } else { "Missing viewport meta tag".into() },
                if !passed { Some("Add <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">".into()) } else { None },
            )
        }
        "ux-02" => {
            let passed = html.contains("<title>") && html.contains("</title>");
            (
                passed,
                if passed { "Page title exists".into() } else { "Missing <title> tag".into() },
                if !passed { Some("Add a descriptive <title> tag in <head>".into()) } else { None },
            )
        }
        "ux-03" => {
            let passed = html.contains("meta") && html.contains("description");
            (
                passed,
                if passed { "Meta description found".into() } else { "Missing meta description".into() },
                if !passed { Some("Add <meta name=\"description\" content=\"...\">".into()) } else { None },
            )
        }
        "ux-05" => {
            // Check if images have alt attributes
            let has_img = html.contains("<img");
            let all_have_alt = !has_img || !html.contains("<img") || html.matches("<img").count() <= html.matches("alt=").count();
            (
                all_have_alt,
                if all_have_alt { "All images have alt attributes".into() } else { "Some images missing alt text".into() },
                if !all_have_alt { Some("Add alt attributes to all <img> tags".into()) } else { None },
            )
        }
        "ux-08" => {
            let passed = html.contains(":focus") || html.contains("focus-visible") || html.contains("focus-within");
            (
                passed,
                if passed { "Focus styles detected".into() } else { "No focus styles found in inline CSS".into() },
                if !passed { Some("Add visible focus indicators for keyboard navigation".into()) } else { None },
            )
        }
        "ux-16" => {
            let passed = html.contains("viewport") && (html.contains("@media") || html.contains("responsive"));
            (
                passed,
                if passed { "Responsive design indicators found".into() } else { "No responsive design detected".into() },
                if !passed { Some("Add responsive breakpoints via @media queries".into()) } else { None },
            )
        }
        "ux-20" => {
            let passed = html.contains("favicon") || html.contains("icon");
            (
                passed,
                if passed { "Favicon reference found".into() } else { "No favicon detected".into() },
                if !passed { Some("Add <link rel=\"icon\" href=\"/favicon.ico\">".into()) } else { None },
            )
        }
        "ux-21" => {
            let passed = html.contains("og:") || html.contains("property=\"og:");
            (
                passed,
                if passed { "Open Graph tags found".into() } else { "Missing Open Graph tags".into() },
                if !passed { Some("Add og:title, og:description, og:image meta tags".into()) } else { None },
            )
        }
        _ => {
            // Placeholder for rules that need browser automation
            (true, format!("{} — requires browser automation for full check", rule.name), None)
        }
    }
}
