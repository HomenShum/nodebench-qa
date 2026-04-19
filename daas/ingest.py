"""Trace ingestion — capture expensive model runs as CanonicalTrace.

For this MVP we run fresh FloorAI-style queries through Gemini Pro directly,
capturing the FULL trace (query, response, token counts, cost). In production,
this data comes from:
  - attrition push-packet from production agents (e.g. FloorAI's Convex action)
  - Claude Code MCP plugin hooks
  - Raw JSONL uploads

The output is a list of CanonicalTrace objects stored as JSON files.
"""

import json
import os
import sys
import time
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from schemas import CanonicalTrace, TraceStep  # noqa: E402

RESULTS = Path(__file__).parent / "results"
RESULTS.mkdir(parents=True, exist_ok=True)

PRO_MODEL = "gemini-3.1-pro-preview"
PRICING = {  # per 1M tokens (input, output)
    "gemini-3.1-pro-preview":        (1.25, 5.00),
    "gemini-3.1-flash-lite-preview": (0.075, 0.30),
    "gemini-2.5-flash-lite":         (0.10, 0.40),
}


def call_gemini(model: str, prompt: str, api_key: str, temperature: float = 0.2, max_tokens: int = 2500) -> dict:
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={api_key}"
    body = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {"temperature": temperature, "maxOutputTokens": max_tokens},
    }
    req = urllib.request.Request(url, data=json.dumps(body).encode(),
                                 headers={"Content-Type": "application/json"}, method="POST")
    start = time.time()
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            data = json.loads(resp.read().decode())
    except Exception as e:
        return {"model": model, "text": "", "error": str(e), "input_tokens": 0, "output_tokens": 0, "cost_usd": 0, "duration_ms": 0}
    duration_ms = int((time.time() - start) * 1000)
    text = ""
    if data.get("candidates"):
        text = "".join(p.get("text", "") for p in data["candidates"][0].get("content", {}).get("parts", []))
    usage = data.get("usageMetadata", {})
    inp = usage.get("promptTokenCount", 0)
    out = usage.get("candidatesTokenCount", 0)
    rin, rout = PRICING.get(model, (1.25, 5.00))
    return {
        "model": model, "text": text,
        "input_tokens": inp, "output_tokens": out,
        "total_tokens": inp + out,
        "cost_usd": (inp/1e6)*rin + (out/1e6)*rout,
        "duration_ms": duration_ms,
    }


def load_floorai_context() -> dict:
    """Load policies and issues from FloorAI repo (same data the production agent uses)."""
    floorai = Path("D:/VSCode Projects/cafecorner_nodebench/floorai/data")
    ctx = {}
    policies_path = floorai / "policies.json"
    issues_path = floorai / "synthetic_issues.csv"
    if policies_path.exists():
        ctx["policies"] = json.loads(policies_path.read_text(encoding="utf-8"))
    if issues_path.exists():
        ctx["issues_csv"] = issues_path.read_text(encoding="utf-8")
    return ctx


def build_floorai_prompt(query: str, ctx: dict) -> str:
    """Build the same kind of prompt FloorAI sends to Gemini Pro."""
    policies_summary = ""
    for p in ctx.get("policies", [])[:15]:
        policies_summary += f"  {p.get('policyId','?')} [{p.get('category','?')}]: {p.get('title','')}: {str(p.get('content',''))[:240]}\n"
    issues_sample = "\n".join(ctx.get("issues_csv", "").split("\n")[:50])

    return f"""You are a retail operations assistant for a multi-store grocery chain.

Using the context brief below, answer the manager's query with:
1. Reference the specific issue ID (e.g. ISS-001) if relevant
2. Reference the specific policy ID (e.g. POL-INV-003) that applies
3. Numbered immediate actions (what to do RIGHT NOW)
4. Numbered follow-up actions (today / this week)
5. Any cross-store patterns or revenue impact

Be concise, specific, cite every factual claim.

CONTEXT BRIEF:
POLICIES:
{policies_summary}

ISSUES (CSV sample):
{issues_sample}

QUERY: {query}

RESPONSE:"""


def ingest_fresh_floorai(api_key: str) -> list:
    """Run 3 FloorAI queries through Pro and capture full traces."""
    queries = [
        ("floorai_milk_delivery", "STR-101", "What's happening with our milk delivery?"),
        ("floorai_staffing", "STR-103", "We're short-staffed today, 3 people called out. What should I do?"),
        ("floorai_cooler_emergency", "STR-104", "Our walk-in cooler is at 52 degrees, what do I do?"),
    ]
    ctx = load_floorai_context()
    traces = []
    for session_id, store_id, query in queries:
        print(f"Running Pro for {session_id}: {query[:50]}...")
        prompt = build_floorai_prompt(query, ctx)
        result = call_gemini(PRO_MODEL, prompt, api_key)
        if result.get("error"):
            print(f"  ERROR: {result['error']}")
            continue

        trace = CanonicalTrace(
            session_id=session_id,
            source_model=PRO_MODEL,
            query=query,
            final_answer=result["text"],
            total_cost_usd=result["cost_usd"],
            total_tokens=result["total_tokens"],
            duration_ms=result["duration_ms"],
            repo_context={
                "url": "https://github.com/HomenShum/floorai",
                "store_id": store_id,
                "context_hash": f"len_policies={len(ctx.get('policies',[]))},len_issues={len(ctx.get('issues_csv',''))}",
            },
            steps=[TraceStep(
                role="assistant",
                model=PRO_MODEL,
                content=result["text"],
                input_tokens=result["input_tokens"],
                output_tokens=result["output_tokens"],
                duration_ms=result["duration_ms"],
            )],
        )
        traces.append(trace)
        print(f"  OK: {result['total_tokens']} tok, ${result['cost_usd']:.6f}")

    # Persist
    out = RESULTS / "canonical_traces.json"
    out.write_text(json.dumps([t.to_dict() for t in traces], indent=2), encoding="utf-8")
    print(f"\nWrote {len(traces)} traces to {out}")
    return traces


def main():
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        env = Path("D:/VSCode Projects/cafecorner_nodebench/nodebench_ai4/nodebench-ai/.env.local")
        if env.exists():
            for line in env.read_text().splitlines():
                if line.startswith("GEMINI_API_KEY="):
                    api_key = line.split("=", 1)[1].strip().strip('"').strip("'")
                    break
    if not api_key:
        print("ERROR: GEMINI_API_KEY required", file=sys.stderr)
        sys.exit(1)

    ingest_fresh_floorai(api_key)


if __name__ == "__main__":
    main()
