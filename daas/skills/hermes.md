# hermes — tool-call benchmark harness variants

## When to pick this lane

- User wants a scaffold whose primary purpose is EVALUATING other
  agents' tool-calling, not running production tool calls.
- Emit BFCL-style + adversarial variants (distractor tools,
  contradictory instructions, noisy schemas).
- Target: testing one's own agent against a harness before shipping.

## Reference

Hermes is a tool-call benchmark pattern. We emit a pytest-compatible
harness with canned scenarios + a rubric judge.

## Files the agent should write

```
harness/
  scenarios.py     Scenario dataclass + SCENARIOS list (20-50 cases)
  adversarial.py   distractor-tool scenarios
  scorer.py        AST match against ground-truth tool call shapes
  runner.py        run candidate agent over scenarios, collect results
judge/
  rubric.py        LLM-as-judge with 6 boolean gates
  prompts.py       rubric system prompt
datasets/
  bfcl_simple.jsonl         first-party canned subset
  bfcl_parallel.jsonl
  adversarial.jsonl         distractor + contradictory instruction cases
requirements.txt / README.md / run.sh / .env.example / workflow_spec.json
```

## Scenario shape

```python
@dataclass
class Scenario:
    id: str
    category: str             # "simple", "parallel", "adversarial"
    prompt: str
    tool_spec: dict           # function declaration
    distractors: list[dict]   # extra tool specs that shouldn't be called
    expected_name: str
    expected_arg_keys: list[str]
    gold_values: dict         # { arg: [acceptable_values] }
```

## Scoring

- AST match: tool name exact; args = dict subset where every required
  key maps to a value in the gold `acceptable_values` list.
- Rubric: 6 booleans — correct_tool, correct_args, no_distractor_called,
  no_hallucinated_tool, matches_intent, bounded_by_budget.

## Known failure modes

- Distractor tools with similar names trick weaker models. Keep the
  base scoring agnostic; the rubric flags distractor-calls separately.
- Evaluation judge returns unparseable JSON. Emit rubric with
  `responseMimeType="application/json"` + brace-balanced fallback
  parser.

## Eval criteria

- Scenarios load from JSONL.
- `runner.py` accepts any subclass of AgentRuntime (our base.py
  protocol) and runs all scenarios against it.
- Scorer produces per-scenario boolean + aggregate pass rate with
  Wilson 95 % CI.
