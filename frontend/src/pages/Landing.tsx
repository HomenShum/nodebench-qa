import { useNavigate } from "react-router-dom";
import { Layout } from "../components/Layout";
import { useEffect } from "react";
import { seedDemoData } from "../lib/demo-data";

/* ── Data ─────────────────────────────────────────────────── */

const CORRECTION_BUBBLES = [
  "You forgot to run the tests before committing.",
  "Where's the search step? You skipped the research.",
  "You didn't check the console for errors.",
  "I asked you to QA all 5 surfaces, not just the landing page.",
];

const WITHOUT_STEPS: { text: string; dimmed?: boolean; strike?: boolean }[] = [
  { text: "Agent receives task" },
  { text: "Implements the code" },
  { text: "Runs tests", strike: true, dimmed: true },
  { text: "Searches for context", strike: true, dimmed: true },
  { text: 'Agent says "Done!"' },
  { text: 'User: "You forgot the tests..."', dimmed: true },
  { text: "Agent re-runs, wastes 2000 tokens", dimmed: true },
  { text: 'User: "You also forgot the search..."', dimmed: true },
  { text: "Another 1500 tokens wasted", dimmed: true },
];

const WITH_STEPS: { text: string; accent?: boolean; mono?: boolean }[] = [
  { text: "Agent receives task" },
  { text: "on-prompt detects workflow \u2192 injects 5 required steps", mono: true, accent: true },
  { text: "Implements the code" },
  { text: "on-tool-use tracks evidence (3/5 steps done)", mono: true, accent: true },
  { text: "Agent tries to stop" },
  { text: 'on-stop \u2192 BLOCKED: "Missing: test_run, web_search"', mono: true, accent: true },
  { text: "Agent runs tests + search" },
  { text: "on-stop \u2192 PASSED: all 5 steps complete", mono: true, accent: true },
  { text: "Saved: 3500 tokens + 2 correction cycles", accent: true },
];

const HOOK_FEATURES: { title: string; desc: string }[] = [
  {
    title: "on-prompt",
    desc: "Detects workflow. Injects required steps. No opt-out.",
  },
  {
    title: "on-tool-use",
    desc: "Every tool call is evidence. Nudges at 20+ calls if steps missing.",
  },
  {
    title: "on-stop",
    desc: "The gate. Blocks if mandatory steps incomplete. No silent failures.",
  },
  {
    title: "on-session-start",
    desc: "Resumes prior incomplete work. Memory persists.",
  },
];

const COMPARISON_ROWS: { feature: string; claude: boolean; supermemory: boolean; attrition: boolean }[] = [
  { feature: "Remember preferences", claude: true, supermemory: true, attrition: true },
  { feature: "Cross-tool sync", claude: false, supermemory: true, attrition: true },
  { feature: "Workflow detection", claude: false, supermemory: false, attrition: true },
  { feature: "Step tracking", claude: false, supermemory: false, attrition: true },
  { feature: "Block incomplete work", claude: false, supermemory: false, attrition: true },
  { feature: "Learn from corrections", claude: false, supermemory: false, attrition: true },
  { feature: "Self-improving judge", claude: false, supermemory: false, attrition: true },
];

const PROVIDER_BADGES = [
  "Claude Code", "Cursor", "Windsurf", "OpenAI Agents SDK",
  "Anthropic SDK", "LangChain", "CrewAI", "PydanticAI",
];

/* ── Helpers ──────────────────────────────────────────────── */

const sectionHeading: React.CSSProperties = {
  fontSize: "0.6875rem",
  textTransform: "uppercase",
  letterSpacing: "0.15em",
  color: "var(--text-muted)",
  marginBottom: "1rem",
  textAlign: "center",
};

const glassCard: React.CSSProperties = {
  padding: "1rem 1.25rem",
  borderRadius: "0.625rem",
  border: "1px solid var(--border)",
  background: "var(--bg-surface)",
};

const Check = () => (
  <span style={{ color: "var(--accent)", fontWeight: 700, fontSize: "1rem" }}>&#10003;</span>
);
const Cross = () => (
  <span style={{ color: "var(--text-muted)", fontSize: "1rem" }}>&#10005;</span>
);

/* ── Component ────────────────────────────────────────────── */

export function Landing() {
  const navigate = useNavigate();

  useEffect(() => {
    seedDemoData();
  }, []);

  return (
    <Layout>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          padding: "4rem 1.5rem 2rem",
        }}
      >
        <div style={{ textAlign: "center", maxWidth: 820, width: "100%" }}>

          {/* ═══ Hero ═══ */}
          <h1
            style={{
              fontSize: "3.5rem",
              fontWeight: 700,
              letterSpacing: "-0.03em",
              lineHeight: 1.1,
              marginBottom: "0.75rem",
            }}
          >
            att<span style={{ color: "var(--accent)" }}>rition</span>
          </h1>

          <p
            style={{
              fontSize: "1.375rem",
              fontWeight: 600,
              color: "var(--text-primary)",
              lineHeight: 1.4,
              marginBottom: "0.75rem",
            }}
          >
            AI agents cut corners. We don't let them.
          </p>

          <p
            style={{
              fontSize: "1.0625rem",
              color: "var(--text-secondary)",
              lineHeight: 1.6,
              marginBottom: "0.25rem",
              maxWidth: 620,
              marginLeft: "auto",
              marginRight: "auto",
            }}
          >
            Always-on enforcement hooks for AI coding agents.
          </p>
          <p
            style={{
              fontSize: "1rem",
              color: "var(--text-secondary)",
              lineHeight: 1.6,
              marginBottom: "0.25rem",
              maxWidth: 620,
              marginLeft: "auto",
              marginRight: "auto",
            }}
          >
            Detect skipped steps. Block incomplete work. Learn from corrections.
          </p>
          <p
            style={{
              fontSize: "0.9375rem",
              color: "var(--text-muted)",
              lineHeight: 1.6,
              marginBottom: "2rem",
              maxWidth: 620,
              marginLeft: "auto",
              marginRight: "auto",
              fontStyle: "italic",
            }}
          >
            Memory that doesn't just remember &mdash; it enforces.
          </p>

          {/* Install */}
          <div
            style={{
              padding: "1.5rem 2rem",
              borderRadius: "0.75rem",
              border: "1px solid rgba(217,119,87,0.3)",
              background: "rgba(217,119,87,0.04)",
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: "0.9375rem",
              textAlign: "center",
              maxWidth: 480,
              marginLeft: "auto",
              marginRight: "auto",
              marginBottom: "0.75rem",
            }}
          >
            <span style={{ color: "var(--accent)" }}>$</span>{" "}
            <span style={{ color: "var(--text-primary)" }}>
              curl -sL attrition.sh/install | bash
            </span>
          </div>

          <p
            style={{
              fontSize: "0.8125rem",
              color: "var(--text-muted)",
              marginBottom: "2.5rem",
            }}
          >
            Free forever for solo devs. Runs locally. Zero server cost.
          </p>

          {/* CTAs */}
          <div
            style={{
              display: "flex",
              gap: "0.75rem",
              justifyContent: "center",
              marginBottom: "4rem",
              flexWrap: "wrap",
            }}
          >
            <button
              onClick={() => {
                const el = document.getElementById("demo");
                if (el) el.scrollIntoView({ behavior: "smooth" });
              }}
              style={{
                padding: "0.875rem 2.25rem",
                borderRadius: "0.75rem",
                border: "none",
                background: "var(--accent)",
                color: "#fff",
                fontSize: "1rem",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              See It In Action
            </button>
            <button
              onClick={() => navigate("/judge")}
              style={{
                padding: "0.875rem 2.25rem",
                borderRadius: "0.75rem",
                border: "1px solid var(--border)",
                background: "transparent",
                color: "var(--text-primary)",
                fontSize: "1rem",
                fontWeight: 500,
                cursor: "pointer",
              }}
            >
              Judge Dashboard
            </button>
          </div>

          {/* ═══ Section 1: The Problem ═══ */}
          <div style={{ marginBottom: "4rem", maxWidth: 640, marginLeft: "auto", marginRight: "auto" }}>
            <h2
              style={{
                fontSize: "1.75rem",
                fontWeight: 700,
                color: "var(--text-primary)",
                marginBottom: "1.5rem",
                lineHeight: 1.2,
              }}
            >
              You've said this before.
            </h2>

            <div style={{ display: "flex", flexDirection: "column", gap: "0.625rem", marginBottom: "1.5rem" }}>
              {CORRECTION_BUBBLES.map((msg, i) => (
                <div
                  key={i}
                  style={{
                    ...glassCard,
                    padding: "0.875rem 1.25rem",
                    background: "var(--bg-elevated)",
                    border: "1px solid rgba(255,255,255,0.08)",
                    textAlign: "left",
                    fontSize: "0.9375rem",
                    color: "var(--text-primary)",
                    lineHeight: 1.5,
                    position: "relative",
                    paddingLeft: "2.5rem",
                  }}
                >
                  <span
                    style={{
                      position: "absolute",
                      left: "1rem",
                      top: "0.875rem",
                      fontSize: "0.875rem",
                      color: "var(--accent)",
                      opacity: 0.7,
                    }}
                  >
                    &gt;
                  </span>
                  "{msg}"
                </div>
              ))}
            </div>

            <p
              style={{
                fontSize: "0.9375rem",
                color: "var(--text-secondary)",
                lineHeight: 1.65,
                textAlign: "left",
              }}
            >
              Every correction costs you time, tokens, and patience.
              Claude Code's memory remembers your preferences.
              It doesn't enforce your workflow.
            </p>
          </div>

          {/* ═══ Section 2: The Solution — Side by side ═══ */}
          <div id="demo" style={{ marginBottom: "4rem", maxWidth: 820, marginLeft: "auto", marginRight: "auto" }}>
            <h2 style={sectionHeading}>The Solution</h2>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: "1rem",
              }}
            >
              {/* Without */}
              <div
                style={{
                  ...glassCard,
                  padding: "1.25rem 1.25rem 1.5rem",
                  textAlign: "left",
                  opacity: 0.65,
                  background: "rgba(20,20,21,0.6)",
                  border: "1px solid rgba(255,255,255,0.04)",
                }}
              >
                <h3
                  style={{
                    fontSize: "0.75rem",
                    textTransform: "uppercase",
                    letterSpacing: "0.12em",
                    color: "var(--text-muted)",
                    marginBottom: "1rem",
                    fontWeight: 600,
                  }}
                >
                  Without attrition
                </h3>
                <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                  {WITHOUT_STEPS.map((s, i) => (
                    <div
                      key={i}
                      style={{
                        fontSize: "0.8125rem",
                        lineHeight: 1.5,
                        color: s.dimmed ? "var(--text-muted)" : "var(--text-secondary)",
                        textDecoration: s.strike ? "line-through" : "none",
                        paddingLeft: "1rem",
                        position: "relative",
                      }}
                    >
                      <span
                        style={{
                          position: "absolute",
                          left: 0,
                          color: s.strike ? "#c0392b" : "var(--text-muted)",
                          fontSize: "0.75rem",
                        }}
                      >
                        {s.strike ? "\u2717" : "\u2022"}
                      </span>
                      {s.text}
                    </div>
                  ))}
                </div>
              </div>

              {/* With */}
              <div
                style={{
                  ...glassCard,
                  padding: "1.25rem 1.25rem 1.5rem",
                  textAlign: "left",
                  border: "1px solid rgba(217,119,87,0.2)",
                  background: "rgba(217,119,87,0.03)",
                }}
              >
                <h3
                  style={{
                    fontSize: "0.75rem",
                    textTransform: "uppercase",
                    letterSpacing: "0.12em",
                    color: "var(--accent)",
                    marginBottom: "1rem",
                    fontWeight: 600,
                  }}
                >
                  With attrition
                </h3>
                <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                  {WITH_STEPS.map((s, i) => (
                    <div
                      key={i}
                      style={{
                        fontSize: "0.8125rem",
                        lineHeight: 1.5,
                        color: s.accent ? "var(--accent)" : "var(--text-secondary)",
                        fontFamily: s.mono ? "'JetBrains Mono', monospace" : "inherit",
                        fontWeight: s.accent ? 500 : 400,
                        paddingLeft: "1rem",
                        position: "relative",
                      }}
                    >
                      <span
                        style={{
                          position: "absolute",
                          left: 0,
                          color: s.accent ? "var(--accent)" : "var(--text-muted)",
                          fontSize: "0.75rem",
                        }}
                      >
                        {s.accent ? "\u25C6" : "\u2022"}
                      </span>
                      {s.text}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* ═══ Section 3: 4-Hook Lifecycle ═══ */}
          <div style={{ marginBottom: "4rem", textAlign: "left", maxWidth: 680, marginLeft: "auto", marginRight: "auto" }}>
            <h2 style={sectionHeading}>4-Hook Lifecycle</h2>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
                gap: "0.75rem",
              }}
            >
              {HOOK_FEATURES.map((hook) => (
                <div key={hook.title} style={glassCard}>
                  <code
                    style={{
                      fontSize: "0.8125rem",
                      fontWeight: 600,
                      color: "var(--accent)",
                      fontFamily: "'JetBrains Mono', monospace",
                    }}
                  >
                    {hook.title}
                  </code>
                  <p
                    style={{
                      fontSize: "0.8125rem",
                      color: "var(--text-secondary)",
                      lineHeight: 1.5,
                      margin: "0.5rem 0 0",
                    }}
                  >
                    {hook.desc}
                  </p>
                </div>
              ))}
            </div>
          </div>

          {/* ═══ Section 4: Competitive Comparison ═══ */}
          <div style={{ marginBottom: "4rem", maxWidth: 680, marginLeft: "auto", marginRight: "auto" }}>
            <h2
              style={{
                fontSize: "1.5rem",
                fontWeight: 700,
                color: "var(--text-primary)",
                marginBottom: "0.5rem",
              }}
            >
              Memory remembers. Attrition enforces.
            </h2>
            <p style={{ fontSize: "0.875rem", color: "var(--text-muted)", marginBottom: "1.5rem" }}>
              Not just memory. Enforcement.
            </p>

            <div
              style={{
                borderRadius: "0.75rem",
                border: "1px solid var(--border)",
                overflow: "hidden",
              }}
            >
              <table
                style={{
                  width: "100%",
                  borderCollapse: "collapse",
                  fontSize: "0.8125rem",
                }}
              >
                <thead>
                  <tr style={{ background: "var(--bg-elevated)" }}>
                    <th
                      style={{
                        textAlign: "left",
                        padding: "0.75rem 1rem",
                        fontWeight: 500,
                        color: "var(--text-muted)",
                        borderBottom: "1px solid var(--border)",
                      }}
                    />
                    <th
                      style={{
                        textAlign: "center",
                        padding: "0.75rem 0.75rem",
                        fontWeight: 600,
                        color: "var(--text-secondary)",
                        borderBottom: "1px solid var(--border)",
                        fontSize: "0.75rem",
                      }}
                    >
                      Claude Memory
                    </th>
                    <th
                      style={{
                        textAlign: "center",
                        padding: "0.75rem 0.75rem",
                        fontWeight: 600,
                        color: "var(--text-secondary)",
                        borderBottom: "1px solid var(--border)",
                        fontSize: "0.75rem",
                      }}
                    >
                      Supermemory
                    </th>
                    <th
                      style={{
                        textAlign: "center",
                        padding: "0.75rem 0.75rem",
                        fontWeight: 700,
                        color: "var(--accent)",
                        borderBottom: "1px solid var(--border)",
                        fontSize: "0.75rem",
                      }}
                    >
                      attrition
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {COMPARISON_ROWS.map((row, i) => (
                    <tr
                      key={row.feature}
                      style={{
                        background: i % 2 === 0 ? "var(--bg-surface)" : "var(--bg-primary)",
                      }}
                    >
                      <td
                        style={{
                          padding: "0.625rem 1rem",
                          color: "var(--text-secondary)",
                          borderBottom: "1px solid var(--border)",
                        }}
                      >
                        {row.feature}
                      </td>
                      <td
                        style={{
                          textAlign: "center",
                          padding: "0.625rem 0.75rem",
                          borderBottom: "1px solid var(--border)",
                        }}
                      >
                        {row.claude ? <Check /> : <Cross />}
                      </td>
                      <td
                        style={{
                          textAlign: "center",
                          padding: "0.625rem 0.75rem",
                          borderBottom: "1px solid var(--border)",
                        }}
                      >
                        {row.supermemory ? <Check /> : <Cross />}
                      </td>
                      <td
                        style={{
                          textAlign: "center",
                          padding: "0.625rem 0.75rem",
                          borderBottom: "1px solid var(--border)",
                        }}
                      >
                        {row.attrition ? <Check /> : <Cross />}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* ═══ Section 5: Provider Agnostic ═══ */}
          <div style={{ marginBottom: "4rem" }}>
            <h2 style={sectionHeading}>Provider Agnostic</h2>
            <p style={{ fontSize: "0.875rem", color: "var(--text-secondary)", marginBottom: "1rem" }}>
              One install. Every agent runtime.
            </p>
            <div
              style={{
                display: "flex",
                gap: "0.5rem",
                flexWrap: "wrap",
                justifyContent: "center",
              }}
            >
              {PROVIDER_BADGES.map((name) => (
                <span
                  key={name}
                  style={{
                    padding: "0.375rem 0.875rem",
                    borderRadius: "2rem",
                    border: "1px solid var(--border)",
                    background: "var(--bg-surface)",
                    fontSize: "0.75rem",
                    color: "var(--text-secondary)",
                    fontWeight: 500,
                  }}
                >
                  {name}
                </span>
              ))}
            </div>
          </div>

          {/* ═══ Section 6: Pricing ═══ */}
          <div style={{ marginBottom: "4rem", maxWidth: 680, marginLeft: "auto", marginRight: "auto" }}>
            <h2 style={sectionHeading}>Pricing</h2>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: "1rem",
              }}
            >
              {/* Solo */}
              <div
                style={{
                  ...glassCard,
                  padding: "1.5rem",
                  textAlign: "left",
                  border: "1px solid rgba(217,119,87,0.2)",
                }}
              >
                <h3
                  style={{
                    fontSize: "1.125rem",
                    fontWeight: 700,
                    color: "var(--accent)",
                    marginBottom: "0.25rem",
                  }}
                >
                  Solo
                </h3>
                <p
                  style={{
                    fontSize: "1.5rem",
                    fontWeight: 700,
                    color: "var(--text-primary)",
                    marginBottom: "1rem",
                  }}
                >
                  Free <span style={{ fontSize: "0.8125rem", fontWeight: 400, color: "var(--text-muted)" }}>forever</span>
                </p>
                <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                  {[
                    "bp CLI + local SQLite",
                    "4-hook enforcement",
                    "Workflow capture + distill",
                    "Correction learning",
                    "All providers supported",
                  ].map((item) => (
                    <li
                      key={item}
                      style={{
                        fontSize: "0.8125rem",
                        color: "var(--text-secondary)",
                        lineHeight: 1.5,
                        paddingLeft: "1.25rem",
                        position: "relative",
                      }}
                    >
                      <span style={{ position: "absolute", left: 0, color: "var(--accent)" }}>\u2713</span>
                      {item}
                    </li>
                  ))}
                </ul>
                <p
                  style={{
                    marginTop: "1rem",
                    fontSize: "0.75rem",
                    color: "var(--text-muted)",
                    fontStyle: "italic",
                  }}
                >
                  Free. Runs on your machine.
                </p>
              </div>

              {/* Teams */}
              <div
                style={{
                  ...glassCard,
                  padding: "1.5rem",
                  textAlign: "left",
                  opacity: 0.7,
                }}
              >
                <h3
                  style={{
                    fontSize: "1.125rem",
                    fontWeight: 700,
                    color: "var(--text-primary)",
                    marginBottom: "0.25rem",
                  }}
                >
                  Teams
                </h3>
                <p
                  style={{
                    fontSize: "1.5rem",
                    fontWeight: 700,
                    color: "var(--text-primary)",
                    marginBottom: "1rem",
                  }}
                >
                  $19<span style={{ fontSize: "0.8125rem", fontWeight: 400, color: "var(--text-muted)" }}>/mo per seat</span>
                </p>
                <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                  {[
                    "Cloud workflow sync",
                    "Shared enforcement policies",
                    "Team memory + corrections",
                    "Compliance dashboard",
                    "Priority support",
                  ].map((item) => (
                    <li
                      key={item}
                      style={{
                        fontSize: "0.8125rem",
                        color: "var(--text-secondary)",
                        lineHeight: 1.5,
                        paddingLeft: "1.25rem",
                        position: "relative",
                      }}
                    >
                      <span style={{ position: "absolute", left: 0, color: "var(--text-muted)" }}>\u2713</span>
                      {item}
                    </li>
                  ))}
                </ul>
                <p
                  style={{
                    marginTop: "1rem",
                    fontSize: "0.75rem",
                    color: "var(--text-muted)",
                    fontStyle: "italic",
                  }}
                >
                  Coming soon.
                </p>
              </div>
            </div>
          </div>

          {/* ═══ Section 7: Install snippet ═══ */}
          <div
            style={{
              padding: "1.5rem 2rem",
              borderRadius: "0.75rem",
              border: "1px solid var(--border)",
              background: "var(--bg-surface)",
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: "0.8125rem",
              color: "var(--text-secondary)",
              textAlign: "left",
              maxWidth: 580,
              marginLeft: "auto",
              marginRight: "auto",
              marginBottom: "2rem",
            }}
          >
            <div style={{ color: "var(--text-muted)", marginBottom: "0.375rem" }}>
              # Install (one time, 30 seconds)
            </div>
            <div>
              <span style={{ color: "var(--accent)" }}>$</span> curl -sL
              attrition.sh/install | bash
            </div>
            <div style={{ marginTop: "1rem", color: "var(--text-muted)" }}>
              # That's it. Enforcement hooks activate automatically.
            </div>
            <div style={{ marginTop: "0.375rem", color: "var(--text-muted)" }}>
              # Every session is now tracked, judged, and enforced.
            </div>
            <div style={{ marginTop: "1rem", color: "var(--text-muted)" }}>
              # View your workflows
            </div>
            <div>
              <span style={{ color: "var(--accent)" }}>$</span> bp workflows
            </div>
            <div style={{ marginTop: "0.75rem", color: "var(--text-muted)" }}>
              # Distill a frontier workflow for cheaper replay
            </div>
            <div>
              <span style={{ color: "var(--accent)" }}>$</span> bp distill
              --target sonnet-4-6
            </div>
            <div style={{ marginTop: "0.75rem", color: "var(--text-muted)" }}>
              # Team sync (coming soon)
            </div>
            <div>
              <span style={{ color: "var(--accent)" }}>$</span> bp sync --team
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
}
