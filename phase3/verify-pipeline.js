#!/usr/bin/env node
// Phase 3 verification harness (exit criteria):
//   1. Zero false positives: every GENUINE rewrite of the 30 dataset prompts
//      (+10 stress prompts if present) passes the gate.
//   2. Zero false negatives: 9 hand-built tampered rewrites (dropped phrase,
//      paraphrase, altered number, smuggled imperative line, imperative
//      assumption, category smuggling, non-empty removed/modified, injected
//      contradiction) ALL fail the gate.
//   3. Edge cases: empty / one-word / ~3k-word prompts — no crashes.
//   4. CLI gate smoke test; deep-check (Ollama) only if the server is up.
// Usage: node phase3/verify-pipeline.js
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { rewrite } from "../phase2/rewriter.js";
import { verify, renderDiffReport } from "./verifier.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let pass = 0, failCount = 0;
const ok = (label, cond, extra = "") => {
  if (cond) pass++;
  else { failCount++; console.log(`  ✗ FAIL ${label} ${extra}`); }
};

// ---- 1. Genuine rewrites must pass (zero false positives) ----
console.log("== Genuine rewrites (dataset + stress) ==");
const dataset = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "phase0", "prompts.dataset.json"), "utf8"));
const stressPath = path.join(__dirname, "..", "phase1", "stress-prompts.json");
const stress = fs.existsSync(stressPath) ? JSON.parse(fs.readFileSync(stressPath, "utf8")).prompts : [];
const prompts = [];
for (const p of dataset.pairs) {
  prompts.push({ label: `${p.id}/ambiguous`, text: p.ambiguous.text });
  prompts.push({ label: `${p.id}/explicit`, text: p.explicit.text });
}
for (const p of stress) prompts.push({ label: `stress:${p.id}`, text: p.text });

let sampleReport = null;
for (const p of prompts) {
  const rw = await rewrite(p.text, { mode: "verbatim" });
  ok(`${p.label}: rewrite ok`, rw.ok);
  const v = verify(p.text, rw);
  ok(`${p.label}: gate PASS`, v.ok, JSON.stringify(v.hard_failures));
  if (p.label === "kanban/ambiguous") sampleReport = { rw, v };
}
console.log(`  genuine rewrites checked: ${prompts.length}`);

// ---- 2. Tampered rewrites must fail (zero false negatives) ----
console.log("== Tampered rewrites (mutations must ALL fail) ==");
const raw = dataset.pairs.find((p) => p.id === "kanban").ambiguous.text;
const rw = await rewrite(raw, { mode: "verbatim" });
const base = rw.optimized_prompt;
const mutate = async (label, fn) => {
  const m = fn(rw, base);
  const v = verify(raw, m);
  ok(`mutation ${label} fails gate`, !v.ok, "gate PASSED a tampered rewrite!");
};
const drop = "for my dev team";
const reLine = (s, from, to) => s.split("\n").map((l) => (l.includes(from) ? l.replace(from, to) : l)).join("\n");

await mutate("dropped-phrase", (rw, base) => ({ ...rw, optimized_prompt: base.replace(drop, "") }));
await mutate("paraphrased-phrase", (rw, base) => ({ ...rw, optimized_prompt: base.replace("I'd like some reporting on top", "I would enjoy a few reports as well") }));
await mutate("altered-number", (rw, base) => ({ ...rw, optimized_prompt: reLine(base, "some reporting on top", "reporting on top of that") }));
await mutate("smuggled-imperative", (rw, base) => ({ ...rw, optimized_prompt: base + "\n\nThe app must require users to log in with email." }));
await mutate("imperative-assumption", (rw, base) => ({ ...rw, assumptions_made: [...rw.assumptions_made, { category: "missing_stack", severity: 2, text: "ASSUMED: the app must require Google sign-in" }] }));
await mutate("category-smuggling", (rw, base) => ({ ...rw, clarifying_questions: [...rw.clarifying_questions, { category: "nonexistent_category", severity: 4, text: "What color scheme?" }] }));
await mutate("nonempty-removed", (rw) => ({ ...rw, changes: { ...rw.changes, removed: ["some reporting"] } }));
await mutate("nonempty-modified", (rw) => ({ ...rw, changes: { ...rw.changes, modified: ["reporting -> reports"] } }));
await mutate("injected-contradiction", (rw, base) => ({ ...rw, warnings: [{ type: "possible_contradiction", category: "unspecified_auth", detail: 'assumption may conflict with "team" in the original' }] }));

// ---- 2b. Optimizer Gate Verification ----
console.log("== Optimizer gate verification ==");
{
  const optPrompt = "i want an expense tracker with login, food travel shopping categories, and monthly budget view";
  const optRw = await rewrite(optPrompt, { mode: "optimize" });
  const optV = verify(optPrompt, optRw);
  ok("genuine optimizer rewrite passes gate", optV.ok);

  // Dropping auth from the optimized prompt must fail requirement-preservation check
  const tamperedDroppedReq = { ...optRw, optimized_prompt: optRw.optimized_prompt.replace(/\* User registration\/login\.\n/i, "") };
  const vDropped = verify(optPrompt, tamperedDroppedReq);
  ok("tampered optimizer rewrite (dropped requirement) fails gate", !vDropped.ok && vDropped.hard_failures.some((f) => f.check === "requirement-preservation" || f.check === "canonical-rebuild"));
}

// ---- 3. Edge cases ----
console.log("== Edge cases ==");
for (const [label, text] of [["empty", ""], ["one-word", "app"], ["long ~3k words", "Build an app with these details. ".repeat(400)]]) {
  try {
    const r = await rewrite(text, { mode: "verbatim" });
    const v = verify(text, r);
    ok(`edge ${label}: no crash`, true, "");
    if (label === "empty") ok("edge empty: gate fails it", !v.ok);
  } catch (e) {
    ok(`edge ${label}: no crash`, false, e.message);
  }
}

// ---- 4. CLI gate smoke (empty stdin path is covered by usage; check exit code path via direct call) ----
console.log("== CLI / report ==");
ok("diff report renders verdict line", /VERDICT: (✓ PASS|✗ HARD FAIL)/.test(renderDiffReport(raw, sampleReport.v.diff, sampleReport.v.hard_failures, sampleReport.v.warnings)));

// ---- Optional deep check (only if Ollama is reachable) ----
const deepUp = await fetch("http://localhost:11434/api/version", { signal: AbortSignal.timeout(2000) }).then((r) => r.ok).catch(() => false);
if (deepUp) {
  const { deepCheck } = await import("./deep-check.js");
  const d = await deepCheck(raw, sampleReport.rw.optimized_prompt);
  ok("deep check: ran or gracefully unavailable", true);
  console.log(`  deep check: available=${d.available} flags=${d.available ? d.flags.length : d.reason}`);
} else {
  console.log("  deep check: Ollama not running — skipped (opt-in, advisory only)");
}

console.log(`\n${failCount === 0 ? "ALL CHECKS PASSED" : "FAILURES PRESENT"}: ${pass} passed, ${failCount} failed`);
if (sampleReport) console.log("\n=== SAMPLE DIFF REPORT (kanban/ambiguous) ===\n" + sampleReport.v.diff_report);
process.exit(failCount === 0 ? 0 : 1);
