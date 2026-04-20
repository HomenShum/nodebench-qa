"""Tool declarations (Gemini function-calling shape) + local handlers.

Replace each `_stub_*` function with a real implementation before
replaying against production data.
"""

from __future__ import annotations

from typing import Any, Callable

GEMINI_TOOLS = [
    {
        "functionDeclarations": []
    }
]

# No tools emitted — add handlers here when the spec has tools.


HANDLERS: dict[str, Callable[[dict[str, Any]], dict[str, Any]]] = {
    
}


def dispatch(name: str, args: dict[str, Any]) -> dict[str, Any]:
    fn = HANDLERS.get(name)
    if fn is None:
        return {"error": f"no handler for tool '{name}'"}
    return fn(args)
