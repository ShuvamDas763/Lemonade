#!/usr/bin/env node
// Lemonade — Core API & Target Compiler Verification Suite

import {
  detect,
  extractSpec,
  compilePrompt,
  verifyCompilation,
  compileTraceable,
  evaluateOutput,
} from "../src/core/index.js";

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
console.log("Lemonade Core API & Compiler Verification Suite");
console.log("=================================================\n");

const testPrompt = `Build an expense tracking website for students.
Students can log in and add expenses with an amount and category like food or textbooks.
A dashboard displays total monthly spending and category breakdown chart.
No complex payment processing or banking integrations for v1.
Run locally with Node and SQLite.`;

// --- 1. Ambiguity Detection ---
console.log("--- 1. Ambiguity Detection ---");
const det = detect(testPrompt);
check("detect returns flags array", Array.isArray(det.flags));
check("detect computes ambiguity score", typeof det.ambiguity_score === "number");

// --- 2. Semantic Extraction ---
console.log("\n--- 2. Semantic Extraction ---");
const spec = extractSpec(testPrompt, { title: "Student Expense Tracker" });
check("spec has stable ID", typeof spec.id === "string" && spec.id.length > 5);
check("spec has title", spec.title === "Student Expense Tracker");
check("spec has binding items", spec.binding().length > 0);

// --- 3. Target-Aware Compilation ---
console.log("\n--- 3. Target-Aware Compilation ---");

// Claude Code
const claudeOutput = compilePrompt(spec, "claude-code");
check("Claude Code compilation has XML tags", claudeOutput.includes("<project_intent") && claudeOutput.includes("</project_intent>"));
check("Claude Code includes raw goal", claudeOutput.includes("<raw_goal>"));
check("Claude Code includes stop condition", claudeOutput.includes("<stop_condition>"));

// Cursor
const cursorOutput = compilePrompt(spec, "cursor");
check("Cursor compilation has cursor header", cursorOutput.includes("CURSOR SPEC CONTRACT"));
check("Cursor compilation includes checklist", cursorOutput.includes("- [ ]"));
check("Cursor compilation includes constraints", cursorOutput.includes("Invariant Constraints"));

// OpenAI Chat Messages
const chatOutput = compilePrompt(spec, "openai-chat");
check("OpenAI chat returns message array", Array.isArray(chatOutput) && chatOutput.length === 2);
check("System message present", chatOutput[0].role === "system");
check("User message contains spec", chatOutput[1].role === "user" && chatOutput[1].content.includes("V1 Requirements"));

// Structured JSON
const jsonOutput = compilePrompt(spec, "json");
const parsedJson = JSON.parse(jsonOutput);
check("JSON export parses correctly", parsedJson.id === spec.id && Array.isArray(parsedJson.items));

// Image Gen Mode
const imageOutput = compilePrompt(spec, "image-gen");
check("Image gen output has style and palette", imageOutput.includes("Style:") && imageOutput.includes("Color Palette:"));

// Research Mode
const researchOutput = compilePrompt(spec, "research");
check("Research output has inquiry header", researchOutput.includes("# Research Inquiry"));

// Default Coding-Agent Mode
const agentOutput = compilePrompt(spec, "coding-agent");
check("Coding agent output has deliverable format", agentOutput.includes("## Deliverable Format"));
check("Coding agent output has stop condition", agentOutput.includes("Stop condition"));

// --- 4. Verification Separation (Integrity vs Quality) ---
console.log("\n--- 4. Verification Separation ---");
const verification = verifyCompilation(testPrompt, agentOutput, spec);
check("Intent integrity separated", typeof verification.intentIntegrity === "object");
check("Intent integrity measures preservation", typeof verification.intentIntegrity.preserved === "boolean");
check("Intent integrity verdict is present", typeof verification.intentIntegrity.verdict === "string");

check("Task quality separated", typeof verification.taskQuality === "object");
check("Task quality has 5-axis metrics", typeof verification.taskQuality.clarity === "number" && typeof verification.taskQuality.verifiability === "number");
check("Task quality has estimated turns", typeof verification.taskQuality.estimatedTurns === "number");

// --- 5. Traceable Compilation Record ---
console.log("\n--- 5. Traceable Compilation Record ---");
const traceable = compileTraceable(spec, "cursor");
check("Traceable has originalPrompt", traceable.originalPrompt === testPrompt);
check("Traceable has target", traceable.target === "cursor");
check("Traceable has preservedItems array", Array.isArray(traceable.preservedItems));
check("Traceable has acceptanceCriteria array", Array.isArray(traceable.acceptanceCriteria));
check("Traceable has verification report", traceable.verification && traceable.verification.intentIntegrity);

// --- 6. Downstream Output Audit ---
console.log("\n--- 6. Downstream Output Audit ---");
const goodAgentResponse = `I have implemented the student expense tracking website.
Students can register and log in to add expenses with amount and category (food, textbooks).
A dashboard shows total monthly spending and breakdown chart. Built with Node and SQLite.`;

const auditGood = evaluateOutput(spec, goodAgentResponse);
check("Good response passes audit", auditGood.verdict === "PASS" && auditGood.coveragePercent >= 80);

const poorAgentResponse = `I created a simple hello world html file.`;
const auditPoor = evaluateOutput(spec, poorAgentResponse);
check("Poor response detects drift", auditPoor.verdict === "DRIFT_DETECTED");

console.log("\n=================================================");
if (failed === 0) {
  console.log(`ALL CORE API CHECKS PASSED: ${passed} passed, 0 failed.`);
  process.exit(0);
} else {
  console.error(`FAILURES ENCOUNTERED: ${passed} passed, ${failed} failed.`);
  process.exit(1);
}
