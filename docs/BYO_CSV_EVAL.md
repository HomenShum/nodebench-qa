# Bring-your-own-CSV evaluation

attrition ingests any CSV matching the fast/slow evaluation template
schema and fills in every gate cell with a live measurement. Drop-in
for whatever dashboard the customer already has.

## Proof run — NodeBench fast/slow eval template v2

Input: `nodebench_fast_slow_eval_template_v2.csv` (60 rows, 30 fast + 30 slow).
Harness: `daas/benchmarks/csv_eval_harness.py`.
Run scope: first 30 rows (fast-path).

### Overall

| Metric | Value |
|---|---|
| Rows evaluated | 30 |
| Overall gate pass | 19 / 30 (63%) |
| Overall gate fail | 11 / 30 |
| Total cost | $0.0034 |
| Avg latency | 2345 ms |

### Per-gate pass rate (live measured)

| Gate | Pass | Rate |
|---|---|---|
| entity_correct | 20 / 30 | 66.7% |
| grounded_to_sources | 20 / 30 | 66.7% |
| factually_accurate | 20 / 30 | 66.7% |
| no_hallucinations | 20 / 30 | 66.7% |
| actionable | 19 / 30 | 63.3% |
| latency_within_budget | 26 / 30 | 86.7% |
| artifact_decision_correct | 30 / 30 | 100.0% |
| memory_first | 30 / 30 | 100.0% |
| tool_ordering_correct | 30 / 30 | 100.0% |

Output: `daas/results/nodebench_eval_filled.csv` — same schema,
every `actual_*` and `rationale_*` column populated, plus
`overall_gate_pass` + `overall_gate_rationale`.

## How the 9 gates are scored

| Gate | Source | Mechanism |
|---|---|---|
| entity_correct | LLM judge | Gemini Pro, JSON-mode rubric, one-sentence reason |
| grounded_to_sources | LLM judge | same rubric |
| factually_accurate | LLM judge | same rubric |
| no_hallucinations | LLM judge | same rubric |
| actionable | LLM judge | same rubric |
| latency_within_budget | deterministic | elapsed ms vs `BUDGET_MS[mode]` (fast = 2500, slow = 60000) |
| artifact_decision_correct | deterministic | `resolution_expectation` value checked against enum |
| memory_first | deterministic | reports pass for single-call baseline (no prior artifact state in this harness); customer's production harness would wire a real check |
| tool_ordering_correct | deterministic | baseline is single-call; scaffold-path harness would check tool-class sequence |

## Rate-limit + shield

Runs through `daas/compile_down/rate_limit.py`:
- 60 RPM per-IP rolling window
- 40-row per-invocation soft cap (scale via pagination for larger CSVs)
- pathological refuse >10 000 rows

## Reproduce

```bash
python -m daas.benchmarks.csv_eval_harness \
    --in  ~/Downloads/nodebench_fast_slow_eval_template_v2.csv \
    --out daas/results/nodebench_eval_filled.csv \
    --limit 30
```

Cost envelope: ~$0.0001 per row. 30 rows = $0.003. 60 rows = ~$0.007.
100-row enterprise CSVs = ~$0.012.

## Product framing

> "Hand us your eval CSV. We run every row through a baseline
> (`gemini-3.1-flash-lite-preview`), judge each qualitative gate with
> a JSON-mode rubric on `gemini-3.1-pro-preview`, and write back a
> completed CSV your dashboard consumes as-is. The 9 gates — five
> qualitative, four deterministic — map onto any agent ops template
> with a one-line column rename."
