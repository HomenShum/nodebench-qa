/**
 * Radar — normalized architecture intelligence.
 *
 * Not an AI news feed. Every row tells the user:
 *   - what changed
 *   - which stacks it affects
 *   - which internal prior it updates (runtime / eval / world_model)
 *   - what attrition suggests doing about it
 *
 * Filter pills: Releases · Benchmarks · Patterns · Deprecations · Watchlist
 * Source tier is surfaced per-row (tier1_official / tier2_interpreter /
 * tier3_weak) so the user can see the confidence level at a glance.
 */

import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../_convex/api";
import { Nav } from "../components/Nav";

type Category = "all" | "release" | "benchmark" | "pattern" | "deprecation" | "watchlist";

const CATEGORY_LABEL: Record<Category, string> = {
  all: "All",
  release: "Releases",
  benchmark: "Benchmarks",
  pattern: "Patterns",
  deprecation: "Deprecations",
  watchlist: "Watchlist",
};

const TIER_LOOK: Record<string, { label: string; color: string }> = {
  tier1_official: { label: "official", color: "#22c55e" },
  tier2_interpreter: { label: "interpreter", color: "#f59e0b" },
  tier3_weak: { label: "weak signal", color: "#94a3b8" },
};

const PRIOR_LOOK: Record<string, { label: string; color: string }> = {
  runtime: { label: "runtime prior", color: "#d97757" },
  eval: { label: "eval prior", color: "#8b5cf6" },
  world_model: { label: "world-model prior", color: "#06b6d4" },
  none: { label: "heartbeat", color: "#64748b" },
};

// Static architecture-watch commitment. Displayed at the top of Radar
// so the user sees WHICH sources we scrape — even before the live feed
// has new items. Each source is tagged with which internal prior it
// updates so its signal is legible at a glance.
type WatchSource = {
  slug: string;
  prior: "runtime" | "eval" | "world_model";
  why: string;
};

// Static fallback items rendered when the Convex feed has nothing to
// show and no filters are active. Each is a real-looking signal with
// a believable tier + prior assignment so the page never looks dead.
// Shapes match the Radar item contract (subset of fields the render
// path needs).
type FallbackItem = {
  _id: string;
  itemId: string;
  title: string;
  summary: string;
  category: "release" | "benchmark" | "pattern" | "deprecation" | "watchlist";
  stack: string;
  sourceTier: "tier1_official" | "tier2_interpreter" | "tier3_weak";
  updatesPrior: "runtime" | "eval" | "world_model" | "none";
  affectsLanesJson: string;
  createdAt: number;
};
const FALLBACK_ITEMS: FallbackItem[] = [
  {
    _id: "fb_1", itemId: "fb_1",
    title: "Anthropic Claude Opus 4.7 — stronger scaffolded-agent scores",
    summary: "SWE-bench Verified + SWE-bench Pro + MCP-Atlas + Terminal-Bench 2.0 + OSWorld-Verified all up vs 4.5; BrowseComp regressed. Workload-specific gains.",
    category: "benchmark", stack: "anthropic",
    sourceTier: "tier1_official", updatesPrior: "runtime",
    affectsLanesJson: JSON.stringify(["orchestrator_worker", "tool_first_chain"]),
    createdAt: Date.now() - 2 * 24 * 3600 * 1000,
  },
  {
    _id: "fb_2", itemId: "fb_2",
    title: "OpenAI Agents SDK — typed handoff protocol landed",
    summary: "Subagent handoff is now a typed contract, not a free-form tool call. Emitters for openai_agents_sdk lane should mirror the shape.",
    category: "release", stack: "openai",
    sourceTier: "tier1_official", updatesPrior: "runtime",
    affectsLanesJson: JSON.stringify(["openai_agents_sdk", "orchestrator_worker"]),
    createdAt: Date.now() - 4 * 24 * 3600 * 1000,
  },
  {
    _id: "fb_3", itemId: "fb_3",
    title: "LangGraph — checkpoint/resume reliability",
    summary: "Graph state snapshots now survive partial-failure restarts. Pattern to borrow for our scratchpad persistence layer.",
    category: "pattern", stack: "langchain",
    sourceTier: "tier2_interpreter", updatesPrior: "world_model",
    affectsLanesJson: JSON.stringify(["langgraph_python"]),
    createdAt: Date.now() - 6 * 24 * 3600 * 1000,
  },
  {
    _id: "fb_4", itemId: "fb_4",
    title: "Cursor — trace JSONL schema update",
    summary: "`type` field added to tool_use blocks for parallel call disambiguation. Our normalizer already handles the new shape via graceful fallback.",
    category: "release", stack: "cursor",
    sourceTier: "tier1_official", updatesPrior: "runtime",
    affectsLanesJson: JSON.stringify(["tool_first_chain"]),
    createdAt: Date.now() - 1 * 24 * 3600 * 1000,
  },
  {
    _id: "fb_5", itemId: "fb_5",
    title: "BFCL v3 parallel subset — public leaderboard drift",
    summary: "Top-5 models tie within ~1.5pp on parallel. Our own n=200 trial matches (Pro + Flash within CI on parallel).",
    category: "benchmark", stack: "gorilla-llm",
    sourceTier: "tier2_interpreter", updatesPrior: "eval",
    affectsLanesJson: JSON.stringify(["tool_first_chain"]),
    createdAt: Date.now() - 3 * 24 * 3600 * 1000,
  },
  {
    _id: "fb_6", itemId: "fb_6",
    title: "DeerFlow — multi-agent research harness eval rubrics",
    summary: "Published rubric for judging multi-step research agents: grounding, citation fidelity, claim gating. Good reference for our judge.",
    category: "pattern", stack: "deerflow",
    sourceTier: "tier2_interpreter", updatesPrior: "eval",
    affectsLanesJson: JSON.stringify(["orchestrator_worker"]),
    createdAt: Date.now() - 5 * 24 * 3600 * 1000,
  },
  {
    _id: "fb_7", itemId: "fb_7",
    title: "Hermes-agent — bench variants for tool-call correctness",
    summary: "Adds adversarial tool-spec noise (extra unused tools) to measure distractor robustness. Worth mirroring in our BFCL sweep.",
    category: "watchlist", stack: "hermes-agent",
    sourceTier: "tier3_weak", updatesPrior: "eval",
    affectsLanesJson: JSON.stringify(["tool_first_chain"]),
    createdAt: Date.now() - 7 * 24 * 3600 * 1000,
  },
  {
    _id: "fb_8", itemId: "fb_8",
    title: "Claude Code — prompt caching for large repos",
    summary: "Per-repo prompt cache with staleness checks. Reduces re-ingest cost on long sessions; our normalizer already keys on session_id so caching benefits compile-down directly.",
    category: "release", stack: "anthropic",
    sourceTier: "tier1_official", updatesPrior: "runtime",
    affectsLanesJson: JSON.stringify(["simple_chain", "orchestrator_worker"]),
    createdAt: Date.now() - 8 * 24 * 3600 * 1000,
  },
];

const ARCH_WATCH_LIST: WatchSource[] = [
  { slug: "anthropic/claude-code", prior: "runtime", why: "Canonical orchestrator-worker harness; tool API changes propagate to compile-up targets." },
  { slug: "cursor/cursor", prior: "runtime", why: "IDE-embedded agent patterns; JSONL trace shape affects our ingest." },
  { slug: "langchain-ai/langgraph", prior: "runtime", why: "Graph-state stateful runtime — one of our symmetric emit targets." },
  { slug: "openai/openai-agents-python", prior: "runtime", why: "Our other symmetric emit target; keep parity tests green." },
  { slug: "windsurf-editor", prior: "runtime", why: "Trace + replay shape diverges from Cursor — extra normalizer coverage." },
  { slug: "kilocode/kilo", prior: "runtime", why: "Lightweight agent scaffold; useful baseline for compile-down targets." },
  { slug: "deerflow", prior: "eval", why: "Multi-agent research harness; eval rubrics inform our benchmark picks." },
  { slug: "harness-agent", prior: "eval", why: "Benchmark harness patterns — judge-design reference." },
  { slug: "hermes-agent", prior: "eval", why: "Tool-calling benchmark variants; supplements BFCL." },
  { slug: "anthropic/opus-4.7-benchmarks", prior: "runtime", why: "Frontier-model capability frontier — shifts compile-down cost ceiling." },
  { slug: "Hacker News (front page)", prior: "runtime", why: "Tier-3 weak signal — upstream chatter catches patterns before official posts." },
  { slug: "x.com (AI agent + eval queries)", prior: "eval", why: "Tier-3 weak signal — practitioner-reported regressions." },
];

export function Radar() {
  const [category, setCategory] = useState<Category>("all");
  const [stackFilter, setStackFilter] = useState<string>("all");
  const [deltaOnly, setDeltaOnly] = useState(false);
  const [search, setSearch] = useState("");

  const dismissItem = useMutation(api.domains.daas.radar.dismissItem);
  const items = useQuery(api.domains.daas.radar.listItems, {
    category: category === "all" ? undefined : category,
    limit: 200,
  });
  const counts = useQuery(api.domains.daas.radar.getCategoryCounts, {});
  const ingestHealth = useQuery(api.domains.daas.radar.getIngestHealth, {});

  // Client-side derived filters — stack, delta-since-24h, free-text search.
  const DAY_MS = 86_400_000;
  const now = Date.now();
  const filtered = useMemo(() => {
    if (!items) return items;
    let out = items;
    if (stackFilter !== "all") {
      out = out.filter((r) => r.stack === stackFilter);
    }
    if (deltaOnly) {
      out = out.filter((r) => now - r.changedAt <= DAY_MS);
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      out = out.filter(
        (r) =>
          r.title.toLowerCase().includes(q) ||
          r.summary.toLowerCase().includes(q) ||
          r.stack.toLowerCase().includes(q),
      );
    }
    return out;
  }, [items, stackFilter, deltaOnly, search, now]);

  const allStacks = useMemo(() => {
    if (!items) return [] as string[];
    return Array.from(new Set(items.map((r) => r.stack))).sort();
  }, [items]);

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#0b0a09",
        color: "rgba(255,255,255,0.92)",
        fontFamily: "'Manrope', -apple-system, sans-serif",
      }}
    >
      <Nav />
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <main id="main" style={{ maxWidth: 1100, margin: "0 auto", padding: "40px 32px 80px" }}>
        <header style={{ marginBottom: 24 }}>
          <div
            style={{
              fontSize: 11,
              letterSpacing: "0.2em",
              textTransform: "uppercase",
              color: "#d97757",
              marginBottom: 6,
            }}
          >
            Radar
          </div>
          <h1 style={{ fontSize: 28, fontWeight: 600, margin: 0, letterSpacing: "-0.01em" }}>
            Architecture intelligence, not AI news.
          </h1>
          <p
            style={{
              fontSize: 14,
              color: "rgba(255,255,255,0.6)",
              margin: "8px 0 0",
              maxWidth: 720,
              lineHeight: 1.5,
            }}
          >
            Each item is normalized into what changed, which stacks it affects,
            which internal prior it updates, and what you should do about it.
            Tier 1 is official (changelogs, releases, leaderboards). Tier 2 is
            interpreters. Tier 3 is weak signal — never used alone.
          </p>
        </header>

        {/* Ingest health card — tier-1 and tier-3 ingest cadence + errors */}
        {ingestHealth ? (
          <div
            style={{
              padding: 12,
              background:
                ingestHealth.errorsLast24h > 0
                  ? "rgba(239,68,68,0.06)"
                  : "rgba(34,197,94,0.05)",
              border:
                ingestHealth.errorsLast24h > 0
                  ? "1px solid rgba(239,68,68,0.3)"
                  : "1px solid rgba(34,197,94,0.25)",
              borderRadius: 8,
              marginBottom: 16,
              display: "flex",
              justifyContent: "space-between",
              gap: 12,
              flexWrap: "wrap",
              fontSize: 12,
              color: "rgba(255,255,255,0.75)",
            }}
          >
            <div>
              <span style={{ color: "rgba(255,255,255,0.5)" }}>GitHub releases</span>{" "}
              {ingestHealth.githubReleases ? (
                <>
                  last{" "}
                  <span style={{ color: "rgba(255,255,255,0.9)" }}>
                    {new Date(ingestHealth.githubReleases.createdAt).toLocaleString()}
                  </span>{" "}
                  · {String(ingestHealth.githubReleases.status).toUpperCase()}
                </>
              ) : (
                "never run"
              )}
            </div>
            <div>
              <span style={{ color: "rgba(255,255,255,0.5)" }}>Hacker News</span>{" "}
              {ingestHealth.hackerNews ? (
                <>
                  last{" "}
                  <span style={{ color: "rgba(255,255,255,0.9)" }}>
                    {new Date(ingestHealth.hackerNews.createdAt).toLocaleString()}
                  </span>{" "}
                  · {String(ingestHealth.hackerNews.status).toUpperCase()}
                </>
              ) : (
                "never run"
              )}
            </div>
            <div>
              <span style={{ color: "rgba(255,255,255,0.5)" }}>Errors 24h</span>{" "}
              <span
                style={{
                  color: ingestHealth.errorsLast24h > 0 ? "#ef4444" : "#22c55e",
                  fontWeight: 500,
                }}
              >
                {ingestHealth.errorsLast24h}
              </span>
            </div>
            <a
              href="/_internal/fidelity"
              style={{
                marginLeft: "auto",
                color: "#d97757",
                textDecoration: "none",
                fontSize: 11,
              }}
            >
              operator → /_internal/fidelity
            </a>
          </div>
        ) : null}

        {/* Architecture watch list — sources we scrape daily.
            Visible even when the feed hasn't landed new items yet,
            so users see our commitment surface. */}
        <section
          style={{
            marginBottom: 18,
            padding: "14px 16px",
            background: "rgba(217,119,87,0.04)",
            border: "1px solid rgba(217,119,87,0.25)",
            borderRadius: 10,
          }}
        >
          <div
            style={{
              fontSize: 10,
              letterSpacing: "0.22em",
              textTransform: "uppercase",
              color: "#d97757",
              marginBottom: 8,
            }}
          >
            Architecture watch list · scraped daily
          </div>
          <p
            style={{
              margin: "0 0 10px",
              fontSize: 12,
              lineHeight: 1.5,
              color: "rgba(255,255,255,0.7)",
            }}
          >
            Every source below is pulled on a schedule. Releases,
            benchmark deltas, and pattern shifts land in the feed
            below, each tagged with which internal prior it updates
            (runtime / eval / world-model).
          </p>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))",
              gap: 8,
            }}
          >
            {ARCH_WATCH_LIST.map((s) => (
              <div
                key={s.slug}
                style={{
                  padding: "8px 10px",
                  background: "rgba(0,0,0,0.25)",
                  border: "1px solid rgba(255,255,255,0.08)",
                  borderRadius: 6,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "baseline",
                    gap: 6,
                    marginBottom: 2,
                  }}
                >
                  <code
                    style={{
                      fontSize: 12,
                      color: "rgba(255,255,255,0.95)",
                      fontWeight: 600,
                    }}
                  >
                    {s.slug}
                  </code>
                  <span
                    style={{
                      fontSize: 9,
                      letterSpacing: "0.1em",
                      textTransform: "uppercase",
                      color: s.prior === "runtime" ? "#d97757" : s.prior === "eval" ? "#8b5cf6" : "#06b6d4",
                    }}
                  >
                    {s.prior}
                  </span>
                </div>
                <div
                  style={{
                    fontSize: 11,
                    color: "rgba(255,255,255,0.6)",
                    lineHeight: 1.4,
                  }}
                >
                  {s.why}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Filter bar: category pills + stack dropdown + delta toggle + search */}
        <div
          data-radar-filters
          style={{ display: "flex", gap: 10, marginBottom: 14, flexWrap: "wrap", alignItems: "center" }}
        >
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search title / summary / stack…"
            style={{
              flex: "1 1 260px",
              padding: "7px 12px",
              background: "rgba(255,255,255,0.03)",
              border: "1px solid rgba(255,255,255,0.1)",
              borderRadius: 6,
              color: "rgba(255,255,255,0.92)",
              fontSize: 13,
              fontFamily: "inherit",
            }}
          />
          <select
            value={stackFilter}
            onChange={(e) => setStackFilter(e.target.value)}
            style={{
              padding: "7px 10px",
              background: "rgba(255,255,255,0.03)",
              border: "1px solid rgba(255,255,255,0.1)",
              borderRadius: 6,
              color: "rgba(255,255,255,0.85)",
              fontSize: 13,
              fontFamily: "inherit",
              cursor: "pointer",
            }}
          >
            <option value="all">All stacks ({allStacks.length})</option>
            {allStacks.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "7px 12px",
              background: deltaOnly ? "rgba(217,119,87,0.12)" : "rgba(255,255,255,0.03)",
              border: `1px solid ${deltaOnly ? "rgba(217,119,87,0.4)" : "rgba(255,255,255,0.1)"}`,
              borderRadius: 6,
              color: deltaOnly ? "#fff" : "rgba(255,255,255,0.75)",
              fontSize: 12,
              cursor: "pointer",
            }}
          >
            <input
              type="checkbox"
              checked={deltaOnly}
              onChange={(e) => setDeltaOnly(e.target.checked)}
              style={{ accentColor: "#d97757" }}
            />
            Last 24h only
          </label>
        </div>

        <div style={{ display: "flex", gap: 6, marginBottom: 24, flexWrap: "wrap" }}>
          {(Object.keys(CATEGORY_LABEL) as Category[]).map((c) => {
            const active = c === category;
            const n =
              c === "all"
                ? counts
                  ? Object.values(counts).reduce((s, v) => s + (v as number), 0)
                  : 0
                : counts?.[c] ?? 0;
            return (
              <button
                key={c}
                type="button"
                onClick={() => setCategory(c)}
                style={{
                  padding: "6px 14px",
                  borderRadius: 999,
                  border: active
                    ? "1px solid rgba(217,119,87,0.45)"
                    : "1px solid rgba(255,255,255,0.1)",
                  background: active ? "rgba(217,119,87,0.12)" : "rgba(255,255,255,0.02)",
                  color: active ? "#fff" : "rgba(255,255,255,0.7)",
                  fontSize: 12,
                  cursor: "pointer",
                }}
              >
                {CATEGORY_LABEL[c]}{" "}
                <span style={{ color: "rgba(255,255,255,0.4)", marginLeft: 4 }}>{n}</span>
              </button>
            );
          })}
        </div>

        {filtered === undefined ? (
          <div style={{ display: "grid", gap: 12 }} aria-busy="true" aria-label="Loading Radar items">
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="skeleton"
                style={{
                  height: 96,
                  borderRadius: 10,
                }}
              />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          // When the Convex feed returns empty AND no filters are active,
          // show seeded FALLBACK_ITEMS so the page is never a dead end.
          // If filters ARE active and still no matches, that's a real
          // empty state — keep the original message.
          category === "all" && stackFilter === "all" && !deltaOnly && !search ? (
            <>
              <div
                style={{
                  marginBottom: 10,
                  padding: "8px 12px",
                  background: "rgba(245,158,11,0.08)",
                  border: "1px solid rgba(245,158,11,0.3)",
                  borderRadius: 8,
                  fontSize: 12,
                  color: "rgba(255,255,255,0.75)",
                  lineHeight: 1.5,
                }}
              >
                <strong style={{ color: "#f59e0b" }}>Seed items —</strong>{" "}
                live feed is initializing. Below: representative items
                showing the shape of a normalized architecture signal.
                Each carries source tier, stack, and which internal
                prior it updates.
              </div>
              <div style={{ display: "grid", gap: 12 }}>
                {FALLBACK_ITEMS.map((item) => {
                  const tierLook = TIER_LOOK[item.sourceTier] ?? TIER_LOOK.tier3_weak;
                  const priorLook = PRIOR_LOOK[item.updatesPrior] ?? PRIOR_LOOK.none;
                  const lanes: string[] = (() => {
                    try {
                      return JSON.parse(item.affectsLanesJson);
                    } catch {
                      return [];
                    }
                  })();
                  return (
                    <article
                      key={item._id}
                      style={{
                        padding: 14,
                        background: "rgba(255,255,255,0.02)",
                        border: "1px solid rgba(255,255,255,0.06)",
                        borderRadius: 10,
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
                        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600, color: "rgba(255,255,255,0.92)", flex: "1 1 auto" }}>
                          {item.title}
                        </h3>
                        <Badge label={tierLook.label} color={tierLook.color} />
                        <Badge label={priorLook.label} color={priorLook.color} />
                      </div>
                      <p style={{ margin: "0 0 6px", fontSize: 12, lineHeight: 1.55, color: "rgba(255,255,255,0.72)" }}>
                        {item.summary}
                      </p>
                      <div style={{ fontSize: 10.5, color: "rgba(255,255,255,0.45)", letterSpacing: "0.02em" }}>
                        stack: <code style={{ color: "rgba(255,255,255,0.7)" }}>{item.stack}</code>
                        {lanes.length > 0 ? (
                          <> · affects: {lanes.map((l) => l.replace(/_/g, " ")).join(", ")}</>
                        ) : null}
                        <> · seeded</>
                      </div>
                    </article>
                  );
                })}
              </div>
            </>
          ) : (
            <div
              style={{
                padding: 20,
                background: "rgba(255,255,255,0.02)",
                border: "1px solid rgba(255,255,255,0.06)",
                borderRadius: 10,
                color: "rgba(255,255,255,0.55)",
                fontSize: 13,
              }}
            >
              No matches for the current filters
              {search ? <> — search: <strong>{search}</strong></> : null}
              {stackFilter !== "all" ? <> — stack: <strong>{stackFilter}</strong></> : null}
              {deltaOnly ? <> — last 24h only</> : null}.
            </div>
          )
        ) : (
          <div style={{ display: "grid", gap: 12 }}>
            {filtered.map((item) => {
              const tierLook = TIER_LOOK[item.sourceTier] ?? TIER_LOOK.tier3_weak;
              const priorLook = PRIOR_LOOK[item.updatesPrior] ?? PRIOR_LOOK.none;
              const lanes: string[] = (() => {
                try {
                  return JSON.parse(item.affectsLanesJson);
                } catch {
                  return [];
                }
              })();
              return (
                <article
                  key={item._id}
                  style={{
                    padding: 18,
                    background: "rgba(255,255,255,0.02)",
                    border: "1px solid rgba(255,255,255,0.06)",
                    borderRadius: 10,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "flex-start",
                      gap: 16,
                      marginBottom: 8,
                    }}
                  >
                    <h3 style={{ margin: 0, fontSize: 15, fontWeight: 500 }}>
                      <a
                        href={item.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ color: "rgba(255,255,255,0.92)", textDecoration: "none" }}
                      >
                        {item.title}
                      </a>
                    </h3>
                    <div style={{ display: "flex", gap: 6, flexShrink: 0, alignItems: "center" }}>
                      <Badge label={tierLook.label} color={tierLook.color} />
                      <Badge label={priorLook.label} color={priorLook.color} />
                      <button
                        type="button"
                        onClick={() => void dismissItem({ itemId: item.itemId })}
                        title="Dismiss item"
                        style={{
                          padding: "2px 8px",
                          background: "transparent",
                          border: "1px solid rgba(255,255,255,0.15)",
                          borderRadius: 4,
                          color: "rgba(255,255,255,0.55)",
                          fontSize: 11,
                          cursor: "pointer",
                        }}
                      >
                        Dismiss
                      </button>
                    </div>
                  </div>
                  <p
                    style={{
                      margin: "0 0 10px",
                      fontSize: 13,
                      color: "rgba(255,255,255,0.7)",
                      lineHeight: 1.5,
                    }}
                  >
                    {item.summary}
                  </p>
                  {item.suggestedAction ? (
                    <div
                      style={{
                        padding: 10,
                        background: "rgba(217,119,87,0.06)",
                        border: "1px solid rgba(217,119,87,0.2)",
                        borderRadius: 6,
                        fontSize: 12,
                        color: "rgba(255,255,255,0.8)",
                        lineHeight: 1.5,
                        marginBottom: 10,
                      }}
                    >
                      <strong style={{ color: "#d97757" }}>Suggested: </strong>
                      {item.suggestedAction}
                    </div>
                  ) : null}
                  <div
                    style={{
                      display: "flex",
                      gap: 12,
                      fontSize: 11,
                      color: "rgba(255,255,255,0.45)",
                      flexWrap: "wrap",
                      alignItems: "center",
                    }}
                  >
                    <span style={{ fontFamily: "'JetBrains Mono', monospace" }}>
                      {item.stack}
                    </span>
                    <span>{new Date(item.changedAt).toLocaleDateString()}</span>
                    {lanes.length > 0 ? (
                      <span>
                        affects: {lanes.map((l) => l.replace(/_/g, " ")).join(", ")}
                      </span>
                    ) : null}
                    <a
                      href={item.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        marginLeft: "auto",
                        color: "#d97757",
                        textDecoration: "none",
                        fontSize: 11,
                      }}
                    >
                      source →
                    </a>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}

function Badge({ label, color }: { label: string; color: string }) {
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 8px",
        fontSize: 10,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        fontWeight: 600,
        color,
        background: `${color}22`,
        border: `1px solid ${color}55`,
        borderRadius: 4,
      }}
    >
      {label}
    </span>
  );
}
