"""OpenRouter AgentRuntime adapter.

OpenRouter is an OpenAI-compatible gateway at
``https://openrouter.ai/api/v1`` that routes to 300+ models from 60+
providers. Same tool-use protocol as OpenAI Chat Completions, so this
adapter is a lightweight OpenAI-REST client — stdlib only, no SDK
dependency.

Model names for OpenRouter look like ``provider/model``:

    anthropic/claude-sonnet-4.6
    openai/gpt-5.4
    google/gemini-3-pro-preview
    deepseek/deepseek-v3.2
    meta-llama/llama-3.3-70b-instruct

Set ``OPENROUTER_API_KEY`` in the environment.
"""

from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.request
from typing import Any

from daas.agent.base import (
    AgentRunResult,
    AgentRuntime,
    Tool,
    ToolCall,
    register_runtime,
)


OPENROUTER_ROOT = "https://openrouter.ai/api/v1"


def _tools_as_openai(tools: list[Tool]) -> list[dict]:
    return [
        {
            "type": "function",
            "function": {
                "name": t.name,
                "description": t.description,
                "parameters": t.parameters_schema,
            },
        }
        for t in tools
    ]


def _post_openai_chat(key: str, body: dict, timeout: int = 90) -> dict:
    url = f"{OPENROUTER_ROOT}/chat/completions"
    req = urllib.request.Request(
        url,
        data=json.dumps(body).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {key}",
            "HTTP-Referer": "https://attrition.sh",
            "X-Title": "attrition compiler agent",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


class OpenRouterAgent:
    name = "openrouter"

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
        key = api_key or os.environ.get("OPENROUTER_API_KEY", "")
        if not key:
            raise RuntimeError("OPENROUTER_API_KEY required for openrouter runtime")

        tool_by_name = {t.name: t for t in tools}
        messages: list[dict] = [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ]
        openai_tools = _tools_as_openai(tools)

        tool_calls: list[ToolCall] = []
        in_tok = 0
        out_tok = 0
        final_text = ""
        t_start = time.perf_counter()
        turn = 0

        for turn in range(max_turns):
            body: dict[str, Any] = {
                "model": model,
                "messages": messages,
                "tools": openai_tools,
                "temperature": temperature,
                "max_tokens": 2048,
            }
            if turn == 0:
                body["tool_choice"] = "required"  # force initial tool call
            else:
                body["tool_choice"] = "auto"

            try:
                resp = _post_openai_chat(key, body)
            except urllib.error.HTTPError as e:
                raise RuntimeError(
                    f"openrouter HTTP {e.code}: {e.read().decode()[:300]}"
                ) from e

            usage = resp.get("usage", {}) or {}
            in_tok += int(usage.get("prompt_tokens", 0) or 0)
            out_tok += int(usage.get("completion_tokens", 0) or 0)
            choices = resp.get("choices", []) or []
            if not choices:
                break
            msg = choices[0].get("message", {}) or {}
            tcs = msg.get("tool_calls") or []

            if tcs:
                messages.append({
                    "role": "assistant",
                    "content": msg.get("content") or "",
                    "tool_calls": tcs,
                })
                done_emitted = False
                for tc in tcs:
                    fn = tc.get("function", {}) or {}
                    name = str(fn.get("name") or "")
                    try:
                        args = json.loads(fn.get("arguments") or "{}")
                    except json.JSONDecodeError:
                        args = {}
                    tool = tool_by_name.get(name)
                    t0 = time.perf_counter()
                    if tool is None:
                        result: dict[str, Any] = {
                            "ok": False,
                            "error": f"unknown tool: {name}",
                        }
                    else:
                        try:
                            result = tool.handler(args if isinstance(args, dict) else {})
                        except Exception as e:  # noqa: BLE001
                            result = {"ok": False, "error": f"{type(e).__name__}: {e}"}
                    elapsed_ms = int((time.perf_counter() - t0) * 1000)
                    tool_calls.append(
                        ToolCall(
                            name=name,
                            arguments=args if isinstance(args, dict) else {},
                            result=result,
                            elapsed_ms=elapsed_ms,
                        )
                    )
                    messages.append({
                        "role": "tool",
                        "tool_call_id": tc.get("id", ""),
                        "content": json.dumps(result),
                    })
                    if name == "emit_done":
                        done_emitted = True
                if done_emitted:
                    break
                continue

            if msg.get("content"):
                final_text = str(msg.get("content") or "")
                break
            break

        elapsed_ms = int((time.perf_counter() - t_start) * 1000)
        # Normalize model alias via prefix stripping: anthropic/claude-sonnet-4.6
        # -> anthropic:claude-sonnet-4.6 for pricing lookup.
        norm_model = model.replace("/", ":", 1) if "/" in model else model
        return AgentRunResult(
            text=final_text,
            tool_calls=tool_calls,
            input_tokens=in_tok,
            output_tokens=out_tok,
            turns=turn + 1,
            model=norm_model,
            runtime_label=self.name,
            elapsed_ms=elapsed_ms,
        )


register_runtime("openrouter", lambda: OpenRouterAgent())
