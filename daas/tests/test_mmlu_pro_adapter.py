"""Tests for the MMLU-Pro adapter — offline, no HF / API calls.

Covers:
  * extract_letter: the four common response shapes + failure fallback
  * run_task: happy path, wrong letter, missing answer key, missing meta
  * Case-insensitivity: "a" as answer normalizes to "A"
"""

from __future__ import annotations

import pytest

from daas.benchmarks.mmlu_pro.runner import extract_letter, run_task


# ---------------------------------------------------------------------------
# extract_letter
# ---------------------------------------------------------------------------


def test_extract_letter_answer_is_pattern() -> None:
    assert extract_letter("So the answer is C.") == "C"


def test_extract_letter_final_answer_pattern() -> None:
    assert extract_letter("Final answer: D") == "D"


def test_extract_letter_boxed_latex() -> None:
    assert extract_letter("Therefore \\boxed{B}.") == "B"


def test_extract_letter_parenthesized_choice() -> None:
    assert extract_letter("We pick option (F).") == "F"


def test_extract_letter_lowercase_coerced_upper() -> None:
    assert extract_letter("The answer is g") == "G"


def test_extract_letter_no_canonical_context_returns_none() -> None:
    # CoT that doesn't use canonical "answer is X" form — we deliberately
    # return None rather than guess the last letter. Prompt pushes the
    # model toward canonical form, and silently-guessing inflates accuracy.
    assert extract_letter("Between B and H, we prefer H.") is None


def test_extract_letter_bare_letter_last_line_ok() -> None:
    # If the WHOLE last line is a bare letter, that's canonical enough
    assert extract_letter("Some reasoning\n\nE") == "E"
    assert extract_letter("Reasoning\n(F)") == "F"
    assert extract_letter("Reasoning\nG.") == "G"


def test_extract_letter_empty_returns_none() -> None:
    assert extract_letter("") is None
    assert extract_letter(None) is None  # type: ignore[arg-type]


def test_extract_letter_no_letter_returns_none() -> None:
    assert extract_letter("I do not know.") is None


def test_extract_letter_beyond_j_ignored() -> None:
    # MMLU-Pro uses A-J; K+ must NOT match
    assert extract_letter("The answer is K") is None


# ---------------------------------------------------------------------------
# run_task
# ---------------------------------------------------------------------------


def _task(answer: str, **extra: object) -> dict[str, object]:
    base = {
        "question_id": 42,
        "question": "stub",
        "options": [f"opt-{i}" for i in range(10)],
        "answer": answer,
        "category": "test",
    }
    base.update(extra)
    return base


def _artifact(letter: str | None, err: str | None = None) -> dict[str, object]:
    return {
        "answer_letter": letter,
        "response_text": "stub",
        "_meta": {
            "model": "test",
            "input_tokens": 0,
            "output_tokens": 0,
            "cost_usd": 0.0,
            "duration_ms": 1,
            "error": err,
        },
    }


def test_run_task_exact_match_passes() -> None:
    r = run_task(_task("C"), _artifact("C"))
    assert r.passed is True
    assert r.score == 1.0
    assert r.benchmark_id == "mmlu_pro"
    assert r.task_id == "42"


def test_run_task_wrong_letter_fails() -> None:
    r = run_task(_task("C"), _artifact("D"))
    assert r.passed is False
    assert r.score == 0.0


def test_run_task_case_insensitive_match() -> None:
    r = run_task(_task("c"), _artifact("C"))
    assert r.passed is True


def test_run_task_missing_letter_fails() -> None:
    r = run_task(_task("C"), _artifact(None))
    assert r.passed is False
    assert r.score == 0.0


def test_run_task_api_error_surfaces_as_harness_error() -> None:
    r = run_task(_task("C"), _artifact(None, err="HTTPError 500: rate limited"))
    assert r.passed is False
    assert r.harness_error is not None
    assert "rate limited" in r.harness_error


def test_run_task_missing_ground_truth_is_harness_error() -> None:
    # A task without `answer` is a data gap, not a trivial pass (HONEST_STATUS)
    t = {"question_id": 7, "question": "stub", "options": ["x"] * 10}
    r = run_task(t, _artifact("A"))
    assert r.passed is False
    assert r.harness_error == "missing_answer_key"
