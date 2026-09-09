#!/usr/bin/env node
// CLI: node phase2/rewrite-cli.js "raw prompt"   (or pipe stdin)
// Prints the structured optimized_prompt + assumptions/questions/warnings.
import { readFileSync } from "node:fs";
import { rewrite } from "./rewriter.js";

const arg = process.argv.slice(2).join(" ").trim();
const text = arg || readFileSync(0, "utf8").trim();

if (!text) {
  console.log('Usage: node phase2/rewrite-cli.js "<prompt>"  (or pipe stdin)');
  process.exit(0);
}

const r = await rewrite(text);
if (!r.ok) {
  console.log(`REWRITE REFUSED: ${r.error}`);
  process.exit(1);
}
console.log(r.optimized_prompt);
console.log("\n--- meta ---");
console.log(`assumptions: ${r.assumptions_made.length}  questions: ${r.clarifying_questions.length}  warnings: ${r.warnings.length}`);
for (const w of r.warnings) console.log(`  WARNING [${w.category}] ${w.detail}`);
