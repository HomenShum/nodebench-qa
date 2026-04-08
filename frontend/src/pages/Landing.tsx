import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Layout } from "../components/Layout";
import { qaCheck } from "../lib/api";
import { saveFromResult } from "../lib/storage";

const FEATURE_CARDS: { title: string; desc: string; accent?: boolean }[] = [
  {
    title: "Workflow Capture",
    desc: "Record frontier model workflows end-to-end. Every tool call, every decision, every output.",
    accent: true,
  },
  {
    title: "Distillation",
    desc: "Distill expensive workflows into cheaper replays. 60-70% token savings on reruns.",
  },
  {
    title: "Judge Replay",
    desc: "Replay and judge distilled workflows. MCP-native, works inside Claude Code, Cursor, Windsurf.",
  },
];

export function Landing() {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  const handleCheck = async () => {
    if (!url.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const result = await qaCheck(url.trim());
      saveFromResult(result);
      navigate(`/results/${result.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
      setLoading(false);
    }
  };

  const handleQuickAction = (path: string) => {
    if (!url.trim()) return;
    // Encode the URL so it can be passed as a query param
    navigate(`${path}?url=${encodeURIComponent(url.trim())}`);
  };

  return (
    <Layout>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "4rem 1.5rem 2rem",
          minHeight: "calc(100vh - 56px - 60px)",
        }}
      >
        <div style={{ textAlign: "center", maxWidth: 680, width: "100%" }}>
          {/* Hero */}
          <h1
            style={{
              fontSize: "3.25rem",
              fontWeight: 700,
              letterSpacing: "-0.03em",
              lineHeight: 1.1,
              marginBottom: "1rem",
            }}
          >
            bench
            <span style={{ color: "var(--accent)" }}>press</span>
          </h1>

          <p
            style={{
              fontSize: "1.25rem",
              color: "var(--text-secondary)",
              lineHeight: 1.6,
              marginBottom: "2.5rem",
            }}
          >
            Frontier models are expensive. benchpress distills them.
            <br />
            Capture workflows once, replay for 60-70% fewer tokens.
          </p>

          {/* URL input + QA Check button */}
          <div
            style={{
              display: "flex",
              gap: "0.75rem",
              maxWidth: 540,
              margin: "0 auto 1rem",
            }}
          >
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://your-app.com"
              onKeyDown={(e) => e.key === "Enter" && handleCheck()}
              style={{
                flex: 1,
                padding: "0.875rem 1.25rem",
                borderRadius: "0.75rem",
                border: "1px solid var(--border)",
                background: "var(--bg-surface)",
                color: "var(--text-primary)",
                fontSize: "1rem",
                outline: "none",
              }}
            />
            <button
              onClick={handleCheck}
              disabled={loading || !url.trim()}
              style={{
                padding: "0.875rem 2rem",
                borderRadius: "0.75rem",
                border: "none",
                background: "var(--accent)",
                color: "#fff",
                fontSize: "1rem",
                fontWeight: 600,
                cursor: loading ? "wait" : "pointer",
                opacity: loading || !url.trim() ? 0.5 : 1,
                transition: "opacity 0.15s",
              }}
            >
              {loading ? "Scanning..." : "QA Check"}
            </button>
          </div>

          {/* Quick-action buttons */}
          <div
            style={{
              display: "flex",
              gap: "0.5rem",
              justifyContent: "center",
              flexWrap: "wrap",
              marginBottom: "1.5rem",
            }}
          >
            {[
              { label: "Sitemap", path: "/sitemap" },
              { label: "UX Audit", path: "/audit" },
              { label: "Dashboard", path: "/dashboard" },
            ].map(({ label, path }) => (
              <button
                key={path}
                onClick={() => handleQuickAction(path)}
                disabled={!url.trim()}
                style={{
                  padding: "0.5rem 1rem",
                  borderRadius: "0.5rem",
                  border: "1px solid var(--border)",
                  background: "transparent",
                  color: url.trim() ? "var(--text-secondary)" : "var(--text-muted)",
                  fontSize: "0.8125rem",
                  fontWeight: 500,
                  cursor: url.trim() ? "pointer" : "default",
                  opacity: url.trim() ? 1 : 0.5,
                  transition: "border-color 0.15s, color 0.15s",
                }}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Error message */}
          {error && (
            <div
              style={{
                padding: "0.75rem 1rem",
                borderRadius: "0.5rem",
                background: "rgba(239,68,68,0.1)",
                border: "1px solid rgba(239,68,68,0.2)",
                color: "#ef4444",
                fontSize: "0.875rem",
                marginBottom: "1.5rem",
                maxWidth: 540,
                margin: "0 auto 1.5rem",
              }}
            >
              {error}
            </div>
          )}

          {/* Feature cards */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
              gap: "1rem",
              marginTop: "2rem",
              maxWidth: 640,
              marginLeft: "auto",
              marginRight: "auto",
            }}
          >
            {FEATURE_CARDS.map((card) => (
              <div
                key={card.title}
                style={{
                  padding: "1.25rem",
                  borderRadius: "0.75rem",
                  border: card.accent
                    ? "1px solid rgba(217,119,87,0.25)"
                    : "1px solid var(--border)",
                  background: "var(--bg-surface)",
                  textAlign: "left",
                }}
              >
                <h3
                  style={{
                    fontSize: "0.9375rem",
                    fontWeight: 600,
                    marginBottom: "0.5rem",
                    color: card.accent ? "var(--accent)" : "var(--text-primary)",
                  }}
                >
                  {card.title}
                </h3>
                <p
                  style={{
                    fontSize: "0.8125rem",
                    color: "var(--text-secondary)",
                    lineHeight: 1.5,
                    margin: 0,
                  }}
                >
                  {card.desc}
                </p>
              </div>
            ))}
          </div>

          {/* Install snippet */}
          <div
            style={{
              marginTop: "2.5rem",
              padding: "1.25rem 1.5rem",
              borderRadius: "0.75rem",
              border: "1px solid var(--border)",
              background: "var(--bg-surface)",
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: "0.8125rem",
              color: "var(--text-secondary)",
              textAlign: "left",
              maxWidth: 540,
              marginLeft: "auto",
              marginRight: "auto",
            }}
          >
            <div style={{ color: "var(--text-muted)", marginBottom: "0.375rem" }}>
              # Install
            </div>
            <div>
              <span style={{ color: "var(--accent)" }}>$</span> cargo install
              benchpress-cli
            </div>
            <div
              style={{ marginTop: "0.625rem", color: "var(--text-muted)" }}
            >
              # Or use from Claude Code / Cursor / Windsurf
            </div>
            <div>
              <span style={{ color: "var(--accent)" }}>$</span> bp check
              http://localhost:3000
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
}
