#!/usr/bin/env node
// Stress-test harness for the Phase 1 detector on OUT-OF-DATASET prompts.
//
// Input: a file path (argv[2]) with prompts separated by BLANK LINES,
// or piped stdin in the same format. Example:
//   node phase1/stress-test.js my-prompts.txt
//   cat my-prompts.txt | node phase1/stress-test.js
import { readFileSync } from "node:fs";
import { detect, listRules } from "./detector.js";

const arg = process.argv.slice(2).join(" ").trim();
const raw = arg ? readFileSync(arg, "utf8") : readFileSync(0, "utf8");
const prompts = raw
  .split(/\n\s*\n/)
  .map((p) => p.trim())
  .filter(Boolean);

if (!prompts.length) {
  console.log("No prompts found. Paste prompts separated by BLANK LINES into a file, then:");
  console.log("  node phase1/stress-test.js file.txt   (or pipe: cat file.txt | node phase1/stress-test.js)");
  process.exit(1);
}

const ruleFireCounts = {};
console.log(`${prompts.length} prompts loaded\n`);
for (let i = 0; i < prompts.length; i++) {
  const text = prompts[i];
  const r = detect(text);
  const preview = text.replace(/\s+/g, " ").slice(0, 90) + (text.length > 90 ? "…" : "");
  console.log(`#${String(i + 1).padStart(2)}  score=${String(r.ambiguity_score).padStart(3)}  ${preview}`);
  if (!r.flags.length) console.log("     (no flags — looks well-specified)");
  for (const f of r.flags) {
    ruleFireCounts[f.category] = (ruleFireCounts[f.category] ?? 0) + 1;
    console.log(`     [${f.id}] ${f.category} (sev ${f.severity}) ${f.resolution} — ${f.evidence}`);
  }
  console.log("");
}

console.log("=== RULE FIRE SUMMARY ===");
for (const rule of listRules()) {
  const n = ruleFireCounts[rule.category] ?? 0;
  console.log(`${rule.id} ${rule.category.padEnd(26)} fired ${String(n).padStart(2)}/${prompts.length}`);
}
console.log("\nJudging guide: for each prompt YOU know the planted ambiguity — mark each flag as");
console.log("TP (real ambiguity), FP (wrong/wrong-context), or MISS (ambiguity not flagged).");
