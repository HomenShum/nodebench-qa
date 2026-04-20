"""Cross-trace playbook induction.

Given a cluster of N similar sessions (from ``cluster_sessions.py``),
derive a single canonical playbook that names:

  * **Core phases** — appear in >= ceil(N/2) sessions. These are the
    load-bearing steps the work keeps coming back to.
  * **Optional branches** — appear in 2..floor(N/2) sessions. These are
    real but not always-on.
  * **Singletons** — appear in exactly one session. Noise / bespoke
    for that run; excluded from the playbook.

Alignment is by phase *signature*, a triple computed from the phase:

    signature = (dominant_tool_class, method_tuple, goal_token_set)

Two signatures are "same phase" if:
    - they share the dominant tool class, AND
    - jaccard(method_tuples) >= 0.5, AND
    - jaccard(goal_token_sets) >= 0.3

We use an order-aware clustering (don't collapse phase_A in session_1
with phase_A in session_2 if they appeared at wildly different
positions). Each output phase carries:

    - member_sessions: which sessions contributed this phase
    - canonical_goal / canonical_method / canonical_stop: consensus
    - coverage: member_sessions / N

Cluster coverage metric:

    playbook_coverage = fraction of cluster sessions whose phase
                        sequence is fully explained by
                        (core + optional) phases (within tolerance)

If `playbook_coverage < 0.6` the cluster is flagged ``incoherent`` —
we don't ship a playbook for it.
"""

from __future__ import annotations

import argparse
import json
import math
import re
import sys
from dataclasses import dataclass, asdict, field
from pathlib import Path
from typing import Any

from daas.compile_down.normalizers.claude_code import from_claude_code_jsonl
from daas.compile_down.meta_workflow import distill_meta_workflow


# --------- signature model ------------------------------------------------
@dataclass(frozen=True)
class PhaseSignature:
    dominant_class: str
    method_tuple: tuple[str, ...]
    goal_tokens: frozenset  # frozenset[str]

    def to_dict(self) -> dict[str, Any]:
        return {
            "dominant_class": self.dominant_class,
            "method_tuple": list(self.method_tuple),
            "goal_tokens": sorted(self.goal_tokens),
        }


def _dominant_class(tool_classes: list[str], method: list[str]) -> str:
    if method:
        # Count occurrences within method
        counts: dict[str, int] = {}
        for c in method:
            counts[c] = counts.get(c, 0) + 1
        return max(counts, key=counts.get)
    if tool_classes:
        return tool_classes[0]
    return ""


_GOAL_TOKEN_RE = re.compile(r"[a-zA-Z][a-zA-Z0-9_-]{2,}")


def _goal_tokens(goal: str, name: str, intent: str) -> frozenset:
    text = " ".join(filter(None, [goal, name, intent]))
    tokens = [t.lower() for t in _GOAL_TOKEN_RE.findall(text) if len(t) > 2]
    # Keep only first 8 meaningful tokens
    return frozenset(tokens[:12])


def phase_signature(phase: dict) -> PhaseSignature:
    return PhaseSignature(
        dominant_class=_dominant_class(
            phase.get("tool_classes") or [], phase.get("method") or []
        ),
        method_tuple=tuple(phase.get("method") or []),
        goal_tokens=_goal_tokens(
            phase.get("goal", ""),
            phase.get("name", ""),
            phase.get("intent", ""),
        ),
    )


def _jaccard(a: set, b: set) -> float:
    if not a and not b:
        return 0.0
    return len(a & b) / max(1, len(a | b))


def _same_phase(a: PhaseSignature, b: PhaseSignature) -> bool:
    if a.dominant_class != b.dominant_class:
        return False
    if a.method_tuple and b.method_tuple:
        if _jaccard(set(a.method_tuple), set(b.method_tuple)) < 0.5:
            return False
    else:
        # If one side has no method, require stronger goal overlap
        if _jaccard(set(a.goal_tokens), set(b.goal_tokens)) < 0.5:
            return False
    if a.goal_tokens and b.goal_tokens:
        if _jaccard(set(a.goal_tokens), set(b.goal_tokens)) < 0.30:
            return False
    return True


# --------- playbook model -------------------------------------------------
@dataclass
class PlaybookPhase:
    role: str  # "core" | "optional"
    signature: dict[str, Any]
    canonical_goal: str
    canonical_method: list[str]
    canonical_stop: str
    angles_union: list[str]
    member_session_ids: list[str]
    coverage: float  # members / N
    # Loop-A slot contract: which artifact kinds (file_path / count /
    # status / section_header) this phase is expected to produce.
    # Derived from the union of member phases' slot_kinds; a kind is
    # REQUIRED if it appeared in >= 50% of members.
    required_slot_kinds: list[str] = field(default_factory=list)
    optional_slot_kinds: list[str] = field(default_factory=list)


@dataclass
class ClusterPlaybook:
    cluster_id: str
    cluster_label: str
    session_count: int
    phases: list[PlaybookPhase]
    coverage_rate: float
    verdict: str  # "coherent" | "incoherent"


def _consensus_string(values: list[str]) -> str:
    """Return the most-frequent non-empty value, or the longest."""
    filt = [v.strip() for v in values if v and v.strip()]
    if not filt:
        return ""
    counts: dict[str, int] = {}
    for v in filt:
        counts[v] = counts.get(v, 0) + 1
    # Most frequent
    best = max(counts, key=lambda k: (counts[k], len(k)))
    return best[:120]


def _consensus_method(methods: list[list[str]]) -> list[str]:
    """Consensus method = the most common class sequence among members,
    or the longest common prefix if no consensus.
    """
    if not methods:
        return []
    filt = [tuple(m) for m in methods if m]
    if not filt:
        return []
    counts: dict[tuple, int] = {}
    for t in filt:
        counts[t] = counts.get(t, 0) + 1
    best = max(counts, key=lambda k: counts[k])
    return list(best)


def induce_playbook(
    cluster_id: str,
    cluster_label: str,
    sessions: list[dict],
) -> ClusterPlaybook:
    """Given N sessions (each a meta_workflow dict with 'phases'), derive
    a canonical playbook.
    """
    n = len(sessions)
    if n == 0:
        return ClusterPlaybook(cluster_id, cluster_label, 0, [], 0.0, "incoherent")

    # Build per-session phase list, tagged with session_id
    all_phases: list[tuple[str, dict, PhaseSignature]] = []
    for sess in sessions:
        sid = sess.get("session_id", "")
        for p in sess.get("phases", []) or []:
            sig = phase_signature(p)
            if not sig.dominant_class and not sig.goal_tokens:
                continue  # skip empty phases
            all_phases.append((sid, p, sig))

    # Greedy cluster phases by signature similarity
    phase_clusters: list[list[tuple[str, dict, PhaseSignature]]] = []
    for record in all_phases:
        _, _, sig = record
        placed = False
        for pc in phase_clusters:
            # Check against representative (first member)
            rep_sig = pc[0][2]
            if _same_phase(sig, rep_sig):
                pc.append(record)
                placed = True
                break
        if not placed:
            phase_clusters.append([record])

    # For each phase_cluster, find unique member sessions
    playbook_phases: list[PlaybookPhase] = []
    core_threshold = max(1, math.ceil(n / 2))
    covered_sessions: set[str] = set()
    for pc in phase_clusters:
        member_session_ids = sorted({sid for sid, _, _ in pc})
        m = len(member_session_ids)
        if m < 2:
            continue  # singleton -> skip
        role = "core" if m >= core_threshold else "optional"
        goals = [p.get("goal", "") for _, p, _ in pc]
        methods = [p.get("method", []) or [] for _, p, _ in pc]
        stops = [p.get("stop_condition", "") for _, p, _ in pc]
        angles_all: list[str] = []
        for _, p, _ in pc:
            for a in p.get("angles", []) or []:
                if a and a not in angles_all:
                    angles_all.append(a)
        # Loop-A slot-kind aggregation: count how many cluster members
        # emitted each kind, split into required (>=50%) / optional.
        slot_counts: dict[str, int] = {}
        for _, p, _ in pc:
            for k in (p.get("slot_kinds") or []):
                slot_counts[k] = slot_counts.get(k, 0) + 1
        half = max(1, (m + 1) // 2)  # ceil(m/2)
        required_kinds = sorted([k for k, c in slot_counts.items() if c >= half])
        optional_kinds = sorted([k for k, c in slot_counts.items() if 0 < c < half])

        playbook_phases.append(
            PlaybookPhase(
                role=role,
                signature=pc[0][2].to_dict(),
                canonical_goal=_consensus_string(goals),
                canonical_method=_consensus_method(methods),
                canonical_stop=_consensus_string(stops),
                angles_union=angles_all[:10],
                member_session_ids=member_session_ids,
                coverage=round(m / n, 3),
                required_slot_kinds=required_kinds,
                optional_slot_kinds=optional_kinds,
            )
        )
        covered_sessions.update(member_session_ids)

    # Coverage rate = fraction of cluster sessions that contributed to
    # at least one core/optional phase
    coverage_rate = round(len(covered_sessions) / n, 3) if n else 0.0
    verdict = "coherent" if coverage_rate >= 0.6 else "incoherent"

    # Sort playbook phases: core first (by coverage desc), then optional
    playbook_phases.sort(
        key=lambda p: (0 if p.role == "core" else 1, -p.coverage)
    )

    return ClusterPlaybook(
        cluster_id=cluster_id,
        cluster_label=cluster_label,
        session_count=n,
        phases=playbook_phases,
        coverage_rate=coverage_rate,
        verdict=verdict,
    )


# --------- CLI entry ------------------------------------------------------
def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument(
        "--clusters",
        required=True,
        help="clusters.json produced by cluster_sessions.py",
    )
    ap.add_argument(
        "--projects-root", default=str(Path.home() / ".claude" / "projects")
    )
    ap.add_argument(
        "--project",
        default="D--VSCode-Projects-cafecorner-nodebench-nodebench-ai4-nodebench-ai",
    )
    ap.add_argument("--min-size", type=int, default=2)
    ap.add_argument("--out", required=True)
    ap.add_argument("--human-out", default=None)
    args = ap.parse_args()

    clusters_doc = json.loads(Path(args.clusters).read_text(encoding="utf-8"))
    project_dir = Path(args.projects_root) / args.project

    playbooks: list[ClusterPlaybook] = []
    for c in clusters_doc.get("clusters", []):
        if len(c.get("session_ids", [])) < args.min_size:
            continue
        sessions_mw: list[dict] = []
        for sid in c["session_ids"]:
            p = project_dir / f"{sid}.jsonl"
            if not p.exists():
                print(f"[WARN] missing {sid}")
                continue
            trace = from_claude_code_jsonl(p)
            mw = distill_meta_workflow(trace)
            # Serialize for induction
            from dataclasses import asdict as _as
            sessions_mw.append(_as(mw))
        pb = induce_playbook(
            cluster_id=c["cluster_id"],
            cluster_label=c["label"],
            sessions=sessions_mw,
        )
        playbooks.append(pb)
        print(
            f"[IND] {pb.cluster_id}  n={pb.session_count}  "
            f"phases={len(pb.phases):>3}  "
            f"coverage={pb.coverage_rate:.2f}  "
            f"verdict={pb.verdict}  label={pb.cluster_label[:40]!r}"
        )

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(
        json.dumps(
            {
                "playbook_count": len(playbooks),
                "coherent_count": sum(1 for p in playbooks if p.verdict == "coherent"),
                "playbooks": [asdict(p) for p in playbooks],
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    print(f"[DONE] wrote {out}")

    if args.human_out:
        lines: list[str] = [
            "# Induced Playbooks — corpus-level\n",
            "Each playbook below was induced from a cluster of similar sessions. "
            "Phases flagged `core` appear in at least half the cluster members; "
            "`optional` phases appear in 2 or more members but less than half.\n",
        ]
        for pb in playbooks:
            lines.append(
                f"\n## `{pb.cluster_id}` — *{pb.cluster_label}* "
                f"(n={pb.session_count}, verdict: `{pb.verdict}`, "
                f"coverage {pb.coverage_rate:.0%})"
            )
            if not pb.phases:
                lines.append("_No recurring phases above singleton threshold._\n")
                continue
            for i, ph in enumerate(pb.phases):
                badge = "**CORE**" if ph.role == "core" else "*optional*"
                lines.append(
                    f"\n### Phase {i + 1} — {badge}  (coverage {ph.coverage:.0%})"
                )
                if ph.canonical_goal:
                    lines.append(f"- **Goal**: {ph.canonical_goal}")
                if ph.canonical_method:
                    arrow = " \u2192 "
                    lines.append(
                        f"- **Method**: {arrow.join(ph.canonical_method)}"
                    )
                if ph.angles_union:
                    lines.append(
                        "- **Angles**: "
                        + "; ".join(f"`{a}`" for a in ph.angles_union[:5])
                    )
                if ph.canonical_stop:
                    lines.append(f"- **Stop**: {ph.canonical_stop}")
                sep = "`, `"
                truncated = [s[:8] for s in ph.member_session_ids]
                lines.append(
                    f"- **In sessions**: `{sep.join(truncated)}`"
                )
        Path(args.human_out).parent.mkdir(parents=True, exist_ok=True)
        Path(args.human_out).write_text("\n".join(lines), encoding="utf-8")
        print(f"[DONE] wrote human-readable -> {args.human_out}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
