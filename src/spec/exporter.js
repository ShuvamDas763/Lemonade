// Lemonade — Specification Exporter.
// Exports ProjectSpec to Markdown, JSON, agent-ready prompt, and audit report.
// Implements the Prompt Optimizer Agent Rules (3.1 - 3.6) and Quota Economy constraints.

import { PROVENANCE, STATUS, ITEM_CATEGORY, PRIORITY, SCOPE } from "./model.js";

const PROVENANCE_LABELS = {
  [PROVENANCE.USER_STATED]: "",
  [PROVENANCE.INFERRED]: "[ASSUMED: ",
  [PROVENANCE.SYSTEM_RECOMMENDED]: "[RECOMMENDED: ",
  [PROVENANCE.MODEL_GUESS]: "[MODEL GUESS — NON-BINDING: ",
};

function formatAssumed(text, prov) {
  if (prov === PROVENANCE.USER_STATED) return text;
  if (text.startsWith("[ASSUMED") || text.startsWith("[INFERRED") || text.startsWith("[RECOMMENDED")) {
    return text;
  }
  const prefix = PROVENANCE_LABELS[prov] || "[ASSUMED: ";
  return `${prefix}${text}]`;
}

/**
 * Infer deliverable format from user prompt text.
 * Rule 3.1: Always specify the deliverable format.
 */
function inferDeliverableFormat(rawText) {
  const lower = String(rawText ?? "").toLowerCase();

  if (lower.includes("one file") || lower.includes("single file") || lower.includes("all in one") || (lower.includes("html") && lower.includes("css") && lower.includes("javascript"))) {
    return "Single standalone `index.html` file containing inline HTML, CSS, and JavaScript. Runnable immediately by opening in any browser with zero build setup or local servers.";
  }
  if (lower.includes("cli") || lower.includes("command line") || lower.includes("terminal tool")) {
    return "Single standalone executable CLI script with zero external runtime dependencies.";
  }
  if (lower.includes("react") && lower.includes("node")) {
    return "Standard Node.js / React project structure with clearly separated client and server entry points.";
  }
  if (lower.includes("react") || lower.includes("vite")) {
    return "Complete frontend web application code ready to run locally.";
  }

  return "Complete, runnable source code deliverable (ready to save and execute locally, with zero placeholder code).";
}

/**
 * Infer concrete lightweight self-test verification steps.
 * Rule 3.6: Lightweight self-test verification step.
 */
function inferSelfTestSteps(spec, rawText) {
  const criteria = spec.byCategory(ITEM_CATEGORY.ACCEPTANCE_CRITERION).filter((i) => i.status !== STATUS.REJECTED);
  if (criteria.length > 0) {
    return criteria.slice(0, 3).map((c) => c.text);
  }

  const reqs = spec.byCategory(ITEM_CATEGORY.REQUIREMENT).filter((i) => i.status !== STATUS.REJECTED);
  const steps = [];

  const lower = String(rawText ?? "").toLowerCase();
  if (lower.includes("add") && (lower.includes("done") || lower.includes("delete") || lower.includes("mark"))) {
    steps.push("Add 2 items, toggle 1 complete, and reload the browser: verify state persists accurately.");
    steps.push("Delete an item: verify it is permanently removed from the view and storage.");
  } else if (reqs.length > 0) {
    steps.push(`Verify the primary happy-path flow: execute '${reqs[0].text.slice(0, 70)}'.`);
    if (reqs.length > 1) {
      steps.push(`Verify secondary requirement: '${reqs[1].text.slice(0, 70)}'.`);
    }
  } else {
    steps.push("Run initial application startup and verify zero console errors or uncaught exceptions.");
    steps.push("Verify that all user-stated features respond to input as expected.");
  }

  return steps;
}

/**
 * Infer protective negative constraints (Must NOT Build).
 * Rule 3.2: Separate "must build" from "must not build".
 */
function inferNegativeConstraints(spec, rawText) {
  const explicitConstraints = spec.byCategory(ITEM_CATEGORY.CONSTRAINT).filter((i) => i.status !== STATUS.REJECTED);
  const nonNeg = spec.byCategory(ITEM_CATEGORY.NON_NEGOTIABLE).filter((i) => i.status !== STATUS.REJECTED);
  const negativeList = [];

  for (const c of [...explicitConstraints, ...nonNeg]) {
    negativeList.push(c.text);
  }

  const lower = String(rawText ?? "").toLowerCase();

  // Guard against unrequested frameworks
  if (lower.includes("no framework") || lower.includes("without framework") || lower.includes("vanilla") || lower.includes("plain js")) {
    if (!negativeList.some((n) => n.toLowerCase().includes("framework"))) {
      negativeList.push("DO NOT use any external libraries or frameworks (no React, Vue, Tailwind, Bootstrap, jQuery).");
    }
  }

  // Guard against unrequested backend / database
  if (!lower.includes("backend") && !lower.includes("server") && !lower.includes("api") && !lower.includes("sql") && !lower.includes("database")) {
    if (!negativeList.some((n) => n.toLowerCase().includes("backend"))) {
      negativeList.push("DO NOT build backend servers, cloud APIs, or database connections for V1.");
    }
  }

  // Guard against unrequested authentication
  if (!lower.includes("login") && !lower.includes("auth") && !lower.includes("password") && !lower.includes("account") && !lower.includes("sso")) {
    if (!negativeList.some((n) => n.toLowerCase().includes("auth") || n.toLowerCase().includes("login"))) {
      negativeList.push("DO NOT implement user authentication, login screens, or multi-user accounts for V1.");
    }
  }

  // Default runaway scope guard
  negativeList.push("DO NOT proactively add unrequested features, subtasks, third-party integrations, or telemetry.");

  return negativeList;
}

/**
 * Export a ProjectSpec to a structured agent-ready markdown prompt.
 * @param {import("./model.js").ProjectSpec} spec
 * @param {object} [options]
 * @param {"minimal"|"builder"|"agent"|"audit"|"json"|"interactive"} [options.mode="agent"]
 * @returns {string}
 */
export function exportToMarkdown(spec, { mode = "agent" } = {}) {
  if (!spec) return "";
  const sections = [];
  const raw = spec.rawPrompt?.trim() || "";
  const rawLower = raw.toLowerCase();
  const isIterativeV2 = rawLower.includes("v2") || rawLower.includes("update") || rawLower.includes("modify") || rawLower.includes("add to existing") || rawLower.includes("extend");

  // 1. Deliverable Format — Rule 3.1 & Rule 2.4 (Front-loaded for small/free model tiers)
  if (mode === "agent" || mode === "builder") {
    sections.push("## Deliverable Format (Rule 3.1)\n");
    sections.push(inferDeliverableFormat(raw));
    sections.push("");
  }

  // 2. Goal (Verbatim source of truth)
  const goals = spec.byCategory(ITEM_CATEGORY.GOAL);
  sections.push("## Goal (verbatim from the user — source of truth)\n");
  sections.push(raw || (goals[0] ? goals[0].text : "Build application as specified."));
  sections.push("");

  // 3. State Preservation Guard (Rule 3.3) — For iterative V2+ builds
  if (isIterativeV2 && (mode === "agent" || mode === "builder")) {
    sections.push("## State Preservation — Non-Negotiable (Rule 3.3)\n");
    sections.push("DO NOT modify, rewrite, or regress working baseline features:");
    sections.push("* Retain all previously working core logic and event handlers.");
    sections.push("* Maintain backward compatibility with existing storage schemas.");
    sections.push("* Do not discard working UI styles when adding new elements.");
    sections.push("");
  }

  // 4. Must Build — Positive Scope (Rule 3.2)
  const reqs = spec.allItems().filter((i) =>
    i.category === ITEM_CATEGORY.REQUIREMENT &&
    i.provenance === PROVENANCE.USER_STATED &&
    i.status !== STATUS.REJECTED &&
    i.scope === SCOPE.V1
  );
  if (reqs.length > 0) {
    sections.push("## V1 Requirements — Must Build\n");
    for (const r of reqs) sections.push(`* ${r.text}`);
    sections.push("");
  }

  // 5. Must NOT Build — Negative Constraints (Rule 3.2)
  const negativeConstraints = inferNegativeConstraints(spec, raw);
  if (negativeConstraints.length > 0) {
    sections.push("## Negative Constraints — Must NOT Build (Rule 3.2)\n");
    for (const c of negativeConstraints) sections.push(`* ${c}`);
    sections.push("");
  }

  // 6. Actors & Permissions (Builder mode)
  const actors = spec.byCategory(ITEM_CATEGORY.ACTOR).filter((i) => i.status !== STATUS.REJECTED);
  if (actors.length > 0 && mode !== "minimal") {
    sections.push("## Actors & Permissions\n");
    for (const a of actors) sections.push(`* ${a.text}`);
    sections.push("");
  }

  // 7. Workflows & Lifecycle
  const workflows = spec.byCategory(ITEM_CATEGORY.WORKFLOW).filter((i) => i.status !== STATUS.REJECTED);
  if (workflows.length > 0 && mode !== "minimal") {
    sections.push("## Workflows & State Transitions\n");
    for (const w of workflows) sections.push(`* ${w.text}`);
    sections.push("");
  }

  // 8. Data Entities & Persistence
  const dataEntities = spec.byCategory(ITEM_CATEGORY.DATA_ENTITY).filter((i) => i.status !== STATUS.REJECTED);
  if (dataEntities.length > 0 && mode !== "minimal") {
    sections.push("## Data Entities & Storage\n");
    for (const d of dataEntities) sections.push(`* ${d.text}`);
    sections.push("");
  }

  // 9. Explicit Assumptions & Ambiguity Resolution (Rule 3.5 — Visible, Never Silent)
  const inferred = spec.allItems().filter((i) =>
    (i.provenance === PROVENANCE.INFERRED || i.provenance === PROVENANCE.SYSTEM_RECOMMENDED) &&
    i.category !== ITEM_CATEGORY.OPEN_QUESTION &&
    i.status !== STATUS.REJECTED
  );
  if (inferred.length > 0) {
    sections.push("## Explicit Assumptions & Ambiguity Resolution (Rule 3.5 — Visible)\n");
    for (const a of inferred) {
      sections.push(`* ${formatAssumed(a.text, a.provenance)}`);
    }
    sections.push("");
  } else if (mode === "agent" || mode === "builder") {
    sections.push("## Explicit Assumptions & Ambiguity Resolution (Rule 3.5 — Visible)\n");
    sections.push("* [ASSUMED: Single-user local-first execution; data persists in browser localStorage with zero external cloud dependencies.]");
    if (rawLower.includes("clean") || rawLower.includes("modern") || rawLower.includes("simple")) {
      sections.push("* [ASSUMED: Visual aesthetic interpreted conservatively — clean sans-serif typography, soft neutral palette, standard system components.]");
    }
    sections.push("");
  }

  // 10. Lightweight Self-Test Verification Checklist (Rule 3.6)
  if (mode === "agent" || mode === "builder") {
    const testSteps = inferSelfTestSteps(spec, raw);
    sections.push("## Lightweight Self-Test Verification (Rule 3.6)\n");
    sections.push("Verify these items before declaring completion:");
    testSteps.forEach((s, idx) => sections.push(`${idx + 1}. ${s}`));
    sections.push("");
  }

  // 11. Implementation Rules & Stop Condition (Rule 3.4 — Hard Quota Shield)
  if (mode === "agent" || mode === "builder") {
    sections.push("## Implementation Rules & Scope Boundaries\n");
    sections.push("1. Incremental build: start with the smallest working end-to-end V1 prototype.");
    sections.push("2. Scope boundary: strictly adhere to the 'Must Build' vs 'Must NOT Build' lists.");
    sections.push("3. Dependencies: prefer built-in solutions; minimize external packages.");
    sections.push("4. Testing: fix root errors immediately rather than working around them.");
    sections.push("5. Stop condition (Rule 3.4): Stop and summarize once the deliverable is complete and all self-test steps pass. Do not proactively output unrequested V2 features.");
    sections.push("");
  }

  // 12. Future Scope
  const future = spec.byCategory(ITEM_CATEGORY.FUTURE_SCOPE).filter((i) => i.status !== STATUS.REJECTED);
  if (future.length > 0) {
    sections.push("## Future Scope (out of V1)\n");
    for (const f of future) sections.push(`* ${f.text}`);
    sections.push("");
  }

  // 13. Open Questions (interactive/audit/builder modes)
  const questions = spec.openQuestions();
  if (questions.length > 0 && (mode === "interactive" || mode === "audit" || mode === "builder")) {
    sections.push("## Open Questions\n");
    for (const q of questions) sections.push(`* ${q.text}`);
    sections.push("");
  }

  // 14. Audit mode coverage
  if (mode === "audit") {
    const coverage = spec.implementationCoverage();
    sections.push("## Implementation Coverage\n");
    sections.push(`- Total binding requirements: ${coverage.total}`);
    sections.push(`- Implemented: ${coverage.implemented}`);
    sections.push(`- Partially implemented: ${coverage.partial}`);
    sections.push(`- Not implemented: ${coverage.missing}`);
    sections.push(`- Contradicted: ${coverage.contradicted}`);
    sections.push(`- Unverified: ${coverage.unverified}`);
    sections.push(`- Coverage: ${(coverage.coverage * 100).toFixed(0)}%`);
    sections.push("");
  }

  return sections.join("\n").trim();
}

/**
 * Export a ProjectSpec to JSON.
 * @param {import("./model.js").ProjectSpec} spec
 * @returns {string}
 */
export function exportToJSON(spec) {
  if (!spec) return "{}";
  return JSON.stringify(spec.toJSON(), null, 2);
}

/**
 * Export a compact agent-ready prompt optimized for 1-shot completion and low token quota.
 * @param {import("./model.js").ProjectSpec} spec
 * @returns {string}
 */
export function exportAgentPrompt(spec) {
  return exportToMarkdown(spec, { mode: "agent" });
}

/**
 * Export an audit report with full provenance and coverage details.
 * @param {import("./model.js").ProjectSpec} spec
 * @returns {string}
 */
export function exportAuditReport(spec) {
  return exportToMarkdown(spec, { mode: "audit" });
}
