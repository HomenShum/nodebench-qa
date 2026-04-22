# attrition eval template — real-world test cases

Parallel to `nodebench_fast_slow_eval_template_v2.csv`, but scoped to
what attrition itself does: **compile-down / compile-up / translate-
across** of agent scaffolds, across 11 emit lanes and 6 driver
runtimes. Every row is a real workflow a user would bring to
attrition tomorrow — retail ops, customer support, research, CRM,
coding agents, streaming UX, ops pipelines.

File: `daas/benchmarks/attrition_eval_template_v1.csv`
Rows: 60 (`AE01`–`AE60`)

## Schema differences from NodeBench's template

NodeBench asked "did the agent answer the question well?"
attrition asks "did we generate a scaffold that actually runs at
preserved quality for the lane the user needs?"

So the gates are attrition-flavored:

| Gate | What it proves |
|---|---|
| `scaffold_compiles` | Every `.py` in the emitted bundle `ast.parse`-valid |
| `scaffold_runs_mock` | `runner.py` / `main.py` imports + executes in `CONNECTOR_MODE=mock` |
| `nine_layers_present` | workflow_spec.json · server.py · state_store.py · eval/ · observability.py · mcp_server.py · README · requirements · run.sh · .env.example |
| `correct_lane_picked` | Classifier's `runtime_lane` matches intent (e.g. "deploy to Vercel" → `vercel_ai_sdk`) |
| `connector_resolver_working` | Flipping `CONNECTOR_MODE` mock ↔ live materially changes `dispatch()` output |
| `mcp_server_importable` | Emitted `mcp_server.py` loads as a stdio MCP server wrapping `dispatch()` |
| `workflow_spec_roundtrip` | `emit -> read workflow_spec.json -> re-emit` produces an identical bundle |
| `baseline_parity` | Scaffold pass rate ≥ Flash Lite solo baseline − CI (BFCL or broadened) |
| `cost_under_budget` | Total token cost ≤ `cost_budget_usd` for this row |
| `latency_under_budget` | Wall clock ≤ `latency_budget_s` for this row |
| `runtime_used_correctly` | `EVAL_VERDICT.runtime_label` matches the driver picked in `driver_runtime` |

Plus the same `overall_gate_pass` + `overall_gate_rationale` rollup.

## What the 60 cases cover

| Range | Coverage |
|---|---|
| AE01–AE06 | simple_chain + tool_first_chain (fast-path, 1–3 tools, BFCL-parallel) |
| AE07–AE10 | OpenAI Agents SDK + Claude Agent SDK target lanes |
| AE11–AE13 | LangGraph + OpenRouter driver runtimes |
| AE14–AE15 | **Gemini Deep Research** tiers (interactive + Max background) |
| AE16–AE18 | **Cross-runtime**: X drives, Y is the emit target (all 3 permutations measured) |
| AE19–AE23 | Manus / DeerFlow / Hermes / Convex / Vercel AI SDK emit lanes |
| AE24–AE30 | Parallel tools, distractors, ambiguous intent, secret-in-prompt, forced regression, roundtrip determinism |
| AE31–AE35 | Runtime-fidelity live replay, broadened eval, OpenRouter fallback routing, Deep Research drives emit |
| AE36–AE45 | Convex cron + Vercel streaming + LangGraph checkpointer + trace upload variants (Claude JSONL / LangChain / OpenAI runs / Gemini) |
| AE46–AE50 | File-only summaries, event-scoped recall, shared canonical cache, demo-day concurrent load, Convex codegen clean |
| AE51–AE56 | OpenAI built-in tools (FileSearch / CodeInterpreter / Shell) + Claude 1M-context compaction + Deep Research closed-world / mixed |
| AE57–AE60 | Adversarial distractors, BYO-CSV eval run, gate-flips-green telemetry, runtime_used_correctly audit |

## How to actually run it

1. **Extend** `daas/benchmarks/csv_eval_harness.py` (already exists
   for NodeBench) with the 11 attrition-specific gate checks —
   deterministic ones (compile, nine-layers, roundtrip) first;
   LLM-judged ones (correct_lane_picked, runtime_used_correctly)
   second.
2. **Run** a dry pass against the first 10 fast-mode rows (AE01,
   AE02, AE03, AE06, AE07, AE16, AE24, AE27, AE28, AE33, AE39,
   AE46, AE51, AE52, AE53) — total estimated cost under $0.02 and
   under 2 min wall clock.
3. **Run** slow-mode rows on demand — they involve full emit + eval,
   cost $0.02–$0.40 per row depending on the lane.
4. **Emit** `daas/results/attrition_eval_filled_v1.csv` with every
   cell populated (PASS/FAIL + 1-sentence rationale + overall
   verdict) just like the NodeBench output.

## Telemetry we're tracing per row

Beyond the per-gate PASS/FAIL, the harness records (schema already
in `AgentRunResult`):

- `runtime_label` — which of the 6 drivers was used
- `model` — the exact model alias (e.g. `anthropic:claude-sonnet-4.6`)
- `input_tokens` + `output_tokens`
- `cost_usd()` — computed from the `PRICING_PER_TOKEN` table in
  `daas/agent/base.py`
- `elapsed_ms`
- `tool_calls` — full array with arguments + result + elapsed_ms each

All of this gets joined into the output CSV per row so a dashboard
can slice by `driver_runtime × emit_lane × mode`, plot pass rate vs
cost, and flag regressions over time.

## The honest product framing for this template

> "Here's a 60-row matrix covering every emit lane × every driver
> runtime × every cross-combination × adversarial cases. For each
> row, 11 booleans + 11 rationales land in the filled CSV.
> Reproducible, auditable, under $0.50 end-to-end. Drop it into
> any CRM / dashboard / CI pipeline."

## Next cycle

Wire `csv_eval_harness.py` to dispatch into `agent_loop.generate_
scaffold(lane, spec, runtime, model)` per row, apply the 11 gates,
write the filled CSV + JSON summary. Budget: ~$0.30 to fill all 60
rows end-to-end.
