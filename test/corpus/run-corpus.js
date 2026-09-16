#!/usr/bin/env node
// Lemonade — Evaluation Benchmark Corpus Runner.
// Evaluates generic extraction & validation across 10 novel domains.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { rewrite } from "../../phase2/rewriter.js";
import { verify } from "../../phase3/verifier.js";
import { buildSpec } from "../../src/spec/extractor.js";
import { validateAll } from "../../src/validation/validate.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const corpusPath = path.join(__dirname, "benchmark.json");
const corpus = JSON.parse(fs.readFileSync(corpusPath, "utf8"));

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
console.log("Lemonade Evaluation Benchmark Corpus (10 Domains)");
console.log("=================================================\n");

const results = [];

for (const entry of corpus) {
  console.log(`--- Domain: ${entry.domain} (${entry.title}) ---`);
  const rw = await rewrite(entry.raw, { mode: "optimize" });
  check(`[${entry.id}] rewrite ok`, rw.ok === true);

  const vRes = verify(entry.raw, rw);
  check(`[${entry.id}] Phase 3 intent verification passed`, vRes.ok === true);

  const spec = buildSpec(entry.raw, entry.title);
  check(`[${entry.id}] spec has items`, spec.allItems().length > 0);

  const val = validateAll(entry.raw, rw.optimized_prompt, spec);
  check(`[${entry.id}] 4D validation: preservation passed`, val.preservation.passed === true);

  // If entry expects constraints, check that constraints are present
  if (entry.expected.mustHaveConstraints) {
    const hasConstraint = spec.allItems().some((i) => i.category === "constraint" || i.category === "non-negotiable" || i.text.toLowerCase().includes("no ") || i.text.toLowerCase().includes("not"));
    check(`[${entry.id}] constraint captured`, hasConstraint === true);
  }

  // If entry expects future features, check that future scope is captured
  if (entry.expected.futureFeatures) {
    const futureWords = entry.expected.futureFeatures;
    const hasFuture = futureWords.some((w) => rw.optimized_prompt.toLowerCase().includes(w));
    check(`[${entry.id}] future features preserved`, hasFuture === true);
  }

  results.push({
    id: entry.id,
    domain: entry.domain,
    items: spec.allItems().length,
    openQuestions: spec.openQuestions().length,
    valid4D: val.valid ? "YES" : "ADVISORY",
    gate: vRes.ok ? "PASS" : "FAIL",
  });
}

console.log("\n=================================================");
console.log("Corpus Benchmark Summary");
console.log("=================================================");
console.table(results);

console.log(`\nALL CORPUS CHECKS: ${passed} passed, ${failed} failed.`);
if (failed > 0) process.exit(1);
