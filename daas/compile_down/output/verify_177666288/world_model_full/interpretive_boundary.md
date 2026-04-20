# Interpretive boundary

Every concept emitted from this world model carries one of two labels.

## Act on this (factual / verified / low-risk)

These fields are the output of deterministic tools or schema-validated
inputs. Downstream consumers can use them directly as operational truth.

- `agent_session.session_id`
- `agent_session.started_at`
- `agent_session.status`
- `user_query.query_id`
- `user_query.text`

## Interpret this first (judgment call / trend / correlation)

These fields require human review before action. They surface signal
but may be noise, coincidence, or causally ambiguous.

- `user_query.intent`

## Why this file exists

World models fail quietly when plausible interpretations masquerade
as settled truth. The product-level rule: every generated surface
shows its boundary label. No exceptions.
