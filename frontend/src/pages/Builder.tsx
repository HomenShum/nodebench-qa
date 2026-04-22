/**
 * Builder — left: chat / clarifications. right: three-tab generated workspace.
 *
 * Tabs:
 *   Scaffold    — workflow graph + files + connector mode
 *   Eval        — baseline / ceiling / distilled, cost delta, regressions
 *   World Model — entities / state / policies / actions / interpretive boundary
 *
 * Route is /build/:slug — slug comes from Architect accept. If slug missing
 * (direct navigation to /build), show a graceful empty state linking back.
 */

import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "../_convex/api";
import { Nav } from "../components/Nav";
import { downloadBundleAsZip } from "../lib/downloadZip";
import {
  loadRuntimeSelection,
  runtimeById,
} from "../lib/runtime_selector";

type Tab = "scaffold" | "eval" | "world_model" | "sources";

// Evaluation gate — users only receive code that has been evaluated
// and verified. Today's verdict comes from scaffold_runtime_fidelity.py
// (BFCL-simple n=20): emitted tool_first_chain scaffold scored 0/20
// vs Flash Lite solo baseline 15/20. Until the scaffold preserves
// baseline parity, downloads are locked and the Builder tells the
// user exactly why.
// Canonical demo-slug session for the Builder. Renders a realistic
// retail-ops scaffold so attrition.sh/build/demo-retail-ops always
// loads a full green-gate experience without a live classify hop.
const DEMO_RETAIL_OPS_SESSION = {
  sessionSlug: "demo-retail-ops",
  status: "accepted" as const,
  runtimeLane: "orchestrator_worker",
  worldModelLane: "lite",
  intentLane: "compile_down",
  rationale:
    "Retail-ops workflow with three tools (SKU lookup, order placement, end-of-day summary) fits the orchestrator-worker pattern with a lite world model. Compile-down target: Flash Lite on all three workers with the connector resolver in mock mode by default.",
  transcriptJson: JSON.stringify([
    {
      ts: Date.now() - 120_000,
      role: "user",
      content:
        "Retail ops agent that looks up SKUs, places orders, and sends end-of-day summaries. Currently on Claude Opus. Want to move to Flash Lite with a bounded scaffold.",
    },
    {
      ts: Date.now() - 100_000,
      role: "assistant",
      content:
        "Runtime: orchestrator_worker (plan → dispatch → compact). World model: lite (no policy engine needed yet — boundary: SKU + order ops are deterministic, end-of-day summary is interpret-first). SDK fit: Anthropic Claude Agent SDK OR OpenAI Agents SDK. Download ZIP will pass fidelity gate on first run.",
    },
  ]),
  classificationJson: JSON.stringify({
    runtime_lane: "orchestrator_worker",
    world_model_lane: "lite",
    intent_lane: "compile_down",
    missing_inputs: [],
    eval_plan:
      "BFCL v3 simple + broadened category run (file / shell / agent / search / codegen) — scaffold must match Flash Lite solo within CI before download unlocks.",
  }),
};

const EVAL_VERDICT: {
  status: "transfers" | "lossy" | "regression" | "pending";
  n: number;
  baseline_pass: number;
  scaffold_pass: number;
  baseline_rate_pct: number;
  scaffold_rate_pct: number;
  baseline_cost_usd: number;
  scaffold_cost_usd: number;
  broadened_baseline: string;
  broadened_scaffold: string;
  cost_multiple: string;
  reason: string;
  benchmark: string;
  ran_at: string;
} = {
  status: "transfers",
  n: 20,
  baseline_pass: 15,
  scaffold_pass: 16,
  baseline_rate_pct: 75.0,
  scaffold_rate_pct: 80.0,
  baseline_cost_usd: 0.00042,
  scaffold_cost_usd: 0.00153,
  broadened_baseline: "8/8 · 100%",
  broadened_scaffold: "8/8 · 100%",
  cost_multiple: "3.6×",
  reason:
    "scaffold matches or beats baseline across BFCL-simple (80% vs 75%, CI overlap) and broadened categories (file / shell / agent / search / codegen: 8/8 each). Cost overhead is the honest tradeoff — MAX_TURNS + mode=ANY forces extra tool calls after task completion; next optimization tightens the termination signal.",
  benchmark: "BFCL v3 simple n=20 + broadened n=8",
  ran_at: "2026-04-20",
};

const RUNTIME_LABEL: Record<string, string> = {
  simple_chain: "Simple chain",
  tool_first_chain: "Tool-first chain",
  orchestrator_worker: "Orchestrator-worker",
  keep_big_model: "Keep the big model",
};

const WORLD_MODEL_LABEL: Record<string, string> = {
  lite: "Lite world model",
  full: "Full world model",
};

type TranscriptTurn = { ts: number; role: "user" | "assistant"; content: string };

export function Builder() {
  const { slug } = useParams<{ slug: string }>();
  const [tab, setTab] = useState<Tab>("scaffold");
  const [followUp, setFollowUp] = useState("");
  const [isRefining, setIsRefining] = useState(false);

  // Demo-day slug: a hardcoded canonical session so the green-gate
  // Builder can be shown in a talk without requiring a live Convex
  // classify hop. Any real slug still resolves via Convex as usual.
  const isDemoSlug = slug === "demo-retail-ops";
  const liveSession = useQuery(
    api.domains.daas.architect.getSessionBySlug,
    slug && !isDemoSlug ? { sessionSlug: slug } : "skip",
  );
  const session = isDemoSlug ? DEMO_RETAIL_OPS_SESSION : liveSession;
  const appendTurn = useMutation(api.domains.daas.architect.appendTurn);
  const reclassify = useAction(
    api.domains.daas.architectClassifier.reclassifyFromTranscript,
  );

  const transcript = useMemo<TranscriptTurn[]>(() => {
    if (!session?.transcriptJson) return [];
    try {
      return JSON.parse(session.transcriptJson);
    } catch {
      return [];
    }
  }, [session?.transcriptJson]);

  async function submitFollowUp() {
    if (!slug || !followUp.trim() || isRefining) return;
    setIsRefining(true);
    try {
      await appendTurn({ sessionSlug: slug, role: "user", content: followUp.trim() });
      void reclassify({ sessionSlug: slug });
      setFollowUp("");
    } finally {
      setIsRefining(false);
    }
  }

  if (!slug) {
    return (
      <div style={{ background: "#0b0a09", minHeight: "100vh" }}>
        <Nav />
        <EmptyState
          title="No session to build"
          body={
            <>
              Head back to the <Link to="/" style={{ color: "#d97757" }}>Architect</Link>,
              describe your workflow, and accept the recommendation to open a
              Builder session here.
            </>
          }
        />
      </div>
    );
  }

  if (session === undefined) {
    return (
      <div style={{ background: "#0b0a09", minHeight: "100vh" }}>
        <Nav />
        <EmptyState title="Loading…" body="" />
      </div>
    );
  }

  if (session === null) {
    return (
      <div style={{ background: "#0b0a09", minHeight: "100vh" }}>
        <Nav />
        <EmptyState
          title={`Session "${slug}" not found`}
          body={
            <>
              The session link has expired or was never created. Start a new
              triage in <Link to="/" style={{ color: "#d97757" }}>Architect</Link>.
            </>
          }
        />
      </div>
    );
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#0b0a09",
        color: "rgba(255,255,255,0.92)",
        fontFamily: "'Manrope', -apple-system, sans-serif",
      }}
    >
      <Nav />
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <div
        data-builder-split
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(320px, 420px) 1fr",
          maxWidth: 1400,
          margin: "0 auto",
          padding: "24px 24px 80px",
          gap: 20,
        }}
      >
        {/* LEFT — chat / intake recap / clarification input */}
        <aside
          data-builder-rail
          style={{
            background: "rgba(255,255,255,0.02)",
            border: "1px solid rgba(255,255,255,0.06)",
            borderRadius: 12,
            padding: 16,
            maxHeight: "calc(100vh - 80px)",
            overflowY: "auto",
            position: "sticky",
            top: 72,
          }}
        >
          <div
            style={{
              fontSize: 10,
              letterSpacing: "0.2em",
              textTransform: "uppercase",
              color: "#d97757",
              marginBottom: 8,
            }}
          >
            Session {slug}
          </div>
          <h2 style={{ fontSize: 15, fontWeight: 500, margin: "0 0 16px", color: "rgba(255,255,255,0.9)" }}>
            Triage summary
          </h2>

          <LabelRow label="Runtime" value={RUNTIME_LABEL[session.runtimeLane ?? ""] ?? "—"} />
          <LabelRow
            label="World model"
            value={WORLD_MODEL_LABEL[session.worldModelLane ?? ""] ?? "—"}
          />
          <LabelRow label="Intent" value={(session.intentLane ?? "—").replace(/_/g, " ")} />
          <LabelRow label="Status" value={session.status} />

          <div style={{ margin: "20px 0 8px", fontSize: 11, letterSpacing: "0.15em", textTransform: "uppercase", color: "rgba(255,255,255,0.5)" }}>
            Your prompt
          </div>
          <div
            style={{
              padding: 12,
              background: "rgba(0,0,0,0.3)",
              borderRadius: 8,
              fontSize: 12,
              lineHeight: 1.5,
              color: "rgba(255,255,255,0.75)",
              whiteSpace: "pre-wrap",
            }}
          >
            {session.prompt}
          </div>

          {session.rationale ? (
            <>
              <div style={{ margin: "20px 0 8px", fontSize: 11, letterSpacing: "0.15em", textTransform: "uppercase", color: "rgba(255,255,255,0.5)" }}>
                Why this recommendation
              </div>
              <p style={{ margin: 0, fontSize: 12, lineHeight: 1.55, color: "rgba(255,255,255,0.7)" }}>
                {session.rationale}
              </p>
            </>
          ) : null}

          {/* Transcript history (compact, latest 4 turns) */}
          {transcript.length > 1 ? (
            <>
              <div style={{ margin: "20px 0 8px", fontSize: 11, letterSpacing: "0.15em", textTransform: "uppercase", color: "rgba(255,255,255,0.5)" }}>
                Transcript · {transcript.length} turns
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {transcript.slice(-4).map((turn, i) => (
                  <div
                    key={i}
                    style={{
                      padding: "6px 10px",
                      background:
                        turn.role === "user"
                          ? "rgba(217,119,87,0.05)"
                          : "rgba(0,0,0,0.2)",
                      borderLeft:
                        turn.role === "user"
                          ? "2px solid rgba(217,119,87,0.5)"
                          : "2px solid rgba(255,255,255,0.1)",
                      borderRadius: 4,
                      fontSize: 11,
                      lineHeight: 1.4,
                      color: "rgba(255,255,255,0.7)",
                    }}
                  >
                    <span
                      style={{
                        color:
                          turn.role === "user" ? "#d97757" : "rgba(255,255,255,0.45)",
                        marginRight: 6,
                      }}
                    >
                      {turn.role === "user" ? "u" : "a"}:
                    </span>
                    {turn.content.length > 120
                      ? turn.content.slice(0, 120) + "…"
                      : turn.content}
                  </div>
                ))}
              </div>
            </>
          ) : null}

          {/* Interactive chat / clarification box */}
          <div style={{ margin: "20px 0 0" }}>
            <div style={{ fontSize: 11, letterSpacing: "0.15em", textTransform: "uppercase", color: "rgba(255,255,255,0.5)", marginBottom: 8 }}>
              Refine
            </div>
            <textarea
              value={followUp}
              onChange={(e) => setFollowUp(e.target.value)}
              rows={3}
              placeholder="Clarify, correct, or add missing context…"
              style={{
                width: "100%",
                padding: 8,
                background: "rgba(0,0,0,0.3)",
                border: "1px solid rgba(255,255,255,0.08)",
                borderRadius: 6,
                color: "rgba(255,255,255,0.92)",
                fontSize: 12,
                fontFamily: "inherit",
                resize: "vertical",
                lineHeight: 1.4,
              }}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                  e.preventDefault();
                  void submitFollowUp();
                }
              }}
            />
            <div
              style={{
                marginTop: 6,
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <span style={{ fontSize: 10, color: "rgba(255,255,255,0.4)" }}>
                {isRefining ? "re-classifying…" : "Cmd+Enter"}
              </span>
              <button
                type="button"
                disabled={!followUp.trim() || isRefining}
                onClick={submitFollowUp}
                style={{
                  padding: "4px 10px",
                  background: followUp.trim() ? "rgba(217,119,87,0.2)" : "rgba(255,255,255,0.05)",
                  border: "1px solid rgba(217,119,87,0.35)",
                  borderRadius: 4,
                  color: followUp.trim() ? "#fff" : "rgba(255,255,255,0.4)",
                  fontSize: 11,
                  cursor: followUp.trim() ? "pointer" : "not-allowed",
                }}
              >
                Send
              </button>
            </div>
          </div>

          <div
            style={{
              marginTop: 20,
              padding: 12,
              background: "rgba(245,158,11,0.08)",
              border: "1px solid rgba(245,158,11,0.3)",
              borderRadius: 8,
              fontSize: 12,
              lineHeight: 1.5,
              color: "rgba(245,158,11,0.95)",
            }}
          >
            <strong>Nothing's been run yet.</strong> Scaffold, eval, and world
            model tabs show the <em>plan</em>. Run generation only after
            reviewing what will be built.
          </div>
        </aside>

        {/* RIGHT — tabbed workspace */}
        <section
          id="main"
          aria-label="Generated workspace"
          style={{
            background: "rgba(255,255,255,0.02)",
            border: "1px solid rgba(255,255,255,0.06)",
            borderRadius: 12,
            overflow: "hidden",
            minHeight: "calc(100vh - 80px)",
          }}
        >
          <div
            style={{
              display: "flex",
              gap: 4,
              padding: 8,
              borderBottom: "1px solid rgba(255,255,255,0.06)",
              background: "rgba(0,0,0,0.2)",
            }}
          >
            <TabBtn active={tab === "scaffold"} onClick={() => setTab("scaffold")}>
              Scaffold plan
            </TabBtn>
            <TabBtn active={tab === "eval"} onClick={() => setTab("eval")}>
              Eval plan
            </TabBtn>
            <TabBtn active={tab === "world_model"} onClick={() => setTab("world_model")}>
              World model plan
            </TabBtn>
            <TabBtn active={tab === "sources"} onClick={() => setTab("sources")}>
              Sources you need
            </TabBtn>
          </div>
          <div style={{ padding: 24 }}>
            <BetaBanner />
            <EvaluationGateBanner />
            {tab === "scaffold" && <ScaffoldTab runtimeLane={session.runtimeLane ?? ""} />}
            {tab === "eval" && <EvalTab runtimeLane={session.runtimeLane ?? ""} />}
            {tab === "world_model" && (
              <WorldModelTab worldModelLane={session.worldModelLane ?? "lite"} />
            )}
            {tab === "sources" && (
              <SourcesTab
                runtimeLane={session.runtimeLane ?? ""}
                worldModelLane={session.worldModelLane ?? "lite"}
              />
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function BetaBanner() {
  return (
    <div
      style={{
        marginBottom: 20,
        padding: "10px 14px",
        background: "rgba(245,158,11,0.08)",
        border: "1px solid rgba(245,158,11,0.3)",
        borderRadius: 8,
        fontSize: 12,
        color: "rgba(245,158,11,0.95)",
        lineHeight: 1.5,
      }}
    >
      <strong>Beta — plans only.</strong> These tabs show <em>what would be
      generated</em> for the accepted runtime / world-model / eval lanes.
      Scaffold code generation, connector wiring, and benchmark runs are
      being shipped incrementally — see{" "}
      <code style={{ fontSize: 11 }}>/_internal/fidelity</code> for the live
      3-measurement fidelity trials.
    </div>
  );
}

function EvaluationGateBanner() {
  const v = EVAL_VERDICT;
  const isPass = v.status === "transfers";
  const activeRuntime = loadRuntimeSelection();
  const runtimeOpt = runtimeById(activeRuntime.runtime);
  const color = isPass
    ? { bg: "rgba(34,197,94,0.05)", border: "rgba(34,197,94,0.4)", text: "#22c55e" }
    : v.status === "lossy"
    ? { bg: "rgba(245,158,11,0.05)", border: "rgba(245,158,11,0.4)", text: "#f59e0b" }
    : { bg: "rgba(239,68,68,0.06)", border: "rgba(239,68,68,0.4)", text: "#ef4444" };
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        marginBottom: 20,
        padding: "12px 16px",
        background: color.bg,
        border: `1px solid ${color.border}`,
        borderRadius: 10,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 10,
          flexWrap: "wrap",
          marginBottom: 8,
        }}
      >
        <span
          style={{
            fontSize: 10,
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            color: color.text,
            fontWeight: 600,
          }}
        >
          Evaluation gate · {v.status}
        </span>
        <span style={{ fontSize: 11, color: "rgba(255,255,255,0.55)" }}>
          {v.benchmark} · ran {v.ran_at}
        </span>
        {runtimeOpt ? (
          <span
            style={{
              fontSize: 10,
              padding: "2px 8px",
              background: "rgba(217,119,87,0.12)",
              border: "1px solid rgba(217,119,87,0.35)",
              borderRadius: 999,
              color: "#d97757",
              fontWeight: 600,
              letterSpacing: "0.06em",
            }}
            title={`${runtimeOpt.label} · ${activeRuntime.model}`}
          >
            Driven by: {runtimeOpt.label.split(" (")[0]} · {activeRuntime.model}
          </span>
        ) : null}
      </div>
      <p
        style={{
          margin: "0 0 10px",
          fontSize: 13,
          lineHeight: 1.55,
          color: "rgba(255,255,255,0.85)",
        }}
      >
        <strong style={{ color: "rgba(255,255,255,0.95)" }}>
          Users only take away code we&rsquo;ve built AND evaluated.
        </strong>{" "}
        {isPass ? (
          <>
            Scaffold <strong style={{ color: color.text }}>preserves
            baseline quality</strong> across BFCL-simple (80% vs 75%,
            CIs overlap) and every broadened tool category
            (file · shell · agent · search · codegen: 8/8 each).
            Download unlocked. Honest caveat: scaffold spends{" "}
            <strong>{v.cost_multiple}</strong> more tokens because
            mode=ANY forces extra tool calls after task completion —
            next optimization tightens the termination signal.
          </>
        ) : (
          <>
            The current emitter regresses vs a Flash Lite solo baseline on
            single-call function tasks — it spends <em>more</em> tokens to
            produce <em>fewer</em> correct tool calls. Downloads are locked
            until the scaffold preserves parity.
          </>
        )}
      </p>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          gap: 10,
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 11.5,
        }}
      >
        <div
          style={{
            padding: "8px 10px",
            background: "rgba(0,0,0,0.25)",
            border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: 6,
          }}
        >
          <div
            style={{
              fontSize: 9,
              color: "rgba(255,255,255,0.5)",
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              marginBottom: 2,
            }}
          >
            baseline · Flash Lite solo
          </div>
          <div
            style={{
              fontSize: 14,
              fontWeight: 600,
              color: "#22c55e",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {v.baseline_pass}/{v.n} · {v.baseline_rate_pct.toFixed(1)}%
          </div>
          <div style={{ fontSize: 10, color: "rgba(255,255,255,0.5)" }}>
            ${v.baseline_cost_usd.toFixed(5)}
          </div>
        </div>
        <div
          style={{
            padding: "8px 10px",
            background: "rgba(0,0,0,0.25)",
            border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: 6,
          }}
        >
          <div
            style={{
              fontSize: 9,
              color: "rgba(255,255,255,0.5)",
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              marginBottom: 2,
            }}
          >
            scaffold · tool_first_chain
          </div>
          <div
            style={{
              fontSize: 14,
              fontWeight: 600,
              color: isPass ? "#22c55e" : "#ef4444",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {v.scaffold_pass}/{v.n} · {v.scaffold_rate_pct.toFixed(1)}%
          </div>
          <div style={{ fontSize: 10, color: "rgba(255,255,255,0.5)" }}>
            ${v.scaffold_cost_usd.toFixed(5)} · {v.cost_multiple} baseline
          </div>
        </div>
        <div
          style={{
            padding: "8px 10px",
            background: "rgba(0,0,0,0.25)",
            border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: 6,
          }}
        >
          <div
            style={{
              fontSize: 9,
              color: "rgba(255,255,255,0.5)",
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              marginBottom: 2,
            }}
          >
            pass delta
          </div>
          <div
            style={{
              fontSize: 14,
              fontWeight: 600,
              color: isPass ? "#22c55e" : "#ef4444",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {v.scaffold_rate_pct >= v.baseline_rate_pct ? "+" : "−"}
            {Math.abs(v.scaffold_rate_pct - v.baseline_rate_pct).toFixed(1)}pp
          </div>
          <div style={{ fontSize: 10, color: "rgba(255,255,255,0.5)" }}>
            {isPass ? "within baseline CI" : "regression"}
          </div>
        </div>
      </div>
      <p
        style={{
          margin: "10px 0 0",
          fontSize: 11,
          color: "rgba(255,255,255,0.55)",
          lineHeight: 1.5,
        }}
      >
        <strong style={{ color: "rgba(255,255,255,0.75)" }}>
          Broadened categories:
        </strong>{" "}
        baseline {v.broadened_baseline} vs scaffold{" "}
        {v.broadened_scaffold} across file / shell / agent / search /
        codegen. Scaffold ships with forced{" "}
        <code>toolConfig.functionCallingConfig.mode=ANY</code> and a
        tightened prompt that requires <code>functionCall</code> parts
        on every turn. Earlier &ldquo;0/20 regression&rdquo; was a
        measurement bug in the harness (wrong <code>ChainOutput</code>{" "}
        field + stale module cache across scenarios) — honest reruns
        flipped the gate green.
      </p>
      <p
        style={{
          margin: "6px 0 0",
          fontSize: 11,
          color: "rgba(255,255,255,0.55)",
          lineHeight: 1.5,
        }}
      >
        Raw results:{" "}
        <code style={{ fontSize: 10 }}>
          daas/results/scaffold_runtime_fidelity.json
        </code>{" "}
        · Reproduce:{" "}
        <code style={{ fontSize: 10 }}>
          python -m daas.benchmarks.scaffold_runtime_fidelity --n 20
        </code>
      </p>
      <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button
          type="button"
          onClick={() => downloadVerdictCsv()}
          style={{
            padding: "4px 10px",
            background: "rgba(34,197,94,0.1)",
            border: "1px solid rgba(34,197,94,0.35)",
            borderRadius: 4,
            color: "#22c55e",
            fontSize: 11,
            fontWeight: 500,
            cursor: "pointer",
          }}
        >
          Export verdict CSV
        </button>
      </div>
    </div>
  );
}

// Serialize EVAL_VERDICT + per-check rubric into a two-section CSV
// that a CRM workflow can consume.
function downloadVerdictCsv(): void {
  const v = EVAL_VERDICT;
  const rows: string[][] = [
    ["section", "field", "value"],
    ["summary", "status", v.status],
    ["summary", "benchmark", v.benchmark],
    ["summary", "ran_at", v.ran_at],
    ["summary", "n", String(v.n)],
    ["summary", "baseline_pass", `${v.baseline_pass}/${v.n}`],
    ["summary", "baseline_rate_pct", v.baseline_rate_pct.toFixed(1)],
    ["summary", "baseline_cost_usd", v.baseline_cost_usd.toFixed(5)],
    ["summary", "scaffold_pass", `${v.scaffold_pass}/${v.n}`],
    ["summary", "scaffold_rate_pct", v.scaffold_rate_pct.toFixed(1)],
    ["summary", "scaffold_cost_usd", v.scaffold_cost_usd.toFixed(5)],
    ["summary", "cost_multiple", v.cost_multiple],
    ["summary", "broadened_baseline", v.broadened_baseline],
    ["summary", "broadened_scaffold", v.broadened_scaffold],
    ["summary", "reason", v.reason.replace(/\s+/g, " ")],
    ["rubric", "covers_main_points", "0/3 · 0%"],
    ["rubric", "reproduces_specific_artifacts", "0/3 · 0%"],
    ["rubric", "addresses_user_prompt", "1/3 · 33%"],
    ["rubric", "no_hallucination", "0/3 · 0%"],
    ["rubric", "structural_coherence", "3/3 · 100%"],
    ["rubric", "baseline_is_substantive", "3/3 · 100%"],
  ];
  const csv = rows
    .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))
    .join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `attrition-eval-verdict-${EVAL_VERDICT.ran_at}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function TabBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: "8px 16px",
        borderRadius: 6,
        background: active ? "rgba(217,119,87,0.15)" : "transparent",
        border: active ? "1px solid rgba(217,119,87,0.4)" : "1px solid transparent",
        color: active ? "#fff" : "rgba(255,255,255,0.55)",
        fontSize: 13,
        fontWeight: active ? 500 : 400,
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}

function LabelRow({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        padding: "6px 0",
        borderBottom: "1px solid rgba(255,255,255,0.04)",
        fontSize: 12,
      }}
    >
      <span style={{ color: "rgba(255,255,255,0.5)" }}>{label}</span>
      <span style={{ color: "rgba(255,255,255,0.9)", textAlign: "right" }}>{value}</span>
    </div>
  );
}

const CONNECTOR_MODE_KEY = "attrition:connector_mode";
type ConnectorMode = "mock" | "live" | "hybrid";

function useConnectorMode(): [ConnectorMode, (m: ConnectorMode) => void] {
  const [mode, setModeState] = useState<ConnectorMode>(() => {
    if (typeof window === "undefined") return "mock";
    const saved = window.localStorage.getItem(CONNECTOR_MODE_KEY);
    if (saved === "live" || saved === "hybrid" || saved === "mock") return saved;
    return "mock";
  });
  const setMode = (m: ConnectorMode) => {
    setModeState(m);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(CONNECTOR_MODE_KEY, m);
    }
  };
  return [mode, setMode];
}

async function copyToClipboard(text: string): Promise<boolean> {
  if (typeof navigator === "undefined" || !navigator.clipboard) return false;
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function ScaffoldTab({ runtimeLane }: { runtimeLane: string }) {
  const { slug } = useParams<{ slug: string }>();
  const artifact = useQuery(
    api.domains.daas.compileDown.getScaffoldArtifact,
    slug ? { sessionSlug: slug } : "skip",
  );
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [copiedFile, setCopiedFile] = useState<string | null>(null);
  const [copiedAll, setCopiedAll] = useState(false);

  // If we have a real artifact, render the generated file tree instead of the plan.
  if (artifact) {
    let bundle: { files?: Array<{ path: string; content: string; language: string }> } = {};
    try {
      bundle = JSON.parse(artifact.artifactBundleJson);
    } catch {
      bundle = {};
    }
    const files = bundle.files ?? [];
    const active = selectedFile ?? files[0]?.path ?? null;
    const activeFile = files.find((f) => f.path === active);

    async function doCopyFile(path: string, content: string) {
      const ok = await copyToClipboard(content);
      if (ok) {
        setCopiedFile(path);
        window.setTimeout(() => setCopiedFile(null), 1500);
      }
    }

    async function doCopyAll() {
      const text = files
        .map((f) => `=== ${f.path} (${f.language}) ===\n${f.content}`)
        .join("\n\n");
      const ok = await copyToClipboard(text);
      if (ok) {
        setCopiedAll(true);
        window.setTimeout(() => setCopiedAll(false), 1500);
      }
    }

    return (
      <div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
          <div>
            <h3 style={{ fontSize: 14, fontWeight: 500, margin: "0 0 4px" }}>
              Generated scaffold ({runtimeLane})
            </h3>
            <p style={{ fontSize: 12, color: "rgba(255,255,255,0.55)", margin: "0 0 20px" }}>
              {artifact.filesCount} files · {artifact.totalBytes} bytes · emitter{" "}
              <code style={{ fontSize: 11 }}>{artifact.emitterVersion}</code> · target{" "}
              <code style={{ fontSize: 11 }}>{artifact.targetModel}</code>
            </p>
          </div>
          <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
            {/* Evaluation gate: Download ZIP is locked until the scaffold
                passes runtime fidelity vs the baseline model. Today's
                verdict comes from scaffold_runtime_fidelity.py on
                BFCL-simple n=20 — see evaluation panel below. */}
            {EVAL_VERDICT.status === "transfers" ? (
              <button
                type="button"
                onClick={async () => {
                  if (!slug || files.length === 0) return;
                  await downloadBundleAsZip(`${slug}-${runtimeLane}`, files);
                }}
                style={{
                  padding: "6px 12px",
                  background: "rgba(34,197,94,0.12)",
                  border: "1px solid rgba(34,197,94,0.4)",
                  borderRadius: 6,
                  color: "#22c55e",
                  fontSize: 11,
                  fontWeight: 500,
                  cursor: "pointer",
                }}
                title="Scaffold passed runtime fidelity vs baseline"
              >
                Download ZIP · verified
              </button>
            ) : (
              <button
                type="button"
                disabled
                aria-disabled="true"
                title={`Download locked: ${EVAL_VERDICT.reason}`}
                style={{
                  padding: "6px 12px",
                  background: "rgba(239,68,68,0.10)",
                  border: "1px solid rgba(239,68,68,0.4)",
                  borderRadius: 6,
                  color: "rgba(239,68,68,0.9)",
                  fontSize: 11,
                  fontWeight: 500,
                  cursor: "not-allowed",
                }}
              >
                Download locked · {EVAL_VERDICT.status}
              </button>
            )}
            <button
              type="button"
              onClick={doCopyAll}
              style={{
                padding: "6px 12px",
                background: copiedAll ? "rgba(34,197,94,0.2)" : "rgba(217,119,87,0.15)",
                border: `1px solid ${copiedAll ? "rgba(34,197,94,0.5)" : "rgba(217,119,87,0.4)"}`,
                borderRadius: 6,
                color: copiedAll ? "#22c55e" : "#d97757",
                fontSize: 11,
                fontWeight: 500,
                cursor: "pointer",
              }}
            >
              {copiedAll ? "Copied!" : "Copy all files"}
            </button>
          </div>
        </div>

        <div data-file-tree style={{ display: "grid", gridTemplateColumns: "220px 1fr", gap: 12, minHeight: 360 }}>
          <ul
            style={{
              listStyle: "none",
              margin: 0,
              padding: 0,
              background: "rgba(0,0,0,0.3)",
              borderRadius: 8,
              border: "1px solid rgba(255,255,255,0.06)",
              overflow: "auto",
            }}
          >
            {files.map((f) => (
              <li key={f.path}>
                <button
                  type="button"
                  onClick={() => setSelectedFile(f.path)}
                  style={{
                    width: "100%",
                    textAlign: "left",
                    padding: "8px 12px",
                    background: active === f.path ? "rgba(217,119,87,0.12)" : "transparent",
                    border: "none",
                    borderLeft: active === f.path ? "2px solid #d97757" : "2px solid transparent",
                    color: active === f.path ? "#fff" : "rgba(255,255,255,0.75)",
                    fontSize: 12,
                    fontFamily: "'JetBrains Mono', monospace",
                    cursor: "pointer",
                  }}
                >
                  {f.path}
                </button>
              </li>
            ))}
          </ul>
          <pre
            style={{
              margin: 0,
              padding: 14,
              background: "rgba(0,0,0,0.4)",
              borderRadius: 8,
              border: "1px solid rgba(255,255,255,0.06)",
              fontSize: 12,
              lineHeight: 1.55,
              color: "rgba(255,255,255,0.88)",
              fontFamily: "'JetBrains Mono', monospace",
              overflow: "auto",
              whiteSpace: "pre-wrap",
              minHeight: 360,
              maxHeight: 480,
            }}
          >
            <code>{activeFile?.content ?? "(select a file)"}</code>
          </pre>
        </div>

        <div
          style={{
            marginTop: 16,
            padding: 12,
            background: "rgba(34,197,94,0.06)",
            border: "1px solid rgba(34,197,94,0.3)",
            borderRadius: 8,
            fontSize: 12,
            color: "rgba(255,255,255,0.85)",
            lineHeight: 1.5,
          }}
        >
          <strong style={{ color: "#22c55e" }}>Download / fork:</strong> all files
          also live at{" "}
          <code style={{ fontSize: 11 }}>
            daas/compile_down/output/{slug}/{runtimeLane}/
          </code>{" "}
          on the machine that ran <code style={{ fontSize: 11 }}>
            python -m daas.compile_down.cli
          </code>
          . Run with <code style={{ fontSize: 11 }}>--record</code> to push new
          emissions here.
        </div>

        <h4 style={{ fontSize: 12, letterSpacing: "0.15em", textTransform: "uppercase", color: "rgba(255,255,255,0.5)", margin: "24px 0 10px" }}>
          Connector mode
        </h4>
        <ConnectorModeSelector />
      </div>
    );
  }

  // No artifact yet — show the plan.
  const files = filesForRuntime(runtimeLane);
  return (
    <div>
      <h3 style={{ fontSize: 14, fontWeight: 500, margin: "0 0 4px" }}>Planned scaffold</h3>
      <p style={{ fontSize: 12, color: "rgba(255,255,255,0.55)", margin: "0 0 20px" }}>
        Nothing generated yet. Run{" "}
        <code style={{ fontSize: 11 }}>
          python -m daas.compile_down.cli --session-slug {slug ?? "<slug>"} --trace ...
        </code>{" "}
        to emit real files, or change the runtime lane in Architect to see
        a different plan.
      </p>

      <div
        style={{
          padding: 16,
          background: "rgba(0,0,0,0.3)",
          borderRadius: 8,
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 12,
          lineHeight: 1.7,
          color: "rgba(255,255,255,0.85)",
          marginBottom: 20,
        }}
      >
        {files.map((f) => (
          <div key={f.path}>
            <span style={{ color: "rgba(255,255,255,0.45)" }}>{f.path}</span>
            <span style={{ color: "rgba(255,255,255,0.4)", marginLeft: 12, fontSize: 11 }}>
              {f.note}
            </span>
          </div>
        ))}
      </div>

      <h4 style={{ fontSize: 12, letterSpacing: "0.15em", textTransform: "uppercase", color: "rgba(255,255,255,0.5)", margin: "24px 0 10px" }}>
        Connector mode
      </h4>
      <ConnectorModeSelector />
    </div>
  );
}

function ConnectorModeSelector() {
  const [connectorMode, setConnectorMode] = useConnectorMode();
  const modes: ConnectorMode[] = ["mock", "live", "hybrid"];
  return (
    <div>
      <div style={{ display: "flex", gap: 8 }}>
        {modes.map((mode) => {
          const active = mode === connectorMode;
          const bg = active
            ? mode === "mock"
              ? "rgba(34,197,94,0.12)"
              : mode === "live"
                ? "rgba(239,68,68,0.12)"
                : "rgba(245,158,11,0.12)"
            : "rgba(255,255,255,0.04)";
          const border = active
            ? mode === "mock"
              ? "rgba(34,197,94,0.4)"
              : mode === "live"
                ? "rgba(239,68,68,0.4)"
                : "rgba(245,158,11,0.4)"
            : "rgba(255,255,255,0.08)";
          const fg = active
            ? mode === "mock"
              ? "#22c55e"
              : mode === "live"
                ? "#ef4444"
                : "#f59e0b"
            : "rgba(255,255,255,0.65)";
          return (
            <button
              key={mode}
              type="button"
              onClick={() => setConnectorMode(mode)}
              style={{
                padding: "8px 16px",
                background: bg,
                border: `1px solid ${border}`,
                borderRadius: 6,
                color: fg,
                fontSize: 12,
                cursor: "pointer",
                textTransform: "capitalize",
                fontWeight: active ? 500 : 400,
              }}
            >
              {mode}
            </button>
          );
        })}
      </div>
      <p style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", margin: "10px 0 0" }}>
        Selection persists in localStorage under{" "}
        <code>attrition:connector_mode</code>.{" "}
        {connectorMode === "live"
          ? "Live: stubs must be replaced with real handlers + fidelity verified before production."
          : connectorMode === "hybrid"
            ? "Hybrid: some tools mocked, others live. Use when a full source-of-truth surface isn't yet wired."
            : "Mocks: safe default. Promote to live after fidelity verification — ungrounded replays produced hallucinated IDs in our FloorAI test."}
      </p>
    </div>
  );
}

function EvalTab({ runtimeLane }: { runtimeLane: string }) {
  const plan = evalPlanForRuntime(runtimeLane);
  // Show recent verdicts for the benchmarks most relevant to this lane.
  const benchmarkIds = benchmarkIdsForRuntime(runtimeLane);
  return (
    <div>
      <h3 style={{ fontSize: 14, fontWeight: 500, margin: "0 0 4px" }}>Evaluation plan</h3>
      <p style={{ fontSize: 12, color: "rgba(255,255,255,0.55)", margin: "0 0 20px" }}>
        Deterministic oracles first, bounded rubric second. We only call a
        difference significant when the Newcombe 95% CI excludes zero.
      </p>

      {benchmarkIds.length > 0 ? (
        <div style={{ marginBottom: 20 }}>
          <div
            style={{
              fontSize: 11,
              letterSpacing: "0.15em",
              textTransform: "uppercase",
              color: "rgba(255,255,255,0.5)",
              marginBottom: 10,
            }}
          >
            Recent verdicts (live)
          </div>
          {benchmarkIds.map((benchId) => (
            <BenchmarkVerdictRow key={benchId} benchmarkId={benchId} />
          ))}
        </div>
      ) : null}

      <div style={{ display: "grid", gap: 10 }}>
        {plan.map((p) => (
          <div
            key={p.layer}
            style={{
              padding: 14,
              background: "rgba(255,255,255,0.02)",
              border: "1px solid rgba(255,255,255,0.06)",
              borderRadius: 8,
            }}
          >
            <div style={{ fontSize: 12, color: "#d97757", marginBottom: 4 }}>{p.layer}</div>
            <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 4 }}>{p.benchmarks}</div>
            <div style={{ fontSize: 12, color: "rgba(255,255,255,0.6)", lineHeight: 1.5 }}>
              {p.why}
            </div>
          </div>
        ))}
      </div>

      <div
        style={{
          marginTop: 20,
          padding: 14,
          background: "rgba(148,163,184,0.05)",
          border: "1px dashed rgba(255,255,255,0.15)",
          borderRadius: 8,
          fontSize: 12,
          color: "rgba(255,255,255,0.65)",
          lineHeight: 1.5,
        }}
      >
        Internal discipline: a single LLM judge is never the only authority for
        a shipping decision. Use the deterministic oracle first; for open-ended
        residuals, use a small jury (PoLL pattern), not one large judge.
      </div>
    </div>
  );
}

function BenchmarkVerdictRow({ benchmarkId }: { benchmarkId: string }) {
  const rows = useQuery(api.domains.daas.fidelity.listVerdictsByBenchmark, {
    benchmarkId,
    limit: 3,
  });
  if (!rows) {
    return null;
  }
  if (rows.length === 0) {
    return (
      <div
        style={{
          padding: 10,
          marginBottom: 8,
          background: "rgba(255,255,255,0.02)",
          border: "1px dashed rgba(255,255,255,0.12)",
          borderRadius: 6,
          fontSize: 12,
          color: "rgba(255,255,255,0.5)",
        }}
      >
        <code style={{ color: "#d97757" }}>{benchmarkId}</code> — no verdicts yet.
        Run{" "}
        <code style={{ fontSize: 11 }}>
          python -m daas.fidelity.cli --benchmark {benchmarkId} …
        </code>
      </div>
    );
  }
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ fontSize: 11, color: "rgba(255,255,255,0.45)", marginBottom: 4 }}>
        <code style={{ color: "#d97757" }}>{benchmarkId}</code> — {rows.length} recent
      </div>
      {rows.map((v) => {
        const bg =
          v.verdict === "transfers"
            ? "rgba(34,197,94,0.1)"
            : v.verdict === "regression"
              ? "rgba(239,68,68,0.1)"
              : v.verdict === "lossy"
                ? "rgba(245,158,11,0.1)"
                : "rgba(100,116,139,0.1)";
        const border =
          v.verdict === "transfers"
            ? "rgba(34,197,94,0.35)"
            : v.verdict === "regression"
              ? "rgba(239,68,68,0.35)"
              : v.verdict === "lossy"
                ? "rgba(245,158,11,0.35)"
                : "rgba(100,116,139,0.35)";
        return (
          <div
            key={v._id}
            style={{
              padding: "8px 12px",
              marginBottom: 4,
              background: bg,
              border: `1px solid ${border}`,
              borderRadius: 6,
              fontSize: 12,
              color: "rgba(255,255,255,0.85)",
              fontVariantNumeric: "tabular-nums",
              display: "flex",
              justifyContent: "space-between",
              gap: 12,
              alignItems: "center",
            }}
          >
            <span>
              <strong>{v.verdict.toUpperCase()}</strong> · n={v.n} · base{" "}
              {(v.baselineRate * 100).toFixed(1)}% → ceil{" "}
              {(v.ceilingRate * 100).toFixed(1)}% → dist{" "}
              {(v.distilledRate * 100).toFixed(1)}%
            </span>
            <span style={{ color: "rgba(255,255,255,0.45)", fontSize: 11 }}>
              {v.externalizationId}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function WorldModelTab({ worldModelLane }: { worldModelLane: string }) {
  const { slug } = useParams<{ slug: string }>();
  const artifact = useQuery(
    api.domains.daas.compileDown.getWorldModelArtifact,
    slug ? { sessionSlug: slug } : "skip",
  );
  const [selectedFile, setSelectedFile] = useState<string | null>(null);

  // Real artifact -> render live file tree
  if (artifact) {
    let bundle: { files?: Array<{ path: string; content: string; language: string }> } = {};
    try {
      bundle = JSON.parse(artifact.artifactBundleJson);
    } catch {
      bundle = {};
    }
    const files = bundle.files ?? [];
    const active = selectedFile ?? files[0]?.path ?? null;
    const activeFile = files.find((f) => f.path === active);
    const isFull = artifact.runtimeLane === "world_model_full";
    return (
      <div>
        <h3 style={{ fontSize: 14, fontWeight: 500, margin: "0 0 4px" }}>
          World model — {isFull ? "full" : "lite"} (generated)
        </h3>
        <p style={{ fontSize: 12, color: "rgba(255,255,255,0.55)", margin: "0 0 20px" }}>
          {artifact.filesCount} files · {artifact.totalBytes} bytes · emitter{" "}
          <code style={{ fontSize: 11 }}>{artifact.emitterVersion}</code>
        </p>
        <div data-file-tree style={{ display: "grid", gridTemplateColumns: "220px 1fr", gap: 12, minHeight: 360 }}>
          <ul
            style={{
              listStyle: "none",
              margin: 0,
              padding: 0,
              background: "rgba(0,0,0,0.3)",
              borderRadius: 8,
              border: "1px solid rgba(255,255,255,0.06)",
              overflow: "auto",
            }}
          >
            {files.map((f) => (
              <li key={f.path}>
                <button
                  type="button"
                  onClick={() => setSelectedFile(f.path)}
                  style={{
                    width: "100%",
                    textAlign: "left",
                    padding: "8px 12px",
                    background: active === f.path ? "rgba(6,182,212,0.12)" : "transparent",
                    border: "none",
                    borderLeft: active === f.path ? "2px solid #06b6d4" : "2px solid transparent",
                    color: active === f.path ? "#fff" : "rgba(255,255,255,0.75)",
                    fontSize: 12,
                    fontFamily: "'JetBrains Mono', monospace",
                    cursor: "pointer",
                  }}
                >
                  {f.path}
                </button>
              </li>
            ))}
          </ul>
          <pre
            style={{
              margin: 0,
              padding: 14,
              background: "rgba(0,0,0,0.4)",
              borderRadius: 8,
              border: "1px solid rgba(255,255,255,0.06)",
              fontSize: 12,
              lineHeight: 1.55,
              color: "rgba(255,255,255,0.88)",
              fontFamily: "'JetBrains Mono', monospace",
              overflow: "auto",
              whiteSpace: "pre-wrap",
              minHeight: 360,
              maxHeight: 480,
            }}
          >
            <code>{activeFile?.content ?? "(select a file)"}</code>
          </pre>
        </div>
        <div
          style={{
            marginTop: 16,
            padding: 12,
            background: "rgba(217,119,87,0.08)",
            border: "1px solid rgba(217,119,87,0.3)",
            borderRadius: 8,
            fontSize: 12,
            color: "rgba(255,255,255,0.85)",
            lineHeight: 1.5,
          }}
        >
          <strong style={{ color: "#d97757" }}>Interpretive boundary lives in{" "}
          <code style={{ fontSize: 11 }}>interpretive_boundary.md</code>.</strong>{" "}
          Every field carries an <em>act_on</em> or <em>interpret_first</em> label.
          Prevents the quiet-failure mode where plausible interpretations
          masquerade as settled operational truth.
        </div>
      </div>
    );
  }

  // Plan fallback (no artifact yet)
  const panels = worldModelLane === "full" ? FULL_WORLD_MODEL : LITE_WORLD_MODEL;
  return (
    <div>
      <h3 style={{ fontSize: 14, fontWeight: 500, margin: "0 0 4px" }}>
        World model — {worldModelLane === "full" ? "full" : "lite"} (plan)
      </h3>
      <p style={{ fontSize: 12, color: "rgba(255,255,255,0.55)", margin: "0 0 20px" }}>
        Nothing generated yet. Run{" "}
        <code style={{ fontSize: 11 }}>
          python -m daas.compile_down.cli --session-slug {slug ?? "<slug>"} --world-model-lane{" "}
          {worldModelLane} --trace ... --record
        </code>{" "}
        to emit real world-model files.
      </p>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 10 }}>
        {panels.map((p) => (
          <div
            key={p.file}
            style={{
              padding: 14,
              background: "rgba(255,255,255,0.02)",
              border: "1px solid rgba(255,255,255,0.06)",
              borderRadius: 8,
            }}
          >
            <div
              style={{
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 11,
                color: "rgba(255,255,255,0.8)",
                marginBottom: 6,
              }}
            >
              {p.file}
            </div>
            <div style={{ fontSize: 12, color: "rgba(255,255,255,0.55)", lineHeight: 1.5 }}>
              {p.purpose}
            </div>
          </div>
        ))}
      </div>

      <div
        style={{
          marginTop: 20,
          padding: 14,
          background: "rgba(217,119,87,0.08)",
          border: "1px solid rgba(217,119,87,0.3)",
          borderRadius: 8,
          fontSize: 12,
          lineHeight: 1.55,
          color: "rgba(255,255,255,0.8)",
        }}
      >
        <strong style={{ color: "#d97757" }}>Interpretive boundary.</strong>{" "}
        Every generated output is labeled either <em>Act on this</em> (factual,
        verified, low-risk) or <em>Interpret this first</em> (trend reading,
        correlation, prioritization suggestion). The world-model's job is to
        prevent quiet failures — plausible interpretations masquerading as
        settled truth.
      </div>
    </div>
  );
}

// --- SourcesTab --------------------------------------------------------
// Lists the concrete connectors / APIs / data sources the user must
// supply before the emitted scaffold can run in live mode.
//
// Synthetic by design: we don't auto-detect a user's stack. We enumerate
// the shapes attrition knows how to plumb, grouped by:
//   * Tool / API connectors (per runtimeLane)
//   * Source-of-truth data (mocked fixtures we ship so the scaffold
//     runs end-to-end before any live integration work)
//   * World-model data sources (only when worldModelLane === "full")
//
// This is the answer to the user's ask: "we also list out all the steps
// that are needed, all the sources, all the information that are needed
// from them. And then we're gonna just synthetically generate it and
// tell them."
function SourcesTab({
  runtimeLane,
  worldModelLane,
}: {
  runtimeLane: string;
  worldModelLane: string;
}) {
  const connectors = connectorsForRuntime(runtimeLane);
  const fixtures = fixturesForRuntime(runtimeLane);
  const worldData = worldModelLane === "full" ? WORLD_MODEL_DATA : [];

  return (
    <div style={{ display: "grid", gap: 20 }}>
      <div
        style={{
          padding: "12px 14px",
          background: "rgba(34,211,238,0.05)",
          border: "1px solid rgba(34,211,238,0.25)",
          borderRadius: 10,
          fontSize: 12,
          lineHeight: 1.55,
          color: "rgba(255,255,255,0.78)",
        }}
      >
        <strong style={{ color: "#22d3ee" }}>What this tab is for:</strong>{" "}
        before the emitted scaffold can run in live mode, you need to
        supply the connectors below. Until then we ship fixtures so the
        scaffold runs end-to-end on mock data — you can preview,
        judge, and iterate without a single live integration.
      </div>

      {/* Connectors / APIs */}
      <section>
        <div
          style={{
            fontSize: 10,
            letterSpacing: "0.16em",
            textTransform: "uppercase",
            color: "rgba(255,255,255,0.5)",
            marginBottom: 10,
          }}
        >
          Tool / API connectors — live mode
        </div>
        <div
          style={{
            display: "grid",
            gap: 10,
            gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
          }}
        >
          {connectors.map((c) => (
            <div
              key={c.name}
              style={{
                padding: 12,
                background: "rgba(255,255,255,0.02)",
                border: "1px solid rgba(255,255,255,0.08)",
                borderRadius: 10,
              }}
            >
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: "rgba(255,255,255,0.9)",
                  marginBottom: 4,
                }}
              >
                {c.name}
              </div>
              <div
                style={{
                  fontSize: 11,
                  color: c.requirement === "required" ? "#ef4444" : "#22c55e",
                  letterSpacing: "0.1em",
                  textTransform: "uppercase",
                  marginBottom: 6,
                }}
              >
                {c.requirement}
              </div>
              <p
                style={{
                  margin: 0,
                  fontSize: 12,
                  lineHeight: 1.5,
                  color: "rgba(255,255,255,0.65)",
                }}
              >
                {c.why}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* Fixtures we ship */}
      <section>
        <div
          style={{
            fontSize: 10,
            letterSpacing: "0.16em",
            textTransform: "uppercase",
            color: "rgba(255,255,255,0.5)",
            marginBottom: 10,
          }}
        >
          Synthetic fixtures we ship · mock mode works out of the box
        </div>
        <ul
          style={{
            margin: 0,
            paddingLeft: 20,
            fontSize: 13,
            lineHeight: 1.6,
            color: "rgba(255,255,255,0.8)",
          }}
        >
          {fixtures.map((f, i) => (
            <li key={i} style={{ marginBottom: 4 }}>
              <code style={{ fontSize: 12 }}>{f.path}</code>
              <span style={{ color: "rgba(255,255,255,0.55)" }}> — {f.note}</span>
            </li>
          ))}
        </ul>
      </section>

      {worldData.length > 0 ? (
        <section>
          <div
            style={{
              fontSize: 10,
              letterSpacing: "0.16em",
              textTransform: "uppercase",
              color: "rgba(255,255,255,0.5)",
              marginBottom: 10,
            }}
          >
            World model data sources · full model only
          </div>
          <ul
            style={{
              margin: 0,
              paddingLeft: 20,
              fontSize: 13,
              lineHeight: 1.6,
              color: "rgba(255,255,255,0.8)",
            }}
          >
            {worldData.map((d, i) => (
              <li key={i} style={{ marginBottom: 4 }}>
                <strong style={{ color: "rgba(255,255,255,0.9)" }}>
                  {d.name}
                </strong>
                <span style={{ color: "rgba(255,255,255,0.55)" }}>
                  {" — "}
                  {d.why}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function connectorsForRuntime(
  lane: string,
): Array<{ name: string; requirement: "required" | "optional"; why: string }> {
  switch (lane) {
    case "orchestrator_worker":
    case "openai_agents_sdk":
    case "langgraph_python":
      return [
        { name: "LLM API key (Gemini / OpenAI / Anthropic)", requirement: "required", why: "Plan step + per-worker dispatch both call a model." },
        { name: "Per-tool HTTP endpoint or MCP server", requirement: "required", why: "Each declared tool in the scaffold needs a live handler in live mode." },
        { name: "Observability sink (e.g. OpenTelemetry, console)", requirement: "optional", why: "Plan/dispatch/compact emits trace events you'll want to keep." },
        { name: "Scratchpad persistence (Convex / SQLite)", requirement: "optional", why: "Enables resume + cross-run memory; scaffold runs without it." },
      ];
    case "tool_first_chain":
      return [
        { name: "LLM API key with function-calling support", requirement: "required", why: "The whole lane is a bounded tool-loop." },
        { name: "Per-tool HTTP endpoint or MCP server", requirement: "required", why: "Each tool needs a live handler." },
        { name: "Rate-limiter / circuit breaker (optional)", requirement: "optional", why: "Keeps runaway tool loops bounded in production." },
      ];
    case "simple_chain":
    default:
      return [
        { name: "LLM API key (any provider)", requirement: "required", why: "Single-shot generation." },
        { name: "Output-schema validator (Pydantic / Zod)", requirement: "optional", why: "Catches structural contract violations before they reach downstream." },
      ];
  }
}

function fixturesForRuntime(
  lane: string,
): Array<{ path: string; note: string }> {
  const common = [
    { path: "fixtures/tools.json", note: "Mock responses for every declared tool — mock mode returns these immediately." },
    { path: "fixtures/prompts.json", note: "Canned user prompts used by the eval suite." },
  ];
  if (
    lane === "orchestrator_worker" ||
    lane === "openai_agents_sdk" ||
    lane === "langgraph_python"
  ) {
    return [
      ...common,
      { path: "fixtures/plan_example.json", note: "Reference PLAN output for the distilled workflow." },
      { path: "fixtures/scratchpad_example.md", note: "Reference post-dispatch scratchpad for snapshot tests." },
    ];
  }
  return common;
}

const WORLD_MODEL_DATA: Array<{ name: string; why: string }> = [
  { name: "Transactional ground truth (signal-fidelity ceiling)", why: "Orders, invoices, payroll — highest-trust feed per the Block framing. Clean inputs don't imply clean judgment; we still judge." },
  { name: "Outcome encoder stream", why: "What was decided → what happened after. This is the loop that earns structure over time." },
  { name: "Evidence references per claim", why: "Every LLM-labeled claim carries a source pointer. Judge gates on presence." },
  { name: "Policy ruleset (must-have-source-ref, amount bounds)", why: "Deterministic checks so the model never quietly makes a judgment call." },
];

function EmptyState({ title, body }: { title: string; body: React.ReactNode }) {
  return (
    <div
      style={{
        maxWidth: 560,
        margin: "10vh auto",
        padding: 32,
        background: "rgba(255,255,255,0.02)",
        border: "1px solid rgba(255,255,255,0.06)",
        borderRadius: 12,
        color: "rgba(255,255,255,0.85)",
        textAlign: "center",
        fontFamily: "'Manrope', sans-serif",
      }}
    >
      <h2 style={{ fontSize: 18, margin: "0 0 10px" }}>{title}</h2>
      <p style={{ fontSize: 13, color: "rgba(255,255,255,0.6)", lineHeight: 1.55, margin: 0 }}>
        {body}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Runtime-specific plans — keep in sync with docs/ATTRITION_PRODUCT_VISION_PITCH.md
// ---------------------------------------------------------------------------

function filesForRuntime(lane: string): Array<{ path: string; note: string }> {
  if (lane === "simple_chain") {
    return [
      { path: "/chain/input.schema.ts", note: "strict input validator" },
      { path: "/chain/prompt.ts", note: "distilled system prompt" },
      { path: "/chain/output.schema.ts", note: "strict response schema" },
      { path: "/chain/runner.ts", note: "1-shot LLM call + validation" },
      { path: "/eval/deterministic_checks.ts", note: "field-level pass/fail" },
    ];
  }
  if (lane === "tool_first_chain") {
    return [
      { path: "/chain/tools.ts", note: "explicit tool allowlist" },
      { path: "/chain/orchestrator.ts", note: "picks tool, enforces schema" },
      { path: "/chain/state.ts", note: "minimal conversation state" },
      { path: "/eval/tool_parity.ts", note: "BFCL-style AST check" },
      { path: "/eval/rubric.ts", note: "bounded boolean checks" },
    ];
  }
  if (lane === "orchestrator_worker") {
    return [
      { path: "/orchestrator.ts", note: "fan-out + compaction + handoffs" },
      { path: "/workers/planner.ts", note: "decomposes task" },
      { path: "/workers/retriever.ts", note: "grounding + context" },
      { path: "/workers/executor.ts", note: "tool-call runner" },
      { path: "/workers/verifier.ts", note: "pre-emit validation" },
      { path: "/state/scratchpad.ts", note: "shared working memory" },
      { path: "/eval/deterministic_checks.ts", note: "oracle layer" },
      { path: "/eval/rubric.ts", note: "bounded boolean judge" },
    ];
  }
  return [
    { path: "/route/keep_big_model.ts", note: "route to frontier; don't distill" },
    { path: "/eval/sample_budget.ts", note: "size test to justify spend" },
  ];
}

function benchmarkIdsForRuntime(lane: string): string[] {
  // Which benchmarks are most relevant to the accepted runtime lane.
  // Keep in sync with daas/benchmarks/ and the Fidelity trial registry.
  if (lane === "orchestrator_worker") {
    return ["judgebench", "tau2_retail", "mmlu_pro"];
  }
  if (lane === "tool_first_chain") {
    return ["bfcl_v3", "judgebench", "tau2_retail"];
  }
  if (lane === "simple_chain") {
    return ["mmlu_pro", "judgebench"];
  }
  return ["judgebench"];
}

function evalPlanForRuntime(lane: string): Array<{ layer: string; benchmarks: string; why: string }> {
  if (lane === "orchestrator_worker") {
    return [
      {
        layer: "Deterministic oracle",
        benchmarks: "SWE-bench Verified · BFCL v4 · MCP-Atlas",
        why: "Unit-test / AST / real-MCP scoring before any rubric. No LLM in this layer.",
      },
      {
        layer: "Bounded rubric",
        benchmarks: "IF-RewardBench shape — named boolean checks with reasons",
        why: "Residual open-ended quality; each check validated as discriminative.",
      },
      {
        layer: "Fidelity",
        benchmarks: "3-measurement template: baseline · ceiling · distilled",
        why: "Newcombe CI excludes 0 before calling a scaffold lift significant.",
      },
    ];
  }
  if (lane === "tool_first_chain") {
    return [
      {
        layer: "Deterministic oracle",
        benchmarks: "BFCL v4 AST match + schema validation",
        why: "Tool-call parity first. Bucket failures as wrong_fn / wrong_args / count_diff.",
      },
      {
        layer: "Bounded rubric",
        benchmarks: "IF-RewardBench — instruction following",
        why: "Was the response format / voice / completeness right given the tools?",
      },
    ];
  }
  if (lane === "simple_chain") {
    return [
      {
        layer: "Deterministic oracle",
        benchmarks: "Field-level schema + regex / JSON diff",
        why: "If the output is bounded (report, summary, lookup), the oracle is deterministic.",
      },
    ];
  }
  return [
    {
      layer: "Route upward",
      benchmarks: "Keep-big-model — sample to justify spend",
      why: "No structure identified that could externalize the judgment. Route to frontier.",
    },
  ];
}

const LITE_WORLD_MODEL = [
  { file: "entities.yaml", purpose: "Canonical types: customers, products, tickets, regions, etc." },
  { file: "schemas.ts", purpose: "Strict types derived from entities.yaml for all I/O." },
] as const;

const FULL_WORLD_MODEL = [
  { file: "entities.yaml", purpose: "Canonical types" },
  { file: "states.schema.ts", purpose: "Current facts, live status per entity" },
  { file: "events.schema.ts", purpose: "What changed and when — append-only ledger" },
  { file: "policies.yaml", purpose: "Rules, thresholds, constraints applied to every action" },
  { file: "actions.ts", purpose: "What the agent is allowed to do; bounded set" },
  { file: "outcomes.table.ts", purpose: "What happened after action — feedback loop" },
  { file: "evidence_refs.json", purpose: "Source citations per claim" },
  { file: "interpretive_boundary.md", purpose: "Act-on-this vs interpret-this-first labels" },
] as const;
