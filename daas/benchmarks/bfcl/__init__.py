"""BFCL v3 adapter — AST-level function call comparison.

Source: https://gorilla.cs.berkeley.edu/leaderboard.html
Dataset: https://huggingface.co/datasets/gorilla-llm/Berkeley-Function-Calling-Leaderboard
License: Apache 2.0

Why this first: our replay already produces tool-call sequences.
BFCL's AST comparator is exactly the `tool-call parity` check the
DaaS judge currently handles only weakly.

Install: ``pip install bfcl-eval``

Usage::

    from daas.benchmarks.bfcl import run_task, load_tasks

    for task in load_tasks(category="simple", limit=50):
        result = run_task(task, replay_artifact)
        # result.passed  — from AST comparator, no LLM in the loop
        # result.score   — ratio of matched calls

The adapter is intentionally decoupled from Convex writes. The runner
(``daas/benchmarks/runner.py``) handles persistence.
"""

from daas.benchmarks.bfcl.runner import (
    load_tasks,
    run_task,
    to_bfcl_format,
)

__all__ = ["load_tasks", "run_task", "to_bfcl_format"]
