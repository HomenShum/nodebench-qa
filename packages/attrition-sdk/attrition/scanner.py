"""Codebase scanner — detect LLM integration points for advisor mode setup.

Scans a project directory and identifies:
1. Which LLM providers are used (OpenAI, Anthropic, LangChain, etc.)
2. Where LLM calls happen (file + line number)
3. Which models are referenced
4. Current agent architecture patterns (single model, multi-model, subagent, etc.)
5. Recommended advisor mode integration points

Usage:
    from attrition.scanner import scan_codebase
    report = scan_codebase("/path/to/project")
    print(report.summary)

    # Or CLI:
    python -m attrition.scanner /path/to/project
"""

import os
import re
import json
from pathlib import Path
from dataclasses import dataclass, field
from typing import Optional

# ── Provider detection patterns ──────────────────────────────────────────────

PROVIDER_PATTERNS: dict[str, list[re.Pattern]] = {
    "anthropic": [
        re.compile(r"from\s+anthropic\s+import|import\s+anthropic", re.IGNORECASE),
        re.compile(r"Anthropic\s*\("),
        re.compile(r"client\.messages\.create"),
        re.compile(r"claude-\w+-\d"),
    ],
    "openai": [
        re.compile(r"from\s+openai\s+import|import\s+openai", re.IGNORECASE),
        re.compile(r"OpenAI\s*\("),
        re.compile(r"client\.chat\.completions\.create"),
        re.compile(r"gpt-4|gpt-3\.5"),
    ],
    "langchain": [
        re.compile(r"from\s+langchain|import\s+langchain", re.IGNORECASE),
        re.compile(r"ChatAnthropic|ChatOpenAI|ChatGoogleGenerativeAI"),
        re.compile(r"LLMChain|AgentExecutor"),
    ],
    "google_genai": [
        re.compile(r"from\s+google\.generativeai|import\s+google\.generativeai", re.IGNORECASE),
        re.compile(r"genai\.GenerativeModel"),
        re.compile(r"gemini-\w+"),
    ],
    "crewai": [
        re.compile(r"from\s+crewai\s+import|import\s+crewai", re.IGNORECASE),
        re.compile(r"Agent\s*\(.*llm="),
        re.compile(r"Crew\s*\("),
    ],
    "openai_agents": [
        re.compile(r"from\s+agents\s+import|import\s+agents", re.IGNORECASE),
        re.compile(r"Agent\s*\(.*model="),
        re.compile(r"Runner\.run"),
    ],
    "claude_code": [
        re.compile(r"\.claude/|CLAUDE\.md|claude-plugin", re.IGNORECASE),
        re.compile(r"subagent|SubagentStop", re.IGNORECASE),
        re.compile(r"model.*opus|model.*sonnet|model.*haiku", re.IGNORECASE),
    ],
    "cursor": [
        re.compile(r"\.cursor/rules|\.cursorrules", re.IGNORECASE),
    ],
    "vercel_ai": [
        re.compile(r"from\s+['\"]ai['\"]|import.*from\s+['\"]ai['\"]"),
        re.compile(r"generateText|streamText|useChat"),
        re.compile(r"@ai-sdk/"),
    ],
}

# ── Model name patterns ─────────────────────────────────────────────────────

MODEL_PATTERNS: list[tuple[re.Pattern, str, str]] = [
    (re.compile(r"claude-opus-4[.-]\d"), "claude-opus-4-6", "anthropic"),
    (re.compile(r"claude-sonnet-4[.-]\d"), "claude-sonnet-4-6", "anthropic"),
    (re.compile(r"claude-haiku-4[.-]\d"), "claude-haiku-4-5", "anthropic"),
    (re.compile(r"claude-3[.-]5-sonnet"), "claude-3.5-sonnet", "anthropic"),
    (re.compile(r"claude-3[.-]5-haiku"), "claude-3.5-haiku", "anthropic"),
    (re.compile(r"gpt-4o(?!-mini)"), "gpt-4o", "openai"),
    (re.compile(r"gpt-4o-mini"), "gpt-4o-mini", "openai"),
    (re.compile(r"gpt-4-turbo"), "gpt-4-turbo", "openai"),
    (re.compile(r"o1-preview|o1-mini|o3-mini"), "o-series", "openai"),
    (re.compile(r"gemini-3[.-]1-flash-lite"), "gemini-3.1-flash-lite", "google"),
    (re.compile(r"gemini-2[.-]5-flash"), "gemini-2.5-flash", "google"),
    (re.compile(r"gemini-2[.-]5-pro"), "gemini-2.5-pro", "google"),
    (re.compile(r"deepseek-r1|deepseek-v3"), "deepseek", "deepseek"),
]

# ── Architecture patterns ────────────────────────────────────────────────────

ARCHITECTURE_PATTERNS: dict[str, list[re.Pattern]] = {
    "subagent": [
        re.compile(r"subagent|sub_agent|SubagentStop", re.IGNORECASE),
        re.compile(r"Agent\s*\(.*model=.*\).*Agent\s*\(.*model=", re.DOTALL),
        re.compile(r"spawn.*agent|launch.*agent", re.IGNORECASE),
    ],
    "chain_of_thought": [
        re.compile(r"chain|pipeline|step_\d|phase_\d", re.IGNORECASE),
        re.compile(r"thinking|reasoning|reflect", re.IGNORECASE),
    ],
    "tool_use": [
        re.compile(r"tools\s*=\s*\[|tool_choice", re.IGNORECASE),
        re.compile(r"function_call|tool_use|tool_result", re.IGNORECASE),
    ],
    "routing": [
        re.compile(r"router|route.*model|model.*select", re.IGNORECASE),
        re.compile(r"if.*model.*else|switch.*model", re.IGNORECASE),
    ],
    "advisor_existing": [
        re.compile(r"advisor|expert|consultant|review", re.IGNORECASE),
        re.compile(r"escalat|handoff|fallback.*model", re.IGNORECASE),
    ],
}

# ── File filtering ───────────────────────────────────────────────────────────

SCAN_EXTENSIONS = {
    ".py", ".ts", ".tsx", ".js", ".jsx", ".rs", ".go",
    ".java", ".kt", ".rb", ".md", ".json", ".yaml", ".yml",
    ".toml", ".sh", ".bash",
}

SKIP_DIRS = {
    "node_modules", ".git", "__pycache__", ".venv", "venv",
    "dist", "build", ".next", "target", ".cargo",
    ".claude/worktrees",
}

MAX_FILE_SIZE = 500_000  # 500KB


# ── Data types ───────────────────────────────────────────────────────────────

@dataclass
class LLMCallSite:
    file: str
    line: int
    provider: str
    pattern: str
    context: str  # surrounding code


@dataclass
class ModelReference:
    model: str
    provider: str
    file: str
    line: int


@dataclass
class ScanReport:
    project_path: str
    files_scanned: int = 0
    providers_detected: dict[str, list[LLMCallSite]] = field(default_factory=dict)
    models_referenced: list[ModelReference] = field(default_factory=list)
    architecture_signals: dict[str, list[str]] = field(default_factory=dict)
    integration_points: list[dict] = field(default_factory=list)

    @property
    def summary(self) -> str:
        lines = []
        lines.append("=" * 60)
        lines.append("ATTRITION CODEBASE SCAN — ADVISOR MODE INTEGRATION")
        lines.append("=" * 60)
        lines.append(f"Project: {self.project_path}")
        lines.append(f"Files scanned: {self.files_scanned}")
        lines.append("")

        # Providers
        lines.append("PROVIDERS DETECTED:")
        if not self.providers_detected:
            lines.append("  (none found)")
        for provider, sites in self.providers_detected.items():
            lines.append(f"  {provider}: {len(sites)} call sites")
            for site in sites[:3]:
                lines.append(f"    {site.file}:{site.line} — {site.pattern}")

        # Models
        lines.append("")
        lines.append("MODELS REFERENCED:")
        if not self.models_referenced:
            lines.append("  (none found)")
        seen = set()
        for ref in self.models_referenced:
            key = f"{ref.model}|{ref.provider}"
            if key not in seen:
                seen.add(key)
                lines.append(f"  {ref.model} ({ref.provider}) — {ref.file}:{ref.line}")

        # Architecture
        lines.append("")
        lines.append("ARCHITECTURE PATTERNS:")
        if not self.architecture_signals:
            lines.append("  single-model (no multi-model patterns detected)")
        for pattern, files in self.architecture_signals.items():
            lines.append(f"  {pattern}: {len(files)} signals")
            for f in files[:2]:
                lines.append(f"    {f}")

        # Integration points
        lines.append("")
        lines.append("RECOMMENDED ADVISOR MODE INTEGRATION:")
        if not self.integration_points:
            lines.append("  (run scan with more context)")
        for pt in self.integration_points:
            lines.append(f"  [{pt['priority']}] {pt['action']}")
            lines.append(f"    File: {pt['file']}")
            lines.append(f"    Why: {pt['reason']}")

        lines.append("")
        lines.append("=" * 60)
        return "\n".join(lines)

    def to_dict(self) -> dict:
        return {
            "project_path": self.project_path,
            "files_scanned": self.files_scanned,
            "providers": {
                p: [{"file": s.file, "line": s.line, "pattern": s.pattern} for s in sites]
                for p, sites in self.providers_detected.items()
            },
            "models": [
                {"model": r.model, "provider": r.provider, "file": r.file, "line": r.line}
                for r in self.models_referenced
            ],
            "architecture": {
                p: files for p, files in self.architecture_signals.items()
            },
            "integration_points": self.integration_points,
        }


# ── Scanner ──────────────────────────────────────────────────────────────────

def scan_codebase(
    project_path: str,
    max_files: int = 5000,
) -> ScanReport:
    """Scan a codebase for LLM integration points."""
    root = Path(project_path).resolve()
    report = ScanReport(project_path=str(root))
    files_processed = 0

    for dirpath, dirnames, filenames in os.walk(root):
        # Skip excluded directories
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]

        for fname in filenames:
            if files_processed >= max_files:
                break

            ext = Path(fname).suffix.lower()
            if ext not in SCAN_EXTENSIONS:
                continue

            fpath = Path(dirpath) / fname
            if fpath.stat().st_size > MAX_FILE_SIZE:
                continue

            try:
                content = fpath.read_text(encoding="utf-8", errors="ignore")
            except (OSError, UnicodeDecodeError):
                continue

            rel_path = str(fpath.relative_to(root))
            lines = content.split("\n")
            files_processed += 1

            # Detect providers
            for provider, patterns in PROVIDER_PATTERNS.items():
                for pattern in patterns:
                    for i, line in enumerate(lines):
                        if pattern.search(line):
                            site = LLMCallSite(
                                file=rel_path,
                                line=i + 1,
                                provider=provider,
                                pattern=pattern.pattern[:60],
                                context=line.strip()[:120],
                            )
                            report.providers_detected.setdefault(provider, []).append(site)

            # Detect model references
            for model_pat, model_name, model_provider in MODEL_PATTERNS:
                for i, line in enumerate(lines):
                    if model_pat.search(line):
                        report.models_referenced.append(ModelReference(
                            model=model_name,
                            provider=model_provider,
                            file=rel_path,
                            line=i + 1,
                        ))

            # Detect architecture patterns
            for arch, patterns in ARCHITECTURE_PATTERNS.items():
                for pattern in patterns:
                    if pattern.search(content):
                        report.architecture_signals.setdefault(arch, []).append(rel_path)
                        break  # One signal per file per pattern

    report.files_scanned = files_processed

    # Generate integration recommendations
    report.integration_points = _recommend_integration(report)

    return report


def _recommend_integration(report: ScanReport) -> list[dict]:
    """Generate integration recommendations based on scan results."""
    points = []
    providers = report.providers_detected
    models = report.models_referenced
    arch = report.architecture_signals

    # Determine the main LLM call file
    all_sites = []
    for sites in providers.values():
        all_sites.extend(sites)

    if not all_sites:
        points.append({
            "priority": "P0",
            "action": "No LLM calls detected. Add attrition.track() to your main entry point.",
            "file": "main.py or index.ts",
            "reason": "Scanner found no LLM provider imports. Either the code uses a custom client or files were outside scan scope.",
        })
        return points

    # Group by file to find the main LLM integration files (only code files)
    code_exts = {".py", ".ts", ".tsx", ".js", ".jsx", ".rs", ".go", ".java", ".kt", ".rb"}
    file_counts: dict[str, int] = {}
    for site in all_sites:
        ext = Path(site.file).suffix.lower()
        if ext in code_exts:
            file_counts[site.file] = file_counts.get(site.file, 0) + 1

    top_files = sorted(file_counts.items(), key=lambda x: -x[1])[:5]

    # P0: Add attrition tracking to the main LLM call file
    main_file = top_files[0][0] if top_files else "unknown"
    points.append({
        "priority": "P0",
        "action": f"Add `from attrition.advisor import AdvisorTracker` to {main_file}",
        "file": main_file,
        "reason": f"This file has {top_files[0][1] if top_files else 0} LLM call sites — the primary integration point.",
    })

    # Check for multi-model usage (already has advisor potential)
    unique_models = list(set(m.model for m in models))
    if len(unique_models) >= 2:
        # Find the expensive model (advisor) and cheap model (executor)
        expensive = [m for m in unique_models if "opus" in m or "gpt-4o" in m.replace("mini", "") or "pro" in m]
        cheap = [m for m in unique_models if m not in expensive]

        if expensive and cheap:
            points.append({
                "priority": "P1",
                "action": f"Tag '{cheap[0]}' calls as executor, '{expensive[0]}' calls as advisor",
                "file": main_file,
                "reason": f"You already use {len(unique_models)} models. The advisor pattern maps directly to your existing architecture.",
            })
        else:
            points.append({
                "priority": "P1",
                "action": f"Consider adding a cheaper model as executor alongside {unique_models[0]}",
                "file": main_file,
                "reason": "Multi-model detected but no clear cheap/expensive split. Adding a cost tier saves money.",
            })
    else:
        model_name = unique_models[0] if unique_models else "your model"
        points.append({
            "priority": "P1",
            "action": f"Add a cheaper executor model. Use {model_name} only as advisor for complex tasks.",
            "file": main_file,
            "reason": "Single-model architecture. The advisor pattern saves 60-80% by routing routine tasks to a cheaper model.",
        })

    # Check for existing subagent/routing patterns
    if "subagent" in arch:
        points.append({
            "priority": "P2",
            "action": "Wire SubagentStop events to attrition advisor tracking",
            "file": arch["subagent"][0],
            "reason": "Existing subagent pattern detected. Each subagent completion is a natural advisor event.",
        })

    if "routing" in arch:
        points.append({
            "priority": "P2",
            "action": "Add cost tracking to your model router",
            "file": arch["routing"][0],
            "reason": "Model routing detected. Instrument each routing decision to measure advisor effectiveness.",
        })

    if "tool_use" in arch:
        points.append({
            "priority": "P3",
            "action": "Track tool call costs separately from reasoning costs",
            "file": arch["tool_use"][0] if arch["tool_use"] else main_file,
            "reason": "Tool use detected. Separating tool dispatch (cheap) from reasoning (expensive) optimizes advisor targeting.",
        })

    return points


# ── CLI entry point ──────────────────────────────────────────────────────────

def main():
    import sys
    import argparse

    parser = argparse.ArgumentParser(description="Scan codebase for LLM integration points")
    parser.add_argument("path", nargs="?", default=".", help="Project directory to scan")
    parser.add_argument("--json", nargs="?", const="-", help="JSON output")
    parser.add_argument("--max-files", type=int, default=5000, help="Max files to scan")
    args = parser.parse_args()

    report = scan_codebase(args.path, max_files=args.max_files)

    if args.json is not None:
        output = json.dumps(report.to_dict(), indent=2)
        if args.json == "-":
            print(output)
        else:
            Path(args.json).write_text(output, encoding="utf-8")
            print(f"Written to {args.json}", file=sys.stderr)
    else:
        print(report.summary)


if __name__ == "__main__":
    main()
