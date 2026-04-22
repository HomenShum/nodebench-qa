"""OpenAI Agents SDK AgentRuntime adapter.

Wraps the ``openai-agents`` package (``Agent`` + ``Runner.run_sync``).
If the package isn't installed we raise at first invocation — the
runtime is optional and Phase 1 defaults to gemini_agent.

Tool translation: our ``Tool`` -> ``@function_tool``-decorated Python
function. We synthesize the decorator at init time so skill manifests
don't need to know anything about openai-agents.

Model aliases: "gpt-5.4", "gpt-5.4-nano", "gpt-5.1", "gpt-5".
"""

from __future__ import annotations

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


def _require_openai_agents() -> Any:
    try:
        import agents  # type: ignore
    except ImportError as e:
        raise RuntimeError(
            "openai_agents_sdk runtime requires `pip install openai-agents`"
        ) from e
    return agents


def _build_function_tool(tool: Tool, log: list[ToolCall]) -> Any:
    """Translate our Tool -> an openai-agents ``function_tool``.

    The SDK inspects the wrapped callable's type hints; we keep it
    simple with a single ``args`` dict parameter.
    """
    agents = _require_openai_agents()

    def _handler(args_json: str) -> str:
        t0 = time.perf_counter()
        try:
            args = json.loads(args_json) if isinstance(args_json, str) else {}
        except json.JSONDecodeError:
            args = {}
        try:
            result = tool.handler(args if isinstance(args, dict) else {})
        except Exception as e:  # noqa: BLE001
            result = {"ok": False, "error": f"{type(e).__name__}: {e}"}
        elapsed_ms = int((time.perf_counter() - t0) * 1000)
        log.append(
            ToolCall(
                name=tool.name,
                arguments=args if isinstance(args, dict) else {},
                result=result,
                elapsed_ms=elapsed_ms,
            )
        )
        return json.dumps(result)

    # Use the SDK's function_tool wrapper. The SDK generates its own
    # schema from the function signature + docstring.
    return agents.function_tool(
        _handler,
        name_override=tool.name,
        description_override=tool.description,
    )


class OpenAIAgentRuntime:
    name = "openai_agents_sdk"

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
        agents = _require_openai_agents()
        key = api_key or os.environ.get("OPENAI_API_KEY", "")
        if not key:
            raise RuntimeError("OPENAI_API_KEY required for openai_agents_sdk runtime")
        os.environ.setdefault("OPENAI_API_KEY", key)

        call_log: list[ToolCall] = []
        fn_tools = [_build_function_tool(t, call_log) for t in tools]

        agent = agents.Agent(
            name="attrition-agent",
            instructions=system,
            tools=fn_tools,
            model=model,
        )

        t0 = time.perf_counter()
        try:
            # Agents SDK docs: Runner.run_sync(agent, input, max_turns=...)
            result = agents.Runner.run_sync(  # type: ignore[attr-defined]
                agent,
                input=user,
                max_turns=max_turns,
            )
        except Exception as e:  # noqa: BLE001
            raise RuntimeError(f"openai-agents run failed: {e}") from e
        elapsed_ms = int((time.perf_counter() - t0) * 1000)

        # Usage is exposed on the result object in recent SDK versions.
        usage = getattr(result, "usage", None) or {}
        in_tok = int(getattr(usage, "input_tokens", 0) or getattr(usage, "prompt_tokens", 0) or 0)
        out_tok = int(
            getattr(usage, "output_tokens", 0) or getattr(usage, "completion_tokens", 0) or 0
        )
        final_text = str(getattr(result, "final_output", "") or "")
        turns = int(getattr(result, "num_turns", 0) or 0)

        return AgentRunResult(
            text=final_text,
            tool_calls=call_log,
            input_tokens=in_tok,
            output_tokens=out_tok,
            turns=turns,
            model=f"openai:{model}",
            runtime_label=self.name,
            elapsed_ms=elapsed_ms,
        )


register_runtime("openai_agents_sdk", lambda: OpenAIAgentRuntime())
