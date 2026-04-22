# attrition skills manifest

Every file in this directory is a runtime-agnostic markdown recipe for
generating a scaffold in one target SDK. The attrition-agent loads the
relevant file into its system prompt, then uses the standard toolbox
(`write_file`, `edit_file`, `ast_parse_check`, `run_shell`,
`search_web`, `emit_done`) to build the bundle.

Skills are plain markdown. Anyone can contribute one without touching
Python — add a file under `daas/skills/<lane>.md`, register the slug
in `daas/agent/agent_loop.py::LANE_REGISTRY`, done.

## Lane index

| Slug | Skill file | Status | Notes |
|---|---|---|---|
| `simple_chain` | [simple_chain.md](./simple_chain.md) | SHIPPED | Single LLM call + schema |
| `tool_first_chain` | [tool_first_chain.md](./tool_first_chain.md) | SHIPPED | Bounded tool loop |
| `orchestrator_worker` | [orchestrator_worker.md](./orchestrator_worker.md) | SHIPPED | Plan → dispatch → compact |
| `openai_agents_sdk` | [openai_agents_sdk.md](./openai_agents_sdk.md) | SHIPPED | openai-agents |
| `langgraph_python` | [langgraph_python.md](./langgraph_python.md) | SHIPPED | StateGraph + checkpointer |
| `claude_agent_sdk` | [claude_agent_sdk.md](./claude_agent_sdk.md) | NEW | ClaudeSDKClient + @tool |
| `manus` | [manus.md](./manus.md) | NEW | Task / object UX + connector visibility |
| `deerflow` | [deerflow.md](./deerflow.md) | NEW | Multi-agent research fanout |
| `hermes` | [hermes.md](./hermes.md) | NEW | Tool-call benchmark harness variants |
| `convex_functions` | [convex_functions.md](./convex_functions.md) | NEW | Convex TypeScript actions + schema |
| `vercel_ai_sdk` | [vercel_ai_sdk.md](./vercel_ai_sdk.md) | NEW | Next.js route handlers + `ai` package |

## Cross-cutting rules

See [_style.md](./_style.md). Every emit MUST:

1. Produce `ast.parse`-valid Python files (or `tsc`-clean TypeScript).
2. Include `README.md`, `requirements.txt` (or `package.json`),
   `run.sh` (or `npm start`), and `.env.example`.
3. Be runnable in mock mode with zero API keys.
4. Never hard-code secrets; always read from env with a fallback stub.
5. Close with `emit_done(summary: str)` — the agent loop halts on this.

## When the classifier picks a lane

The classifier in `convex/domains/daas/architectClassifier.ts` consumes
the **lane index above** in its system prompt. New skill file → new
lane available in the dropdown. No classifier code change needed.
