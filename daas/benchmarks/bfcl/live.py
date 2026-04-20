"""Live BFCL replay — Gemini Flash Lite executes real BFCL tasks.

Turns a BFCL task into a tool-calling request for Gemini 3.1 Flash Lite
(same executor our DaaS replay pipeline uses). The resulting function
calls are scored against BFCL's ground truth with the same AST
comparator as the golden/broken dry-runs — so all three modes feed the
exact same ``score_calls`` path.

Why this matters: a model that can't satisfy BFCL's AST checker on
simple single-call tasks is not going to satisfy the DaaS scaffold's
tool-call-parity guarantees either. BFCL is the rigorous lower bound
for ``covers_main_points`` + ``internally_consistent`` rubric checks
the product-surface judge already runs.

Agentic reliability:
  [TIMEOUT]       AbortSignal + per-request wall-clock cap (GEMINI_TIMEOUT_MS).
  [HONEST_STATUS] Upstream errors surface as ``harness_error`` on
                  BenchmarkResult, never as passed=True or score=0.0.
  [BOUND_READ]    Function spec list capped at MAX_TOOLS_PER_TASK.
  [DETERMINISTIC] temperature=0 for reproducibility; results stream to
                  JSONL with a stable schema.
"""

from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

GEMINI_FLASH_LITE = "gemini-3.1-flash-lite-preview"
GEMINI_URL_TEMPLATE = (
    "https://generativelanguage.googleapis.com/v1beta/"
    "models/{model}:generateContent?key={key}"
)

GEMINI_TIMEOUT_SECONDS = 30
MAX_TOOLS_PER_TASK = 16  # BOUND_READ — BFCL tasks rarely exceed ~6

# Per-call cost basis for Flash Lite (as of 2026-04):
#   input:  $0.10 / 1M tokens
#   output: $0.40 / 1M tokens
# (cost is informational; judge never overrides score with cost.)
FLASH_LITE_INPUT_USD_PER_TOK = 0.10 / 1_000_000
FLASH_LITE_OUTPUT_USD_PER_TOK = 0.40 / 1_000_000


def _resolve_api_key() -> str:
    """Resolve GEMINI_API_KEY from env, then the NodeBench .env.local fallback."""
    key = os.environ.get("GEMINI_API_KEY")
    if key:
        return key
    env_local = Path(
        "D:/VSCode Projects/cafecorner_nodebench/nodebench_ai4/nodebench-ai/.env.local"
    )
    if env_local.exists():
        for line in env_local.read_text(encoding="utf-8").splitlines():
            if line.startswith("GEMINI_API_KEY="):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    raise RuntimeError(
        "GEMINI_API_KEY not set. Export it or add to "
        "nodebench-ai/.env.local as GEMINI_API_KEY=..."
    )


def _bfcl_to_gemini_tools(bfcl_functions: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Translate BFCL function specs → Gemini ``tools`` array.

    BFCL shape::

        {"name": "fn", "description": "...", "parameters": {"type": "dict", "properties": {...}, "required": [...]}}

    Gemini shape::

        [{"functionDeclarations": [{"name": "fn", "description": "...", "parameters": {"type": "OBJECT", "properties": {...}, "required": [...]}}]}]

    BFCL uses lowercase ``dict`` / ``str`` / ``int`` / ``float`` / ``list`` for
    type names; Gemini expects uppercase JSON-Schema-ish names.
    """
    type_map = {
        "dict": "OBJECT",
        "object": "OBJECT",
        "str": "STRING",
        "string": "STRING",
        "int": "INTEGER",
        "integer": "INTEGER",
        "float": "NUMBER",
        "number": "NUMBER",
        "bool": "BOOLEAN",
        "boolean": "BOOLEAN",
        "list": "ARRAY",
        "array": "ARRAY",
        "tuple": "ARRAY",
        "any": "STRING",  # lossy but valid; BFCL marks rare edge cases as "any"
    }

    def _convert_schema(schema: dict[str, Any]) -> dict[str, Any]:
        if not isinstance(schema, dict):
            return {"type": "STRING"}
        out: dict[str, Any] = {}
        bfcl_type = schema.get("type", "string")
        out["type"] = type_map.get(str(bfcl_type).lower(), "STRING")
        if "description" in schema:
            out["description"] = str(schema["description"])[:512]  # BOUND_READ
        if "enum" in schema and isinstance(schema["enum"], list):
            out["enum"] = [str(v) for v in schema["enum"][:32]]
        if out["type"] == "OBJECT" and isinstance(schema.get("properties"), dict):
            out["properties"] = {
                k: _convert_schema(v) for k, v in schema["properties"].items()
            }
            if isinstance(schema.get("required"), list):
                out["required"] = list(schema["required"])
        if out["type"] == "ARRAY":
            items = schema.get("items") or {"type": "string"}
            out["items"] = _convert_schema(items)
        return out

    declarations = []
    for fn in bfcl_functions[:MAX_TOOLS_PER_TASK]:
        name = fn.get("name")
        if not name:
            continue
        decl: dict[str, Any] = {
            "name": str(name),
            "description": str(fn.get("description", ""))[:1024],
        }
        params = fn.get("parameters") or {}
        if params:
            decl["parameters"] = _convert_schema(params)
        declarations.append(decl)
    return [{"functionDeclarations": declarations}] if declarations else []


def _bfcl_question_to_gemini_contents(
    question: Any,
) -> list[dict[str, Any]]:
    """BFCL question is ``list[list[{"role", "content"}]]`` (outer list is turn groups).

    We flatten it into Gemini's ``contents`` — ``[{"role": "user"|"model", "parts": [{"text": ...}]}]``.
    """
    contents: list[dict[str, Any]] = []
    if not isinstance(question, list):
        return [{"role": "user", "parts": [{"text": str(question)}]}]

    # BFCL v3 wraps turns in an outer list — flatten one level if needed
    inner = question
    if question and isinstance(question[0], list):
        inner = question[0]

    for turn in inner:
        if not isinstance(turn, dict):
            continue
        role = turn.get("role", "user")
        gem_role = "model" if role in ("assistant", "model") else "user"
        text = str(turn.get("content", ""))
        contents.append({"role": gem_role, "parts": [{"text": text}]})
    if not contents:
        contents = [{"role": "user", "parts": [{"text": ""}]}]
    return contents


def live_replay(
    task: dict[str, Any],
    *,
    api_key: str | None = None,
    model: str = GEMINI_FLASH_LITE,
) -> dict[str, Any]:
    """Ask Gemini Flash Lite to pick function call(s) for a BFCL task.

    Returns the canonical DaaS replay-artifact shape::

        {
          "toolCalls": [{"worker": "...", "tool": "...", "args": {...}}, ...],
          "_meta": {
            "model": "...",
            "input_tokens": int,
            "output_tokens": int,
            "cost_usd": float,
            "duration_ms": int,
            "error": str | None,
          }
        }

    On API failure, ``toolCalls`` is [] and ``_meta.error`` is populated
    — the scorer then treats it the same as ``broken`` mode.
    """
    key = api_key or _resolve_api_key()
    tools = _bfcl_to_gemini_tools(task.get("function", []) or [])
    contents = _bfcl_question_to_gemini_contents(task.get("question"))

    body: dict[str, Any] = {
        "contents": contents,
        "generationConfig": {
            "temperature": 0.0,  # DETERMINISTIC
            "maxOutputTokens": 1024,
        },
    }
    if tools:
        body["tools"] = tools
        # FunctionCallingConfig: force the model to emit a function call
        # when tools are available (matches BFCL's "it should call the
        # function" expectation for simple/multiple/parallel).
        body["toolConfig"] = {"functionCallingConfig": {"mode": "ANY"}}

    url = GEMINI_URL_TEMPLATE.format(model=model, key=key)
    req = urllib.request.Request(
        url,
        data=json.dumps(body).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    started = time.time()
    try:
        with urllib.request.urlopen(req, timeout=GEMINI_TIMEOUT_SECONDS) as resp:
            payload = json.loads(resp.read())
    except urllib.error.HTTPError as exc:
        body_text = exc.read().decode("utf-8", errors="replace")[:512]
        return {
            "toolCalls": [],
            "_meta": {
                "model": model,
                "input_tokens": 0,
                "output_tokens": 0,
                "cost_usd": 0.0,
                "duration_ms": int((time.time() - started) * 1000),
                "error": f"HTTPError {exc.code}: {body_text}",
            },
        }
    except Exception as exc:  # network / timeout / parse
        return {
            "toolCalls": [],
            "_meta": {
                "model": model,
                "input_tokens": 0,
                "output_tokens": 0,
                "cost_usd": 0.0,
                "duration_ms": int((time.time() - started) * 1000),
                "error": f"{type(exc).__name__}: {exc}",
            },
        }
    duration_ms = int((time.time() - started) * 1000)

    # Extract function calls from the first candidate's parts
    tool_calls: list[dict[str, Any]] = []
    candidates = payload.get("candidates") or []
    if candidates:
        parts = (candidates[0].get("content") or {}).get("parts") or []
        for p in parts:
            fc = p.get("functionCall")
            if not fc:
                continue
            name = fc.get("name")
            args = fc.get("args") or {}
            if name:
                tool_calls.append({"worker": "bfcl_replay", "tool": name, "args": args})

    usage = payload.get("usageMetadata") or {}
    in_tok = int(usage.get("promptTokenCount", 0))
    out_tok = int(usage.get("candidatesTokenCount", 0))
    cost = in_tok * FLASH_LITE_INPUT_USD_PER_TOK + out_tok * FLASH_LITE_OUTPUT_USD_PER_TOK

    return {
        "toolCalls": tool_calls,
        "_meta": {
            "model": model,
            "input_tokens": in_tok,
            "output_tokens": out_tok,
            "cost_usd": cost,
            "duration_ms": duration_ms,
            "error": None,
        },
    }
