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
import { RuntimeSelector } from "../components/RuntimeSelector";
import type { TraceSummary } from "../lib/normalize_trace";

type TranscriptTurn = { ts: number; role: "user" | "assistant"; content: string };

const STARTER_CHIPS = [
  "Make my expensive agent cheaper",
  "Turn my LangChain prototype into real production code",
  "Take my Claude Code workflow to production",
  "Show me what a multi-agent setup would look like for this",
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

// Recent-sessions panel — cross-session continuity without server
// queries. We write a compact record to localStorage every time the
// user submits a prompt; Architect reads the last 10 on mount.
const RECENT_SESSIONS_KEY = "attrition:recent_sessions";
type RecentSession = {
  slug: string;
  prompt_preview: string;
  ts: number;
};
function recordRecentSession(slug: string, prompt: string): void {
  if (typeof window === "undefined") return;
  try {
    const raw = window.localStorage.getItem(RECENT_SESSIONS_KEY);
    const list: RecentSession[] = raw ? JSON.parse(raw) : [];
    const entry: RecentSession = {
      slug,
      prompt_preview: prompt.slice(0, 180),
      ts: Date.now(),
    };
    const deduped = [entry, ...list.filter((r) => r.slug !== slug)].slice(0, 10);
    window.localStorage.setItem(
      RECENT_SESSIONS_KEY,
      JSON.stringify(deduped),
    );
  } catch {
    /* storage full / disabled — silent no-op */
  }
}
function loadRecentSessions(): RecentSession[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(RECENT_SESSIONS_KEY);
    if (!raw) return [];
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list.slice(0, 10) : [];
  } catch {
    return [];
  }
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
      // Persist a local record so the Recent sessions panel can show
      // continuity across visits (in-browser only, no server query).
      recordRecentSession(s, prompt.trim());
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
        <header style={{ marginBottom: 28 }}>
          <div
            style={{
              fontSize: 11,
              letterSpacing: "0.2em",
              textTransform: "uppercase",
              color: "#d97757",
              marginBottom: 8,
            }}
          >
            attrition.sh · we turn AI agents into production code
          </div>
          <h1
            style={{
              fontSize: 36,
              fontWeight: 600,
              margin: 0,
              letterSpacing: "-0.018em",
              lineHeight: 1.1,
              maxWidth: 820,
            }}
          >
            Turn your AI agent into production code.
            <br />
            <span style={{ color: "#d97757" }}>
              In one hour. You own every line.
            </span>
          </h1>
          <p
            style={{
              fontSize: 15,
              color: "rgba(255,255,255,0.82)",
              margin: "12px 0 0",
              maxWidth: 760,
              lineHeight: 1.6,
            }}
          >
            Built something in Claude Code, Cursor, or LangChain that works
            in chat but falls apart when you try to ship it? Paste what it
            does. In{" "}
            <strong style={{ color: "#fff" }}>60 seconds</strong> we sketch
            the right architecture. In{" "}
            <strong style={{ color: "#fff" }}>15 minutes</strong> we
            generate every file — with a live test run you can watch. In{" "}
            <strong style={{ color: "#fff" }}>30</strong> you chat to fix
            anything wrong and download the folder. In{" "}
            <strong style={{ color: "#fff" }}>60</strong> it's answering
            real users in your production system. One download. You own
            the code from there.
          </p>
          {!slug ? (
            <>
              {/* Eval credibility strip — real numbers from daas/results/
                  TELEMETRY_REPORT.md. Refreshes each baseline run. */}
              <EvalCredibilityStrip />
              {/* Five-checkpoint visual timeline. The core product shape. */}
              <JourneyTimeline />
            </>
          ) : null}
        </header>

        {!slug ? (
          <section>
            {/* Driver runtime selector — picks which agent SDK runs
                attrition's own generation agent (Gemini / OpenAI /
                Claude Agent SDK / LangGraph / OpenRouter). The choice
                persists to localStorage and is surfaced on Builder. */}
            <RuntimeSelector />

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
            <RecentSessionsPanel />

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
            {/* Vision / mission / thesis — the close-out before the CTA.
                One paragraph. Repeatable in a pitch. Calibrated to roll
                off the tongue in a demo. */}
            <section
              aria-label="Why attrition exists"
              style={{
                marginTop: 28,
                padding: 16,
                background: "rgba(255,255,255,0.02)",
                border: "1px solid rgba(255,255,255,0.06)",
                borderRadius: 10,
              }}
            >
              <div
                style={{
                  fontSize: 10,
                  letterSpacing: "0.22em",
                  textTransform: "uppercase",
                  color: "rgba(255,255,255,0.55)",
                  marginBottom: 8,
                }}
              >
                Why we built this
              </div>
              <p
                style={{
                  margin: 0,
                  fontSize: 13,
                  lineHeight: 1.65,
                  color: "rgba(255,255,255,0.85)",
                  maxWidth: 760,
                }}
              >
                Here's the pattern we kept seeing. Someone builds an agent
                in Claude Code or Cursor. It feels magic in the chat. Then
                they try to deploy it — and the next two weeks are spent
                wiring twelve files they only half understand, running
                tests that don't really tell them if they broke anything.
                The gap between &ldquo;works in chat&rdquo; and
                &ldquo;works in production&rdquo; is the hardest part of
                shipping AI agents right now. attrition is the bridge. One
                command: starter code for any AI provider, ready for
                wherever you deploy. We write the first version. You own
                every line after that. The reason we split the experience
                into five steps is simple: we want that one download to
                be right, so you never have to come back to us unless
                your workflow genuinely changes.
              </p>
            </section>

            <div style={{ marginTop: 16, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: 11, color: "rgba(255,255,255,0.45)" }}>
                No code yet. We decide the shape with you first.
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
            {/* Checkpoint eyebrow — tells the user where they are in the
                5-stage journey. Mirrors NextSteps.tsx formatting. */}
            <div
              style={{
                fontSize: 10,
                letterSpacing: "0.22em",
                textTransform: "uppercase",
                color: "#d97757",
                marginBottom: 14,
                fontWeight: 600,
              }}
            >
              {session?.status === "ready" || session?.status === "accepted"
                ? "Step 2 of 5 · here's what we'll build"
                : "Step 1 of 5 · we're reading your request"}
            </div>
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
              <ClassifierStatusBadge status={session?.status ?? "classifying"} />
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

// --- Eval credibility strip ----------------------------------------------
// Real numbers from daas/results/TELEMETRY_REPORT.md. When a new baseline
// lands, re-run `python -m daas.benchmarks.publish_telemetry` and update
// these constants. The strip is intentionally quiet in visual weight but
// high in signal — it tells investors/builders "these are measured, not
// aspirational."
const EVAL_NUMBERS = {
  passes: 50,
  total: 60,
  passPct: 83,
  gates: 11,
  costPerScaffoldUsd: 0.005,
  lanesAt100: 7,
  iterations: 6,
  cumulativeSpendUsd: 1.34,
} as const;

function EvalCredibilityStrip() {
  return (
    <div
      style={{
        marginTop: 16,
        padding: "10px 14px",
        background: "rgba(34,197,94,0.05)",
        border: "1px solid rgba(34,197,94,0.22)",
        borderRadius: 8,
        display: "flex",
        flexWrap: "wrap",
        gap: 14,
        alignItems: "center",
        fontSize: 12,
        color: "rgba(255,255,255,0.8)",
      }}
      aria-label="evaluation telemetry"
    >
      <span
        style={{
          fontSize: 10,
          letterSpacing: "0.18em",
          textTransform: "uppercase",
          color: "#22c55e",
          fontWeight: 600,
        }}
      >
        Tested
      </span>
      <span>
        <strong style={{ color: "#fff" }}>
          {EVAL_NUMBERS.passes} of {EVAL_NUMBERS.total}
        </strong>{" "}
        real workflows pass
      </span>
      <span style={{ color: "rgba(255,255,255,0.3)" }}>·</span>
      <span>
        checked against{" "}
        <strong style={{ color: "#fff" }}>
          {EVAL_NUMBERS.gates} quality checks
        </strong>
      </span>
      <span style={{ color: "rgba(255,255,255,0.3)" }}>·</span>
      <span>
        costs{" "}
        <strong style={{ color: "#fff" }}>about half a cent</strong> to
        generate
      </span>
      <span style={{ color: "rgba(255,255,255,0.3)" }}>·</span>
      <span>
        <strong style={{ color: "#fff" }}>
          {EVAL_NUMBERS.lanesAt100}
        </strong>{" "}
        architecture styles pass every check
      </span>
      <span style={{ color: "rgba(255,255,255,0.3)" }}>·</span>
      <span>
        improved{" "}
        <strong style={{ color: "#fff" }}>
          {EVAL_NUMBERS.iterations} times
        </strong>{" "}
        from its own test failures
      </span>
      <span style={{ color: "rgba(255,255,255,0.3)" }}>·</span>
      <a
        href="https://github.com/HomenShum/attrition/blob/main/daas/results/TELEMETRY_REPORT.md"
        target="_blank"
        rel="noopener noreferrer"
        style={{
          color: "#22c55e",
          textDecoration: "none",
          fontWeight: 500,
        }}
      >
        Telemetry report →
      </a>
    </div>
  );
}

// --- The 5-checkpoint journey timeline -----------------------------------
// The product's full shape at a glance. Users land and see exactly what
// they're about to experience, then click through to start. This is the
// CEO/demo-presenter surface — every label is calibrated to roll off the
// tongue when you're walking someone through the app live.
type Checkpoint = {
  minute: string;
  icon: string;
  title: string;
  subtitle: string;
  body: string;
  accent: string;
};

const CHECKPOINTS: Checkpoint[] = [
  {
    minute: "1 min",
    icon: "●",
    title: "Something's happening",
    subtitle: "We start reading your request",
    body: "You paste what your agent does. Within two seconds, text starts streaming back — that's us reading your description and planning. Your original words stay visible the whole time, so you know this is about YOUR workflow, not a rehearsed demo.",
    accent: "#22c55e",
  },
  {
    minute: "5 min",
    icon: "◆",
    title: "That's actually my workflow",
    subtitle: "Here's what we're about to build",
    body: "We show you the shape of the agent: what kind it is, which tools it'll use, which pieces it'll have. Right next to that — what we're sure about vs what we're guessing. Click one button to correct us if we got it wrong.",
    accent: "#d97757",
  },
  {
    minute: "15 min",
    icon: "▣",
    title: "Real code, right in front of me",
    subtitle: "Every file, generated live",
    body: "Files appear one at a time, like watching someone code. Flip to the Preview tab and see the agent actually run in safe test mode — printing exactly what it'll print in production. Eleven quality checks run at the bottom. All green, or the download button stays locked.",
    accent: "#8b5cf6",
  },
  {
    minute: "30 min",
    icon: "✓",
    title: "This is exactly what I wanted",
    subtitle: "Chat to fix, then download — once",
    body: "Type what needs changing: \"use Postgres not MySQL,\" \"add a Slack tool,\" whatever. We show you the exact edits before applying them. When every quality check is green and you tick \"yes, this matches,\" you download the folder. That's the one and only time.",
    accent: "#f59e0b",
  },
  {
    minute: "60 min",
    icon: "◉",
    title: "Real users are talking to it",
    subtitle: "Live in your production",
    body: "Unzip the folder into your codebase. Add your API keys. Replace the placeholder tool calls with your real services. Flip the switch from test to live. Deploy however you normally deploy. A checklist on our site ticks green as each step passes.",
    accent: "#22d3ee",
  },
];

function JourneyTimeline() {
  return (
    <section
      aria-label="The five-checkpoint journey"
      style={{ marginTop: 22 }}
    >
      <div
        style={{
          fontSize: 10,
          letterSpacing: "0.22em",
          textTransform: "uppercase",
          color: "rgba(255,255,255,0.55)",
          marginBottom: 10,
        }}
      >
        Five steps · you download once, at step 4
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(175px, 1fr))",
          gap: 8,
        }}
      >
        {CHECKPOINTS.map((c, i) => (
          <article
            key={c.minute}
            style={{
              position: "relative",
              padding: "12px 12px 14px",
              background: "rgba(255,255,255,0.02)",
              border: `1px solid ${c.accent}30`,
              borderRadius: 10,
              borderLeft: `3px solid ${c.accent}`,
              transition: "background 180ms ease",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                marginBottom: 6,
              }}
            >
              <span
                style={{
                  fontSize: 11,
                  color: c.accent,
                  fontWeight: 700,
                  letterSpacing: "0.05em",
                }}
              >
                {c.icon} {c.minute.toUpperCase()}
              </span>
              {i < CHECKPOINTS.length - 1 ? (
                <span
                  style={{
                    flex: 1,
                    borderTop: `1px dashed ${c.accent}40`,
                    marginLeft: 6,
                  }}
                  aria-hidden="true"
                />
              ) : null}
            </div>
            <div
              style={{
                fontSize: 14,
                fontWeight: 600,
                color: "#fff",
                marginBottom: 2,
                letterSpacing: "-0.01em",
              }}
            >
              {c.title}
            </div>
            <div
              style={{
                fontSize: 11,
                color: c.accent,
                marginBottom: 8,
                fontWeight: 500,
              }}
            >
              {c.subtitle}
            </div>
            <p
              style={{
                margin: 0,
                fontSize: 12,
                color: "rgba(255,255,255,0.68)",
                lineHeight: 1.5,
              }}
            >
              {c.body}
            </p>
          </article>
        ))}
      </div>
      <p
        style={{
          margin: "12px 0 0",
          fontSize: 12,
          color: "rgba(255,255,255,0.6)",
          lineHeight: 1.55,
          maxWidth: 780,
        }}
      >
        The download button stays locked until step 4 (thirty minutes in).
        That's on purpose. We'd rather you download once &mdash; slowly,
        with every quality check green and you confident it matches
        &mdash; than copy-fix-copy-fix forever.
      </p>
    </section>
  );
}

// --- 1-min checkpoint: "it's alive" signal -------------------------------
// A pulsing streaming badge with a live latency counter. The whole point
// is to make the classifier feel real and responsive during the first
// <5 seconds after submit — otherwise users stare at a blank checklist
// and assume the page is broken.
function ClassifierStatusBadge({
  status,
}: {
  status: string;
}) {
  const isStreaming = status === "classifying" || status === "understanding";
  const isDone = status === "ready" || status === "accepted";
  const [elapsedMs, setElapsedMs] = useState(0);
  const startRef = useRef<number>(Date.now());
  useEffect(() => {
    if (!isStreaming) return;
    startRef.current = Date.now();
    setElapsedMs(0);
    const id = window.setInterval(() => {
      setElapsedMs(Date.now() - startRef.current);
    }, 100);
    return () => window.clearInterval(id);
  }, [isStreaming]);

  const label = isDone
    ? "Triage complete"
    : status === "classifying"
      ? "Gemini Flash Lite · streaming"
      : "Understanding your workflow…";

  const dotColor = isDone ? "#22c55e" : "#d97757";
  const pulsing = isStreaming;
  const elapsedSec = (elapsedMs / 1000).toFixed(1);
  const slo = elapsedMs < 2000 ? "within SLO" : elapsedMs < 5000 ? "nominal" : "slow";
  const sloColor =
    elapsedMs < 2000
      ? "#22c55e"
      : elapsedMs < 5000
        ? "rgba(255,255,255,0.5)"
        : "#f59e0b";

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        fontSize: 11,
        letterSpacing: "0.18em",
        textTransform: "uppercase",
        color: "rgba(255,255,255,0.72)",
      }}
      aria-live="polite"
    >
      <span
        style={{
          width: 10,
          height: 10,
          borderRadius: "50%",
          background: dotColor,
          boxShadow: pulsing ? `0 0 0 0 ${dotColor}66` : "none",
          animation: pulsing ? "attritionPulse 1.3s ease-out infinite" : "none",
        }}
        aria-hidden="true"
      />
      <span>{label}</span>
      {isStreaming ? (
        <span
          style={{
            fontVariantNumeric: "tabular-nums",
            color: sloColor,
            letterSpacing: "0.05em",
            textTransform: "none",
          }}
          aria-label={`elapsed ${elapsedSec} seconds, ${slo}`}
        >
          · {elapsedSec}s · {slo}
        </span>
      ) : null}
      <style
        dangerouslySetInnerHTML={{
          __html: `
            @keyframes attritionPulse {
              0%   { box-shadow: 0 0 0 0 rgba(217,119,87,0.55); }
              70%  { box-shadow: 0 0 0 10px rgba(217,119,87,0); }
              100% { box-shadow: 0 0 0 0 rgba(217,119,87,0); }
            }
          `,
        }}
      />
    </div>
  );
}

function RecentSessionsPanel() {
  const [items, setItems] = useState<RecentSession[]>(() => loadRecentSessions());
  // Refresh list when the page regains focus (user came back from Builder)
  useEffect(() => {
    const refresh = () => setItems(loadRecentSessions());
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, []);
  if (items.length === 0) return null;
  return (
    <section
      aria-label="Recent sessions"
      style={{
        margin: "28px 0 0",
        padding: "14px 16px",
        background: "rgba(255,255,255,0.02)",
        border: "1px solid rgba(255,255,255,0.06)",
        borderRadius: 10,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          marginBottom: 10,
        }}
      >
        <div
          style={{
            fontSize: 10,
            letterSpacing: "0.22em",
            textTransform: "uppercase",
            color: "rgba(255,255,255,0.6)",
          }}
        >
          Recent sessions · local to this browser
        </div>
        <button
          type="button"
          onClick={() => {
            if (typeof window !== "undefined") {
              window.localStorage.removeItem(RECENT_SESSIONS_KEY);
            }
            setItems([]);
          }}
          style={{
            fontSize: 10,
            padding: "2px 8px",
            background: "transparent",
            border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: 4,
            color: "rgba(255,255,255,0.55)",
            cursor: "pointer",
          }}
        >
          Clear
        </button>
      </div>
      <ul
        style={{
          listStyle: "none",
          padding: 0,
          margin: 0,
          display: "grid",
          gap: 6,
        }}
      >
        {items.map((r) => (
          <li key={r.slug}>
            <a
              href={`/build/${r.slug}`}
              style={{
                display: "flex",
                gap: 10,
                padding: "8px 10px",
                background: "rgba(0,0,0,0.2)",
                border: "1px solid rgba(255,255,255,0.06)",
                borderRadius: 6,
                color: "rgba(255,255,255,0.82)",
                textDecoration: "none",
                fontSize: 12,
                lineHeight: 1.45,
              }}
            >
              <code
                style={{
                  fontSize: 10,
                  color: "#d97757",
                  fontFamily: "'JetBrains Mono', monospace",
                  flex: "0 0 auto",
                }}
              >
                {r.slug.slice(0, 8)}
              </code>
              <span style={{ flex: "1 1 auto", opacity: 0.85 }}>
                {r.prompt_preview || "(no prompt preview)"}
              </span>
              <span
                style={{
                  flex: "0 0 auto",
                  fontSize: 10,
                  color: "rgba(255,255,255,0.45)",
                }}
              >
                {new Date(r.ts).toLocaleDateString()}
              </span>
            </a>
          </li>
        ))}
      </ul>
    </section>
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
