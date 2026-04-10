import { useEffect, useState, useRef, useCallback } from "react";
import { Layout } from "../components/Layout";

/* ── Types matching /api/live/* responses ────────────────────── */

interface HookInfo {
  name: string;
  detail: string;
}

interface WorkflowStep {
  name: string;
  has_evidence: boolean;
  evidence_tools: string[];
}

interface WorkflowStatus {
  name: string;
  steps: WorkflowStep[];
  completion_pct: number;
}

interface ActivityEvent {
  ts: string;
  tool: string;
  keys: string[];
  scrubbed: string;
  was_blocked: boolean;
}

interface LiveStatus {
  hooks_installed: number;
  hooks: HookInfo[];
  active_workflow: WorkflowStatus | null;
  recent_activity: ActivityEvent[];
  blocked_searches: number;
  total_events: number;
  session_duration_sec: number;
  verdict_if_stopped_now: string;
}

/* ── Styles ────────────────────────────────────────────────── */

const glass: React.CSSProperties = {
  borderRadius: "0.625rem",
  border: "1px solid rgba(255,255,255,0.06)",
  background: "#141415",
};

const mono: React.CSSProperties = {
  fontFamily: "'JetBrains Mono', monospace",
};

const label: React.CSSProperties = {
  fontSize: "0.6875rem",
  textTransform: "uppercase",
  letterSpacing: "0.1em",
  color: "#9a9590",
  marginBottom: "0.5rem",
};

/* ── Helpers ────────────────────────────────────────────────── */

const API_BASE = "http://localhost:8100";

function formatDuration(secs: number): string {
  if (secs < 60) return `${secs}s`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m`;
  return `${Math.floor(secs / 3600)}h ${Math.floor((secs % 3600) / 60)}m`;
}

function formatTime(ts: string): string {
  if (ts.length >= 19) return ts.slice(11, 19);
  return ts;
}

function verdictColor(verdict: string): string {
  switch (verdict) {
    case "BLOCK":
      return "#ef4444";
    case "ESCALATE":
      return "#eab308";
    case "ALLOW":
      return "#22c55e";
    default:
      return "#9a9590";
  }
}

function verdictBg(verdict: string): string {
  switch (verdict) {
    case "BLOCK":
      return "rgba(239,68,68,0.08)";
    case "ESCALATE":
      return "rgba(234,179,8,0.08)";
    case "ALLOW":
      return "rgba(34,197,94,0.08)";
    default:
      return "rgba(255,255,255,0.04)";
  }
}

/* ── Demo data generator ──────────────────────────────────────── */

const DEMO_TOOLS = [
  { tool: "Grep", scrubbed: 'pattern="async.*fetch" src/**/*.ts' },
  { tool: "Read", scrubbed: "src/api/client.ts (1-120)" },
  { tool: "Edit", scrubbed: "src/api/client.ts: convert fetch to async/await" },
  { tool: "Bash", scrubbed: "npm test -- --run" },
  { tool: "Read", scrubbed: "src/types/api.d.ts (1-45)" },
  { tool: "Grep", scrubbed: 'pattern="import.*client" src/' },
  { tool: "Edit", scrubbed: "src/services/auth.ts: update import paths" },
  { tool: "Bash", scrubbed: "npx tsc --noEmit" },
  { tool: "WebSearch", scrubbed: "breaking changes async-retry v4" },
  { tool: "Edit", scrubbed: "src/api/retry.ts: add AbortController timeout" },
  { tool: "Read", scrubbed: "package.json (dependencies)" },
  { tool: "Bash", scrubbed: "npm run build" },
  { tool: "Grep", scrubbed: 'pattern="\.then\\(" src/' },
  { tool: "Edit", scrubbed: "src/utils/fetch.ts: remove .then() chains" },
  { tool: "Bash", scrubbed: "npm run test:integration" },
];

const DEMO_WORKFLOW_STEPS: WorkflowStep[] = [
  { name: "Grep for sync patterns", has_evidence: true, evidence_tools: ["Grep"] },
  { name: "Read affected source files", has_evidence: true, evidence_tools: ["Read"] },
  { name: "Edit files to async/await", has_evidence: true, evidence_tools: ["Edit"] },
  { name: "Search for breaking changes", has_evidence: false, evidence_tools: [] },
  { name: "Update generated types", has_evidence: true, evidence_tools: ["Edit"] },
  { name: "Run unit tests", has_evidence: true, evidence_tools: ["Bash(test)"] },
  { name: "Run integration tests", has_evidence: false, evidence_tools: [] },
  { name: "Build and verify", has_evidence: false, evidence_tools: [] },
];

function makeDemoTimestamp(offsetSec: number): string {
  const d = new Date(Date.now() - offsetSec * 1000);
  return d.toISOString().slice(0, 19);
}

function generateDemoActivity(count: number): ActivityEvent[] {
  const events: ActivityEvent[] = [];
  for (let i = 0; i < count; i++) {
    const entry = DEMO_TOOLS[i % DEMO_TOOLS.length];
    const isBlocked = i === 7; // One blocked entry
    events.push({
      ts: makeDemoTimestamp((count - i) * 12),
      tool: isBlocked ? "Grep" : entry.tool,
      keys: [],
      scrubbed: isBlocked ? 'pattern="async.*fetch" (DUPLICATE)' : entry.scrubbed,
      was_blocked: isBlocked,
    });
  }
  return events;
}

function buildDemoStatus(tickCount: number): LiveStatus {
  // Steps complete progressively: start at 5/8, advance toward 8/8
  const stepsComplete = Math.min(5 + Math.floor(tickCount / 4), 8);
  const steps = DEMO_WORKFLOW_STEPS.map((s, i) => ({
    ...s,
    has_evidence: i < stepsComplete,
    evidence_tools: i < stepsComplete ? (s.evidence_tools.length > 0 ? s.evidence_tools : ["Bash"]) : [],
  }));
  const pct = Math.round((stepsComplete / 8) * 100);

  // Verdict evolves: ESCALATE -> ALLOW as steps complete
  let verdict = "ESCALATE";
  if (stepsComplete >= 7) verdict = "ALLOW";

  return {
    hooks_installed: 10,
    hooks: ALL_HOOK_NAMES.map((name) => ({ name, detail: "active" })),
    active_workflow: {
      name: "API Client Refactor",
      steps,
      completion_pct: pct,
    },
    recent_activity: [],
    blocked_searches: 1,
    total_events: 8 + tickCount,
    session_duration_sec: 142 + tickCount * 5,
    verdict_if_stopped_now: verdict,
  };
}

/* ── StatusCard ──────────────────────────────────────────────── */

function StatusCard({
  title,
  value,
  color,
  bg,
}: {
  title: string;
  value: string | number;
  color: string;
  bg?: string;
}) {
  return (
    <div
      style={{
        ...glass,
        padding: "1rem 1.25rem",
        background: bg || "#141415",
        flex: 1,
        minWidth: 180,
      }}
    >
      <div style={label}>{title}</div>
      <div
        style={{
          ...mono,
          fontSize: "1.5rem",
          fontWeight: 700,
          color,
          lineHeight: 1.2,
        }}
      >
        {value}
      </div>
    </div>
  );
}

/* ── ProgressBar ─────────────────────────────────────────────── */

function ProgressBar({ pct }: { pct: number }) {
  const barColor =
    pct >= 80 ? "#22c55e" : pct >= 50 ? "#eab308" : "#ef4444";
  return (
    <div
      style={{
        width: "100%",
        height: 8,
        borderRadius: 4,
        background: "rgba(255,255,255,0.06)",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          width: `${Math.min(pct, 100)}%`,
          height: "100%",
          borderRadius: 4,
          background: barColor,
          transition: "width 0.3s ease",
        }}
      />
    </div>
  );
}

/* ── Demo Banner ──────────────────────────────────────────────── */

function DemoBanner() {
  return (
    <div
      style={{
        ...glass,
        padding: "0.75rem 1.25rem",
        marginBottom: "1.5rem",
        border: "1px solid rgba(234,179,8,0.35)",
        background: "rgba(234,179,8,0.04)",
        display: "flex",
        alignItems: "center",
        gap: "0.75rem",
      }}
    >
      <div
        style={{
          ...mono,
          fontSize: "0.6875rem",
          fontWeight: 700,
          letterSpacing: "0.08em",
          color: "#eab308",
          padding: "0.15rem 0.5rem",
          borderRadius: "0.25rem",
          background: "rgba(234,179,8,0.15)",
          flexShrink: 0,
        }}
      >
        DEMO MODE
      </div>
      <span style={{ fontSize: "0.8125rem", color: "#9a9590", lineHeight: 1.4 }}>
        Showing simulated data. Run{" "}
        <code style={{ ...mono, fontSize: "0.75rem", color: "#d97757" }}>bp serve</code>{" "}
        for live data.
      </span>
    </div>
  );
}

/* ── Main Component ──────────────────────────────────────────── */

export function Live() {
  const [status, setStatus] = useState<LiveStatus | null>(null);
  const [activity, setActivity] = useState<ActivityEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const [isDemo, setIsDemo] = useState(false);
  const [demoTick, setDemoTick] = useState(0);
  const feedRef = useRef<HTMLDivElement>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/live/status`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: LiveStatus = await res.json();
      setStatus(data);
      setConnected(true);
      setIsDemo(false);
    } catch {
      setConnected(false);
      // Fall back to demo mode
      setIsDemo(true);
    }
  }, []);

  const fetchActivity = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/live/activity?limit=50`);
      if (!res.ok) return;
      const data: ActivityEvent[] = await res.json();
      setActivity(data);
    } catch {
      // silent -- demo mode handles activity
    }
  }, []);

  // Initial connection attempt
  useEffect(() => {
    fetchStatus();
    fetchActivity();
  }, [fetchStatus, fetchActivity]);

  // Live polling when connected
  useEffect(() => {
    if (!connected && !isDemo) return;

    if (connected) {
      const interval = setInterval(() => {
        fetchStatus();
        fetchActivity();
      }, 5000);
      return () => clearInterval(interval);
    }
  }, [connected, isDemo, fetchStatus, fetchActivity]);

  // Demo mode tick: update data every 5 seconds
  useEffect(() => {
    if (!isDemo) return;

    // Set initial demo data
    const demoStatus = buildDemoStatus(0);
    setStatus(demoStatus);
    setActivity(generateDemoActivity(8));

    const interval = setInterval(() => {
      setDemoTick((prev) => {
        const next = prev + 1;
        const newStatus = buildDemoStatus(next);
        setStatus(newStatus);
        // Add 1 new activity entry each tick
        setActivity((prevActivity) => {
          const newEntry: ActivityEvent = {
            ts: makeDemoTimestamp(0),
            tool: DEMO_TOOLS[next % DEMO_TOOLS.length].tool,
            keys: [],
            scrubbed: DEMO_TOOLS[next % DEMO_TOOLS.length].scrubbed,
            was_blocked: false,
          };
          return [...prevActivity, newEntry].slice(-50);
        });
        return next;
      });
    }, 5000);

    return () => clearInterval(interval);
  }, [isDemo]);

  // Periodically retry connection even in demo mode
  useEffect(() => {
    if (!isDemo) return;

    const retryInterval = setInterval(async () => {
      try {
        const res = await fetch(`${API_BASE}/api/live/status`);
        if (res.ok) {
          const data: LiveStatus = await res.json();
          setStatus(data);
          setConnected(true);
          setIsDemo(false);
          setDemoTick(0);
        }
      } catch {
        // still offline, stay in demo
      }
    }, 15000);

    return () => clearInterval(retryInterval);
  }, [isDemo]);

  // Auto-scroll activity feed
  useEffect(() => {
    if (feedRef.current) {
      feedRef.current.scrollTop = feedRef.current.scrollHeight;
    }
  }, [activity]);

  // Suppress unused variable warning
  void demoTick;

  const workflow = status?.active_workflow ?? null;
  const verdict = status?.verdict_if_stopped_now ?? "UNKNOWN";

  return (
    <Layout>
      <div
        style={{
          maxWidth: 1100,
          margin: "0 auto",
          padding: "2rem 1.5rem 2rem",
        }}
      >
        {/* ── Header ──────────────────────────────────────────── */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.75rem",
            marginBottom: "1.5rem",
          }}
        >
          <h1
            style={{
              fontSize: "1.75rem",
              fontWeight: 700,
              letterSpacing: "-0.025em",
              color: "#e8e6e3",
              margin: 0,
            }}
          >
            Live Status
          </h1>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.375rem",
              padding: "0.25rem 0.75rem",
              borderRadius: "1rem",
              background: connected
                ? "rgba(34,197,94,0.1)"
                : isDemo
                  ? "rgba(234,179,8,0.1)"
                  : "rgba(239,68,68,0.1)",
              border: `1px solid ${
                connected
                  ? "rgba(34,197,94,0.2)"
                  : isDemo
                    ? "rgba(234,179,8,0.2)"
                    : "rgba(239,68,68,0.2)"
              }`,
            }}
          >
            <div
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: connected ? "#22c55e" : isDemo ? "#eab308" : "#ef4444",
              }}
            />
            <span
              style={{
                ...mono,
                fontSize: "0.6875rem",
                color: connected ? "#22c55e" : isDemo ? "#eab308" : "#ef4444",
              }}
            >
              {connected ? "Connected" : isDemo ? "Demo" : "Disconnected"}
            </span>
          </div>
        </div>

        {/* ── Demo banner ─────────────────────────────────────── */}
        {isDemo && <DemoBanner />}

        {/* ── Row 1: Status Cards ─────────────────────────────── */}
        {status && (
          <>
            <div
              style={{
                display: "flex",
                gap: "0.75rem",
                marginBottom: "1.5rem",
                flexWrap: "wrap",
              }}
            >
              <StatusCard
                title="Hooks Active"
                value={status.hooks_installed}
                color={
                  status.hooks_installed > 0
                    ? "#22c55e"
                    : "#ef4444"
                }
                bg={
                  status.hooks_installed > 0
                    ? "rgba(34,197,94,0.04)"
                    : "rgba(239,68,68,0.04)"
                }
              />
              <StatusCard
                title="Active Workflow"
                value={workflow?.name ?? "None"}
                color={workflow ? "#e8e6e3" : "#6b6560"}
              />
              <StatusCard
                title="Events This Session"
                value={status.total_events}
                color="#e8e6e3"
              />
              <StatusCard
                title="Verdict If Stopped Now"
                value={verdict}
                color={verdictColor(verdict)}
                bg={verdictBg(verdict)}
              />
            </div>

            {/* ── Row 2: Workflow Progress ───────────────────── */}
            {workflow && (
              <div
                style={{
                  ...glass,
                  padding: "1.25rem",
                  marginBottom: "1.5rem",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "baseline",
                    justifyContent: "space-between",
                    marginBottom: "0.75rem",
                  }}
                >
                  <div style={label}>
                    Workflow Progress
                  </div>
                  <span
                    style={{
                      ...mono,
                      fontSize: "0.8125rem",
                      color: verdictColor(verdict),
                    }}
                  >
                    {workflow.completion_pct}%
                  </span>
                </div>

                <ProgressBar pct={workflow.completion_pct} />

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns:
                      "repeat(auto-fill, minmax(200px, 1fr))",
                    gap: "0.5rem",
                    marginTop: "1rem",
                  }}
                >
                  {workflow.steps.map((step, i) => (
                    <div
                      key={i}
                      style={{
                        display: "flex",
                        alignItems: "flex-start",
                        gap: "0.5rem",
                        padding: "0.5rem 0.625rem",
                        borderRadius: "0.375rem",
                        background: step.has_evidence
                          ? "rgba(34,197,94,0.04)"
                          : "rgba(239,68,68,0.04)",
                        border: `1px solid ${
                          step.has_evidence
                            ? "rgba(34,197,94,0.12)"
                            : "rgba(239,68,68,0.12)"
                        }`,
                      }}
                    >
                      <span
                        style={{
                          color: step.has_evidence
                            ? "#22c55e"
                            : "#ef4444",
                          fontSize: "0.875rem",
                          flexShrink: 0,
                          lineHeight: 1.4,
                        }}
                      >
                        {step.has_evidence ? "\u2713" : "\u2717"}
                      </span>
                      <div>
                        <div
                          style={{
                            fontSize: "0.8125rem",
                            color: step.has_evidence
                              ? "#e8e6e3"
                              : "#9a9590",
                            lineHeight: 1.4,
                          }}
                        >
                          {i + 1}. {step.name}
                        </div>
                        {step.evidence_tools.length > 0 && (
                          <div
                            style={{
                              ...mono,
                              fontSize: "0.625rem",
                              color: "#6b6560",
                              marginTop: "0.125rem",
                            }}
                          >
                            {step.evidence_tools.join(
                              ", "
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ── Row 3: Live Activity Feed ──────────────────── */}
            <div
              style={{
                ...glass,
                padding: "1.25rem",
                marginBottom: "1.5rem",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  marginBottom: "0.75rem",
                }}
              >
                <div style={label}>
                  Live Activity Feed
                </div>
                <span
                  style={{
                    ...mono,
                    fontSize: "0.625rem",
                    color: "#6b6560",
                  }}
                >
                  auto-refresh 5s |{" "}
                  {formatDuration(
                    status.session_duration_sec
                  )}
                </span>
              </div>

              {/* Column headers */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "80px 160px 1fr",
                  gap: "0.5rem",
                  padding: "0.375rem 0.5rem",
                  borderBottom:
                    "1px solid rgba(255,255,255,0.06)",
                  marginBottom: "0.25rem",
                }}
              >
                <span
                  style={{
                    ...mono,
                    fontSize: "0.625rem",
                    color: "#6b6560",
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                  }}
                >
                  Time
                </span>
                <span
                  style={{
                    ...mono,
                    fontSize: "0.625rem",
                    color: "#6b6560",
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                  }}
                >
                  Tool
                </span>
                <span
                  style={{
                    ...mono,
                    fontSize: "0.625rem",
                    color: "#6b6560",
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                  }}
                >
                  Args
                </span>
              </div>

              {/* Scrollable feed */}
              <div
                ref={feedRef}
                style={{
                  maxHeight: 400,
                  overflowY: "auto",
                  scrollbarWidth: "thin",
                  scrollbarColor:
                    "rgba(255,255,255,0.1) transparent",
                }}
              >
                {activity.length === 0 && (
                  <div
                    style={{
                      padding: "2rem",
                      textAlign: "center",
                      color: "#6b6560",
                      fontSize: "0.8125rem",
                    }}
                  >
                    No activity recorded yet. Start a
                    Claude Code session with hooks
                    installed.
                  </div>
                )}
                {activity.map((event, i) => (
                  <div
                    key={i}
                    style={{
                      display: "grid",
                      gridTemplateColumns:
                        "80px 160px 1fr",
                      gap: "0.5rem",
                      padding: "0.375rem 0.5rem",
                      borderRadius: "0.25rem",
                      background: event.was_blocked
                        ? "rgba(239,68,68,0.06)"
                        : i % 2 === 0
                          ? "transparent"
                          : "rgba(255,255,255,0.01)",
                      borderLeft: event.was_blocked
                        ? "2px solid #ef4444"
                        : "2px solid transparent",
                    }}
                  >
                    {/* Time */}
                    <span
                      style={{
                        ...mono,
                        fontSize: "0.75rem",
                        color: "#6b6560",
                      }}
                    >
                      {formatTime(event.ts)}
                    </span>

                    {/* Tool badge */}
                    <span>
                      {event.was_blocked ? (
                        <span
                          style={{
                            ...mono,
                            fontSize: "0.6875rem",
                            padding:
                              "0.1rem 0.5rem",
                            borderRadius: "0.25rem",
                            background:
                              "rgba(239,68,68,0.15)",
                            color: "#ef4444",
                            fontWeight: 600,
                          }}
                        >
                          BLOCKED
                        </span>
                      ) : (
                        <span
                          style={{
                            ...mono,
                            fontSize: "0.6875rem",
                            padding:
                              "0.1rem 0.5rem",
                            borderRadius: "0.25rem",
                            background:
                              toolBadgeBg(
                                event.tool
                              ),
                            color: toolBadgeColor(
                              event.tool
                            ),
                          }}
                        >
                          {event.tool}
                        </span>
                      )}
                    </span>

                    {/* Scrubbed args */}
                    <span
                      style={{
                        ...mono,
                        fontSize: "0.75rem",
                        color: event.was_blocked
                          ? "#ef4444"
                          : "#9a9590",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {event.was_blocked
                        ? `${event.tool}("${event.scrubbed}") \u2014 duplicate search`
                        : event.scrubbed || "\u2014"}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* ── Row 4: Blocked Searches (if any) ──────────── */}
            {status.blocked_searches > 0 && (
              <div
                style={{
                  ...glass,
                  padding: "1.25rem",
                  marginBottom: "1.5rem",
                  border: "1px solid rgba(239,68,68,0.15)",
                  background: "rgba(239,68,68,0.02)",
                }}
              >
                <div
                  style={{
                    ...label,
                    color: "#ef4444",
                  }}
                >
                  Blocked Searches ({status.blocked_searches})
                </div>
                <p
                  style={{
                    fontSize: "0.8125rem",
                    color: "#9a9590",
                    lineHeight: 1.6,
                  }}
                >
                  {status.blocked_searches} duplicate
                  search{status.blocked_searches !== 1 ? "es" : ""}{" "}
                  blocked this session. The agent attempted
                  to re-run searches it already performed.
                </p>
              </div>
            )}

            {/* ── Hooks detail ─────────────────────────────── */}
            <div
              style={{
                ...glass,
                padding: "1.25rem",
                marginBottom: "1.5rem",
              }}
            >
              <div style={label}>
                Installed Hooks
              </div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns:
                    "repeat(auto-fill, minmax(220px, 1fr))",
                  gap: "0.375rem",
                }}
              >
                {ALL_HOOK_NAMES.map((hookName) => {
                  const installed = status.hooks.find(
                    (h) => h.name === hookName
                  );
                  return (
                    <div
                      key={hookName}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "0.5rem",
                        padding: "0.375rem 0.5rem",
                        borderRadius: "0.25rem",
                        background: installed
                          ? "rgba(34,197,94,0.04)"
                          : "rgba(255,255,255,0.02)",
                      }}
                    >
                      <span
                        style={{
                          color: installed
                            ? "#22c55e"
                            : "#6b6560",
                          fontSize: "0.8125rem",
                        }}
                      >
                        {installed
                          ? "\u2713"
                          : "\u00b7"}
                      </span>
                      <span
                        style={{
                          ...mono,
                          fontSize: "0.75rem",
                          color: installed
                            ? "#e8e6e3"
                            : "#6b6560",
                        }}
                      >
                        {hookName}
                      </span>
                      {installed &&
                        installed.detail && (
                          <span
                            style={{
                              ...mono,
                              fontSize: "0.625rem",
                              color: "#6b6560",
                            }}
                          >
                            (
                            {installed.detail}
                            )
                          </span>
                        )}
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        )}
      </div>
    </Layout>
  );
}

/* ── Constants ──────────────────────────────────────────────── */

const ALL_HOOK_NAMES = [
  "SessionStart",
  "UserPromptSubmit",
  "PreToolUse",
  "PostToolUse",
  "Stop",
  "SubagentStop",
  "InstructionsLoaded",
  "PreCompact",
  "SessionEnd",
  "FileChanged",
];

/* ── Tool badge colors ──────────────────────────────────────── */

function toolBadgeColor(tool: string): string {
  if (tool.startsWith("mcp__")) return "#a78bfa"; // purple for MCP
  switch (tool) {
    case "Grep":
    case "Glob":
      return "#60a5fa"; // blue for search
    case "Read":
      return "#9a9590"; // muted for read
    case "Edit":
    case "Write":
      return "#d97757"; // terracotta for mutations
    case "Bash":
      return "#22c55e"; // green for shell
    case "WebSearch":
    case "WebFetch":
      return "#eab308"; // yellow for web
    default:
      return "#9a9590";
  }
}

function toolBadgeBg(tool: string): string {
  const color = toolBadgeColor(tool);
  const r = parseInt(color.slice(1, 3), 16);
  const g = parseInt(color.slice(3, 5), 16);
  const b = parseInt(color.slice(5, 7), 16);
  return `rgba(${r},${g},${b},0.1)`;
}
