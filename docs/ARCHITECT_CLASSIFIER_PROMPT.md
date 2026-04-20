# Architect Classifier Prompt

Versioned extraction of the system prompt used by the Architect page's
Gemini Flash Lite classifier. Source lives in
`convex/domains/daas/architectClassifier.ts` (`SYSTEM_PROMPT`); this doc
is the human-readable reference, not the source of truth.

## Why this doc exists

- The classifier's output shape (`runtime_lane`, `world_model_lane`,
  `intent_lane`, `checklist`, `rationale`, `missing_inputs`, `eval_plan`)
  is what every downstream surface consumes. Changing the prompt shape
  silently breaks Builder tabs, Radar priors, Fidelity trials.
- Calibration regresses silently otherwise. Every prompt revision must
  re-run `daas/classifier_eval/runner.py` against the 30-prompt gold
  set (`daas/classifier_eval/gold.jsonl`) and beat the last recorded
  baseline.

## Current baseline (v1, commit `c15528a`)

Measured against n=30 gold prompts on `joyous-walrus-428`:

| Axis | Accuracy | Notes |
|---|---|---|
| intent | 93.3% (28/30) | strongest axis |
| world_model | 80.0% (24/30) | |
| runtime | 63.3% (19/30) | systematic under-scaffolding |
| all three match | 50.0% (15/30) | exact-triad baseline |

Known failure mode: classifier tends to pick `tool_first_chain` when
`orchestrator_worker` is gold (4/30) and `simple_chain` when
`tool_first_chain` is gold (3/30). Future prompt revisions should aim
to fix this without regressing the 93% intent accuracy.

## Prompt structure

```
You are attrition.sh's architecture triage classifier.

Given a user's problem description, classify it onto three bounded axes:

RUNTIME_LANE — pick exactly one:
  simple_chain
  tool_first_chain
  orchestrator_worker
  keep_big_model

WORLD_MODEL_LANE — pick exactly one:
  lite
  full

INTENT_LANE — pick exactly one:
  compile_down
  compile_up
  translate
  greenfield
  unknown

Return STRICT JSON with EXACTLY these keys (no extra commentary, no markdown):
{
  "runtime_lane": "...",
  "world_model_lane": "...",
  "intent_lane": "...",
  "checklist": [
    {"step": "problem_type_identified", "status": "ok", "detail": "<=120 chars"},
    {"step": "output_contract_extracted", "status": "ok|missing", "detail": "..."},
    {"step": "tools_mcp_likely_needed", "status": "ok|missing", "detail": "..."},
    {"step": "existing_assets_detected", "status": "ok|missing", "detail": "..."},
    {"step": "source_of_truth_resolved", "status": "ok|missing", "detail": "..."},
    {"step": "eval_method_selected", "status": "ok|missing", "detail": "..."},
    {"step": "runtime_lane_chosen", "status": "ok", "detail": "why this runtime"},
    {"step": "world_model_lane_chosen", "status": "ok", "detail": "why this world model"},
    {"step": "interpretive_boundary_marked", "status": "ok|missing", "detail": "..."},
    {"step": "missing_inputs_identified", "status": "ok|missing", "detail": "..."}
  ],
  "rationale": "2-4 sentence explanation of WHY each lane was chosen and what's missing",
  "missing_inputs": ["list", "of", "things", "needed"],
  "eval_plan": "one sentence on how success will be judged"
}

Be strict. If the user's prompt is too vague to confidently pick a lane, set
intent_lane to "unknown" and mark the classifier's confidence in the rationale.
Never claim to have detected something you didn't.
```

## Server-side hardening

Even though the prompt asks for strict JSON, the Convex classifier **also**:

1. Strips any markdown code fences from the response before parsing.
2. Falls back to `keep_big_model` / `lite` / `unknown` on parse failure
   (never picks a confident lane when the output is unparseable).
3. Defensively normalizes enum values (any unknown value coerces to the
   safe fallback).
4. Truncates `rationale` to 3800 chars before committing.
5. Records a `harness_error` style fallback checklist when the model
   call itself errors (timeout, HTTP, rate limit).

These are the same HONEST_STATUS invariants the product enforces
everywhere else.

## How to iterate safely

```bash
# 1. Change the prompt in convex/domains/daas/architectClassifier.ts
# 2. Deploy:
npx convex deploy -y

# 3. Re-run eval against the gold set:
python -m daas.classifier_eval.runner --convex https://joyous-walrus-428.convex.cloud

# 4. Compare the per-axis accuracy + confusion matrix to the baseline
#    table above. Any regression on INTENT > 2pp or RUNTIME > 3pp is a
#    rollback. Document the shift here before landing the change.
```

Gold prompts span:
- 6 compile_down / 5 compile_up / 3 translate / 14 greenfield / 1 unknown intents
- 4 simple_chain / 9 tool_first_chain / 15 orchestrator_worker / 2 keep_big_model
- 18 lite / 12 full world models

When the prompt's failure mode shifts (e.g. new systematic bias), add a
gold prompt that isolates it. The gold set grows monotonically.

## Related

- `daas/classifier_eval/` — harness + gold prompts + per-run results
- `convex/domains/daas/architectClassifier.ts` — source
- `convex/domains/daas/architectRate.ts` — bucket limiting (20 / 5min)
