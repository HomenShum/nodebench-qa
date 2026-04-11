# Behavioral Design Audit: attrition.sh

Applying the 5 principles from Linear/Perplexity/ChatGPT/Notion to attrition.

## Current State: Honest Assessment

attrition.sh currently violates ALL 5 behavioral design principles.

### 1. VALUE BEFORE IDENTITY — time-to-wow < 5 seconds

**ChatGPT**: One text box. Type. Get answer.
**Perplexity**: Search bar. Instant synthesis.

**attrition.sh now**: 9-section landing page with competitive tables, proof taxonomy cards, benchmark fixtures, and install commands. User must read 3 screens of explanation before understanding what the product does.

The "Try it now" scanner exists but it's buried below the hero, the product demo section, and a "This is not a hypothetical" section with 4 quote cards.

**The first thing you see is NOT the thing you do.**

**Fix**: Strip landing to: one headline + one input + one result. That's it above the fold.
```
Your agent skipped 3 steps. Attrition caught them.
[Paste a URL to scan]  [Scan]
→ Score: 95/100. 1 issue found. 480ms.
```

### 2. SPEED IS A FEATURE, NOT A METRIC

**Linear**: Sub-50ms everything.
**ChatGPT**: Streaming makes 3s feel like watching someone think.

**attrition.sh now**: Chat panel simulates responses with hardcoded delays (500ms thinking, 1000ms tool call). The real API call to Cloud Run has 1-5s cold start latency. No progressive streaming. No skeleton loading on page transitions.

**Fix**: 
- Remove artificial delays from chat
- Add streaming dots during real API call
- Show result sections progressively (score first, then dimensions, then issues)
- Hard budget: first visible response < 800ms

### 3. THE OUTPUT IS THE DISTRIBUTION

**ChatGPT**: Every conversation is a screenshot.
**Perplexity**: Shareable answer URLs with citations.

**attrition.sh now**: No shareable URLs for scan results. No way to share a proof row. No screenshot-worthy moment. The proof page is good content but not shareable — it's a long scrollable page, not a single card someone would screenshot.

**Fix**:
- Generate shareable result URLs: `attrition.sh/scan/abc123`
- Make each proof row independently linkable: `attrition.sh/proof#false_completion`
- Design the scan result as a screenshot-worthy card (score ring + 3 key findings)

### 4. MEET USERS WHERE THEY ARE

**Linear**: Cmd+K everywhere.
**ChatGPT**: One text box. Absence of UI IS the UI.

**attrition.sh now**: 4 nav tabs, a slide-over chat panel, separate pages for proof/improvements/get-started. The user has to learn a navigation system before getting value.

The MCP server meets users in Claude Code — that's correct. But the web app doesn't follow the same pattern.

**Fix**:
- Make the chat panel the ENTIRE product on web
- Every page should be reachable from chat: "show proof", "how does it work", "get started"
- URL-based queries: `attrition.sh/?scan=example.com` goes straight to results

### 5. THE PRODUCT IMPROVES ITSELF

**TikTok**: Algorithm gets better with every swipe.
**ChatGPT**: Memory makes later interactions better.

**attrition.sh now**: No visible learning. The correction learner exists in Rust but nothing in the UI says "I'm getting better for you." No "based on your previous scans" suggestions. No personalization.

**Fix**:
- Show scan history in the chat panel: "You've scanned 3 sites. Most common issue: missing viewport meta."
- Show correction learning: "Based on 5 sessions, 'run tests' is now a required step."
- Make the judge visibly smarter over time

---

## The Deeper Problem: Too Many Surfaces

attrition.sh has:
- Landing page (9 sections)
- Proof page
- Improvements page
- Get Started page
- Live dashboard
- Workflows page
- Judge page
- Anatomy page
- Benchmark page
- Compare page
- Chat panel

**That's 11 surfaces for a product that does ONE thing: catch when agents skip steps.**

### What Linear/Perplexity/ChatGPT have:
- **ChatGPT**: 1 surface. The chat. Everything happens there.
- **Perplexity**: 1 surface. The search bar + answer page.
- **Linear**: 1 surface. The issue list + Cmd+K.

### What attrition should have:
1. **The scanner** — paste URL, see what's wrong, see what was missed
2. **The chat** — ask anything, get answers with tool calls
3. **The docs** — for people who want to understand (proof, improvements, how it works)

That's 3, not 11.

---

## Applying to the MCP Problem

The NodeBench MCP has the SAME problem: too many surfaces, no clear workflow.

### What the MCP does wrong:
- 350+ tools across 57 domains — nobody needs 350 tools
- Progressive discovery adds more complexity, not less
- No clear "one thing you do with this"
- Performance is unverifiable (micro-benchmarks, not user value)
- Boot time is slow because it loads analytics, embeddings, dashboards, profiling

### What Addy Osmani's agent-skills gets right:
- Each skill is ONE thing with ONE workflow
- The skill README shows: what it does, how to use it, what you get
- No discovery layer needed — you install the skill you want
- No 350-tool registry — you have 5 skills that each do 1 thing well

### What attrition's MCP should look like:
```
bp.check <url>     — scan a URL, get score + issues
bp.judge.start     — start judging a workflow
bp.judge.event     — report what happened
bp.judge.verdict   — get the verdict
bp.capture         — save a session as a workflow
bp.distill         — compress for cheaper replay
```

6 tools. Not 12. Not 350. Six tools that each do one thing.

Remove: bp.sitemap, bp.ux_audit, bp.diff_crawl, bp.workflow, bp.pipeline, bp.workflows.
These are sub-features of bp.check and bp.capture.

---

## Concrete Execution Board

| Principle | Symptom in attrition | Fix | File targets | Metric | Ship order |
|-----------|---------------------|-----|-------------|--------|------------|
| Value before identity | 9-section landing, scanner buried | Strip to: headline + input + result above fold | Landing.tsx | Time from load to first scan < 5s | 1 |
| Speed as feature | Chat has fake delays, no streaming | Remove delays, add progressive result rendering | ChatContext.tsx | First visible result < 800ms | 2 |
| Output = distribution | No shareable scan URLs | Generate /scan/:id pages that render without nav | main.tsx, new ScanResult.tsx | Shareable URL exists for every scan | 3 |
| Meet them where they are | 4 nav tabs + 11 pages | Make chat the primary surface, collapse nav to 2 items | Layout.tsx, Landing.tsx | User can do everything from chat | 4 |
| Product improves | No visible learning | Show scan history + correction count in chat | ChatContext.tsx, storage.ts | Returning user sees personalized suggestions | 5 |
| MCP bloat | 12 tools, most unused | Reduce to 6 core tools | tools.rs | tools/list returns 6, not 12 | 6 |

---

## The One-Line Version

**attrition.sh should feel like Perplexity for agent workflows: one input, one answer, shareable results, visibly getting smarter.**

Not: a 11-page dashboard with competitive comparison tables and benchmark fixtures.
