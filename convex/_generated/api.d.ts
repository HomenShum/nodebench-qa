/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as crons from "../crons.js";
import type * as domains_daas_actions from "../domains/daas/actions.js";
import type * as domains_daas_admin from "../domains/daas/admin.js";
import type * as domains_daas_architect from "../domains/daas/architect.js";
import type * as domains_daas_architectClassifier from "../domains/daas/architectClassifier.js";
import type * as domains_daas_benchmarks from "../domains/daas/benchmarks.js";
import type * as domains_daas_fidelity from "../domains/daas/fidelity.js";
import type * as domains_daas_http from "../domains/daas/http.js";
import type * as domains_daas_mutations from "../domains/daas/mutations.js";
import type * as domains_daas_queries from "../domains/daas/queries.js";
import type * as domains_daas_radar from "../domains/daas/radar.js";
import type * as domains_daas_radarIngest from "../domains/daas/radarIngest.js";
import type * as domains_daas_rubrics from "../domains/daas/rubrics.js";
import type * as http from "../http.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  crons: typeof crons;
  "domains/daas/actions": typeof domains_daas_actions;
  "domains/daas/admin": typeof domains_daas_admin;
  "domains/daas/architect": typeof domains_daas_architect;
  "domains/daas/architectClassifier": typeof domains_daas_architectClassifier;
  "domains/daas/benchmarks": typeof domains_daas_benchmarks;
  "domains/daas/fidelity": typeof domains_daas_fidelity;
  "domains/daas/http": typeof domains_daas_http;
  "domains/daas/mutations": typeof domains_daas_mutations;
  "domains/daas/queries": typeof domains_daas_queries;
  "domains/daas/radar": typeof domains_daas_radar;
  "domains/daas/radarIngest": typeof domains_daas_radarIngest;
  "domains/daas/rubrics": typeof domains_daas_rubrics;
  http: typeof http;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
