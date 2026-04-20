// Append-only event ledger. Every state change emits an event.

// event_type: "agent_session.created"
export interface AgentSession.createdEvent {
  event_id: string;
  entity: "agent_session";
  event_type: "agent_session.created";
  at: string; // ISO-8601
  payload: {
    id: string;
    at: datetime;
  };
}

// event_type: "agent_session.updated"
export interface AgentSession.updatedEvent {
  event_id: string;
  entity: "agent_session";
  event_type: "agent_session.updated";
  at: string; // ISO-8601
  payload: {
    id: string;
    changed_fields: array;
    at: datetime;
  };
}

// event_type: "user_query.created"
export interface UserQuery.createdEvent {
  event_id: string;
  entity: "user_query";
  event_type: "user_query.created";
  at: string; // ISO-8601
  payload: {
    id: string;
    at: datetime;
  };
}

// event_type: "user_query.updated"
export interface UserQuery.updatedEvent {
  event_id: string;
  entity: "user_query";
  event_type: "user_query.updated";
  at: string; // ISO-8601
  payload: {
    id: string;
    changed_fields: array;
    at: datetime;
  };
}

