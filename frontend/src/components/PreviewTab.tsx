/**
 * PreviewTab — xterm-style simulator of `./run.sh --mock`.
 *
 * Renders a fake-but-representative terminal output showing exactly what
 * the emitted scaffold would print when the user runs it in mock mode.
 * This is the **"literally see the output"** moment of the 15-min
 * checkpoint — users watch mock connector responses flow, so they can
 * verify the scaffold's *shape* before they download.
 *
 * Per-runtime-lane scripts are intentionally short (6-12 lines) and
 * match the real emitted scaffold's print statements. If the real
 * scaffold ever diverges from these scripts, update both sides.
 *
 * This is a simulation, NOT a sandboxed Docker exec — that's a Layer 2
 * eval concern. The simulation is a UX trust signal, not a correctness
 * oracle.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation } from "convex/react";
import { api } from "../_convex/api";

type Line = {
  delayMs: number;
  kind: "cmd" | "stdout" | "stderr" | "ok" | "info";
  text: string;
};

const SCRIPTS: Record<string, Line[]> = {
  simple_chain: [
    { delayMs: 0, kind: "cmd", text: "$ CONNECTOR_MODE=mock ./run.sh" },
    { delayMs: 400, kind: "info", text: "[runner] loading workflow_spec.json ..." },
    { delayMs: 250, kind: "info", text: "[runner] model=gemini-3.1-flash-lite-preview, connector=mock" },
    { delayMs: 400, kind: "stdout", text: "[chain] prompt -> model ..." },
    { delayMs: 900, kind: "stdout", text: "[chain] model returned {status:'ok', summary:'(mock canned response)'}" },
    { delayMs: 300, kind: "ok", text: "✓ Run complete in 1.2s · tokens in=180 out=42 · cost=$0.0004" },
  ],
  tool_first_chain: [
    { delayMs: 0, kind: "cmd", text: "$ CONNECTOR_MODE=mock ./run.sh" },
    { delayMs: 400, kind: "info", text: "[runner] loading workflow_spec.json ..." },
    { delayMs: 250, kind: "info", text: "[runner] model=gpt-5.4, connector=mock, tools=[kb_search, draft_reply, slack_notify]" },
    { delayMs: 400, kind: "stdout", text: "[turn 1] model requested tool: kb_search('refund policy')" },
    { delayMs: 500, kind: "stdout", text: "[mock] kb_search → 3 canned snippets" },
    { delayMs: 300, kind: "stdout", text: "[turn 2] model requested tool: draft_reply(tone='supportive')" },
    { delayMs: 500, kind: "stdout", text: '[mock] draft_reply → "Thanks for reaching out. Based on our..."' },
    { delayMs: 300, kind: "stdout", text: "[turn 3] model requested tool: slack_notify(channel='support')" },
    { delayMs: 250, kind: "info", text: "[mock] slack_notify → suppressed (CONNECTOR_MODE=mock)" },
    { delayMs: 300, kind: "stdout", text: "[turn 4] model emitted final answer" },
    { delayMs: 300, kind: "ok", text: "✓ Run complete in 3.1s · turns=4 · tokens in=1420 out=380 · cost=$0.0031" },
  ],
  orchestrator_worker: [
    { delayMs: 0, kind: "cmd", text: "$ CONNECTOR_MODE=mock ./run.sh" },
    { delayMs: 400, kind: "info", text: "[runner] loading workflow_spec.json ..." },
    { delayMs: 250, kind: "info", text: "[runner] orchestrator=claude-sonnet-4.6, workers=3, connector=mock" },
    { delayMs: 400, kind: "stdout", text: "[orchestrator] plan -> {worker_A: SKU lookup, worker_B: order place, worker_C: EOD summary}" },
    { delayMs: 600, kind: "stdout", text: "[worker_A] dispatch sku_lookup('SKU-442') ..." },
    { delayMs: 400, kind: "stdout", text: "[mock] sku_lookup → {stock: 120, price: 19.99}" },
    { delayMs: 400, kind: "stdout", text: "[worker_B] dispatch order_place('SKU-442', qty=50) ..." },
    { delayMs: 400, kind: "stdout", text: "[mock] order_place → {order_id: 'MOCK-ORD-7712', status: 'accepted'}" },
    { delayMs: 400, kind: "stdout", text: "[worker_C] dispatch eod_summary('2026-04-21') ..." },
    { delayMs: 400, kind: "stdout", text: "[mock] eod_summary → {orders: 14, revenue: 1832.00}" },
    { delayMs: 300, kind: "stdout", text: "[orchestrator] compact scratchpad → {status: 'ok', summary: 1 order placed, 14 EOD}" },
    { delayMs: 300, kind: "ok", text: "✓ Run complete in 4.4s · 3 workers · turns=12 · tokens in=3820 out=1100 · cost=$0.0120" },
  ],
  openai_agents_sdk: [
    { delayMs: 0, kind: "cmd", text: "$ CONNECTOR_MODE=mock ./run.sh" },
    { delayMs: 400, kind: "info", text: "[runner] OpenAI Agents SDK · model=gpt-5.4 · connector=mock" },
    { delayMs: 400, kind: "stdout", text: "[Runner.run_sync] Agent='support_drafter' starting ..." },
    { delayMs: 500, kind: "stdout", text: "[mock] function_tool kb_search invoked" },
    { delayMs: 400, kind: "stdout", text: "[mock] function_tool draft_reply invoked" },
    { delayMs: 400, kind: "stdout", text: "[Runner.run_sync] Agent returned final_output (mock)" },
    { delayMs: 300, kind: "ok", text: "✓ Run complete in 2.7s · final_output len=180 · cost=$0.0028" },
  ],
  langgraph_python: [
    { delayMs: 0, kind: "cmd", text: "$ CONNECTOR_MODE=mock ./run.sh" },
    { delayMs: 400, kind: "info", text: "[runner] LangGraph · chat_model=gemini-3-pro · connector=mock" },
    { delayMs: 400, kind: "stdout", text: "[graph] node 'plan' entered" },
    { delayMs: 500, kind: "stdout", text: "[graph] node 'tool_dispatch' → mock tool returned" },
    { delayMs: 400, kind: "stdout", text: "[graph] node 'compact' → state reduced" },
    { delayMs: 300, kind: "stdout", text: "[graph] END state reached" },
    { delayMs: 300, kind: "ok", text: "✓ Run complete in 2.3s · checkpoint saved · cost=$0.0018" },
  ],
};

const DEFAULT_SCRIPT: Line[] = SCRIPTS.tool_first_chain;

function scriptFor(runtimeLane: string): Line[] {
  return SCRIPTS[runtimeLane] ?? DEFAULT_SCRIPT;
}

function lineColor(kind: Line["kind"]): string {
  switch (kind) {
    case "cmd":
      return "#d97757";
    case "stdout":
      return "rgba(255,255,255,0.88)";
    case "stderr":
      return "#ef4444";
    case "ok":
      return "#22c55e";
    case "info":
      return "rgba(255,255,255,0.55)";
  }
}

// Per-script-line metadata for converting terminal output into real trace
// spans. When a user clicks "Record this run", we walk the script and
// emit one agentTraceSpans row per line (with lane-matching costs +
// token estimates so the /runs/:runId viewer shows realistic data).
// This is the Tier-1 MVP — the numbers are scripted, not observed from
// a real LLM run. Tier 2 swaps the scripted source for real exec.
type ScriptSpan = {
  kind: "meta" | "llm" | "tool" | "compact" | "handoff" | "wait";
  name: string;
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
  modelLabel?: string;
  inputJson?: string;
  outputJson?: string;
};

function spanFromLine(line: Line, lane: string): ScriptSpan | null {
  const text = line.text;
  if (line.kind === "cmd") {
    return {
      kind: "meta",
      name: "run_start",
      inputJson: JSON.stringify({ command: text.replace(/^\$\s*/, "") }),
    };
  }
  if (/^\[runner\]/.test(text)) {
    return { kind: "meta", name: "runner.init", outputJson: JSON.stringify({ info: text }) };
  }
  if (/^\[orchestrator\]\s+plan/.test(text)) {
    return {
      kind: "llm",
      name: "orchestrator.plan",
      modelLabel: lane === "orchestrator_worker" ? "claude-sonnet-4.6" : "gemini-3.1-flash-lite-preview",
      inputTokens: 420,
      outputTokens: 180,
      costUsd: 0.0026,
      inputJson: JSON.stringify({ task: "plan worker dispatch" }),
      outputJson: JSON.stringify({ plan: text.split("->")[1]?.trim() ?? text }),
    };
  }
  if (/^\[worker_/.test(text)) {
    const workerMatch = text.match(/\[worker_([A-Z])\]/);
    const toolMatch = text.match(/dispatch\s+(\w+)/);
    return {
      kind: "handoff",
      name: `handoff→${workerMatch ? "worker_" + workerMatch[1] : "worker"}${toolMatch ? " ("+toolMatch[1]+")" : ""}`,
      inputJson: JSON.stringify({ invocation: text }),
    };
  }
  if (/^\[mock\]/.test(text)) {
    const toolMatch = text.match(/\[mock\]\s+(\w+)/);
    return {
      kind: "tool",
      name: toolMatch ? toolMatch[1] : "mock_tool",
      inputJson: JSON.stringify({ connector: "mock" }),
      outputJson: JSON.stringify({ result: text }),
    };
  }
  if (/^\[orchestrator\]\s+compact/.test(text)) {
    return {
      kind: "compact",
      name: "scratchpad.compact",
      inputJson: JSON.stringify({ before_tokens: 2840, phase: "post-worker" }),
      outputJson: JSON.stringify({ after_tokens: 620, info: text }),
    };
  }
  if (/^\[turn\s+\d+\]/.test(text)) {
    return {
      kind: "llm",
      name: text.match(/^\[turn\s+(\d+)\]/)![0],
      modelLabel: "gpt-5.4-nano",
      inputTokens: 350,
      outputTokens: 110,
      costUsd: 0.0012,
      inputJson: JSON.stringify({ history_turns: 1 }),
      outputJson: JSON.stringify({ note: text }),
    };
  }
  if (/^\[graph\]/.test(text)) {
    return {
      kind: "tool",
      name: "graph.node",
      inputJson: JSON.stringify({ step: text }),
    };
  }
  if (/^\[Runner\.run_sync\]/.test(text)) {
    return {
      kind: "llm",
      name: "Runner.run_sync",
      modelLabel: "gpt-5.4-nano",
      inputTokens: 380,
      outputTokens: 120,
      costUsd: 0.0014,
      outputJson: JSON.stringify({ info: text }),
    };
  }
  if (/^✓/.test(text)) {
    return {
      kind: "meta",
      name: "run_end",
      outputJson: JSON.stringify({ summary: text }),
    };
  }
  // Info / stderr lines become lightweight wait spans
  if (line.kind === "info") {
    return { kind: "wait", name: "runner.info", outputJson: JSON.stringify({ info: text }) };
  }
  return null;
}

function randomRunId(): string {
  const rand = Math.random().toString(36).slice(2, 10);
  const ts = Date.now().toString(36);
  return `${ts}-${rand}`;
}

export function PreviewTab({
  runtimeLane,
  sessionSlug,
}: {
  runtimeLane: string;
  sessionSlug?: string | null;
}) {
  const script = useMemo(() => scriptFor(runtimeLane), [runtimeLane]);
  const [visible, setVisible] = useState<Line[]>([]);
  const [running, setRunning] = useState(false);
  const [runCount, setRunCount] = useState(0);
  const [recordingRun, setRecordingRun] = useState(false);
  const [recordedRunId, setRecordedRunId] = useState<string | null>(null);
  const startRun = useMutation(api.domains.daas.agentTrace.startRun);
  const recordSpan = useMutation(api.domains.daas.agentTrace.recordSpan);
  const finishRun = useMutation(api.domains.daas.agentTrace.finishRun);
  const timersRef = useRef<number[]>([]);
  const termRef = useRef<HTMLDivElement | null>(null);

  const clearTimers = () => {
    timersRef.current.forEach((t) => window.clearTimeout(t));
    timersRef.current = [];
  };

  const run = () => {
    clearTimers();
    setVisible([]);
    setRunning(true);
    let cumulative = 0;
    script.forEach((line) => {
      cumulative += line.delayMs;
      const id = window.setTimeout(() => {
        setVisible((v) => [...v, line]);
        if (termRef.current) {
          termRef.current.scrollTop = termRef.current.scrollHeight;
        }
      }, cumulative);
      timersRef.current.push(id);
    });
    const doneId = window.setTimeout(() => setRunning(false), cumulative + 100);
    timersRef.current.push(doneId);
  };

  useEffect(() => {
    // Auto-run once on tab mount
    run();
    return () => clearTimers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runtimeLane, runCount]);

  // Record the same scripted run as real Convex trace spans, then open
  // /runs/:runId in a new tab. Tier-1 MVP: the trace data reflects the
  // shape + timing of the simulation, not a real LLM exec. Tier 2
  // replaces the script with observed events from a sandbox runner.
  async function recordAsTrace(): Promise<void> {
    if (recordingRun) return;
    setRecordingRun(true);
    const runId = randomRunId();
    try {
      await startRun({
        runId,
        sessionSlug: sessionSlug ?? undefined,
        runtimeLane,
        driverRuntime: "gemini_agent",
        mode: "mock",
        input: `Mock preview replay for lane=${runtimeLane}. This is a scripted demonstration of the scaffold's expected shape, recorded as a real trace run for inspection.`,
      });
      // Emit spans in sequence with realistic gaps so the timeline
      // shows progression. Each line's scripted delay maps to its
      // finishedAt offset.
      let cumulativeMs = 0;
      const runStartedAt = Date.now();
      for (let i = 0; i < script.length; i++) {
        const line = script[i];
        cumulativeMs += line.delayMs;
        const s = spanFromLine(line, runtimeLane);
        if (!s) continue;
        const spanStart = runStartedAt + cumulativeMs;
        const spanEnd = spanStart + Math.max(80, line.delayMs);
        await recordSpan({
          runId,
          spanId: `span-${i.toString().padStart(4, "0")}`,
          kind: s.kind,
          name: s.name,
          startedAt: spanStart,
          finishedAt: spanEnd,
          inputJson: s.inputJson ?? JSON.stringify({}),
          outputJson: s.outputJson ?? JSON.stringify({}),
          inputTokens: s.inputTokens,
          outputTokens: s.outputTokens,
          costUsd: s.costUsd,
          modelLabel: s.modelLabel,
        });
      }
      await finishRun({
        runId,
        status: "complete",
        finalOutput: "Mock-mode replay complete — see spans above for per-step detail.",
      });
      setRecordedRunId(runId);
      // Try popup first (preferred: leaves the Builder context intact).
      // If the browser blocks it, the "open last trace ↗" button in the
      // recorder UI will navigate in the same tab instead.
      const popup = window.open(`/runs/${runId}`, "_blank", "noopener");
      if (!popup) {
        // Popup blocked — fall back to in-tab navigation
        window.location.href = `/runs/${runId}`;
      }
    } catch (err) {
      console.error("recordAsTrace failed", err);
    } finally {
      setRecordingRun(false);
    }
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}
    >
      <div
        style={{
          padding: "12px 14px",
          background: "rgba(34,197,94,0.05)",
          border: "1px solid rgba(34,197,94,0.3)",
          borderRadius: 8,
          fontSize: 12,
          color: "rgba(255,255,255,0.8)",
          lineHeight: 1.5,
        }}
      >
        <strong style={{ color: "#22c55e" }}>Mock exec preview.</strong>{" "}
        This simulates what <code style={{ fontSize: 11 }}>./run.sh</code> prints with{" "}
        <code style={{ fontSize: 11 }}>CONNECTOR_MODE=mock</code>. No real API calls, no real
        credentials — just the shape of what your scaffold will do when you
        run it locally. Replace the <code style={{ fontSize: 11 }}>_live_&lt;tool&gt;.py</code>{" "}
        stubs in the downloaded ZIP with your real handlers, flip to{" "}
        <code style={{ fontSize: 11 }}>CONNECTOR_MODE=live</code>, and you're in prod.
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "6px 12px",
          background: "rgba(0,0,0,0.5)",
          border: "1px solid rgba(255,255,255,0.08)",
          borderTopLeftRadius: 8,
          borderTopRightRadius: 8,
          borderBottom: "none",
        }}
      >
        <div
          style={{
            display: "flex",
            gap: 6,
            alignItems: "center",
          }}
        >
          <span style={{ width: 10, height: 10, borderRadius: "50%", background: "#ef4444" }} />
          <span style={{ width: 10, height: 10, borderRadius: "50%", background: "#f59e0b" }} />
          <span style={{ width: 10, height: 10, borderRadius: "50%", background: "#22c55e" }} />
          <span
            style={{
              marginLeft: 12,
              fontSize: 11,
              color: "rgba(255,255,255,0.55)",
              fontFamily: "'JetBrains Mono', monospace",
              letterSpacing: "0.02em",
            }}
          >
            bash · {runtimeLane || "default"} · mock
          </span>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <button
            type="button"
            onClick={() => {
              if (recordingRun) return;
              if (recordedRunId) {
                // Already recorded — open in same tab (popup-blocker safe)
                window.location.href = `/runs/${recordedRunId}`;
                return;
              }
              void recordAsTrace();
            }}
            disabled={recordingRun || running}
            title={
              recordedRunId
                ? `Open /runs/${recordedRunId}`
                : "Record this run as a live trace in /runs/:runId"
            }
            style={{
              padding: "4px 10px",
              background: recordingRun ? "rgba(255,255,255,0.05)" : "rgba(34,197,94,0.18)",
              border: "1px solid rgba(34,197,94,0.4)",
              borderRadius: 5,
              color: recordingRun ? "rgba(255,255,255,0.4)" : "#fff",
              fontSize: 11,
              cursor: recordingRun || running ? "not-allowed" : "pointer",
              fontFamily: "'JetBrains Mono', monospace",
            }}
          >
            {recordingRun ? "recording…" : recordedRunId ? "open last trace ↗" : "record live trace ↗"}
          </button>
          <button
            type="button"
            onClick={() => setRunCount((c) => c + 1)}
            disabled={running}
            style={{
              padding: "4px 10px",
              background: running ? "rgba(255,255,255,0.05)" : "rgba(217,119,87,0.18)",
              border: "1px solid rgba(217,119,87,0.35)",
              borderRadius: 5,
              color: running ? "rgba(255,255,255,0.4)" : "#fff",
              fontSize: 11,
              cursor: running ? "not-allowed" : "pointer",
              fontFamily: "'JetBrains Mono', monospace",
            }}
          >
            {running ? "running…" : "replay"}
          </button>
        </div>
      </div>

      <div
        ref={termRef}
        role="log"
        aria-live="polite"
        aria-label="Mock execution terminal output"
        style={{
          minHeight: 280,
          maxHeight: 480,
          overflowY: "auto",
          padding: 14,
          background: "#050504",
          border: "1px solid rgba(255,255,255,0.08)",
          borderTop: "none",
          borderBottomLeftRadius: 8,
          borderBottomRightRadius: 8,
          fontFamily: "'JetBrains Mono', 'Menlo', monospace",
          fontSize: 12,
          lineHeight: 1.65,
          marginTop: -12,
        }}
      >
        {visible.map((line, i) => (
          <div
            key={i}
            style={{
              color: lineColor(line.kind),
              whiteSpace: "pre-wrap",
              animation: "attritionTerminalFade 140ms ease-in",
            }}
          >
            {line.text}
          </div>
        ))}
        {running ? (
          <div
            style={{
              display: "inline-block",
              width: 8,
              height: 14,
              background: "#d97757",
              marginTop: 2,
              animation: "attritionCursorBlink 900ms step-end infinite",
            }}
            aria-hidden="true"
          />
        ) : null}
      </div>

      <div
        style={{
          padding: "10px 14px",
          background: "rgba(255,255,255,0.02)",
          border: "1px solid rgba(255,255,255,0.06)",
          borderRadius: 8,
          fontSize: 11,
          color: "rgba(255,255,255,0.5)",
          lineHeight: 1.55,
        }}
      >
        <strong style={{ color: "rgba(255,255,255,0.75)" }}>What this proves:</strong>{" "}
        the scaffold's orchestration shape, tool-dispatch order, and connector-resolver
        boundary are all exercised. What it doesn't prove: live network calls, real
        credentials, real latency. Those land in the 60-min checkpoint — see the
        Download ZIP confirmation for the post-download walkthrough.
      </div>

      <style
        dangerouslySetInnerHTML={{
          __html: `
            @keyframes attritionTerminalFade {
              from { opacity: 0; transform: translateY(2px); }
              to   { opacity: 1; transform: translateY(0); }
            }
            @keyframes attritionCursorBlink {
              0%, 60%  { opacity: 1; }
              61%, 100% { opacity: 0; }
            }
          `,
        }}
      />
    </div>
  );
}
