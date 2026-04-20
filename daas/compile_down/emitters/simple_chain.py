"""Simple chain emitter — bounded, deterministic, single-shot LLM call.

Emits a minimal Python package with:
  - runner.py       — the one-shot call with strict input/output validation
  - prompts.py      — the distilled system prompt
  - schemas.py      — pydantic-like input/output shapes
  - README.md       — how to run
  - requirements.txt

The generated code has exactly one dependency: google-genai. No
orchestration, no tool loop, no state.
"""

from __future__ import annotations

from typing import Any

from daas.compile_down.artifact import ArtifactBundle


DEFAULT_TARGET_MODEL = "gemini-3.1-flash-lite-preview"


def emit_bundle(spec: Any, *, target_model: str | None = None) -> ArtifactBundle:
    """Convert a WorkflowSpec into a simple-chain code bundle."""
    model = target_model or getattr(spec, "executor_model", None) or DEFAULT_TARGET_MODEL
    trace_id = getattr(spec, "source_trace_id", "unknown")
    system_prompt = getattr(spec, "orchestrator_system_prompt", "") or (
        "You are a focused assistant. Answer precisely and concisely."
    )
    success_criteria = list(getattr(spec, "success_criteria", []) or [])
    domain_rules = list(getattr(spec, "domain_rules", []) or [])

    bundle = ArtifactBundle(runtime_lane="simple_chain", target_model=model)

    bundle.add(
        "prompts.py",
        _prompts_py(system_prompt, success_criteria, domain_rules, trace_id),
        "python",
    )
    bundle.add("schemas.py", _schemas_py(), "python")
    bundle.add("runner.py", _runner_py(model), "python")
    bundle.add("requirements.txt", "google-genai>=1.0.0\n", "text")
    bundle.add("README.md", _readme_md(trace_id, model), "markdown")

    return bundle


def _safe_py_string(s: str) -> str:
    """Emit ``s`` as a Python string literal that is GUARANTEED to parse.

    repr() handles embedded quotes, backslashes, newlines, trailing
    quotes, and every other edge case triple-quoted strings break on.
    The result is a single-line literal, which is fine for generated
    code (it's the value that matters, not the formatting).
    """
    return repr(s)


def _prompts_py(system_prompt: str, success_criteria: list[str], rules: list[str], trace_id: str) -> str:
    # Keep the module docstring simple ASCII to avoid triple-quote traps.
    criteria_block = "\n".join(f"  - {c}" for c in success_criteria) if success_criteria else "  (none)"
    rules_block = "\n".join(f"  - {r}" for r in rules) if rules else "  (none)"
    # Module docstring uses only the trace_id (safe) — full prompt goes
    # through repr() below so nothing user-controlled touches triple quotes.
    return (
        f'"""System prompt distilled from trace {trace_id}.\n\n'
        f'Success criteria:\n{criteria_block}\n\n'
        f'Domain rules:\n{rules_block}\n"""\n\n'
        f'SYSTEM_PROMPT = {_safe_py_string(system_prompt)}\n'
    )


def _schemas_py() -> str:
    return '''"""Minimal I/O schemas for the simple chain.

Pydantic would be cleaner. We use plain dataclasses here to keep the
generated package zero-dependency-beyond-google-genai.
"""

from dataclasses import dataclass


@dataclass
class ChainInput:
    query: str
    context: str = ""


@dataclass
class ChainOutput:
    answer: str
    input_tokens: int = 0
    output_tokens: int = 0
    cost_usd: float = 0.0
'''


def _runner_py(model: str) -> str:
    return f'''"""Single-shot LLM runner — simple_chain emitter output."""

from __future__ import annotations

import argparse
import json
import os
import time

from prompts import SYSTEM_PROMPT
from schemas import ChainInput, ChainOutput

MODEL = "{model}"


def _gemini_key() -> str:
    key = os.environ.get("GEMINI_API_KEY")
    if not key:
        raise RuntimeError("Set GEMINI_API_KEY")
    return key


def run(inp: ChainInput) -> ChainOutput:
    import urllib.request

    prompt = f"{{SYSTEM_PROMPT}}\\n\\nCONTEXT:\\n{{inp.context}}\\n\\nQUERY:\\n{{inp.query}}\\n\\nRESPONSE:"
    body = {{
        "contents": [{{"parts": [{{"text": prompt}}]}}],
        "generationConfig": {{"temperature": 0.2, "maxOutputTokens": 2048}},
    }}
    url = (
        f"https://generativelanguage.googleapis.com/v1beta/"
        f"models/{{MODEL}}:generateContent?key={{_gemini_key()}}"
    )
    req = urllib.request.Request(
        url,
        data=json.dumps(body).encode("utf-8"),
        headers={{"Content-Type": "application/json"}},
        method="POST",
    )
    started = time.time()
    with urllib.request.urlopen(req, timeout=30) as r:
        data = json.loads(r.read())
    text = "".join(p.get("text", "") for p in data["candidates"][0]["content"]["parts"])
    usage = data.get("usageMetadata", {{}})
    in_tok = int(usage.get("promptTokenCount", 0))
    out_tok = int(usage.get("candidatesTokenCount", 0))
    # Flash Lite pricing: $0.10 in, $0.40 out per 1M tokens
    cost = in_tok * 0.10 / 1_000_000 + out_tok * 0.40 / 1_000_000
    return ChainOutput(answer=text, input_tokens=in_tok, output_tokens=out_tok, cost_usd=cost)


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--query", required=True)
    p.add_argument("--context", default="")
    args = p.parse_args()
    out = run(ChainInput(query=args.query, context=args.context))
    print(out.answer)
    print(f"\\n[cost ${{out.cost_usd:.6f}} tokens={{out.input_tokens + out.output_tokens}}]")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
'''


def _readme_md(trace_id: str, model: str) -> str:
    return f'''# Simple chain — distilled from trace `{trace_id}`

Generated by attrition.sh compile_down pipeline. Target model: `{model}`.

## Run

```bash
pip install -r requirements.txt
export GEMINI_API_KEY=...
python runner.py --query "your query here"
```

## What this is

A single-shot LLM call with a distilled system prompt. No tools, no
orchestration, no state. Use this shape when the original workflow
is bounded and deterministic (report generators, summarizers,
classification).

## What this is NOT

- A scaffold for multi-step tool-using agents (use `tool_first_chain`)
- A stateful workflow with policies and outcomes (use
  `orchestrator_worker` with a full world model)

## Replay verification

Before trusting this in production, run it against the original
traces and score via `daas.fidelity`:

```python
from daas.fidelity.trial import run_trials
# ... pass this chain's `run()` as the distilled measurement
```
'''
