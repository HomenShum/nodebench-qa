import { type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";

const NAV_LINKS = [
  { to: "/", label: "Home" },
  { to: "/dashboard", label: "Dashboard" },
  { to: "/sitemap", label: "Sitemap" },
  { to: "/audit", label: "Audit" },
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
          bench<span style={{ color: "var(--accent)" }}>press</span>
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

        <a
          href="https://github.com/Homen-ta/benchpress"
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
      </nav>

      {/* Main content */}
      <main style={{ flex: 1 }}>{children}</main>

      {/* Footer */}
      <footer style={footerStyle}>
        benchpress &middot; workflow memory + distillation engine
      </footer>
    </div>
  );
}
