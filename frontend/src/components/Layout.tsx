import { type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { useChat } from "../contexts/ChatContext";
import { ChatPanel } from "./ChatPanel";

const NAV_LINKS = [
  { to: "/", label: "Home" },
  { to: "/live", label: "Live" },
  { to: "/proof", label: "Proof" },
  { to: "/improvements", label: "Improvements" },
  { to: "/workflows", label: "Workflows" },
  { to: "/judge", label: "Judge" },
  { to: "/anatomy", label: "Anatomy" },
  { to: "/benchmark", label: "Benchmark" },
  { to: "/get-started", label: "Get Started" },
] as const;

const navStyle: React.CSSProperties = {
  position: "sticky",
  top: 0,
  zIndex: 50,
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "0 1.5rem",
  height: 56,
  borderBottom: "1px solid var(--border)",
  background: "rgba(10,10,11,0.85)",
  backdropFilter: "blur(12px)",
  WebkitBackdropFilter: "blur(12px)",
};

const logoStyle: React.CSSProperties = {
  fontSize: "1.125rem",
  fontWeight: 700,
  letterSpacing: "-0.02em",
  textDecoration: "none",
  color: "var(--text-primary)",
};

const footerStyle: React.CSSProperties = {
  borderTop: "1px solid var(--border)",
  padding: "1.5rem",
  textAlign: "center",
  fontSize: "0.8125rem",
  color: "var(--text-muted)",
};

export function Layout({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const { togglePanel } = useChat();

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        background: "var(--bg-primary)",
      }}
    >
      {/* Top nav */}
      <nav style={navStyle}>
        <Link to="/" style={logoStyle}>
          att<span style={{ color: "var(--accent)" }}>rition</span>
        </Link>

        <div style={{ display: "flex", gap: "0.25rem" }}>
          {NAV_LINKS.map(({ to, label }) => {
            const active = pathname === to;
            return (
              <Link
                key={to}
                to={to}
                style={{
                  padding: "0.375rem 0.875rem",
                  borderRadius: "0.5rem",
                  fontSize: "0.875rem",
                  fontWeight: 500,
                  textDecoration: "none",
                  color: active ? "var(--accent)" : "var(--text-secondary)",
                  background: active ? "rgba(217,119,87,0.08)" : "transparent",
                  transition: "color 0.15s, background 0.15s",
                }}
              >
                {label}
              </Link>
            );
          })}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
          <button
            onClick={togglePanel}
            style={{
              padding: "0.375rem 0.875rem",
              borderRadius: "0.5rem",
              border: "1px solid rgba(217,119,87,0.3)",
              background: "rgba(217,119,87,0.06)",
              color: "#d97757",
              fontSize: "0.8125rem",
              fontWeight: 600,
              cursor: "pointer",
              transition: "background 0.15s, border-color 0.15s",
              whiteSpace: "nowrap",
            }}
          >
            Ask attrition
          </button>
          <a
            href="https://github.com/HomenShum/attrition"
            target="_blank"
            rel="noopener noreferrer"
            style={{
              fontSize: "0.8125rem",
              color: "var(--text-muted)",
              textDecoration: "none",
            }}
          >
            GitHub
          </a>
        </div>
      </nav>

      {/* Main content */}
      <main style={{ flex: 1 }}>{children}</main>

      {/* Footer */}
      <footer style={footerStyle}>
        attrition &middot; enforcement hooks for AI agents
      </footer>

      {/* Chat panel (slide-over) */}
      <ChatPanel />
    </div>
  );
}
