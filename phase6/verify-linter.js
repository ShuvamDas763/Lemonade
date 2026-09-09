#!/usr/bin/env node
// Phase 6 verification harness:
//   1. Span invariants on planted prompts: bounds, non-empty text, sorted,
//      span text == raw slice at [start:end).
//   2. Detector consistency: detectSpans categories == detect() categories.
//   3. Clean prompt (fully specified): zero flags.
//   4. CLI: file mode, stdin mode, --json (parses, spans have line/col),
//      --strict exit 1 with flags / exit 0 without, missing file -> exit 2.
//   5. Regressions: phase1/2/3/4/5 harnesses still green.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { detect, detectSpans } from "../phase1/detector.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let pass = 0, failCount = 0;
const ok = (label, cond, extra = "") => {
  if (cond) pass++;
  else { failCount++; console.log(`  ✗ FAIL ${label} ${extra}`); }
};

// ---- 1+2. Span invariants + detector consistency ----
console.log("== Span invariants ==");
const texts = [
  "make me a tinder clone but for books, with a nice modern look",
  "I want a meal planner for my family, make it look nice, and maybe a shopping list too, my wife should see it on her phone",
  "build a chatgpt wrapper for my site, send me an email when done",
  "",
  "app",
];
for (const t of texts) {
  const det = detect(t);
  const spans = detectSpans(t);
  const catsA = det.flags.map((f) => f.category).sort().join(",");
  const catsB = spans.map((f) => f.category).sort().join(",");
  ok(`categories match detect() [${(t.slice(0, 30) || "(empty)")}]`, catsA === catsB, `${catsA} vs ${catsB}`);
  for (const f of spans) {
    for (const s of f.spans) {
      ok(`span in bounds [${f.category}]`, s.start >= 0 && s.end <= t.length && s.start < s.end, JSON.stringify(s));
      ok(`span text matches slice [${f.category}]`, t.slice(s.start, s.end) === s.text, JSON.stringify(s));
    }
    ok(`spans sorted [${f.category}]`, f.spans.every((s, i) => i === 0 || f.spans[i - 1].start <= s.start));
  }
}

// ---- 3. Clean prompt ----
console.log("== Clean prompt ==");
const cleanText = "Build a kanban board web app: 3 fixed columns, drag-and-drop cards. Stack: Next.js + Prisma + SQLite, one shared workspace, no login for v1. Reporting = exactly one view: cards moved to Done per week for the last 4 weeks. Attachments, labels and multiple boards are out of scope. Done = moving a card persists, and the weekly report counts it.";
const cleanSpans = detectSpans(cleanText);
ok("fully specified prompt -> 0 span flags", cleanSpans.length === 0, JSON.stringify(cleanSpans.map((f) => f.category)));

// ---- 4. CLI modes ----
console.log("== CLI modes ==");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lemonade-p6-"));
const sample = path.join(tmp, "prompt.txt");
fs.writeFileSync(sample, texts[1] + "\n");
const run = (args, opts = {}) => {
  try {
    const stdout = execFileSync("node", [path.join(__dirname, "lint-cli.js"), ...args], { encoding: "utf8", ...opts });
    return { code: 0, stdout };
  } catch (e) {
    return { code: e.status, stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
  }
};
const r1 = run([sample]);
ok("file mode: flags rendered", /vague_scope|missing_data_model|unspecified_auth/.test(r1.stdout) && /\^+/.test(r1.stdout), r1.stdout.slice(0, 200));
const r2 = run(["--stdin"], { input: texts[2] });
ok("stdin mode works", r2.code === 0 && /vague_integration/.test(r2.stdout), r2.stdout.slice(0, 200));
const r3 = run([sample, "--json"]);
let parsed = null;
try { parsed = JSON.parse(r3.stdout); } catch { /* leave null */ }
ok("--json parses", !!parsed && Array.isArray(parsed.flags), r3.stdout.slice(0, 120));
ok("--json spans carry line/col", !!parsed && parsed.flags.some((f) => f.spans.some((s) => s.line >= 1 && s.col >= 1)));
const r4 = run([sample, "--strict"]);
ok("--strict exits 1 with flags", r4.code === 1);
const cleanFile = path.join(tmp, "clean.txt");
fs.writeFileSync(cleanFile, cleanText);
const r5 = run([cleanFile, "--strict"]);
ok("--strict exits 0 on clean prompt", r5.code === 0 && /no ambiguity flags/.test(r5.stdout));
const r6 = run([path.join(tmp, "nope.txt")]);
ok("missing file -> exit 2", r6.code === 2);
const r7 = run([sample, "--min-severity", "3"]);
ok("--min-severity filters", !/vague_scope/.test(r7.stdout) && /sev 3/.test(r7.stdout), r7.stdout.slice(0, 200));

// ---- 5. Regressions ----
console.log("== Regressions ==");
const run2 = (p) => execFileSync("node", [p], { encoding: "utf8" });
ok("phase1 recall 100%", /100\.0%/.test(run2(path.join(__dirname, "..", "phase1", "verify-detector.js"))));
ok("phase2 30/30", (run2(path.join(__dirname, "..", "phase2", "verify-rewriter.js")).match(/ok=true/g) ?? []).length === 30);
ok("phase3 ALL PASSED", /ALL CHECKS PASSED/.test(run2(path.join(__dirname, "..", "phase3", "verify-pipeline.js"))));
ok("phase4 ALL PASSED", /ALL CHECKS PASSED/.test(run2(path.join(__dirname, "..", "phase4", "verify-memory.js"))));
ok("phase5 ALL PASSED", /ALL CHECKS PASSED/.test(run2(path.join(__dirname, "..", "phase5", "verify-feedback.js"))));

console.log(`\n${failCount === 0 ? "ALL CHECKS PASSED" : "FAILURES PRESENT"}: ${pass} passed, ${failCount} failed`);
process.exit(failCount === 0 ? 0 : 1);
