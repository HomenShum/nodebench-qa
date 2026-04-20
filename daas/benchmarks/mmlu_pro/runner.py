"""MMLU-Pro task loader + letter-match scorer + live replay.

Task schema (TIGER-Lab/MMLU-Pro):
    question_id : int
    question    : str
    options     : list[str]           # 10 options (A..J)
    answer      : str                 # "A".."J"
    answer_index: int                 # 0..9
    category    : str                 # "law" | "psychology" | "engineering" | ...
    src         : str

Scoring: extract the answer letter from the model's free-text response,
exact-match against `answer`. Deterministic, no LLM judge in the loop.

Why MMLU-Pro as a Pro-vs-Flash divergence check:
    - BFCL is saturated (Δ=0-3pp). Both models ceil.
    - MMLU-Pro is explicitly 10-option (not 4) to resist guessing and
      has dedicated "hard" subjects (law, health, psychology) where
      model-capability lift should be visible.
    - If Pro ALSO doesn't beat Flash Lite here, the "distill from big
      model" thesis has a real problem and we pivot to rule-normalizer.
"""

from __future__ import annotations

import json
import os
import re
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

from daas.benchmarks import BenchmarkResult

MMLU_PRO_REPO = "TIGER-Lab/MMLU-Pro"
MMLU_PRO_CACHE_DIR = Path(__file__).resolve().parent.parent / "_cache" / "mmlu_pro"

GEMINI_FLASH_LITE = "gemini-3.1-flash-lite-preview"
GEMINI_URL_TEMPLATE = (
    "https://generativelanguage.googleapis.com/v1beta/"
    "models/{model}:generateContent?key={key}"
)
GEMINI_TIMEOUT_SECONDS = 30

# Flash Lite pricing (informational only; judge never overrides score with cost).
FLASH_LITE_INPUT_USD_PER_TOK = 0.10 / 1_000_000
FLASH_LITE_OUTPUT_USD_PER_TOK = 0.40 / 1_000_000
# Pro pricing (gemini-3.1-pro-preview as of 2026-04-19)
PRO_INPUT_USD_PER_TOK = 1.25 / 1_000_000
PRO_OUTPUT_USD_PER_TOK = 5.00 / 1_000_000


def _resolve_api_key() -> str:
    key = os.environ.get("GEMINI_API_KEY")
    if key:
        return key
    env_local = Path(
        "D:/VSCode Projects/cafecorner_nodebench/nodebench_ai4/nodebench-ai/.env.local"
    )
    if env_local.exists():
        for line in env_local.read_text(encoding="utf-8").splitlines():
            if line.startswith("GEMINI_API_KEY="):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    raise RuntimeError("GEMINI_API_KEY not set")


# ---------------------------------------------------------------------------
# Task loading — HF parquet / jsonl
# ---------------------------------------------------------------------------


def load_tasks(
    limit: int = 50,
    *,
    category: str | None = None,
    split: str = "test",
    force_refresh: bool = False,
) -> list[dict[str, Any]]:
    """Load `limit` MMLU-Pro tasks (optionally filtered by category).

    HF test split is ~12k rows; we sample the first `limit`, optionally
    after filtering by category so small-n probes stay in-domain.
    """
    MMLU_PRO_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    cache_key = f"{split}_{category or 'all'}.jsonl"
    cached = MMLU_PRO_CACHE_DIR / cache_key

    if cached.exists() and not force_refresh:
        with cached.open("r", encoding="utf-8") as fh:
            rows = [json.loads(line) for line in fh if line.strip()]
        if rows:
            return rows[:limit]

    try:
        from datasets import load_dataset  # type: ignore
    except ImportError as exc:  # pragma: no cover
        raise RuntimeError(
            "MMLU-Pro loader needs `datasets`. pip install datasets"
        ) from exc

    ds = load_dataset(MMLU_PRO_REPO, split=split)
    rows: list[dict[str, Any]] = []
    for item in ds:  # type: ignore[assignment]
        if category and str(item.get("category", "")).lower() != category.lower():
            continue
        rows.append(dict(item))
        if len(rows) >= limit:
            break

    with cached.open("w", encoding="utf-8") as fh:
        for r in rows:
            fh.write(json.dumps(r, ensure_ascii=False) + "\n")
    return rows


# ---------------------------------------------------------------------------
# Answer extraction
# ---------------------------------------------------------------------------


# Pattern list ordered tightest-first. Each captures ONE letter (A-J,
# case-insensitive) inside a recognizable answer context. We deliberately
# DON'T have a "any capital letter anywhere" fallback — that inflates
# extraction by matching pronouns ("I") and section markers ("A.", "B)").
_ANSWER_PATTERNS = [
    re.compile(
        r"\b(?:the\s+)?(?:final\s+)?answer\s+is\s*:?\s*\(?([A-J])\)?",
        re.IGNORECASE,
    ),
    re.compile(r"\\boxed\{\s*([A-J])\s*\}", re.IGNORECASE),
    re.compile(r"\banswer\s*[:=]\s*\(?([A-J])\)?", re.IGNORECASE),
    re.compile(r"\boption\s*\(?([A-J])\)?", re.IGNORECASE),
    # Parenthesized letter — must be uppercase to avoid "(i)" list markers.
    re.compile(r"\(([A-J])\)"),
]


def extract_letter(text: str | None) -> str | None:
    """Parse the answer letter (A..J) out of a free-text model response.

    Only returns a letter when there is unambiguous answer context
    (``"answer is X"``, ``"\\boxed{X}"``, ``"option X"``, ``"(X)"``)
    or the response's last line is a bare single-letter choice. A pronoun
    ("I") or sentence-initial letter does NOT count as an answer.
    """
    if not text:
        return None
    for pat in _ANSWER_PATTERNS:
        m = pat.search(text)
        if m:
            return m.group(1).upper()
    # Last-line fallback — only if the line IS the letter (optionally with
    # a single trailing . or ) or (). Prevents free-text last-word matches.
    last = text.strip().splitlines()[-1].strip() if text.strip() else ""
    bare = re.fullmatch(r"\(?([A-Ja-j])\)?\.?", last)
    if bare:
        return bare.group(1).upper()
    return None


# ---------------------------------------------------------------------------
# Live replay — call Gemini, extract letter
# ---------------------------------------------------------------------------


def _format_prompt(task: dict[str, Any]) -> str:
    options = task.get("options") or []
    letters = "ABCDEFGHIJ"
    opt_block = "\n".join(
        f"{letters[i]}. {opt}" for i, opt in enumerate(options[: len(letters)])
    )
    question = task.get("question", "")
    # CoT-friendly prompt — matches the official MMLU-Pro eval prompt
    return (
        f"Question: {question}\n\n"
        f"Options:\n{opt_block}\n\n"
        f"Think step by step, then state your answer on a new line as "
        f'"The answer is X" where X is the letter (A-J).'
    )


def live_replay(
    task: dict[str, Any],
    *,
    api_key: str | None = None,
    model: str = GEMINI_FLASH_LITE,
) -> dict[str, Any]:
    """Ask Gemini to answer one MMLU-Pro question. No tools, no JSON schema.

    Returns an artifact shape compatible with run_task::

        {
          "answer_letter": "C" | None,
          "response_text": "...full model output...",
          "_meta": {
            "model": str,
            "input_tokens": int,
            "output_tokens": int,
            "cost_usd": float,
            "duration_ms": int,
            "error": str | None,
          }
        }
    """
    key = api_key or _resolve_api_key()
    prompt = _format_prompt(task)

    body = {
        "contents": [{"role": "user", "parts": [{"text": prompt}]}],
        "generationConfig": {
            "temperature": 0.0,
            "maxOutputTokens": 2048,
        },
    }
    url = GEMINI_URL_TEMPLATE.format(model=model, key=key)
    req = urllib.request.Request(
        url,
        data=json.dumps(body).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    started = time.time()
    try:
        with urllib.request.urlopen(req, timeout=GEMINI_TIMEOUT_SECONDS) as resp:
            payload = json.loads(resp.read())
    except urllib.error.HTTPError as exc:
        body_text = exc.read().decode("utf-8", errors="replace")[:512]
        return _error_artifact(model, started, f"HTTPError {exc.code}: {body_text}")
    except Exception as exc:
        return _error_artifact(model, started, f"{type(exc).__name__}: {exc}")
    duration_ms = int((time.time() - started) * 1000)

    text = ""
    candidates = payload.get("candidates") or []
    if candidates:
        parts = (candidates[0].get("content") or {}).get("parts") or []
        text = "".join(str(p.get("text", "")) for p in parts)

    letter = extract_letter(text)

    usage = payload.get("usageMetadata") or {}
    in_tok = int(usage.get("promptTokenCount", 0))
    out_tok = int(usage.get("candidatesTokenCount", 0))
    if "pro" in model:
        cost = in_tok * PRO_INPUT_USD_PER_TOK + out_tok * PRO_OUTPUT_USD_PER_TOK
    else:
        cost = in_tok * FLASH_LITE_INPUT_USD_PER_TOK + out_tok * FLASH_LITE_OUTPUT_USD_PER_TOK

    return {
        "answer_letter": letter,
        "response_text": text,
        "_meta": {
            "model": model,
            "input_tokens": in_tok,
            "output_tokens": out_tok,
            "cost_usd": cost,
            "duration_ms": duration_ms,
            "error": None,
        },
    }


def _error_artifact(model: str, started: float, err: str) -> dict[str, Any]:
    return {
        "answer_letter": None,
        "response_text": "",
        "_meta": {
            "model": model,
            "input_tokens": 0,
            "output_tokens": 0,
            "cost_usd": 0.0,
            "duration_ms": int((time.time() - started) * 1000),
            "error": err,
        },
    }


# ---------------------------------------------------------------------------
# Scoring
# ---------------------------------------------------------------------------


def run_task(task: dict[str, Any], artifact: dict[str, Any]) -> BenchmarkResult:
    """Exact-match letter scoring against `task["answer"]`.

    HONEST_STATUS: an API error or missing letter is passed=False, not a
    silent pass. Ground-truth answer missing -> harness_error.
    """
    expected = task.get("answer")
    task_id = str(task.get("question_id", "<missing>"))
    meta = artifact.get("_meta") if isinstance(artifact, dict) else None
    meta_error = meta.get("error") if isinstance(meta, dict) else None

    if expected is None:
        return BenchmarkResult(
            benchmark_id="mmlu_pro",
            task_id=task_id,
            passed=False,
            score=0.0,
            raw_result={"_meta": meta} if meta else {},
            harness_error="missing_answer_key",
        )

    actual_letter = artifact.get("answer_letter") if isinstance(artifact, dict) else None
    passed = bool(actual_letter and actual_letter.upper() == str(expected).upper())
    return BenchmarkResult(
        benchmark_id="mmlu_pro",
        task_id=task_id,
        passed=passed,
        score=1.0 if passed else 0.0,
        raw_result={
            "expected": expected,
            "actual": actual_letter,
            "category": task.get("category"),
            "_meta": meta,
        },
        harness_error=str(meta_error) if meta_error else None,
    )
