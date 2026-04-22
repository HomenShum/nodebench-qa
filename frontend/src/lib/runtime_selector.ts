/**
 * Runtime-selector catalog + localStorage persistence.
 *
 * Mirrors daas/agent/runtimes/__init__.py so the UI dropdown options
 * match the Python AgentRuntime registry. New runtime = new entry here
 * + a matching registration on the Python side.
 */

export type RuntimeId =
  | "gemini_agent"
  | "openai_agents_sdk"
  | "claude_agent_sdk"
  | "langgraph"
  | "openrouter";

export type RuntimeOption = {
  id: RuntimeId;
  label: string;
  provider: string;
  defaultModel: string;
  models: string[];
  pricePerMillionIn: number;
  pricePerMillionOut: number;
  requiresEnv: string;
  note: string;
};

export const RUNTIME_CATALOG: RuntimeOption[] = [
  {
    id: "gemini_agent",
    label: "Gemini Agent (Google)",
    provider: "google",
    defaultModel: "gemini-3-pro",
    models: [
      "gemini-3-pro",
      "gemini-3.1-pro-preview",
      "gemini-3.1-flash-lite",
      "gemini-3.1-flash-lite-preview",
    ],
    pricePerMillionIn: 2.0,
    pricePerMillionOut: 12.0,
    requiresEnv: "GEMINI_API_KEY",
    note: "Native google-genai function-calling; REST-only, zero extra deps.",
  },
  {
    id: "openai_agents_sdk",
    label: "OpenAI Agents SDK",
    provider: "openai",
    defaultModel: "gpt-5.4",
    models: ["gpt-5.4", "gpt-5.1", "gpt-5", "gpt-5.4-nano"],
    pricePerMillionIn: 2.5,
    pricePerMillionOut: 2.5,
    requiresEnv: "OPENAI_API_KEY",
    note: "Runner + Agent + @function_tool. Built-in FileSearch/Shell/WebSearch.",
  },
  {
    id: "claude_agent_sdk",
    label: "Claude Agent SDK (Anthropic)",
    provider: "anthropic",
    defaultModel: "claude-sonnet-4.6",
    models: ["claude-opus-4.7", "claude-sonnet-4.6", "claude-haiku-4.5"],
    pricePerMillionIn: 3.0,
    pricePerMillionOut: 15.0,
    requiresEnv: "ANTHROPIC_API_KEY",
    note: "ClaudeSDKClient + @tool + in-process MCP server.",
  },
  {
    id: "langgraph",
    label: "LangGraph (any provider)",
    provider: "langchain",
    defaultModel: "gemini-3-pro",
    models: [
      "gemini-3-pro",
      "gpt-5.4",
      "claude-sonnet-4.6",
      "openrouter/anthropic/claude-sonnet-4.6",
    ],
    pricePerMillionIn: 2.0,
    pricePerMillionOut: 12.0,
    requiresEnv: "(per-provider key of your choice)",
    note: "StateGraph + create_react_agent + checkpointer. Wraps any LangChain chat model.",
  },
  {
    id: "openrouter",
    label: "OpenRouter (300+ models)",
    provider: "openrouter",
    defaultModel: "anthropic/claude-sonnet-4.6",
    models: [
      "anthropic/claude-sonnet-4.6",
      "anthropic/claude-opus-4.7",
      "openai/gpt-5.4",
      "google/gemini-3-pro",
      "google/gemini-3.1-flash-lite",
      "deepseek/deepseek-v3.2",
      "meta-llama/llama-3.3-70b-instruct",
    ],
    pricePerMillionIn: 3.0,
    pricePerMillionOut: 15.0,
    requiresEnv: "OPENROUTER_API_KEY",
    note: "OpenAI-compatible gateway. Bring-your-own-key; automatic fallback routing.",
  },
];

const STORAGE_KEY = "attrition:runtime_selection";

export type RuntimeSelection = {
  runtime: RuntimeId;
  model: string;
};

export function loadRuntimeSelection(): RuntimeSelection {
  if (typeof window === "undefined") {
    return { runtime: "gemini_agent", model: "gemini-3-pro" };
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as RuntimeSelection;
      const opt = RUNTIME_CATALOG.find((r) => r.id === parsed.runtime);
      if (opt && opt.models.includes(parsed.model)) return parsed;
    }
  } catch {
    /* fall through */
  }
  return { runtime: "gemini_agent", model: "gemini-3-pro" };
}

export function saveRuntimeSelection(sel: RuntimeSelection): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(sel));
  } catch {
    /* storage disabled */
  }
}

export function runtimeById(id: string): RuntimeOption | undefined {
  return RUNTIME_CATALOG.find((r) => r.id === id);
}
