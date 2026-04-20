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

import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "convex/react";
import { api } from "../_convex/api";
import { Nav } from "../components/Nav";

type Tab = "scaffold" | "eval" | "world_model";

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

export function Builder() {
  const { slug } = useParams<{ slug: string }>();
  const [tab, setTab] = useState<Tab>("scaffold");

  const session = useQuery(
    api.domains.daas.architect.getSessionBySlug,
    slug ? { sessionSlug: slug } : "skip",
  );

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
      <div
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
          </div>
          <div style={{ padding: 24 }}>
            <BetaBanner />
            {tab === "scaffold" && <ScaffoldTab runtimeLane={session.runtimeLane ?? ""} />}
            {tab === "eval" && <EvalTab runtimeLane={session.runtimeLane ?? ""} />}
            {tab === "world_model" && (
              <WorldModelTab worldModelLane={session.worldModelLane ?? "lite"} />
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

function ScaffoldTab({ runtimeLane }: { runtimeLane: string }) {
  const { slug } = useParams<{ slug: string }>();
  const artifact = useQuery(
    api.domains.daas.compileDown.getScaffoldArtifact,
    slug ? { sessionSlug: slug } : "skip",
  );
  const [selectedFile, setSelectedFile] = useState<string | null>(null);

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
    return (
      <div>
        <h3 style={{ fontSize: 14, fontWeight: 500, margin: "0 0 4px" }}>
          Generated scaffold ({runtimeLane})
        </h3>
        <p style={{ fontSize: 12, color: "rgba(255,255,255,0.55)", margin: "0 0 20px" }}>
          {artifact.filesCount} files · {artifact.totalBytes} bytes · emitter{" "}
          <code style={{ fontSize: 11 }}>{artifact.emitterVersion}</code> · target{" "}
          <code style={{ fontSize: 11 }}>{artifact.targetModel}</code>
        </p>

        <div style={{ display: "grid", gridTemplateColumns: "220px 1fr", gap: 12, minHeight: 360 }}>
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
      <div style={{ display: "flex", gap: 8 }}>
        {["mock", "live", "hybrid"].map((mode) => (
          <button
            key={mode}
            type="button"
            style={{
              padding: "8px 16px",
              background: mode === "mock" ? "rgba(34,197,94,0.12)" : "rgba(255,255,255,0.04)",
              border:
                mode === "mock"
                  ? "1px solid rgba(34,197,94,0.4)"
                  : "1px solid rgba(255,255,255,0.08)",
              borderRadius: 6,
              color: mode === "mock" ? "#22c55e" : "rgba(255,255,255,0.65)",
              fontSize: 12,
              cursor: "pointer",
              textTransform: "capitalize",
            }}
          >
            {mode}
          </button>
        ))}
      </div>
      <p style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", margin: "10px 0 0" }}>
        Start with mocks. Promote to live only once source-of-truth connectors are
        wired — ungrounded replays produced hallucinated IDs in our FloorAI test.
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
        <div style={{ display: "grid", gridTemplateColumns: "220px 1fr", gap: 12, minHeight: 360 }}>
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
