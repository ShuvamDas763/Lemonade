#!/usr/bin/env node
// Lemonade Boundary & Contradiction Verification Suite
//
// Tests Section 39 boundary conditions, contradiction detection, invented requirement detection,
// and diagnostic requirement ledger accounting.

import { optimizePrompt, auditRequirements, evaluateQuality } from "../phase2/optimizer.js";
import { rewrite } from "../phase2/rewriter.js";

let failures = 0;
function check(label, cond) {
  if (!cond) {
    failures++;
    console.error(`  ✗ FAIL: ${label}`);
  } else {
    console.log(`  ✓ PASS: ${label}`);
  }
}

console.log("=================================================");
console.log("Lemonade Boundary & Scope Validation Suite");
console.log("=================================================");

console.log("\n--- 1. Boundary & Priority Classification ---");
{
  // Test A: Optional feature preservation
  const pOpt = "Build a recipe box website. Add notifications if easy; otherwise skip them.";
  const rOpt = optimizePrompt(pOpt);
  check("optional: optimization ok", rOpt.ok);
  check("optional: not promoted to mandatory V1", !rOpt.optimized_prompt.includes("## V1 Requirements — Must Build\n\n* Add notifications"));
  check("optional: present in Optional section", rOpt.optimized_prompt.includes("## Optional / Conditional") && /notifications/i.test(rOpt.optimized_prompt));

  // Test B: Future feature preservation
  const pFut = "Build a recipe box website. Payments can come later.";
  const rFut = optimizePrompt(pFut);
  check("future: optimization ok", rFut.ok);
  check("future: not in mandatory V1", !rFut.optimized_prompt.includes("## V1 Requirements — Must Build\n\n* Payments"));
  check("future: present in Future section", rFut.optimized_prompt.includes("## Future") && /payments/i.test(rFut.optimized_prompt));

  // Test C: Explicit negative constraint
  const pExcl = "Build a recipe box website. Students do not need to login.";
  const rExcl = optimizePrompt(pExcl);
  check("exclusion: preserved in constraints", rExcl.optimized_prompt.includes("## Constraints") && /login/i.test(rExcl.optimized_prompt));

  // Test D: Conditional feature
  const pCond = "Build a study website. Add video calls only if simple; otherwise skip them.";
  const rCond = optimizePrompt(pCond);
  check("conditional: preserved in Optional section", rCond.optimized_prompt.includes("## Optional / Conditional") && /video calls/i.test(rCond.optimized_prompt));

  // Test E: Basic version first boundary
  const pBasic = "Build an expense tracker. Build the basic version first.";
  const rBasic = optimizePrompt(pBasic);
  check("boundary: basic version first preserved", rBasic.optimized_prompt.includes("## Implementation Boundaries") || /basic version/i.test(rBasic.optimized_prompt));

  // Test F: Scope control boundary
  const pScope = "Build an expense tracker. Don't add random features.";
  const rScope = optimizePrompt(pScope);
  check("boundary: scope control preserved", rScope.optimized_prompt.includes("## Implementation Boundaries") || /requested scope/i.test(rScope.optimized_prompt));

  // Test G: Technical preference
  const pTech = "Build a book website. React preferred.";
  const rTech = optimizePrompt(pTech);
  check("tech: React preferred under Technical Direction", rTech.optimized_prompt.includes("## Technical Direction") && /React/i.test(rTech.optimized_prompt));

  // Test H: Deferred decision
  const pDef = "Build a book website. Use whichever database is easiest.";
  const rDef = await rewrite(pDef, { mode: "optimize" });
  check("deferred decision: does not emit blocking questions", rDef.clarifying_questions.length === 0);
}

console.log("\n--- 2. Contradiction Detection ---");
{
  const canteenRaw = `i want to make a website for our college canteen.
students dont need to login just open the website and see the menu.
dont add online payment or complicated delivery stuff. this is just for our college canteen pickup.`;

  // Case 1: Contradicting negative login constraint
  const tamperedLogin = `## Goal\nBuild a college canteen website.\n\n## V1 Requirements — Must Build\n* Students must log in with college credentials.\n* View menu.`;
  const auditLogin = auditRequirements(canteenRaw, tamperedLogin);
  check("contradiction detected: accounts enforced when forbidden", auditLogin.contradictions.length > 0);
  check("scopeDelta counts contradiction", auditLogin.scopeDelta.contradicted > 0);

  const qualLogin = evaluateQuality(canteenRaw, null, tamperedLogin);
  check("gate fails on contradiction", qualLogin.passed === false);

  // Case 2: Contradicting pickup-only constraint
  const tamperedDelivery = `## Goal\nBuild a college canteen website.\n\n## V1 Requirements — Must Build\n* Students view menu.\n* Enable delivery to dorm rooms.`;
  const auditDelivery = auditRequirements(canteenRaw, tamperedDelivery);
  check("contradiction detected: delivery enabled when pickup only", auditDelivery.contradictions.length > 0);

  const qualDelivery = evaluateQuality(canteenRaw, null, tamperedDelivery);
  check("gate fails on delivery contradiction", qualDelivery.passed === false);
}

console.log("\n--- 3. Invented Requirement Detection ---");
{
  const libraryRaw = `i want to build a website for our college library.
students should be able to search for books by name or author and see availability.
keep it simple and locally runnable.`;

  // Output with unrequested Stripe and Barcode scanner
  const tamperedInvention = `## Goal\nBuild a college library.\n\n## V1 Requirements — Must Build\n* Students search books.\n* View book availability.\n* Stripe payment integration for fines.\n* Barcode scanner integration for physical checkouts.`;
  const auditInv = auditRequirements(libraryRaw, tamperedInvention);
  check("invented requirements detected", auditInv.invented.length > 0);
  check("scopeDelta counts added scope", auditInv.scopeDelta.added > 0);

  const qualInv = evaluateQuality(libraryRaw, null, tamperedInvention);
  check("gate fails on major ungrounded inventions", qualInv.passed === false);
}

console.log("\n--- 4. Diagnostic Requirement Ledger ---");
{
  const lostFoundRaw = `I want a college lost and found website. Students should be able to post lost or found things with a photo, title, description, location and date. Other students can search recent posts and filter by lost/found and category. They can send a claim request. The owner can accept or reject it. If accepted, mark the item returned and don't allow more claims. Users should only edit/delete their own posts. There should be login so random people don't spam it. Admin should be able to remove fake/inappropriate posts and see reports. Users can report suspicious posts. Keep it clean and modern, like an official college service and not social media, and make it mobile friendly. React preferred and use the easiest local backend/database. Notifications are optional if simple, otherwise show updates on the website. Email notifications, chat, payments and maps can come later. Build the basic working version first.`;

  const optRes = optimizePrompt(lostFoundRaw, { includeAcceptanceCriteria: true });
  const ledger = optRes.quality.ledger;

  check("ledger extracted categories exist", !!ledger && typeof ledger.extracted === "object");
  check("ledger functional requirements tracked", ledger.extracted.functional > 0);
  check("ledger business rules tracked", ledger.extracted.business_rule > 0);
  check("ledger role permissions tracked", ledger.extracted.role_permission > 0);
  check("ledger data fields tracked", ledger.extracted.data > 0);
  check("ledger boundaries tracked", ledger.extracted.boundary > 0);
  check("ledger preserved count matches extracted", ledger.preserved.functional === ledger.extracted.functional);
  check("ledger scopeDelta added is 0", ledger.scopeDelta.added === 0);
  check("ledger scopeDelta contradicted is 0", ledger.scopeDelta.contradicted === 0);
  check("ledger missing list is empty", ledger.missing.length === 0);
}

console.log("\n=================================================");
if (failures > 0) {
  console.error(`FAILED: ${failures} check(s) failed.`);
  process.exit(1);
} else {
  console.log("ALL CHECKS PASSED: Boundary, contradiction, invention & ledger checks validated.");
  process.exit(0);
}
