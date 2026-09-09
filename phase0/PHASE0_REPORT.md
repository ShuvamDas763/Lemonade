# Phase 0 Report — Does Ambiguity Cost? (Ambiguity-Cost Profiler)

- **Generated:** 2026-09-08T19:51:37.108Z
- **Backend:** `simulated` (synthetic cost model — see verdict)
- **Runs per prompt:** 5 · **Pairs:** 15 · **Sessions:** 150

## Verdict

**PREMISE: UNVALIDATED.** All numbers below come from the synthetic cost-model backend, whose design bakes in the direction of the result. This run proves the harness, dataset and report pipeline work end-to-end — it does **not** prove that ambiguity costs more with a real LLM. Do not cite these numbers as evidence.

## Method

15 paired prompts (same app, ambiguous vs. explicit variant; dataset: `phase0/prompts.dataset.json`). Each session is a multi-turn agent loop over one prompt with work units fixed per pair (identical for both variants), so any difference in turns/tokens/corrections is attributable to **process overhead caused by ambiguity**, not app complexity. Metrics per session: turns to done, total tokens (input + output), tester corrections, completion within the turn cap.

## Headline numbers (mean per session)

| Metric | Ambiguous | Explicit | Ratio |
|---|---|---|---|
| Turns | 7.33 | 4.13 | **1.77×** |
| Total tokens | 18,680 | 9,809 | **1.9×** |
| Input tokens | 14,869 | 6,988 | — |
| Output tokens | 3,812 | 2,821 | — |
| Tester corrections | 1.05 | 0 | — |
| Sessions completed within turn cap | 100% | 100% | — |

## Per-pair results

| Pair | Planted | Turns (A) | Turns (E) | Turns × | Tokens (A) | Tokens (E) | Tokens × | Corrections (A) | Completed (A) |
|---|---|---|---|---|---|---|---|---|---|
| bookswipe | 6 | 7 | 4 | 1.75× | 17,427 | 9,436 | 1.85× | 0.8 | 100% |
| habit-tracker | 5 | 6.2 | 4 | 1.55× | 15,372 | 9,456 | 1.63× | 1.2 | 100% |
| invoice-generator | 7 | 8.6 | 4 | 2.15× | 23,056 | 9,476 | 2.43× | 1.4 | 100% |
| standup-bot | 5 | 7.4 | 4.4 | 1.68× | 18,955 | 10,490 | 1.81× | 1.8 | 100% |
| recipe-box | 5 | 6.4 | 4 | 1.6× | 15,752 | 9,520 | 1.65× | 0.6 | 100% |
| url-shortener | 5 | 7.2 | 4 | 1.8× | 18,018 | 9,420 | 1.91× | 0.6 | 100% |
| kanban | 6 | 7.6 | 4.2 | 1.81× | 19,832 | 9,992 | 1.98× | 1.6 | 100% |
| expense-splitter | 6 | 8 | 4 | 2× | 20,718 | 9,476 | 2.19× | 1.2 | 100% |
| pomodoro | 4 | 7 | 4.2 | 1.67× | 17,445 | 9,950 | 1.75× | 0.6 | 100% |
| crm-lite | 6 | 8 | 4.6 | 1.74× | 20,742 | 11,008 | 1.88× | 1 | 100% |
| markdown-notes | 5 | 7.4 | 4.2 | 1.76× | 18,859 | 9,942 | 1.9× | 1.4 | 100% |
| booking | 6 | 7.6 | 4.2 | 1.81× | 19,330 | 10,009 | 1.93× | 0.6 | 100% |
| fitness-log | 5 | 7.4 | 4 | 1.85× | 18,958 | 9,460 | 2× | 1.6 | 100% |
| podcast-player | 4 | 6.6 | 4.2 | 1.57× | 16,150 | 9,984 | 1.62× | 0.4 | 100% |
| feedback-widget | 6 | 7.6 | 4 | 1.9× | 19,592 | 9,516 | 2.06× | 1 | 100% |

## Ambiguity patterns ranked by attributed cost

Attribution = clarify + correction events consuming a turn, normalized per planting (how many process turns each planted pattern cost on average).

| Rank | Pattern | Severity | Planted | Process turns | Turns/planting | Corrections | Silent assumptions |
|---|---|---|---|---|---|---|---|
| 1 | `compound_request` | 3 | 15 | 15 | 1 | 2 | 0 |
| 2 | `vague_integration` | 3 | 10 | 10 | 1 | 2 | 0 |
| 3 | `missing_data_model` | 3 | 70 | 69 | 0.99 | 13 | 1 |
| 4 | `missing_stack` | 2 | 75 | 70 | 0.93 | 19 | 5 |
| 5 | `missing_platform` | 2 | 55 | 49 | 0.89 | 10 | 6 |
| 6 | `missing_success_criteria` | 2 | 75 | 54 | 0.72 | 14 | 21 |
| 7 | `unspecified_auth` | 2 | 45 | 30 | 0.67 | 8 | 15 |
| 8 | `vague_scope` | 1 | 60 | 31 | 0.52 | 11 | 29 |

**Provisional Phase 1 seed set:** the top-ranked categories above are the first rules to implement in the Ambiguity Detector (provisional — derived from the synthetic model).



## Simulation parameters (synthetic backend only)

| Param | Value |
|---|---|
| `workUnits` | `10` |
| `buildRate` | `2.5` |
| `sysTokens` | `1200` |
| `ctxGrowthTokens` | `250` |
| `buildOutTokens` | `700` |
| `reworkOutTokens` | `450` |
| `clarifyOutTokens` | `120` |
| `userAnsTokens` | `40` |
| `pClarify` | `{"1":0.15,"2":0.3,"3":0.5}` |
| `pWrongGuess` | `0.25` |
| `pBaseNoise` | `0.03` |
| `maxTurns` | `14` |

## Threats to validity / what this run can and cannot tell us

- The simulator's parameters (clarify/correction probabilities, token costs) were chosen by the author for plausibility — the conclusion "ambiguous costs more" is baked in by design.
- Real agentic tools differ: file edits, builds, test loops, model quality and tester patience all shift the numbers.
- Only a run against a real backend (`npm run phase0:ollama` for free, or `phase0:anthropic` paid) can move the premise from UNVALIDATED to measured.

## Next step

Run the same dataset through a real backend to convert this report from calibration to evidence: `npm run phase0:ollama` (free) or `phase0:anthropic` (paid).
