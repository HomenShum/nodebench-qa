# simple_chain — single LLM call with an output schema

## When to pick this lane

- The task is one-shot: user query → one answer, no tool use.
- No multi-step reasoning, no external APIs.
- Output shape is known: a text blob, a JSON object matching a schema,
  or a markdown document.
- Ideal for: quick classification, short summarization, deterministic
  transformation, "answer this question" with known context.

## Avoid this lane when

- The task needs ANY tool call (use `tool_first_chain`).
- The task has sub-problems (use `orchestrator_worker`).
- The prompt is long-running or needs iteration (use any scaffolded lane).

## Files the agent should write

```
prompts.py          SYSTEM_PROMPT distilled from user's intent
schemas.py          ChainInput (query) + ChainOutput (answer + tokens + cost)
runner.py           single generateContent / chat call; return ChainOutput
requirements.txt    minimal deps for the provider the user picked
README.md           one-paragraph description + run instructions
run.sh              one-command launcher
.env.example        provider API key
workflow_spec.json  the serialized spec
```

## runner.py outline (Gemini default; any provider works)

```python
from __future__ import annotations
import os, json, urllib.request
from prompts import SYSTEM_PROMPT
from schemas import ChainInput, ChainOutput

MODEL = "gemini-3.1-flash-lite-preview"  # user can override via env

def run(inp: ChainInput) -> ChainOutput:
    key = os.environ["GEMINI_API_KEY"]
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent?key={key}"
    body = {
        "systemInstruction": {"parts": [{"text": SYSTEM_PROMPT}]},
        "contents": [{"role": "user", "parts": [{"text": inp.query}]}],
        "generationConfig": {"temperature": 0.2, "maxOutputTokens": 1024},
    }
    req = urllib.request.Request(url, data=json.dumps(body).encode(),
                                 headers={"Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=30) as r:
        resp = json.loads(r.read())
    # ... parse text + usage; return ChainOutput
```

## Known failure modes

- Model responds with prose when the user expected JSON. Mitigation:
  `responseMimeType="application/json"` in `generationConfig`.
- Rate limiting on bursty use. Mitigation: add a single retry with
  exponential backoff.

## Eval criteria

Smoke: runner imports + `run(ChainInput("hello"))` returns a
ChainOutput with non-empty `answer`. Mock-mode acceptance: if the
provider env var is missing, return a stub response with a clear
"no key" marker so the rest of the pipeline still runs.
