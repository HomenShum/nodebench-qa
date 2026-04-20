"""Generated-code artifact bundle — what an emitter returns.

A bundle is a list of {path, content, language} files. The Convex
side stores the bundle as a single JSON blob on
``daasGeneratedArtifacts``. The Builder Scaffold tab renders it as a
file tree with syntax-highlighted previews.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any


@dataclass(frozen=True)
class ArtifactFile:
    path: str                    # e.g. "chain/runner.py"
    content: str                 # the file body as a string
    language: str = "python"     # "python" | "typescript" | "yaml" | "json" | "markdown"


@dataclass
class ArtifactBundle:
    runtime_lane: str
    target_model: str
    files: list[ArtifactFile] = field(default_factory=list)

    def add(self, path: str, content: str, language: str = "python") -> None:
        self.files.append(ArtifactFile(path=path, content=content, language=language))

    @property
    def total_bytes(self) -> int:
        return sum(len(f.content.encode("utf-8")) for f in self.files)

    def to_json(self) -> str:
        return json.dumps(
            {
                "runtime_lane": self.runtime_lane,
                "target_model": self.target_model,
                "files": [
                    {"path": f.path, "content": f.content, "language": f.language}
                    for f in self.files
                ],
            },
            ensure_ascii=False,
        )

    @classmethod
    def from_json(cls, s: str) -> ArtifactBundle:
        data: dict[str, Any] = json.loads(s)
        bundle = cls(
            runtime_lane=str(data.get("runtime_lane", "")),
            target_model=str(data.get("target_model", "")),
        )
        for f in data.get("files", []):
            bundle.add(
                path=str(f.get("path", "")),
                content=str(f.get("content", "")),
                language=str(f.get("language", "python")),
            )
        return bundle
