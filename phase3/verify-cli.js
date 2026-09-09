#!/usr/bin/env node
// CLI: rewrite a prompt, run the Phase 3 hard gate, print the human-readable
// diff report. Exit code 1 on hard failure (usable as a send-gate in scripts).
//   node phase3/verify-cli.js "<prompt>" [--deep]
import { readFileSync } from "node:fs";
import { rewrite } from "../phase2/rewriter.js";
import { verify } from "./verifier.js";

const arg = process.argv.slice(2).join(" ").trim();
const text = arg || readFileSync(0, "utf8").trim();

if (!text) {
  console.log('Usage: node phase3/verify-cli.js "<prompt>"  (or pipe stdin)');
  process.exit(0);
}

const rw = await rewrite(text);
if (!rw.ok) {
  console.log(`REFUSED: ${rw.error}`);
  process.exit(1);
}
const verdict = verify(text, rw);
console.log("=== OPTIMIZED PROMPT ===\n");
console.log(rw.optimized_prompt);
console.log("\n" + verdict.diff_report);
if (process.argv.includes("--deep")) {
  const { deepCheck } = await import("./deep-check.js");
  const deep = await deepCheck(text, rw.optimized_prompt);
  if (!deep.available) {
    console.log(`\n(deep check unavailable: ${deep.reason})`);
  } else {
    console.log(`\nDEEP CHECK (advisory, model reconstruction diff):`);
    console.log(`  reconstruction: "${deep.reconstruction.slice(0, 200)}"`);
    console.log(`  original words the reconstruction did not capture: ${deep.flags.length ? deep.flags.join(", ") : "(none)"}`);
  }
}
process.exit(verdict.ok ? 0 : 1);
