#!/usr/bin/env node
// Lemonade — Automated Verification for Prompt Optimizer Rules (3.1 - 3.6)
// and Free-Tier Quota Intelligence Engine.

import { buildSpec } from "../src/spec/extractor.js";
import { optimizePrompt } from "../phase2/optimizer.js";
import { exportAgentPrompt, exportToMarkdown } from "../src/spec/exporter.js";
import { evaluatePromptQualityAndQuota, evaluateFiveAxes, calculateDelta, generateBaselinePrompt } from "../src/spec/scoring.js";

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
console.log("Lemonade Prompt Optimizer Rules Verification Suite");
console.log("=================================================\n");

// --- TEST CASE 1: To-Do Web App (V1 Prompt) ---
console.log("--- Test Case 1: To-Do Web App (V1 Prompt) ---");
const todoPromptV1 = `to be able to add tasks, mark them as done, and delete them.
Make it look clean and modern, with a light color scheme — maybe soft blue and white.
Use HTML, CSS, and JavaScript, all in one file so it's easy to test.
Don't use any frameworks. Add a little animation when i check off a task, like a strikethrough effect.`;

const specV1 = buildSpec(todoPromptV1, "To-Do Web App V1");
const agentPromptV1 = exportAgentPrompt(specV1);

// Rule 3.1: Deliverable Format
check("Rule 3.1: Deliverable Format is present", agentPromptV1.includes("## Deliverable Format"));
check("Rule 3.1: Deliverable specifies single standalone index.html", agentPromptV1.toLowerCase().includes("index.html"));

// Rule 3.2: Separate Must Build from Must NOT Build
check("Rule 3.2: Must Build positive scope present", agentPromptV1.includes("## V1 Requirements — Must Build"));
check("Rule 3.2: Must NOT Build negative constraints present", agentPromptV1.includes("## Negative Constraints — Must NOT Build"));
check("Rule 3.2: Prohibits external frameworks", agentPromptV1.toLowerCase().includes("framework"));

// Rule 3.4: Hard Stop Condition
check("Rule 3.4: Hard stop condition is present", agentPromptV1.includes("Stop condition"));
check("Rule 3.4: Stop condition protects against feature creep", agentPromptV1.toLowerCase().includes("do not proactively"));

// Rule 3.5: Visible Assumptions
check("Rule 3.5: Assumptions are labeled visibly [ASSUMED:]", agentPromptV1.includes("[ASSUMED:"));

// Rule 3.6: Lightweight Self-Test Verification Step
check("Rule 3.6: Self-test verification section is present", agentPromptV1.includes("## Lightweight Self-Test Verification"));
check("Rule 3.6: Contains concrete actionable test steps", agentPromptV1.toLowerCase().includes("verify"));

// --- TEST CASE 2: Iterative V2 Prompt (State Preservation Guard) ---
console.log("\n--- Test Case 2: Iterative V2 Prompt (State Preservation Guard) ---");
const todoPromptV2 = `Update my existing to-do app to V2: add due dates and filter tabs (All, Active, Completed).`;
const specV2 = buildSpec(todoPromptV2, "To-Do Web App V2");
const agentPromptV2 = exportAgentPrompt(specV2);

// Rule 3.3: State Preservation
check("Rule 3.3: State preservation section present for V2 prompt", agentPromptV2.includes("## State Preservation — Non-Negotiable"));
check("Rule 3.3: Explicit regression guard against breaking working logic", agentPromptV2.toLowerCase().includes("do not modify") || agentPromptV2.toLowerCase().includes("regress"));

// --- TEST CASE 3: 5-Axis Scoring & Quota Intelligence ---
console.log("\n--- Test Case 3: 5-Axis Scoring & Quota Economics ---");
const evalResult = evaluatePromptQualityAndQuota(todoPromptV1, agentPromptV1, specV1);

check("Baseline naive prompt generated", typeof evalResult.baselinePrompt === "string" && evalResult.baselinePrompt.length > 5);
console.log(`    Baseline Prompt: "${evalResult.baselinePrompt}"`);
console.log(`    Baseline Score: ${evalResult.baselineScore.composite}/100 (Est. Turns: ${evalResult.baselineScore.estimatedTurns})`);
console.log(`    Optimized Score: ${evalResult.optimizedScore.composite}/100 (Est. Turns: ${evalResult.optimizedScore.estimatedTurns})`);
console.log(`    Value Delta (Δ): +${evalResult.delta.compositeDelta} pts, ${evalResult.delta.turnsSaved} turns saved`);

check("Clarity score exceeds 85/100", evalResult.optimizedScore.clarity >= 85);
check("Completeness score exceeds 90/100", evalResult.optimizedScore.completeness >= 90);
check("Scope control score exceeds 90/100", evalResult.optimizedScore.scopeControl >= 90);
check("Verifiability score exceeds 90/100", evalResult.optimizedScore.verifiability >= 90);
check("Value delta is significantly positive (Δ > +30)", evalResult.delta.compositeDelta >= 30);
check("Loop risk is SAFE", evalResult.optimizedScore.loopRisk === "SAFE");
check("Target turns is 1.0 (1-shot completion)", evalResult.optimizedScore.estimatedTurns === 1.0);

// --- TEST CASE 4: Unambiguous CLI/Script Prompt (Zero Invented Assumptions & Invariant Scaffolding) ---
console.log("\n--- Test Case 4: Unambiguous CLI/Script Prompt ---");
const scriptPrompt = "Write a script to read a CSV file and sum the amounts. Use only Node's built-in fs module, no external packages.";
const optScript = optimizePrompt(scriptPrompt);

check("Rule 3.1: Deliverable format present on script prompt", optScript.optimized_prompt.includes("## Deliverable Format"));
check("Rule 3.1: Inferred deliverable is executable script", optScript.optimized_prompt.toLowerCase().includes("standalone executable script"));
check("Compound clause split: negative constraint isolated", optScript.optimized_prompt.includes("## Constraints") && optScript.optimized_prompt.toLowerCase().includes("no external packages"));
check("Compound clause split: positive tech directive isolated", optScript.optimized_prompt.includes("## Technical Direction") && optScript.optimized_prompt.toLowerCase().includes("built-in fs"));
check("Rule 3.5: Zero hallucinated localStorage assumptions", !optScript.optimized_prompt.includes("localStorage"));
check("Rule 3.5: Zero hallucinated auth assumptions", !optScript.optimized_prompt.toLowerCase().includes("authentication is not defined"));
check("Rule 3.6: Self-test verification present on script prompt", optScript.optimized_prompt.includes("## Lightweight Self-Test Verification"));
check("Rule 3.4: Hard stop condition present in Implementation Rules", optScript.optimized_prompt.includes("## Implementation Rules & Scope Boundaries") && optScript.optimized_prompt.includes("Stop condition (Rule 3.4)"));

const specScript = buildSpec(scriptPrompt, "CSV Sum Script");
const agentPromptScript = exportAgentPrompt(specScript);
check("Agent Export: Zero false-positive assumption invention", !agentPromptScript.includes("localStorage") && agentPromptScript.includes("zero assumptions required"));
check("Agent Export: Invariant scaffolding retained", agentPromptScript.includes("## Lightweight Self-Test Verification") && agentPromptScript.includes("## Deliverable Format"));

console.log("\n=================================================");
if (failed === 0) {
  console.log(`ALL OPTIMIZER RULES VERIFIED: ${passed} passed, 0 failed.`);
  process.exit(0);
} else {
  console.error(`FAILURES ENCOUNTERED: ${passed} passed, ${failed} failed.`);
  process.exit(1);
}
