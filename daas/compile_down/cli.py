"""Compile-down CLI — trace in, runnable code bundle out.

Usage:
    python -m daas.compile_down.cli \\
        --session-slug my_session \\
        --trace daas/examples/traces/floorai_milk.json \\
        --runtime-lane tool_first_chain \\
        --target-model gemini-3.1-flash-lite-preview \\
        --record

Without --record the bundle is written to daas/compile_down/output/
and nothing hits Convex.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path
from typing import Any

from daas.compile_down import emit
from daas.compile_down.world_model import emit_world_model, WORLD_MODEL_LANES
from daas.schemas import CanonicalTrace, WorkflowSpec

CONVEX_PROD_URL = "https://joyous-walrus-428.convex.cloud"
EMITTER_VERSION = "v0.1.0"

OUTPUT_DIR = Path(__file__).resolve().parent / "output"


def load_trace(path: Path) -> dict[str, Any]:
    raw = json.loads(path.read_text(encoding="utf-8"))
    # Accept either canonical shape or a trimmed shape with query + finalAnswer
    return raw


def trace_to_workflow_spec(trace: dict[str, Any], target_model: str) -> WorkflowSpec:
    """Minimum-viable distillation — extract a WorkflowSpec from a trace.

    For the tool_first_chain / simple_chain emitters, we only need:
      - a system prompt seed (distilled from the trace's user query)
      - tool specs from any observed tool invocations
      - success criteria heuristics

    A richer LLM-based distiller lives in daas.distill; this is the
    zero-API-call fallback so compile_down has no external dependency.
    """
    query = str(trace.get("query") or trace.get("prompt") or "")
    tools_seen: list[dict[str, Any]] = []
    seen_names = set()
    for step in trace.get("steps") or []:
        for tc in step.get("tool_calls") or []:
            name = tc.get("name")
            if not name or name in seen_names:
                continue
            seen_names.add(name)
            tools_seen.append(
                {
                    "name": name,
                    "purpose": f"Observed in trace — {len(tc.get('args', {}))} argument(s) per call.",
                    "input_schema": {
                        "type": "object",
                        "properties": {
                            k: {"type": _infer_type(v)}
                            for k, v in (tc.get("args") or {}).items()
                        },
                    },
                    "output_schema": {"type": "object"},
                }
            )
    # Also accept a flat "toolCalls" list (common in ingested Claude Code sessions)
    for tc in trace.get("toolCalls") or []:
        name = tc.get("name") or tc.get("tool")
        if not name or name in seen_names:
            continue
        seen_names.add(name)
        tools_seen.append(
            {
                "name": name,
                "purpose": "Observed in flat toolCalls array.",
                "input_schema": {"type": "object", "properties": {}},
                "output_schema": {"type": "object"},
            }
        )

    system_prompt = (
        trace.get("distilled_system_prompt")
        or f"You are answering the following class of queries: {query[:200]}\n"
        "Respond concisely, cite specific IDs or facts where available, "
        "and avoid speculation."
    )
    return WorkflowSpec(
        source_trace_id=str(trace.get("sessionId") or trace.get("session_id") or "unknown"),
        executor_model=target_model,
        orchestrator_system_prompt=system_prompt,
        tools=tools_seen,  # type: ignore[arg-type]
        success_criteria=[
            "Answers real user query with concrete specifics from tool results.",
            "Does not fabricate IDs or references not present in tool output.",
        ],
        domain_rules=[],
    )


def _infer_type(v: Any) -> str:
    if isinstance(v, bool):
        return "boolean"
    if isinstance(v, int):
        return "integer"
    if isinstance(v, float):
        return "number"
    if isinstance(v, list):
        return "array"
    if isinstance(v, dict):
        return "object"
    return "string"


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--session-slug", required=True)
    p.add_argument("--trace", type=Path, required=True)
    p.add_argument(
        "--runtime-lane",
        choices=["simple_chain", "tool_first_chain"],
        default="tool_first_chain",
    )
    p.add_argument(
        "--world-model-lane",
        choices=list(WORLD_MODEL_LANES) + ["none"],
        default="none",
        help="Also emit a world-model substrate bundle; lite or full",
    )
    p.add_argument("--target-model", default="gemini-3.1-flash-lite-preview")
    p.add_argument("--record", action="store_true")
    p.add_argument("--convex-url", default=CONVEX_PROD_URL)
    p.add_argument("--output-dir", type=Path, default=OUTPUT_DIR)
    args = p.parse_args(argv)

    if not args.trace.exists():
        print(f"[fatal] trace not found: {args.trace}", file=sys.stderr)
        return 2

    trace = load_trace(args.trace)
    spec = trace_to_workflow_spec(trace, args.target_model)
    bundle = emit(args.runtime_lane, spec, target_model=args.target_model)

    # Local write — always. Record flag only controls Convex push.
    out_dir = args.output_dir / args.session_slug / args.runtime_lane
    out_dir.mkdir(parents=True, exist_ok=True)
    for f in bundle.files:
        (out_dir / f.path).parent.mkdir(parents=True, exist_ok=True)
        (out_dir / f.path).write_text(f.content, encoding="utf-8")
    bundle_path = out_dir / "_bundle.json"
    bundle_path.write_text(bundle.to_json(), encoding="utf-8")
    print(f"Emitted {len(bundle.files)} files ({bundle.total_bytes} bytes) -> {out_dir}")

    # World-model emission (optional second bundle)
    wm_bundle = None
    if args.world_model_lane != "none":
        wm_bundle = emit_world_model(args.world_model_lane, spec)
        wm_out = args.output_dir / args.session_slug / wm_bundle.runtime_lane
        wm_out.mkdir(parents=True, exist_ok=True)
        for f in wm_bundle.files:
            (wm_out / f.path).parent.mkdir(parents=True, exist_ok=True)
            (wm_out / f.path).write_text(f.content, encoding="utf-8")
        (wm_out / "_bundle.json").write_text(wm_bundle.to_json(), encoding="utf-8")
        print(
            f"Emitted {len(wm_bundle.files)} world-model files ({wm_bundle.total_bytes} bytes) -> {wm_out}"
        )

    if args.record:
        try:
            from convex import ConvexClient  # type: ignore
        except ImportError:
            print("[fatal] --record requires `pip install convex`", file=sys.stderr)
            return 3
        c = ConvexClient(args.convex_url)
        kwargs = {
            "sessionSlug": args.session_slug,
            "runtimeLane": args.runtime_lane,
            "targetModel": args.target_model,
            "artifactBundleJson": bundle.to_json(),
            "filesCount": len(bundle.files),
            "totalBytes": bundle.total_bytes,
            "emitterVersion": EMITTER_VERSION,
            "workflowSpecJson": json.dumps(spec.to_dict(), default=str),
        }
        c.mutation("domains/daas/compileDown:upsertArtifact", kwargs)
        print(
            f"Recorded artifact for session={args.session_slug} lane={args.runtime_lane} "
            f"({bundle.total_bytes} bytes)"
        )
        if wm_bundle is not None:
            wm_kwargs = {
                "sessionSlug": args.session_slug,
                "runtimeLane": wm_bundle.runtime_lane,
                "targetModel": args.target_model,
                "artifactBundleJson": wm_bundle.to_json(),
                "filesCount": len(wm_bundle.files),
                "totalBytes": wm_bundle.total_bytes,
                "emitterVersion": EMITTER_VERSION,
            }
            c.mutation("domains/daas/compileDown:upsertArtifact", wm_kwargs)
            print(
                f"Recorded world-model artifact lane={wm_bundle.runtime_lane} "
                f"({wm_bundle.total_bytes} bytes)"
            )

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
