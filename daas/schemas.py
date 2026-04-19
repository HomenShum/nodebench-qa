"""Type definitions for the Distillation-as-a-Service pipeline."""

from dataclasses import dataclass, field, asdict
from typing import Optional


# ── CanonicalTrace: source-agnostic representation of an observed agent run ──

@dataclass
class ToolInvocation:
    name: str
    args: dict
    result_summary: str  # abbreviated
    duration_ms: int = 0


@dataclass
class TraceStep:
    role: str  # "planner" | "executor" | "tool" | "user" | "assistant"
    model: Optional[str] = None
    content: str = ""
    tool_calls: list = field(default_factory=list)  # list[ToolInvocation]
    input_tokens: int = 0
    output_tokens: int = 0
    duration_ms: int = 0


@dataclass
class CanonicalTrace:
    session_id: str
    source_model: str
    advisor_model: Optional[str] = None
    query: str = ""
    final_answer: str = ""
    steps: list = field(default_factory=list)  # list[TraceStep]
    total_cost_usd: float = 0.0
    total_tokens: int = 0
    duration_ms: int = 0
    repo_context: Optional[dict] = None  # {url, claudeMd, agentsMd}

    def to_dict(self):
        return asdict(self)


# ── WorkflowSpec: architecture distilled from a CanonicalTrace ──

@dataclass
class ToolDef:
    name: str
    purpose: str  # what it's for
    input_schema: dict  # rough shape
    output_schema: dict


@dataclass
class Worker:
    name: str
    role: str  # "classifier" | "retriever" | "reasoner" | "formatter" | etc.
    model: str  # target cheap model
    system_prompt: str
    tools: list = field(default_factory=list)  # tool names this worker may call


@dataclass
class HandoffRule:
    from_agent: str
    to_agent: str
    trigger: str  # when to handoff
    payload_schema: dict


@dataclass
class WorkflowSpec:
    source_trace_id: str
    executor_model: str  # target cheap model for orchestrator
    advisor_model: Optional[str] = None  # optional expensive consultation
    orchestrator_system_prompt: str = ""
    orchestrator_plan_prompt: str = ""
    workers: list = field(default_factory=list)  # list[Worker]
    tools: list = field(default_factory=list)  # list[ToolDef]
    handoffs: list = field(default_factory=list)  # list[HandoffRule]
    success_criteria: list = field(default_factory=list)  # list[str]
    domain_rules: list = field(default_factory=list)  # list[str]
    target_sdk: str = "google-genai"  # "google-genai" | "openai" | "anthropic" | "langchain"

    def to_dict(self):
        return asdict(self)


# ── ReplayResult: what we get from running the scaffold ──

@dataclass
class ReplayResult:
    workflow_spec_id: str
    query: str
    final_answer: str
    steps_executed: int
    tool_calls: list
    input_tokens: int
    output_tokens: int
    total_tokens: int
    total_cost_usd: float
    duration_ms: int
    error: Optional[str] = None


# ── Judgment: how well the replay matched the original ──

@dataclass
class Judgment:
    original_trace_id: str
    replay_id: str
    output_similarity: float  # 0-1, based on key entity/reference overlap
    cost_delta_pct: float  # negative = cheaper
    tool_parity: float  # 0-1, overlap of tool calls with original
    quality_score: float  # 0-10
    verdict: str  # "pass" | "partial" | "fail"
    details: str = ""

    def to_dict(self):
        return asdict(self)
