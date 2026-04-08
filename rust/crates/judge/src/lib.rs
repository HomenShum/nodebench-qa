//! attrition-judge: Workflow replay judgment engine
//!
//! Compares expected canonical event streams against actual replay outputs.
//! Produces verdicts (correct / partial / escalate / failed), divergence reports,
//! attention maps, and nudge hints for mid-replay correction.

pub mod attention;
pub mod diff;
pub mod engine;
pub mod learner;
pub mod types;

pub use types::*;
