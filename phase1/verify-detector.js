#!/usr/bin/env node
// Phase 1 verification against the Phase 0 dataset (exit criteria):
//   - ambiguous prompts: the deliberately planted patterns should be flagged (recall)
//   - explicit prompts: few/zero flags (false-positive rate)
//   - edge cases: empty / one-word / huge prompts must not crash
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { detect } from "./detector.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataset = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "phase0", "prompts.dataset.json"), "utf8"));

let plantedTotal = 0, plantedHits = 0, extrasTotal = 0, fpTotal = 0;
const fpByRule = {};
const rows = [];

for (const pair of dataset.pairs) {
  const a = detect(pair.ambiguous.text);
  const e = detect(pair.explicit.text);
  const planted = new Set(pair.ambiguous.planted_patterns);
  const flaggedCats = new Set(a.flags.map((f) => f.category));
  const hits = [...planted].filter((c) => flaggedCats.has(c));
  const misses = [...planted].filter((c) => !flaggedCats.has(c));
  const extras = [...flaggedCats].filter((c) => !planted.has(c));
  plantedTotal += planted.size;
  plantedHits += hits.length;
  extrasTotal += extras.length;
  fpTotal += e.flags.length;
  for (const f of e.flags) fpByRule[f.category] = (fpByRule[f.category] ?? 0) + 1;
  rows.push({ pairId: pair.id, hits: hits.length, planted: planted.size, misses, extras, explicitFlags: e.flags.map((f) => f.category) });
  console.log(
    `${pair.id.padEnd(18)} ambiguous: ${hits.length}/${planted.size} planted flagged` +
      `${misses.length ? `  MISS=[${misses.join(",")}]` : ""}${extras.length ? `  extra=[${extras.join(",")}]` : ""}` +
      `  | explicit: ${e.flags.length === 0 ? "clean" : `FP=[${e.flags.map((f) => f.category).join(",")}]`}`
  );
}

console.log("\n=== SUMMARY ===");
console.log(`Planted-pattern recall (ambiguous side): ${plantedHits}/${plantedTotal} = ${((plantedHits / plantedTotal) * 100).toFixed(1)}%`);
console.log(`Extra flags on ambiguous side (not planted, not necessarily wrong): ${extrasTotal}`);
console.log(`False-positive flags on explicit side: ${fpTotal}${fpTotal ? `  by rule: ${JSON.stringify(fpByRule)}` : ""}`);

console.log("\n=== EDGE CASES ===");
const cases = [
  ["empty prompt", ""],
  ["one-word prompt", "app"],
  ["very long prompt (~3k words)", "Build an app with these details. ".repeat(400)],
  ["out-of-dataset sample", "make me a todo app with reminders and stuff, it should look nice"],
];
for (const [label, text] of cases) {
  const r = detect(text);
  console.log(`EDGE OK  ${label.padEnd(32)} flags=${r.flags.length} score=${r.ambiguity_score} [${r.flags.map((f) => f.category).join(", ")}]`);
}
