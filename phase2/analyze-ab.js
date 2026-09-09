#!/usr/bin/env node
// Drift judge + aggregator for the Phase 2 A/B experiment (phase2/results/ab-sessions.jsonl).
//
// The judge is a TRANSPARENT keyword heuristic, not ground truth: every hit is
// reported with its snippet so a human can audit each verdict. It scans only
// agent BUILD/DONE text for features that contradict the kanban pair's explicit
// spec (out-of-scope features, auth, multi-board/user framing, extra metrics).
// "Labeled" = the same session's agent text contains an explicit ASSUMPTION
// mention anywhere (weak signal — labeling presence, not correctness).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MARKERS, judgeTranscript } from "./drift-judge.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const lines = fs.readFileSync(path.join(__dirname, "results", "ab-sessions.jsonl"), "utf8").split("\n").filter(Boolean);

// Keep the LAST record per key (the runner may append duplicates across restarts).
const byKey = new Map();
for (const l of lines) {
  const r = JSON.parse(l);
  byKey.set(`${r.arm}:${r.runIndex ?? 0}`, r);
}
const sessions = [...byKey.values()];

// MARKERS / NEGATION / judge logic live in drift-judge.js (shared with Phase 3).

const rows = [];
for (const arm of ["raw", "optimized", "explicit"]) {
  const rs = sessions.filter((s) => s.arm === arm).sort((a, b) => a.runIndex - b.runIndex);
  const n = rs.length || 1;
  const sum = (k) => rs.reduce((a, x) => a + (x[k] ?? 0), 0);
  const judged = rs.map((r) => ({ runIndex: r.runIndex, ...judgeTranscript(r) }));
  rows.push({
    arm,
    sessions: rs.length,
    meanTurns: +(sum("turns") / n).toFixed(2),
    meanTokens: Math.round(sum("totalTokens") / n),
    meanClarifies: +(rs.reduce((a, x) => a + x.events.filter((e) => e.type === "clarify").length, 0) / n).toFixed(2),
    completion: +(rs.filter((x) => x.completed).length / n).toFixed(2),
    driftSessions: judged.filter((j) => j.hits.length > 0).length,
    labeledDriftSessions: judged.filter((j) => j.hits.length > 0 && j.labeled).length,
    judged,
  });
}

console.log("=== A/B DRIFT JUDGE (keyword heuristic, auditable snippets below) ===");
console.log("arm         sessions  turns  tokens  clarifies  done  driftSessions(labeled)");
for (const r of rows) {
  console.log(
    `${r.arm.padEnd(10)}  ${String(r.sessions).padEnd(8)} ${String(r.meanTurns).padEnd(6)} ${String(r.meanTokens).padEnd(6)} ${String(r.meanClarifies).padEnd(9)} ${String(Math.round(r.completion * 100) + "%").padEnd(5)} ${r.driftSessions}(${r.labeledDriftSessions})`
  );
}
console.log("\n=== PER-SESSION VERDICTS ===");
for (const r of rows) {
  for (const j of r.judged) {
    console.log(`[${r.arm}#${j.runIndex}] ${j.hits.length === 0 ? "CLEAN" : `DRIFT x${j.hits.length}${j.labeled ? " (labeled)" : " (silent)"}`}`);
    for (const h of j.hits) console.log(`    - ${h.marker} (T${h.turn}): "${h.snippet}"`);
  }
}

fs.writeFileSync(path.join(__dirname, "results", "ab-drift.json"), JSON.stringify({ markers: MARKERS.map(({ id, why }) => ({ id, why })), rows }, null, 2));
console.log("\nWrote phase2/results/ab-drift.json");
