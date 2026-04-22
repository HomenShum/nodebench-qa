# orchestrator_worker — plan → dispatch → compact with shared scratchpad

## When to pick this lane

- The task has sub-problems that decompose into parallel / sequential
  worker assignments. (Example: "research Acme AI" → founder worker,
  product worker, funding worker, news worker.)
- A planner decides which workers run + what tools each may use.
- Output is synthesized from a scratchpad populated by workers.
- Canonical Claude Agent SDK / Anthropic "orchestrator-worker" shape.

## Avoid this lane when

- Task is single-shot (use `simple_chain`).
- Task is one-call function lookup (use `tool_first_chain`).
- Task needs persistent graph state across restarts (use `langgraph_python`).

## Files the agent should write

```
prompts.py         orchestrator system prompt + per-worker system prompts
schemas.py         RunInput, RunOutput, WorkerAssignment, WorkerOutput, Scratchpad
state.py           Scratchpad dataclass + section helpers
handoffs.py        typed handoff contract between workers
tools.py           shared tool declarations + connector dispatch
workers/
  __init__.py
  executor.py      default fallback worker (used when plan is unparseable)
orchestrator.py    plan → dispatch → compact loop, MAX_WORKER_TURNS=3
runner.py          thin wrapper that instantiates RunInput + calls orchestrator.run()
requirements.txt / README.md / run.sh / .env.example / workflow_spec.json
mcp_server.py      MCP wrapper over tools.dispatch (Layer 9)
eval/              scenarios.py + rubric.py
state_store.py     SQLite persistence (Layer 5)
server.py          FastAPI + SSE (Layer 2)
observability.py   OpenTelemetry hooks (Layer 8)
```

## Three-stage pipeline

```
1. PLAN      orchestrator LLM → JSON array of {worker, task, tools_allowed}
2. DISPATCH  for each assignment:
               - per-worker LLM loop (bounded, MAX_WORKER_TURNS=3)
               - tool calls flow through tools.dispatch()
               - worker writes its section into Scratchpad
3. COMPACT   orchestrator reads full scratchpad → final answer
```

## Key invariants

- `_parse_plan(text)` — tolerant JSON parse with markdown-fence strip
  and first-array-substring fallback. Never crashes on malformed LLM
  output.
- Falls back to single `executor` worker when plan is unparseable.
- Sequential dispatch through up to `MAX_WORKER_ASSIGNMENTS=4`;
  fan-out parallelism is a future optimization (not an invariant).
- Cost/token totals aggregated across plan + every worker + compact.

## Known failure modes

- Plan LLM emits markdown-fenced JSON. Fix: strip fences before
  `json.loads`; fall back to first-array extraction.
- Worker tool loop hits infinite retry on a specific tool. Fix:
  bounded `MAX_WORKER_TURNS`; worker emits partial scratchpad and
  returns on limit.
- Compact step over-synthesizes when scratchpad sections contradict.
  Fix: compact system prompt explicitly says "when workers disagree,
  surface the disagreement — don't pick a side."

## Eval criteria

- Shipped orchestrator.py passes `ast.parse`.
- Orchestrator has `_parse_plan`, `_run_worker`, `MAX_WORKER_TURNS`.
- Mock-mode end-to-end: plan + 1 worker + compact runs without
  real API keys.
- Live replay fidelity on BFCL / broadened scenarios: scaffold
  transfers vs baseline (measured by `scaffold_runtime_fidelity`).
