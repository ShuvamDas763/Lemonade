// Lemonade — 5-Axis Quality & Free-Tier Quota Intelligence Engine.
// Evaluates prompts against real-world production constraints:
// Clarity, Completeness, Efficiency, Scope Control, and Verifiability,
// paired with token cost, turns-to-completion, and runaway scope protection.

import { ITEM_CATEGORY, PROVENANCE, STATUS, SCOPE } from "./model.js";

/**
 * Generate the naive, beginner one-liner baseline prompt.
 * Used to calculate the actual Value Delta (Δ) added by the optimizer.
 * @param {string} rawPrompt
 * @returns {string}
 */
export function generateBaselinePrompt(rawPrompt) {
  const text = String(rawPrompt ?? "").trim();
  if (!text) return "Build an application.";

  // Extract first imperative or core sentence
  const firstSentence = text.split(/[.?!;\n]/)[0].trim();
  if (firstSentence.length > 10) {
    return firstSentence.endsWith(".") ? firstSentence : `${firstSentence}.`;
  }

  // Fallback: simplified noun phrase
  const match = text.match(/(?:build|create|make|develop)\s+(?:me\s+)?(?:a|an)?\s*([^,.\n]+)/i);
  if (match) {
    return `Build a ${match[1].trim()}.`;
  }

  return `Build ${text.slice(0, 50).trim()}...`;
}

/**
 * Estimate token count with realistic tokenizer heuristic (1.3 tokens per word).
 * @param {string} text
 * @returns {number}
 */
export function estimateTokens(text) {
  if (!text) return 0;
  const words = text.trim().split(/\s+/).length;
  const specialChars = (text.match(/[{}\[\]()<>:=/*#`|]/g) || []).length;
  return Math.round(words * 1.25 + specialChars * 0.25);
}

/**
 * Evaluate prompt on the 5 Core Axes:
 * 1. Clarity — is intent unambiguous to a model with zero prior context?
 * 2. Completeness — are format, scope, and stop condition present?
 * 3. Efficiency — quality delivered per token spent (penalizing bloat).
 * 4. Scope Control — does it prevent over-building or under-building?
 * 5. Verifiability — can the user/agent check "done" objectively?
 *
 * @param {string} promptText
 * @param {import("./model.js").ProjectSpec} [spec]
 * @param {boolean} [isBaseline=false]
 * @returns {object}
 */
export function evaluateFiveAxes(promptText, spec = null, isBaseline = false) {
  const text = String(promptText ?? "");
  const lower = text.toLowerCase();
  const tokenCount = estimateTokens(text);

  if (isBaseline || text.length < 80) {
    // Naive baseline prompt scoring
    const clarity = 35;
    const completeness = 20;
    const efficiency = 45; // cheap in prompt tokens, but disastrous in turn count
    const scopeControl = 15; // zero boundaries
    const verifiability = 20; // no testable criteria
    const composite = Math.round(
      clarity * 0.25 + completeness * 0.25 + efficiency * 0.15 + scopeControl * 0.2 + verifiability * 0.15
    );

    return {
      clarity,
      completeness,
      efficiency,
      scopeControl,
      verifiability,
      composite,
      tokenCount,
      estimatedTurns: 3.5,
      loopRisk: "HIGH",
      bloatPenalty: 0,
      diagnostics: [
        "Unbounded scope: high risk of model inventing unrequested architecture or frameworks.",
        "Missing deliverable format declaration.",
        "Missing stop condition: agent may loop or generate unsolicited features.",
        "No objective verification criteria.",
      ],
    };
  }

  const diagnostics = [];

  // 1. CLARITY (Weight: 25%)
  let clarityScore = 100;
  // Check for ungrounded subjective terms without definitions
  const vagueTerms = (text.match(/\b(clean|modern|fast|simple|slick|intuitive|easy|nice|good)\b/gi) || []);
  if (vagueTerms.length > 0 && !lower.includes("interpreted conservatively") && !lower.includes("assumed")) {
    clarityScore -= Math.min(25, vagueTerms.length * 5);
    diagnostics.push(`Contains ${vagueTerms.length} subjective term(s) without bounded definitions.`);
  }
  // Check if intent is clearly stated
  if (!lower.includes("goal") && !lower.includes("must build") && !lower.includes("requirement")) {
    clarityScore -= 20;
  }
  clarityScore = Math.max(20, Math.min(100, clarityScore));

  // 2. COMPLETENESS (Weight: 25%)
  let completenessScore = 100;
  const hasFormat = lower.includes("deliverable format") || lower.includes("single standalone") || lower.includes("single-file") || lower.includes("output format") || lower.includes("inline html");
  const hasStop = lower.includes("stop condition") || lower.includes("stop and summarize") || lower.includes("once all v1 requirements work");
  const hasScopeList = lower.includes("must build") || lower.includes("v1 requirements");
  const hasNegativeScope = lower.includes("must not build") || lower.includes("do not use") || lower.includes("do not build") || lower.includes("non-negotiables");

  if (!hasFormat) {
    completenessScore -= 25;
    diagnostics.push("Missing explicit deliverable format declaration (Rule 3.1).");
  }
  if (!hasStop) {
    completenessScore -= 25;
    diagnostics.push("Missing hard stop condition (Rule 3.4).");
  }
  if (!hasScopeList) {
    completenessScore -= 20;
  }
  if (!hasNegativeScope) {
    completenessScore -= 20;
  }
  completenessScore = Math.max(15, Math.min(100, completenessScore));

  // 3. EFFICIENCY (Weight: 15%)
  let efficiencyScore = 100;
  let bloatPenalty = 0;
  // Penalize empty decorative boilerplate that doesn't change model behavior
  if (text.includes("---") && (text.match(/---/g) || []).length > 4) {
    bloatPenalty += 8;
  }
  if (text.includes("Please ensure that you read all of the following instructions carefully before proceeding")) {
    bloatPenalty += 15;
    diagnostics.push("Verbose conversational intro flagged as token bloat.");
  }
  // Token efficiency ratio: high quality per token spent
  if (tokenCount > 600 && completenessScore < 85) {
    efficiencyScore -= 25;
    diagnostics.push("High token weight without proportional completeness.");
  } else if (tokenCount > 400) {
    efficiencyScore -= 10;
  }
  efficiencyScore = Math.max(30, Math.min(100, efficiencyScore - bloatPenalty));

  // 4. SCOPE CONTROL (Weight: 20%)
  let scopeControlScore = 100;
  if (!hasNegativeScope) {
    scopeControlScore -= 45;
    diagnostics.push("Missing negative constraint list ('Must NOT Build'): high risk of feature creep (Rule 3.2).");
  }
  if (lower.includes("etc.") || lower.includes("and so on") || lower.includes("and more")) {
    scopeControlScore -= 20;
    diagnostics.push("Open-ended filler words ('etc.') detected in scope definition.");
  }
  if (lower.includes("v2") || lower.includes("future scope") || lower.includes("out of scope") || lower.includes("out of v1")) {
    scopeControlScore += 5; // Bonus for explicit phase gating
  }
  scopeControlScore = Math.max(15, Math.min(100, scopeControlScore));

  // 5. VERIFIABILITY (Weight: 15%)
  let verifiabilityScore = 100;
  const hasSelfTest = lower.includes("self-test") || lower.includes("verification") || lower.includes("acceptance criteria") || lower.includes("confirm that");
  if (!hasSelfTest) {
    verifiabilityScore -= 40;
    diagnostics.push("Missing lightweight self-test verification checklist (Rule 3.6).");
  }
  verifiabilityScore = Math.max(20, Math.min(100, verifiabilityScore));

  // COMPOSITE WEIGHTED SCORE
  const composite = Math.round(
    clarityScore * 0.25 +
    completenessScore * 0.25 +
    efficiencyScore * 0.15 +
    scopeControlScore * 0.20 +
    verifiabilityScore * 0.15
  );

  // QUOTA ECONOMICS
  // A prompt with format, negative scope, and stop condition reliably terminates in 1 turn
  const isOneShot = hasFormat && hasNegativeScope && hasStop && clarityScore >= 80;
  const estimatedTurns = isOneShot ? 1.0 : hasStop ? 1.8 : 3.2;
  const loopRisk = isOneShot ? "SAFE" : hasStop ? "MODERATE" : "HIGH";

  return {
    clarity: clarityScore,
    completeness: completenessScore,
    efficiency: efficiencyScore,
    scopeControl: scopeControlScore,
    verifiability: verifiabilityScore,
    composite,
    tokenCount,
    estimatedTurns,
    loopRisk,
    bloatPenalty,
    diagnostics,
  };
}

/**
 * Calculate the Value Delta (Δ) between baseline naive prompt and optimized prompt.
 * @param {object} baselineScore
 * @param {object} optimizedScore
 * @returns {object}
 */
export function calculateDelta(baselineScore, optimizedScore) {
  return {
    clarityDelta: optimizedScore.clarity - baselineScore.clarity,
    completenessDelta: optimizedScore.completeness - baselineScore.completeness,
    efficiencyDelta: optimizedScore.efficiency - baselineScore.efficiency,
    scopeControlDelta: optimizedScore.scopeControl - baselineScore.scopeControl,
    verifiabilityDelta: optimizedScore.verifiability - baselineScore.verifiability,
    compositeDelta: optimizedScore.composite - baselineScore.composite,
    turnsSaved: Math.max(0, +(baselineScore.estimatedTurns - optimizedScore.estimatedTurns).toFixed(1)),
    outputTokensSavedEst: Math.round((baselineScore.estimatedTurns - optimizedScore.estimatedTurns) * 800),
  };
}

/**
 * Complete Quota & 5-Axis Evaluation Suite.
 * @param {string} rawPrompt
 * @param {string} optimizedPrompt
 * @param {import("./model.js").ProjectSpec} [spec]
 * @returns {object}
 */
export function evaluatePromptQualityAndQuota(rawPrompt, optimizedPrompt, spec = null) {
  const baselinePrompt = generateBaselinePrompt(rawPrompt);
  const baselineScore = evaluateFiveAxes(baselinePrompt, null, true);
  const optimizedScore = evaluateFiveAxes(optimizedPrompt, spec, false);
  const delta = calculateDelta(baselineScore, optimizedScore);

  return {
    baselinePrompt,
    baselineScore,
    optimizedScore,
    delta,
    summary: {
      promptTokens: optimizedScore.tokenCount,
      estimatedTurns: optimizedScore.estimatedTurns,
      loopRisk: optimizedScore.loopRisk,
      valueDelta: delta.compositeDelta,
      turnsSaved: delta.turnsSaved,
      targetTierSizing: optimizedScore.tokenCount < 350 ? "Free-Tier & Small Models (<4k ctx)" : "Frontier Models",
    },
  };
}
