// Architect classifier — Gemini call that classifies an intake prompt
// into runtime / world-model / intent lanes.
//
// Runs as a Node action (not a mutation) so it can hit an external API
// with timeouts + abort. Returns a bounded-shape classification JSON
// that the commitClassification mutation stores.
//
// HONEST_STATUS: if Gemini errors or returns unparseable JSON, we surface
// a best-effort "unknown" classification with an explicit error note —
// never a fake confident recommendation.

"use node";

import { v } from "convex/values";
import { action } from "../../_generated/server";
import { api } from "../../_generated/api";

const CLASSIFIER_MODEL = "gemini-3.1-flash-lite-preview";
const CLASSIFIER_TIMEOUT_MS = 25_000;

// Token-cost basis for Flash Lite — informational only; classifier never
// gates output based on cost.
const FLASH_LITE_IN_USD = 0.10 / 1_000_000;
const FLASH_LITE_OUT_USD = 0.40 / 1_000_000;

const SYSTEM_PROMPT = `You are attrition.sh's architecture triage classifier.

Given a user's problem description, classify it onto three bounded axes:

RUNTIME_LANE — pick exactly one:
  simple_chain        - bounded, deterministic, tool-routing or formatting
  tool_first_chain    - chain with structured tool calls + strict response schema
  orchestrator_worker - fan-out workers + handoffs + compaction required
  keep_big_model      - task depends on tacit judgment that cannot cleanly be externalized

WORLD_MODEL_LANE — pick exactly one:
  lite  - entities + schema only, no live state / policy / outcome tracking
  full  - needs entities + state + events + policies + actions + outcomes + evidence graph

INTENT_LANE — pick exactly one:
  compile_down - user has an expensive frontier agent and wants a cheaper production path
  compile_up   - user has a legacy chain / prompt stack and wants a richer scaffold
  translate    - user wants to port a working workflow across frameworks / SDKs
  greenfield   - no prior solution exists; user is starting fresh
  unknown      - insufficient context to confidently pick any of the above

Return STRICT JSON with EXACTLY these keys (no extra commentary, no markdown):
{
  "runtime_lane": "...",
  "world_model_lane": "...",
  "intent_lane": "...",
  "checklist": [
    {"step": "problem_type_identified", "status": "ok", "detail": "<=120 chars"},
    {"step": "output_contract_extracted", "status": "ok|missing", "detail": "..."},
    {"step": "tools_mcp_likely_needed", "status": "ok|missing", "detail": "..."},
    {"step": "existing_assets_detected", "status": "ok|missing", "detail": "..."},
    {"step": "source_of_truth_resolved", "status": "ok|missing", "detail": "..."},
    {"step": "eval_method_selected", "status": "ok|missing", "detail": "..."},
    {"step": "runtime_lane_chosen", "status": "ok", "detail": "why this runtime"},
    {"step": "world_model_lane_chosen", "status": "ok", "detail": "why this world model"},
    {"step": "interpretive_boundary_marked", "status": "ok|missing", "detail": "..."},
    {"step": "missing_inputs_identified", "status": "ok|missing", "detail": "..."}
  ],
  "rationale": "2-4 sentence explanation of WHY each lane was chosen and what's missing",
  "missing_inputs": ["list", "of", "things", "needed"],
  "eval_plan": "one sentence on how success will be judged"
}

Be strict. If the user's prompt is too vague to confidently pick a lane, set
intent_lane to "unknown" and mark the classifier's confidence in the rationale.
Never claim to have detected something you didn't.`;

/**
 * Re-classify using the full accumulated transcript. Called after a
 * follow-up turn so the verdict reflects the cumulative intake.
 */
export const reclassifyFromTranscript = action({
  args: { sessionSlug: v.string() },
  handler: async (ctx, args): Promise<{ ok: boolean; reason?: string }> => {
    const session = await ctx.runQuery(api.domains.daas.architect.getSessionBySlug, {
      sessionSlug: args.sessionSlug,
    });
    if (!session) {
      return { ok: false, reason: "session_not_found" };
    }
    let transcript: Array<{ role: string; content: string }> = [];
    try {
      transcript = JSON.parse(session.transcriptJson);
    } catch {
      transcript = [];
    }
    const userTurns = transcript
      .filter((t) => t.role === "user")
      .map((t) => t.content);
    const prompt = userTurns.join("\n\n---\n\n") || session.prompt;
    return await ctx.runAction(api.domains.daas.architectClassifier.classify, {
      sessionSlug: args.sessionSlug,
      prompt,
    });
  },
});

export const classify = action({
  args: {
    sessionSlug: v.string(),
    prompt: v.string(),
  },
  handler: async (ctx, args): Promise<{ ok: boolean; reason?: string }> => {
    // Per-session cost cap — refuse to burn more $ on a session that's
    // already hit the cap. This protects against runaway refine loops.
    const costStatus = await ctx.runQuery(
      api.domains.daas.costCap.getSessionCostStatus,
      { sessionSlug: args.sessionSlug },
    );
    if (!costStatus.allowed) {
      await ctx.runMutation(api.domains.daas.architect.commitClassification, {
        sessionSlug: args.sessionSlug,
        checklistJson: JSON.stringify([
          {
            step: "problem_type_identified",
            status: "missing",
            detail: `session cost cap reached ($${costStatus.currentUsd.toFixed(4)} of $${costStatus.capUsd.toFixed(2)})`,
          },
        ]),
        classificationJson: "{}",
        runtimeLane: "keep_big_model",
        worldModelLane: "lite",
        intentLane: "unknown",
        rationale: `Session cost cap reached: $${costStatus.currentUsd.toFixed(4)} of $${costStatus.capUsd.toFixed(2)}. Start a new session to continue.`,
      });
      return { ok: false, reason: "cost_capped" };
    }

    // Rate-limit check — bucket by the first 6 chars of sessionSlug so
    // one anonymous client can't spam classifier calls. This is a best-
    // effort protection until we ship real auth.
    const bucketKey = `architect:${args.sessionSlug.slice(0, 6) || "anon"}`;
    const bucket = await ctx.runMutation(
      api.domains.daas.architectRate.checkClassifyBucket,
      { bucketKey },
    );
    if (!bucket.allowed) {
      await ctx.runMutation(api.domains.daas.architect.commitClassification, {
        sessionSlug: args.sessionSlug,
        checklistJson: JSON.stringify([
          {
            step: "problem_type_identified",
            status: "missing",
            detail: `rate limit reached (20 classify calls per 5 min); try again after ${new Date(bucket.resetAt).toLocaleTimeString()}`,
          },
        ]),
        classificationJson: "{}",
        runtimeLane: "keep_big_model",
        worldModelLane: "lite",
        intentLane: "unknown",
        rationale:
          "Rate limit reached (20 classify calls per 5 min per bucket). Wait a few minutes or contact us to raise the cap.",
      });
      return { ok: false, reason: "rate_limited" };
    }

    await ctx.runMutation(api.domains.daas.architect.markClassifying, {
      sessionSlug: args.sessionSlug,
    });

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      await ctx.runMutation(api.domains.daas.architect.commitClassification, {
        sessionSlug: args.sessionSlug,
        checklistJson: JSON.stringify([
          {
            step: "problem_type_identified",
            status: "missing",
            detail: "classifier unavailable (no GEMINI_API_KEY)",
          },
        ]),
        classificationJson: "{}",
        runtimeLane: "keep_big_model",
        worldModelLane: "lite",
        intentLane: "unknown",
        rationale:
          "Classifier unavailable — GEMINI_API_KEY not configured on the server. Please provide your workflow details directly.",
      });
      return { ok: false, reason: "no_api_key" };
    }

    const body = {
      contents: [
        {
          role: "user",
          parts: [{ text: `${SYSTEM_PROMPT}\n\nUSER PROMPT:\n${args.prompt}` }],
        },
      ],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 2048,
        responseMimeType: "application/json",
      },
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), CLASSIFIER_TIMEOUT_MS);
    let raw = "";
    try {
      const resp = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${CLASSIFIER_MODEL}:generateContent?key=${apiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: controller.signal,
        },
      );
      if (!resp.ok) {
        throw new Error(`Gemini HTTP ${resp.status}: ${(await resp.text()).slice(0, 300)}`);
      }
      const j = await resp.json();
      const parts = (j.candidates?.[0]?.content?.parts ?? []) as Array<{ text?: string }>;
      raw = parts.map((p) => String(p.text ?? "")).join("");
    } catch (err) {
      clearTimeout(timeoutId);
      await ctx.runMutation(api.domains.daas.architect.commitClassification, {
        sessionSlug: args.sessionSlug,
        checklistJson: JSON.stringify([
          { step: "problem_type_identified", status: "missing", detail: `error: ${String(err).slice(0, 120)}` },
        ]),
        classificationJson: "{}",
        runtimeLane: "keep_big_model",
        worldModelLane: "lite",
        intentLane: "unknown",
        rationale: `Classifier failed: ${String(err).slice(0, 300)}. Retry or describe the workflow in more detail.`,
      });
      return { ok: false, reason: "classifier_error" };
    }
    clearTimeout(timeoutId);

    // Parse strict JSON. Strip any code fences just in case.
    const cleaned = raw
      .trim()
      .replace(/^```(?:json)?/i, "")
      .replace(/```$/i, "")
      .trim();
    let parsed: {
      runtime_lane?: string;
      world_model_lane?: string;
      intent_lane?: string;
      checklist?: unknown;
      rationale?: string;
      missing_inputs?: unknown;
      eval_plan?: string;
    };
    try {
      parsed = JSON.parse(cleaned);
    } catch (err) {
      await ctx.runMutation(api.domains.daas.architect.commitClassification, {
        sessionSlug: args.sessionSlug,
        checklistJson: JSON.stringify([
          { step: "problem_type_identified", status: "missing", detail: "classifier returned invalid JSON" },
        ]),
        classificationJson: JSON.stringify({ raw: cleaned.slice(0, 500) }),
        runtimeLane: "keep_big_model",
        worldModelLane: "lite",
        intentLane: "unknown",
        rationale:
          "Classifier returned a non-JSON response. Please rephrase or provide more detail.",
      });
      return { ok: false, reason: "unparseable" };
    }

    // Cost accounting — estimate using Flash Lite pricing since that's
    // the classifier model. Accumulates into architectSessions.totalCostUsd.
    try {
      const usage = (await Promise.resolve(parsed as unknown)) as Record<string, unknown>;
      // Reach into the raw payload for usage metadata if present
      // (parsed is the model's JSON body, not the response envelope;
      // we approximate from prompt length).
      const promptChars = args.prompt.length;
      const approxInTokens = Math.max(1, Math.ceil(promptChars / 4));
      const approxOutTokens = Math.max(256, cleaned.length / 4);
      const approxCost =
        approxInTokens * FLASH_LITE_IN_USD + approxOutTokens * FLASH_LITE_OUT_USD;
      await ctx.runMutation(
        api.domains.daas.costCap.accumulateSessionCost,
        { sessionSlug: args.sessionSlug, additionalUsd: approxCost },
      );
      void usage; // silence unused
    } catch {
      // Cost accounting is best-effort — never fail the classify for it.
    }

    // Defensive normalization — enforce bounded enums on the server side too.
    const runtimeLane = ["simple_chain", "tool_first_chain", "orchestrator_worker", "keep_big_model"].includes(
      String(parsed.runtime_lane),
    )
      ? String(parsed.runtime_lane)
      : "keep_big_model";
    const worldModelLane = ["lite", "full"].includes(String(parsed.world_model_lane))
      ? String(parsed.world_model_lane)
      : "lite";
    const intentLane = ["compile_down", "compile_up", "translate", "greenfield", "unknown"].includes(
      String(parsed.intent_lane),
    )
      ? String(parsed.intent_lane)
      : "unknown";

    const checklist = Array.isArray(parsed.checklist) ? parsed.checklist : [];
    const rationale = String(parsed.rationale ?? "").slice(0, 3800);

    await ctx.runMutation(api.domains.daas.architect.commitClassification, {
      sessionSlug: args.sessionSlug,
      checklistJson: JSON.stringify(checklist),
      classificationJson: JSON.stringify(parsed),
      runtimeLane,
      worldModelLane,
      intentLane,
      rationale,
    });
    return { ok: true };
  },
});
