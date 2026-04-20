// attrition.sh HTTP routes.
//
// POST /api/daas/ingest — public CanonicalTrace ingest
//                         (auth, rate limit, HMAC signing — see
//                         domains/daas/http.ts for details).

import { httpRouter } from "convex/server";
import { ingestHttp as daasIngestHttp } from "./domains/daas/http";
import { healthHandler } from "./domains/daas/health";

const http = httpRouter();

http.route({
  path: "/api/daas/ingest",
  method: "POST",
  handler: daasIngestHttp,
});

http.route({
  path: "/api/daas/ingest",
  method: "OPTIONS",
  handler: daasIngestHttp,
});

// Liveness + shallow ingest-health probe. Used by external monitoring
// and by the deploy verifier.
http.route({ path: "/health", method: "GET", handler: healthHandler });
http.route({ path: "/health", method: "OPTIONS", handler: healthHandler });

export default http;
