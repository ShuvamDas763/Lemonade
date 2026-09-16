#!/usr/bin/env node
// Lemonade — Automated Persistence & Restart Recovery Verification Suite
//
// Tests that specifications persisted to disk:
//   1. Are atomically saved without corruption.
//   2. Rehydrate properly into full ProjectSpec class instances with all methods.
//   3. Retain complete history and item relationships after simulated process crash/restart.
//   4. Allow updates, question resolution, and exports on restored specifications.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { SpecRepository } from "../src/spec/repository.js";
import { ProjectSpec, SpecItem, PROVENANCE, STATUS, ITEM_CATEGORY } from "../src/spec/model.js";
import { exportAgentPrompt, exportToMarkdown, exportToJSON } from "../src/spec/exporter.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_DATA_DIR = path.join(__dirname, "scratch", "test-specs");

// Clean test dir
if (fs.existsSync(TEST_DATA_DIR)) {
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
}
fs.mkdirSync(TEST_DATA_DIR, { recursive: true });

let passed = 0;
let failed = 0;

function check(label, condition, detail = "") {
  if (condition) {
    passed++;
    console.log(`  ✓ PASS: ${label}`);
  } else {
    failed++;
    console.error(`  ✗ FAIL: ${label}${detail ? " -> " + detail : ""}`);
  }
}

console.log("=================================================");
console.log("Lemonade Persistence & Hydration Verification Suite");
console.log("=================================================\n");

// --- STEP 1: Create spec and save atomically ---
console.log("--- 1. Atomic Persistence ---");
const repo1 = new SpecRepository(TEST_DATA_DIR);

const spec = new ProjectSpec({
  rawPrompt: "Build a customer feedback portal where users submit ratings without accounts.",
  title: "Customer Feedback Portal",
});

const req1 = new SpecItem({
  category: ITEM_CATEGORY.REQUIREMENT,
  text: "Users can submit ratings without accounts.",
  provenance: PROVENANCE.USER_STATED,
  status: STATUS.PROPOSED,
});
spec.addItem(req1);

const q1 = new SpecItem({
  category: ITEM_CATEGORY.OPEN_QUESTION,
  text: "Should submissions be rate-limited by IP address?",
  provenance: PROVENANCE.SYSTEM_RECOMMENDED,
  status: STATUS.PROPOSED,
});
spec.addItem(q1);

repo1.create(spec);

const savedFile = path.join(TEST_DATA_DIR, `${spec.id}.json`);
check("File exists on disk", fs.existsSync(savedFile));
check("No leftover .tmp files on disk", fs.readdirSync(TEST_DATA_DIR).filter((f) => f.includes(".tmp.")).length === 0);

// --- STEP 2: Simulate process crash / server restart ---
console.log("\n--- 2. Server Restart & Hydration ---");
// Create a completely new repository instance simulating process resurrection
const repo2 = new SpecRepository(TEST_DATA_DIR);

const restored = repo2.get(spec.id);
check("Restored spec is not null", restored !== null);
check("Restored spec is instance of ProjectSpec", restored instanceof ProjectSpec);
check("Restored spec preserves title", restored.title === "Customer Feedback Portal");
check("Restored spec preserves rawPrompt", restored.rawPrompt.includes("customer feedback portal"));
check("Restored spec has 2 items", restored.items.size === 2);

const restoredReq = restored.findItem(req1.id);
check("Restored item is instance of SpecItem", restoredReq instanceof SpecItem);
check("Restored item has text", restoredReq.text === req1.text);
check("Restored item is binding", restoredReq.isBinding() === true);

// --- STEP 3: Mutate restored spec & answer question ---
console.log("\n--- 3. Mutation & Decision on Restored Spec ---");
restored.acceptItem(restoredReq.id, "Approved by admin");
check("Status updated to accepted", restoredReq.status === STATUS.ACCEPTED);

const decision = restored.answerQuestion(q1.id, "Yes, rate-limit to 5 ratings per minute per IP.");
check("Question answered and decision created", decision !== null);
check("Decision has user-stated provenance", decision.provenance === PROVENANCE.USER_STATED);
check("Open questions list is now 0", restored.openQuestions().length === 0);

repo2.save(restored);

// --- STEP 4: Simulate second restart and verify changes survived ---
console.log("\n--- 4. Second Restart Verification ---");
const repo3 = new SpecRepository(TEST_DATA_DIR);
const restored2 = repo3.get(spec.id);

check("Restored2 has 3 items (including answered decision)", restored2.items.size === 3);
const restoredReq2 = restored2.findItem(req1.id);
check("Req status remains accepted after 2nd restart", restoredReq2.status === STATUS.ACCEPTED);
check("Timeline recorded acceptance and answer", restored2.timeline.length >= 3);

// --- STEP 5: Exporting Restored Spec ---
console.log("\n--- 5. Export Execution on Restored Spec ---");
const agentPrompt = exportAgentPrompt(restored2);
check("Export agent prompt succeeds", typeof agentPrompt === "string" && agentPrompt.length > 50);
check("Export includes accepted decision", agentPrompt.includes("rate-limit"));

const mdExport = exportToMarkdown(restored2, { mode: "builder" });
check("Export markdown builder succeeds", typeof mdExport === "string" && mdExport.includes("## V1 Requirements"));

const jsonExport = exportToJSON(restored2);
check("Export JSON succeeds", typeof jsonExport === "string" && JSON.parse(jsonExport).id === spec.id);

// --- STEP 6: Listing and Deleting ---
console.log("\n--- 6. Listing and Deletion ---");
const list = repo3.list();
check("Repository list returns 1 spec", list.length === 1);
check("List item has correct metadata", list[0].id === spec.id && list[0].itemCount === 3);

const deleted = repo3.delete(spec.id);
check("Spec deleted successfully", deleted === true);
check("File removed from disk", !fs.existsSync(savedFile));
check("Get returns null after deletion", repo3.get(spec.id) === null);

// Clean test dir
fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });

console.log("\n=================================================");
if (failed === 0) {
  console.log(`ALL PERSISTENCE CHECKS PASSED: ${passed} passed, 0 failed.`);
  process.exit(0);
} else {
  console.error(`FAILURES ENCOUNTERED: ${passed} passed, ${failed} failed.`);
  process.exit(1);
}
