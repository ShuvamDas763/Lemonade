#!/usr/bin/env node
// End-to-end demo of everything built so far, on ANY prompt:
//
//   node demo/end-to-end.js "<your prompt>"            # pipeline for one prompt
//   node demo/end-to-end.js --loop                      # correction-memory story:
//                                                        two corrections -> promotion ->
//                                                        next prompt gets the preference
//   --store <path>   where the demo memory lives (default data/demo-corrections.json)
//
// Uses only the deterministic pipeline (zero model calls). The optional Ollama
// deep check remains available via phase3/verify-cli.js --deep.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { detect } from "../phase1/detector.js";
import { rewrite } from "../phase2/rewriter.js";
import { verify } from "../phase3/verifier.js";
import { extractCorrections, CorrectionStore } from "../phase4/corrections.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const storeIdx = args.indexOf("--store");
const storePath = storeIdx >= 0
  ? args[storeIdx + 1]
  : path.join(__dirname, "..", "data", "demo-corrections.json");
const rest = storeIdx >= 0 ? args.filter((a, i) => i !== storeIdx && i !== storeIdx + 1) : args;
const mode = rest[0] === "--loop" ? "loop" : "once";
const prompt = mode === "once" ? rest.join(" ").trim() : "";

const hr = (t) => console.log(`\n${"─".repeat(4)} ${t} ${"─".repeat(60)}`);

if (mode === "once") {
  if (!prompt) {
    console.log('Usage: node demo/end-to-end.js "<prompt>"   |   node demo/end-to-end.js --loop');
    process.exit(0);
  }
  console.log(`RAW PROMPT:\n  ${prompt}`);

  hr("STAGE 1 — Ambiguity Detector (phase1)");
  const det = detect(prompt);
  console.log(`ambiguity score: ${det.ambiguity_score}  flags: ${det.flags.length}`);
  for (const f of det.flags) {
    console.log(`  [${f.id}] ${f.category} (sev ${f.severity}) -> ${f.resolution === "assumption" ? "safe default" : "clarifying question"}`);
    console.log(`        evidence: ${f.evidence}`);
  }
  if (det.flags.length === 0) console.log("  (no ambiguity flags — clean prompt)");

  hr("STAGE 2 — Rewriter (phase2)");
  const rw = await rewrite(prompt, { memoryPath: storePath });
  console.log(`assumptions: ${rw.assumptions_made.length}  open questions: ${rw.clarifying_questions.length}  memory applied: ${rw.memory.applied.length}`);
  console.log("\n--- OPTIMIZED PROMPT ---");
  console.log(rw.optimized_prompt);

  hr("STAGE 3 — Intent-Preservation Verifier (phase3)");
  const v = verify(prompt, rw);
  console.log(v.diff_report);
  process.exit(v.ok ? 0 : 1);
}

// ---- --loop: the correction-memory story ----
const store = new CorrectionStore(storePath);
console.log(`DEMO memory store: ${storePath}\n`);

hr("SESSION 1 — user corrects the agent once");
const s1 = extractCorrections("no, use Vue instead of React");
console.log(`reply: "no, use Vue instead of React"  -> events: ${JSON.stringify(s1.map((e) => e.value))}`);
store.record(s1, { source: "demo-session-1" });
console.log(`store: ${store.all().map((r) => `[${r.status}] ${r.value}`).join(", ")}`);

hr("rewrite a NEW prompt — candidate must NOT be applied (over-fit guard)");
const r1 = await rewrite("build a habit tracker web app", { memoryPath: storePath });
console.log(`memory: applied=${JSON.stringify(r1.memory.applied)}  preference in prompt: ${r1.optimized_prompt.includes("USER PREFERENCE")}`);

hr("SESSION 2 — user corrects the same way again");
const s2 = extractCorrections("I prefer Vue, not React");
console.log(`reply: "I prefer Vue, not React"  -> events: ${JSON.stringify(s2.map((e) => e.value))}`);
store.record(s2, { source: "demo-session-2" });
console.log(`store: ${store.all().map((r) => `[${r.status}] ${r.value} (count=${r.count})`).join(", ")}`);

hr("rewrite ANOTHER new prompt — standing preference now auto-applies, labeled");
const r2 = await rewrite("build a recipe box web app", { memoryPath: storePath });
const prefLine = r2.assumptions_made.find((a) => a.category === "memory_applied");
console.log(`memory: applied=${JSON.stringify(r2.memory.applied)}`);
console.log(`injected line: ${prefLine?.text}`);
const v2 = verify("build a recipe box web app", r2);
console.log(`phase 3 gate: ${v2.ok ? "PASS" : "FAIL"}`);

hr("CONFLICT GUARD — a standing prohibition meets a prompt that asks for it");
const s3 = extractCorrections("never use comments in the code");
store.record(s3, { source: "demo-session-3" });
store.record(extractCorrections("never use comments in the code"), { source: "demo-session-4" });
console.log(`standing now: ${store.standing().map((r) => `"${r.value}"`).join(", ")}`);
const r3 = await rewrite("build a blog with a comments section under each post", { memoryPath: storePath });
console.log(`prompt asks for comments -> applied=${JSON.stringify(r3.memory.applied)} skipped=${JSON.stringify(r3.memory.skipped.map((s) => s.reason))}`);
const r4 = await rewrite("build a blog with posts and an about page", { memoryPath: storePath });
console.log(`neutral prompt          -> applied=${JSON.stringify(r4.memory.applied)} (preference flows normally)`);

hr("STORE CONTENTS");
console.log(fs.readFileSync(storePath, "utf8").split("\n").slice(0, 4).join("\n") + "\n  ...");
console.log(`\ninspect/reset any time:  npm run memory -- list   |   delete ${path.relative(process.cwd(), storePath)}`);
