"""Gemini AgentRuntime adapter.

Uses the REST ``generateContent`` endpoint directly (stdlib only) so we
don't need the ``google-genai`` package at install time. The agent
loop:

    1. Send system + user + accumulated ``contents`` with
       ``toolConfig.functionCallingConfig.mode = ANY`` on turn 0 (force
       tool call) and ``AUTO`` on turn 1+ (let it terminate).
    2. If the model emits a ``functionCall`` part, dispatch the handler,
       append the result as a ``functionResponse`` turn, loop.
    3. If the model emits only ``text``, that's the final answer.

Pricing uses the PRICING_PER_TOKEN table in base.py; model names
accepted: "gemini-3-pro", "gemini-3-pro-long", "gemini-3.1-flash-lite",
"gemini-3.1-flash-lite-preview", "gemini-3.1-pro-preview".
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


GEMINI_API_ROOT = "https://generativelanguage.googleapis.com/v1beta"

_GEMINI_TYPE_MAP = {
    "object": "OBJECT",
    "array": "ARRAY",
    "string": "STRING",
    "integer": "INTEGER",
    "number": "NUMBER",
    "boolean": "BOOLEAN",
}


def _to_gemini_schema(schema: dict) -> dict:
    """Normalize JSON Schema -> Gemini OpenAPI style (UPPERCASE types)."""
    if not isinstance(schema, dict):
        return schema
    out: dict[str, Any] = {}
    for k, v in schema.items():
        if k == "type" and isinstance(v, str):
            out["type"] = _GEMINI_TYPE_MAP.get(v.lower(), v.upper())
        elif k == "properties" and isinstance(v, dict):
            out["properties"] = {pk: _to_gemini_schema(pv) for pk, pv in v.items()}
        elif k == "items" and isinstance(v, dict):
            out["items"] = _to_gemini_schema(v)
        else:
            out[k] = v
    return out


def _tools_as_gemini(tools: list[Tool]) -> list[dict]:
    return [
        {
            "functionDeclarations": [
                {
                    "name": t.name,
                    "description": t.description,
                    "parameters": _to_gemini_schema(t.parameters_schema),
                }
                for t in tools
            ]
        }
    ]


class GeminiAgent:
    name = "gemini_agent"

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
        key = api_key or os.environ.get("GEMINI_API_KEY", "")
        if not key:
            raise RuntimeError("GEMINI_API_KEY required for gemini_agent runtime")

        tool_by_name = {t.name: t for t in tools}
        contents: list[dict] = [
            {"role": "user", "parts": [{"text": user}]},
        ]
        gemini_tools = _tools_as_gemini(tools)
        url = f"{GEMINI_API_ROOT}/models/{model}:generateContent?key={key}"

        tool_calls: list[ToolCall] = []
        in_tok = 0
        out_tok = 0
        final_text = ""
        t_start = time.perf_counter()

        for turn in range(max_turns):
            mode = "ANY" if turn == 0 else "AUTO"
            body = {
                "systemInstruction": {"parts": [{"text": system}]},
                "contents": contents,
                "tools": gemini_tools,
                "toolConfig": {"functionCallingConfig": {"mode": mode}},
                "generationConfig": {
                    "temperature": temperature,
                    "maxOutputTokens": 2048,
                },
            }
            req = urllib.request.Request(
                url,
                data=json.dumps(body).encode("utf-8"),
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            try:
                with urllib.request.urlopen(req, timeout=90) as r:
                    resp = json.loads(r.read().decode("utf-8"))
            except urllib.error.HTTPError as e:
                raise RuntimeError(
                    f"gemini HTTP {e.code}: {e.read().decode()[:300]}"
                ) from e

            usage = resp.get("usageMetadata", {}) or {}
            in_tok += int(usage.get("promptTokenCount", 0) or 0)
            out_tok += int(usage.get("candidatesTokenCount", 0) or 0)
            cands = resp.get("candidates", []) or []
            if not cands:
                break
            parts = (cands[0].get("content") or {}).get("parts", []) or []
            fn_parts = [p.get("functionCall") for p in parts if p.get("functionCall")]
            text_parts = [str(p.get("text") or "") for p in parts if p.get("text")]

            if fn_parts:
                # Dispatch each tool call, append functionResponse turn
                contents.append({"role": "model", "parts": parts})
                response_parts = []
                done_emitted = False
                for fc in fn_parts:
                    name = str(fc.get("name") or "")
                    args = fc.get("args") or {}
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
                    response_parts.append(
                        {
                            "functionResponse": {
                                "name": name,
                                "response": {"result": result},
                            }
                        }
                    )
                    if name == "emit_done":
                        done_emitted = True
                contents.append({"role": "user", "parts": response_parts})
                if done_emitted:
                    break
                continue  # another LLM turn with tool results

            if text_parts:
                final_text = "\n".join(text_parts)
                break
            break  # no content, no tool — give up

        elapsed_ms = int((time.perf_counter() - t_start) * 1000)
        normalized_model = f"google:{model}"
        return AgentRunResult(
            text=final_text,
            tool_calls=tool_calls,
            input_tokens=in_tok,
            output_tokens=out_tok,
            turns=min(turn + 1, max_turns),
            model=normalized_model,
            runtime_label=self.name,
            elapsed_ms=elapsed_ms,
        )


register_runtime("gemini_agent", lambda: GeminiAgent())
