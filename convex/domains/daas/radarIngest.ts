// Radar ingestion — fetches Tier-1 sources and upserts into daasRadarItems.
//
// Primary source: GitHub Releases REST API. It is:
//   - the authoritative source for every agent SDK and benchmark repo
//     on our watchlist (Claude Code, OpenAI Agents, ADK, LangGraph,
//     DeerFlow, Hermes, tau2-bench, SWE-bench, BFCL/Gorilla).
//   - available unauthenticated (60 req/hr — our watchlist fits comfortably).
//   - stable and rate-limit-friendly.
//
// Secondary sources (scoped out of this first ingest, noted where added):
//   - Anthropic / OpenAI / Google HTML changelogs (scrape; add when
//     HTML is stable enough to justify the brittleness).
//   - HackerNews Firebase search (tier3 signal; add later with its
//     own card style so weak signals never masquerade as official).
//   - Vellum benchmark rollups (tier2 interpreter; add as a manual
//     curator button first, then auto-ingest once we lock the schema).
//
// Agentic reliability:
//   [BOUND]         Per-source items capped at MAX_PER_SOURCE; total
//                   per-run capped at MAX_TOTAL_ITEMS.
//   [HONEST_STATUS] Source-level fetch errors land in an ingestReport
//                   and are returned — never faked as zero-diff.
//   [TIMEOUT]       Each fetch uses AbortSignal.timeout.
//   [SSRF]          Watchlist is compile-time; no user input reaches fetch.
//   [BOUND_READ]    Release body truncated to 280 chars for the Radar summary.
//   [DETERMINISTIC] itemId is `release:<stack>:<tag>` (or `benchmark:...`)
//                   — same upstream release always collides with same row.

"use node";

import { v } from "convex/values";
import { action, internalAction } from "../../_generated/server";
import { api, internal } from "../../_generated/api";

const GITHUB_TIMEOUT_MS = 8_000;
const MAX_PER_SOURCE = 5;
const MAX_TOTAL_ITEMS = 60;
const SUMMARY_MAX = 280;

type WatchEntry = {
  repo: string;               // "owner/name"
  stack: string;              // normalized stack key used across the product
  lanes: string[];            // runtime lanes this stack belongs to
  category: "release" | "benchmark";
  updatesPrior: "runtime" | "eval" | "world_model" | "none";
  suggestedAction?: string;
};

// Compile-time watchlist. Every entry is a real, public GitHub repo.
// The `stack` key is what appears in Radar rows; keep consistent with
// architect recommender priors.
const WATCHLIST: WatchEntry[] = [
  {
    repo: "anthropics/claude-code",
    stack: "claude_code",
    lanes: ["orchestrator_worker"],
    category: "release",
    updatesPrior: "runtime",
    suggestedAction:
      "If hooks, subagents, or MCP primitives changed, update Architect's orchestrator_worker prior.",
  },
  {
    repo: "openai/openai-agents-python",
    stack: "openai_agents_sdk",
    lanes: ["orchestrator_worker", "tool_first_chain"],
    category: "release",
    updatesPrior: "runtime",
    suggestedAction: "Regenerate handoff payloads against current schema when translating here.",
  },
  {
    repo: "anthropics/anthropic-sdk-python",
    stack: "anthropic_sdk",
    lanes: ["orchestrator_worker", "tool_first_chain"],
    category: "release",
    updatesPrior: "runtime",
  },
  {
    repo: "langchain-ai/langgraph",
    stack: "langgraph",
    lanes: ["orchestrator_worker"],
    category: "release",
    updatesPrior: "runtime",
    suggestedAction: "Default compile_up target for LangChain-ecosystem users.",
  },
  {
    repo: "google/adk-python",
    stack: "google_adk",
    lanes: ["orchestrator_worker", "tool_first_chain"],
    category: "release",
    updatesPrior: "runtime",
    suggestedAction: "Include as translate target when the user's workflow uses Gemini + MCP.",
  },
  {
    repo: "bytedance/deer-flow",
    stack: "deerflow",
    lanes: ["orchestrator_worker"],
    category: "release",
    updatesPrior: "runtime",
  },
  {
    repo: "NousResearch/Hermes-Function-Calling",
    stack: "hermes_agent",
    lanes: ["tool_first_chain", "orchestrator_worker"],
    category: "release",
    updatesPrior: "runtime",
  },
  {
    repo: "sierra-research/tau2-bench",
    stack: "benchmarks",
    lanes: ["orchestrator_worker", "tool_first_chain"],
    category: "benchmark",
    updatesPrior: "eval",
    suggestedAction:
      "Default benchmark for retail / support flow compile_up or compile_down recommendations.",
  },
  {
    repo: "princeton-nlp/SWE-bench",
    stack: "benchmarks",
    lanes: ["orchestrator_worker", "keep_big_model"],
    category: "benchmark",
    updatesPrior: "eval",
    suggestedAction:
      "Use SWE-bench Verified as the ceiling for compile_down claims on coding scaffolds.",
  },
  {
    repo: "ShishirPatil/gorilla",
    stack: "benchmarks",
    lanes: ["tool_first_chain", "orchestrator_worker"],
    category: "benchmark",
    updatesPrior: "eval",
    suggestedAction:
      "Track BFCL releases; v3 is saturated for frontier models, watch for v4 divergence benchmarks.",
  },
];

type GhRelease = {
  tag_name: string;
  name: string | null;
  body: string | null;
  html_url: string;
  published_at: string | null;
  draft: boolean;
  prerelease: boolean;
};

type IngestReport = {
  totalCandidates: number;
  upserted: number;
  updated: number;
  skipped: number;
  errors: Array<{ repo: string; message: string }>;
  runMs: number;
};

function truncate(s: string | null | undefined, max: number): string {
  if (!s) return "";
  const flat = s.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`;
}

async function fetchReleases(repo: string): Promise<GhRelease[]> {
  const url = `https://api.github.com/repos/${repo}/releases?per_page=${MAX_PER_SOURCE}`;
  const headers: Record<string, string> = {
    "Accept": "application/vnd.github+json",
    "User-Agent": "attrition-radar-ingest",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  const token = process.env.GITHUB_TOKEN;
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const resp = await fetch(url, {
    method: "GET",
    headers,
    signal: AbortSignal.timeout(GITHUB_TIMEOUT_MS),
  });
  if (!resp.ok) {
    const body = (await resp.text()).slice(0, 200);
    throw new Error(`GitHub ${resp.status} for ${repo}: ${body}`);
  }
  const data = (await resp.json()) as GhRelease[];
  return data.filter((r) => !r.draft && r.tag_name && r.published_at);
}

/**
 * Public action (callable via `npx convex run`) — runs the full watchlist
 * ingest once and returns a report. Crons.ts wires this up.
 */
export const ingestAll = action({
  args: {},
  handler: async (ctx): Promise<IngestReport> => {
    const started = Date.now();
    const errors: IngestReport["errors"] = [];
    let totalCandidates = 0;
    let upserted = 0;
    let updated = 0;
    let skipped = 0;

    for (const entry of WATCHLIST) {
      if (upserted + updated >= MAX_TOTAL_ITEMS) break;

      let releases: GhRelease[] = [];
      try {
        releases = await fetchReleases(entry.repo);
      } catch (err) {
        errors.push({ repo: entry.repo, message: String(err).slice(0, 300) });
        continue;
      }

      for (const rel of releases) {
        totalCandidates += 1;
        if (upserted + updated >= MAX_TOTAL_ITEMS) {
          skipped += 1;
          continue;
        }

        const publishedMs = rel.published_at ? Date.parse(rel.published_at) : Date.now();
        const title = (rel.name && rel.name.trim()) || `${entry.repo} ${rel.tag_name}`;
        const summary = truncate(
          rel.body || `Release ${rel.tag_name} published to ${entry.repo}.`,
          SUMMARY_MAX,
        );
        const itemId = `${entry.category}:${entry.stack}:${rel.tag_name}`;

        try {
          const res = await ctx.runMutation(api.domains.daas.radar.upsertItem, {
            itemId,
            category: entry.category,
            sourceTier: "tier1_official",
            stack: entry.stack,
            title,
            summary,
            url: rel.html_url,
            changedAt: publishedMs,
            affectsLanesJson: JSON.stringify(entry.lanes),
            updatesPrior: entry.updatesPrior,
            ...(entry.suggestedAction ? { suggestedAction: entry.suggestedAction } : {}),
          });
          if (res?.updated) updated += 1;
          else upserted += 1;
        } catch (err) {
          errors.push({
            repo: `${entry.repo} (${rel.tag_name})`,
            message: String(err).slice(0, 300),
          });
        }
      }
    }

    return {
      totalCandidates,
      upserted,
      updated,
      skipped,
      errors,
      runMs: Date.now() - started,
    };
  },
});

/**
 * Internal action used by the cron. Cannot be called from the client.
 * Wraps ingestAll and logs any source-level errors to the audit log so
 * stale / drifted feeds are visible without opening the function logs.
 */
export const ingestAllInternal = internalAction({
  args: {},
  handler: async (ctx): Promise<IngestReport> => {
    const started = Date.now();
    const report = (await ctx.runAction(api.domains.daas.radarIngest.ingestAll, {})) as IngestReport;
    // Mirror into daasAuditLog so operators can see ingest health alongside
    // other DaaS ops without paging through Convex function logs.
    try {
      // Build args conditionally — Convex v.optional(...) means the key
      // must be ABSENT when missing, NOT null/undefined.
      const auditArgs: {
        op: string;
        actorKind: string;
        status: string;
        metaJson: string;
        durationMs: number;
        errorMessage?: string;
      } = {
        op: "radar.ingestAll",
        actorKind: "cron",
        status: report.errors.length === 0 ? "ok" : "error",
        metaJson: JSON.stringify({
          totalCandidates: report.totalCandidates,
          upserted: report.upserted,
          updated: report.updated,
          skipped: report.skipped,
          errorCount: report.errors.length,
        }),
        durationMs: Date.now() - started,
      };
      if (report.errors.length > 0) {
        auditArgs.errorMessage = `${report.errors.length} source(s) failed; first: ${report.errors[0].message.slice(0, 120)}`;
      }
      await ctx.runMutation(internal.domains.daas.mutations.logAuditEvent, auditArgs);
    } catch {
      // Audit log is best-effort; never fail the ingest because of it.
    }
    return report;
  },
});
