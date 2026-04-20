"""Compile-down pipeline — turns a frontier-model trace into runnable
cheaper code.

End-to-end shape:

    CanonicalTrace                     # captured from Claude Code / Cursor /
            |                            any SDK agent run
            v
    Distiller                          # (reuses daas.distill) extracts
            |                            WorkflowSpec from the trace
            v
    WorkflowSpec                       # canonical internal representation
            |                            (see daas/schemas.py)
            v
    Emitter[target_runtime]            # turns spec into runnable code files
            |
            v
    ArtifactBundle                     # {files: [{path, content, language}]}
            |
            v
    Replay on cheap model              # run the generated code against tasks
            |
            v
    Fidelity verdict                   # 3-measurement template compares
                                         original vs replay (see daas.fidelity)

Today: tool_first_chain + simple_chain emitters. Tomorrow: orchestrator_worker.

The Emitter is adapter-agnostic — same WorkflowSpec can emit to OpenAI,
Gemini, or a model-agnostic chain that reads its provider from an env var.
"""

from daas.compile_down.artifact import ArtifactBundle, ArtifactFile
from daas.compile_down.emitters import emit, KNOWN_EMITTERS

__all__ = ["ArtifactBundle", "ArtifactFile", "emit", "KNOWN_EMITTERS"]
