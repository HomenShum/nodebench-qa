import {
  createContext,
  useContext,
  useState,
  useCallback,
  type ReactNode,
} from "react";

/* ── Types ────────────────────────────────────────────────────── */

export interface ChatMessage {
  id: string;
  role: "user" | "agent" | "tool";
  content: string;
  timestamp: string;
  toolName?: string;
  toolStatus?: "running" | "complete" | "error";
}

interface ChatState {
  messages: ChatMessage[];
  isOpen: boolean;
  isProcessing: boolean;
}

interface ChatContextValue extends ChatState {
  sendMessage: (text: string) => void;
  togglePanel: () => void;
  openPanel: () => void;
  closePanel: () => void;
  /** Inject a pre-built conversation (for "Open in chat" flows) */
  injectConversation: (msgs: ChatMessage[]) => void;
}

/* ── Helpers ───────────────────────────────────────────────────── */

let _idCounter = 0;
function nextId(): string {
  _idCounter += 1;
  return `msg_${Date.now()}_${_idCounter}`;
}

function now(): string {
  return new Date().toISOString();
}

/* ── Simulated scan findings ──────────────────────────────────── */

function simulateScanFindings(url: string): ChatMessage[] {
  const findings: ChatMessage[] = [];

  findings.push({
    id: nextId(),
    role: "tool",
    content: `Crawling ${url}...`,
    timestamp: now(),
    toolName: "bp.check",
    toolStatus: "running",
  });

  findings.push({
    id: nextId(),
    role: "tool",
    content: [
      `Crawled 3 pages in 1.2s`,
      `Score: 85/100`,
      ``,
      `Findings:`,
      `  [warn] Missing viewport meta tag on /about`,
      `  [info] 2 images without alt text on /`,
      `  [info] No canonical URL set on /pricing`,
    ].join("\n"),
    timestamp: now(),
    toolName: "bp.check",
    toolStatus: "complete",
  });

  findings.push({
    id: nextId(),
    role: "agent",
    content: [
      `Scan complete for ${url}.`,
      ``,
      `Overall score: **85/100**`,
      ``,
      `Found 3 issues:`,
      `- 1 warning: missing viewport meta on /about`,
      `- 2 info: missing alt text and canonical URLs`,
      ``,
      `The site is mostly clean. The viewport issue should be fixed for mobile rendering.`,
      `View the full trace at /anatomy for step-by-step details.`,
    ].join("\n"),
    timestamp: now(),
  });

  return findings;
}

function simulateStatusResponse(): ChatMessage[] {
  return [
    {
      id: nextId(),
      role: "tool",
      content: [
        `Hook Status Summary:`,
        `  SessionStart    active`,
        `  PreToolUse      active`,
        `  PostToolUse     active`,
        `  Stop            active`,
        `  10/10 hooks installed`,
      ].join("\n"),
      timestamp: now(),
      toolName: "bp.status",
      toolStatus: "complete",
    },
    {
      id: nextId(),
      role: "agent",
      content:
        "All 10 hooks are active and reporting. The system is fully instrumented. Visit /live for the real-time dashboard.",
      timestamp: now(),
    },
  ];
}

function simulateMissedSteps(): ChatMessage[] {
  return [
    {
      id: nextId(),
      role: "tool",
      content: [
        `Workflow: API Client Refactor`,
        `Steps: 8 total, 5 completed`,
        ``,
        `Missing steps:`,
        `  [4] Search for breaking changes in dependent packages`,
        `  [7] Run integration tests (only unit tests ran)`,
        `  [8] Build and verify clean output`,
      ].join("\n"),
      timestamp: now(),
      toolName: "bp.workflow.check",
      toolStatus: "complete",
    },
    {
      id: nextId(),
      role: "agent",
      content: [
        "The agent missed 3 of 8 required workflow steps:",
        "",
        "1. Never searched for breaking changes in dependencies",
        "2. Skipped integration tests (ran unit tests only)",
        "3. Did not run a final build to verify clean output",
        "",
        "This is a typical ESCALATE verdict. The agent declared done after unit tests passed, but the workflow standard requires integration tests and a build gate.",
      ].join("\n"),
      timestamp: now(),
    },
  ];
}

function simulateHelpResponse(): ChatMessage[] {
  return [
    {
      id: nextId(),
      role: "agent",
      content: [
        "Available commands:",
        "",
        '  scan <url>     - Run a QA check on a URL (e.g., "scan https://example.com")',
        '  check <url>    - Same as scan',
        "  show status    - Show hook status summary",
        "  what did the agent miss? - Show missing workflow steps",
        "  help           - Show this message",
        "",
        "Try: scan https://example.com",
      ].join("\n"),
      timestamp: now(),
    },
  ];
}

function simulateGenericResponse(): ChatMessage[] {
  return [
    {
      id: nextId(),
      role: "agent",
      content:
        'I can scan URLs, show what agents missed, or check hook status. Try: "scan https://example.com" or "show status"',
      timestamp: now(),
    },
  ];
}

/* ── Command router ───────────────────────────────────────────── */

function routeCommand(text: string): ChatMessage[] {
  const lower = text.toLowerCase().trim();

  // scan / check <url>
  const scanMatch = lower.match(/^(?:scan|check)\s+(.+)/);
  if (scanMatch) {
    let url = scanMatch[1].trim();
    if (!url.startsWith("http")) url = `https://${url}`;
    return simulateScanFindings(url);
  }

  if (lower.includes("status")) return simulateStatusResponse();
  if (lower.includes("miss") || lower.includes("skip")) return simulateMissedSteps();
  if (lower === "help" || lower === "?") return simulateHelpResponse();

  return simulateGenericResponse();
}

/* ── Context ──────────────────────────────────────────────────── */

const ChatContext = createContext<ChatContextValue | null>(null);

export function ChatProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ChatState>({
    messages: [],
    isOpen: false,
    isProcessing: false,
  });

  const togglePanel = useCallback(() => {
    setState((s) => ({ ...s, isOpen: !s.isOpen }));
  }, []);

  const openPanel = useCallback(() => {
    setState((s) => ({ ...s, isOpen: true }));
  }, []);

  const closePanel = useCallback(() => {
    setState((s) => ({ ...s, isOpen: false }));
  }, []);

  const injectConversation = useCallback((msgs: ChatMessage[]) => {
    setState((s) => ({
      ...s,
      messages: [...s.messages, ...msgs],
      isOpen: true,
    }));
  }, []);

  const sendMessage = useCallback((text: string) => {
    const userMsg: ChatMessage = {
      id: nextId(),
      role: "user",
      content: text,
      timestamp: now(),
    };

    setState((s) => ({
      ...s,
      messages: [...s.messages, userMsg],
      isProcessing: true,
    }));

    // Simulate thinking delay, then tool call, then response
    const responses = routeCommand(text);
    let delay = 500; // initial "thinking" delay

    responses.forEach((msg, i) => {
      const isToolRunning = msg.toolStatus === "running";
      const currentDelay = delay;

      setTimeout(() => {
        setState((s) => ({
          ...s,
          messages: [...s.messages, msg],
          isProcessing: i < responses.length - 1,
        }));
      }, currentDelay);

      delay += isToolRunning ? 1000 : 500;
    });
  }, []);

  return (
    <ChatContext.Provider
      value={{
        ...state,
        sendMessage,
        togglePanel,
        openPanel,
        closePanel,
        injectConversation,
      }}
    >
      {children}
    </ChatContext.Provider>
  );
}

export function useChat(): ChatContextValue {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error("useChat must be used within ChatProvider");
  return ctx;
}
