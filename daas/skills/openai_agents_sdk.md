# openai_agents_sdk — OpenAI Agents SDK (Python)

## When to pick this lane

- User's production is OpenAI (GPT-5.4 / GPT-5.1 / GPT-5 etc.).
- Want the Agents SDK's Runner + function_tool + handoffs pattern.
- Need built-in tools (FileSearch, CodeInterpreter, Shell, WebSearch,
  HostedMCP, ImageGeneration).

## References

- PyPI: `openai-agents`
- Docs: `openai.github.io/openai-agents-python`
- Tools guide: `openai.github.io/openai-agents-python/tools/`

## Files the agent should write

```
agent.py          build Agent + run via Runner.run_sync
tools.py          @function_tool-decorated callables
requirements.txt  openai-agents ; openai
README.md         OPENAI_API_KEY setup; Runner.run_sync vs run
run.sh / .env.example / workflow_spec.json
eval/             scenarios.py + rubric.py
```

## agent.py spine

```python
from __future__ import annotations
import os, json
from agents import Agent, Runner, function_tool

@function_tool
def lookup_sku(sku: str) -> str:
    """Look up a SKU by id. Returns JSON."""
    mode = os.environ.get("CONNECTOR_MODE", "mock")
    if mode == "mock":
        return json.dumps({"price": 10, "sku": sku})
    raise NotImplementedError("wire live endpoint")

agent = Agent(
    name="attrition-agent",
    instructions="You are an ops analyst. Call tools; keep it tight.",
    tools=[lookup_sku],
    model=os.environ.get("ATTRITION_MODEL", "gpt-5.4"),
)

if __name__ == "__main__":
    result = Runner.run_sync(agent, input="Find SKU X123")
    print(result.final_output)
    print(f"usage: {result.usage}")
```

## Key invariants

- `@function_tool` — the SDK derives the tool schema from the
  function signature + docstring. Keep types simple.
- `Runner.run_sync(agent, input, max_turns=...)` returns a Result with
  `.final_output`, `.usage`, `.num_turns`, `.messages`.
- For multi-agent handoffs: create multiple `Agent` instances and
  pass them as `handoffs=[other_agent]` on the parent.

## Known failure modes

- Function-tool signature with complex nested types → SDK fails to
  derive schema. Keep tool inputs as primitives or simple dicts.
- Forgetting to set `OPENAI_API_KEY` → the SDK raises on first call.
  Check + clear error in `run.sh`.

## Eval criteria

- `agent.py` imports cleanly.
- `Runner.run_sync` with a stubbed tool returns a Result with
  `final_output` populated.
- `ast.parse` + `ruff check` both clean.
