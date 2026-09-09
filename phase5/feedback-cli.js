#!/usr/bin/env node
// Phase 5 CLI:
//   node phase5/feedback-cli.js record <accepted|edited|rejected> --flags R1,R5 [--edit "old=>new"]
//   node phase5/feedback-cli.js stats
//   node phase5/feedback-cli.js report [--out path.md]
//   node phase5/feedback-cli.js learn-edits "old=>new" [...]   # feed user edits into correction memory
//   --outcomes <path>   outcome store (default data/outcomes.json)
//   --store <path>      correction store for learn-edits (default data/corrections.json)
import path from "node:path";
import { fileURLToPath } from "node:url";
import { OutcomeStore, ruleStats, generateReport, learnFromEdits } from "./feedback.js";
import { CorrectionStore } from "../phase4/corrections.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const argVal = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const has = (name) => args.includes(name);
const outcomesPath = argVal("--outcomes", path.join(__dirname, "..", "data", "outcomes.json"));
const corrPath = argVal("--store", path.join(__dirname, "..", "data", "corrections.json"));
const [cmd, ...rest] = args.filter((a, i) => a !== "--outcomes" && a !== argVal("--outcomes", null) && a !== "--store" && a !== argVal("--store", null));

const store = new OutcomeStore(outcomesPath);

if (cmd === "record") {
  const [outcome, ...flagsArgs] = rest;
  const fi = flagsArgs.indexOf("--flags");
  const flags = fi >= 0 ? (flagsArgs[fi + 1] ?? "").split(",").map((s) => s.trim()).filter(Boolean) : [];
  const edits = [];
  let ei = flagsArgs.indexOf("--edit");
  while (ei >= 0) {
    const [original, replacement] = String(flagsArgs[ei + 1] ?? "").split("=>");
    if (original && replacement) edits.push({ original: original.trim(), replacement: replacement.trim() });
    const next = flagsArgs.indexOf("--edit", ei + 1);
    ei = next;
  }
  const ev = store.record({ outcome, flags, edits });
  const learned = edits.length ? learnFromEdits(edits, new CorrectionStore(corrPath)) : 0;
  console.log(`recorded: ${ev.outcome} flags=[${ev.flags.join(",")}] edits=${edits.length}${edits.length ? ` -> ${learned} correction event(s) recorded` : ""}`);
} else if (cmd === "stats") {
  const rows = ruleStats(store);
  if (!rows.length) { console.log("(no outcomes recorded yet)"); }
  for (const r of rows) console.log(`${r.id.padEnd(8)} n=${String(r.total).padEnd(4)} accept=${(r.acceptRate * 100).toFixed(1).replace(/\.0$/, "") + "%").padEnd(5)} status=${r.status}`);
} else if (cmd === "report") {
  const { text } = generateReport(store);
  console.log(text);
  const out = argVal("--out", null);
  if (out) { import("node:fs").then((fs) => fs.writeFileSync(out, text)); console.log(`\n(wrote ${out})`); }
} else if (cmd === "learn-edits") {
  const edits = rest.map((s) => { const [original, replacement] = String(s).split("=>"); return { original: (original ?? "").trim(), replacement: (replacement ?? "").trim() }; });
  const n = learnFromEdits(edits, new CorrectionStore(corrPath));
  console.log(`recorded ${n} correction event(s) from ${edits.length} edit(s)`);
} else {
  console.log("Usage: feedback-cli.js record <accepted|edited|rejected> --flags R1,R5 [--edit \"old=>new\"] | stats | report [--out file] | learn-edits \"old=>new\" [...]");
}
