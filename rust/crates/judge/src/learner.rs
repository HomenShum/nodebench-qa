//! Correction Learner — detects when users correct agent behavior,
//! records patterns, and recommends tightened workflow steps.
//!
//! Scans natural-language prompts for correction signals ("you forgot X",
//! "you skipped X", "missing X", etc.) and maps them to canonical workflow
//! step names. Over time, frequently-missed steps can be auto-promoted to
//! required checkpoints.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{BufRead, Write};
use std::path::Path;

// ── Correction record ─────────────────────────────────────────────────────

/// A single recorded correction — one instance where a user told the agent
/// it missed or forgot a step.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Correction {
    pub timestamp: String,
    pub session_id: String,
    pub missed_step: String,
    pub correction_text: String,
}

// ── Pattern table ─────────────────────────────────────────────────────────

/// A (regex pattern, mapped step name) pair.
struct CorrectionPattern {
    regex: regex::Regex,
    step: &'static str,
}

/// Build the 17 correction-detection patterns.
/// Each regex is case-insensitive and matches common user correction phrasing.
fn build_patterns() -> Vec<CorrectionPattern> {
    let raw: Vec<(&str, &str)> = vec![
        // "forgot" family
        (r"(?i)you\s+forgot\s+(?:to\s+)?(\w+)", "generic"),
        (r"(?i)forgot\s+(?:to\s+)?search", "search"),
        (r"(?i)forgot\s+(?:to\s+)?test", "test_run"),
        (r"(?i)forgot\s+(?:to\s+)?build", "build_verify"),
        (r"(?i)forgot\s+(?:to\s+)?(?:check|qa|review)", "qa_audit"),
        // "didn't / did not" family
        (r"(?i)you\s+didn'?t\s+(?:run\s+)?search", "search"),
        (r"(?i)you\s+didn'?t\s+(?:run\s+)?test", "test_run"),
        (r"(?i)you\s+didn'?t\s+(?:run\s+)?(?:preview|check\s+the\s+ui)", "visual_check"),
        (r"(?i)you\s+didn'?t\s+(?:run\s+)?build", "build_verify"),
        // "skipped" family
        (r"(?i)you\s+skipped\s+(?:the\s+)?search", "search"),
        (r"(?i)you\s+skipped\s+(?:the\s+)?test", "test_run"),
        (r"(?i)you\s+skipped\s+(?:the\s+)?(?:qa|review|audit)", "qa_audit"),
        // "missed / missing" family
        (r"(?i)you\s+missed\s+(?:the\s+)?(\w+)", "generic"),
        (r"(?i)missing\s+(?:the\s+)?(?:search|lookup)", "search"),
        // "where's" / "no X" / "what about" family
        (r"(?i)where'?s\s+the\s+(?:search|lookup)", "search"),
        (r"(?i)no\s+(?:test|tests)\b", "test_run"),
        (r"(?i)what\s+about\s+(?:the\s+)?(?:qa|review|testing|tests)", "qa_audit"),
    ];

    raw.into_iter()
        .filter_map(|(pat, step)| {
            regex::Regex::new(pat)
                .ok()
                .map(|regex| CorrectionPattern { regex, step })
        })
        .collect()
}

// ── Keyword → step fallback mapping ───────────────────────────────────────

/// When a generic pattern matches, try to resolve the captured keyword to a
/// canonical step name.
fn keyword_to_step(keyword: &str) -> &'static str {
    match keyword.to_lowercase().as_str() {
        "search" | "lookup" | "find" | "query" => "search",
        "test" | "tests" | "testing" => "test_run",
        "qa" | "review" | "audit" | "check" => "qa_audit",
        "preview" | "ui" | "visual" | "screenshot" => "visual_check",
        "build" | "compile" | "bundle" => "build_verify",
        "lint" | "format" | "fmt" => "lint_format",
        "deploy" | "ship" | "release" => "deploy",
        "commit" | "push" | "pr" => "version_control",
        _ => "unknown",
    }
}

// ── CorrectionLearner ─────────────────────────────────────────────────────

/// Learns from user corrections to tighten future workflow steps.
///
/// Tracks which steps are frequently missed and can recommend that those
/// steps be promoted to mandatory checkpoints.
pub struct CorrectionLearner {
    corrections: Vec<Correction>,
    patterns: HashMap<String, usize>,
    compiled_patterns: Vec<CorrectionPattern>,
}

impl CorrectionLearner {
    /// Create a new empty learner.
    pub fn new() -> Self {
        Self {
            corrections: Vec::new(),
            patterns: HashMap::new(),
            compiled_patterns: build_patterns(),
        }
    }

    /// Scan a user prompt for correction signals.
    ///
    /// Returns `Some(step_name)` if a correction pattern matched, `None` otherwise.
    pub fn detect_correction(&self, prompt: &str) -> Option<String> {
        for cp in &self.compiled_patterns {
            if let Some(captures) = cp.regex.captures(prompt) {
                if cp.step == "generic" {
                    // Try to resolve the captured group to a step name
                    if let Some(m) = captures.get(1) {
                        let resolved = keyword_to_step(m.as_str());
                        if resolved != "unknown" {
                            return Some(resolved.to_string());
                        }
                    }
                    // Generic matched but keyword not resolvable — still a correction
                    return Some("unknown".to_string());
                }
                return Some(cp.step.to_string());
            }
        }
        None
    }

    /// Record a correction: the user told us we missed `missed_step`.
    pub fn record(&mut self, session_id: &str, missed_step: &str, text: &str) {
        self.corrections.push(Correction {
            timestamp: chrono::Utc::now().to_rfc3339(),
            session_id: session_id.to_string(),
            missed_step: missed_step.to_string(),
            correction_text: text.to_string(),
        });
        *self.patterns.entry(missed_step.to_string()).or_insert(0) += 1;
    }

    /// Return all steps whose correction count meets or exceeds `threshold`.
    ///
    /// These are candidates for being promoted to mandatory workflow checkpoints.
    pub fn get_tightened_steps(&self, threshold: usize) -> Vec<(String, usize)> {
        let mut result: Vec<(String, usize)> = self
            .patterns
            .iter()
            .filter(|(_, count)| **count >= threshold)
            .map(|(step, count)| (step.clone(), *count))
            .collect();
        result.sort_by(|a, b| b.1.cmp(&a.1)); // highest count first
        result
    }

    /// Total number of recorded corrections.
    pub fn correction_count(&self) -> usize {
        self.corrections.len()
    }

    /// Get the pattern frequency map (step -> count).
    pub fn pattern_counts(&self) -> &HashMap<String, usize> {
        &self.patterns
    }

    /// Save all corrections to a JSONL file.
    pub fn save(&self, path: &Path) -> std::io::Result<()> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let mut file = std::fs::File::create(path)?;
        for correction in &self.corrections {
            let line = serde_json::to_string(correction)
                .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
            writeln!(file, "{}", line)?;
        }
        Ok(())
    }

    /// Load corrections from a JSONL file, rebuilding the pattern map.
    pub fn load(path: &Path) -> std::io::Result<Self> {
        let file = std::fs::File::open(path)?;
        let reader = std::io::BufReader::new(file);
        let mut learner = Self::new();

        for line in reader.lines() {
            let line = line?;
            let trimmed = line.trim();
            if trimmed.is_empty() {
                continue;
            }
            let correction: Correction = serde_json::from_str(trimmed)
                .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
            *learner
                .patterns
                .entry(correction.missed_step.clone())
                .or_insert(0) += 1;
            learner.corrections.push(correction);
        }

        Ok(learner)
    }
}

impl Default for CorrectionLearner {
    fn default() -> Self {
        Self::new()
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn test_detect_forgot_search() {
        let learner = CorrectionLearner::new();
        assert_eq!(
            learner.detect_correction("you forgot to search for the error"),
            Some("search".to_string())
        );
        assert_eq!(
            learner.detect_correction("You forgot search"),
            Some("search".to_string())
        );
    }

    #[test]
    fn test_detect_skipped_test() {
        let learner = CorrectionLearner::new();
        assert_eq!(
            learner.detect_correction("you skipped the test"),
            Some("test_run".to_string())
        );
        assert_eq!(
            learner.detect_correction("You skipped the tests suite"),
            Some("test_run".to_string())
        );
    }

    #[test]
    fn test_detect_didnt_preview() {
        let learner = CorrectionLearner::new();
        assert_eq!(
            learner.detect_correction("you didn't preview the changes"),
            Some("visual_check".to_string())
        );
        assert_eq!(
            learner.detect_correction("you didn't check the ui"),
            Some("visual_check".to_string())
        );
    }

    #[test]
    fn test_detect_missing_search() {
        let learner = CorrectionLearner::new();
        assert_eq!(
            learner.detect_correction("missing the search step"),
            Some("search".to_string())
        );
    }

    #[test]
    fn test_detect_no_tests() {
        let learner = CorrectionLearner::new();
        assert_eq!(
            learner.detect_correction("no tests were run"),
            Some("test_run".to_string())
        );
    }

    #[test]
    fn test_detect_wheres_search() {
        let learner = CorrectionLearner::new();
        assert_eq!(
            learner.detect_correction("where's the search?"),
            Some("search".to_string())
        );
    }

    #[test]
    fn test_detect_what_about_qa() {
        let learner = CorrectionLearner::new();
        assert_eq!(
            learner.detect_correction("what about the qa step?"),
            Some("qa_audit".to_string())
        );
        assert_eq!(
            learner.detect_correction("what about testing?"),
            Some("qa_audit".to_string())
        );
    }

    #[test]
    fn test_no_correction_in_normal_prompt() {
        let learner = CorrectionLearner::new();
        assert_eq!(
            learner.detect_correction("please search for the latest news about AI"),
            None
        );
        assert_eq!(
            learner.detect_correction("can you help me write a test?"),
            None
        );
        assert_eq!(
            learner.detect_correction("I need to build a new feature"),
            None
        );
        assert_eq!(
            learner.detect_correction("how do I deploy to production?"),
            None
        );
    }

    #[test]
    fn test_record_and_counts() {
        let mut learner = CorrectionLearner::new();
        learner.record("sess1", "search", "you forgot to search");
        learner.record("sess2", "search", "you skipped the search");
        learner.record("sess3", "test_run", "no tests were run");

        assert_eq!(learner.correction_count(), 3);
        assert_eq!(learner.patterns.get("search"), Some(&2));
        assert_eq!(learner.patterns.get("test_run"), Some(&1));
    }

    #[test]
    fn test_tightened_steps_threshold() {
        let mut learner = CorrectionLearner::new();
        // Record search 5 times, test_run 3 times, qa_audit 1 time
        for i in 0..5 {
            learner.record(&format!("s{}", i), "search", "forgot search");
        }
        for i in 0..3 {
            learner.record(&format!("t{}", i), "test_run", "forgot test");
        }
        learner.record("q0", "qa_audit", "forgot qa");

        // Threshold 3: search (5) and test_run (3) qualify
        let tightened = learner.get_tightened_steps(3);
        assert_eq!(tightened.len(), 2);
        assert_eq!(tightened[0].0, "search"); // highest first
        assert_eq!(tightened[0].1, 5);
        assert_eq!(tightened[1].0, "test_run");
        assert_eq!(tightened[1].1, 3);

        // Threshold 4: only search qualifies
        let tightened = learner.get_tightened_steps(4);
        assert_eq!(tightened.len(), 1);
        assert_eq!(tightened[0].0, "search");

        // Threshold 6: nothing qualifies
        let tightened = learner.get_tightened_steps(6);
        assert!(tightened.is_empty());
    }

    #[test]
    fn test_save_load_roundtrip() {
        let mut learner = CorrectionLearner::new();
        learner.record("sess1", "search", "you forgot to search");
        learner.record("sess2", "test_run", "you skipped the test");
        learner.record("sess3", "search", "missing the search step");

        // Save to temp file
        let dir = std::env::temp_dir().join("attrition_test_learner");
        let path = dir.join("corrections.jsonl");
        learner.save(&path).expect("save should succeed");

        // Load back
        let loaded = CorrectionLearner::load(&path).expect("load should succeed");
        assert_eq!(loaded.correction_count(), 3);
        assert_eq!(loaded.patterns.get("search"), Some(&2));
        assert_eq!(loaded.patterns.get("test_run"), Some(&1));

        // Verify correction content
        assert_eq!(loaded.corrections[0].session_id, "sess1");
        assert_eq!(loaded.corrections[0].missed_step, "search");
        assert_eq!(loaded.corrections[1].missed_step, "test_run");
        assert_eq!(loaded.corrections[2].missed_step, "search");

        // Cleanup
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_load_nonexistent_file() {
        let path = PathBuf::from("/tmp/attrition_nonexistent_9999.jsonl");
        let result = CorrectionLearner::load(&path);
        assert!(result.is_err());
    }

    #[test]
    fn test_generic_keyword_resolution() {
        let learner = CorrectionLearner::new();
        // "you forgot tests" -> generic pattern captures "tests" -> resolves to test_run
        assert_eq!(
            learner.detect_correction("you forgot tests"),
            Some("test_run".to_string())
        );
        // "you missed the build" -> generic pattern captures "build" -> resolves to build_verify
        assert_eq!(
            learner.detect_correction("you missed the build"),
            Some("build_verify".to_string())
        );
    }

    #[test]
    fn test_detect_didnt_build() {
        let learner = CorrectionLearner::new();
        assert_eq!(
            learner.detect_correction("you didn't build the project"),
            Some("build_verify".to_string())
        );
        assert_eq!(
            learner.detect_correction("you didn't run build"),
            Some("build_verify".to_string())
        );
    }

    #[test]
    fn test_detect_forgot_qa() {
        let learner = CorrectionLearner::new();
        assert_eq!(
            learner.detect_correction("you forgot to check the code"),
            Some("qa_audit".to_string())
        );
        assert_eq!(
            learner.detect_correction("forgot to qa"),
            Some("qa_audit".to_string())
        );
    }
}
