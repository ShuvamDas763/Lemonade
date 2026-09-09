#!/usr/bin/env node
// Phase 4 verification harness (exit criteria):
//   1. Promotion: the same correction across 2 mock sessions -> standing, and
//      it is injected (labeled [USER PREFERENCE]) into the next rewrite automatically.
//   2. Over-fit guard: a single correction (candidate) is NEVER auto-applied.
//   3. Conflict guard: standing "no comments" is skipped when the prompt asks
//      for comments (the prompt outranks the preference), with a recorded reason.
//   4. Stale: a preference unused for >45 days drops out of standing().
//   5. Graceful degradation: a corrupt store never breaks rewriting.
//   6. Phase 3 gate: memory assumptions pass the gate; stripping the visible
//      [USER PREFERENCE label is a HARD FAILURE (never silently hidden).
//   7. Regressions: phase1 recall + phase2/phase3 harnesses still green.
// Usage: node phase4/verify-memory.js
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractCorrections, CorrectionStore } from "./corrections.js";
import { rewrite } from "../phase2/rewriter.js";
import { verify } from "../phase3/verifier.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let pass = 0, failCount = 0;
const ok = (label, cond, extra = "") => {
  if (cond) pass++;
  else { failCount++; console.log(`  ✗ FAIL ${label} ${extra}`); }
};

// Isolated temp store for every scenario.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lemonade-p4-"));
const storePath = (name) => path.join(tmp, `${name}.json`);

// ---- 1+2. Promotion + over-fit guard ----
console.log("== Promotion & over-fit guard ==");
const p1 = storePath("promotion");
const evts1 = extractCorrections("no, use TypeScript instead of JavaScript");
ok("extract: replacement detected", evts1.length >= 1 && evts1[0].value.toLowerCase().includes("typescript"), JSON.stringify(evts1));
const s1 = new CorrectionStore(p1);
s1.record(evts1, { source: "mock-session-1" });
ok("after 1 correction: candidate", s1.all()[0].count === 1 && s1.all()[0].status === "candidate");
let rw1 = await rewrite("make me a small pomodoro timer", { memoryPath: p1 });
ok("candidate NOT auto-applied (over-fit guard)", rw1.memory.applied.length === 0 && !rw1.optimized_prompt.includes("USER PREFERENCE"));
const s2 = new CorrectionStore(p1);
s2.record(extractCorrections("no, use TypeScript instead of JavaScript"), { source: "mock-session-2" });
ok("after 2nd correction: standing", s2.all()[0].count === 2 && s2.all()[0].status === "standing");
let rw2 = await rewrite("make me a small pomodoro timer", { memoryPath: p1 });
const memA = rw2.assumptions_made.find((a) => a.category === "memory_applied");
ok("standing preference auto-applied", !!memA, "");
ok("applied text carries visible [USER PREFERENCE label", !!memA && /\[USER PREFERENCE/i.test(memA.text), memA?.text);
ok("rewriter reports applied key", rw2.memory.applied.length === 1);
const gateMem = verify("make me a small pomodoro timer", rw2);
ok("Phase 3 gate PASSes rewrite with memory assumption", gateMem.ok, JSON.stringify(gateMem.hard_failures));

// ---- 3. Conflict guard ----
console.log("== Conflict guard ==");
const p2 = storePath("conflict");
const s3 = new CorrectionStore(p2);
s3.record(extractCorrections("never use comments in the code"), { source: "mock-a" });
s3.record(extractCorrections("never use comments in the code"), { source: "mock-b" });
ok("prohibition recorded standing", s3.standing().length === 1 && s3.standing()[0].value.startsWith("no comments"), JSON.stringify(s3.standing()));
let rwC = await rewrite("build a blog with a comments section under each post", { memoryPath: p2 });
ok("conflicting preference SKIPPED (prompt outranks preference)", rwC.memory.applied.length === 0 && rwC.memory.skipped.length === 1, JSON.stringify(rwC.memory));
ok("skip reason recorded", /outranks/.test(rwC.memory.skipped[0]?.reason ?? ""));
let rwD = await rewrite("build a blog with posts and an about page", { memoryPath: p2 });
ok("non-conflicting prompt still gets the preference", rwD.memory.applied.length === 1);

// ---- 4. Stale ----
console.log("== Staleness ==");
const p3 = storePath("stale");
const s4 = new CorrectionStore(p3);
s4.record(extractCorrections("always use TypeScript"), { source: "old" });
s4.record(extractCorrections("always use TypeScript"), { source: "old" });
const rec = s4.all()[0];
rec.lastSeen = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString(); // 60 days ago
s4.save();
const s5 = new CorrectionStore(p3);
ok("60-day-old preference is stale, not standing", s5.standing().length === 0 && s5.all()[0].status === "stale");
let rwS = await rewrite("build a todo app", { memoryPath: p3 });
ok("stale preference NOT injected", rwS.memory.applied.length === 0);

// ---- 5. Graceful degradation ----
console.log("== Graceful degradation ==");
const p4 = storePath("corrupt");
fs.writeFileSync(p4, "{ not valid json !!");
let rwX = await rewrite("build a todo app", { memoryPath: p4 });
ok("corrupt store: rewrite still succeeds", rwX.ok === true);
ok("corrupt store: failure recorded in memory.skipped", rwX.memory.skipped.some((x) => /memory unavailable/.test(x.reason ?? "")), JSON.stringify(rwX.memory));

// ---- 6. Gate tamper: hidden label ----
console.log("== Gate: memory label is mandatory ==");
const stripped = JSON.parse(JSON.stringify(rw2));
for (const a of stripped.assumptions_made) if (a.category === "memory_applied") a.text = "[ASSUMED: TypeScript]";
const gateStripped = verify("make me a small pomodoro timer", stripped);
ok("stripping [USER PREFERENCE label = HARD FAIL", !gateStripped.ok && gateStripped.hard_failures.some((f) => f.check === "memory-label"), JSON.stringify(gateStripped.hard_failures));
const evtsEmpty = extractCorrections("   ");
ok("empty reply extracts nothing", evtsEmpty.length === 0);

// ---- 7. Regressions ----
console.log("== Regressions ==");
const { execFileSync } = await import("node:child_process");
const run = (cmd) => execFileSync("node", [cmd], { encoding: "utf8" });
const p2out = run(path.join(__dirname, "..", "phase2", "verify-rewriter.js"));
ok("phase2 verify still 30/30", (p2out.match(/ok=true/g) ?? []).length === 30);
const p3out = run(path.join(__dirname, "..", "phase3", "verify-pipeline.js"));
ok("phase3 pipeline still ALL CHECKS PASSED", /ALL CHECKS PASSED/.test(p3out));
const p1out = run(path.join(__dirname, "..", "phase1", "verify-detector.js"));
ok("phase1 recall still 100%", /100\.0%/.test(p1out));

console.log(`\n${failCount === 0 ? "ALL CHECKS PASSED" : "FAILURES PRESENT"}: ${pass} passed, ${failCount} failed`);
console.log(`(temp stores in ${tmp})`);
process.exit(failCount === 0 ? 0 : 1);
