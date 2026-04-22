"""Runtime-agnostic AgentRuntime protocol.

Every driver (Gemini, OpenAI Agents SDK, Claude Agent SDK, LangGraph,
OpenRouter) conforms to the same interface so the attrition-agent
loop is portable across models and frameworks.

Pricing constants are maintained at the top so EVAL_VERDICT can
calculate cost deltas across runtimes without hard-coding them per
adapter.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Callable, Protocol


# ---------------------------------------------------------------------
# Model-card pricing table (as of April 2026).
# Keys are "provider:model_alias" and values are (in_usd_per_tok, out_usd_per_tok).
# Adapters normalize their native model IDs into these aliases when
# returning an AgentRunResult.
# ---------------------------------------------------------------------
PRICING_PER_TOKEN: dict[str, tuple[float, float]] = {
    # Anthropic
    "anthropic:claude-opus-4.7": (5.00e-6, 25.00e-6),
    "anthropic:claude-sonnet-4.6": (3.00e-6, 15.00e-6),
    "anthropic:claude-haiku-4.5": (1.00e-6, 5.00e-6),
    # OpenAI
    "openai:gpt-5.4": (2.50e-6, 2.50e-6),     # midpoint — Pro is $30/$180
    "openai:gpt-5.4-nano": (0.20e-6, 1.25e-6),
    "openai:gpt-5.1": (1.25e-6, 10.00e-6),
    "openai:gpt-5": (0.63e-6, 5.00e-6),
    # Google
    "google:gemini-3-pro": (2.00e-6, 12.00e-6),      # <= 200 k ctx
    "google:gemini-3-pro-long": (4.00e-6, 18.00e-6), # > 200 k ctx
    "google:gemini-3.1-flash-lite": (0.25e-6, 1.50e-6),
    "google:gemini-3.1-flash-lite-preview": (0.10e-6, 0.40e-6),
    "google:gemini-3.1-pro-preview": (1.25e-6, 10.00e-6),
}


# ---------------------------------------------------------------------
# Tool abstraction — an adapter translates this into the native tool
# format for its SDK (FunctionDeclaration, @tool, @function_tool, etc).
# ---------------------------------------------------------------------
@dataclass(frozen=True)
class Tool:
    name: str
    description: str
    parameters_schema: dict[str, Any]       # JSON Schema
    handler: Callable[[dict], Any]          # sync; adapters can wrap async


@dataclass(frozen=True)
class ToolCall:
    name: str
    arguments: dict[str, Any]
    result: Any
    elapsed_ms: int


# ---------------------------------------------------------------------
# Unified run result so the attrition-agent loop can compare across
# any runtime. All cost math lives here.
# ---------------------------------------------------------------------
@dataclass
class AgentRunResult:
    text: str
    tool_calls: list[ToolCall]
    input_tokens: int
    output_tokens: int
    turns: int
    model: str                              # provider-normalized alias
    runtime_label: str                      # e.g. "gemini_agent", "openai_agents_sdk"
    elapsed_ms: int
    raw_usage: dict[str, Any] = field(default_factory=dict)

    def cost_usd(self) -> float:
        in_price, out_price = PRICING_PER_TOKEN.get(self.model, (0.0, 0.0))
        return self.input_tokens * in_price + self.output_tokens * out_price


# ---------------------------------------------------------------------
# The runtime protocol. Adapters conform structurally.
# ---------------------------------------------------------------------
class AgentRuntime(Protocol):
    """Run a single agent turn-loop. Blocking; returns when the agent
    emits a final text answer OR hits ``max_turns``.
    """

    name: str  # e.g. "gemini_agent" | "openai_agents_sdk" | "claude_agent_sdk"

    def run(
        self,
        *,
        system: str,
        user: str,
        tools: list[Tool],
        max_turns: int = 8,
        model: str,
        temperature: float = 0.2,
        api_key: str | None = None,
    ) -> AgentRunResult: ...


# ---------------------------------------------------------------------
# Registry — populated by adapter modules when imported.
# ---------------------------------------------------------------------
RUNTIMES: dict[str, Callable[[], AgentRuntime]] = {}


def register_runtime(name: str, factory: Callable[[], AgentRuntime]) -> None:
    RUNTIMES[name] = factory


def get_runtime(name: str) -> AgentRuntime:
    if name not in RUNTIMES:
        raise KeyError(
            f"no AgentRuntime registered for {name!r}. "
            f"Known: {sorted(RUNTIMES)}"
        )
    return RUNTIMES[name]()


__all__ = [
    "AgentRunResult",
    "AgentRuntime",
    "PRICING_PER_TOKEN",
    "RUNTIMES",
    "Tool",
    "ToolCall",
    "get_runtime",
    "register_runtime",
]
