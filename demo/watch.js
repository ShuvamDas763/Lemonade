#!/usr/bin/env node
// Lemonade watch mode — the daily-driver command:
//
//   npm run watch                  # REPL: type a prompt, Enter -> optimized prompt in your clipboard
//   npm run watch -- "prompt"      # one-shot: process a single prompt and exit
//   cat brief.md | npm run watch   # pipe a (multiline) prompt through once
//
// The optimized prompt lands on your clipboard ready to paste into any coding
// agent (Cursor, Claude Code, a raw LLM session). No clipboard (SSH/CI)? The
// block is printed for manual copy — never a hard failure.
//
// Principle kept intact: the Phase 3 intent-preservation gate runs on every
// rewrite; a rewrite that FAILS the gate is never copied, it is reported.
// Learned preferences come from the same default store as `npm run memory`.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import readline, { emitKeypressEvents } from "node:readline";
import { detect } from "../phase1/detector.js";
import { rewrite } from "../phase2/rewriter.js";
import { verify } from "../phase3/verifier.js";
import { extractCorrections, CorrectionStore } from "../phase4/corrections.js";
import { SpecLedger } from "../phase6/ledger.js";
import { copyToClipboard, readFromClipboard } from "./clipboard.js";
import { CODES, makeColor, startSpinner, History, formatHistory } from "./tui.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_STORE = path.join(__dirname, "..", "data", "corrections.json");
const DEFAULT_LEDGER = path.join(__dirname, "..", "data", "spec-ledger.json");
const RULE = "─".repeat(70);

function parseArgs(argv) {
  const opts = { store: DEFAULT_STORE, copy: true, json: false, quiet: false, help: false, prompt: "", ledger: null, mode: "optimize", file: null, clip: false };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--store") opts.store = path.resolve(argv[++i] ?? DEFAULT_STORE);
    else if (a === "--ledger") opts.ledger = path.resolve(argv[++i] ?? DEFAULT_LEDGER);
    else if (a === "--no-copy") opts.copy = false;
    else if (a === "--json") opts.json = true;
    else if (a === "--quiet") opts.quiet = true;
    else if (a === "--help" || a === "-h") opts.help = true;
    else if (a === "--mode") opts.mode = argv[++i] ?? "optimize";
    else if (a === "--verbatim") opts.mode = "verbatim";
    else if (a === "--file" || a === "-f") opts.file = path.resolve(argv[++i] ?? "");
    else if (a === "--clip" || a === "-c") opts.clip = true;
    else rest.push(a);
  }
  if (opts.file && fs.existsSync(opts.file)) {
    opts.prompt = fs.readFileSync(opts.file, "utf8").trim();
  } else {
    opts.prompt = rest.join(" ").trim();
  }
  return opts;
}


/** Rewrite + gate + copy one prompt. Returns a result object (no printing). */
export async function processPrompt(text, { store = DEFAULT_STORE, copy = true, ledger: ledgerPath = null, mode = "optimize" } = {}) {
  const det = detect(text);
  const rw = await rewrite(text, { memoryPath: store, mode });
  const gate = verify(text, rw);
  let copied = null;
  if (gate.ok && copy) copied = await copyToClipboard(rw.optimized_prompt);
  // Optional spec-drift ledger: the typed prompt is a message in a session
  // conversation, so requirements stated here are checked against (and join)
  // everything said before. Ledger problems never fail the gate — they are
  // flags for the human (confirm/supersede), per the ledger's own philosophy.
  let ledger = null;
  if (ledgerPath) {
    try {
      const res = new SpecLedger(ledgerPath).processMessage(text);
      ledger = {
        messageIndex: res.messageIndex,
        additions: res.additions.length,
        reversals: res.reversals.length,
        violations: res.violations.map((v) => ({
          type: v.type, quote: v.quote,
          againstId: v.against.id, againstPhrase: v.against.phrase, againstMsg: v.against.firstSeenMessage,
        })),
      };
    } catch (e) {
      ledger = { error: e.message };
    }
  }
  return {
    ok: gate.ok,
    optimized_prompt: rw.optimized_prompt,
    meta: {
      ambiguity_score: det.ambiguity_score,
      flags: det.flags.length,
      assumptions: rw.assumptions_made.length,
      questions: rw.clarifying_questions.length,
      memory_applied: rw.memory.applied,
      memory_overrides: (rw.memory.overrides ?? []).map((o) => o.category),
      gate: gate.ok ? "PASS" : "FAIL",
      ledger,
      retention: rw.quality?.retentionPercent ?? null,
      quality_score: rw.quality?.compositeScore ?? null,
      category_retention: rw.quality?.categoryRetention ?? null,
    },
    copied, // { ok, tool } | { ok: false, reason } | null (--no-copy or failed gate)
  };
}

function statusLine(r) {
  const m = r.meta;
  const mem = m.memory_applied.length
    ? ` · memory: ${m.memory_applied.join(",")}${m.memory_overrides.length ? ` (overrides: ${m.memory_overrides.join(",")})` : ""}`
    : "";
  if (!r.ok) return `✗ GATE FAILED — nothing copied. Fix the prompt or inspect the report above.`;
  if (m.quality_score != null) {
    let catDetail = "";
    if (m.category_retention) {
      const cr = m.category_retention;
      catDetail = ` (Req: ${cr.requirement}% · Con: ${cr.constraint}% · UX: ${cr.ux}% · Scope: ${cr.futureScope}%)`;
    }
    const base = `${m.retention}% retention${catDetail} · score ${m.quality_score} · gate PASS${mem}`;
    if (r.copied === null) return `✔ ${base} · --no-copy`;
    if (r.copied.ok) return `✔ ${base} → clipboard (${r.copied.tool})`;
    return `⚠ ${base} · clipboard unavailable (${r.copied.reason}) — copy the block below manually`;
  }
  if (r.copied === null) return `✔ ${m.flags} flags · score ${m.ambiguity_score} · ${m.assumptions} assumptions · ${m.questions} question(s) · gate PASS${mem} · --no-copy`;
  if (r.copied.ok) return `✔ ${m.flags} flags · score ${m.ambiguity_score} · ${m.assumptions} assumptions · ${m.questions} question(s) · gate PASS${mem} → clipboard (${r.copied.tool})`;
  return `⚠ ${m.flags} flags · score ${m.ambiguity_score} · gate PASS${mem} · clipboard unavailable (${r.copied.reason}) — copy the block below manually`;
}

function renderStatus(r, color) {
  const line = statusLine(r);
  if (!r.ok) return line.replace(/^✗/, color(CODES.red, "✗")).replace("GATE FAILED", color(CODES.red, "GATE FAILED"));
  if (r.copied && !r.copied.ok) return line.replace(/^⚠/, color(CODES.yellow, "⚠"));
  return line.replace(/^✔/, color(CODES.green, "✔")).replace("gate PASS", color(CODES.green, "gate PASS"));
}

function ledgerLine(ledger, color) {
  if (!ledger) return null;
  if (ledger.error) return `ledger: unavailable (${ledger.error})`;
  const bits = [`ledger msg #${ledger.messageIndex}`];
  if (ledger.additions) bits.push(`+${ledger.additions} requirement(s)`);
  if (ledger.reversals) bits.push(`↻ ${ledger.reversals} intentional reversal(s)`);
  if (!ledger.violations.length) return bits.join(" · ");
  const lines = [bits.join(" · ")];
  for (const v of ledger.violations) {
    lines.push(`${color(CODES.yellow, "⚠ ledger violation")}: "${v.quote}" conflicts with msg ${v.againstMsg} "${v.againstPhrase}"`);
    lines.push(`  ${color(CODES.dim, `intentional? confirm it:  npm run drift -- confirm ${v.againstId}`)}`);
  }
  return lines.join("\n");
}

function printResult(r, { quiet = false, color = (_c, s) => String(s) } = {}) {
  console.log(renderStatus(r, color));
  const led = ledgerLine(r.meta.ledger, color);
  if (led) console.log(led);
  if (!quiet && r.ok) {
    console.log(`${RULE} optimized prompt ${RULE.slice(0, 0)}\n${r.optimized_prompt}\n${RULE}`);
  }
}

async function oneShot(prompt, opts) {
  const r = await processPrompt(prompt, opts);
  if (opts.json) {
    console.log(JSON.stringify({ ok: r.ok, copied: r.copied?.ok === true, tool: r.copied?.tool ?? null, meta: r.meta, optimized_prompt: r.optimized_prompt }, null, 2));
  } else {
    printResult(r, { quiet: opts.quiet, color: makeColor(process.stdout) });
  }
  process.exit(r.ok ? 0 : 1);
}

function printHelp() {
  console.log(`Lemonade watch — ambiguity-checked prompts, straight to your clipboard.

  npm run watch                     interactive: type a prompt, get it optimized + copied
  npm run watch -- "prompt"         one-shot
  cat brief.md | npm run watch      pipe a multiline prompt
  npm run watch -- "p" --quiet      status line only (paste straight from clipboard)
  <empty file> | npm run watch     same as piping (runs non-TTY path)

Options:
  --store <file>   correction-memory store (default data/corrections.json, shared with npm run memory)
  --ledger <file>  also run every prompt through the spec-drift ledger (default data/spec-ledger.json,
                   shared with npm run drift); violations print inline with their confirm command
  --no-copy        don't touch the clipboard; just print (useful when no clipboard tool exists)
  --show-on-fail   when a rewrite's gate fails, still print the optimized block so you
                   can read it or copy it manually (the block is always printed in the
                   non-quiet terminal loop)
  --quiet          status line only
  --json           machine-readable output (one-shot modes)

REPL commands: Enter on empty line -> history (press 1-9 or /1-/9 to recopy) · history · ledger show · .clear forget memory · .exit (or q) leave · .help`);
}

async function repl(opts) {
  const color = makeColor(process.stdout);
  const interactive = !!process.stdin.isTTY;
  const history = new History(25);
  let waitingPick = false; // true right after history is shown: 1-9 recopy
  let picking = false;

  const finish = () => { console.log("bye 🍋"); process.exit(0); };

  const showHistory = () => {
    console.log();
    console.log(formatHistory(history, color));
    waitingPick = history.size > 0;
  };

  const pick = async (n) => {
    if (picking) return;
    picking = true;
    const e = history.get(n);
    if (!e) console.log(`no history entry #${n}`);
    else if (!e.ok || !e.r?.optimized_prompt) console.log(`#${n} was never copied — its gate failed`);
    else {
      const sp = startSpinner("copying…", { stream: process.stdout, enabled: interactive });
      const c = await copyToClipboard(e.r.optimized_prompt);
      sp.stop();
      if (c.ok) console.log(`${color(CODES.green, "✔")} recopied #${n} → clipboard (${c.tool})  ${color(CODES.dim, e.text)}`);
      else {
        console.log(`${color(CODES.yellow, "⚠")} clipboard unavailable (${c.reason}) — block reprinted below`);
        console.log(`${RULE}\n${e.r.optimized_prompt}\n${RULE}`);
      }
    }
    picking = false;
  };

  const handleMeta = async (text) => {
    if (/^(exit|quit|q|\.exit|\.quit)$/i.test(text)) { finish(); return true; }
    if (/^(history|hist)$/i.test(text)) { showHistory(); return true; }
    if (/^\/([1-9])$/.test(text) && history.size) {
      const n = Number(text.slice(1));
      await pick(n);
      return true;
    }
    if (/^ledger$/i.test(text) || /^ledger show$/i.test(text)) {
      if (!opts.ledger) { console.log("ledger off — restart with --ledger <file>"); return true; }
      try {
        const rows = new SpecLedger(opts.ledger).activeEntries();
        if (!rows.length) console.log("(ledger empty)");
        for (const e of rows) console.log(`  [${e.kind}] ${e.phrase}${e.number != null ? ` (n=${e.number})` : ""}  (msg ${e.firstSeen}${e.count > 1 ? `, ×${e.count}` : ""})  id=${e.id}`);
      } catch (e) { console.log(`ledger unavailable: ${e.message}`); }
      return true;
    }
    if (/^(clear|cls|\.clear)$/i.test(text)) {
      try { fs.rmSync(opts.store, { force: true }); console.log(`memory cleared (${opts.store})`); }
      catch (e) { console.log(`could not clear memory: ${e.message}`); }
      return true;
    }
    if (/^(\.help|help|\?)$/i.test(text)) {
      console.log("  type a prompt + Enter → optimized prompt copied to clipboard\n  Enter on empty line → history, then press 1-9 to recopy · .clear · .exit");
      return true;
    }
    // A lone digit with history present recopies (line-based path — always
    // available, even where raw mode isn't). With no history it's just a prompt.
    if (/^\d$/.test(text) && history.size) { await pick(Number(text)); return true; }
    return false;
  };

  const ledgerNote = opts.ledger ? `\n  ledger: ${opts.ledger}` : "";
  console.log(color(CODES.bold, "🍋 lemonade watch"));
  console.log(`type a prompt + Enter → optimized prompt copied to clipboard${ledgerNote}`);
  console.log(`Enter on an empty line → recent prompts (1-9 or /1-/9 to re-copy) · .help · .exit`);
  console.log(`history recopy also works as line input: type 1, 2, ...${history ? String(history.size) : ""} while history is shown`);
  console.log(`or prefix with /  (e.g. /1) — handy where raw-mode keypresses aren't available`);
  console.log(`score in the status line = ambiguity severity sum (0 = clean prompt, no assumptions)`);
  if (!opts.ledger && opts.store === DEFAULT_STORE) {
    console.log(color(CODES.dim, "hint: --ledger <file> turns every prompt into a spec-drift session (npm run drift reads the same file)"));
  }
  // Keypress listener MUST be attached before readline owns stdin: our handler
  // then sees the line buffer BEFORE readline inserts the digit, which is how
  // "1-9 while history is showing" recopies instead of typing a number.
  if (interactive) {
    try {
      emitKeypressEvents(process.stdin);
      process.stdin.setRawMode(true);
      process.stdin.on("keypress", (str, key) => {
        if (!waitingPick || picking || !key || key.ctrl || key.meta) return;
        if (key.name >= "1" && key.name <= "9") {
          pick(Number(key.name));
          while (rl.line) rl.write("", { name: "backspace" }); // swallow the digit readline inserted
        } else if (str && str.trim()) {
          waitingPick = false; // typing anything else cancels pick mode
        }
      });
    } catch { /* raw mode unavailable (odd terminals) — digits still work as line input */ }
  }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: `${color(CODES.bold, "🍋")} ` });
  rl.prompt();
  let pasteBuffer = [];
  let pasteTimer = null;

  const flushBuffer = async () => {
    const text = pasteBuffer.join("\n").trim();
    pasteBuffer = [];
    pasteTimer = null;
    if (!text) {
      if (waitingPick && history.size) showHistory();
      else console.log(color(CODES.dim, "(empty) type a prompt, press Enter for history, or .help"));
      return rl.prompt();
    }
    if (await handleMeta(text)) return rl.prompt();
    const sp = startSpinner("optimizing…", { stream: process.stdout, enabled: interactive });
    const r = await processPrompt(text, opts);
    sp.stop();
    history.add({ text: text.length > 36 ? `${text.slice(0, 35)}…` : text, ok: r.ok, r });
    printResult(r, { quiet: opts.quiet, color });
    if (!r.ok && !opts.quiet && !opts.json) {
      console.log(color(CODES.dim, "(nothing copied — gate failed.)"));
    }
    waitingPick = false;
    rl.prompt();
  };

  rl.on("line", (line) => {
    pasteBuffer.push(line);
    if (pasteTimer) clearTimeout(pasteTimer);
    pasteTimer = setTimeout(flushBuffer, 40);
  }).on("close", finish).on("SIGINT", finish);
}

// CLI entry runs ONLY when executed directly (node demo/watch.js / npm run watch).
// Importing this module (tests, integrations) must never touch stdin or exit.
const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) { printHelp(); process.exit(0); }

  if (opts.clip) {
    const clip = await readFromClipboard();
    if (clip.ok && clip.text) opts.prompt = clip.text.trim();
  } else if (opts.prompt) {
    try {
      const clip = await readFromClipboard();
      if (clip.ok && clip.text && clip.text.length > opts.prompt.length) {
        const clipNorm = clip.text.trim().toLowerCase().replace(/\s+/g, " ");
        const promptNorm = opts.prompt.trim().toLowerCase().replace(/\s+/g, " ");
        const sample = promptNorm.slice(0, Math.min(promptNorm.length, 30));
        if (clipNorm.includes(sample)) {
          if (!opts.quiet && !opts.json) {
            console.log("[Lemonade: detected shell multiline truncation; auto-recovered full prompt from clipboard]");
          }
          opts.prompt = clip.text.trim();
        }
      }
    } catch {}
  }

  const argText = opts.prompt;
  if (argText) await oneShot(argText, opts);

  if (process.env.LEMONADE_FORCE_REPL === "1" || process.stdin.isTTY) {
    await repl(opts);
  } else {
    const piped = fs.readFileSync(0, "utf8").trim();
    if (piped) await oneShot(piped, opts);
    else printHelp();
    process.exit(0);
  }
}

