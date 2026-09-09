#!/usr/bin/env node
// Phase 6 ↔ Phase 4 ↔ Phase 2 wiring harness. Fixture-based, planted outcomes:
//   1. A/B-shaped transcript: user prohibition then agent BUILD of the same
//      feature -> structural VIOLATION + prohibition routed to memory.
//   2. Agent CLARIFY questions about prohibited features -> NO phantom
//      violation, NO phantom inclusion (questions are not requirements).
//   3. Agent turns cannot add requirements (check-only write path).
//   4. Seeded prompt: user reply echoing the original verbatim -> NO
//      duplicate/memory event from the echo.
//   5. Violation -> canonical memory event ("no attachments"), not a junk
//      agent-voice key.
//   6. Repeated identical drift across 3 sessions (shared store) -> promoted
//      to standing; one-off drift stays candidate (over-fit guard).
//   7. Same-feature violation + judge flag -> routed ONCE (dedup).
//   8. Explicit-spec transcript with no drift -> zero events anywhere.
//   9. user-reply corrections still reach memory (Phase 4 path intact).
//  10. Regressions: drift + linter harnesses, Phase 4 harness.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { SpecLedger } from "./ledger.js";
import { CorrectionStore } from "../phase4/corrections.js";
import { wireSession, messagesFromSession, memoryEventsFromUserMessage } from "./ab-wiring.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let pass = 0, failCount = 0;
const ok = (label, cond, extra = "") => {
  if (cond) pass++;
  else { failCount++; console.log(`  ✗ FAIL ${label} ${extra}`); }
};
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lemonade-p6w-"));
const store = (name) => new CorrectionStore(path.join(tmp, `${name}.json`));

const SPEC = "Build a board. Attachments, labels and multiple boards are out of scope. No login for v1.";

// ---- 1. violation + memory routing ----
console.log("== Violation -> memory routing ==");
{
  const led = new SpecLedger(path.join(tmp, "h1.json"));
  led.processMessage(SPEC, { trusted: true });
  const rec = { transcript: [
    { turn: 1, role: "user", kind: "ANSWER", text: "Attachments, labels and multiple boards are out of scope." },
    { turn: 2, role: "agent", kind: "BUILD", text: "Implementing the ability to add attachments to cards now." },
  ] };
  const out = wireSession({ record: rec, ledger: led, store: store("s1"), sessionId: "h1", initialPrompt: SPEC });
  ok("agent build of prohibited feature -> violation", out.totals.violations === 1, JSON.stringify(out.totals));
  ok("violation routed to memory as canonical prohibition", out.routed.some((r) => r.from === "violation" && /no attachments/i.test(r.event.value)), JSON.stringify(out.routed.map((r) => r.event.value)));
  ok("memory record created", Object.keys(store("s1").all ? store("s1").data.preferences : {}).length >= 1);
}

// ---- 2. CLARIFY phantom guard ----
console.log("== CLARIFY phantom guard ==");
{
  const led = new SpecLedger(path.join(tmp, "h2.json"));
  led.processMessage(SPEC, { trusted: true });
  const rec = { transcript: [
    { turn: 1, role: "user", kind: "ANSWER", text: "Attachments, labels and multiple boards are out of scope." },
    { turn: 2, role: "agent", kind: "CLARIFY", text: "CLARIFY: Is it important to have the ability to add attachments, labels, and manage multiple boards in the initial release?" },
  ] };
  const out = wireSession({ record: rec, ledger: led, store: store("s2"), sessionId: "h2", initialPrompt: SPEC });
  ok("CLARIFY about prohibited feature -> no violation", out.totals.violations === 0, JSON.stringify(out.totals));
  ok("CLARIFY -> no agent-flag (question is not invention)", out.totals.agentFlaggedTurns === 0, JSON.stringify(out.totals));
  ok("CLARIFY -> nothing routed to memory", out.totals.memoryEventsRouted === 0, JSON.stringify(out.totals));
}

// ---- 3. agent turns cannot add requirements ----
console.log("== Agent write-path guard ==");
{
  const led = new SpecLedger(path.join(tmp, "h3.json"));
  const rec = { transcript: [
    { turn: 1, role: "agent", kind: "BUILD", text: "I will include dark mode and 5 boards in the build." },
  ] };
  const out = wireSession({ record: rec, ledger: led, store: store("s3"), sessionId: "h3" });
  ok("agent BUILD adds no entries", led.activeEntries().length === 0, JSON.stringify(led.activeEntries()));
  ok("agent invention still flagged by judge layer", out.totals.agentFlaggedTurns >= 1, JSON.stringify(out.totals));
}

// ---- 4. seeded-prompt echo guard ----
console.log("== Echo guard ==");
{
  const led = new SpecLedger(path.join(tmp, "h4.json"));
  const rec = { transcript: [
    { turn: 1, role: "user", kind: "ANSWER", text: "Q: Which part is the priority?\nA: Attachments, labels and multiple boards are out of scope." },
  ] };
  const out = wireSession({ record: rec, ledger: led, store: store("s4"), sessionId: "h4", initialPrompt: SPEC });
  ok("verbatim echo of seeded spec -> no memory event", out.totals.memoryEventsRouted === 0, JSON.stringify(out.routed.map((r) => r.event.value)));
  ok("echo -> no ledger violation", out.totals.violations === 0, JSON.stringify(out.totals));
}

// ---- 5/6. canonical keys + promotion across sessions ----
console.log("== Promotion across sessions ==");
{
  const dir = path.join(tmp, "promo");
  fs.mkdirSync(dir, { recursive: true });
  const mem = new CorrectionStore(path.join(dir, "mem.json"));
  const mkSession = (i) => ({
    transcript: [
      { turn: 1, role: "user", kind: "ANSWER", text: "Attachments, labels and multiple boards are out of scope." },
      { turn: 2, role: "agent", kind: "BUILD", text: `Building now: implementing support for attachments in release ${i}.` },
    ],
  });
  for (let i = 1; i <= 3; i++) {
    const led = new SpecLedger(path.join(dir, `l${i}.json`));
    wireSession({ record: mkSession(i), ledger: led, store: mem, sessionId: `p${i}`, initialPrompt: SPEC });
  }
  const rec = mem.all().find((r) => r.key === "attachments");
  ok("canonical memory key attachments exists", !!rec, JSON.stringify(mem.all().map((r) => r.key)));
  ok("repeated drift across 3 sessions -> standing", rec?.status === "standing", JSON.stringify({ key: rec?.key, status: rec?.status, count: rec?.count }));
  ok("count crossed threshold (3)", rec?.count === 3, String(rec?.count));
  ok("source is ledger-violation", rec?.sources?.[0]?.source === "ledger-violation", JSON.stringify(rec?.sources?.[0]));
  ok("value keeps prohibition polarity (no attachments)", /^no attachments$/i.test(rec?.value ?? ""), rec?.value);
}

// ---- 7. dedup: violation + judge flag same feature = one event ----
console.log("== Dedup ==");
{
  const led = new SpecLedger(path.join(tmp, "h7.json"));
  led.processMessage(SPEC, { trusted: true });
  const rec = { transcript: [
    { turn: 1, role: "user", kind: "ANSWER", text: "Attachments, labels and multiple boards are out of scope." },
    { turn: 2, role: "agent", kind: "BUILD", text: "Adding attachments to cards." },
  ] };
  const out = wireSession({ record: rec, ledger: led, store: store("s7"), sessionId: "h7", initialPrompt: SPEC });
  const attach = out.routed.filter((r) => /attach/i.test(r.event.value));
  ok("same-feature violation + flag routes once", attach.length === 1, JSON.stringify(out.routed.map((r) => r.event.value)));
  ok("routed from structural violation (not double-flagged)", attach[0]?.from === "violation", JSON.stringify(attach.map((r) => r.from)));
}

// ---- 8. clean explicit transcript -> zero everywhere ----
console.log("== Clean session ==");
{
  const led = new SpecLedger(path.join(tmp, "h8.json"));
  const explicit = "Build a kanban board web app: 3 fixed columns, no login for v1. Attachments, labels and multiple boards are out of scope.";
  const rec = { transcript: [
    { turn: 1, role: "user", kind: "ANSWER", text: "I answered a round of questions already - please proceed with your best judgment now." },
    { turn: 2, role: "agent", kind: "BUILD", text: "Building the 3-column board now, without attachments or labels." },
    { turn: 3, role: "agent", kind: "DONE", text: "DONE: board complete, attachments and labels excluded as requested." },
  ] };
  const out = wireSession({ record: rec, ledger: led, store: store("s8"), sessionId: "h8", initialPrompt: explicit });
  ok("clean session -> zero violations", out.totals.violations === 0, JSON.stringify(out.totals));
  ok("clean session -> zero agent flags", out.totals.agentFlaggedTurns === 0, JSON.stringify(out.totals));
  ok("clean session -> zero memory events", out.totals.memoryEventsRouted === 0, JSON.stringify(out.totals));
}

// ---- 9. user-reply correction path intact ----
console.log("== User-reply corrections ==");
{
  const led = new SpecLedger(path.join(tmp, "h9.json"));
  led.processMessage("we'll build the settings panel first", { trusted: true });
  const rec = { transcript: [
    { turn: 1, role: "user", kind: "ANSWER", text: "No, use Vue instead of React." },
    { turn: 2, role: "agent", kind: "BUILD", text: "Building with Vue." },
  ] };
  const mem = store("s9");
  const out = wireSession({ record: rec, ledger: led, store: mem, sessionId: "h9", initialPrompt: "Build the settings panel. Stack: React." });
  ok("user replacement correction reaches memory", mem.all().some((r) => /vue/i.test(r.value)), JSON.stringify(mem.all().map((r) => r.value)));
  ok("correction recorded as reply (not ledger-violation)", mem.all().find((r) => /vue/i.test(r.value))?.sources?.[0]?.source === "reply", JSON.stringify(mem.all().find((r) => /vue/i.test(r.value))?.sources?.[0]));
}

// ---- 10. regressions ----
console.log("== Regressions ==");
try { execFileSync("node", [path.join(__dirname, "verify-drift.js")], { stdio: "pipe" }); ok("phase6 drift harness green", true); }
catch (e) { ok("phase6 drift harness green", false, String(e.stdout ?? e.message).slice(-200)); }
try { execFileSync("node", [path.join(__dirname, "verify-linter.js")], { stdio: "pipe" }); ok("phase6 linter harness green", true); }
catch (e) { ok("phase6 linter harness green", false, String(e.stdout ?? e.message).slice(-200)); }
try { execFileSync("node", [path.join(__dirname, "..", "phase4", "verify-memory.js")], { stdio: "pipe" }); ok("phase4 memory harness green", true); }
catch (e) { ok("phase6 memory harness green", false, String(e.stdout ?? e.message).slice(-200)); }

console.log(failCount === 0 ? `\nALL CHECKS PASSED: ${pass} passed, 0 failed` : `\nFAILURES PRESENT: ${pass} passed, ${failCount} failed`);
process.exit(failCount === 0 ? 0 : 1);
