import { useEffect, useState, useCallback } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { Layout } from "../components/Layout";
import { ScoreRing } from "../components/ScoreRing";
import { DimensionBar } from "../components/DimensionBar";
import { IssueCard, sortIssues } from "../components/IssueCard";
import { qaCheck } from "../lib/api";
import { getRun, saveFromResult, type QaRun } from "../lib/storage";

type PageState = "loading" | "ready" | "not-found" | "error" | "rerunning";

export function Results() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [state, setState] = useState<PageState>("loading");
  const [run, setRun] = useState<QaRun | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) {
      setState("not-found");
      return;
    }
    const stored = getRun(id);
    if (stored) {
      setRun(stored);
      setState("ready");
    } else {
      setState("not-found");
    }
  }, [id]);

  const handleRerun = useCallback(async () => {
    if (!run) return;
    setState("rerunning");
    setError(null);
    try {
      const result = await qaCheck(run.url);
      const newRun = saveFromResult(result);
      navigate(`/results/${newRun.id}`, { replace: true });
      setRun(newRun);
      setState("ready");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Rerun failed");
      setState("ready");
    }
  }, [run, navigate]);

  const formatDate = (ts: string) => {
    try {
      return new Date(ts).toLocaleString();
    } catch {
      return ts;
    }
  };

  const formatDuration = (ms: number) => {
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  };

  // --- Loading ---
  if (state === "loading" || state === "rerunning") {
    return (
      <Layout>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            minHeight: "60vh",
            flexDirection: "column",
            gap: "1rem",
          }}
        >
          <Spinner />
          <p style={{ color: "var(--text-muted)", fontSize: "0.9375rem" }}>
            {state === "rerunning" ? "Re-running QA check..." : "Loading results..."}
          </p>
        </div>
      </Layout>
    );
  }

  // --- Not Found ---
  if (state === "not-found" || !run) {
    return (
      <Layout>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            minHeight: "60vh",
            flexDirection: "column",
            gap: "1rem",
          }}
        >
          <p style={{ fontSize: "1.125rem", color: "var(--text-secondary)" }}>
            Run not found
          </p>
          <p style={{ color: "var(--text-muted)", fontSize: "0.875rem" }}>
            ID: {id ?? "none"}
          </p>
          <Link
            to="/"
            style={{
              marginTop: "0.5rem",
              padding: "0.625rem 1.5rem",
              borderRadius: "0.5rem",
              background: "var(--accent)",
              color: "#fff",
              textDecoration: "none",
              fontWeight: 600,
              fontSize: "0.875rem",
            }}
          >
            Start a new check
          </Link>
        </div>
      </Layout>
    );
  }

  // --- Ready ---
  const { result } = run;
  const dims = result.dimensions;
  const issues = sortIssues(result.issues);

  return (
    <Layout>
      <div
        style={{
          maxWidth: 960,
          margin: "0 auto",
          padding: "2rem 1.5rem",
        }}
      >
        {/* Hero section */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "2rem",
            flexWrap: "wrap",
            marginBottom: "2rem",
          }}
        >
          <ScoreRing score={result.score} size={140} strokeWidth={10} label="Overall" />

          <div style={{ flex: 1, minWidth: 200 }}>
            <h1
              style={{
                fontSize: "1.5rem",
                fontWeight: 700,
                letterSpacing: "-0.01em",
                marginBottom: "0.375rem",
              }}
            >
              QA Results
            </h1>
            <p
              style={{
                color: "var(--text-secondary)",
                fontSize: "0.9375rem",
                marginBottom: "0.25rem",
                wordBreak: "break-all",
              }}
            >
              {result.url}
            </p>
            <div
              style={{
                display: "flex",
                gap: "1.5rem",
                flexWrap: "wrap",
                fontSize: "0.8125rem",
                color: "var(--text-muted)",
              }}
            >
              <span>{formatDate(result.timestamp)}</span>
              <span>{formatDuration(result.duration_ms)}</span>
              <span>
                {issues.length} issue{issues.length !== 1 ? "s" : ""}
              </span>
            </div>
          </div>

          <button
            onClick={handleRerun}
            style={{
              padding: "0.625rem 1.25rem",
              borderRadius: "0.5rem",
              border: "1px solid var(--border)",
              background: "transparent",
              color: "var(--accent)",
              fontSize: "0.875rem",
              fontWeight: 600,
              cursor: "pointer",
              transition: "border-color 0.15s",
            }}
          >
            Run Again
          </button>
        </div>

        {/* Error from rerun */}
        {error && (
          <div
            style={{
              padding: "0.75rem 1rem",
              borderRadius: "0.5rem",
              background: "rgba(239,68,68,0.1)",
              border: "1px solid rgba(239,68,68,0.2)",
              color: "#ef4444",
              fontSize: "0.875rem",
              marginBottom: "1.5rem",
            }}
          >
            {error}
          </div>
        )}

        {/* Dimensions */}
        <div
          style={{
            padding: "1.25rem 1.5rem",
            borderRadius: "0.75rem",
            border: "1px solid var(--border)",
            background: "var(--bg-surface)",
            marginBottom: "1.5rem",
          }}
        >
          <h2
            style={{
              fontSize: "0.6875rem",
              textTransform: "uppercase",
              letterSpacing: "0.12em",
              color: "var(--text-muted)",
              marginBottom: "1rem",
            }}
          >
            Dimensions
          </h2>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.625rem" }}>
            {Object.entries(dims).map(([key, val]) => (
              <DimensionBar key={key} label={key} score={val} />
            ))}
          </div>
        </div>

        {/* Issues */}
        <div>
          <h2
            style={{
              fontSize: "0.6875rem",
              textTransform: "uppercase",
              letterSpacing: "0.12em",
              color: "var(--text-muted)",
              marginBottom: "0.75rem",
            }}
          >
            Issues ({issues.length})
          </h2>

          {issues.length === 0 ? (
            <div
              style={{
                padding: "2rem",
                borderRadius: "0.75rem",
                border: "1px solid var(--border)",
                background: "var(--bg-surface)",
                textAlign: "center",
                color: "var(--text-muted)",
              }}
            >
              No issues found. Clean report.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
              {issues.map((issue, i) => (
                <IssueCard key={`${issue.severity}-${issue.title}-${i}`} issue={issue} />
              ))}
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}

// --- Simple CSS spinner ---
function Spinner() {
  return (
    <div
      style={{
        width: 32,
        height: 32,
        border: "3px solid var(--border)",
        borderTopColor: "var(--accent)",
        borderRadius: "50%",
        animation: "bp-spin 0.6s linear infinite",
      }}
    >
      <style>{`@keyframes bp-spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  );
}
