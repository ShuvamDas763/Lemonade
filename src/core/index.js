// Lemonade — Unified Core API & Intent Compiler Platform.
//
// The Intent Integrity Layer between a Human Request and an AI Execution System.
// Pure, deterministic, zero-dependency engine.

import { detect as detectAmbiguity } from "../../phase1/detector.js";
import { buildSpec as extractProjectSpec } from "../spec/extractor.js";
import { compilePrompt } from "./compiler.js";
import { validateAll } from "../validation/validate.js";
import { evaluatePromptQualityAndQuota } from "../spec/scoring.js";
import { SpecRepository } from "../spec/repository.js";
import { ITEM_CATEGORY, STATUS, PROVENANCE, SCOPE } from "../spec/model.js";

/**
 * 1. Ambiguity Detection (Deterministic Lexical Engine)
 * @param {string} prompt
 * @returns {object} Detection results with flags and scores
 */
export function detect(prompt) {
  return detectAmbiguity(prompt);
}

/**
 * 2. Semantic Specification Extraction
 * @param {string} prompt
 * @param {{ title?: string }} [options]
 * @returns {import("../spec/model.js").ProjectSpec} Canonical ProjectSpec instance
 */
export function extractSpec(prompt, options = {}) {
  return extractProjectSpec(prompt, options.title || "");
}

/**
 * 3. Target-Aware Prompt Compilation
 * Compiles a ProjectSpec into target-specific agent prompts:
 *   'coding-agent' | 'cursor' | 'claude-code' | 'openai-chat' | 'markdown' | 'json' | 'image-gen' | 'research'
 *
 * @param {import("../spec/model.js").ProjectSpec} spec
 * @param {string} [target="coding-agent"]
 * @returns {string|object}
 */
export { compilePrompt };

/**
 * 4. Verification & Validation Engine
 * Strictly separates:
 *   - Intent Integrity (Was the user request preserved without invention/loss?)
 *   - Task Quality (Did optimization improve verifiability, clarity, and cost?)
 *
 * @param {string} originalPrompt
 * @param {string} compiledPrompt
 * @param {import("../spec/model.js").ProjectSpec} spec
 * @returns {{ intentIntegrity: object, taskQuality: object, ok: boolean }}
 */
export function verifyCompilation(originalPrompt, compiledPrompt, spec) {
  const validation = validateAll(originalPrompt, compiledPrompt, spec);
  const quota = evaluatePromptQualityAndQuota(originalPrompt, compiledPrompt, spec);

  const intentIntegrity = {
    preserved: validation.preservation.passed,
    missingWords: validation.preservation.missingWords || [],
    safetyPassed: validation.safety.passed,
    inventedConcepts: validation.safety.inventedConcepts || [],
    contradictionsDetected: validation.safety.contradictions || [],
    additionsTraceable: validation.safety.passed && validation.preservation.passed,
    verdict: validation.valid ? "INTACT" : "FLAGGED",
  };

  const taskQuality = {
    clarity: quota.optimizedScore.clarity,
    completeness: quota.optimizedScore.completeness,
    efficiency: quota.optimizedScore.efficiency,
    scopeControl: quota.optimizedScore.scopeControl,
    verifiability: quota.optimizedScore.verifiability,
    compositeScore: quota.optimizedScore.composite,
    estimatedTurns: quota.optimizedScore.estimatedTurns,
    tokenCount: quota.tokenCount,
    loopRisk: quota.optimizedScore.loopRisk,
  };

  return {
    ok: validation.valid,
    intentIntegrity,
    taskQuality,
    rawValidation: validation,
  };
}

/**
 * 5. Full Traceable Compilation
 * Emits the comprehensive proof-carrying prompt object.
 *
 * @param {import("../spec/model.js").ProjectSpec} spec
 * @param {string} [target="coding-agent"]
 * @returns {object} Full traceable compilation record
 */
export function compileTraceable(spec, target = "coding-agent") {
  const originalPrompt = spec.rawPrompt || "";
  const compiled = compilePrompt(spec, target);
  const compiledText = typeof compiled === "string" ? compiled : JSON.stringify(compiled);

  const verification = verifyCompilation(originalPrompt, compiledText, spec);

  const preservedItems = spec.allItems()
    .filter((i) => i.provenance === PROVENANCE.USER_STATED && i.status !== STATUS.REJECTED)
    .map((i) => ({ id: i.id, text: i.text, category: i.category }));

  const clarifiedItems = spec.allItems()
    .filter((i) => i.category === ITEM_CATEGORY.ACCEPTED_DECISION)
    .map((i) => ({ id: i.id, text: i.text, sourceQuestion: i.relatedItems }));

  const inferredItems = spec.allItems()
    .filter((i) => i.provenance === PROVENANCE.INFERRED && i.status !== STATUS.REJECTED)
    .map((i) => ({ id: i.id, text: i.text, confidence: i.confidence }));

  const recommendedItems = spec.allItems()
    .filter((i) => i.provenance === PROVENANCE.SYSTEM_RECOMMENDED && i.category !== ITEM_CATEGORY.OPEN_QUESTION)
    .map((i) => ({ id: i.id, text: i.text, confidence: i.confidence }));

  const unresolvedQuestions = spec.openQuestions()
    .map((q) => ({ id: q.id, text: q.text, impact: q.implementationImpact }));

  const removedItems = spec.allItems()
    .filter((i) => i.status === STATUS.REJECTED)
    .map((i) => ({ id: i.id, text: i.text }));

  const acceptanceCriteria = spec.allItems()
    .filter((i) => i.category === ITEM_CATEGORY.ACCEPTANCE_CRITERION)
    .map((i) => i.text);

  const negativeScope = spec.allItems()
    .filter((i) => i.category === ITEM_CATEGORY.CONSTRAINT || i.category === ITEM_CATEGORY.NON_NEGOTIABLE)
    .map((i) => i.text);

  return {
    originalPrompt,
    compiledPrompt: compiled,
    target,
    preservedItems,
    clarifiedItems,
    inferredItems,
    recommendedItems,
    unresolvedQuestions,
    removedItems,
    contradictions: verification.intentIntegrity.contradictionsDetected,
    acceptanceCriteria,
    negativeScope,
    stopConditions: [
      "Stop once all V1 requirements pass self-test verification.",
      "Do not proactively output unrequested future features.",
    ],
    verification,
  };
}

/**
 * 6. Evaluate Downstream AI Output Against Spec
 * @param {import("../spec/model.js").ProjectSpec} spec
 * @param {string} agentOutput
 * @returns {object} Audit evaluation result
 */
export function evaluateOutput(spec, agentOutput) {
  const outLower = String(agentOutput || "").toLowerCase();
  const bindingReqs = spec.binding();
  const results = [];

  let satisfiedCount = 0;
  for (const req of bindingReqs) {
    const words = (req.text || "").toLowerCase().match(/\b[a-z]{4,}\b/g) || [];
    const matched = words.filter((w) => outLower.includes(w)).length;
    const satisfied = words.length > 0 && (matched / words.length) >= 0.6;
    if (satisfied) satisfiedCount++;

    results.push({
      id: req.id,
      text: req.text,
      satisfied,
      matchRatio: words.length > 0 ? (matched / words.length) : 1,
    });
  }

  const coverage = bindingReqs.length > 0 ? (satisfiedCount / bindingReqs.length) : 1;

  return {
    totalRequirements: bindingReqs.length,
    satisfiedRequirements: satisfiedCount,
    coveragePercent: Math.round(coverage * 100),
    verdict: coverage >= 0.8 ? "PASS" : "DRIFT_DETECTED",
    details: results,
  };
}

/**
 * 7. Record Decision on Requirement or Question
 * @param {SpecRepository} repository
 * @param {string} specId
 * @param {{ itemId?: string, questionId?: string, action: string, value?: string, reason?: string }} decision
 * @returns {import("../spec/model.js").ProjectSpec}
 */
export function recordDecision(repository, specId, decision) {
  return repository.update(specId, (spec) => {
    if (decision.questionId && decision.value) {
      spec.answerQuestion(decision.questionId, decision.value);
    } else if (decision.itemId && decision.action) {
      if (decision.action === "accept") spec.acceptItem(decision.itemId, decision.reason);
      else if (decision.action === "reject") spec.rejectItem(decision.itemId, decision.reason);
      else if (decision.action === "defer") spec.deferItem(decision.itemId, decision.reason);
    }
  });
}
