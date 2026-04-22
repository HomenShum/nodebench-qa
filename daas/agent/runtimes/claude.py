"""Anthropic Claude Agent SDK AgentRuntime adapter.

Wraps the ``claude-agent-sdk`` package. Tools are defined via the
``@tool`` decorator exposed by the SDK. We translate our internal
``Tool`` abstraction at runtime via a small factory.

Model aliases (as of April 2026):
    claude-opus-4.7
    claude-sonnet-4.6
    claude-haiku-4.5

If the SDK isn't installed, the runtime raises at first use; this is
by design — core attrition doesn't depend on it.
"""

from __future__ import annotations

import asyncio
import inspect
import json
import os
import time
from typing import Any, Callable

from daas.agent.base import (
    AgentRunResult,
    AgentRuntime,
    Tool,
    ToolCall,
    register_runtime,
)


def _require_sdk() -> Any:
    try:
        import claude_agent_sdk  # type: ignore
    except ImportError as e:
        raise RuntimeError(
            "claude_agent_sdk runtime requires `pip install claude-agent-sdk`"
        ) from e
    return claude_agent_sdk


def _build_sdk_tool(tool: Tool, log: list[ToolCall]) -> tuple[str, Any]:
    sdk = _require_sdk()

    def _handler(**kwargs: Any) -> dict[str, Any]:
        t0 = time.perf_counter()
        try:
            result = tool.handler(kwargs)
        except Exception as e:  # noqa: BLE001
            result = {"ok": False, "error": f"{type(e).__name__}: {e}"}
        elapsed_ms = int((time.perf_counter() - t0) * 1000)
        log.append(
            ToolCall(
                name=tool.name,
                arguments=kwargs,
                result=result,
                elapsed_ms=elapsed_ms,
            )
        )
        return {"content": [{"type": "text", "text": json.dumps(result)}]}

    # @tool(name, description, input_schema)
    wrapped = sdk.tool(tool.name, tool.description, tool.parameters_schema)(_handler)
    return tool.name, wrapped


class ClaudeAgentRuntime:
    name = "claude_agent_sdk"

    def run(
        self,
        *,
        system: str,
        user: str,
        tools: list[Tool],
        max_turns: int = 8,
        model: str,
        temperature: float = 0.2,
        api_key: str | None = None,
    ) -> AgentRunResult:
        sdk = _require_sdk()
        key = api_key or os.environ.get("ANTHROPIC_API_KEY", "")
        if not key:
            raise RuntimeError("ANTHROPIC_API_KEY required for claude_agent_sdk runtime")
        os.environ.setdefault("ANTHROPIC_API_KEY", key)

        call_log: list[ToolCall] = []
        sdk_tools = [_build_sdk_tool(t, call_log) for t in tools]

        # Build an in-process MCP server with our tools.
        server = sdk.create_sdk_mcp_server(
            name="attrition-tools",
            version="1.0.0",
            tools=[wrapped for _, wrapped in sdk_tools],
        )

        options = sdk.ClaudeAgentOptions(  # type: ignore[attr-defined]
            mcp_servers={"attrition": server},
            allowed_tools=[f"mcp__attrition__{name}" for name, _ in sdk_tools],
            max_turns=max_turns,
            system_prompt=system,
            model=model,
        )

        t_start = time.perf_counter()
        async def _drive() -> tuple[str, int, int]:
            text_out = ""
            total_in = 0
            total_out = 0
            async with sdk.ClaudeSDKClient(options=options) as client:  # type: ignore[attr-defined]
                await client.query(user)
                async for message in client.receive_response():
                    # ResultMessage carries totals at the end
                    rm = getattr(message, "__class__", type(None)).__name__
                    if rm == "ResultMessage":
                        usage = getattr(message, "usage", {}) or {}
                        total_in = int(usage.get("input_tokens", 0) or 0)
                        total_out = int(usage.get("output_tokens", 0) or 0)
                        text_out = str(getattr(message, "result", "") or "")
                        break
            return text_out, total_in, total_out

        try:
            text, in_tok, out_tok = asyncio.run(_drive())
        except Exception as e:  # noqa: BLE001
            raise RuntimeError(f"claude-agent-sdk run failed: {e}") from e
        elapsed_ms = int((time.perf_counter() - t_start) * 1000)

        return AgentRunResult(
            text=text,
            tool_calls=call_log,
            input_tokens=in_tok,
            output_tokens=out_tok,
            turns=max(1, len(call_log)),
            model=f"anthropic:{model}",
            runtime_label=self.name,
            elapsed_ms=elapsed_ms,
        )


register_runtime("claude_agent_sdk", lambda: ClaudeAgentRuntime())
