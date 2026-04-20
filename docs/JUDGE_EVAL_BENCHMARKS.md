# Judge + Eval Benchmarks (shipped inventory)

Every adapter, its tier, its scoring mode, and what it's for in
attrition's two-loop eval architecture:

- **Loop A** — evaluate the judge itself. Deterministic or pairwise-gold
  benchmarks that ask: "does our rubric judge agree with ground truth?"
- **Loop B** — evaluate the scaffold. Workflow-shaped benchmarks where
  the grader is deterministic or a stateful simulator.

## Shipped adapters

| Adapter | Loop | Scoring | Install / data | File |
|---|---|---|---|---|
| BFCL v3 | B | AST tool-call match (deterministic) | HF `gorilla-llm/Berkeley-Function-Calling-Leaderboard` | `daas/benchmarks/bfcl/` |
| BFCL v4 | B | AST + multi-turn (delegates to v3 until upstream v4 split stable) | same | `daas/benchmarks/bfcl_v4/` |
| MMLU-Pro | A canary | Letter match (deterministic) | HF `TIGER-Lab/MMLU-Pro` | `daas/benchmarks/mmlu_pro/` |
| JudgeBench | A primary | Pairwise A-or-B match against correctness gold | HF `ScalerLab/JudgeBench` | `daas/benchmarks/judgebench/` |
| IF-RewardBench | A | Pairwise chosen-vs-rejected w/ per-task checklist | HF `allenai/IF-RewardBench` | `daas/benchmarks/if_rewardbench/` |
| τ²-bench retail | B | DB state + action match via Sierra simulator | `pip install -e git+github.com/sierra-research/tau2-bench` | `daas/benchmarks/tau2/` |
| SWE-bench Verified | B | Docker unit-test PASS/FAIL | HF `princeton-nlp/SWE-bench_Verified` + Docker | `daas/benchmarks/swebench_verified/` |
| MCP-Atlas | B | Real MCP servers (partially LLM-judged per upstream) | `pip install -e git+github.com/mcp-atlas/mcp-atlas` | `daas/benchmarks/mcp_atlas/` |
| Terminal-Bench 2.0 | B | Docker sandbox terminal success | `pip install terminal-bench` + Docker | `daas/benchmarks/terminal_bench_2/` |
| BrowseComp | B | Exact-match short answer after browsing | Local JSONL (OpenAI license) | `daas/benchmarks/browsecomp/` |
| Arena-Hard-Auto | A secondary | Pairwise preference (delegates to JudgeBench shape) | Local JSONL from `lmarena/arena-hard-auto` | `daas/benchmarks/arena_hard_auto/` |
| RewardBench 2 | A secondary | Pairwise reward-model / factuality | HF `allenai/reward-bench-2` | `daas/benchmarks/rewardbench_2/` |
| PoLL | utility | Panel-of-smaller-judges voting pattern | stdlib only | `daas/benchmarks/poll.py` |

## How each lands in the product

- Shell adapters (`swebench_verified`, `terminal_bench_2`, `mcp_atlas`)
  return `harness_error` with exact install instructions when the
  required dependency (Docker + pip package) is absent. They never
  fake a verdict.
- Pairwise benchmarks (`judgebench`, `if_rewardbench`,
  `arena_hard_auto`, `rewardbench_2`) all use the judgebench extractor
  for A / B pick extraction and normalize labels (`"A>B"` comparator,
  `0`/`1` ints, `"response_A"` prefix all accepted).
- Deterministic benchmarks (`bfcl_v3`, `mmlu_pro`, `browsecomp`) score
  exact-match with no LLM in the loop.
- `tau2_retail` is deterministic via the Sierra simulator but we fail
  closed (`db_state_match` rejects empty-vs-empty as a non-test).

## Two-loop architecture

### Loop A — judge calibration

Primary: `JudgeBench + IF-RewardBench`

These are the benchmarks where attrition's own rubric judge is the
thing under test. A regression on JudgeBench accuracy is a direct
signal that the rubric needs revision.

Secondary: `Arena-Hard-Auto + RewardBench 2 + MT-Bench`

Preference-oriented — good sanity checks but not truth-oriented. Never
the primary gate.

Canary: `MMLU-Pro` @ n=50, stratified. Quick regression gate for every
rubric revision — catches obviously-broken judge prompts in <30s.

### Loop B — scaffold quality

Primary by lane:

| Accepted runtime | Primary Loop B benchmarks |
|---|---|
| `tool_first_chain` | `BFCL v4` + `MCP-Atlas` |
| `orchestrator_worker` | `τ²-bench retail` + `SWE-bench Verified` (coding) |
| `simple_chain` | field-level schema diff (benchmark-free — internal) |
| `keep_big_model` | `Terminal-Bench 2.0` for long-horizon if in scope |

For retail / support flows specifically: τ²-bench is the default.
Falsification from FloorAI confirmed τ²-bench is the closest public
analog to our actual use cases.

For research / browsing scaffolds: `BrowseComp`.

## Fidelity trial shape

All B benchmarks plug into `daas/fidelity/cli.py` which runs the
3-measurement template:

```
baseline   = small_model.solo(task)
ceiling    = large_model.solo(task)
distilled  = small_model(task, scaffold=artifact)
```

Verdict via Wilson CI + Newcombe difference — bounded to 5 values
(`transfers`, `lossy`, `no_gap`, `regression`, `insufficient_data`).
Minimum n=60 before any non-`insufficient_data` verdict.

## Never-alone rules

1. **A single LLM judge is never the only authority for a shipping
   decision.** Deterministic oracles first; PoLL panel for residuals.
2. **BFCL v3 does not drive scaffold-lift claims** — our own
   falsification run showed it's saturated (Pro ≈ Flash Lite within
   noise). Use SWE-bench Verified or τ²-bench instead.
3. **MMLU-Pro is a canary, not a product claim.** Use for regression
   gates, never as "here's our accuracy number."
4. **Tier-3 weak signals NEVER update a recommender prior on their
   own.** Radar enforces this via the `tier3_weak` badge.

## Source: Vellum Opus 4.7 analysis framing

This stack was selected to satisfy the framing from the Vellum Opus
4.7 benchmarks analysis (linked as a Radar tier-2 item). Specifically:

- Prefer workload-realistic, workflow-shaped benchmarks over broad
  exam-style evals
- Pair deterministic oracles (SWE-bench, BFCL AST) with stateful
  simulators (τ²-bench) for production relevance
- Treat preference benchmarks as secondary calibration, not primary
  gates

## Ship order from here

Most adapters are shells with clear integration paths. The real work
remaining is:

1. Run `daas.fidelity.cli` with real trial-count against each
   benchmark + accumulate verdicts on
   `daasFidelityVerdicts` so the Builder Eval tab has live data per
   runtime lane.
2. Wire the actual Sierra simulator when a retail customer needs τ²
   scoring.
3. Provision Docker for SWE-bench Verified + Terminal-Bench 2 when a
   coding-agent customer needs unit-test scoring.

Until then, each adapter's `harness_error` messaging keeps the
product honest about what's installed vs not.

## Related

- `daas/fidelity/` — 3-measurement template + Wilson/Newcombe verdict
- `docs/FIDELITY_SYSTEM.md` — full fidelity system design
- `docs/BFCL_FALSIFICATION_FINDINGS.md` — what we learned the hard way
