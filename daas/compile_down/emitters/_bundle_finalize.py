"""Bundle finalizer — makes every emitted bundle a full 9-layer cut.

After the lane-specific emitter returns its ArtifactBundle of Layer 3/4
(+ sometimes Layer 6/9 partials), this module appends files covering
every remaining layer so the bundle is a complete, runnable service:

    Layer 0  workflow_spec.json    explicit serialized spec (regen-ready)
    Layer 2  server.py             FastAPI + SSE wrapper
    Layer 5  state_store.py        SQLite persistence for runs + scratchpad
    Layer 7  eval/scenarios.py     mock-mode smoke tests
    Layer 7  eval/rubric.py        6-boolean judge (LLM-judged, deterministic rollup)
    Layer 8  observability.py      OpenTelemetry hooks (graceful no-op)
    Layer 9  mcp_server.py         MCP endpoint wrapper over tools.dispatch

Plus the "runnable" connective tissue from the prior cycle:
    README.md · requirements.txt · run.sh · .env.example

All files are deterministic functions of (runtime_lane, spec), so the
same spec emits the same bundle on re-run. No network, no LLM.
"""

from __future__ import annotations

import json
from typing import Any

from daas.compile_down.artifact import ArtifactBundle, ArtifactFile


# --- per-lane facts ------------------------------------------------------
_LANE_TITLE: dict[str, str] = {
    "simple_chain": "Simple chain — single LLM call with an output schema",
    "tool_first_chain": "Tool-first chain — bounded LLM + tool-call loop",
    "orchestrator_worker": "Orchestrator-worker — plan -> dispatch -> compact",
    "openai_agents_sdk": "OpenAI Agents SDK translation target",
    "langgraph_python": "LangGraph Python translation target",
}

_LANE_DEPS: dict[str, list[str]] = {
    "simple_chain": [
        "google-genai>=0.7.0",
    ],
    "tool_first_chain": [
        "google-genai>=0.7.0",
    ],
    "orchestrator_worker": [
        "google-genai>=0.7.0",
    ],
    "openai_agents_sdk": [
        "openai>=1.60.0",
        "openai-agents>=0.0.9 ; python_version>='3.10'",
    ],
    "langgraph_python": [
        "langgraph>=0.2.0",
        "langchain>=0.3.0",
        "langchain-google-genai>=2.0.0",
    ],
}

# Optional extras — 9-layer-cut deps. The CORE runtime runs without
# these (server.py / observability.py / mcp_server.py all fall through
# to no-op on ImportError). Installed when the user runs
# `pip install -r requirements-all.txt`.
_EXTRAS_DEPS: list[str] = [
    # Layer 2 — server
    "fastapi>=0.110.0",
    "uvicorn[standard]>=0.29.0",
    # Layer 8 — observability
    "opentelemetry-api>=1.25.0",
    "opentelemetry-sdk>=1.25.0",
    # Layer 9 — MCP server
    "mcp>=1.2.0 ; python_version>='3.10'",
]

_LANE_ENV: dict[str, list[tuple[str, str]]] = {
    "simple_chain": [
        ("GEMINI_API_KEY", "Required — get one at https://aistudio.google.com/apikey"),
        ("CONNECTOR_MODE", "Optional — mock | live | hybrid (defaults to mock)"),
    ],
    "tool_first_chain": [
        ("GEMINI_API_KEY", "Required"),
        ("CONNECTOR_MODE", "Optional — mock | live | hybrid (defaults to mock)"),
        ("CONNECTOR_OVERRIDES", "Optional — JSON: {\"tool_name\": \"live\"} for per-tool overrides in hybrid mode"),
    ],
    "orchestrator_worker": [
        ("GEMINI_API_KEY", "Required — used by plan + per-worker + compact LLM calls"),
        ("CONNECTOR_MODE", "Optional — mock | live | hybrid"),
        ("CONNECTOR_OVERRIDES", "Optional — JSON overrides for hybrid"),
    ],
    "openai_agents_sdk": [
        ("OPENAI_API_KEY", "Required"),
        ("CONNECTOR_MODE", "Optional — mock | live | hybrid"),
    ],
    "langgraph_python": [
        ("GEMINI_API_KEY", "Required — graph LLM node uses Gemini by default"),
        ("CONNECTOR_MODE", "Optional — mock | live | hybrid"),
    ],
}

_LANE_ENTRYPOINT: dict[str, str] = {
    "simple_chain": "main.py",
    "tool_first_chain": "main.py",
    "orchestrator_worker": "orchestrator.py",
    "openai_agents_sdk": "main.py",
    "langgraph_python": "graph.py",
}


# --- 9-layer file builders ----------------------------------------------
def _workflow_spec_json(spec: Any) -> str:
    """Layer 0 — explicit serialized spec (regen-ready).

    Any emitted scaffold can be regenerated from this file alone:
        python -m daas.compile_down.cli --spec workflow_spec.json --lane <lane>
    """
    tools_out: list[dict[str, Any]] = []
    for t in getattr(spec, "tools", []) or []:
        if isinstance(t, dict):
            tools_out.append(
                {
                    "name": t.get("name", ""),
                    "purpose": t.get("purpose", ""),
                    "input_schema": t.get("input_schema", {}),
                }
            )
        else:
            tools_out.append(
                {
                    "name": getattr(t, "name", ""),
                    "purpose": getattr(t, "purpose", ""),
                    "input_schema": getattr(t, "input_schema", {}),
                }
            )
    payload = {
        "source_trace_id": getattr(spec, "source_trace_id", ""),
        "executor_model": getattr(spec, "executor_model", ""),
        "orchestrator_system_prompt": getattr(spec, "orchestrator_system_prompt", ""),
        "tools": tools_out,
    }
    return json.dumps(payload, indent=2)


def _server_py(lane: str) -> str:
    """Layer 2 — FastAPI + SSE wrapper."""
    return '''"""FastAPI + SSE wrapper around the lane runtime. Layer 2.

GET  /health         — mode + status
GET  /api/spec       — serve workflow_spec.json
POST /api/run        — stream the scaffold's run as SSE events
                       (event: start | result | error | done)

Requires: fastapi, uvicorn. Falls back gracefully if not installed.
"""
from __future__ import annotations

import json
import os
from typing import Any

try:
    from fastapi import FastAPI, Request
    from fastapi.responses import JSONResponse, StreamingResponse
except ImportError:  # pragma: no cover - optional extra
    FastAPI = None  # type: ignore[assignment]
    Request = None  # type: ignore[assignment]
    JSONResponse = None  # type: ignore[assignment]
    StreamingResponse = None  # type: ignore[assignment]

# Import the lane's runner — every lane ships a runner.py with a
# callable ``main(prompt: str) -> dict`` entry point.
try:
    from runner import main as run_main  # type: ignore
except Exception:  # noqa: BLE001
    run_main = None  # type: ignore[assignment]


app = FastAPI() if FastAPI is not None else None


if app is not None:
    @app.get("/health")
    def health() -> dict[str, Any]:
        return {
            "status": "ok",
            "connector_mode": os.environ.get("CONNECTOR_MODE", "mock"),
            "runner_imported": run_main is not None,
        }

    @app.get("/api/spec")
    def spec_endpoint() -> Any:
        try:
            with open("workflow_spec.json", "r", encoding="utf-8") as fh:
                return json.load(fh)
        except FileNotFoundError:
            return JSONResponse(
                status_code=404, content={"error": "workflow_spec.json missing"}
            )

    @app.post("/api/run")
    async def run_endpoint(request: "Request") -> Any:
        body = await request.json()
        prompt = str(body.get("prompt", "")).strip()

        def stream():  # type: ignore[no-untyped-def]
            yield (
                "event: start\\ndata: "
                + json.dumps({"prompt": prompt[:400]})
                + "\\n\\n"
            )
            if run_main is None:
                yield (
                    "event: error\\ndata: "
                    + json.dumps({"error": "runner.main not importable"})
                    + "\\n\\n"
                )
                yield "event: done\\ndata: {}\\n\\n"
                return
            try:
                result = run_main(prompt)
            except Exception as e:  # noqa: BLE001
                yield (
                    "event: error\\ndata: "
                    + json.dumps({"error": f"{type(e).__name__}: {e}"[:400]})
                    + "\\n\\n"
                )
                yield "event: done\\ndata: {}\\n\\n"
                return
            yield (
                "event: result\\ndata: "
                + json.dumps(result if isinstance(result, (dict, list, str)) else str(result))
                + "\\n\\n"
            )
            yield "event: done\\ndata: {}\\n\\n"

        return StreamingResponse(stream(), media_type="text/event-stream")


if __name__ == "__main__":
    if app is None:
        raise SystemExit(
            "server requires fastapi + uvicorn. "
            "pip install -r requirements-all.txt"
        )
    import uvicorn

    port = int(os.environ.get("PORT", "8000"))
    uvicorn.run(app, host="0.0.0.0", port=port)
'''


def _state_store_py() -> str:
    """Layer 5 — SQLite persistence for runs + scratchpad."""
    return '''"""SQLite persistence for scratchpad + runs. Layer 5.

No ORM, no migration tool — one file, stdlib-only, graceful schema
bootstrap. Enable via env var ``ATTRITION_DB=./attrition.db``.
"""
from __future__ import annotations

import json
import os
import sqlite3
import time
import uuid
from contextlib import contextmanager
from typing import Iterator, Optional

DB_PATH = os.environ.get("ATTRITION_DB", "./attrition.db")


_SCHEMA = """
CREATE TABLE IF NOT EXISTS runs (
    run_id       TEXT PRIMARY KEY,
    query        TEXT NOT NULL,
    result_json  TEXT,
    created_at   INTEGER NOT NULL,
    completed_at INTEGER
);
CREATE TABLE IF NOT EXISTS scratchpad (
    run_id     TEXT NOT NULL,
    section    TEXT NOT NULL,
    content    TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (run_id, section)
);
CREATE INDEX IF NOT EXISTS idx_runs_created ON runs(created_at);
"""


@contextmanager
def conn() -> Iterator[sqlite3.Connection]:
    c = sqlite3.connect(DB_PATH)
    try:
        c.executescript(_SCHEMA)
        yield c
        c.commit()
    finally:
        c.close()


def new_run(query: str) -> str:
    """Create a new run row, return the run_id (uuid4)."""
    run_id = str(uuid.uuid4())
    with conn() as c:
        c.execute(
            "INSERT INTO runs (run_id, query, result_json, created_at, completed_at)"
            " VALUES (?, ?, NULL, ?, NULL)",
            (run_id, query, int(time.time())),
        )
    return run_id


def finish_run(run_id: str, result: dict) -> None:
    with conn() as c:
        c.execute(
            "UPDATE runs SET result_json = ?, completed_at = ? WHERE run_id = ?",
            (json.dumps(result), int(time.time()), run_id),
        )


def save_scratchpad(run_id: str, section: str, content: str) -> None:
    with conn() as c:
        c.execute(
            "INSERT OR REPLACE INTO scratchpad (run_id, section, content, updated_at)"
            " VALUES (?, ?, ?, ?)",
            (run_id, section, content, int(time.time())),
        )


def load_scratchpad(run_id: str) -> dict[str, str]:
    with conn() as c:
        rows = c.execute(
            "SELECT section, content FROM scratchpad WHERE run_id = ?",
            (run_id,),
        ).fetchall()
    return {section: content for section, content in rows}


def load_run(run_id: str) -> Optional[dict]:
    with conn() as c:
        row = c.execute(
            "SELECT run_id, query, result_json, created_at, completed_at"
            " FROM runs WHERE run_id = ?",
            (run_id,),
        ).fetchone()
    if not row:
        return None
    return {
        "run_id": row[0],
        "query": row[1],
        "result": json.loads(row[2]) if row[2] else None,
        "created_at": row[3],
        "completed_at": row[4],
    }
'''


def _eval_scenarios_py() -> str:
    """Layer 7 — mock-mode smoke tests + per-tool dispatch checks."""
    return '''"""Scenario-based smoke tests. Layer 7.

Every declared tool must dispatch in mock mode without crashing.
Extend with live queries once you have real handlers wired.

Usage:
    python -m eval.scenarios          # run smoke test, print JSON
    pytest eval/scenarios.py          # pytest-compatible test fn
"""
from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

try:
    # Present in tool_first_chain / orchestrator_worker / openai_agents_sdk
    from tools import dispatch  # type: ignore
except Exception:  # noqa: BLE001
    dispatch = None  # type: ignore[assignment]


def load_declared_tools() -> list[str]:
    p = Path("workflow_spec.json")
    if not p.exists():
        return []
    try:
        spec = json.loads(p.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return []
    return [str(t.get("name", "")) for t in spec.get("tools", []) if t.get("name")]


def assert_mock_dispatch_works(tool_names: list[str]) -> list[dict[str, Any]]:
    os.environ["CONNECTOR_MODE"] = "mock"
    results: list[dict[str, Any]] = []
    for name in tool_names:
        if dispatch is None:
            results.append(
                {"tool": name, "passed": False, "reason": "no dispatch() available (simple_chain lane)"}
            )
            continue
        try:
            r = dispatch(name, {})
            passed = isinstance(r, dict) and r.get("status") == "mock"
            results.append({"tool": name, "passed": passed, "response": r})
        except Exception as e:  # noqa: BLE001
            results.append({"tool": name, "passed": False, "reason": f"{type(e).__name__}: {e}"})
    return results


def run_smoke_test() -> dict[str, Any]:
    tools = load_declared_tools()
    dispatch_results = assert_mock_dispatch_works(tools)
    passed = sum(1 for r in dispatch_results if r["passed"])
    return {
        "tool_count": len(tools),
        "passed": passed,
        "failed": len(tools) - passed,
        "details": dispatch_results,
    }


def test_all_tools_dispatch_in_mock_mode() -> None:  # pytest entry
    result = run_smoke_test()
    assert result["failed"] == 0, json.dumps(result, indent=2)


if __name__ == "__main__":
    print(json.dumps(run_smoke_test(), indent=2))
'''


def _eval_rubric_py() -> str:
    """Layer 7 — boolean-rubric judge."""
    return '''"""6-boolean rubric judge. Layer 7.

Matches the pattern attrition.sh uses in its own replay harness:
the LLM judges 6 independent booleans, the verdict is derived
DETERMINISTICALLY from the vector. The LLM only judges dimensions;
the rollup is pure Python.

Usage:
    from eval.rubric import judge
    result = judge(user_prompt, original_answer, replay_answer)
    # result = {"verdict": ..., "reason": ..., "checks": {...}}

Requires GEMINI_API_KEY for the LLM-judged bools. Returns
insufficient_data when the key is missing or the call fails.
"""
from __future__ import annotations

import json
import os
import re
import urllib.error
import urllib.request
from typing import Any

CHECK_KEYS: tuple[str, ...] = (
    "covers_main_points",
    "reproduces_specific_artifacts",
    "addresses_user_prompt",
    "no_hallucination",
    "structural_coherence",
    "baseline_is_substantive",
)

_RUBRIC = """You are a fidelity judge. Emit a PURE JSON object with exactly these six keys, each an object {bool, reason}:

covers_main_points · reproduces_specific_artifacts · addresses_user_prompt · no_hallucination · structural_coherence · baseline_is_substantive

Definitions:
  covers_main_points             REPLAY hits every substantive point ORIGINAL hits.
  reproduces_specific_artifacts  REPLAY includes concrete filenames / counts / status lines from ORIGINAL.
  addresses_user_prompt          REPLAY answers what USER_PROMPT asked.
  no_hallucination               REPLAY invents nothing that USER_PROMPT / playbook didn't imply.
  structural_coherence           REPLAY has the shape of a helpful answer.
  baseline_is_substantive        ORIGINAL_ANSWER is rich enough to be a meaningful baseline.

Do NOT emit a verdict — the verdict is computed downstream from your booleans.
"""


def verdict_from_checks(checks: dict[str, Any]) -> tuple[str, str]:
    """Deterministic rollup."""

    def b(k: str) -> bool:
        v = checks.get(k, {})
        return bool(v.get("bool") if isinstance(v, dict) else v)

    def r(k: str) -> str:
        v = checks.get(k, {})
        if isinstance(v, dict):
            return str(v.get("reason") or "")
        return ""

    if not b("baseline_is_substantive"):
        return "insufficient_data", r("baseline_is_substantive") or "baseline not substantive"
    if not b("addresses_user_prompt") or not b("no_hallucination"):
        rr = r("addresses_user_prompt") if not b("addresses_user_prompt") else r("no_hallucination")
        return "regression", rr
    fidelity = ("covers_main_points", "reproduces_specific_artifacts", "structural_coherence")
    misses = [k for k in fidelity if not b(k)]
    if not misses:
        return "transfers", "all fidelity bools pass"
    if len(misses) == 1:
        return "lossy", r(misses[0]) or "one fidelity bool failed"
    return "regression", "; ".join(r(k) for k in misses[:2])


def _extract_balanced_json(s: str) -> str:
    depth = 0
    in_str = False
    esc = False
    start = -1
    for i, ch in enumerate(s):
        if in_str:
            if esc:
                esc = False
            elif ch == "\\\\":
                esc = True
            elif ch == '"':
                in_str = False
            continue
        if ch == '"':
            in_str = True
        elif ch == "{":
            if depth == 0:
                start = i
            depth += 1
        elif ch == "}":
            if depth > 0:
                depth -= 1
                if depth == 0 and start != -1:
                    return s[start : i + 1]
    return ""


def judge(
    user_prompt: str,
    original_answer: str,
    replay_answer: str,
    *,
    api_key: str | None = None,
    model: str = "gemini-3.1-pro-preview",
) -> dict[str, Any]:
    key = api_key or os.environ.get("GEMINI_API_KEY", "")
    if not key:
        return {"verdict": "insufficient_data", "reason": "no GEMINI_API_KEY set", "checks": {}}

    body = (
        f"USER_PROMPT:\\n{user_prompt[:2500]}\\n\\n"
        f"ORIGINAL_ANSWER:\\n{original_answer[:4000]}\\n\\n"
        f"REPLAY_ANSWER:\\n{replay_answer[:4000]}"
    )
    payload = {
        "systemInstruction": {"parts": [{"text": _RUBRIC}]},
        "contents": [{"role": "user", "parts": [{"text": body}]}],
        "generationConfig": {
            "temperature": 0.2,
            "maxOutputTokens": 2048,
            "responseMimeType": "application/json",
        },
    }
    url = (
        f"https://generativelanguage.googleapis.com/v1beta/models/{model}"
        f":generateContent?key={key}"
    )
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            raw = resp.read().decode("utf-8")
    except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError) as e:
        return {"verdict": "insufficient_data", "reason": f"judge call failed: {e}", "checks": {}}

    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        return {"verdict": "insufficient_data", "reason": "invalid JSON wrapper", "checks": {}}

    candidates = parsed.get("candidates") or []
    if not candidates:
        return {"verdict": "insufficient_data", "reason": "empty judge candidates", "checks": {}}
    parts = (candidates[0].get("content") or {}).get("parts") or []
    text = "\\n".join(str(p.get("text") or "") for p in parts if isinstance(p, dict))

    try:
        checks_obj = json.loads(text.strip())
    except json.JSONDecodeError:
        chunk = _extract_balanced_json(text)
        try:
            checks_obj = json.loads(chunk) if chunk else None
        except json.JSONDecodeError:
            checks_obj = None
    if not isinstance(checks_obj, dict):
        return {"verdict": "insufficient_data", "reason": "unparseable judge output", "checks": {}}

    # Normalize missing keys as failed checks
    checks: dict[str, Any] = {}
    for k in CHECK_KEYS:
        v = checks_obj.get(k, {})
        if isinstance(v, dict):
            checks[k] = {"bool": bool(v.get("bool")), "reason": str(v.get("reason") or "")[:240]}
        elif isinstance(v, bool):
            checks[k] = {"bool": v, "reason": ""}
        else:
            checks[k] = {"bool": False, "reason": "check missing from judge output"}

    verdict, reason = verdict_from_checks(checks)
    return {"verdict": verdict, "reason": reason[:240], "checks": checks}


if __name__ == "__main__":
    # Self-test with trivial inputs
    demo = judge("How many files?", "Three: a.py, b.py, c.py", "Some files exist.")
    print(json.dumps(demo, indent=2))
'''


def _eval_init_py() -> str:
    return '"""Evaluation layer — 6-boolean rubric + mock-mode smoke tests."""\n'


def _observability_py() -> str:
    """Layer 8 — OpenTelemetry hooks (graceful no-op)."""
    return '''"""OpenTelemetry tracing hooks. Layer 8.

Idempotent setup; falls back to no-op cleanly if opentelemetry is
not installed. Enable OTLP export via OTEL_EXPORTER_OTLP_ENDPOINT.
"""
from __future__ import annotations

import functools
import os
from typing import Any, Callable, TypeVar

F = TypeVar("F", bound=Callable[..., Any])

_initialized = False


def setup_tracing(service_name: str | None = None) -> None:
    """Install a tracer provider. Safe to call many times."""
    global _initialized
    if _initialized:
        return
    _initialized = True

    try:
        from opentelemetry import trace
        from opentelemetry.sdk.resources import Resource
        from opentelemetry.sdk.trace import TracerProvider
        from opentelemetry.sdk.trace.export import (
            BatchSpanProcessor,
            ConsoleSpanExporter,
        )
    except ImportError:
        print("[observability] opentelemetry not installed; using no-op tracer")
        return

    name = service_name or os.environ.get("SERVICE_NAME", "attrition-scaffold")
    resource = Resource(attributes={"service.name": name})
    provider = TracerProvider(resource=resource)

    endpoint = os.environ.get("OTEL_EXPORTER_OTLP_ENDPOINT")
    if endpoint:
        try:
            from opentelemetry.exporter.otlp.proto.http.trace_exporter import (
                OTLPSpanExporter,
            )

            provider.add_span_processor(BatchSpanProcessor(OTLPSpanExporter()))
        except ImportError:
            provider.add_span_processor(BatchSpanProcessor(ConsoleSpanExporter()))
    else:
        provider.add_span_processor(BatchSpanProcessor(ConsoleSpanExporter()))

    trace.set_tracer_provider(provider)


def traced(name: str | None = None) -> Callable[[F], F]:
    """Decorator: wrap a function in an OTel span. No-op if OTel is absent."""

    def decorator(fn: F) -> F:
        @functools.wraps(fn)
        def wrapper(*args: Any, **kwargs: Any) -> Any:
            try:
                from opentelemetry import trace as _trace

                tracer = _trace.get_tracer(fn.__module__)
                with tracer.start_as_current_span(name or fn.__qualname__) as span:
                    span.set_attribute("function.module", fn.__module__)
                    return fn(*args, **kwargs)
            except ImportError:
                return fn(*args, **kwargs)

        return wrapper  # type: ignore[return-value]

    return decorator


__all__ = ["setup_tracing", "traced"]
'''


def _mcp_server_py() -> str:
    """Layer 9 — MCP endpoint wrapper over tools.dispatch."""
    return '''"""MCP server exposing this scaffold's tools. Layer 9.

Wraps tools.dispatch() so other agents can call this scaffold's
capabilities over the Model Context Protocol. Respects
CONNECTOR_MODE (mock / live / hybrid) just like direct dispatch.

Run:
    python mcp_server.py

Requires `mcp` package. Falls back with a clean error if missing.
"""
from __future__ import annotations

import asyncio
import json
import os

try:
    from mcp import types  # type: ignore
    from mcp.server import Server  # type: ignore
    from mcp.server.stdio import stdio_server  # type: ignore
except ImportError:
    types = None  # type: ignore[assignment]
    Server = None  # type: ignore[assignment]
    stdio_server = None  # type: ignore[assignment]

try:
    from tools import STUB_HANDLERS, dispatch  # type: ignore
    TOOL_NAMES = sorted(STUB_HANDLERS.keys()) if isinstance(STUB_HANDLERS, dict) else []
except Exception:  # noqa: BLE001
    dispatch = None  # type: ignore[assignment]
    TOOL_NAMES = []


app = Server("attrition-scaffold") if Server is not None else None


if app is not None:

    @app.list_tools()  # type: ignore[misc]
    async def list_tools():  # type: ignore[no-untyped-def]
        mode = os.environ.get("CONNECTOR_MODE", "mock")
        return [
            types.Tool(
                name=name,
                description=(
                    f"attrition scaffold tool — dispatched via connector "
                    f"resolver (current mode: {mode})"
                ),
                inputSchema={"type": "object", "additionalProperties": True},
            )
            for name in TOOL_NAMES
        ]

    @app.call_tool()  # type: ignore[misc]
    async def call_tool(name: str, arguments: dict):  # type: ignore[no-untyped-def]
        if dispatch is None:
            return [
                types.TextContent(
                    type="text",
                    text=json.dumps({"error": "dispatch() unavailable in this scaffold"}),
                )
            ]
        result = dispatch(name, arguments or {})
        return [types.TextContent(type="text", text=json.dumps(result))]


async def _main() -> None:
    if app is None or stdio_server is None:
        raise SystemExit(
            "mcp package not installed. pip install 'mcp>=1.2.0'"
        )
    async with stdio_server() as (read_stream, write_stream):
        await app.run(read_stream, write_stream, app.create_initialization_options())


if __name__ == "__main__":
    asyncio.run(_main())
'''


# --- README / requirements / .env.example / run.sh (unchanged below) ----
def _readme(lane: str, spec: Any) -> str:
    title = _LANE_TITLE.get(lane, lane)
    entrypoint = _LANE_ENTRYPOINT.get(lane, "main.py")
    tools = _spec_tools(spec)
    tools_md = (
        "\n".join(f"- `{t}` — {_purpose_for(spec, t)}" for t in tools)
        if tools
        else "- (no tools declared in this spec)"
    )
    executor_model = getattr(spec, "executor_model", "gemini-3.1-flash-lite-preview")
    source_trace_id = getattr(spec, "source_trace_id", "")
    return f"""# {title}

Auto-generated by **attrition.sh** from trace `{source_trace_id}`.

Runtime lane: `{lane}`
Executor model: `{executor_model}`

## What this is

A runnable scaffold compiled down from a captured agent run. It was
distilled from the original trace into a canonical WorkflowSpec, then
emitted into this runtime lane. You can run it as-is in **mock** mode
to validate shape, or flip `CONNECTOR_MODE=live` once you've wired the
handlers in `tools.py` to real endpoints.

## Quick start

```bash
pip install -r requirements.txt
cp .env.example .env
# edit .env with your API key
./run.sh
```

Or directly:

```bash
python {entrypoint}
```

## Connector modes

This scaffold ships with two handlers per tool:
- `_stub_<name>(args)` — returns a mock response (fixture-placeholder)
- `_live_<name>(args)` — raises `NotImplementedError` until you wire it

Flip at runtime via env var:

```bash
CONNECTOR_MODE=mock   python {entrypoint}   # default
CONNECTOR_MODE=live   python {entrypoint}   # requires live handlers
CONNECTOR_MODE=hybrid CONNECTOR_OVERRIDES='{{"lookup_sku": "live"}}' python {entrypoint}
```

## Tools in this scaffold

{tools_md}

## How to wire a live handler

Open `tools.py` and replace the body of `_live_<tool_name>`:

```python
def _live_lookup_sku(args):
    # your real call here
    import requests
    r = requests.get("https://your.api/sku", params={{"id": args["id"]}})
    return r.json()
```

Then run with `CONNECTOR_MODE=live`.

## Regenerate from trace

```bash
# from the attrition repo
python -m daas.compile_down.cli \\
    --trace path/to/original.jsonl \\
    --lane {lane} \\
    --out ./regenerated
```

## The 9 layers in this bundle

| Layer | File(s) | Purpose |
|---|---|---|
| 0 Specification | `workflow_spec.json` | Serialized spec — regenerate any lane: `python -m daas.compile_down.cli --spec workflow_spec.json --lane <lane>` |
| 1 Frontend | *(not emitted — bring your own app)* | Call `POST /api/run` from your UI |
| 2 Server | `server.py` | FastAPI + SSE at `/health`, `/api/spec`, `/api/run` |
| 3 Services | lane-specific (`orchestrator.py` / `runner.py` / `graph.py`) | Pipeline / state machine |
| 4 Agents | lane-specific (same as Layer 3) | LLM orchestration (plan → dispatch → compact or equivalent) |
| 5 Database | `state_store.py` | SQLite persistence for runs + scratchpad |
| 6 Security | `tools.py` connector resolver | Mock vs live dispatch boundary |
| 7 Evaluation | `eval/scenarios.py`, `eval/rubric.py` | Mock-mode smoke tests + 6-boolean judge |
| 8 Observability | `observability.py` | OpenTelemetry hooks (console by default, OTLP if `OTEL_EXPORTER_OTLP_ENDPOINT` set) |
| 9 MCP tools | `mcp_server.py` | Expose `tools.dispatch()` as an MCP endpoint |

Extras required only for layers 2 / 8 / 9:

```bash
pip install -r requirements-all.txt
```

Core agent runtime (layers 3 / 4) needs only `requirements.txt`.

---

*Generated by attrition.sh · compile-down + verification layer.*
*Every `.py` in this bundle is `ast.parse`-valid on emit.*
"""


def _requirements(lane: str) -> str:
    deps = _LANE_DEPS.get(lane, ["google-genai>=0.7.0"])
    return "\n".join(deps) + "\n"


def _env_example(lane: str) -> str:
    rows = _LANE_ENV.get(lane, [("GEMINI_API_KEY", "Required")])
    lines: list[str] = [
        "# Environment for attrition-generated scaffold.",
        "# Copy this file to .env and fill in the required values.",
        "",
    ]
    for name, note in rows:
        lines.append(f"# {note}")
        lines.append(f"{name}=")
        lines.append("")
    return "\n".join(lines)


def _run_sh(lane: str) -> str:
    entrypoint = _LANE_ENTRYPOINT.get(lane, "main.py")
    return f"""#!/usr/bin/env bash
# One-command entry point for the attrition-generated scaffold.
set -euo pipefail

# Load .env if present (do not fail if missing — mock mode needs no key)
if [ -f .env ]; then
    set -a
    # shellcheck disable=SC1091
    source .env
    set +a
fi

# Default to mock so first-run never crashes on missing live handlers.
export CONNECTOR_MODE="${{CONNECTOR_MODE:-mock}}"

# Use python3 on *nix, fall back to python on Windows.
if command -v python3 >/dev/null 2>&1; then
    PY=python3
else
    PY=python
fi

exec "$PY" {entrypoint} "$@"
"""


# --- spec helpers --------------------------------------------------------
def _spec_tools(spec: Any) -> list[str]:
    out: list[str] = []
    for t in getattr(spec, "tools", []) or []:
        if isinstance(t, dict):
            n = t.get("name")
        else:
            n = getattr(t, "name", None)
        if n:
            out.append(str(n))
    return out


def _purpose_for(spec: Any, tool_name: str) -> str:
    for t in getattr(spec, "tools", []) or []:
        if isinstance(t, dict):
            if t.get("name") == tool_name:
                return str(t.get("purpose", "")).strip() or "(no purpose declared)"
        else:
            if getattr(t, "name", None) == tool_name:
                p = str(getattr(t, "purpose", "") or "").strip()
                return p or "(no purpose declared)"
    return "(no purpose declared)"


# --- public entry --------------------------------------------------------
def finalize_bundle(
    bundle: ArtifactBundle,
    *,
    runtime_lane: str,
    spec: Any,
) -> ArtifactBundle:
    """Append README.md + requirements.txt + run.sh + .env.example to the
    bundle. Idempotent — skips files the emitter already produced.
    """
    # Lane-aware: filter files the agent wrote that violate the lane
    # contract. A simple_chain agent that eagerly writes eval/ or
    # state_store.py files produces a bundle that fails the
    # correct_lane_picked judge. Filter now so the bundle is consistent
    # regardless of who wrote each file OR which platform produced it
    # (Windows workspaces emit backslash paths — we normalize).
    _lane_excludes_early: dict[str, frozenset[str]] = {
        "simple_chain": frozenset({
            "state_store.py",
            "mcp_server.py",
            "eval/__init__.py",
            "eval/scenarios.py",
            "eval/rubric.py",
            "tools.py",              # simple_chain has no tools
            "requirements-all.txt",  # extras (fastapi, otel, mcp) exceed lane
        }),
        "tool_first_chain": frozenset({
            "state_store.py",
        }),
    }
    _excluded_early = _lane_excludes_early.get(runtime_lane, frozenset())

    def _norm(p: str) -> str:
        """Normalize path to forward-slash (Workspace.list() emits backslash on Windows)."""
        return p.replace("\\", "/")

    def _path_excluded(p: str) -> bool:
        p_norm = _norm(p)
        if p_norm in _excluded_early:
            return True
        if runtime_lane == "simple_chain" and p_norm.startswith("eval/"):
            return True
        return False

    # Normalize path separators on every file the agent wrote so
    # downstream tooling (ZIP emit, gate checks, judge) sees a consistent
    # forward-slash layout regardless of host OS.
    normalized_input: list[ArtifactFile] = []
    for f in bundle.files:
        if _path_excluded(f.path):
            continue
        if "\\" in f.path:
            # Recreate with normalized path (ArtifactFile is a dataclass;
            # we produce a fresh instance rather than mutating).
            normalized_input.append(ArtifactFile(
                path=_norm(f.path),
                content=f.content,
                language=getattr(f, "language", "text"),
            ))
        else:
            normalized_input.append(f)
    existing_paths = {f.path for f in normalized_input}
    appended: list[ArtifactFile] = list(normalized_input)

    # Detect whether this bundle already has a tools.py (Layer 6 + 9 hook).
    has_tools_py = any(f.path == "tools.py" for f in bundle.files)
    # requirements-all.txt pins the optional 9-layer extras (fastapi, otel, mcp)
    extras_text = (
        _requirements(runtime_lane)
        + "\n# --- optional extras for layers 2 / 8 / 9 ---\n"
        + "\n".join(_EXTRAS_DEPS)
        + "\n"
    )

    candidates: list[tuple[str, str, str]] = [
        ("README.md", _readme(runtime_lane, spec), "markdown"),
        ("requirements.txt", _requirements(runtime_lane), "text"),
        ("requirements-all.txt", extras_text, "text"),
        ("run.sh", _run_sh(runtime_lane), "shell"),
        (".env.example", _env_example(runtime_lane), "text"),
        # 9-layer-cut files
        ("workflow_spec.json", _workflow_spec_json(spec), "json"),
        ("server.py", _server_py(runtime_lane), "python"),
        ("state_store.py", _state_store_py(), "python"),
        ("eval/__init__.py", _eval_init_py(), "python"),
        ("eval/scenarios.py", _eval_scenarios_py(), "python"),
        ("eval/rubric.py", _eval_rubric_py(), "python"),
        ("observability.py", _observability_py(), "python"),
    ]
    # MCP server is backfilled for lanes that actually dispatch tools.
    # Tool-less lanes (simple_chain) don't need an MCP endpoint; the
    # `correct_lane_picked` LLM judge flags them for over-emission.
    candidates.append(("mcp_server.py", _mcp_server_py(), "python"))
    _ = has_tools_py  # kept for future lane-awareness heuristics

    # Single source of truth for what the lane excludes. Applies to BOTH
    # agent-written files (filtered before backfill) AND backfill
    # candidates (skipped in the loop below). Defined once above this
    # block as `_lane_excludes_early`; we reuse it here.
    excluded = _excluded_early
    for path, content, lang in candidates:
        if path in existing_paths:
            continue
        if path in excluded:
            # Skip backfill — the lane's contract prohibits this layer.
            continue
        appended.append(ArtifactFile(path=path, content=content, language=lang))

    # Preserve the bundle's existing runtime_lane + target_model so we
    # don't lose metadata on finalize.
    kwargs: dict[str, Any] = {"files": appended}
    for name in ("runtime_lane", "target_model"):
        if hasattr(bundle, name):
            kwargs[name] = getattr(bundle, name)
    try:
        return ArtifactBundle(**kwargs)
    except TypeError:
        # Fall back to minimal construction if the dataclass signature
        # changes and doesn't accept our extras.
        return ArtifactBundle(files=appended)  # type: ignore[call-arg]
