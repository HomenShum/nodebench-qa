"""BFCL v3 task loader + AST comparator adapter.

Integration path:
    1. ``load_tasks(category, limit)`` — pull N tasks from the HuggingFace
       dataset (cached locally as JSONL).
    2. ``to_bfcl_format(replay_artifact)`` — translate DaaS replay output
       (``{worker, tool, args}[]``) into BFCL's expected call shape.
    3. ``score_calls(expected, actual)`` — AST-level match using bfcl_eval
       when available; falls back to a local comparator that follows the
       documented BFCL spec exactly (same name + arg-set semantics).
    4. ``run_task(task, replay_artifact)`` — one-shot wrapper that returns
       a ``BenchmarkResult`` ready for the Convex ``recordRun`` mutation.

BFCL v3 categories we care about (per JUDGE_EVAL_BENCHMARKS.md):
    simple     — single call, single candidate
    multiple   — pick correct function from N candidates (one call)
    parallel   — multiple calls in one turn
    multi_turn — stateful multi-turn interaction (closest to DaaS)
    live       — real-world production traces

50 tasks/category = 250 eval points per full sweep.

Source: https://gorilla.cs.berkeley.edu/blogs/13_bfcl_v3_multi_turn.html
Dataset: https://huggingface.co/datasets/gorilla-llm/Berkeley-Function-Calling-Leaderboard
License: Apache 2.0
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from time import time
from typing import Any, Iterable

from daas.benchmarks import BenchmarkResult

# BFCL dataset cache lives alongside other benchmark data so one
# `.gitignore daas/benchmarks/_cache/` covers all five benchmarks.
BFCL_CACHE_DIR = Path(__file__).resolve().parent.parent / "_cache" / "bfcl_v3"

# Subset of BFCL categories we will score against. Order reflects
# judge-eval priority: tool-parity first, then multi-turn stateful.
BFCL_CATEGORIES = (
    "simple",
    "multiple",
    "parallel",
    "multi_turn",
    "live",
)

# HuggingFace repo id — the canonical BFCL dataset.
BFCL_HF_REPO = "gorilla-llm/Berkeley-Function-Calling-Leaderboard"


# ---------------------------------------------------------------------------
# Task loading
# ---------------------------------------------------------------------------


def _cache_path(category: str) -> Path:
    return BFCL_CACHE_DIR / f"{category}.jsonl"


def load_tasks(
    category: str,
    limit: int = 50,
    *,
    force_refresh: bool = False,
) -> list[dict[str, Any]]:
    """Load ``limit`` tasks from the given BFCL category.

    BFCL v3 ships as per-category JSON files in the HF repo root (e.g.
    ``BFCL_v3_simple.json``) — NOT as HF Hub splits with a unified
    schema. The ``datasets`` library's auto-loader chokes because
    columns differ across files, so we pull raw JSON via
    ``huggingface_hub.hf_hub_download`` and parse it ourselves.

    Tasks expose (at minimum) these fields — the exact BFCL v3 schema::

        id              : str           # e.g. "simple_42"
        question        : list[dict]    # chat-format prompt
        function        : list[dict]    # candidate tool specs
        ground_truth    : list[dict]    # expected {name, arguments}
    """
    if category not in BFCL_CATEGORIES:
        raise ValueError(
            f"unknown BFCL category {category!r}; expected one of {BFCL_CATEGORIES}"
        )

    BFCL_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    cached = _cache_path(category)

    if cached.exists() and not force_refresh:
        with cached.open("r", encoding="utf-8") as fh:
            rows = [json.loads(line) for line in fh if line.strip()]
        if rows:
            return rows[:limit]

    try:
        from huggingface_hub import hf_hub_download  # type: ignore
    except ImportError as exc:  # pragma: no cover - env-dependent
        raise RuntimeError(
            "BFCL dataset requires `huggingface_hub`. "
            "Install with: pip install huggingface_hub"
        ) from exc

    # BFCL v3 splits questions from answers — questions live at the repo
    # root, answers live under ``possible_answer/`` with the same filename.
    # Both are JSONL (one task per line) despite the .json suffix. We
    # download both and merge on ``id`` so downstream scoring has real
    # ground truth (otherwise empty-expected -> silent 100% pass).
    file_map = {
        "simple": "BFCL_v3_simple.json",
        "multiple": "BFCL_v3_multiple.json",
        "parallel": "BFCL_v3_parallel.json",
        "multi_turn": "BFCL_v3_multi_turn_base.json",
        "live": "BFCL_v3_live_simple.json",
    }
    filename = file_map[category]
    questions_path = hf_hub_download(
        repo_id=BFCL_HF_REPO, filename=filename, repo_type="dataset"
    )
    try:
        answers_path: str | None = hf_hub_download(
            repo_id=BFCL_HF_REPO,
            filename=f"possible_answer/{filename}",
            repo_type="dataset",
        )
    except Exception:
        # ``live`` categories sometimes lack an answer file in the public
        # mirror. Surface the gap honestly rather than fake a pass.
        answers_path = None

    def _parse_jsonl(path: str) -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = []
        with open(path, "r", encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                try:
                    out.append(json.loads(line))
                except json.JSONDecodeError:
                    continue  # HONEST_STATUS: skip malformed, never pretend
        return out

    questions = _parse_jsonl(questions_path)
    answers_by_id: dict[str, dict[str, Any]] = {}
    if answers_path is not None:
        for a in _parse_jsonl(answers_path):
            aid = a.get("id")
            if aid:
                answers_by_id[aid] = a

    rows: list[dict[str, Any]] = []
    for q in questions:
        qid = q.get("id")
        merged = dict(q)
        if qid and qid in answers_by_id:
            ans = answers_by_id[qid]
            # BFCL answer files put the call list under ``ground_truth`` —
            # copy verbatim so the scorer sees it.
            if "ground_truth" in ans:
                merged["ground_truth"] = ans["ground_truth"]
            elif "possible_answer" in ans:
                merged["ground_truth"] = ans["possible_answer"]
        rows.append(merged)
        if len(rows) >= limit:
            break

    with cached.open("w", encoding="utf-8") as fh:
        for row in rows:
            fh.write(json.dumps(row, ensure_ascii=False) + "\n")
    return rows


# ---------------------------------------------------------------------------
# Format translation
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class BfclCall:
    """Single function-call in BFCL's native shape."""

    name: str
    arguments: dict[str, Any]

    def as_dict(self) -> dict[str, Any]:
        return {"name": self.name, "arguments": self.arguments}


def to_bfcl_format(replay_artifact: dict[str, Any]) -> list[BfclCall]:
    """Translate a DaaS replay artifact into BFCL's native call list.

    Accepted input shapes:

    1. Canonical DaaS replay output::

           {
             "toolCalls": [
               {"worker": "...", "tool": "search_code", "args": {...}},
               ...
             ]
           }

    2. Legacy / shorthand::

           {"calls": [{"name": "search_code", "arguments": {...}}, ...]}

    3. Already-BFCL list::

           [{"name": "search_code", "arguments": {...}}, ...]

    Returns an ordered list of ``BfclCall`` instances. Order matters for
    ``parallel`` and ``multi_turn`` categories.
    """
    if isinstance(replay_artifact, list):
        # Already-BFCL list
        return [BfclCall(name=c["name"], arguments=dict(c.get("arguments", {}))) for c in replay_artifact]

    if "calls" in replay_artifact:
        raw_calls = replay_artifact["calls"]
        return [
            BfclCall(name=c["name"], arguments=dict(c.get("arguments", {})))
            for c in raw_calls
        ]

    if "toolCalls" in replay_artifact:
        out: list[BfclCall] = []
        for c in replay_artifact["toolCalls"]:
            name = c.get("tool") or c.get("name")
            if not name:
                continue  # skip malformed — BFCL treats missing-name as a miss
            out.append(BfclCall(name=str(name), arguments=dict(c.get("args") or c.get("arguments") or {})))
        return out

    raise ValueError(
        f"unrecognized replay artifact shape; keys={list(replay_artifact.keys())}"
    )


# ---------------------------------------------------------------------------
# Scoring (ground-truth AST comparison)
# ---------------------------------------------------------------------------


def _args_match(expected: dict[str, Any], actual: dict[str, Any]) -> bool:
    """BFCL AST-match semantics for arguments.

    Two accepted shapes for ``expected``:

    1. **Internal / test shape** — scalar values::

           {"x": 1, "verbose": "<optional>"}

       All keys in ``expected`` must be present in ``actual`` and compared
       with ``==``. ``"<optional>"`` is a wildcard matching any value.

    2. **BFCL v3 possible_answer shape** — value is a list of acceptable
       values (one of them must match; empty string in the list means the
       argument is optional and may be absent)::

           {"unit": ["units", ""]}         # either "units" or omitted
           {"base": [10]}                  # must be 10

       Empty string in the list is BFCL's "optional / may be omitted"
       sentinel. If ``actual`` omits the key AND the expected list
       contains ``""`` or ``None``, that's a match.
    """
    for key, expected_val in expected.items():
        if isinstance(expected_val, list):
            # BFCL v3 shape: any-of
            allows_missing = ("" in expected_val) or (None in expected_val)
            if key not in actual:
                if allows_missing:
                    continue
                return False
            if actual[key] not in expected_val:
                # Direct membership failed — try lax numeric/string compare
                # (BFCL tolerates 10 == "10" in many cases).
                if not any(_loose_eq(actual[key], ev) for ev in expected_val):
                    return False
        else:
            # Internal / test shape: scalar compare
            if key not in actual:
                return False
            if isinstance(expected_val, str) and expected_val == "<optional>":
                continue
            if expected_val != actual[key]:
                return False
    return True


def _loose_eq(a: Any, b: Any) -> bool:
    """BFCL-style loose equality: numeric coercion + whitespace-insensitive."""
    if a == b:
        return True
    try:
        if float(a) == float(b):
            return True
    except (TypeError, ValueError):
        pass
    if isinstance(a, str) and isinstance(b, str):
        return a.strip().lower() == b.strip().lower()
    return False


def _normalize_expected(expected: Any) -> list[dict[str, Any]]:
    """Convert BFCL v3 possible_answer shape to internal [{name, arguments}].

    Accepts either:
      * Already-internal: ``[{"name": "f", "arguments": {...}}, ...]``
      * BFCL v3 shape:    ``[{"f": {"x": [1], "y": ["a", ""]}}, ...]``

    Returns a list of ``{name, arguments}`` dicts where ``arguments``
    values may be lists (BFCL any-of) or scalars (internal).
    """
    if not isinstance(expected, list):
        raise TypeError(f"expected a list, got {type(expected).__name__}")
    out: list[dict[str, Any]] = []
    for entry in expected:
        if not isinstance(entry, dict):
            raise TypeError(f"expected dict entries, got {type(entry).__name__}")
        if "name" in entry and "arguments" in entry:
            out.append({"name": entry["name"], "arguments": dict(entry["arguments"])})
            continue
        # BFCL v3 shape: single key = function name, value = args dict
        if len(entry) != 1:
            raise ValueError(
                f"ambiguous BFCL entry shape (keys: {list(entry.keys())})"
            )
        (fn_name, args_dict), = entry.items()
        out.append({"name": fn_name, "arguments": dict(args_dict) if isinstance(args_dict, dict) else {}})
    return out


def score_calls(
    expected: list[dict[str, Any]] | Any,
    actual: list[BfclCall] | list[dict[str, Any]],
) -> tuple[bool, float, dict[str, Any]]:
    """Compare expected vs. actual call lists using BFCL AST semantics.

    Returns ``(passed, score, detail)``:
      * ``passed`` is True iff every expected call has a matching actual
        call (name + args) — this is BFCL's own pass condition.
      * ``score`` is ``matched / len(expected)`` (0..1). Surfaces partial
        credit for triage even though ``passed`` stays binary.
      * ``detail`` breaks down per-expected-call for the raw_result blob.

    Accepts both the internal ``[{name, arguments}]`` shape and the native
    BFCL v3 ``[{fn_name: {arg: [vals]}}]`` shape — ``_normalize_expected``
    handles the conversion.
    """
    # Normalize expected shape first so the rest of the logic is uniform.
    expected_norm = _normalize_expected(expected) if expected else []

    # Normalize actual → list of {name, arguments}
    actual_calls: list[dict[str, Any]] = []
    for c in actual:
        if isinstance(c, BfclCall):
            actual_calls.append(c.as_dict())
        else:
            actual_calls.append({"name": c["name"], "arguments": dict(c.get("arguments", {}))})

    if not expected_norm:
        return (True, 1.0, {"mode": "empty_expected", "actual_count": len(actual_calls)})

    # Prefer bfcl_eval if installed AND its heavy transitive deps resolve —
    # its comparator handles edge cases (nested multi_turn, parallel
    # permutations) beyond the minimal local fallback. In practice the
    # bfcl-eval wheel pulls in `qwen_agent` which requires `soundfile`;
    # when that chain is broken we silently fall back to the local
    # comparator below (which is AST-equivalent for the simple/multiple/
    # parallel categories we currently target).
    try:
        from bfcl_eval.eval_checker.ast_eval import (  # type: ignore
            ast_checker as _ast_checker,
        )

        check = _ast_checker.ast_checker(  # type: ignore[attr-defined]
            func_call=actual_calls,
            possible_answer=expected,
        )
        ok = bool(check.get("valid"))
        score = 1.0 if ok else 0.0
        return (ok, score, {"mode": "bfcl_eval", "check": check})
    except (ImportError, AttributeError):
        pass  # fall through to local implementation

    matched_idx: set[int] = set()
    detail_rows: list[dict[str, Any]] = []
    for exp in expected_norm:
        hit = False
        for i, act in enumerate(actual_calls):
            if i in matched_idx:
                continue
            if act["name"] != exp["name"]:
                continue
            if _args_match(exp.get("arguments", {}), act.get("arguments", {})):
                matched_idx.add(i)
                hit = True
                detail_rows.append({"expected": exp, "actual_idx": i, "match": True})
                break
        if not hit:
            detail_rows.append({"expected": exp, "actual_idx": None, "match": False})

    matched = sum(1 for r in detail_rows if r["match"])
    score = matched / len(expected_norm)
    passed = matched == len(expected_norm)
    return (
        passed,
        score,
        {
            "mode": "local_ast",
            "matched": matched,
            "expected_count": len(expected_norm),
            "actual_count": len(actual_calls),
            "rows": detail_rows,
        },
    )


def run_task(
    task: dict[str, Any],
    replay_artifact: dict[str, Any],
    *,
    task_id_key: str = "id",
) -> BenchmarkResult:
    """Run one BFCL task against a replay artifact, return deterministic verdict.

    The benchmark harness's own boolean is the source of truth. We never
    synthesize a pass value when the comparator said fail.
    """
    started = time()
    try:
        actual = to_bfcl_format(replay_artifact)
        expected = task.get("ground_truth") or task.get("possible_answer")
        if expected is None:
            # HONEST_STATUS: a task with no ground_truth is a data-integrity
            # gap, not a trivial pass. The merger failed to attach answers —
            # surface it as a harness error so the eval rollup is honest.
            return BenchmarkResult(
                benchmark_id="bfcl_v3",
                task_id=str(task.get(task_id_key, "<missing_id>")),
                passed=False,
                score=0.0,
                raw_result={"actual": [c.as_dict() for c in actual]},
                harness_error="missing_ground_truth: answer file not merged; check possible_answer/ download",
            )
        passed, score, detail = score_calls(expected, actual)
        raw_result: dict[str, Any] = {
            "expected": expected,
            "actual": [c.as_dict() for c in actual],
            "detail": detail,
        }
        # Preserve upstream replay telemetry (model, cost, duration, error)
        # so the runner can roll up per-task cost/latency without another
        # data path. Live-mode scripts put this under ``_meta``.
        meta = replay_artifact.get("_meta") if isinstance(replay_artifact, dict) else None
        if isinstance(meta, dict):
            raw_result["_meta"] = meta
        # If the upstream replay itself errored (API failure, etc.), surface
        # it as harness_error too — a network-failed replay is NOT a
        # scaffold failure on the underlying task.
        meta_error = meta.get("error") if isinstance(meta, dict) else None
        return BenchmarkResult(
            benchmark_id="bfcl_v3",
            task_id=str(task.get(task_id_key, "<missing_id>")),
            passed=passed,
            score=score,
            raw_result=raw_result,
            harness_error=str(meta_error) if meta_error else None,
        )
    except Exception as exc:
        return BenchmarkResult(
            benchmark_id="bfcl_v3",
            task_id=str(task.get(task_id_key, "<missing_id>")),
            passed=False,
            score=0.0,
            raw_result={"elapsed_ms": int((time() - started) * 1000)},
            harness_error=f"{type(exc).__name__}: {exc}",
        )


def run_suite(
    categories: Iterable[str] = BFCL_CATEGORIES,
    per_category: int = 50,
    *,
    replay_fn=None,
) -> list[BenchmarkResult]:
    """Run a full BFCL subset.

    ``replay_fn(task) -> dict`` must be provided — it is the DaaS pipeline
    caller's responsibility to produce a replay artifact for each task.
    This keeps the adapter reusable across dispatch targets (local Python
    replay, Convex action, synthetic golden calls, etc.).
    """
    if replay_fn is None:
        raise ValueError(
            "run_suite requires replay_fn(task) -> replay_artifact. "
            "See daas.replay for the live implementation, or pass a mock "
            "for unit tests."
        )
    results: list[BenchmarkResult] = []
    for category in categories:
        tasks = load_tasks(category=category, limit=per_category)
        for task in tasks:
            artifact = replay_fn(task)
            results.append(run_task(task, artifact))
    return results
