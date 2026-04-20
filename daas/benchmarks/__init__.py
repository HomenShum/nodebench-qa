"""Public-benchmark adapters for DaaS judge eval cycles.

See docs/JUDGE_EVAL_BENCHMARKS.md for ranking + rationale.

Priority ladder (implementation order):
    bfcl       — AST tool-call parity (Day 1-2)
    mmlu_pro   — single-letter exact-match canary (Day 3-4)
    tau2       — DB end-state + expected-action match (Day 5-7)
    swebench   — Docker PASS_TO_PASS / FAIL_TO_PASS unit tests (Day 8-10)
    reportbench — citation precision/recall against ground-truth arrays (Day 11-12)

Each adapter exposes the same interface::

    run_task(task, replay_artifact) -> BenchmarkResult

where ``replay_artifact`` is whatever the DaaS replay produced (tool-call
sequence for BFCL, structured answer for MMLU-Pro, final DB state for
tau2, unified diff for swebench, citations list for reportbench), and
``BenchmarkResult`` is a frozen dataclass with::

    passed: bool          # the harness's own verdict, NO LLM judge
    score: float          # 0..1 harness-native score
    raw_result: dict      # harness output verbatim for audit
    harness_error: str    # set when the harness itself failed
"""

from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class BenchmarkResult:
    """Uniform result shape across all benchmark adapters.

    Mirrors the Convex ``daasBenchmarkRuns`` table so the harness runner
    can write rows without a second transformation.
    """

    benchmark_id: str
    task_id: str
    passed: bool
    score: float
    raw_result: dict[str, Any]
    harness_error: str | None = None


__all__ = ["BenchmarkResult"]
