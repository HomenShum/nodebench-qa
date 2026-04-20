"""Live replay harness — the real fidelity proof.

For each held-out session in a cluster's playbook:

    1. Take the session's ORIGINAL user prompt (trace.query).
    2. Take the session's ORIGINAL assistant final answer (expensive
       baseline — produced by the real agent at the time).
    3. Build a cheap-runtime system prompt from the cluster's induced
       playbook (concatenated phase goals + methods, joined into a
       compact operator briefing).
    4. Call Flash Lite ``gemini-3.1-flash-lite-preview`` with that
       system prompt + the original user prompt. Capture the
       Flash Lite answer.
    5. Call Pro ``gemini-3.1-pro-preview`` as an LLM judge with a
       strict rubric that emits one of:
         transfers         — Flash Lite answer is equivalent to original
         lossy             — covers main points but misses specifics
         regression        — substantially worse / missing critical content
         insufficient_data — judge can't tell (rare; flags bad input)
    6. Aggregate verdicts across the cluster; report a Wilson 95 % CI
       on transfer rate.

Cost accounting: every Gemini call records input/output tokens +
estimated USD so the replay ships with a live cost readout, not a
marketing number.

Required env: ``GEMINI_API_KEY`` (read from env or passed via --api-key).
"""

from __future__ import annotations

import argparse
import json
import math
import os
import re
import sys
import time
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Any

from daas.compile_down.normalizers.claude_code import from_claude_code_jsonl


# --------- configuration --------------------------------------------------
FLASH_MODEL = "gemini-3.1-flash-lite-preview"
PRO_MODEL = "gemini-3.1-pro-preview"

FLASH_PRICE_IN = 0.10 / 1_000_000  # USD per input token (rough)
FLASH_PRICE_OUT = 0.40 / 1_000_000
PRO_PRICE_IN = 1.25 / 1_000_000
PRO_PRICE_OUT = 10.0 / 1_000_000

MAX_QUERY_CHARS = 6000
MAX_ORIGINAL_ANSWER_CHARS = 4000
FLASH_MAX_OUTPUT_TOKENS = 2048
JUDGE_MAX_OUTPUT_TOKENS = 4096

JUDGE_RUBRIC = """You are a fidelity judge evaluating agent replay.

Given:
  - USER_PROMPT:     what the user asked
  - ORIGINAL_ANSWER: what an expensive agent produced (baseline)
  - REPLAY_ANSWER:   what a cheap agent produced against the same
                     prompt, using a distilled playbook

Do NOT emit a verdict. You emit SIX INDEPENDENT BOOLEAN CHECKS.
The verdict is derived deterministically downstream from the vector
of booleans — that separation keeps your job stable and auditable.

Emit a pure JSON object (no code fences) with exactly this shape:
{
  "covers_main_points":             {"bool": true|false, "reason": "one sentence"},
  "reproduces_specific_artifacts":  {"bool": true|false, "reason": "one sentence"},
  "addresses_user_prompt":          {"bool": true|false, "reason": "one sentence"},
  "no_hallucination":               {"bool": true|false, "reason": "one sentence"},
  "structural_coherence":           {"bool": true|false, "reason": "one sentence"},
  "baseline_is_substantive":        {"bool": true|false, "reason": "one sentence"}
}

Definitions (strict):
  covers_main_points
    true  = REPLAY hits every substantive point ORIGINAL hits at the
            topic/section level.
    false = REPLAY is missing one or more load-bearing sections the
            ORIGINAL clearly delivered.

  reproduces_specific_artifacts
    true  = REPLAY includes the concrete file names / counts / status
            lines / exact quotes present in ORIGINAL.
    false = REPLAY substitutes generic plans for ORIGINAL's specifics.

  addresses_user_prompt
    true  = REPLAY actually answers what USER_PROMPT asked.
    false = REPLAY drifts off-topic or answers a different question.

  no_hallucination
    true  = REPLAY invents nothing that USER_PROMPT and the playbook
            didn't imply.
    false = REPLAY fabricates details (fake filenames, fake numbers,
            fake claims).

  structural_coherence
    true  = REPLAY has the shape of a helpful answer (coherent flow,
            not noise).
    false = REPLAY is incoherent, partial, or cut off mid-thought.

  baseline_is_substantive
    true  = ORIGINAL_ANSWER is rich enough to be a meaningful baseline
            (> ~80 characters of substantive content).
    false = ORIGINAL_ANSWER is trivial / a one-liner / empty. Flag this
            so downstream can emit insufficient_data cleanly.

Every reason must be ONE sentence. Do not combine checks into a single
verdict — that is computed after you return.
"""


# --------- Gemini HTTP client --------------------------------------------
def _gemini_call(
    *,
    model: str,
    system: str,
    user: str,
    api_key: str,
    max_output_tokens: int,
    response_mime_type: str = "text/plain",
) -> tuple[str, int, int]:
    """One-shot generateContent call. Returns (text, in_toks, out_toks).

    When ``response_mime_type="application/json"`` Gemini guarantees the
    text is valid JSON (no markdown fences, no leading prose) which
    fixes the judge-parse truncation we were hitting.
    """
    import urllib.request
    import urllib.error

    url = (
        f"https://generativelanguage.googleapis.com/v1beta/models/{model}"
        f":generateContent?key={api_key}"
    )
    gen_config: dict = {
        "temperature": 0.2,
        "maxOutputTokens": max_output_tokens,
        "responseMimeType": response_mime_type,
    }
    payload = {
        "systemInstruction": {"parts": [{"text": system}]},
        "contents": [
            {"role": "user", "parts": [{"text": user}]},
        ],
        "generationConfig": gen_config,
    }
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=90) as resp:
            body = resp.read().decode("utf-8")
    except urllib.error.HTTPError as e:
        err_body = e.read().decode("utf-8", errors="ignore")
        return (f"[HTTP {e.code}] {err_body[:400]}", 0, 0)
    except (urllib.error.URLError, TimeoutError) as e:  # noqa: BLE001
        return (f"[NETERR] {e}", 0, 0)

    try:
        parsed = json.loads(body)
    except json.JSONDecodeError:
        return (body[:400], 0, 0)

    candidates = parsed.get("candidates") or []
    if not candidates:
        # Blocked or empty
        blocked = parsed.get("promptFeedback", {}).get("blockReason", "")
        return (f"[empty_candidates blocked={blocked}]", 0, 0)
    parts = (candidates[0].get("content") or {}).get("parts") or []
    text = "\n".join(str(p.get("text", "")) for p in parts if p.get("text"))
    usage = parsed.get("usageMetadata") or {}
    in_toks = int(usage.get("promptTokenCount", 0) or 0)
    out_toks = int(usage.get("candidatesTokenCount", 0) or 0)
    return text, in_toks, out_toks


# --------- playbook -> operator briefing ---------------------------------
# Human-readable explanations of each slot kind, used in the honesty
# clause of the briefing so the cheap runtime knows EXACTLY what it's
# allowed to fabricate (nothing) and how to mark a missing concrete.
_SLOT_KIND_BLURB: dict[str, str] = {
    "file_path": "specific file names (e.g. `src/foo/Bar.tsx`)",
    "count": "specific numeric counts with units (e.g. `12 errors`, `n=200`, `80 tests`)",
    "status": "concrete status / verdict tokens (e.g. `PASS`, `OK`, `READY`, `✓`, `FAIL`)",
    "section_header": "concrete section titles or ALL-CAPS labels",
}


def build_operator_briefing(playbook: dict) -> str:
    """Compact text the cheap runtime uses as its system prompt.

    Now includes SLOT CONTRACTS per phase: if the corpus says this phase
    typically emits file names / counts / status lines, the briefing
    tells the cheap model to either EMIT THAT SHAPE or explicitly write
    `insufficient_data:<kind>`. This is the Loop-A fix for 0/4 on
    reproduces_specific_artifacts.
    """
    lines: list[str] = [
        "You are a cheap-runtime operator following a distilled playbook.",
        "The playbook was induced from a corpus of real agent sessions that",
        f"handled work labeled: {playbook.get('cluster_label', 'unknown')!r}.",
        "",
        "When you answer the user, follow the playbook phases in order.",
        "Each phase names a goal + method (tool-class recipe) + a slot",
        "contract (what shape of concrete output that phase is known to",
        "produce). You are producing a TEXT answer (not calling tools);",
        "apply the playbook as your mental operating procedure.",
        "",
        "HONESTY CLAUSE (load-bearing):",
        "  Do NOT fabricate specific file names, counts, status lines,",
        "  or section headers that are not present in the user's prompt.",
        "  If a phase's slot contract asks for a specific you don't have,",
        "  write `insufficient_data:<slot_kind>` on that line instead.",
        "  Generic substitutes (e.g. inventing plausible filenames) count",
        "  as fabrication and will be rejected.",
        "",
        "--- PLAYBOOK ---",
    ]
    phases = playbook.get("phases") or []
    for i, ph in enumerate(phases):
        badge = "CORE" if ph.get("role") == "core" else "optional"
        lines.append(f"[{badge}] Phase {i+1}: {ph.get('canonical_goal') or '(no goal)'}")
        method = ph.get("canonical_method") or []
        if method:
            lines.append(f"    method: {' -> '.join(method)}")
        stop = (ph.get("canonical_stop") or "").strip()
        if stop:
            stop_short = re.sub(r"\s+", " ", stop)[:120]
            lines.append(f"    stop: {stop_short}")
        angles = ph.get("angles_union") or []
        if angles:
            lines.append(f"    angles: {', '.join(angles[:3])[:180]}")
        # Slot contract
        req = ph.get("required_slot_kinds") or []
        opt = ph.get("optional_slot_kinds") or []
        if req:
            req_blurbs = [f"{k} = {_SLOT_KIND_BLURB.get(k, k)}" for k in req]
            lines.append(
                f"    REQUIRED slots (emit concrete or `insufficient_data:<kind>`): "
                f"{'; '.join(req_blurbs)}"
            )
        if opt:
            lines.append(f"    optional slots (if available): {', '.join(opt)}")
    lines += [
        "",
        "Answer the user's prompt in <= 1500 words. Cover the goals of",
        "every CORE phase that is relevant to the user's prompt. Skip",
        "irrelevant phases. When a CORE phase has a REQUIRED slot and",
        "you don't have the specific value from the user's prompt, say so",
        "with `insufficient_data:<slot_kind>` — do not invent a plausible",
        "substitute.",
    ]
    return "\n".join(lines)


# --------- Wilson CI -----------------------------------------------------
def wilson_95(k: int, n: int) -> tuple[float, float, float]:
    if n == 0:
        return 0.0, 0.0, 0.0
    p = k / n
    z = 1.96
    denom = 1 + z * z / n
    centre = (p + z * z / (2 * n)) / denom
    margin = (z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))) / denom
    return round(p, 3), round(max(0.0, centre - margin), 3), round(min(1.0, centre + margin), 3)


# --------- per-session replay -------------------------------------------
@dataclass
class ReplayResult:
    session_id: str
    query_preview: str
    original_answer_preview: str
    replay_answer_preview: str
    verdict: str
    judge_reason: str  # composed from individual check reasons
    missing_items: list[str]
    # Cycle-29 boolean rubric vector + reasons (audit trail)
    checks: dict  # {check_name: {"bool": bool, "reason": str}}
    flash_in_tokens: int
    flash_out_tokens: int
    judge_in_tokens: int
    judge_out_tokens: int
    flash_usd: float
    judge_usd: float
    elapsed_s: float


def replay_one_session(
    jsonl_path: Path,
    operator_briefing: str,
    *,
    api_key: str,
) -> ReplayResult:
    t0 = time.perf_counter()
    trace = from_claude_code_jsonl(jsonl_path)
    query = (trace.query or "").strip()
    if len(query) > MAX_QUERY_CHARS:
        query = query[:MAX_QUERY_CHARS] + "\n\n[...truncated...]"
    original = (trace.final_answer or "").strip()
    original_for_judge = original[:MAX_ORIGINAL_ANSWER_CHARS]
    if not query or not original:
        return ReplayResult(
            session_id=jsonl_path.stem,
            query_preview=query[:200],
            original_answer_preview=original[:200],
            replay_answer_preview="",
            verdict="insufficient_data",
            judge_reason="empty query or empty original answer",
            missing_items=[],
            checks={},
            flash_in_tokens=0,
            flash_out_tokens=0,
            judge_in_tokens=0,
            judge_out_tokens=0,
            flash_usd=0.0,
            judge_usd=0.0,
            elapsed_s=round(time.perf_counter() - t0, 2),
        )

    # --- Step 1: Flash Lite replay
    replay_text, f_in, f_out = _gemini_call(
        model=FLASH_MODEL,
        system=operator_briefing,
        user=query,
        api_key=api_key,
        max_output_tokens=FLASH_MAX_OUTPUT_TOKENS,
    )

    # --- Step 2: Pro judge
    judge_user = (
        f"USER_PROMPT:\n{query[:2500]}\n\n"
        f"ORIGINAL_ANSWER:\n{original_for_judge}\n\n"
        f"REPLAY_ANSWER:\n{replay_text[:MAX_ORIGINAL_ANSWER_CHARS]}"
    )
    judge_text, j_in, j_out = _gemini_call(
        model=PRO_MODEL,
        system=JUDGE_RUBRIC,
        user=judge_user,
        api_key=api_key,
        max_output_tokens=JUDGE_MAX_OUTPUT_TOKENS,
        # Force JSON output — Gemini emits pure JSON, no markdown fences,
        # no prose preamble. Fixes the truncation we saw when the model
        # started writing reasoning text before the object.
        response_mime_type="application/json",
    )
    verdict, reason, missing, checks = _parse_judge_json(judge_text)

    # Persist raw judge response for auditing — helps debug truncation.
    debug_dir = Path("daas/results/_judge_raw")
    debug_dir.mkdir(parents=True, exist_ok=True)
    (debug_dir / f"{jsonl_path.stem}.txt").write_text(
        f"=== JUDGE RAW (len={len(judge_text)}) ===\n{judge_text}\n"
        f"=== PARSED CHECKS ===\n{json.dumps(checks, indent=2)}\n"
        f"=== DERIVED VERDICT ===\n{verdict}\n{reason}\n",
        encoding="utf-8",
    )

    flash_usd = f_in * FLASH_PRICE_IN + f_out * FLASH_PRICE_OUT
    judge_usd = j_in * PRO_PRICE_IN + j_out * PRO_PRICE_OUT

    return ReplayResult(
        session_id=jsonl_path.stem,
        query_preview=query[:240],
        original_answer_preview=original[:240],
        replay_answer_preview=replay_text[:240],
        verdict=verdict,
        judge_reason=reason,
        missing_items=missing,
        checks=checks,
        flash_in_tokens=f_in,
        flash_out_tokens=f_out,
        judge_in_tokens=j_in,
        judge_out_tokens=j_out,
        flash_usd=round(flash_usd, 6),
        judge_usd=round(judge_usd, 6),
        elapsed_s=round(time.perf_counter() - t0, 2),
    )


def _extract_first_balanced_json(s: str) -> str:
    """Return the first balanced {...} substring, respecting strings and
    escapes. Returns "" if not found.
    """
    depth = 0
    in_str = False
    esc = False
    start = -1
    for i, ch in enumerate(s):
        if in_str:
            if esc:
                esc = False
            elif ch == "\\":
                esc = True
            elif ch == '"':
                in_str = False
            continue
        if ch == '"':
            in_str = True
            continue
        if ch == "{":
            if depth == 0:
                start = i
            depth += 1
        elif ch == "}":
            if depth > 0:
                depth -= 1
                if depth == 0 and start != -1:
                    return s[start : i + 1]
    return ""


CHECK_KEYS: tuple[str, ...] = (
    "covers_main_points",
    "reproduces_specific_artifacts",
    "addresses_user_prompt",
    "no_hallucination",
    "structural_coherence",
    "baseline_is_substantive",
)


def _verdict_from_checks(checks: dict) -> tuple[str, str]:
    """Deterministic rollup from the 6-boolean rubric vector.

    Order:
      1. If baseline isn't substantive, we can't judge. -> insufficient_data
      2. If replay contradicts or fails to address the user's prompt,
         that's a hard fail. -> regression
      3. Otherwise, count misses among the three "fidelity" bools.
           0 misses -> transfers
           1 miss   -> lossy
           >=2     -> regression

    Returns (verdict, one-sentence composed reason).
    """

    def b(k: str) -> bool:
        v = checks.get(k, {})
        if isinstance(v, dict):
            return bool(v.get("bool"))
        return bool(v)

    def r(k: str) -> str:
        v = checks.get(k, {})
        if isinstance(v, dict):
            return str(v.get("reason") or "")
        return ""

    if not b("baseline_is_substantive"):
        return "insufficient_data", (r("baseline_is_substantive") or "baseline not substantive")

    if not b("addresses_user_prompt") or not b("no_hallucination"):
        rr = r("addresses_user_prompt") if not b("addresses_user_prompt") else r("no_hallucination")
        return "regression", rr

    fidelity_keys = (
        "covers_main_points",
        "reproduces_specific_artifacts",
        "structural_coherence",
    )
    misses = [k for k in fidelity_keys if not b(k)]
    if not misses:
        return "transfers", "all fidelity checks passed"
    if len(misses) == 1:
        return "lossy", r(misses[0])
    composed = "; ".join(r(k) for k in misses[:2])
    return "regression", composed[:240]


def _parse_judge_json(text: str) -> tuple[str, str, list[str], dict]:
    """Tolerant JSON parse of the SIX-BOOLEAN rubric.

    Returns (verdict, composed_reason, missing_items, checks_dict).
    Verdict is derived deterministically from the parsed booleans.
    """
    if not text:
        return "insufficient_data", "empty judge response", [], {}
    stripped = text.strip()
    if stripped.startswith("```"):
        stripped = re.sub(r"^```(?:json)?\s*", "", stripped)
        stripped = re.sub(r"\s*```\s*$", "", stripped)
    obj: dict | None = None
    try:
        obj = json.loads(stripped)
    except json.JSONDecodeError:
        chunk = _extract_first_balanced_json(stripped)
        if chunk:
            try:
                obj = json.loads(chunk)
            except json.JSONDecodeError:
                obj = None
    if not isinstance(obj, dict):
        return (
            "insufficient_data",
            f"unparseable judge (first 200 chars): {stripped[:200]}",
            [],
            {},
        )

    # Normalize the check dict
    checks: dict[str, dict] = {}
    for k in CHECK_KEYS:
        v = obj.get(k)
        if isinstance(v, dict):
            checks[k] = {
                "bool": bool(v.get("bool")),
                "reason": str(v.get("reason") or "")[:240],
            }
        elif isinstance(v, bool):
            checks[k] = {"bool": v, "reason": ""}
        else:
            # Missing check -> treat as false (conservative)
            checks[k] = {"bool": False, "reason": "check missing from judge output"}

    verdict, composed = _verdict_from_checks(checks)

    # missing_items fallback: surface failing fidelity checks as the
    # "what the replay missed" list for the UI.
    missing = [k for k in ("covers_main_points", "reproduces_specific_artifacts", "structural_coherence")
               if not checks[k]["bool"]]

    return verdict, composed[:240], missing[:6], checks


# --------- CLI entry -----------------------------------------------------
def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--playbooks", required=True)
    ap.add_argument("--cluster-id", default=None, help="Only replay this cluster")
    ap.add_argument("--api-key", default=os.environ.get("GEMINI_API_KEY", ""))
    ap.add_argument(
        "--projects-root", default=str(Path.home() / ".claude" / "projects")
    )
    ap.add_argument(
        "--project",
        default="D--VSCode-Projects-cafecorner-nodebench-nodebench-ai4-nodebench-ai",
    )
    ap.add_argument("--max-sessions-per-cluster", type=int, default=3)
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    if not args.api_key:
        print("[ERR] GEMINI_API_KEY not set and no --api-key given", file=sys.stderr)
        return 2
    pb_doc = json.loads(Path(args.playbooks).read_text(encoding="utf-8"))
    project_dir = Path(args.projects_root) / args.project

    results: list[dict[str, Any]] = []
    for pb in pb_doc.get("playbooks", []):
        if args.cluster_id and pb["cluster_id"] != args.cluster_id:
            continue
        if pb.get("verdict") != "coherent":
            print(f"[SKIP] {pb['cluster_id']} verdict={pb['verdict']}")
            continue
        briefing = build_operator_briefing(pb)
        cluster_results: list[ReplayResult] = []
        target_ids = {
            member_id
            for ph in pb["phases"]
            for member_id in ph["member_session_ids"]
        }
        sessions_to_run = list(target_ids)[: args.max_sessions_per_cluster]
        print(
            f"\n=== replaying cluster {pb['cluster_id']} "
            f"(n={len(sessions_to_run)} held-out sessions) ==="
        )
        for sid in sessions_to_run:
            jsonl = project_dir / f"{sid}.jsonl"
            if not jsonl.exists():
                print(f"[WARN] missing {sid}")
                continue
            r = replay_one_session(jsonl, briefing, api_key=args.api_key)
            cluster_results.append(r)
            print(
                f"  {sid[:8]}  verdict={r.verdict:<18}  "
                f"flash=${r.flash_usd:.4f}  judge=${r.judge_usd:.4f}  "
                f"reason={r.judge_reason[:70]!r}"
            )

        # Cluster-level aggregate
        n = len(cluster_results)
        t_count = sum(1 for r in cluster_results if r.verdict == "transfers")
        l_count = sum(1 for r in cluster_results if r.verdict == "lossy")
        r_count = sum(1 for r in cluster_results if r.verdict == "regression")
        i_count = sum(1 for r in cluster_results if r.verdict == "insufficient_data")
        # Transfer rate = transfers / (transfers + lossy + regression)
        denom = t_count + l_count + r_count
        p, lo, hi = wilson_95(t_count, max(1, denom))
        total_usd = sum(r.flash_usd + r.judge_usd for r in cluster_results)
        results.append(
            {
                "cluster_id": pb["cluster_id"],
                "cluster_label": pb["cluster_label"],
                "sessions_replayed": n,
                "transfers": t_count,
                "lossy": l_count,
                "regression": r_count,
                "insufficient_data": i_count,
                "transfer_rate": p,
                "transfer_rate_ci95_lo": lo,
                "transfer_rate_ci95_hi": hi,
                "total_usd": round(total_usd, 6),
                "briefing_preview": briefing[:800],
                "results": [asdict(r) for r in cluster_results],
            }
        )
        print(
            f"  --> transfers {t_count}/{denom}  "
            f"({p*100:.1f}% CI [{lo*100:.1f}, {hi*100:.1f}])  "
            f"cost=${total_usd:.4f}"
        )

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(
        json.dumps(
            {
                "flash_model": FLASH_MODEL,
                "judge_model": PRO_MODEL,
                "cluster_count": len(results),
                "clusters": results,
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    print(f"\n[DONE] wrote {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
