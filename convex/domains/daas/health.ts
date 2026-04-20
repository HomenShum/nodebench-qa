// HTTP /health endpoint — simple liveness + shallow ingest health probe.
//
// Returns 200 JSON with:
//   { ok: true, deployment: "<convex-name>", radar_errors_24h: <count>,
//     classifier_recent_errors: <count>, shipped_docs_count: <int> }
//
// Used by external monitoring / deploy verification. Never blocks on
// expensive work; bounded to reads of the audit log.

import { httpAction } from "../../_generated/server";
import { api } from "../../_generated/api";


export const healthHandler = httpAction(async (ctx, request) => {
  // CORS for external checks
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Content-Type": "application/json",
  };

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const health = await ctx.runQuery(api.domains.daas.radar.getIngestHealth, {});

  const payload = {
    ok: true,
    checkedAt: Date.now(),
    radar: {
      githubReleasesLast:
        (health.githubReleases?.createdAt as number | null) ?? null,
      hackerNewsLast: (health.hackerNews?.createdAt as number | null) ?? null,
      errorsLast24h: health.errorsLast24h ?? 0,
    },
  };

  return new Response(JSON.stringify(payload, null, 2), {
    status: 200,
    headers: corsHeaders,
  });
});
