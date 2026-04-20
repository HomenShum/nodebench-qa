"""Tests for compile-down emitters — offline, deterministic.

Each test builds a mock WorkflowSpec, runs an emitter, and asserts the
emitted code compiles (via ast.parse) and contains the expected files.
"""

from __future__ import annotations

import ast

import pytest

from daas.compile_down import emit, ArtifactBundle
from daas.compile_down.cli import trace_to_workflow_spec
from daas.schemas import WorkflowSpec


def _spec(
    *,
    system_prompt: str = "be helpful",
    tools: list | None = None,
    rules: list | None = None,
) -> WorkflowSpec:
    return WorkflowSpec(
        source_trace_id="test_trace",
        executor_model="gemini-3.1-flash-lite-preview",
        orchestrator_system_prompt=system_prompt,
        tools=tools or [],
        domain_rules=rules or [],
        success_criteria=["concise", "grounded"],
    )


# ---------------------------------------------------------------------------
# simple_chain emitter
# ---------------------------------------------------------------------------


def test_simple_chain_emits_expected_files() -> None:
    bundle = emit("simple_chain", _spec())
    paths = {f.path for f in bundle.files}
    assert paths == {"prompts.py", "schemas.py", "runner.py", "requirements.txt", "README.md"}


def test_simple_chain_python_files_are_syntactically_valid() -> None:
    bundle = emit("simple_chain", _spec(system_prompt='hello "world"'))
    for f in bundle.files:
        if f.path.endswith(".py"):
            ast.parse(f.content)  # raises SyntaxError if broken


def test_simple_chain_preserves_system_prompt() -> None:
    bundle = emit("simple_chain", _spec(system_prompt="EXACT_MARKER_TEXT"))
    prompts = next(f for f in bundle.files if f.path == "prompts.py")
    assert "EXACT_MARKER_TEXT" in prompts.content


def test_simple_chain_escapes_triple_quotes_in_prompt() -> None:
    # Critical: unescaped triple-quotes in a docstring break syntax
    hostile = 'nested """ in prompt'
    bundle = emit("simple_chain", _spec(system_prompt=hostile))
    prompts = next(f for f in bundle.files if f.path == "prompts.py")
    ast.parse(prompts.content)


# ---------------------------------------------------------------------------
# tool_first_chain emitter
# ---------------------------------------------------------------------------


def test_tool_first_chain_emits_tools_py() -> None:
    tools = [
        {"name": "lookup_inventory", "purpose": "get SKU", "input_schema": {"type": "object"}}
    ]
    bundle = emit("tool_first_chain", _spec(tools=tools))
    paths = {f.path for f in bundle.files}
    assert "tools.py" in paths
    tools_py = next(f for f in bundle.files if f.path == "tools.py").content
    assert "lookup_inventory" in tools_py
    assert "_stub_lookup_inventory" in tools_py
    assert "HANDLERS" in tools_py
    ast.parse(tools_py)


def test_tool_first_chain_handles_empty_tools() -> None:
    bundle = emit("tool_first_chain", _spec(tools=[]))
    tools_py = next(f for f in bundle.files if f.path == "tools.py").content
    ast.parse(tools_py)  # still valid even with no handlers


def test_tool_first_chain_bounded_tool_loop_in_runner() -> None:
    bundle = emit("tool_first_chain", _spec())
    runner = next(f for f in bundle.files if f.path == "runner.py").content
    # Must have MAX_TURNS cap to prevent infinite tool loops
    assert "MAX_TURNS" in runner
    ast.parse(runner)


def test_tool_first_chain_includes_system_instruction() -> None:
    bundle = emit("tool_first_chain", _spec(system_prompt="specific_system_marker"))
    prompts = next(f for f in bundle.files if f.path == "prompts.py").content
    assert "specific_system_marker" in prompts


# ---------------------------------------------------------------------------
# Dispatch
# ---------------------------------------------------------------------------


def test_emit_rejects_unknown_runtime_lane() -> None:
    with pytest.raises(ValueError, match="No emitter"):
        emit("imaginary_lane", _spec())


def test_emit_bundle_total_bytes_reflects_encoded_content() -> None:
    bundle = emit("simple_chain", _spec())
    expected = sum(len(f.content.encode("utf-8")) for f in bundle.files)
    assert bundle.total_bytes == expected


def test_bundle_roundtrips_through_json() -> None:
    bundle = emit("simple_chain", _spec(system_prompt="roundtrip"))
    restored = ArtifactBundle.from_json(bundle.to_json())
    assert restored.runtime_lane == bundle.runtime_lane
    assert restored.target_model == bundle.target_model
    assert {f.path for f in restored.files} == {f.path for f in bundle.files}


# ---------------------------------------------------------------------------
# trace_to_workflow_spec
# ---------------------------------------------------------------------------


def test_trace_to_workflow_spec_extracts_tools_from_steps() -> None:
    trace = {
        "sessionId": "s1",
        "query": "what's in the cooler?",
        "steps": [
            {
                "role": "executor",
                "tool_calls": [
                    {"name": "read_sensor", "args": {"sensor_id": "cooler_1"}},
                    {"name": "read_sensor", "args": {"sensor_id": "cooler_2"}},
                ],
            }
        ],
    }
    spec = trace_to_workflow_spec(trace, "gemini-3.1-flash-lite-preview")
    tool_names = [t["name"] for t in spec.tools]
    assert tool_names == ["read_sensor"]  # dedupe


def test_trace_to_workflow_spec_handles_flat_toolcalls() -> None:
    trace = {
        "sessionId": "s1",
        "prompt": "ping",
        "toolCalls": [{"name": "ping_api"}, {"tool": "check_status"}],
    }
    spec = trace_to_workflow_spec(trace, "gemini-3.1-flash-lite-preview")
    assert {t["name"] for t in spec.tools} == {"ping_api", "check_status"}


def test_trace_to_workflow_spec_no_tools_still_emits_valid_spec() -> None:
    trace = {"sessionId": "s1", "query": "hi"}
    spec = trace_to_workflow_spec(trace, "gemini-3.1-flash-lite-preview")
    assert spec.source_trace_id == "s1"
    assert spec.executor_model == "gemini-3.1-flash-lite-preview"
    assert spec.tools == []


# ---------------------------------------------------------------------------
# Full pipeline: trace -> spec -> emit -> syntactically valid code
# ---------------------------------------------------------------------------


def test_full_pipeline_produces_valid_python() -> None:
    trace = {
        "sessionId": "full_pipeline_test",
        "query": "summarize today's sales",
        "steps": [
            {
                "role": "executor",
                "tool_calls": [
                    {"name": "fetch_sales", "args": {"date": "today"}},
                    {"name": "aggregate", "args": {"by": "store"}},
                ],
            }
        ],
    }
    spec = trace_to_workflow_spec(trace, "gemini-3.1-flash-lite-preview")
    bundle = emit("tool_first_chain", spec)
    for f in bundle.files:
        if f.path.endswith(".py"):
            ast.parse(f.content)
    # The emitted runner + tools + prompts should reference both tools
    tools_content = next(f for f in bundle.files if f.path == "tools.py").content
    assert "fetch_sales" in tools_content
    assert "aggregate" in tools_content
