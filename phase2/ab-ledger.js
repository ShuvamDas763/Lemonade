#!/usr/bin/env node
// Phase 6 ↔ Phase 4 ↔ Phase 2 integration runner: feed the REAL multi-message
// A/B sessions (phase2/results/ab-sessions.jsonl) through the spec-drift
// ledger with role-based trust, and route drift into per-arm correction-memory
// stores so we can see candidate prohibitions accumulate per arm.
//
//   node phase2/ab-ledger.js                  # replay the 9 checkpointed sessions
//   node phase2/ab-ledger.js --shared-memory  # one shared store across runs per arm
//
// Trust model: the initial prompt + user ANSWER turns are trusted (they add
// requirements); agent CLARIFY/BUILD/DONE turns are check-only. The seeded
// initial prompt makes later verbatim echoes of it recognizable as echoes,
// not new requirements. The optimized arm's prompt is reconstructed with the
// same deterministic rewrite() used by ab-kanban.js (same default store).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CorrectionStore } from "../phase4/corrections.js";
import { SpecLedger } from "../phase6/ledger.js";
import { wireSession } from "../phase6/ab-wiring.js";
import { rewrite } from "./rewriter.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const jsonlPath = path.join(__dirname, "results", "ab-sessions.jsonl");
const outPath = path.join(__dirname, "results", "ab-ledger-summary.json");
const DATA_DIR = path.join(__dirname, "..", "data");
const SHARED_MEMORY = args.includes("--shared-memory");

if (!fs.existsSync(jsonlPath)) {
  console.error(`No A/B sessions found at ${jsonlPath} — run node phase2/ab-kanban.js --fresh --runs 3 first.`);
  process.exit(1);
}

const dataset = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "phase0", "prompts.dataset.json"), "utf8"));
const pair = dataset.pairs.find((p) => p.id === "kanban");
const optimizedRw = await rewrite(pair.ambiguous.text);
if (!optimizedRw.ok) { console.error(`Rewriter failed: ${optimizedRw.error}`); process.exit(1); }
const promptByArm = { raw: pair.ambiguous.text, optimized: optimizedRw.optimized_prompt, explicit: pair.explicit.text };

// Fresh ledger + memory stores for a clean replay (data/ is runtime state).
fs.mkdirSync(DATA_DIR, { recursive: true });
for (const f of fs.readdirSync(DATA_DIR).filter((f) => f.startsWith("ab-ledger-") || f.startsWith("ab-memory-"))) {
  fs.rmSync(path.join(DATA_DIR, f), { force: true });
}

const records = fs.readFileSync(jsonlPath, "utf8").split("\n").filter(Boolean)
  .map((l) => JSON.parse(l))
  .sort((a, b) => a.arm.localeCompare(b.arm) || a.runIndex - b.runIndex);

const sessionOutcomes = [];
const memoryStores = new Map(); // arm -> store (shared mode) or "arm:run" -> store
const storeFor = (arm, runIndex) => {
  const key = SHARED_MEMORY ? arm : `${arm}:${runIndex}`;
  if (!memoryStores.has(key)) memoryStores.set(key, new CorrectionStore(path.join(DATA_DIR, `ab-memory-${key.replace(/[:]/g, "-")}.json`)));
  return memoryStores.get(key);
};

for (const rec of records) {
  const ledger = new SpecLedger(path.join(DATA_DIR, `ab-ledger-${rec.arm}-${rec.runIndex}.json`));
  const outcome = wireSession({
    record: rec,
    ledger,
    store: storeFor(rec.arm, rec.runIndex),
    sessionId: `${rec.arm}:${rec.runIndex}`,
    initialPrompt: promptByArm[rec.arm] ?? null,
  });
  sessionOutcomes.push({ arm: rec.arm, runIndex: rec.runIndex, ...outcome });
}

// ---- Per-arm summary ----
const arms = ["raw", "optimized", "explicit"];
const summary = arms.map((arm) => {
  const s = sessionOutcomes.filter((o) => o.arm === arm);
  const judgeHits = {};
  let agentFlaggedTurns = 0;
  for (const o of s) {
    agentFlaggedTurns += o.totals.agentFlaggedTurns;
    for (const m of o.perMessage) for (const h of m.judgeHits ?? []) judgeHits[h.marker] = (judgeHits[h.marker] ?? 0) + 1;
  }
  const storeKeys = [...memoryStores.keys()].filter((k) => (SHARED_MEMORY ? k === arm : k.startsWith(`${arm}:`)));
  const prefs = {};
  for (const k of storeKeys) for (const r of memoryStores.get(k).all()) {
    prefs[r.key] = prefs[r.key] ?? { value: r.value, count: 0, status: r.status, sources: 0 };
    prefs[r.key].count = Math.max(prefs[r.key].count, r.count);
    prefs[r.key].sources += r.sources.length;
    prefs[r.key].status = r.status;
  }
  return {
    arm,
    sessions: s.length,
    ledgerViolations: s.reduce((a, o) => a + o.totals.violations, 0),
    agentFlaggedTurns,
    judgeHitsByMarker: judgeHits,
    memoryEventsRouted: s.reduce((a, o) => a + o.totals.memoryEventsRouted, 0),
    memoryPreferences: prefs,
  };
});

const result = {
  generatedAt: new Date().toISOString(),
  sharedMemory: SHARED_MEMORY,
  arms: summary,
  sessions: sessionOutcomes.map(({ arm, runIndex, totals, perMessage, routedCount }) => ({ arm, runIndex, totals, perMessage, routedCount })),
};
fs.writeFileSync(outPath, JSON.stringify(result, null, 2));

for (const a of summary) {
  console.log(`\n=== ${a.arm.toUpperCase()} (${a.sessions} sessions) ===`);
  console.log(`ledger violations: ${a.ledgerViolations} | agent-flagged turns: ${a.agentFlaggedTurns} | memory events routed: ${a.memoryEventsRouted}`);
  console.log(`judge hits by marker: ${JSON.stringify(a.judgeHitsByMarker)}`);
  const prefs = Object.entries(a.memoryPreferences);
  console.log(prefs.length ? `memory preferences: ${prefs.map(([k, p]) => `${k}(${p.status}, ×${p.count})`).join(", ")}` : "memory preferences: (none)");
}
console.log(`\nWrote ${outPath}`);
