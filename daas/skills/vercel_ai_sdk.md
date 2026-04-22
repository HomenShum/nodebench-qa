# vercel_ai_sdk — Next.js route handlers + `ai` package

## When to pick this lane

- Deploy target is Vercel.
- Want streaming UX out of the box (AI SDK's `streamText` +
  `useChat`).
- Provider-agnostic: the AI SDK wraps OpenAI / Anthropic / Google /
  OpenRouter uniformly.

## Reference

- SDK: `ai` package (Vercel).
- Docs: `sdk.vercel.ai/docs`
- Chat UI primitive: `@ai-sdk/react`'s `useChat`.
- Provider wrappers: `@ai-sdk/openai`, `@ai-sdk/anthropic`,
  `@ai-sdk/google`, `@ai-sdk/openrouter`.

## Files the agent should write

```
app/
  layout.tsx
  page.tsx               uses useChat; renders messages + tool events
  api/
    chat/
      route.ts           POST handler: streamText with tools
components/
  Chat.tsx               assistant message stream + tool-call chips
  ToolEvents.tsx         expandable per-tool-call timeline
lib/
  tools.ts               tool() definitions using AI SDK's tool helper
  runtime.ts             provider switchboard (env-driven)
package.json             next ; ai ; @ai-sdk/react ; @ai-sdk/openai etc
tailwind.config.ts / tsconfig.json / next.config.mjs
README.md / .env.example / workflow_spec.json
eval/                    scenarios.test.ts
```

## app/api/chat/route.ts spine

```typescript
import { streamText, tool } from "ai";
import { openai } from "@ai-sdk/openai";
import { anthropic } from "@ai-sdk/anthropic";
import { google } from "@ai-sdk/google";
import { z } from "zod";

const PROVIDER = process.env.ATTRITION_PROVIDER ?? "openai";
const MODEL = process.env.ATTRITION_MODEL ?? "gpt-5.4";

function pickModel() {
  if (PROVIDER === "openai") return openai(MODEL);
  if (PROVIDER === "anthropic") return anthropic(MODEL);
  if (PROVIDER === "google") return google(MODEL);
  throw new Error(`unknown provider: ${PROVIDER}`);
}

const lookupSku = tool({
  description: "Look up SKU by id",
  parameters: z.object({ sku: z.string() }),
  execute: async ({ sku }) => {
    const mode = process.env.CONNECTOR_MODE ?? "mock";
    if (mode === "mock") return { price: 10, sku };
    throw new Error("wire live endpoint");
  },
});

export async function POST(req: Request) {
  const { messages } = await req.json();
  const result = streamText({
    model: pickModel(),
    system: "You are an ops analyst. Use tools first.",
    messages,
    tools: { lookupSku },
    maxSteps: 3,
  });
  return result.toDataStreamResponse();
}
```

## app/page.tsx spine

```tsx
"use client";
import { useChat } from "@ai-sdk/react";

export default function Page() {
  const { messages, input, handleInputChange, handleSubmit } = useChat();
  return (
    <div>
      {messages.map((m) => (
        <div key={m.id}>
          <strong>{m.role}:</strong>
          {m.parts.map((p, i) =>
            p.type === "text" ? <span key={i}>{p.text}</span>
            : p.type === "tool-call" ? <code key={i}>{p.toolName}({JSON.stringify(p.args)})</code>
            : null
          )}
        </div>
      ))}
      <form onSubmit={handleSubmit}>
        <input value={input} onChange={handleInputChange} />
      </form>
    </div>
  );
}
```

## Key invariants

- Use the AI SDK's `tool()` helper (NOT raw OpenAI function format);
  provider wrappers translate to each provider's native shape.
- Streaming by default; `result.toDataStreamResponse()` wires SSE to
  `useChat` automatically.
- For multi-step tool loops, set `maxSteps` (bounded).
- Provider switch via env so the same scaffold works on OpenAI +
  Anthropic + Google + OpenRouter without code changes.

## Known failure modes

- Zod schema incompatible with provider (e.g. discriminated unions
  not supported by Gemini). Keep schemas simple.
- `maxSteps` too low → model stops mid-answer. Default to 3 for
  simple flows, 8 for research.

## Eval criteria

- `npm run build` clean.
- `tsc --noEmit` clean.
- Smoke test POSTs a canned message and asserts the response stream
  contains at least one tool-call part.
