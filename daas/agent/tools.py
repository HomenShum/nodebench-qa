"""The attrition-agent's toolbox.

The agent uses these tools — exposed identically to every runtime
adapter — to build scaffolds. Runtime adapters translate ``Tool`` into
their native format (``FunctionDeclaration`` for Gemini, ``@tool`` for
Claude Agent SDK, ``@function_tool`` for OpenAI Agents SDK, plain
function nodes for LangGraph).

Tool invocations are sandboxed to a per-session workspace so one
session can't read or write another session's files.
"""

from __future__ import annotations

import ast
import json
import os
import re
import shutil
import subprocess
import tempfile
import time
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from daas.agent.base import Tool


# ---------------------------------------------------------------------
# Workspace — the agent writes every file into a per-session tmp dir.
# Path traversal is blocked; only paths strictly inside the workspace
# are allowed.
# ---------------------------------------------------------------------
@dataclass
class Workspace:
    root: Path
    files: dict[str, str] = field(default_factory=dict)  # rel_path -> content

    @classmethod
    def new(cls, prefix: str = "attrition_agent_") -> "Workspace":
        return cls(root=Path(tempfile.mkdtemp(prefix=prefix)))

    def resolve(self, rel_path: str) -> Path:
        target = (self.root / rel_path).resolve()
        root_resolved = self.root.resolve()
        if not str(target).startswith(str(root_resolved)):
            raise PermissionError(f"path escapes workspace: {rel_path!r}")
        return target

    def write(self, rel_path: str, content: str) -> int:
        target = self.resolve(rel_path)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content, encoding="utf-8")
        self.files[rel_path] = content
        return len(content)

    def read(self, rel_path: str) -> str:
        target = self.resolve(rel_path)
        return target.read_text(encoding="utf-8")

    def list(self) -> list[str]:
        out: list[str] = []
        for p in sorted(self.root.rglob("*")):
            if p.is_file():
                out.append(str(p.relative_to(self.root)))
        return out

    def cleanup(self) -> None:
        shutil.rmtree(self.root, ignore_errors=True)


# ---------------------------------------------------------------------
# Individual tool handlers. Each returns a small JSON-serializable
# dict so the adapter can feed results back to the model.
# ---------------------------------------------------------------------
def _write_file(ws: Workspace) -> Tool:
    def handler(args: dict) -> dict[str, Any]:
        path = str(args.get("path", "")).strip()
        content = str(args.get("content", ""))
        if not path:
            return {"ok": False, "error": "path required"}
        bytes_written = ws.write(path, content)
        return {"ok": True, "path": path, "bytes": bytes_written}

    return Tool(
        name="write_file",
        description=(
            "Create or overwrite a file in the session workspace with the "
            "given content. Use for emitting scaffold files (runner.py, "
            "tools.py, etc)."
        ),
        parameters_schema={
            "type": "object",
            "properties": {
                "path": {"type": "string", "description": "Relative path inside the workspace"},
                "content": {"type": "string"},
            },
            "required": ["path", "content"],
        },
        handler=handler,
    )


def _edit_file(ws: Workspace) -> Tool:
    def handler(args: dict) -> dict[str, Any]:
        path = str(args.get("path", "")).strip()
        old = str(args.get("old_string", ""))
        new = str(args.get("new_string", ""))
        if not path or not old:
            return {"ok": False, "error": "path and old_string required"}
        try:
            content = ws.read(path)
        except FileNotFoundError:
            return {"ok": False, "error": f"file not found: {path}"}
        if old not in content:
            return {"ok": False, "error": "old_string not in file"}
        updated = content.replace(old, new, 1)
        ws.write(path, updated)
        return {"ok": True, "path": path, "replacement_count": 1}

    return Tool(
        name="edit_file",
        description="Replace first occurrence of old_string with new_string in the named file.",
        parameters_schema={
            "type": "object",
            "properties": {
                "path": {"type": "string"},
                "old_string": {"type": "string"},
                "new_string": {"type": "string"},
            },
            "required": ["path", "old_string", "new_string"],
        },
        handler=handler,
    )


def _read_file(ws: Workspace) -> Tool:
    def handler(args: dict) -> dict[str, Any]:
        path = str(args.get("path", "")).strip()
        if not path:
            return {"ok": False, "error": "path required"}
        try:
            return {"ok": True, "path": path, "content": ws.read(path)}
        except FileNotFoundError:
            return {"ok": False, "error": f"file not found: {path}"}

    return Tool(
        name="read_file",
        description="Return the contents of a file previously written into the workspace.",
        parameters_schema={
            "type": "object",
            "properties": {"path": {"type": "string"}},
            "required": ["path"],
        },
        handler=handler,
    )


def _list_files(ws: Workspace) -> Tool:
    def handler(_args: dict) -> dict[str, Any]:
        return {"ok": True, "files": ws.list()}

    return Tool(
        name="list_files",
        description="List every file currently in the session workspace.",
        parameters_schema={"type": "object", "properties": {}},
        handler=handler,
    )


def _ast_parse_check(ws: Workspace) -> Tool:
    def handler(args: dict) -> dict[str, Any]:
        path = str(args.get("path", "")).strip()
        if not path or not path.endswith(".py"):
            return {"ok": False, "error": "expected a .py path"}
        try:
            content = ws.read(path)
        except FileNotFoundError:
            return {"ok": False, "error": f"file not found: {path}"}
        try:
            ast.parse(content)
        except SyntaxError as e:
            return {"ok": False, "error": f"SyntaxError at line {e.lineno}: {e.msg}"}
        return {"ok": True, "path": path, "lines": content.count("\n") + 1}

    return Tool(
        name="ast_parse_check",
        description="Validate that a .py file in the workspace parses cleanly.",
        parameters_schema={
            "type": "object",
            "properties": {"path": {"type": "string"}},
            "required": ["path"],
        },
        handler=handler,
    )


def _run_shell(ws: Workspace, *, allowlist: tuple[str, ...]) -> Tool:
    def handler(args: dict) -> dict[str, Any]:
        cmd = str(args.get("command", "")).strip()
        if not cmd:
            return {"ok": False, "error": "command required"}
        # Whitelisted prefixes only — keep the agent bounded
        head = cmd.split()[0] if cmd.split() else ""
        if head not in allowlist:
            return {
                "ok": False,
                "error": f"command {head!r} not allowed; allowlist: {list(allowlist)}",
            }
        try:
            result = subprocess.run(
                cmd,
                cwd=str(ws.root),
                shell=True,
                capture_output=True,
                text=True,
                timeout=30,
            )
        except subprocess.TimeoutExpired:
            return {"ok": False, "error": "timed out after 30 s"}
        return {
            "ok": result.returncode == 0,
            "stdout": result.stdout[-4000:],
            "stderr": result.stderr[-4000:],
            "exit_code": result.returncode,
        }

    return Tool(
        name="run_shell",
        description=(
            "Run a whitelisted shell command inside the workspace. "
            "Allowlist: python, pytest, ruff, mypy."
        ),
        parameters_schema={
            "type": "object",
            "properties": {"command": {"type": "string"}},
            "required": ["command"],
        },
        handler=handler,
    )


def _search_web() -> Tool:
    def handler(args: dict) -> dict[str, Any]:
        query = str(args.get("query", "")).strip()
        if not query:
            return {"ok": False, "error": "query required"}
        # Minimal DuckDuckGo-HTML scrape fallback (stdlib only). If
        # OPENROUTER_SEARCH_API or similar env is set we'd wire it here.
        url = f"https://duckduckgo.com/html/?q={urllib.request.quote(query)}"
        req = urllib.request.Request(url, headers={"User-Agent": "attrition-agent/1.0"})
        try:
            with urllib.request.urlopen(req, timeout=10) as r:
                html = r.read().decode("utf-8", errors="replace")
        except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError) as e:
            return {"ok": False, "error": f"fetch failed: {e}"}
        # Extract first 5 result titles + URLs
        pattern = re.compile(
            r'<a[^>]+class="result__a"[^>]+href="(?P<url>[^"]+)"[^>]*>(?P<title>[^<]+)</a>',
            re.DOTALL,
        )
        hits = []
        for m in pattern.finditer(html):
            hits.append({"title": re.sub(r"\s+", " ", m.group("title")).strip(), "url": m.group("url")})
            if len(hits) >= 5:
                break
        return {"ok": True, "query": query, "results": hits}

    return Tool(
        name="search_web",
        description="Search the web and return up to 5 ranked title + URL pairs.",
        parameters_schema={
            "type": "object",
            "properties": {"query": {"type": "string"}},
            "required": ["query"],
        },
        handler=handler,
    )


def _emit_done(ws: Workspace) -> Tool:
    def handler(args: dict) -> dict[str, Any]:
        summary = str(args.get("summary", "")).strip()
        return {
            "ok": True,
            "summary": summary,
            "file_count": len(ws.files),
            "files": ws.list(),
        }

    return Tool(
        name="emit_done",
        description=(
            "Signal that the scaffold is complete. The agent loop halts "
            "after this tool returns. Include a short summary of the "
            "generated bundle."
        ),
        parameters_schema={
            "type": "object",
            "properties": {"summary": {"type": "string"}},
            "required": ["summary"],
        },
        handler=handler,
    )


# ---------------------------------------------------------------------
# Assemble the standard build toolset. Skills can reference these
# tool names exactly.
# ---------------------------------------------------------------------
def BUILD_TOOL_SET(ws: Workspace | None = None) -> list[Tool]:
    if ws is None:
        ws = Workspace.new()
    return [
        _write_file(ws),
        _edit_file(ws),
        _read_file(ws),
        _list_files(ws),
        _ast_parse_check(ws),
        _run_shell(ws, allowlist=("python", "pytest", "ruff", "mypy")),
        _search_web(),
        _emit_done(ws),
    ]


__all__ = ["BUILD_TOOL_SET", "Workspace"]
