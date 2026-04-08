// --------------------------------------------------------------------------
// benchpress API client
// All endpoints proxy through Vite -> localhost:8100
// --------------------------------------------------------------------------

/** Shape returned by POST /api/qa/check */
export interface QaCheckResult {
  id: string;
  url: string;
  score: number;
  duration_ms: number;
  dimensions: {
    js_errors: number;
    accessibility: number;
    performance: number;
    layout: number;
    seo: number;
    security: number;
  };
  issues: QaIssue[];
  timestamp: string;
}

export interface QaIssue {
  severity: "critical" | "high" | "medium" | "low" | "info";
  title: string;
  description: string;
  selector?: string;
  dimension?: string;
}

/** Shape returned by POST /api/qa/sitemap */
export interface SitemapResult {
  url: string;
  pages: SitemapPage[];
  total_pages: number;
  crawl_duration_ms: number;
  timestamp: string;
}

export interface SitemapPage {
  url: string;
  title: string;
  status: number;
  depth: number;
  links: number;
  content_type?: string;
}

/** Shape returned by POST /api/qa/ux-audit */
export interface UxAuditResult {
  url: string;
  score: number;
  rules: UxRule[];
  timestamp: string;
  duration_ms: number;
}

export interface UxRule {
  id: string;
  name: string;
  status: "pass" | "fail" | "skip";
  recommendation?: string;
  details?: string;
}

/** Shape returned by POST /api/qa/diff-crawl */
export interface DiffCrawlResult {
  url: string;
  baseline_pages: number;
  current_pages: number;
  added: string[];
  removed: string[];
  changed: DiffChange[];
  timestamp: string;
}

export interface DiffChange {
  url: string;
  field: string;
  before: string;
  after: string;
}

/** Shape returned by GET /health */
export interface HealthData {
  status: string;
  version: string;
  uptime_secs: number;
  requests_served: number;
}

// --------------------------------------------------------------------------
// Error wrapper
// --------------------------------------------------------------------------

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      if (body?.error) msg = body.error;
    } catch {
      /* ignore parse failures */
    }
    throw new ApiError(res.status, msg);
  }
  return res.json() as Promise<T>;
}

function post<T>(url: string, body: Record<string, unknown>): Promise<T> {
  return request<T>(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// --------------------------------------------------------------------------
// Public API
// --------------------------------------------------------------------------

export function qaCheck(url: string): Promise<QaCheckResult> {
  return post<QaCheckResult>("/api/qa/check", { url });
}

export function sitemap(url: string): Promise<SitemapResult> {
  return post<SitemapResult>("/api/qa/sitemap", { url });
}

export function uxAudit(url: string): Promise<UxAuditResult> {
  return post<UxAuditResult>("/api/qa/ux-audit", { url });
}

export function diffCrawl(url: string): Promise<DiffCrawlResult> {
  return post<DiffCrawlResult>("/api/qa/diff-crawl", { url });
}

export function health(): Promise<HealthData> {
  return request<HealthData>("/health");
}
