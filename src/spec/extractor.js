// Lemonade — Generic Semantic Extractor.
//
// Domain-independent extraction of structured spec items from raw user prompts.
// Uses Actor-Action-Object-Condition-Result model across all domains.
// Every extracted item carries source span (character offsets) for traceability.
//
// This module NEVER hardcodes domain knowledge. Domain-specific enrichment
// lives in src/domains/ as optional plugins.

import {
  SpecItem, ProjectSpec, PROVENANCE, PRIORITY, SCOPE, STATUS,
  REVERSIBILITY, IMPACT, ITEM_CATEGORY,
} from "./model.js";

// ---- Sentence segmentation ----
export function segmentIntoStatements(rawPrompt) {
  const text = String(rawPrompt ?? "").replace(/\r\n/g, "\n");
  const paragraphs = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const units = [];
  for (const para of paragraphs) {
    const lines = para.split("\n").map((l) => l.trim()).filter(Boolean);
    for (const line of lines) {
      // Split on sentence boundaries but keep the offsets
      const parts = line.split(/(?<=[.?!])\s+(?=[A-Za-z0-9])/g).map((s) => s.trim()).filter(Boolean);
      units.push(...parts);
    }
  }
  return units;
}

// ---- Pattern matchers for semantic classification ----

const CONSTRAINT_PATTERNS = [
  /\b(don't|do not|never|no\s+|cannot|must not|shouldn't|should not|only(?!\s+if)|pickup only|local only|without)\b/i,
  /\b(forbidden|prohibited|excluded|banned|disallowed|restricted)\b/i,
];

const OPTIONAL_PATTERNS = [
  /\b(optional|if practical|if easy|nice to have|if possible|only if|if simple|if not too hard|otherwise skip|bonus|stretch goal|would be cool|cherry on top)\b/i,
];

const FUTURE_PATTERNS = [
  /\b(later|future|next version|down the road|can come later|phase 2|v2|eventually|someday|long term|backlog)\b/i,
];

const SCOPE_EXCLUSION_PATTERNS = [
  /\b(out of scope|off the table|excluded|not for now|not in v1|skip for now)\b/i,
];

const ACCEPTANCE_PATTERNS = [
  /\b(should work|must work|needs to work|done when|success means|acceptance criteria|definition of done|verify that|ensure that)\b/i,
];

const ACTOR_PATTERNS = [
  /\b(user|admin|student|librarian|staff|manager|customer|visitor|guest|owner|moderator|teacher|developer|operator|member)\b/gi,
];

const SECURITY_PATTERNS = [
  /\b(auth|login|password|encrypt|permission|role|access control|token|session|cookie|oauth|jwt|api key|secret|private|gdpr|hipaa|compliance|audit log)\b/i,
];

const WORKFLOW_PATTERNS = [
  /\b(when|after|before|then|if.*then|once|upon|triggers?|transitions?|state machine|flow|pipeline|sequence|step \d)\b/i,
];

const UX_PATTERNS = [
  /\b(clean|modern|mobile|responsive|ui|design|feel|simple|beautiful|sleek|minimal|dark mode|light mode|theme|layout|animation|fast|smooth)\b/i,
];

const TECH_PATTERNS = [
  /\b(react|vue|svelte|angular|node|express|fastapi|django|flask|sqlite|postgres|mongodb|redis|docker|kubernetes|aws|gcp|azure|typescript|python|go|rust|graphql|rest|api|websocket|tailwind|bootstrap)\b/i,
];

const DATA_ENTITY_PATTERNS = [
  /\b(table|collection|model|schema|field|column|record|entity|document|database|store|storage)\b/i,
];

const BOUNDARY_PATTERNS = [
  /\b(basic version|first version|keep it simple|don't over-engineer|don't add random|start small|minimal viable|mvp|incremental|stop once|stop when|stop after)\b/i,
];

// ---- Confidence estimation ----
function estimateConfidence(text, category) {
  const len = text.trim().length;
  // Explicit, specific statements get higher confidence
  if (len > 50) return 0.85;
  if (len > 20) return 0.7;
  return 0.5;
}

// ---- Impact estimation ----
function estimateImpact(text) {
  const t = text.toLowerCase();
  if (SECURITY_PATTERNS.some((p) => p.test(t))) return IMPACT.CRITICAL;
  if (/\b(database|architecture|framework|infrastructure)\b/i.test(t)) return IMPACT.HIGH;
  if (/\b(ui|design|layout|color|font)\b/i.test(t)) return IMPACT.LOW;
  return IMPACT.MEDIUM;
}

// ---- Reversibility estimation ----
function estimateReversibility(text) {
  const t = text.toLowerCase();
  if (/\b(database|schema|auth|architecture|framework|language)\b/i.test(t)) return REVERSIBILITY.COSTLY;
  if (/\b(encryption|gdpr|compliance|legal)\b/i.test(t)) return REVERSIBILITY.IRREVERSIBLE;
  return REVERSIBILITY.REVERSIBLE;
}

// ---- Source span finder ----
function findSourceSpan(raw, segment) {
  const idx = raw.indexOf(segment);
  if (idx >= 0) return { start: idx, end: idx + segment.length };
  // Try case-insensitive
  const lowerIdx = raw.toLowerCase().indexOf(segment.toLowerCase());
  if (lowerIdx >= 0) return { start: lowerIdx, end: lowerIdx + segment.length };
  return null;
}

// ---- Actor extraction ----
function extractActors(rawPrompt) {
  const actors = new Set();
  for (const pattern of ACTOR_PATTERNS) {
    const re = new RegExp(pattern.source, "gi");
    let m;
    while ((m = re.exec(rawPrompt)) !== null) {
      actors.add(m[0].toLowerCase());
    }
  }
  return [...actors];
}

// ---- Question ranking ----
// Rank questions by: ambiguity severity × implementation impact × rework cost × irreversibility
export function rankQuestion(question) {
  let score = 1;
  const t = (question.text || "").toLowerCase();

  // Ambiguity severity
  if (/\b(auth|database|platform|stack)\b/.test(t)) score *= 3;
  else if (/\b(ui|design|color)\b/.test(t)) score *= 1;
  else score *= 2;

  // Implementation impact
  if (/\b(architecture|framework|database)\b/.test(t)) score *= 3;
  else if (/\b(feature|page|component)\b/.test(t)) score *= 2;
  else score *= 1;

  // Rework cost
  if (/\b(schema|data model|api design)\b/.test(t)) score *= 3;
  else score *= 1.5;

  // Irreversibility
  if (/\b(database|auth|encryption|legal)\b/.test(t)) score *= 2;
  else score *= 1;

  return score;
}

/**
 * Extract a structured specification from a raw prompt.
 * Domain-independent. Returns a { goal, items[], actors[], ambiguityGaps[] } result.
 *
 * @param {string} rawPrompt - The user's raw prompt text
 * @returns {{ goal: string, items: SpecItem[], actors: string[], ambiguityGaps: object[] }}
 */
export function extractSpec(rawPrompt) {
  const raw = String(rawPrompt ?? "").trim();
  if (!raw) {
    return { goal: "", items: [], actors: [], ambiguityGaps: [] };
  }

  const items = [];
  const ambiguityGaps = [];
  const segments = segmentIntoStatements(raw);

  // 1. Goal — first substantial sentence
  let goal = "";
  const firstSentence = raw.split(/[.?!]/)[0]?.trim() || "";
  if (firstSentence.length > 10) {
    goal = firstSentence;
  } else {
    goal = segments[0] || raw.slice(0, 100);
  }

  const goalItem = new SpecItem({
    category: ITEM_CATEGORY.GOAL,
    text: goal,
    provenance: PROVENANCE.USER_STATED,
    sourceSpan: findSourceSpan(raw, goal),
    sourceMessage: raw,
    confidence: 0.95,
    priority: PRIORITY.MUST,
    scope: SCOPE.V1,
    status: STATUS.ACCEPTED,
  });
  items.push(goalItem);

  // 2. Extract actors
  const actors = extractActors(raw);

  // 3. Classify each segment
  for (const segment of segments) {
    if (segment === goal && items.length === 1) continue; // skip goal, already added
    if (segment.length < 5) continue;
    if (/^(hi|hello|hey|please help|thanks|thank you)\b/i.test(segment)) continue;

    const sourceSpan = findSourceSpan(raw, segment);
    const sLower = segment.toLowerCase();

    // Determine category and priority
    let category = ITEM_CATEGORY.REQUIREMENT;
    let priority = PRIORITY.MUST;
    let scope = SCOPE.V1;
    let provenance = PROVENANCE.USER_STATED;
    let confidence = estimateConfidence(segment, category);

    // Check for constraints (negative requirements)
    if (CONSTRAINT_PATTERNS.some((p) => p.test(sLower))) {
      category = ITEM_CATEGORY.CONSTRAINT;
      priority = PRIORITY.MUST;
      confidence = 0.9;
    }
    // Check for optional features
    else if (OPTIONAL_PATTERNS.some((p) => p.test(sLower))) {
      category = ITEM_CATEGORY.OPTIONAL;
      priority = PRIORITY.COULD;
      confidence = 0.8;
    }
    // Check for future scope
    else if (FUTURE_PATTERNS.some((p) => p.test(sLower)) || SCOPE_EXCLUSION_PATTERNS.some((p) => p.test(sLower))) {
      category = ITEM_CATEGORY.FUTURE_SCOPE;
      priority = PRIORITY.WONT;
      scope = SCOPE.FUTURE;
      confidence = 0.85;
    }
    // Check for acceptance criteria
    else if (ACCEPTANCE_PATTERNS.some((p) => p.test(sLower))) {
      category = ITEM_CATEGORY.ACCEPTANCE_CRITERION;
      confidence = 0.85;
    }
    // Check for security/privacy requirements
    else if (SECURITY_PATTERNS.some((p) => p.test(sLower)) && CONSTRAINT_PATTERNS.some((p) => p.test(sLower))) {
      category = ITEM_CATEGORY.SECURITY;
      priority = PRIORITY.MUST;
      confidence = 0.9;
    }
    // Check for UX requirements
    else if (UX_PATTERNS.some((p) => p.test(sLower)) && !TECH_PATTERNS.some((p) => p.test(sLower))) {
      // UX statements are requirements but lower impact
      category = ITEM_CATEGORY.REQUIREMENT;
    }
    // Check for tech direction
    else if (TECH_PATTERNS.some((p) => p.test(sLower)) && !/\b(build|create|make)\b/i.test(sLower)) {
      category = ITEM_CATEGORY.REQUIREMENT;
    }
    // Check for boundary statements
    else if (BOUNDARY_PATTERNS.some((p) => p.test(sLower))) {
      category = ITEM_CATEGORY.NON_NEGOTIABLE;
      priority = PRIORITY.MUST;
    }

    // Extract actor-action-object from the segment
    let actor = null, action = null, object = null, condition = null, result = null;

    // Simple actor detection in the segment
    for (const a of actors) {
      if (sLower.includes(a)) { actor = a; break; }
    }

    // Action-object extraction (verb + noun phrase)
    const actionMatch = segment.match(/\b(can|should|must|will|shall|need to|want to|able to)\s+(\w+)\s+(.{3,40}?)(?=[.,;!?]|$)/i);
    if (actionMatch) {
      action = actionMatch[2];
      object = actionMatch[3]?.trim();
    }

    // Condition extraction
    const condMatch = segment.match(/\b(if|when|once|after|before|unless)\s+(.{3,60}?)(?=[.,;!?]|$)/i);
    if (condMatch) {
      condition = condMatch[0].trim();
    }

    // Workflow detection
    const isWorkflow = WORKFLOW_PATTERNS.some((p) => p.test(sLower)) && condMatch;

    const item = new SpecItem({
      category: isWorkflow ? ITEM_CATEGORY.WORKFLOW : category,
      text: segment,
      provenance,
      sourceSpan,
      sourceMessage: raw,
      confidence,
      priority,
      scope,
      status: STATUS.PROPOSED,
      reversibility: estimateReversibility(segment),
      implementationImpact: estimateImpact(segment),
      actor,
      action,
      object,
      condition,
      result,
    });

    items.push(item);
  }

  // 4. Detect ambiguity gaps — things not specified that usually matter
  const rawLower = raw.toLowerCase();

  const gapChecks = [
    { id: "platform", label: "Target platform not specified", check: () => !/\b(web|mobile|desktop|cli|api|browser|ios|android)\b/i.test(rawLower), impact: IMPACT.HIGH, reversibility: REVERSIBILITY.COSTLY },
    { id: "auth", label: "Authentication/authorization not specified", check: () => !/\b(auth|login|sign.?in|register|account|permission|role)\b/i.test(rawLower), impact: IMPACT.CRITICAL, reversibility: REVERSIBILITY.COSTLY },
    { id: "data-model", label: "Data model/entities not specified", check: () => !/\b(database|schema|table|model|entity|field|column|store|storage)\b/i.test(rawLower), impact: IMPACT.HIGH, reversibility: REVERSIBILITY.COSTLY },
    { id: "stack", label: "Technology stack not specified", check: () => !TECH_PATTERNS.some((p) => p.test(rawLower)), impact: IMPACT.HIGH, reversibility: REVERSIBILITY.COSTLY },
    { id: "success-criteria", label: "Success/acceptance criteria not specified", check: () => !ACCEPTANCE_PATTERNS.some((p) => p.test(rawLower)), impact: IMPACT.MEDIUM, reversibility: REVERSIBILITY.REVERSIBLE },
    { id: "deployment", label: "Deployment target not specified", check: () => !/\b(deploy|host|server|cloud|local|production|staging)\b/i.test(rawLower), impact: IMPACT.MEDIUM, reversibility: REVERSIBILITY.REVERSIBLE },
    { id: "error-handling", label: "Error handling strategy not specified", check: () => !/\b(error|fail|fallback|retry|graceful|exception)\b/i.test(rawLower), impact: IMPACT.MEDIUM, reversibility: REVERSIBILITY.REVERSIBLE },
  ];

  for (const gap of gapChecks) {
    if (gap.check()) {
      ambiguityGaps.push({
        id: gap.id,
        label: gap.label,
        impact: gap.impact,
        reversibility: gap.reversibility,
        questionScore: rankQuestion({ text: gap.label }),
      });
    }
  }

  // Sort gaps by question score (highest priority first)
  ambiguityGaps.sort((a, b) => b.questionScore - a.questionScore);

  return { goal, items, actors, ambiguityGaps };
}

/**
 * Build a ProjectSpec from raw prompt extraction.
 * @param {string} rawPrompt
 * @param {string} [title]
 * @returns {import("./model.js").ProjectSpec}
 */
export function buildSpec(rawPrompt, title = "") {
  const extraction = extractSpec(rawPrompt);
  const spec = new ProjectSpec({ rawPrompt, title: title || extraction.goal });

  for (const item of extraction.items) {
    spec.addItem(item);
  }

  // Add open questions for ambiguity gaps
  for (const gap of extraction.ambiguityGaps) {
    spec.addItem(new SpecItem({
      category: ITEM_CATEGORY.OPEN_QUESTION,
      text: gap.label,
      provenance: PROVENANCE.SYSTEM_RECOMMENDED,
      confidence: 0.6,
      priority: PRIORITY.SHOULD,
      scope: SCOPE.V1,
      status: STATUS.PROPOSED,
      implementationImpact: gap.impact,
      reversibility: gap.reversibility,
    }));
  }

  return spec;
}


