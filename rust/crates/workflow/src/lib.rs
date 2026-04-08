//! benchpress-workflow: Canonical event stream capture and storage
//!
//! Captures coding agent sessions (Claude Code, raw API, generic) into a
//! canonical event format. Stores workflows in SQLite for replay and distillation.

pub mod types;
pub mod storage;
pub mod adapters;

pub use types::*;
