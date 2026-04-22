"""attrition-agent orchestrator.

Reads a skill manifest + picks a runtime + drives the generation loop.

Usage:
    from daas.agent.agent_loop import generate_scaffold

    bundle = generate_scaffold(
        lane="orchestrator_worker",
        spec=workflow_spec,
        runtime="gemini_agent",      # or openai_agents_sdk, claude_agent_sdk, ...
        model="gemini-3-pro",
    )
    # bundle has the same shape as deterministic emit(): list of
    # ArtifactFile, runtime_lane, target_model.

Fallback chain:
    If the agent's output is missing README / requirements / run.sh /
    .env.example, `_bundle_finalize.py` (unchanged) adds them so the
    minimum-viable bundle always ships.
"""

from __future__ import annotations

import json
from dataclasses import asdict, is_dataclass
from pathlib import Path
from typing import Any

from daas.agent.base import (
    AgentRunResult,
    AgentRuntime,
    get_runtime,
)
from daas.agent.tools import BUILD_TOOL_SET, Workspace
from daas.compile_down.artifact import ArtifactBundle, ArtifactFile
from daas.compile_down.emitters._bundle_finalize import finalize_bundle

# Import runtimes to trigger their self-registration.
import daas.agent.runtimes  # noqa: F401


# Every lane maps to a skill file under daas/skills/. Adding a new
# lane = adding a skill file + one line here.
LANE_REGISTRY: dict[str, str] = {
    "simple_chain": "simple_chain.md",
    "tool_first_chain": "tool_first_chain.md",
    "orchestrator_worker": "orchestrator_worker.md",
    "openai_agents_sdk": "openai_agents_sdk.md",
    "langgraph_python": "langgraph_python.md",
    "claude_agent_sdk": "claude_agent_sdk.md",
    "manus": "manus.md",
    "deerflow": "deerflow.md",
    "hermes": "hermes.md",
    "convex_functions": "convex_functions.md",
    "vercel_ai_sdk": "vercel_ai_sdk.md",
}

SKILLS_ROOT = Path(__file__).resolve().parent.parent / "skills"


def _load_skill(lane: str) -> str:
    """Load a skill's markdown + the cross-cutting _style.md."""
    filename = LANE_REGISTRY.get(lane)
    if not filename:
        raise KeyError(
            f"unknown lane {lane!r}. Known: {sorted(LANE_REGISTRY)}"
        )
    skill_path = SKILLS_ROOT / filename
    style_path = SKILLS_ROOT / "_style.md"
    if not skill_path.exists():
        raise FileNotFoundError(f"skill file missing: {skill_path}")
    skill_text = skill_path.read_text(encoding="utf-8")
    style_text = style_path.read_text(encoding="utf-8") if style_path.exists() else ""
    return f"{style_text}\n\n{'=' * 60}\n\n{skill_text}"


def _spec_to_user_prompt(spec: Any, lane: str) -> str:
    """Serialize a WorkflowSpec into the user-turn payload for the agent."""
    if is_dataclass(spec):
        spec_dict = asdict(spec)
    elif isinstance(spec, dict):
        spec_dict = spec
    else:
        spec_dict = {
            "source_trace_id": getattr(spec, "source_trace_id", ""),
            "executor_model": getattr(spec, "executor_model", ""),
            "orchestrator_system_prompt": getattr(spec, "orchestrator_system_prompt", ""),
            "tools": getattr(spec, "tools", []),
        }
    tools_block = json.dumps(spec_dict.get("tools", []), indent=2)
    return f"""Build a scaffold for the **{lane}** lane against this WorkflowSpec:

```
source_trace_id:             {spec_dict.get('source_trace_id', '')}
executor_model:              {spec_dict.get('executor_model', '')}
orchestrator_system_prompt:  {spec_dict.get('orchestrator_system_prompt', '')}
```

Tools declared:

```json
{tools_block}
```

Instructions:
1. Write every scaffold file into the workspace using the `write_file` tool.
2. Validate every Python file with `ast_parse_check` before moving on.
3. Follow the cross-cutting rules in _style.md and the lane-specific
   shape described in this skill file.
4. When done, call `emit_done` with a one-line summary.

You must not call `emit_done` until every required file has been
written and parses cleanly. If a file fails `ast_parse_check`, fix
it with `edit_file` before proceeding.
"""


def _bundle_from_workspace(ws: Workspace, lane: str, spec: Any) -> ArtifactBundle:
    """Collect every file the agent wrote into an ArtifactBundle."""
    files: list[ArtifactFile] = []
    for rel_path in ws.list():
        content = ws.read(rel_path)
        lang = _infer_language(rel_path)
        files.append(ArtifactFile(path=rel_path, content=content, language=lang))
    bundle = ArtifactBundle(
        files=files,
        runtime_lane=lane,
        target_model=getattr(spec, "executor_model", "") or "",
    )
    # finalize_bundle is idempotent — if the agent wrote README /
    # requirements / run.sh / .env.example, it skips them; otherwise
    # it adds them as the minimum-viable fallback.
    return finalize_bundle(bundle, runtime_lane=lane, spec=spec)


def _infer_language(path: str) -> str:
    if path.endswith(".py"):
        return "python"
    if path.endswith((".ts", ".tsx")):
        return "typescript"
    if path.endswith((".js", ".jsx")):
        return "javascript"
    if path.endswith(".md"):
        return "markdown"
    if path.endswith(".json"):
        return "json"
    if path.endswith(".sh"):
        return "shell"
    if path.endswith((".yml", ".yaml")):
        return "yaml"
    return "text"


def generate_scaffold(
    *,
    lane: str,
    spec: Any,
    runtime: str = "gemini_agent",
    model: str = "gemini-3-pro",
    max_turns: int = 20,
    api_key: str | None = None,
) -> tuple[ArtifactBundle, AgentRunResult]:
    """Drive the attrition-agent loop.

    Returns (bundle, run_result). The run_result carries cost, token
    totals, tool-call log, and runtime_label so downstream (Builder
    UI, EVAL_VERDICT) can surface per-run attribution.
    """
    system_prompt = _load_skill(lane)
    user_prompt = _spec_to_user_prompt(spec, lane)

    workspace = Workspace.new(prefix=f"attrition_{lane}_")
    tools = BUILD_TOOL_SET(workspace)

    runtime_impl: AgentRuntime = get_runtime(runtime)
    run_result = runtime_impl.run(
        system=system_prompt,
        user=user_prompt,
        tools=tools,
        max_turns=max_turns,
        model=model,
        temperature=0.2,
        api_key=api_key,
    )

    bundle = _bundle_from_workspace(workspace, lane, spec)
    return bundle, run_result


__all__ = [
    "LANE_REGISTRY",
    "generate_scaffold",
]
