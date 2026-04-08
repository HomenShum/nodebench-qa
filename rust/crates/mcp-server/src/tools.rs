use std::future::Future;
use std::pin::Pin;

/// An MCP tool definition
pub struct McpTool {
    pub name: &'static str,
    pub description: &'static str,
    pub input_schema: serde_json::Value,
    pub handler: fn(serde_json::Value) -> Pin<Box<dyn Future<Output = benchpress_core::Result<serde_json::Value>> + Send>>,
}

/// Register all available MCP tools
pub fn register_all() -> Vec<McpTool> {
    vec![
        McpTool {
            name: "bp.check",
            description: "Run a full QA check on a URL — JS errors, accessibility, rendering, performance",
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "url": {
                        "type": "string",
                        "description": "The URL to QA check"
                    },
                    "timeout_ms": {
                        "type": "integer",
                        "description": "Timeout in milliseconds (default: 30000)",
                        "default": 30000
                    }
                },
                "required": ["url"]
            }),
            handler: |args| Box::pin(tool_qa_check(args)),
        },
        McpTool {
            name: "bp.sitemap",
            description: "Crawl a website and generate an interactive sitemap with screenshots",
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "url": {
                        "type": "string",
                        "description": "Root URL to crawl"
                    },
                    "max_depth": {
                        "type": "integer",
                        "description": "Maximum crawl depth (default: 3)",
                        "default": 3
                    },
                    "max_pages": {
                        "type": "integer",
                        "description": "Maximum pages to crawl (default: 50)",
                        "default": 50
                    }
                },
                "required": ["url"]
            }),
            handler: |args| Box::pin(tool_sitemap(args)),
        },
        McpTool {
            name: "bp.ux_audit",
            description: "Run a 21-rule UX audit with scoring and actionable recommendations",
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "url": {
                        "type": "string",
                        "description": "URL to audit"
                    }
                },
                "required": ["url"]
            }),
            handler: |args| Box::pin(tool_ux_audit(args)),
        },
        McpTool {
            name: "bp.diff_crawl",
            description: "Compare current site state against a previous baseline crawl",
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "url": {
                        "type": "string",
                        "description": "URL to diff crawl"
                    },
                    "baseline_id": {
                        "type": "string",
                        "description": "ID of the baseline crawl to compare against"
                    }
                },
                "required": ["url"]
            }),
            handler: |args| Box::pin(tool_diff_crawl(args)),
        },
        McpTool {
            name: "bp.workflow",
            description: "Start a workflow recording for trajectory replay (60-70% token savings on reruns)",
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "url": {
                        "type": "string",
                        "description": "URL to start workflow on"
                    },
                    "name": {
                        "type": "string",
                        "description": "Name for this workflow"
                    }
                },
                "required": ["url"]
            }),
            handler: |args| Box::pin(tool_workflow(args)),
        },
        McpTool {
            name: "bp.pipeline",
            description: "Run the full QA pipeline: crawl, analyze, test, verify, report",
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "url": {
                        "type": "string",
                        "description": "URL to run the full pipeline on"
                    }
                },
                "required": ["url"]
            }),
            handler: |args| Box::pin(tool_pipeline(args)),
        },
    ]
}

async fn tool_qa_check(args: serde_json::Value) -> benchpress_core::Result<serde_json::Value> {
    let url = args.get("url").and_then(|v| v.as_str()).unwrap_or("");
    let timeout = args.get("timeout_ms").and_then(|v| v.as_u64()).unwrap_or(30_000);
    let result = benchpress_engine::qa::run_qa_check(url, timeout).await?;
    serde_json::to_value(result).map_err(|e| benchpress_core::Error::Internal(e.to_string()))
}

async fn tool_sitemap(args: serde_json::Value) -> benchpress_core::Result<serde_json::Value> {
    let url = args.get("url").and_then(|v| v.as_str()).unwrap_or("");
    let max_depth = args.get("max_depth").and_then(|v| v.as_u64()).unwrap_or(3) as u8;
    let max_pages = args.get("max_pages").and_then(|v| v.as_u64()).unwrap_or(50) as usize;
    let result = benchpress_engine::crawl::crawl_sitemap(url, max_depth, max_pages).await?;
    serde_json::to_value(result).map_err(|e| benchpress_core::Error::Internal(e.to_string()))
}

async fn tool_ux_audit(args: serde_json::Value) -> benchpress_core::Result<serde_json::Value> {
    let url = args.get("url").and_then(|v| v.as_str()).unwrap_or("");
    let result = benchpress_engine::audit::run_ux_audit(url).await?;
    serde_json::to_value(result).map_err(|e| benchpress_core::Error::Internal(e.to_string()))
}

async fn tool_diff_crawl(args: serde_json::Value) -> benchpress_core::Result<serde_json::Value> {
    let url = args.get("url").and_then(|v| v.as_str()).unwrap_or("");
    let baseline_id = args.get("baseline_id").and_then(|v| v.as_str());
    let result = benchpress_engine::diff::run_diff_crawl(url, baseline_id).await?;
    serde_json::to_value(result).map_err(|e| benchpress_core::Error::Internal(e.to_string()))
}

async fn tool_workflow(args: serde_json::Value) -> benchpress_core::Result<serde_json::Value> {
    let url = args.get("url").and_then(|v| v.as_str()).unwrap_or("");
    let name = args.get("name").and_then(|v| v.as_str()).unwrap_or("unnamed");
    let result = benchpress_engine::workflow::start_workflow(url, name).await?;
    serde_json::to_value(result).map_err(|e| benchpress_core::Error::Internal(e.to_string()))
}

async fn tool_pipeline(args: serde_json::Value) -> benchpress_core::Result<serde_json::Value> {
    let url = args.get("url").and_then(|v| v.as_str()).unwrap_or("");
    let result = benchpress_agents::pipeline::run_pipeline(url).await?;
    serde_json::to_value(result).map_err(|e| benchpress_core::Error::Internal(e.to_string()))
}
