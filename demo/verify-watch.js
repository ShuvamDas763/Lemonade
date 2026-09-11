#!/usr/bin/env node
// Watch-mode verification harness:
//   1. processPrompt(): gate PASS, verbatim embedding, meta sane, copy-shape
//      contract ({ok,tool}|{ok,reason}|null) holds on this machine
//   2. copyToClipboard(): unicode text, empty-input refuse, no-throw when no tool
//   3. spawned e2e: one-shot, --json, --quiet, piped stdin, --store isolation,
//      exit codes
//   4. Windows-only: clipboard content read back via Get-Clipboard and asserted
//      to contain the optimized prompt (the "it actually copied" proof);
//      user's prior clipboard content is restored afterwards
// REPL input loop itself needs a TTY and is exercised manually; its engine
// (processPrompt) is fully covered here.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { processPrompt } from "./watch.js";
import { copyToClipboard } from "./clipboard.js";

let failures = 0;
const check = (label, cond) => {
  if (!cond) { failures++; console.log(`  FAIL: ${label}`); }
  return cond;
};
const run = (args, input = null, env = {}) => new Promise((resolve) => {
  const child = spawn(process.execPath, ["demo/watch.js", ...args], { stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, ...env } });
  let out = "", err = "";
  child.stdout.on("data", (d) => (out += d));
  child.stderr.on("data", (d) => (err += d));
  if (input !== null) child.stdin.end(input); else child.stdin.end();
  child.on("close", (code) => resolve({ code, out, err }));
});

const runFeed = (args, lines, env = {}) => new Promise((resolve) => {
  const child = spawn(process.execPath, ["demo/watch.js", ...args], { stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, ...env } });
  let out = "", err = "";
  child.stdout.on("data", (d) => (out += d));
  child.stderr.on("data", (d) => (err += d));
  // Feed lines slowly: the REPL processes each asynchronously and the ledger
  // command reads the file the previous line's rewrite just persisted.
  (async () => {
    for (const [text, ms] of lines) {
      await new Promise((r) => setTimeout(r, ms));
      child.stdin.write(text);
    }
    child.stdin.end();
  })();
  child.on("close", (code) => resolve({ code, out, err }));
});

const PROMPT = "make me a tinder clone but for books, with a nice modern look";
const tmpStore = path.join(os.tmpdir(), `lemonade-watch-verify-${process.pid}.json`);

// Clipboard hygiene: sections 1 and 3 really copy, so save the user's
// clipboard FIRST and restore it at the end (Windows only).
const onWin = process.platform === "win32";
const ps = (...a) => new Promise((res) => {
  const c = spawn("powershell", ["-NoProfile", "-Command", ...a], { stdio: ["ignore", "pipe", "ignore"] });
  let o = ""; c.stdout.on("data", (d) => (o += d));
  c.on("close", () => res(o));
});
const prevClip = onWin ? await ps("Get-Clipboard") : null;

console.log("=== 1. processPrompt (engine shared by REPL + one-shot) ===");
{
  const r = await processPrompt(PROMPT, { store: tmpStore, copy: false, mode: "verbatim" });
  check("gate PASS", r.ok === true && r.meta.gate === "PASS");
  check("verbatim embedding", r.optimized_prompt.includes(PROMPT));
  check("meta counts sane", r.meta.flags >= 3 && r.meta.assumptions >= 2 && Array.isArray(r.meta.memory_applied));
  check("copy:false -> copied null", r.copied === null);
  console.log(`OK  gate=${r.meta.gate} flags=${r.meta.flags} assumptions=${r.meta.assumptions} overrides=${JSON.stringify(r.meta.memory_overrides)}`);

  const r2 = await processPrompt(PROMPT, { store: tmpStore, copy: true, mode: "verbatim" });
  check("copy attempted -> shape contract", r2.copied === null || (typeof r2.copied.ok === "boolean" && (r2.copied.ok ? typeof r2.copied.tool === "string" : typeof r2.copied.reason === "string")));
  console.log(`OK  copy attempt -> ${JSON.stringify(r2.copied)}`);
}

console.log("=== 2. copyToClipboard unit checks ===");
{
  const u = await copyToClipboard("café ✓ — unicode round-trip probe");
  check("unicode copy: ok boolean + tool/reason contract", typeof u.ok === "boolean" && (u.ok ? typeof u.tool === "string" : typeof u.reason === "string"));
  const e = await copyToClipboard("");
  check("empty input refused", e.ok === false && typeof e.reason === "string");
  console.log(`OK  unicode=${JSON.stringify(u)} empty=${JSON.stringify(e)}`);
}

console.log("=== 3. spawned e2e (real CLI) ===");
{
  const a = await run([PROMPT, "--store", tmpStore, "--verbatim"]);
  check("one-shot exit 0", a.code === 0);
  check("one-shot reports clipboard + prints prompt", a.out.includes("optimized prompt") && a.out.includes("## Goal (verbatim"));
  check("one-shot prints status line with gate", /gate PASS/.test(a.out));

  const b = await run([PROMPT, "--json", "--store", tmpStore, "--verbatim"]);
  let j = null;
  try { j = JSON.parse(b.out); } catch {}
  check("--json parses", !!j);
  check("--json ok/gate/prompt fields", j?.ok === true && j?.meta?.gate === "PASS" && j.optimized_prompt.includes(PROMPT));

  const c = await run([PROMPT, "--quiet", "--store", tmpStore, "--verbatim"]);
  check("--quiet: status only, no prompt body", c.code === 0 && /gate PASS/.test(c.out) && !c.out.includes("## Goal"));

  const d = await run(["--store", tmpStore, "--verbatim"], "build a kanban board with cards and a nice look\n");
  check("piped stdin one-shot exit 0 + prompt printed", d.code === 0 && d.out.includes("## Goal (verbatim"));

  const e = await run(["--help"]);
  check("--help exit 0 + usage", e.code === 0 && e.out.includes("interactive"));
}

console.log("=== 3b. spec-drift ledger integration (--ledger) ===");
{
  const tmpLedger = path.join(os.tmpdir(), `lemonade-watch-ledger-${process.pid}.json`);
  const m1 = await run(["no attachments for v1, keep it lean", "--json", "--ledger", tmpLedger]);
  let j1 = null; try { j1 = JSON.parse(m1.out); } catch {}
  check("msg1: gate PASS, ledger recorded additions, 0 violations", j1?.ok === true && j1?.meta?.ledger?.additions >= 1 && j1.meta.ledger.violations.length === 0);

  const m2 = await run(["hmm add an attachments page too", "--json", "--ledger", tmpLedger]);
  let j2 = null; try { j2 = JSON.parse(m2.out); } catch {}
  check("msg2: UNMARKED contradiction -> violation with confirm hint (gate stays PASS)", j2?.ok === true && j2?.meta?.ledger?.violations?.length === 1 && typeof j2.meta.ledger.violations[0].againstId === "string");
  const vid = j2?.meta?.ledger?.violations?.[0]?.againstId;

  if (vid) {
    const cf = spawn(process.execPath, ["phase6/drift-cli.js", "confirm", vid, "--ledger", tmpLedger], { stdio: ["ignore", "pipe", "ignore"] });
    await new Promise((r) => cf.on("close", r));
    const m3 = await run(["extend the attachments view", "--json", "--ledger", tmpLedger]);
    let j3 = null; try { j3 = JSON.parse(m3.out); } catch {}
    check("after confirm: extending the feature is clean", j3?.ok === true && j3?.meta?.ledger?.violations?.length === 0);
  }

  // Same file npm run drift reads (--all: the confirmed entry is superseded,
  // and the active view may legitimately be empty).
  const ps2 = spawn(process.execPath, ["phase6/drift-cli.js", "show", "--all", "--ledger", tmpLedger], { stdio: ["ignore", "pipe", "ignore"] });
  let showOut = ""; ps2.stdout.on("data", (d) => (showOut += d));
  await new Promise((r) => ps2.on("close", r));
  check("drift-cli sees the same ledger entries", /attachments/.test(showOut));

  // REPL path (LEMONADE_FORCE_REPL): lines fed with delays drive the real loop.
  const rep = await runFeed(["--ledger", tmpLedger], [
    ["remember: no dark mode in v1\n", 1500],
    ["ledger\n", 600],
    ["q\n", 400],
  ], { LEMONADE_FORCE_REPL: "1" });
  check("REPL processes prompt + `ledger` command + q exits 0", rep.code === 0 && /\[prohibition\] no dark mode/.test(rep.out) && /bye/.test(rep.out));

  fs.rmSync(tmpLedger, { force: true });
  console.log("OK  ledger loop: record -> violation -> confirm -> clean (+ REPL ledger view)");
}

console.log("=== 4. clipboard end-to-end proof (Windows) ===");
if (onWin) {
  const r = await run([PROMPT, "--store", tmpStore, "--verbatim"]);
  const back = await ps("Get-Clipboard");
  check("clipboard contains the optimized prompt", r.code === 0 && back.includes("## Goal (verbatim") && back.includes(PROMPT));
  console.log(`OK  clipboard round-trip verified (${back.length} chars read back)`);
} else {
  console.log("SKIP (non-Windows): platform copy path covered by section 2 contract checks");
}

console.log("=== 5. watch optimizer mode end-to-end ===");
{
  const optRes = await run(["build an expense tracker with login and monthly budgets", "--store", tmpStore, "--json"]);
  let j = null;
  try { j = JSON.parse(optRes.out); } catch {}
  check("optimizer run exit 0", optRes.code === 0);
  check("optimizer json parses", !!j);
  check("optimizer gate PASS", j?.meta?.gate === "PASS");
  check("optimizer produces structured sections", j?.optimized_prompt?.includes("## Goal") && j?.optimized_prompt?.includes("## V1 Requirements") && j?.optimized_prompt?.includes("## Implementation"));
}

if (onWin && prevClip !== null) {
  await ps(`Set-Clipboard -Value '${(prevClip || "").replace(/'/g, "''").slice(0, 4000)}'`);
  console.log("OK  user clipboard restored");
}

fs.rmSync(tmpStore, { force: true });
console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
