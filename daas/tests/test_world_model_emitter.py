"""Tests for the world-model substrate emitters."""

from __future__ import annotations

import pytest

from daas.compile_down.world_model import emit_world_model, WORLD_MODEL_LANES
from daas.schemas import WorkflowSpec


def _spec(tools: list | None = None, rules: list | None = None) -> WorkflowSpec:
    return WorkflowSpec(
        source_trace_id="wm_test",
        executor_model="gemini-3.1-flash-lite-preview",
        orchestrator_system_prompt="you are helpful",
        tools=tools or [],
        domain_rules=rules or [],
    )


def test_world_model_rejects_unknown_lane() -> None:
    with pytest.raises(ValueError, match="Unknown world_model lane"):
        emit_world_model("medium", _spec())


def test_lite_emits_expected_files() -> None:
    bundle = emit_world_model("lite", _spec())
    paths = {f.path for f in bundle.files}
    assert paths == {"entities.yaml", "schemas.ts", "README.md"}
    assert bundle.runtime_lane == "world_model_lite"


def test_lite_entities_always_include_session_and_query() -> None:
    bundle = emit_world_model("lite", _spec())
    entities_yaml = next(f for f in bundle.files if f.path == "entities.yaml").content
    assert "agent_session" in entities_yaml
    assert "user_query" in entities_yaml


def test_lite_entities_derived_from_tools() -> None:
    spec = _spec(tools=[{"name": "lookup_sku", "purpose": "fetch SKU"}])
    bundle = emit_world_model("lite", spec)
    yaml = next(f for f in bundle.files if f.path == "entities.yaml").content
    assert "lookup_sku_result" in yaml


def test_full_emits_all_eight_files() -> None:
    bundle = emit_world_model("full", _spec())
    paths = {f.path for f in bundle.files}
    expected = {
        "entities.yaml",
        "states.schema.ts",
        "events.schema.ts",
        "policies.yaml",
        "actions.ts",
        "outcomes.table.ts",
        "evidence_refs.json",
        "interpretive_boundary.md",
        "README.md",
    }
    assert paths == expected
    assert bundle.runtime_lane == "world_model_full"


def test_full_policies_include_base_plus_domain_rules() -> None:
    spec = _spec(rules=["never refund over $500"])
    bundle = emit_world_model("full", spec)
    pol = next(f for f in bundle.files if f.path == "policies.yaml").content
    assert "never refund over $500" in pol
    # Base policies about interpretive boundary + evidence
    assert "verifiable source reference" in pol
    assert "interpret_first" in pol


def test_full_actions_registered_when_tools_present() -> None:
    spec = _spec(tools=[{"name": "refund", "purpose": "Stripe refund"}])
    bundle = emit_world_model("full", spec)
    actions_ts = next(f for f in bundle.files if f.path == "actions.ts").content
    assert '"refund"' in actions_ts
    assert "ACTION_REGISTRY" in actions_ts


def test_full_actions_never_when_no_tools() -> None:
    bundle = emit_world_model("full", _spec(tools=[]))
    actions_ts = next(f for f in bundle.files if f.path == "actions.ts").content
    assert "never;" in actions_ts


def test_full_interpretive_boundary_labels_each_field() -> None:
    bundle = emit_world_model("full", _spec())
    ib = next(f for f in bundle.files if f.path == "interpretive_boundary.md").content
    assert "Act on this" in ib
    assert "Interpret this first" in ib
    # user_query.intent is flagged interpret_first by the derivation logic
    assert "user_query.intent" in ib


def test_full_evidence_refs_json_is_valid_json() -> None:
    import json as J

    bundle = emit_world_model("full", _spec())
    ev = next(f for f in bundle.files if f.path == "evidence_refs.json").content
    obj = J.loads(ev)
    assert "source_trace_id" in obj
    assert "refs" in obj


def test_hints_override_auto_derivation() -> None:
    # User supplies custom entities; auto-derivation is skipped
    custom_entities = [
        {
            "name": "custom_thing",
            "purpose": "user-provided",
            "fields": [{"name": "x", "type": "string", "boundary": "act_on"}],
        }
    ]
    bundle = emit_world_model("lite", _spec(), hints={"entities": custom_entities})
    yaml = next(f for f in bundle.files if f.path == "entities.yaml").content
    assert "custom_thing" in yaml
    # Default entities NOT present
    assert "agent_session" not in yaml


def test_world_model_lanes_constant() -> None:
    assert WORLD_MODEL_LANES == ("lite", "full")


def test_lite_schemas_ts_types_are_typescript() -> None:
    bundle = emit_world_model("lite", _spec(tools=[{"name": "fetch", "purpose": "..."}]))
    ts = next(f for f in bundle.files if f.path == "schemas.ts").content
    assert "export interface" in ts
    # enum type should render as union of string literals
    assert '"running"' in ts or "enum" in ts.lower()


def test_full_states_reference_entity_fields() -> None:
    bundle = emit_world_model("full", _spec())
    states = next(f for f in bundle.files if f.path == "states.schema.ts").content
    assert "AgentSessionState" in states
    assert "retention" in states
