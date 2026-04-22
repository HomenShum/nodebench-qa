"""Scenario tests for the agent-runtime adapters.

Runs offline — mocks the provider HTTP/SDK layer so each adapter can
prove its tool-dispatch + result-shape contract without live API keys.

For each runtime we verify:
  1. Self-registration into daas.agent.base.RUNTIMES.
  2. Runtime raises cleanly when its SDK/package is absent.
  3. Tool dispatch loop threads a handler invocation + records a
     ToolCall in AgentRunResult.
  4. Returned AgentRunResult carries sane token counts + normalized
     model alias + cost_usd().
"""

from __future__ import annotations

import json
from typing import Any
from unittest.mock import MagicMock, patch

import pytest

from daas.agent.base import (
    PRICING_PER_TOKEN,
    RUNTIMES,
    Tool,
    ToolCall,
    get_runtime,
)
from daas.agent.tools import BUILD_TOOL_SET, Workspace


# Import runtimes to self-register
import daas.agent.runtimes  # noqa: F401


def _dummy_tool() -> Tool:
    def handler(args: dict) -> dict:
        return {"ok": True, "echo": args}

    return Tool(
        name="echo",
        description="return what you got",
        parameters_schema={
            "type": "object",
            "properties": {"msg": {"type": "string"}},
            "required": ["msg"],
        },
        handler=handler,
    )


# ----- registry -----------------------------------------------------------
def test_all_runtimes_register_on_import() -> None:
    # Every adapter module should have self-registered by now.
    for name in (
        "gemini_agent",
        "openai_agents_sdk",
        "claude_agent_sdk",
        "langgraph",
        "openrouter",
    ):
        assert name in RUNTIMES, f"runtime {name!r} failed to register"


def test_get_runtime_unknown_raises() -> None:
    with pytest.raises(KeyError):
        get_runtime("nonexistent-runtime")


# ----- pricing ------------------------------------------------------------
def test_pricing_table_covers_major_models() -> None:
    expected = {
        "anthropic:claude-opus-4.7",
        "anthropic:claude-sonnet-4.6",
        "openai:gpt-5.4",
        "google:gemini-3-pro",
        "google:gemini-3.1-flash-lite",
    }
    assert expected.issubset(PRICING_PER_TOKEN.keys())


# ----- gemini adapter with mocked HTTP ------------------------------------
def test_gemini_agent_tool_dispatch_offline() -> None:
    from daas.agent.runtimes.gemini import GeminiAgent

    # Fake Gemini response: turn 0 emits a functionCall, turn 1 emits text.
    responses = [
        # Turn 0
        {
            "candidates": [
                {
                    "content": {
                        "role": "model",
                        "parts": [
                            {
                                "functionCall": {
                                    "name": "echo",
                                    "args": {"msg": "hello"},
                                }
                            }
                        ],
                    }
                }
            ],
            "usageMetadata": {"promptTokenCount": 50, "candidatesTokenCount": 10},
        },
        # Turn 1 — with the tool result fed back, the model terminates.
        {
            "candidates": [
                {
                    "content": {
                        "role": "model",
                        "parts": [{"text": "got it"}],
                    }
                }
            ],
            "usageMetadata": {"promptTokenCount": 60, "candidatesTokenCount": 5},
        },
    ]

    class _FakeHTTP:
        def __init__(self, queue):
            self.queue = queue

        def __call__(self, req, timeout=None):
            body = self.queue.pop(0)

            class _Resp:
                def __enter__(self_inner):
                    return self_inner

                def __exit__(self_inner, *args):
                    return False

                def read(self_inner):
                    return json.dumps(body).encode("utf-8")

            return _Resp()

    fake = _FakeHTTP(list(responses))
    with patch("urllib.request.urlopen", new=fake):
        agent = GeminiAgent()
        result = agent.run(
            system="You are a test harness.",
            user="please call echo",
            tools=[_dummy_tool()],
            max_turns=4,
            model="gemini-3.1-flash-lite-preview",
            api_key="FAKE_KEY_FOR_TESTING",
        )

    assert result.text == "got it"
    assert len(result.tool_calls) == 1
    assert result.tool_calls[0].name == "echo"
    assert result.tool_calls[0].arguments == {"msg": "hello"}
    assert result.tool_calls[0].result == {"ok": True, "echo": {"msg": "hello"}}
    assert result.input_tokens == 110
    assert result.output_tokens == 15
    assert result.model == "google:gemini-3.1-flash-lite-preview"
    assert result.runtime_label == "gemini_agent"
    assert result.cost_usd() > 0  # uses the pricing table


# ----- openai adapter refuses without SDK ---------------------------------
def test_openai_runtime_refuses_without_sdk() -> None:
    from daas.agent.runtimes.openai import OpenAIAgentRuntime

    # Force the _require_openai_agents() lookup to fail
    with patch(
        "daas.agent.runtimes.openai._require_openai_agents",
        side_effect=RuntimeError("openai-agents not installed"),
    ):
        with pytest.raises(RuntimeError, match="openai-agents"):
            OpenAIAgentRuntime().run(
                system="s",
                user="u",
                tools=[_dummy_tool()],
                max_turns=1,
                model="gpt-5.4",
                api_key="FAKE",
            )


# ----- claude adapter refuses without SDK ---------------------------------
def test_claude_runtime_refuses_without_sdk() -> None:
    from daas.agent.runtimes.claude import ClaudeAgentRuntime

    with patch(
        "daas.agent.runtimes.claude._require_sdk",
        side_effect=RuntimeError("claude-agent-sdk not installed"),
    ):
        with pytest.raises(RuntimeError, match="claude-agent-sdk"):
            ClaudeAgentRuntime().run(
                system="s",
                user="u",
                tools=[_dummy_tool()],
                max_turns=1,
                model="claude-sonnet-4.6",
                api_key="FAKE",
            )


# ----- langgraph adapter refuses without package --------------------------
def test_langgraph_runtime_refuses_without_package() -> None:
    from daas.agent.runtimes.langgraph import LangGraphAgent

    with patch(
        "daas.agent.runtimes.langgraph._require_langgraph",
        side_effect=RuntimeError("langgraph not installed"),
    ):
        with pytest.raises(RuntimeError, match="langgraph"):
            LangGraphAgent().run(
                system="s",
                user="u",
                tools=[_dummy_tool()],
                max_turns=1,
                model="gemini-3-pro",
                api_key="FAKE",
            )


# ----- openrouter adapter with mocked HTTP --------------------------------
def test_openrouter_agent_tool_dispatch_offline() -> None:
    from daas.agent.runtimes.openrouter import OpenRouterAgent

    responses = [
        # Turn 0 — OpenAI-style tool_calls response
        {
            "choices": [
                {
                    "message": {
                        "content": "",
                        "tool_calls": [
                            {
                                "id": "call_1",
                                "function": {
                                    "name": "echo",
                                    "arguments": json.dumps({"msg": "hi"}),
                                },
                            }
                        ],
                    }
                }
            ],
            "usage": {"prompt_tokens": 40, "completion_tokens": 8},
        },
        # Turn 1 — text-only termination
        {
            "choices": [{"message": {"content": "done"}}],
            "usage": {"prompt_tokens": 45, "completion_tokens": 4},
        },
    ]

    class _FakeHTTP:
        def __init__(self, q):
            self.q = q

        def __call__(self, req, timeout=None):
            body = self.q.pop(0)

            class _Resp:
                def __enter__(self_inner):
                    return self_inner

                def __exit__(self_inner, *a):
                    return False

                def read(self_inner):
                    return json.dumps(body).encode("utf-8")

            return _Resp()

    fake = _FakeHTTP(list(responses))
    with patch("urllib.request.urlopen", new=fake):
        agent = OpenRouterAgent()
        result = agent.run(
            system="s",
            user="u",
            tools=[_dummy_tool()],
            max_turns=4,
            model="anthropic/claude-sonnet-4.6",
            api_key="FAKE_OPENROUTER",
        )

    assert result.text == "done"
    assert len(result.tool_calls) == 1
    assert result.tool_calls[0].name == "echo"
    assert result.tool_calls[0].arguments == {"msg": "hi"}
    assert result.input_tokens == 85
    assert result.output_tokens == 12
    assert result.model == "anthropic:claude-sonnet-4.6"
    assert result.cost_usd() > 0


# ----- workspace guards path traversal ------------------------------------
def test_workspace_blocks_path_traversal() -> None:
    ws = Workspace.new()
    try:
        with pytest.raises(PermissionError):
            ws.write("../escape.txt", "nope")
    finally:
        ws.cleanup()


def test_build_tool_set_exposes_eight_tools() -> None:
    tools = BUILD_TOOL_SET()
    names = sorted(t.name for t in tools)
    assert names == sorted([
        "write_file", "edit_file", "read_file", "list_files",
        "ast_parse_check", "run_shell", "search_web", "emit_done",
    ])
