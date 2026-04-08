//! benchpress-sdk: Rust SDK for consuming benchpress services
//!
//! Provides a typed client for external applications to interact with
//! the benchpress API and MCP server.

use benchpress_core::types::{QaResult, SitemapResult, UxAuditResult};
use benchpress_core::Result;
use serde::Deserialize;

/// Client for the benchpress API
pub struct BpClient {
    base_url: String,
    client: reqwest::Client,
    auth_token: Option<String>,
}

impl BpClient {
    /// Create a new client pointing at a benchpress server
    pub fn new(base_url: &str) -> Self {
        Self {
            base_url: base_url.trim_end_matches('/').to_string(),
            client: reqwest::Client::new(),
            auth_token: None,
        }
    }

    /// Set an authentication token
    pub fn with_auth(mut self, token: &str) -> Self {
        self.auth_token = Some(token.to_string());
        self
    }

    /// Build a request with auth header if token is set
    fn authed_get(&self, url: String) -> reqwest::RequestBuilder {
        let mut req = self.client.get(url);
        if let Some(ref token) = self.auth_token {
            req = req.header("Authorization", format!("Bearer {}", token));
        }
        req
    }

    fn authed_post(&self, url: String) -> reqwest::RequestBuilder {
        let mut req = self.client.post(url);
        if let Some(ref token) = self.auth_token {
            req = req.header("Authorization", format!("Bearer {}", token));
        }
        req
    }

    /// Run a QA check on a URL
    pub async fn qa_check(&self, url: &str) -> Result<QaResult> {
        let resp = self
            .authed_post(format!("{}/api/qa/check", self.base_url))
            .json(&serde_json::json!({ "url": url }))
            .send()
            .await?;

        let result: QaResult = resp.json().await.map_err(|e| {
            benchpress_core::Error::Internal(format!("Failed to parse QA result: {}", e))
        })?;
        Ok(result)
    }

    /// Generate a sitemap for a URL
    pub async fn sitemap(&self, url: &str, max_depth: u8, max_pages: usize) -> Result<SitemapResult> {
        let resp = self
            .authed_post(format!("{}/api/qa/sitemap", self.base_url))
            .json(&serde_json::json!({
                "url": url,
                "max_depth": max_depth,
                "max_pages": max_pages,
            }))
            .send()
            .await?;

        let result: SitemapResult = resp.json().await.map_err(|e| {
            benchpress_core::Error::Internal(format!("Failed to parse sitemap: {}", e))
        })?;
        Ok(result)
    }

    /// Run a UX audit on a URL
    pub async fn ux_audit(&self, url: &str) -> Result<UxAuditResult> {
        let resp = self
            .authed_post(format!("{}/api/qa/ux-audit", self.base_url))
            .json(&serde_json::json!({ "url": url }))
            .send()
            .await?;

        let result: UxAuditResult = resp.json().await.map_err(|e| {
            benchpress_core::Error::Internal(format!("Failed to parse UX audit: {}", e))
        })?;
        Ok(result)
    }

    /// Check server health
    pub async fn health(&self) -> Result<HealthResponse> {
        let resp = self
            .authed_get(format!("{}/health", self.base_url))
            .send()
            .await?;

        let result: HealthResponse = resp.json().await.map_err(|e| {
            benchpress_core::Error::Internal(format!("Failed to parse health: {}", e))
        })?;
        Ok(result)
    }
}

#[derive(Debug, Deserialize)]
pub struct HealthResponse {
    pub status: String,
    pub version: String,
    pub uptime_secs: u64,
}
