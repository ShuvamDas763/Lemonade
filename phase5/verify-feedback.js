#!/usr/bin/env node
// Phase 5 verification harness (exit criteria):
//   1. 46 mock outcomes planted so the scorer MUST identify:
//      R1 healthy (high accept), R2 watch (borderline), R3 flagged (noisy),
//      R5 provisional (<8 observations) — anything else is a bug.
//   2. Flagged rules are surfaced in the report, never auto-removed.
//   3. Edit-diff learning: label-stripped, short, changed edits record events;
//      long/identical/empty edits are skipped; two matching edits promote.
//   4. Store guards: unknown outcome rejected; FIFO cap respected.
//   5. Regressions: phase1/2/3/4 harnesses still green.
// Usage: node phase5/verify-feedback.js
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { OutcomeStore, ruleStats, generateReport, learnFromEdits, ROLLING, MIN_OBSERVATIONS } from "./feedback.js";
import { CorrectionStore } from "../phase4/corrections.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let pass = 0, failCount = 0;
const ok = (label, cond, extra = "") => {
  if (cond) pass++;
  else { failCount++; console.log(`  ✗ FAIL ${label} ${extra}`); }
};

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lemonade-p5-"));
const outcomesPath = path.join(tmp, "outcomes.json");
const corrPath = path.join(tmp, "corrections.json");

// ---- 1. Planted mock outcomes ----
console.log("== Planted outcomes -> expected statuses ==");
// Ground truth planted into the data (verify the scorer finds it):
//   R1: 12 accepted, 1 edited, 1 rejected        -> acceptRate 0.857 -> healthy
//   R2: 6 accepted, 3 edited, 3 rejected         -> 0.5              -> watch
//   R3: 1 accepted, 2 edited, 9 rejected         -> 0.083            -> flagged
//   R4: 7 accepted, 1 edited                     -> provisional (n=8? -> not <8)
//       give R4 n=5 -> provisional
//   R5: 4 accepted, 2 rejected                   -> provisional (n=6 < 8)
//   R6: 10 accepted, 2 edited                    -> 0.833 -> healthy
// total events = 14 + 12 + 12 + 5 + 6 + 12 = 61 (>= 30 required by the brief)
const plant = {
  R1: ["accepted", "accepted", "accepted", "accepted", "accepted", "accepted", "accepted", "accepted", "accepted", "accepted", "accepted", "accepted", "edited", "rejected"],
  R2: ["accepted", "accepted", "accepted", "accepted", "accepted", "accepted", "edited", "edited", "edited", "rejected", "rejected", "rejected"],
  R3: ["rejected", "rejected", "rejected", "rejected", "rejected", "rejected", "rejected", "rejected", "rejected", "edited", "edited", "accepted"],
  R4: ["accepted", "accepted", "accepted", "accepted", "rejected"],
  R5: ["accepted", "accepted", "accepted", "accepted", "rejected", "rejected"],
  R6: ["accepted", "accepted", "accepted", "accepted", "accepted", "accepted", "accepted", "accepted", "accepted", "accepted", "edited", "edited"],
};
const store = new OutcomeStore(outcomesPath);
let eventCount = 0;
for (const [id, outcomes] of Object.entries(plant)) {
  for (const o of outcomes) {
    store.record({ outcome: o, flags: [id], sessionId: `mock-${id}-${eventCount}` });
    eventCount++;
  }
}
ok("46+ mock outcomes recorded", store.all().length === eventCount && eventCount >= 30, `${store.all().length}/${eventCount}`);

const stats = Object.fromEntries(ruleStats(store).map((r) => [r.id, r]));
const expect = {
  R1: "healthy", R2: "watch", R3: "flagged", R4: "provisional", R5: "provisional", R6: "healthy",
};
for (const [id, status] of Object.entries(expect)) {
  ok(`${id} -> ${status} (planted)`, stats[id]?.status === status, JSON.stringify(stats[id]));
}
ok("R3 acceptRate ~0.083", Math.abs(stats.R3.acceptRate - 1 / 12) < 0.01, String(stats.R3.acceptRate));

// ---- 2. Report surfaces flagged rules, removes nothing ----
console.log("== Report ==");
const { text, rows } = generateReport(store);
ok("report lists all 6 rules", rows.length === 6);
ok("report flags R3 in recommendations", /\*\*R3\*\*/.test(text));
ok("report recommends watch on R2", /R2\*\*: borderline/.test(text));
ok("report never auto-removes (human in the loop)", /never auto-removed/.test(text));

// ---- 3. Edit-diff learning ----
console.log("== Edit-diff learning ==");
const corr = new CorrectionStore(corrPath);
const n1 = learnFromEdits([{ original: "[ASSUMED: React (Vite)]", replacement: "Vue" }], corr);
ok("label-stripped edit records an event", n1 === 1, String(n1));
const n2 = learnFromEdits([{ original: "React", replacement: "React" }], corr);
ok("identical edit skipped", n2 === 0);
const n3 = learnFromEdits([{ original: "build the whole app with server side rendering using a custom framework", replacement: "use plain server components with no custom framework at all please" }], corr);
ok("over-long edit skipped (content, not preference)", n3 === 0);
const n4 = learnFromEdits([{ original: "[ASSUMED: React (Vite)]", replacement: "Vue" }], corr);
ok("second occurrence -> promotion candidate logic intact (2 events, still store's rule)", n4 === 1 && corr.all().find((r) => r.key.includes("vue"))?.count === 2, JSON.stringify(corr.all().map((r) => [r.key, r.count, r.status])));
ok("promotion threshold: 2 occurrences -> standing", corr.all().find((r) => r.key.includes("vue"))?.status === "standing");

// ---- 4. Store guards ----
console.log("== Store guards ==");
let threw = false;
try { store.record({ outcome: "meh", flags: ["R1"] }); } catch { threw = true; }
ok("unknown outcome rejected", threw);
const capped = new OutcomeStore(path.join(tmp, "capped.json"));
for (let i = 0; i < 2005; i++) capped.record({ outcome: "accepted", flags: ["RX"] });
ok("FIFO cap at 2000", capped.all().length === 2000);

// ---- 5. Regressions ----
console.log("== Regressions ==");
const { execFileSync } = await import("node:child_process");
const run = (cmd) => execFileSync("node", [cmd], { encoding: "utf8" });
ok("phase1 recall 100%", /100\.0%/.test(run(path.join(__dirname, "..", "phase1", "verify-detector.js"))));
ok("phase2 30/30", (run(path.join(__dirname, "..", "phase2", "verify-rewriter.js")).match(/ok=true/g) ?? []).length === 30);
ok("phase3 ALL PASSED", /ALL CHECKS PASSED/.test(run(path.join(__dirname, "..", "phase3", "verify-pipeline.js"))));
ok("phase4 ALL PASSED", /ALL CHECKS PASSED/.test(run(path.join(__dirname, "..", "phase4", "verify-memory.js"))));

console.log(`\n${failCount === 0 ? "ALL CHECKS PASSED" : "FAILURES PRESENT"}: ${pass} passed, ${failCount} failed`);
process.exit(failCount === 0 ? 0 : 1);
