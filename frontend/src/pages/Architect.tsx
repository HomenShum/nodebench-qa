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

type TranscriptTurn = { ts: number; role: "user" | "assistant"; content: string };

const STARTER_CHIPS = [
  "Make my expensive agent cheaper",
  "Migrate my legacy chain to a stronger scaffold",
  "Turn my Claude Code workflow into a production runtime",
  "Show me what this would look like as an orchestrator-worker system",
] as const;

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

function shortSlug(): string {
  return Math.random().toString(36).slice(2, 10);
}

export function Architect() {
  const [prompt, setPrompt] = useState("");
  const [slug, setSlug] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();

  const createSession = useMutation(api.domains.daas.architect.createSession);
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

  async function submit() {
    if (!prompt.trim() || submitting) return;
    setSubmitting(true);
    const s = shortSlug();
    try {
      await createSession({ sessionSlug: s, prompt: prompt.trim() });
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
      <main style={{ maxWidth: 960, margin: "0 auto", padding: "40px 32px 80px" }}>
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
            Architect
          </div>
          <h1 style={{ fontSize: 30, fontWeight: 600, margin: 0, letterSpacing: "-0.01em" }}>
            Describe your workflow.
          </h1>
          <p
            style={{
              fontSize: 15,
              color: "rgba(255,255,255,0.6)",
              margin: "8px 0 0",
              maxWidth: 680,
              lineHeight: 1.5,
            }}
          >
            We'll tell you what runtime to use, what world model you need, and
            whether the distillation gap is even real — before you spend on
            a scaffold that might be decoration.
          </p>
        </header>

        {!slug ? (
          <section>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
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
                  void submit();
                }
              }}
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
                fontSize: 11,
                letterSpacing: "0.2em",
                textTransform: "uppercase",
                color: "rgba(255,255,255,0.5)",
                marginBottom: 10,
              }}
            >
              {session?.status === "ready" || session?.status === "accepted"
                ? "Triage complete"
                : session?.status === "classifying"
                  ? "Classifying…"
                  : "Understanding…"}
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

                <div style={{ display: "flex", gap: 12, justifyContent: "flex-end" }}>
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
                    Accept → open Builder
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
