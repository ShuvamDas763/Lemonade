// SYNTHETIC backend — a structured cost model, NOT evidence about real LLMs.
//
// What it models: an agentic coding session where each *unresolved ambiguity
// dimension* (a planted pattern) risks either a clarification turn (agent asks,
// scripted user answers) or a wrong-guess turn (agent builds the wrong thing,
// the tester corrects it, one rework turn). Every turn re-sends growing context,
// so extra turns amplify input tokens — the real cost mechanism in agentic
// coding. Work units are identical for both variants of a pair (same app), so
// differences come from PROCESS overhead only, i.e. ambiguity itself.
//
// What it cannot do: validate the premise. The direction of the result is baked
// in by the model's design. See PHASE0_REPORT.md "Threats to validity".
import { hashSeed, mulberry32, estimateTokens } from "../lib/rng.js";

export const PARAMS = {
  workUnits: 10,          // build effort per app (same for both variants of a pair)
  buildRate: 2.5,         // work units completed per clean build turn
  sysTokens: 1200,        // agent system prompt, re-sent every turn
  ctxGrowthTokens: 250,   // added context per prior turn (files, history)
  buildOutTokens: 700,    // output tokens per build turn
  reworkOutTokens: 450,   // output tokens when rebuilding after a correction
  clarifyOutTokens: 120,  // output tokens to ask a clarifying question
  userAnsTokens: 40,      // scripted user's answer tokens
  pClarify: { 3: 0.5, 2: 0.3, 1: 0.15 }, // per-turn P(ask) by severity of top unresolved gap
  pWrongGuess: 0.25,      // per-turn P(build-the-wrong-thing) when not clarifying
  pBaseNoise: 0.03,       // residual clarification rate even on clean specs
  maxTurns: 14,           // session cap; exceeding it = incomplete (abandonment proxy)
};

export async function runSession(prompt, { pairId, variant, runIndex = 0, seed } = {}) {
  const s = seed ?? hashSeed(`${pairId}:${variant}:${runIndex}`);
  const rand = mulberry32(s);
  const promptTokens = estimateTokens(prompt.text);

  const unresolved = [...(prompt.plantedPatterns ?? [])]; // pre-sorted severity desc
  const plantedCategories = unresolved.map((p) => p.category);

  let turn = 0, inTok = 0, outTok = 0, corrections = 0;
  let progress = 0;
  const events = [];

  while (progress < PARAMS.workUnits && turn < PARAMS.maxTurns) {
    turn++;
    inTok += PARAMS.sysTokens + promptTokens + PARAMS.ctxGrowthTokens * (turn - 1);

    let acted = false;
    if (unresolved.length > 0) {
      const top = unresolved[0];
      const pC = PARAMS.pClarify[top.severity] ?? 0.25;
      if (rand() < pC) {
        // One clarify turn may bundle up to 2 gaps (agents ask batched questions).
        const bundle = unresolved.splice(0, unresolved.length > 1 && rand() < 0.5 ? 2 : 1);
        for (const p of bundle) events.push({ turn, type: "clarify", pattern: p.category });
        outTok += PARAMS.clarifyOutTokens * bundle.length + PARAMS.userAnsTokens * bundle.length;
        acted = true;
      } else if (rand() < PARAMS.pWrongGuess) {
        const p = unresolved.shift();
        corrections += 1;
        events.push({ turn, type: "correction", pattern: p.category });
        outTok += PARAMS.reworkOutTokens;
        acted = true; // no build progress this turn
      }
    } else if (rand() < PARAMS.pBaseNoise) {
      events.push({ turn, type: "clarify", pattern: null });
      outTok += PARAMS.clarifyOutTokens + PARAMS.userAnsTokens;
      acted = true;
    }

    if (!acted) {
      progress += PARAMS.buildRate;
      outTok += PARAMS.buildOutTokens;
    }
  }

  const completed = progress >= PARAMS.workUnits;
  // Gaps never explicitly resolved are silent assumptions that shipped.
  const silentAssumptions = unresolved.map((p) => p.category);

  return {
    pairId,
    variant,
    runIndex,
    backend: "simulated",
    seed: s,
    turns: turn,
    inputTokens: inTok,
    outputTokens: outTok,
    totalTokens: inTok + outTok,
    corrections,
    completed,
    events,
    plantedCategories,
    silentAssumptions,
  };
}
