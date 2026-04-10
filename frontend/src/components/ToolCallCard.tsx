/* ── Inline tool execution card (like Claude Code) ─────────── */

const mono: React.CSSProperties = {
  fontFamily: "'JetBrains Mono', monospace",
};

interface ToolCallCardProps {
  toolName: string;
  content: string;
  status: "running" | "complete" | "error";
}

function statusIcon(status: "running" | "complete" | "error"): string {
  switch (status) {
    case "running":
      return "\u{1F50D}"; // magnifying glass
    case "complete":
      return "\u2713";
    case "error":
      return "\u2717";
  }
}

function statusColor(status: "running" | "complete" | "error"): string {
  switch (status) {
    case "running":
      return "#eab308";
    case "complete":
      return "#22c55e";
    case "error":
      return "#ef4444";
  }
}

export function ToolCallCard({ toolName, content, status }: ToolCallCardProps) {
  return (
    <div
      style={{
        borderRadius: "0.5rem",
        border: `1px solid ${
          status === "error"
            ? "rgba(239,68,68,0.2)"
            : status === "running"
              ? "rgba(234,179,8,0.2)"
              : "rgba(34,197,94,0.15)"
        }`,
        background:
          status === "error"
            ? "rgba(239,68,68,0.04)"
            : status === "running"
              ? "rgba(234,179,8,0.04)"
              : "rgba(34,197,94,0.04)",
        padding: "0.625rem 0.75rem",
        marginBottom: "0.25rem",
      }}
    >
      {/* Header row */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.5rem",
          marginBottom: content ? "0.375rem" : 0,
        }}
      >
        <span style={{ fontSize: "0.8125rem" }}>{statusIcon(status)}</span>
        <span
          style={{
            ...mono,
            fontSize: "0.6875rem",
            fontWeight: 600,
            color: statusColor(status),
            letterSpacing: "0.02em",
          }}
        >
          {status === "running" ? `Running ${toolName}...` : toolName}
        </span>
        {status === "running" && (
          <span
            style={{
              ...mono,
              fontSize: "0.625rem",
              color: "#6b6560",
              animation: "pulse 1.5s infinite",
            }}
          >
            ...
          </span>
        )}
      </div>

      {/* Content body */}
      {content && status !== "running" && (
        <pre
          style={{
            ...mono,
            fontSize: "0.6875rem",
            lineHeight: 1.5,
            color: "#9a9590",
            margin: 0,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}
        >
          {content}
        </pre>
      )}
    </div>
  );
}
