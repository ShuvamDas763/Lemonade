// TokenTrim Phase 1 — Intent Gating & Complexity Classifier (Deterministic, zero-dep).
//
// Solves the #1 user complaint: annoying assumption bloat on simple queries.
// Differentiates between:
//   - PASS_THROUGH: Direct questions, syntax snippets, regexes, explanations -> 0 bloat.
//   - LIGHTWEIGHT:  Scoped single-function, utility, or localized test additions.
//   - FULL_SPEC:    Greenfield builds, architectural features, apps, systems -> full safety.

const QUESTION_STARTERS = /^(?:how\s+(?:to|do|can|would|should)|what\s+(?:is|are|does|would)|why\s+(?:is|does|do)|can\s+you\s+(?:explain|show|tell)|explain\b|tell\s+me\s+about|difference\s+between)\b/i;

const SNIPPET_TARGETS = /\b(?:regex|regular\s+expression|sql\s+query|bash\s+command|curl\s+command|format\s+(?:this|json|yaml)|fix\s+(?:typo|spelling|syntax)|convert\s+to\b|one-liner|cheat\s*sheet)\b/i;

const LIGHTWEIGHT_TARGETS = /\b(?:add\s+a\s+(?:function|helper|util|method|route|endpoint|type|interface|test)|write\s+a\s+(?:unit\s+test|test\s+case|helper|validator))\b/i;

const FULL_SPEC_SIGNALS = /\b(?:build|create|make|develop|implement|design)\s+(?:an?\s+)?(?:app|application|system|dashboard|service|platform|clone|tool|tracker|planner|portal|engine|bot|manager|generator|pipeline|widget)\b/i;

/**
 * Classify the intent and complexity level of a user prompt.
 *
 * @param {string} rawPrompt
 * @returns {{ level: "PASS_THROUGH"|"LIGHTWEIGHT"|"FULL_SPEC", reason: string, bypassRewrite: boolean }}
 */
export function classifyIntent(rawPrompt) {
  const text = String(rawPrompt ?? "").trim();
  if (!text) {
    return { level: "PASS_THROUGH", reason: "empty prompt", bypassRewrite: true };
  }

  // 1. Direct Q&A or explanation queries
  if (QUESTION_STARTERS.test(text) && !FULL_SPEC_SIGNALS.test(text)) {
    return {
      level: "PASS_THROUGH",
      reason: "informational question or explanation query",
      bypassRewrite: true,
    };
  }

  // 2. Syntax snippets, regex, trivial formatting
  if (SNIPPET_TARGETS.test(text) && !FULL_SPEC_SIGNALS.test(text)) {
    return {
      level: "PASS_THROUGH",
      reason: "localized syntax, regex, or snippet request",
      bypassRewrite: true,
    };
  }

  // 3. Very short query (< 30 chars) without architectural keywords
  if (text.length < 30 && !/\b(build|app|clone|system|dashboard|service)\b/i.test(text)) {
    return {
      level: "PASS_THROUGH",
      reason: "short localized query with no architectural scope",
      bypassRewrite: true,
    };
  }

  // 4. Scoped function/test additions
  if (LIGHTWEIGHT_TARGETS.test(text) && !FULL_SPEC_SIGNALS.test(text)) {
    return {
      level: "LIGHTWEIGHT",
      reason: "scoped function, test, or helper modification",
      bypassRewrite: false,
    };
  }

  // 5. Default to full specification envelope for greenfield / app building
  return {
    level: "FULL_SPEC",
    reason: "architectural feature, greenfield build, or full-system prompt",
    bypassRewrite: false,
  };
}
