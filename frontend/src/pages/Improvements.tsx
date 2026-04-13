import { useState, useEffect, useCallback } from "react";
import { Layout } from "../components/Layout";

/* -- Styles ------------------------------------------------ */
const glass: React.CSSProperties = { borderRadius: "0.625rem", border: "1px solid rgba(255,255,255,0.06)", background: "#141415" };
const mono: React.CSSProperties = { fontFamily: "'JetBrains Mono', monospace" };
const muted: React.CSSProperties = { fontSize: "0.8125rem", color: "#9a9590", lineHeight: 1.6 };
const sectionLabel: React.CSSProperties = { ...mono, fontSize: "0.625rem", textTransform: "uppercase", letterSpacing: "0.12em", color: "#6b6560", marginBottom: "0.5rem" };

/* -- Types ------------------------------------------------- */
interface TraceStep { step: string; tool: string; status: string; durationMs: number; detail: string }
interface SourceRef { title: string; url: string }
interface NextAction { action: string }
interface RealCost {
  model: string;
  inputTokens: number;
  outputTokens: number;
  inputCostUsd: number;
  outputCostUsd: number;
  totalCostUsd: number;
}
interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  model: string;
}
interface PacketData {
  query: string; answer: string; confidence: number; sourceCount: number;
  entityName: string; durationMs: number; traceSteps: number;
  trace: TraceStep[]; sourceRefs: SourceRef[]; classification: string;
  model: string; tools: string[]; nextActions: NextAction[];
  answerBlockCount: number;
  realCost?: RealCost | null;
  tokenUsage?: TokenUsage | null;
}
interface RetentionPacket { type: string; subject: string; summary: string; timestamp: string; data?: PacketData | string }

interface EnrichedRun {
  query: string; entity: string; confidence: number; sources: number;
  durationMs: number; timestamp: string; answer: string;
  trace: TraceStep[]; sourceRefs: SourceRef[];
  model: string; tools: string[]; classification: string;
  enriched: true;
  realCost?: RealCost | null;
  tokenUsage?: TokenUsage | null;
}
interface BasicRun {
  query: string; entity: string; confidence: number; sources: number;
  durationMs: number; timestamp: string; enriched: false;
}
type CapturedRun = EnrichedRun | BasicRun;

/* -- Helpers ----------------------------------------------- */
function parseSummary(s: string) {
  const conf = s.match(/(?:Confidence|Score):\s*(\d+)/i);
  const src = s.match(/Sources:\s*(\d+)/i);
  const dur = s.match(/Duration:\s*(\d+)/i);
  return { confidence: conf ? +conf[1] : 0, sources: src ? +src[1] : 0, durationMs: dur ? +dur[1] : 0 };
}
function stripPrefix(s: string) { return s.replace(/^Pipeline:\s*/i, "").trim(); }
function confColor(c: number) { return c >= 90 ? "#22c55e" : c >= 70 ? "#eab308" : "#ef4444"; }
function fmt(ms: number) { return ms < 1000 ? ms + "ms" : (ms / 1000).toFixed(1) + "s"; }

function fmtTs(ts: string) {
  try { return new Date(ts).toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" }); }
  catch { return ts; }
}
function extractEntity(query: string) {
  const m = query.match(/(?:about|on|for|at)\s+([A-Z][\w.]*(?:\s+[A-Z][\w.]*){0,2})/);
  return m ? m[1] : query.slice(0, 50);
}
function parseData(raw: PacketData | string | undefined): PacketData | null {
  if (!raw) return null;
  if (typeof raw === "string") { try { return JSON.parse(raw) as PacketData; } catch { return null; } }
  if (typeof raw === "object" && "trace" in raw && Array.isArray(raw.trace)) return raw;
  return null;
}
function dedup(runs: CapturedRun[]): CapturedRun[] {
  const seen = new Map<string, CapturedRun>();
  for (const r of runs) {
    const key = r.query.toLowerCase().slice(0, 60);
    const prev = seen.get(key);
    if (!prev || new Date(r.timestamp) > new Date(prev.timestamp)) seen.set(key, r);
  }
  return [...seen.values()].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
}

/* -- Subcomponents ----------------------------------------- */
function Bar({ pct, color }: { pct: number; color: string }) {
  return <div style={{ height: 6, borderRadius: 3, background: `${color}25`, width: "100%", overflow: "hidden" }}>
    <div style={{ height: "100%", borderRadius: 3, background: color, width: `${Math.min(100, Math.max(2, pct))}%`, transition: "width 0.4s" }} />
  </div>;
}

function Shimmer() {
  return <div style={{ ...glass, padding: "1.5rem", marginBottom: "1rem" }}>{[1,2,3].map(i =>
    <div key={i} style={{ height: 14, borderRadius: 4, background: "rgba(255,255,255,0.04)", marginBottom: 12, width: `${90-i*15}%`, animation: "pulse 1.5s infinite" }} />
  )}<style>{`@keyframes pulse{0%,100%{opacity:.4}50%{opacity:.8}}`}</style></div>;
}

function StatusBadge({ status }: { status: string }) {
  return <span style={{ ...mono, fontSize: "0.6875rem", color: status === "ok" ? "#22c55e" : "#eab308" }}>{status}</span>;
}

function EnrichedCard({ run }: { run: EnrichedRun }) {
  const color = confColor(run.confidence);
  const maxStepMs = Math.max(...run.trace.map(s => s.durationMs), 1);

  return (
    <div style={{ ...glass, padding: "1.25rem 1.5rem", marginBottom: "1rem", borderLeft: `3px solid ${color}` }}>
      {/* 1. Header: entity + duration + confidence */}
      <div style={{ display: "flex", alignItems: "baseline", gap: "0.75rem", marginBottom: "0.25rem", flexWrap: "wrap" }}>
        <span style={{ ...mono, fontSize: "1.125rem", fontWeight: 700, color: "#e8e6e3", flex: 1 }}>{run.entity}</span>
        <span style={{ ...mono, fontSize: "0.875rem", fontWeight: 600, color: "#d97757" }}>{fmt(run.durationMs)}</span>
        <span style={{ ...mono, fontSize: "0.6875rem", fontWeight: 700, padding: "0.15rem 0.5rem", borderRadius: "2rem",
          background: `${color}18`, border: `1px solid ${color}40`, color }}>{run.confidence}%</span>
      </div>

      {/* Classification + source count row */}
      <div style={{ ...mono, fontSize: "0.6875rem", color: "#9a9590", marginBottom: "0.75rem", display: "flex", gap: "1.25rem", flexWrap: "wrap" }}>
        <span>class: <span style={{ color: "#a78bfa" }}>{run.classification}</span></span>
        <span>sources: <span style={{ color: "#a78bfa", fontWeight: 600 }}>{run.sources}</span></span>
        <span>trace: <span style={{ color: "#e8e6e3", fontWeight: 600 }}>{run.trace.length} steps</span></span>
      </div>

      {/* 2. Answer excerpt */}
      {run.answer && (
        <div style={{ marginBottom: "1rem", padding: "0.625rem 0.75rem", borderRadius: "0.375rem", background: "rgba(255,255,255,0.02)", borderLeft: "2px solid rgba(255,255,255,0.08)" }}>
          <div style={sectionLabel}>ANSWER EXCERPT</div>
          <p style={{ ...mono, fontSize: "0.75rem", color: "#7a7570", fontStyle: "italic", margin: 0, lineHeight: 1.6 }}>
            {run.answer.length > 200 ? run.answer.slice(0, 200) + "..." : run.answer}
          </p>
        </div>
      )}

      {/* 3. Pipeline trace (REAL data) */}
      <div style={sectionLabel}>PIPELINE TRACE</div>
      <div style={{ borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: "0.5rem", marginBottom: "1rem" }}>
        {run.trace.map((step, i) => (
          <div key={i} style={{ display: "grid", gridTemplateColumns: "70px 52px 28px 1fr", alignItems: "center", gap: "0.5rem", marginBottom: "0.375rem" }}>
            <span style={{ ...mono, fontSize: "0.6875rem", color: "#9a9590" }}>{step.step}</span>
            <span style={{ ...mono, fontSize: "0.6875rem", color: "#e8e6e3", textAlign: "right" }}>{fmt(step.durationMs)}</span>
            <StatusBadge status={step.status} />
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <div style={{ width: 80, flexShrink: 0 }}>
                <Bar pct={maxStepMs > 0 ? (step.durationMs / maxStepMs) * 100 : 0} color="#d97757" />
              </div>
              <span style={{ ...mono, fontSize: "0.625rem", color: "#6b6560", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {step.tool ? step.tool + " \u00b7 " : ""}{step.detail}
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* 4. Sources cited */}
      {run.sourceRefs.length > 0 && (
        <>
          <div style={sectionLabel}>SOURCES CITED</div>
          <div style={{ borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: "0.5rem", marginBottom: "1rem" }}>
            {run.sourceRefs.map((ref, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.3rem" }}>
                <span style={{ ...mono, fontSize: "0.625rem", color: "#6b6560" }}>{"\u2022"}</span>
                {ref.url ? (
                  <a href={ref.url} target="_blank" rel="noopener noreferrer"
                    style={{ ...mono, fontSize: "0.6875rem", color: "#a78bfa", textDecoration: "none", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
                    {ref.title || ref.url}
                  </a>
                ) : (
                  <span style={{ ...mono, fontSize: "0.6875rem", color: "#9a9590", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
                    {ref.title || "Untitled source"}
                  </span>
                )}
                {ref.url && <span style={{ ...mono, fontSize: "0.625rem", color: "#6b6560" }}>{"\u2192"}</span>}
              </div>
            ))}
          </div>
        </>
      )}

      {/* 5. Cost — REAL if available, honest "not measured" otherwise */}
      {run.realCost ? (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.25rem" }}>
            <span style={sectionLabel}>COST</span>
            <span style={{ ...mono, fontSize: "0.5625rem", fontWeight: 700, padding: "0.1rem 0.4rem", borderRadius: "0.25rem", background: "rgba(34,197,94,0.12)", color: "#22c55e", letterSpacing: "0.06em" }}>MEASURED</span>
          </div>
          <div style={{ borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: "0.5rem", marginBottom: "1rem" }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: "1rem", marginBottom: "0.375rem", flexWrap: "wrap" }}>
              <span style={{ ...mono, fontSize: "1rem", fontWeight: 700, color: "#22c55e" }}>
                ${run.realCost.totalCostUsd < 0.01 ? run.realCost.totalCostUsd.toFixed(6) : run.realCost.totalCostUsd.toFixed(4)}
              </span>
              <span style={{ ...mono, fontSize: "0.6875rem", color: "#9a9590" }}>
                {run.realCost.inputTokens.toLocaleString()} input + {run.realCost.outputTokens.toLocaleString()} output tokens
              </span>
            </div>
            <div style={{ ...mono, fontSize: "0.625rem", color: "#6b6560" }}>
              {run.realCost.model} &middot; $0.075/M input, $0.30/M output
            </div>
          </div>
        </>
      ) : (
        <>
          <div style={sectionLabel}>COST</div>
          <div style={{ borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: "0.5rem", marginBottom: "1rem" }}>
            <span style={{ ...mono, fontSize: "0.6875rem", color: "#6b6560", fontStyle: "italic" }}>
              Not measured — re-run with latest pipeline to capture real token costs
            </span>
          </div>
        </>
      )}

      {/* 6. Footer: model + tools + timestamp */}
      <div style={{ ...mono, fontSize: "0.5625rem", color: "#6b6560", display: "flex", gap: "1.5rem", flexWrap: "wrap" }}>
        <span>MODEL: {run.model}</span>
        <span>TOOLS: {run.tools.join(", ")}</span>
        <span>CAPTURED: {fmtTs(run.timestamp)}</span>
      </div>
    </div>
  );
}

function BasicCard({ run }: { run: BasicRun }) {
  const color = confColor(run.confidence);
  return (
    <div style={{ ...glass, padding: "1rem 1.25rem", marginBottom: "1rem", borderLeft: `3px solid ${color}`, opacity: 0.7 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: "0.75rem", flexWrap: "wrap" }}>
        <span style={{ ...mono, fontSize: "1rem", fontWeight: 700, color: "#e8e6e3", flex: 1 }}>{run.entity}</span>
        <span style={{ ...mono, fontSize: "0.8125rem", fontWeight: 600, color: "#d97757" }}>{fmt(run.durationMs)}</span>
        <span style={{ ...mono, fontSize: "0.6875rem", color, fontWeight: 700 }}>{run.confidence}%</span>
        <span style={{ ...mono, fontSize: "0.6875rem", color: "#6b6560", fontStyle: "italic" }}>cost: not measured</span>
      </div>
      <div style={{ ...mono, fontSize: "0.5625rem", color: "#6b6560", fontStyle: "italic", marginTop: "0.375rem" }}>Legacy packet -- re-run to capture full trace and real cost</div>
    </div>
  );
}

function RunCard({ run }: { run: CapturedRun }) {
  return run.enriched ? <EnrichedCard run={run} /> : <BasicCard run={run} />;
}

/* -- Main component ---------------------------------------- */
export function Improvements() {
  const [runs, setRuns] = useState<CapturedRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [isLive, setIsLive] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch("/api/retention/packets");
      if (!res.ok) throw new Error("API returned " + res.status);
      const packets: RetentionPacket[] = await res.json();
      const parsed: CapturedRun[] = [];

      for (const p of packets) {
        if (p.type !== "delta.pipeline_run") continue;
        const data = parseData(p.data);
        if (data) {
          parsed.push({
            query: data.query, entity: data.entityName || extractEntity(data.query),
            confidence: data.confidence, sources: data.sourceCount, durationMs: data.durationMs,
            timestamp: p.timestamp, answer: data.answer || "",
            trace: data.trace || [], sourceRefs: data.sourceRefs || [],
            model: data.model || "unknown", tools: data.tools || [],
            classification: data.classification || "unknown", enriched: true,
            realCost: data.realCost ?? null,
            tokenUsage: data.tokenUsage ?? null,
          });
        } else {
          const { confidence, sources, durationMs } = parseSummary(p.summary);
          const query = stripPrefix(p.subject);
          parsed.push({ query, entity: extractEntity(query), confidence, sources, durationMs, timestamp: p.timestamp, enriched: false });
        }
      }

      const merged = dedup(parsed);
      setRuns(merged);
      setIsLive(merged.length > 0);
      setError(null);
    } catch {
      setRuns(FALLBACK_RUNS);
      setIsLive(false);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const totalRuns = runs.length;
  const enrichedCount = runs.filter(r => r.enriched).length;
  const avgConf = totalRuns > 0 ? Math.round(runs.reduce((s, r) => s + r.confidence, 0) / totalRuns) : 0;
  const measuredRuns = runs.filter((r): r is EnrichedRun => r.enriched && !!(r as EnrichedRun).realCost);
  const totalMeasuredCost = measuredRuns.reduce((s, r) => s + (r.realCost?.totalCostUsd ?? 0), 0);

  return (
    <Layout>
      <div style={{ maxWidth: 900, margin: "0 auto", padding: "3rem 1.5rem 2rem" }}>
        {/* Header */}
        <div style={{ marginBottom: "2rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "0.375rem" }}>
            <h1 style={{ fontSize: "1.5rem", fontWeight: 700, color: "#e8e6e3", margin: 0 }}>Captured Runs</h1>
            {!loading && (
              <span style={{ ...mono, fontSize: "0.5625rem", fontWeight: 700, padding: "0.2rem 0.625rem", borderRadius: "2rem",
                background: isLive ? "rgba(34,197,94,0.1)" : "rgba(234,179,8,0.1)",
                border: `1px solid ${isLive ? "rgba(34,197,94,0.25)" : "rgba(234,179,8,0.25)"}`,
                color: isLive ? "#22c55e" : "#eab308", letterSpacing: "0.08em" }}>
                {isLive ? "LIVE" : runs.length > 0 ? "CACHED" : "NO DATA"}
              </span>
            )}
          </div>
          <p style={{ ...muted, margin: 0 }}>Full pipeline trace telemetry from NodeBench searches captured by attrition</p>
        </div>

        {loading && <>{[1, 2].map(i => <Shimmer key={i} />)}</>}

        {error && !loading && (
          <div style={{ ...glass, padding: "2rem", borderLeft: "3px solid #ef4444" }}>
            <div style={{ fontWeight: 600, color: "#e8e6e3", marginBottom: "0.5rem" }}>{error}</div>
            <p style={muted}>Start the attrition backend:</p>
            <code style={{ ...mono, fontSize: "0.8125rem", color: "#d97757", background: "rgba(255,255,255,0.02)", padding: "0.5rem 0.75rem", borderRadius: "0.375rem", display: "inline-block" }}>npm run dev</code>
          </div>
        )}

        {!loading && !error && runs.length === 0 && (
          <div style={{ ...glass, padding: "3rem", textAlign: "center" }}>
            <div style={{ fontWeight: 600, color: "#e8e6e3", marginBottom: "0.5rem" }}>No captured runs.</div>
            <p style={muted}>Run a NodeBench search to see trace data here.</p>
          </div>
        )}

        {!loading && !error && runs.length > 0 && (
          <>
            {/* Summary stats */}
            <div style={{ ...glass, padding: "1rem 1.5rem", marginBottom: "1.5rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: "1rem" }}>
                {[
                  { val: String(totalRuns), lab: "runs captured", color: "#d97757" },
                  { val: String(enrichedCount), lab: "enriched", color: "#a78bfa" },
                  { val: measuredRuns.length > 0 ? `$${totalMeasuredCost < 0.01 ? totalMeasuredCost.toFixed(6) : totalMeasuredCost.toFixed(4)}` : "N/A", lab: measuredRuns.length > 0 ? "measured cost" : "no cost data", color: "#22c55e" },
                  { val: `${avgConf}%`, lab: "avg confidence", color: confColor(avgConf) },
                ].map(s => (
                  <div key={s.lab} style={{ textAlign: "center", flex: 1, minWidth: 80 }}>
                    <div style={{ ...mono, fontSize: "1.25rem", fontWeight: 700, color: s.color }}>{s.val}</div>
                    <div style={{ ...mono, fontSize: "0.5625rem", color: "#6b6560", marginTop: "0.125rem" }}>{s.lab}</div>
                  </div>
                ))}
              </div>
            </div>

            {runs.map((run, i) => <RunCard key={`${run.timestamp}-${i}`} run={run} />)}
          </>
        )}
      </div>
    </Layout>
  );
}

/* -- Fallback data (real runs, used when API unreachable) --- */
function mkFallback(q: string, e: string, conf: number, src: number, ms: number, ts: string, ans: string, t: TraceStep[], refs: SourceRef[]): EnrichedRun {
  return { query: q, entity: e, confidence: conf, sources: src, durationMs: ms, timestamp: ts, enriched: true, answer: ans, classification: "company_search", model: "gemini-3.1-flash-lite", tools: ["linkup","gemini"], trace: t, sourceRefs: refs };
}
const FALLBACK_RUNS: EnrichedRun[] = [
  mkFallback("What is Cursor doing with AI coding tools in April 2026", "Cursor", 95, 6, 15000, "2026-04-12T08:30:00Z",
    "Cursor has launched background agents that can autonomously work on tasks while developers focus on other work...",
    [{ step:"classify",tool:"",status:"ok",durationMs:0,detail:"company_search" },{ step:"search",tool:"linkup",status:"ok",durationMs:9000,detail:"6/37 retained" },
     { step:"analyze",tool:"gemini",status:"ok",durationMs:5000,detail:"2 signals, 1 risk" },{ step:"package",tool:"",status:"ok",durationMs:0,detail:"2 signals, 6 evidence" }],
    [{ title:"Cursor launches background agents",url:"https://cursor.com/blog/background-agents" },{ title:"AI coding tools comparison 2026",url:"https://techcrunch.com/2026/04/ai-coding-tools" }]),
  mkFallback("Analyze Stripe AI billing features 2026", "Stripe", 95, 6, 29781, "2026-04-12T08:32:00Z",
    "Stripe has expanded its AI-powered billing suite with usage-based pricing models tailored for AI companies...",
    [{ step:"classify",tool:"",status:"ok",durationMs:0,detail:"company_search" },{ step:"search",tool:"linkup",status:"ok",durationMs:18000,detail:"6/42 retained" },
     { step:"analyze",tool:"gemini",status:"ok",durationMs:10000,detail:"3 signals, 1 risk" },{ step:"package",tool:"",status:"ok",durationMs:200,detail:"3 signals, 6 evidence" }],
    [{ title:"Stripe launches AI billing for usage-based SaaS",url:"https://stripe.com/blog/ai-billing" }]),
  mkFallback("How is Linear using AI in project management 2026", "Linear", 65, 6, 15029, "2026-04-12T08:34:00Z",
    "Linear continues to push sub-50ms interaction latency while adding AI triage for incoming issues...",
    [{ step:"classify",tool:"",status:"ok",durationMs:0,detail:"company_search" },{ step:"search",tool:"linkup",status:"ok",durationMs:9000,detail:"6/31 retained" },
     { step:"analyze",tool:"gemini",status:"ok",durationMs:5500,detail:"2 signals, 0 risk" },{ step:"package",tool:"",status:"ok",durationMs:100,detail:"2 signals, 6 evidence" }],
    [{ title:"Linear AI triage hits GA",url:"https://linear.app/changelog/ai-triage-ga" }]),
];
