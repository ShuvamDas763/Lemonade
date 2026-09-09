#!/usr/bin/env node
// Phase 2 verification against the Phase 0 dataset (exit criteria):
//   - every rewrite embeds the original prompt VERBATIM (preservation by
//     construction)
//   - additions are ONLY labeled assumptions + open questions from flags
//   - contradiction self-check reports 0 warnings (intent-match gate)
//   - edge cases: empty / one-word / ~3k-word prompts, no crashes
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { rewrite } from "./rewriter.js";
import { verify } from "../phase3/verifier.js";
import { extractCorrections, CorrectionStore } from "../phase4/corrections.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataset = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "phase0", "prompts.dataset.json"), "utf8"));

let failures = 0;
const check = (label, cond) => {
  if (!cond) {
    failures++;
    console.log(`  FAIL: ${label}`);
  }
  return cond;
};

for (const pair of dataset.pairs) {
  for (const variant of ["ambiguous", "explicit"]) {
    const raw = pair[variant].text;
    const r = await rewrite(raw);
    console.log(`${pair.id}/${variant.padEnd(9)} ok=${r.ok} assumptions=${r.assumptions_made.length} questions=${r.clarifying_questions.length} warnings=${r.warnings.length}`);
    check(`${pair.id}/${variant} ok`, r.ok);
    check(`${pair.id}/${variant} verbatim`, r.optimized_prompt.includes(raw.trim()));
    check(`${pair.id}/${variant} additions labeled`, r.assumptions_made.every((a) => a.text.startsWith("[ASSUMED:") && r.optimized_prompt.includes(a.text)));
    check(`${pair.id}/${variant} removals empty`, r.changes.removed.length === 0 && r.changes.modified.length === 0);
    check(`${pair.id}/${variant} zero warnings`, r.warnings.length === 0);
  }
}

console.log("\n=== EDGE CASES ===");
const cases = [
  ["empty prompt", ""],
  ["one-word prompt", "app"],
  ["very long prompt (~3k words)", "Build an app with these details. ".repeat(400)],
];
for (const [label, text] of cases) {
  const r = await rewrite(text);
  if (label === "empty prompt") {
    check("empty refused gracefully", r.ok === false && Array.isArray(r.warnings));
    console.log(`EDGE OK  ${label.padEnd(30)} -> refused: "${r.error}"`);
  } else {
    check(`edge ${label} ok`, r.ok && r.optimized_prompt.includes(text.trim()));
    console.log(`EDGE OK  ${label.padEnd(30)} -> assumptions=${r.assumptions_made.length} questions=${r.clarifying_questions.length}`);
  }
}

console.log("\n=== MEMORY PREFERENCES (Phase 4 integration, isolated temp store) ===");
{
  const storePath = path.join(os.tmpdir(), `lemonade-p2-verify-${process.pid}-${Date.now()}.json`);
  const store = new CorrectionStore(storePath);
  // Same correction twice -> standing (over-fit guard), dimension=stack.
  store.record(extractCorrections("no, use Vue, not React"), { source: "p2-verify-1" });
  store.record(extractCorrections("no, use Vue, not React"), { source: "p2-verify-2" });

  const raw1 = "build me a portfolio website to showcase my design work";
  const r1 = await rewrite(raw1, { memoryPath: storePath });
  const texts = r1.assumptions_made.map((a) => a.text);
  const hasPref = texts.some((t) => t.includes("USER PREFERENCE") && t.includes("Vue"));
  const hasStackDefault = texts.some((t) => t.startsWith("[ASSUMED:") && /react|typescript/i.test(t));
  check("standing preference applied as labeled assumption", hasPref);
  check("stack default REPLACED by preference (no contradictory pair)", hasPref && !hasStackDefault);
  check("override recorded visibly in memory.overrides", (r1.memory.overrides ?? []).some((o) => o.category === "missing_stack"));
  check("phase 3 gate still passes with preference applied", verify(raw1, r1).ok);

  const store2Path = path.join(os.tmpdir(), `lemonade-p2-verify-c-${process.pid}-${Date.now()}.json`);
  const store2 = new CorrectionStore(store2Path);
  store2.record(extractCorrections("no, use Vue, not React"), { source: "p2-verify-3" }); // candidate only
  const r2 = await rewrite("build a recipe box web app", { memoryPath: store2Path });
  check("candidate-only store is never applied (over-fit guard)", r2.memory.applied.length === 0);

  fs.rmSync(storePath, { force: true });
  fs.rmSync(store2Path, { force: true });
  console.log(`MEM OK   pref applied=${JSON.stringify(r1.memory.applied)}  overrides=${JSON.stringify((r1.memory.overrides ?? []).map((o) => o.category))}`);
}

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);

// Show 3 full examples for human intent-review (Self-Verification Protocol).
if (failures === 0) {
  for (const id of ["bookswipe", "invoice-generator", "kanban"]) {
    const pair = dataset.pairs.find((p) => p.id === id);
    const r = await rewrite(pair.ambiguous.text);
    console.log(`\n${"=".repeat(72)}\nEXAMPLE: ${id} (ambiguous variant)\n${"=".repeat(72)}`);
    console.log(r.optimized_prompt);
  }
}
process.exit(failures === 0 ? 0 : 1);
