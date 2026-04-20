"""Tool-first chain emitter.

Emits a Python package that runs a bounded tool loop:
  1. Pick one tool from an explicit allowlist (Gemini function calling).
  2. Execute the tool.
  3. Feed result back.
  4. Emit strict-schema response.

No orchestrator graph, no subagents. Use this when the workflow has
clear tool boundaries but one reasoning tier is enough.
"""

from __future__ import annotations

import json
from typing import Any

from daas.compile_down.artifact import ArtifactBundle


DEFAULT_TARGET_MODEL = "gemini-3.1-flash-lite-preview"


def emit_bundle(spec: Any, *, target_model: str | None = None) -> ArtifactBundle:
    model = target_model or getattr(spec, "executor_model", None) or DEFAULT_TARGET_MODEL
    trace_id = getattr(spec, "source_trace_id", "unknown")
    system_prompt = getattr(spec, "orchestrator_system_prompt", "") or (
        "You are a tool-using assistant. Prefer calling a tool over speculating."
    )
    tools_list = list(getattr(spec, "tools", []) or [])
    success_criteria = list(getattr(spec, "success_criteria", []) or [])
    domain_rules = list(getattr(spec, "domain_rules", []) or [])

    bundle = ArtifactBundle(runtime_lane="tool_first_chain", target_model=model)

    bundle.add("prompts.py", _prompts_py(system_prompt, success_criteria, domain_rules, trace_id), "python")
    bundle.add("tools.py", _tools_py(tools_list), "python")
    bundle.add("runner.py", _runner_py(model), "python")
    bundle.add("schemas.py", _schemas_py(), "python")
    bundle.add("requirements.txt", "google-genai>=1.0.0\n", "text")
    bundle.add("README.md", _readme_md(trace_id, model, tools_list), "markdown")

    return bundle


def _safe_py_string(s: str) -> str:
    """repr()-based safe Python literal. Handles all quoting edge cases."""
    return repr(s)


def _prompts_py(system_prompt: str, success_criteria: list[str], rules: list[str], trace_id: str) -> str:
    criteria_block = "\n".join(f"  - {c}" for c in success_criteria) if success_criteria else "  (none)"
    rules_block = "\n".join(f"  - {r}" for r in rules) if rules else "  (none)"
    # Append the shared tool-calling rules to whatever was distilled from the trace.
    full_prompt = (
        system_prompt
        + "\n\nRules:\n- Prefer calling a tool over speculating.\n"
        "- Use at most ONE tool per turn unless the user asked for multiple.\n"
        "- Return JSON that matches the response schema exactly."
    )
    return (
        f'"""Distilled prompt from trace {trace_id}.\n\n'
        f'Success criteria:\n{criteria_block}\n\n'
        f'Domain rules:\n{rules_block}\n"""\n\n'
        f'SYSTEM_PROMPT = {_safe_py_string(full_prompt)}\n'
    )


def _tools_py(tools: list[Any]) -> str:
    """Emit tool specs in Gemini's functionDeclarations shape + a dispatch map."""
    decls: list[dict[str, Any]] = []
    handlers = []
    for t in tools:
        name = getattr(t, "name", None) or (t.get("name") if isinstance(t, dict) else None)
        purpose = getattr(t, "purpose", None) or (t.get("purpose") if isinstance(t, dict) else "")
        input_schema = (
            getattr(t, "input_schema", None)
            or (t.get("input_schema") if isinstance(t, dict) else {})
            or {}
        )
        if not name:
            continue
        decls.append(
            {
                "name": name,
                "description": str(purpose)[:512],
                "parameters": _to_gemini_schema(input_schema),
            }
        )
        handlers.append(name)

    decls_json = json.dumps(decls, indent=2, ensure_ascii=False)
    handler_map = ",\n    ".join(f'"{n}": _stub_{n}' for n in handlers) or ""
    stub_fns = "\n\n".join(
        f'def _stub_{n}(args: dict) -> dict:\n    """TODO: implement tool {n}. Return JSON-serializable dict."""\n    return {{"status": "not_implemented", "tool": "{n}", "args": args}}'
        for n in handlers
    ) or '# No tools emitted — add handlers here when the spec has tools.'

    return f'''"""Tool declarations (Gemini function-calling shape) + local handlers.

Replace each `_stub_*` function with a real implementation before
replaying against production data.
"""

from __future__ import annotations

from typing import Any, Callable

GEMINI_TOOLS = [
    {{
        "functionDeclarations": {decls_json}
    }}
]

{stub_fns}


HANDLERS: dict[str, Callable[[dict[str, Any]], dict[str, Any]]] = {{
    {handler_map}
}}


def dispatch(name: str, args: dict[str, Any]) -> dict[str, Any]:
    fn = HANDLERS.get(name)
    if fn is None:
        return {{"error": f"no handler for tool '{{name}}'"}}
    return fn(args)
'''


def _to_gemini_schema(schema: dict[str, Any]) -> dict[str, Any]:
    """Best-effort mapping from free-form input_schema to Gemini's shape."""
    if not isinstance(schema, dict):
        return {"type": "OBJECT", "properties": {}}
    if "type" not in schema:
        return {"type": "OBJECT", "properties": schema or {}}
    type_map = {
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
        "dict": "OBJECT",
        "object": "OBJECT",
    }
    t = type_map.get(str(schema.get("type", "object")).lower(), "OBJECT")
    out: dict[str, Any] = {"type": t}
    if "description" in schema:
        out["description"] = str(schema["description"])[:512]
    if t == "OBJECT" and isinstance(schema.get("properties"), dict):
        out["properties"] = {
            k: _to_gemini_schema(v if isinstance(v, dict) else {"type": "string"})
            for k, v in schema["properties"].items()
        }
        if isinstance(schema.get("required"), list):
            out["required"] = list(schema["required"])
    if t == "ARRAY":
        out["items"] = _to_gemini_schema(schema.get("items") or {"type": "string"})
    return out


def _schemas_py() -> str:
    return '''"""Input/output schemas for the tool-first chain."""

from dataclasses import dataclass
from typing import Any


@dataclass
class ChainInput:
    query: str
    context: dict[str, Any] = None  # type: ignore[assignment]


@dataclass
class ChainOutput:
    answer: str
    tool_calls: list[dict[str, Any]]
    input_tokens: int
    output_tokens: int
    cost_usd: float
    turns: int
'''


def _runner_py(model: str) -> str:
    return f'''"""Tool-first chain runner — bounded tool loop, single reasoning tier."""

from __future__ import annotations

import argparse
import json
import os
import time
import urllib.request

from prompts import SYSTEM_PROMPT
from schemas import ChainInput, ChainOutput
from tools import GEMINI_TOOLS, dispatch

MODEL = "{model}"
MAX_TURNS = 4   # bounded tool loop
FLASH_LITE_IN = 0.10 / 1_000_000
FLASH_LITE_OUT = 0.40 / 1_000_000


def _gemini_key() -> str:
    key = os.environ.get("GEMINI_API_KEY")
    if not key:
        raise RuntimeError("Set GEMINI_API_KEY")
    return key


def _post(url: str, body: dict) -> dict:
    req = urllib.request.Request(
        url,
        data=json.dumps(body).encode("utf-8"),
        headers={{"Content-Type": "application/json"}},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read())


def run(inp: ChainInput) -> ChainOutput:
    key = _gemini_key()
    url = (
        f"https://generativelanguage.googleapis.com/v1beta/"
        f"models/{{MODEL}}:generateContent?key={{key}}"
    )
    # Initial user turn
    contents = [
        {{"role": "user", "parts": [{{"text": inp.query}}]}},
    ]
    in_tok = out_tok = 0
    tool_calls_log: list = []
    final_text = ""

    for turn in range(MAX_TURNS):
        body = {{
            "systemInstruction": {{"parts": [{{"text": SYSTEM_PROMPT}}]}},
            "contents": contents,
            "tools": GEMINI_TOOLS,
            "generationConfig": {{"temperature": 0.2, "maxOutputTokens": 2048}},
        }}
        resp = _post(url, body)
        usage = resp.get("usageMetadata", {{}})
        in_tok += int(usage.get("promptTokenCount", 0))
        out_tok += int(usage.get("candidatesTokenCount", 0))
        cands = resp.get("candidates", [])
        if not cands:
            break
        parts = (cands[0].get("content") or {{}}).get("parts", [])
        fn_calls = [p.get("functionCall") for p in parts if p.get("functionCall")]
        text_parts = [p.get("text", "") for p in parts if p.get("text")]
        if fn_calls:
            contents.append({{"role": "model", "parts": parts}})
            for fc in fn_calls:
                name = fc.get("name", "")
                args = fc.get("args", {{}}) or {{}}
                result = dispatch(name, args)
                tool_calls_log.append({{"tool": name, "args": args, "result": result}})
                contents.append(
                    {{
                        "role": "user",
                        "parts": [
                            {{"functionResponse": {{"name": name, "response": {{"result": result}}}}}}
                        ],
                    }}
                )
            continue  # another turn with tool results
        if text_parts:
            final_text = "".join(text_parts)
            break
        break

    cost = in_tok * FLASH_LITE_IN + out_tok * FLASH_LITE_OUT
    return ChainOutput(
        answer=final_text,
        tool_calls=tool_calls_log,
        input_tokens=in_tok,
        output_tokens=out_tok,
        cost_usd=cost,
        turns=min(turn + 1, MAX_TURNS),
    )


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--query", required=True)
    args = p.parse_args()
    out = run(ChainInput(query=args.query))
    print(out.answer)
    print(
        f"\\n[cost ${{out.cost_usd:.6f}} "
        f"tokens={{out.input_tokens + out.output_tokens}} "
        f"turns={{out.turns}} tools={{len(out.tool_calls)}}]"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
'''


def _readme_md(trace_id: str, model: str, tools: list[Any]) -> str:
    tool_names = [getattr(t, "name", None) or (t.get("name") if isinstance(t, dict) else "?") for t in tools]
    tool_list = "\n".join(f"- `{n}`" for n in tool_names) or "_(no tools in distilled spec)_"
    return f'''# Tool-first chain — distilled from trace `{trace_id}`

Generated by attrition.sh compile_down. Target model: `{model}`.

## Declared tools

{tool_list}

## Run

```bash
pip install -r requirements.txt
export GEMINI_API_KEY=...
python runner.py --query "your query here"
```

Each tool has a stub in `tools.py`. Replace `_stub_<name>` with a real
implementation (DB lookup, API call, local computation) before replaying
against production data — the default stubs return
`{{status: "not_implemented"}}`.

## Fidelity check before shipping

After implementing the tool handlers, run the 3-measurement fidelity
template against the original trace's benchmark:

```
python -m daas.fidelity.cli \\
  --benchmark <your-benchmark> \\
  --externalization-id <slug> \\
  --form tool_schema \\
  --artifact path/to/bundle.json \\
  --source-model gemini-3.1-pro-preview \\
  --small-model {model} \\
  --large-model gemini-3.1-pro-preview \\
  --limit 60 --record
```

Verdict must be `transfers` (fidelity ≥ 80%) before this package
replaces the frontier runtime in production.
'''
