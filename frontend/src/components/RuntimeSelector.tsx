/**
 * RuntimeSelector — dropdown that lets the user pick which driver
 * runtime + model drives the attrition-agent. Value is persisted to
 * localStorage so the Architect and Builder surfaces stay in sync.
 */

import { useEffect, useState } from "react";
import {
  loadRuntimeSelection,
  saveRuntimeSelection,
  RUNTIME_CATALOG,
  runtimeById,
  type RuntimeId,
  type RuntimeSelection,
} from "../lib/runtime_selector";

export function RuntimeSelector({
  onChange,
}: {
  onChange?: (sel: RuntimeSelection) => void;
}) {
  const [sel, setSel] = useState<RuntimeSelection>(() => loadRuntimeSelection());
  const opt = runtimeById(sel.runtime);

  useEffect(() => {
    saveRuntimeSelection(sel);
    onChange?.(sel);
  }, [sel, onChange]);

  return (
    <section
      aria-label="Driver runtime selector"
      style={{
        margin: "0 0 14px",
        padding: "12px 14px",
        background: "rgba(217,119,87,0.04)",
        border: "1px solid rgba(217,119,87,0.25)",
        borderRadius: 10,
      }}
    >
      <div
        style={{
          fontSize: 10,
          letterSpacing: "0.22em",
          textTransform: "uppercase",
          color: "#d97757",
          marginBottom: 8,
        }}
      >
        Drive this attrition session with
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(200px, 1.2fr) minmax(160px, 1fr)",
          gap: 10,
          marginBottom: 8,
        }}
      >
        <select
          value={sel.runtime}
          onChange={(e) => {
            const id = e.target.value as RuntimeId;
            const next = runtimeById(id);
            if (!next) return;
            setSel({ runtime: id, model: next.defaultModel });
          }}
          style={selectStyle()}
          aria-label="Runtime"
        >
          {RUNTIME_CATALOG.map((r) => (
            <option key={r.id} value={r.id}>
              {r.label}
            </option>
          ))}
        </select>
        <select
          value={sel.model}
          onChange={(e) => setSel((s) => ({ ...s, model: e.target.value }))}
          style={selectStyle()}
          aria-label="Model"
        >
          {opt?.models.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </div>
      {opt ? (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
            gap: 8,
            fontSize: 11,
            fontFamily: "'JetBrains Mono', monospace",
          }}
        >
          <Info label="provider" value={opt.provider} />
          <Info
            label="price in / out"
            value={`$${opt.pricePerMillionIn.toFixed(2)} / $${opt.pricePerMillionOut.toFixed(2)} / 1M tok`}
          />
          <Info label="needs env" value={opt.requiresEnv} />
        </div>
      ) : null}
      <p
        style={{
          margin: "8px 0 0",
          fontSize: 11,
          color: "rgba(255,255,255,0.6)",
          lineHeight: 1.5,
        }}
      >
        {opt?.note ?? ""}
      </p>
    </section>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        padding: "6px 8px",
        background: "rgba(0,0,0,0.3)",
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: 6,
      }}
    >
      <div
        style={{
          fontSize: 9,
          letterSpacing: "0.14em",
          textTransform: "uppercase",
          color: "rgba(255,255,255,0.5)",
          marginBottom: 2,
        }}
      >
        {label}
      </div>
      <div style={{ color: "rgba(255,255,255,0.88)" }}>{value}</div>
    </div>
  );
}

function selectStyle(): React.CSSProperties {
  return {
    padding: "8px 10px",
    background: "rgba(0,0,0,0.25)",
    border: "1px solid rgba(255,255,255,0.12)",
    borderRadius: 6,
    color: "rgba(255,255,255,0.92)",
    fontSize: 13,
    fontFamily: "inherit",
    cursor: "pointer",
  };
}
