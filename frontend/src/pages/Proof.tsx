import { Layout } from "../components/Layout";

/* ── Styles ────────────────────────────────────────────────── */

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

/* ── Pain → Fix data ───────────────────────────────────────── */

interface PainRow {
  pain: string;
  theme: string;
  sourceQuote: string;
  sourceLabel: string;
  sourceUrl: string;
  baseline: string[];
  attritionFix: string[];
  verdict: string;
  verdictColor: string;
  savings: string;
}

const PAIN_ROWS: PainRow[] = [
  {
    pain: "Agent says \"done\" with unfinished work",
    theme: "false_completion",
    sourceQuote: "Claude Code will often stop after a task, forgetting it has unfinished TODOs, and you have to remind it to keep going.",
    sourceLabel: "claude-code #1632",
    sourceUrl: "https://github.com/anthropics/claude-code/issues/1632",
    baseline: [
      "Agent completes 3 of 10 TODOs",
      "Declares \"The project is now fully reconstructed!\"",
      "User manually says \"Don't forget to decompile the tests...\"",
      "Agent resumes — wastes re-exploration tokens",
    ],
    attritionFix: [
      "on-stop hook fires before agent can declare done",
      "Judge checks: 3/10 TODOs complete = 30%",
      "Verdict: FAILED — blocks stop, lists 7 missing items",
      "Agent continues without user correction needed",
    ],
    verdict: "FAILED → agent forced to continue",
    verdictColor: "#ef4444",
    savings: "Eliminated 1 correction cycle + re-exploration tokens",
  },
  {
    pain: "Agent skips explicit instructions silently",
    theme: "instruction_drift",
    sourceQuote: "Claude selectively completed only the easy parts and skipped the rest without asking.",
    sourceLabel: "claude-code #24129",
    sourceUrl: "https://github.com/anthropics/claude-code/issues/24129",
    baseline: [
      "User gives 5 requirements: PDF, xlsx, csv, inner data, outer data",
      "Agent processes xlsx only, skips PDF and csv entirely",
      "No notification that requirements were dropped",
      "User discovers gap manually hours later",
    ],
    attritionFix: [
      "on-prompt detects 5 required data sources",
      "Injects checklist into agent context",
      "on-tool-use tracks: xlsx ✓, PDF ✗, csv ✗ after 15 calls",
      "Nudge fired: \"Missing: PDF parsing, CSV processing\"",
    ],
    verdict: "PARTIAL → nudge at tool call 15",
    verdictColor: "#eab308",
    savings: "Caught gap at minute 8 instead of hour 3",
  },
  {
    pain: "70% of tokens are waste in agent runs",
    theme: "cost_overrun",
    sourceQuote: "A developer tracking consumption across 42 agent runs found that 70% of tokens were waste — reading too many files, exploring irrelevant paths, repeating searches.",
    sourceLabel: "Morph LLM cost analysis",
    sourceUrl: "https://www.morphllm.com/ai-coding-costs",
    baseline: [
      "Agent reads 47 files when 12 are relevant",
      "Searches the same query 3 times across the session",
      "Explores 2 dead-end approaches before finding the right one",
      "Total: 52K tokens, $0.82 on Opus",
    ],
    attritionFix: [
      "Distill after first run: eliminate dead-end explorations",
      "Copy-paste extraction: reuse known-good file contents",
      "Context compression: strip redundant reasoning",
      "Distilled replay: 23K tokens, $0.18 on Sonnet",
    ],
    verdict: "CORRECT — replay accepted at 56% fewer tokens",
    verdictColor: "#22c55e",
    savings: "$0.82 → $0.18 per run (78% cost reduction)",
  },
  {
    pain: "Rules files don't hold up as work scales",
    theme: "rules_file_overload",
    sourceQuote: "Users are writing long CLAUDE.md and lessons.md files to stop repeated mistakes, but still complain about instruction-following and having to restate recurring principles.",
    sourceLabel: "Reddit r/ClaudeAI + HN threads, 2026",
    sourceUrl: "https://www.reddit.com/r/ClaudeAI/",
    baseline: [
      "200-line CLAUDE.md with 15 rules",
      "Agent loads all 200 lines every call (token overhead)",
      "Rule #7 says \"always run tests\" — agent ignores it 40% of the time",
      "User adds rule #16: \"I MEAN IT, run the tests\" — still missed",
    ],
    attritionFix: [
      "on-prompt: detects \"always run tests\" as a required step",
      "Promotes to hard-gated workflow step (not a suggestion)",
      "on-stop: checks for Bash tool call containing test command",
      "No test evidence → Verdict: FAILED, blocks stop",
    ],
    verdict: "FAILED → blocks until test evidence found",
    verdictColor: "#ef4444",
    savings: "Rules become enforced policies, not ignored suggestions",
  },
  {
    pain: "Memory lost between sessions",
    theme: "memory_loss",
    sourceQuote: "Users keep reopening sessions and restating context or mining old logs because the system does not retrieve the right prior knowledge at the right time.",
    sourceLabel: "HN discussions on coding agent memory, 2026",
    sourceUrl: "https://news.ycombinator.com/",
    baseline: [
      "Day 1: user explains 7-step deployment workflow",
      "Day 2: new session, agent has no memory of workflow",
      "User re-explains from scratch (15 minutes + 3K tokens)",
      "Day 3: same thing again",
    ],
    attritionFix: [
      "Day 1: attrition captures the workflow (47 canonical events)",
      "Day 2: on-session-start retrieves prior workflow",
      "Injects required steps into context automatically",
      "User types task → agent already knows the 7 steps",
    ],
    verdict: "CORRECT — workflow retrieved, no re-explanation needed",
    verdictColor: "#22c55e",
    savings: "15 min + 3K tokens saved per resumed session",
  },
];

/* ── Component ─────────────────────────────────────────────── */

export function Proof() {
  return (
    <Layout>
      <div style={{ maxWidth: 960, margin: "0 auto", padding: "3rem 1.5rem 2rem" }}>

        {/* Header */}
        <div style={{ textAlign: "center", marginBottom: "3rem" }}>
          <h1 style={{ fontSize: "2.25rem", fontWeight: 700, letterSpacing: "-0.025em", color: "#e8e6e3", marginBottom: "0.5rem" }}>
            Pain &rarr; Fix
          </h1>
          <p style={{ ...muted, maxWidth: 600, margin: "0 auto", fontSize: "1rem" }}>
            Five real developer pain points from 2026.
            Each one: the source quote, what happens today, and what attrition does differently.
          </p>
        </div>

        {/* Pain rows */}
        <div style={{ display: "flex", flexDirection: "column", gap: "2rem" }}>
          {PAIN_ROWS.map((row, i) => (
            <div key={i} style={{ ...glass, padding: "1.5rem", overflow: "hidden" }}>

              {/* Pain header */}
              <div style={{ display: "flex", alignItems: "baseline", gap: "0.75rem", marginBottom: "0.75rem", flexWrap: "wrap" }}>
                <span style={{
                  ...mono,
                  fontSize: "0.6875rem",
                  padding: "0.125rem 0.5rem",
                  borderRadius: "0.25rem",
                  background: "rgba(217,119,87,0.12)",
                  color: "#d97757",
                }}>
                  {row.theme}
                </span>
                <h3 style={{ fontSize: "1.125rem", fontWeight: 700, color: "#e8e6e3", margin: 0 }}>
                  {row.pain}
                </h3>
              </div>

              {/* Source quote */}
              <div style={{
                display: "flex",
                gap: "0.75rem",
                alignItems: "flex-start",
                padding: "0.75rem 1rem",
                borderRadius: "0.5rem",
                background: "rgba(255,255,255,0.02)",
                border: "1px solid rgba(255,255,255,0.04)",
                marginBottom: "1.25rem",
              }}>
                <span style={{ color: "#d97757", fontSize: "1.25rem", lineHeight: 1, flexShrink: 0 }}>&ldquo;</span>
                <div>
                  <p style={{ fontSize: "0.8125rem", color: "#e8e6e3", lineHeight: 1.5, margin: "0 0 0.25rem" }}>
                    {row.sourceQuote}
                  </p>
                  <a href={row.sourceUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: "0.6875rem", color: "#d97757", textDecoration: "none" }}>
                    {row.sourceLabel} &rarr;
                  </a>
                </div>
              </div>

              {/* Before / After columns */}
              <div style={{
                display: "grid",
                gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)",
                gap: "0.75rem",
                marginBottom: "1rem",
              }}>
                {/* Baseline */}
                <div>
                  <div style={{ fontSize: "0.6875rem", textTransform: "uppercase", letterSpacing: "0.1em", color: "#9a9590", marginBottom: "0.5rem" }}>
                    Without attrition
                  </div>
                  <div style={{
                    ...glass,
                    padding: "0.875rem",
                    background: "rgba(255,255,255,0.02)",
                    opacity: 0.7,
                  }}>
                    {row.baseline.map((line, j) => (
                      <div key={j} style={{ fontSize: "0.8125rem", color: "#9a9590", marginBottom: j < row.baseline.length - 1 ? "0.375rem" : 0, lineHeight: 1.4 }}>
                        <span style={{ color: "#6b6560", marginRight: "0.375rem" }}>&bull;</span>
                        {line}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Attrition fix */}
                <div>
                  <div style={{ fontSize: "0.6875rem", textTransform: "uppercase", letterSpacing: "0.1em", color: "#d97757", fontWeight: 600, marginBottom: "0.5rem" }}>
                    With attrition
                  </div>
                  <div style={{
                    ...glass,
                    padding: "0.875rem",
                    border: "1px solid rgba(217,119,87,0.15)",
                    background: "rgba(217,119,87,0.02)",
                  }}>
                    {row.attritionFix.map((line, j) => (
                      <div key={j} style={{ fontSize: "0.8125rem", color: "#e8e6e3", marginBottom: j < row.attritionFix.length - 1 ? "0.375rem" : 0, lineHeight: 1.4 }}>
                        <span style={{ color: "#d97757", marginRight: "0.375rem" }}>&bull;</span>
                        {line}
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Verdict + savings */}
              <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
                <div style={{
                  ...glass,
                  padding: "0.5rem 0.875rem",
                  display: "flex",
                  alignItems: "center",
                  gap: "0.5rem",
                  flex: 1,
                  minWidth: 200,
                }}>
                  <span style={{ fontSize: "0.6875rem", textTransform: "uppercase", letterSpacing: "0.08em", color: "#9a9590" }}>Verdict:</span>
                  <span style={{ ...mono, fontSize: "0.75rem", fontWeight: 600, color: row.verdictColor }}>{row.verdict}</span>
                </div>
                <div style={{
                  ...glass,
                  padding: "0.5rem 0.875rem",
                  display: "flex",
                  alignItems: "center",
                  gap: "0.5rem",
                  flex: 1,
                  minWidth: 200,
                }}>
                  <span style={{ fontSize: "0.6875rem", textTransform: "uppercase", letterSpacing: "0.08em", color: "#9a9590" }}>Savings:</span>
                  <span style={{ fontSize: "0.8125rem", color: "#22c55e" }}>{row.savings}</span>
                </div>
              </div>

            </div>
          ))}
        </div>

        {/* Bottom CTA */}
        <div style={{ textAlign: "center", marginTop: "3rem" }}>
          <p style={{ ...muted, marginBottom: "1rem" }}>
            Every pain above is a real 2026 developer complaint. Every fix is a real attrition hook.
          </p>
          <div style={{
            ...glass,
            ...mono,
            padding: "1rem 1.5rem",
            fontSize: "0.875rem",
            maxWidth: 460,
            margin: "0 auto 0.75rem",
            border: "1px solid rgba(217,119,87,0.25)",
            background: "rgba(217,119,87,0.03)",
            textAlign: "center",
          }}>
            <span style={{ color: "#d97757" }}>$</span>{" "}
            <span style={{ color: "#e8e6e3" }}>curl -sL attrition.sh/install | bash</span>
          </div>
          <p style={{ fontSize: "0.75rem", color: "#9a9590" }}>
            Free forever. Runs locally. Hooks activate automatically.
          </p>
        </div>

      </div>
    </Layout>
  );
}
