"""LangGraph AgentRuntime adapter.

Builds a prebuilt ReAct agent via ``langgraph.prebuilt.create_react_agent``
and runs it with our tools. The underlying LLM is pluggable — we use
``langchain_google_genai.ChatGoogleGenerativeAI`` by default; swap the
``chat_model`` kwarg to hit any LangChain-wrapped provider.

If LangGraph isn't installed, this runtime raises at first use.

Model aliases route to the appropriate Chat wrapper:
    gemini-3-pro         -> ChatGoogleGenerativeAI
    gpt-5.4              -> ChatOpenAI
    claude-sonnet-4.6    -> ChatAnthropic
"""

from __future__ import annotations

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


def _require_langgraph() -> Any:
    try:
        import langgraph  # noqa: F401
        from langgraph.prebuilt import create_react_agent  # type: ignore
    except ImportError as e:
        raise RuntimeError(
            "langgraph runtime requires `pip install langgraph langchain "
            "langchain-google-genai langchain-openai langchain-anthropic`"
        ) from e
    return create_react_agent


def _resolve_chat_model(model: str):
    """Return a LangChain chat model instance for the given alias."""
    m = model.lower()
    if m.startswith("gemini") or m.startswith("google/gemini"):
        try:
            from langchain_google_genai import ChatGoogleGenerativeAI  # type: ignore
        except ImportError:
            raise RuntimeError("pip install langchain-google-genai")
        # Strip provider prefix
        model_id = m.split("/", 1)[1] if "/" in m else m
        return ChatGoogleGenerativeAI(model=model_id, temperature=0.2)
    if m.startswith("gpt-") or m.startswith("openai/"):
        try:
            from langchain_openai import ChatOpenAI  # type: ignore
        except ImportError:
            raise RuntimeError("pip install langchain-openai")
        model_id = m.split("/", 1)[1] if "/" in m else m
        return ChatOpenAI(model=model_id, temperature=0.2)
    if m.startswith("claude-") or m.startswith("anthropic/"):
        try:
            from langchain_anthropic import ChatAnthropic  # type: ignore
        except ImportError:
            raise RuntimeError("pip install langchain-anthropic")
        model_id = m.split("/", 1)[1] if "/" in m else m
        return ChatAnthropic(model=model_id, temperature=0.2)
    raise ValueError(
        f"unknown model alias for langgraph runtime: {model!r}. "
        "Use gemini-*, gpt-*, or claude-* prefixes."
    )


def _build_lc_tool(tool: Tool, log: list[ToolCall]) -> Any:
    from langchain_core.tools import StructuredTool  # type: ignore

    def _handler(**kwargs: Any) -> str:
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
        return json.dumps(result)

    return StructuredTool.from_function(
        func=_handler,
        name=tool.name,
        description=tool.description,
    )


class LangGraphAgent:
    name = "langgraph"

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
        create_react_agent = _require_langgraph()

        call_log: list[ToolCall] = []
        lc_tools = [_build_lc_tool(t, call_log) for t in tools]
        llm = _resolve_chat_model(model)

        agent = create_react_agent(llm, tools=lc_tools)

        t_start = time.perf_counter()
        try:
            messages = {"messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ]}
            final = agent.invoke(messages, config={"recursion_limit": max_turns * 4})
        except Exception as e:  # noqa: BLE001
            raise RuntimeError(f"langgraph run failed: {e}") from e
        elapsed_ms = int((time.perf_counter() - t_start) * 1000)

        # Extract final assistant text
        msgs = final.get("messages") or []
        final_text = ""
        in_tok = out_tok = 0
        for m in reversed(msgs):
            # AIMessage has .content + .usage_metadata
            if hasattr(m, "content"):
                content = getattr(m, "content", "") or ""
                if isinstance(content, str) and content and not final_text:
                    final_text = content
                usage = getattr(m, "usage_metadata", None) or {}
                in_tok += int(usage.get("input_tokens", 0) or 0)
                out_tok += int(usage.get("output_tokens", 0) or 0)

        return AgentRunResult(
            text=final_text,
            tool_calls=call_log,
            input_tokens=in_tok,
            output_tokens=out_tok,
            turns=max(1, len(call_log)),
            model=f"langgraph:{model}",
            runtime_label=self.name,
            elapsed_ms=elapsed_ms,
        )


register_runtime("langgraph", lambda: LangGraphAgent())
