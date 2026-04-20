// Per-session cost cap enforcement.
//
// Every Gemini call attributed to a session increments
// architectSessions.totalCostUsd. Before the next call, we check
// against SESSION_COST_CAP_USD (0.50 today — enough for ~15 full
// classifier cycles + ~10 replays on cheap models).
//
// Over-cap sessions get a clear 429-style response instead of a fake
// classification or replay.

import { v } from "convex/values";
import { mutation, query } from "../../_generated/server";

export const SESSION_COST_CAP_USD = 0.50;


/**
 * Check the current cumulative cost for a session.
 * Returns {allowed, currentUsd, capUsd, remainingUsd}.
 */
export const getSessionCostStatus = query({
  args: { sessionSlug: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("architectSessions")
      .withIndex("by_sessionSlug", (q) => q.eq("sessionSlug", args.sessionSlug))
      .unique();
    if (!row) {
      return {
        allowed: false as const,
        currentUsd: 0,
        capUsd: SESSION_COST_CAP_USD,
        remainingUsd: SESSION_COST_CAP_USD,
      };
    }
    const current = row.totalCostUsd ?? 0;
    return {
      allowed: current < SESSION_COST_CAP_USD,
      currentUsd: current,
      capUsd: SESSION_COST_CAP_USD,
      remainingUsd: Math.max(0, SESSION_COST_CAP_USD - current),
    };
  },
});


/**
 * Accumulate cost into a session. Called from the classifier after a
 * Gemini call completes (with in_tok / out_tok → cost). Over-cap
 * sessions still get their cost recorded — it's a READ-side gate, not
 * a write-side rejection.
 */
export const accumulateSessionCost = mutation({
  args: {
    sessionSlug: v.string(),
    additionalUsd: v.number(),
  },
  handler: async (ctx, args) => {
    if (args.additionalUsd < 0) throw new Error("cost must be non-negative");
    if (args.additionalUsd > 0.50) {
      // Sanity cap on single-call cost — Flash Lite should never cost
      // > $0.50 for one classify. If it does, something is wrong.
      throw new Error(`single-call cost ${args.additionalUsd} exceeds safety threshold`);
    }
    const row = await ctx.db
      .query("architectSessions")
      .withIndex("by_sessionSlug", (q) => q.eq("sessionSlug", args.sessionSlug))
      .unique();
    if (!row) return;
    const newTotal = (row.totalCostUsd ?? 0) + args.additionalUsd;
    await ctx.db.patch(row._id, {
      totalCostUsd: newTotal,
      updatedAt: Date.now(),
    });
  },
});
