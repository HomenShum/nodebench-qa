use anyhow::Result;
use clap::{Parser, Subcommand};

const BANNER: &str = r#"
    ____                  _     ____
   | __ )  ___ _ __   ___| |__ |  _ \ _ __ ___  ___ ___
   |  _ \ / _ \ '_ \ / __| '_ \| |_) | '__/ _ \/ __/ __|
   | |_) |  __/ | | | (__| | | |  __/| | |  __/\__ \__ \
   |____/ \___|_| |_|\___|_| |_|_|   |_|  \___||___/___/
   benchpress — workflow memory + distillation engine
"#;

#[derive(Parser)]
#[command(name = "bp")]
#[command(version = env!("CARGO_PKG_VERSION"))]
#[command(about = "Workflow memory + distillation engine")]
#[command(long_about = "benchpress: Capture frontier model workflows, distill for cheaper replay.\nRust rewrite with MCP protocol support.")]
struct Cli {
    #[command(subcommand)]
    command: Commands,

    /// Enable JSON output
    #[arg(long)]
    json: bool,

    /// Verbose logging
    #[arg(short, long)]
    verbose: bool,
}

#[derive(Subcommand)]
enum Commands {
    /// Start the benchpress server (API + MCP)
    Serve {
        /// Host to bind to
        #[arg(long, default_value = "0.0.0.0")]
        host: String,

        /// API server port
        #[arg(long, default_value_t = 8100)]
        port: u16,

        /// Also start the MCP server
        #[arg(long, default_value_t = true)]
        mcp: bool,

        /// MCP server port
        #[arg(long, default_value_t = 8101)]
        mcp_port: u16,
    },

    /// Run a QA check on a URL
    Check {
        /// URL to check
        url: String,

        /// Timeout in milliseconds
        #[arg(long, default_value_t = 30000)]
        timeout: u64,
    },

    /// Generate a sitemap for a URL
    Sitemap {
        /// Root URL to crawl
        url: String,

        /// Maximum crawl depth
        #[arg(long, default_value_t = 3)]
        depth: u8,

        /// Maximum pages to crawl
        #[arg(long, default_value_t = 50)]
        max_pages: usize,
    },

    /// Run a UX audit on a URL
    Audit {
        /// URL to audit
        url: String,
    },

    /// Run a diff crawl comparing current state to baseline
    Diff {
        /// URL to diff crawl
        url: String,

        /// Baseline crawl ID to compare against
        #[arg(long)]
        baseline: Option<String>,
    },

    /// Run the full QA pipeline
    Pipeline {
        /// URL to run the pipeline on
        url: String,
    },

    /// Show server health status
    Health {
        /// Server URL to check
        #[arg(default_value = "http://localhost:8100")]
        url: String,
    },

    /// Show version and system info
    Info,
}

#[tokio::main]
async fn main() -> Result<()> {
    let cli = Cli::parse();

    // Init telemetry — verbose flag controls filter level without unsafe set_var
    benchpress_telemetry::init_with_level(if cli.verbose { "debug" } else { "info" });

    match cli.command {
        Commands::Serve { host, port, mcp, mcp_port } => {
            println!("{}", BANNER);
            println!("  API server: http://{}:{}", host, port);
            if mcp {
                println!("  MCP server: http://{}:{}/mcp", host, mcp_port);
            }
            println!();

            let config = benchpress_core::AppConfig {
                server: benchpress_core::config::ServerConfig {
                    host: host.clone(),
                    port,
                    ..Default::default()
                },
                mcp: benchpress_core::config::McpConfig {
                    enabled: mcp,
                    port: mcp_port,
                    auth_token: None,
                },
                ..Default::default()
            };

            let app = benchpress_api::build_router(&config);

            // Mount MCP server on separate port if enabled
            if mcp {
                let mcp_router = benchpress_mcp::build_mcp_router();
                let mcp_listener = tokio::net::TcpListener::bind(format!("{}:{}", host, mcp_port)).await?;
                tracing::info!("MCP server listening on {}:{}", host, mcp_port);
                tokio::spawn(async move {
                    if let Err(e) = axum::serve(mcp_listener, mcp_router).await {
                        tracing::error!("MCP server error: {}", e);
                    }
                });
            }

            let listener = tokio::net::TcpListener::bind(format!("{}:{}", host, port)).await?;
            tracing::info!("benchpress API server listening on {}:{}", host, port);
            axum::serve(listener, app).await?;
        }

        Commands::Check { url, timeout } => {
            let result = benchpress_engine::qa::run_qa_check(&url, timeout).await?;
            if cli.json {
                println!("{}", serde_json::to_string_pretty(&result)?);
            } else {
                println!("QA Check: {}", url);
                println!("  Score: {}/100", result.score.overall);
                println!("  Issues: {}", result.issues.len());
                println!("  Duration: {}ms", result.duration_ms);
                for issue in &result.issues {
                    println!("  [{:?}] {}: {}", issue.severity, issue.title, issue.description);
                }
            }
        }

        Commands::Sitemap { url, depth, max_pages } => {
            let result = benchpress_engine::crawl::crawl_sitemap(&url, depth, max_pages).await?;
            if cli.json {
                println!("{}", serde_json::to_string_pretty(&result)?);
            } else {
                println!("Sitemap: {}", url);
                println!("  Pages found: {}", result.total_pages);
                println!("  Duration: {}ms", result.crawl_duration_ms);
                for page in &result.pages {
                    println!("  [{}] {} — {:?}", page.status, page.url, page.title.as_deref().unwrap_or("(no title)"));
                }
            }
        }

        Commands::Audit { url } => {
            let result = benchpress_engine::audit::run_ux_audit(&url).await?;
            if cli.json {
                println!("{}", serde_json::to_string_pretty(&result)?);
            } else {
                println!("UX Audit: {}", url);
                println!("  Score: {}/100", result.score);
                println!("  Passed: {}/{}", result.rules_passed, result.rules_checked);
                println!("  Duration: {}ms", result.duration_ms);
                for finding in &result.findings {
                    let status = if finding.passed { "PASS" } else { "FAIL" };
                    println!("  [{}] {}: {}", status, finding.rule_name, finding.detail);
                    if let Some(rec) = &finding.recommendation {
                        println!("         Recommendation: {}", rec);
                    }
                }
            }
        }

        Commands::Diff { url, baseline } => {
            let result = benchpress_engine::diff::run_diff_crawl(&url, baseline.as_deref()).await?;
            if cli.json {
                println!("{}", serde_json::to_string_pretty(&result)?);
            } else {
                println!("Diff Crawl: {}", url);
                println!("  {}", result.summary);
                for diff in &result.diffs {
                    println!("  [{:?}] {}: {}", diff.diff_type, diff.url, diff.detail);
                }
            }
        }

        Commands::Pipeline { url } => {
            let result = benchpress_agents::pipeline::run_pipeline(&url).await?;
            if cli.json {
                println!("{}", serde_json::to_string_pretty(&result)?);
            } else {
                println!("Pipeline: {}", url);
                println!("  Status: {:?}", result.status);
                for stage in &result.stages {
                    println!("  [{:?}] {:?} — {}ms", stage.status, stage.stage, stage.duration_ms);
                }
            }
        }

        Commands::Health { url } => {
            let client = benchpress_sdk::BpClient::new(&url);
            match client.health().await {
                Ok(health) => {
                    println!("Server: {} (v{})", health.status, health.version);
                    println!("Uptime: {}s", health.uptime_secs);
                }
                Err(e) => {
                    eprintln!("Failed to reach server at {}: {}", url, e);
                    std::process::exit(1);
                }
            }
        }

        Commands::Info => {
            println!("{}", BANNER);
            println!("  Version: {}", env!("CARGO_PKG_VERSION"));
            println!("  Platform: {} / {}", std::env::consts::OS, std::env::consts::ARCH);
            println!("  Config dir: {}", benchpress_core::AppConfig::config_dir().display());
            println!("  Data dir: {}", benchpress_core::AppConfig::data_dir().display());
        }
    }

    Ok(())
}
