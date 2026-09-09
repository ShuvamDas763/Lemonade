#!/usr/bin/env node
// CLI: node phase1/detect-cli.js "raw prompt text"
//      echo "prompt" | node phase1/detect-cli.js
import { readFileSync } from "node:fs";
import { detect, listRules } from "./detector.js";

const arg = process.argv.slice(2).join(" ").trim();
const text = arg || readFileSync(0, "utf8").trim();

if (!text) {
  console.log("Usage: node phase1/detect-cli.js \"<prompt>\"  (or pipe stdin)");
  console.log("\nSeeded rules:");
  for (const r of listRules()) console.log(`  ${r.id} ${r.category.padEnd(24)} sev=${r.severity} ${r.safe_default ? "assumption" : "question"}`);
  process.exit(0);
}

const result = detect(text);
console.log(`ambiguity_score=${result.ambiguity_score} flags=${result.flags.length}`);
for (const f of result.flags) {
  console.log(`\n[${f.id}] ${f.category} (severity ${f.severity}) -> ${f.resolution}`);
  console.log(`  evidence: ${f.evidence}`);
  if (f.assumption) console.log(`  assumption: ${f.assumption}`);
  if (f.question) console.log(`  question:   ${f.question}`);
}
if (!result.flags.length) console.log("No ambiguity flags - prompt looks well-specified.");
