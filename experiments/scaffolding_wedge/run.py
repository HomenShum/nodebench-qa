#!/usr/bin/env python3
"""Scaffolding Wedge Experiment — does distilled reasoning transfer from Pro to Flash?

FIRST PRINCIPLE:
  Less capable models need more scaffolding than more capable models
  (per Dive-into-Claude-Code architecture analysis).

HYPOTHESIS:
  If we distill the reasoning steps from a Pro response into a structured
  skill prompt, and inject that into Flash's context, then:
    Flash + skill quality >= 80% of Pro quality  @  < 40% of Pro cost

If true: attrition's distillation wedge is real.
If false: distillation is prompt stuffing, not reasoning transfer.

EXPERIMENT:
  3 queries of increasing complexity (from FloorAI golden dataset):
    EVAL-001 (simple lookup: milk delivery status)
    EVAL-002 (medium: staffing shortage action plan)
    EVAL-003 (complex: food safety emergency protocol)

  For each query, 3 configurations:
    A. Flash alone (cheap baseline)
    B. Pro alone (expensive ceiling)
    C. Flash + distilled skill (the experiment)

  Judge each response (Pro, structured rubric on factual_alignment,
  policy_grounding, actionability, overall_score).

  Measure: tokens, cost, quality score.

Usage:
    python run.py
    python run.py --skip-if-exists  # reuse previous runs if present

Outputs:
    results/raw_responses.json    — all 9 responses with metadata
    results/judgments.json        — judge scores for all 9
    results/report.html           — visual side-by-side + charts
"""

import argparse
import json
import os
import sys
import time
import urllib.request
from pathlib import Path
from datetime import datetime, timezone

# ── Config ──────────────────────────────────────────────────────────

FLOORAI_DIR = Path("D:/VSCode Projects/cafecorner_nodebench/floorai")
RESULTS_DIR = Path(__file__).parent / "results"
RESULTS_DIR.mkdir(parents=True, exist_ok=True)

MODELS = {
    "flash": "gemini-3.1-flash-lite-preview",
    "pro":   "gemini-3.1-pro-preview",
}

PRICING = {  # per 1M tokens (input, output)
    "gemini-3.1-flash-lite-preview": (0.075, 0.30),
    "gemini-3.1-pro-preview":        (1.25,  5.00),
}

# Pick 3 queries of increasing complexity
TARGET_CASES = ["EVAL-001", "EVAL-002", "EVAL-003"]

# ── Gemini API ──────────────────────────────────────────────────────

def call_gemini(model: str, prompt: str, api_key: str, temperature: float = 0.2) -> dict:
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={api_key}"
    body = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {
            "temperature": temperature,
            "maxOutputTokens": 3000,
        },
    }
    req = urllib.request.Request(
        url,
        data=json.dumps(body).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    start = time.time()
    with urllib.request.urlopen(req, timeout=120) as resp:
        data = json.loads(resp.read().decode())
    latency_ms = int((time.time() - start) * 1000)

    text = ""
    if data.get("candidates"):
        parts = data["candidates"][0].get("content", {}).get("parts", [])
        text = "".join(p.get("text", "") for p in parts)

    usage = data.get("usageMetadata", {})
    inp = usage.get("promptTokenCount", 0)
    out = usage.get("candidatesTokenCount", 0)
    rate_in, rate_out = PRICING.get(model, (1.25, 5.00))
    cost = (inp / 1_000_000) * rate_in + (out / 1_000_000) * rate_out

    return {
        "model": model,
        "text": text,
        "input_tokens": inp,
        "output_tokens": out,
        "total_tokens": inp + out,
        "cost_usd": cost,
        "latency_ms": latency_ms,
    }


# ── Context builder ─────────────────────────────────────────────────

def load_floorai_context():
    """Load the deterministic retail-ops context (issues, policies, resolutions)."""
    context = {}
    for name in ["synthetic_issues.csv", "policies.json"]:
        fp = FLOORAI_DIR / "data" / name
        if fp.exists():
            if name.endswith(".csv"):
                context[name] = fp.read_text(encoding="utf-8", errors="ignore")
            else:
                context[name] = json.loads(fp.read_text(encoding="utf-8", errors="ignore"))
    return context


def build_context_brief(case: dict, context: dict) -> str:
    """Deterministic context brief — same for all 3 model configurations."""
    lines = ["RETAIL OPS CONTEXT BRIEF", "=" * 40]
    lines.append(f"Store: {case.get('storeId', 'unknown')}")
    lines.append(f"Query: {case.get('query', '')}")
    lines.append("")
    lines.append("AVAILABLE ISSUES (CSV):")
    issues_csv = context.get("synthetic_issues.csv", "")
    # Take first 60 lines for context
    lines.append("\n".join(issues_csv.split("\n")[:60]))
    lines.append("")
    lines.append("POLICIES:")
    policies = context.get("policies.json", [])
    for p in policies[:15]:
        lines.append(f"  {p.get('policyId','?')} [{p.get('category','?')}]: {p.get('title','')}")
        lines.append(f"    {str(p.get('content',''))[:300]}")
    lines.append("")
    return "\n".join(lines)


# ── Prompts: the core experiment ────────────────────────────────────

BASE_INSTRUCTION = """You are a retail operations assistant helping a store manager.

Using the context brief below, answer the query with:
1. Reference to the specific issue ID (e.g. ISS-001) if relevant
2. Reference to the specific policy ID (e.g. POL-INV-003) that applies
3. Numbered immediate actions (what to do RIGHT NOW)
4. Numbered follow-up actions (what to do today/this week)
5. Any cross-store patterns or revenue impact

Be concise and specific. Cite every factual claim.

CONTEXT BRIEF:
{brief}

QUERY: {query}

RESPONSE:"""


DISTILL_INSTRUCTION = """You are extracting a reusable REASONING SKILL from an expert retail-ops response.

Given the expert's response below, produce a structured skill template that a
less-capable model could follow to reproduce this reasoning on similar queries.

The skill template should include:
- TRIGGER: when this skill applies (query patterns)
- CONTEXT CHECKS: what to look up in the context (specific IDs, categories, patterns)
- REASONING STEPS: numbered steps the expert implicitly followed
- OUTPUT STRUCTURE: exact sections and format of the final response
- DOMAIN RULES: any hard rules the expert applied (e.g. "food safety requires X")

Return ONLY the skill template in markdown. No preamble.

EXPERT QUERY: {query}

EXPERT RESPONSE:
{expert_response}

SKILL TEMPLATE:"""


SCAFFOLDED_INSTRUCTION = """You are a retail operations assistant. Apply the REASONING SKILL below exactly as specified, using the context brief to ground every claim.

REASONING SKILL:
{skill}

CONTEXT BRIEF:
{brief}

QUERY: {query}

Apply the skill's reasoning steps in order. Use the exact output structure. Cite specific IDs. RESPONSE:"""


# ── Judge ───────────────────────────────────────────────────────────

JUDGE_PROMPT = """You are an expert judge evaluating a retail-ops assistant's response.

QUERY: {query}
REQUIRED REFERENCES: {refs}

RESPONSE TO JUDGE:
{response}

Score on 4 criteria (0-10 each):
1. factual_alignment: Does it cite real issue IDs, policy IDs, and facts?
2. policy_grounding: Does it reference the correct policy and explain it?
3. actionability: Are actions specific, numbered, and executable?
4. completeness: Does it cover immediate + follow-up + cross-store + risk?

Also compute:
- references_found: which required references appear verbatim in response
- references_missing: required references NOT found

Return ONLY valid JSON:
{{"factual_alignment": N, "policy_grounding": N, "actionability": N, "completeness": N, "overall_score": AVG, "references_found": [...], "references_missing": [...], "verdict": "pass|partial|fail", "rationale": "one sentence"}}"""


def judge_response(query: str, required_refs: list, response_text: str, api_key: str) -> dict:
    prompt = JUDGE_PROMPT.format(
        query=query,
        refs=required_refs,
        response=response_text[:4000],
    )
    result = call_gemini(MODELS["pro"], prompt, api_key, temperature=0.0)
    text = result["text"]
    # Extract JSON
    import re
    match = re.search(r"\{[\s\S]*\}", text)
    if not match:
        return {"error": "no_json", "raw": text[:300], "overall_score": 0}
    try:
        verdict = json.loads(match.group(0))
        verdict["_judge_cost_usd"] = result["cost_usd"]
        verdict["_judge_tokens"] = result["total_tokens"]
        return verdict
    except Exception as e:
        return {"error": str(e), "raw": text[:300], "overall_score": 0}


# ── Experiment runner ───────────────────────────────────────────────

def run_experiment(api_key: str, skip_if_exists: bool = False):
    # Load dataset
    with open(FLOORAI_DIR / "data" / "golden_dataset.json") as f:
        dataset = json.load(f)

    cases = [c for c in dataset if c["id"] in TARGET_CASES]
    assert len(cases) == 3, f"Expected 3 cases, got {len(cases)}"

    context = load_floorai_context()
    raw_path = RESULTS_DIR / "raw_responses.json"

    if skip_if_exists and raw_path.exists():
        print(f"Loading existing results from {raw_path}")
        with open(raw_path) as f:
            runs = json.load(f)
    else:
        runs = []
        for case in cases:
            print(f"\n{'='*60}")
            print(f"Case {case['id']}: {case['query'][:60]}")
            print(f"{'='*60}")

            brief = build_context_brief(case, context)

            # ─── A. Flash alone ───
            print("  [A] Flash alone...", end=" ", flush=True)
            prompt_a = BASE_INSTRUCTION.format(brief=brief, query=case["query"])
            result_a = call_gemini(MODELS["flash"], prompt_a, api_key)
            print(f"{result_a['total_tokens']} tok, ${result_a['cost_usd']:.6f}, {result_a['latency_ms']}ms")

            # ─── B. Pro alone ───
            print("  [B] Pro alone...", end=" ", flush=True)
            prompt_b = BASE_INSTRUCTION.format(brief=brief, query=case["query"])
            result_b = call_gemini(MODELS["pro"], prompt_b, api_key)
            print(f"{result_b['total_tokens']} tok, ${result_b['cost_usd']:.6f}, {result_b['latency_ms']}ms")

            # ─── Distill Pro's response into a skill ───
            print("  [distill] Extracting skill from Pro...", end=" ", flush=True)
            distill_prompt = DISTILL_INSTRUCTION.format(
                query=case["query"],
                expert_response=result_b["text"][:4000],
            )
            distill_result = call_gemini(MODELS["pro"], distill_prompt, api_key, temperature=0.0)
            skill_text = distill_result["text"].strip()
            print(f"{distill_result['total_tokens']} tok, ${distill_result['cost_usd']:.6f}")

            # ─── C. Flash + distilled skill ───
            print("  [C] Flash + skill...", end=" ", flush=True)
            prompt_c = SCAFFOLDED_INSTRUCTION.format(
                skill=skill_text,
                brief=brief,
                query=case["query"],
            )
            result_c = call_gemini(MODELS["flash"], prompt_c, api_key)
            print(f"{result_c['total_tokens']} tok, ${result_c['cost_usd']:.6f}, {result_c['latency_ms']}ms")

            runs.append({
                "case_id": case["id"],
                "query": case["query"],
                "store_id": case.get("storeId"),
                "required_references": case.get("required_references", []),
                "flash_alone": result_a,
                "pro_alone": result_b,
                "distilled_skill": {
                    "text": skill_text,
                    "cost_usd": distill_result["cost_usd"],
                    "total_tokens": distill_result["total_tokens"],
                },
                "flash_plus_skill": result_c,
            })

        with open(raw_path, "w", encoding="utf-8") as f:
            json.dump(runs, f, indent=2)
        print(f"\nRaw responses saved to {raw_path}")

    # ─── Judge all 9 responses ───
    print(f"\n{'='*60}")
    print("JUDGING (Pro judge with structured rubric)...")
    print(f"{'='*60}")

    judgments_path = RESULTS_DIR / "judgments.json"
    if skip_if_exists and judgments_path.exists():
        with open(judgments_path) as f:
            all_judgments = json.load(f)
    else:
        all_judgments = []
        for run in runs:
            case_judgments = {"case_id": run["case_id"], "query": run["query"]}
            for config_key in ["flash_alone", "pro_alone", "flash_plus_skill"]:
                print(f"  judging {run['case_id']} / {config_key}...", end=" ", flush=True)
                verdict = judge_response(
                    run["query"],
                    run["required_references"],
                    run[config_key]["text"],
                    api_key,
                )
                case_judgments[config_key] = verdict
                print(f"score={verdict.get('overall_score','?')} verdict={verdict.get('verdict','?')}")
            all_judgments.append(case_judgments)

        with open(judgments_path, "w", encoding="utf-8") as f:
            json.dump(all_judgments, f, indent=2)
        print(f"\nJudgments saved to {judgments_path}")

    return runs, all_judgments


# ── Entry point ─────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--skip-if-exists", action="store_true")
    args = parser.parse_args()

    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        # Read from nodebench .env.local
        env_file = Path("D:/VSCode Projects/cafecorner_nodebench/nodebench_ai4/nodebench-ai/.env.local")
        if env_file.exists():
            for line in env_file.read_text().splitlines():
                if line.startswith("GEMINI_API_KEY="):
                    api_key = line.split("=", 1)[1].strip().strip('"').strip("'")
                    break

    if not api_key:
        print("ERROR: GEMINI_API_KEY not set and not found in .env.local", file=sys.stderr)
        sys.exit(1)

    runs, judgments = run_experiment(api_key, skip_if_exists=args.skip_if_exists)
    print(f"\n{'='*60}")
    print("EXPERIMENT COMPLETE")
    print(f"{'='*60}")
    print(f"Runs: {len(runs)}")
    print(f"Judgments: {len(judgments)}")
    print(f"\nNext step: python report.py to generate visual HTML report.")


if __name__ == "__main__":
    main()
