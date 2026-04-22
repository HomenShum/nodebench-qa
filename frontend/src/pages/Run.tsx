/**
 * Run — live agent trace viewer at /runs/:runId.
 *
 * See docs/LIVE_RUN_AND_TRACE_ADR.md for the full architecture.
 *
 * Subscribes to:
 *   api.domains.daas.agentTrace.getRun              (header metadata)
 *   api.domains.daas.agentTrace.listSpansForRun     (timeline)
 *
 * Renders a step-card timeline with:
 *   - Run header (lane / driver / cost / tokens / status)
 *   - Filter chips (all | llm only | tool only | errors only)
 *   - Expandable per-span cards with input / output / prompt / metadata
 *
 * Design references in the ADR: LangSmith run viewer, Arize AX trace
 * detail, Convex Chef live preview.
 */

import { useMemo, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useQuery } from "convex/react";
import { api } from "../_convex/api";
import { Nav } from "../components/Nav";

type SpanKind = "llm" | "tool" | "compact" | "handoff" | "wait" | "meta";

type FilterMode = "all" | "llm" | "tool" | "errors";

const KIND_ACCENT: Record<SpanKind, string> = {
  llm: "#8b5cf6",      // purple
  tool: "#22c55e",     // green
  compact: "#22d3ee",  // cyan
  handoff: "#f59e0b",  // amber
  wait: "rgba(255,255,255,0.35)",
  meta: "#d97757",     // terracotta
};

const KIND_LABEL: Record<SpanKind, string> = {
  llm: "LLM",
  tool: "TOOL",
  compact: "COMPACT",
  handoff: "HANDOFF",
  wait: "WAIT",
  meta: "META",
};

function durationLabel(startedAt: number, finishedAt: number | null): string {
  if (finishedAt == null) return "running…";
  const ms = finishedAt - startedAt;
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function costLabel(cost: number | null): string {
  if (cost == null || cost === 0) return "—";
  if (cost < 0.0001) return `$${cost.toFixed(6)}`;
  return `$${cost.toFixed(4)}`;
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + "…";
}

function tryPrettyJson(s: string): string {
  try {
    const parsed = JSON.parse(s);
    return JSON.stringify(parsed, null, 2);
  } catch {
    return s;
  }
}

export function Run() {
  const { runId } = useParams<{ runId: string }>();
  const run = useQuery(
    api.domains.daas.agentTrace.getRun,
    runId ? { runId } : "skip",
  );
  const spans = useQuery(
    api.domains.daas.agentTrace.listSpansForRun,
    runId ? { runId } : "skip",
  );
  const [filter, setFilter] = useState<FilterMode>("all");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const filteredSpans = useMemo(() => {
    if (!spans) return [];
    switch (filter) {
      case "llm":
        return spans.filter((s) => s.kind === "llm");
      case "tool":
        return spans.filter((s) => s.kind === "tool");
      case "errors":
        return spans.filter((s) => !!s.errorMessage);
      default:
        return spans;
    }
  }, [spans, filter]);

  // Baseline for time-offset display. Using the first span's startedAt
  // rather than run.startedAt avoids clock-skew artifacts (browser
  // Date.now() vs Convex server Date.now() differ by round-trip time,
  // which showed as misleading +116000ms offsets during dogfood).
  const timeBaseline = useMemo(() => {
    if (spans && spans.length > 0) return spans[0].startedAt;
    return run?.startedAt ?? Date.now();
  }, [spans, run?.startedAt]);

  const toggle = (spanId: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(spanId)) next.delete(spanId);
      else next.add(spanId);
      return next;
    });
  };

  if (!runId) {
    return (
      <div style={pageStyle}>
        <Nav />
        <main style={mainStyle}>
          <NotFoundCard message="No run id in the URL." />
        </main>
      </div>
    );
  }

  if (run === undefined || spans === undefined) {
    return (
      <div style={pageStyle}>
        <Nav />
        <main style={mainStyle}>
          <div style={{ opacity: 0.55, fontSize: 13 }}>
            Loading run <code>{runId}</code>…
          </div>
        </main>
      </div>
    );
  }

  if (run === null) {
    return (
      <div style={pageStyle}>
        <Nav />
        <main style={mainStyle}>
          <NotFoundCard
            message={`Run "${runId}" not found. It may have expired or never been created.`}
          />
        </main>
      </div>
    );
  }

  const isRunning = run.status === "running";
  const isFailed = run.status === "failed";
  const statusColor = isRunning
    ? "#22d3ee"
    : isFailed
      ? "#ef4444"
      : "#22c55e";
  const statusLabel = isRunning
    ? "running"
    : isFailed
      ? "failed"
      : "complete";

  return (
    <div style={pageStyle}>
      <Nav />
      <main style={mainStyle}>
        {/* Step label eyebrow — consistent with the 5-checkpoint vocabulary */}
        <div
          style={{
            fontSize: 10,
            letterSpacing: "0.22em",
            textTransform: "uppercase",
            color: "#d97757",
            fontWeight: 600,
            marginBottom: 10,
          }}
        >
          Live run · one card per step · shareable url
        </div>

        {/* Header */}
        <header style={{ marginBottom: 22 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              marginBottom: 6,
              flexWrap: "wrap",
            }}
          >
            <span
              style={{
                width: 10,
                height: 10,
                borderRadius: "50%",
                background: statusColor,
                animation: isRunning ? "runPulse 1.3s ease-out infinite" : "none",
              }}
              aria-hidden="true"
            />
            <h1
              style={{
                fontSize: 22,
                fontWeight: 600,
                margin: 0,
                letterSpacing: "-0.01em",
              }}
            >
              Run <code style={{ fontSize: 18, color: "#d97757" }}>{run.runId.slice(0, 12)}</code>
            </h1>
            <span
              style={{
                fontSize: 11,
                letterSpacing: "0.15em",
                textTransform: "uppercase",
                color: statusColor,
                fontWeight: 600,
              }}
            >
              {statusLabel}
            </span>
          </div>
          <div
            style={{
              fontSize: 12,
              color: "rgba(255,255,255,0.65)",
              display: "flex",
              gap: 12,
              flexWrap: "wrap",
            }}
          >
            <span>
              lane: <strong style={{ color: "#fff" }}>{run.runtimeLane}</strong>
            </span>
            <span style={dotStyle}>·</span>
            <span>
              driver: <strong style={{ color: "#fff" }}>{run.driverRuntime}</strong>
            </span>
            <span style={dotStyle}>·</span>
            <span>
              mode: <strong style={{ color: "#fff" }}>{run.mode}</strong>
            </span>
            <span style={dotStyle}>·</span>
            <span>
              {run.totalSpans} step{run.totalSpans === 1 ? "" : "s"}
            </span>
            <span style={dotStyle}>·</span>
            <span>
              tokens in <strong style={{ color: "#fff" }}>{run.totalInputTokens.toLocaleString()}</strong>{" "}
              / out <strong style={{ color: "#fff" }}>{run.totalOutputTokens.toLocaleString()}</strong>
            </span>
            <span style={dotStyle}>·</span>
            <span>
              cost <strong style={{ color: "#fff" }}>{costLabel(run.totalCostUsd)}</strong>
            </span>
            <span style={dotStyle}>·</span>
            <span>{durationLabel(run.startedAt, run.finishedAt)}</span>
          </div>
          {run.errorMessage ? (
            <div
              style={{
                marginTop: 10,
                padding: "10px 12px",
                background: "rgba(239,68,68,0.08)",
                border: "1px solid rgba(239,68,68,0.3)",
                borderRadius: 6,
                fontSize: 12,
                color: "rgba(239,68,68,0.9)",
                whiteSpace: "pre-wrap",
              }}
            >
              {run.errorMessage}
            </div>
          ) : null}
          {run.input ? (
            <details
              style={{
                marginTop: 10,
                padding: "8px 12px",
                background: "rgba(255,255,255,0.02)",
                border: "1px solid rgba(255,255,255,0.06)",
                borderRadius: 6,
              }}
            >
              <summary
                style={{
                  fontSize: 11,
                  letterSpacing: "0.15em",
                  textTransform: "uppercase",
                  color: "rgba(255,255,255,0.55)",
                  cursor: "pointer",
                }}
              >
                user input
              </summary>
              <pre
                style={{
                  margin: "8px 0 0",
                  fontSize: 12,
                  color: "rgba(255,255,255,0.82)",
                  whiteSpace: "pre-wrap",
                  fontFamily: "'JetBrains Mono', monospace",
                }}
              >
                {run.input}
              </pre>
            </details>
          ) : null}
        </header>

        {/* Filter chips */}
        <div
          style={{
            display: "flex",
            gap: 6,
            marginBottom: 12,
            flexWrap: "wrap",
          }}
        >
          {(["all", "llm", "tool", "errors"] as const).map((m) => {
            const active = filter === m;
            return (
              <button
                key={m}
                type="button"
                onClick={() => setFilter(m)}
                style={{
                  padding: "5px 12px",
                  background: active ? "rgba(217,119,87,0.2)" : "transparent",
                  border: `1px solid ${active ? "rgba(217,119,87,0.5)" : "rgba(255,255,255,0.1)"}`,
                  borderRadius: 999,
                  color: active ? "#fff" : "rgba(255,255,255,0.7)",
                  fontSize: 11,
                  textTransform: "uppercase",
                  letterSpacing: "0.1em",
                  cursor: "pointer",
                }}
              >
                {m}
                {m === "all" && spans ? ` · ${spans.length}` : ""}
                {m !== "all" && spans
                  ? ` · ${spans.filter((s) => (m === "errors" ? !!s.errorMessage : s.kind === m)).length}`
                  : ""}
              </button>
            );
          })}
        </div>

        {/* Timeline */}
        <section aria-label="Span timeline">
          {filteredSpans.length === 0 ? (
            <div
              style={{
                padding: 16,
                background: "rgba(255,255,255,0.02)",
                border: "1px dashed rgba(255,255,255,0.08)",
                borderRadius: 8,
                fontSize: 13,
                color: "rgba(255,255,255,0.55)",
              }}
            >
              {isRunning
                ? "Waiting for the first span…"
                : "No spans match this filter."}
            </div>
          ) : (
            <ol
              style={{
                listStyle: "none",
                padding: 0,
                margin: 0,
                display: "flex",
                flexDirection: "column",
                gap: 6,
              }}
            >
              {filteredSpans.map((span) => (
                <SpanCard
                  key={span.spanId}
                  span={span}
                  expanded={expanded.has(span.spanId)}
                  onToggle={() => toggle(span.spanId)}
                  runStartedAt={timeBaseline}
                />
              ))}
            </ol>
          )}
        </section>

        {/* Footer actions */}
        <div
          style={{
            marginTop: 28,
            display: "flex",
            gap: 10,
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
          }}
        >
          <span style={{ fontSize: 11, color: "rgba(255,255,255,0.5)" }}>
            Shareable link: <code>{typeof window !== "undefined" ? window.location.href : ""}</code>
          </span>
          {run.sessionSlug ? (
            <Link
              to={`/build/${run.sessionSlug}`}
              style={{
                padding: "8px 14px",
                background: "transparent",
                border: "1px solid rgba(255,255,255,0.15)",
                borderRadius: 8,
                color: "rgba(255,255,255,0.8)",
                fontSize: 13,
                textDecoration: "none",
              }}
            >
              ← Back to scaffold
            </Link>
          ) : null}
        </div>

        <style
          dangerouslySetInnerHTML={{
            __html: `
              @keyframes runPulse {
                0%   { box-shadow: 0 0 0 0 rgba(34,211,238,0.55); }
                70%  { box-shadow: 0 0 0 8px rgba(34,211,238,0); }
                100% { box-shadow: 0 0 0 0 rgba(34,211,238,0); }
              }
            `,
          }}
        />
      </main>
    </div>
  );
}

// ------------------------------------------------------------------ SpanCard

type Span = {
  spanId: string;
  parentSpanId: string | null;
  kind: string;
  name: string;
  startedAt: number;
  finishedAt: number | null;
  inputJson: string;
  outputJson: string;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
  modelLabel: string | null;
  errorMessage: string | null;
};

function SpanCard({
  span,
  expanded,
  onToggle,
  runStartedAt,
}: {
  span: Span;
  expanded: boolean;
  onToggle: () => void;
  runStartedAt: number;
}) {
  const kind = (span.kind as SpanKind) in KIND_ACCENT ? (span.kind as SpanKind) : "meta";
  const accent = KIND_ACCENT[kind];
  const label = KIND_LABEL[kind];
  const offsetMs = span.startedAt - runStartedAt;
  const offsetLabel = offsetMs < 1000 ? `+${offsetMs}ms` : `+${(offsetMs / 1000).toFixed(2)}s`;

  // Build a one-line summary for the collapsed state
  const tokenSummary =
    span.inputTokens != null || span.outputTokens != null
      ? `in=${span.inputTokens ?? "—"} out=${span.outputTokens ?? "—"}`
      : null;
  const summary = [
    span.modelLabel,
    tokenSummary,
    costLabel(span.costUsd),
    durationLabel(span.startedAt, span.finishedAt),
  ]
    .filter((x) => x && x !== "—")
    .join(" · ");

  return (
    <li
      style={{
        background: span.errorMessage ? "rgba(239,68,68,0.04)" : "rgba(255,255,255,0.02)",
        border: `1px solid ${span.errorMessage ? "rgba(239,68,68,0.3)" : `${accent}2a`}`,
        borderLeft: `3px solid ${accent}`,
        borderRadius: 8,
        overflow: "hidden",
      }}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "10px 12px",
          background: "transparent",
          border: "none",
          color: "inherit",
          textAlign: "left",
          cursor: "pointer",
        }}
      >
        <span
          style={{
            fontSize: 10,
            letterSpacing: "0.12em",
            color: accent,
            fontWeight: 600,
            flexShrink: 0,
            minWidth: 64,
          }}
        >
          {label}
        </span>
        <span
          style={{
            fontSize: 10,
            color: "rgba(255,255,255,0.45)",
            fontFamily: "'JetBrains Mono', monospace",
            flexShrink: 0,
            minWidth: 60,
          }}
        >
          {offsetLabel}
        </span>
        <span
          style={{
            fontSize: 13,
            color: "rgba(255,255,255,0.9)",
            fontWeight: 500,
            flexShrink: 0,
          }}
        >
          {span.name}
        </span>
        <span
          style={{
            flex: 1,
            fontSize: 11,
            color: "rgba(255,255,255,0.5)",
            fontFamily: "'JetBrains Mono', monospace",
            textAlign: "right",
          }}
        >
          {summary}
        </span>
        <span
          aria-hidden="true"
          style={{
            fontSize: 11,
            color: "rgba(255,255,255,0.4)",
            flexShrink: 0,
            width: 14,
          }}
        >
          {expanded ? "▾" : "▸"}
        </span>
      </button>

      {expanded ? (
        <div
          style={{
            padding: "12px 14px 14px",
            borderTop: `1px solid ${accent}22`,
            display: "grid",
            gap: 10,
          }}
        >
          {span.errorMessage ? (
            <div
              style={{
                padding: "8px 10px",
                background: "rgba(239,68,68,0.08)",
                border: "1px solid rgba(239,68,68,0.3)",
                borderRadius: 6,
                fontSize: 12,
                color: "rgba(239,68,68,0.95)",
                whiteSpace: "pre-wrap",
              }}
            >
              {span.errorMessage}
            </div>
          ) : null}
          <LabeledJson label="input" json={span.inputJson} />
          <LabeledJson label="output" json={span.outputJson} />
          {kind === "llm" || span.modelLabel ? (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
                gap: 8,
                fontSize: 11,
                color: "rgba(255,255,255,0.7)",
              }}
            >
              {span.modelLabel ? (
                <MetaPill label="model" value={span.modelLabel} />
              ) : null}
              {span.inputTokens != null ? (
                <MetaPill label="in tokens" value={String(span.inputTokens)} />
              ) : null}
              {span.outputTokens != null ? (
                <MetaPill label="out tokens" value={String(span.outputTokens)} />
              ) : null}
              {span.costUsd != null ? (
                <MetaPill label="cost" value={costLabel(span.costUsd)} />
              ) : null}
              {span.parentSpanId ? (
                <MetaPill label="parent" value={truncate(span.parentSpanId, 10)} />
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

function LabeledJson({ label, json }: { label: string; json: string }) {
  return (
    <div>
      <div
        style={{
          fontSize: 10,
          letterSpacing: "0.15em",
          textTransform: "uppercase",
          color: "rgba(255,255,255,0.45)",
          marginBottom: 4,
        }}
      >
        {label}
      </div>
      <pre
        style={{
          margin: 0,
          padding: "8px 10px",
          background: "rgba(0,0,0,0.35)",
          border: "1px solid rgba(255,255,255,0.06)",
          borderRadius: 6,
          fontSize: 11,
          color: "rgba(255,255,255,0.82)",
          fontFamily: "'JetBrains Mono', monospace",
          whiteSpace: "pre-wrap",
          maxHeight: 280,
          overflowY: "auto",
        }}
      >
        {tryPrettyJson(json)}
      </pre>
    </div>
  );
}

function MetaPill({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        padding: "5px 8px",
        background: "rgba(255,255,255,0.02)",
        border: "1px solid rgba(255,255,255,0.06)",
        borderRadius: 5,
      }}
    >
      <div
        style={{
          fontSize: 9,
          letterSpacing: "0.14em",
          textTransform: "uppercase",
          color: "rgba(255,255,255,0.4)",
          marginBottom: 2,
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: 12, color: "rgba(255,255,255,0.9)", fontFamily: "'JetBrains Mono', monospace" }}>
        {value}
      </div>
    </div>
  );
}

function NotFoundCard({ message }: { message: string }) {
  return (
    <div
      style={{
        padding: 24,
        background: "rgba(239,68,68,0.05)",
        border: "1px solid rgba(239,68,68,0.3)",
        borderRadius: 10,
        textAlign: "center",
      }}
    >
      <div
        style={{
          fontSize: 10,
          letterSpacing: "0.22em",
          textTransform: "uppercase",
          color: "#ef4444",
          marginBottom: 8,
          fontWeight: 600,
        }}
      >
        Run not found
      </div>
      <div style={{ fontSize: 14, color: "rgba(255,255,255,0.82)", marginBottom: 14 }}>
        {message}
      </div>
      <Link
        to="/"
        style={{
          padding: "8px 14px",
          background: "rgba(217,119,87,0.18)",
          border: "1px solid rgba(217,119,87,0.4)",
          borderRadius: 6,
          color: "#fff",
          fontSize: 13,
          textDecoration: "none",
        }}
      >
        Start a new triage →
      </Link>
    </div>
  );
}

// ----------------------------------------------------------- shared styles

const pageStyle: React.CSSProperties = {
  minHeight: "100vh",
  background: "#0b0a09",
  color: "rgba(255,255,255,0.92)",
  fontFamily: "'Manrope', -apple-system, sans-serif",
};

const mainStyle: React.CSSProperties = {
  maxWidth: 1040,
  margin: "0 auto",
  padding: "32px 28px 80px",
};

const dotStyle: React.CSSProperties = {
  color: "rgba(255,255,255,0.25)",
};
