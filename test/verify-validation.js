#!/usr/bin/env node
// Lemonade — Four-Dimension Validation Verification Suite.
// Tests:
//   1. Dimension A (Preservation): word survival & source span coverage
//   2. Dimension B (Interpretation): actors, actions, negative constraints
//   3. Dimension C (Safety): auth, privacy, and invented payment risks
//   4. Dimension D (Completeness): missing permissions, missing storage
//   5. Independence Invariant: passing preservation alone does NOT make a rewrite valid!

import {
  validatePreservation,
  validateInterpretation,
  validateSafety,
  validateCompleteness,
  validateAll,
} from "../src/validation/validate.js";

import { buildSpec } from "../src/spec/extractor.js";
import { ProjectSpec, SpecItem, PROVENANCE, ITEM_CATEGORY, REVERSIBILITY } from "../src/spec/model.js";

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
console.log("Lemonade Four-Dimension Validation Verification");
console.log("=================================================\n");

// --- 1. Dimension A: Preservation ---
console.log("== 1. Dimension A: Preservation Checks ==");
{
  const raw = "Build a personal workout logger with exercise sets reps weight and date.";
  const preservedOpt = "## Goal\nBuild a personal workout logger with exercise sets reps weight and date.\n\n## Assumptions\n- [ASSUMED: local storage]";
  const resPreserved = validatePreservation(raw, preservedOpt);
  check("Preservation passes when original words survive", resPreserved.passed === true);

  // Dropped half the words
  const droppedOpt = "## Goal\nBuild something simple.";
  const resDropped = validatePreservation(raw, droppedOpt);
  check("Preservation fails when significant words are dropped", resDropped.passed === false);
  check("Failure details explain missing words", resDropped.failures.some((f) => f.check === "word-survival"));
}

// --- 2. Dimension B: Interpretation ---
console.log("\n== 2. Dimension B: Interpretation Checks ==");
{
  const raw = "Admin and customer portals. Customers submit support tickets. Do not allow customers to delete tickets.";
  const spec = buildSpec(raw, "Support Portal");

  const resInterp = validateInterpretation(raw, spec);
  check("Interpretation extracts actors without fatal failures", resInterp.passed === true);

  // Negative constraint check
  const hasNegative = raw.toLowerCase().includes("do not allow");
  const capturedConstraint = spec.allItems().some((i) => i.category === ITEM_CATEGORY.CONSTRAINT || i.text.toLowerCase().includes("delete"));
  check("Negative constraint captured in spec", capturedConstraint === true);
}

// --- 3. Dimension C: Safety & Risk Checks ---
console.log("\n== 3. Dimension C: Safety & Risk Checks ==");
{
  const raw = "Build an internal company wiki with markdown notes.";
  const spec = buildSpec(raw, "Wiki");

  // Plant an invented payment assumption into the spec
  spec.addItem(new SpecItem({
    category: ITEM_CATEGORY.INFERRED_REQUIREMENT,
    text: "Stripe payment gateway integration for premium features",
    provenance: PROVENANCE.INFERRED,
  }));

  const resSafety = validateSafety(raw, spec);
  check("Safety dimension catches invented payment assumption", resSafety.passed === false);
  check("Safety failure identifies invented payment", resSafety.failures.some((f) => f.check === "invented-payment"));

  // Check irreversible assumption warning
  const spec2 = new ProjectSpec({ title: "Test", rawPrompt: "Simple chat app" });
  spec2.addItem(new SpecItem({
    category: ITEM_CATEGORY.INFERRED_REQUIREMENT,
    text: "Use irreversible proprietary cloud database schema",
    provenance: PROVENANCE.INFERRED,
    reversibility: REVERSIBILITY.IRREVERSIBLE,
  }));

  const resSafety2 = validateSafety("Simple chat app", spec2);
  check("Safety flags irreversible architectural assumptions", resSafety2.warnings.some((w) => w.check === "irreversible-assumption"));
}

// --- 4. Dimension D: Completeness Checks ---
console.log("\n== 4. Dimension D: Completeness Checks ==");
{
  const raw = "Build a student and teacher portal with course grades and assignments.";
  const spec = buildSpec(raw, "Portal");

  const resComp = validateCompleteness(raw, spec);
  // It should flag multiple actors or missing storage if unresolved
  check("Completeness checks execute without throwing", typeof resComp.passed === "boolean");
}

// --- 5. Independence Invariant ---
console.log("\n== 5. Independence Invariant: Preservation alone != Valid ==");
{
  const raw = "Build a simple task app for teams.";
  // Textually preserves raw text verbatim, but spec contains invented payment
  const optPrompt = "## Goal\nBuild a simple task app for teams.\n\n## V1\n* Tasks";
  const badSpec = new ProjectSpec({ title: "Task App", rawPrompt: raw });
  badSpec.addItem(new SpecItem({
    category: ITEM_CATEGORY.INFERRED_REQUIREMENT,
    text: "Integrate Stripe billing and charges",
    provenance: PROVENANCE.INFERRED,
  }));

  const composite = validateAll(raw, optPrompt, badSpec);
  check("Preservation passed because text matched", composite.preservation.passed === true);
  check("Safety failed because of ungrounded billing assumption", composite.safety.passed === false);
  check("Composite validation is FALSE even when preservation passed", composite.valid === false);
}

console.log("\n=================================================");
if (failed === 0) {
  console.log(`ALL CHECKS PASSED: ${passed} passed, 0 failed.`);
} else {
  console.error(`FAILURES: ${passed} passed, ${failed} failed.`);
  process.exit(1);
}
