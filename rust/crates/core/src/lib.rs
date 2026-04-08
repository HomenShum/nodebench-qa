//! benchpress-core: Core types, configuration, and error handling
//!
//! This crate provides the foundational types shared across all benchpress crates.
//! It is the dependency root — no other benchpress crate depends on anything
//! except this one.

pub mod config;
pub mod error;
pub mod types;

pub use config::AppConfig;
pub use error::{Error, Result};
