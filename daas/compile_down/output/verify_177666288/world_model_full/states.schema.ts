// Current-state snapshots. One row per entity, live-updated.

export interface AgentSessionState {
  entity_id: string;
  retention: "session";
  last_updated: string; // ISO-8601
  // fields tracked:
  // - session_id
  // - started_at
  // - status
}

export interface UserQueryState {
  entity_id: string;
  retention: "session";
  last_updated: string; // ISO-8601
  // fields tracked:
  // - query_id
  // - text
  // - intent
}

