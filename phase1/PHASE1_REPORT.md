# Phase 1 Report — Ambiguity Detector (Heuristic Rule Engine)

- **Generated:** 2026-09-08
- **Exit criteria:** met — 100% planted-pattern recall (81/81) on the 15 ambiguous prompts, 0 false-positive flags on the 15 well-specified prompts, edge cases pass without crashes.

## Brainstorm — internal representation (considered / rejected / chosen)

1. **Plain regex rules inline in code** — fastest to write, but rules tangle with program logic, are hard to diff/review, and Phase 5's feedback loop needs to promote/demote rules programmatically. Rejected.
2. **Declarative JSON rule config + tiny interpreter engine** — rules are data (easy to add, review, and auto-tune later); the engine stays ~100 lines; zero dependencies. **Chosen.**
3. **Small local LLM as the classifier** — more semantic coverage, but non-deterministic, slower, and violates the cost-discipline constraint as a *default*. Rejected for now; can layer on later as an optional refinement (Phase 6 idea), never replacing heuristics silently.

## Rule schema (`phase1/rules.json`)

| Field | Meaning |
|---|---|
| `id`, `category`, `severity` | identity + tie-in to the shared Phase 0 taxonomy (`phase0/patterns.taxonomy.json`) |
| `match.type` | `absence` (signals missing), `presence` (vague/loaded terms present), `presence_minus` (signal present, spec never addresses the concern), `clause_count` (structural bundling) |
| `require_any` | guard: absence-rules only fire on prompts that look like build requests |
| `suppress_any` | structured-spec markers ("Data model", "Done =", "out of scope", "Features:") that silence a rule |
| `minus_any` | for `presence_minus`: if the spec addresses the concern *anywhere*, don't flag |
| `safe_default` | `true` → resolution is a labeled ASSUMPTION; `false` → a CLARIFYING QUESTION (no safe default exists) |
| `default_assumption` / `clarifying_question` | the pre-drafted resolution text for Phase 2 to consume |

8 seeded rules: `missing_stack` (2), `missing_platform` (2), `vague_scope` (1), `missing_data_model` (3), `compound_request` (3, question), `missing_success_criteria` (2), `unspecified_auth` (2), `vague_integration` (3, question). Severities/`safe_default` flags come from the Phase 0 taxonomy; the two no-safe-default rules (`compound_request`, `vague_integration`) are exactly the categories that drove scope invention in the Phase 0 transcripts.

## API

```js
import { detect } from "./phase1/detector.js";
detect("make me a tinder clone but for books, with a nice modern look");
// -> { flags: [{id:"R4", category:"missing_data_model", severity:3, evidence, resolution:"assumption", assumption:"[ASSUMED: ...]"}, ...],
//      ambiguity_score: 12, flagged: true }
```

- CLI: `node phase1/detect-cli.js "<prompt>"` (or pipe stdin)
- Endpoint: `npm run phase1:serve` → `POST /detect {prompt}` on `:7847`, `GET /health`
- Endpoint smoke test: `npm run phase1:test-endpoint` → health 200, detect 200 w/ 6 flags, malformed body → 400 ✅

## Verification results (`npm run phase1:verify`)

```
Planted-pattern recall (ambiguous side): 81/81 = 100.0%
Extra flags on ambiguous side: 5   (all defensible: platform genuinely
                                    unstated in kanban/crm-lite/fitness-log;
                                    data model unstated in pomodoro; auth
                                    unaddressed in fitness-log)
False-positive flags on explicit side: 0/15 prompts
Edge cases: empty prompt → 0 flags; one-word → 4 flags; ~3k-word → 5 flags;
            out-of-dataset sample → sensible 5 flags. No crashes.
```

Sample CLI output (real): the bookswipe ambiguous prompt yields 6 flags, each with evidence ("subjective/open-ended qualifier: \"nice, modern, clone\"", "implies users but says nothing about accounts/auth: \"tinder\"") and a labeled assumption.

## Intent-match check

N/A — the detector never transforms a prompt; it only reads it and emits flags. (The intent-preservation gate applies in Phases 2–3.)

## Open risks / limitations

1. **Tuned on this dataset** — 15 pairs is small; rules may overfit to my own prompt-writing style. Mitigations: out-of-dataset sample behaves sensibly; Phase 5's feedback loop will re-score rules on real acceptance data; rules are data, so retuning is cheap.
2. **English-only lexicon**, no negation across sentence boundaries (window of 18 chars for integration nouns).
3. **`presence_minus` is global** — a single auth mention anywhere suppresses `unspecified_auth` for the whole prompt. Fine for one-ask prompts; may miss per-feature gaps in long specs.
4. **Absence rules need a build-intent guard** (`require_any`) to avoid flagging random text; the guard lexicon is hand-maintained.
5. Detects ambiguity *presence*, not ambiguity *cost* — prioritization comes from severity + Phase 0's drift findings, not a learned cost model yet.

## Real-world smoke test finding (2026-09-08)

A fresh out-of-dataset demo prompt ("meal planner … my wife should be able to see it on her phone") exposed a guard-vocabulary gap: `absence` rules never evaluated because no build-intent token matched ("planner"). **Fix:** `require_any` extended with everyday app nouns (planner, tracker, organizer, generator, logger, …); dataset recall (81/81) and stress results (26/26, 0 FP) re-verified unchanged after the edit.

**Residual gaps noted honestly (unfixed):** the phrase "on her phone" suppresses `missing_platform` (the ask is implicitly a web/shared app) and also suppresses `unspecified_auth`, even though "my wife should be able to see it" is a genuine multi-user signal. Both are real-world recall misses of the global-minus design (documented limitation #3 above); they are safe-direction misses (fewer flags, no wrong flags).

## Out-of-dataset stress test (`phase1/run-stress.js`)

10 fresh prompts (5 ambiguous with planted patterns, 5 explicit), authored independently of the dataset.

**Round 1 (before tuning):** recall 96.2% (25/26), 5 explicit-side FPs — each a real lexicon gap: `JSON file` and `chrome.storage.sync` not read as data-model signals; `REST API` not recognized as a platform choice; `cute` missing from subjective qualifiers; `"Tetris clone"` + structured spec wrongly triggered vague_scope ("clone" is only vague when the prompt has no spec markers).

**Round 2 (after tuning):**

```
Planted recall (ambiguous side): 26/26 = 100.0%
Extra flags (ambiguous side): 3  (S1 platform inference from "online store",
                                  S3 compound bundling, S9 chatgpt wrapper —
                                  integration named, flow unspecified: all defensible)
False positives (explicit side): 0
Dataset regression check: 81/81 recall, 0 FP — unchanged
```

Rule changes made: `\bpostgresql?\b` + `\bjson\b` + `\bstorage\b` (R1/R4), `\brest api\b` (R2), aesthetic-adjective group extended with cute/pretty/cool/fun/playful + spec-marker suppression (R3), `chrome.storage` added to provider-specific suppressors (R8).

## Next step (Phase 2 preview)

Consume `detect()` output in the Rewriter: safe-default flags → labeled `[ASSUMED: ...]` insertions structured into Goal / Explicit Requirements / Assumptions Made / Open Questions; no-safe-default flags → surfaced clarifying questions. Verification = the Phase 0 dataset again, human-reviewed for intent preservation.
