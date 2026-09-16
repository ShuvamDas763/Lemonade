#!/usr/bin/env node
// Lemonade — Canonical Specification Model Verification Suite.
// Verifies:
//   1. SpecItem and ProjectSpec instantiation and validation
//   2. Provenance rules: model guesses never become requirements silently
//   3. Item status mutation & decision timeline tracking
//   4. Question answering and spec refinement
//   5. Serialization / deserialization round-trip integrity
//   6. Implementation coverage and drift reporting
//   7. Exporter formats: minimal, builder, agent, audit, json, interactive

import {
  ProjectSpec,
  SpecItem,
  PROVENANCE,
  PRIORITY,
  SCOPE,
  STATUS,
  REVERSIBILITY,
  IMPACT,
  ITEM_CATEGORY,
  IMPLEMENTATION_STATUS,
} from "../src/spec/model.js";

import {
  exportToMarkdown,
  exportToJSON,
  exportAgentPrompt,
  exportAuditReport,
} from "../src/spec/exporter.js";

import { buildSpec } from "../src/spec/extractor.js";

let passed = 0;
let failed = 0;

function check(label, cond) {
  if (cond) {
    passed++;
    console.log(`  ✓ PASS: ${label}`);
  } else {
    failed++;
    console.error(`  ✗ FAIL: ${label}`);
  }
}

console.log("=================================================");
console.log("Lemonade Specification Model Verification Suite");
console.log("=================================================\n");

// --- 1. SpecItem Invariants ---
console.log("== 1. SpecItem Invariants & Validation ==");
{
  const item = new SpecItem({
    category: ITEM_CATEGORY.REQUIREMENT,
    text: "Students can search for books by author",
    provenance: PROVENANCE.USER_STATED,
    confidence: 0.95,
    priority: PRIORITY.MUST,
    scope: SCOPE.V1,
    status: STATUS.PROPOSED,
    implementationImpact: IMPACT.MEDIUM,
    reversibility: REVERSIBILITY.REVERSIBLE,
  });

  check("Item has stable ID", typeof item.id === "string" && item.id.length > 5);
  check("Item has correct category", item.category === ITEM_CATEGORY.REQUIREMENT);
  check("Item is binding by default because user-stated", item.isBinding() === true);
  check("Item status starts as proposed", item.status === STATUS.PROPOSED);

  // An inferred item must not be binding by default
  const inferredItem = new SpecItem({
    category: ITEM_CATEGORY.INFERRED_REQUIREMENT,
    text: "Use SQLite database locally",
    provenance: PROVENANCE.INFERRED,
    confidence: 0.6,
  });
  check("Inferred item is not binding by default", inferredItem.isBinding() === false);

  // Model guess item
  const guessItem = new SpecItem({
    category: ITEM_CATEGORY.MODEL_GUESS,
    text: "Add Stripe payment processing",
    provenance: PROVENANCE.MODEL_GUESS,
  });
  check("Model guess is not binding", guessItem.isBinding() === false);
}

// --- 2. ProjectSpec Life Cycle & Decision Tracking ---
console.log("\n== 2. ProjectSpec Mutations & Decision Timeline ==");
{
  const spec = new ProjectSpec({
    title: "Campus Marketplace",
    rawPrompt: "Build a campus marketplace for used textbooks. Students can post and buy books.",
  });

  check("Spec initialized with title", spec.title === "Campus Marketplace");
  check("Spec raw prompt preserved", spec.rawPrompt.toLowerCase().includes("campus marketplace"));

  const req1 = spec.addItem(new SpecItem({
    category: ITEM_CATEGORY.REQUIREMENT,
    text: "Students can post books with photo and price",
    provenance: PROVENANCE.USER_STATED,
    priority: PRIORITY.MUST,
  }));

  const q1 = spec.addItem(new SpecItem({
    category: ITEM_CATEGORY.OPEN_QUESTION,
    text: "What payment method should be supported?",
    provenance: PROVENANCE.SYSTEM_RECOMMENDED,
    implementationImpact: IMPACT.HIGH,
  }));

  check("Spec contains added items", spec.allItems().length === 2);
  check("Open questions filter works", spec.openQuestions().length === 1);

  // Accept req1
  spec.acceptItem(req1.id, "User approved requirement");
  check("req1 status updated to accepted", req1.status === STATUS.ACCEPTED);
  check("Timeline recorded acceptance", spec.timeline.some((t) => t.action === "accepted" && t.itemId === req1.id));

  // Answer q1
  spec.answerQuestion(q1.id, "Cash on delivery only for v1");
  check("Answering question marks question accepted", q1.status === STATUS.ACCEPTED);
  check("Answering question generates accepted decision item", spec.allItems().some((i) => i.category === ITEM_CATEGORY.ACCEPTED_DECISION && i.text.includes("Cash on delivery")));
}

// --- 3. JSON Serialization Round-Trip ---
console.log("\n== 3. JSON Serialization Round-Trip Integrity ==");
{
  const original = new ProjectSpec({
    title: "Expense Tracker",
    rawPrompt: "Track expenses with monthly view and category breakdown.",
  });

  original.addItem(new SpecItem({
    category: ITEM_CATEGORY.REQUIREMENT,
    text: "Add expenses with category and amount",
    provenance: PROVENANCE.USER_STATED,
  }));

  const jsonStr = exportToJSON(original);
  check("Export to JSON generates valid JSON", typeof jsonStr === "string" && jsonStr.startsWith("{"));

  const parsed = JSON.parse(jsonStr);
  const reconstructed = ProjectSpec.fromJSON(parsed);

  check("Reconstructed spec matches title", reconstructed.title === original.title);
  check("Reconstructed spec items match count", reconstructed.allItems().length === original.allItems().length);
  check("Reconstructed item preserves text", reconstructed.allItems()[0].text === original.allItems()[0].text);
  check("Reconstructed item preserves provenance", reconstructed.allItems()[0].provenance === PROVENANCE.USER_STATED);
}

// --- 4. Exporter Output Modes ---
console.log("\n== 4. Specification Exporter Output Modes ==");
{
  const raw = "Make a canteen ordering website. Students view menu and place orders. Staff updates status.";
  const spec = buildSpec(raw, "Canteen App");

  const mdMinimal = exportToMarkdown(spec, { mode: "minimal" });
  check("Minimal export includes Goal", mdMinimal.includes("## Goal"));
  check("Minimal export includes V1 Requirements", mdMinimal.includes("## V1 Requirements"));

  const mdAgent = exportAgentPrompt(spec);
  check("Agent export includes Goal and Implementation Rules", mdAgent.includes("## Goal") && mdAgent.includes("## Implementation Rules"));

  const mdAudit = exportAuditReport(spec);
  check("Audit export includes Implementation Coverage", mdAudit.includes("## Implementation Coverage"));

  const mdBuilder = exportToMarkdown(spec, { mode: "builder" });
  check("Builder export produces comprehensive markdown", mdBuilder.length > mdMinimal.length);
}

console.log("\n=================================================");
if (failed === 0) {
  console.log(`ALL CHECKS PASSED: ${passed} passed, 0 failed.`);
} else {
  console.error(`FAILURES: ${passed} passed, ${failed} failed.`);
  process.exit(1);
}
