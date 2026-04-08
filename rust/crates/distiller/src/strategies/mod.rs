//! Distillation strategies for compressing and optimizing workflow event streams.
//!
//! Each strategy operates on a different axis:
//! - `step_elimination` — remove redundant/dead-end steps
//! - `copy_paste_block` — extract deterministic outputs for injection
//! - `context_compress` — shrink verbose reasoning blocks
//! - `checkpoint_prune` — extract verification checkpoints

pub mod checkpoint_prune;
pub mod context_compress;
pub mod copy_paste_block;
pub mod step_elimination;
