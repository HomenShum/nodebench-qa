// Outcome feedback loop. Every session closes with an outcome row
// so the world model can learn what happened after each action.

export interface OutcomeRow {
  session_id: string;
  outcome: "success" | "partial" | "fail";
  evidence_refs: string[]; // ids into evidence_refs.json
  cost_usd: number;
  duration_ms: number;
  notes: string; // human / auto-generated post-mortem
  at: string; // ISO-8601
}
