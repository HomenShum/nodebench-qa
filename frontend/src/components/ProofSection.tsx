/**
 * ProofSection — the headline marketing proof on the Architect landing.
 *
 * Live data from the BFCL v3 simple benchmark (n=200) measured against
 * joyous-walrus-428 on 2026-04-20:
 *
 *   Flash Lite solo                       93.0%  CI [88.6, 95.8]
 *   Pro solo                              74.5%  CI [68.0, 80.0]
 *   Flash Lite + attrition normalizer     95.0%  CI [91.0, 97.3]
 *
 * Gap (Pro - Flash): -18.5pp, Newcombe 95% CI [-25.5, -11.4] — stat sig,
 * INVERTED. The "upgrade to Pro" assumption is wrong by 18.5pp on this
 * benchmark. Our deterministic normalizer adds another +2pp.
 *
 * Stats are hard-coded here rather than live-queried so the marketing
 * section loads fast + doesn't flash skeletons. The raw verdict lives
 * at `daasFidelityVerdicts` for anyone who wants to verify.
 */

import { Link } from "react-router-dom";

type Stat = {
  label: string;
  rate: number;
  ciLo: number;
  ciHi: number;
  accent: string;
  sub: string;
};

const STATS: Stat[] = [
  {
    label: "gemini-3.1-flash-lite-preview",
    rate: 93.0,
    ciLo: 88.6,
    ciHi: 95.8,
    accent: "#94a3b8",
    sub: "Flash Lite solo · native function calling",
  },
  {
    label: "gemini-3.1-pro-preview",
    rate: 74.5,
    ciLo: 68.0,
    ciHi: 80.0,
    accent: "#ef4444",
    sub: "Pro solo · same function-calling config",
  },
  {
    label: "gemini-3.1-flash-lite-preview + attrition normalizer",
    rate: 95.0,
    ciLo: 91.0,
    ciHi: 97.3,
    accent: "#22c55e",
    sub: "Flash Lite + deterministic post-processor",
  },
];

export function ProofSection() {
  return (
    <section
      aria-labelledby="proof-heading"
      style={{
        marginTop: 40,
        padding: "28px 24px",
        background:
          "linear-gradient(135deg, rgba(217,119,87,0.04) 0%, rgba(34,197,94,0.04) 100%)",
        border: "1px solid rgba(217,119,87,0.25)",
        borderRadius: 14,
      }}
    >
      <div
        style={{
          fontSize: 10,
          letterSpacing: "0.22em",
          textTransform: "uppercase",
          color: "#d97757",
          marginBottom: 6,
        }}
      >
        Proof · Loop B · BFCL v3 simple · n=200 · function calling
      </div>

      <h2
        id="proof-heading"
        style={{
          fontSize: 22,
          fontWeight: 600,
          lineHeight: 1.2,
          margin: "0 0 10px",
          letterSpacing: "-0.01em",
        }}
      >
        The &quot;upgrade to Pro&quot; assumption is{" "}
        <span style={{ color: "#d97757" }}>wrong by 18.5pp</span> on
        tool-calling.
      </h2>

      <p
        style={{
          fontSize: 13,
          color: "rgba(255,255,255,0.7)",
          lineHeight: 1.55,
          margin: "0 0 22px",
          maxWidth: 680,
        }}
      >
        We measured <code style={{ fontSize: 12 }}>gemini-3.1-flash-lite-preview</code>{" "}
        vs <code style={{ fontSize: 12 }}>gemini-3.1-pro-preview</code> on 200
        BFCL v3 simple tasks. BFCL is a function-calling benchmark: each
        task declares one or more tool specs, the model emits a{" "}
        <code style={{ fontSize: 12 }}>functionCall</code> part, and the
        scorer does AST comparison against a gold set of acceptable
        call shapes. Both models ran with the same config —{" "}
        <code style={{ fontSize: 12 }}>
          toolConfig.functionCallingConfig.mode = &quot;ANY&quot;
        </code>
        , <code style={{ fontSize: 12 }}>temperature 0.0</code>, 1024
        max output tokens. The bars below show pass rate with Wilson 95%
        confidence intervals; Newcombe CI on (Pro − Flash) excludes zero.
      </p>

      <div style={{ display: "grid", gap: 14, marginBottom: 20 }}>
        {STATS.map((s) => (
          <StatBar key={s.label} stat={s} />
        ))}
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
          gap: 12,
          marginBottom: 16,
        }}
      >
        <Callout
          tone="red"
          label="Pro − Flash gap"
          value="−18.5pp"
          ci="[−25.5, −11.4]"
          note="Newcombe CI excludes 0 — stat sig"
        />
        <Callout
          tone="green"
          label="Normalizer lift"
          value="+2.0pp"
          ci="[−2.8, +7.0]"
          note="deterministic rules, zero cost"
        />
        <Callout
          tone="neutral"
          label="Cost at n=200"
          value="$0.006"
          ci="Flash Lite ~= Pro"
          note="both ~<$0.01 total"
        />
      </div>

      <details
        style={{
          marginBottom: 14,
          padding: "10px 14px",
          background: "rgba(0,0,0,0.25)",
          border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: 8,
          fontSize: 12,
          color: "rgba(255,255,255,0.75)",
        }}
      >
        <summary
          style={{
            cursor: "pointer",
            color: "rgba(255,255,255,0.85)",
            fontSize: 12,
            fontWeight: 500,
          }}
        >
          Methodology (click to expand)
        </summary>
        <ul
          style={{
            margin: "10px 0 0",
            paddingLeft: 20,
            lineHeight: 1.6,
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 11,
            color: "rgba(255,255,255,0.7)",
          }}
        >
          <li>
            Benchmark: <code>princeton-nlp</code>-hosted
            <code> BFCL_v3_simple.json</code> +{" "}
            <code>possible_answer/BFCL_v3_simple.json</code> gold
          </li>
          <li>Task count: n=200 sequential</li>
          <li>
            Baseline model: <code>gemini-3.1-flash-lite-preview</code>
          </li>
          <li>
            Ceiling model: <code>gemini-3.1-pro-preview</code>
          </li>
          <li>
            Call config: <code>temperature=0.0</code>,{" "}
            <code>maxOutputTokens=1024</code>,{" "}
            <code>tools=[{"{functionDeclarations: [...]}"}]</code>,{" "}
            <code>toolConfig.functionCallingConfig.mode=&quot;ANY&quot;</code>
          </li>
          <li>
            Scorer:{" "}
            <code>
              daas.benchmarks.bfcl.runner.score_calls
            </code>{" "}
            — BFCL v3 any-of gold shape, whitespace-insensitive compare,
            loose numeric coercion, AST match
          </li>
          <li>
            Distilled scaffold:{" "}
            <code>daas.benchmarks.bfcl.normalizers.normalize_artifact</code>{" "}
            — deterministic rules (<code>x^2 → x**2</code>,{" "}
            <code>3*x → 3x</code>, int-interval → float-interval); 27
            scenario tests
          </li>
          <li>Stats: Wilson 95% CI per rate; Newcombe CI for diffs</li>
          <li>
            Raw verdict row: <code>daasFidelityVerdicts</code> where{" "}
            <code>externalizationId = bfcl_normalizer_v2</code>
          </li>
        </ul>
      </details>

      <p
        style={{
          fontSize: 12,
          color: "rgba(255,255,255,0.55)",
          lineHeight: 1.55,
          margin: "0 0 8px",
        }}
      >
        <strong style={{ color: "rgba(255,255,255,0.8)" }}>The frame:</strong>{" "}
        BFCL&apos;s AST grader rewards mechanical output. Pro over-specifies
        (e.g. emits{" "}
        <code style={{ fontSize: 11 }}>species: &quot;Homo sapiens&quot;</code>{" "}
        when the task prompt said &quot;human&quot;). Flash Lite happens to
        emit simpler output that matches the gold more often. Our
        deterministic normalizer fixes surface-syntax mismatches (
        <code style={{ fontSize: 11 }}>x^2 → x**2</code>,{" "}
        <code style={{ fontSize: 11 }}>3*x → 3x</code>) — adds another 2pp.
      </p>

      {/* Scope ladder — same stack, different BFCL categories */}
      <div
        style={{
          marginTop: 8,
          marginBottom: 18,
          padding: "14px 16px",
          background: "rgba(255,255,255,0.02)",
          border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: 10,
        }}
      >
        <div
          style={{
            fontSize: 10,
            letterSpacing: "0.22em",
            textTransform: "uppercase",
            color: "rgba(255,255,255,0.7)",
            marginBottom: 10,
          }}
        >
          Scope ladder · same stack · different BFCL categories
        </div>
        <table
          style={{
            width: "100%",
            fontSize: 11.5,
            fontFamily: "'JetBrains Mono', monospace",
            color: "rgba(255,255,255,0.8)",
            borderCollapse: "collapse",
          }}
        >
          <thead>
            <tr
              style={{
                color: "rgba(255,255,255,0.5)",
                fontSize: 10,
                letterSpacing: "0.12em",
                textTransform: "uppercase",
                textAlign: "left",
              }}
            >
              <th style={{ padding: "6px 8px", fontWeight: 500 }}>Category</th>
              <th style={{ padding: "6px 8px", fontWeight: 500 }}>Flash</th>
              <th style={{ padding: "6px 8px", fontWeight: 500 }}>Pro</th>
              <th style={{ padding: "6px 8px", fontWeight: 500 }}>Pro − Flash</th>
              <th style={{ padding: "6px 8px", fontWeight: 500 }}>Normalizer</th>
            </tr>
          </thead>
          <tbody>
            <tr style={{ borderTop: "1px solid rgba(255,255,255,0.08)" }}>
              <td style={{ padding: "8px", color: "rgba(255,255,255,0.9)" }}>
                simple <span style={{ color: "rgba(255,255,255,0.45)" }}>n=200 · single call</span>
              </td>
              <td style={{ padding: "8px" }}>93.0%</td>
              <td style={{ padding: "8px" }}>74.5%</td>
              <td style={{ padding: "8px", color: "#ef4444", fontWeight: 600 }}>
                −18.5pp <span style={{ color: "rgba(255,255,255,0.45)", fontWeight: 400 }}>sig</span>
              </td>
              <td style={{ padding: "8px", color: "#22c55e", fontWeight: 600 }}>+2.0pp</td>
            </tr>
            <tr style={{ borderTop: "1px solid rgba(255,255,255,0.08)" }}>
              <td style={{ padding: "8px", color: "rgba(255,255,255,0.9)" }}>
                parallel <span style={{ color: "rgba(255,255,255,0.45)" }}>n=200 · multi-tool, single turn</span>
              </td>
              <td style={{ padding: "8px" }}>86.0%</td>
              <td style={{ padding: "8px" }}>87.5%</td>
              <td style={{ padding: "8px", color: "rgba(255,255,255,0.7)" }}>
                +1.5pp <span style={{ color: "rgba(255,255,255,0.45)", fontWeight: 400 }}>noise</span>
              </td>
              <td style={{ padding: "8px", color: "rgba(255,255,255,0.7)" }}>+0.5pp</td>
            </tr>
          </tbody>
        </table>
        <p
          style={{
            fontSize: 11,
            color: "rgba(255,255,255,0.55)",
            lineHeight: 1.55,
            margin: "10px 0 0",
          }}
        >
          <strong style={{ color: "rgba(255,255,255,0.8)" }}>Honest read:</strong>{" "}
          the 18.5pp gap is real on <code>simple</code> (surface-syntax
          mismatch is where Pro hurts itself). On <code>parallel</code>{" "}
          (multi-tool, single-turn) the models tie within CI. Not yet
          measured: <code>multi_turn</code> (stateful) and <code>tau2</code>{" "}
          (agentic). We don&apos;t generalize beyond what we ran.
        </p>
      </div>

      <p
        style={{
          fontSize: 12,
          color: "rgba(255,255,255,0.55)",
          lineHeight: 1.55,
          margin: "0 0 14px",
        }}
      >
        <strong style={{ color: "rgba(255,255,255,0.8)" }}>The takeaway:</strong>{" "}
        measure before you upgrade. attrition classifies your workflow
        against bounded runtime lanes, generates runnable code for the
        cheaper path, and tells you — with a Wilson CI — when a scaffold
        actually lifts fidelity.
      </p>

      {/* Loop A proof — translation layer execution */}
      <div
        style={{
          marginTop: 8,
          marginBottom: 18,
          padding: "14px 16px",
          background: "rgba(34,197,94,0.04)",
          border: "1px solid rgba(34,197,94,0.25)",
          borderRadius: 10,
        }}
      >
        <div
          style={{
            fontSize: 10,
            letterSpacing: "0.22em",
            textTransform: "uppercase",
            color: "#22c55e",
            marginBottom: 6,
          }}
        >
          Proof · Loop A · translation layer · end-to-end
        </div>
        <div
          style={{
            fontSize: 13,
            color: "rgba(255,255,255,0.85)",
            lineHeight: 1.5,
            marginBottom: 8,
          }}
        >
          The compile-down/up pipeline actually{" "}
          <em style={{ color: "#22c55e", fontStyle: "normal" }}>executes</em>
          , not just labels.
        </div>
        <ul
          style={{
            margin: 0,
            paddingLeft: 18,
            fontSize: 11.5,
            color: "rgba(255,255,255,0.7)",
            lineHeight: 1.6,
            fontFamily: "'JetBrains Mono', monospace",
          }}
        >
          <li>
            Connector resolver: flipping{" "}
            <code>CONNECTOR_MODE</code> materially changes dispatch output
            across <strong style={{ color: "#22c55e" }}>4 scenarios</strong>{" "}
            (mock / live / hybrid+override / hybrid+default) — 8 scenario
            tests, all pass
          </li>
          <li>
            Orchestrator-worker: emits a full{" "}
            <strong style={{ color: "#22c55e" }}>
              plan → dispatch → compact
            </strong>{" "}
            loop; per-worker tool calls route through the connector
            resolver (not a TODO, real bounded loop with{" "}
            <code>MAX_WORKER_TURNS=3</code>)
          </li>
          <li>
            5 runtime lanes share one emitter: simple_chain ·
            tool_first_chain · orchestrator_worker · openai_agents_sdk ·
            langgraph_python — every emitted <code>.py</code>{" "}
            <code>ast.parse</code>-valid
          </li>
          <li>
            39 emitter + resolver tests pass against the updated pipeline
          </li>
        </ul>
      </div>

      {/* Loop C proof — corpus-level compile (both directions) + live replay + SDK matrix */}
      <div
        style={{
          marginTop: 0,
          marginBottom: 18,
          padding: "14px 16px",
          background: "rgba(217,119,87,0.05)",
          border: "1px solid rgba(217,119,87,0.3)",
          borderRadius: 10,
        }}
      >
        <div
          style={{
            fontSize: 10,
            letterSpacing: "0.22em",
            textTransform: "uppercase",
            color: "#d97757",
            marginBottom: 6,
          }}
        >
          Proof · Loop C · corpus of real traces · both directions · live replay
        </div>
        <div
          style={{
            fontSize: 13,
            color: "rgba(255,255,255,0.85)",
            lineHeight: 1.5,
            marginBottom: 10,
          }}
        >
          The product is bidirectional: compile-DOWN extracts a shared
          playbook from many traces, compile-UP adds structure a sparse
          trace was missing. Both land in the same{" "}
          <code>WorkflowSpec</code> and we measure fidelity live against
          a Pro baseline.
        </div>

        {/* Compile-DOWN numbers (corpus level) */}
        <div
          style={{
            fontSize: 10,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color: "rgba(255,255,255,0.5)",
            marginBottom: 6,
          }}
        >
          Compile-down · corpus
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
            gap: 8,
            marginBottom: 12,
            fontFamily: "'JetBrains Mono', monospace",
          }}
        >
          <Metric label="sessions clustered" value="15" />
          <Metric label="clusters formed" value="12" />
          <Metric label="playbooks induced (coherent)" value="2 / 2" accent="#22c55e" />
          <Metric label="meta-phases distilled" value="455" />
          <Metric
            label="phases w/ ≥3/4 playbook slots"
            value="78.9%"
            accent="#22c55e"
          />
          <Metric label="bytes ingested (largest 5)" value="149 MB" />
        </div>

        {/* Compile-UP numbers (structural) */}
        <div
          style={{
            fontSize: 10,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color: "rgba(255,255,255,0.5)",
            marginBottom: 6,
          }}
        >
          Compile-up · structure added
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
            gap: 8,
            marginBottom: 12,
            fontFamily: "'JetBrains Mono', monospace",
          }}
        >
          <Metric label="runtime lanes" value="5" />
          <Metric label="AST-valid (lane × session)" value="25 / 25" accent="#22c55e" />
          <Metric label="orchestrator plan/dispatch/compact" value="100%" accent="#22c55e" />
          <Metric label="structural fidelity" value="100%" accent="#22c55e" />
        </div>

        {/* Live replay verdict */}
        <div
          style={{
            fontSize: 10,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color: "rgba(255,255,255,0.5)",
            marginBottom: 6,
          }}
        >
          Live replay · Flash Lite vs Pro-judged baseline · $0.054 total · slot-contract + JSON-mode rubric
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
            gap: 8,
            marginBottom: 10,
            fontFamily: "'JetBrains Mono', monospace",
          }}
        >
          <Metric label="sessions replayed live" value="3" />
          <Metric label="transfers" value="0" accent="#ef4444" />
          <Metric label="lossy" value="0" />
          <Metric label="regression" value="3" accent="#ef4444" />
          <Metric label="insufficient_data" value="0" />
          <Metric label="transfer rate" value="0 / 3" accent="#ef4444" />
        </div>

        {/* Boolean rubric — per-check pass rates
            (LLM judges the 6 bools, verdict rollup is deterministic) */}
        <div
          style={{
            fontSize: 10,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color: "rgba(255,255,255,0.5)",
            marginBottom: 6,
            marginTop: 6,
          }}
        >
          Boolean rubric · per-check pass rate · verdict is deterministic
        </div>
        <table
          style={{
            width: "100%",
            fontSize: 11,
            fontFamily: "'JetBrains Mono', monospace",
            color: "rgba(255,255,255,0.8)",
            borderCollapse: "collapse",
            marginBottom: 12,
          }}
        >
          <thead>
            <tr
              style={{
                color: "rgba(255,255,255,0.45)",
                fontSize: 10,
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                textAlign: "left",
              }}
            >
              <th style={{ padding: "4px 8px", fontWeight: 500 }}>Check</th>
              <th style={{ padding: "4px 8px", fontWeight: 500 }}>Pass rate</th>
              <th style={{ padding: "4px 8px", fontWeight: 500 }}>Reads as</th>
            </tr>
          </thead>
          <tbody>
            <tr style={{ borderTop: "1px solid rgba(255,255,255,0.08)" }}>
              <td style={{ padding: "4px 8px" }}>baseline_is_substantive</td>
              <td style={{ padding: "4px 8px", color: "#22c55e" }}>3 / 3 · 100%</td>
              <td style={{ padding: "4px 8px", color: "rgba(255,255,255,0.55)" }}>
                originals are real
              </td>
            </tr>
            <tr style={{ borderTop: "1px solid rgba(255,255,255,0.08)" }}>
              <td style={{ padding: "4px 8px" }}>structural_coherence</td>
              <td style={{ padding: "4px 8px", color: "#22c55e" }}>3 / 3 · 100%</td>
              <td style={{ padding: "4px 8px", color: "rgba(255,255,255,0.55)" }}>
                answer-shaped output
              </td>
            </tr>
            <tr style={{ borderTop: "1px solid rgba(255,255,255,0.08)" }}>
              <td style={{ padding: "4px 8px" }}>addresses_user_prompt</td>
              <td style={{ padding: "4px 8px", color: "#f59e0b" }}>1 / 3 · 33%</td>
              <td style={{ padding: "4px 8px", color: "rgba(255,255,255,0.55)" }}>
                replay drifts off-topic
              </td>
            </tr>
            <tr style={{ borderTop: "1px solid rgba(255,255,255,0.08)" }}>
              <td style={{ padding: "4px 8px" }}>no_hallucination</td>
              <td style={{ padding: "4px 8px", color: "#ef4444" }}>0 / 3 · 0%</td>
              <td style={{ padding: "4px 8px", color: "rgba(255,255,255,0.55)" }}>
                replay fabricates specifics
              </td>
            </tr>
            <tr style={{ borderTop: "1px solid rgba(255,255,255,0.08)" }}>
              <td style={{ padding: "4px 8px" }}>covers_main_points</td>
              <td style={{ padding: "4px 8px", color: "#ef4444" }}>0 / 3 · 0%</td>
              <td style={{ padding: "4px 8px", color: "rgba(255,255,255,0.55)" }}>
                misses load-bearing sections
              </td>
            </tr>
            <tr style={{ borderTop: "1px solid rgba(255,255,255,0.08)" }}>
              <td style={{ padding: "4px 8px" }}>reproduces_specific_artifacts</td>
              <td style={{ padding: "4px 8px", color: "#ef4444" }}>0 / 3 · 0%</td>
              <td style={{ padding: "4px 8px", color: "rgba(255,255,255,0.55)" }}>
                substitutes generic plans
              </td>
            </tr>
          </tbody>
        </table>

        <p
          style={{
            fontSize: 11.5,
            color: "rgba(255,255,255,0.7)",
            lineHeight: 1.55,
            margin: "0 0 12px",
            padding: "8px 12px",
            background: "rgba(239,68,68,0.06)",
            border: "1px solid rgba(239,68,68,0.25)",
            borderRadius: 8,
          }}
        >
          <strong style={{ color: "rgba(255,255,255,0.9)" }}>
            Honest replay verdict:
          </strong>{" "}
          zero transfers on three held-out Claude Code sessions,
          verdict derived deterministically from the 6-boolean rubric
          above (no single-enum judge call). The rubric now runs with
          a <strong>slot contract</strong> per phase — filenames,
          counts, status lines, section headers the original actually
          emitted. Flash Lite is told: emit the concrete value{" "}
          <em style={{ color: "rgba(255,255,255,0.85)", fontStyle: "normal" }}>
            or
          </em>{" "}
          write <code>insufficient_data:&lt;kind&gt;</code>. The
          rubric judge is constrained to{" "}
          <code>responseMimeType=application/json</code> so no output
          truncates mid-rubric.
        </p>
        <p
          style={{
            fontSize: 11.5,
            color: "rgba(255,255,255,0.7)",
            lineHeight: 1.55,
            margin: "0 0 12px",
            padding: "8px 12px",
            background: "rgba(239,68,68,0.06)",
            border: "1px solid rgba(239,68,68,0.25)",
            borderRadius: 8,
          }}
        >
          <strong style={{ color: "rgba(255,255,255,0.9)" }}>
            The boundary the rubric exposes:
          </strong>{" "}
          on specifics-heavy developer work (my own Claude Code
          sessions — exact file names, build counts, status lines),
          Flash Lite <em style={{ color: "rgba(255,255,255,0.85)", fontStyle: "normal" }}>still</em>{" "}
          fabricates despite the contract.{" "}
          <em style={{ color: "#d97757", fontStyle: "normal" }}>
            This is the &ldquo;know when you can&rsquo;t&rdquo; half
            of the product working.
          </em>{" "}
          The rubric tells us <em style={{ color: "rgba(255,255,255,0.85)", fontStyle: "normal" }}>why</em> per check (reasons cite
          &ldquo;16/16 field count&rdquo;, &ldquo;specific file names
          like ArtifactPacketPanel.tsx&rdquo; — not vague &ldquo;it
          missed things&rdquo;). Flash + Pro live cost total this
          cycle: <code>$0.054</code>. Next mitigation would be
          connector-grounded specifics: feed the cheap runtime the
          real tool outputs, not just the playbook prose.
        </p>

        {/* SDK matrix */}
        <div
          style={{
            fontSize: 10,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color: "rgba(255,255,255,0.5)",
            marginBottom: 6,
          }}
        >
          SDK matrix · ingress + egress substrate
        </div>
        <table
          style={{
            width: "100%",
            fontSize: 11.5,
            fontFamily: "'JetBrains Mono', monospace",
            color: "rgba(255,255,255,0.8)",
            borderCollapse: "collapse",
            marginBottom: 12,
          }}
        >
          <thead>
            <tr
              style={{
                color: "rgba(255,255,255,0.45)",
                fontSize: 10,
                letterSpacing: "0.12em",
                textTransform: "uppercase",
                textAlign: "left",
              }}
            >
              <th style={{ padding: "6px 8px", fontWeight: 500 }}>SDK</th>
              <th style={{ padding: "6px 8px", fontWeight: 500 }}>Ingest</th>
              <th style={{ padding: "6px 8px", fontWeight: 500 }}>Emit</th>
              <th style={{ padding: "6px 8px", fontWeight: 500 }}>Scenario tests</th>
            </tr>
          </thead>
          <tbody>
            <tr style={{ borderTop: "1px solid rgba(255,255,255,0.08)" }}>
              <td style={{ padding: "6px 8px", color: "rgba(255,255,255,0.9)" }}>Anthropic Claude Code</td>
              <td style={{ padding: "6px 8px", color: "#22c55e" }}>✓ JSONL</td>
              <td style={{ padding: "6px 8px" }}>simple_chain</td>
              <td style={{ padding: "6px 8px" }}>—</td>
            </tr>
            <tr style={{ borderTop: "1px solid rgba(255,255,255,0.08)" }}>
              <td style={{ padding: "6px 8px", color: "rgba(255,255,255,0.9)" }}>OpenAI Agents SDK</td>
              <td style={{ padding: "6px 8px", color: "#22c55e" }}>✓ chat + runs</td>
              <td style={{ padding: "6px 8px", color: "#22c55e" }}>✓ openai_agents_sdk</td>
              <td style={{ padding: "6px 8px", color: "#22c55e" }}>5 / 5</td>
            </tr>
            <tr style={{ borderTop: "1px solid rgba(255,255,255,0.08)" }}>
              <td style={{ padding: "6px 8px", color: "rgba(255,255,255,0.9)" }}>Google Gemini</td>
              <td style={{ padding: "6px 8px", color: "#22c55e" }}>✓ generateContent</td>
              <td style={{ padding: "6px 8px", color: "#22c55e" }}>✓ default runtime</td>
              <td style={{ padding: "6px 8px", color: "#22c55e" }}>4 / 4</td>
            </tr>
            <tr style={{ borderTop: "1px solid rgba(255,255,255,0.08)" }}>
              <td style={{ padding: "6px 8px", color: "rgba(255,255,255,0.9)" }}>LangGraph</td>
              <td style={{ padding: "6px 8px", color: "#22c55e" }}>✓ graph import</td>
              <td style={{ padding: "6px 8px", color: "#22c55e" }}>✓ langgraph_python</td>
              <td style={{ padding: "6px 8px" }}>symmetric</td>
            </tr>
            <tr style={{ borderTop: "1px solid rgba(255,255,255,0.08)" }}>
              <td style={{ padding: "6px 8px", color: "rgba(255,255,255,0.9)" }}>LangChain callbacks</td>
              <td style={{ padding: "6px 8px", color: "#22c55e" }}>✓ BaseCallbackHandler</td>
              <td style={{ padding: "6px 8px" }}>via LangGraph</td>
              <td style={{ padding: "6px 8px", color: "#22c55e" }}>3 / 3</td>
            </tr>
          </tbody>
        </table>

        {/* Inline example phase — from session 30393b87, phase 2 */}
        <div
          style={{
            padding: "10px 12px",
            background: "rgba(0,0,0,0.30)",
            border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: 8,
            fontSize: 11.5,
            marginBottom: 10,
          }}
        >
          <div
            style={{
              fontSize: 10,
              letterSpacing: "0.15em",
              textTransform: "uppercase",
              color: "rgba(255,255,255,0.5)",
              marginBottom: 6,
            }}
          >
            Example · session <code>30393b87</code> · phase 2 of 23
          </div>
          <div
            style={{
              fontFamily: "'JetBrains Mono', monospace",
              color: "rgba(255,255,255,0.9)",
              fontSize: 11.5,
              lineHeight: 1.55,
            }}
          >
            <div>
              <span style={{ color: "#d97757" }}>trigger</span>{" "}
              <span style={{ color: "rgba(255,255,255,0.55)" }}>(user):</span>{" "}
              &quot;NodeBench Master Strategy &amp; PRD — NodeBench should be
              built as a local-first, multi-entity operating-memory and
              context substrate…&quot;
            </div>
            <div style={{ marginTop: 4 }}>
              <span style={{ color: "#d97757" }}>intent</span>
              <span style={{ color: "rgba(255,255,255,0.55)" }}>:</span>{" "}
              Now saving the full expanded PRD.
            </div>
            <div style={{ marginTop: 4 }}>
              <span style={{ color: "#d97757" }}>tool classes</span>
              <span style={{ color: "rgba(255,255,255,0.55)" }}>:</span>{" "}
              edit, read, search, shell, write
            </div>
            <div style={{ marginTop: 4 }}>
              <span style={{ color: "#d97757" }}>tools</span>
              <span style={{ color: "rgba(255,255,255,0.55)" }}>:</span> Read ·
              ToolSearch · TodoWrite · Write
            </div>
            <div style={{ marginTop: 4 }}>
              <span style={{ color: "#d97757" }}>step span</span>
              <span style={{ color: "rgba(255,255,255,0.55)" }}>:</span> 118
              raw trace steps collapse to one readable meta-phase
            </div>
          </div>
        </div>

        <p
          style={{
            fontSize: 11,
            color: "rgba(255,255,255,0.55)",
            lineHeight: 1.55,
            margin: "0",
          }}
        >
          <strong style={{ color: "rgba(255,255,255,0.8)" }}>
            Complex → simple:
          </strong>{" "}
          the 81 MB / 9,587-step marathon collapsed to{" "}
          <strong style={{ color: "rgba(255,255,255,0.9)" }}>
            226 meta-phases
          </strong>
          , 102 angles extracted, 58 unique tools captured — every emitted{" "}
          <code>.py</code> parses across 5 runtime lanes.{" "}
          <strong style={{ color: "rgba(255,255,255,0.8)" }}>
            Simple → complex:
          </strong>{" "}
          the 3.7 KB / 2-step trivial session still emits a full
          orchestrator_worker scaffold (plan → dispatch → compact) that
          degenerates gracefully. Structural + intent captured; behavioral
          equivalence on rerun is the next loop.
        </p>
      </div>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", fontSize: 11 }}>
        <Link
          to="/_internal/fidelity"
          style={{
            color: "#d97757",
            textDecoration: "none",
            padding: "4px 0",
          }}
        >
          Raw verdict rows →
        </Link>
        <a
          href="https://joyous-walrus-428.convex.site/health"
          target="_blank"
          rel="noopener noreferrer"
          style={{
            color: "rgba(255,255,255,0.55)",
            textDecoration: "none",
          }}
        >
          Live /health
        </a>
        <Link
          to="/radar"
          style={{
            color: "rgba(255,255,255,0.55)",
            textDecoration: "none",
          }}
        >
          Radar ingest health
        </Link>
        <a
          href="https://github.com/HomenShum/attrition"
          target="_blank"
          rel="noopener noreferrer"
          style={{
            color: "rgba(255,255,255,0.55)",
            textDecoration: "none",
          }}
        >
          Reproduce on GitHub
        </a>
      </div>
    </section>
  );
}

function StatBar({ stat }: { stat: Stat }) {
  // Scale so 0-100% maps to 0-100% of bar width; CI band centered on rate
  const leftPct = stat.ciLo;
  const widthPct = Math.max(0.5, stat.ciHi - stat.ciLo);
  const markerLeftPct = stat.rate;
  return (
    <div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          marginBottom: 4,
          fontSize: 12,
        }}
      >
        <span style={{ color: "rgba(255,255,255,0.9)", fontWeight: 500 }}>
          {stat.label}
          <span
            style={{
              color: "rgba(255,255,255,0.45)",
              fontWeight: 400,
              marginLeft: 6,
            }}
          >
            · {stat.sub}
          </span>
        </span>
        <span
          style={{
            color: stat.accent,
            fontVariantNumeric: "tabular-nums",
            fontWeight: 600,
          }}
        >
          {stat.rate.toFixed(1)}%
        </span>
      </div>
      <div
        style={{
          position: "relative",
          height: 16,
          background: "rgba(255,255,255,0.04)",
          borderRadius: 4,
          overflow: "hidden",
        }}
        role="img"
        aria-label={`${stat.label}: ${stat.rate}% with 95% CI ${stat.ciLo}% to ${stat.ciHi}%`}
      >
        {/* CI band */}
        <div
          style={{
            position: "absolute",
            left: `${leftPct}%`,
            width: `${widthPct}%`,
            top: 0,
            bottom: 0,
            background: `${stat.accent}33`,
            borderLeft: `1px solid ${stat.accent}66`,
            borderRight: `1px solid ${stat.accent}66`,
          }}
        />
        {/* Point estimate */}
        <div
          style={{
            position: "absolute",
            left: `calc(${markerLeftPct}% - 2px)`,
            top: 0,
            bottom: 0,
            width: 4,
            background: stat.accent,
          }}
        />
        {/* CI text */}
        <div
          style={{
            position: "absolute",
            right: 8,
            top: 2,
            fontSize: 10,
            color: "rgba(255,255,255,0.5)",
            fontVariantNumeric: "tabular-nums",
            pointerEvents: "none",
          }}
        >
          CI [{stat.ciLo.toFixed(1)}, {stat.ciHi.toFixed(1)}]
        </div>
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: string;
}) {
  const color = accent || "rgba(255,255,255,0.9)";
  return (
    <div
      style={{
        padding: "6px 8px",
        background: "rgba(0,0,0,0.25)",
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: 6,
      }}
    >
      <div
        style={{
          fontSize: 9,
          color: "rgba(255,255,255,0.45)",
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          marginBottom: 2,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 13,
          fontWeight: 600,
          color,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {value}
      </div>
    </div>
  );
}

function Callout({
  tone,
  label,
  value,
  ci,
  note,
}: {
  tone: "red" | "green" | "neutral";
  label: string;
  value: string;
  ci: string;
  note: string;
}) {
  const color =
    tone === "red" ? "#ef4444" : tone === "green" ? "#22c55e" : "#94a3b8";
  return (
    <div
      style={{
        padding: 12,
        background: `${color}10`,
        border: `1px solid ${color}40`,
        borderRadius: 8,
      }}
    >
      <div
        style={{
          fontSize: 10,
          letterSpacing: "0.15em",
          textTransform: "uppercase",
          color: color,
          marginBottom: 4,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 20,
          fontWeight: 600,
          color: "rgba(255,255,255,0.95)",
          fontVariantNumeric: "tabular-nums",
          letterSpacing: "-0.01em",
          marginBottom: 2,
        }}
      >
        {value}
      </div>
      <div
        style={{
          fontSize: 10,
          color: "rgba(255,255,255,0.45)",
          fontVariantNumeric: "tabular-nums",
          marginBottom: 2,
        }}
      >
        {ci}
      </div>
      <div style={{ fontSize: 11, color: "rgba(255,255,255,0.65)" }}>
        {note}
      </div>
    </div>
  );
}
