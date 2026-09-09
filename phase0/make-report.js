#!/usr/bin/env node
// Renders phase0/results/latest.json into phase0/PHASE0_REPORT.md.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const r = JSON.parse(fs.readFileSync(path.join(__dirname, "results", "latest.json"), "utf8"));
const m = r.meta;
const simulated = m.backend === "simulated";

// Behavioral stats from raw session logs (real backends only).
let behavioral = null;
const jsonlPath = path.join(__dirname, "results", `sessions-${m.backend}.jsonl`);
if (!simulated && fs.existsSync(jsonlPath)) {
  const recs = fs.readFileSync(jsonlPath, "utf8").trim().split("\n").map(JSON.parse);
  const stat = (variant) => {
    const rs = recs.filter((x) => x.variant === variant);
    const clar = rs.reduce((a, x) => a + (x.events ?? []).filter((e) => e.type === "clarify").length, 0);
    return {
      sessions: rs.length,
      clarifyEvents: clar,
      sessionsWithClarify: rs.filter((x) => (x.events ?? []).some((e) => e.type === "clarify")).length,
      fastGuessSessions: rs.filter((x) => x.turns <= 3).length,
    };
  };
  behavioral = { ambiguous: stat("ambiguous"), explicit: stat("explicit") };
}

const fmt = (n) => n.toLocaleString("en-US");
const pct = (x) => `${(x * 100).toFixed(0)}%`;

const noCostDiff = !simulated && (r.aggregate.tokenRatio < 1 || r.aggregate.turnRatio < 1.2);
const verdict = simulated
  ? `**PREMISE: UNVALIDATED.** All numbers below come from the synthetic cost-model backend, whose design bakes in the direction of the result. This run proves the harness, dataset and report pipeline work end-to-end — it does **not** prove that ambiguity costs more with a real LLM. Do not cite these numbers as evidence.`
  : noCostDiff
    ? `**MEASURED RESULT (real sessions, qwen2.5:3b via Ollama, scripted-user protocol): ambiguity did NOT measurably increase session turns or tokens** — turns ${r.aggregate.turnRatio}×, tokens ${r.aggregate.tokenRatio}×. The measurable cost of ambiguity appeared elsewhere: clarification load and **silent scope invention** visible in transcripts (see Behavioral findings). Session-token savings are therefore NOT the value proposition for the optimizer; surfacing ambiguity the model silently papers over is.`
    : `**MEASURED RESULT.** Real model sessions under a scripted-user (wizard-of-oz) protocol: single model, scripted answers, corrections not auto-detected, no real IDE. Directional evidence, not proof.`;

const behavioralSection = behavioral
  ? `## Behavioral findings (from ${behavioral.ambiguous.sessions + behavioral.explicit.sessions} real sessions)

| Signal | Ambiguous | Explicit |
|---|---|---|
| Clarification events | ${behavioral.ambiguous.clarifyEvents} | ${behavioral.explicit.clarifyEvents} |
| Sessions with ≥1 clarification | ${behavioral.ambiguous.sessionsWithClarify}/${behavioral.ambiguous.sessions} | ${behavioral.explicit.sessionsWithClarify}/${behavioral.explicit.sessions} |
| Sessions finished in ≤3 turns (silent-guess proxy) | ${behavioral.ambiguous.fastGuessSessions} | ${behavioral.explicit.fastGuessSessions} |

Transcript review (manual) of the ambiguous side found the model **inventing unrequested scope**, e.g.:

- **crm-lite**: "integrates email marketing campaigns" — from the vague "needs email integration"
- **expense-splitter**: "expense categories and notifications" — nothing about either was requested
- **standup-bot**: reinterpreted as "schedule, join, and leave standup meetings … send reminders"
- **bookswipe**: added "likes and comments" and a search page not present in the request

Reading: with a small local model, ambiguous prompts do **not** blow up session cost — the model guesses quietly. The damage channel is **intent drift**, which is exactly what a Lemonade-style pre-flight (detect → structure → label assumptions) targets.
`
  : "";

const threats = simulated
  ? `- The simulator's parameters (clarify/correction probabilities, token costs) were chosen by the author for plausibility — the conclusion "ambiguous costs more" is baked in by design.
- Real agentic tools differ: file edits, builds, test loops, model quality and tester patience all shift the numbers.
- Only a run against a real backend (\`npm run phase0:ollama\` for free, or \`phase0:anthropic\` paid) can move the premise from UNVALIDATED to measured.`
  : `- Scripted user: answers come from the explicit spec, so "clarification cost" is measured, but open-ended user drift is not.
- Corrections are not auto-detected in real mode (logged as 0); manual review of transcripts is needed for that signal.
- One model, one run per prompt: high variance possible; raise --runs for stability.`;

const patternRows = r.patternRanking
  .map((p, i) => `| ${i + 1} | \`${p.category}\` | ${p.severity} | ${p.planted} | ${p.processTurns} | ${p.turnsPerPlanting} | ${p.correctionEvents} | ${p.silentAssumptions} |`)
  .join("\n");

const pairRows = r.perPair
  .map((p) => `| ${p.pairId} | ${p.plantedCount} | ${p.ambiguousTurns} | ${p.explicitTurns} | ${p.turnRatio}× | ${fmt(p.ambiguousTokens)} | ${fmt(p.explicitTokens)} | ${p.tokenRatio}× | ${p.ambiguousCorrections} | ${pct(p.ambiguousCompleted)} |`)
  .join("\n");

const paramsTable = m.simulatedParams
  ? Object.entries(m.simulatedParams)
      .map(([k, v]) => `| \`${k}\` | \`${JSON.stringify(v)}\` |`)
      .join("\n")
  : "_n/a (real backend)_";

const md = `# Phase 0 Report — Does Ambiguity Cost? (Ambiguity-Cost Profiler)

- **Generated:** ${m.generatedAt}
- **Backend:** \`${m.backend}\`${simulated ? " (synthetic cost model — see verdict)" : ""}
- **Runs per prompt:** ${m.runsPerPrompt} · **Pairs:** ${m.datasetPairs} · **Sessions:** ${m.sessions}

## Verdict

${verdict}

## Method

15 paired prompts (same app, ambiguous vs. explicit variant; dataset: \`phase0/prompts.dataset.json\`). Each session is a multi-turn agent loop over one prompt with work units fixed per pair (identical for both variants), so any difference in turns/tokens/corrections is attributable to **process overhead caused by ambiguity**, not app complexity. Metrics per session: turns to done, total tokens (input + output), tester corrections, completion within the turn cap.

## Headline numbers (mean per session)

| Metric | Ambiguous | Explicit | Ratio |
|---|---|---|---|
| Turns | ${r.aggregate.ambiguous.meanTurns} | ${r.aggregate.explicit.meanTurns} | **${r.aggregate.turnRatio}×** |
| Total tokens | ${fmt(r.aggregate.ambiguous.meanTotalTokens)} | ${fmt(r.aggregate.explicit.meanTotalTokens)} | **${r.aggregate.tokenRatio}×** |
| Input tokens | ${fmt(r.aggregate.ambiguous.meanInputTokens)} | ${fmt(r.aggregate.explicit.meanInputTokens)} | — |
| Output tokens | ${fmt(r.aggregate.ambiguous.meanOutputTokens)} | ${fmt(r.aggregate.explicit.meanOutputTokens)} | — |
| Tester corrections | ${r.aggregate.ambiguous.meanCorrections} | ${r.aggregate.explicit.meanCorrections} | — |
| Sessions completed within turn cap | ${pct(r.aggregate.ambiguous.completionRate)} | ${pct(r.aggregate.explicit.completionRate)} | — |

## Per-pair results

| Pair | Planted | Turns (A) | Turns (E) | Turns × | Tokens (A) | Tokens (E) | Tokens × | Corrections (A) | Completed (A) |
|---|---|---|---|---|---|---|---|---|---|
${pairRows}

## Ambiguity patterns ranked by attributed cost

Attribution = clarify + correction events consuming a turn, normalized per planting (how many process turns each planted pattern cost on average).

| Rank | Pattern | Severity | Planted | Process turns | Turns/planting | Corrections | Silent assumptions |
|---|---|---|---|---|---|---|---|
${patternRows}

**Provisional Phase 1 seed set:** the top-ranked categories above are the first rules to implement in the Ambiguity Detector ${simulated ? "(provisional — derived from the synthetic model)" : "(attribution is 0 in real mode because clarify events are not pattern-tagged yet — that mapping is precisely the Phase 1 detector's job)"}.

${behavioralSection}

## Simulation parameters (synthetic backend only)

| Param | Value |
|---|---|
${paramsTable}

## Threats to validity / what this run can and cannot tell us

${threats}

## Next step

${simulated
  ? "Run the same dataset through a real backend to convert this report from calibration to evidence: `npm run phase0:ollama` (free) or `phase0:anthropic` (paid)."
  : "1. Human review of the 30 transcripts (in `results/sessions-ollama.jsonl`) to score corrections — the one signal this protocol cannot auto-measure.\n2. Proceed to Phase 1 (Ambiguity Detector) targeting the drift channel above; re-run this profiler after Phase 2 to test whether structured prompts reduce clarifications/drift."}
`;
fs.writeFileSync(path.join(__dirname, "PHASE0_REPORT.md"), md);
console.log(`Wrote phase0/PHASE0_REPORT.md (${md.length} chars)`);
