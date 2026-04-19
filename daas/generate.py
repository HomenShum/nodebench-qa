"""Scaffold generator — emits executable Python code from a WorkflowSpec.

Targets google-genai SDK (since FloorAI uses Gemini). Emits a single-file
Python module per workflow that can be imported and run as:

    from scaffolds.my_workflow import run_workflow
    result = run_workflow(query, repo_context)

The generated scaffold implements the orchestrator-worker pattern:
  1. Orchestrator (cheap model) receives the query + domain rules
  2. Orchestrator plans which workers to dispatch
  3. Each worker (cheap model, narrow role) executes with scoped context
  4. Handoff payloads flow between workers
  5. Final formatter worker assembles the response

The scaffold is DETERMINISTIC given the same WorkflowSpec.
"""

import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from schemas import WorkflowSpec, Worker  # noqa: E402

SCAFFOLDS = Path(__file__).parent / "scaffolds"
SCAFFOLDS.mkdir(parents=True, exist_ok=True)
RESULTS = Path(__file__).parent / "results"


SCAFFOLD_TEMPLATE = '''"""Auto-generated scaffold from WorkflowSpec.

Source trace: {source_trace_id}
Executor model: {executor_model}
Workers: {worker_count}
Tools: {tool_count}

DO NOT EDIT — regenerate via `python daas/generate.py`.
"""

import json
import time
import urllib.request

EXECUTOR_MODEL = "{executor_model}"
PRICING_IN = {pricing_in}   # $ per 1M input tokens
PRICING_OUT = {pricing_out}  # $ per 1M output tokens


def call_llm(prompt: str, api_key: str, temperature: float = 0.2, max_tokens: int = 1500) -> dict:
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{{EXECUTOR_MODEL}}:generateContent?key={{api_key}}"
    body = {{
        "contents": [{{"parts": [{{"text": prompt}}]}}],
        "generationConfig": {{"temperature": temperature, "maxOutputTokens": max_tokens}},
    }}
    req = urllib.request.Request(
        url, data=json.dumps(body).encode(),
        headers={{"Content-Type": "application/json"}}, method="POST",
    )
    start = time.time()
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            data = json.loads(resp.read().decode())
    except Exception as e:
        return {{"text": "", "error": str(e), "input_tokens": 0, "output_tokens": 0, "cost_usd": 0, "duration_ms": 0}}
    duration_ms = int((time.time() - start) * 1000)
    text = ""
    if data.get("candidates"):
        text = "".join(p.get("text", "") for p in data["candidates"][0].get("content", {{}}).get("parts", []))
    usage = data.get("usageMetadata", {{}})
    inp = usage.get("promptTokenCount", 0)
    out = usage.get("candidatesTokenCount", 0)
    return {{
        "text": text,
        "input_tokens": inp, "output_tokens": out,
        "total_tokens": inp + out,
        "cost_usd": (inp / 1e6) * PRICING_IN + (out / 1e6) * PRICING_OUT,
        "duration_ms": duration_ms,
    }}


# ── Domain rules (hard guardrails from the distilled spec) ──
DOMAIN_RULES = {domain_rules_list}
SUCCESS_CRITERIA = {success_criteria_list}


# ── Worker definitions ──
{workers_code}


# ── Tool stubs (mock mode — return structured responses based on tool name) ──
def call_tool(tool_name: str, args: dict, repo_context: dict) -> dict:
    """Mock tool dispatch. Production would route to real APIs.

    For MVP, returns deterministic stubs based on tool name + the repo_context
    (which includes the same policies/issues the expert saw).
    """
    tool_name_lower = tool_name.lower()
    ctx = repo_context or {{}}

    # Search-style tools return snippets from the injected context
    if any(k in tool_name_lower for k in ["search", "find", "lookup", "get_policy", "get_issue"]):
        return {{
            "tool": tool_name,
            "args": args,
            "result": f"[mock] Returned relevant records for {{args}} from the injected repo context.",
            "note": "MOCK MODE — in production, this would hit the live API specified by the user.",
        }}

    # Compute-style tools return a placeholder
    return {{
        "tool": tool_name,
        "args": args,
        "result": "[mock] Computation stub. Replace with live connector in production.",
    }}


# ── Orchestrator ──
ORCHESTRATOR_SYSTEM_PROMPT = {orchestrator_system_prompt!r}
ORCHESTRATOR_PLAN_PROMPT = {orchestrator_plan_prompt!r}


def run_orchestrator(query: str, repo_context: dict, api_key: str) -> dict:
    """Plan which workers to dispatch."""
    rules = "\\n".join(f"- {{r}}" for r in DOMAIN_RULES)
    criteria = "\\n".join(f"- {{c}}" for c in SUCCESS_CRITERIA)
    worker_list = "\\n".join(f"- {{w['name']}}: {{w['role']}}" for w in WORKERS)

    prompt = f\"\"\"{{ORCHESTRATOR_SYSTEM_PROMPT}}

DOMAIN RULES:
{{rules}}

SUCCESS CRITERIA:
{{criteria}}

AVAILABLE WORKERS:
{{worker_list}}

QUERY: {{query}}

REPO CONTEXT KEYS: {{list(repo_context.keys()) if repo_context else []}}

{{ORCHESTRATOR_PLAN_PROMPT}}

Return a JSON plan with this shape:
{{{{
  "workers_to_dispatch": ["<worker_name>", ...],
  "reasoning": "<one sentence>"
}}}}
\"\"\"
    return call_llm(prompt, api_key, temperature=0.1)


def parse_plan(text: str) -> list:
    """Extract the worker dispatch plan from orchestrator output."""
    import re as _re
    match = _re.search(r"\\{{[\\s\\S]*?\\}}", text)
    if not match:
        return [w["name"] for w in WORKERS]  # fallback: dispatch all
    try:
        plan = json.loads(match.group(0))
        return plan.get("workers_to_dispatch", [w["name"] for w in WORKERS])
    except Exception:
        return [w["name"] for w in WORKERS]


# ── Main entry point ──
def run_workflow(query: str, repo_context: dict, api_key: str) -> dict:
    """Execute the distilled workflow and return the final answer + telemetry."""
    total_cost = 0.0
    total_tokens = 0
    total_in = 0
    total_out = 0
    tool_calls = []
    worker_outputs = {{}}
    start = time.time()

    # 1. Orchestrator plans
    plan_result = run_orchestrator(query, repo_context, api_key)
    total_cost += plan_result["cost_usd"]
    total_tokens += plan_result["total_tokens"]
    total_in += plan_result["input_tokens"]
    total_out += plan_result["output_tokens"]
    workers_to_dispatch = parse_plan(plan_result["text"])

    # 2. Execute each worker
    for worker_name in workers_to_dispatch:
        worker = next((w for w in WORKERS if w["name"] == worker_name), None)
        if not worker:
            continue

        # Build worker prompt with scoped context + shared repo context
        rules = "\\n".join(f"- {{r}}" for r in DOMAIN_RULES)
        peer_outputs = "\\n".join(f"  {{n}}: {{str(o)[:300]}}" for n, o in worker_outputs.items())
        prompt = f\"\"\"{{worker["system_prompt"]}}

DOMAIN RULES:
{{rules}}

QUERY: {{query}}
REPO CONTEXT: {{json.dumps(repo_context)[:12000] if repo_context else ""}}

PEER WORKER OUTPUTS SO FAR:
{{peer_outputs}}

Execute your role. Be concise, specific, cite IDs/references explicitly.
\"\"\"
        result = call_llm(prompt, api_key, temperature=0.2, max_tokens=1200)
        total_cost += result["cost_usd"]
        total_tokens += result["total_tokens"]
        total_in += result["input_tokens"]
        total_out += result["output_tokens"]
        worker_outputs[worker_name] = result["text"]

        # Log any tool calls the worker would make (mock here)
        for tool_name in worker.get("tools", []):
            tool_calls.append({{"worker": worker_name, "tool": tool_name}})

    # 3. Formatter: assemble final answer
    rules = "\\n".join(f"- {{r}}" for r in DOMAIN_RULES)
    criteria = "\\n".join(f"- {{c}}" for c in SUCCESS_CRITERIA)
    all_outputs = "\\n\\n".join(f"## {{n}}\\n{{o}}" for n, o in worker_outputs.items())

    format_prompt = f\"\"\"You are assembling the final response to a store manager's query.

DOMAIN RULES:
{{rules}}

SUCCESS CRITERIA (the final response MUST satisfy these):
{{criteria}}

QUERY: {{query}}

WORKER OUTPUTS:
{{all_outputs}}

Synthesize a single, well-structured final response. Include:
- Issue ID reference (if relevant)
- Policy ID reference
- Numbered immediate actions
- Numbered follow-up actions
- Cross-store pattern (if any)
- Revenue/risk notes (if any)

FINAL RESPONSE:\"\"\"
    final = call_llm(format_prompt, api_key, temperature=0.2, max_tokens=1500)
    total_cost += final["cost_usd"]
    total_tokens += final["total_tokens"]
    total_in += final["input_tokens"]
    total_out += final["output_tokens"]

    duration_ms = int((time.time() - start) * 1000)

    return {{
        "final_answer": final["text"],
        "workers_dispatched": workers_to_dispatch,
        "worker_outputs": worker_outputs,
        "tool_calls": tool_calls,
        "input_tokens": total_in,
        "output_tokens": total_out,
        "total_tokens": total_tokens,
        "total_cost_usd": total_cost,
        "duration_ms": duration_ms,
    }}


if __name__ == "__main__":
    import os, sys as _sys
    from pathlib import Path as _Path
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        env = _Path("D:/VSCode Projects/cafecorner_nodebench/nodebench_ai4/nodebench-ai/.env.local")
        if env.exists():
            for line in env.read_text().splitlines():
                if line.startswith("GEMINI_API_KEY="):
                    api_key = line.split("=", 1)[1].strip().strip('"').strip("'"); break
    if not api_key:
        print("GEMINI_API_KEY required", file=_sys.stderr); _sys.exit(1)

    query = _sys.argv[1] if len(_sys.argv) > 1 else "Test query"
    result = run_workflow(query, {{}}, api_key)
    print(json.dumps({{
        "final_answer": result["final_answer"],
        "total_cost_usd": result["total_cost_usd"],
        "total_tokens": result["total_tokens"],
        "workers": result["workers_dispatched"],
    }}, indent=2))
'''


def sanitize_name(name: str) -> str:
    """Make a session_id safe for a Python module name."""
    return re.sub(r"[^a-z0-9_]", "_", name.lower())


def generate_scaffold(spec: WorkflowSpec) -> Path:
    """Emit a single Python module implementing the WorkflowSpec."""
    # Pricing lookup
    pricing = {
        "gemini-3.1-flash-lite-preview": (0.075, 0.30),
        "gemini-2.5-flash-lite":         (0.10, 0.40),
        "gemini-3.1-pro-preview":        (1.25, 5.00),
    }
    pricing_in, pricing_out = pricing.get(spec.executor_model, (0.075, 0.30))

    # Build WORKERS constant as Python list of dicts
    workers_data = []
    for w in spec.workers:
        wd = w if isinstance(w, dict) else {
            "name": w.name, "role": w.role,
            "system_prompt": w.system_prompt,
            "tools": w.tools,
        }
        # Ensure required fields exist
        wd.setdefault("name", "unnamed_worker")
        wd.setdefault("role", "worker")
        wd.setdefault("system_prompt", "You are a helpful worker.")
        wd.setdefault("tools", [])
        workers_data.append({
            "name": wd["name"],
            "role": wd["role"],
            "system_prompt": wd["system_prompt"],
            "tools": wd.get("tools", []),
        })

    workers_code = "WORKERS = " + json.dumps(workers_data, indent=4)
    domain_rules_list = json.dumps(spec.domain_rules or [])
    success_criteria_list = json.dumps(spec.success_criteria or [])

    code = SCAFFOLD_TEMPLATE.format(
        source_trace_id=spec.source_trace_id,
        executor_model=spec.executor_model,
        worker_count=len(workers_data),
        tool_count=len(spec.tools),
        pricing_in=pricing_in,
        pricing_out=pricing_out,
        orchestrator_system_prompt=spec.orchestrator_system_prompt or "You are a planning orchestrator.",
        orchestrator_plan_prompt=spec.orchestrator_plan_prompt or "Plan which workers to dispatch.",
        workers_code=workers_code,
        domain_rules_list=domain_rules_list,
        success_criteria_list=success_criteria_list,
    )

    module_name = f"workflow_{sanitize_name(spec.source_trace_id)}.py"
    out_path = SCAFFOLDS / module_name
    out_path.write_text(code, encoding="utf-8")
    return out_path


def main():
    specs_path = RESULTS / "workflow_specs.json"
    if not specs_path.exists():
        print(f"ERROR: run distill.py first. Missing {specs_path}", file=sys.stderr)
        sys.exit(1)

    raw_specs = json.loads(specs_path.read_text(encoding="utf-8"))
    paths = []
    for raw in raw_specs:
        # Reconstruct dataclass objects
        workers = [Worker(**w) for w in raw.get("workers", [])]
        from schemas import ToolDef, HandoffRule
        tools = [ToolDef(**t) for t in raw.get("tools", [])]
        handoffs = [HandoffRule(**h) for h in raw.get("handoffs", [])]
        spec = WorkflowSpec(
            source_trace_id=raw["source_trace_id"],
            executor_model=raw.get("executor_model", "gemini-3.1-flash-lite-preview"),
            orchestrator_system_prompt=raw.get("orchestrator_system_prompt", ""),
            orchestrator_plan_prompt=raw.get("orchestrator_plan_prompt", ""),
            workers=workers,
            tools=tools,
            handoffs=handoffs,
            success_criteria=raw.get("success_criteria", []),
            domain_rules=raw.get("domain_rules", []),
            target_sdk=raw.get("target_sdk", "google-genai"),
        )
        path = generate_scaffold(spec)
        paths.append(path)
        print(f"[gen] {spec.source_trace_id} -> {path.name}")

    print(f"\nGenerated {len(paths)} scaffolds in {SCAFFOLDS}")


if __name__ == "__main__":
    main()
