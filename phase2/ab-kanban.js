#!/usr/bin/env node
// Phase 2 A/B experiment — does the optimized prompt change downstream behavior?
//
//   node phase2/ab-kanban.js --runs 3 [--pair kanban]
//
// Arms (same seed per run index, same scripted-user oracle, temp 0.2):
//   raw        — the pair's ambiguous prompt, verbatim
//   optimized  — Phase 2 rewrite of that prompt (verbatim Goal + labeled assumptions/questions)
//   explicit   — the pair's hand-written explicit spec (reference "ceiling")
// The scripted user answers clarifications from the EXPLICIT spec in every arm,
// so responder quality is constant and differences attribute to the prompt.
// Checkpointed to phase2/results/ab-sessions.jsonl — safe to re-run after timeout.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runSession } from "../phase0/backends/ollama.js";
import { rewrite } from "./rewriter.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const arg = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };

const pairId = arg("--pair", "kanban");
const RUNS = Number(arg("--runs", 3));
const ARMS = ["raw", "optimized", "explicit"];

const jsonlPath = path.join(__dirname, "results", "ab-sessions.jsonl");
fs.mkdirSync(path.join(__dirname, "results"), { recursive: true });
// --fresh wipes the checkpoint BEFORE the optimized prompt is built, so a
// re-run after changing the rewriter/oracle never mixes old-protocol records.
if (args.includes("--fresh")) fs.rmSync(jsonlPath, { force: true });

const dataset = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "phase0", "prompts.dataset.json"), "utf8"));
const pair = dataset.pairs.find((p) => p.id === pairId);
if (!pair) { console.error(`No pair '${pairId}' in phase0/prompts.dataset.json`); process.exit(1); }

const rawText = pair.ambiguous.text;
const explicitText = pair.explicit.text;

// Build the optimized prompt once; it must pass Lemonade's own invariants
// (verbatim Goal, labeled-only additions) before it's allowed into the experiment.
const rw = await rewrite(rawText);
if (!rw.ok) { console.error(`Rewriter failed: ${rw.error}`); process.exit(1); }
if (rw.changes.removed.length > 0 || rw.changes.modified.length > 0) {
  console.error("REFUSED: rewriter reported removed/modified content — intent-preservation violated.");
  process.exit(1);
}
const optimizedText = rw.optimized_prompt;

console.log(`Pair=${pairId} arms=${ARMS.join(",")} runs/arm=${RUNS} -> ${ARMS.length * RUNS} sessions`);
console.log(`Optimized prompt: ${optimizedText.length} chars (raw ${rawText.length} chars), assumptions=${rw.assumptions_made.length} questions=${rw.clarifying_questions.length} warnings=${rw.warnings.length}\n`);

const done = new Map();
if (fs.existsSync(jsonlPath)) {
  for (const line of fs.readFileSync(jsonlPath, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try { const rec = JSON.parse(line); done.set(`${rec.pairId}:${rec.arm}:${rec.runIndex}`, rec); }
    catch { /* partial last line */ }
  }
}

const promptsByArm = { raw: rawText, optimized: optimizedText, explicit: explicitText };
const sessions = [];
for (let r = 0; r < RUNS; r++) {
  for (const arm of ARMS) {
    const key = `${pairId}:${arm}:${r}`;
    let rec = done.get(key);
    if (!rec) {
      console.log(`running ${key} ...`);
      rec = await runSession(
        { text: promptsByArm[arm], plantedPatterns: arm === "raw" ? pair.ambiguous.planted_patterns ?? [] : [] },
        { pairId, variant: arm, runIndex: r, referenceText: explicitText }
      );
      rec.arm = arm;
      fs.appendFileSync(jsonlPath, JSON.stringify(rec) + "\n");
    }
    sessions.push(rec);
    const clar = rec.events.filter((e) => e.type === "clarify").length;
    console.log(`  [${key}] turns=${rec.turns} tokens=${rec.totalTokens} clarifies=${clar} completed=${rec.completed}`);
  }
}

// ---- Aggregation ----
const agg = (rs) => {
  const n = rs.length || 1;
  const sum = (k) => rs.reduce((a, x) => a + (x[k] ?? 0), 0);
  return {
    sessions: rs.length,
    meanTurns: +(sum("turns") / n).toFixed(2),
    meanInputTokens: Math.round(sum("inputTokens") / n),
    meanOutputTokens: Math.round(sum("outputTokens") / n),
    meanTotalTokens: Math.round(sum("totalTokens") / n),
    meanClarifies: +(rs.reduce((a, x) => a + x.events.filter((e) => e.type === "clarify").length, 0) / n).toFixed(2),
    completionRate: +(rs.filter((x) => x.completed).length / n).toFixed(3),
  };
};

const byArm = Object.fromEntries(ARMS.map((arm) => [arm, agg(sessions.filter((s) => s.arm === arm))]));
const rawA = byArm.raw, optA = byArm.optimized, expA = byArm.explicit;

const summary = {
  meta: {
    generatedAt: new Date().toISOString(),
    pair: pairId,
    runsPerArm: RUNS,
    backend: "ollama",
    oracle: "scripted user answers every arm from the pair's explicit spec (constant across arms)",
    optimizedPromptChars: optimizedText.length,
    assumptions: rw.assumptions_made.length,
    openQuestions: rw.clarifying_questions.length,
    rewriterWarnings: rw.warnings,
  },
  aggregate: {
    raw: rawA,
    optimized: optA,
    explicit: expA,
    optimizedVsRaw: {
      turnRatio: +(optA.meanTurns / (rawA.meanTurns || 1)).toFixed(2),
      tokenRatio: +(optA.meanTotalTokens / (rawA.meanTotalTokens || 1)).toFixed(2),
    },
    optimizedVsExplicit: {
      turnRatio: +(optA.meanTurns / (expA.meanTurns || 1)).toFixed(2),
      tokenRatio: +(optA.meanTotalTokens / (expA.meanTotalTokens || 1)).toFixed(2),
    },
  },
};
fs.writeFileSync(path.join(__dirname, "results", "ab-summary.json"), JSON.stringify(summary, null, 2));

console.log("\n=== AGGREGATE (mean per session) ===");
console.log(`              raw    optimized   explicit`);
console.log(`turns         ${String(rawA.meanTurns).padEnd(6)}${String(optA.meanTurns).padEnd(12)}${expA.meanTurns}`);
console.log(`tokens        ${String(rawA.meanTotalTokens).padEnd(6)}${String(optA.meanTotalTokens).padEnd(12)}${expA.meanTotalTokens}`);
console.log(`  input       ${String(rawA.meanInputTokens).padEnd(6)}${String(optA.meanInputTokens).padEnd(12)}${expA.meanInputTokens}`);
console.log(`  output      ${String(rawA.meanOutputTokens).padEnd(6)}${String(optA.meanOutputTokens).padEnd(12)}${expA.meanOutputTokens}`);
console.log(`clarifies     ${String(rawA.meanClarifies).padEnd(6)}${String(optA.meanClarifies).padEnd(12)}${expA.meanClarifies}`);
console.log(`completion    ${(rawA.completionRate * 100 + "%").padEnd(6)}${(optA.completionRate * 100 + "%").padEnd(12)}${expA.completionRate * 100 + "%"}`);
console.log(`\noptimized/raw: turns ${summary.aggregate.optimizedVsRaw.turnRatio}x, tokens ${summary.aggregate.optimizedVsRaw.tokenRatio}x`);
console.log(`optimized/explicit: turns ${summary.aggregate.optimizedVsExplicit.turnRatio}x, tokens ${summary.aggregate.optimizedVsExplicit.tokenRatio}x`);
console.log(`\nWrote phase2/results/ab-summary.json (transcripts in ab-sessions.jsonl)`);
