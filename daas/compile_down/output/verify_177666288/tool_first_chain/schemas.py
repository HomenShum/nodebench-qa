"""Input/output schemas for the tool-first chain."""

from dataclasses import dataclass
from typing import Any


@dataclass
class ChainInput:
    query: str
    context: dict[str, Any] = None  # type: ignore[assignment]


@dataclass
class ChainOutput:
    answer: str
    tool_calls: list[dict[str, Any]]
    input_tokens: int
    output_tokens: int
    cost_usd: float
    turns: int
