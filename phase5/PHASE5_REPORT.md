# Phase 5 Report — Feedback Loop (self-improving rule engine)

- **Generated:** 2026-09-08
- **Exit criteria:** met — with 61 simulated outcomes carrying planted ground truth, the scoring system correctly identifies healthy vs watch vs flagged vs provisional rules (verified against the designed split), flagged rules are surfaced for review (never auto-removed), and edit-diff learning feeds the Phase 4 correction store through the same deterministic extractor. `node phase5/verify-feedback.js` → `ALL CHECKS PASSED: 23 passed, 0 failed`.

## Brainstorm — design choices (considered / rejected / chosen)

1. **Attribution of outcomes to rules:** LLM judgment per transcript (rejected: cost + non-determinism) vs **flag-based attribution** — each outcome event carries the rule IDs that fired for that rewrite, so outcomes aggregate per rule deterministically. **Chosen.** (Imperfect for multi-flag rewrites — an edit may reflect only one of three fired rules; recorded as a limitation.)
2. **Scoring:** lifetime averages (rejected: stale behavior hides forever) vs **rolling window (last 50 events per rule)** with statuses `provisional (<8 observations) → healthy (≥60%) → watch (40–60%) → flagged (<40%)` and a `MIN_OBSERVATIONS=8` over-reaction guard. **Chosen.**
3. **Action on flagged rules:** auto-delete/reweight (rejected: violates the brief's human-in-the-loop requirement) vs **surface in the periodic report with recommendations**; removal stays manual. **Chosen.**
4. **Edit-diff learning:** diff-specific logic (rejected: second code path, untested thresholds) vs **synthesizing a natural-language correction** ("no, use X instead of Y" / "from now on use X") processed by the **same tested Phase 4 extractor** — one code path, one promotion rule. **Chosen**, guarded to short replacement-shaped diffs (≤8 words/side) so content rewrites aren't mistaken for preferences.

## Design

```
OutcomeStore.record({flags: [ruleIds], outcome: accepted|edited|rejected, edits: [{original, replacement}]})
ruleStats(store)  -> [{id, total, acceptRate(rolling 50), status}]   sorted worst-first
generateReport(store) -> markdown: table + recommendations (flagged/watch), no auto-removal
learnFromEdits(edits, correctionStore) -> n   # Phase 4 integration (source: "edit-diff")
```

- **Signals consumed:** accepted-as-is (+1 accept), edited-before-send (−1, the strongest per-rewrite signal per the brief), rejected. Downstream-output corrections are noted in the architecture but not yet auto-ingested (attribution too noisy — documented).
- **Label-only edit shape handled:** when the user replaces an entire assumption line (`[ASSUMED: React (Vite)]` → `Vue`), the original strips to empty; the learner emits a standing statement ("from now on use Vue") instead of a broken replacement — the most common real edit shape, caught by the harness.
- **Store:** JSON, atomic writes, FIFO cap 2000 events; unknown outcomes rejected loudly.

## Verification results (real output)

```
== Planted outcomes ==   R1 healthy (14 ev), R2 watch (12), R3 flagged (12, acceptRate 8.3%),
                         R4/R5 provisional (<8), R6 healthy (12) — all match the planted split ✓
== Report ==             all 6 rules listed ✓, R3 recommended for revision ✓, R2 borderline ✓,
                         removals never automatic ✓
== Edit-diff learning == label-stripped edit records ✓, identical edit skipped ✓,
                         over-long content edit skipped ✓, 2 occurrences -> standing ✓
== Store guards ==       unknown outcome rejected ✓, FIFO cap 2000 ✓
== Regressions ==        phase1 100% recall ✓, phase2 30/30 ✓, phase3 95/0 ✓, phase4 21/0 ✓
ALL CHECKS PASSED: 23 passed, 0 failed
```

CLI smoke: two `record --edit "[ASSUMED: React (Vite)]=>Vue"` events → memory store shows `[standing] Vue (count=2)` with excerpt "from now on use Vue" — the full edit→preference loop in two commands.

## Intent-match check (protocol step 4)

Does the feedback loop change what users asked for? **No** — it only re-scores *rules* and surfaces recommendations; prompts, assumptions, and preferences keep their existing guards (verbatim goal, labeled additions, ≥2-occurrence promotion). The single behavior change it feeds forward is rule *wording*, which Phase 2's gate and Phase 3's F1–F10 still verify on every rewrite.

## Open risks / limitations

1. **Multi-flag attribution is coarse** — an "edited" outcome debits every rule that fired; per-rule responsibility needs counterfactual sampling (expensive) or user-visible rule tagging (UX work), not solvable free today.
2. **"Edited" is a blunt negative** — users also edit for taste, not error; the 0.4/0.6 thresholds are conservative and MIN_OBSERVATIONS=8 dampens misclassification.
3. **Downstream-output corrections not yet ingested** — the brief marks them noisy; when an execution channel exists, outcome events can carry `downstream: corrected|accepted` with pair/session ids for attribution.
4. **Windows/thresholds are guesses** — to be tuned once real acceptance data accumulates; the report exists precisely to review them.

## How to run

```bash
npm run phase5:verify                                   # 23-check harness incl. regressions
npm run feedback -- record edited --flags R1,R5 --edit "[ASSUMED: React (Vite)]=>Vue"
npm run feedback -- stats                               # rolling per-rule hit rates + statuses
npm run feedback -- report --out data/rule-report.md    # periodic report (human review input)
```
