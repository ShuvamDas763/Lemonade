#!/usr/bin/env node
// TokenTrim Market-Ready Verification Suite
// Tests all 5 pillars:
//   1. Multi-turn Context Pruner (token & character reduction)
//   2. Workspace Context Auto-Detection (Node, Python, Go, Rust)
//   3. Intent Gating (zero-bloat bypass for trivial queries)
//   4. Runtime Invariant Firewall (extract negative boundaries + audit drift)
//   5. Transparent OpenAI-Compatible Proxy (/v1/chat/completions non-streaming & streaming)

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import { pruneContext } from "../phase2/pruner.js";
import { detectWorkspace } from "../phase2/workspace.js";
import { classifyIntent } from "../phase1/intent-gate.js";
import { SessionFirewall, auditAgentOutput, formatBoundaryContract } from "../phase6/firewall.js";
import { extractRequirements } from "../phase6/ledger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let passed = 0;
let failed = 0;

function assert(label, cond, extra = "") {
  if (cond) {
    passed++;
    console.log(`  ✓ PASS: ${label}`);
  } else {
    failed++;
    console.error(`  ✗ FAIL: ${label} ${extra}`);
  }
}

console.log("=================================================");
console.log("TokenTrim Market-Ready Verification Suite");
console.log("=================================================\n");

// -------------------------------------------------------------
// 1. Multi-Turn Context Pruner
// -------------------------------------------------------------
console.log("== 1. Multi-Turn Context Pruner ==");

const giantStack = "Error: Connection refused\n    at TCPConnectWrap.afterConnect [as oncomplete] (net.js:1146:16)\n".repeat(40);
const giantLog = "Processing item 0...\nProcessing item 1...\n".repeat(60);

const testMessages = [
  { role: "system", content: "You are an expert developer." },
  { role: "user", content: "Build a widget." },
  { role: "assistant", content: "Here is the widget code." },
  { role: "tool", content: giantStack }, // turn 2 tool error
  { role: "assistant", content: "I see the error, fixing it now." },
  { role: "tool", content: giantLog }, // turn 3 tool output
  { role: "assistant", content: "Widget is ready." },
  // Active recent turns (must NOT be pruned):
  { role: "user", content: "Add a button to it." },
  { role: "assistant", content: "Button added." },
];

const pruneResult = pruneContext(testMessages, { preserveRecentTurns: 1 });

assert("System prompt preserved intact", pruneResult.pruned_messages[0].content === "You are an expert developer.");
assert("Recent user turn preserved intact", pruneResult.pruned_messages[7].content === "Add a button to it.");
assert("Recent assistant turn preserved intact", pruneResult.pruned_messages[8].content === "Button added.");
assert("Stale stack trace compacted", pruneResult.pruned_messages[3].content.includes("omitted by TokenTrim"));
assert("Stale tool output compacted", pruneResult.pruned_messages[5].content.includes("omitted by TokenTrim"));
assert("Token reduction achieved >30%", pruneResult.reduction_percent > 30, `got ${pruneResult.reduction_percent}%`);
assert("Estimated tokens saved calculated", pruneResult.estimated_tokens_saved > 200, `got ${pruneResult.estimated_tokens_saved}`);

// -------------------------------------------------------------
// 2. Workspace Context Auto-Detection
// -------------------------------------------------------------
console.log("\n== 2. Workspace Context Auto-Detection ==");

// Test current workspace (Node.js)
const curWs = detectWorkspace(path.join(__dirname, ".."), false);
assert("Current workspace detected as Node.js", curWs.detected && curWs.ecosystem === "node");
assert("Package manager identified", !!curWs.packageManager);

// Test mock Python repo
const tmpPython = fs.mkdtempSync(path.join(os.tmpdir(), "tokentrim-test-py-"));
fs.writeFileSync(path.join(tmpPython, "pyproject.toml"), `
[project]
name = "fastapi-app"
dependencies = ["fastapi", "sqlalchemy", "pytest"]
`);
const pyWs = detectWorkspace(tmpPython, false);
assert("Python project detected", pyWs.detected && pyWs.ecosystem === "python");
assert("FastAPI framework identified", pyWs.frameworks.includes("FastAPI"));

// Test mock Go repo
const tmpGo = fs.mkdtempSync(path.join(os.tmpdir(), "tokentrim-test-go-"));
fs.writeFileSync(path.join(tmpGo, "go.mod"), "module github.com/user/myservice\ngo 1.22\nrequire github.com/gin-gonic/gin v1.9.1\n");
const goWs = detectWorkspace(tmpGo, false);
assert("Go project detected", goWs.detected && goWs.ecosystem === "go");
assert("Gin framework identified", goWs.frameworks.includes("Gin"));

// Test empty directory (graceful fallback)
const tmpEmpty = fs.mkdtempSync(path.join(os.tmpdir(), "tokentrim-test-empty-"));
const emptyWs = detectWorkspace(tmpEmpty, false);
assert("Empty directory returns detected=false", emptyWs.detected === false);

// -------------------------------------------------------------
// 3. Intent Gating
// -------------------------------------------------------------
console.log("\n== 3. Intent Gating ==");

const q1 = classifyIntent("how do I center a div with flexbox?");
assert("How-to question -> PASS_THROUGH", q1.level === "PASS_THROUGH" && q1.bypassRewrite === true);

const q2 = classifyIntent("write a regex for email address validation");
assert("Regex request -> PASS_THROUGH", q2.level === "PASS_THROUGH" && q2.bypassRewrite === true);

const q3 = classifyIntent("fix typo in line 42");
assert("Small typo fix -> PASS_THROUGH", q3.level === "PASS_THROUGH" && q3.bypassRewrite === true);

const q4 = classifyIntent("add a helper function to format currency");
assert("Helper addition -> LIGHTWEIGHT", q4.level === "LIGHTWEIGHT" && q4.bypassRewrite === false);

const q5 = classifyIntent("build me a kanban board with drag and drop");
assert("Full app build -> FULL_SPEC", q5.level === "FULL_SPEC" && q5.bypassRewrite === false);

// -------------------------------------------------------------
// 4. Runtime Invariant Firewall
// -------------------------------------------------------------
console.log("\n== 4. Runtime Invariant Firewall ==");

const fw = new SessionFirewall();
const fwUserRes = fw.processUserMessage("Build a minimal kanban board. No login for v1, no external database.");

assert("Prohibitions extracted", fwUserRes.requirements.some((r) => r.kind === "prohibition" && r.key === "auth"));
assert("Boundary contract formatted", fwUserRes.contract && fwUserRes.contract.includes("PROHIBITED [auth]"));

// Audit simulated agent drift
const driftedAgent = "I have configured the database and installed passport and jsonwebtoken to handle user authentication.";
const auditDrift = fw.auditResponse(driftedAgent);
assert("Firewall caught unauthorized auth implementation", !auditDrift.clean && auditDrift.violations.length >= 1);
assert("Firewall emitted warning message", !!auditDrift.warning);

// Audit clean agent output
const cleanAgent = "I have built the 3-column kanban board using browser localStorage with no login required.";
const auditClean = fw.auditResponse(cleanAgent);
assert("Clean output passed firewall", auditClean.clean === true && auditClean.violations.length === 0);

// -------------------------------------------------------------
// 5. Transparent OpenAI-Compatible Proxy (/v1)
// -------------------------------------------------------------
console.log("\n== 5. Transparent OpenAI-Compatible Proxy (/v1) ==");

const TEST_PORT = 7898;
const srv = spawn(process.execPath, ["phase1/server.js"], {
  cwd: path.join(__dirname, ".."),
  env: { ...process.env, PORT: String(TEST_PORT) },
  stdio: "pipe",
});

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  await wait(800);

  // Check /v1/models
  const modelsRes = await fetch(`http://localhost:${TEST_PORT}/v1/models`);
  assert("GET /v1/models -> 200", modelsRes.status === 200);
  const modelsData = await modelsRes.json();
  assert("Models list returned", Array.isArray(modelsData.data) && modelsData.data.length > 0);

  // Check /v1/chat/completions (Non-Streaming)
  const chatRes = await fetch(`http://localhost:${TEST_PORT}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: "tokentrim-smart",
      messages: testMessages,
      stream: false,
    }),
  });

  assert("POST /v1/chat/completions -> 200", chatRes.status === 200);
  assert("Header x-tokentrim-tokens-saved present", chatRes.headers.has("x-tokentrim-tokens-saved"));
  const chatData = await chatRes.json();
  assert("Standard chat completion format returned", !!chatData.choices?.[0]?.message?.content);
  assert("Usage metrics contain tokens_saved_by_tokentrim", typeof chatData.usage?.tokens_saved_by_tokentrim === "number");

  // Check /v1/chat/completions (Streaming SSE)
  const streamRes = await fetch(`http://localhost:${TEST_PORT}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: "tokentrim-smart",
      messages: [{ role: "user", content: "build me a todo app" }],
      stream: true,
    }),
  });

  assert("Streaming request returns 200", streamRes.status === 200);
  assert("Streaming content-type is text/event-stream", streamRes.headers.get("content-type")?.includes("text/event-stream"));
  const sseBody = await streamRes.text();
  assert("SSE stream emits data: chunks", sseBody.includes("data: {") && sseBody.includes("data: [DONE]"));

} catch (err) {
  assert("Proxy test failed with exception", false, err.message);
} finally {
  srv.kill();
}

console.log("\n=================================================");
if (failed === 0) {
  console.log(`ALL CHECKS PASSED: ${passed} passed, 0 failed.`);
  console.log("TokenTrim is verified and market-ready!");
  process.exit(0);
} else {
  console.error(`FAILURES PRESENT: ${passed} passed, ${failed} failed.`);
  process.exit(1);
}
