//! benchpress-mcp: MCP (Model Context Protocol) server
//!
//! Exposes workflow capture and distillation tools via JSON-RPC over HTTP
//! for AI coding agents (Claude Code, Cursor, Windsurf, Devin, etc.)

pub mod protocol;
pub mod tools;

use axum::{routing::post, Router};
use std::sync::Arc;

pub struct McpState {
    pub tools: Vec<tools::McpTool>,
}

impl McpState {
    pub fn new() -> Self {
        Self {
            tools: tools::register_all(),
        }
    }
}

impl Default for McpState {
    fn default() -> Self {
        Self::new()
    }
}

/// Build the MCP server router
pub fn build_mcp_router() -> Router {
    let state = Arc::new(McpState::new());

    Router::new()
        .route("/mcp", post(protocol::handle_jsonrpc))
        .with_state(state)
}
