"""Meta-workflow distiller.

The ``trace_to_workflow_spec`` distiller captures structure (tools,
executor model, system prompt). That proves compile-down preserves
NAMES — necessary but not what we lead with.

This module distills the META-WORKFLOW: the *why and when* of the
agent's work, as phases. Each phase answers:

    "This section is doing <X>, targeting angles <Y>, because the
     user said <Z>."

We segment a CanonicalTrace into ``Phase`` records using deterministic
heuristics (no LLM call). Segmentation cues, in precedence order:

    1. A new ``role=user`` message re-opens a phase (user re-directed).
    2. Cue phrases at the start of an assistant turn:
         "now ", "next ", "let me ", "alright", "ok so",
         "moving on", "step N", "finally", "first, ", "second, "
    3. A shift in tool-class (see ``_tool_class``): search -> edit,
       read -> write, shell -> navigate, etc.

For each phase we emit:
    - name        : first 6-ish words of the opening assistant text
    - intent      : first full sentence of the opening assistant text
    - trigger     : the user message that preceded the phase (<= 240 ch)
    - angles      : phrases after cue words ("look for", "check",
                    "angle", "focus on", "regarding")
    - tool_classes: set of the tool categories invoked in this phase
    - tools_used  : unique tool names invoked in this phase
    - step_span   : [start_index, end_index) in the trace's steps list
    - step_count  : number of steps in the phase

This is the artifact the user actually wants to see when we say
"compile-down": a readable outline of what the agent was DOING, not
an inventory of its toolbox.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field, asdict
from typing import Any, Iterable


# --- tool classification --------------------------------------------------
# Heuristic buckets. Strings that appear in tool names map to coarse
# categories the operator actually cares about in a workflow overview.
_TOOL_CLASS_RULES: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("search", ("grep", "glob", "find", "search", "websearch", "web_search", "query")),
    ("read", ("read", "load", "fetch", "get", "view", "describe", "inspect", "show")),
    ("edit", ("edit", "update", "patch", "replace", "modify")),
    ("write", ("write", "create", "mkdir", "append", "save", "emit")),
    ("shell", ("bash", "shell", "exec", "run", "compile", "test", "install")),
    ("navigate", ("cd", "ls", "goto", "open", "navigate", "click", "browser")),
    ("agent", ("agent", "task", "delegate", "spawn", "teammate", "subagent")),
    ("think", ("plan", "scratchpad", "note", "thinking", "reflect")),
)


def _tool_class(name: str) -> str:
    low = (name or "").lower()
    for klass, needles in _TOOL_CLASS_RULES:
        for n in needles:
            if n in low:
                return klass
    return "other"


# --- phase cue matching ---------------------------------------------------
_PHASE_CUES = (
    "now ",
    "next ",
    "let me ",
    "alright",
    "ok so",
    "ok, so",
    "okay so",
    "moving on",
    "finally",
    "first, ",
    "second, ",
    "third, ",
    "step ",
    "phase ",
    "i'll now ",
    "i will now ",
    "i need to ",
    "i'll ",
    "let's ",
)

_ANGLE_CUES = re.compile(
    r"(?:"
    r"look(?:ing)?\s+for\s+(?P<a1>[^.?!\n]{3,120})"
    r"|check(?:ing)?\s+(?:for\s+)?(?P<a2>[^.?!\n]{3,120})"
    r"|angle[s]?[:\-]?\s+(?P<a3>[^.?!\n]{3,120})"
    r"|focus(?:ing)?\s+on\s+(?P<a4>[^.?!\n]{3,120})"
    r"|regarding\s+(?P<a5>[^.?!\n]{3,120})"
    r"|because\s+(?P<a6>[^.?!\n]{3,120})"
    r")",
    re.IGNORECASE,
)


def _first_sentence(text: str, max_len: int = 200) -> str:
    if not text:
        return ""
    # Split on common sentence terminators; keep it simple.
    for sep in (". ", "! ", "? ", "\n\n"):
        i = text.find(sep)
        if 10 < i <= max_len:
            return text[: i + 1].strip()
    return text[:max_len].strip()


def _short_name(text: str, words: int = 6) -> str:
    toks = re.findall(r"\S+", text or "")
    return " ".join(toks[:words]).strip().rstrip(",.:;")


def _extract_angles(text: str, max_angles: int = 4) -> list[str]:
    if not text:
        return []
    angles: list[str] = []
    for m in _ANGLE_CUES.finditer(text):
        for g in m.groupdict().values():
            if g:
                g = g.strip().rstrip(",.:;")
                if g and g not in angles:
                    angles.append(g[:120])
                break
        if len(angles) >= max_angles:
            break
    return angles


def _starts_with_cue(text: str) -> bool:
    if not text:
        return False
    low = text.strip().lower()
    for cue in _PHASE_CUES:
        if low.startswith(cue):
            return True
    return False


# --- data model -----------------------------------------------------------
@dataclass
class Phase:
    index: int
    name: str
    intent: str
    trigger: str
    angles: list[str]
    tool_classes: list[str]
    tools_used: list[str]
    step_span_start: int
    step_span_end: int  # exclusive
    step_count: int
    # Playbook-entry slots (Cycle 25 — Goal / Angles / Method / Stop)
    goal: str = ""
    method: list[str] = field(default_factory=list)  # ordered tool-class sequence
    stop_condition: str = ""
    playbook_score: int = 0  # 0-4, count of filled slots (goal/angles/method/stop)
    # Loop-A slot signature (Cycle 30 — fixes 0/4 on reproduces_specific_artifacts)
    # Which CATEGORIES of concrete output this phase actually produced.
    # We pass the KINDS (not the values) into the replay briefing so the
    # cheap runtime knows what specifics to surface — or explicitly say
    # "insufficient_data:<kind>" instead of fabricating.
    slot_kinds: list[str] = field(default_factory=list)  # e.g. ["file_path", "count", "status"]
    slot_examples: list[str] = field(default_factory=list)  # a few example values (redacted)


# --- slot extraction (Loop A) -----------------------------------------
# Regexes for the four concrete artifact kinds that dominate Claude Code
# output: file paths, numeric counts with unit, status / verdict lines,
# and section headers / ALL-CAPS labels. These are the exact things the
# expensive baseline produces that the distilled playbook was losing.
_SLOT_FILE_RE = re.compile(
    r"(?<![\w./])(?:[\w.-]+/)*[\w.-]+\.(?:"
    r"tsx?|py|md|mdx|json|jsonl|ya?ml|toml|rs|go|sh|html|css|scss|"
    r"sql|lock|env|cfg|ini|txt|log|proto"
    r")(?![\w])",
)
_SLOT_COUNT_RE = re.compile(
    r"\b(?:\d{1,3}(?:,\d{3})+|\d+)\s*(?:"
    r"errors?|warnings?|tests?|files?|lines?|steps?|phases?|tools?|"
    r"sessions?|bytes?|tokens?|rows?|issues?|passing|failing|pending|"
    r"%|pp|ms|s|MB|KB|GB"
    r")\b",
    re.IGNORECASE,
)
_SLOT_STATUS_RE = re.compile(
    r"(?:\bPASS\b|\bFAIL\b|\bOK\b|\bERROR\b|\bREADY\b|"
    r"\bDONE\b|\bFAILED\b|\bSUCCESS\b|\bSKIPPED\b|"
    r"\bBLOCKED\b|\bPUBLISHED\b|\bCOMMITTED\b|\bDEPLOYED\b|"
    r"\u2713|\u2717|\u2714|\u2718|\[OK\]|\[FAIL\]|\[ERR\]|\[SKIP\])",
)
_SLOT_SECTION_RE = re.compile(
    r"(?m)^(?:#{1,4}\s+.{3,80}|(?:[A-Z][A-Z0-9 _/-]{4,60}))\s*$",
)


def _extract_slot_signature(texts: list[str]) -> tuple[list[str], list[str]]:
    """Return (slot_kinds, slot_examples).

    kinds lists which categories appeared; examples shows a few redacted
    sample values so the briefing can be specific about what shape of
    concrete output this phase is known to produce.
    """
    if not texts:
        return [], []
    joined = "\n".join(texts[:6])[:20000]  # cap scan to keep fast
    kinds: list[str] = []
    examples: list[str] = []

    files = _SLOT_FILE_RE.findall(joined)
    if files:
        kinds.append("file_path")
        for f in files[:3]:
            if f not in examples:
                examples.append(f[:80])

    counts = _SLOT_COUNT_RE.findall(joined)
    if counts:
        kinds.append("count")
        # findall returns the literal group — rescan to get short samples
        for m in _SLOT_COUNT_RE.finditer(joined):
            v = m.group(0).strip()
            if v and v not in examples:
                examples.append(v[:40])
            if sum(1 for e in examples if e in counts or any(c in e for c in counts)) >= 3:
                break

    statuses = _SLOT_STATUS_RE.findall(joined)
    if statuses:
        kinds.append("status")
        seen: set[str] = set()
        for s in statuses:
            if s not in seen and len(seen) < 3:
                seen.add(s)
                if s not in examples:
                    examples.append(s[:40])

    sections = _SLOT_SECTION_RE.findall(joined)
    if sections:
        kinds.append("section_header")
        for h in sections[:2]:
            h_norm = re.sub(r"\s+", " ", h).strip()
            if h_norm and h_norm not in examples:
                examples.append(h_norm[:80])

    # Dedupe kinds preserving order
    seen_k: set[str] = set()
    unique_kinds = [k for k in kinds if not (k in seen_k or seen_k.add(k))]
    return unique_kinds, examples[:8]


# --- goal / method / stop extractors (heuristic, no LLM) -----------------
_IMPERATIVE_VERBS = (
    "write", "save", "persist", "emit", "create", "build", "implement",
    "verify", "validate", "test", "check", "prove",
    "search", "find", "look", "gather", "collect", "ingest",
    "read", "load", "fetch", "inspect", "review",
    "refactor", "update", "modify", "edit", "patch", "fix",
    "run", "execute", "compile", "deploy",
    "distill", "summarize", "analyze", "compare", "measure",
    "add", "remove", "delete", "rename", "move",
    "plan", "design", "propose", "draft",
)

_STOP_SIGNALS = (
    "done", "complete", "finished", "all pass", "all tests pass",
    "zero errors", "clean", "ok", "success", "verified",
    "build clean", "tsc clean", "committed", "pushed", "deployed",
    "ready", "shipped", "landed",
)

_GOAL_CUES = re.compile(
    r"(?:"
    r"(?:goal|objective|target)(?:\s+is)?[:\-]\s+(?P<g1>[^.?!\n]{3,120})"
    r"|in\s+order\s+to\s+(?P<g2>[^.?!\n]{3,120})"
    r"|so\s+that\s+(?P<g3>[^.?!\n]{3,120})"
    r"|to\s+(?P<g4>(?:"
    + "|".join(_IMPERATIVE_VERBS)
    + r")\b[^.?!\n]{0,120})"
    r")",
    re.IGNORECASE,
)


def _extract_goal(texts: list[str]) -> str:
    """Derive a noun-phrase goal from the phase's assistant text.

    Priority:
      1. Explicit "goal:" / "objective:" cue
      2. "in order to X" / "so that X" / "to <imperative>" cue
      3. First imperative-verb-headed sentence from the opener
      4. Empty (caller can fall back to dominant tool class)
    """
    if not texts:
        return ""
    joined = " ".join(texts[:3])
    m = _GOAL_CUES.search(joined)
    if m:
        for g in m.groupdict().values():
            if g:
                return g.strip().rstrip(",.:;")[:120]
    # Fallback: first sentence starting with an imperative verb
    opener = texts[0]
    first = _first_sentence(opener, max_len=200)
    if first:
        low = first.lower().lstrip()
        for v in _IMPERATIVE_VERBS:
            if low.startswith(v + " ") or low.startswith(v + "ing "):
                return first.rstrip(".:;")[:120]
    return ""


def _extract_method(steps_span: list, sget) -> list[str]:
    """Ordered list of tool classes, with adjacent duplicates collapsed."""
    seq: list[str] = []
    last = None
    for s in steps_span:
        tool_calls = sget(s, "tool_calls", []) or []
        for tc in tool_calls:
            name = tc.get("name") if isinstance(tc, dict) else getattr(tc, "name", "")
            if not name:
                continue
            klass = _tool_class(name)
            if klass and klass != last:
                seq.append(klass)
                last = klass
    # Cap at 8 classes so the method reads as a recipe, not a log
    return seq[:8]


def _extract_stop_condition(texts: list[str], method: list[str]) -> str:
    """Look at the final assistant text for success / exit signals."""
    if texts:
        tail = texts[-1].lower()
        for sig in _STOP_SIGNALS:
            if sig in tail:
                # Return the phrase verbatim with context
                idx = tail.find(sig)
                window = texts[-1][max(0, idx - 20) : idx + len(sig) + 40]
                return window.strip().rstrip(",.:;")[:120]
    if method:
        # Fallback: phase ends after the last tool class completes
        return f"after final {method[-1]} step"
    return ""


def _fallback_goal_from_method(method: list[str]) -> str:
    """When no text cue is found, synthesize a goal from the method."""
    if not method:
        return ""
    GOAL_MAP = {
        "search": "gather information",
        "read": "load relevant context",
        "edit": "modify existing code",
        "write": "persist new artifact",
        "shell": "execute a verification step",
        "navigate": "move across resources",
        "agent": "delegate to a sub-agent",
        "think": "plan or reason explicitly",
        "other": "perform a generic action",
    }
    # Use the last (most decisive) class as the goal driver
    return GOAL_MAP.get(method[-1], "")


@dataclass
class MetaWorkflow:
    session_id: str
    total_steps: int
    phase_count: int
    dominant_tool_classes: list[str]
    phases: list[Phase] = field(default_factory=list)


# --- main entry -----------------------------------------------------------
def distill_meta_workflow(trace: Any) -> MetaWorkflow:
    """Segment a CanonicalTrace (or dict) into phases.

    Works on either ``CanonicalTrace`` dataclasses or plain dicts
    produced by ``from_claude_code_jsonl``.
    """
    session_id = getattr(trace, "session_id", "") or (
        trace.get("session_id", "") if isinstance(trace, dict) else ""
    )
    steps = getattr(trace, "steps", None) or (
        trace.get("steps", []) if isinstance(trace, dict) else []
    )

    # Normalize step access so we handle dataclass / dict / hybrid
    def sget(s: Any, key: str, default: Any = None) -> Any:
        if isinstance(s, dict):
            return s.get(key, default)
        return getattr(s, key, default)

    # ------------------------------------------------------------------
    # Segmentation policy (revised — meta, not micro):
    #   PRIMARY boundary  : a new user message (user re-directs the agent)
    #   SECONDARY boundary: within a user-message block, a sustained
    #                       tool-class shift (>= MIN_RUN consecutive turns
    #                       with a different dominant class) creates a
    #                       sub-phase. Individual "Let me" cues DO NOT
    #                       create boundaries — those are narration, not
    #                       intent shifts.
    #
    # This yields meta-workflow phases on the order of 1-3 per user
    # turn, not one per assistant turn.
    # ------------------------------------------------------------------
    MIN_SUB_PHASE_RUN = 4  # need 4+ consecutive same-class steps to sub-split

    # First pass: split on user messages into "blocks"
    blocks: list[tuple[int, int, str]] = []  # (start, end_excl, trigger)
    cur_trigger = ""
    cur_start = 0
    first_user_seen = False
    for i, s in enumerate(steps):
        if sget(s, "role", "") == "user":
            if first_user_seen and cur_start < i:
                blocks.append((cur_start, i, cur_trigger))
            cur_trigger = (sget(s, "content", "") or "")[:400]
            cur_start = i + 1
            first_user_seen = True
    if first_user_seen and cur_start < len(steps):
        blocks.append((cur_start, len(steps), cur_trigger))
    elif not first_user_seen and len(steps) > 0:
        # No user turns at all — one implicit block
        blocks.append((0, len(steps), ""))

    phases: list[Phase] = []

    # Second pass: within each block, optionally split on sustained
    # tool-class transition
    for block_start, block_end, trigger in blocks:
        # Gather per-step dominant class within the block
        step_classes: list[str] = []
        assistant_texts: list[str] = []
        for j in range(block_start, block_end):
            s = steps[j]
            role = sget(s, "role", "")
            if role == "assistant":
                t = sget(s, "content", "") or ""
                if t:
                    assistant_texts.append(t)
            tool_calls = sget(s, "tool_calls", []) or []
            classes_this_step: list[str] = []
            for tc in tool_calls:
                name = tc.get("name") if isinstance(tc, dict) else getattr(tc, "name", "")
                if name:
                    classes_this_step.append(_tool_class(name))
            # Dominant class for this step (or "" if no tools)
            if classes_this_step:
                # majority vote
                best = max(set(classes_this_step), key=classes_this_step.count)
                step_classes.append(best)
            else:
                step_classes.append("")

        # Find sub-phase boundaries: runs of >= MIN_SUB_PHASE_RUN
        # consecutive same-class steps form a sub-phase.
        sub_starts: list[int] = [0]
        run_class = ""
        run_len = 0
        for idx, c in enumerate(step_classes):
            if c != run_class:
                if run_len >= MIN_SUB_PHASE_RUN and idx > 0:
                    sub_starts.append(idx)
                run_class = c
                run_len = 1
            else:
                run_len += 1
        sub_ranges: list[tuple[int, int]] = []
        for k, s_ in enumerate(sub_starts):
            e_ = sub_starts[k + 1] if k + 1 < len(sub_starts) else len(step_classes)
            sub_ranges.append((s_, e_))

        for sub_start, sub_end in sub_ranges:
            global_start = block_start + sub_start
            global_end = block_start + sub_end
            if global_end <= global_start:
                continue
            # Gather names/classes for the sub-phase
            tool_names_seen: list[str] = []
            classes_seen: set[str] = set()
            texts_in_sub: list[str] = []
            for j in range(global_start, global_end):
                s = steps[j]
                if sget(s, "role", "") == "assistant":
                    t = sget(s, "content", "") or ""
                    if t:
                        texts_in_sub.append(t)
                tool_calls = sget(s, "tool_calls", []) or []
                for tc in tool_calls:
                    name = tc.get("name") if isinstance(tc, dict) else getattr(tc, "name", "")
                    if not name:
                        continue
                    if name not in tool_names_seen:
                        tool_names_seen.append(name)
                    classes_seen.add(_tool_class(name))
            opener = texts_in_sub[0] if texts_in_sub else ""
            name = _short_name(opener) or f"phase-{len(phases) + 1}"
            intent = _first_sentence(opener) or name
            angles = _extract_angles(" ".join(texts_in_sub[:3]))

            # --- Playbook-entry slots (Cycle 25) ---------------------
            steps_span = steps[global_start:global_end]
            method = _extract_method(steps_span, sget)
            goal = _extract_goal(texts_in_sub) or _fallback_goal_from_method(method)
            stop = _extract_stop_condition(texts_in_sub, method)
            # playbook_score = how many of the 4 slots we filled
            playbook_score = sum(
                1 for slot in (goal, angles, method, stop) if slot
            )
            # --- Loop-A slot signature ---------------------------------
            slot_kinds, slot_examples = _extract_slot_signature(texts_in_sub)

            phases.append(
                Phase(
                    index=len(phases),
                    name=name,
                    intent=intent,
                    trigger=(trigger or "")[:240],
                    angles=angles,
                    tool_classes=sorted(classes_seen),
                    tools_used=tool_names_seen,
                    step_span_start=global_start,
                    step_span_end=global_end,
                    step_count=global_end - global_start,
                    goal=goal,
                    method=method,
                    stop_condition=stop,
                    playbook_score=playbook_score,
                    slot_kinds=slot_kinds,
                    slot_examples=slot_examples,
                )
            )

    # Dominant tool classes across all phases
    class_counts: dict[str, int] = {}
    for p in phases:
        for c in p.tool_classes:
            class_counts[c] = class_counts.get(c, 0) + 1
    dominant = sorted(class_counts, key=lambda k: -class_counts[k])[:5]

    return MetaWorkflow(
        session_id=session_id,
        total_steps=len(steps),
        phase_count=len(phases),
        dominant_tool_classes=dominant,
        phases=phases,
    )


def meta_workflow_to_dict(mw: MetaWorkflow) -> dict[str, Any]:
    return asdict(mw)
