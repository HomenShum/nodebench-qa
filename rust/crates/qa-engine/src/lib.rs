//! benchpress-engine: QA engine for browser automation, crawling, and auditing
//!
//! This crate provides the core QA functionality:
//! - `qa` — Full QA check (JS errors, a11y, rendering, performance)
//! - `crawl` — Site crawling and sitemap generation
//! - `audit` — UX audit against 21-rule checklist
//! - `diff` — Before/after comparison crawls
//! - `workflow` — Workflow recording and trajectory replay

pub mod audit;
pub mod crawl;
pub mod diff;
pub mod qa;
pub mod workflow;
