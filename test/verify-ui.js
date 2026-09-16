#!/usr/bin/env node
// Lemonade — Web UI & Integrity API Verification.
// Verifies local web server endpoints, spec lifecycle, and static assets.

import { createServer } from "../src/ui/server.js";

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

const PORT = 7895;
const HOST = "127.0.0.1";
const { server, listen, close } = createServer({ port: PORT, host: HOST });

console.log("=================================================");
console.log("Lemonade UI & REST API Verification Suite");
console.log("=================================================\n");

try {
  await listen();

  // 1. Health check
  const healthRes = await fetch(`http://${HOST}:${PORT}/api/health`);
  const healthData = await healthRes.json();
  check("GET /api/health -> 200", healthRes.status === 200);
  check("Health data ok", healthData.ok === true && healthData.service === "lemonade-integrity-platform");

  // 2. Ambiguity Detection
  const detectRes = await fetch(`http://${HOST}:${PORT}/api/detect`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: "make a website for tracking habits" }),
  });
  const detectData = await detectRes.json();
  check("POST /api/detect -> 200", detectRes.status === 200);
  check("Detect flags returned", Array.isArray(detectData.flags) && detectData.flags.length > 0);

  // 3. Spec Creation
  const prompt = "Build a customer feedback survey tool with rating scales. No login for respondents.";
  const createRes = await fetch(`http://${HOST}:${PORT}/api/spec/create`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, mode: "agent" }),
  });
  const createData = await createRes.json();
  check("POST /api/spec/create -> 201", createRes.status === 201);
  check("Spec created with items", createData.spec && createData.spec.items.length > 0);
  check("Validation attached", createData.validation && typeof createData.validation.valid === "boolean");
  check("Exports attached", typeof createData.exports.agentPrompt === "string" && typeof createData.exports.json === "string");

  const specId = createData.spec.id;
  const firstItem = createData.spec.items.find((i) => i.category === "requirement") || createData.spec.items[0];

  // 4. Spec Retrieval
  const getRes = await fetch(`http://${HOST}:${PORT}/api/spec/${specId}`);
  const getData = await getRes.json();
  check("GET /api/spec/:id -> 200", getRes.status === 200);
  check("Retrieved spec matches ID", getData.spec.id === specId);

  // 5. Item Decision (Accept)
  const decideRes = await fetch(`http://${HOST}:${PORT}/api/spec/${specId}/item/${firstItem.id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "accept", reason: "Verified by test" }),
  });
  const decideData = await decideRes.json();
  check("PUT /api/spec/:id/item/:itemId (accept) -> 200", decideRes.status === 200);
  check("Item status updated to accepted", decideData.item.status === "accepted");

  // 6. Question Answering
  const questionItem = createData.spec.items.find((i) => i.category === "open-question");
  if (questionItem) {
    const ansRes = await fetch(`http://${HOST}:${PORT}/api/spec/${specId}/question/${questionItem.id}/answer`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ answer: "Use local browser storage" }),
    });
    const ansData = await ansRes.json();
    check("POST /api/spec/:id/question/:qid/answer -> 200", ansRes.status === 200);
    check("Question marked accepted in spec", ansData.spec.items.some((i) => i.id === questionItem.id && i.status === "accepted"));
  }

  // 7. Ledger Report
  const ledgerRes = await fetch(`http://${HOST}:${PORT}/api/ledger`);
  const ledgerData = await ledgerRes.json();
  check("GET /api/ledger -> 200", ledgerRes.status === 200);
  check("Ledger report present", ledgerData.report && typeof ledgerData.report.coveragePercent === "number");

  // 8. Static Assets
  const htmlRes = await fetch(`http://${HOST}:${PORT}/`);
  const htmlText = await htmlRes.text();
  check("GET / -> 200 (index.html)", htmlRes.status === 200 && htmlText.includes("LEMONADE"));

  const cssRes = await fetch(`http://${HOST}:${PORT}/styles.css`);
  check("GET /styles.css -> 200", cssRes.status === 200);

  const jsRes = await fetch(`http://${HOST}:${PORT}/app.js`);
  check("GET /app.js -> 200", jsRes.status === 200);

} catch (err) {
  console.error("Test Exception:", err);
  failed++;
} finally {
  await close();
}

console.log("\n=================================================");
if (failed === 0) {
  console.log(`ALL UI CHECKS PASSED: ${passed} passed, 0 failed.`);
} else {
  console.error(`FAILURES: ${passed} passed, ${failed} failed.`);
  process.exit(1);
}
