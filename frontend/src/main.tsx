/**
 * attrition.sh — three pages only.
 *   /             Architect  — chat-first intake + triage
 *   /build/:slug  Builder    — generated scaffold + eval + world-model
 *   /radar        Radar      — normalized architecture intelligence
 *
 * Internal operator views live under /_internal/* and are not linked
 * from the public nav.
 */

import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { ConvexProvider, ConvexReactClient } from "convex/react";
import { Architect } from "./pages/Architect";
import { Builder } from "./pages/Builder";
import { NextSteps } from "./pages/NextSteps";
import { Run } from "./pages/Run";
import { Radar } from "./pages/Radar";
import { Fidelity } from "./pages/Fidelity";
import { Telemetry } from "./pages/Telemetry";
import { ErrorBoundary } from "./components/ErrorBoundary";
import "./index.css";

const CONVEX_URL =
  (import.meta.env.VITE_CONVEX_URL as string | undefined) ||
  "https://joyous-walrus-428.convex.cloud";
const convex = new ConvexReactClient(CONVEX_URL);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ConvexProvider client={convex}>
      <BrowserRouter>
        <Routes>
          {/* Three public pages — each wrapped so a render error on one
              page doesn't blank the whole app. */}
          <Route
            path="/"
            element={
              <ErrorBoundary label="architect">
                <Architect />
              </ErrorBoundary>
            }
          />
          <Route
            path="/build"
            element={
              <ErrorBoundary label="builder">
                <Builder />
              </ErrorBoundary>
            }
          />
          <Route
            path="/build/:slug"
            element={
              <ErrorBoundary label="builder">
                <Builder />
              </ErrorBoundary>
            }
          />
          <Route
            path="/runs/:runId"
            element={
              <ErrorBoundary label="run-trace">
                <Run />
              </ErrorBoundary>
            }
          />
          <Route
            path="/next-steps/:slug"
            element={
              <ErrorBoundary label="next-steps">
                <NextSteps />
              </ErrorBoundary>
            }
          />
          <Route
            path="/next-steps"
            element={
              <ErrorBoundary label="next-steps">
                <NextSteps />
              </ErrorBoundary>
            }
          />
          <Route
            path="/radar"
            element={
              <ErrorBoundary label="radar">
                <Radar />
              </ErrorBoundary>
            }
          />

          {/* Internal operator view — fidelity trial rollups */}
          <Route
            path="/_internal/fidelity"
            element={
              <ErrorBoundary label="fidelity">
                <Fidelity />
              </ErrorBoundary>
            }
          />
          <Route
            path="/_internal/telemetry"
            element={
              <ErrorBoundary label="telemetry">
                <Telemetry />
              </ErrorBoundary>
            }
          />

          {/* Everything else → Architect. No dead links. */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </ConvexProvider>
  </React.StrictMode>,
);
