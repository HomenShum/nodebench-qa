import { useState, useEffect, useCallback } from "react";
import { Layout } from "../components/Layout";

/* ── Types ─────────────────────────────────────────────────────── */

interface CodevIteration {
  iter: number;
  passRate: number;
  confidence: number;
  latency: number;
  changes: string;
  tools: string[];
  sources: string[];
  codeChanges: string[];
}

interface RetentionPacket {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  created_at: string;
}

/* ── Styles ────────────────────────────────────────────────────── */

const glass: React.CSSProperties = {
  borderRadius: "0.625rem",
  border: "1px solid rgba(255,255,255,0.06)",
  background: "#141415",
};

const mono: React.CSSProperties = {
  fontFamily: "'JetBrains Mono', monospace",
};

const sec: React.CSSProperties = {
  fontSize: "0.8125rem",
  color: "#9a9590",
  lineHeight: 1.6,
};

const label: React.CSSProperties = {
  fontSize: "0.6875rem",
  textTransform: "uppercase" as const,
  letterSpacing: "0.1em",
  color: "#9a9590",
  marginBottom: "0.5rem",
};

/* ── Fallback demo data ────────────────────────────────────────── */

const DEMO_ITERATIONS: CodevIteration[] = [
  {
    iter: 1,
    passRate: 80,
    confidence: 65,
    latency: 15.3,
    changes: "Initial search pipeline + eval harness",
    tools: ["searchPipeline.ts", "searchQualityEval.ts"],
    sources: ["Linkup API", "Gemini Flash Lite"],
    codeChanges: [
      "server/routes/search.ts: 4-layer grounding pipeline",
      "packages/mcp-local/src/benchmarks/searchQualityEval.ts: 53-query eval corpus",
    ],
  },
  {
    iter: 2,
    passRate: 70,
    confidence: 72,
    latency: 12.9,
    changes: "Entity resolution fix + multi-entity splitting",
    tools: ["entityEnrichmentTools.ts", "webTools.ts", "toolRegistry.ts"],
    sources: ["Linkup API", "Gemini Flash Lite", "OpenAI Extraction"],
    codeChanges: [
      "server/routes/search.ts: entity possessive/descriptor stripping",
      "server/routes/search.ts: multi-entity comparison branch",
      "packages/mcp-local/src/tools/entityEnrichmentTools.ts: company_search fallback chain",
    ],
  },
  {
    iter: 3,
    passRate: 80,
    confidence: 78,
    latency: 15.5,
    changes: "Grounded eval + claim-level verification",
    tools: ["searchQualityEval.ts", "llmJudgeEval.ts"],
    sources: ["arxiv:2510.24476", "Deepchecks", "Google Vertex AI"],
    codeChanges: [
      "server/routes/search.ts: isGrounded() claim filter",
      "server/routes/search.ts: retrievalConfidence threshold",
      "packages/mcp-local/src/benchmarks/searchQualityEval.ts: grounded judge metadata",
    ],
  },
  {
    iter: 4,
    passRate: 100,
    confidence: 88,
    latency: 15.2,
    changes: "Role lens shaping + temporal awareness",
    tools: ["searchQualityEval.ts", "toolRegistry.ts", "deepSimTools.ts"],
    sources: ["Gemini Flash Lite", "Linkup API"],
    codeChanges: [
      "server/routes/search.ts: lens-specific prompt templates (6 roles)",
      "server/routes/search.ts: temporal query detection + date parsing",
    ],
  },
  {
    iter: 5,
    passRate: 100,
    confidence: 94,
    latency: 13.1,
    changes: "Latency optimization + corpus expansion to 103 queries",
    tools: ["searchQualityEval.ts", "searchPipeline.ts", "webTools.ts"],
    sources: ["Linkup API", "Gemini Flash Lite", "HuggingFace Embeddings"],
    codeChanges: [
      "server/routes/search.ts: Promise.race timeout tuning",
      "packages/mcp-local/src/benchmarks/searchQualityEval.ts: 53 -> 103 query corpus",
    ],
  },
];

/* ── Helpers ────────────────────────────────────────────────────── */

function passRateColor(rate: number): string {
  if (rate >= 100) return "#22c55e";
  if (rate >= 80) return "#eab308";
  return "#ef4444";
}

function latencyColor(current: number, prev: number | null): string {
  if (prev === null) return "#9a9590";
  return current < prev ? "#22c55e" : current > prev ? "#ef4444" : "#9a9590";
}

function delta(current: number, prev: number | null, unit: string, lowerBetter = false): string {
  if (prev === null) return "";
  const diff = current - prev;
  if (diff === 0) return "";
  const sign = diff > 0 ? "+" : "";
  const arrow = lowerBetter ? (diff < 0 ? " \u2193" : " \u2191") : (diff > 0 ? " \u2191" : " \u2193");
  return `${sign}${diff.toFixed(unit === "%" ? 0 : 1)}${unit}${arrow}`;
}

function deltaColor(current: number, prev: number | null, lowerBetter = false): string {
  if (prev === null) return "#9a9590";
  const diff = current - prev;
  if (diff === 0) return "#9a9590";
  const improved = lowerBetter ? diff < 0 : diff > 0;
  return improved ? "#22c55e" : "#ef4444";
}

/* ── Sub-components ────────────────────────────────────────────── */

function SkeletonCard() {
  return (
    <div style={{ ...glass, padding: "1.25rem" }}>
      <div style={{ height: 16, width: "60%", borderRadius: 4, background: "rgba(255,255,255,0.04)", marginBottom: 12 }} />
      <div style={{ height: 12, width: "40%", borderRadius: 4, background: "rgba(255,255,255,0.03)", marginBottom: 20 }} />
      <div style={{ height: 10, width: "80%", borderRadius: 4, background: "rgba(255,255,255,0.03)", marginBottom: 8 }} />
      <div style={{ height: 10, width: "55%", borderRadius: 4, background: "rgba(255,255,255,0.03)" }} />
    </div>
  );
}

function MetricBar({
  values,
  colorFn,
  labelPrefix,
  unit,
  maxVal,
}: {
  values: number[];
  colorFn: (v: number, i: number) => string;
  labelPrefix: string;
  unit: string;
  maxVal: number;
}) {
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: "0.375rem", height: 80 }}>
      {values.map((v, i) => {
        const height = Math.max(8, (v / maxVal) * 64);
        const color = colorFn(v, i);
        return (
          <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, flex: 1 }}>
            <span style={{ ...mono, fontSize: "0.625rem", color, fontWeight: 600 }}>
              {v}{unit}
            </span>
            <div
              style={{
                width: "100%",
                maxWidth: 48,
                height,
                borderRadius: "0.25rem 0.25rem 0 0",
                background: color,
                opacity: 0.7,
                transition: "height 0.3s ease",
              }}
            />
            <span style={{ ...mono, fontSize: "0.5625rem", color: "#6b6560" }}>
              {labelPrefix}{i + 1}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function CollapsibleSection({
  title,
  items,
  renderItem,
  accentColor = "#d97757",
}: {
  title: string;
  items: string[];
  renderItem: (item: string, idx: number) => React.ReactNode;
  accentColor?: string;
}) {
  const [open, setOpen] = useState(false);

  if (items.length === 0) return null;

  return (
    <div style={{ marginBottom: "0.5rem" }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          background: "none",
          border: "none",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          gap: "0.375rem",
          padding: 0,
          marginBottom: open ? "0.375rem" : 0,
        }}
      >
        <span
          style={{
            ...mono,
            fontSize: "0.5625rem",
            color: accentColor,
            transition: "transform 0.15s",
            transform: open ? "rotate(90deg)" : "rotate(0deg)",
            display: "inline-block",
          }}
        >
          {"\u25B6"}
        </span>
        <span style={{ ...label, marginBottom: 0, fontSize: "0.625rem", color: accentColor, fontWeight: 600 }}>
          {title}
        </span>
        <span style={{ ...mono, fontSize: "0.5625rem", color: "#6b6560" }}>
          ({items.length})
        </span>
      </button>
      {open && (
        <div style={{ paddingLeft: "1rem" }}>
          {items.map((item, idx) => (
            <div key={idx} style={{ marginBottom: "0.25rem" }}>
              {renderItem(item, idx)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function IterationCard({
  iteration,
  prev,
}: {
  iteration: CodevIteration;
  prev: CodevIteration | null;
}) {
  const prColor = passRateColor(iteration.passRate);

  return (
    <div style={{ ...glass, padding: "1.25rem" }}>
      {/* Header row */}
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: "0.75rem",
          marginBottom: "0.75rem",
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", alignItems: "baseline", gap: "0.5rem", flexWrap: "wrap" }}>
          <span
            style={{
              ...mono,
              fontSize: "0.6875rem",
              padding: "0.125rem 0.5rem",
              borderRadius: "0.25rem",
              background: "rgba(217,119,87,0.12)",
              color: "#d97757",
              fontWeight: 600,
            }}
          >
            R{iteration.iter}
          </span>
          <span style={{ fontSize: "1rem", fontWeight: 600, color: "#e8e6e3" }}>
            {iteration.changes}
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
          {/* Pass rate badge */}
          <span
            style={{
              ...mono,
              fontSize: "0.75rem",
              fontWeight: 700,
              padding: "0.125rem 0.625rem",
              borderRadius: "9999px",
              background: `${prColor}18`,
              border: `1px solid ${prColor}33`,
              color: prColor,
            }}
          >
            {iteration.passRate}%
          </span>
          {prev && (
            <span style={{ ...mono, fontSize: "0.625rem", color: deltaColor(iteration.passRate, prev.passRate) }}>
              {delta(iteration.passRate, prev.passRate, "%")}
            </span>
          )}
          {/* Latency */}
          <span
            style={{
              ...mono,
              fontSize: "0.6875rem",
              color: latencyColor(iteration.latency, prev?.latency ?? null),
            }}
          >
            {iteration.latency}s
          </span>
          {prev && (
            <span style={{ ...mono, fontSize: "0.625rem", color: deltaColor(iteration.latency, prev.latency, true) }}>
              {delta(iteration.latency, prev.latency, "s", true)}
            </span>
          )}
        </div>
      </div>

      {/* Collapsible detail sections */}
      <CollapsibleSection
        title="TOOLS CALLED"
        items={iteration.tools}
        accentColor="#63b3ed"
        renderItem={(item) => (
          <span style={{ ...mono, fontSize: "0.75rem", color: "#e8e6e3" }}>
            {"\u2022"} {item}
          </span>
        )}
      />

      <CollapsibleSection
        title="SOURCES CITED"
        items={iteration.sources}
        accentColor="#a78bfa"
        renderItem={(item) => (
          <span
            style={{
              display: "inline-block",
              ...mono,
              fontSize: "0.6875rem",
              padding: "0.1rem 0.5rem",
              borderRadius: "9999px",
              background: "rgba(167,139,250,0.1)",
              border: "1px solid rgba(167,139,250,0.2)",
              color: "#a78bfa",
            }}
          >
            {item}
          </span>
        )}
      />

      <CollapsibleSection
        title="CODE CHANGES"
        items={iteration.codeChanges}
        accentColor="#d97757"
        renderItem={(item) => {
          const colonIdx = item.indexOf(":");
          if (colonIdx === -1) {
            return (
              <span style={{ ...mono, fontSize: "0.75rem", color: "#9a9590" }}>
                {item}
              </span>
            );
          }
          const filePath = item.slice(0, colonIdx);
          const desc = item.slice(colonIdx + 1).trim();
          return (
            <div style={{ lineHeight: 1.5 }}>
              <span style={{ ...mono, fontSize: "0.6875rem", color: "#6b6560" }}>
                {filePath}
              </span>
              <span style={{ ...mono, fontSize: "0.6875rem", color: "#6b6560" }}>
                {" \u2192 "}
              </span>
              <span style={{ fontSize: "0.75rem", color: "#e8e6e3" }}>
                {desc}
              </span>
            </div>
          );
        }}
      />
    </div>
  );
}

/* ── Empty state ───────────────────────────────────────────────── */

function EmptyState() {
  return (
    <div
      style={{
        ...glass,
        padding: "3rem 2rem",
        textAlign: "center",
        border: "1px solid rgba(217,119,87,0.12)",
      }}
    >
      <div style={{ fontSize: "2rem", marginBottom: "0.75rem", opacity: 0.3 }}>
        {"\u2300"}
      </div>
      <div style={{ fontSize: "1rem", fontWeight: 600, color: "#e8e6e3", marginBottom: "0.5rem" }}>
        No improvement data yet
      </div>
      <div style={{ ...sec, maxWidth: 480, margin: "0 auto", marginBottom: "1.5rem" }}>
        Connect NodeBench to attrition via the retention bridge. Once co-dev iterations run,
        each loop's tools, sources, code changes, and metric deltas will appear here.
      </div>
      <div
        style={{
          ...glass,
          ...mono,
          padding: "0.75rem 1.25rem",
          fontSize: "0.8125rem",
          maxWidth: 440,
          margin: "0 auto",
          border: "1px solid rgba(217,119,87,0.25)",
          background: "rgba(217,119,87,0.03)",
          textAlign: "center",
        }}
      >
        <span style={{ color: "#d97757" }}>$</span>{" "}
        <span style={{ color: "#e8e6e3" }}>curl -sL attrition.sh/install | bash</span>
      </div>
    </div>
  );
}

/* ── Main page ─────────────────────────────────────────────────── */

export function Improvements() {
  const [iterations, setIterations] = useState<CodevIteration[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [packetsRes, _statusRes] = await Promise.allSettled([
        fetch("/api/retention/packets"),
        fetch("/api/retention/status"),
      ]);

      // Try to extract co-dev iterations from packets
      let codevData: CodevIteration[] = [];

      if (packetsRes.status === "fulfilled" && packetsRes.value.ok) {
        const packets: RetentionPacket[] = await packetsRes.value.json();
        // Filter for co-dev iteration packets and map them
        const codevPackets = packets.filter(
          (p) => p.type === "codev_iteration" || p.type === "improvement_trace"
        );
        if (codevPackets.length > 0) {
          codevData = codevPackets.map((p) => ({
            iter: (p.payload.iter as number) ?? 0,
            passRate: (p.payload.passRate as number) ?? 0,
            confidence: (p.payload.confidence as number) ?? 0,
            latency: (p.payload.latency as number) ?? 0,
            changes: (p.payload.changes as string) ?? "",
            tools: (p.payload.tools as string[]) ?? [],
            sources: (p.payload.sources as string[]) ?? [],
            codeChanges: (p.payload.codeChanges as string[]) ?? [],
          }));
        }
      }

      // If we got real data, use it; otherwise check status for context and fall back to demo
      if (codevData.length > 0) {
        setIterations(codevData);
      } else {
        // Use demo data so the page is always useful
        setIterations(DEMO_ITERATIONS);
      }
    } catch {
      // Network errors -- fall back to demo data
      setIterations(DEMO_ITERATIONS);
      setError("Could not reach retention API. Showing demo data.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  /* ── Computed aggregates ─────────────────────────────────────── */

  const passRates = iterations.map((it) => it.passRate);
  const latencies = iterations.map((it) => it.latency);
  const totalTools = new Set(iterations.flatMap((it) => it.tools)).size;
  const totalSources = new Set(iterations.flatMap((it) => it.sources)).size;
  const totalCodeChanges = iterations.reduce((acc, it) => acc + it.codeChanges.length, 0);
  const isDemo = iterations === DEMO_ITERATIONS;

  return (
    <Layout>
      <div style={{ maxWidth: 960, margin: "0 auto", padding: "3rem 1.5rem 2rem" }}>

        {/* ── Header ──────────────────────────────────────────── */}
        <div style={{ textAlign: "center", marginBottom: "2.5rem" }}>
          <h1
            style={{
              fontSize: "2.25rem",
              fontWeight: 700,
              letterSpacing: "-0.025em",
              color: "#e8e6e3",
              marginBottom: "0.375rem",
            }}
          >
            Improvement Trace
          </h1>
          <p style={{ ...sec, maxWidth: 640, margin: "0 auto", fontSize: "1rem" }}>
            How attrition makes NodeBench better. Every iteration: what tools were called,
            what sources were cited, what code changed, what metrics improved.
          </p>
          {isDemo && !error && (
            <div
              style={{
                ...mono,
                fontSize: "0.625rem",
                marginTop: "0.75rem",
                padding: "0.25rem 0.75rem",
                borderRadius: "9999px",
                display: "inline-block",
                background: "rgba(234,179,8,0.08)",
                border: "1px solid rgba(234,179,8,0.15)",
                color: "#eab308",
              }}
            >
              DEMO DATA
            </div>
          )}
          {error && (
            <div
              style={{
                ...mono,
                fontSize: "0.6875rem",
                marginTop: "0.75rem",
                color: "#eab308",
              }}
            >
              {error}
            </div>
          )}
        </div>

        {/* ── Loading skeleton ────────────────────────────────── */}
        {loading && (
          <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
          </div>
        )}

        {/* ── Empty state ─────────────────────────────────────── */}
        {!loading && iterations.length === 0 && <EmptyState />}

        {/* ── Content ─────────────────────────────────────────── */}
        {!loading && iterations.length > 0 && (
          <>
            {/* Section 1: Metrics Over Time */}
            <div style={{ ...glass, padding: "1.5rem", marginBottom: "2rem" }}>
              <div style={label}>METRICS OVER TIME</div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: "2rem",
                  marginTop: "0.5rem",
                }}
              >
                {/* Pass Rate */}
                <div>
                  <div
                    style={{
                      fontSize: "0.75rem",
                      fontWeight: 600,
                      color: "#e8e6e3",
                      marginBottom: "0.75rem",
                    }}
                  >
                    Pass Rate
                  </div>
                  <MetricBar
                    values={passRates}
                    colorFn={(v) => passRateColor(v)}
                    labelPrefix="R"
                    unit="%"
                    maxVal={100}
                  />
                </div>

                {/* Latency */}
                <div>
                  <div
                    style={{
                      fontSize: "0.75rem",
                      fontWeight: 600,
                      color: "#e8e6e3",
                      marginBottom: "0.75rem",
                    }}
                  >
                    Latency (lower is better)
                  </div>
                  <MetricBar
                    values={latencies}
                    colorFn={(v, i) => latencyColor(v, i > 0 ? latencies[i - 1] : null)}
                    labelPrefix="R"
                    unit="s"
                    maxVal={Math.max(...latencies) * 1.2}
                  />
                </div>
              </div>
            </div>

            {/* Section 2: Iteration Cards */}
            <div style={{ marginBottom: "2.5rem" }}>
              <h2
                style={{
                  fontSize: "0.6875rem",
                  textTransform: "uppercase",
                  letterSpacing: "0.15em",
                  color: "#9a9590",
                  marginBottom: "1rem",
                }}
              >
                Iteration Details
              </h2>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                {iterations.map((it, i) => (
                  <IterationCard
                    key={it.iter}
                    iteration={it}
                    prev={i > 0 ? iterations[i - 1] : null}
                  />
                ))}
              </div>
            </div>

            {/* Section 3: Compound Effect Summary */}
            <div
              style={{
                ...glass,
                padding: "1.5rem",
                border: "1px solid rgba(217,119,87,0.15)",
                background: "rgba(217,119,87,0.02)",
              }}
            >
              <div style={{ ...label, color: "#d97757", fontWeight: 600 }}>
                COMPOUND EFFECT
              </div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(3, 1fr)",
                  gap: "1rem",
                  marginBottom: "1rem",
                }}
              >
                {/* Iterations + Pass Rate */}
                <div style={{ textAlign: "center" }}>
                  <div
                    style={{
                      ...mono,
                      fontSize: "1.5rem",
                      fontWeight: 700,
                      color: "#e8e6e3",
                    }}
                  >
                    {iterations.length}
                  </div>
                  <div style={{ fontSize: "0.75rem", color: "#9a9590" }}>iterations</div>
                  <div
                    style={{
                      ...mono,
                      fontSize: "0.8125rem",
                      color: "#22c55e",
                      marginTop: "0.25rem",
                    }}
                  >
                    {passRates[0]}% {"\u2192"} {passRates[passRates.length - 1]}% pass rate
                  </div>
                </div>

                {/* Latency */}
                <div style={{ textAlign: "center" }}>
                  <div
                    style={{
                      ...mono,
                      fontSize: "1.5rem",
                      fontWeight: 700,
                      color: "#e8e6e3",
                    }}
                  >
                    {latencies[0]}s {"\u2192"} {latencies[latencies.length - 1]}s
                  </div>
                  <div style={{ fontSize: "0.75rem", color: "#9a9590" }}>latency</div>
                  <div
                    style={{
                      ...mono,
                      fontSize: "0.8125rem",
                      color: latencies[latencies.length - 1] < latencies[0] ? "#22c55e" : "#ef4444",
                      marginTop: "0.25rem",
                    }}
                  >
                    {(((latencies[0] - latencies[latencies.length - 1]) / latencies[0]) * 100).toFixed(0)}% faster
                  </div>
                </div>

                {/* Volume */}
                <div style={{ textAlign: "center" }}>
                  <div style={{ display: "flex", justifyContent: "center", gap: "1.25rem" }}>
                    <div>
                      <div style={{ ...mono, fontSize: "1.125rem", fontWeight: 700, color: "#63b3ed" }}>
                        {totalTools}
                      </div>
                      <div style={{ fontSize: "0.6875rem", color: "#9a9590" }}>tools</div>
                    </div>
                    <div>
                      <div style={{ ...mono, fontSize: "1.125rem", fontWeight: 700, color: "#a78bfa" }}>
                        {totalSources}
                      </div>
                      <div style={{ fontSize: "0.6875rem", color: "#9a9590" }}>sources</div>
                    </div>
                    <div>
                      <div style={{ ...mono, fontSize: "1.125rem", fontWeight: 700, color: "#d97757" }}>
                        {totalCodeChanges}
                      </div>
                      <div style={{ fontSize: "0.6875rem", color: "#9a9590" }}>changes</div>
                    </div>
                  </div>
                </div>
              </div>

              <div
                style={{
                  textAlign: "center",
                  fontSize: "0.8125rem",
                  color: "#9a9590",
                  borderTop: "1px solid rgba(255,255,255,0.04)",
                  paddingTop: "0.75rem",
                }}
              >
                Every change is traceable. Every improvement is measured.
              </div>
            </div>
          </>
        )}
      </div>
    </Layout>
  );
}
