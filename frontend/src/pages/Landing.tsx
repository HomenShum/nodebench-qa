import { Layout } from "../components/Layout";
import { useState, useEffect } from "react";

/* -- Palette --------------------------------------------------------- */

const BG = "#0a0a0b";
const CARD = "#141415";
const BORDER = "rgba(255,255,255,0.06)";
const TEXT = "#e8e6e3";
const MUTED = "#6b6560";
const ACCENT = "#d97757";
const GREEN = "#22c55e";

/* -- Shared styles --------------------------------------------------- */

const mono: React.CSSProperties = {
  fontFamily: "'JetBrains Mono', monospace",
};

const codeBlock: React.CSSProperties = {
  ...mono,
  fontSize: "0.8125rem",
  color: "#9a9590",
  padding: "1rem 1.25rem",
  borderRadius: "0.5rem",
  background: BG,
  border: `1px solid ${BORDER}`,
  margin: 0,
  overflowX: "auto",
  lineHeight: 1.7,
  whiteSpace: "pre",
};

const sectionLabel: React.CSSProperties = {
  ...mono,
  fontSize: "0.6875rem",
  fontWeight: 600,
  textTransform: "uppercase" as const,
  letterSpacing: "0.15em",
  color: MUTED,
  marginBottom: "1.25rem",
};

/* -- Types ----------------------------------------------------------- */

interface Packet {
  entity?: string;
  query?: string;
  confidence?: number;
  sourceCount?: number;
  durationMs?: number;
  cost?: number;
}

/* -- Component ------------------------------------------------------- */

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
      .catch(() => {});
    return () => ac.abort();
  }, []);

  return (
    <Layout>
      <div style={{ maxWidth: 720, margin: "0 auto", padding: "0 1.5rem" }}>

        {/* ---- S1: THE PROBLEM + WHAT THIS IS ---------------------- */}
        <section style={{ padding: "5rem 0 2.5rem" }}>
          <h1 style={{
            fontSize: "2.25rem",
            fontWeight: 700,
            letterSpacing: "-0.03em",
            color: TEXT,
            marginBottom: "2rem",
          }}>
            attrition
          </h1>

          <div style={{
            ...mono,
            fontSize: "0.9375rem",
            color: MUTED,
            lineHeight: 1.8,
            marginBottom: "2.5rem",
          }}>
            <p style={{ color: TEXT, fontWeight: 600, margin: "0 0 0.75rem" }}>
              You don't know what your agent sessions cost.
              <br />
              You can't replay the good ones.
            </p>
            <p style={{ margin: "0 0 1rem" }}>
              Your Claude Code / Cursor / Codex sessions run expensive frontier
              models, repeat the same workflows, and you have no idea what each
              session actually cost or if a cheaper model would produce the same result.
            </p>
            <p style={{ margin: 0 }}>
              attrition wraps agent sessions, measures real cost,
              <br />
              and replays successful workflows on cheaper models.
            </p>
          </div>

          <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
            <a
              href="#example"
              style={{
                ...mono,
                fontSize: "0.8125rem",
                color: TEXT,
                textDecoration: "none",
                padding: "0.5rem 1.25rem",
                borderRadius: "0.375rem",
                border: `1px solid ${BORDER}`,
                background: CARD,
              }}
            >
              See a real example
            </a>
            <a
              href="#get-started"
              style={{
                ...mono,
                fontSize: "0.8125rem",
                color: "#0a0a0b",
                textDecoration: "none",
                padding: "0.5rem 1.25rem",
                borderRadius: "0.375rem",
                background: ACCENT,
                fontWeight: 600,
              }}
            >
              Get started
            </a>
          </div>
        </section>

        {/* ---- S2: LIVE CAPTURED DATA or INSTALL PROMPT ------------- */}
        <section id="example" style={{ marginBottom: "4rem" }}>
          <div style={sectionLabel}>What it captures</div>
          {packets.length > 0 && packets[0].cost != null ? (
            <div style={{
              borderRadius: "0.5rem",
              border: `1px solid ${BORDER}`,
              background: CARD,
              padding: "1.5rem 1.5rem",
              ...mono,
              fontSize: "0.8125rem",
              lineHeight: 1.8,
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.25rem" }}>
                <span style={{
                  fontSize: "0.625rem",
                  fontWeight: 700,
                  padding: "0.125rem 0.5rem",
                  borderRadius: "0.25rem",
                  background: "rgba(34,197,94,0.1)",
                  color: GREEN,
                  letterSpacing: "0.05em",
                }}>MEASURED</span>
                <span style={{ color: MUTED }}>Latest captured run</span>
              </div>
              <div style={{ color: TEXT, fontWeight: 500 }}>
                {packets[0].entity || packets[0].query || "Pipeline run"}
              </div>
              <div style={{ color: MUTED, marginBottom: "0.75rem" }}>
                {packets[0].sourceCount != null && <>{packets[0].sourceCount} sources &middot; </>}
                {packets[0].durationMs != null && <>{(packets[0].durationMs / 1000).toFixed(1)}s</>}
              </div>
              <div style={{ fontSize: "1.25rem", color: GREEN, fontWeight: 700 }}>
                Cost: ${packets[0].cost.toFixed(4)}
              </div>
              <div style={{ ...mono, fontSize: "0.6875rem", color: MUTED, marginTop: "0.5rem" }}>
                Real cost from Gemini API token usage
              </div>
            </div>
          ) : (
            <div style={{
              borderRadius: "0.5rem",
              border: `1px solid ${BORDER}`,
              background: CARD,
              padding: "1.5rem 1.5rem",
              ...mono,
              fontSize: "0.8125rem",
              lineHeight: 1.8,
            }}>
              <div style={{ color: TEXT, fontWeight: 500, marginBottom: "0.5rem" }}>
                Every session gets measured, not estimated.
              </div>
              <div style={{ color: MUTED, marginBottom: "0.75rem" }}>
                attrition captures real token counts and API costs from every
                pipeline run. No fake numbers, no estimates.
              </div>
              <div style={{ color: ACCENT, fontWeight: 600 }}>
                Install to see your real costs.
              </div>
            </div>
          )}
        </section>

        {/* ---- S3: THREE THINGS IT DOES ---------------------------- */}
        <section style={{ marginBottom: "4rem" }}>
          <div style={sectionLabel}>Three things it does</div>

          <div style={{ display: "flex", flexDirection: "column", gap: "2rem" }}>
            {/* Capture */}
            <div>
              <div style={{
                ...mono,
                fontSize: "0.75rem",
                fontWeight: 700,
                color: ACCENT,
                letterSpacing: "0.1em",
                marginBottom: "0.5rem",
              }}>
                CAPTURE
              </div>
              <p style={{ fontSize: "0.9375rem", color: TEXT, margin: "0 0 0.75rem", lineHeight: 1.6 }}>
                Record what happened in your agent session.
              </p>
              <pre style={codeBlock}>{`from attrition import track
track()  # auto-patches OpenAI, Anthropic, LangChain`}</pre>
            </div>

            {/* Measure */}
            <div>
              <div style={{
                ...mono,
                fontSize: "0.75rem",
                fontWeight: 700,
                color: ACCENT,
                letterSpacing: "0.1em",
                marginBottom: "0.5rem",
              }}>
                MEASURE
              </div>
              <p style={{ fontSize: "0.9375rem", color: TEXT, margin: "0 0 0.75rem", lineHeight: 1.6 }}>
                Know exactly what it cost.
              </p>
              <pre style={codeBlock}>{`$ bp status
Last session: 4 trace steps  1,801 tokens  $0.0002`}</pre>
            </div>

            {/* Replay */}
            <div>
              <div style={{
                ...mono,
                fontSize: "0.75rem",
                fontWeight: 700,
                color: ACCENT,
                letterSpacing: "0.1em",
                marginBottom: "0.5rem",
              }}>
                REPLAY
              </div>
              <p style={{ fontSize: "0.9375rem", color: TEXT, margin: "0 0 0.75rem", lineHeight: 1.6 }}>
                Run it again cheaper.
              </p>
              <pre style={codeBlock}>{`$ bp replay <id> --model sonnet
Replay complete. Compare costs in /improvements`}</pre>
            </div>
          </div>
        </section>

        {/* ---- S4: LIVE CAPTURED RUNS ------------------------------ */}
        <section style={{ marginBottom: "4rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "0.5rem" }}>
            <div style={{ ...sectionLabel, marginBottom: 0 }}>Live captured runs</div>
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
          <p style={{
            fontSize: "0.8125rem",
            color: MUTED,
            lineHeight: 1.6,
            margin: "0 0 1rem",
          }}>
            Real workflow runs captured from NodeBench, a research product that uses attrition.
          </p>

          {packets.length > 0 ? (
            <div style={{
              borderRadius: "0.5rem",
              border: `1px solid ${BORDER}`,
              background: CARD,
              overflow: "hidden",
            }}>
              {packets.map((p, i) => (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "0.625rem 1rem",
                    borderBottom: i < packets.length - 1 ? `1px solid ${BORDER}` : "none",
                    gap: "0.75rem",
                  }}
                >
                  <div style={{
                    ...mono,
                    fontSize: "0.8125rem",
                    color: TEXT,
                    fontWeight: 500,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    minWidth: 0,
                    flex: 1,
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
              ...mono,
              borderRadius: "0.5rem",
              border: `1px solid ${BORDER}`,
              background: CARD,
              padding: "1.5rem",
              textAlign: "center",
              fontSize: "0.8125rem",
              color: MUTED,
            }}>
              Start the server to see live data
            </div>
          )}
        </section>

        {/* ---- S5: GET STARTED ------------------------------------- */}
        <section id="get-started" style={{ marginBottom: "4rem" }}>
          <div style={sectionLabel}>Get started</div>
          <pre style={{ ...codeBlock, marginBottom: "1.25rem" }}>
{`$ curl -sL attrition.sh/install | bash`}
          </pre>
          <p style={{
            ...mono,
            fontSize: "0.8125rem",
            color: MUTED,
            lineHeight: 1.8,
            margin: "0 0 1.5rem",
          }}>
            Works with: Claude Code &middot; Cursor &middot; Codex &middot; OpenAI &middot; LangChain
          </p>

          <p style={{
            fontSize: "0.875rem",
            color: TEXT,
            margin: "0 0 0.75rem",
            fontWeight: 500,
          }}>
            Or integrate via API:
          </p>
          <pre style={codeBlock}>
{`POST /api/retention/push-packet
{
  "type": "delta.pipeline_run",
  "subject": "Pipeline: Analyze Stripe",
  "summary": "Confidence: 95, Sources: 6, Tokens: 1801"
}`}
          </pre>
        </section>

        {/* ---- FOOTER ---------------------------------------------- */}
        <section style={{ marginBottom: "4rem", textAlign: "center" }}>
          <a
            href="https://github.com/HomenShum/attrition"
            target="_blank"
            rel="noopener noreferrer"
            style={{
              ...mono,
              fontSize: "0.9375rem",
              color: TEXT,
              textDecoration: "none",
              fontWeight: 600,
            }}
          >
            github.com/HomenShum/attrition
          </a>
          <div style={{
            ...mono,
            fontSize: "0.75rem",
            color: MUTED,
            marginTop: "0.5rem",
            marginBottom: "1rem",
          }}>
            MIT license
          </div>
          <div style={{
            ...mono,
            fontSize: "0.75rem",
            color: MUTED,
            display: "flex",
            justifyContent: "center",
            gap: "1.5rem",
          }}>
            <a href="/docs" style={{ color: MUTED, textDecoration: "none" }}>Docs</a>
            <a href="/improvements" style={{ color: MUTED, textDecoration: "none" }}>Captured Runs</a>
            <a
              href="https://github.com/HomenShum/attrition"
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: MUTED, textDecoration: "none" }}
            >
              GitHub
            </a>
          </div>
        </section>

      </div>
    </Layout>
  );
}
