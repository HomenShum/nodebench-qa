# Connector Resolver Spec

Behavior contract for the three connector modes (`mock` / `live` /
`hybrid`) that Builder's Scaffold tab toggles between. The persisted
selection lives in `localStorage` under `attrition:connector_mode`
(see `frontend/src/pages/Builder.tsx::useConnectorMode`).

## Modes

| Mode | Fill | What emitted tools actually do | When to use |
|---|---|---|---|
| `mock` | green | Every tool stub returns `{"status": "not_implemented"}` | Safe default. First view of any generated scaffold. |
| `live` | red | Tool stubs must be replaced with real handlers + fidelity verified | Only after fidelity has transferred against a benchmark |
| `hybrid` | amber | Some tools mocked (safe), others live (real APIs). Split controlled per-tool via env flag | Source-of-truth surface not fully wired — live for the core path, mock for the long tail |

## Why mode exists

From the FloorAI falsification run (`docs/BFCL_FALSIFICATION_FINDINGS.md`):
when a cheap replay runtime calls tools that aren't grounded in real
source-of-truth data, it hallucinates IDs. The `connector_mode`
selector makes this risk explicit in the UI — users default to mock,
upgrade deliberately.

## Current implementation state (shipped today)

- **UI selector**: functional. Toggles state + persists across reloads.
  Three colored buttons reflect the semantic meaning (green = safe,
  red = risky, amber = partial).
- **Per-tool handler contract**: every emitter (simple_chain,
  tool_first_chain, orchestrator_worker) generates `_stub_<tool>`
  functions. The user replaces these by hand.
- **Runtime dispatch**: the generated `runner.py` reads only from
  stubs today. A future cycle will add a `CONNECTOR_MODE` env var
  that routes each tool call through one of:
  - `mock`: stub (always)
  - `live`: real handler (fails loudly if missing)
  - `hybrid`: per-tool lookup in a `CONNECTOR_OVERRIDES` dict

## Planned resolver (not shipped)

```
# In generated tools.py
import os
CONNECTOR_MODE = os.environ.get("CONNECTOR_MODE", "mock")
CONNECTOR_OVERRIDES = {
    # e.g. "lookup_sku": "live"  (explicit per-tool override for hybrid)
}

def dispatch(name, args):
    mode = CONNECTOR_OVERRIDES.get(name, CONNECTOR_MODE)
    if mode == "live":
        return _live_handlers[name](args)
    return _stub_handlers[name](args)
```

This adds a `_live_handlers` dict users populate. A future CLI flag
`--connector-resolver` scaffolds the dict based on declared tools.

Today this is a **manual integration step** — each user replaces
`_stub_<name>` with their own implementation. Not yet automatic.

## What mode NEVER does

- Mode is UI + documentation only today. There is no server-side
  enforcement that a "live" selection requires a fidelity-verified
  scaffold — that responsibility is still on the operator.
- Mode does NOT affect the rate-limit bucket or cost cap. Those are
  per-session, independent of mode.
- Mode does NOT alter what the classifier picks. It's about runtime
  execution of the emitted scaffold, not the planning stage.

## Failure modes

- **Switch to `live` without replacing stubs**: the generated runner
  calls `_stub_<name>` which returns `"not_implemented"`. Output will
  be hollow — fidelity verdict will land on `regression` or `lossy`.
  The classifier test for this runtime should fail before reaching
  users.
- **Hybrid without `CONNECTOR_OVERRIDES`**: equivalent to `mock`
  (resolver falls back to the mode-level default).
- **Mode flipped during a live session**: localStorage change triggers
  a re-render but in-flight agent runs use the mode they started
  with. This is intentional to avoid mid-run schizophrenia.

## Related docs

- `docs/BUILDER_GENERATION_SPEC.md` — how emitters produce the stubs
- `docs/ATTRITION_PRODUCT_VISION_PITCH.md` — why this is part of the
  honesty contract, not a polish item
- `docs/BFCL_FALSIFICATION_FINDINGS.md` — the empirical finding that
  ungrounded replays produce hallucinated IDs
