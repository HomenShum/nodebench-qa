# World model — full

- 2 entities
- 3 policies
- 0 actions

## Files

| File | Purpose |
|---|---|
| `entities.yaml` | Canonical types |
| `states.schema.ts` | Live state per entity |
| `events.schema.ts` | Append-only event ledger |
| `policies.yaml` | Rules enforced at every action |
| `actions.ts` | Bounded action registry |
| `outcomes.table.ts` | Feedback loop |
| `evidence_refs.json` | Source citations per claim |
| `interpretive_boundary.md` | Act-on vs interpret-first labels |

## How to use

1. Wire `actions.ts` into your agent's tool allowlist.
2. Load `policies.yaml` into the policy engine before each action.
3. Emit an event to `events.schema.ts` shape for every state change.
4. Close each session with an `OutcomeRow`.
5. Every claim in agent output carries a reference id into
   `evidence_refs.json`.
6. Every output surface labels its concepts per `interpretive_boundary.md`.
