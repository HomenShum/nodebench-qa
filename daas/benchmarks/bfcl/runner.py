"""BFCL v3 task loader + AST comparator adapter.

Integration path:
    1. ``load_tasks(category, limit)`` — pull N tasks from the HuggingFace
       dataset (cached locally).
    2. ``to_bfcl_format(replay_artifact)`` — translate DaaS replay output
       (``{worker, tool, args}[]``) into BFCL's expected call shape.
    3. ``run_task(task, replay_artifact)`` — invoke ``bfcl-eval``'s AST
       comparator, return a ``BenchmarkResult``.

BFCL categories of interest (per JUDGE_EVAL_BENCHMARKS.md):
    - ``simple`` — single-turn expert-curated
    - ``multiple`` — pick correct function from multiple candidates
    - ``parallel`` — emit multiple calls in one turn
    - ``multi_turn`` — stateful multi-turn (closest to DaaS scaffolds)
    - ``live`` — real-world production traces

We aim for 50 tasks per category = 250 eval points.

This file is a SCAFFOLD — the real comparator wiring lands in the
implementation PR. Every function raises ``NotImplementedError`` with a
pointer so the integration work is traceable.
"""

from __future__ import annotations

from pathlib import Path
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


def load_tasks(category: str, limit: int = 50) -> list[dict[str, Any]]:
    """Load ``limit`` tasks from the given BFCL category.

    Pull path (to implement):
        1. ``from datasets import load_dataset``
        2. ``ds = load_dataset("gorilla-llm/Berkeley-Function-Calling-Leaderboard", split=category)``
        3. ``return list(ds.select(range(limit)))``

    Cache the resulting JSONL to ``BFCL_CACHE_DIR / f"{category}.jsonl"``
    so offline runs work.
    """
    if category not in BFCL_CATEGORIES:
        raise ValueError(
            f"unknown BFCL category {category!r}; expected one of {BFCL_CATEGORIES}"
        )
    raise NotImplementedError(
        "TODO(bfcl): wire HuggingFace dataset pull + local JSONL cache. "
        "See daas/benchmarks/bfcl/runner.py::load_tasks."
    )


def to_bfcl_format(replay_artifact: dict[str, Any]) -> list[dict[str, Any]]:
    """Translate a DaaS replay artifact into BFCL's expected call shape.

    DaaS replay emits::

        {
          "workersDispatched": ["BugLocator", "PatchProposer"],
          "toolCalls": [
            {"worker": "BugLocator", "tool": "search_code", "args": {...}},
            ...
          ]
        }

    BFCL expects (per bfcl-eval AST comparator)::

        [
          {"name": "search_code", "arguments": {...}},
          ...
        ]

    Nested tool-call structures (multi_turn) need per-turn grouping;
    parallel calls stay flat within a turn.
    """
    raise NotImplementedError(
        "TODO(bfcl): shape mapping. Tests: daas/tests/test_bfcl_format.py"
    )


def run_task(
    task: dict[str, Any],
    replay_artifact: dict[str, Any],
) -> BenchmarkResult:
    """Run one BFCL task against a replay artifact, return deterministic verdict.

    Invokes ``bfcl_eval.ast_checker`` (or the current public entrypoint —
    verify against installed version) with:
        - expected: ``task["ground_truth"]``
        - actual: ``to_bfcl_format(replay_artifact)``

    Returns ``BenchmarkResult.passed`` = True iff AST match is exact for
    single/parallel, or structurally compatible for multi_turn.
    """
    raise NotImplementedError(
        "TODO(bfcl): invoke bfcl_eval.ast_checker; write daas/tests/test_bfcl_runner.py"
    )


def run_suite(
    categories: Iterable[str] = BFCL_CATEGORIES,
    per_category: int = 50,
) -> list[BenchmarkResult]:
    """Run the full BFCL subset and return flat result list.

    Scaffold only — real implementation dispatches each task through
    the DaaS replay pipeline then scores via ``run_task``.
    """
    raise NotImplementedError(
        "TODO(bfcl): orchestrate distill -> replay -> score loop. "
        "Reuses daas.replay.replay_trace for each task."
    )
