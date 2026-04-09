import { useNavigate } from "react-router-dom";
import { Layout } from "../components/Layout";
import { useEffect } from "react";
import { seedDemoData } from "../lib/demo-data";

/* ── Shared styles ─────────────────────────────────────────────── */

const glass: React.CSSProperties = {
  borderRadius: "0.625rem",
  border: "1px solid rgba(255,255,255,0.06)",
  background: "#141415",
};

const mono: React.CSSProperties = {
  fontFamily: "'JetBrains Mono', monospace",
};

const muted: React.CSSProperties = {
  fontSize: "0.8125rem",
  color: "#9a9590",
  lineHeight: 1.6,
};

const sectionNum: React.CSSProperties = {
  ...mono,
  fontSize: "0.6875rem",
  textTransform: "uppercase",
  letterSpacing: "0.15em",
  color: "#9a9590",
  marginBottom: "0.75rem",
};

const sectionHeading: React.CSSProperties = {
  fontSize: "1.75rem",
  fontWeight: 700,
  letterSpacing: "-0.025em",
  lineHeight: 1.2,
  color: "#e8e6e3",
  marginBottom: "0.75rem",
};

const wrap: React.CSSProperties = {
  maxWidth: 900,
  margin: "0 auto",
  padding: "3rem 1.5rem 2rem",
};

const sectionGap: React.CSSProperties = { marginBottom: "5rem" };

const badge: React.CSSProperties = {
  display: "inline-block",
  padding: "0.2rem 0.5rem",
  borderRadius: "2rem",
  border: "1px solid rgba(255,255,255,0.06)",
  background: "#141415",
  fontSize: "0.6875rem",
  color: "#9a9590",
  marginRight: "0.375rem",
  marginBottom: "0.375rem",
};

/* ── Competitive matrix data ──────────────────────────────────── */

const FEATURES = [
  "Remember preferences",
  "Cross-tool memory",
  "Workflow detection",
  "Step-by-step tracking",
  "Block incomplete work",
  "Self-improving judge",
  "Replay at lower cost",
  "Runs locally (free)",
] as const;

type CellVal = true | false;
const COMPETITORS: { name: string; vals: CellVal[] }[] = [
  { name: "Claude Memory",  vals: [true,  false, false, false, false, false, false, true ] },
  { name: "Supermemory",    vals: [true,  true,  false, false, false, false, false, false] },
  { name: "Codex",          vals: [true,  false, false, false, false, false, false, false] },
];
const ATTRITION_VALS: CellVal[] = [true, true, true, true, true, true, true, true];

/* ── Personas ─────────────────────────────────────────────────── */

const PERSONAS = [
  {
    who: "Claude Code power users",
    pain: "\"I keep telling it to run tests. It keeps forgetting.\"",
    fix: "Attrition's Stop hook blocks completion until tests are verified.",
  },
  {
    who: "Engineers with repeated workflows",
    pain: "\"Every sprint I re-explain the same 7-step process.\"",
    fix: "Attrition captures the workflow once, enforces it every time after.",
  },
  {
    who: "Teams paying too much for agent runs",
    pain: "\"We're spending $4K/session on Opus for the same refactor pattern.\"",
    fix: "Attrition distills the workflow and replays on Sonnet at 60% less.",
  },
];

/* ── Providers ────────────────────────────────────────────────── */

const PROVIDERS = ["Claude Code", "Cursor", "OpenAI", "LangChain", "CrewAI", "Anthropic", "PydanticAI"];

/* ── Component ────────────────────────────────────────────────── */

export function Landing() {
  const navigate = useNavigate();
  useEffect(() => { seedDemoData(); }, []);

  return (
    <Layout>
      <div style={wrap}>

        {/* ═══════════════════════════════════════════════════════
            [1/8] HERO — Pain + Promise + CTA
            ═══════════════════════════════════════════════════════ */}
        <section style={{ ...sectionGap, textAlign: "center" }}>
          <div style={sectionNum}>[1/8]</div>

          <h1 style={{
            fontSize: "2.75rem",
            fontWeight: 700,
            letterSpacing: "-0.03em",
            lineHeight: 1.15,
            marginBottom: "0.5rem",
            color: "#e8e6e3",
          }}>
            Your agent says it's done too early.
          </h1>
          <h2 style={{
            fontSize: "2.75rem",
            fontWeight: 700,
            letterSpacing: "-0.03em",
            lineHeight: 1.15,
            marginBottom: "1.5rem",
            color: "#d97757",
          }}>
            Attrition shows what it skipped.
          </h2>

          <p style={{
            ...muted,
            maxWidth: 580,
            margin: "0 auto 2.5rem",
            fontSize: "1.0625rem",
          }}>
            Attrition watches every tool call, file edit, and search your AI agent makes.
            It checks recurring workflows against your actual standard, flags what's missing,
            and replays the next run at lower cost.
          </p>

          <div style={{ display: "flex", gap: "0.75rem", justifyContent: "center", flexWrap: "wrap" }}>
            <button
              onClick={() => navigate("/proof")}
              style={{
                padding: "0.875rem 2rem",
                borderRadius: "0.75rem",
                border: "none",
                background: "#d97757",
                color: "#fff",
                fontSize: "1rem",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              See the proof
            </button>
            <button
              onClick={() => navigate("/anatomy")}
              style={{
                padding: "0.875rem 2rem",
                borderRadius: "0.75rem",
                border: "1px solid rgba(255,255,255,0.06)",
                background: "transparent",
                color: "#e8e6e3",
                fontSize: "1rem",
                fontWeight: 500,
                cursor: "pointer",
              }}
            >
              See replay anatomy
            </button>
          </div>
        </section>

        {/* ═══════════════════════════════════════════════════════
            [2/8] THE PRODUCT IN ONE SCREEN — visible miss
            ═══════════════════════════════════════════════════════ */}
        <section id="product-screen" style={sectionGap}>
          <div style={sectionNum}>[2/8]</div>
          <h2 style={sectionHeading}>The product in one screen</h2>
          <p style={{ ...muted, marginBottom: "1.25rem" }}>
            Task: Refactor API client to async/await
          </p>

          <div style={{
            ...glass,
            padding: "1.5rem",
            marginBottom: "0.75rem",
          }}>
            {/* Two-column: agent vs attrition */}
            <div style={{
              display: "grid",
              gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
              gap: "1rem",
              marginBottom: "1.25rem",
            }}>
              {/* Left — agent reported */}
              <div>
                <div style={{
                  fontSize: "0.6875rem",
                  textTransform: "uppercase",
                  letterSpacing: "0.1em",
                  color: "#9a9590",
                  marginBottom: "0.625rem",
                }}>
                  What the agent reported
                </div>
                <div style={{
                  ...glass,
                  padding: "1rem",
                  background: "rgba(255,255,255,0.02)",
                }}>
                  {[
                    "Grep'd for sync patterns (12 matches)",
                    "Read src/api/client.ts",
                    "Edited 4 files to async/await",
                    "Ran tests -- all pass",
                    "Built -- clean",
                  ].map((line) => (
                    <div key={line} style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "0.5rem",
                      fontSize: "0.8125rem",
                      marginBottom: "0.375rem",
                    }}>
                      <span style={{ color: "#22c55e", ...mono, fontSize: "0.75rem" }}>OK</span>
                      <span style={{ color: "#e8e6e3" }}>{line}</span>
                    </div>
                  ))}
                  <div style={{
                    marginTop: "0.625rem",
                    padding: "0.5rem 0.75rem",
                    borderRadius: "0.375rem",
                    background: "rgba(34,197,94,0.06)",
                    border: "1px solid rgba(34,197,94,0.15)",
                    fontSize: "0.8125rem",
                    color: "#22c55e",
                    ...mono,
                  }}>
                    "Done! All sync calls converted."
                  </div>
                </div>
              </div>

              {/* Right — attrition caught */}
              <div>
                <div style={{
                  fontSize: "0.6875rem",
                  textTransform: "uppercase",
                  letterSpacing: "0.1em",
                  color: "#ef4444",
                  fontWeight: 600,
                  marginBottom: "0.625rem",
                }}>
                  What attrition caught
                </div>
                <div style={{
                  ...glass,
                  padding: "1rem",
                  border: "1px solid rgba(239,68,68,0.3)",
                  background: "rgba(239,68,68,0.04)",
                }}>
                  {[
                    "Search for breaking changes in dependent packages",
                    "Update generated types (src/types/api.d.ts)",
                    "Run integration tests (only unit tests ran)",
                  ].map((step) => (
                    <div key={step} style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "0.5rem",
                      fontSize: "0.8125rem",
                      marginBottom: "0.375rem",
                    }}>
                      <span style={{ color: "#ef4444", ...mono, fontSize: "0.6875rem", fontWeight: 600 }}>MISSING</span>
                      <span style={{ color: "#e8e6e3" }}>{step}</span>
                    </div>
                  ))}
                  <div style={{
                    marginTop: "0.75rem",
                    borderTop: "1px solid rgba(239,68,68,0.2)",
                    paddingTop: "0.625rem",
                    fontSize: "0.8125rem",
                  }}>
                    <span style={{ color: "#eab308", fontWeight: 600, ...mono }}>VERDICT: SHOULD HAVE ESCALATED</span>
                    <div style={{ color: "#9a9590", fontSize: "0.75rem", marginTop: "0.25rem" }}>
                      3 of 8 required steps missing
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Bottom row — after correction */}
            <div style={{
              display: "flex",
              gap: "1rem",
              flexWrap: "wrap",
              alignItems: "center",
            }}>
              <div style={{
                ...glass,
                padding: "0.625rem 1rem",
                display: "flex",
                alignItems: "center",
                gap: "0.5rem",
                flex: 1,
                minWidth: 200,
              }}>
                <span style={{
                  display: "inline-block",
                  padding: "0.125rem 0.5rem",
                  borderRadius: "0.25rem",
                  background: "rgba(34,197,94,0.15)",
                  color: "#22c55e",
                  fontSize: "0.75rem",
                  fontWeight: 600,
                  ...mono,
                }}>
                  ACCEPTED
                </span>
                <span style={{ fontSize: "0.8125rem", color: "#9a9590" }}>
                  After correction &mdash; corrected replay accepted, 63% cheaper on Sonnet
                </span>
              </div>
            </div>
          </div>

          <p style={{ textAlign: "center", fontSize: "0.75rem", color: "#9a9590" }}>
            Real workflow. Real miss. Real catch. &mdash;{" "}
            <a href="/anatomy" style={{ color: "#d97757", textDecoration: "none" }}>
              See the full trace &rarr;
            </a>
          </p>
        </section>

        {/* ═══════════════════════════════════════════════════════
            [3/9] THIS IS NOT A HYPOTHETICAL — real quotes from the wild
            ═══════════════════════════════════════════════════════ */}
        <section style={sectionGap}>
          <div style={sectionNum}>[3/9]</div>
          <h2 style={sectionHeading}>This is not a hypothetical</h2>
          <p style={{ ...muted, marginBottom: "1.25rem", textAlign: "center" }}>
            Real developers. Real GitHub issues. Real frustration. All from 2026.
          </p>

          <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
            {[
              {
                quote: "Claude Code will often stop after a task, forgetting it has unfinished TODOs, and you have to remind it to keep going.",
                source: "GitHub issue #1632",
                url: "https://github.com/anthropics/claude-code/issues/1632",
                detail: "User had 10 TODOs. Agent completed 3 and declared victory.",
              },
              {
                quote: "Claude selectively completed only the easy parts and skipped the rest without asking.",
                source: "GitHub issue #24129",
                url: "https://github.com/anthropics/claude-code/issues/24129",
                detail: "5 explicit requirements given. Claude did 2, silently dropped 3.",
              },
              {
                quote: "A developer tracking token consumption across 42 agent runs found that 70% of tokens were waste.",
                source: "Morph LLM cost analysis",
                url: "https://www.morphllm.com/ai-coding-costs",
                detail: "Agent read too many files, explored irrelevant paths, repeated searches.",
              },
              {
                quote: "Developers using Claude Code as an agent report $500–2,000/month in API costs, far exceeding published pricing.",
                source: "Morph LLM pricing report",
                url: "https://www.morphllm.com/ai-coding-costs",
                detail: "Sessions reach 200K tokens per call by the end.",
              },
            ].map((item) => (
              <div key={item.source} style={{ ...glass, padding: "1rem 1.25rem", display: "flex", gap: "1rem", alignItems: "flex-start" }}>
                <span style={{ color: "#d97757", fontSize: "1.25rem", lineHeight: 1, flexShrink: 0, marginTop: "0.125rem" }}>&ldquo;</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontSize: "0.875rem", color: "#e8e6e3", lineHeight: 1.5, marginBottom: "0.375rem" }}>
                    {item.quote}
                  </p>
                  <p style={{ fontSize: "0.75rem", color: "#9a9590", marginBottom: "0.25rem" }}>{item.detail}</p>
                  <a href={item.url} target="_blank" rel="noopener noreferrer" style={{ fontSize: "0.6875rem", color: "#d97757", textDecoration: "none" }}>
                    {item.source} &rarr;
                  </a>
                </div>
              </div>
            ))}
          </div>

          <p style={{ textAlign: "center", fontSize: "0.75rem", color: "#9a9590", marginTop: "1rem" }}>
            Attrition exists because CLAUDE.md remembers preferences &mdash; but nothing <em>enforces</em> workflow steps.
          </p>
        </section>

        {/* ═══════════════════════════════════════════════════════
            [4/9] HOW IT WORKS — 3 steps
            ═══════════════════════════════════════════════════════ */}
        <section style={sectionGap}>
          <div style={sectionNum}>[4/9]</div>
          <h2 style={sectionHeading}>How it works</h2>

          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
            gap: "0.875rem",
          }}>
            {[
              {
                num: "1",
                title: "Capture",
                desc: "Hooks into your agent runtime. Watches every prompt, tool call, file edit, search, and output. Captures as canonical events -- tool-agnostic, provider-agnostic.",
                badges: PROVIDERS,
              },
              {
                num: "2",
                title: "Judge",
                desc: "Compares what happened against your recurring workflow standard. Flags skipped steps. Blocks incomplete work. Learns from corrections -- the judge tightens over time.",
                badges: ["on-prompt", "on-tool-use", "on-stop", "on-session-start"],
              },
              {
                num: "3",
                title: "Replay",
                desc: "Distills the workflow to 45% smaller. Replays on a cheaper model. Judge verifies the replay is correct before accepting. Saves $1,965 on a typical frontier run.",
                badges: ["step elimination", "copy-paste", "context compression", "checkpoints"],
              },
            ].map((step) => (
              <div key={step.num} style={{ ...glass, padding: "1.25rem" }}>
                <div style={{
                  ...mono,
                  fontSize: "1.5rem",
                  fontWeight: 700,
                  color: "#d97757",
                  marginBottom: "0.375rem",
                }}>
                  {step.num}
                </div>
                <div style={{
                  fontSize: "0.9375rem",
                  fontWeight: 600,
                  color: "#e8e6e3",
                  marginBottom: "0.5rem",
                }}>
                  {step.title}
                </div>
                <p style={{ ...muted, fontSize: "0.8125rem", margin: "0 0 0.75rem" }}>
                  {step.desc}
                </p>
                <div style={{ display: "flex", flexWrap: "wrap" }}>
                  {step.badges.map((b) => (
                    <span key={b} style={badge}>{b}</span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ═══════════════════════════════════════════════════════
            [5/9] COMPETITIVE POSITIONING — feature matrix
            ═══════════════════════════════════════════════════════ */}
        <section style={sectionGap}>
          <div style={sectionNum}>[5/9]</div>
          <h2 style={sectionHeading}>Memory remembers. Attrition enforces.</h2>
          <p style={{ ...muted, marginBottom: "1.5rem" }}>
            Most tools help your agent remember. Attrition is the only one that blocks incomplete work.
          </p>

          {/* Header row */}
          <div style={{
            display: "grid",
            gridTemplateColumns: "1fr repeat(4, 100px)",
            gap: "1px",
            marginBottom: "1px",
          }}>
            <div style={{ padding: "0.625rem 0.75rem", fontSize: "0.6875rem", textTransform: "uppercase", letterSpacing: "0.08em", color: "#9a9590" }}>
              Feature
            </div>
            {[...COMPETITORS.map((c) => c.name), "attrition"].map((name, i) => (
              <div key={name} style={{
                padding: "0.625rem 0.5rem",
                fontSize: "0.6875rem",
                textTransform: "uppercase",
                letterSpacing: "0.05em",
                textAlign: "center",
                fontWeight: 600,
                color: i === 3 ? "#d97757" : "#9a9590",
                background: i === 3 ? "rgba(217,119,87,0.06)" : "transparent",
                borderRadius: i === 3 ? "0.375rem 0.375rem 0 0" : undefined,
              }}>
                {name}
              </div>
            ))}
          </div>

          {/* Data rows */}
          {FEATURES.map((feat, ri) => (
            <div key={feat} style={{
              display: "grid",
              gridTemplateColumns: "1fr repeat(4, 100px)",
              gap: "1px",
              borderTop: "1px solid rgba(255,255,255,0.04)",
            }}>
              <div style={{
                padding: "0.5rem 0.75rem",
                fontSize: "0.8125rem",
                color: "#e8e6e3",
              }}>
                {feat}
              </div>
              {COMPETITORS.map((comp) => (
                <div key={comp.name} style={{
                  padding: "0.5rem 0.5rem",
                  textAlign: "center",
                  fontSize: "0.875rem",
                  color: comp.vals[ri] ? "rgba(255,255,255,0.25)" : "rgba(255,255,255,0.1)",
                }}>
                  {comp.vals[ri] ? "\u2713" : "\u2717"}
                </div>
              ))}
              <div style={{
                padding: "0.5rem 0.5rem",
                textAlign: "center",
                fontSize: "0.875rem",
                color: ATTRITION_VALS[ri] ? "#22c55e" : "rgba(255,255,255,0.1)",
                background: "rgba(217,119,87,0.06)",
                fontWeight: 600,
              }}>
                {ATTRITION_VALS[ri] ? "\u2713" : "\u2717"}
              </div>
            </div>
          ))}

          <p style={{ textAlign: "center", fontSize: "0.75rem", color: "#9a9590", marginTop: "0.75rem" }}>
            Supermemory: $19/mo. Codex: waitlist. Attrition: free, local, MIT.
          </p>
        </section>

        {/* ═══════════════════════════════════════════════════════
            [6/9] REAL BENCHMARK — numbers with context
            ═══════════════════════════════════════════════════════ */}
        <section style={sectionGap}>
          <div style={sectionNum}>[6/9]</div>
          <h2 style={sectionHeading}>Real data. Not simulated.</h2>

          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
            gap: "0.875rem",
            marginBottom: "1rem",
          }}>
            {[
              { stat: "14/15", label: "acceptable replays on cross-stack benchmark" },
              { stat: "60-70%", label: "lower cost on replay vs frontier run" },
              { stat: "8/8", label: "required workflow steps verified with tool-call evidence" },
              { stat: "45%", label: "of workflow compressed into reusable replay path" },
            ].map((item) => (
              <div key={item.label} style={{
                ...glass,
                padding: "1.125rem 1.25rem",
                display: "flex",
                alignItems: "baseline",
                gap: "0.75rem",
              }}>
                <span style={{
                  ...mono,
                  fontSize: "1.5rem",
                  fontWeight: 700,
                  color: "#d97757",
                  flexShrink: 0,
                }}>
                  {item.stat}
                </span>
                <span style={{ fontSize: "0.8125rem", color: "#9a9590", lineHeight: 1.4 }}>
                  {item.label}
                </span>
              </div>
            ))}
          </div>

          <p style={{ textAlign: "center", fontSize: "0.75rem", color: "#9a9590" }}>
            Every run shows trace, verdict, and missing-step evidence.{" "}
            <a href="/benchmark" style={{ color: "#d97757", textDecoration: "none" }}>
              See the full benchmark report &rarr;
            </a>
          </p>
        </section>

        {/* ═══════════════════════════════════════════════════════
            [7/9] WHO IT'S FOR — 3 persona cards
            ═══════════════════════════════════════════════════════ */}
        <section style={sectionGap}>
          <div style={sectionNum}>[7/9]</div>
          <h2 style={sectionHeading}>Who it's for</h2>

          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
            gap: "0.875rem",
          }}>
            {PERSONAS.map((p) => (
              <div key={p.who} style={{ ...glass, padding: "1.25rem" }}>
                <div style={{
                  fontSize: "0.9375rem",
                  fontWeight: 600,
                  color: "#e8e6e3",
                  marginBottom: "0.625rem",
                }}>
                  {p.who}
                </div>
                <p style={{
                  fontSize: "0.8125rem",
                  color: "#9a9590",
                  fontStyle: "italic",
                  lineHeight: 1.5,
                  margin: "0 0 0.625rem",
                }}>
                  {p.pain}
                </p>
                <p style={{ fontSize: "0.8125rem", color: "#e8e6e3", lineHeight: 1.5, margin: 0 }}>
                  {p.fix}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* ═══════════════════════════════════════════════════════
            [8/9] UNDER THE HOOD — technical depth
            ═══════════════════════════════════════════════════════ */}
        <section style={sectionGap}>
          <div style={sectionNum}>[8/9]</div>
          <h2 style={sectionHeading}>Built for engineers who read source code.</h2>

          <div style={{
            display: "flex",
            gap: "1.5rem",
            flexWrap: "wrap",
            marginBottom: "1.5rem",
          }}>
            {[
              { val: "12", unit: "Rust crates" },
              { val: "87", unit: "tests" },
              { val: "15K", unit: "lines" },
              { val: "MIT", unit: "license" },
            ].map((s) => (
              <div key={s.unit} style={{ display: "flex", alignItems: "baseline", gap: "0.375rem" }}>
                <span style={{ ...mono, fontSize: "1.25rem", fontWeight: 700, color: "#d97757" }}>
                  {s.val}
                </span>
                <span style={{ fontSize: "0.8125rem", color: "#9a9590" }}>{s.unit}</span>
              </div>
            ))}
          </div>

          {/* Architecture block */}
          <div style={{
            ...glass,
            padding: "1.25rem",
            marginBottom: "1.25rem",
            ...mono,
            fontSize: "0.8125rem",
            lineHeight: 1.7,
            color: "#9a9590",
            whiteSpace: "pre",
            overflowX: "auto",
          }}>
{`attrition/
  workflow/     Canonical events + SQLite storage
  distiller/    4-strategy compression (45% avg)
  judge/        Always-on verdict engine + correction learner
  llm-client/   Anthropic + OpenAI + compatible endpoints
  mcp-server/   12 MCP tools (JSON-RPC)
  cli/          bp binary, 11 subcommands`}
          </div>

          {/* Python SDK */}
          <div style={{
            ...glass,
            padding: "1.25rem",
            marginBottom: "1rem",
          }}>
            <div style={{
              fontSize: "0.6875rem",
              textTransform: "uppercase",
              letterSpacing: "0.1em",
              color: "#9a9590",
              marginBottom: "0.625rem",
            }}>
              Python SDK
            </div>
            <div style={{
              ...mono,
              fontSize: "0.8125rem",
              lineHeight: 1.7,
              color: "#e8e6e3",
              whiteSpace: "pre",
            }}>
{`from attrition import track
track()  # auto-detects OpenAI, Anthropic, LangChain, CrewAI`}
            </div>
          </div>

          <a
            href="https://github.com/HomenShum/attrition"
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: "#d97757", textDecoration: "none", fontSize: "0.875rem" }}
          >
            Read the source &rarr;
          </a>
        </section>

        {/* ═══════════════════════════════════════════════════════
            [9/9] TRY IT — install LAST (after belief)
            ═══════════════════════════════════════════════════════ */}
        <section style={{ textAlign: "center", marginBottom: "2rem" }}>
          <div style={sectionNum}>[9/9]</div>
          <h2 style={{ ...sectionHeading, marginBottom: "1.25rem" }}>Try it</h2>

          <div style={{
            ...glass,
            padding: "1.25rem 2rem",
            ...mono,
            fontSize: "0.875rem",
            maxWidth: 480,
            margin: "0 auto 0.75rem",
            border: "1px solid rgba(217,119,87,0.25)",
            background: "rgba(217,119,87,0.03)",
          }}>
            <span style={{ color: "#d97757" }}>$</span>{" "}
            <span style={{ color: "#e8e6e3" }}>curl -sL attrition.sh/install | bash</span>
          </div>

          <p style={{ fontSize: "0.8125rem", color: "#9a9590", marginBottom: "1.5rem" }}>
            Free forever for solo devs. Runs locally. Zero server cost.
          </p>

          <div style={{
            display: "flex",
            gap: "0.5rem",
            flexWrap: "wrap",
            justifyContent: "center",
            marginBottom: "1.25rem",
          }}>
            {PROVIDERS.map((name) => (
              <span key={name} style={badge}>{name}</span>
            ))}
          </div>

          <p style={{ fontSize: "0.8125rem", color: "#9a9590", marginBottom: "1.5rem" }}>
            One install. Every agent runtime.
          </p>

          <div style={{
            display: "flex",
            gap: "1.5rem",
            justifyContent: "center",
            flexWrap: "wrap",
            fontSize: "0.875rem",
          }}>
            <a href="/anatomy" style={{ color: "#d97757", textDecoration: "none" }}>
              View anatomy &rarr;
            </a>
            <a href="/benchmark" style={{ color: "#d97757", textDecoration: "none" }}>
              See benchmark &rarr;
            </a>
            <a
              href="https://github.com/HomenShum/attrition"
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: "#d97757", textDecoration: "none" }}
            >
              Read the source &rarr;
            </a>
          </div>
        </section>

      </div>
    </Layout>
  );
}
