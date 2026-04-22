# manus — task/object UX shape with file + connector visibility

## When to pick this lane

- User wants the Manus UX pattern: every agent action surfaces as a
  task with files + connector activity visible in real time.
- Emit target is a web app (not a pure CLI).
- Need inspectable execution — user can pause, replay, inspect any
  step.

## Note

Manus is primarily a UX pattern, not an SDK. This lane emits a
**Next.js app scaffold** that renders tasks / files / connectors
using the same shape as Manus. The agent execution underneath uses
any of the other runtimes (Claude / OpenAI / Gemini / LangGraph).

## Files the agent should write

```
app/
  layout.tsx        shell with task/file/connector panels
  page.tsx          main task view
  api/
    task/
      route.ts      POST creates task, GET streams SSE events
components/
  TaskPanel.tsx     left pane: task tree + current status
  FilesPanel.tsx    center pane: files read/written by the agent
  ConnectorsPanel.tsx  right pane: connector (tool) activity log
  EventStream.tsx   subscribes to SSE, dispatches to panels
lib/
  agent.ts          client to whichever runtime drives execution
  tools.ts          connector definitions + mock/live dispatch
package.json        next ; react ; zod ; ai (or specific driver SDK)
next.config.mjs
README.md / .env.example / workflow_spec.json
eval/               scenarios.test.ts
```

## Key UX invariants

- Task panel: tree of task → subtask → tool calls. Expandable; each
  node shows status icon (pending / running / succeeded / failed).
- Files panel: every `write_file` + `edit_file` produces a card with
  filename, diff preview, timestamp.
- Connectors panel: every tool call produces a card showing args,
  response, elapsed_ms, mode (mock/live).
- SSE event stream: one event per agent turn; typed events for
  `task_started` / `tool_called` / `file_written` / `task_completed`.

## Key runtime invariants

- The Next.js route handler (`app/api/task/route.ts`) spawns an agent
  run using one of our AgentRuntime adapters (configured via env:
  `ATTRITION_RUNTIME=gemini_agent|openai_agents_sdk|...`).
- The agent emits normalized events; the route handler re-emits them
  as SSE.
- No client-side secrets; the route handler reads provider keys
  from env.

## Known failure modes

- SSE connection drops → events lost. Mitigation: include
  monotonically-increasing event_id; client reconnects with
  `Last-Event-ID` header; server replays from a circular buffer.
- Large file previews bloat the DOM. Mitigation: diff-only previews
  past 200 lines; full view on click.

## Eval criteria

- `npm run build` clean.
- `tsc --noEmit` clean.
- API route handles a mock task end-to-end and streams at least 5
  typed events.
