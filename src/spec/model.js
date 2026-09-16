// Lemonade — Canonical Project Specification Model.
//
// Every requirement, constraint, decision, and assumption lives here with:
//   - stable ID
//   - source span (character offsets into original text)
//   - provenance: user-stated | inferred | system-recommended | model-guess
//   - confidence (0–1)
//   - priority: must | should | could | wont
//   - scope: v1 | future | out
//   - status: proposed | accepted | rejected | deferred
//   - reversibility: reversible | costly | irreversible
//   - implementation impact: low | medium | high | critical
//   - timestamp
//
// STRICT RULES:
//   1. Only user-stated items are binding by default.
//   2. Inferred requirements must be visibly labeled.
//   3. System recommendations must be optional.
//   4. Model guesses must NEVER become requirements silently.

import crypto from "node:crypto";

// ---- Constants ----
export const PROVENANCE = Object.freeze({
  USER_STATED: "user-stated",
  INFERRED: "inferred",
  SYSTEM_RECOMMENDED: "system-recommended",
  MODEL_GUESS: "model-guess",
});

export const PRIORITY = Object.freeze({
  MUST: "must",
  SHOULD: "should",
  COULD: "could",
  WONT: "wont",
});

export const SCOPE = Object.freeze({
  V1: "v1",
  FUTURE: "future",
  OUT: "out",
});

export const STATUS = Object.freeze({
  PROPOSED: "proposed",
  ACCEPTED: "accepted",
  REJECTED: "rejected",
  DEFERRED: "deferred",
});

export const REVERSIBILITY = Object.freeze({
  REVERSIBLE: "reversible",
  COSTLY: "costly",
  IRREVERSIBLE: "irreversible",
});

export const IMPACT = Object.freeze({
  LOW: "low",
  MEDIUM: "medium",
  HIGH: "high",
  CRITICAL: "critical",
});

export const ITEM_CATEGORY = Object.freeze({
  GOAL: "goal",
  REQUIREMENT: "requirement",
  INFERRED_REQUIREMENT: "inferred-requirement",
  SYSTEM_RECOMMENDATION: "system-recommendation",
  MODEL_GUESS: "model-guess",
  CONSTRAINT: "constraint",
  NON_NEGOTIABLE: "non-negotiable",
  OPTIONAL: "optional",
  FUTURE_SCOPE: "future-scope",
  OPEN_QUESTION: "open-question",
  ACCEPTED_DECISION: "accepted-decision",
  REJECTED_DECISION: "rejected-decision",
  ACCEPTANCE_CRITERION: "acceptance-criterion",
  ACTOR: "actor",
  DATA_ENTITY: "data-entity",
  WORKFLOW: "workflow",
  SECURITY: "security",
  IMPLEMENTATION_EVIDENCE: "implementation-evidence",
});

export const IMPLEMENTATION_STATUS = Object.freeze({
  IMPLEMENTED: "implemented",
  PARTIALLY_IMPLEMENTED: "partially-implemented",
  NOT_IMPLEMENTED: "not-implemented",
  CONTRADICTED: "contradicted",
  UNVERIFIED: "unverified",
});

// ---- ID Generation ----
let counter = 0;
function stableId(prefix = "ITEM") {
  counter++;
  const ts = Date.now().toString(36);
  const rnd = crypto.randomBytes(3).toString("hex");
  return `${prefix}-${ts}-${rnd}-${counter}`;
}

// ---- SpecItem: every entity in the specification ----
export class SpecItem {
  constructor({
    category,
    text,
    provenance = PROVENANCE.INFERRED,
    sourceSpan = null,
    sourceMessage = null,
    confidence = 0.5,
    priority = PRIORITY.SHOULD,
    scope = SCOPE.V1,
    status = STATUS.PROPOSED,
    reversibility = REVERSIBILITY.REVERSIBLE,
    implementationImpact = IMPACT.MEDIUM,
    id = null,
    actor = null,
    action = null,
    object = null,
    condition = null,
    result = null,
    dataFields = [],
    relatedItems = [],
    implementationStatus = IMPLEMENTATION_STATUS.UNVERIFIED,
    evidence = [],
  } = {}) {
    this.id = id || stableId(category?.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 4) || "ITEM");
    this.category = category;
    this.text = text;
    this.provenance = provenance;
    this.sourceSpan = sourceSpan; // { start, end } character offsets into original prompt
    this.sourceMessage = sourceMessage; // the original text this was extracted from
    this.confidence = Math.max(0, Math.min(1, confidence));
    this.priority = priority;
    this.scope = scope;
    this.status = status;
    this.reversibility = reversibility;
    this.implementationImpact = implementationImpact;
    this.createdAt = new Date().toISOString();
    this.updatedAt = this.createdAt;

    // Semantic structure (Actor-Action-Object-Condition-Result)
    this.actor = actor;
    this.action = action;
    this.object = object;
    this.condition = condition;
    this.result = result;
    this.dataFields = dataFields;

    // Relationships
    this.relatedItems = relatedItems;

    // Implementation tracking
    this.implementationStatus = implementationStatus;
    this.evidence = evidence; // [{ type: "file"|"test"|"commit"|"pr"|"agent-message", ref, timestamp }]
  }

  /** Is this item binding (user-stated or explicitly accepted)? */
  isBinding() {
    if (this.status === STATUS.ACCEPTED) return true;
    return this.provenance === PROVENANCE.USER_STATED && this.status !== STATUS.REJECTED;
  }

  /** Should this item be visibly labeled in output? */
  requiresLabel() {
    return this.provenance !== PROVENANCE.USER_STATED;
  }

  /** Update status and record change. */
  decide(newStatus, reason = "") {
    const old = this.status;
    this.status = newStatus;
    this.updatedAt = new Date().toISOString();
    return { itemId: this.id, from: old, to: newStatus, reason, at: this.updatedAt };
  }

  /** Add implementation evidence. */
  addEvidence(type, ref, detail = "") {
    this.evidence.push({ type, ref, detail, timestamp: new Date().toISOString() });
    this.updatedAt = new Date().toISOString();
  }

  toJSON() {
    return {
      id: this.id,
      category: this.category,
      text: this.text,
      provenance: this.provenance,
      sourceSpan: this.sourceSpan,
      sourceMessage: this.sourceMessage,
      confidence: this.confidence,
      priority: this.priority,
      scope: this.scope,
      status: this.status,
      reversibility: this.reversibility,
      implementationImpact: this.implementationImpact,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      actor: this.actor,
      action: this.action,
      object: this.object,
      condition: this.condition,
      result: this.result,
      dataFields: this.dataFields,
      relatedItems: this.relatedItems,
      implementationStatus: this.implementationStatus,
      evidence: this.evidence,
    };
  }

  static fromJSON(obj) {
    const item = new SpecItem(obj);
    item.id = obj.id;
    item.createdAt = obj.createdAt;
    item.updatedAt = obj.updatedAt;
    return item;
  }
}

// ---- ProjectSpec: the complete specification for a project ----
export class ProjectSpec {
  constructor({ id = null, rawPrompt = "", title = "" } = {}) {
    this.id = id || stableId("SPEC");
    this.version = 1;
    this.title = title;
    this.rawPrompt = rawPrompt;
    this.items = new Map();
    this.changeHistory = []; // [{ action, itemId, detail, timestamp }]
    this.createdAt = new Date().toISOString();
    this.updatedAt = this.createdAt;
  }

  /** Add a spec item with provenance enforcement. */
  addItem(item) {
    if (!(item instanceof SpecItem)) {
      item = new SpecItem(item);
    }
    // STRICT RULE: model guesses cannot be auto-promoted to requirements
    if (item.provenance === PROVENANCE.MODEL_GUESS && item.status === STATUS.ACCEPTED) {
      item.status = STATUS.PROPOSED;
    }
    this.items.set(item.id, item);
    this._recordChange("add", item.id, `Added ${item.category}: ${item.text?.slice(0, 80)}`);
    return item;
  }

  /** Get an item by ID. */
  getItem(id) {
    return this.items.get(id) || null;
  }

  /** Alias for getItem. */
  findItem(id) {
    return this.getItem(id);
  }

  /** Remove an item (soft — marks as rejected, preserves history). */
  removeItem(id, reason = "") {
    const item = this.items.get(id);
    if (!item) return null;
    const change = item.decide(STATUS.REJECTED, reason);
    this._recordChange("reject", id, reason || `Rejected: ${item.text?.slice(0, 80)}`);
    return change;
  }

  /** Decide on an item: accept, reject, or defer. */
  decideItem(id, status, reason = "") {
    const item = this.items.get(id);
    if (!item) return null;
    // STRICT RULE: model guesses require explicit acceptance to become binding
    if (item.provenance === PROVENANCE.MODEL_GUESS && status === STATUS.ACCEPTED) {
      item.provenance = PROVENANCE.INFERRED; // promoted, but still labeled
    }
    const change = item.decide(status, reason);
    this._recordChange(status, id, `${change.from} → ${change.to}: ${reason}`);
    return change;
  }

  /** Accept an item. */
  acceptItem(id, reason = "") {
    return this.decideItem(id, STATUS.ACCEPTED, reason);
  }

  /** Reject an item. */
  rejectItem(id, reason = "") {
    return this.decideItem(id, STATUS.REJECTED, reason);
  }

  /** Defer an item. */
  deferItem(id, reason = "") {
    return this.decideItem(id, STATUS.DEFERRED, reason);
  }

  /** Answer an open question, turning the answer into an accepted decision item. */
  answerQuestion(questionId, answer) {
    const q = this.items.get(questionId);
    if (!q) return null;
    this.decideItem(questionId, STATUS.ACCEPTED, `Answered: ${answer}`);
    const decisionItem = new SpecItem({
      category: ITEM_CATEGORY.ACCEPTED_DECISION,
      text: answer,
      provenance: PROVENANCE.USER_STATED,
      priority: PRIORITY.MUST,
      status: STATUS.ACCEPTED,
      relatedItems: [questionId],
    });
    this.addItem(decisionItem);
    return decisionItem;
  }

  /** Timeline getter (alias for changeHistory). */
  get timeline() {
    return this.changeHistory;
  }

  // ---- Query methods ----

  /** All items of a given category. */
  byCategory(category) {
    return [...this.items.values()].filter((i) => i.category === category);
  }

  /** All items of a given provenance. */
  byProvenance(provenance) {
    return [...this.items.values()].filter((i) => i.provenance === provenance);
  }

  /** All items with a given status. */
  byStatus(status) {
    return [...this.items.values()].filter((i) => i.status === status);
  }

  /** All binding items (user-stated or explicitly accepted). */
  binding() {
    return [...this.items.values()].filter((i) => i.isBinding());
  }

  /** All items that require visible labeling (non-user-stated). */
  labeled() {
    return [...this.items.values()].filter((i) => i.requiresLabel());
  }

  /** All open questions. */
  openQuestions() {
    return this.byCategory(ITEM_CATEGORY.OPEN_QUESTION).filter((i) => i.status === STATUS.PROPOSED);
  }

  /** User-stated requirements only. */
  userRequirements() {
    return [...this.items.values()].filter(
      (i) => i.provenance === PROVENANCE.USER_STATED &&
        (i.category === ITEM_CATEGORY.REQUIREMENT || i.category === ITEM_CATEGORY.CONSTRAINT || i.category === ITEM_CATEGORY.NON_NEGOTIABLE)
    );
  }

  /** Implementation coverage summary. */
  implementationCoverage() {
    const binding = this.binding();
    const total = binding.length;
    if (total === 0) return { total: 0, implemented: 0, partial: 0, missing: 0, contradicted: 0, unverified: 0, coverage: 1 };
    const counts = { implemented: 0, partial: 0, missing: 0, contradicted: 0, unverified: 0 };
    for (const item of binding) {
      switch (item.implementationStatus) {
        case IMPLEMENTATION_STATUS.IMPLEMENTED: counts.implemented++; break;
        case IMPLEMENTATION_STATUS.PARTIALLY_IMPLEMENTED: counts.partial++; break;
        case IMPLEMENTATION_STATUS.NOT_IMPLEMENTED: counts.missing++; break;
        case IMPLEMENTATION_STATUS.CONTRADICTED: counts.contradicted++; break;
        default: counts.unverified++; break;
      }
    }
    return {
      total,
      ...counts,
      coverage: total > 0 ? (counts.implemented + counts.partial * 0.5) / total : 0,
    };
  }

  /** All items as flat array. */
  allItems() {
    return [...this.items.values()];
  }

  // ---- Serialization ----

  toJSON() {
    return {
      id: this.id,
      version: this.version,
      title: this.title,
      rawPrompt: this.rawPrompt,
      items: [...this.items.values()].map((i) => i.toJSON()),
      changeHistory: this.changeHistory,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }

  static fromJSON(obj) {
    const spec = new ProjectSpec({ id: obj.id, rawPrompt: obj.rawPrompt, title: obj.title });
    spec.version = obj.version || 1;
    spec.createdAt = obj.createdAt;
    spec.updatedAt = obj.updatedAt;
    spec.changeHistory = obj.changeHistory || [];
    for (const itemData of (obj.items || [])) {
      const item = SpecItem.fromJSON(itemData);
      spec.items.set(item.id, item);
    }
    return spec;
  }

  // ---- Internal ----

  _recordChange(action, itemId, detail) {
    this.changeHistory.push({ action, itemId, detail, timestamp: new Date().toISOString() });
    this.updatedAt = new Date().toISOString();
  }
}
