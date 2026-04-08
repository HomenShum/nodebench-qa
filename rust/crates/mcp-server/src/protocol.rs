use axum::{extract::State, Json};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use crate::McpState;

/// JSON-RPC 2.0 request
#[derive(Debug, Deserialize)]
pub struct JsonRpcRequest {
    pub jsonrpc: String,
    pub id: serde_json::Value,
    pub method: String,
    #[serde(default)]
    pub params: serde_json::Value,
}

/// JSON-RPC 2.0 response
#[derive(Debug, Serialize)]
pub struct JsonRpcResponse {
    pub jsonrpc: &'static str,
    pub id: serde_json::Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<JsonRpcError>,
}

#[derive(Debug, Serialize)]
pub struct JsonRpcError {
    pub code: i32,
    pub message: String,
}

/// Handle incoming JSON-RPC requests
pub async fn handle_jsonrpc(
    State(state): State<Arc<McpState>>,
    Json(req): Json<JsonRpcRequest>,
) -> Json<JsonRpcResponse> {
    let result = match req.method.as_str() {
        "initialize" => handle_initialize(&state),
        "tools/list" => handle_tools_list(&state),
        "tools/call" => handle_tools_call(&state, &req.params).await,
        _ => Err(JsonRpcError {
            code: -32601,
            message: format!("Method not found: {}", req.method),
        }),
    };

    Json(match result {
        Ok(value) => JsonRpcResponse {
            jsonrpc: "2.0",
            id: req.id,
            result: Some(value),
            error: None,
        },
        Err(error) => JsonRpcResponse {
            jsonrpc: "2.0",
            id: req.id,
            result: None,
            error: Some(error),
        },
    })
}

fn handle_initialize(_state: &McpState) -> std::result::Result<serde_json::Value, JsonRpcError> {
    Ok(serde_json::json!({
        "protocolVersion": "2024-11-05",
        "capabilities": {
            "tools": {}
        },
        "serverInfo": {
            "name": "benchpress",
            "version": env!("CARGO_PKG_VERSION")
        }
    }))
}

fn handle_tools_list(state: &McpState) -> std::result::Result<serde_json::Value, JsonRpcError> {
    let tools: Vec<serde_json::Value> = state
        .tools
        .iter()
        .map(|t| {
            serde_json::json!({
                "name": t.name,
                "description": t.description,
                "inputSchema": t.input_schema,
            })
        })
        .collect();

    Ok(serde_json::json!({ "tools": tools }))
}

async fn handle_tools_call(
    state: &McpState,
    params: &serde_json::Value,
) -> std::result::Result<serde_json::Value, JsonRpcError> {
    let tool_name = params
        .get("name")
        .and_then(|v| v.as_str())
        .ok_or(JsonRpcError {
            code: -32602,
            message: "Missing tool name".into(),
        })?;

    let tool_args = params.get("arguments").cloned().unwrap_or_default();

    let tool = state
        .tools
        .iter()
        .find(|t| t.name == tool_name)
        .ok_or(JsonRpcError {
            code: -32602,
            message: format!("Unknown tool: {}", tool_name),
        })?;

    let result = (tool.handler)(tool_args)
        .await
        .map_err(|e| JsonRpcError {
            code: -32603,
            message: e.to_string(),
        })?;

    Ok(serde_json::json!({
        "content": [{
            "type": "text",
            "text": serde_json::to_string_pretty(&result).unwrap_or_default()
        }]
    }))
}
