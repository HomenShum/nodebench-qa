# World Model Spec

Formal definition of what attrition's world-model substrate emitter
produces. Source: `daas/compile_down/world_model/emitter.py`. Two
variants: `lite` and `full`.

## Why this substrate exists

Most agent failures we see aren't the model hallucinating — they're
the MODEL OUTPUT being treated as operational truth when it was
actually a judgment call. The quiet-failure mode from Nate B Jones'
world-model talk (Radar pattern row `pattern:world_model:interpretive_boundary`):

> *"Plausible interpretations masquerading as settled operational truth."*

The substrate exists to **make every field carry a boundary label**:
`act_on` (factual, verified, low-risk) vs `interpret_first` (judgment
call, trend reading, correlation).

## Lite variant (3 files)

Used when the workflow is bounded and doesn't need live state, policy,
or outcome tracking.

| File | Purpose |
|---|---|
| `entities.yaml` | Canonical types: what things exist in this workflow (session, user query, per-tool output entities) |
| `schemas.ts` | Strict TypeScript types derived from `entities.yaml` |
| `README.md` | How to use, what's NOT here |

## Full variant (9 files)

Used when the workflow must read, decide, write, escalate, and be
auditable.

| File | Purpose |
|---|---|
| `entities.yaml` | Canonical types (same as lite) |
| `states.schema.ts` | Current-state snapshots per entity (live-updated, with retention) |
| `events.schema.ts` | Append-only event ledger (`<entity>.created`, `<entity>.updated`) |
| `policies.yaml` | Rules enforced at every action emission |
| `actions.ts` | Bounded set of actions the agent may emit |
| `outcomes.table.ts` | `OutcomeRow` feedback loop (success/partial/fail + evidence refs + cost) |
| `evidence_refs.json` | Source citations per claim |
| `interpretive_boundary.md` | `act_on` vs `interpret_first` labels for every field |
| `README.md` | How to wire into the agent runtime |

## Auto-derivation rules

Given a `WorkflowSpec`, the emitter produces:

### entities
- Always include `agent_session` and `user_query` as base entities
- For every tool in the spec: add `<tool>_result` entity with fields
  `tool_call_id`, `args`, `output`, `produced_at`
- Per-field `boundary`:
  - `act_on` for: ids, timestamps, verified inputs, raw tool outputs
  - `interpret_first` for: inferred intent, labels, synthesized fields

### states
- One `<EntityName>State` interface per entity
- Default retention: `session` for agent_session + user_query, `30d`
  otherwise

### events
- Two events per entity: `.created` and `.updated`
- Append-only ledger; never mutate

### policies
- Domain rules from the spec land as individual policies
- 3 universal base policies always included:
  1. *"Every tool call must carry a verifiable source reference."*
  2. *"If output contains a trend claim, it must be labeled
     interpret_first."*
  3. *"Record an outcome row for every session (success | partial |
     fail) with evidence refs."*

### actions
- One entry per tool in the spec
- Default `requires_approval: false`, `boundary: act_on`
- Empty spec → `ActionName = never` (type-level safety)

### interpretive boundary
- Scans every field of every entity
- Lists them into two markdown sections

## Schema + CLI

```bash
python -m daas.compile_down.cli \
  --session-slug <slug> \
  --trace <trace.json> \
  --runtime-lane tool_first_chain \
  --world-model-lane full \
  --record
```

The `--record` flag pushes the world-model bundle to Convex at
`daasGeneratedArtifacts.runtimeLane = "world_model_full"` (or
`"world_model_lite"`). The Builder queries it via
`getWorldModelArtifact`.

## Hints override

For custom workflows, users can override auto-derivation:

```python
from daas.compile_down.world_model import emit_world_model

bundle = emit_world_model(
    "full",
    spec,
    hints={
        "entities": [...],   # user-supplied; overrides auto-derivation
        "policies": [...],
        "actions": [...],
    },
)
```

Keys are the filename stems. Any missing key falls back to
auto-derivation. Locked by
`test_hints_override_auto_derivation` in
`daas/tests/test_world_model_emitter.py`.

## Testing contract

14 scenario tests in `daas/tests/test_world_model_emitter.py` lock:

- File sets per lane (lite=3, full=9)
- `agent_session` + `user_query` always present
- Tool-derived entities appear as `<tool>_result`
- Domain rules + 3 base policies in `policies.yaml`
- Actions `never` when no tools
- `interpretive_boundary.md` labels every field
- `evidence_refs.json` is valid JSON
- Hints-override bypasses auto-derivation
- `states.schema.ts` references entity names correctly

## Failure modes to watch

- **Mislabeled boundary**: a `tool_result.output` labeled `interpret_first`
  is too conservative; an inferred field labeled `act_on` is dangerous.
  The auto-derivation defaults conservatively (most things = `act_on`
  except explicitly-synthesized fields like `user_query.intent`).
- **Growing entity set**: every tool adds an entity. If a spec has
  50 tools, the substrate is 50+ entities. Consider grouping.
- **Stale policies**: the 3 base policies are good defaults but every
  shipping workflow needs its own. Add domain rules to the
  `WorkflowSpec` before emitting; they land as policy rows.

## Related

- `daas/compile_down/world_model/emitter.py` — source
- `docs/BUILDER_GENERATION_SPEC.md` — how this fits into the broader
  emission pipeline
- `docs/ATTRITION_PRODUCT_VISION_PITCH.md` — why the interpretive
  boundary is part of the product, not just a doc
