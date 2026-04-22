# _style.md — cross-cutting rules every emit must follow

The attrition-agent loads this file alongside the target-lane skill
file when building a bundle. Rules here are non-negotiable.

## 1. Runnability

Every emitted scaffold must:

- Parse cleanly (`ast.parse` for Python, `tsc --noEmit` for TS).
- Include `README.md` with a one-paragraph intro + how to run.
- Include `requirements.txt` (or `package.json`) with pinned versions.
- Include `run.sh` (or `npm start`) that starts the scaffold in mock
  mode with zero required env vars.
- Include `.env.example` listing every required env var for live mode.
- Include a `workflow_spec.json` — the serialized spec that was used
  to generate the bundle (enables regen).

## 2. Connector resolver pattern

For any lane that has tools:

- Generate TWO handlers per tool: `_stub_<name>(args)` returning
  structured mock data, and `_live_<name>(args)` raising
  `NotImplementedError` until the user wires it.
- Route via `dispatch(name, args)` that reads `CONNECTOR_MODE` env
  (`mock` / `live` / `hybrid`).
- In hybrid mode, read `CONNECTOR_OVERRIDES` as a JSON map
  `{tool_name: "live"|"mock"}`.

## 3. Observability

- Emit `observability.py` (or equivalent) with a `setup_tracing()`
  function that's a no-op when OpenTelemetry isn't installed.
- Wrap the main entry with `@traced` so one run = one span tree.

## 4. Evaluation

- Emit an `eval/` subdirectory with:
  - `scenarios.py` — pytest-compatible mock-mode smoke tests.
  - `rubric.py` — 6-boolean judge template that calls any LLM provider
    via the scaffold's own provider env vars.

## 5. Secret handling

- NEVER inline a concrete API key in any emitted file.
- ALWAYS read from env with a clear error if missing.
- `.env.example` includes the variable name + one-line description
  ("Get one at https://...") but NEVER an actual value.

## 6. Security guard

- For any emitted HTTP server layer (Layer 2 in the 9-layer bundle),
  include a rate-limit decorator stub that the user can wire to
  their real limiter. The stub behaviour: no-op, log a warning.

## 7. MCP exposure

- If the lane has a `tools.py` with dispatch, also emit `mcp_server.py`
  that wraps `dispatch()` as an MCP stdio server. This lets the
  generated scaffold be consumed by other agents.

## 8. Termination

The agent MUST call `emit_done(summary: str)` as its final tool. The
loop halts on this. Summary should list the filenames written + any
honest caveats ("ast_parse_check failed on X; left the file as-is").

## 9. Style invariants

- Python: 4-space indent, type hints on every function signature,
  `from __future__ import annotations` at the top of every file.
- TypeScript: 2-space indent, explicit types on every exported symbol,
  no `any` unless commented with why.
- Markdown: ATX headings, fenced code blocks tagged with language.

## 10. The deterministic floor

If the agent can't decide or the task drifts past `max_turns`, the
finalizer (`daas/compile_down/emitters/_bundle_finalize.py`) guarantees
README + requirements + run.sh + .env.example land anyway. Those are
the absolute minimum.
