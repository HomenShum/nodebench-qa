// Session ownership — minimal owner-token scheme.
//
// Clients generate a random 32-char token, stored in localStorage under
// `attrition:owner:<sessionSlug>`. On session create, client sends
// sha256(token) — we keep only the first 16 hex chars (ownerHashPrefix).
//
// ownership contract:
//   * anyone with sessionSlug can READ (share-link semantics)
//   * only owner token holder can WRITE (append turn, re-classify,
//     mark accepted)
//
// This is deliberately minimal — pre-revenue, no accounts, no auth
// provider. Good enough that casual guessing can't hijack, not good
// enough against a targeted attacker. Document limit, don't hide it.

import { v } from "convex/values";
import { mutation, query } from "../../_generated/server";

const TOKEN_HASH_PREFIX_LEN = 16;


async function sha256Prefix(token: string): Promise<string> {
  // Convex supports Web Crypto inside mutations.
  const encoder = new TextEncoder();
  const data = encoder.encode(token);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, TOKEN_HASH_PREFIX_LEN);
}


/**
 * Claim ownership of a session during createSession. Returns the
 * ownerHashPrefix that the client MUST also store client-side for
 * future write operations.
 *
 * Idempotent — re-claiming with the same token is a no-op.
 */
export const claimOwnership = mutation({
  args: {
    sessionSlug: v.string(),
    ownerToken: v.string(),
  },
  handler: async (ctx, args) => {
    if (args.ownerToken.length < 16) {
      throw new Error("ownerToken must be at least 16 chars");
    }
    const hashPrefix = await sha256Prefix(args.ownerToken);
    const row = await ctx.db
      .query("architectSessions")
      .withIndex("by_sessionSlug", (q) => q.eq("sessionSlug", args.sessionSlug))
      .unique();
    if (!row) throw new Error(`session not found: ${args.sessionSlug}`);
    if (row.ownerHashPrefix && row.ownerHashPrefix !== hashPrefix) {
      throw new Error("session already claimed by a different owner");
    }
    if (!row.ownerHashPrefix) {
      await ctx.db.patch(row._id, {
        ownerHashPrefix: hashPrefix,
        updatedAt: Date.now(),
      });
    }
    return { ownerHashPrefix: hashPrefix };
  },
});


/**
 * Verify a session write is authorized by the presented ownerToken.
 * Called from mutations before any write (append turn / re-classify /
 * mark accepted). Throws on mismatch.
 *
 * Exposed as a reusable helper via `assertOwner(ctx, slug, token)`.
 */
export const verifyOwner = mutation({
  args: {
    sessionSlug: v.string(),
    ownerToken: v.string(),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("architectSessions")
      .withIndex("by_sessionSlug", (q) => q.eq("sessionSlug", args.sessionSlug))
      .unique();
    if (!row) {
      return { ok: false, reason: "not_found" as const };
    }
    if (!row.ownerHashPrefix) {
      // Legacy session (pre-ownership). Allow until the owner claims it.
      return { ok: true, reason: "legacy_unclaimed" as const };
    }
    const hashPrefix = await sha256Prefix(args.ownerToken);
    if (hashPrefix !== row.ownerHashPrefix) {
      return { ok: false, reason: "owner_mismatch" as const };
    }
    return { ok: true, reason: "owner_verified" as const };
  },
});


/**
 * Read a session's ownership status without checking a token — lets
 * the Builder page show "you are owner" vs "guest view" badges.
 */
export const getOwnershipStatus = query({
  args: { sessionSlug: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("architectSessions")
      .withIndex("by_sessionSlug", (q) => q.eq("sessionSlug", args.sessionSlug))
      .unique();
    if (!row) return { exists: false, claimed: false };
    return {
      exists: true,
      claimed: Boolean(row.ownerHashPrefix),
      ownerHashPrefix: row.ownerHashPrefix ?? null,
    };
  },
});
