#!/usr/bin/env node
// Spec-drift verification harness. Planted scenarios, each with an expected outcome:
//   A. prohibition vs later inclusion            -> VIOLATION (prohibition-violated)
//   B. numeric statement vs different number     -> VIOLATION (numeric-drift)
//   C. reversal marker ("actually, change of…")  -> NO violation, supersession recorded
//   D. reaffirmation ("no attachments" again)    -> count++ , no duplicate, no violation
//   E. confirm <id>                              -> old entry superseded, stops firing
//   F. fully consistent conversation             -> zero violations
//   G. edge cases (empty message) + regressions.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { extractRequirements, SpecLedger, phraseKey, REVERSAL_MARKERS } from "./ledger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let pass = 0, failCount = 0;
const ok = (label, cond, extra = "") => {
  if (cond) pass++;
  else { failCount++; console.log(`  ✗ FAIL ${label} ${extra}`); }
};
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lemonade-p6d-"));
const led = (name) => new SpecLedger(path.join(tmp, `${name}.json`));

// ---- Extraction ----
console.log("== Extraction ==");
const r1 = extractRequirements("no attachments, no login for v1, exactly 3 columns, add a comments section, include dark mode");
ok("prohibitions extracted", r1.filter((x) => x.kind === "prohibition").map((x) => x.key).join(",").includes("attachment") && r1.some((x) => x.key === "auth"), JSON.stringify(r1));
ok("quantity extracted with number", r1.some((x) => x.kind === "quantity" && x.key === "column" && x.number === 3), JSON.stringify(r1.filter((x) => x.kind === "quantity")));
ok("inclusion extracted", r1.some((x) => x.kind === "inclusion" && x.key === "comments"), JSON.stringify(r1.filter((x) => x.kind === "inclusion")));
ok("atomic phrase dark mode", r1.some((x) => x.key === "dark mode"));
ok("3 fixed columns -> keys on column", extractRequirements("the board should have exactly 3 fixed columns").some((x) => x.kind === "quantity" && x.key === "column"), JSON.stringify(extractRequirements("the board should have exactly 3 fixed columns")));
ok("out-of-scope phrase", extractRequirements("attachments are out of scope").some((x) => x.kind === "prohibition" && x.key === "attachments"), JSON.stringify(extractRequirements("attachments are out of scope")));
ok("empty text -> no requirements", extractRequirements("").length === 0);

// ---- A. prohibition vs inclusion ----
console.log("== Scenario A: prohibition violated ==");
const A = led("A");
A.processMessage("Build a board. No attachments for v1.");
const a2 = A.processMessage("Can you also add an attachments page?");
ok("violation flagged", a2.violations.length === 1 && a2.violations[0].type === "prohibition-violated", JSON.stringify(a2.violations));
ok("violation references the original", a2.violations[0].against.phrase.includes("no attachments") && a2.violations[0].against.firstSeenMessage === 1);
ok("strict CLI would gate", A.violations() === 1);

// ---- B. numeric drift ----
console.log("== Scenario B: numeric drift ==");
const B = led("B");
B.processMessage("The board should have exactly 3 fixed columns.");
const b2 = B.processMessage("Make it 5 columns, please.");
ok("numeric drift flagged", b2.violations.length === 1 && b2.violations[0].type === "numeric-drift", JSON.stringify(b2.violations));
ok("detail names both numbers", /3 .* 5|said 3.*says 5/.test(b2.violations[0].detail), b2.violations[0]?.detail);

// ---- C. reversal markers -> supersession, no violation ----
console.log("== Scenario C: intentional reversal ==");
const C = led("C");
C.processMessage("Use exactly 3 columns.");
const c2 = C.processMessage("Actually, change of plan: use 5 columns instead.");
ok("no violation when intentional", c2.violations.length === 0, JSON.stringify(c2.violations));
ok("supersession recorded", c2.reversals.length === 1 && C.all().filter((e) => e.supersededBy).length === 1, JSON.stringify(c2.reversals));
ok("new quantity is active", C.activeEntries().some((e) => e.kind === "quantity" && e.number === 5));

// ---- D. reaffirmation ----
console.log("== Scenario D: reaffirmation ==");
const D = led("D");
D.processMessage("No attachments in v1.");
const d2 = D.processMessage("Remember: no attachments.");
const entry = D.all().find((e) => e.key === "attachments");
ok("no duplicate entry", D.all().filter((e) => e.key === "attachments").length === 1);
ok("count incremented", entry.count === 2 && entry.lastSeen === 2, JSON.stringify(entry));

// ---- E. confirm flow ----
console.log("== Scenario E: confirm resolves ==");
const E = led("E");
E.processMessage("No attachments in v1.");
const e2 = E.processMessage("Add an attachments panel.");
const vid = e2.violations[0].against.id;
ok("confirm supersedes old entry", E.confirm(vid) === true);
ok("double-confirm refused", E.confirm(vid) === false);
const e3 = E.processMessage("Also extend the attachments view a bit more.");
ok("after confirm, no new violation", e3.violations.length === 0, JSON.stringify(e3.violations));

// ---- F. consistent conversation -> zero violations ----
console.log("== Scenario F: consistent conversation ==");
const F = led("F");
const msgs = [
  "Build a kanban board: 3 columns, no attachments, no login for v1.",
  "The board needs drag and drop between the 3 columns.",
  "Add a weekly report of cards moved to Done.",
  "Remember, no attachments and no login.",
];
let viol = 0;
msgs.forEach((m) => { viol += F.processMessage(m).violations.length; });
ok("consistent convo -> 0 violations", viol === 0, String(viol));
ok("reaffirmations counted", F.all().filter((e) => e.count > 1).length >= 1);

// ---- CLI ----
console.log("== CLI ==");
const run = (args, opts = {}) => {
  try { return { code: 0, stdout: execFileSync("node", [path.join(__dirname, "drift-cli.js"), ...args], { encoding: "utf8", ...opts }) }; }
  catch (e) { return { code: e.status, stdout: e.stdout ?? "", stderr: e.stderr ?? "" }; }
};
const lp = path.join(tmp, "cli-ledger.json");
run(["say", "Build a board, no attachments.", "--ledger", lp]);
const rc2 = run(["say", "Add an attachments page please.", "--ledger", lp, "--strict"]);
ok("CLI strict exits 1 on violation", rc2.code === 1 && /VIOLATION/.test(rc2.stdout), rc2.stdout.slice(0, 160));
const rj = run(["say", "Add a ratings widget.", "--ledger", lp, "--json"]);
let parsed = null;
try { parsed = JSON.parse(rj.stdout); } catch { /* noop */ }
ok("CLI --json parses", !!parsed && Array.isArray(parsed.additions));
run(["confirm", parsed ? "x" : "x", "--ledger", lp]); // smoke: bad id handled gracefully
const rs = run(["stats", "--ledger", lp]);
ok("CLI stats render", /messages: \d+/.test(rs.stdout));

// ---- Edge cases ----
console.log("== Edge cases ==");
const G = led("G");
const g1 = G.processMessage("");
ok("empty message: no crash, no additions", g1.additions.length === 0 && g1.violations.length === 0);

// ---- Regressions ----
console.log("== Regressions ==");
const run2 = (p) => execFileSync("node", [p], { encoding: "utf8" });
ok("phase1 recall 100%", /100\.0%/.test(run2(path.join(__dirname, "..", "phase1", "verify-detector.js"))));
ok("phase2 30/30", (run2(path.join(__dirname, "..", "phase2", "verify-rewriter.js")).match(/ok=true/g) ?? []).length === 30);
ok("phase3 ALL PASSED", /ALL CHECKS PASSED/.test(run2(path.join(__dirname, "..", "phase3", "verify-pipeline.js"))));
ok("phase4 ALL PASSED", /ALL CHECKS PASSED/.test(run2(path.join(__dirname, "..", "phase4", "verify-memory.js"))));
ok("phase5 ALL PASSED", /ALL CHECKS PASSED/.test(run2(path.join(__dirname, "..", "phase5", "verify-feedback.js"))));
ok("phase6 linter ALL PASSED", /ALL CHECKS PASSED/.test(run2(path.join(__dirname, "..", "phase6", "verify-linter.js"))));

console.log(`\n${failCount === 0 ? "ALL CHECKS PASSED" : "FAILURES PRESENT"}: ${pass} passed, ${failCount} failed`);
process.exit(failCount === 0 ? 0 : 1);
