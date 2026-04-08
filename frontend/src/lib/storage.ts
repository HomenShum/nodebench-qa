// --------------------------------------------------------------------------
// localStorage-backed run history
// --------------------------------------------------------------------------

import type { QaCheckResult } from "./api";

const STORAGE_KEY = "bp_runs";
const MAX_RUNS = 100;

export interface QaRun {
  id: string;
  url: string;
  score: number;
  issueCount: number;
  durationMs: number;
  timestamp: string;
  result: QaCheckResult;
}

function readAll(): QaRun[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as QaRun[];
  } catch {
    return [];
  }
}

function writeAll(runs: QaRun[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(runs));
}

/** Save a run. Caps history at MAX_RUNS. */
export function saveRun(run: QaRun): void {
  const runs = readAll();
  // Replace if same ID exists (re-run scenario)
  const idx = runs.findIndex((r) => r.id === run.id);
  if (idx >= 0) {
    runs[idx] = run;
  } else {
    runs.unshift(run);
  }
  writeAll(runs.slice(0, MAX_RUNS));
}

/** Build a QaRun from a QaCheckResult and persist it. */
export function saveFromResult(result: QaCheckResult): QaRun {
  const run: QaRun = {
    id: result.id,
    url: result.url,
    score: result.score,
    issueCount: result.issues.length,
    durationMs: result.duration_ms,
    timestamp: result.timestamp,
    result,
  };
  saveRun(run);
  return run;
}

/** Get a single run by ID. */
export function getRun(id: string): QaRun | null {
  return readAll().find((r) => r.id === id) ?? null;
}

/** List all runs, newest first. */
export function listRuns(): QaRun[] {
  return readAll().sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
  );
}

/** Clear all stored runs. */
export function clearRuns(): void {
  localStorage.removeItem(STORAGE_KEY);
}
