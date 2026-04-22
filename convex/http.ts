// attrition.sh HTTP routes.
//
// POST /api/daas/ingest    — public CanonicalTrace ingest (auth, rate
//                            limit, HMAC — see domains/daas/http.ts).
// POST /http/attritionPing — opt-in telemetry from downloaded scaffolds
//                            phoning home for the 60-min NextSteps page.

import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { api } from "./_generated/api";
import { ingestHttp as daasIngestHttp } from "./domains/daas/http";
import { healthHandler } from "./domains/daas/health";

const http = httpRouter();

http.route({
  path: "/api/daas/ingest",
  method: "POST",
  handler: daasIngestHttp,
});

http.route({
  path: "/api/daas/ingest",
  method: "OPTIONS",
  handler: daasIngestHttp,
});

// Liveness + shallow ingest-health probe. Used by external monitoring
// and by the deploy verifier.
http.route({ path: "/health", method: "GET", handler: healthHandler });
http.route({ path: "/health", method: "OPTIONS", handler: healthHandler });

// --- NextSteps webhook ---------------------------------------------------
// Accepts: {session_slug, event, client_ts, runtime_lane?, driver_runtime?}
// Writes to scaffoldPings; NextSteps UI subscribes per session.
// Idempotent per (session_slug, event) — re-pings overwrite.
// CORS-permissive so localhost scaffolds can POST without a preflight dance.

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};

const attritionPingHandler = httpAction(async (ctx, request) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (request.method !== "POST") {
    return new Response("method not allowed", {
      status: 405,
      headers: CORS_HEADERS,
    });
  }

  let body: unknown;
  try {
    // BOUND_READ: cap payload read at 8KB before parse
    const text = await request.text();
    if (text.length > 8 * 1024) {
      return new Response("payload too large", {
        status: 413,
        headers: CORS_HEADERS,
      });
    }
    body = JSON.parse(text);
  } catch {
    return new Response("invalid JSON", { status: 400, headers: CORS_HEADERS });
  }

  if (typeof body !== "object" || body === null) {
    return new Response("body must be JSON object", {
      status: 400,
      headers: CORS_HEADERS,
    });
  }
  const b = body as Record<string, unknown>;
  const sessionSlug = typeof b.session_slug === "string" ? b.session_slug : null;
  const event = typeof b.event === "string" ? b.event : null;
  const clientTs =
    typeof b.client_ts === "number" ? b.client_ts : Date.now();
  const runtimeLane =
    typeof b.runtime_lane === "string" ? b.runtime_lane : undefined;
  const driverRuntime =
    typeof b.driver_runtime === "string" ? b.driver_runtime : undefined;

  if (!sessionSlug || !event) {
    return new Response("missing session_slug or event", {
      status: 400,
      headers: CORS_HEADERS,
    });
  }

  try {
    const result = await ctx.runMutation(api.domains.daas.nextSteps.recordPing, {
      sessionSlug,
      event,
      clientTs,
      runtimeLane,
      driverRuntime,
      raw: JSON.stringify(body).slice(0, 4000),
    });
    return new Response(JSON.stringify({ ok: true, ...result }), {
      status: 200,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 400,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }
});

http.route({
  path: "/http/attritionPing",
  method: "POST",
  handler: attritionPingHandler,
});
http.route({
  path: "/http/attritionPing",
  method: "OPTIONS",
  handler: attritionPingHandler,
});

// --- Live-run trace webhook ---------------------------------------------
// Emitted scaffolds POST trace events here as they run. Accepts three
// event types distinguished by `event`:
//   run_start  → dispatches to agentTrace.startRun mutation
//   span       → dispatches to agentTrace.recordSpan mutation
//   run_end    → dispatches to agentTrace.finishRun mutation
// See docs/LIVE_RUN_AND_TRACE_ADR.md for the full shape.

const attritionTraceHandler = httpAction(async (ctx, request) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (request.method !== "POST") {
    return new Response("method not allowed", {
      status: 405,
      headers: CORS_HEADERS,
    });
  }

  let body: unknown;
  try {
    const text = await request.text();
    // BOUND_READ: cap payload at 32KB (span payloads can be bigger than ping)
    if (text.length > 32 * 1024) {
      return new Response("payload too large", {
        status: 413,
        headers: CORS_HEADERS,
      });
    }
    body = JSON.parse(text);
  } catch {
    return new Response("invalid JSON", {
      status: 400,
      headers: CORS_HEADERS,
    });
  }

  if (typeof body !== "object" || body === null) {
    return new Response("body must be JSON object", {
      status: 400,
      headers: CORS_HEADERS,
    });
  }
  const b = body as Record<string, unknown>;
  const event = typeof b.event === "string" ? b.event : null;

  try {
    if (event === "run_start") {
      const result = await ctx.runMutation(api.domains.daas.agentTrace.startRun, {
        runId: String(b.run_id ?? ""),
        sessionSlug: typeof b.session_slug === "string" ? b.session_slug : undefined,
        runtimeLane: String(b.runtime_lane ?? ""),
        driverRuntime: String(b.driver_runtime ?? ""),
        mode: String(b.mode ?? "mock"),
        input: String(b.input ?? ""),
      });
      return new Response(JSON.stringify({ ok: true, ...result }), {
        status: 200,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }
    if (event === "span") {
      const result = await ctx.runMutation(api.domains.daas.agentTrace.recordSpan, {
        runId: String(b.run_id ?? ""),
        spanId: String(b.span_id ?? ""),
        parentSpanId: typeof b.parent_span_id === "string" ? b.parent_span_id : undefined,
        kind: String(b.kind ?? "meta"),
        name: String(b.name ?? ""),
        startedAt: typeof b.started_at === "number" ? b.started_at : Date.now(),
        finishedAt: typeof b.finished_at === "number" ? b.finished_at : undefined,
        inputJson: typeof b.input_json === "string" ? b.input_json : JSON.stringify(b.input ?? null),
        outputJson: typeof b.output_json === "string" ? b.output_json : JSON.stringify(b.output ?? null),
        inputTokens: typeof b.input_tokens === "number" ? b.input_tokens : undefined,
        outputTokens: typeof b.output_tokens === "number" ? b.output_tokens : undefined,
        costUsd: typeof b.cost_usd === "number" ? b.cost_usd : undefined,
        modelLabel: typeof b.model_label === "string" ? b.model_label : undefined,
        promptHash: typeof b.prompt_hash === "string" ? b.prompt_hash : undefined,
        errorMessage: typeof b.error_message === "string" ? b.error_message : undefined,
      });
      return new Response(JSON.stringify({ ok: true, ...result }), {
        status: 200,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }
    if (event === "run_end") {
      const result = await ctx.runMutation(api.domains.daas.agentTrace.finishRun, {
        runId: String(b.run_id ?? ""),
        status: String(b.status ?? "complete"),
        finalOutput: typeof b.final_output === "string" ? b.final_output : undefined,
        errorMessage: typeof b.error_message === "string" ? b.error_message : undefined,
      });
      return new Response(JSON.stringify({ ok: true, ...result }), {
        status: 200,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }
    return new Response(
      JSON.stringify({ ok: false, error: `unknown event: ${event}` }),
      { status: 400, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return new Response(
      JSON.stringify({ ok: false, error: msg }),
      { status: 400, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
    );
  }
});

http.route({
  path: "/http/attritionTrace",
  method: "POST",
  handler: attritionTraceHandler,
});
http.route({
  path: "/http/attritionTrace",
  method: "OPTIONS",
  handler: attritionTraceHandler,
});

export default http;
