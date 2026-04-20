// attrition.sh Convex schema.
//
// Only DaaS tables live here. If this deployment ever adds adjacent
// features, add their table imports below the daas block.

import { defineSchema } from "convex/server";
import {
  daasTraces,
  daasWorkflowSpecs,
  daasReplays,
  daasJudgments,
  daasRateBuckets,
  daasAuditLog,
  daasApiKeys,
  daasBenchmarkRuns,
} from "./domains/daas/schema";

export default defineSchema({
  daasTraces,
  daasWorkflowSpecs,
  daasReplays,
  daasJudgments,
  daasRateBuckets,
  daasAuditLog,
  daasApiKeys,
  daasBenchmarkRuns,
});
