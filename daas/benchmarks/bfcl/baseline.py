"""BFCL baseline CLI — produces the first real eval number offline.

Dry-run modes (no Gemini costs, no Convex writes required):

    python -m daas.benchmarks.bfcl.baseline --category simple --limit 20 --mode golden
        → upper bound: replay returns ground_truth verbatim. Must score 100%.

    python -m daas.benchmarks.bfcl.baseline --category simple --limit 20 --mode broken
        → lower bound: replay returns []. Must score 0%.

These two runs together prove the pipeline is honest — same tasks,
different replay outputs, deterministic 100% vs 0% split. Once the
live replay is wired in (Gemini Flash Lite + the distilled scaffold),
swap ``--mode=live`` and the same script produces the real number.

Results are written to ``daas/benchmarks/_cache/bfcl_v3/baseline.jsonl``.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path
from typing import Any, Callable

from daas.benchmarks.bfcl.runner import (
    BFCL_CACHE_DIR,
    BFCL_CATEGORIES,
    load_tasks,
    run_task,
)
from daas.benchmarks.bfcl.live import live_replay


def golden_replay(task: dict[str, Any]) -> dict[str, Any]:
    """Echo the ground-truth back as the replay artifact — upper bound.

    BFCL v3 ground_truth shape is ``[{fn_name: {arg: [v1, v2, ...]}}]``
    where each arg's list is any-of. Pick the first non-empty element
    as the concrete actual call so the scorer sees a real match.
    """
    truth = task.get("ground_truth") or task.get("possible_answer") or []
    calls: list[dict[str, Any]] = []
    for entry in truth:
        if not isinstance(entry, dict):
            continue
        if "name" in entry and "arguments" in entry:
            # Already internal shape — pass through
            calls.append({"name": entry["name"], "arguments": dict(entry["arguments"])})
            continue
        if len(entry) != 1:
            continue
        (fn_name, args_dict), = entry.items()
        picked: dict[str, Any] = {}
        if isinstance(args_dict, dict):
            for arg_name, vals in args_dict.items():
                if isinstance(vals, list):
                    # Skip optional-only args (list of just empty string / None)
                    concrete = [v for v in vals if v not in ("", None)]
                    if concrete:
                        picked[arg_name] = concrete[0]
                else:
                    picked[arg_name] = vals
        calls.append({"name": fn_name, "arguments": picked})
    return {"calls": calls}


def broken_replay(task: dict[str, Any]) -> dict[str, Any]:
    """Return nothing — lower bound sanity check (must score 0%)."""
    return {"calls": []}


MODES: dict[str, Callable[[dict[str, Any]], dict[str, Any]]] = {
    "golden": golden_replay,
    "broken": broken_replay,
    # live-mode replay calls Gemini Flash Lite — real cost, real latency.
    "live": live_replay,
}


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--category", choices=BFCL_CATEGORIES, default="simple")
    p.add_argument("--limit", type=int, default=20)
    p.add_argument("--mode", choices=sorted(MODES), default="golden")
    p.add_argument(
        "--output",
        type=Path,
        default=BFCL_CACHE_DIR / "baseline.jsonl",
        help="JSONL path to append results to",
    )
    p.add_argument(
        "--record",
        action="store_true",
        help="Push each result to the attrition Convex daasBenchmarkRuns table",
    )
    p.add_argument(
        "--convex-url",
        default="https://joyous-walrus-428.convex.cloud",
        help="Convex deployment URL (attrition prod by default)",
    )
    p.add_argument(
        "--session-id-prefix",
        default="bfcl_v3",
        help="Prefix for synthesized sessionId (<prefix>_<timestamp>_<taskId>)",
    )
    args = p.parse_args(argv)

    try:
        tasks = load_tasks(category=args.category, limit=args.limit)
    except RuntimeError as exc:
        print(f"[warn] {exc}", file=sys.stderr)
        print(
            "[info] falling back to a synthetic fixture for offline smoke-test.",
            file=sys.stderr,
        )
        tasks = _synthetic_fixture(args.category, args.limit)

    replay_fn = MODES[args.mode]

    convex_client = None
    if args.record:
        try:
            from convex import ConvexClient  # type: ignore
        except ImportError as exc:
            print(
                f"[fatal] --record requires `convex` python client: {exc}",
                file=sys.stderr,
            )
            return 3
        convex_client = ConvexClient(args.convex_url)

    results = []
    run_ts = int(time.time())
    recorded = 0
    record_errors = 0
    started = time.time()
    for task in tasks:
        artifact = replay_fn(task)
        result = run_task(task, artifact)
        results.append(result)
        if convex_client is not None:
            meta = result.raw_result.get("_meta") if isinstance(result.raw_result, dict) else None
            cost = float(meta.get("cost_usd") or 0) if isinstance(meta, dict) else 0.0
            duration = int(meta.get("duration_ms") or 0) if isinstance(meta, dict) else 0
            # Strip the (possibly-large) rows detail to stay under 16KB. Keep
            # the structured detail summary without per-row arguments.
            raw_for_storage = dict(result.raw_result)
            detail = raw_for_storage.get("detail")
            if isinstance(detail, dict) and isinstance(detail.get("rows"), list):
                detail = {k: v for k, v in detail.items() if k != "rows"}
                raw_for_storage["detail"] = detail
            raw_json = json.dumps(raw_for_storage, ensure_ascii=False)
            if len(raw_json) > 16_000:
                raw_json = json.dumps(
                    {"truncated": True, "size_chars": len(raw_json), "task_id": result.task_id}
                )
            try:
                convex_client.mutation(
                    "domains/daas/benchmarks:recordRun",
                    {
                        "benchmarkId": result.benchmark_id,
                        "taskId": result.task_id,
                        "sessionId": f"{args.session_id_prefix}_{run_ts}_{result.task_id}",
                        "executorModel": (
                            meta.get("model") if isinstance(meta, dict) else "offline_dry_run"
                        ),
                        "passed": result.passed,
                        "score": result.score,
                        "rawResultJson": raw_json,
                        "replayCostUsd": cost,
                        "durationMs": duration,
                        **({"harnessError": result.harness_error} if result.harness_error else {}),
                    },
                )
                recorded += 1
            except Exception as exc:
                record_errors += 1
                print(
                    f"[warn] convex record failed for {result.task_id}: {exc}",
                    file=sys.stderr,
                )
    elapsed_ms = int((time.time() - started) * 1000)

    passed = sum(1 for r in results if r.passed)
    total = len(results)
    pass_rate = passed / total if total else 0.0
    avg_score = sum(r.score for r in results) / total if total else 0.0

    # Aggregate cost + harness errors across results (live mode only; golden
    # and broken have no meta block so these stay zero).
    total_cost = 0.0
    harness_errors = 0
    for r in results:
        meta = r.raw_result.get("_meta") if isinstance(r.raw_result, dict) else None
        if isinstance(meta, dict):
            total_cost += float(meta.get("cost_usd") or 0)
            if meta.get("error"):
                harness_errors += 1
        if r.harness_error:
            harness_errors += 1

    print(
        f"\n=== BFCL v3 baseline: category={args.category} mode={args.mode} ==="
    )
    print(f"  tasks:     {total}")
    print(f"  passed:    {passed}")
    print(f"  pass rate: {pass_rate:.1%}")
    print(f"  avg score: {avg_score:.3f}")
    print(f"  elapsed:   {elapsed_ms} ms")
    if args.mode == "live":
        print(f"  cost:      ${total_cost:.6f}")
        print(f"  errors:    {harness_errors}")
    if args.record:
        print(f"  recorded:  {recorded} to Convex ({record_errors} failed)")

    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("a", encoding="utf-8") as fh:
        for r in results:
            fh.write(
                json.dumps(
                    {
                        "benchmark_id": r.benchmark_id,
                        "task_id": r.task_id,
                        "passed": r.passed,
                        "score": r.score,
                        "harness_error": r.harness_error,
                        "mode": args.mode,
                        "category": args.category,
                    },
                    ensure_ascii=False,
                )
                + "\n"
            )
    print(f"  appended -> {args.output}")

    # Assert-style self-check for the two dry-run modes so the script
    # signals loudly if the adapter regresses.
    if args.mode == "golden" and pass_rate < 1.0:
        print(
            "\n[FAIL] golden mode must pass 100%. Adapter has a regression.",
            file=sys.stderr,
        )
        return 2
    if args.mode == "broken" and pass_rate > 0.0:
        print(
            "\n[FAIL] broken mode must fail 100%. Scoring is inflated.",
            file=sys.stderr,
        )
        return 2
    return 0


def _synthetic_fixture(category: str, limit: int) -> list[dict[str, Any]]:
    """Hand-crafted BFCL-shaped tasks for offline smoke-testing.

    Used when HuggingFace download is unavailable (airplane, CI, or first
    run before credentials are configured). Mirrors the public schema.
    """
    templates = [
        {
            "id": f"synthetic_{category}_0",
            "question": [{"role": "user", "content": "Add 2 + 3."}],
            "function": [
                {"name": "add", "parameters": {"a": "int", "b": "int"}},
            ],
            "ground_truth": [{"name": "add", "arguments": {"a": 2, "b": 3}}],
        },
        {
            "id": f"synthetic_{category}_1",
            "question": [{"role": "user", "content": "Weather in SF?"}],
            "function": [
                {"name": "get_weather", "parameters": {"city": "str"}},
            ],
            "ground_truth": [
                {"name": "get_weather", "arguments": {"city": "San Francisco"}}
            ],
        },
    ]
    out: list[dict[str, Any]] = []
    while len(out) < limit:
        out.extend(templates)
    return out[:limit]


if __name__ == "__main__":
    raise SystemExit(main())
