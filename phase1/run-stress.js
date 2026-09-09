#!/usr/bin/env node
// Scored stress-test runner for the Phase 1 detector on the out-of-dataset set
// (phase1/stress-prompts.json). Reports planted recall, extra flags, explicit-side
// false positives, and a per-rule fire summary.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { detect, listRules } from "./detector.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const set = JSON.parse(fs.readFileSync(path.join(__dirname, "stress-prompts.json"), "utf8"));

let plantedTotal = 0, plantedHits = 0, extrasTotal = 0, fpTotal = 0;
const fireCounts = {};
const fpDetail = [];

for (const p of set.prompts) {
  const r = detect(p.text);
  const cats = new Set(r.flags.map((f) => f.category));
  for (const c of cats) fireCounts[c] = (fireCounts[c] ?? 0) + 1;

  const preview = p.text.replace(/\s+/g, " ").slice(0, 70) + (p.text.length > 70 ? "…" : "");
  if (p.kind === "ambiguous") {
    const planted = new Set(p.planted);
    const hits = [...planted].filter((c) => cats.has(c));
    const misses = [...planted].filter((c) => !cats.has(c));
    const extras = [...cats].filter((c) => !planted.has(c));
    plantedTotal += planted.size;
    plantedHits += hits.length;
    extrasTotal += extras.length;
    console.log(
      `${p.id} (ambig)  ${hits.length}/${planted.size}` +
        `${misses.length ? `  MISS=[${misses.join(",")}]` : ""}${extras.length ? `  extra=[${extras.join(",")}]` : ""}  | ${preview}`
    );
  } else {
    fpTotal += r.flags.length;
    if (r.flags.length) fpDetail.push(`${p.id}: ${r.flags.map((f) => f.category).join(",")}`);
    console.log(
      `${p.id} (expl)   ${r.flags.length === 0 ? "clean" : `FP=[${r.flags.map((f) => f.category).join(",")}]`}          | ${preview}`
    );
  }
}

console.log("\n=== STRESS SUMMARY ===");
console.log(`Planted recall (ambiguous side): ${plantedHits}/${plantedTotal} = ${((plantedHits / plantedTotal) * 100).toFixed(1)}%`);
console.log(`Extra flags (ambiguous side, may be defensible): ${extrasTotal}`);
console.log(`False positives (explicit side): ${fpTotal}${fpDetail.length ? `  -> ${fpDetail.join(" | ")}` : ""}`);
console.log("\n=== RULE FIRE COUNTS ===");
for (const rule of listRules()) {
  console.log(`${rule.id} ${rule.category.padEnd(26)} ${String(fireCounts[rule.category] ?? 0).padStart(2)}/${set.prompts.length}`);
}
