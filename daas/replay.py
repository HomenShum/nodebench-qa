"""Replay + judge — run each generated scaffold and compare to the original trace.

Measures:
- Final answer text
- Total cost (measured from real API usageMetadata)
- Token breakdown
- Workers dispatched
- Tool calls attempted

Judges:
- Output similarity via entity overlap (deterministic, no LLM judge needed)
- Cost delta vs original
- Quality score (composite of similarity + structural checks)
"""

import importlib.util
import json
import os
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from schemas import CanonicalTrace, Judgment  # noqa: E402

RESULTS = Path(__file__).parent / "results"
SCAFFOLDS = Path(__file__).parent / "scaffolds"


def load_module(path: Path):
    """Dynamically import a scaffold module."""
    spec = importlib.util.spec_from_file_location(path.stem, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def extract_refs(text: str) -> set:
    """Pull all issue/policy IDs from a response (ISS-XXX, POL-XXX, SKU-XXX)."""
    patterns = [
        r"ISS-\d+",
        r"POL-[A-Z]+-\d+",
        r"SKU-\d+",
        r"STR-\d+",
    ]
    refs = set()
    for p in patterns:
        refs.update(re.findall(p, text, re.IGNORECASE))
    return {r.upper() for r in refs}


def extract_numbers(text: str) -> set:
    """Pull meaningful numeric values (degrees, percentages, dollar amounts)."""
    nums = set()
    for p in [r"\d+\s*°F", r"\d+\s*degrees?", r"\$\d+[,.]?\d*", r"\d+\s*%"]:
        nums.update(re.findall(p, text, re.IGNORECASE))
    return {n.upper() for n in nums}


def count_numbered_actions(text: str) -> int:
    """Count numbered list items (1., 2., etc.) as proxy for action quality."""
    return len(re.findall(r"^\s*\d+\.\s+", text, re.MULTILINE))


def structural_quality(text: str) -> dict:
    """Compute deterministic structural quality signals."""
    return {
        "refs_cited": len(extract_refs(text)),
        "numbered_actions": count_numbered_actions(text),
        "has_immediate_actions": bool(re.search(r"immediate|now|right away", text, re.IGNORECASE)),
        "has_followup": bool(re.search(r"follow[- ]?up|later|this week|today", text, re.IGNORECASE)),
        "has_cross_store": bool(re.search(r"cross[- ]?store|other stores|chain[- ]?wide", text, re.IGNORECASE)),
        "response_length": len(text),
    }


def judge_replay(original_trace: CanonicalTrace, replay_result: dict, replay_id: str) -> Judgment:
    """Deterministically compare the replay to the original expert trace."""
    orig_text = original_trace.final_answer
    repl_text = replay_result["final_answer"]

    orig_refs = extract_refs(orig_text)
    repl_refs = extract_refs(repl_text)
    ref_overlap = len(orig_refs & repl_refs) / max(len(orig_refs), 1)

    orig_nums = extract_numbers(orig_text)
    repl_nums = extract_numbers(repl_text)
    num_overlap = len(orig_nums & repl_nums) / max(len(orig_nums), 1) if orig_nums else 1.0

    # Structural parity
    orig_s = structural_quality(orig_text)
    repl_s = structural_quality(repl_text)
    struct_score = 0
    struct_score += 1 if repl_s["refs_cited"] >= orig_s["refs_cited"] * 0.8 else 0
    struct_score += 1 if repl_s["numbered_actions"] >= orig_s["numbered_actions"] * 0.8 else 0
    struct_score += 1 if repl_s["has_immediate_actions"] else 0
    struct_score += 1 if repl_s["has_followup"] else 0
    struct_score /= 4

    output_similarity = (0.5 * ref_overlap) + (0.2 * num_overlap) + (0.3 * struct_score)

    # Cost
    cost_delta_pct = ((replay_result["total_cost_usd"] - original_trace.total_cost_usd) / original_trace.total_cost_usd) * 100 if original_trace.total_cost_usd else 0.0

    # Tool parity (MVP: count tool calls made in replay vs zero tools in our trace)
    # We don't have real tool call parity data since the original was a single Pro call.
    # For MVP we set this to 1.0 if workers were dispatched, else 0.
    tool_parity = 1.0 if replay_result.get("workers_dispatched") else 0.0

    # Quality 0-10
    quality_score = min(10.0, output_similarity * 10)

    # Verdict
    if output_similarity >= 0.7 and cost_delta_pct < 0:
        verdict = "pass"
    elif output_similarity >= 0.5:
        verdict = "partial"
    else:
        verdict = "fail"

    return Judgment(
        original_trace_id=original_trace.session_id,
        replay_id=replay_id,
        output_similarity=round(output_similarity, 3),
        cost_delta_pct=round(cost_delta_pct, 1),
        tool_parity=round(tool_parity, 3),
        quality_score=round(quality_score, 2),
        verdict=verdict,
        details=json.dumps({
            "ref_overlap": round(ref_overlap, 3),
            "num_overlap": round(num_overlap, 3),
            "struct_score": round(struct_score, 3),
            "orig_structure": orig_s,
            "replay_structure": repl_s,
            "orig_cost_usd": original_trace.total_cost_usd,
            "replay_cost_usd": replay_result["total_cost_usd"],
        }),
    )


def sanitize_name(name: str) -> str:
    return re.sub(r"[^a-z0-9_]", "_", name.lower())


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
        print("GEMINI_API_KEY required", file=sys.stderr)
        sys.exit(1)

    traces_path = RESULTS / "canonical_traces.json"
    if not traces_path.exists():
        print("ERROR: ingest.py first", file=sys.stderr)
        sys.exit(1)

    raw_traces = json.loads(traces_path.read_text(encoding="utf-8"))
    traces = []
    for raw in raw_traces:
        trace = CanonicalTrace(
            session_id=raw["session_id"],
            source_model=raw["source_model"],
            query=raw.get("query", ""),
            final_answer=raw.get("final_answer", ""),
            total_cost_usd=raw.get("total_cost_usd", 0),
            total_tokens=raw.get("total_tokens", 0),
            duration_ms=raw.get("duration_ms", 0),
            repo_context=raw.get("repo_context"),
        )
        traces.append(trace)

    judgments = []
    replays = []
    for trace in traces:
        mod_name = f"workflow_{sanitize_name(trace.session_id)}.py"
        mod_path = SCAFFOLDS / mod_name
        if not mod_path.exists():
            print(f"SKIP {trace.session_id}: no scaffold at {mod_path}")
            continue

        print(f"\n[replay] {trace.session_id}: loading {mod_name}...")
        module = load_module(mod_path)

        # Build repo context (same data the expert saw)
        import sys as _s
        _s.path.insert(0, str(Path(__file__).parent))
        from ingest import load_floorai_context
        ctx = load_floorai_context()
        # Reduce to summary for the scaffold (Flash Lite has smaller effective context than Pro)
        repo_ctx = {
            "policies_summary": [{"id": p.get("policyId"), "category": p.get("category"), "title": p.get("title"), "content": str(p.get("content",""))[:400]} for p in ctx.get("policies", [])[:15]],
            "issues_csv_head": "\n".join(ctx.get("issues_csv","").split("\n")[:40]),
            "store_id": (trace.repo_context or {}).get("store_id"),
        }

        print(f"  executing scaffold workflow...")
        try:
            result = module.run_workflow(trace.query, repo_ctx, api_key)
        except Exception as e:
            print(f"  FAILED: {e}")
            continue

        print(f"  result: {result['total_tokens']} tok, ${result['total_cost_usd']:.6f}")
        print(f"  workers: {result['workers_dispatched']}")

        # Judge
        judgment = judge_replay(trace, result, replay_id=f"replay_{trace.session_id}")
        print(f"  judgment: similarity={judgment.output_similarity}, cost_delta={judgment.cost_delta_pct}%, verdict={judgment.verdict}")
        judgments.append(judgment)
        replays.append({
            "trace_id": trace.session_id,
            "query": trace.query,
            "original_answer": trace.final_answer,
            "original_cost_usd": trace.total_cost_usd,
            "original_tokens": trace.total_tokens,
            "replay_answer": result["final_answer"],
            "replay_cost_usd": result["total_cost_usd"],
            "replay_tokens": result["total_tokens"],
            "workers_dispatched": result["workers_dispatched"],
            "tool_calls": result["tool_calls"],
        })

    (RESULTS / "replays.json").write_text(json.dumps(replays, indent=2), encoding="utf-8")
    (RESULTS / "judgments.json").write_text(json.dumps([j.to_dict() for j in judgments], indent=2), encoding="utf-8")

    print(f"\n{'='*70}\nAGGREGATE\n{'='*70}")
    from statistics import mean
    if judgments:
        avg_sim = mean(j.output_similarity for j in judgments)
        avg_cost_delta = mean(j.cost_delta_pct for j in judgments)
        passed = sum(1 for j in judgments if j.verdict == "pass")
        partial = sum(1 for j in judgments if j.verdict == "partial")
        failed = sum(1 for j in judgments if j.verdict == "fail")
        print(f"  Runs: {len(judgments)}")
        print(f"  Avg output similarity: {avg_sim:.3f}")
        print(f"  Avg cost delta: {avg_cost_delta:+.1f}%")
        print(f"  Verdicts: pass={passed} partial={partial} fail={failed}")
    print(f"\nWrote replays.json + judgments.json to {RESULTS}")


if __name__ == "__main__":
    main()
