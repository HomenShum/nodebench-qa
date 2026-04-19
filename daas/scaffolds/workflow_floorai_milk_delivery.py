"""Auto-generated scaffold from WorkflowSpec.

Source trace: floorai_milk_delivery
Executor model: gemini-3.1-flash-lite-preview
Workers: 3
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
DOMAIN_RULES = ["Missed vendor deliveries must trigger a requirement to contact the vendor representative within 24 hours.", "Systemic cross-store issues must be escalated to the Regional Manager with backup supplier options and contract penalty clauses.", "Vendor performance issues require compiling 30-day reliability metrics and issuing a formal notification for a corrective action plan within 15 days.", "All revenue impacts must be aggregated across all affected stores when a cross-store pattern is detected."]
SUCCESS_CRITERIA = ["Response includes a 'Cross-Store Pattern & Revenue Impact' section that names the vendor, SKU, missed dates, and quantifies total revenue impact.", "Response includes an 'Immediate Actions' numbered list with at least 3 items.", "Response includes a 'Follow-Up Actions' numbered list with at least 3 items.", "Every action item explicitly cites a relevant Policy ID (e.g., POL-INV-003) or Issue ID (e.g., ISS-018) in parentheses.", "Response identifies a specific escalation contact (e.g., Regional Manager) by name."]


# ── Worker definitions ──
WORKERS = [
    {
        "name": "IssueAnalyzer",
        "role": "Issue and Pattern Investigator",
        "system_prompt": "You are responsible for finding specific store issues, identifying the affected SKUs/vendors, and determining if the issue is a systemic cross-store pattern. You must calculate or retrieve the estimated revenue impact across all affected locations.",
        "tools": [
            "search_issues",
            "analyze_cross_store_impact"
        ]
    },
    {
        "name": "PolicySpecialist",
        "role": "Policy and Contract Expert",
        "system_prompt": "You are responsible for retrieving standard operating procedures (SOPs) related to inventory shortages and vendor management. You also look up vendor contract details, penalty clauses, backup suppliers, and relevant escalation contacts (e.g., Regional Managers).",
        "tools": [
            "search_policies",
            "get_vendor_contract_details",
            "get_personnel_directory"
        ]
    },
    {
        "name": "ActionPlanner",
        "role": "Remediation Strategist",
        "system_prompt": "You are responsible for taking issue data and policy requirements to formulate a concrete action plan. You must divide actions into 'Immediate Actions' (containment, escalation, documentation) and 'Follow-Up Actions' (metrics compilation, formal notifications, customer comms). Every action must cite the relevant Policy ID or Issue ID.",
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
ORCHESTRATOR_SYSTEM_PROMPT = "You are the lead retail operations orchestrator. Your objective is to investigate operational queries by coordinating specialist agents to gather issue details, assess cross-store impact, retrieve relevant policies, and formulate actionable plans. You must synthesize the final output into three strict sections: 'Cross-Store Pattern & Revenue Impact', 'Immediate Actions (Right Now)', and 'Follow-Up Actions (Today / This Week)'. Ensure all claims cite specific Issue IDs and Policy IDs."
ORCHESTRATOR_PLAN_PROMPT = "Analyze the user's query. First, dispatch the IssueAnalyzer to identify the core problem, affected SKUs, and cross-store revenue impact. Second, dispatch the PolicySpecialist to retrieve relevant inventory/vendor policies, contract penalty clauses, and key personnel. Finally, dispatch the ActionPlanner to generate a prioritized list of immediate and follow-up actions based on the gathered data."


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
