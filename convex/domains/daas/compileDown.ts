// Compile-down action surface.
//
// Mutations: upsertArtifact, removeArtifact.
// Queries:   getArtifactForSession, listArtifactsBySession.
//
// The actual emitter runs in Python (daas/compile_down/emitters/...).
// Convex is storage + retrieval only — the emit is not an LLM call, it
// is deterministic code generation, so we keep it out of Convex.

import { v } from "convex/values";
import { mutation, query } from "../../_generated/server";

const MAX_BUNDLE_BYTES = 256_000;

/**
 * Upsert the generated bundle for a (sessionSlug, runtimeLane) pair.
 * Idempotent — re-emitting replaces the prior bundle.
 */
export const upsertArtifact = mutation({
  args: {
    sessionSlug: v.string(),
    runtimeLane: v.string(),
    targetModel: v.string(),
    artifactBundleJson: v.string(),
    filesCount: v.number(),
    totalBytes: v.number(),
    emitterVersion: v.string(),
    workflowSpecJson: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (args.artifactBundleJson.length > MAX_BUNDLE_BYTES) {
      throw new Error(
        `artifact bundle exceeds ${MAX_BUNDLE_BYTES}B (${args.artifactBundleJson.length}); split or compress`,
      );
    }
    if (args.totalBytes > MAX_BUNDLE_BYTES) {
      throw new Error(`totalBytes reported > ${MAX_BUNDLE_BYTES}; rejecting`);
    }
    const existing = await ctx.db
      .query("daasGeneratedArtifacts")
      .withIndex("by_sessionSlug_runtimeLane", (q) =>
        q.eq("sessionSlug", args.sessionSlug).eq("runtimeLane", args.runtimeLane),
      )
      .unique();
    const now = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, {
        targetModel: args.targetModel,
        artifactBundleJson: args.artifactBundleJson,
        filesCount: args.filesCount,
        totalBytes: args.totalBytes,
        emitterVersion: args.emitterVersion,
        workflowSpecJson: args.workflowSpecJson,
        generatedAt: now,
      });
      return { id: existing._id, updated: true };
    }
    const id = await ctx.db.insert("daasGeneratedArtifacts", {
      ...args,
      generatedAt: now,
    });
    return { id, updated: false };
  },
});

/**
 * Delete an artifact — used when an Architect session's lane changes.
 */
export const removeArtifact = mutation({
  args: { sessionSlug: v.string(), runtimeLane: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("daasGeneratedArtifacts")
      .withIndex("by_sessionSlug_runtimeLane", (q) =>
        q.eq("sessionSlug", args.sessionSlug).eq("runtimeLane", args.runtimeLane),
      )
      .unique();
    if (row) await ctx.db.delete(row._id);
  },
});

/**
 * Fetch the most recent artifact for a session (any lane). Builder's
 * Scaffold tab uses this to render the file tree.
 */
export const getArtifactForSession = query({
  args: { sessionSlug: v.string() },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("daasGeneratedArtifacts")
      .withIndex("by_sessionSlug", (q) => q.eq("sessionSlug", args.sessionSlug))
      .order("desc")
      .take(5);
    return rows[0] ?? null;
  },
});

/**
 * World-model artifact specifically — queried by the Builder World Model
 * tab. Looks up ``world_model_lite`` or ``world_model_full`` (whichever
 * was last emitted for this session).
 */
export const getWorldModelArtifact = query({
  args: { sessionSlug: v.string() },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("daasGeneratedArtifacts")
      .withIndex("by_sessionSlug", (q) => q.eq("sessionSlug", args.sessionSlug))
      .order("desc")
      .take(10);
    for (const r of rows) {
      if (r.runtimeLane === "world_model_lite" || r.runtimeLane === "world_model_full") {
        return r;
      }
    }
    return null;
  },
});

/**
 * Runtime-scaffold artifact specifically — the Builder Scaffold tab
 * needs this rather than "most recent of any kind" so world-model
 * emissions don't shadow the scaffold.
 */
export const getScaffoldArtifact = query({
  args: { sessionSlug: v.string() },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("daasGeneratedArtifacts")
      .withIndex("by_sessionSlug", (q) => q.eq("sessionSlug", args.sessionSlug))
      .order("desc")
      .take(10);
    for (const r of rows) {
      if (r.runtimeLane === "world_model_lite" || r.runtimeLane === "world_model_full") {
        continue;
      }
      return r;
    }
    return null;
  },
});

/**
 * All artifacts for a session — useful for comparing "tool_first_chain"
 * vs "orchestrator_worker" emissions of the same workflow.
 */
export const listArtifactsBySession = query({
  args: { sessionSlug: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("daasGeneratedArtifacts")
      .withIndex("by_sessionSlug", (q) => q.eq("sessionSlug", args.sessionSlug))
      .order("desc")
      .take(20);
  },
});
