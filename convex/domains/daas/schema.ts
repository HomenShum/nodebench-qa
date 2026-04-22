// Distillation-as-a-Service domain schema.
//
// Mirrors the Python DaaS pipeline outputs (canonical_traces, workflow_specs,
// replays, judgments). Every table is bounded (BOUND) with explicit time indexes
// so pruning jobs can cap historical data. Scores + similarity are stored as-is
// from deterministic computation (HONEST_SCORES — never hardcoded floors).
//
// See:
//   docs/DISTILLATION_AS_A_SERVICE.md
//   docs/BENCHMARK_STRATEGY.md
//   daas/schemas.py (Python dataclasses this schema mirrors)

import { defineTable } from "convex/server";
import { v } from "convex/values";

/** Pipeline stage names — matches the 6-stage diagram in DISTILLATION_AS_A_SERVICE.md. */
export const DAAS_PIPELINE_STAGES = [
  "ingest",
  "normalize",
  "distill",
  "generate",
  "replay",
  "judge",
] as const;

/** Deterministic verdict set — bounded enum, same shape as Python Judgment.verdict. */
export const DAAS_VERDICTS = ["pass", "partial", "fail"] as const;

/**
 * daasTraces — one row per ingested expert-model trace.
 *
 * Source is source-agnostic: Claude Code session, existing codebase runtime
 * (e.g., FloorAI Convex agent), raw JSONL upload, etc. The Normalizer
 * collapses everything to this shape.
 */
export const daasTraces = defineTable({
  sessionId: v.string(), // user-supplied / MCP-generated ID
  sourceModel: v.string(), // e.g. "gemini-3.1-pro-preview"
  advisorModel: v.optional(v.string()),
  sourceSystem: v.optional(v.string()), // "claude-code" | "convex-agent" | "raw-jsonl" | ...
  query: v.string(),
  finalAnswer: v.string(),
  totalCostUsd: v.number(),
  totalTokens: v.number(),
  durationMs: v.number(),
  repoContextJson: v.optional(v.string()), // stringified repo_context
  stepsJson: v.optional(v.string()), // stringified list of TraceStep
  createdAt: v.number(),
})
  .index("by_sessionId", ["sessionId"])
  .index("by_sourceSystem_createdAt", ["sourceSystem", "createdAt"])
  .index("by_createdAt", ["createdAt"]);

/**
 * daasWorkflowSpecs — distilled WorkflowSpec (orchestrator + workers + tools + rules).
 *
 * One row per distilled trace. The `specJson` field holds the full structured
 * spec; callers who need fast filtering can use the denormalized columns.
 */
export const daasWorkflowSpecs = defineTable({
  sourceTraceId: v.string(), // daasTraces.sessionId
  executorModel: v.string(),
  advisorModel: v.optional(v.string()),
  targetSdk: v.string(), // "google-genai" | "openai" | "anthropic" | "langchain"
  workerCount: v.number(),
  toolCount: v.number(),
  handoffCount: v.number(),
  specJson: v.string(), // full WorkflowSpec JSON
  distillCostUsd: v.number(),
  distillTokens: v.number(),
  createdAt: v.number(),
})
  .index("by_sourceTraceId", ["sourceTraceId"])
  .index("by_createdAt", ["createdAt"]);

/**
 * daasReplays — one row per scaffold execution.
 *
 * Stores the cheap-model replay output plus measured cost/token telemetry.
 * Multiple replays can exist per spec (e.g., across runs, across executor
 * models, with different connector modes).
 */
export const daasReplays = defineTable({
  traceId: v.string(), // daasTraces.sessionId (original)
  specId: v.optional(v.id("daasWorkflowSpecs")),
  executorModel: v.string(),
  replayAnswer: v.string(),
  originalAnswer: v.string(), // denormalized for side-by-side UI
  originalCostUsd: v.number(),
  originalTokens: v.number(),
  replayCostUsd: v.number(),
  replayTokens: v.number(),
  workersDispatched: v.array(v.string()),
  toolCallsJson: v.optional(v.string()), // stringified [{worker, tool}]
  connectorMode: v.string(), // "mock" | "live" | "hybrid"
  durationMs: v.number(),
  errorMessage: v.optional(v.string()),
  createdAt: v.number(),
})
  .index("by_traceId", ["traceId"])
  .index("by_specId", ["specId"])
  .index("by_createdAt", ["createdAt"]);

/**
 * daasJudgments — one row per judge pass.
 *
 * Judge produces a bounded set of BOOLEAN CHECKS, each with an explainable
 * reason. No arbitrary floats. `checksJson` is the source of truth; every
 * other numeric field is derived:
 *   passedCount / totalCount            = aggregate pass rate
 *   costDeltaPct                        = measured from token counts (real)
 *   verdict                             = derived from pass rate thresholds
 *
 * This matches the user directive: "score should not be arbitrary numbers,
 * instead, it should be llm judged boolean explainable reasons."
 *
 * checksJson shape (validated at mutation boundary):
 *   [{ "name": string, "passed": boolean, "reason": string }]
 *
 * The judge model + rubric hash is recorded so dashboards can filter to
 * apples-to-apples comparisons across judge revisions.
 */
export const daasJudgments = defineTable({
  traceId: v.string(), // daasTraces.sessionId
  replayId: v.id("daasReplays"),

  // Real measured cost delta (kept because it's a MEASUREMENT, not a score)
  costDeltaPct: v.number(),

  // Bounded verdict derived from pass rate (see DAAS_VERDICTS)
  verdict: v.string(),

  judgedAt: v.number(),

  // Boolean-rubric shape — required. checksJson is source of truth:
  // [{ name, passed, reason }, ...]. Other fields are denormalized
  // aggregates stored for index + fast read.
  passedCount: v.number(),
  totalCount: v.number(),
  checksJson: v.string(),

  // Judge provenance (apples-to-apples rollouts across revisions)
  judgeModel: v.optional(v.string()),
  rubricId: v.optional(v.string()),
  rubricVersion: v.optional(v.string()),

  // Optional free-form rationale
  detailsJson: v.optional(v.string()),
})
  .index("by_traceId", ["traceId"])
  .index("by_replayId", ["replayId"])
  .index("by_verdict", ["verdict"])
  .index("by_judgedAt", ["judgedAt"]);

/**
 * daasApiKeys — authenticated ingest callers.
 *
 * Each row has a hashed key prefix (first 12 chars of sha256 hex for
 * index lookup — the raw key is never stored), owner label, optional
 * per-key rate-limit override, and enable flag. Admin action rotates
 * keys by toggling enabled=false and inserting a new row.
 *
 * NB: the raw key never touches Convex storage. The ingest path hashes
 * the provided header and looks up by prefix. This means a leaked DB
 * dump cannot be used to forge valid keys.
 */
export const daasApiKeys = defineTable({
  /** First 12 chars of sha256(rawKey) — enough to collision-avoid at scale we care about */
  keyHashPrefix: v.string(),
  /** Human-readable label (team name, integration name) */
  owner: v.string(),
  /** Optional per-key rate limit override. If null, falls back to global authed default */
  rateLimitPerMinute: v.optional(v.number()),
  /** When false, ingest requests with this key are rejected as if key was missing */
  enabled: v.boolean(),
  /** Optional HMAC secret for signed webhooks (see verifyIngestSignature) */
  webhookSecret: v.optional(v.string()),
  /** Last use timestamp for stale-key cleanup */
  lastUsedAt: v.optional(v.number()),
  createdAt: v.number(),
  notes: v.optional(v.string()),
})
  .index("by_keyHashPrefix", ["keyHashPrefix"])
  .index("by_owner", ["owner"])
  .index("by_createdAt", ["createdAt"]);

/**
 * daasAuditLog — append-only audit trail for every DaaS operation that
 * mutates or judges data. Every row has an actor (who), an operation
 * (what), a bounded status (ok | error | denied), and structured
 * metadata. Append-only per agent_run_verdict_workflow.md.
 *
 * Kept lean (< 2KB / row) so storage stays bounded; large payloads go
 * elsewhere and are referenced by id.
 */
export const DAAS_AUDIT_STATUSES = ["ok", "error", "denied"] as const;

export const daasAuditLog = defineTable({
  /** "http.ingest" | "action.judgeReplay" | "admin.deleteTracesByPrefix" | ... */
  op: v.string(),
  /** "cli" | "http" | "frontend" | "action" */
  actorKind: v.string(),
  /** Client identifier — bucketKey for HTTP, userId for authed actions */
  actorId: v.optional(v.string()),
  /** One of DAAS_AUDIT_STATUSES */
  status: v.string(),
  /** Optional traceId / replayId / judgmentId this entry relates to */
  subjectId: v.optional(v.string()),
  /** Bounded JSON blob with op-specific fields (cost, tokens, model, etc.) */
  metaJson: v.optional(v.string()),
  /** Short error string when status != "ok" */
  errorMessage: v.optional(v.string()),
  /** Duration of the operation in ms */
  durationMs: v.optional(v.number()),
  createdAt: v.number(),
})
  .index("by_createdAt", ["createdAt"])
  .index("by_op", ["op"])
  .index("by_status_createdAt", ["status", "createdAt"])
  .index("by_subjectId", ["subjectId"]);

/**
 * daasRateBuckets — DB-backed rate limit buckets.
 *
 * In-memory rate limiting doesn't work in Convex's serverless environment
 * (each HTTP action can land in a fresh container). This table persists
 * buckets so the limit is enforced across containers.
 *
 * BOUND: old rows (resetAt < now - 1 day) should be cleaned by a cron.
 * HONEST_SCORES: count is a real counter; resetAt is absolute epoch ms.
 */
export const daasRateBuckets = defineTable({
  /** Key is either `ip:<addr>` or `key:<hashed-api-key-prefix>` */
  bucketKey: v.string(),
  count: v.number(),
  /** Epoch ms when this bucket resets to 0 */
  resetAt: v.number(),
  /** Epoch ms when this row was last touched (for GC) */
  updatedAt: v.number(),
})
  .index("by_bucketKey", ["bucketKey"])
  .index("by_updatedAt", ["updatedAt"]);

/**
 * daasBenchmarkRuns — public-benchmark task executions with ground-truth scoring.
 *
 * The LLM-rubric judge (daasJudgments) catches hallucination + structural
 * failures, but it is still an LLM judging an LLM. Public benchmarks run
 * each task through the replay scaffold and score against deterministic
 * ground truth (unit tests, AST comparison, exact-match citations).
 *
 * Supported benchmarks (see docs/JUDGE_EVAL_BENCHMARKS.md):
 *   - "bfcl_v3"         — AST-level function call comparison (Day 1-2)
 *   - "mmlu_pro"        — single-letter exact match canary (Day 3-4)
 *   - "tau2_retail"     — DB end-state + expected-action match (Day 5-7)
 *   - "swebench_verified" — Docker unit-test PASS/FAIL (Day 8-10)
 *   - "reportbench"     — citation set precision/recall (Day 11-12)
 *
 * One row per (benchmark, taskId, replayId) triple. `rawResultJson` is the
 * benchmark-specific harness output verbatim; `passed` is the harness's
 * own boolean verdict (NOT an LLM's interpretation).
 */
export const DAAS_BENCHMARK_IDS = [
  "bfcl_v3",
  "bfcl_v4",
  "mmlu_pro",
  "tau2_retail",
  "tau2_telecom",
  "tau2_airline",
  "swebench_verified",
  "reportbench",
  "judgebench",
  "if_rewardbench",
  "mcp_atlas",
  "terminal_bench_2",
  "browsecomp",
  "arena_hard_auto",
  "rewardbench_2",
] as const;

/**
 * daasExternalizations — compile-time distillation artifacts.
 *
 * Every form of distillation (prompt / tool_schema / scaffold_graph) is
 * stored here as an opaque JSON blob. The schema DOES NOT interpret the
 * blob — interpretation is the form-specific trial runner's job.
 *
 * BOUND: artifactJson capped at 32KB (recordExternalization mutation
 * enforces). The entire artifact is loaded into the small model's
 * context on every distilled measurement, so bigger artifacts = more
 * tokens = higher cost per task.
 */
export const DAAS_EXTERNALIZATION_FORMS = [
  "prompt",
  "tool_schema",
  "scaffold_graph",
] as const;

export const daasExternalizations = defineTable({
  /** Stable human-readable identifier (e.g. "mmlu_pro_cot_v1"). Unique per row. */
  externalizationId: v.string(),
  /** One of DAAS_EXTERNALIZATION_FORMS */
  form: v.string(),
  /** Form-specific JSON payload; size-bounded by mutation */
  artifactJson: v.string(),
  /** Which big model this was distilled from (for provenance + attribution) */
  sourceModel: v.string(),
  /** Source trace session ids used to distill; empty array = hand-authored */
  sourceTraceIdsJson: v.string(),
  /** Short human note ("baseline cot", "v2 with worked example", etc.) */
  notes: v.optional(v.string()),
  createdAt: v.number(),
})
  .index("by_externalizationId", ["externalizationId"])
  .index("by_form_createdAt", ["form", "createdAt"])
  .index("by_createdAt", ["createdAt"]);

/**
 * daasFidelityTrials — per-task 3-measurement records.
 *
 * One row per (externalization, benchmark, task). Storing per-task (not
 * aggregated) lets us:
 *   1. Recompute the verdict when the classifier changes
 *   2. Drill into which tasks the scaffold helped vs hurt
 *   3. Split rollups by subject / category after the fact
 *
 * Error fields are distinct from pass/fail — a harness error excludes
 * that trial from the pass rate denominator, not an automatic failure.
 */
export const daasFidelityTrials = defineTable({
  externalizationId: v.string(),
  benchmarkId: v.string(),
  taskId: v.string(),
  baselineModel: v.string(),
  ceilingModel: v.string(),
  distilledModel: v.string(),
  baselinePassed: v.boolean(),
  ceilingPassed: v.boolean(),
  distilledPassed: v.boolean(),
  baselineCostUsd: v.number(),
  ceilingCostUsd: v.number(),
  distilledCostUsd: v.number(),
  baselineError: v.optional(v.string()),
  ceilingError: v.optional(v.string()),
  distilledError: v.optional(v.string()),
  createdAt: v.number(),
})
  .index("by_externalizationId_createdAt", ["externalizationId", "createdAt"])
  .index("by_externalizationId_benchmarkId", ["externalizationId", "benchmarkId"])
  .index("by_taskId", ["taskId"])
  .index("by_createdAt", ["createdAt"]);

/**
 * daasFidelityVerdicts — cached aggregated verdicts per (ext, benchmark) pair.
 *
 * Appended by the trial runner at the end of each run. Multiple verdicts
 * per pair exist (one per run); queries take the latest unless a specific
 * runId is requested. verdict is one of DAAS_TRANSFER_VERDICTS.
 */
export const DAAS_TRANSFER_VERDICTS = [
  "transfers",
  "lossy",
  "no_gap",
  "regression",
  "insufficient_data",
] as const;

/**
 * architectSessions — chat-first intake + architecture triage.
 *
 * Every landing-page interaction records a session: the user's prompt,
 * the classifier's streaming checklist, and the final 3-card recommendation
 * (runtime / world-model / eval). Builder page loads by sessionId.
 *
 * The classifier output is a bounded-shape JSON so downstream routing
 * (to Builder scaffolds, to Radar priors) stays type-safe.
 */
export const ARCHITECT_RUNTIME_LANES = [
  "simple_chain",        // bounded, deterministic, tool-routing / formatting
  "tool_first_chain",    // chain with structured tool calls and response schema
  "orchestrator_worker", // fan-out workers + handoffs + compaction
  "keep_big_model",      // route to frontier; don't try to distill
] as const;

export const ARCHITECT_WORLD_MODEL_LANES = [
  "lite",   // entities + schema only
  "full",   // entities + state + events + policies + actions + outcomes + evidence
] as const;

export const ARCHITECT_INTENT_LANES = [
  "compile_down",   // frontier -> cheap
  "compile_up",     // legacy chain -> scaffold
  "translate",      // one SDK/framework -> another
  "greenfield",     // no prior solution
  "unknown",        // classifier couldn't confidently pick a lane
] as const;

export const architectSessions = defineTable({
  /** Short human-shareable id: 8-char alphanum (URL-friendly). */
  sessionSlug: v.string(),
  /** The user's initial prompt */
  prompt: v.string(),
  /** Append-only list of {ts, role, content} — user + assistant turns */
  transcriptJson: v.string(),
  /** Bounded classifier output; see frontend Architect for shape */
  classificationJson: v.optional(v.string()),
  /** Streaming checklist state for UI replay */
  checklistJson: v.optional(v.string()),
  /** One of ARCHITECT_RUNTIME_LANES (final recommendation) */
  runtimeLane: v.optional(v.string()),
  /** One of ARCHITECT_WORLD_MODEL_LANES */
  worldModelLane: v.optional(v.string()),
  /** One of ARCHITECT_INTENT_LANES */
  intentLane: v.optional(v.string()),
  /** Free-form why + next-steps — capped at 4KB by mutation */
  rationale: v.optional(v.string()),
  /** Status: "intake" | "classifying" | "ready" | "accepted" | "dismissed" */
  status: v.string(),
  /** First 16 chars of sha256(owner_token) — minimal ownership check.
   *  Owner tokens are generated client-side and stored in localStorage;
   *  the hash is what the Builder page checks when deciding whether
   *  to show "owner" controls vs "guest view". Anyone with the slug
   *  can READ the session (share-link semantics); only the owner
   *  token holder can append turns / re-classify. */
  ownerHashPrefix: v.optional(v.string()),
  /** Cumulative USD spent by this session on classifier / replay calls.
   *  Enforced cap in architectClassifier when > SESSION_COST_CAP_USD. */
  totalCostUsd: v.optional(v.number()),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_sessionSlug", ["sessionSlug"])
  .index("by_status_createdAt", ["status", "createdAt"])
  .index("by_createdAt", ["createdAt"]);

/**
 * radarItems — normalized ecosystem intelligence feed.
 *
 * Tier 1 (official changelogs, GitHub releases, benchmark leaderboards) is
 * the authoritative source. Tier 2 (Vellum, vendor blogs) is interpretation.
 * Tier 3 (HN/X/discourse) is weak signal. Each item carries:
 *   - what changed
 *   - which stacks it affects
 *   - which internal prior to update (runtime / eval / world_model)
 *   - suggested action for attrition users
 *
 * Explicitly NOT an "AI news feed". Every row has an `affectsLanes` array
 * so the recommender can look up relevant updates when triaging a user
 * intake.
 */
export const RADAR_CATEGORIES = [
  "release",       // new version of a framework / model / SDK
  "benchmark",     // new benchmark, leaderboard shift, saturation signal
  "pattern",       // emerging architecture pattern (e.g. new orchestrator shape)
  "deprecation",   // removed / EOL feature
  "watchlist",     // tracked project heartbeat (seen activity but no notable change)
] as const;

export const RADAR_SOURCE_TIERS = ["tier1_official", "tier2_interpreter", "tier3_weak"] as const;

/**
 * daasGeneratedArtifacts — compile_down / compile_up / translate
 *   emitted runnable code bundles.
 *
 * One row per (architectSessions.sessionSlug, runtimeLane) pair.
 * Emit is idempotent — re-running the emitter upserts the same row.
 *
 * Bundle shape is opaque JSON of:
 *   { runtime_lane, target_model, files: [{ path, content, language }] }
 *
 * BOUND: total bundle capped at 256KB at the mutation boundary so a
 * runaway emitter can't balloon the table.
 */
export const daasGeneratedArtifacts = defineTable({
  sessionSlug: v.string(),
  runtimeLane: v.string(),
  targetModel: v.string(),
  artifactBundleJson: v.string(),
  filesCount: v.number(),
  totalBytes: v.number(),
  /** Which emitter produced this (for re-emission diffing) */
  emitterVersion: v.string(),
  /** Optional workflow spec JSON for downstream re-emission */
  workflowSpecJson: v.optional(v.string()),
  generatedAt: v.number(),
})
  .index("by_sessionSlug", ["sessionSlug"])
  .index("by_sessionSlug_runtimeLane", ["sessionSlug", "runtimeLane"])
  .index("by_generatedAt", ["generatedAt"]);

export const radarItems = defineTable({
  /** Stable id: "<category>:<slug>:<iso_date>" */
  itemId: v.string(),
  category: v.string(),
  sourceTier: v.string(),
  /** Which framework / project this item is about (e.g. "claude_code", "openai_agents_sdk") */
  stack: v.string(),
  title: v.string(),
  summary: v.string(), // 280 char cap enforced by mutation
  url: v.string(),
  /** ISO timestamp of the upstream change */
  changedAt: v.number(),
  /** Which architect lanes this affects — any of ARCHITECT_RUNTIME_LANES */
  affectsLanesJson: v.string(),
  /** Which priors to adjust: "runtime" | "eval" | "world_model" | "none" */
  updatesPrior: v.string(),
  /** Suggested action for attrition users, 1-2 sentences */
  suggestedAction: v.optional(v.string()),
  /** Dismissed by operator (hide from default Radar view) */
  dismissed: v.boolean(),
  createdAt: v.number(),
})
  .index("by_itemId", ["itemId"])
  .index("by_category_changedAt", ["category", "changedAt"])
  .index("by_stack_changedAt", ["stack", "changedAt"])
  .index("by_sourceTier_changedAt", ["sourceTier", "changedAt"])
  .index("by_dismissed_changedAt", ["dismissed", "changedAt"])
  .index("by_changedAt", ["changedAt"]);

export const daasFidelityVerdicts = defineTable({
  externalizationId: v.string(),
  benchmarkId: v.string(),
  /** One of DAAS_TRANSFER_VERDICTS */
  verdict: v.string(),
  /** Sample size used for this verdict (after error exclusions) */
  n: v.number(),
  /** Baseline pass rate (0..1) */
  baselineRate: v.number(),
  baselineCiLo: v.number(),
  baselineCiHi: v.number(),
  ceilingRate: v.number(),
  ceilingCiLo: v.number(),
  ceilingCiHi: v.number(),
  distilledRate: v.number(),
  distilledCiLo: v.number(),
  distilledCiHi: v.number(),
  gapPp: v.number(),
  transferPp: v.number(),
  /** transfer / gap when gap > 0; null (omitted) otherwise */
  fidelityPct: v.optional(v.number()),
  gapSignificant: v.boolean(),
  transferSignificant: v.boolean(),
  regressionSignificant: v.boolean(),
  /** One-line human explanation + next-action */
  narrative: v.string(),
  /** Total cost of this verdict's trials (baseline + ceiling + distilled) */
  totalCostUsd: v.number(),
  createdAt: v.number(),
})
  .index("by_externalizationId_createdAt", ["externalizationId", "createdAt"])
  .index("by_benchmarkId_createdAt", ["benchmarkId", "createdAt"])
  .index("by_verdict_createdAt", ["verdict", "createdAt"])
  .index("by_createdAt", ["createdAt"]);

/**
 * scaffoldPings — opt-in telemetry from downloaded scaffolds phoning home.
 *
 * Populated by POST /attritionPing (see convex/http.ts) when an emitted
 * scaffold passes a milestone (mock_exec_pass, live_smoke_pass, etc.).
 * The NextSteps UI subscribes to this table per session slug so the
 * 60-min checklist ticks in real time as the user ships.
 *
 * Bounded (BOUND): pruned to 90 days via cron. Scaffold can re-ping the
 * same event — we keep the latest row by (sessionSlug, event) via upsert
 * in the mutation; index by (sessionSlug, event) supports that lookup.
 * Auditable (HONEST_STATUS): the `raw` field records the full payload
 * for forensic review.
 */
/**
 * agentRuns — one row per live-run invocation.
 *
 * See docs/LIVE_RUN_AND_TRACE_ADR.md for the full architecture. One
 * run = one end-to-end agent invocation. Spans are emitted into
 * `agentTraceSpans` as the run progresses; totals on this row
 * (spans, tokens, cost) are patched as each span lands.
 *
 * Bounded (BOUND): input capped at 4KB, finalOutput at 8KB before
 * insert/patch. Pruning cron optional; MVP retains indefinitely.
 */
export const agentRuns = defineTable({
  /** Unguessable UUID — public shareable URL segment */
  runId: v.string(),
  /** Optional back-link to architectSessions.sessionSlug */
  sessionSlug: v.optional(v.string()),
  /** One of 12 emit lanes (simple_chain, orchestrator_worker, …) */
  runtimeLane: v.string(),
  /** One of 6 driver runtimes (gemini_agent, claude_agent_sdk, …) */
  driverRuntime: v.string(),
  /** "mock" (no real tools fired) | "live" (real connectors) */
  mode: v.string(),
  /** "running" | "complete" | "failed" */
  status: v.string(),
  startedAt: v.number(),
  finishedAt: v.optional(v.number()),
  /** User's prompt (bounded 4KB) */
  input: v.string(),
  /** Top-level result text (bounded 8KB); absent while running */
  finalOutput: v.optional(v.string()),
  /** Cumulative cost across all spans */
  totalCostUsd: v.number(),
  totalInputTokens: v.number(),
  totalOutputTokens: v.number(),
  /** Denormalized count — kept in sync by recordSpan */
  totalSpans: v.number(),
  /** Present when status="failed" */
  errorMessage: v.optional(v.string()),
})
  .index("by_runId", ["runId"])
  .index("by_sessionSlug_startedAt", ["sessionSlug", "startedAt"])
  .index("by_status_startedAt", ["status", "startedAt"]);

/**
 * agentTraceSpans — one row per step of an agent run.
 *
 * kind enum (string — using string instead of v.union for forward-compat):
 *   llm       — LLM call (model, prompt, output, tokens, cost)
 *   tool      — tool dispatch (name, args, result, elapsed)
 *   compact   — context compaction (before/after token counts)
 *   handoff   — orchestrator→worker handoff (from, to, payload)
 *   wait      — explicit waits (retry backoff, rate-limit hold)
 *   meta      — scaffold-level events (run_start, run_end, error)
 *
 * Hierarchical: parentSpanId enables nested timeline rendering
 * (orchestrator → worker_A → tool). Root spans have no parent.
 *
 * Bounded: inputJson + outputJson capped 8KB. Oversize payloads
 * truncated with a "...(truncated)" marker; full blobs are NOT
 * stored on this row — keep in object storage if needed.
 */
export const agentTraceSpans = defineTable({
  runId: v.string(),
  /** ULID — sortable by time, unique per run */
  spanId: v.string(),
  /** Parent span; root spans omit */
  parentSpanId: v.optional(v.string()),
  /** Span kind (see docstring) */
  kind: v.string(),
  /** Short human label ("sku_lookup", "model.call", "compact") */
  name: v.string(),
  startedAt: v.number(),
  finishedAt: v.optional(v.number()),
  /** Input payload as JSON (bounded 8KB) */
  inputJson: v.string(),
  /** Output payload as JSON (bounded 8KB); absent while running */
  outputJson: v.string(),
  /** LLM spans only — token counts */
  inputTokens: v.optional(v.number()),
  outputTokens: v.optional(v.number()),
  /** Computed cost for this span (LLM spans) */
  costUsd: v.optional(v.number()),
  /** Model alias for LLM spans */
  modelLabel: v.optional(v.string()),
  /** SHA-256 head of prompt for cache-hit insight */
  promptHash: v.optional(v.string()),
  /** Present when span failed */
  errorMessage: v.optional(v.string()),
})
  .index("by_runId_startedAt", ["runId", "startedAt"])
  .index("by_runId_kind", ["runId", "kind"])
  .index("by_parentSpanId", ["parentSpanId"]);

export const scaffoldPings = defineTable({
  /** Maps back to architectSessions.sessionSlug */
  sessionSlug: v.string(),
  /** One of: downloaded, mock_exec_pass, live_smoke_pass, first_prod_request, deployed */
  event: v.string(),
  /** When the scaffold reported the event (client-supplied) */
  clientTs: v.number(),
  /** When the webhook received it (server time) */
  serverTs: v.number(),
  /** Optional — lane captured at download time (cross-check) */
  runtimeLane: v.optional(v.string()),
  /** Optional — driver used */
  driverRuntime: v.optional(v.string()),
  /** Full JSON payload the scaffold sent, bounded <4KB */
  raw: v.string(),
})
  .index("by_sessionSlug_serverTs", ["sessionSlug", "serverTs"])
  .index("by_sessionSlug_event", ["sessionSlug", "event"])
  .index("by_event_serverTs", ["event", "serverTs"]);

export const daasBenchmarkRuns = defineTable({
  /** One of DAAS_BENCHMARK_IDS */
  benchmarkId: v.string(),
  /** Benchmark-native task identifier (BFCL call id, MMLU-Pro question_id, SWE-bench instance_id, etc.) */
  taskId: v.string(),
  /** DaaS trace session id the scaffold was distilled from (may be synthetic for benchmark-only runs) */
  sessionId: v.string(),
  /**
   * Replay row the harness scored against. Optional for standalone eval
   * runs (e.g. BFCL where the benchmark task IS the replay input and
   * doesn't need a separate distilled scaffold). When absent, this row
   * represents a raw executor-vs-benchmark measurement, not a scaffold
   * replay. Dashboards should filter by presence when comparing
   * "scaffold lift" vs "executor solo" numbers.
   */
  replayId: v.optional(v.id("daasReplays")),
  /** Executor model used in replay (e.g. "gemini-3.1-flash-lite-preview") */
  executorModel: v.string(),
  /** Ground-truth pass/fail from the benchmark harness itself (NO LLM in the loop) */
  passed: v.boolean(),
  /** Benchmark-specific score (0..1 float; e.g., BFCL AST match ratio, ReportBench F1) */
  score: v.number(),
  /** Harness-native structured output — JSON string, bounded < 16KB */
  rawResultJson: v.string(),
  /** Measured replay cost for this specific task (for cost-per-task-resolved reporting) */
  replayCostUsd: v.number(),
  /** Wall-clock duration from replay dispatch to harness verdict */
  durationMs: v.number(),
  /** Optional error if the harness itself failed (distinct from the scaffold failing a real task) */
  harnessError: v.optional(v.string()),
  createdAt: v.number(),
})
  .index("by_benchmarkId_taskId", ["benchmarkId", "taskId"])
  .index("by_benchmarkId_createdAt", ["benchmarkId", "createdAt"])
  .index("by_sessionId", ["sessionId"])
  .index("by_replayId", ["replayId"])
  .index("by_passed_createdAt", ["passed", "createdAt"]);
