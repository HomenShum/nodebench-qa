# ADR — Live Agent Runs + Trace Viewer

**Status:** Draft · scope MVP · 2026-04-22
**Owner:** Homen
**Informed by:** Convex Chef, LangSmith run viewer, Arize AX evaluators, Anthropic Claude cookbook observability

## Problem

Today attrition does this:
```
User prompt → classifier → scaffold emitted → Download ZIP → user runs it on their laptop
```

The user never sees **their** agent running on **our** site. That's a
fatal gap for four audiences:

| Audience | Gap it creates |
|---|---|
| Demo-day investor | We say "it works" but they only see source code and a scripted terminal simulator — not an actual run with real tokens, real latencies, real tool calls |
| Senior engineer evaluating us | They can read code but can't verify behavior without leaving our site and running it locally — 2 weeks of friction before they commit |
| Product manager / CTO | Can't share "here's our agent working" to a colleague via URL |
| Us (eval flywheel) | Our 11 gates are structural; we can't measure "does this scaffold actually execute end-to-end" without running it |

The precedent is clear:

- **Convex Chef** ([get-convex/chef](https://github.com/get-convex/chef))
  generates Convex apps from a chat prompt and runs them live on
  Convex infrastructure, with a streaming preview URL. The user
  never downloads anything until they're satisfied with the live
  preview.
- **LangSmith** shows every LLM + tool call as a span, with a
  hierarchical trace viewer: input, output, tokens, latency, per-step.
- **Arize AX** goes further with reusable **evaluators** (LLM-as-judge
  templates you can apply to any trace): summarization quality,
  hallucination detection, SQL correctness, user-frustration scoring.
  [arize.com/docs/ax/evaluate/evaluators](https://arize.com/docs/ax/evaluate/evaluators)
- **Anthropic cookbook observability_agent** shows structured trace
  events for tool dispatch + git/github/CI integration.

## What "live on our site" means

Three tiers we should build toward, in order:

### Tier 1 — Playback (MVP, this cycle)

Every scaffold is annotated with a telemetry hook that emits **trace
spans** as it runs. We don't need real execution to ship this tier —
our Preview-tab simulator can POST real spans to our webhook, and
the `/runs/:runId` page reads them back. This gives us:

- A real data model that matches Tiers 2/3 shape
- A real-time trace UI users can demo
- A real persistent artifact (shareable URL, replayable history)

### Tier 2 — Mock-mode live execution (next cycle)

User clicks "Run live" on their emitted scaffold. The scaffold runs
server-side in **mock connector mode** against a sandbox (Modal /
Cloud Run / Convex action). No real LLM, no real keys required.
Every step emits a span. Same UI, real backend.

### Tier 3 — Real LLM execution with BYOK or rate-limited shared keys (cycle after)

User pastes their own API key (BYOK) OR uses our rate-limited shared
key. Scaffold runs with real LLM calls against their own Anthropic /
OpenAI / Gemini / OpenRouter accounts. Full production-equivalent
trace.

This ADR focuses on Tier 1. Tiers 2 & 3 are noted so the schema
supports them without rework.

## Data model

Two new Convex tables, additive (no migration impact):

```typescript
// convex/domains/daas/schema.ts

/**
 * agentRuns — one row per live-run invocation.
 *
 * Lifecycle: created (status="running") → spans accumulate →
 * terminal event (status="complete" or "failed") with finalOutput +
 * totals. A run can be retried → new runId, new row.
 */
export const agentRuns = defineTable({
  runId: v.string(),                    // UUID, public shareable
  sessionSlug: v.optional(v.string()),  // links back to Architect
  runtimeLane: v.string(),              // e.g. "orchestrator_worker"
  driverRuntime: v.string(),            // e.g. "gemini_agent"
  mode: v.string(),                     // "mock" | "live"
  status: v.string(),                   // "running" | "complete" | "failed"
  startedAt: v.number(),
  finishedAt: v.optional(v.number()),
  input: v.string(),                    // user's prompt, bounded 4KB
  finalOutput: v.optional(v.string()),  // top-level result, bounded 8KB
  totalCostUsd: v.number(),             // computed sum across spans
  totalInputTokens: v.number(),
  totalOutputTokens: v.number(),
  totalSpans: v.number(),               // denormalized count
  errorMessage: v.optional(v.string()),
})
  .index("by_runId", ["runId"])
  .index("by_sessionSlug_startedAt", ["sessionSlug", "startedAt"])
  .index("by_status_startedAt", ["status", "startedAt"]);

/**
 * agentTraceSpans — one row per step of an agent run.
 *
 * Kinds match what the Preview tab simulator shows + what real agents
 * emit:
 *   llm       — a single LLM call (model, prompt, output, tokens, cost)
 *   tool      — a tool dispatch (name, args, result, elapsed)
 *   compact   — a context-compaction event (before/after token counts)
 *   handoff   — an orchestrator→worker handoff (from, to, payload)
 *   wait      — explicit waits (retry backoff, rate-limit hold)
 *   meta      — scaffold-level events (run_start, run_end, error)
 *
 * Hierarchical: parentSpanId lets us render nested timelines
 * (orchestrator span contains worker_A span contains tool span).
 *
 * Bounded: inputJson + outputJson capped at 8KB each before insert,
 * the rest stored elsewhere if the user needs full blobs.
 */
export const agentTraceSpans = defineTable({
  runId: v.string(),
  spanId: v.string(),                   // ULID, sortable
  parentSpanId: v.optional(v.string()),
  kind: v.string(),                     // llm | tool | compact | handoff | wait | meta
  name: v.string(),                     // e.g. "sku_lookup", "model.call", "compact"
  startedAt: v.number(),
  finishedAt: v.optional(v.number()),
  inputJson: v.string(),                // bounded 8KB
  outputJson: v.string(),               // bounded 8KB
  inputTokens: v.optional(v.number()),
  outputTokens: v.optional(v.number()),
  costUsd: v.optional(v.number()),
  modelLabel: v.optional(v.string()),   // "gemini-3.1-flash-lite-preview"
  promptHash: v.optional(v.string()),   // dedup key for prompt-caching insight
  errorMessage: v.optional(v.string()),
})
  .index("by_runId_startedAt", ["runId", "startedAt"])
  .index("by_runId_kind", ["runId", "kind"])
  .index("by_parentSpanId", ["parentSpanId"]);
```

Two new indexes per table — cheap storage, read-light.

## Emission path

```
scaffold's observability.py     attrition web app
        │                             │
        │  POST /http/attritionTrace  │
        │  {runId, kind, name, ...}   │
        ├──────────────────────────►  │
        │                             │
        │                             │  convex mutation:
        │                             │  agentTrace.recordSpan
        │                             │  → agentTraceSpans insert
        │                             │  → agentRuns patch (totals)
        │                             │
        │                             │  UI subscribes via:
        │                             │  useQuery(listSpansForRun)
        │                             │  → timeline card re-renders
```

## UI: /runs/:runId

Borrowed shape (not pixel-copy) from LangSmith + Arize AX + our existing
trace aesthetic:

```
┌────────────────────────────────────────────────────────────────────┐
│ Run abc123def · orchestrator_worker · gemini_agent · mock         │
│ started 4.4s ago · 12 spans · 3 LLM calls · $0.0120 · 4.9K tokens │
├────────────────────────────────────────────────────────────────────┤
│                                                                    │
│  ┌──► META   run_start        4.4s ago                          ▸│
│  │                                                                  │
│  ├──► LLM    model.call        claude-sonnet-4.6                 ▸│
│  │   in=180 out=42 · $0.0004 · 0.9s                                │
│  │                                                                  │
│  ├──► TOOL   sku_lookup        worker_A                          ▸│
│  │   args: {"sku": "SKU-442"}                                       │
│  │   result: {"stock": 120, "price": 19.99}                         │
│  │                                                                  │
│  ├──► TOOL   order_place       worker_B                          ▸│
│  │   args: {"sku": "SKU-442", "qty": 50}                            │
│  │                                                                  │
│  ├──► COMPACT  scratchpad      from=2840t to=620t                ▸│
│  │                                                                  │
│  └──► META   run_end           4.4s                              ▸│
│                                                                    │
└────────────────────────────────────────────────────────────────────┘

▸ expands to full card: input · output · prompt · tokens · cost · errors
```

Filter chips across the top: `all · llm only · tool only · errors only`.
Bottom sticky bar: cost tally + share-link + "re-run" button.

## Per-span card expanded (the LangSmith-equivalent detail view)

When a user clicks ▸ on an LLM span:

```
┌─ LLM · model.call · claude-sonnet-4.6 ──────────────────────────┐
│ started 4.4s ago · took 920ms · $0.0004                         │
│                                                                  │
│ Prompt                                                    [copy] │
│ ────────────────────────────────────────────────────────────────│
│ You are an ops analyst. Use tools first. Answer concisely.      │
│                                                                  │
│ User input                                                [copy] │
│ ────────────────────────────────────────────────────────────────│
│ Order 50 units of SKU-442 if stock > 100, then summarize EOD.   │
│                                                                  │
│ Tool definitions available (3)                              [▸] │
│                                                                  │
│ Model output                                              [copy] │
│ ────────────────────────────────────────────────────────────────│
│ I'll look up the SKU first. [tool_call:sku_lookup...]            │
│                                                                  │
│ Tokens: in 180 · out 42 · cache-hit 0%                           │
│ Cost: $0.0004 · latency 920ms                                    │
└──────────────────────────────────────────────────────────────────┘
```

When a TOOL span:

```
┌─ TOOL · sku_lookup · worker_A ──────────────────────────────────┐
│ started 4.4s ago · took 40ms · connector=mock                   │
│                                                                  │
│ Arguments                                                  [copy]│
│ {                                                                │
│   "sku": "SKU-442"                                               │
│ }                                                                │
│                                                                  │
│ Result                                                     [copy]│
│ {                                                                │
│   "stock": 120,                                                  │
│   "price": 19.99                                                 │
│ }                                                                │
└──────────────────────────────────────────────────────────────────┘
```

## Tier 1 deliverables (this cycle)

1. `convex/domains/daas/schema.ts` — +`agentRuns` +`agentTraceSpans`
2. `convex/domains/daas/agentTrace.ts` — 4 functions:
   - `startRun` (mutation): create `agentRuns` row with status=running
   - `recordSpan` (mutation): insert `agentTraceSpans` row + patch `agentRuns` totals
   - `finishRun` (mutation): patch status + finalOutput + finishedAt
   - `listSpansForRun` (query): ordered span list for UI subscription
   - `getRun` (query): run header metadata
3. `convex/http.ts` — `POST /http/attritionTrace` endpoint
4. `frontend/src/pages/Run.tsx` — `/runs/:runId` route, step-card timeline
5. `frontend/src/main.tsx` — route registration
6. `frontend/src/pages/Builder.tsx` — Preview tab wires its simulator
   to emit REAL spans so there's a working demo run.
7. `daas/compile_down/emitters/_bundle_finalize.py` — `_observability_py()`
   canonical gets a `trace_span(...)` helper that POSTs to `/http/attritionTrace`
   (opt-in via env var).

## Tier 2 / 3 hooks (future, reserved in this design)

- Mock-mode server-side execution → Convex action that invokes a
  sandbox runner (Modal, Cloud Run). Emits spans same way. Rate-
  limited via existing `daasRateBuckets`.
- BYOK UI → stored in `localStorage` (client-side only, never hits
  our server) OR optionally encrypted in Convex for cross-device.
  Keys are passed to the sandbox runner via short-lived signed env
  injection.
- Evaluators (Arize-AX-style) → a new table `agentEvaluators` plus
  `agentEvaluationResults` joining against `agentTraceSpans`. LLM-
  as-judge templates defined once, run against any trace. Our
  existing 11-gate eval becomes a canonical "attrition structural
  evaluator" the user can see + extend.

## Non-goals (explicit)

- Full sandboxed code execution (Tier 2 — next cycle)
- BYOK (Tier 3 — cycle after)
- Streaming real LLM tokens into the trace UI
- Share-with-non-logged-in-users (runId is shareable URL, but
  auth gates may apply for private runs)
- Tool-call replay / editing from the trace UI (later)

## Open questions

1. **Span retention** — do we keep forever or TTL after 90 days? MVP: indefinite, add TTL when it becomes expensive.
2. **Multi-tenancy** — should runs be scoped per-user? MVP: public by runId (unguessable UUID), add auth later.
3. **Trace-level evaluators** — how much of Arize's evaluator pattern do we adopt in Tier 1? MVP: none; trace viewer is read-only. Add eval-on-trace in cycle after Tier 3.
4. **Trace export** — JSON download of the full trace? MVP: no; add in Tier 2.

## Success criteria for Tier 1

- A user can click "Run live" on Builder, see `/runs/:runId` open in a new tab
- Timeline populates with real spans as the run progresses
- Each span is expandable to show input/output/prompt/tokens/cost
- Share the URL with a colleague — they see the same trace
- Zero LLM cost for this tier (simulator data only)
- Ships in one cycle, ≤ 500 LOC net added to frontend

## References

- Convex Chef — [get-convex/chef](https://github.com/get-convex/chef) — live-preview-of-generated-app pattern
- LangSmith run viewer — hierarchical spans, expandable per-step detail
- Arize AX Evaluators — [arize.com/docs/ax/evaluate/evaluators](https://arize.com/docs/ax/evaluate/evaluators) — LLM-as-judge templates + online evals
- Anthropic observability_agent cookbook — structured trace events for DevOps

## Canonical future reference

Once Tier 1 ships, this doc lives at
`docs/LIVE_RUN_AND_TRACE_ADR.md` as the architecture of record.
Future Tier 2 / Tier 3 changes should update sections here
rather than create parallel docs.
