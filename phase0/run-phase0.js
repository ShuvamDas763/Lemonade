#!/usr/bin/env node
// Phase 0 orchestrator. Usage:
//   node phase0/run-phase0.js --backend simulated --runs 5
//   node phase0/run-phase0.js --backend ollama    --runs 1
//   node phase0/run-phase0.js --backend anthropic --runs 1 --yes   (PAID)
//   node phase0/run-phase0.js --edge-cases                         (robustness checks)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as simulated from "./backends/simulated.js";
import * as ollama from "./backends/ollama.js";
import * as anthropic from "./backends/anthropic.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const arg = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const has = (name) => args.includes(name);

const backendName = arg("--backend", "simulated");
const runs = Number(arg("--runs", backendName === "simulated" ? 5 : 1));
const onlyPair = arg("--pair", null);

const BACKENDS = { simulated, ollama, anthropic };
const backend = BACKENDS[backendName];
if (!backend) {
  console.error(`Unknown backend '${backendName}'. Use: ${Object.keys(BACKENDS).join(", ")}`);
  process.exit(1);
}
if (backendName === "anthropic") {
  try { anthropic.assertConsent(has("--yes")); }
  catch (e) { console.error(`REFUSED: ${e.message}`); process.exit(1); }
}

const dataset = JSON.parse(fs.readFileSync(path.join(__dirname, "prompts.dataset.json"), "utf8"));
const taxonomy = JSON.parse(fs.readFileSync(path.join(__dirname, "patterns.taxonomy.json"), "utf8"));
const byCategory = Object.fromEntries(taxonomy.patterns.map((p) => [p.id, p]));
const resolvePatterns = (pair) =>
  (pair.ambiguous.planted_patterns ?? [])
    .map((id) => byCategory[id])
    .filter(Boolean)
    .sort((a, b) => b.severity - a.severity);

// ---- Edge-case robustness checks (Self-Verification Protocol step 3) ----
if (has("--edge-cases")) {
  if (backendName !== "simulated") { console.error("--edge-cases only supports the simulated backend."); process.exit(1); }
  const cases = [
    ["empty prompt", ""],
    ["one-word prompt", "app"],
    ["very long prompt (~3k words, no patterns)", "Build an app with these details. ".repeat(400)],
  ];
  for (const [label, text] of cases) {
    try {
      const rec = await simulated.runSession(
        { text, plantedPatterns: [] },
        { pairId: `edge:${label}`, variant: "explicit", runIndex: 0 }
      );
      console.log(`EDGE OK  ${label.padEnd(44)} turns=${String(rec.turns).padStart(2)} tokens=${rec.totalTokens} completed=${rec.completed} corrections=${rec.corrections}`);
    } catch (e) {
      console.log(`EDGE FAIL ${label}: ${e.message}`);
      process.exitCode = 1;
    }
  }
  process.exit(process.exitCode ?? 0);
}

// ---- Run every pair x variant x run (checkpointed: resumable across restarts) ----
const jsonlPath = path.join(__dirname, "results", `sessions-${backendName}.jsonl`);
if (has("--fresh")) fs.rmSync(jsonlPath, { force: true });
const done = new Map();
if (fs.existsSync(jsonlPath)) {
  for (const line of fs.readFileSync(jsonlPath, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const rec = JSON.parse(line);
      done.set(`${rec.pairId}:${rec.variant}:${rec.runIndex ?? 0}`, rec);
    } catch { /* ignore partial last line */ }
  }
}

const pairs = onlyPair ? dataset.pairs.filter((p) => p.id === onlyPair) : dataset.pairs;
if (!pairs.length) { console.error(`No pair matches --pair ${onlyPair}`); process.exit(1); }

const sessions = [];
console.log(`Backend=${backendName} runs/prompt=${runs} pairs=${pairs.length} -> ${pairs.length * 2 * runs} sessions (resuming ${done.size})`);
for (const pair of pairs) {
  const planted = resolvePatterns(pair);
  for (const variant of ["ambiguous", "explicit"]) {
    for (let r = 0; r < runs; r++) {
      const key = `${pair.id}:${variant}:${r}`;
      let rec = done.get(key);
      if (!rec) {
        rec = await backend.runSession(
          { text: pair[variant].text, plantedPatterns: variant === "ambiguous" ? planted : [] },
          { pairId: pair.id, variant, runIndex: r, referenceText: pair.explicit.text }
        );
        fs.appendFileSync(jsonlPath, JSON.stringify(rec) + "\n");
      }
      sessions.push(rec);
      console.log(`  [${pair.id}/${variant}#${r}] turns=${rec.turns} tokens=${rec.totalTokens} corrections=${rec.corrections} completed=${rec.completed}`);
    }
  }
}
console.log("done\n");

// ---- Aggregation ----
const agg = (rs) => {
  const n = rs.length || 1;
  const sum = (k) => rs.reduce((a, r) => a + (r[k] ?? 0), 0);
  return {
    sessions: rs.length,
    meanTurns: +(sum("turns") / n).toFixed(2),
    meanInputTokens: Math.round(sum("inputTokens") / n),
    meanOutputTokens: Math.round(sum("outputTokens") / n),
    meanTotalTokens: Math.round(sum("totalTokens") / n),
    meanCorrections: +(sum("corrections") / n).toFixed(2),
    completionRate: +(rs.filter((r) => r.completed).length / n).toFixed(3),
  };
};

const aggA = agg(sessions.filter((s) => s.variant === "ambiguous"));
const aggE = agg(sessions.filter((s) => s.variant === "explicit"));

const perPair = pairs.map((pair) => {
  const a = agg(sessions.filter((s) => s.pairId === pair.id && s.variant === "ambiguous"));
  const e = agg(sessions.filter((s) => s.pairId === pair.id && s.variant === "explicit"));
  return {
    pairId: pair.id,
    app: pair.app,
    plantedCount: (pair.ambiguous.planted_patterns ?? []).length,
    ambiguousTurns: a.meanTurns,
    explicitTurns: e.meanTurns,
    turnRatio: +(a.meanTurns / e.meanTurns).toFixed(2),
    ambiguousTokens: a.meanTotalTokens,
    explicitTokens: e.meanTotalTokens,
    tokenRatio: +(a.meanTotalTokens / e.meanTotalTokens).toFixed(2),
    ambiguousCorrections: a.meanCorrections,
    explicitCorrections: e.meanCorrections,
    ambiguousCompleted: a.completionRate,
  };
});

// Per-pattern attribution: how many process turns (clarify + correction) did
// each planted category actually consume, per planting (normalized).
const attribution = Object.fromEntries(
  taxonomy.patterns.map((p) => [p.id, {
    category: p.id, severity: p.severity,
    planted: 0, clarifyEvents: 0, correctionEvents: 0, processTurns: 0, silentAssumptions: 0,
  }])
);
for (const s of sessions) {
  if (s.variant !== "ambiguous") continue;
  for (const cat of s.plantedCategories ?? []) if (attribution[cat]) attribution[cat].planted++;
  for (const ev of s.events) {
    if (ev.pattern && attribution[ev.pattern]) {
      attribution[ev.pattern].processTurns++;
      if (ev.type === "clarify") attribution[ev.pattern].clarifyEvents++;
      else attribution[ev.pattern].correctionEvents++;
    }
  }
  for (const cat of s.silentAssumptions ?? []) if (attribution[cat]) attribution[cat].silentAssumptions++;
}
for (const a of Object.values(attribution)) {
  a.turnsPerPlanting = a.planted ? +(a.processTurns / a.planted).toFixed(2) : 0;
}
const patternRanking = Object.values(attribution).sort((a, b) => b.turnsPerPlanting - a.turnsPerPlanting);

const results = {
  meta: {
    generatedAt: new Date().toISOString(),
    backend: backendName,
    runsPerPrompt: runs,
    datasetPairs: dataset.pairs.length,
    sessions: sessions.length,
    simulatedParams: backendName === "simulated" ? simulated.PARAMS : null,
    notes: {
      correctionsInRealMode: "Corrections are only modeled by the simulated backend; real backends log 0 because auto-judging is not implemented (manual review required).",
    },
  },
  aggregate: {
    ambiguous: aggA,
    explicit: aggE,
    turnRatio: +(aggA.meanTurns / aggE.meanTurns).toFixed(2),
    tokenRatio: +(aggA.meanTotalTokens / aggE.meanTotalTokens).toFixed(2),
  },
  perPair,
  patternRanking,
};

fs.mkdirSync(path.join(__dirname, "results"), { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
fs.writeFileSync(path.join(__dirname, "results", `phase0-${backendName}-${stamp}.json`), JSON.stringify(results, null, 2));
fs.writeFileSync(path.join(__dirname, "results", "latest.json"), JSON.stringify(results, null, 2));

// ---- Stdout summary ----
const a = results.aggregate;
console.log("=== AGGREGATE (mean per session) ===");
console.log(`              ambiguous   explicit   ratio`);
console.log(`turns         ${String(a.ambiguous.meanTurns).padEnd(12)}${String(a.explicit.meanTurns).padEnd(11)}${a.turnRatio}x`);
console.log(`total tokens  ${String(a.ambiguous.meanTotalTokens).padEnd(12)}${String(a.explicit.meanTotalTokens).padEnd(11)}${a.tokenRatio}x`);
console.log(`corrections   ${String(a.ambiguous.meanCorrections).padEnd(12)}${String(a.explicit.meanCorrections).padEnd(11)}-`);
console.log(`completion    ${(a.ambiguous.completionRate * 100).toFixed(0)}%${" ".padEnd(10)}${(a.explicit.completionRate * 100).toFixed(0)}%`);
console.log("\n=== TOP AMBIGUITY PATTERNS BY ATTRIBUTED PROCESS TURNS / PLANTING ===");
for (const p of patternRanking.slice(0, 5)) {
  console.log(`${p.category.padEnd(26)} sev=${p.severity} turns/planting=${p.turnsPerPlanting} planted=${p.planted} corrections=${p.correctionEvents}`);
}
console.log(`\nWrote results/latest.json (+ timestamped copy). Report: node phase0/make-report.js`);
