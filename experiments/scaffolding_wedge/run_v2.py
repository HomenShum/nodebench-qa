#!/usr/bin/env python3
"""Scaffolding Wedge Experiment V2 — HARDER test with stripped context.

ROOT CAUSE OF V1 FAILURE:
  V1 gave ALL configs a rich context brief with every issue + policy inline.
  Result: judge scored everything 10/10 — all configs cited all references.
  The wedge test passed but measured nothing (no discrimination between configs).

FIX IN V2:
  Strip the deterministic context brief to a minimal query-only prompt.
  Now Flash must reason from general knowledge; Pro must reason from general
  knowledge; only the distilled skill provides the retail-ops specific
  scaffolding (policy checks, action-plan structure, cross-store patterns).

  This tests whether distilled reasoning TRANSFERS, not whether a rich context
  brief makes all models equivalent.

THREE CONFIGURATIONS:
  A. Flash alone + minimal prompt (cheap, no scaffolding)
  B. Pro alone + minimal prompt (expensive, internal scaffolding)
  C. Flash + distilled skill (cheap + external scaffolding)

JUDGE RUBRIC (stricter):
  - factual_specificity: cites exact IDs/SKUs/quantities (not generic refs)
  - policy_mapping: identifies the specific policy by ID, explains application
  - action_quality: numbered, specific, time-bound, non-generic
  - completeness: immediate + follow-up + escalation + risk

  A response that says "check your policies" scores 2/10.
  A response that cites POL-INV-003 and applies specific clauses scores 8+/10.

Usage:
    python run_v2.py
"""

import json, os, sys, time, re, urllib.request
from pathlib import Path
from datetime import datetime, timezone
from statistics import mean

FLOORAI_DIR = Path("D:/VSCode Projects/cafecorner_nodebench/floorai")
RESULTS_DIR = Path(__file__).parent / "results"
RESULTS_DIR.mkdir(parents=True, exist_ok=True)

MODELS = {
    "flash": "gemini-3.1-flash-lite-preview",
    "pro":   "gemini-3.1-pro-preview",
}
PRICING = {
    "gemini-3.1-flash-lite-preview": (0.075, 0.30),
    "gemini-3.1-pro-preview":        (1.25,  5.00),
}
TARGET_CASES = ["EVAL-001", "EVAL-002", "EVAL-003"]


def call_gemini(model: str, prompt: str, api_key: str, temperature: float = 0.2) -> dict:
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={api_key}"
    body = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {"temperature": temperature, "maxOutputTokens": 2500},
    }
    req = urllib.request.Request(url, data=json.dumps(body).encode(),
                                 headers={"Content-Type": "application/json"}, method="POST")
    start = time.time()
    with urllib.request.urlopen(req, timeout=120) as resp:
        data = json.loads(resp.read().decode())
    latency_ms = int((time.time() - start) * 1000)
    text = ""
    if data.get("candidates"):
        text = "".join(p.get("text","") for p in data["candidates"][0].get("content",{}).get("parts",[]))
    usage = data.get("usageMetadata", {})
    inp = usage.get("promptTokenCount", 0)
    out = usage.get("candidatesTokenCount", 0)
    rin, rout = PRICING.get(model, (1.25, 5.00))
    return {
        "model": model, "text": text,
        "input_tokens": inp, "output_tokens": out, "total_tokens": inp + out,
        "cost_usd": (inp/1e6)*rin + (out/1e6)*rout,
        "latency_ms": latency_ms,
    }


# ─── MINIMAL PROMPT (no context brief — tests reasoning transfer) ───
MINIMAL_INSTRUCTION = """You are a retail operations assistant for a multi-store grocery chain.

A store manager is asking you a question. You do NOT have access to their specific
issue database or policy database — you must answer based on general retail-ops
expertise and reasoning.

Provide:
1. Your best guess at what the underlying issue is
2. Specific actions the manager should take (immediate + follow-up)
3. What information the manager should gather to investigate further
4. Any escalation or cross-functional coordination needed

Be specific and actionable. If you would normally cite a policy ID, note what
TYPE of policy applies (e.g., "inventory vendor-delay policy") even if you don't
know the exact ID.

QUERY: {query}

RESPONSE:"""

# ─── SCAFFOLDED PROMPT (Flash + distilled skill from Pro) ───
# The distilled skill provides the retail-ops reasoning pattern that Pro has internally.
SCAFFOLDED_INSTRUCTION = """You are a retail operations assistant for a multi-store grocery chain.

A store manager is asking you a question. Apply the REASONING SKILL below EXACTLY
as specified. This skill was distilled from expert retail-ops practice.

REASONING SKILL:
{skill}

QUERY: {query}

Follow the skill's reasoning steps in order. Use the exact output structure it specifies.

RESPONSE:"""

# ─── DISTILLED SKILLS (hand-crafted to represent what the distillation would produce) ───
# These are the reasoning patterns Pro uses internally. We're testing whether externalizing
# them lets Flash apply them.
DISTILLED_SKILLS = {
    "EVAL-001": """# Skill: Vendor Delivery Issue Diagnosis

## TRIGGER
Store manager reports delivery problem (late, missing, wrong product, bad quality).

## CONTEXT CHECKS (before answering)
1. Identify the vendor name and SKU from the query
2. Check for an open issue ID matching the vendor/SKU pattern (format: ISS-NNN)
3. Check the inventory vendor-delay policy (format: POL-INV-NNN)
4. Check if other stores have the same issue (cross-store pattern)

## REASONING STEPS
1. Diagnose: what's the root vendor issue? (delivery delay, quality, cancellation, substitution)
2. Policy application: quote the vendor-delay policy's specific clauses (recovery window, substitution authority, customer communication)
3. Cross-store check: is this a chain-wide vendor problem?
4. Revenue impact: estimate the daily revenue loss from the missing SKU
5. Customer communication: what should staff tell customers who ask?

## OUTPUT STRUCTURE
**Issue identified**: [ID + description]
**Applicable policy**: [ID + 1-sentence summary]
**Immediate actions** (numbered, within 1 hour)
**Follow-up actions** (numbered, within 24 hours)
**Cross-store pattern**: [yes/no + if yes, which stores]
**Revenue impact**: [$X/day estimate + reasoning]
**Customer communication**: [exact script for staff]

## DOMAIN RULES
- NEVER tell customers to go to another store without vendor coordination
- ALWAYS offer substitution before issuing refunds
- ESCALATE to regional if vendor delay > 48 hours
""",

    "EVAL-002": """# Skill: Staffing Shortage Response

## TRIGGER
Store manager reports staff callouts, leaving store under minimum staffing.

## CONTEXT CHECKS
1. Count of absent staff + their roles (cashier, stocker, lead)
2. Current staffing plan vs minimum safe staffing
3. HR callout-coverage policy (format: POL-HR-NNN)
4. Time-sensitive operations affected (opening, peak hours, close)

## REASONING STEPS
1. Triage: which roles are under-covered and when?
2. Policy application: callout-coverage escalation chain, overtime authorization
3. Immediate coverage: on-call list, regional float pool, cross-store loan
4. Operational adjustments: reduced service, self-checkout expansion, delayed restocking
5. Customer impact: expected wait times, service quality degradation

## OUTPUT STRUCTURE
**Issue identified**: [ID + which roles short]
**Applicable policy**: [ID + coverage hierarchy]
**Immediate actions** (within 30 min): [numbered, who to call in what order]
**Operational adjustments** (today): [numbered, what service is affected]
**Follow-up** (end of shift): [escalation report, overtime approvals, root-cause review]
**Cross-store pattern**: [check if other stores have simultaneous callouts]

## DOMAIN RULES
- NEVER drop below 2 employees in store simultaneously
- ALWAYS prioritize cashier coverage over stocking
- ESCALATE to regional if < 50% of minimum staffing achievable
""",

    "EVAL-003": """# Skill: Refrigeration Emergency Protocol

## TRIGGER
Walk-in cooler, freezer, or case temperature outside safe range (typically cooler > 41°F or freezer > 0°F).

## CONTEXT CHECKS
1. Exact temperature reading + how long out of range
2. Affected product categories (dairy, meat, produce, prepared foods)
3. Maintenance emergency policy (format: POL-MAINT-NNN)
4. Refrigeration vendor contract / on-call number

## REASONING STEPS (TIME-CRITICAL)
1. Product safety triage: 41-45°F for < 4hrs = monitor; > 45°F or > 4hrs = discard high-risk
2. Policy application: emergency repair authority, product-loss write-off threshold
3. Immediate containment: move high-value high-risk product to working unit, stop sales of affected items
4. Vendor dispatch: contact refrigeration service with temperature + time
5. Health compliance: document temperature log for health dept (required if inspection in next 14 days)
6. Insurance: photograph product condition before discard (business-interruption claim)

## OUTPUT STRUCTURE
**Issue identified**: [ID + temperature + duration]
**Applicable policy**: [ID + food safety threshold]
**IMMEDIATE (within 15 min)**: [1-3 numbered, time-critical]
**TODAY (within 4 hours)**: [numbered repair + loss assessment]
**DOCUMENTATION**: [specific forms and photos needed]
**Escalation**: [who to notify in what order + contact method]

## DOMAIN RULES
- NEVER sell product from a cooler > 45°F for > 2 hours ("danger zone" rule)
- ALWAYS log temperature timestamps for health dept
- ESCALATE to regional manager AND health-compliance officer on any > 4hr excursion
"""
}


JUDGE_PROMPT = """You are a STRICT retail-ops expert evaluating a response. Score harshly.

QUERY: {query}
REQUIRED REFERENCES (may or may not be cited): {refs}

RESPONSE TO JUDGE:
{response}

Score on 4 criteria (0-10 each). BE STRICT. A response earns a 10 ONLY if it is
EXPERT-LEVEL specific. Generic retail advice ("check your policies") = 2.

1. factual_specificity: Does it name SPECIFIC facts (temperatures, time windows, product categories, policy IDs, SKUs)?
2. policy_mapping: Does it identify the CORRECT policy type and explain specific clauses that apply?
3. action_quality: Numbered, specific, time-bound actions (not "be careful" or "follow procedures")?
4. completeness: Covers immediate + follow-up + escalation + risk + documentation?

Return ONLY valid JSON:
{{"factual_specificity": N, "policy_mapping": N, "action_quality": N, "completeness": N, "overall_score": AVG, "verdict": "pass|partial|fail", "rationale": "ONE sentence"}}"""


def judge_response(query, refs, resp_text, api_key):
    prompt = JUDGE_PROMPT.format(query=query, refs=refs, response=resp_text[:4000])
    result = call_gemini(MODELS["pro"], prompt, api_key, temperature=0.0)
    text = result["text"]
    m = re.search(r"\{[\s\S]*\}", text)
    if not m:
        return {"error": "no_json", "raw": text[:300], "overall_score": 0}
    try:
        v = json.loads(m.group(0))
        v["_judge_cost_usd"] = result["cost_usd"]
        return v
    except Exception as e:
        return {"error": str(e), "raw": text[:300], "overall_score": 0}


def main():
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        env = Path("D:/VSCode Projects/cafecorner_nodebench/nodebench_ai4/nodebench-ai/.env.local")
        if env.exists():
            for line in env.read_text().splitlines():
                if line.startswith("GEMINI_API_KEY="):
                    api_key = line.split("=",1)[1].strip().strip('"').strip("'"); break
    if not api_key:
        print("ERROR: GEMINI_API_KEY required", file=sys.stderr); sys.exit(1)

    with open(FLOORAI_DIR/"data"/"golden_dataset.json") as f:
        dataset = json.load(f)
    cases = [c for c in dataset if c["id"] in TARGET_CASES]
    assert len(cases) == 3

    runs = []
    for case in cases:
        print(f"\n{'='*60}\n{case['id']}: {case['query'][:55]}\n{'='*60}", flush=True)
        skill = DISTILLED_SKILLS[case['id']]

        print("  [A] Flash alone (minimal context)...", end=" ", flush=True)
        a = call_gemini(MODELS["flash"], MINIMAL_INSTRUCTION.format(query=case["query"]), api_key)
        print(f"{a['total_tokens']} tok ${a['cost_usd']:.6f}")

        print("  [B] Pro alone (minimal context)...", end=" ", flush=True)
        b = call_gemini(MODELS["pro"], MINIMAL_INSTRUCTION.format(query=case["query"]), api_key)
        print(f"{b['total_tokens']} tok ${b['cost_usd']:.6f}")

        print("  [C] Flash + distilled skill...", end=" ", flush=True)
        c = call_gemini(MODELS["flash"], SCAFFOLDED_INSTRUCTION.format(skill=skill, query=case["query"]), api_key)
        print(f"{c['total_tokens']} tok ${c['cost_usd']:.6f}")

        runs.append({
            "case_id": case["id"], "query": case["query"], "store_id": case.get("storeId"),
            "required_references": case.get("required_references", []),
            "flash_alone": a, "pro_alone": b, "flash_plus_skill": c,
            "distilled_skill": {"text": skill, "total_tokens": 0, "cost_usd": 0},
        })

    raw_path = RESULTS_DIR / "raw_responses_v2.json"
    raw_path.write_text(json.dumps(runs, indent=2), encoding="utf-8")
    print(f"\nRaw v2 saved to {raw_path}")

    # ── Judge ──
    print(f"\n{'='*60}\nJUDGING (stricter rubric)\n{'='*60}", flush=True)
    judgments = []
    for run in runs:
        cj = {"case_id": run["case_id"], "query": run["query"]}
        for cfg in ["flash_alone", "pro_alone", "flash_plus_skill"]:
            print(f"  judging {run['case_id']} / {cfg}...", end=" ", flush=True)
            v = judge_response(run["query"], run["required_references"], run[cfg]["text"], api_key)
            cj[cfg] = v
            # Map new keys to old for report compatibility
            v_compat = dict(v)
            v_compat["factual_alignment"] = v.get("factual_specificity", 0)
            v_compat["policy_grounding"] = v.get("policy_mapping", 0)
            v_compat["actionability"] = v.get("action_quality", 0)
            cj[cfg] = v_compat
            print(f"score={v.get('overall_score','?')} verdict={v.get('verdict','?')}")
        judgments.append(cj)

    jpath = RESULTS_DIR / "judgments_v2.json"
    jpath.write_text(json.dumps(judgments, indent=2), encoding="utf-8")
    print(f"\nJudgments v2 saved to {jpath}")

    # Quick summary
    configs = ["flash_alone", "pro_alone", "flash_plus_skill"]
    avg = {c: mean(float(j[c].get("overall_score", 0)) for j in judgments) for c in configs}
    avg_cost = {c: mean(r[c]["cost_usd"] for r in runs) for c in configs}
    qr = (avg["flash_plus_skill"]/avg["pro_alone"])*100 if avg["pro_alone"] else 0
    cf = (avg_cost["flash_plus_skill"]/avg_cost["pro_alone"])*100 if avg_cost["pro_alone"] else 0
    uplift = avg["flash_plus_skill"] - avg["flash_alone"]
    print(f"\n{'='*60}\nRESULTS\n{'='*60}")
    for c in configs:
        print(f"  {c:20s}: avg_score={avg[c]:.2f}  avg_cost=${avg_cost[c]:.6f}")
    print(f"\n  Quality retention (Flash+skill vs Pro): {qr:.1f}%")
    print(f"  Cost fraction  (Flash+skill vs Pro):    {cf:.1f}%")
    print(f"  Quality uplift (Flash+skill − Flash):   +{uplift:.2f}")
    if qr >= 80 and cf < 40:
        print("  VERDICT: WEDGE CONFIRMED ✅")
    elif qr >= 60 and cf < 60:
        print("  VERDICT: PARTIAL")
    else:
        print("  VERDICT: REJECTED ❌")


if __name__ == "__main__":
    main()
