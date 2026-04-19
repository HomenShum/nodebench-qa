"""Distiller — extracts WorkflowSpec from a CanonicalTrace.

This is ONE expensive call per trace (using Pro as the distiller). The output
is a structured WorkflowSpec that a cheaper model can execute via a generated
orchestrator-worker scaffold.

Key insight from Vellum/Anthropic advisor data: weaker executors gain MORE
from scaffolding. We therefore target Flash Lite as executor and distill
Pro's reasoning into explicit worker roles with scoped tool access.
"""

import json
import os
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from schemas import CanonicalTrace, WorkflowSpec, Worker, ToolDef, HandoffRule  # noqa: E402
from ingest import call_gemini, PRO_MODEL  # noqa: E402

RESULTS = Path(__file__).parent / "results"


DISTILL_PROMPT = """You are an expert in agent workflow architecture. Given an EXPERT MODEL'S output for a specific query, extract a reusable WORKFLOW SPECIFICATION that a cheaper model could follow to reproduce this reasoning.

The goal: a weaker executor model (gemini-3.1-flash-lite-preview) will execute a multi-agent workflow (orchestrator + specialist workers) that mimics the expert's internal reasoning.

Return ONLY valid JSON matching this schema (no markdown fences, no prose):

{{
  "orchestrator_system_prompt": "<prompt for the orchestrator that PLANS the workflow>",
  "orchestrator_plan_prompt": "<prompt that asks the orchestrator to decide which workers to dispatch>",
  "workers": [
    {{
      "name": "<worker_name>",
      "role": "<role_label>",
      "system_prompt": "<focused prompt for this worker>",
      "tools": ["<tool_name>", ...]
    }}
  ],
  "tools": [
    {{
      "name": "<tool_name>",
      "purpose": "<what this tool does>",
      "input_schema": {{"param": "<type>"}},
      "output_schema": {{"field": "<type>"}}
    }}
  ],
  "handoffs": [
    {{
      "from_agent": "<agent>",
      "to_agent": "<agent>",
      "trigger": "<when to handoff>",
      "payload_schema": {{"field": "<type>"}}
    }}
  ],
  "success_criteria": [
    "<measurable criterion 1>",
    "<measurable criterion 2>"
  ],
  "domain_rules": [
    "<hard guardrail 1>",
    "<hard guardrail 2>"
  ]
}}

Guidance:
- Identify the IMPLICIT sub-agents in the expert response (e.g. "issue classifier", "policy mapper", "action planner", "cross-store analyzer").
- Each worker should have a NARROW role so Flash Lite can execute it reliably.
- Tools should include ALL actions the expert implicitly took (search policies, lookup issues, check other stores, compute revenue impact).
- Success criteria should be DETERMINISTIC (e.g. "response cites specific issue ID matching ISS-N", "numbered action list with >=3 items").
- Domain rules should encode HARD constraints the expert followed (e.g. "food safety emergency requires immediate containment actions").

EXPERT QUERY: {query}

EXPERT RESPONSE:
{expert_response}

REPO CONTEXT: {repo_context}

WORKFLOW SPEC JSON:"""


def extract_json(text: str) -> dict:
    """Pull the first valid JSON object from a response (robust to markdown fences)."""
    # Strip markdown fences if present
    text = re.sub(r"```(?:json)?\s*", "", text)
    text = re.sub(r"```", "", text)
    match = re.search(r"\{[\s\S]*\}", text)
    if not match:
        raise ValueError("No JSON object found in distiller response")
    # Try parsing progressively shorter prefixes if first attempt fails
    raw = match.group(0)
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        # Try to fix trailing commas
        cleaned = re.sub(r",\s*([\]}])", r"\1", raw)
        return json.loads(cleaned)


def distill_trace(trace: CanonicalTrace, api_key: str, target_executor: str = "gemini-3.1-flash-lite-preview") -> WorkflowSpec:
    """Call Pro to extract a WorkflowSpec from an expert trace."""
    print(f"[distill] {trace.session_id}: calling Pro to extract WorkflowSpec...")
    prompt = DISTILL_PROMPT.format(
        query=trace.query,
        expert_response=trace.final_answer[:6000],
        repo_context=json.dumps(trace.repo_context or {}),
    )
    result = call_gemini(PRO_MODEL, prompt, api_key, temperature=0.0, max_tokens=4000)
    if result.get("error"):
        raise RuntimeError(f"Distiller call failed: {result['error']}")

    try:
        spec_json = extract_json(result["text"])
    except Exception as e:
        raise RuntimeError(f"Failed to parse WorkflowSpec JSON: {e}\nRaw:\n{result['text'][:800]}")

    spec = WorkflowSpec(
        source_trace_id=trace.session_id,
        executor_model=target_executor,
        orchestrator_system_prompt=spec_json.get("orchestrator_system_prompt", ""),
        orchestrator_plan_prompt=spec_json.get("orchestrator_plan_prompt", ""),
        workers=[Worker(**w, model=target_executor) if "model" not in w else Worker(**w)
                 for w in spec_json.get("workers", [])],
        tools=[ToolDef(**t) for t in spec_json.get("tools", [])],
        handoffs=[HandoffRule(**h) for h in spec_json.get("handoffs", [])],
        success_criteria=spec_json.get("success_criteria", []),
        domain_rules=spec_json.get("domain_rules", []),
    )

    print(f"  -> {len(spec.workers)} workers, {len(spec.tools)} tools, {len(spec.handoffs)} handoffs")
    print(f"  distill_cost=${result['cost_usd']:.6f} ({result['total_tokens']} tokens)")
    return spec


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

    traces_path = RESULTS / "canonical_traces.json"
    if not traces_path.exists():
        print(f"ERROR: run ingest.py first. Missing {traces_path}", file=sys.stderr)
        sys.exit(1)

    raw_traces = json.loads(traces_path.read_text(encoding="utf-8"))
    traces = [CanonicalTrace(**{k: v for k, v in t.items() if k in CanonicalTrace.__dataclass_fields__})
              for t in raw_traces]
    # Re-attach steps as objects (we just read dicts)
    for t, raw in zip(traces, raw_traces):
        t.steps = raw.get("steps", [])

    specs = []
    for trace in traces:
        try:
            spec = distill_trace(trace, api_key)
            specs.append(spec)
        except Exception as e:
            print(f"  FAILED {trace.session_id}: {e}")

    out = RESULTS / "workflow_specs.json"
    out.write_text(json.dumps([s.to_dict() for s in specs], indent=2), encoding="utf-8")
    print(f"\nWrote {len(specs)} WorkflowSpecs to {out}")


if __name__ == "__main__":
    main()
