import { type ChatMessage as ChatMessageType } from "../contexts/ChatContext";
import { ToolCallCard } from "./ToolCallCard";

/* ── Styles ────────────────────────────────────────────────────── */

const mono: React.CSSProperties = {
  fontFamily: "'JetBrains Mono', monospace",
};

/* ── Render helpers ────────────────────────────────────────────── */

/** Simple markdown-ish rendering: **bold**, `code`, and line breaks */
function renderContent(text: string): React.ReactNode[] {
  const lines = text.split("\n");
  const nodes: React.ReactNode[] = [];

  lines.forEach((line, li) => {
    // Bold: **text**
    const parts = line.split(/(\*\*[^*]+\*\*)/g);
    const lineNodes = parts.map((part, pi) => {
      if (part.startsWith("**") && part.endsWith("**")) {
        return (
          <strong key={`${li}-${pi}`} style={{ color: "#e8e6e3", fontWeight: 600 }}>
            {part.slice(2, -2)}
          </strong>
        );
      }
      // Inline code: `code`
      const codeParts = part.split(/(`[^`]+`)/g);
      return codeParts.map((cp, ci) => {
        if (cp.startsWith("`") && cp.endsWith("`")) {
          return (
            <code
              key={`${li}-${pi}-${ci}`}
              style={{
                ...mono,
                fontSize: "0.75rem",
                padding: "0.1rem 0.3rem",
                borderRadius: "0.2rem",
                background: "rgba(255,255,255,0.06)",
                color: "#d97757",
              }}
            >
              {cp.slice(1, -1)}
            </code>
          );
        }
        return <span key={`${li}-${pi}-${ci}`}>{cp}</span>;
      });
    });

    nodes.push(<span key={`line-${li}`}>{lineNodes}</span>);
    if (li < lines.length - 1) {
      nodes.push(<br key={`br-${li}`} />);
    }
  });

  return nodes;
}

/* ── Component ─────────────────────────────────────────────────── */

interface ChatMessageProps {
  message: ChatMessageType;
}

export function ChatMessageBubble({ message }: ChatMessageProps) {
  const { role, content, toolName, toolStatus } = message;

  // Tool messages render as ToolCallCard
  if (role === "tool" && toolName && toolStatus) {
    return (
      <div style={{ padding: "0.25rem 0" }}>
        <ToolCallCard
          toolName={toolName}
          content={content}
          status={toolStatus}
        />
      </div>
    );
  }

  // User messages: right-aligned, terracotta
  if (role === "user") {
    return (
      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
          padding: "0.25rem 0",
        }}
      >
        <div
          style={{
            maxWidth: "85%",
            padding: "0.5rem 0.75rem",
            borderRadius: "0.625rem 0.625rem 0.125rem 0.625rem",
            background: "rgba(217,119,87,0.15)",
            border: "1px solid rgba(217,119,87,0.2)",
            fontSize: "0.8125rem",
            color: "#e8e6e3",
            lineHeight: 1.5,
          }}
        >
          {content}
        </div>
      </div>
    );
  }

  // Agent messages: left-aligned, glass card
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "flex-start",
        padding: "0.25rem 0",
      }}
    >
      <div
        style={{
          maxWidth: "90%",
          padding: "0.625rem 0.75rem",
          borderRadius: "0.625rem 0.625rem 0.625rem 0.125rem",
          background: "rgba(255,255,255,0.03)",
          border: "1px solid rgba(255,255,255,0.06)",
          fontSize: "0.8125rem",
          color: "#c5c0bb",
          lineHeight: 1.6,
        }}
      >
        {renderContent(content)}
      </div>
    </div>
  );
}
