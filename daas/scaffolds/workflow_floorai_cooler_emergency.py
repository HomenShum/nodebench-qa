"""Auto-generated scaffold from WorkflowSpec.

Source trace: floorai_cooler_emergency
Executor model: gemini-3.1-flash-lite-preview
Workers: 3
Tools: 4

DO NOT EDIT — regenerate via `python daas/generate.py`.
"""

import json
import time
import urllib.request

EXECUTOR_MODEL = "gemini-3.1-flash-lite-preview"
PRICING_IN = 0.075   # $ per 1M input tokens
PRICING_OUT = 0.3  # $ per 1M output tokens


def call_llm(prompt: str, api_key: str, temperature: float = 0.2, max_tokens: int = 1500) -> dict:
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{EXECUTOR_MODEL}:generateContent?key={api_key}"
    body = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {"temperature": temperature, "maxOutputTokens": max_tokens},
    }
    req = urllib.request.Request(
        url, data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json"}, method="POST",
    )
    start = time.time()
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            data = json.loads(resp.read().decode())
    except Exception as e:
        return {"text": "", "error": str(e), "input_tokens": 0, "output_tokens": 0, "cost_usd": 0, "duration_ms": 0}
    duration_ms = int((time.time() - start) * 1000)
    text = ""
    if data.get("candidates"):
        text = "".join(p.get("text", "") for p in data["candidates"][0].get("content", {}).get("parts", []))
    usage = data.get("usageMetadata", {})
    inp = usage.get("promptTokenCount", 0)
    out = usage.get("candidatesTokenCount", 0)
    return {
        "text": text,
        "input_tokens": inp, "output_tokens": out,
        "total_tokens": inp + out,
        "cost_usd": (inp / 1e6) * PRICING_IN + (out / 1e6) * PRICING_OUT,
        "duration_ms": duration_ms,
    }


# ── Domain rules (hard guardrails from the distilled spec) ──
DOMAIN_RULES = ["Any cold-holding temperature exceeding 41 degrees Fahrenheit requires immediate product evaluation and discarding of unsafe perishables.", "Emergency equipment failures require immediate vendor contact; if the primary vendor is unavailable, emergency vendor authorization must be requested.", "All discarded inventory must be explicitly documented for shrinkage and loss reporting."]
SUCCESS_CRITERIA = ["Response includes a specific Reference Issue ID matching the format ISS-XXX.", "Response includes a specific Reference Policy ID matching the format POL-XXX.", "Response contains a numbered list titled 'Immediate Actions' with at least 2 items.", "Response contains a numbered list titled 'Follow-up Actions' with at least 1 item.", "Response explicitly states a dollar amount for Revenue Impact.", "Response explicitly states whether there are cross-store patterns or if the incident is isolated."]


# ── Worker definitions ──
WORKERS = [
    {
        "name": "Information_Retriever",
        "role": "Context Gatherer",
        "system_prompt": "You are responsible for finding active issues and standard operating policies related to the user's query. Extract the exact Issue ID, Policy ID, and critical context (e.g., current temperature, vendor availability).",
        "tools": [
            "search_active_issues",
            "search_policies"
        ]
    },
    {
        "name": "Action_Planner",
        "role": "Safety & Operations Planner",
        "system_prompt": "You are a safety and operations expert. Using the provided issue details and policy text, formulate a numbered list of 'Immediate Actions' (prioritizing containment and food safety) and 'Follow-up Actions' (vendor coordination, documentation). Adhere strictly to temperature thresholds and safety rules.",
        "tools": []
    },
    {
        "name": "Impact_Analyzer",
        "role": "Business Analyst",
        "system_prompt": "You analyze the business impact of store issues. Calculate the financial value of inventory at risk for the specific issue, and check historical/system-wide data to determine if this is an isolated incident or a cross-store pattern.",
        "tools": [
            "calculate_revenue_impact",
            "check_cross_store_patterns"
        ]
    }
]


# ── Tool stubs (mock mode — return structured responses based on tool name) ──
def call_tool(tool_name: str, args: dict, repo_context: dict) -> dict:
    """Mock tool dispatch. Production would route to real APIs.

    For MVP, returns deterministic stubs based on tool name + the repo_context
    (which includes the same policies/issues the expert saw).
    """
    tool_name_lower = tool_name.lower()
    ctx = repo_context or {}

    # Search-style tools return snippets from the injected context
    if any(k in tool_name_lower for k in ["search", "find", "lookup", "get_policy", "get_issue"]):
        return {
            "tool": tool_name,
            "args": args,
            "result": f"[mock] Returned relevant records for {args} from the injected repo context.",
            "note": "MOCK MODE — in production, this would hit the live API specified by the user.",
        }

    # Compute-style tools return a placeholder
    return {
        "tool": tool_name,
        "args": args,
        "result": "[mock] Computation stub. Replace with live connector in production.",
    }


# ── Orchestrator ──
ORCHESTRATOR_SYSTEM_PROMPT = "You are the Store Operations Orchestrator. Your objective is to coordinate the response to store operational and safety queries. You must dispatch specialized workers to retrieve relevant issue tickets, identify applicable policies, formulate safety-compliant action plans, and analyze business impact. Synthesize the workers' findings into a highly structured final report with specific sections for Issue ID, Policy ID, Immediate Actions, Follow-up Actions, and Cross-Store Patterns & Revenue Impact."
ORCHESTRATOR_PLAN_PROMPT = "Analyze the user's query. Step 1: Dispatch the Information_Retriever to find matching active Issue IDs and Policy IDs for the given store. Step 2: Dispatch the Action_Planner, providing it with the retrieved policy and issue details, to generate Immediate and Follow-up actions. Step 3: Dispatch the Impact_Analyzer to determine revenue at risk and check for cross-store patterns. Step 4: Compile the final response using the exact formatting required by the success criteria."


def run_orchestrator(query: str, repo_context: dict, api_key: str) -> dict:
    """Plan which workers to dispatch."""
    rules = "\n".join(f"- {r}" for r in DOMAIN_RULES)
    criteria = "\n".join(f"- {c}" for c in SUCCESS_CRITERIA)
    worker_list = "\n".join(f"- {w['name']}: {w['role']}" for w in WORKERS)

    prompt = f"""{ORCHESTRATOR_SYSTEM_PROMPT}

DOMAIN RULES:
{rules}

SUCCESS CRITERIA:
{criteria}

AVAILABLE WORKERS:
{worker_list}

QUERY: {query}

REPO CONTEXT KEYS: {list(repo_context.keys()) if repo_context else []}

{ORCHESTRATOR_PLAN_PROMPT}

Return a JSON plan with this shape:
{{
  "workers_to_dispatch": ["<worker_name>", ...],
  "reasoning": "<one sentence>"
}}
"""
    return call_llm(prompt, api_key, temperature=0.1)


def parse_plan(text: str) -> list:
    """Extract the worker dispatch plan from orchestrator output."""
    import re as _re
    match = _re.search(r"\{[\s\S]*?\}", text)
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
    worker_outputs = {}
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
        rules = "\n".join(f"- {r}" for r in DOMAIN_RULES)
        peer_outputs = "\n".join(f"  {n}: {str(o)[:300]}" for n, o in worker_outputs.items())
        prompt = f"""{worker["system_prompt"]}

DOMAIN RULES:
{rules}

QUERY: {query}
REPO CONTEXT: {json.dumps(repo_context)[:12000] if repo_context else ""}

PEER WORKER OUTPUTS SO FAR:
{peer_outputs}

Execute your role. Be concise, specific, cite IDs/references explicitly.
"""
        result = call_llm(prompt, api_key, temperature=0.2, max_tokens=1200)
        total_cost += result["cost_usd"]
        total_tokens += result["total_tokens"]
        total_in += result["input_tokens"]
        total_out += result["output_tokens"]
        worker_outputs[worker_name] = result["text"]

        # Log any tool calls the worker would make (mock here)
        for tool_name in worker.get("tools", []):
            tool_calls.append({"worker": worker_name, "tool": tool_name})

    # 3. Formatter: assemble final answer
    rules = "\n".join(f"- {r}" for r in DOMAIN_RULES)
    criteria = "\n".join(f"- {c}" for c in SUCCESS_CRITERIA)
    all_outputs = "\n\n".join(f"## {n}\n{o}" for n, o in worker_outputs.items())

    format_prompt = f"""You are assembling the final response to a store manager's query.

DOMAIN RULES:
{rules}

SUCCESS CRITERIA (the final response MUST satisfy these):
{criteria}

QUERY: {query}

WORKER OUTPUTS:
{all_outputs}

Synthesize a single, well-structured final response. Include:
- Issue ID reference (if relevant)
- Policy ID reference
- Numbered immediate actions
- Numbered follow-up actions
- Cross-store pattern (if any)
- Revenue/risk notes (if any)

FINAL RESPONSE:"""
    final = call_llm(format_prompt, api_key, temperature=0.2, max_tokens=1500)
    total_cost += final["cost_usd"]
    total_tokens += final["total_tokens"]
    total_in += final["input_tokens"]
    total_out += final["output_tokens"]

    duration_ms = int((time.time() - start) * 1000)

    return {
        "final_answer": final["text"],
        "workers_dispatched": workers_to_dispatch,
        "worker_outputs": worker_outputs,
        "tool_calls": tool_calls,
        "input_tokens": total_in,
        "output_tokens": total_out,
        "total_tokens": total_tokens,
        "total_cost_usd": total_cost,
        "duration_ms": duration_ms,
    }


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
    result = run_workflow(query, {}, api_key)
    print(json.dumps({
        "final_answer": result["final_answer"],
        "total_cost_usd": result["total_cost_usd"],
        "total_tokens": result["total_tokens"],
        "workers": result["workers_dispatched"],
    }, indent=2))
