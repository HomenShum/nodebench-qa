/**
 * Architect — chat-first intake + animated classification checklist.
 *
 * User lands, types a workflow prompt, watches the checklist stream in,
 * then sees a 3-card recommendation (runtime / world model / eval) with
 * one-click accept to the Builder workspace.
 *
 * The UI never says "building..." during intake — only "understanding",
 * "classifying", "recommending" until the user explicitly accepts.
 */

import { useState, useEffect, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useAction, useQuery } from "convex/react";
import { api } from "../_convex/api";
import { Nav } from "../components/Nav";
import { HeroDemoLoop } from "../components/HeroDemoLoop";
import { ProofSection } from "../components/ProofSection";
import { TraceDropzone } from "../components/TraceDropzone";
import type { TraceSummary } from "../lib/normalize_trace";

type TranscriptTurn = { ts: number; role: "user" | "assistant"; content: string };

const STARTER_CHIPS = [
  "Make my expensive agent cheaper",
  "Migrate my legacy chain to a stronger scaffold",
  "Turn my Claude Code workflow into a production runtime",
  "Show me what this would look like as an orchestrator-worker system",
] as const;

// Hand-picked examples with frozen gold verdicts. Showing these on the
// landing page acts as both social proof and calibration — users see
// what a triage output looks like before they submit their own prompt.
type SampleVerdict = {
  prompt: string;
  runtime: string;
  world_model: string;
  intent: string;
  note: string;
};

const SAMPLE_VERDICTS: SampleVerdict[] = [
  {
    prompt:
      "Retail inventory agent on Claude Opus 4.7, $20/day. Cut to $2/day on core lookups.",
    runtime: "Tool-first chain",
    world_model: "Lite",
    intent: "Compile down",
    note: "Bounded retrieval — no policy engine needed. Gemini Flash Lite + schema.",
  },
  {
    prompt:
      "400-line LangChain support agent on GPT-4. Want proper orchestrator with retries and escalation.",
    runtime: "Orchestrator-worker",
    world_model: "Full",
    intent: "Compile up",
    note: "Stateful, retries, escalation → full world model with policies + outcomes.",
  },
  {
    prompt:
      "Weekly financial report from a revenue spreadsheet. Email to finance.",
    runtime: "Simple chain",
    world_model: "Lite",
    intent: "Greenfield",
    note: "Bounded + deterministic. Don't oversell a scaffold here.",
  },
];

type ChecklistStep = {
  step: string;
  status: "ok" | "missing" | "pending";
  detail?: string;
};

const EXPECTED_STEPS: ChecklistStep[] = [
  { step: "problem_type_identified", status: "pending" },
  { step: "output_contract_extracted", status: "pending" },
  { step: "tools_mcp_likely_needed", status: "pending" },
  { step: "existing_assets_detected", status: "pending" },
  { step: "source_of_truth_resolved", status: "pending" },
  { step: "eval_method_selected", status: "pending" },
  { step: "runtime_lane_chosen", status: "pending" },
  { step: "world_model_lane_chosen", status: "pending" },
  { step: "interpretive_boundary_marked", status: "pending" },
  { step: "missing_inputs_identified", status: "pending" },
];

const STEP_LABELS: Record<string, string> = {
  problem_type_identified: "Problem type identified",
  output_contract_extracted: "Output contract extracted",
  tools_mcp_likely_needed: "Tools / MCP likely needed",
  existing_assets_detected: "Existing assets detected",
  source_of_truth_resolved: "Source-of-truth status resolved",
  eval_method_selected: "Eval method selected",
  runtime_lane_chosen: "Recommended runtime chosen",
  world_model_lane_chosen: "Recommended world model chosen",
  interpretive_boundary_marked: "Interpretive boundary marked",
  missing_inputs_identified: "Missing inputs identified",
};

const RUNTIME_LABEL: Record<string, string> = {
  simple_chain: "Simple chain",
  tool_first_chain: "Tool-first chain",
  orchestrator_worker: "Orchestrator-worker",
  keep_big_model: "Keep the big model",
};

const WORLD_MODEL_LABEL: Record<string, string> = {
  lite: "Lite",
  full: "Full",
};

const INTENT_LABEL: Record<string, string> = {
  compile_down: "Compile down (frontier → cheap)",
  compile_up: "Compile up (legacy chain → scaffold)",
  translate: "Translate across frameworks",
  greenfield: "Greenfield build",
  unknown: "Unknown — need more detail",
};

// --- Derived recommendation mappings (client-side, deterministic) --------
// SDK fit is derived from runtimeLane so the landing doesn't need a
// Convex redeploy when we add / refine target SDKs.
const SDK_FIT: Record<
  string,
  { primary: string; secondary: string; note: string }
> = {
  simple_chain: {
    primary: "Raw HTTP / any provider SDK",
    secondary: "OpenAI Agents SDK · Google Gemini",
    note: "Single LLM call + schema. Pick the cheapest provider that hits the contract.",
  },
  tool_first_chain: {
    primary: "OpenAI Agents SDK",
    secondary: "Google Gemini function-calling · Claude tool_use",
    note: "Bounded tool loop. Native function-calling beats prompt-engineered tool calls.",
  },
  orchestrator_worker: {
    primary: "Anthropic Claude Agent SDK",
    secondary: "LangGraph · OpenAI Agents SDK multi-agent",
    note: "Plan → dispatch → compact with shared scratchpad. Claude Agent SDK is the canonical pattern; LangGraph if you already run it.",
  },
  openai_agents_sdk: {
    primary: "OpenAI Agents SDK",
    secondary: "LangGraph",
    note: "Keep SDK parity if your prod is already on OpenAI.",
  },
  langgraph_python: {
    primary: "LangGraph",
    secondary: "OpenAI Agents SDK",
    note: "Graph-state stateful runs; natural fit for long-horizon workflows.",
  },
};

// Component layers a generated scaffold will ship with, indexed by
// (runtimeLane, worldModelLane). World model presence adds a policy
// + outcome-encoding layer per the Block world-model framing.
function componentLayersFor(
  runtimeLane: string,
  worldModelLane: string,
): string[] {
  const full = worldModelLane === "full";
  switch (runtimeLane) {
    case "orchestrator_worker":
    case "openai_agents_sdk":
    case "langgraph_python":
      return [
        "Capture + normalize (trace → WorkflowSpec)",
        "Plan step (LLM → JSON worker assignments)",
        "Per-worker dispatch (bounded tool loop)",
        "Shared scratchpad + compaction",
        "Connector resolver (mock / live / hybrid)",
        ...(full
          ? [
              "Policy engine (must-have source ref · amount bounds · trend gating)",
              "Outcome encoder (what happened → what was decided → result)",
            ]
          : []),
        "Judge + benchmark rubric (boolean structural + LLM semantic)",
      ];
    case "tool_first_chain":
      return [
        "Capture + normalize (trace → WorkflowSpec)",
        "Single-LLM tool loop (bounded, MAX_TURNS cap)",
        "Connector resolver (mock / live / hybrid)",
        ...(full
          ? [
              "Policy engine (claim gating · source-ref required)",
              "Outcome encoder",
            ]
          : []),
        "Judge + benchmark rubric",
      ];
    case "simple_chain":
    default:
      return [
        "Capture + normalize",
        "Prompt + output-schema contract",
        ...(full
          ? [
              "State table (inputs · outputs · outcome encoded)",
              "Policy engine",
            ]
          : []),
        "Judge + rubric",
      ];
  }
}

// Interpretive Boundary — which surfaces of the workflow are
// deterministic ("Act On This") vs LLM-judged ("Interpret First").
// Adapted from the Block world-model framing (Nate B Jones): we refuse
// to hide a quiet judgment call behind a deterministic-looking output.
function interpretiveBoundaryFor(
  runtimeLane: string,
  worldModelLane: string,
): { actOn: string[]; interpretFirst: string[] } {
  const full = worldModelLane === "full";
  const out = {
    actOn: [
      "Structural schema validation on tool I/O",
      "Connector-mode dispatch (mock vs live) — deterministic",
      "AST-parse validity on emitted scaffold",
      "Token / cost accounting",
    ] as string[],
    interpretFirst: [
      "Final LLM answer quality (boolean rubric → verdict)",
      "Fidelity vs baseline (transfers / lossy / regression)",
    ] as string[],
  };
  if (full) {
    out.actOn.push("Policy checks (source-ref · amount bounds)");
    out.interpretFirst.push("Trend-claim gating (LLM-labeled, policy-enforced)");
  }
  if (
    runtimeLane === "orchestrator_worker" ||
    runtimeLane === "openai_agents_sdk" ||
    runtimeLane === "langgraph_python"
  ) {
    out.interpretFirst.push("Per-worker plan adherence (scratchpad audit)");
  }
  return out;
}

function shortSlug(): string {
  return Math.random().toString(36).slice(2, 10);
}

function generateOwnerToken(): string {
  if (typeof window === "undefined") return "";
  const buf = new Uint8Array(24);
  window.crypto.getRandomValues(buf);
  return Array.from(buf)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function ownerTokenStorageKey(slug: string): string {
  return `attrition:owner:${slug}`;
}

export function Architect() {
  const [prompt, setPrompt] = useState("");
  const [slug, setSlug] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();

  const createSession = useMutation(api.domains.daas.architect.createSession);
  const claimOwnership = useMutation(api.domains.daas.ownership.claimOwnership);
  const appendTurn = useMutation(api.domains.daas.architect.appendTurn);
  const classify = useAction(api.domains.daas.architectClassifier.classify);
  const reclassify = useAction(
    api.domains.daas.architectClassifier.reclassifyFromTranscript,
  );
  const markAccepted = useMutation(api.domains.daas.architect.markAccepted);
  const [followUp, setFollowUp] = useState("");
  const [isRefining, setIsRefining] = useState(false);

  const session = useQuery(
    api.domains.daas.architect.getSessionBySlug,
    slug ? { sessionSlug: slug } : "skip",
  );
  const costStatus = useQuery(
    api.domains.daas.costCap.getSessionCostStatus,
    slug ? { sessionSlug: slug } : "skip",
  );

  async function submit() {
    if (!prompt.trim() || submitting) return;
    setSubmitting(true);
    const s = shortSlug();
    try {
      await createSession({ sessionSlug: s, prompt: prompt.trim() });
      // Claim ownership: generate a token, store it locally, tell the
      // server the hash. This session is now owned by the holder of
      // the localStorage token.
      const token = generateOwnerToken();
      if (typeof window !== "undefined") {
        window.localStorage.setItem(ownerTokenStorageKey(s), token);
      }
      try {
        await claimOwnership({ sessionSlug: s, ownerToken: token });
      } catch {
        // Ownership claim is best-effort — classification still proceeds
      }
      setSlug(s);
      // Kick off classifier (doesn't await the full run — it writes back
      // to the session via mutations and the query below re-renders).
      void classify({ sessionSlug: s, prompt: prompt.trim() });
    } finally {
      setSubmitting(false);
    }
  }

  async function accept() {
    if (!slug) return;
    await markAccepted({ sessionSlug: slug });
    navigate(`/build/${slug}`);
  }

  function reset() {
    setSlug(null);
    setPrompt("");
    setFollowUp("");
  }

  async function submitFollowUp() {
    if (!slug || !followUp.trim() || isRefining) return;
    setIsRefining(true);
    try {
      await appendTurn({ sessionSlug: slug, role: "user", content: followUp.trim() });
      // Fire-and-forget: classifier re-runs and overwrites verdict
      void reclassify({ sessionSlug: slug });
      setFollowUp("");
    } finally {
      setIsRefining(false);
    }
  }

  // Parse transcript for multi-turn display
  const transcript = useMemo<TranscriptTurn[]>(() => {
    if (!session?.transcriptJson) return [];
    try {
      return JSON.parse(session.transcriptJson);
    } catch {
      return [];
    }
  }, [session?.transcriptJson]);

  // Parse classification for missing_inputs surfacing
  const classification = useMemo<{
    missing_inputs?: string[];
    eval_plan?: string;
  } | null>(() => {
    if (!session?.classificationJson) return null;
    try {
      return JSON.parse(session.classificationJson);
    } catch {
      return null;
    }
  }, [session?.classificationJson]);

  // Merge expected steps with backend checklist (backend fills what it completed)
  const mergedChecklist = useMemo<ChecklistStep[]>(() => {
    if (!session?.checklistJson) return EXPECTED_STEPS;
    try {
      const returned = JSON.parse(session.checklistJson) as ChecklistStep[];
      const byKey = new Map(returned.map((r) => [r.step, r]));
      return EXPECTED_STEPS.map((e) => byKey.get(e.step) ?? e);
    } catch {
      return EXPECTED_STEPS;
    }
  }, [session?.checklistJson]);

  // Staggered reveal — when the backend commits the checklist, animate
  // items in one-by-one to make it feel streamed rather than batch-flipped.
  const [revealCount, setRevealCount] = useState(0);
  const hasChecklist = Boolean(session?.checklistJson);
  const totalSteps = mergedChecklist.length;
  useEffect(() => {
    if (!hasChecklist) {
      setRevealCount(0);
      return;
    }
    setRevealCount(0);
    let i = 0;
    const handle = setInterval(() => {
      i += 1;
      setRevealCount(i);
      if (i >= totalSteps) clearInterval(handle);
    }, 110);
    return () => clearInterval(handle);
  }, [hasChecklist, totalSteps, session?.sessionSlug]);

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
      <main id="main" style={{ maxWidth: 960, margin: "0 auto", padding: "40px 32px 80px" }}>
        <header style={{ marginBottom: 32 }}>
          <div
            style={{
              fontSize: 11,
              letterSpacing: "0.2em",
              textTransform: "uppercase",
              color: "#d97757",
              marginBottom: 6,
            }}
          >
            attrition.sh · architecture compiler + verification layer
          </div>
          <h1
            style={{
              fontSize: 34,
              fontWeight: 600,
              margin: 0,
              letterSpacing: "-0.015em",
              lineHeight: 1.12,
              maxWidth: 780,
            }}
          >
            Compile frontier agent runs into cheaper, verified
            production workflows.
          </h1>
          <p
            style={{
              fontSize: 15,
              color: "rgba(255,255,255,0.72)",
              margin: "10px 0 0",
              maxWidth: 720,
              lineHeight: 1.55,
            }}
          >
            Capture what worked in Claude Code, Cursor, or your existing
            agent stack. Distill it into a portable workflow asset.
            Generate a new runtime, replay it on cheaper models, and
            ship only what passes.
          </p>
          <p
            style={{
              fontSize: 13,
              color: "rgba(255,255,255,0.5)",
              margin: "6px 0 0",
              maxWidth: 720,
              lineHeight: 1.55,
            }}
          >
            We translate workflows between chains, tool runtimes, and
            orchestrator-worker systems — with judged regression checks,
            cost deltas, and runnable code. Three motions:{" "}
            <strong style={{ color: "rgba(255,255,255,0.8)" }}>
              compile down
            </strong>
            ,{" "}
            <strong style={{ color: "rgba(255,255,255,0.8)" }}>
              compile up
            </strong>
            , and{" "}
            <strong style={{ color: "rgba(255,255,255,0.8)" }}>
              translate across
            </strong>
            .
          </p>
          <p
            style={{
              fontSize: 13,
              color: "rgba(255,255,255,0.55)",
              margin: "14px 0 0",
              fontWeight: 500,
              letterSpacing: "-0.01em",
            }}
          >
            Describe your workflow → we stream an architecture
            recommendation.
          </p>
        </header>

        {!slug ? (
          <section>
            {/* Trace upload — parse a real agent run in-browser and
                prefill the prompt with a structured brief. */}
            <TraceDropzone
              onSummary={(summary: TraceSummary) => {
                // Prepend the brief above any existing prompt text
                setPrompt((prev) =>
                  prev?.trim()
                    ? `${summary.brief}\n\n---\n\nAlso: ${prev.trim()}`
                    : summary.brief,
                );
              }}
            />

            <PromptTextarea
              value={prompt}
              onChange={setPrompt}
              onSubmit={() => void submit()}
            />
            <div
              style={{
                marginTop: 12,
                display: "flex",
                gap: 8,
                flexWrap: "wrap",
              }}
            >
              {STARTER_CHIPS.map((chip) => (
                <button
                  key={chip}
                  type="button"
                  onClick={() => setPrompt(chip)}
                  style={{
                    padding: "6px 12px",
                    background: "rgba(255,255,255,0.04)",
                    border: "1px solid rgba(255,255,255,0.08)",
                    borderRadius: 999,
                    color: "rgba(255,255,255,0.75)",
                    fontSize: 12,
                    cursor: "pointer",
                  }}
                >
                  {chip}
                </button>
              ))}
            </div>

            {/* Measured proof — BFCL v3 n=200 result, rendered first so
                a visitor sees real numbers before any scripted demo. */}
            <ProofSection />

            {/* Animated hero demo loop — 3 scripted sample triages */}
            <div
              style={{
                marginTop: 24,
                padding: "16px 0 0",
                borderTop: "1px solid rgba(255,255,255,0.06)",
              }}
            >
              <HeroDemoLoop />
            </div>

            {/* Static sample verdicts — handpicked reference + calibration */}
            <div
              style={{
                marginTop: 24,
              }}
            >
              <div
                style={{
                  fontSize: 11,
                  letterSpacing: "0.2em",
                  textTransform: "uppercase",
                  color: "rgba(255,255,255,0.5)",
                  marginBottom: 12,
                }}
              >
                Frozen samples
              </div>
              <div style={{ display: "grid", gap: 10 }}>
                {SAMPLE_VERDICTS.map((s, i) => (
                  <div
                    key={i}
                    style={{
                      padding: 14,
                      background: "rgba(255,255,255,0.02)",
                      border: "1px solid rgba(255,255,255,0.06)",
                      borderRadius: 8,
                    }}
                  >
                    <div
                      style={{
                        fontSize: 12,
                        color: "rgba(255,255,255,0.72)",
                        marginBottom: 8,
                        lineHeight: 1.5,
                        fontStyle: "italic",
                      }}
                    >
                      “{s.prompt}”
                    </div>
                    <div
                      style={{
                        display: "flex",
                        gap: 6,
                        flexWrap: "wrap",
                        marginBottom: 8,
                      }}
                    >
                      <SampleBadge label="Runtime" value={s.runtime} accent="#d97757" />
                      <SampleBadge label="World model" value={s.world_model} accent="#8b5cf6" />
                      <SampleBadge label="Intent" value={s.intent} accent="#22c55e" />
                    </div>
                    <div
                      style={{
                        fontSize: 12,
                        color: "rgba(255,255,255,0.55)",
                        lineHeight: 1.5,
                      }}
                    >
                      {s.note}
                    </div>
                  </div>
                ))}
              </div>
              <p
                style={{
                  marginTop: 10,
                  fontSize: 11,
                  color: "rgba(255,255,255,0.4)",
                }}
              >
                These are handpicked — your own prompt gets classified live by Gemini
                Flash Lite against the same bounded enums.
              </p>
            </div>
            <div style={{ marginTop: 16, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: 11, color: "rgba(255,255,255,0.4)" }}>
                Nothing's built yet. We decide with you first.
              </span>
              <button
                type="button"
                disabled={submitting || !prompt.trim()}
                onClick={submit}
                style={{
                  padding: "10px 20px",
                  background: prompt.trim() ? "#d97757" : "rgba(255,255,255,0.08)",
                  border: "none",
                  borderRadius: 8,
                  color: prompt.trim() ? "#fff" : "rgba(255,255,255,0.4)",
                  fontSize: 14,
                  fontWeight: 500,
                  cursor: prompt.trim() ? "pointer" : "not-allowed",
                }}
              >
                {submitting ? "Starting…" : "Run triage →"}
              </button>
            </div>
          </section>
        ) : (
          <section>
            {/* Multi-turn transcript */}
            <div
              style={{
                marginBottom: 20,
                display: "flex",
                flexDirection: "column",
                gap: 8,
              }}
            >
              {transcript.map((turn, i) => (
                <div
                  key={i}
                  style={{
                    padding: 12,
                    background:
                      turn.role === "user"
                        ? "rgba(217,119,87,0.06)"
                        : "rgba(255,255,255,0.02)",
                    border:
                      turn.role === "user"
                        ? "1px solid rgba(217,119,87,0.25)"
                        : "1px solid rgba(255,255,255,0.06)",
                    borderRadius: 8,
                  }}
                >
                  <div
                    style={{
                      fontSize: 10,
                      letterSpacing: "0.15em",
                      textTransform: "uppercase",
                      color: turn.role === "user" ? "#d97757" : "rgba(255,255,255,0.5)",
                      marginBottom: 4,
                    }}
                  >
                    {turn.role}
                  </div>
                  <p
                    style={{
                      margin: 0,
                      fontSize: 13,
                      lineHeight: 1.5,
                      color: "rgba(255,255,255,0.85)",
                      whiteSpace: "pre-wrap",
                    }}
                  >
                    {turn.content}
                  </p>
                </div>
              ))}
            </div>

            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 10,
              }}
            >
              <div
                style={{
                  fontSize: 11,
                  letterSpacing: "0.2em",
                  textTransform: "uppercase",
                  color: "rgba(255,255,255,0.5)",
                }}
              >
                {session?.status === "ready" || session?.status === "accepted"
                  ? "Triage complete"
                  : session?.status === "classifying"
                    ? "Classifying…"
                    : "Understanding…"}
              </div>
              {costStatus ? (
                <div
                  style={{
                    fontSize: 10,
                    color:
                      costStatus.remainingUsd < 0.1
                        ? "#f59e0b"
                        : "rgba(255,255,255,0.45)",
                    fontVariantNumeric: "tabular-nums",
                  }}
                  title={`$${costStatus.currentUsd.toFixed(4)} of $${costStatus.capUsd.toFixed(2)} session cap`}
                >
                  ${costStatus.currentUsd.toFixed(4)} / ${costStatus.capUsd.toFixed(2)}
                </div>
              ) : null}
            </div>

            <ul style={{ listStyle: "none", padding: 0, margin: "0 0 28px" }}>
              {mergedChecklist.map((step, i) => (
                <li
                  key={step.step}
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 10,
                    padding: "8px 0",
                    fontSize: 13,
                    color:
                      step.status === "ok"
                        ? "rgba(255,255,255,0.85)"
                        : step.status === "missing"
                          ? "rgba(245,158,11,0.85)"
                          : "rgba(255,255,255,0.35)",
                    opacity: hasChecklist && i >= revealCount ? 0.15 : 1,
                    transition: "opacity 0.25s ease-in",
                    animationDelay: `${i * 60}ms`,
                  }}
                >
                  <span
                    style={{
                      display: "inline-flex",
                      width: 18,
                      height: 18,
                      borderRadius: 4,
                      background:
                        step.status === "ok"
                          ? "rgba(34,197,94,0.18)"
                          : step.status === "missing"
                            ? "rgba(245,158,11,0.18)"
                            : "rgba(255,255,255,0.06)",
                      border: `1px solid ${
                        step.status === "ok"
                          ? "rgba(34,197,94,0.5)"
                          : step.status === "missing"
                            ? "rgba(245,158,11,0.5)"
                            : "rgba(255,255,255,0.12)"
                      }`,
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                      marginTop: 2,
                      fontSize: 10,
                      color: step.status === "ok" ? "#22c55e" : step.status === "missing" ? "#f59e0b" : "transparent",
                    }}
                  >
                    {step.status === "ok" ? "✓" : step.status === "missing" ? "!" : ""}
                  </span>
                  <span style={{ flex: 1 }}>
                    <div style={{ fontWeight: 500 }}>{STEP_LABELS[step.step] ?? step.step}</div>
                    {step.detail ? (
                      <div style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", marginTop: 2 }}>
                        {step.detail}
                      </div>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>

            {session?.status === "ready" || session?.status === "accepted" ? (
              <div>
                <div
                  style={{
                    fontSize: 11,
                    letterSpacing: "0.2em",
                    textTransform: "uppercase",
                    color: "rgba(255,255,255,0.5)",
                    marginBottom: 10,
                  }}
                >
                  Recommendation
                </div>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(3, 1fr)",
                    gap: 12,
                    marginBottom: 24,
                  }}
                >
                  <Card
                    label="Runtime"
                    value={RUNTIME_LABEL[session?.runtimeLane ?? ""] ?? "—"}
                    accent="#d97757"
                  />
                  <Card
                    label="World model"
                    value={WORLD_MODEL_LABEL[session?.worldModelLane ?? ""] ?? "—"}
                    accent="#8b5cf6"
                  />
                  <Card
                    label="Intent"
                    value={INTENT_LABEL[session?.intentLane ?? ""] ?? "—"}
                    accent="#22c55e"
                  />
                </div>

                {/* SDK fit — derived client-side from runtimeLane */}
                {session?.runtimeLane && SDK_FIT[session.runtimeLane] ? (
                  <div
                    style={{
                      padding: 14,
                      background: "rgba(34,211,238,0.05)",
                      border: "1px solid rgba(34,211,238,0.3)",
                      borderRadius: 10,
                      marginBottom: 16,
                    }}
                  >
                    <div
                      style={{
                        fontSize: 11,
                        letterSpacing: "0.15em",
                        textTransform: "uppercase",
                        color: "#22d3ee",
                        marginBottom: 6,
                      }}
                    >
                      SDK fit
                    </div>
                    <div style={{ fontSize: 14, color: "rgba(255,255,255,0.9)", marginBottom: 4, fontWeight: 500 }}>
                      Primary: {SDK_FIT[session.runtimeLane].primary}
                    </div>
                    <div style={{ fontSize: 12, color: "rgba(255,255,255,0.65)", marginBottom: 8 }}>
                      Also compiles to: {SDK_FIT[session.runtimeLane].secondary}
                    </div>
                    <p style={{ margin: 0, fontSize: 12, lineHeight: 1.5, color: "rgba(255,255,255,0.6)" }}>
                      {SDK_FIT[session.runtimeLane].note}
                    </p>
                  </div>
                ) : null}

                {/* Component layers — the scaffold we'll emit, step by step */}
                {session?.runtimeLane ? (
                  <div
                    style={{
                      padding: 14,
                      background: "rgba(217,119,87,0.05)",
                      border: "1px solid rgba(217,119,87,0.3)",
                      borderRadius: 10,
                      marginBottom: 16,
                    }}
                  >
                    <div
                      style={{
                        fontSize: 11,
                        letterSpacing: "0.15em",
                        textTransform: "uppercase",
                        color: "#d97757",
                        marginBottom: 8,
                      }}
                    >
                      Component layers the scaffold will ship with
                    </div>
                    <ol
                      style={{
                        margin: 0,
                        paddingLeft: 22,
                        fontSize: 13,
                        lineHeight: 1.6,
                        color: "rgba(255,255,255,0.82)",
                      }}
                    >
                      {componentLayersFor(
                        session.runtimeLane,
                        session.worldModelLane ?? "lite",
                      ).map((layer, i) => (
                        <li key={i} style={{ marginBottom: 3 }}>
                          {layer}
                        </li>
                      ))}
                    </ol>
                  </div>
                ) : null}

                {/* Interpretive Boundary — Act On This vs Interpret First */}
                {session?.runtimeLane ? (
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
                      gap: 12,
                      marginBottom: 16,
                    }}
                  >
                    <div
                      style={{
                        padding: 14,
                        background: "rgba(34,197,94,0.05)",
                        border: "1px solid rgba(34,197,94,0.3)",
                        borderRadius: 10,
                      }}
                    >
                      <div
                        style={{
                          fontSize: 10,
                          letterSpacing: "0.16em",
                          textTransform: "uppercase",
                          color: "#22c55e",
                          marginBottom: 6,
                        }}
                      >
                        Act on this · deterministic
                      </div>
                      <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, lineHeight: 1.55, color: "rgba(255,255,255,0.78)" }}>
                        {interpretiveBoundaryFor(
                          session.runtimeLane,
                          session.worldModelLane ?? "lite",
                        ).actOn.map((item, i) => (
                          <li key={i} style={{ marginBottom: 2 }}>{item}</li>
                        ))}
                      </ul>
                    </div>
                    <div
                      style={{
                        padding: 14,
                        background: "rgba(245,158,11,0.05)",
                        border: "1px solid rgba(245,158,11,0.3)",
                        borderRadius: 10,
                      }}
                    >
                      <div
                        style={{
                          fontSize: 10,
                          letterSpacing: "0.16em",
                          textTransform: "uppercase",
                          color: "#f59e0b",
                          marginBottom: 6,
                        }}
                      >
                        Interpret this first · judgment
                      </div>
                      <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, lineHeight: 1.55, color: "rgba(255,255,255,0.78)" }}>
                        {interpretiveBoundaryFor(
                          session.runtimeLane,
                          session.worldModelLane ?? "lite",
                        ).interpretFirst.map((item, i) => (
                          <li key={i} style={{ marginBottom: 2 }}>{item}</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                ) : null}

                {session?.rationale ? (
                  <div
                    style={{
                      padding: 16,
                      background: "rgba(255,255,255,0.02)",
                      border: "1px solid rgba(255,255,255,0.06)",
                      borderRadius: 10,
                      marginBottom: 16,
                    }}
                  >
                    <div style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", marginBottom: 6 }}>
                      Why
                    </div>
                    <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5, color: "rgba(255,255,255,0.8)" }}>
                      {session.rationale}
                    </p>
                  </div>
                ) : null}

                {classification?.missing_inputs && classification.missing_inputs.length > 0 ? (
                  <div
                    style={{
                      padding: 16,
                      background: "rgba(245,158,11,0.06)",
                      border: "1px solid rgba(245,158,11,0.3)",
                      borderRadius: 10,
                      marginBottom: 16,
                    }}
                  >
                    <div
                      style={{
                        fontSize: 11,
                        letterSpacing: "0.15em",
                        textTransform: "uppercase",
                        color: "#f59e0b",
                        marginBottom: 8,
                      }}
                    >
                      Missing inputs
                    </div>
                    <ul style={{ margin: 0, paddingLeft: 20, fontSize: 13, lineHeight: 1.55, color: "rgba(255,255,255,0.85)" }}>
                      {classification.missing_inputs.map((item, i) => (
                        <li key={i} style={{ marginBottom: 4 }}>{item}</li>
                      ))}
                    </ul>
                    <p style={{ margin: "10px 0 0", fontSize: 12, color: "rgba(255,255,255,0.55)" }}>
                      Paste them into the refine box below and the classifier re-runs with the added context.
                    </p>
                  </div>
                ) : null}

                {classification?.eval_plan ? (
                  <div
                    style={{
                      padding: 12,
                      background: "rgba(139,92,246,0.06)",
                      border: "1px solid rgba(139,92,246,0.3)",
                      borderRadius: 8,
                      marginBottom: 16,
                      fontSize: 12,
                      color: "rgba(255,255,255,0.8)",
                      lineHeight: 1.5,
                    }}
                  >
                    <strong style={{ color: "#8b5cf6" }}>Eval plan: </strong>
                    {classification.eval_plan}
                  </div>
                ) : null}

                {/* Refine / follow-up box */}
                <div
                  style={{
                    padding: 14,
                    background: "rgba(255,255,255,0.03)",
                    border: "1px solid rgba(255,255,255,0.1)",
                    borderRadius: 10,
                    marginBottom: 20,
                  }}
                >
                  <div
                    style={{
                      fontSize: 11,
                      letterSpacing: "0.15em",
                      textTransform: "uppercase",
                      color: "rgba(255,255,255,0.55)",
                      marginBottom: 8,
                    }}
                  >
                    Refine
                  </div>
                  <textarea
                    value={followUp}
                    onChange={(e) => setFollowUp(e.target.value)}
                    rows={3}
                    placeholder="Add context, correct an assumption, or answer the missing-inputs list above…"
                    style={{
                      width: "100%",
                      padding: 10,
                      background: "rgba(0,0,0,0.25)",
                      border: "1px solid rgba(255,255,255,0.08)",
                      borderRadius: 6,
                      color: "rgba(255,255,255,0.92)",
                      fontSize: 13,
                      fontFamily: "inherit",
                      resize: "vertical",
                      lineHeight: 1.5,
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
                      marginTop: 8,
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                    }}
                  >
                    <span style={{ fontSize: 11, color: "rgba(255,255,255,0.4)" }}>
                      {isRefining ? "Re-classifying…" : "Cmd/Ctrl + Enter to submit"}
                    </span>
                    <button
                      type="button"
                      disabled={!followUp.trim() || isRefining}
                      onClick={submitFollowUp}
                      style={{
                        padding: "6px 14px",
                        background: followUp.trim() ? "rgba(217,119,87,0.2)" : "rgba(255,255,255,0.05)",
                        border: "1px solid rgba(217,119,87,0.35)",
                        borderRadius: 6,
                        color: followUp.trim() ? "#fff" : "rgba(255,255,255,0.4)",
                        fontSize: 12,
                        fontWeight: 500,
                        cursor: followUp.trim() ? "pointer" : "not-allowed",
                      }}
                    >
                      Re-classify
                    </button>
                  </div>
                </div>

                <div
                  style={{
                    display: "flex",
                    gap: 12,
                    justifyContent: "flex-end",
                    alignItems: "center",
                    flexWrap: "wrap",
                  }}
                >
                  <span
                    style={{
                      fontSize: 11,
                      color: "rgba(255,255,255,0.5)",
                      marginRight: "auto",
                      maxWidth: 420,
                      lineHeight: 1.5,
                    }}
                  >
                    Next: the Builder opens with the emitted scaffold.
                    Each file is <code>ast.parse</code>-valid on emit,
                    ships with <code>README.md</code> +{" "}
                    <code>requirements.txt</code> + <code>run.sh</code>{" "}
                    + <code>.env.example</code>, and downloads as a
                    single ZIP that runs in mock mode with no API key.
                  </span>
                  <button
                    type="button"
                    onClick={reset}
                    style={{
                      padding: "10px 16px",
                      background: "transparent",
                      border: "1px solid rgba(255,255,255,0.15)",
                      borderRadius: 8,
                      color: "rgba(255,255,255,0.75)",
                      fontSize: 13,
                      cursor: "pointer",
                    }}
                  >
                    Revise prompt
                  </button>
                  <button
                    type="button"
                    onClick={accept}
                    style={{
                      padding: "10px 20px",
                      background: "#d97757",
                      border: "none",
                      borderRadius: 8,
                      color: "#fff",
                      fontSize: 14,
                      fontWeight: 500,
                      cursor: "pointer",
                    }}
                  >
                    Build this scaffold → open runnable code
                  </button>
                </div>
              </div>
            ) : (
              <div
                style={{
                  padding: 16,
                  background: "rgba(255,255,255,0.02)",
                  border: "1px solid rgba(255,255,255,0.06)",
                  borderRadius: 10,
                  fontSize: 13,
                  color: "rgba(255,255,255,0.55)",
                }}
              >
                Running triage against a cheap classifier. Nothing is built yet — we're
                deciding whether structure can actually replace model cost for this
                workflow.
              </div>
            )}
          </section>
        )}
      </main>
    </div>
  );
}

function PromptTextarea({
  value,
  onChange,
  onSubmit,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
}) {
  const ref = useRef<HTMLTextAreaElement | null>(null);

  // Global "/" shortcut — focus the intake box from anywhere on the page.
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if (e.key !== "/") return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      e.preventDefault();
      ref.current?.focus();
    }
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  return (
    <div style={{ position: "relative" }}>
      <textarea
        ref={ref}
        aria-label="Describe your workflow"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="e.g. I need a retail inventory decision agent that reads live store data, applies pricing and restock policy, and writes actions back to our ERP..."
        rows={6}
        style={{
          width: "100%",
          padding: 16,
          background: "rgba(255,255,255,0.03)",
          border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: 10,
          color: "rgba(255,255,255,0.92)",
          fontSize: 15,
          fontFamily: "inherit",
          resize: "vertical",
          lineHeight: 1.5,
        }}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
            e.preventDefault();
            onSubmit();
          }
        }}
      />
      <div
        style={{
          position: "absolute",
          top: 10,
          right: 14,
          display: "flex",
          gap: 4,
          fontSize: 10,
          color: "rgba(255,255,255,0.35)",
          pointerEvents: "none",
        }}
        aria-hidden="true"
      >
        <kbd>/</kbd>
        <span>focus</span>
      </div>
    </div>
  );
}

function SampleBadge({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent: string;
}) {
  return (
    <span
      style={{
        padding: "3px 10px",
        fontSize: 11,
        color: accent,
        background: `${accent}15`,
        border: `1px solid ${accent}40`,
        borderRadius: 4,
        whiteSpace: "nowrap",
      }}
    >
      <span style={{ color: "rgba(255,255,255,0.5)", marginRight: 4 }}>{label}:</span>
      <strong style={{ fontWeight: 500 }}>{value}</strong>
    </span>
  );
}

function Card({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <div
      style={{
        padding: 16,
        background: "rgba(255,255,255,0.02)",
        border: "1px solid rgba(255,255,255,0.06)",
        borderRadius: 10,
        minHeight: 96,
      }}
    >
      <div
        style={{
          fontSize: 10,
          letterSpacing: "0.2em",
          textTransform: "uppercase",
          color: accent,
          marginBottom: 8,
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: 15, fontWeight: 500, lineHeight: 1.4 }}>{value}</div>
    </div>
  );
}
