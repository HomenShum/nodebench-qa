//! benchpress-api: Axum HTTP API server
//!
//! Provides the REST API for QA operations, agent orchestration,
//! and frontend communication.

pub mod routes;
pub mod state;

use axum::Router;
use benchpress_core::AppConfig;
use state::AppState;
use std::sync::Arc;
use tower_http::cors::{Any, CorsLayer};
use tower_http::trace::TraceLayer;

/// Build the complete Axum router with all routes mounted
pub fn build_router(config: &AppConfig) -> Router {
    let state = Arc::new(AppState::new(config.clone()));

    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    Router::new()
        .nest("/api", routes::api_routes())
        .nest("/health", routes::health_routes())
        .with_state(state)
        .layer(cors)
        .layer(TraceLayer::new_for_http())
}
