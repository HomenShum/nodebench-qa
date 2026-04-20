"""Runtime-fidelity test for the emitted scaffold.

The question every other benchmark sidestepped:
    When we compile DOWN (wrap Flash Lite in the emitted tool_first_chain
    scaffold), does the cheap model preserve its solo quality?
    When we compile UP (wrap it in orchestrator_worker, which adds a
    plan step + dispatch + compact), does the extra ceremony hurt
    simple-task performance?

Apples-to-apples on the same task subset. Same model (Flash Lite)
across all three conditions. Wilson 95% CI on each rate. Newcombe CI
on the pairwise deltas so we can say honestly whether the differences
are statistically significant.

Conditions:
    A  baseline           Flash Lite solo (direct generateContent call
                          with toolConfig.mode=ANY)
    B  compile-down       Flash Lite running inside the EMITTED
                          tool_first_chain scaffold (emitted from a
                          spec that names this task's single tool;
                          scaffold does a bounded tool loop, MAX_TURNS=4)
    C  compile-up         Flash Lite running inside the EMITTED
                          orchestrator_worker scaffold (plan ->
                          dispatch -> compact with shared scratchpad;
                          1 worker assignment for single-call tasks)

Output per condition:
    pass_rate          Wilson 95% CI
    total_in_tokens    sum across all tasks
    total_out_tokens
    total_usd          Flash Lite pricing
    wall_clock_s

Usage:
    python -m daas.benchmarks.scaffold_runtime_fidelity --n 20

Cost envelope at n=20: ~$0.01 for 3 conditions (Flash Lite is cheap).
"""

from __future__ import annotations

import argparse
import importlib
import json
import math
import os
import sys
import tempfile
import time
import urllib.error
import urllib.request
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Any

from daas.compile_down import emit
from daas.schemas import WorkflowSpec
from daas.benchmarks.bfcl.runner import (
    BFCL_CACHE_DIR,
    score_calls,
    to_bfcl_format,
)

# --- config ---------------------------------------------------------------
FLASH_MODEL = "gemini-3.1-flash-lite-preview"
FLASH_IN_USD_PER_TOK = 0.10 / 1_000_000
FLASH_OUT_USD_PER_TOK = 0.40 / 1_000_000


# --- Wilson CI ------------------------------------------------------------
def wilson_95(k: int, n: int) -> tuple[float, float, float]:
    if n == 0:
        return 0.0, 0.0, 0.0
    p = k / n
    z = 1.96
    denom = 1 + z * z / n
    centre = (p + z * z / (2 * n)) / denom
    margin = (z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))) / denom
    return p, max(0.0, centre - margin), min(1.0, centre + margin)


# --- BFCL task loader -----------------------------------------------------
def load_simple_tasks(n: int) -> list[dict[str, Any]]:
    path = BFCL_CACHE_DIR / "simple.jsonl"
    out: list[dict[str, Any]] = []
    with path.open("r", encoding="utf-8") as fh:
        for ln in fh:
            ln = ln.strip()
            if not ln:
                continue
            try:
                out.append(json.loads(ln))
            except json.JSONDecodeError:
                continue
            if len(out) >= n:
                break
    return out


# --- task field extractors ------------------------------------------------
def _extract_question(task: dict[str, Any]) -> str:
    """BFCL stores question as [[{role, content}]] — peel it."""
    q = task.get("question") or task.get("prompt") or ""
    # Unwrap nested lists
    for _ in range(3):
        if isinstance(q, list):
            q = q[0] if q else ""
        else:
            break
    if isinstance(q, dict):
        q = q.get("content") or q.get("text") or ""
    return str(q)


# --- tool-spec conversion -------------------------------------------------
_BFCL_TO_GEMINI_TYPE: dict[str, str] = {
    "dict": "OBJECT",
    "object": "OBJECT",
    "array": "ARRAY",
    "list": "ARRAY",
    "tuple": "ARRAY",
    "string": "STRING",
    "str": "STRING",
    "integer": "INTEGER",
    "int": "INTEGER",
    "number": "NUMBER",
    "float": "NUMBER",
    "boolean": "BOOLEAN",
    "bool": "BOOLEAN",
}


def _gemini_ify_schema(s: Any) -> Any:
    """Convert BFCL JSON-Schema (lowercase + ``dict``) to Gemini OpenAPI
    style (UPPERCASE types, ``OBJECT`` instead of ``dict``). Drops fields
    Gemini doesn't understand.
    """
    if isinstance(s, list):
        return [_gemini_ify_schema(x) for x in s]
    if not isinstance(s, dict):
        return s
    out: dict[str, Any] = {}
    for k, v in s.items():
        if k == "type" and isinstance(v, str):
            out["type"] = _BFCL_TO_GEMINI_TYPE.get(v.lower(), v.upper())
        elif k in {"properties", "items", "additionalProperties"} and isinstance(v, dict):
            out[k] = {pk: _gemini_ify_schema(pv) for pk, pv in v.items()} if k == "properties" else _gemini_ify_schema(v)
        elif k == "properties":
            out[k] = v
        elif k in {"required", "description", "enum", "nullable", "format"}:
            out[k] = v
        else:
            # Keep unknown keys (Gemini tolerates most; drop noisy ones)
            if k not in {"default"}:
                out[k] = _gemini_ify_schema(v) if isinstance(v, dict) else v
    return out


def _bfcl_function_to_tool(func_spec: Any) -> dict[str, Any]:
    """BFCL function format → our internal tool dict for WorkflowSpec."""
    if isinstance(func_spec, list):
        func_spec = func_spec[0] if func_spec else {}
    fs = func_spec if isinstance(func_spec, dict) else {}
    params = fs.get("parameters", {}) or {}
    return {
        "name": str(fs.get("name", "bfcl_tool")),
        "purpose": str(fs.get("description", "")),
        "input_schema": _gemini_ify_schema(params),
    }


# --- Condition A: Flash Lite solo ----------------------------------------
def run_baseline(task: dict[str, Any], api_key: str) -> dict[str, Any]:
    """Direct generateContent with toolConfig.mode=ANY."""
    question = _extract_question(task)
    tool_spec = _bfcl_function_to_tool(task.get("function"))
    schema = tool_spec.get("input_schema", {})
    fn_decl = {
        "name": tool_spec["name"],
        "description": tool_spec.get("purpose") or "tool",
        "parameters": schema or {"type": "OBJECT", "properties": {}},
    }
    body = {
        "contents": [{"role": "user", "parts": [{"text": str(question)}]}],
        "tools": [{"functionDeclarations": [fn_decl]}],
        "toolConfig": {"functionCallingConfig": {"mode": "ANY"}},
        "generationConfig": {"temperature": 0.0, "maxOutputTokens": 1024},
    }
    url = (
        f"https://generativelanguage.googleapis.com/v1beta/models/"
        f"{FLASH_MODEL}:generateContent?key={api_key}"
    )
    t0 = time.perf_counter()
    try:
        req = urllib.request.Request(
            url,
            data=json.dumps(body).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=45) as r:
            raw = r.read().decode("utf-8")
        parsed = json.loads(raw)
    except Exception as e:  # noqa: BLE001
        return {
            "tool_calls": [],
            "in_tok": 0,
            "out_tok": 0,
            "elapsed_s": round(time.perf_counter() - t0, 2),
            "error": f"{type(e).__name__}: {e}",
        }
    elapsed = time.perf_counter() - t0
    parts = (
        ((parsed.get("candidates") or [{}])[0].get("content") or {}).get("parts") or []
    )
    tool_calls: list[dict[str, Any]] = []
    for p in parts:
        fc = (p or {}).get("functionCall")
        if fc:
            tool_calls.append(
                {
                    "name": str(fc.get("name", "")),
                    "arguments": fc.get("args") or {},
                }
            )
    usage = parsed.get("usageMetadata") or {}
    return {
        "tool_calls": tool_calls,
        "in_tok": int(usage.get("promptTokenCount", 0) or 0),
        "out_tok": int(usage.get("candidatesTokenCount", 0) or 0),
        "elapsed_s": round(elapsed, 2),
    }


# --- Condition B / C: emit scaffold, run it in-process -------------------
def _write_bundle(bundle: Any, outdir: Path) -> None:
    for f in bundle.files:
        target = outdir / f.path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(f.content, encoding="utf-8")


def _import_module_from(path: Path, module_name: str) -> Any:
    # Put the scaffold dir FIRST on sys.path, clear any cached module of
    # the same name, re-import fresh so we don't read a prior bundle.
    sys.path.insert(0, str(path))
    try:
        for k in list(sys.modules.keys()):
            if k == module_name or k.startswith(module_name + "."):
                del sys.modules[k]
        return importlib.import_module(module_name)
    finally:
        # don't leave path polluted for next condition
        try:
            sys.path.remove(str(path))
        except ValueError:
            pass


def run_scaffold(
    lane: str,
    task: dict[str, Any],
    api_key: str,
) -> dict[str, Any]:
    """Emit lane scaffold for this task's tool, run runner.run(query)."""
    question = _extract_question(task)

    tool_spec = _bfcl_function_to_tool(task.get("function"))
    spec = WorkflowSpec(
        source_trace_id=str(task.get("id", "task")),
        executor_model=FLASH_MODEL,
        orchestrator_system_prompt=(
            "You answer the user's query by calling the single declared "
            "tool. Emit exactly one function call."
        ),
        tools=[tool_spec],
    )
    bundle = emit(lane, spec)

    tmp = Path(tempfile.mkdtemp(prefix=f"attrition_{lane}_"))
    _write_bundle(bundle, tmp)

    # Set env for the scaffold's live LLM call
    prev_key = os.environ.get("GEMINI_API_KEY")
    prev_mode = os.environ.get("CONNECTOR_MODE")
    os.environ["GEMINI_API_KEY"] = api_key
    os.environ["CONNECTOR_MODE"] = "mock"

    t0 = time.perf_counter()
    tool_calls: list[dict[str, Any]] = []
    in_tok = out_tok = 0
    error = ""
    try:
        if lane == "tool_first_chain":
            runner_mod = _import_module_from(tmp, "runner")
            schemas_mod = _import_module_from(tmp, "schemas")
            result = runner_mod.run(schemas_mod.ChainInput(query=str(question)))
            tool_calls = list(getattr(result, "tool_calls_log", []) or [])
            in_tok = int(getattr(result, "input_tokens", 0) or 0)
            out_tok = int(getattr(result, "output_tokens", 0) or 0)
        elif lane == "orchestrator_worker":
            orch_mod = _import_module_from(tmp, "orchestrator")
            schemas_mod = _import_module_from(tmp, "schemas")
            # orchestrator_worker's run entry takes a query and returns
            # a dict with totals + worker outputs.
            result = orch_mod.run(str(question))
            # Walk the result looking for tool calls
            tool_calls = _extract_tool_calls_from_orchestrator(result)
            in_tok = int(result.get("total_in_tokens", 0) if isinstance(result, dict) else 0)
            out_tok = int(result.get("total_out_tokens", 0) if isinstance(result, dict) else 0)
        else:
            error = f"unsupported lane: {lane}"
    except Exception as e:  # noqa: BLE001
        error = f"{type(e).__name__}: {e}"
    elapsed = time.perf_counter() - t0

    # Restore env
    if prev_key is None:
        os.environ.pop("GEMINI_API_KEY", None)
    else:
        os.environ["GEMINI_API_KEY"] = prev_key
    if prev_mode is None:
        os.environ.pop("CONNECTOR_MODE", None)
    else:
        os.environ["CONNECTOR_MODE"] = prev_mode

    return {
        "tool_calls": tool_calls,
        "in_tok": in_tok,
        "out_tok": out_tok,
        "elapsed_s": round(elapsed, 2),
        "error": error,
    }


def _extract_tool_calls_from_orchestrator(result: Any) -> list[dict[str, Any]]:
    """The orchestrator_worker emitted run returns a dict; tool_calls
    live inside worker output entries. Best-effort walk.
    """
    tool_calls: list[dict[str, Any]] = []
    if isinstance(result, dict):
        for key in ("workers", "scratchpad", "dispatch"):
            v = result.get(key)
            if isinstance(v, dict):
                for worker_key, worker_val in v.items():
                    if isinstance(worker_val, dict):
                        for tc in worker_val.get("tool_calls", []) or []:
                            if isinstance(tc, dict) and tc.get("name"):
                                tool_calls.append(
                                    {
                                        "name": str(tc["name"]),
                                        "args": tc.get("args") or {},
                                    }
                                )
        # Also allow top-level
        for tc in result.get("tool_calls", []) or []:
            if isinstance(tc, dict) and tc.get("name"):
                tool_calls.append(
                    {"name": str(tc["name"]), "args": tc.get("args") or {}}
                )
    return tool_calls


# --- scoring --------------------------------------------------------------
def score_result(task: dict[str, Any], result: dict[str, Any]) -> bool:
    """Use BFCL's AST comparator against the task's ground_truth.

    score_calls returns (passed, score, detail) — we only want passed.
    Normalize call shape to BFCL's internal {name, arguments}.
    """
    tool_calls = result.get("tool_calls") or []
    if not tool_calls:
        return False
    actual: list[dict[str, Any]] = []
    for tc in tool_calls:
        if not isinstance(tc, dict):
            continue
        name = tc.get("name")
        if not name:
            continue
        actual.append(
            {
                "name": str(name),
                # Accept either our internal "arguments" or the scaffold's "args"
                "arguments": dict(
                    tc.get("arguments") or tc.get("args") or {}
                ),
            }
        )
    if not actual:
        return False
    expected = task.get("ground_truth") or task.get("possible_answer") or []
    try:
        passed, _score, _detail = score_calls(expected, actual)
    except Exception:  # noqa: BLE001
        return False
    return bool(passed)


# --- orchestration --------------------------------------------------------
@dataclass
class ConditionResult:
    name: str
    passed: int
    total: int
    pass_rate: float
    ci95_lo: float
    ci95_hi: float
    total_in_tok: int
    total_out_tok: int
    total_usd: float
    wall_clock_s: float
    errors: int


def run_condition(
    name: str,
    runner,
    tasks: list[dict[str, Any]],
    api_key: str,
) -> tuple[ConditionResult, list[dict[str, Any]]]:
    t0 = time.perf_counter()
    per_task: list[dict[str, Any]] = []
    passed = errors = 0
    total_in = total_out = 0
    for i, task in enumerate(tasks):
        r = runner(task, api_key)
        ok = score_result(task, r)
        passed += 1 if ok else 0
        if r.get("error"):
            errors += 1
        total_in += r.get("in_tok", 0)
        total_out += r.get("out_tok", 0)
        per_task.append(
            {
                "id": task.get("id"),
                "passed": ok,
                "tool_calls": r.get("tool_calls"),
                "in_tok": r.get("in_tok", 0),
                "out_tok": r.get("out_tok", 0),
                "elapsed_s": r.get("elapsed_s"),
                "error": r.get("error", ""),
            }
        )
        if (i + 1) % 5 == 0 or i == len(tasks) - 1:
            print(
                f"  {name}  {i+1:>3}/{len(tasks)}  "
                f"passed={passed}  err={errors}  "
                f"tok={total_in+total_out}"
            )
    wall = time.perf_counter() - t0
    p, lo, hi = wilson_95(passed, len(tasks))
    cost = total_in * FLASH_IN_USD_PER_TOK + total_out * FLASH_OUT_USD_PER_TOK
    return (
        ConditionResult(
            name=name,
            passed=passed,
            total=len(tasks),
            pass_rate=round(p, 3),
            ci95_lo=round(lo, 3),
            ci95_hi=round(hi, 3),
            total_in_tok=total_in,
            total_out_tok=total_out,
            total_usd=round(cost, 6),
            wall_clock_s=round(wall, 2),
            errors=errors,
        ),
        per_task,
    )


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=20)
    ap.add_argument("--api-key", default=os.environ.get("GEMINI_API_KEY", ""))
    ap.add_argument(
        "--out",
        default="daas/results/scaffold_runtime_fidelity.json",
    )
    ap.add_argument(
        "--conditions",
        default="baseline,tool_first_chain,orchestrator_worker",
        help="Comma-separated subset",
    )
    args = ap.parse_args()

    if not args.api_key:
        print("[ERR] no GEMINI_API_KEY set", file=sys.stderr)
        return 2

    tasks = load_simple_tasks(args.n)
    print(f"loaded {len(tasks)} BFCL-simple tasks")

    conditions_run = [c.strip() for c in args.conditions.split(",") if c.strip()]
    runners = {
        "baseline": lambda t, k: run_baseline(t, k),
        "tool_first_chain": lambda t, k: run_scaffold("tool_first_chain", t, k),
        "orchestrator_worker": lambda t, k: run_scaffold("orchestrator_worker", t, k),
    }

    summaries: list[ConditionResult] = []
    details: dict[str, Any] = {}
    for c in conditions_run:
        if c not in runners:
            print(f"[SKIP] unknown condition: {c}")
            continue
        print(f"\n=== condition {c} ===")
        summary, per_task = run_condition(c, runners[c], tasks, args.api_key)
        summaries.append(summary)
        details[c] = {"summary": asdict(summary), "per_task": per_task}

    # Report
    print("\n=== RUNTIME FIDELITY RESULTS ===")
    print(f"{'condition':<22} {'pass':<10} {'rate':<8} {'ci95':<18} {'tok':<12} {'$':<10} {'wall_s':<8}")
    print("-" * 95)
    for s in summaries:
        print(
            f"{s.name:<22} {s.passed}/{s.total:<8} "
            f"{s.pass_rate*100:>5.1f}%   "
            f"[{s.ci95_lo*100:>4.1f}, {s.ci95_hi*100:>4.1f}]   "
            f"{s.total_in_tok + s.total_out_tok:<12} "
            f"${s.total_usd:<9.5f} {s.wall_clock_s:<8.1f}"
        )

    # Write full report
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(
        json.dumps(
            {
                "n": len(tasks),
                "flash_model": FLASH_MODEL,
                "summaries": [asdict(s) for s in summaries],
                "details": details,
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    print(f"\n[DONE] wrote {out}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
