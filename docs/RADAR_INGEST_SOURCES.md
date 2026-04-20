# Radar Ingest Sources

Full inventory of what feeds the Radar page + how each source is tiered,
cadenced, and used by the recommender.

## Tier discipline

| Tier | Label | Used for | Examples |
|---|---|---|---|
| 1 | `tier1_official` | Authoritative — can update recommender priors directly | GitHub Releases, official changelogs, public benchmark leaderboards |
| 2 | `tier2_interpreter` | Trusted interpretation — requires operator review before prior shift | Vellum blog, vendor launch posts, curated patterns from video talks |
| 3 | `tier3_weak` | Weak signal — NEVER used alone to update a prior | Hacker News front page matches, X posts, discourse threads |

Every row carries a `sourceTier` column and the UI renders a tier badge
on every row. The recommender code path checks tier when deciding
whether to update a prior automatically vs. flag for operator review.

## Active ingest jobs (on joyous-walrus-428)

| Job | Source | Cadence | File |
|---|---|---|---|
| `radar-ingest-github-releases` | 10 GitHub repos (see below) | every 6h | `convex/domains/daas/radarIngest.ts` |
| `radar-ingest-hackernews` | HN Firebase top-500 keyword filter | every 2h | `convex/domains/daas/radarHnIngest.ts` |

Both jobs write to `daasAuditLog` with op `radar.ingestAll` /
`radar.ingestHn` so ingest health is visible on the Radar page header.

## GitHub Releases watchlist (tier 1)

| Repo | Stack | Category | Updates prior |
|---|---|---|---|
| `anthropics/claude-code` | `claude_code` | release | runtime |
| `openai/openai-agents-python` | `openai_agents_sdk` | release | runtime |
| `anthropics/anthropic-sdk-python` | `anthropic_sdk` | release | runtime |
| `langchain-ai/langgraph` | `langgraph` | release | runtime |
| `google/adk-python` | `google_adk` | release | runtime |
| `bytedance/deer-flow` | `deerflow` | release | runtime |
| `NousResearch/Hermes-Function-Calling` | `hermes_agent` | release | runtime |
| `sierra-research/tau2-bench` | `benchmarks` | benchmark | eval |
| `princeton-nlp/SWE-bench` | `benchmarks` | benchmark | eval |
| `ShishirPatil/gorilla` | `benchmarks` | benchmark | eval |

Per-run caps: 5 items per source, 60 total per run. Uses
`AbortSignal.timeout(8_000)`. Optional `GITHUB_TOKEN` env bumps the
rate limit from 60 req/hr → 5000 req/hr — set it on the Convex
environment when traffic warrants.

## HackerNews Firebase watchlist (tier 3)

API: `https://hacker-news.firebaseio.com/v0/topstories.json` →
`/v0/item/<id>.json`. Unauthenticated.

Keyword filter (title must contain ≥1, case-insensitive):

```
claude code, claude agent, agent sdk, mcp server, langgraph,
langchain, openai agents, anthropic sdk, swe-bench, bfcl, tau2,
judgebench, terminal-bench, browsecomp, tool calling, function
calling, llm agent, ai agent, orchestrator worker, scaffold,
distillation
```

Per-run cap: 25 items. Tight filter is deliberate — noise poisons the
weak-signal bucket faster than sparse matches hurt coverage.

Each match is stored as:
- `itemId = hn:<stack>:<hn_id>`
- `sourceTier = tier3_weak`
- `updatesPrior` depends on keyword → runtime/eval/none
- `suggestedAction` hard-coded: *"Weak signal. Don't act on this alone;
  check the matching Tier 1 repo/changelog for a corroborating release
  before updating recommender priors."*

## Sources explicitly scoped OUT (for now)

| Source | Why skipped |
|---|---|
| Anthropic `/docs/claude-code/changelog` HTML | Scrape is fragile; GitHub releases already cover the same signal authoritatively |
| OpenAI `/docs/changelog` HTML | Same reason |
| Google ADK HTML changelog | Same reason |
| Vellum blog (tier 2) | Manual curation for now; auto-ingest would flood tier 2 |
| X / Twitter | Requires API auth + cost; revisit when we have a budget and an operator |
| Discord / Slack communities | No structured feed; revisit if a user specifically requests |

When a request comes in for any of these, extend
`convex/domains/daas/` with a new `radar<Source>Ingest.ts` file
following the same pattern (action + internalAction + cron entry).

## Operator controls

- **Dismiss**: per-row dismiss button on `/radar` soft-hides an item
  (sets `dismissed: true`). `listItems` default filters dismissed out.
- **Ingest health card**: top of `/radar` shows last run timestamp +
  status per job, plus 24h error count with a direct link to
  `/_internal/fidelity` for drill-down.
- **Category / stack / time / text filters**: all client-side against
  the already-loaded result set.

## When an ingest regresses

1. `/radar` ingest-health card goes red (any error in last 24h).
2. `daasAuditLog` has the error message in `errorMessage` per
   `radar.ingestAll` / `radar.ingestHn` row.
3. Read `npx convex logs --prod` for the full stack trace.
4. Fix + re-deploy. The cron catches up on the next interval; no
   manual backfill needed.
