"""MMLU-Pro adapter — 10-option multiple choice reasoning eval.

Source: https://huggingface.co/datasets/TIGER-Lab/MMLU-Pro
License: MIT

Per JUDGE_EVAL_BENCHMARKS.md this is the regression-canary benchmark:
cheap (≈$0.0002/task on Flash Lite), deterministic letter-match scoring,
and covers 14 subject domains. We use it here as the Pro-vs-Flash-Lite
divergence check — the BFCL saturation finding showed we need a harder
reasoning benchmark to validate the "distill from big model" thesis.
"""

from daas.benchmarks.mmlu_pro.runner import (
    extract_letter,
    load_tasks,
    live_replay,
    run_task,
)

__all__ = ["extract_letter", "load_tasks", "live_replay", "run_task"]
