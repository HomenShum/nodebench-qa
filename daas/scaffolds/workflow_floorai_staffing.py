"""Auto-generated scaffold from WorkflowSpec.

Source trace: floorai_staffing
Executor model: gemini-3.1-flash-lite-preview
Workers: 4
Tools: 5

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
DOMAIN_RULES = ["Staffing shortages exceeding 30% of the scheduled shift must trigger emergency protocols (e.g., overtime approval).", "Internal coverage from neighboring stores must be sought before contacting external temp agencies.", "All recommended actions must be strictly grounded in retrieved policies and active store issues.", "Revenue impact must be estimated and stated for any staffing shortage issue."]
SUCCESS_CRITERIA = ["Response explicitly lists 'Issue Reference' and 'Applicable Policy' IDs at the top.", "Response contains distinct 'Immediate Actions' and 'Follow-up Actions' sections with numbered lists.", "Every recommended action explicitly cites a supporting Policy ID or Issue ID in parentheses.", "Response includes a calculated staffing shortage percentage and references a specific policy threshold.", "Response includes a 'Revenue Impact & Cross-Store Patterns' section detailing a specific dollar amount and regional trends."]


# ── Worker definitions ──
WORKERS = [
    {
        "name": "Policy_Issue_Retriever",
        "role": "Context Gatherer",
        "system_prompt": "You are responsible for finding relevant HR/operational policies and active store issues based on the user's query. Extract policy IDs, issue IDs, and key protocol details (e.g., emergency staffing thresholds).",
        "tools": [
            "search_policies",
            "get_store_issues"
        ]
    },
    {
        "name": "Staffing_Impact_Calculator",
        "role": "Data Analyst",
        "system_prompt": "You calculate staffing metrics (e.g., shortage percentages based on scheduled vs. called-out staff), evaluate them against policy thresholds, and estimate the financial/revenue impact of the specific issue.",
        "tools": [
            "calculate_staffing_metrics",
            "estimate_revenue_impact"
        ]
    },
    {
        "name": "Regional_Analyzer",
        "role": "Pattern Investigator",
        "system_prompt": "You analyze cross-store and regional data to identify broader trends, compounding factors (like system outages or seasonal pushes), and historical data that contextualize the local store's issue.",
        "tools": [
            "get_regional_patterns"
        ]
    },
    {
        "name": "Action_Planner",
        "role": "Strategy Formulator",
        "system_prompt": "You take policies, active issues, calculated impacts, and regional patterns to formulate a prioritized list of Immediate Actions (Right Now) and Follow-up Actions (Today / This Week). Ensure every action cites a specific Policy ID or Issue ID.",
        "tools": []
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
ORCHESTRATOR_SYSTEM_PROMPT = 'You are the lead store operations orchestrator. Your role is to analyze store manager queries, determine the necessary context (policies, active issues, staffing metrics, regional patterns), and dispatch specialist agents to gather this information. Once all specialists have completed their tasks, synthesize their findings into a structured, actionable response containing Issue References, Applicable Policies, Immediate Actions, Follow-up Actions, and Revenue/Regional Impacts.'
ORCHESTRATOR_PLAN_PROMPT = "Analyze the user's query about staffing shortages. Dispatch the Policy_Issue_Retriever to identify relevant HR policies and active store issues. Then, route the gathered data to the Staffing_Impact_Calculator to compute shortage percentages and revenue impact. Next, send the context to the Regional_Analyzer to find compounding cross-store patterns. Finally, route all data to the Action_Planner to formulate step-by-step immediate and follow-up actions before returning the final synthesis to the user."


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
