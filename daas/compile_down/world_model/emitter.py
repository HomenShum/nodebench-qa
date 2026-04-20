"""World-model substrate emitter — lite and full variants.

Given a WorkflowSpec + optional user hints, emit an ArtifactBundle
with canonical files. The Builder's World Model tab reads these
bundles at runtimeLane = ``world_model_lite`` / ``world_model_full``
so the existing artifact storage doesn't need new tables.
"""

from __future__ import annotations

import json
from typing import Any

from daas.compile_down.artifact import ArtifactBundle

WORLD_MODEL_LANES = ("lite", "full")


def emit_world_model(
    lane: str,
    spec: Any,
    *,
    hints: dict[str, Any] | None = None,
) -> ArtifactBundle:
    """Dispatch to lite / full world-model emitter.

    ``hints`` can override auto-derivation with user-provided entities,
    states, policies. Keys are the filename stems (e.g., "entities",
    "policies"). Missing keys are auto-derived from the WorkflowSpec.
    """
    if lane not in WORLD_MODEL_LANES:
        raise ValueError(
            f"Unknown world_model lane {lane!r}. Expected one of {WORLD_MODEL_LANES}."
        )
    hints = hints or {}
    if lane == "lite":
        return _emit_lite(spec, hints)
    return _emit_full(spec, hints)


# ---------------------------------------------------------------------------
# Lite: entities + schemas only
# ---------------------------------------------------------------------------


def _emit_lite(spec: Any, hints: dict[str, Any]) -> ArtifactBundle:
    bundle = ArtifactBundle(
        runtime_lane="world_model_lite",
        target_model=str(getattr(spec, "executor_model", "")),
    )
    entities = _derive_entities(spec, hints)
    bundle.add("entities.yaml", _entities_yaml(entities), "yaml")
    bundle.add("schemas.ts", _schemas_ts(entities), "typescript")
    bundle.add("README.md", _readme_lite(entities), "markdown")
    return bundle


# ---------------------------------------------------------------------------
# Full: entities + states + events + policies + actions + outcomes +
#       evidence + interpretive boundary
# ---------------------------------------------------------------------------


def _emit_full(spec: Any, hints: dict[str, Any]) -> ArtifactBundle:
    bundle = ArtifactBundle(
        runtime_lane="world_model_full",
        target_model=str(getattr(spec, "executor_model", "")),
    )
    entities = _derive_entities(spec, hints)
    states = _derive_states(entities, hints)
    events = _derive_events(entities, hints)
    policies = _derive_policies(spec, hints)
    actions = _derive_actions(spec, hints)

    bundle.add("entities.yaml", _entities_yaml(entities), "yaml")
    bundle.add("states.schema.ts", _states_schema_ts(states), "typescript")
    bundle.add("events.schema.ts", _events_schema_ts(events), "typescript")
    bundle.add("policies.yaml", _policies_yaml(policies), "yaml")
    bundle.add("actions.ts", _actions_ts(actions), "typescript")
    bundle.add("outcomes.table.ts", _outcomes_table_ts(entities), "typescript")
    bundle.add("evidence_refs.json", _evidence_refs_json(spec), "json")
    bundle.add(
        "interpretive_boundary.md",
        _interpretive_boundary_md(entities, states, policies),
        "markdown",
    )
    bundle.add("README.md", _readme_full(entities, policies, actions), "markdown")
    return bundle


# ---------------------------------------------------------------------------
# Derivers — auto-extract entities/states/policies from a WorkflowSpec
# ---------------------------------------------------------------------------


def _derive_entities(spec: Any, hints: dict[str, Any]) -> list[dict[str, Any]]:
    if "entities" in hints and isinstance(hints["entities"], list):
        return hints["entities"]

    # Heuristic: each distinct tool in the spec implies an entity it operates on.
    # We also add the default "agent_session" and "user_query" entities.
    entities: list[dict[str, Any]] = [
        {
            "name": "agent_session",
            "purpose": "One orchestrator run; groups all tool calls + outputs.",
            "fields": [
                {"name": "session_id", "type": "string", "boundary": "act_on"},
                {"name": "started_at", "type": "datetime", "boundary": "act_on"},
                {"name": "status", "type": "enum[running, done, failed]", "boundary": "act_on"},
            ],
        },
        {
            "name": "user_query",
            "purpose": "The user's input that triggered this workflow.",
            "fields": [
                {"name": "query_id", "type": "string", "boundary": "act_on"},
                {"name": "text", "type": "string", "boundary": "act_on"},
                {"name": "intent", "type": "string", "boundary": "interpret_first"},
            ],
        },
    ]
    for tool in (getattr(spec, "tools", None) or []):
        tool_name = tool.get("name") if isinstance(tool, dict) else getattr(tool, "name", None)
        if not tool_name:
            continue
        entity_name = tool_name.replace(".", "_").replace("-", "_") + "_result"
        entities.append(
            {
                "name": entity_name,
                "purpose": f"Output of the `{tool_name}` tool.",
                "fields": [
                    {"name": "tool_call_id", "type": "string", "boundary": "act_on"},
                    {"name": "args", "type": "object", "boundary": "act_on"},
                    {"name": "output", "type": "any", "boundary": "act_on"},
                    {"name": "produced_at", "type": "datetime", "boundary": "act_on"},
                ],
            }
        )
    return entities


def _derive_states(entities: list[dict[str, Any]], hints: dict[str, Any]) -> list[dict[str, Any]]:
    if "states" in hints and isinstance(hints["states"], list):
        return hints["states"]
    return [
        {
            "entity": e["name"],
            "state": "current",
            "fields": [f["name"] for f in e.get("fields", [])],
            "retention": "session" if e["name"] in ("agent_session", "user_query") else "30d",
        }
        for e in entities
    ]


def _derive_events(entities: list[dict[str, Any]], hints: dict[str, Any]) -> list[dict[str, Any]]:
    if "events" in hints and isinstance(hints["events"], list):
        return hints["events"]
    events: list[dict[str, Any]] = []
    for e in entities:
        events.append(
            {
                "entity": e["name"],
                "event_type": f"{e['name']}.created",
                "payload": {"id": "string", "at": "datetime"},
            }
        )
        events.append(
            {
                "entity": e["name"],
                "event_type": f"{e['name']}.updated",
                "payload": {"id": "string", "changed_fields": "array", "at": "datetime"},
            }
        )
    return events


def _derive_policies(spec: Any, hints: dict[str, Any]) -> list[dict[str, Any]]:
    if "policies" in hints and isinstance(hints["policies"], list):
        return hints["policies"]
    # Seed policies from domain_rules on the spec, plus universal defaults.
    policies: list[dict[str, Any]] = []
    for rule in (getattr(spec, "domain_rules", None) or []):
        policies.append(
            {
                "id": f"policy_{len(policies) + 1:03d}",
                "trigger": "on_every_action",
                "rule": str(rule),
                "severity": "blocking",
                "boundary": "act_on",
            }
        )
    policies.extend(
        [
            {
                "id": "policy_base_001",
                "trigger": "on_tool_emit",
                "rule": "Every tool call must carry a verifiable source reference.",
                "severity": "blocking",
                "boundary": "act_on",
            },
            {
                "id": "policy_base_002",
                "trigger": "on_output_emit",
                "rule": "If output contains a trend claim, it must be labeled 'interpret_first'.",
                "severity": "warning",
                "boundary": "interpret_first",
            },
            {
                "id": "policy_base_003",
                "trigger": "on_session_end",
                "rule": "Record an outcome row for every session (success | partial | fail) with evidence refs.",
                "severity": "blocking",
                "boundary": "act_on",
            },
        ]
    )
    return policies


def _derive_actions(spec: Any, hints: dict[str, Any]) -> list[dict[str, Any]]:
    if "actions" in hints and isinstance(hints["actions"], list):
        return hints["actions"]
    actions: list[dict[str, Any]] = []
    for tool in (getattr(spec, "tools", None) or []):
        name = tool.get("name") if isinstance(tool, dict) else getattr(tool, "name", None)
        purpose = tool.get("purpose") if isinstance(tool, dict) else getattr(tool, "purpose", "")
        if not name:
            continue
        actions.append(
            {
                "name": name,
                "purpose": str(purpose)[:180],
                "write_path": True,  # assume tool can write unless proven otherwise
                "requires_approval": False,
                "boundary": "act_on",
            }
        )
    return actions


# ---------------------------------------------------------------------------
# File-body emitters
# ---------------------------------------------------------------------------


def _yaml_str(s: str) -> str:
    """Minimal YAML string escape for our simple schemas."""
    if any(c in s for c in ":#\n\"'|>"):
        return json.dumps(s)
    return s


def _entities_yaml(entities: list[dict[str, Any]]) -> str:
    lines = ["# Canonical entities for this workflow's world model.", ""]
    for e in entities:
        lines.append(f"- name: {_yaml_str(e['name'])}")
        lines.append(f"  purpose: {_yaml_str(str(e.get('purpose', '')))}")
        lines.append("  fields:")
        for f in e.get("fields", []):
            lines.append(f"    - name: {_yaml_str(f['name'])}")
            lines.append(f"      type: {_yaml_str(f['type'])}")
            lines.append(f"      boundary: {_yaml_str(f.get('boundary', 'act_on'))}")
        lines.append("")
    return "\n".join(lines) + "\n"


def _schemas_ts(entities: list[dict[str, Any]]) -> str:
    type_map = {
        "string": "string",
        "integer": "number",
        "int": "number",
        "number": "number",
        "boolean": "boolean",
        "bool": "boolean",
        "datetime": "string  // ISO-8601",
        "object": "Record<string, unknown>",
        "any": "unknown",
        "array": "unknown[]",
    }
    out = ["// Strict TypeScript schemas derived from entities.yaml.", ""]
    for e in entities:
        out.append(f"export interface {_pascal(e['name'])} {{")
        for f in e.get("fields", []):
            t_raw = str(f["type"]).lower()
            if t_raw.startswith("enum["):
                literal = t_raw[5:-1]
                members = [m.strip() for m in literal.split(",") if m.strip()]
                ts_type = " | ".join(f'"{m}"' for m in members)
            else:
                ts_type = type_map.get(t_raw, "unknown")
            out.append(f"  {f['name']}: {ts_type};")
        out.append("}")
        out.append("")
    return "\n".join(out) + "\n"


def _states_schema_ts(states: list[dict[str, Any]]) -> str:
    out = ["// Current-state snapshots. One row per entity, live-updated.", ""]
    for s in states:
        out.append(f"export interface {_pascal(s['entity'])}State {{")
        out.append("  entity_id: string;")
        out.append(f'  retention: "{s.get("retention", "30d")}";')
        out.append("  last_updated: string; // ISO-8601")
        out.append("  // fields tracked:")
        for f in s.get("fields", []):
            out.append(f"  // - {f}")
        out.append("}")
        out.append("")
    return "\n".join(out) + "\n"


def _events_schema_ts(events: list[dict[str, Any]]) -> str:
    out = [
        "// Append-only event ledger. Every state change emits an event.",
        "",
    ]
    for e in events:
        out.append(f'// event_type: "{e["event_type"]}"')
        out.append(f"export interface {_pascal(e['event_type'])}Event {{")
        out.append(f'  event_id: string;')
        out.append(f'  entity: "{e["entity"]}";')
        out.append(f'  event_type: "{e["event_type"]}";')
        out.append(f"  at: string; // ISO-8601")
        out.append("  payload: {")
        for k, v in (e.get("payload") or {}).items():
            out.append(f"    {k}: {v};")
        out.append("  };")
        out.append("}")
        out.append("")
    return "\n".join(out) + "\n"


def _policies_yaml(policies: list[dict[str, Any]]) -> str:
    lines = [
        "# Policies enforced at every action emission.",
        "# severity: blocking | warning | informational",
        "# boundary: act_on | interpret_first",
        "",
    ]
    for p in policies:
        lines.append(f"- id: {_yaml_str(p['id'])}")
        lines.append(f"  trigger: {_yaml_str(p['trigger'])}")
        lines.append(f"  rule: {_yaml_str(p['rule'])}")
        lines.append(f"  severity: {_yaml_str(p.get('severity', 'warning'))}")
        lines.append(f"  boundary: {_yaml_str(p.get('boundary', 'act_on'))}")
        lines.append("")
    return "\n".join(lines) + "\n"


def _actions_ts(actions: list[dict[str, Any]]) -> str:
    out = [
        "// Bounded set of actions the agent may emit.",
        "// The policy engine validates every action before it reaches the outside world.",
        "",
        "export type ActionName =",
    ]
    if not actions:
        out.append("  never; // no actions declared in this workflow")
    else:
        for i, a in enumerate(actions):
            suffix = " |" if i < len(actions) - 1 else ";"
            out.append(f'  "{a["name"]}"{suffix}')
    out.append("")
    out.append("export interface Action {")
    out.append("  name: ActionName;")
    out.append("  args: Record<string, unknown>;")
    out.append("  requires_approval: boolean;")
    out.append('  boundary: "act_on" | "interpret_first";')
    out.append("}")
    out.append("")
    out.append("export const ACTION_REGISTRY: Record<string, { purpose: string; requires_approval: boolean }> = {")
    for a in actions:
        out.append(
            f'  "{a["name"]}": {{ purpose: {json.dumps(a.get("purpose", ""))}, requires_approval: {"true" if a.get("requires_approval") else "false"} }},'
        )
    out.append("};")
    return "\n".join(out) + "\n"


def _outcomes_table_ts(entities: list[dict[str, Any]]) -> str:
    return (
        "// Outcome feedback loop. Every session closes with an outcome row\n"
        "// so the world model can learn what happened after each action.\n"
        "\n"
        "export interface OutcomeRow {\n"
        "  session_id: string;\n"
        '  outcome: "success" | "partial" | "fail";\n'
        "  evidence_refs: string[]; // ids into evidence_refs.json\n"
        "  cost_usd: number;\n"
        "  duration_ms: number;\n"
        "  notes: string; // human / auto-generated post-mortem\n"
        "  at: string; // ISO-8601\n"
        "}\n"
    )


def _evidence_refs_json(spec: Any) -> str:
    return json.dumps(
        {
            "source_trace_id": getattr(spec, "source_trace_id", "unknown"),
            "refs": [],
            "_note": (
                "Populated at runtime. Every factual claim in the agent's "
                "output must reference an id here; entries carry "
                "{id, source_url_or_handle, retrieved_at, boundary}."
            ),
        },
        indent=2,
    )


def _interpretive_boundary_md(
    entities: list[dict[str, Any]],
    states: list[dict[str, Any]],
    policies: list[dict[str, Any]],
) -> str:
    act_on_fields = []
    interpret_fields = []
    for e in entities:
        for f in e.get("fields", []):
            fqn = f"{e['name']}.{f['name']}"
            if f.get("boundary") == "interpret_first":
                interpret_fields.append(fqn)
            else:
                act_on_fields.append(fqn)

    act_on_block = "\n".join(f"- `{f}`" for f in act_on_fields) or "_(none)_"
    interpret_block = "\n".join(f"- `{f}`" for f in interpret_fields) or "_(none)_"

    return (
        "# Interpretive boundary\n\n"
        "Every concept emitted from this world model carries one of two labels.\n\n"
        "## Act on this (factual / verified / low-risk)\n\n"
        "These fields are the output of deterministic tools or schema-validated\n"
        "inputs. Downstream consumers can use them directly as operational truth.\n\n"
        f"{act_on_block}\n\n"
        "## Interpret this first (judgment call / trend / correlation)\n\n"
        "These fields require human review before action. They surface signal\n"
        "but may be noise, coincidence, or causally ambiguous.\n\n"
        f"{interpret_block}\n\n"
        "## Why this file exists\n\n"
        "World models fail quietly when plausible interpretations masquerade\n"
        "as settled truth. The product-level rule: every generated surface\n"
        "shows its boundary label. No exceptions.\n"
    )


def _readme_lite(entities: list[dict[str, Any]]) -> str:
    return (
        f"# World model — lite ({len(entities)} entities)\n\n"
        "Generated by attrition.sh compile_down / world_model lite emitter.\n\n"
        "## What's here\n\n"
        "- `entities.yaml` — canonical types\n"
        "- `schemas.ts` — strict TypeScript types derived from entities.yaml\n\n"
        "## What's NOT here (use `--world-model-lane full`)\n\n"
        "- live state tracking\n"
        "- append-only event ledger\n"
        "- policy engine\n"
        "- actions + approvals\n"
        "- outcome feedback loop\n"
        "- evidence graph + interpretive boundary labels\n"
    )


def _readme_full(
    entities: list[dict[str, Any]],
    policies: list[dict[str, Any]],
    actions: list[dict[str, Any]],
) -> str:
    return (
        f"# World model — full\n\n"
        f"- {len(entities)} entities\n"
        f"- {len(policies)} policies\n"
        f"- {len(actions)} actions\n\n"
        "## Files\n\n"
        "| File | Purpose |\n"
        "|---|---|\n"
        "| `entities.yaml` | Canonical types |\n"
        "| `states.schema.ts` | Live state per entity |\n"
        "| `events.schema.ts` | Append-only event ledger |\n"
        "| `policies.yaml` | Rules enforced at every action |\n"
        "| `actions.ts` | Bounded action registry |\n"
        "| `outcomes.table.ts` | Feedback loop |\n"
        "| `evidence_refs.json` | Source citations per claim |\n"
        "| `interpretive_boundary.md` | Act-on vs interpret-first labels |\n\n"
        "## How to use\n\n"
        "1. Wire `actions.ts` into your agent's tool allowlist.\n"
        "2. Load `policies.yaml` into the policy engine before each action.\n"
        "3. Emit an event to `events.schema.ts` shape for every state change.\n"
        "4. Close each session with an `OutcomeRow`.\n"
        "5. Every claim in agent output carries a reference id into\n"
        "   `evidence_refs.json`.\n"
        "6. Every output surface labels its concepts per `interpretive_boundary.md`.\n"
    )


def _pascal(snake: str) -> str:
    return "".join(part.capitalize() for part in snake.replace("-", "_").split("_"))
