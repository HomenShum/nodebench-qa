# Translation Layer Audit (Cycle 20)

Triggered by a direct user question: "do we actually have the translation layer?"

The GAP_CHECKLIST claimed Cycles 2–6 shipped compile_down / compile_up /
translate. Some of those blocks had not been personally re-verified in
this session. This doc records the honest verification.

Date: 2026-04-20
Commit: audit run against current `main`

## Diagram-to-code mapping

The product-vision diagram shows 8 blocks. Where they live in the
codebase and their current verified state:

| Diagram block | Code location | Verified? |
|---|---|---|
| 1. Capture + Normalize | `daas/compile_down/normalizers/` + `convex/domains/daas/http.ts` | **Yes** — Claude Code JSONL, Cursor, LangGraph import all parse their documented shapes |
| 2. Distiller | `daas/compile_down/cli.py::trace_to_workflow_spec` + `daas/distill.py` | **Yes** — extracts tools from trace, produces `WorkflowSpec` |
| 3. Compile Down | `daas/compile_down/emitters/simple_chain.py` + `tool_first_chain.py` | **Yes** — emit valid Python; used in production |
| 4. Compile Up / Translate | `daas/compile_down/emitters/orchestrator_worker.py` + `openai_agents.py` + `langgraph_python.py` | **Yes — newly verified** — all three emit ast-valid Python. NOTE: lives inside `compile_down/emitters/`, NOT a separate `compile_up/` dir. Naming is misleading. |
| 5. Connector Resolver (mock/live/hybrid) | UI in `Builder.tsx` + `useConnectorMode` hook + `docs/CONNECTOR_RESOLVER_SPEC.md` | **Partial** — UI + spec only; emitted `tools.py` returns `_stub_<name>` regardless of mode. No executing switcher today. |
| 6. Replay Runtime | `convex/domains/daas/actions.ts::replayTrace` + `daas/benchmarks/bfcl/live.py` | **Partial** — trace-level replay works; but emitted orchestrator_worker runtime has a TODO for full worker dispatch (plan + compact loop only) |
| 7. Judge + Benchmark | `daas/fidelity/` + `daas/benchmarks/` + `domains/daas/actions.ts::judgeReplay` | **Yes** — BFCL AST scorer, rubric boolean judge, 13 benchmark adapters, verdict rows in `daasFidelityVerdicts` |
| 8. Ship (code) / Route (up) | Ship = ZIP download + clipboard (Builder UI). Route = classification label only | **Partial** — ship is real; route is a label, not an executing service |

## Live audit run (just executed)

Against a synthetic but realistic Claude Code session JSONL:

```
[OK] normalizer(claude_code)
       session_id=audit, query='Find SKUs with stock <10 in STR-101',
       source_model=claude-opus-4-7, steps=2, tokens=122
[OK] distiller (trace -> WorkflowSpec)
       1 tool extracted: ['query_inventory']
[OK] emit(simple_chain        ): 5 files, 3833B,  3 .py all parse
[OK] emit(tool_first_chain    ): 6 files, 6824B,  4 .py all parse
[OK] emit(orchestrator_worker ): 11 files, 8158B, 9 .py all parse
[OK] emit(openai_agents_sdk   ): 5 files, 1830B,  3 .py all parse
[OK] emit(langgraph_python    ): 5 files, 2878B,  3 .py all parse
[OK] normalizer(cursor): 2 steps, 1 tool_call
[OK] langgraph_import: 2 workers, 1 handoff
```

## What honestly can + cannot be claimed on the landing

### Can claim (verified)
- Any trace (Claude Code / Cursor / LangGraph graph) normalizes to a
  canonical WorkflowSpec
- Same WorkflowSpec emits to 5 runtime-lane targets (simple_chain,
  tool_first_chain, orchestrator_worker) + 2 cross-SDK targets
  (openai_agents_sdk, langgraph_python)
- Every emitted `.py` passes `ast.parse`
- Full world-model substrate emits 10 files per session

### Cannot claim (today)
- Connector resolver actually switches behavior at runtime (mode is
  UI + docs only)
- Emitted orchestrator_worker code runs the full worker fan-out
  (current runtime has plan + compact only; full dispatch is a TODO)
- Automatic routing of task instances to the big model at request time
  (it's a recommendation lane, not an executing router)

### Next verification gates (before landing claims these work)
1. End-to-end Cursor export → LangGraph runnable package, smoke-tested
2. Connector mode flip produces different replay output on a real task
3. Emitted orchestrator_worker runtime successfully dispatches a 3-worker
   plan on one benchmark task end-to-end

## Action items

- [x] Stop claiming translation layer is fully end-to-end in the
      ProofSection marketing — it's not shipped there yet
- [ ] Wire the connector resolver so flipping the mode actually produces
      different replay behavior (next cycle)
- [ ] Finish orchestrator.py worker dispatch (currently TODO) so the
      generated orchestrator_worker code really runs the full Anthropic
      pattern, not just plan + compact
- [ ] Create a `daas/compile_up/` symlink or module that exposes the
      translation emitters under their diagram name for clarity
