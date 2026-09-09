#!/usr/bin/env node
// Phase 6 — Spec-Drift CLI (requirements ledger over a conversation).
//
//   node phase6/drift-cli.js say "<message>"          process one message
//   node phase6/drift-cli.js say --file <path>        process a file as one message
//   node phase6/drift-cli.js show [--all]             active entries (or incl. superseded)
//   node phase6/drift-cli.js confirm <entryId>        resolve a flagged contradiction
//   node phase6/drift-cli.js stats                    ledger summary
//   --ledger <path>   ledger file (default data/spec-ledger.json)
//   --json            machine-readable output for `say`
//   --strict          exit 1 when the message raised unconfirmed violations
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SpecLedger } from "./ledger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const argVal = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const has = (name) => args.includes(name);
const ledgerPath = argVal("--ledger", path.join(__dirname, "..", "data", "spec-ledger.json"));
const filtered = args.filter((a, i) => a !== "--ledger" && a !== argVal("--ledger", null));
const [cmd, ...rest] = filtered;
const ledger = new SpecLedger(ledgerPath);

const render = (r) => {
  const parts = [`message #${r.messageIndex}`];
  if (r.additions.length) parts.push(`+${r.additions.length} requirement(s)`);
  if (r.violations.length) parts.push(`${r.violations.length} VIOLATION(S)`);
  if (r.reversals.length) parts.push(`${r.reversals.length} intentional reversal(s)`);
  console.log(parts.join("  "));
  for (const a of r.additions) console.log(`  + [${a.kind}] ${a.phrase}${a.number != null ? ` (n=${a.number})` : ""}`);
  for (const v of r.violations) {
    console.log(`  ⚠ ${v.type}: "${v.quote}"`);
    console.log(`    conflicts with ${v.against.id} from message ${v.against.firstSeenMessage}: "${v.against.phrase}"`);
    console.log(`    ${v.detail}`);
    console.log(`    -> if intentional: drift-cli.js confirm ${v.against.id}`);
  }
  for (const x of r.reversals) console.log(`  ↻ intentional: "${x.oldPhrase}" superseded by "${x.newPhrase}" (history kept)`);
  return r.violations.length;
};

if (cmd === "say") {
  const fi = rest.indexOf("--file");
  const text = fi >= 0 ? fs.readFileSync(rest[fi + 1], "utf8") : rest.join(" ").trim();
  if (!text) { console.log('Usage: drift-cli.js say "<message>" | say --file <path>'); process.exit(2); }
  const r = ledger.processMessage(text);
  if (has("--json")) {
    console.log(JSON.stringify(r, null, 2));
  } else {
    const n = render(r);
    if (has("--strict") && n > 0) process.exit(1);
  }
} else if (cmd === "show") {
  const rows = has("--all") ? ledger.all() : ledger.activeEntries();
  if (!rows.length) { console.log("(ledger empty)"); process.exit(0); }
  for (const e of rows) {
    console.log(`${e.supersededBy ? "superseded" : "active   "}  [${e.kind}] ${e.phrase}  (msg ${e.firstSeen}${e.count > 1 ? `, ×${e.count}` : ""})  id=${e.id}`);
  }
} else if (cmd === "confirm") {
  const id = rest.join(" ").trim();
  console.log(ledger.confirm(id) ? `confirmed: ${id} is superseded (history kept)` : `no active entry with id: ${id}`);
} else if (cmd === "stats") {
  const active = ledger.activeEntries();
  const byKind = {};
  for (const e of active) byKind[e.kind] = (byKind[e.kind] ?? 0) + 1;
  console.log(`messages: ${ledger.data.messageCount}  active requirements: ${active.length}  total entries: ${ledger.all().length}  flagged violations: ${ledger.violations()}`);
  console.log(`active by kind: ${JSON.stringify(byKind)}`);
} else {
  console.log("Usage: drift-cli.js say \"<msg>\" | show [--all] | confirm <id> | stats  [--ledger <path>] [--json] [--strict]");
}
