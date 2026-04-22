# claude_agent_sdk — Anthropic Claude Agent SDK (Python)

## When to pick this lane

- User wants the canonical Claude Code shape: `ClaudeSDKClient` +
  `@tool` decorator + in-process MCP server for custom tools.
- Target model is Claude Opus 4.7 ($5/$25) or Sonnet 4.6 ($3/$15).
- Long-horizon / compaction-heavy work where Claude's own context
  management pays off.

## References

- PyPI: `claude-agent-sdk`
- GitHub: `github.com/anthropics/claude-agent-sdk-python`
- Docs: `platform.claude.com/docs/en/agent-sdk/python`

## Files the agent should write

```
agent.py          main script: create tools via @tool, build SDK MCP
                  server, instantiate ClaudeSDKClient with ClaudeAgentOptions
tools.py          @tool-decorated functions (one per capability)
requirements.txt  claude-agent-sdk>=0.1.0 ; python_version>='3.10'
README.md         ANTHROPIC_API_KEY setup + allowed_tools list
run.sh            wraps `python agent.py`
.env.example      ANTHROPIC_API_KEY
workflow_spec.json
eval/             scenarios.py + rubric.py
```

## agent.py spine

```python
from __future__ import annotations
import asyncio, os
from claude_agent_sdk import (
    ClaudeSDKClient, ClaudeAgentOptions, create_sdk_mcp_server, tool,
)

@tool("lookup_sku", "Look up SKU by id", {"type": "object",
      "properties": {"id": {"type": "string"}}, "required": ["id"]})
async def lookup_sku(args: dict) -> dict:
    # user wires live endpoint; mock-mode returns stub
    mode = os.environ.get("CONNECTOR_MODE", "mock")
    if mode == "mock":
        return {"content": [{"type": "text", "text": '{"price": 10}'}]}
    raise NotImplementedError("wire live endpoint")

server = create_sdk_mcp_server(
    name="attrition-tools", version="1.0.0", tools=[lookup_sku],
)

options = ClaudeAgentOptions(
    mcp_servers={"attrition": server},
    allowed_tools=["mcp__attrition__lookup_sku"],
    system_prompt="You are an ops analyst. Use tools to answer.",
    model=os.environ.get("ATTRITION_MODEL", "claude-sonnet-4.6"),
)

async def main():
    async with ClaudeSDKClient(options=options) as client:
        await client.query("Find SKU X123")
        async for msg in client.receive_response():
            print(msg)

if __name__ == "__main__":
    asyncio.run(main())
```

## Key invariants

- `allowed_tools` MUST list every tool we want the agent to call, by
  prefixed MCP name (`mcp__<server>__<tool>`). Omitting = Claude
  refuses to call it.
- Every `@tool` function MUST return the SDK's structured content
  shape (`{"content": [{"type": "text", "text": "..."}]}`).
- Async throughout. Use `asyncio.run` at the entrypoint.

## Known failure modes

- Forgetting `ANTHROPIC_API_KEY` → silent hang at `query()`. Add
  explicit env check at main().
- Tool returns non-structured dict → SDK raises. Wrap everything
  in `{"content": [{"type": "text", "text": json.dumps(result)}]}`.

## Eval criteria

- `python agent.py` starts without error when ANTHROPIC_API_KEY set.
- Mock-mode returns structured content for every declared tool.
- `ast.parse(agent.py)` + `ast.parse(tools.py)` both clean.
