//! benchpress-agents: Multi-agent orchestration
//!
//! Hierarchical agent system:
//! - Coordinator: Routes tasks to specialist agents
//! - QA Pipeline: Crawl → Test → Execute → Verify
//! - Device Testing: Mobile device automation via MCP
//! - OAVR Sub-agents: Observe-Act-Verify-Reason pattern

pub mod coordinator;
pub mod oavr;
pub mod pipeline;
