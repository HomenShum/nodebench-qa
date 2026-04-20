# Builder Generation Spec

What gets generated per runtime lane when the user clicks into Builder
+ runs `python -m daas.compile_down.cli --record`. Every emitter
produces an `ArtifactBundle` (JSON blob: `{runtime_lane, target_model,
files: [{path, content, language}]}`) that stores in
`daasGeneratedArtifacts` and renders on Builder's Scaffold / World
Model tabs.

All emitted Python files MUST pass `ast.parse` — locked by
`daas/tests/test_compile_down_emitters.py` (15 tests) +
`daas/tests/test_translation_emitters.py` (16 tests).

## Emitter dispatch table

| runtime_lane | Emitter | Default target model | Files |
|---|---|---|---|
| `simple_chain` | `daas/compile_down/emitters/simple_chain.py` | `gemini-3.1-flash-lite-preview` | 5 |
| `tool_first_chain` | `daas/compile_down/emitters/tool_first_chain.py` | `gemini-3.1-flash-lite-preview` | 6 |
| `orchestrator_worker` | `daas/compile_down/emitters/orchestrator_worker.py` | `gemini-3.1-flash-lite-preview` | 8 + 1 per worker |
| `openai_agents_sdk` (translate) | `daas/compile_down/emitters/openai_agents.py` | `gpt-4o-mini` | 5 |
| `langgraph_python` (translate) | `daas/compile_down/emitters/langgraph_python.py` | `gpt-4o-mini` | 5 |

## simple_chain

One-shot LLM call with strict input/output schema.

```
prompts.py         distilled SYSTEM_PROMPT (via repr() — handles all
                   quote edge cases safely)
schemas.py         ChainInput / ChainOutput dataclasses
runner.py          urllib-based Gemini call + CLI entry
requirements.txt   google-genai>=1.0.0
README.md          how-to-run + what-this-is-not
```

## tool_first_chain

Bounded tool loop (MAX_TURNS=4) with Gemini function-calling.

```
prompts.py         SYSTEM_PROMPT + tool-calling discipline appended
tools.py           GEMINI_TOOLS + _stub_* handlers + dispatch()
schemas.py         ChainInput / ChainOutput (adds tool_calls list)
runner.py          multi-turn loop: fn_call → dispatch → feed result
requirements.txt   google-genai>=1.0.0
README.md
```

## orchestrator_worker

Anthropic "Building Effective Agents" pattern.

```
prompts.py              ORCHESTRATOR_SYSTEM_PROMPT
schemas.py              RunInput / WorkerAssignment / WorkerOutput / RunOutput
state.py                Scratchpad (sections dict, append/read/compact)
tools.py                GEMINI_TOOLS + handlers
handoffs.py             WorkerName Literal + Handoff dataclass
orchestrator.py         plan + dispatch + compaction loop
workers/
  <worker_name>.py      one file per worker in the spec
  executor.py           default single worker when spec has none
runner.py               CLI
requirements.txt
README.md
```

## openai_agents_sdk (translation target)

```
agent.py                Agent() + Runner.run_sync + @function_tool imports
tools.py                @function_tool wrappers per tool
runner.py               CLI
requirements.txt        openai-agents>=0.1.0, openai>=1.0.0
README.md
```

When a spec has no tools, `agent.py` emits a safe
`# (no tools in distilled spec)` comment instead of
`from tools import ()` (which is a Python SyntaxError). Locked by test.

## langgraph_python (translation target)

```
graph.py                StateGraph with per-worker node + compaction node
state.py                TypedDict GraphState with query / scratchpad / final_answer
runner.py               CLI
requirements.txt        langgraph>=0.6, langchain-core, langchain-openai
README.md
```

## world_model (second bundle, emitted alongside the runtime scaffold)

See `docs/WORLD_MODEL_SPEC.md` for the substrate file inventory.
Emitted by `daas/compile_down/world_model/emitter.py` with
`runtime_lane` encoded as `world_model_lite` or `world_model_full` so
the Builder's World Model tab queries a specific row.

## Invariants

- **Deterministic.** Same `WorkflowSpec` → identical bundle bytes.
  No timestamps, no randomness, no non-stable JSON ordering.
- **Safe-to-compile.** Every `.py` file passes `ast.parse`.
  Dangerous patterns (empty import parens, unescaped triple-quotes)
  have regression tests.
- **Self-documenting.** Every bundle includes a README.md describing
  what-to-replace, how-to-run, and what-not-to-trust-without-fidelity.
- **Stub-clear.** Every tool handler starts as `_stub_<name>` that
  returns `{"status": "not_implemented"}`. Clear flag that the
  artifact is NOT production-ready until those are replaced.
- **Connector-aware.** Runner code reads model / API keys from env
  so the same file works in mock + live + hybrid connector modes.

## How to add a new runtime lane emitter

1. Create `daas/compile_down/emitters/<lane>.py` with
   `emit_bundle(spec, *, target_model=None) -> ArtifactBundle`.
2. Register in `daas/compile_down/emitters/__init__.py`:
   `KNOWN_EMITTERS[<lane>] = <module>.emit_bundle`.
3. Add `<lane>` to the CLI choices in
   `daas/compile_down/cli.py::main` argparse.
4. Write scenario tests in
   `daas/tests/test_compile_down_emitters.py` or
   `daas/tests/test_translation_emitters.py`:
   - expected file set
   - AST validity for every .py
   - worker / tool / prompt content propagation
   - empty-spec + hostile-input edge cases
5. Update this doc with the new row in the dispatch table.

## Export paths

CLI writes files to:
```
daas/compile_down/output/<sessionSlug>/<runtime_lane>/
  <file paths as in the bundle>
  _bundle.json     (full bundle as a single serialized blob)
```

When `--record` is passed, same bundle goes to
`daasGeneratedArtifacts.artifactBundleJson` on the Convex prod, where
the Builder page reads it via `getScaffoldArtifact` /
`getWorldModelArtifact`.
