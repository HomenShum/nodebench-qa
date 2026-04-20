/**
 * TraceDropzone — drag-and-drop trace upload for the Architect page.
 *
 * Accepts .jsonl / .json / .txt / .log. All parsing is in-browser via
 * src/lib/normalize_trace.ts — trace contents never leave the browser
 * from this component. The parent receives a ``TraceSummary`` and can
 * choose to push only the ``brief`` string to the classifier.
 */

import { useCallback, useRef, useState } from "react";
import {
  FORMAT_LABEL,
  normalizeTrace,
  type TraceSummary,
} from "../lib/normalize_trace";

type Props = {
  onSummary: (summary: TraceSummary, rawFilename: string) => void;
};

const ACCEPT = ".jsonl,.json,.txt,.log,application/json,text/plain";
const MAX_BYTES = 50 * 1024 * 1024; // 50 MB guard

export function TraceDropzone({ onSummary }: Props) {
  const [dragging, setDragging] = useState(false);
  const [preview, setPreview] = useState<TraceSummary | null>(null);
  const [filename, setFilename] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const fileInput = useRef<HTMLInputElement | null>(null);

  const handleFile = useCallback(
    async (file: File) => {
      setError("");
      if (file.size > MAX_BYTES) {
        setError(
          `File too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Max 50 MB — paste a representative slice instead.`,
        );
        return;
      }
      setLoading(true);
      try {
        const text = await file.text();
        const summary = normalizeTrace(text, file.name);
        setPreview(summary);
        setFilename(file.name);
        onSummary(summary, file.name);
      } catch (e) {
        setError(
          `Couldn't parse ${file.name}: ${(e as Error).message ?? String(e)}`,
        );
      } finally {
        setLoading(false);
      }
    },
    [onSummary],
  );

  const onDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setDragging(false);
      const f = e.dataTransfer.files?.[0];
      if (f) void handleFile(f);
    },
    [handleFile],
  );

  const baseBorder = dragging
    ? "1px dashed #d97757"
    : "1px dashed rgba(255,255,255,0.2)";
  const baseBg = dragging
    ? "rgba(217,119,87,0.08)"
    : "rgba(255,255,255,0.02)";

  return (
    <div style={{ marginTop: 10 }}>
      <div
        role="button"
        tabIndex={0}
        aria-label="Upload agent trace file"
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => fileInput.current?.click()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            fileInput.current?.click();
          }
        }}
        style={{
          padding: "14px 16px",
          border: baseBorder,
          background: baseBg,
          borderRadius: 10,
          cursor: "pointer",
          transition: "background 120ms, border-color 120ms",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            fontSize: 13,
            color: "rgba(255,255,255,0.75)",
          }}
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
          <span>
            <strong style={{ color: "#fff" }}>
              {loading ? "Parsing…" : "Drop a trace file here"}
            </strong>{" "}
            or click to browse —{" "}
            <code style={{ fontSize: 12 }}>.jsonl</code> /{" "}
            <code style={{ fontSize: 12 }}>.json</code>. Claude Code · OpenAI
            Agents · Gemini · LangChain · LangSmith auto-detected. Parsed in
            your browser — contents never uploaded.
          </span>
        </div>
        <input
          ref={fileInput}
          type="file"
          accept={ACCEPT}
          style={{ display: "none" }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void handleFile(f);
          }}
        />
      </div>

      {error ? (
        <div
          role="alert"
          style={{
            marginTop: 8,
            padding: "8px 12px",
            background: "rgba(239,68,68,0.08)",
            border: "1px solid rgba(239,68,68,0.3)",
            borderRadius: 8,
            color: "#fca5a5",
            fontSize: 12,
          }}
        >
          {error}
        </div>
      ) : null}

      {preview && !error ? (
        <div
          style={{
            marginTop: 10,
            padding: "12px 14px",
            background: "rgba(34,197,94,0.04)",
            border: "1px solid rgba(34,197,94,0.3)",
            borderRadius: 10,
          }}
        >
          <div
            style={{
              fontSize: 10,
              letterSpacing: "0.16em",
              textTransform: "uppercase",
              color: "#22c55e",
              marginBottom: 6,
            }}
          >
            Trace parsed · {filename}
          </div>
          <div
            style={{
              fontSize: 12.5,
              color: "rgba(255,255,255,0.9)",
              marginBottom: 4,
              fontWeight: 500,
            }}
          >
            {FORMAT_LABEL[preview.format]}
            {preview.sourceModel && preview.sourceModel !== "unknown" ? (
              <>
                {" · "}
                <code style={{ fontSize: 11, fontFamily: "'JetBrains Mono', monospace" }}>
                  {preview.sourceModel}
                </code>
              </>
            ) : null}
          </div>
          <div
            style={{
              fontSize: 11.5,
              color: "rgba(255,255,255,0.7)",
              fontFamily: "'JetBrains Mono', monospace",
              marginBottom: preview.uniqueTools.length ? 8 : 0,
            }}
          >
            {preview.stepCount} steps · {preview.toolCount} tool calls ·{" "}
            {preview.uniqueTools.length} unique tool{preview.uniqueTools.length === 1 ? "" : "s"}
          </div>
          {preview.uniqueTools.length > 0 ? (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 8 }}>
              {preview.uniqueTools.slice(0, 12).map((t) => (
                <span
                  key={t}
                  style={{
                    padding: "2px 6px",
                    background: "rgba(0,0,0,0.3)",
                    border: "1px solid rgba(255,255,255,0.08)",
                    borderRadius: 4,
                    color: "rgba(255,255,255,0.8)",
                    fontSize: 10.5,
                    fontFamily: "'JetBrains Mono', monospace",
                  }}
                >
                  {t}
                </span>
              ))}
              {preview.uniqueTools.length > 12 ? (
                <span style={{ fontSize: 10.5, color: "rgba(255,255,255,0.5)" }}>
                  +{preview.uniqueTools.length - 12} more
                </span>
              ) : null}
            </div>
          ) : null}
          <div
            style={{
              fontSize: 11.5,
              color: "rgba(255,255,255,0.55)",
              lineHeight: 1.5,
            }}
          >
            A concise brief has been prefilled in the prompt below. The raw
            trace stays in your browser — only the brief goes to the
            classifier when you submit.
          </div>
        </div>
      ) : null}
    </div>
  );
}
