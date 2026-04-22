/**
 * agentTrace — domain for live agent runs + per-step trace spans.
 *
 * See docs/LIVE_RUN_AND_TRACE_ADR.md for the full architecture.
 *
 * Four public entry points:
 *   startRun          — create an agentRuns row (status=running)
 *   recordSpan        — append an agentTraceSpans row + patch run totals
 *   finishRun         — patch run status=complete|failed + finalOutput
 *   listSpansForRun   — ordered span feed for UI subscription
 *   getRun            — run header metadata
 *
 * Bounded invariants (agentic_reliability.md):
 *   BOUND           — inputJson/outputJson capped at 8KB; input at 4KB,
 *                     finalOutput at 8KB on the run row.
 *   HONEST_STATUS   — failed runs have errorMessage + status="failed".
 *                     recordSpan never silently drops; oversize payloads
 *                     truncate with explicit marker.
 *   DETERMINISTIC   — recordSpan is idempotent by spanId: re-posting the
 *                     same span updates in place rather than duplicating.
 *   BOUND_READ      — list query capped at 500 spans per run.
 */

import { v } from "convex/values";
import { mutation, query } from "../../_generated/server";

const MAX_INPUT_BYTES = 4 * 1024;     // run.input
const MAX_OUTPUT_BYTES = 8 * 1024;    // run.finalOutput + span io
const MAX_SPANS_PER_RUN = 500;        // list query cap
const ALLOWED_KINDS = new Set([
  "llm",
  "tool",
  "compact",
  "handoff",
  "wait",
  "meta",
]);
const ALLOWED_STATUSES = new Set(["running", "complete", "failed"]);
const ALLOWED_MODES = new Set(["mock", "live"]);

function _truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 16) + "…(truncated)";
}

/**
 * Create a new agentRuns row. Caller receives the runId they passed in
 * (idempotent) or the auto-generated doc id for back-reference.
 *
 * Client should generate the runId (ULID or UUIDv4) so the URL
 * `/runs/:runId` can be shared immediately without waiting for a
 * round-trip. If a run with this runId already exists, returns its
 * existing row (idempotent re-submit during flaky networks).
 */
export const startRun = mutation({
  args: {
    runId: v.string(),
    sessionSlug: v.optional(v.string()),
    runtimeLane: v.string(),
    driverRuntime: v.string(),
    mode: v.string(),
    input: v.string(),
  },
  handler: async (ctx, args) => {
    if (!ALLOWED_MODES.has(args.mode)) {
      throw new Error(`invalid mode: ${args.mode}`);
    }
    // Idempotent: if already exists, return it
    const existing = await ctx.db
      .query("agentRuns")
      .withIndex("by_runId", (q) => q.eq("runId", args.runId))
      .unique()
      .catch(() => null);
    if (existing) {
      return {
        runId: existing.runId,
        status: "already_exists" as const,
        _id: existing._id,
      };
    }
    const input = _truncate(args.input, MAX_INPUT_BYTES);
    const id = await ctx.db.insert("agentRuns", {
      runId: args.runId,
      sessionSlug: args.sessionSlug,
      runtimeLane: args.runtimeLane,
      driverRuntime: args.driverRuntime,
      mode: args.mode,
      status: "running",
      startedAt: Date.now(),
      input,
      totalCostUsd: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalSpans: 0,
    });
    return { runId: args.runId, status: "created" as const, _id: id };
  },
});

/**
 * Append one trace span to a run. Idempotent by (runId, spanId):
 * re-sending the same span updates in place. This matters because
 * a scaffold may retry on network flakes and we don't want
 * duplicate spans in the UI.
 *
 * Also patches the parent run's denormalized totals (spans, tokens,
 * cost) so the run header can render without a second query.
 */
export const recordSpan = mutation({
  args: {
    runId: v.string(),
    spanId: v.string(),
    parentSpanId: v.optional(v.string()),
    kind: v.string(),
    name: v.string(),
    startedAt: v.number(),
    finishedAt: v.optional(v.number()),
    inputJson: v.string(),
    outputJson: v.string(),
    inputTokens: v.optional(v.number()),
    outputTokens: v.optional(v.number()),
    costUsd: v.optional(v.number()),
    modelLabel: v.optional(v.string()),
    promptHash: v.optional(v.string()),
    errorMessage: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (!ALLOWED_KINDS.has(args.kind)) {
      throw new Error(`invalid kind: ${args.kind}`);
    }
    // Look up the parent run
    const run = await ctx.db
      .query("agentRuns")
      .withIndex("by_runId", (q) => q.eq("runId", args.runId))
      .unique()
      .catch(() => null);
    if (!run) {
      throw new Error(`run not found: ${args.runId}`);
    }
    const inputJson = _truncate(args.inputJson, MAX_OUTPUT_BYTES);
    const outputJson = _truncate(args.outputJson, MAX_OUTPUT_BYTES);

    // Idempotent upsert on spanId
    const existing = await ctx.db
      .query("agentTraceSpans")
      .withIndex("by_runId_startedAt", (q) => q.eq("runId", args.runId))
      .filter((q) => q.eq(q.field("spanId"), args.spanId))
      .first();

    const payload = {
      runId: args.runId,
      spanId: args.spanId,
      parentSpanId: args.parentSpanId,
      kind: args.kind,
      name: args.name,
      startedAt: args.startedAt,
      finishedAt: args.finishedAt,
      inputJson,
      outputJson,
      inputTokens: args.inputTokens,
      outputTokens: args.outputTokens,
      costUsd: args.costUsd,
      modelLabel: args.modelLabel,
      promptHash: args.promptHash,
      errorMessage: args.errorMessage,
    };

    if (existing) {
      await ctx.db.patch(existing._id, payload);
    } else {
      await ctx.db.insert("agentTraceSpans", payload);
      // Only bump run totals on first-insert (not on patches)
      await ctx.db.patch(run._id, {
        totalSpans: run.totalSpans + 1,
        totalInputTokens: run.totalInputTokens + (args.inputTokens ?? 0),
        totalOutputTokens: run.totalOutputTokens + (args.outputTokens ?? 0),
        totalCostUsd: run.totalCostUsd + (args.costUsd ?? 0),
      });
    }
    return { ok: true, mode: existing ? ("updated" as const) : ("inserted" as const) };
  },
});

/**
 * Terminal event for a run. Sets status + finalOutput + finishedAt.
 */
export const finishRun = mutation({
  args: {
    runId: v.string(),
    status: v.string(),
    finalOutput: v.optional(v.string()),
    errorMessage: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (!ALLOWED_STATUSES.has(args.status)) {
      throw new Error(`invalid status: ${args.status}`);
    }
    if (args.status === "running") {
      throw new Error("finishRun can only set status=complete|failed");
    }
    const run = await ctx.db
      .query("agentRuns")
      .withIndex("by_runId", (q) => q.eq("runId", args.runId))
      .unique()
      .catch(() => null);
    if (!run) {
      throw new Error(`run not found: ${args.runId}`);
    }
    const patch: Record<string, unknown> = {
      status: args.status,
      finishedAt: Date.now(),
    };
    if (args.finalOutput !== undefined) {
      patch.finalOutput = _truncate(args.finalOutput, MAX_OUTPUT_BYTES);
    }
    if (args.errorMessage !== undefined) {
      patch.errorMessage = args.errorMessage;
    }
    await ctx.db.patch(run._id, patch);
    return { ok: true };
  },
});

/**
 * Ordered span feed for the UI. Sorted by startedAt ascending so
 * the timeline renders in run order.
 */
export const listSpansForRun = query({
  args: { runId: v.string() },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("agentTraceSpans")
      .withIndex("by_runId_startedAt", (q) => q.eq("runId", args.runId))
      .take(MAX_SPANS_PER_RUN);
    // Sort by startedAt asc (take() returns insertion order, not by index)
    rows.sort((a, b) => a.startedAt - b.startedAt);
    return rows.map((r) => ({
      _id: r._id,
      spanId: r.spanId,
      parentSpanId: r.parentSpanId ?? null,
      kind: r.kind,
      name: r.name,
      startedAt: r.startedAt,
      finishedAt: r.finishedAt ?? null,
      inputJson: r.inputJson,
      outputJson: r.outputJson,
      inputTokens: r.inputTokens ?? null,
      outputTokens: r.outputTokens ?? null,
      costUsd: r.costUsd ?? null,
      modelLabel: r.modelLabel ?? null,
      promptHash: r.promptHash ?? null,
      errorMessage: r.errorMessage ?? null,
    }));
  },
});

/**
 * Run header metadata (for the top of /runs/:runId).
 */
export const getRun = query({
  args: { runId: v.string() },
  handler: async (ctx, args) => {
    const run = await ctx.db
      .query("agentRuns")
      .withIndex("by_runId", (q) => q.eq("runId", args.runId))
      .unique()
      .catch(() => null);
    if (!run) return null;
    return {
      runId: run.runId,
      sessionSlug: run.sessionSlug ?? null,
      runtimeLane: run.runtimeLane,
      driverRuntime: run.driverRuntime,
      mode: run.mode,
      status: run.status,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt ?? null,
      input: run.input,
      finalOutput: run.finalOutput ?? null,
      totalCostUsd: run.totalCostUsd,
      totalInputTokens: run.totalInputTokens,
      totalOutputTokens: run.totalOutputTokens,
      totalSpans: run.totalSpans,
      errorMessage: run.errorMessage ?? null,
    };
  },
});
