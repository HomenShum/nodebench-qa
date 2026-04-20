// DaaS public-benchmark action surface.
//
// Bridges Python harness adapters (daas/benchmarks/**) to the Convex
// daasBenchmarkRuns table so dashboards can roll up ground-truth
// pass rates alongside the LLM-rubric judge verdicts.
//
// See docs/JUDGE_EVAL_BENCHMARKS.md for per-benchmark rationale +
// integration order (bfcl first, then mmlu_pro, tau2, swebench,
// reportbench).
//
// Agentic reliability:
//   [BOUND] Each recorded run row is append-only, never updated; table
//           has time + benchmarkId indexes for pruning.
//   [HONEST_STATUS] `harnessError` is surfaced distinctly from a task
//           simply failing. A harness crash is NOT a scaffold failure.
//   [HONEST_SCORES] `passed` and `score` come verbatim from the
//           benchmark harness — never synthesized here.
//   [DETERMINISTIC] No score rounding, no floor values applied.

import { v } from "convex/values";
import { mutation, query } from "../../_generated/server";
import { DAAS_BENCHMARK_IDS } from "./schema";

/**
 * Record a single benchmark task execution.
 *
 * Called by the Python benchmark runner after it has:
 *   1. Dispatched the replay via daas.replay
 *   2. Scored the replay output through the benchmark-specific harness
 *      (BFCL AST comparator, MMLU-Pro letter match, etc.)
 *
 * The Convex side is write-only — all deterministic scoring happens in
 * the Python adapter so the harness's own verdict is the source of truth.
 */
export const recordRun = mutation({
  args: {
    benchmarkId: v.string(),
    taskId: v.string(),
    sessionId: v.string(),
    replayId: v.id("daasReplays"),
    executorModel: v.string(),
    passed: v.boolean(),
    score: v.number(),
    rawResultJson: v.string(),
    replayCostUsd: v.number(),
    durationMs: v.number(),
    harnessError: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (!DAAS_BENCHMARK_IDS.includes(args.benchmarkId as typeof DAAS_BENCHMARK_IDS[number])) {
      throw new Error(
        `unknown benchmarkId ${args.benchmarkId}; expected one of ${DAAS_BENCHMARK_IDS.join(", ")}`,
      );
    }
    if (args.score < 0 || args.score > 1) {
      throw new Error(`score must be in [0, 1]; got ${args.score}`);
    }
    if (args.rawResultJson.length > 16_000) {
      throw new Error(
        `rawResultJson exceeds 16KB bound (${args.rawResultJson.length} chars); store large artifacts elsewhere`,
      );
    }
    const id = await ctx.db.insert("daasBenchmarkRuns", {
      ...args,
      createdAt: Date.now(),
    });
    return { id };
  },
});

/**
 * Aggregate pass rate + cost per benchmark — powers the benchmark dashboard
 * and the regression gate for rubric changes.
 */
export const getAggregates = query({
  args: {
    benchmarkId: v.optional(v.string()),
    sinceMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const cutoff = args.sinceMs ?? 0;
    const rows = args.benchmarkId
      ? await ctx.db
          .query("daasBenchmarkRuns")
          .withIndex("by_benchmarkId_createdAt", (q) =>
            q.eq("benchmarkId", args.benchmarkId!).gte("createdAt", cutoff),
          )
          .collect()
      : await ctx.db
          .query("daasBenchmarkRuns")
          .withIndex("by_passed_createdAt", (q) => q.gte("passed" as never, false as never))
          .collect();

    const byBench = new Map<
      string,
      { total: number; passed: number; totalScore: number; totalCost: number; totalDuration: number }
    >();
    for (const r of rows) {
      const b = byBench.get(r.benchmarkId) ?? {
        total: 0,
        passed: 0,
        totalScore: 0,
        totalCost: 0,
        totalDuration: 0,
      };
      b.total += 1;
      if (r.passed) b.passed += 1;
      b.totalScore += r.score;
      b.totalCost += r.replayCostUsd;
      b.totalDuration += r.durationMs;
      byBench.set(r.benchmarkId, b);
    }
    return Array.from(byBench.entries()).map(([benchmarkId, b]) => ({
      benchmarkId,
      total: b.total,
      passed: b.passed,
      passRate: b.total > 0 ? b.passed / b.total : 0,
      avgScore: b.total > 0 ? b.totalScore / b.total : 0,
      totalCostUsd: b.totalCost,
      avgDurationMs: b.total > 0 ? b.totalDuration / b.total : 0,
    }));
  },
});

/**
 * Latest N runs for a benchmark — useful for regression-triage UI
 * ("which tasks flipped from pass to fail in the last deploy?").
 */
export const listRecent = query({
  args: {
    benchmarkId: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = Math.min(args.limit ?? 50, 200);
    return await ctx.db
      .query("daasBenchmarkRuns")
      .withIndex("by_benchmarkId_createdAt", (q) => q.eq("benchmarkId", args.benchmarkId))
      .order("desc")
      .take(limit);
  },
});
