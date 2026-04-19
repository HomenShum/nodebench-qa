#!/usr/bin/env python3
"""Generate visual HTML report from experiment results."""

import json
import html
from pathlib import Path
from statistics import mean

RESULTS_DIR = Path(__file__).parent / "results"


def load_data():
    runs = json.loads((RESULTS_DIR / "raw_responses.json").read_text(encoding="utf-8"))
    judgments = json.loads((RESULTS_DIR / "judgments.json").read_text(encoding="utf-8"))
    # Index judgments by case_id
    judg_idx = {j["case_id"]: j for j in judgments}
    return runs, judg_idx


def markdown_to_html(text: str) -> str:
    """Very simple markdown-ish rendering preserving structure."""
    import re
    s = html.escape(text)
    # headers
    s = re.sub(r"^### (.+)$", r"<h4>\1</h4>", s, flags=re.M)
    s = re.sub(r"^## (.+)$", r"<h3>\1</h3>", s, flags=re.M)
    s = re.sub(r"^# (.+)$", r"<h3>\1</h3>", s, flags=re.M)
    # bold
    s = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", s)
    # inline code
    s = re.sub(r"`([^`]+)`", r"<code>\1</code>", s)
    # numbered lists
    s = re.sub(r"^(\d+)\. (.+)$", r"<div class='listitem'><span class='lnum'>\1.</span> \2</div>", s, flags=re.M)
    # bullet lists
    s = re.sub(r"^[-\*] (.+)$", r"<div class='bullet'>• \1</div>", s, flags=re.M)
    # paragraphs
    s = s.replace("\n\n", "</p><p>")
    return f"<p>{s}</p>"


def score_bar(score: float, max_score: int = 10, color: str = "#22c55e") -> str:
    pct = (score / max_score) * 100
    return f"""<div class="bar-wrap"><div class="bar-fill" style="width:{pct}%; background:{color};"></div><div class="bar-label">{score}/{max_score}</div></div>"""


def verdict_badge(verdict: str) -> str:
    colors = {"pass": "#22c55e", "partial": "#f59e0b", "fail": "#ef4444"}
    color = colors.get(verdict, "#9a9590")
    return f'<span class="badge" style="background:{color}20;color:{color};border:1px solid {color}40">{verdict.upper()}</span>'


def build_report(runs, judg_idx) -> str:
    # ─── Aggregate stats ───
    aggregates = {"flash_alone": [], "pro_alone": [], "flash_plus_skill": []}
    costs = {"flash_alone": [], "pro_alone": [], "flash_plus_skill": []}
    tokens = {"flash_alone": [], "pro_alone": [], "flash_plus_skill": []}
    distill_cost = []

    for run in runs:
        j = judg_idx.get(run["case_id"], {})
        for config in aggregates:
            score = j.get(config, {}).get("overall_score", 0)
            try:
                aggregates[config].append(float(score))
            except (TypeError, ValueError):
                aggregates[config].append(0.0)
            costs[config].append(run[config]["cost_usd"])
            tokens[config].append(run[config]["total_tokens"])
        distill_cost.append(run["distilled_skill"]["cost_usd"])

    avg_score = {k: mean(v) if v else 0 for k, v in aggregates.items()}
    avg_cost = {k: mean(v) if v else 0 for k, v in costs.items()}
    total_cost = {k: sum(v) for k, v in costs.items()}
    total_tokens = {k: sum(v) for k, v in tokens.items()}

    # Quality retention: how much of Pro's quality does Flash+skill recover?
    quality_retention = (avg_score["flash_plus_skill"] / avg_score["pro_alone"]) * 100 if avg_score["pro_alone"] else 0
    cost_fraction = (avg_cost["flash_plus_skill"] / avg_cost["pro_alone"]) * 100 if avg_cost["pro_alone"] else 0
    uplift_over_flash = avg_score["flash_plus_skill"] - avg_score["flash_alone"]

    # ─── Verdict ───
    if quality_retention >= 80 and cost_fraction < 40:
        verdict = "WEDGE CONFIRMED"
        verdict_color = "#22c55e"
    elif quality_retention >= 60 and cost_fraction < 60:
        verdict = "PARTIAL — needs more data"
        verdict_color = "#f59e0b"
    else:
        verdict = "WEDGE REJECTED"
        verdict_color = "#ef4444"

    # ─── HTML ───
    html_parts = []
    html_parts.append("""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Scaffolding Wedge Experiment — attrition.sh</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Inter', sans-serif; background: #0a0a0a; color: #e8e6e3; margin: 0; padding: 2rem; line-height: 1.5; }
  .container { max-width: 1200px; margin: 0 auto; }
  h1 { font-size: 2rem; margin-bottom: 0.5rem; letter-spacing: -0.02em; }
  h2 { font-size: 1.25rem; margin-top: 2rem; margin-bottom: 0.75rem; letter-spacing: -0.01em; color: #f5f5f4; }
  h3 { font-size: 1rem; color: #d97757; margin-top: 1rem; }
  h4 { font-size: 0.875rem; color: #e8e6e3; margin: 0.5rem 0; }
  .sub { color: #9a9590; font-size: 0.875rem; }
  .card { background: #151413; border: 1px solid rgba(255,255,255,0.08); border-radius: 12px; padding: 1.5rem; margin-bottom: 1rem; }
  .verdict-card { background: linear-gradient(135deg, rgba(255,255,255,0.02), rgba(255,255,255,0.05)); border: 2px solid; padding: 2rem; text-align: center; }
  .verdict-label { font-size: 2.5rem; font-weight: 700; letter-spacing: -0.03em; }
  .verdict-metrics { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1rem; margin-top: 1.5rem; }
  .metric { background: rgba(255,255,255,0.03); padding: 1rem; border-radius: 8px; }
  .metric-label { font-size: 0.625rem; text-transform: uppercase; letter-spacing: 0.12em; color: #9a9590; margin-bottom: 0.25rem; }
  .metric-value { font-size: 1.75rem; font-weight: 700; font-family: 'JetBrains Mono', monospace; }
  .row { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 1rem; }
  .col { background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.06); border-radius: 8px; padding: 1rem; min-width: 0; }
  .col-flash-alone { border-left: 3px solid #60a5fa; }
  .col-pro-alone { border-left: 3px solid #f59e0b; }
  .col-flash-plus-skill { border-left: 3px solid #22c55e; }
  .col-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.75rem; }
  .col-title { font-weight: 600; font-size: 0.8125rem; }
  .col-cost { font-family: 'JetBrains Mono', monospace; font-size: 0.75rem; color: #9a9590; }
  .response { background: #0a0a0a; border: 1px solid rgba(255,255,255,0.04); border-radius: 6px; padding: 0.75rem; font-size: 0.75rem; max-height: 400px; overflow-y: auto; line-height: 1.5; }
  .response p { margin: 0.25rem 0; }
  .response h3 { font-size: 0.8125rem; color: #d97757; margin-top: 0.5rem; }
  .response h4 { font-size: 0.75rem; margin: 0.25rem 0; }
  .response code { background: rgba(255,255,255,0.05); padding: 1px 4px; border-radius: 3px; font-size: 0.6875rem; }
  .response .listitem { margin: 0.125rem 0; padding-left: 0.5rem; }
  .response .listitem .lnum { color: #d97757; font-weight: 600; margin-right: 0.25rem; }
  .response .bullet { margin: 0.125rem 0 0.125rem 0.5rem; }
  .score-grid { display: grid; grid-template-columns: auto 1fr auto; gap: 0.5rem; font-size: 0.75rem; margin-top: 0.75rem; }
  .score-label { color: #9a9590; }
  .bar-wrap { background: rgba(255,255,255,0.05); border-radius: 4px; height: 16px; position: relative; overflow: hidden; }
  .bar-fill { height: 100%; transition: width 0.3s; }
  .bar-label { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); font-size: 0.625rem; font-family: 'JetBrains Mono', monospace; color: #fff; mix-blend-mode: difference; }
  .badge { padding: 2px 8px; border-radius: 4px; font-size: 0.6875rem; font-weight: 600; font-family: 'JetBrains Mono', monospace; }
  .skill-box { background: rgba(217, 119, 87, 0.05); border: 1px dashed rgba(217, 119, 87, 0.3); border-radius: 8px; padding: 1rem; margin: 1rem 0; font-family: 'JetBrains Mono', monospace; font-size: 0.75rem; max-height: 250px; overflow-y: auto; line-height: 1.5; }
  .chart-row { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1rem; margin: 1rem 0; }
  .chart-box { background: rgba(255,255,255,0.02); padding: 1rem; border-radius: 8px; }
  .bar-group { display: grid; grid-template-columns: 140px 1fr; gap: 0.5rem; align-items: center; margin: 0.375rem 0; font-size: 0.75rem; }
  .bar-group-label { color: #9a9590; text-align: right; }
  .footer { text-align: center; color: #5d5854; font-size: 0.6875rem; margin-top: 3rem; padding-top: 1rem; border-top: 1px solid rgba(255,255,255,0.04); }
  code.mono { font-family: 'JetBrains Mono', monospace; background: rgba(255,255,255,0.05); padding: 2px 6px; border-radius: 4px; }
  .refs-row { display: flex; gap: 0.25rem; flex-wrap: wrap; margin: 0.25rem 0; font-size: 0.625rem; font-family: 'JetBrains Mono', monospace; }
  .ref-chip { padding: 1px 6px; border-radius: 3px; }
  .ref-found { background: rgba(34,197,94,0.12); color: #22c55e; }
  .ref-missing { background: rgba(239,68,68,0.12); color: #ef4444; }
</style>
</head>
<body>
<div class="container">
""")

    # ─── Header ───
    html_parts.append(f"""
<h1>Scaffolding Wedge Experiment</h1>
<p class="sub">attrition.sh research arm — can distilled reasoning transfer from Pro to Flash?</p>

<div class="card verdict-card" style="border-color: {verdict_color};">
  <div class="verdict-label" style="color: {verdict_color};">{verdict}</div>
  <p class="sub">3 queries × 3 configurations × Pro judge with structured rubric</p>
  <div class="verdict-metrics">
    <div class="metric">
      <div class="metric-label">Quality Retention</div>
      <div class="metric-value" style="color:{verdict_color}">{quality_retention:.1f}%</div>
      <div class="sub">(Flash+skill quality ÷ Pro quality)</div>
    </div>
    <div class="metric">
      <div class="metric-label">Cost Fraction</div>
      <div class="metric-value" style="color:#60a5fa">{cost_fraction:.1f}%</div>
      <div class="sub">(Flash+skill cost ÷ Pro cost)</div>
    </div>
    <div class="metric">
      <div class="metric-label">Quality Uplift</div>
      <div class="metric-value" style="color:#d97757">+{uplift_over_flash:.2f}</div>
      <div class="sub">(Flash+skill − Flash alone, /10)</div>
    </div>
  </div>
</div>
""")

    # ─── First principle section ───
    html_parts.append("""
<div class="card">
  <h2>First Principle</h2>
  <p>From the <a style="color:#d97757" href="https://github.com/VILA-Lab/Dive-into-Claude-Code" target="_blank">Dive-into-Claude-Code</a> architecture analysis: <em>"As frontier models converge in capability, the operational harness becomes the differentiator. Less capable models need more scaffolding."</em></p>
  <p>The Anthropic advisor pattern codifies this: Opus provides scaffolding (plans, corrections, stop signals) that Sonnet/Haiku lacks. <strong>attrition.sh's hypothesis</strong>: this scaffolding can be distilled from observed successful Pro runs and injected into cheaper-model replays — generating skill templates automatically rather than requiring hand-written state graphs.</p>
  <h3>Test</h3>
  <p>For each query, run three configurations and judge:</p>
  <ul>
    <li><code class="mono">A: Flash alone</code> — cheap baseline</li>
    <li><code class="mono">B: Pro alone</code> — expensive ceiling</li>
    <li><code class="mono">C: Flash + distilled skill</code> — the experiment. Pro's reasoning is extracted into a structured skill template, then injected into Flash's prompt.</li>
  </ul>
  <h3>Success criteria</h3>
  <p>Wedge confirmed if <strong>quality retention ≥ 80%</strong> at <strong>cost fraction &lt; 40%</strong>.</p>
</div>
""")

    # ─── Aggregate charts ───
    max_score = max(max(aggregates["pro_alone"] or [0]), max(aggregates["flash_plus_skill"] or [0]), max(aggregates["flash_alone"] or [0]), 1)
    max_cost = max(max(costs["pro_alone"] or [0]), max(costs["flash_plus_skill"] or [0]), max(costs["flash_alone"] or [0]), 0.00001)

    def config_color(c):
        return {"flash_alone": "#60a5fa", "pro_alone": "#f59e0b", "flash_plus_skill": "#22c55e"}[c]

    def config_label(c):
        return {"flash_alone": "Flash alone", "pro_alone": "Pro alone", "flash_plus_skill": "Flash + skill"}[c]

    html_parts.append("""
<div class="card">
  <h2>Aggregate Results</h2>
  <div class="chart-row">
    <div class="chart-box">
      <h4>Average Quality Score (0-10)</h4>
""")
    for c in ["flash_alone", "pro_alone", "flash_plus_skill"]:
        w = (avg_score[c] / 10) * 100
        html_parts.append(f"""<div class="bar-group"><div class="bar-group-label">{config_label(c)}</div><div class="bar-wrap"><div class="bar-fill" style="width:{w}%;background:{config_color(c)}"></div><div class="bar-label">{avg_score[c]:.2f}</div></div></div>""")
    html_parts.append("""
    </div>
    <div class="chart-box">
      <h4>Avg Cost per Query (USD)</h4>
""")
    for c in ["flash_alone", "pro_alone", "flash_plus_skill"]:
        w = (avg_cost[c] / max_cost) * 100 if max_cost > 0 else 0
        html_parts.append(f"""<div class="bar-group"><div class="bar-group-label">{config_label(c)}</div><div class="bar-wrap"><div class="bar-fill" style="width:{w}%;background:{config_color(c)}"></div><div class="bar-label">${avg_cost[c]:.6f}</div></div></div>""")
    html_parts.append("""
    </div>
    <div class="chart-box">
      <h4>Avg Tokens per Query</h4>
""")
    max_tok = max(mean(tokens[c]) if tokens[c] else 0 for c in tokens) or 1
    for c in ["flash_alone", "pro_alone", "flash_plus_skill"]:
        v = mean(tokens[c]) if tokens[c] else 0
        w = (v / max_tok) * 100
        html_parts.append(f"""<div class="bar-group"><div class="bar-group-label">{config_label(c)}</div><div class="bar-wrap"><div class="bar-fill" style="width:{w}%;background:{config_color(c)}"></div><div class="bar-label">{v:,.0f}</div></div></div>""")
    html_parts.append("</div></div></div>")

    # ─── Per-query cards ───
    html_parts.append('<h2>Per-Query Breakdown</h2>')
    for run in runs:
        j = judg_idx.get(run["case_id"], {})
        required_refs = run["required_references"]

        html_parts.append(f"""
<div class="card">
  <h3>{run['case_id']} — {html.escape(run['query'])}</h3>
  <p class="sub">Store: <code class="mono">{run.get('store_id','?')}</code> · Required refs: """)
        for r in required_refs:
            html_parts.append(f'<code class="mono">{r}</code> ')
        html_parts.append('</p>')

        # Distilled skill
        html_parts.append(f"""
<h4 style="color:#d97757;margin-top:1rem">🧪 Distilled Skill (extracted from Pro's reasoning)</h4>
<div class="skill-box">{markdown_to_html(run['distilled_skill']['text'])}</div>
<p class="sub">Distillation cost: <code class="mono">${run['distilled_skill']['cost_usd']:.6f}</code> · {run['distilled_skill']['total_tokens']:,} tokens (one-time per pattern)</p>

<div class="row">
""")

        for config_key in ["flash_alone", "pro_alone", "flash_plus_skill"]:
            config_data = run[config_key]
            verdict_data = j.get(config_key, {})
            title = config_label(config_key)

            found = set(verdict_data.get("references_found", []) or [])
            missing = set(verdict_data.get("references_missing", []) or [])
            # Also compute deterministically from response text (trustworthy)
            resp_text = config_data["text"].lower()
            det_found = [r for r in required_refs if r.lower() in resp_text]
            det_missing = [r for r in required_refs if r.lower() not in resp_text]

            html_parts.append(f"""
  <div class="col col-{config_key.replace('_','-')}">
    <div class="col-header">
      <div class="col-title">{title}</div>
      <div class="col-cost">${config_data['cost_usd']:.6f}</div>
    </div>
    <div class="sub" style="font-size:0.6875rem;margin-bottom:0.5rem">
      {config_data['total_tokens']:,} tokens · {config_data['latency_ms']}ms · {config_data['model']}
    </div>
    <div class="response">{markdown_to_html(config_data['text'])}</div>
    <div class="score-grid">
      <span class="score-label">Factual</span>{score_bar(verdict_data.get('factual_alignment', 0))}
      <span></span>
      <span class="score-label">Policy</span>{score_bar(verdict_data.get('policy_grounding', 0))}
      <span></span>
      <span class="score-label">Actionability</span>{score_bar(verdict_data.get('actionability', 0))}
      <span></span>
      <span class="score-label">Completeness</span>{score_bar(verdict_data.get('completeness', 0))}
      <span></span>
      <span class="score-label" style="font-weight:600">Overall</span>{score_bar(verdict_data.get('overall_score', 0), color='#d97757')}
      <span>{verdict_badge(verdict_data.get('verdict', 'unknown'))}</span>
    </div>
    <div style="margin-top:0.5rem;font-size:0.625rem">
      <strong>Refs found (deterministic):</strong>
      <div class="refs-row">""")
            for r in det_found:
                html_parts.append(f'<span class="ref-chip ref-found">✓ {r}</span>')
            for r in det_missing:
                html_parts.append(f'<span class="ref-chip ref-missing">✗ {r}</span>')
            html_parts.append(f"""
      </div>
      <p class="sub" style="font-size:0.625rem;margin-top:0.5rem"><em>{html.escape(verdict_data.get('rationale', ''))}</em></p>
    </div>
  </div>
""")

        html_parts.append('</div></div>')

    # ─── Conclusion ───
    conclusion_color = verdict_color
    html_parts.append(f"""
<div class="card" style="border-color:{conclusion_color};border-width:2px">
  <h2>First-Principles Conclusion</h2>
""")

    if "CONFIRMED" in verdict:
        html_parts.append(f"""
  <p><strong style="color:#22c55e">The wedge is real.</strong> Flash + distilled skill recovers <strong>{quality_retention:.1f}%</strong> of Pro quality at <strong>{cost_fraction:.1f}%</strong> of the cost. Distillation transfers reasoning, not just prompts.</p>
  <p><strong>What this means for attrition.sh</strong>: the product is not "yet another cost dashboard." It is a research arm that captures expensive expert runs, distills them into reusable skills, and measurably reduces cost on replays. The data moat compounds per captured run.</p>
  <h3>Next experiment</h3>
  <ul>
    <li>Test skill transfer across WORKLOADS (does a retail-ops skill help with similar queries it wasn't distilled from?)</li>
    <li>Test skill decay over time as domain facts evolve</li>
    <li>Scale to 20+ queries, compute statistical significance</li>
  </ul>
""")
    elif "PARTIAL" in verdict:
        html_parts.append(f"""
  <p><strong style="color:#f59e0b">Inconclusive.</strong> Quality retention ({quality_retention:.1f}%) and cost fraction ({cost_fraction:.1f}%) suggest SOME reasoning transfers but not enough to clearly win.</p>
  <p><strong>Next moves</strong>:</p>
  <ul>
    <li>Increase sample to 20 queries — 3 is too small for signal</li>
    <li>Investigate failure modes — which queries lost the most quality?</li>
    <li>Test richer skill templates (current templates may under-specify)</li>
  </ul>
""")
    else:
        html_parts.append(f"""
  <p><strong style="color:#ef4444">The wedge fails under this test.</strong> Flash + skill did not close enough of the quality gap at the expected cost fraction.</p>
  <p><strong>Honest next steps</strong>:</p>
  <ul>
    <li>Fold attrition into NodeBench as a cost analytics surface</li>
    <li>OR: investigate if a richer distillation (multi-shot, context-augmented) works better before giving up</li>
    <li>Do NOT ship distillation-as-a-service based on this evidence</li>
  </ul>
""")

    html_parts.append("""
</div>

<div class="footer">
  Generated by attrition.sh scaffolding wedge experiment · All data measured from real Gemini API usageMetadata · No estimates
</div>
</div></body></html>
""")

    return "".join(html_parts)


def main():
    runs, judg_idx = load_data()
    html_out = build_report(runs, judg_idx)
    out_path = RESULTS_DIR / "report.html"
    out_path.write_text(html_out, encoding="utf-8")
    print(f"Visual report written to {out_path}")
    print(f"Open: file:///{out_path.as_posix()}")


if __name__ == "__main__":
    main()
