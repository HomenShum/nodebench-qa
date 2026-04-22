# langgraph_python — LangGraph (v1.0 StateGraph + checkpointer)

## When to pick this lane

- Graph-shaped agent: nodes = steps, edges = transitions, state
  flows between them.
- Need durable state across restarts (checkpointer pattern).
- Existing LangChain ecosystem fit.
- Model-agnostic — LangGraph wraps any LangChain chat model.

## References

- Docs: `docs.langchain.com/oss/python/langgraph`
- Prebuilt ReAct: `langgraph.prebuilt.create_react_agent`
- Checkpointer interface: `.put`, `.put_writes`, `.get_tuple`, `.list`

## Files the agent should write

```
graph.py          StateGraph definition OR create_react_agent wrapper
state.py          TypedDict state schema
runner.py         invoke graph with initial state
checkpointer.py   MemorySaver for dev, PostgresSaver for prod (stub)
requirements.txt  langgraph ; langchain ; langchain-google-genai
                  ; langchain-openai ; langchain-anthropic
README.md         describes state schema + checkpointer swap
run.sh / .env.example / workflow_spec.json
eval/             scenarios.py + rubric.py
```

## graph.py spine (prebuilt ReAct path)

```python
from __future__ import annotations
import os
from langgraph.prebuilt import create_react_agent
from langgraph.checkpoint.memory import MemorySaver
from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_core.tools import StructuredTool

def _lookup_sku(sku: str) -> str:
    mode = os.environ.get("CONNECTOR_MODE", "mock")
    if mode == "mock":
        return '{"price": 10, "sku": "' + sku + '"}'
    raise NotImplementedError("wire live endpoint")

tools = [StructuredTool.from_function(_lookup_sku, name="lookup_sku")]
llm = ChatGoogleGenerativeAI(model="gemini-3-pro", temperature=0.2)
checkpointer = MemorySaver()  # swap for PostgresSaver in prod
agent = create_react_agent(llm, tools=tools, checkpointer=checkpointer)
```

## graph.py spine (custom StateGraph path)

```python
from langgraph.graph import StateGraph, START, END
from typing import TypedDict

class State(TypedDict):
    input: str
    tool_output: str | None
    final: str | None

def plan(state: State) -> State: ...
def dispatch(state: State) -> State: ...
def compact(state: State) -> State: ...

graph = StateGraph(State)
graph.add_node("plan", plan)
graph.add_node("dispatch", dispatch)
graph.add_node("compact", compact)
graph.add_edge(START, "plan")
graph.add_edge("plan", "dispatch")
graph.add_edge("dispatch", "compact")
graph.add_edge("compact", END)
app = graph.compile(checkpointer=MemorySaver())
```

## Key invariants

- State MUST be a TypedDict (or dict); LangGraph merges dict updates.
- Checkpointer MUST implement all four methods (put, put_writes,
  get_tuple, list). MemorySaver in dev, PostgresSaver in prod.
- For multi-agent supervisor patterns, emit one subgraph per agent
  and a parent graph that routes via conditional edges.

## Known failure modes

- Recursion limit hit (default 25). Emit `config={"recursion_limit": 50}`
  when the graph has >8 expected steps.
- Chat model mismatch: `create_react_agent` wants a LangChain chat
  model, not a plain provider SDK object.

## Eval criteria

- Graph compiles without error.
- `agent.invoke({"messages": [...]})` returns a dict with `messages`.
- Checkpointer round-trip: same thread_id resumes state correctly.
