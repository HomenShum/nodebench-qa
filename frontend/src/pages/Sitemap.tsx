import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { Layout } from "../components/Layout";
import { sitemap as fetchSitemap } from "../lib/api";
import type { SitemapResult, SitemapPage } from "../lib/api";

export function Sitemap() {
  const [searchParams] = useSearchParams();
  const [url, setUrl] = useState(searchParams.get("url") ?? "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SitemapResult | null>(null);

  // Auto-trigger if URL came from query param
  useEffect(() => {
    const prefilledUrl = searchParams.get("url");
    if (prefilledUrl) {
      setUrl(prefilledUrl);
      runSitemap(prefilledUrl);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const runSitemap = async (targetUrl: string) => {
    if (!targetUrl.trim()) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const data = await fetchSitemap(targetUrl.trim());
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sitemap crawl failed");
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = () => runSitemap(url);

  const statusColor = (status: number) => {
    if (status >= 200 && status < 300) return "#22c55e";
    if (status >= 300 && status < 400) return "#eab308";
    return "#ef4444";
  };

  const depthIndent = (depth: number) => ({
    paddingLeft: `${depth * 1.25}rem`,
  });

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
          Sitemap Explorer
        </h1>
        <p
          style={{
            color: "var(--text-secondary)",
            fontSize: "0.9375rem",
            marginBottom: "1.5rem",
          }}
        >
          Crawl a URL and discover all reachable pages with status codes and link counts.
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
            {loading ? "Crawling..." : "Crawl"}
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

        {/* Loading spinner */}
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
            {/* Summary bar */}
            <div
              style={{
                display: "flex",
                gap: "1.5rem",
                flexWrap: "wrap",
                marginBottom: "1rem",
                fontSize: "0.875rem",
                color: "var(--text-secondary)",
              }}
            >
              <span>
                <strong style={{ color: "var(--text-primary)" }}>
                  {result.total_pages}
                </strong>{" "}
                pages found
              </span>
              <span>
                Crawled in{" "}
                <strong style={{ color: "var(--text-primary)" }}>
                  {result.crawl_duration_ms < 1000
                    ? `${result.crawl_duration_ms}ms`
                    : `${(result.crawl_duration_ms / 1000).toFixed(1)}s`}
                </strong>
              </span>
            </div>

            {/* Page list */}
            <div
              style={{
                borderRadius: "0.75rem",
                border: "1px solid var(--border)",
                background: "var(--bg-surface)",
                overflow: "hidden",
              }}
            >
              {/* Header */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 60px 48px",
                  gap: "0.5rem",
                  padding: "0.625rem 1rem",
                  borderBottom: "1px solid var(--border)",
                  fontSize: "0.6875rem",
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                  color: "var(--text-muted)",
                  fontWeight: 600,
                }}
              >
                <span>Page</span>
                <span style={{ textAlign: "center" }}>Status</span>
                <span style={{ textAlign: "center" }}>Links</span>
              </div>

              {/* Rows */}
              {result.pages.length === 0 ? (
                <div
                  style={{
                    padding: "2rem",
                    textAlign: "center",
                    color: "var(--text-muted)",
                  }}
                >
                  No pages discovered.
                </div>
              ) : (
                result.pages.map((page: SitemapPage, i: number) => (
                  <div
                    key={`${page.url}-${i}`}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr 60px 48px",
                      gap: "0.5rem",
                      padding: "0.625rem 1rem",
                      borderBottom:
                        i < result.pages.length - 1
                          ? "1px solid var(--border)"
                          : "none",
                      alignItems: "center",
                    }}
                  >
                    {/* URL + title with depth indent */}
                    <div style={depthIndent(page.depth)}>
                      <div
                        style={{
                          fontSize: "0.875rem",
                          color: "var(--text-primary)",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {page.title || page.url}
                      </div>
                      {page.title && (
                        <div
                          style={{
                            fontSize: "0.75rem",
                            color: "var(--text-muted)",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {page.url}
                        </div>
                      )}
                    </div>

                    {/* Status code */}
                    <div style={{ textAlign: "center" }}>
                      <span
                        style={{
                          display: "inline-block",
                          padding: "0.125rem 0.375rem",
                          borderRadius: "0.25rem",
                          fontSize: "0.75rem",
                          fontWeight: 600,
                          fontFamily: "'JetBrains Mono', monospace",
                          color: statusColor(page.status),
                          background: `${statusColor(page.status)}15`,
                        }}
                      >
                        {page.status}
                      </span>
                    </div>

                    {/* Link count */}
                    <div
                      style={{
                        textAlign: "center",
                        fontSize: "0.8125rem",
                        color: "var(--text-secondary)",
                        fontFamily: "'JetBrains Mono', monospace",
                      }}
                    >
                      {page.links}
                    </div>
                  </div>
                ))
              )}
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
            Enter a URL above to discover all reachable pages.
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
