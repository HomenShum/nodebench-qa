import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { Layout } from "../components/Layout";
import { ScoreRing } from "../components/ScoreRing";
import { uxAudit } from "../lib/api";
import type { UxAuditResult, UxRule } from "../lib/api";

const STATUS_STYLES: Record<
  UxRule["status"],
  { color: string; bg: string; label: string }
> = {
  pass: { color: "#22c55e", bg: "rgba(34,197,94,0.1)", label: "PASS" },
  fail: { color: "#ef4444", bg: "rgba(239,68,68,0.1)", label: "FAIL" },
  skip: { color: "#6b7280", bg: "rgba(107,114,128,0.1)", label: "SKIP" },
};

export function Audit() {
  const [searchParams] = useSearchParams();
  const [url, setUrl] = useState(searchParams.get("url") ?? "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<UxAuditResult | null>(null);

  useEffect(() => {
    const prefilledUrl = searchParams.get("url");
    if (prefilledUrl) {
      setUrl(prefilledUrl);
      runAudit(prefilledUrl);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const runAudit = async (targetUrl: string) => {
    if (!targetUrl.trim()) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const data = await uxAudit(targetUrl.trim());
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "UX audit failed");
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = () => runAudit(url);

  // Count by status
  const counts = result
    ? {
        pass: result.rules.filter((r) => r.status === "pass").length,
        fail: result.rules.filter((r) => r.status === "fail").length,
        skip: result.rules.filter((r) => r.status === "skip").length,
      }
    : null;

  return (
    <Layout>
      <div style={{ maxWidth: 1024, margin: "0 auto", padding: "2rem 1.5rem" }}>
        <h1
          style={{
            fontSize: "2rem",
            fontWeight: 700,
            letterSpacing: "-0.02em",
            marginBottom: "0.5rem",
          }}
        >
          UX Audit
        </h1>
        <p
          style={{
            color: "var(--text-secondary)",
            fontSize: "0.9375rem",
            marginBottom: "1.5rem",
          }}
        >
          Run 21 heuristic rules against any URL and get actionable
          recommendations.
        </p>

        {/* Input */}
        <div
          style={{
            display: "flex",
            gap: "0.75rem",
            marginBottom: "1.5rem",
            maxWidth: 600,
          }}
        >
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://your-app.com"
            onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
            style={{
              flex: 1,
              padding: "0.75rem 1rem",
              borderRadius: "0.5rem",
              border: "1px solid var(--border)",
              background: "var(--bg-surface)",
              color: "var(--text-primary)",
              fontSize: "0.9375rem",
              outline: "none",
            }}
          />
          <button
            onClick={handleSubmit}
            disabled={loading || !url.trim()}
            style={{
              padding: "0.75rem 1.5rem",
              borderRadius: "0.5rem",
              border: "none",
              background: "var(--accent)",
              color: "#fff",
              fontSize: "0.9375rem",
              fontWeight: 600,
              cursor: loading ? "wait" : "pointer",
              opacity: loading || !url.trim() ? 0.5 : 1,
            }}
          >
            {loading ? "Auditing..." : "Audit"}
          </button>
        </div>

        {/* Error */}
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

        {/* Loading */}
        {loading && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "3rem",
            }}
          >
            <Spinner />
          </div>
        )}

        {/* Results */}
        {result && !loading && (
          <>
            {/* Hero: score + summary */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "2rem",
                flexWrap: "wrap",
                marginBottom: "2rem",
                padding: "1.5rem",
                borderRadius: "0.75rem",
                border: "1px solid var(--border)",
                background: "var(--bg-surface)",
              }}
            >
              <ScoreRing score={result.score} size={120} label="UX Score" />

              <div style={{ flex: 1, minWidth: 180 }}>
                <div
                  style={{
                    display: "flex",
                    gap: "1.5rem",
                    flexWrap: "wrap",
                    marginBottom: "0.75rem",
                  }}
                >
                  {counts &&
                    (
                      [
                        ["Passed", counts.pass, "#22c55e"],
                        ["Failed", counts.fail, "#ef4444"],
                        ["Skipped", counts.skip, "#6b7280"],
                      ] as const
                    ).map(([label, count, color]) => (
                      <div key={label}>
                        <div
                          style={{
                            fontSize: "1.5rem",
                            fontWeight: 700,
                            fontFamily: "'JetBrains Mono', monospace",
                            color,
                          }}
                        >
                          {count}
                        </div>
                        <div
                          style={{
                            fontSize: "0.6875rem",
                            textTransform: "uppercase",
                            letterSpacing: "0.08em",
                            color: "var(--text-muted)",
                          }}
                        >
                          {label}
                        </div>
                      </div>
                    ))}
                </div>
                <p
                  style={{
                    fontSize: "0.8125rem",
                    color: "var(--text-muted)",
                  }}
                >
                  {result.rules.length} rules evaluated &middot;{" "}
                  {result.duration_ms < 1000
                    ? `${result.duration_ms}ms`
                    : `${(result.duration_ms / 1000).toFixed(1)}s`}
                </p>
              </div>
            </div>

            {/* Rules grid */}
            <h2
              style={{
                fontSize: "0.6875rem",
                textTransform: "uppercase",
                letterSpacing: "0.12em",
                color: "var(--text-muted)",
                marginBottom: "0.75rem",
              }}
            >
              Rules ({result.rules.length})
            </h2>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
                gap: "0.75rem",
              }}
            >
              {result.rules.map((rule: UxRule) => {
                const s = STATUS_STYLES[rule.status];
                return (
                  <div
                    key={rule.id}
                    style={{
                      padding: "1rem 1.25rem",
                      borderRadius: "0.75rem",
                      border: `1px solid ${rule.status === "fail" ? "rgba(239,68,68,0.2)" : "var(--border)"}`,
                      background: "var(--bg-surface)",
                      display: "flex",
                      flexDirection: "column",
                      gap: "0.5rem",
                    }}
                  >
                    {/* Header */}
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "0.625rem",
                      }}
                    >
                      <span
                        style={{
                          display: "inline-block",
                          padding: "0.125rem 0.5rem",
                          borderRadius: "0.25rem",
                          fontSize: "0.625rem",
                          fontWeight: 700,
                          letterSpacing: "0.06em",
                          color: s.color,
                          background: s.bg,
                        }}
                      >
                        {s.label}
                      </span>
                      <span
                        style={{
                          fontWeight: 600,
                          fontSize: "0.875rem",
                        }}
                      >
                        {rule.name}
                      </span>
                    </div>

                    {/* Recommendation */}
                    {rule.recommendation && (
                      <p
                        style={{
                          fontSize: "0.8125rem",
                          color: "var(--text-secondary)",
                          lineHeight: 1.5,
                          margin: 0,
                        }}
                      >
                        {rule.recommendation}
                      </p>
                    )}

                    {/* Details */}
                    {rule.details && (
                      <p
                        style={{
                          fontSize: "0.75rem",
                          color: "var(--text-muted)",
                          lineHeight: 1.4,
                          margin: 0,
                        }}
                      >
                        {rule.details}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}

        {/* Idle state */}
        {!result && !loading && !error && (
          <div
            style={{
              padding: "3rem",
              borderRadius: "0.75rem",
              border: "1px solid var(--border)",
              background: "var(--bg-surface)",
              textAlign: "center",
              color: "var(--text-muted)",
              fontSize: "0.9375rem",
            }}
          >
            Enter a URL above to run a UX heuristic audit.
          </div>
        )}
      </div>
    </Layout>
  );
}

function Spinner() {
  return (
    <div
      style={{
        width: 28,
        height: 28,
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
