#!/usr/bin/env node
// Memory CLI:
//   node phase4/memory-cli.js add "<user reply>"     record correction events
//   node phase4/memory-cli.js list [--standing]      show store contents
//   node phase4/memory-cli.js forget <key>           explicit removal (never automatic)
//   --store <path>                                   override store file (default: data/corrections.json)
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractCorrections, CorrectionStore } from "./corrections.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const storeIdx = args.indexOf("--store");
const storePath = storeIdx >= 0 ? args[storeIdx + 1] : path.join(__dirname, "..", "data", "corrections.json");
const [cmd, ...rest] = args.filter((a, i) => i !== storeIdx && i !== storeIdx + 1);
const store = new CorrectionStore(storePath);

if (cmd === "add") {
  const reply = rest.join(" ").trim();
  if (!reply) { console.log('Usage: memory-cli.js add "<user reply>"'); process.exit(1); }
  const known = store.all().map((r) => r.value);
  const events = extractCorrections(reply, { knownValues: known });
  if (events.length === 0) { console.log("no correction events detected"); process.exit(0); }
  const updated = store.record(events, { source: "cli" });
  for (const rec of updated) {
    console.log(`recorded: [${rec.status}] ${rec.value}  (count=${rec.count}, key=${rec.key})`);
  }
} else if (cmd === "list") {
  const recs = args.includes("--standing") ? store.standing() : store.all();
  if (recs.length === 0) { console.log("(no preferences recorded)"); process.exit(0); }
  for (const r of recs) {
    console.log(`[${r.status}] (${r.dimension}) "${r.value}"  count=${r.count} lastSeen=${r.lastSeen} key=${r.key}`);
    for (const ex of r.excerpts.slice(0, 2)) console.log(`    e.g. "${ex}"`);
  }
} else if (cmd === "forget") {
  const key = rest.join(" ").trim();
  console.log(store.forget(key) ? `forgot: ${key}` : `no such key: ${key} (see list)`);
} else {
  console.log('Usage: memory-cli.js add "<reply>" | list [--standing] | forget <key> [--store <path>]');
}
