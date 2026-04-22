# tool_first_chain — bounded tool loop, single reasoning tier

## When to pick this lane

- One reasoning tier calls one or more tools to answer.
- Tool calls are bounded and predictable (no sub-planning).
- Example: "look up SKU X, then report the price" — 1-2 tool calls.
- Good for: BFCL-style function calling, deterministic lookup +
  synthesis, retail-ops, CRM line drafting.

## Avoid this lane when

- The task needs a planner that decides WHICH tools to invoke based
  on intermediate results (use `orchestrator_worker`).
- Tools need complex handoff / delegation (use `orchestrator_worker`).

## Files the agent should write

```
prompts.py        SYSTEM_PROMPT + tool-call rules
tools.py          STUB_HANDLERS + LIVE_HANDLERS + dispatch() + GEMINI_TOOLS
schemas.py        ChainInput / ChainOutput
runner.py         bounded loop (MAX_TURNS=2); turn 0 mode=ANY, turn 1+ mode=AUTO
requirements.txt  google-genai (or whatever provider)
README.md         describes connector modes + how to wire live handlers
run.sh / .env.example / workflow_spec.json
mcp_server.py     MCP wrapper over dispatch() (Layer 9)
eval/             scenarios.py + rubric.py
```

## Key invariants

- `MAX_TURNS = 2`. Turn 0 forces a tool call; turn 1 with mode=AUTO
  lets the model summarize and terminate. Prior 4-turn loops wasted
  3-5× tokens.
- Emit `toolConfig.functionCallingConfig.mode = "ANY"` on turn 0,
  `"AUTO"` on turn 1+.
- Canonical `tool_calls_log` entries carry BOTH `name`+`arguments`
  AND `tool`+`args` keys for downstream scorer compatibility.

## runner.py spine

```python
for turn in range(MAX_TURNS):
    mode = "ANY" if turn == 0 else "AUTO"
    body = {..., "toolConfig": {"functionCallingConfig": {"mode": mode}}}
    resp = _post(url, body)
    # if functionCall parts: dispatch + append functionResponse; continue
    # if text parts: final_text = ...; break
```

## Known failure modes

- "Use at most one tool per turn" framing in the system prompt made
  Flash Lite emit prose instead of a functionCall on simple tasks.
  Fix: rules now say "YOU MUST emit a functionCall when a declared
  tool can answer the request."
- Scoring harness reads `tool_calls_log` but the dataclass field is
  `tool_calls`. Fix: harness accepts both via `getattr(result,
  "tool_calls", None) or getattr(result, "tool_calls_log", None)`.

## Eval criteria

- BFCL-simple n=20: scaffold must match Flash Lite solo baseline
  within CI. Target: scaffold ≥ baseline − 10pp, ideally ≥ baseline.
- Broadened categories (file/shell/agent/search/codegen): scaffold
  must hit 100% on any category the user's spec touches.
- Cost: scaffold ≤ 5× baseline on shipped measurement, trending
  toward ≤ 1.5× with further turn-control tightening.
