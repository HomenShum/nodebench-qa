import { Layout } from "../components/Layout";
import { useState, useEffect } from "react";

/* ── Palette ──────────────────────────────────────────────────── */

const BG = "#0a0a0b";
const CARD = "#141415";
const BORDER = "rgba(255,255,255,0.06)";
const TEXT = "#e8e6e3";
const MUTED = "#6b6560";
const ACCENT = "#d97757";
const GREEN = "#22c55e";

/* ── Shared styles ────────────────────────────────────────────── */

const mono: React.CSSProperties = {
  fontFamily: "'JetBrains Mono', monospace",
};

const glass: React.CSSProperties = {
  borderRadius: "0.625rem",
  border: `1px solid ${BORDER}`,
  background: CARD,
};

/* ── Types ────────────────────────────────────────────────────── */

interface Packet {
  entity?: string;
  query?: string;
  confidence?: number;
  sourceCount?: number;
  durationMs?: number;
  cost?: number;
}

/* ── Workflow card data ───────────────────────────────────────── */

const STEPS = [
  "Grep sync patterns",
  "Edit 4 files",
  "Run tests",
  "Build clean",
  "Git commit",
  "Search deps",
];

/* ── Component ────────────────────────────────────────────────── */

export function Landing() {
  const [packets, setPackets] = useState<Packet[]>([]);
  const [live, setLive] = useState(false);

  useEffect(() => {
    const ac = new AbortController();
    fetch("/api/retention/packets", { signal: ac.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data: Packet[]) => {
        if (Array.isArray(data) && data.length > 0) {
          setPackets(data.slice(0, 6));
          setLive(true);
        }
      })
      .catch(() => {
        /* server offline -- show fallback */
      });
    return () => ac.abort();
  }, []);

  return (
    <Layout>
      <div style={{ maxWidth: 720, margin: "0 auto", padding: "0 1.5rem" }}>

        {/* ══════════════════════════════════════════════════════════
            HERO: one number, one comparison, two buttons
            ══════════════════════════════════════════════════════════ */}
        <section style={{ textAlign: "center", padding: "6rem 0 4rem" }}>
          <h1 style={{
            fontSize: "3rem",
            fontWeight: 700,
            letterSpacing: "-0.04em",
            color: TEXT,
            marginBottom: "2rem",
          }}>
            att<span style={{ color: ACCENT }}>rition</span>
          </h1>

          <p style={{
            ...mono,
            fontSize: "1.25rem",
            color: MUTED,
            lineHeight: 1.7,
            marginBottom: "0.25rem",
          }}>
            Your last Claude Code session cost{" "}
            <span style={{ color: TEXT, fontWeight: 600 }}>$1.84</span>.
          </p>
          <p style={{
            ...mono,
            fontSize: "1.25rem",
            color: MUTED,
            lineHeight: 1.7,
            marginBottom: "2.5rem",
          }}>
            Replay it for{" "}
            <span style={{ color: GREEN, fontWeight: 600 }}>$0.27</span>.
          </p>

          <div style={{ display: "flex", gap: "0.75rem", justifyContent: "center", flexWrap: "wrap" }}>
            <a href="#example" style={{
              padding: "0.75rem 1.75rem",
              borderRadius: "0.5rem",
              border: `1px solid ${ACCENT}`,
              background: "transparent",
              color: ACCENT,
              fontSize: "0.9375rem",
              fontWeight: 600,
              textDecoration: "none",
              cursor: "pointer",
            }}>
              See a real example
            </a>
            <a href="#install" style={{
              padding: "0.75rem 1.75rem",
              borderRadius: "0.5rem",
              border: "none",
              background: ACCENT,
              color: "#fff",
              fontSize: "0.9375rem",
              fontWeight: 600,
              textDecoration: "none",
              cursor: "pointer",
            }}>
              Install in 30s
            </a>
          </div>
        </section>

        {/* ══════════════════════════════════════════════════════════
            WORKFLOW CARD: terminal-style captured session
            ══════════════════════════════════════════════════════════ */}
        <section id="example" style={{ marginBottom: "5rem" }}>
          <div style={{
            ...glass,
            ...mono,
            padding: "1.5rem",
            background: BG,
            border: `1px solid rgba(255,255,255,0.08)`,
          }}>
            {/* Header */}
            <div style={{ marginBottom: "1rem" }}>
              <div style={{ fontSize: "0.9375rem", fontWeight: 600, color: TEXT, marginBottom: "0.25rem" }}>
                Refactor API client to async/await
              </div>
              <div style={{ fontSize: "0.75rem", color: MUTED }}>
                claude-opus-4-6 &middot; 47 tool calls &middot; 8m 12s
              </div>
            </div>

            {/* Steps grid */}
            <div style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: "0.375rem 1.5rem",
              marginBottom: "1.25rem",
            }}>
              {STEPS.map((s) => (
                <div key={s} style={{ fontSize: "0.8125rem", color: "#9a9590" }}>
                  <span style={{ color: GREEN, marginRight: "0.5rem" }}>&#10003;</span>
                  {s}
                </div>
              ))}
            </div>

            {/* Separator */}
            <div style={{ borderTop: `1px solid rgba(255,255,255,0.06)`, margin: "0 0 1rem" }} />

            {/* Cost comparison */}
            <div style={{ display: "flex", gap: "2rem", flexWrap: "wrap" }}>
              <div>
                <div style={{ fontSize: "0.6875rem", color: MUTED, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "0.25rem" }}>
                  Cost
                </div>
                <div style={{ fontSize: "1.25rem", fontWeight: 700, color: TEXT }}>$1.84</div>
                <div style={{
                  marginTop: "0.375rem",
                  height: 6,
                  width: 160,
                  borderRadius: 3,
                  background: "rgba(255,255,255,0.06)",
                  overflow: "hidden",
                }}>
                  <div style={{ height: "100%", width: "100%", borderRadius: 3, background: "rgba(255,255,255,0.15)" }} />
                </div>
              </div>
              <div>
                <div style={{ fontSize: "0.6875rem", color: MUTED, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "0.25rem" }}>
                  Replay
                </div>
                <div style={{ fontSize: "1.25rem", fontWeight: 700, color: GREEN }}>$0.27</div>
                <div style={{
                  marginTop: "0.375rem",
                  height: 6,
                  width: 160,
                  borderRadius: 3,
                  background: "rgba(255,255,255,0.06)",
                  overflow: "hidden",
                }}>
                  <div style={{ height: "100%", width: "15%", borderRadius: 3, background: GREEN }} />
                </div>
              </div>
              <div style={{ marginLeft: "auto", textAlign: "right" }}>
                <div style={{ fontSize: "0.8125rem", color: MUTED }}>Savings</div>
                <div style={{ fontSize: "1.25rem", fontWeight: 700, color: GREEN }}>85%</div>
                <div style={{ fontSize: "0.75rem", color: MUTED, marginTop: "0.125rem" }}>
                  Judge: <span style={{ color: GREEN }}>CORRECT</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ══════════════════════════════════════════════════════════
            WHAT IT DOES: 3 steps, plain english
            ══════════════════════════════════════════════════════════ */}
        <section style={{ marginBottom: "5rem" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "2rem" }}>
            {[
              {
                num: "1",
                title: "Wrap your session",
                cmd: '$ attrition run claude "refactor the API client"',
                desc: "Every tool call, file edit, and search is captured.",
              },
              {
                num: "2",
                title: "See what it cost",
                cmd: "47 tool calls \u00b7 6 sources \u00b7 $1.84 \u00b7 8m 12s",
                desc: "Know exactly what happened and what it cost.",
              },
              {
                num: "3",
                title: "Replay it cheaper",
                cmd: "$ attrition replay <id> --model sonnet",
                desc: "Same workflow. Same quality. 85% less cost. Judge verifies the replay is correct.",
              },
            ].map((step) => (
              <div key={step.num}>
                <div style={{ display: "flex", alignItems: "baseline", gap: "0.75rem", marginBottom: "0.5rem" }}>
                  <span style={{
                    ...mono,
                    fontSize: "0.75rem",
                    fontWeight: 700,
                    color: ACCENT,
                    width: 20,
                    textAlign: "center",
                    flexShrink: 0,
                  }}>
                    {step.num}
                  </span>
                  <span style={{ fontSize: "1rem", fontWeight: 600, color: TEXT }}>
                    {step.title}
                  </span>
                </div>
                <div style={{ marginLeft: "2.25rem" }}>
                  <div style={{
                    ...mono,
                    fontSize: "0.8125rem",
                    color: ACCENT,
                    padding: "0.5rem 0.75rem",
                    borderRadius: "0.375rem",
                    background: "rgba(217,119,87,0.06)",
                    border: "1px solid rgba(217,119,87,0.12)",
                    marginBottom: "0.375rem",
                  }}>
                    {step.cmd}
                  </div>
                  <div style={{ fontSize: "0.875rem", color: MUTED, lineHeight: 1.6 }}>
                    {step.desc}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ══════════════════════════════════════════════════════════
            CAPTURED RUNS: live from API or fallback
            ══════════════════════════════════════════════════════════ */}
        <section style={{ marginBottom: "5rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "1rem" }}>
            <h2 style={{
              fontSize: "0.6875rem",
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: "0.15em",
              color: MUTED,
              margin: 0,
            }}>
              Captured runs
            </h2>
            {live && (
              <span style={{
                ...mono,
                fontSize: "0.625rem",
                fontWeight: 700,
                padding: "0.125rem 0.5rem",
                borderRadius: "0.25rem",
                background: "rgba(34,197,94,0.1)",
                color: GREEN,
                letterSpacing: "0.05em",
              }}>
                LIVE
              </span>
            )}
          </div>

          {packets.length > 0 ? (
            <div style={{ ...glass, overflow: "hidden" }}>
              {packets.map((p, i) => (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "0.75rem 1rem",
                    borderBottom: i < packets.length - 1 ? `1px solid ${BORDER}` : "none",
                    gap: "0.75rem",
                    flexWrap: "wrap",
                  }}
                >
                  <div style={{
                    fontSize: "0.8125rem",
                    color: TEXT,
                    fontWeight: 500,
                    flex: "1 1 200px",
                    minWidth: 0,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}>
                    {p.entity || p.query || "Unknown query"}
                  </div>
                  <div style={{
                    ...mono,
                    fontSize: "0.75rem",
                    color: MUTED,
                    display: "flex",
                    gap: "0.75rem",
                    flexShrink: 0,
                  }}>
                    {p.confidence != null && <span>{p.confidence}% conf</span>}
                    {p.sourceCount != null && <span>{p.sourceCount} src</span>}
                    {p.durationMs != null && <span>{(p.durationMs / 1000).toFixed(1)}s</span>}
                    {p.cost != null && <span style={{ color: GREEN }}>${p.cost.toFixed(3)}</span>}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{
              ...glass,
              padding: "2rem",
              textAlign: "center",
              ...mono,
              fontSize: "0.8125rem",
              color: MUTED,
            }}>
              Start the server to see live data
            </div>
          )}
        </section>

        {/* ══════════════════════════════════════════════════════════
            INSTALL: last, after proof
            ══════════════════════════════════════════════════════════ */}
        <section id="install" style={{ marginBottom: "4rem" }}>
          <h2 style={{
            fontSize: "1.5rem",
            fontWeight: 700,
            letterSpacing: "-0.02em",
            color: TEXT,
            marginBottom: "1.5rem",
            textAlign: "center",
          }}>
            Install in 30 seconds
          </h2>

          <div style={{ ...glass, padding: "1.5rem", maxWidth: 560, margin: "0 auto" }}>
            {/* curl */}
            <div style={{
              ...mono,
              fontSize: "0.8125rem",
              color: TEXT,
              padding: "0.75rem 1rem",
              borderRadius: "0.5rem",
              background: BG,
              border: `1px solid ${BORDER}`,
              marginBottom: "1.25rem",
            }}>
              $ curl -sL attrition.sh/install | bash
            </div>

            {/* Compatibility */}
            <div style={{
              fontSize: "0.8125rem",
              color: MUTED,
              marginBottom: "1.25rem",
              textAlign: "center",
            }}>
              Works with: Claude Code &middot; Cursor &middot; Codex &middot; OpenAI &middot; LangChain
            </div>

            {/* MCP config */}
            <div style={{
              ...mono,
              fontSize: "0.6875rem",
              color: MUTED,
              textTransform: "uppercase",
              letterSpacing: "0.12em",
              marginBottom: "0.5rem",
            }}>
              Or add to .mcp.json
            </div>
            <pre style={{
              ...mono,
              fontSize: "0.75rem",
              color: "#9a9590",
              padding: "0.75rem 1rem",
              borderRadius: "0.5rem",
              background: BG,
              border: `1px solid ${BORDER}`,
              margin: 0,
              overflowX: "auto",
              lineHeight: 1.7,
            }}>{`{
  "mcpServers": {
    "attrition": {
      "command": "npx",
      "args": ["-y", "attrition@latest"]
    }
  }
}`}</pre>
          </div>
        </section>

        {/* ══════════════════════════════════════════════════════════
            INTEGRATE: for products that want attrition as their cost layer
            ══════════════════════════════════════════════════════════ */}
        <section style={{ marginBottom: "4rem" }}>
          <h2 style={{
            fontSize: "1.5rem",
            fontWeight: 700,
            letterSpacing: "-0.02em",
            color: TEXT,
            marginBottom: "0.5rem",
            textAlign: "center",
          }}>
            Build it into your product
          </h2>
          <p style={{
            fontSize: "0.875rem",
            color: MUTED,
            textAlign: "center",
            marginBottom: "2rem",
            maxWidth: 520,
            marginLeft: "auto",
            marginRight: "auto",
            lineHeight: 1.6,
          }}>
            Any app that runs agent workflows can use attrition to measure cost,
            capture runs, and replay them cheaper. NodeBench already does.
          </p>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "0.75rem", maxWidth: 700, margin: "0 auto 1.5rem" }}>
            {/* Retention Bridge */}
            <div style={{ ...glass, padding: "1.25rem" }}>
              <div style={{ ...mono, fontSize: "0.6875rem", color: ACCENT, marginBottom: "0.5rem", textTransform: "uppercase", letterSpacing: "0.1em" }}>
                Retention Bridge API
              </div>
              <div style={{ fontSize: "0.8125rem", color: TEXT, lineHeight: 1.5, marginBottom: "0.75rem" }}>
                Push pipeline results to attrition. Get cost tracking, workflow capture, and replay for free.
              </div>
              <pre style={{ ...mono, fontSize: "0.6875rem", color: MUTED, padding: "0.625rem 0.75rem", borderRadius: "0.375rem", background: BG, border: `1px solid ${BORDER}`, margin: 0, overflowX: "auto", lineHeight: 1.7 }}>
{`POST /api/retention/push-packet
{
  "type": "delta.pipeline_run",
  "subject": "Company analysis",
  "summary": "Conf: 95, Sources: 6,
              Duration: 12s"
}`}
              </pre>
            </div>

            {/* Python SDK */}
            <div style={{ ...glass, padding: "1.25rem" }}>
              <div style={{ ...mono, fontSize: "0.6875rem", color: ACCENT, marginBottom: "0.5rem", textTransform: "uppercase", letterSpacing: "0.1em" }}>
                Python SDK (one line)
              </div>
              <div style={{ fontSize: "0.8125rem", color: TEXT, lineHeight: 1.5, marginBottom: "0.75rem" }}>
                Auto-patches OpenAI, Anthropic, LangChain, CrewAI. Every API call tracked and costed.
              </div>
              <pre style={{ ...mono, fontSize: "0.6875rem", color: MUTED, padding: "0.625rem 0.75rem", borderRadius: "0.375rem", background: BG, border: `1px solid ${BORDER}`, margin: 0, overflowX: "auto", lineHeight: 1.7 }}>
{`from attrition import track
track()

# That's it. Every LLM call
# is now captured + costed.`}
              </pre>
            </div>
          </div>

          {/* How NodeBench uses it */}
          <div style={{ ...glass, padding: "1.25rem", maxWidth: 700, margin: "0 auto" }}>
            <div style={{ ...mono, fontSize: "0.6875rem", color: GREEN, marginBottom: "0.5rem", textTransform: "uppercase", letterSpacing: "0.1em" }}>
              Live example: NodeBench AI
            </div>
            <div style={{ fontSize: "0.8125rem", color: TEXT, lineHeight: 1.6, marginBottom: "0.75rem" }}>
              NodeBench runs research pipelines for startup analysis. Every search pushes results to attrition via the retention bridge. Cost, latency, and source count are tracked per run. Replay savings compound over time.
            </div>
            <div style={{ display: "flex", gap: "1.5rem", flexWrap: "wrap", ...mono, fontSize: "0.75rem" }}>
              <span style={{ color: MUTED }}>5 queries captured</span>
              <span style={{ color: MUTED }}>avg 88% confidence</span>
              <span style={{ color: MUTED }}>avg 19.9s latency</span>
              <span style={{ color: GREEN }}>80% replay savings</span>
            </div>
          </div>
        </section>

      </div>
    </Layout>
  );
}
