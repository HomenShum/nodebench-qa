import { useState, useRef, useEffect } from "react";
import { useChat } from "../contexts/ChatContext";
import { ChatMessageBubble } from "./ChatMessage";

/* ── Styles ────────────────────────────────────────────────────── */

const mono: React.CSSProperties = {
  fontFamily: "'JetBrains Mono', monospace",
};

/* ── Component ─────────────────────────────────────────────────── */

export function ChatPanel() {
  const { messages, isOpen, isProcessing, sendMessage, closePanel } = useChat();
  const [input, setInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Focus input when panel opens
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || isProcessing) return;
    sendMessage(trimmed);
    setInput("");
  }

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={closePanel}
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 90,
          background: "rgba(0,0,0,0.3)",
        }}
      />

      {/* Panel */}
      <div
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          bottom: 0,
          width: 400,
          maxWidth: "100vw",
          zIndex: 100,
          display: "flex",
          flexDirection: "column",
          background: "#0e0e0f",
          borderLeft: "1px solid rgba(255,255,255,0.06)",
          boxShadow: "-8px 0 32px rgba(0,0,0,0.5)",
        }}
      >
        {/* ── Header ──────────────────────────────────────────── */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "0.875rem 1rem",
            borderBottom: "1px solid rgba(255,255,255,0.06)",
            flexShrink: 0,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <span style={{ fontSize: "0.9375rem", fontWeight: 600, color: "#e8e6e3" }}>
              Ask attrition
            </span>
            <span
              style={{
                ...mono,
                fontSize: "0.5625rem",
                padding: "0.1rem 0.375rem",
                borderRadius: "0.25rem",
                background: "rgba(34,197,94,0.1)",
                color: "#22c55e",
                fontWeight: 600,
                letterSpacing: "0.04em",
              }}
            >
              DEMO
            </span>
          </div>
          <button
            onClick={closePanel}
            style={{
              background: "none",
              border: "none",
              color: "#6b6560",
              fontSize: "1.25rem",
              cursor: "pointer",
              padding: "0.25rem",
              lineHeight: 1,
            }}
            aria-label="Close chat panel"
          >
            \u2715
          </button>
        </div>

        {/* ── Messages ────────────────────────────────────────── */}
        <div
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "0.75rem",
            scrollbarWidth: "thin",
            scrollbarColor: "rgba(255,255,255,0.1) transparent",
          }}
        >
          {messages.length === 0 && (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                height: "100%",
                gap: "1rem",
                padding: "2rem 1rem",
              }}
            >
              <div
                style={{
                  fontSize: "0.9375rem",
                  fontWeight: 600,
                  color: "#e8e6e3",
                  textAlign: "center",
                }}
              >
                Ask attrition anything
              </div>
              <p
                style={{
                  fontSize: "0.8125rem",
                  color: "#6b6560",
                  textAlign: "center",
                  lineHeight: 1.5,
                  maxWidth: 280,
                }}
              >
                Scan URLs, check what agents missed, or view hook status.
              </p>

              {/* Suggestion chips */}
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "0.375rem",
                  width: "100%",
                  maxWidth: 300,
                }}
              >
                {[
                  "scan https://example.com",
                  "what did the agent miss?",
                  "show status",
                ].map((suggestion) => (
                  <button
                    key={suggestion}
                    onClick={() => sendMessage(suggestion)}
                    style={{
                      ...mono,
                      fontSize: "0.75rem",
                      padding: "0.5rem 0.75rem",
                      borderRadius: "0.5rem",
                      border: "1px solid rgba(255,255,255,0.06)",
                      background: "rgba(255,255,255,0.02)",
                      color: "#9a9590",
                      cursor: "pointer",
                      textAlign: "left",
                      transition: "background 0.15s, border-color 0.15s",
                    }}
                    onMouseEnter={(e) => {
                      (e.target as HTMLButtonElement).style.background = "rgba(217,119,87,0.06)";
                      (e.target as HTMLButtonElement).style.borderColor = "rgba(217,119,87,0.2)";
                      (e.target as HTMLButtonElement).style.color = "#d97757";
                    }}
                    onMouseLeave={(e) => {
                      (e.target as HTMLButtonElement).style.background = "rgba(255,255,255,0.02)";
                      (e.target as HTMLButtonElement).style.borderColor = "rgba(255,255,255,0.06)";
                      (e.target as HTMLButtonElement).style.color = "#9a9590";
                    }}
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((msg) => (
            <ChatMessageBubble key={msg.id} message={msg} />
          ))}

          {isProcessing && (
            <div style={{ padding: "0.375rem 0" }}>
              <div
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "0.375rem",
                  padding: "0.375rem 0.75rem",
                  borderRadius: "0.625rem",
                  background: "rgba(255,255,255,0.03)",
                  border: "1px solid rgba(255,255,255,0.06)",
                }}
              >
                <span
                  style={{
                    ...mono,
                    fontSize: "0.75rem",
                    color: "#6b6560",
                  }}
                >
                  Thinking
                </span>
                <span
                  style={{
                    ...mono,
                    fontSize: "0.75rem",
                    color: "#6b6560",
                    display: "inline-block",
                    width: 20,
                    textAlign: "left",
                    animation: "ellipsis 1.2s steps(4, end) infinite",
                  }}
                >
                  ...
                </span>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* ── Input ───────────────────────────────────────────── */}
        <form
          onSubmit={handleSubmit}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
            padding: "0.75rem",
            borderTop: "1px solid rgba(255,255,255,0.06)",
            flexShrink: 0,
          }}
        >
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder='Try "scan https://example.com"'
            disabled={isProcessing}
            style={{
              flex: 1,
              padding: "0.5rem 0.75rem",
              borderRadius: "0.5rem",
              border: "1px solid rgba(255,255,255,0.08)",
              background: "rgba(255,255,255,0.03)",
              color: "#e8e6e3",
              fontSize: "0.8125rem",
              outline: "none",
              fontFamily: "inherit",
            }}
          />

          {/* Mic icon (placeholder) */}
          <button
            type="button"
            style={{
              background: "none",
              border: "none",
              color: "#6b6560",
              fontSize: "1.125rem",
              cursor: "not-allowed",
              padding: "0.375rem",
              opacity: 0.5,
            }}
            title="Voice input (coming soon)"
            aria-label="Voice input"
          >
            {"\u{1F3A4}"}
          </button>

          {/* Send */}
          <button
            type="submit"
            disabled={isProcessing || !input.trim()}
            style={{
              padding: "0.5rem 0.875rem",
              borderRadius: "0.5rem",
              border: "none",
              background: isProcessing || !input.trim() ? "#3a3530" : "#d97757",
              color: isProcessing || !input.trim() ? "#6b6560" : "#fff",
              fontSize: "0.8125rem",
              fontWeight: 600,
              cursor: isProcessing || !input.trim() ? "not-allowed" : "pointer",
              transition: "background 0.15s",
            }}
          >
            Send
          </button>
        </form>
      </div>
    </>
  );
}
