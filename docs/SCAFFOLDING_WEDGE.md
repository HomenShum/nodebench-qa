# Scaffolding-as-a-Service — The Real Wedge

## Thesis (user insight, verified credible)

Less capable models need more scaffolding. More capable models need less. This is the [architectural insight from Dive-into-Claude-Code](https://github.com/VILA-Lab/Dive-into-Claude-Code): as frontier models converge in capability, the operational harness becomes the differentiator.

The Anthropic advisor pattern codifies this: Opus (capable) provides the scaffolding (plan, correction, stop signal) that Sonnet (less capable) lacks. The advisor IS on-demand scaffolding delivery.

**attrition.sh's unique angle**: generate the scaffolding automatically from measured successful runs, then inject it into cheaper-model replays.

## Mechanism

1. **Capture** — expensive model succeeds at task X, all tokens + trace measured
2. **Distill** — extract reasoning steps, context, tool sequence into a reusable skill
3. **Replay** — cheaper model attempts task X with distilled skill as scaffolding
4. **Judge** — measure success rate delta

## Why this is different from existing tools

| Tool | What it does | Gap |
|------|-------------|-----|
| LangGraph | Manual state graphs | Requires human design per workflow |
| CLAUDE.md / SKILL.md | Static scaffolding | Doesn't adapt to observed success patterns |
| LiteLLM / AgentOps | Measurement | No scaffolding generation |
| Prompt caching | Context reuse | Doesn't distill reasoning |
| attrition distillation | Auto-generated from real runs | Needs proof |

## Kill criteria (7-day experiment)

Use FloorAI's 3 measured queries as the test bed:

1. **Cooler emergency** (Pro, $0.030, 21K tokens, complex multi-step)
   - Attempt with Flash alone → expect failure (misses food safety steps)
   - Distill Pro run → skill: "food safety emergency protocol"
   - Retry Flash + skill → measure success
2. **Milk delivery status** (Pro, $0.018, 14K tokens, simple lookup)
   - Probably Flash alone succeeds — baseline for "already simple enough"
3. **Staffing shortage** (Pro, $0.016, 11K tokens, medium complexity)
   - Mid-tier test case

### Success definition

- 3/5 complex tasks: (Flash + distilled skill) achieves ≥ 80% of Pro-alone quality at < 40% cost → **WEDGE CONFIRMED**
- < 3/5 succeed → distillation is prompt stuffing, product is dead

## What attrition becomes if proven

Not a cost dashboard. Not an observability platform. **A scaffolding-as-a-service engine**:

- Every Pro/Opus success → candidate skill
- Library of distilled skills per domain (retail ops, code review, research)
- Cheap models run with on-demand scaffold injection
- Measured savings per skill

This maps to a defensible position: the data moat compounds per session. After 10K captured Pro runs across 100 workloads, attrition can recommend "for this workload, use Flash + skill #42, expected 65% savings at 90% quality."

## Open questions (to answer via experiment)

1. Can distilled skills be domain-generic or do they stay workload-specific?
2. What's the minimum measurement sample size before distillation is reliable?
3. How do skills decay as the domain evolves?
4. What prevents skill pollution (bad runs → bad skills)?

## Next action

Run the 3-query experiment on FloorAI's existing captured packets. Results decide whether we build the distillation engine or fold attrition into NodeBench.
