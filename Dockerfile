# =============================================================================
# attrition — multi-stage Docker build for GCP Cloud Run
# Produces a single binary that serves API + React frontend + MCP endpoint
# =============================================================================

# ---------------------------------------------------------------------------
# Stage 1: Build Rust backend
# ---------------------------------------------------------------------------
FROM rust:1.86-bookworm AS rust-builder
WORKDIR /app

# Cache dependency build — copy manifests first
COPY Cargo.toml Cargo.lock ./
COPY rust/ rust/

# Build release binary (the CLI crate produces the `bp` binary)
RUN cargo build --release -p attrition-cli

# ---------------------------------------------------------------------------
# Stage 2: Build React frontend
# ---------------------------------------------------------------------------
FROM node:22-bookworm AS frontend-builder
WORKDIR /app/frontend

# Cache npm install
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

# Build production bundle
COPY frontend/ .
RUN npm run build

# ---------------------------------------------------------------------------
# Stage 3: Minimal runtime image
# ---------------------------------------------------------------------------
FROM debian:bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates python3 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy the release binary
COPY --from=rust-builder /app/target/release/bp /usr/local/bin/bp

# Copy frontend static files — served by the Rust binary at /
COPY --from=frontend-builder /app/frontend/dist /app/static

# Copy benchmark data and Claude plugin config
COPY benchmarks/ /app/benchmarks/
COPY .claude-plugin/ /app/.claude-plugin/

# Cloud Run injects $PORT but we default to 8080
ENV PORT=8080
ENV BP_HOST=0.0.0.0
ENV BP_PORT=8080
ENV ATTRITION_STATIC_DIR=/app/static

EXPOSE 8080

# Single binary serves API + static frontend + MCP
CMD ["bp", "serve", "--host", "0.0.0.0", "--port", "8080"]
