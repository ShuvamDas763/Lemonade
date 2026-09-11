# Phase 0 Report — Does Ambiguity Cost? (Ambiguity-Cost Profiler)

- **Generated:** 2026-09-09T17:54:15.498Z
- **Backend:** `ollama`
- **Runs per prompt:** 1 · **Pairs:** 15 · **Sessions:** 30

## Verdict

**MEASURED RESULT (real sessions, qwen2.5:3b via Ollama, scripted-user protocol): ambiguity did NOT measurably increase session turns or tokens** — turns 1.11×, tokens 0.68×. The measurable cost of ambiguity appeared elsewhere: clarification load and **silent scope invention** visible in transcripts (see Behavioral findings). Session-token savings are therefore NOT the value proposition for the optimizer; surfacing ambiguity the model silently papers over is.

## Method

15 paired prompts (same app, ambiguous vs. explicit variant; dataset: `phase0/prompts.dataset.json`). Each session is a multi-turn agent loop over one prompt with work units fixed per pair (identical for both variants), so any difference in turns/tokens/corrections is attributable to **process overhead caused by ambiguity**, not app complexity. Metrics per session: turns to done, total tokens (input + output), tester corrections, completion within the turn cap.

## Headline numbers (mean per session)

| Metric | Ambiguous | Explicit | Ratio |
|---|---|---|---|
| Turns | 4.8 | 4.33 | **1.11×** |
| Total tokens | 1,636 | 2,417 | **0.68×** |
| Input tokens | 1,432 | 1,885 | — |
| Output tokens | 204 | 532 | — |
| Tester corrections | 0 | 0 | — |
| Sessions completed within turn cap | 100% | 100% | — |

## Per-pair results

| Pair | Planted | Turns (A) | Turns (E) | Turns × | Tokens (A) | Tokens (E) | Tokens × | Corrections (A) | Completed (A) |
|---|---|---|---|---|---|---|---|---|---|
| bookswipe | 6 | 6 | 4 | 1.5× | 2,223 | 2,525 | 0.88× | 0 | 100% |
| habit-tracker | 5 | 5 | 4 | 1.25× | 1,640 | 2,642 | 0.62× | 0 | 100% |
| invoice-generator | 7 | 5 | 4 | 1.25× | 1,418 | 1,897 | 0.75× | 0 | 100% |
| standup-bot | 5 | 6 | 4 | 1.5× | 2,451 | 2,021 | 1.21× | 0 | 100% |
| recipe-box | 5 | 2 | 4 | 0.5× | 421 | 2,359 | 0.18× | 0 | 100% |
| url-shortener | 5 | 3 | 6 | 0.5× | 756 | 2,646 | 0.29× | 0 | 100% |
| kanban | 6 | 5 | 4 | 1.25× | 1,449 | 1,611 | 0.9× | 0 | 100% |
| expense-splitter | 6 | 8 | 4 | 2× | 3,424 | 2,104 | 1.63× | 0 | 100% |
| pomodoro | 4 | 4 | 4 | 1× | 1,126 | 2,532 | 0.44× | 0 | 100% |
| crm-lite | 6 | 5 | 4 | 1.25× | 1,548 | 2,043 | 0.76× | 0 | 100% |
| markdown-notes | 5 | 8 | 5 | 1.6× | 3,648 | 2,074 | 1.76× | 0 | 100% |
| booking | 6 | 3 | 4 | 0.75× | 694 | 3,139 | 0.22× | 0 | 100% |
| fitness-log | 5 | 4 | 4 | 1× | 1,260 | 1,806 | 0.7× | 0 | 100% |
| podcast-player | 4 | 2 | 6 | 0.33× | 418 | 4,058 | 0.1× | 0 | 100% |
| feedback-widget | 6 | 6 | 4 | 1.5× | 2,065 | 2,797 | 0.74× | 0 | 100% |

## Ambiguity patterns ranked by attributed cost

Attribution = clarify + correction events consuming a turn, normalized per planting (how many process turns each planted pattern cost on average).

| Rank | Pattern | Severity | Planted | Process turns | Turns/planting | Corrections | Silent assumptions |
|---|---|---|---|---|---|---|---|
| 1 | `missing_stack` | 2 | 15 | 0 | 0 | 0 | 0 |
| 2 | `missing_platform` | 2 | 11 | 0 | 0 | 0 | 0 |
| 3 | `vague_scope` | 1 | 12 | 0 | 0 | 0 | 0 |
| 4 | `missing_data_model` | 3 | 14 | 0 | 0 | 0 | 0 |
| 5 | `compound_request` | 3 | 3 | 0 | 0 | 0 | 0 |
| 6 | `missing_success_criteria` | 2 | 15 | 0 | 0 | 0 | 0 |
| 7 | `unspecified_auth` | 2 | 9 | 0 | 0 | 0 | 0 |
| 8 | `vague_integration` | 3 | 2 | 0 | 0 | 0 | 0 |

**Provisional Phase 1 seed set:** the top-ranked categories above are the first rules to implement in the Ambiguity Detector (attribution is 0 in real mode because clarify events are not pattern-tagged yet — that mapping is precisely the Phase 1 detector's job).

## Behavioral findings (from 30 real sessions)

| Signal | Ambiguous | Explicit |
|---|---|---|
| Clarification events | 32 | 7 |
| Sessions with ≥1 clarification | 15/15 | 3/15 |
| Sessions finished in ≤3 turns (silent-guess proxy) | 4 | 0 |

Transcript review (manual) of the ambiguous side found the model **inventing unrequested scope**, e.g.:

- **crm-lite**: "integrates email marketing campaigns" — from the vague "needs email integration"
- **expense-splitter**: "expense categories and notifications" — nothing about either was requested
- **standup-bot**: reinterpreted as "schedule, join, and leave standup meetings … send reminders"
- **bookswipe**: added "likes and comments" and a search page not present in the request

Reading: with a small local model, ambiguous prompts do **not** blow up session cost — the model guesses quietly. The damage channel is **intent drift**, which is exactly what a Lemonade-style pre-flight (detect → structure → label assumptions) targets.


## Simulation parameters (synthetic backend only)

| Param | Value |
|---|---|
_n/a (real backend)_

## Threats to validity / what this run can and cannot tell us

- Scripted user: answers come from the explicit spec, so "clarification cost" is measured, but open-ended user drift is not.
- Corrections are not auto-detected in real mode (logged as 0); manual review of transcripts is needed for that signal.
- One model, one run per prompt: high variance possible; raise --runs for stability.

## Next step

1. Human review of the 30 transcripts (in `results/sessions-ollama.jsonl`) to score corrections — the one signal this protocol cannot auto-measure.
2. Proceed to Phase 1 (Ambiguity Detector) targeting the drift channel above; re-run this profiler after Phase 2 to test whether structured prompts reduce clarifications/drift.
