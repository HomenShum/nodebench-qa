"""Runtime-lane-specific emitters.

Each emitter takes a WorkflowSpec and returns an ArtifactBundle of
runnable files. Emitters are pure functions — no side effects, no
network calls. Deterministic output for deterministic input.

Dispatch table:
    simple_chain         → daas.compile_down.emitters.simple_chain
    tool_first_chain     → daas.compile_down.emitters.tool_first_chain
    orchestrator_worker  → (not yet shipped — next cycle)
"""

from typing import Any

from daas.compile_down.artifact import ArtifactBundle
from daas.compile_down.emitters import simple_chain, tool_first_chain

KNOWN_EMITTERS = {
    "simple_chain": simple_chain.emit_bundle,
    "tool_first_chain": tool_first_chain.emit_bundle,
}


def emit(runtime_lane: str, spec: Any, *, target_model: str | None = None) -> ArtifactBundle:
    """Dispatch to the runtime-lane-specific emitter."""
    fn = KNOWN_EMITTERS.get(runtime_lane)
    if fn is None:
        raise ValueError(
            f"No emitter for runtime_lane={runtime_lane!r}. "
            f"Known: {sorted(KNOWN_EMITTERS)}"
        )
    return fn(spec, target_model=target_model)


__all__ = ["KNOWN_EMITTERS", "emit"]
