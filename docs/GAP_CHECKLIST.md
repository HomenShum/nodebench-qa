# attrition.sh — Gap Checklist

Honest audit of what we **said** we'd do vs what's actually shipped.
P0 = honesty blocker (we're claiming things we can't do). P1 = promised
core feature missing. P2 = polish / robustness.

Last audit: 2026-04-19, commit `3836480`.

---

## P0 — Honesty blockers (ship or soften the claim)

- [ ] **Builder's "Scaffold" tab does not generate code.** File list is
      hardcoded per runtime lane. Must either (a) wire real generation or
      (b) relabel the tab "Scaffold plan" and mark it non-interactive until
      generation lands.
- [ ] **Builder's "Eval" tab cannot run evals.** Shows recommended
      benchmarks only. Must either wire a run button (routes to
      `/_internal/fidelity` trials) or relabel "Eval plan".
- [ ] **Builder's "World Model" tab does not emit files.** We list what
      *would* live at `entities.yaml` / `interpretive_boundary.md` but
      generate nothing. Same relabel-or-ship rule.
- [ ] **"Three motions" claim is ahead of reality.** We ship triage for
      all three (compile_down / compile_up / translate) but the actual
      translator / compiler is not written. Either build a minimal compiler
      for one motion, or temporarily narrow the pitch to "triage + plan +
      measure" until a full motion ships.
- [ ] **Classifier has no eval against ground truth.** We ship it to
      production with no calibration — it might confidently misclassify.
      Need a JudgeBench-style eval set of 30+ prompts with gold lanes.

## P1 — Promised core features not yet shipped

### Architect
- [ ] Multi-turn chat (currently one-shot prompt → verdict). The vision
      doc says "pure chat" with back-and-forth clarification.
- [ ] Step-by-step checklist streaming (today the checklist flips from
      all-pending to final in one commit — should tick in order).
- [ ] Explicit "missing inputs" input form (we identify missing inputs
      but don't ask for them).
- [ ] Edit / revise prompt without full reset.
- [ ] Feed Radar priors back into classifier prompt (priors exist but
      aren't retrieved).

### Builder
- [ ] Interactive left-rail chat (today it's a static recap).
- [ ] Real file tree + code preview on the right (Lovable-style).
- [ ] "Run generation" button that actually produces repo files.
- [ ] Connector mode switching (mock / live / hybrid) wired to anything.
- [ ] Mock generator that fabricates plausible fixtures from a schema.
- [ ] Fidelity verdict panel inline (link out to `/_internal/fidelity`
      at minimum until this is built).
- [ ] Export to starter repo (zip or GitHub push).

### Radar
- [ ] Anthropic / OpenAI / Google HTML changelog scraper (explicitly
      promised; only GitHub releases ingested today).
- [ ] HackerNews Firebase search for weak-signal watchlist terms.
- [ ] Vellum / benchmark-leaderboard interpreter tier.
- [ ] X / Twitter watchlist (user mentioned).
- [ ] Deprecation category — filter exists, no items ever hit it.
- [ ] "What changed since yesterday" delta view.
- [ ] Filter by stack (today only by category).
- [ ] Dismissal UI button (mutation exists, no button).
- [ ] Free-text search across items.

### Eval stack (from user's JudgeBench + ... list)
- [ ] **JudgeBench** adapter — Loop A judge calibration.
- [ ] **IF-RewardBench** adapter — Loop A, instruction-following.
- [ ] **SWE-bench Verified** adapter (promised multiple times; still
      no Docker harness).
- [ ] **BFCL v4** upgrade from v3 (v3 saturated per our own findings).
- [ ] **MCP-Atlas** adapter.
- [ ] **τ²-bench** adapter (closest FloorAI analog, still not built).
- [ ] **Terminal-Bench 2.0** adapter.
- [ ] **BrowseComp** adapter.
- [ ] **PoLL pattern** — panel-of-smaller-judges for open-ended residuals.
- [ ] **Arena-Hard-Auto / RewardBench 2** for secondary calibration.
- [ ] Wire FloorAI internal gold set into the Eval tab.

### World model substrate
- [ ] Actual generator for `entities.yaml`, `states.schema.ts`,
      `events.schema.ts`, `policies.yaml`, `actions.ts`, `outcomes.table.ts`,
      `evidence_refs.json`, `interpretive_boundary.md`.
- [ ] "Act on this" vs "Interpret this first" labeling system in code
      (not just in copy).
- [ ] Policy engine that enforces the rules file at action emission.
- [ ] Outcome feedback loop (the world model must learn from results).

### Migration / translation
- [ ] Trace normalizer: Claude Code / Cursor / LangGraph session →
      canonical WorkflowSpec.
- [ ] WorkflowSpec → OpenAI Agents SDK code emitter.
- [ ] WorkflowSpec → LangGraph code emitter.
- [ ] WorkflowSpec → plain tool-first chain emitter.
- [ ] Regression diff: old legacy chain verdict vs new scaffold verdict.

## P2 — Polish / robustness

### Reliability
- [ ] Cron retry with backoff on GitHub rate-limit hits.
- [ ] GITHUB_TOKEN set on Convex env (today runs unauthenticated;
      60 req/hr ceiling).
- [ ] Architect rate limit (abuse prevention; currently any unauth
      request can classify).
- [ ] Cost cap per session (Gemini calls uncapped today).
- [ ] Error boundaries on the three React pages.
- [ ] `/health` endpoint on the site.

### Auth / ownership
- [ ] No auth anywhere — anyone can view any `/build/:slug`.
- [ ] No session ownership / sharing model.
- [ ] API key path for programmatic classify + ingest.
- [ ] SSRF hardening beyond compile-time watchlist.

### Observability
- [ ] Link `/_internal/fidelity` from operator-only nav.
- [ ] Radar ingest health card on the `/radar` header (shows last run,
      error count).
- [ ] Architect session audit visible to operators.
- [ ] Cost / latency rollup visible somewhere.
- [ ] Analytics (at minimum: classifier calls per day, accept rate,
      lane distribution).

### Content / growth
- [ ] Hero demo video or live loop animation on `/`.
- [ ] Example prompts with frozen gold verdicts (social proof).
- [ ] Pricing page (none today).
- [ ] Signup / account.
- [ ] Public case study with measured cost delta.
- [ ] OG images per page.
- [ ] `sitemap.xml`, per-page `<meta description>`.

### Docs
- [ ] `docs/ARCHITECT_CLASSIFIER_PROMPT.md` — the prompt lives in code
      only; extract and version it.
- [ ] `docs/RADAR_INGEST_SOURCES.md` — full inventory of tiers + cadence.
- [ ] `docs/BUILDER_GENERATION_SPEC.md` — what will be generated per lane.
- [ ] `docs/WORLD_MODEL_SPEC.md` — the substrate shape.
- [ ] `docs/CONNECTOR_RESOLVER_SPEC.md`.
- [ ] Update `docs/JUDGE_EVAL_BENCHMARKS.md` with the user's latest list
      (JudgeBench, IF-RewardBench, BFCL v4, MCP-Atlas, tau2, Terminal-Bench,
      BrowseComp, Arena-Hard-Auto, RewardBench 2).

## Recommended ship order (next 3 cycles)

**Cycle 1 — truth-in-labeling (P0 only):**
Relabel Builder tabs to "plan" where we don't actually run anything.
Add a visible "Beta — triage + plan only" banner. Wire
`/_internal/fidelity` link from Builder's Eval tab. Write the
classifier eval harness (30 prompts, gold lanes) and commit a
baseline verdict.

**Cycle 2 — the one motion that matters most:**
Pick **compile_down** only. Wire trace intake → WorkflowSpec →
tool-first-chain emitter → replay → Fidelity verdict. One end-to-end
happy path for one motion is worth more than triage for three.

**Cycle 3 — eval rigor:**
Ship JudgeBench + τ²-bench adapters. Update judge calibration docs.
Wire to the Builder Eval tab so every Fidelity trial on τ²-bench or
JudgeBench appears inline for the accepted session.

After that, circle back to multi-turn Architect chat, world-model
emission, and Radar HTML-changelog ingest.

---

## What NOT to add until the above lands

- More pages (we locked to three — keep it that way).
- More Radar categories.
- Multi-agent orchestration on the classifier itself.
- Full auth / billing (pre-revenue; don't build accounting until
  someone is paying).
- Mobile optimization (desktop-first until paid usage exists).
