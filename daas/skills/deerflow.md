# deerflow — multi-agent research fanout

## When to pick this lane

- Task is deep research / diligence: collect, synthesize, cite.
- Multiple specialized workers (search, reader, critic) operate on
  a shared research plan.
- Emit a DeerFlow-style graph where the planner decomposes the
  question into parallel sub-questions, workers fan out, and a
  writer consolidates.

## References

DeerFlow is a research pattern, not a pinned package. Emit a
dependency on `langgraph` (for the graph shell) + whichever chat
model(s) the user picked.

## Files the agent should write

```
agents/
  planner.py       decomposes question into sub-questions
  searcher.py      web_search + fetch_url tool user
  reader.py        extract claims + sources from fetched pages
  critic.py        flag unsupported or contradictory claims
  writer.py        consolidate into cited markdown report
graph.py           StateGraph wiring all five nodes; parallel fanout
                   from planner → searcher × N → reader × N → critic → writer
state.py           ResearchState TypedDict (question, sub_questions,
                   claims, sources, critique, final_report)
tools.py           web_search, fetch_url, extract_claims,
                   connector dispatch with mock/live modes
requirements.txt / README.md / run.sh / .env.example / workflow_spec.json
eval/              scenarios.py (deep-research smoke tests) + rubric.py
```

## state.py shape

```python
from typing import TypedDict, Annotated
from operator import add

class ResearchState(TypedDict):
    question: str
    sub_questions: list[str]
    claims: Annotated[list[dict], add]   # [{claim, source_url, confidence}]
    sources: Annotated[list[dict], add]  # reducer accumulates
    critique: list[str]
    final_report: str
```

## Known failure modes

- Parallel fanout over-fetches → rate-limit or cost blowup. Cap
  `MAX_SEARCH_CALLS_PER_QUESTION` in `searcher.py`.
- Claims without sources slip through. `critic.py` MUST flag any
  claim lacking a `source_url` and either demote its confidence or
  strip it before `writer.py` sees it.
- Writer hallucinates novel claims. Emit a rule in `writer.py` system
  prompt: "every sentence in final_report must map to at least one
  entry in `state['claims']` — if you can't cite, drop it."

## Eval criteria

- Graph compiles.
- End-to-end mock run on a canned question produces a `final_report`
  where every claim maps to a source_url.
- `critic.py` catches at least one unsupported claim in a seeded
  adversarial test.
