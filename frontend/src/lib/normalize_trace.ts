/**
 * In-browser trace normalizer.
 *
 * Mirrors daas/compile_down/normalizers/{claude_code,openai_agents,
 * gemini_traces,langchain_callbacks}.py for browser use: auto-detects
 * the input format, extracts a compact summary, and returns a
 * "brief" the user can drop into the Architect classifier prompt.
 *
 * Trace contents never leave the browser from this function. The
 * only thing that goes to the server is the short summary the user
 * chooses to submit.
 *
 * Supported input shapes:
 *   - Claude Code JSONL  (top-level {"type": "user"|"assistant"|...})
 *   - OpenAI chat messages array ([{"role": ...}])
 *   - OpenAI Assistants run-step array (objects with "step_details")
 *   - Gemini contents array ([{"role": "user"|"model", "parts": [...]}])
 *   - Gemini generateContent response ({"candidates": [...]})
 *   - LangChain BaseCallbackHandler event JSONL (events with "event" field)
 *   - LangSmith Run JSON ({"run_type": ..., "inputs": ..., "outputs": ...})
 */

export type TraceFormat =
  | "claude_code_jsonl"
  | "openai_chat"
  | "openai_run_steps"
  | "gemini_contents"
  | "gemini_response"
  | "langchain_events"
  | "langsmith_run"
  | "unknown";

export type ToolCall = { name: string; args: Record<string, unknown> };

export type TraceSummary = {
  format: TraceFormat;
  sourceModel: string;
  stepCount: number;
  toolCount: number;
  uniqueTools: string[];
  firstUserMessage: string;
  lastAssistantMessage: string;
  // For the classifier brief — concise text the user can submit
  brief: string;
};

export function normalizeTrace(raw: string, filename?: string): TraceSummary {
  const fmt = detectFormat(raw, filename);
  switch (fmt) {
    case "claude_code_jsonl":
      return normalizeClaudeCode(raw);
    case "openai_chat":
    case "openai_run_steps":
      return normalizeOpenAI(raw, fmt);
    case "gemini_contents":
    case "gemini_response":
      return normalizeGemini(raw, fmt);
    case "langchain_events":
    case "langsmith_run":
      return normalizeLangChain(raw, fmt);
    default:
      return emptySummary("unknown", raw);
  }
}

// ---------- format detection ---------------------------------------------
export function detectFormat(raw: string, filename?: string): TraceFormat {
  const head = raw.trim().slice(0, 2048);
  const lines = raw.split("\n").filter((l) => l.trim()).slice(0, 6);

  // Filename hint
  if (filename) {
    if (/\.jsonl$/i.test(filename) && head.includes('"type"')) {
      if (/"type"\s*:\s*"(?:user|assistant|tool_use|tool_result)"/.test(head))
        return "claude_code_jsonl";
    }
  }

  // JSONL detection — multiple JSON lines
  if (lines.length > 1) {
    let parsedOk = 0;
    for (const ln of lines) {
      try {
        const obj = JSON.parse(ln);
        parsedOk += 1;
        if (obj && typeof obj === "object") {
          if ("type" in obj) {
            const t = String((obj as Record<string, unknown>).type);
            if (
              t === "user" ||
              t === "assistant" ||
              t === "tool_use" ||
              t === "tool_result"
            ) {
              return "claude_code_jsonl";
            }
          }
          if ("event" in obj) {
            const ev = String((obj as Record<string, unknown>).event || "");
            if (ev.startsWith("on_")) return "langchain_events";
          }
        }
      } catch {
        /* not JSON */
      }
    }
    // Mixed: if several parsed as objects with "role", it's chat jsonl
    if (parsedOk >= 2 && /"role"\s*:/.test(head)) return "openai_chat";
  }

  // Single JSON document
  try {
    const doc = JSON.parse(raw);
    if (Array.isArray(doc)) {
      if (doc.length > 0) {
        const first = doc[0];
        if (first && typeof first === "object") {
          if ("role" in first) {
            const r = String((first as Record<string, unknown>).role);
            if (["user", "assistant", "tool", "system"].includes(r))
              return "openai_chat";
            if (r === "user" || r === "model" || r === "function") {
              if ("parts" in first) return "gemini_contents";
            }
          }
          if ("step_details" in first || first && (first as Record<string, unknown>).object === "thread.run.step")
            return "openai_run_steps";
        }
      }
    } else if (doc && typeof doc === "object") {
      const d = doc as Record<string, unknown>;
      if ("candidates" in d && Array.isArray(d.candidates))
        return "gemini_response";
      if ("contents" in d && Array.isArray(d.contents))
        return "gemini_contents";
      if ("messages" in d && Array.isArray(d.messages)) return "openai_chat";
      if ("steps" in d && Array.isArray(d.steps)) return "openai_run_steps";
      if ("run_type" in d && "inputs" in d) return "langsmith_run";
      if ("event" in d && String(d.event).startsWith("on_"))
        return "langchain_events";
    }
  } catch {
    /* not a single JSON */
  }

  return "unknown";
}

// ---------- per-format normalizers --------------------------------------
function normalizeClaudeCode(raw: string): TraceSummary {
  const lines = raw.split("\n").filter((l) => l.trim());
  const tools = new Set<string>();
  const toolCalls: ToolCall[] = [];
  let firstUser = "";
  let lastAssistant = "";
  let model = "";
  let stepCount = 0;

  for (const ln of lines) {
    try {
      const o = JSON.parse(ln) as Record<string, unknown>;
      const t = String(o.type || "");
      const msg = (o.message ?? {}) as Record<string, unknown>;
      if (t === "user") {
        const content = (msg.content ?? o.content ?? "") as
          | string
          | unknown[];
        // Skip tool_result-wrapped user messages
        const isToolResultWrapper =
          Array.isArray(content) &&
          content.some(
            (b) =>
              b &&
              typeof b === "object" &&
              (b as Record<string, unknown>).type === "tool_result",
          );
        if (!isToolResultWrapper) {
          const text = flattenContent(content);
          if (!firstUser && text) firstUser = text;
          stepCount += 1;
        }
      } else if (t === "assistant") {
        const content = (msg.content ?? []) as unknown;
        const text = flattenContent(content);
        if (text) lastAssistant = text;
        if (!model && msg.model) model = String(msg.model);
        if (Array.isArray(content)) {
          for (const b of content as unknown[]) {
            const blk = b as Record<string, unknown>;
            if (blk && blk.type === "tool_use") {
              const n = String(blk.name || "");
              if (n) {
                tools.add(n);
                toolCalls.push({
                  name: n,
                  args: (blk.input as Record<string, unknown>) ?? {},
                });
              }
            }
          }
        }
        stepCount += 1;
      } else if (t === "tool_use") {
        const n = String(o.name || "");
        if (n) tools.add(n);
      }
    } catch {
      /* skip bad lines */
    }
  }

  const unique = Array.from(tools);
  return buildSummary(
    "claude_code_jsonl",
    model || "claude-unknown",
    stepCount,
    unique,
    firstUser,
    lastAssistant,
    toolCalls.length,
  );
}

function normalizeOpenAI(raw: string, fmt: TraceFormat): TraceSummary {
  const doc = JSON.parse(raw);
  const stream: Record<string, unknown>[] = Array.isArray(doc)
    ? (doc as Record<string, unknown>[])
    : Array.isArray((doc as Record<string, unknown>).messages)
    ? ((doc as Record<string, unknown>).messages as Record<string, unknown>[])
    : Array.isArray((doc as Record<string, unknown>).steps)
    ? ((doc as Record<string, unknown>).steps as Record<string, unknown>[])
    : Array.isArray((doc as Record<string, unknown>).data)
    ? ((doc as Record<string, unknown>).data as Record<string, unknown>[])
    : [];

  const tools = new Set<string>();
  let firstUser = "";
  let lastAssistant = "";
  let model = "";
  let stepCount = 0;
  let toolCalls = 0;

  for (const ev of stream) {
    if ("role" in ev) {
      const role = String(ev.role);
      const content = ev.content as unknown;
      const text = flattenContent(content);
      stepCount += 1;
      if (role === "user" && !firstUser && text) firstUser = text;
      if (role === "assistant") {
        if (text) lastAssistant = text;
        if (!model && ev.model) model = String(ev.model);
        const tc = (ev.tool_calls ?? []) as unknown[];
        for (const c of tc) {
          const cc = c as Record<string, unknown>;
          const fn = (cc.function ?? {}) as Record<string, unknown>;
          const n = String(fn.name || cc.name || "");
          if (n) {
            tools.add(n);
            toolCalls += 1;
          }
        }
      }
    } else if ("step_details" in ev || ev.object === "thread.run.step") {
      const details = (ev.step_details ?? {}) as Record<string, unknown>;
      const type = String(ev.type || details.type || "");
      if (type === "tool_calls") {
        const tcs = (details.tool_calls ?? []) as unknown[];
        for (const tc of tcs) {
          const cc = tc as Record<string, unknown>;
          const fn = (cc.function ?? {}) as Record<string, unknown>;
          const n = String(fn.name || "");
          if (n) {
            tools.add(n);
            toolCalls += 1;
          }
        }
        stepCount += 1;
      } else if (type === "message_creation") {
        stepCount += 1;
      }
    }
  }

  return buildSummary(
    fmt,
    model || "openai-unknown",
    stepCount,
    Array.from(tools),
    firstUser,
    lastAssistant,
    toolCalls,
  );
}

function normalizeGemini(raw: string, fmt: TraceFormat): TraceSummary {
  const doc = JSON.parse(raw);
  let contents: Record<string, unknown>[] = [];
  let model = "";
  if (Array.isArray(doc)) {
    contents = doc as Record<string, unknown>[];
  } else if (doc && typeof doc === "object") {
    const d = doc as Record<string, unknown>;
    if (Array.isArray(d.contents)) {
      contents = d.contents as Record<string, unknown>[];
      if (d.model) model = String(d.model);
    } else if (Array.isArray(d.candidates)) {
      for (const c of d.candidates as Record<string, unknown>[]) {
        const content = c.content as Record<string, unknown> | undefined;
        if (content) contents.push(content);
      }
    }
  }

  const tools = new Set<string>();
  let firstUser = "";
  let lastAssistant = "";
  let stepCount = 0;
  let toolCalls = 0;

  for (const item of contents) {
    const role = String(item.role || "");
    const parts = (item.parts ?? []) as Record<string, unknown>[];
    const textBuf: string[] = [];
    for (const p of parts) {
      if (p && typeof p === "object") {
        if ("text" in p) textBuf.push(String(p.text));
        if ("functionCall" in p) {
          const fc = p.functionCall as Record<string, unknown>;
          const n = String(fc.name || "");
          if (n) {
            tools.add(n);
            toolCalls += 1;
          }
        }
      }
    }
    const text = textBuf.join("\n");
    stepCount += 1;
    if ((role === "user" || role === "") && !firstUser && text) firstUser = text;
    if (role === "model" && text) lastAssistant = text;
  }

  return buildSummary(
    fmt,
    model || "gemini-unknown",
    stepCount,
    Array.from(tools),
    firstUser,
    lastAssistant,
    toolCalls,
  );
}

function normalizeLangChain(raw: string, fmt: TraceFormat): TraceSummary {
  // Accept JSONL, a JSON array of events, or a single LangSmith Run doc.
  const tools = new Set<string>();
  let firstUser = "";
  let lastAssistant = "";
  let model = "";
  let stepCount = 0;
  let toolCalls = 0;

  const events: Record<string, unknown>[] = [];
  const lines = raw.split("\n").filter((l) => l.trim());
  for (const ln of lines) {
    try {
      const o = JSON.parse(ln);
      if (Array.isArray(o)) {
        events.push(...(o as Record<string, unknown>[]));
      } else {
        events.push(o as Record<string, unknown>);
      }
    } catch {
      /* skip */
    }
  }
  if (events.length === 0) {
    try {
      const doc = JSON.parse(raw);
      if (Array.isArray(doc)) events.push(...(doc as Record<string, unknown>[]));
      else events.push(doc as Record<string, unknown>);
    } catch {
      /* skip */
    }
  }

  for (const ev of events) {
    const name = String(ev.event || ev.type || "");
    if (name === "on_chain_start") {
      const inputs = (ev.inputs ?? {}) as Record<string, unknown>;
      const text =
        (inputs.input as string) ||
        (inputs.question as string) ||
        (inputs.prompt as string) ||
        "";
      if (!firstUser && text) firstUser = text;
      stepCount += 1;
    } else if (name === "on_llm_start") {
      const ser = (ev.serialized ?? {}) as Record<string, unknown>;
      const idArr = ser.id as string[] | undefined;
      const m =
        (Array.isArray(idArr) && idArr.length ? idArr[idArr.length - 1] : "") ||
        String(ser.name || "");
      if (!model && m) model = m;
      stepCount += 1;
    } else if (name === "on_llm_end") {
      const response = (ev.response ?? {}) as Record<string, unknown>;
      const gens = response.generations as unknown[][] | undefined;
      if (Array.isArray(gens) && gens.length && Array.isArray(gens[0]) && gens[0].length) {
        const first = gens[0][0] as Record<string, unknown>;
        if (first && first.text) lastAssistant = String(first.text);
      }
    } else if (name === "on_tool_start" || name === "on_agent_action") {
      const action = (ev.action ?? {}) as Record<string, unknown>;
      const n = String(ev.name || action.tool || "");
      if (n) {
        tools.add(n);
        toolCalls += 1;
      }
    } else if (name === "on_agent_finish") {
      const finish = (ev.finish ?? {}) as Record<string, unknown>;
      const rv = (finish.return_values ?? {}) as Record<string, unknown>;
      const out = String(rv.output || rv.answer || "");
      if (out) lastAssistant = out;
    }
    // LangSmith Run top-level envelope
    if (ev.run_type && ev.inputs) {
      const inputs = ev.inputs as Record<string, unknown>;
      if (!firstUser) firstUser = String(inputs.input ?? inputs.question ?? "");
      const outputs = (ev.outputs ?? {}) as Record<string, unknown>;
      if (outputs.output) lastAssistant = String(outputs.output);
    }
  }

  return buildSummary(
    fmt,
    model || "langchain-unknown",
    stepCount,
    Array.from(tools),
    firstUser,
    lastAssistant,
    toolCalls,
  );
}

// ---------- helpers ------------------------------------------------------
function flattenContent(content: unknown): string {
  if (content == null) return "";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const b of content) {
      if (b && typeof b === "object") {
        const blk = b as Record<string, unknown>;
        if (blk.type === "text" && typeof blk.text === "string") parts.push(blk.text);
        else if (blk.type === "tool_result" && typeof blk.content === "string")
          parts.push(blk.content);
      } else if (typeof b === "string") parts.push(b);
    }
    return parts.join("\n");
  }
  if (typeof content === "object") {
    const c = content as Record<string, unknown>;
    if (typeof c.text === "string") return c.text;
  }
  return String(content);
}

function emptySummary(format: TraceFormat, raw: string): TraceSummary {
  return {
    format,
    sourceModel: "unknown",
    stepCount: 0,
    toolCount: 0,
    uniqueTools: [],
    firstUserMessage: "",
    lastAssistantMessage: "",
    brief:
      format === "unknown"
        ? `Unrecognized trace format. First 200 chars:\n\n${raw.slice(0, 200)}…`
        : "",
  };
}

function buildSummary(
  format: TraceFormat,
  sourceModel: string,
  stepCount: number,
  uniqueTools: string[],
  firstUser: string,
  lastAssistant: string,
  toolCalls: number,
): TraceSummary {
  const first = firstUser.trim().slice(0, 300);
  const last = lastAssistant.trim().slice(0, 300);
  const brief = [
    `I'm attaching a **${FORMAT_LABEL[format]}** trace I ran.`,
    `Model: \`${sourceModel}\`. ${stepCount} steps, ${toolCalls} tool calls across ${uniqueTools.length} unique tools: ${uniqueTools.slice(0, 8).join(", ")}${uniqueTools.length > 8 ? ", …" : ""}.`,
    first ? `First user message:\n> ${first.replace(/\n/g, "\n> ")}` : "",
    last ? `Final assistant message:\n> ${last.replace(/\n/g, "\n> ")}` : "",
    "",
    "Based on this, what runtime and world-model would you recommend? Can the cheap path transfer, or would the judge catch regressions?",
  ]
    .filter(Boolean)
    .join("\n\n");

  return {
    format,
    sourceModel,
    stepCount,
    toolCount: toolCalls,
    uniqueTools,
    firstUserMessage: first,
    lastAssistantMessage: last,
    brief,
  };
}

export const FORMAT_LABEL: Record<TraceFormat, string> = {
  claude_code_jsonl: "Claude Code / Claude Agent SDK JSONL",
  openai_chat: "OpenAI chat completions / Agents SDK",
  openai_run_steps: "OpenAI Assistants run steps",
  gemini_contents: "Gemini multi-turn contents",
  gemini_response: "Gemini generateContent response",
  langchain_events: "LangChain BaseCallbackHandler events",
  langsmith_run: "LangSmith Run export",
  unknown: "Unrecognized",
};
