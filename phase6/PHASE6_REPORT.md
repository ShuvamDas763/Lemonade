# Phase 6 Report — Inline Ambiguity Linter

- **Generated:** 2026-09-08
- **Exit criteria:** met — reuses the Phase 1 rule engine verbatim (one semantics, two views), highlights flagged phrases in place with file:line:col and caret underlines, zero model calls, zero dependencies. `node phase6/verify-linter.js` → `ALL CHECKS PASSED: 90 passed, 0 failed`.

## Design

- **`detectSpans(raw)` (phase1/detector.js, additive):** same rules, same evaluation as `detect()`, plus character-offset spans per flag. Span semantics per matcher type: `presence`/`presence_minus` → the matched (negation-filtered) terms; `clause_count` → the feature nouns; `absence` → anchored to the build-intent token (absence has no wrong text to underline); prompts with no anchor get a prompt-level note instead of a fake span. Flag categories are regression-checked to equal `detect()` categories on every harness run.
- **`lint-cli.js`:** file or stdin (`--stdin`); human mode with `path:line:col`, evidence, source line, caret underlines under every flagged phrase (multi-line flags supported — one flag, several lines); `--json` emits machine-readable spans with line/col for editor integration; `--min-severity N` filters; `--strict` exits 1 when any flag ≥ min-severity exists (commit/CI gate), 0 otherwise, 2 on usage errors.

## Verification results (real output)

```
== Span invariants ==     bounds, non-empty, text == raw.slice(start,end), sorted — for every
                          flag on 5 prompts (incl. empty + one-word) ✓
== Detector consistency == detectSpans categories == detect() categories on all prompts ✓
== Clean prompt ==        fully specified reference prompt -> 0 span flags ✓
== CLI modes ==           file ✓, stdin ✓, --json parses + line/col ✓, --strict 1/0 ✓,
                          missing file -> exit 2 ✓, --min-severity filters ✓
== Regressions ==         phase1 100% ✓, phase2 30/30 ✓, phase3 95/0 ✓, phase4 21/0 ✓, phase5 23/0 ✓
ALL CHECKS PASSED: 90 passed, 0 failed
```

Demo (`node phase6/lint-cli.js examples/ambiguous-prompt.md`): 7 flags on the messy meal-planner file — R7 underlines **family** (line 3) and **wife** (line 6) as one flag; R3 underlines nice/modern/cool/stuff across three lines; R8 pins "email" as a vague integration needing an answer; R1/R4/R6 anchor to the build-intent token "want".

One harness-caught bug: per-pattern span collection could emit out-of-order spans within a flag — fixed by sorting spans by position before return.

## Cross-phase consistency fix (found by the demo)

The detector knew "family/wife" implies multi-user (R7 vocabulary added in the audit), but Phase 2's adaptive auth assumption only checked team words — it would still have written "single-user" under a verbatim prompt about the user's wife. `authAssumption()` now shares R7's social vocabulary, so the family prompt gets *"single shared workspace without login… team/user framing detected"*. Phase 2 re-verified 30/30.

## Intent-match check (protocol step 4)

N/A — the linter never transforms anything; it highlights and suggests. All suggestions come from the same rule config Phase 2 consumes.

## Limitations

1. Absence rules can only underline what *is* there (the anchor); the actual gap has no location — the evidence line explains it.
2. Character↔line mapping assumes `\n` (no `\r\n` normalization); CRLF files get correct line numbers, columns can be off on CR-only files (nobody writes those).
3. Flags are still prompt-level heuristics — the linter inherits Phase 1's documented recall/precision envelope, not more.

## Part 2 — Spec-Drift Detector (requirements ledger)

**Exit criteria:** met — planted contradiction scenarios (prohibition violated, numeric drift, intentional reversal, reaffirmation, confirm flow, fully consistent conversation) all produce exactly their expected outcome. `node phase6/verify-drift.js` → `ALL CHECKS PASSED: 32 passed, 0 failed`.

**Design:** a per-conversation **ledger** (`SpecLedger`, JSON store, atomic writes) accumulates requirements extracted deterministically from each message — prohibitions (reusing the tested Phase 4 extractor), explicit out-of-scope phrases, explicit-feature inclusions (precision over recall: a drift detector that cries wolf gets ignored), and quantities (with adjective-skipping so "3 **fixed** columns" keys on "column"). Later messages are checked against active entries:

- **Unmarked contradiction → VIOLATION** referencing the original entry (id, message index, both statements) with a one-line `confirm` hint — flagged, never judged (the user may have changed their mind).
- **Reversal markers** ("actually", "change of plan", "scratch", "switch to", …) → the old entry is **superseded with history kept**, no violation.
- **Atomic-phrase canonicalization**: "no login" vs "add a login page" collide on key `login` (that's the drift you want to catch); "dark mode" vs "light mode" stay distinct.
- **Confirm flow**: explicit `confirm <id>` resolves a flagged contradiction going forward; entries are never silently deleted (superseded, history retained).

**Demo** (`examples/spec-drift-conversation.txt`, real run): message 3's "Actually, change of plan: use 5 columns instead" → intentional supersession of "3 columns"; message 7's "add a login page with Google sign-in" after "no login for v1" → `prohibition-violated` against message 6 with the confirm command printed.

**Harness-caught bugs:** (1) after an intentional reversal the new requirement was dropped by the double-log guard — fixed so the new truth is recorded; (2) two assertion key mismatches ("attachment" vs the ledger's correct "attachments").

**Limitations:** head-word collision can over-flag unrelated features sharing a noun (e.g. "user" in two different senses) — that is the safe direction (a flag asks, silence doesn't); extraction is English-only and conservative; semantic drift with no lexical overlap ("no auth" → later "JWT sessions" when 'auth' absent) is not caught. `--strict` gates on unconfirmed violations (exit 1).

```bash
npm run drift -- say "no attachments for v1"        # process a message
npm run drift -- say --file conversation.txt        # whole file as one message
npm run drift -- show [--all] | stats | confirm <id>
npm run phase6:drift-verify                         # 32-check harness
```

## How to run (Part 1 — linter)

```bash
npm run lint -- examples/ambiguous-prompt.md          # human-readable highlights
npm run lint -- --stdin < prompt.txt                  # pipe anything
npm run lint -- prompt.txt --json                     # editor integration
npm run lint -- prompt.txt --strict                   # CI/commit gate (exit 1 = ambiguous)
npm run phase6:verify                                 # 90-check harness incl. regressions
```

## Part 3 — A/B integration: sessions feed the ledger, drift feeds memory

**Exit criteria:** met — the 9 real multi-message A/B sessions flow through the spec-drift ledger with role-based trust, structural violations and judge flags route into per-arm correction-memory stores, and repeated drift promotes under the store's over-fit guard. `node phase6/verify-ab-wiring.js` → `ALL CHECKS PASSED: 25 passed, 0 failed`.

**Design (`phase6/ab-wiring.js`, `phase2/ab-ledger.js`):**

- **Role-based trust:** the initial prompt and user ANSWER turns add/supersede requirements; agent BUILD/DONE turns are **checked but never recorded** (the agent does not own the spec — it can violate the ledger, never extend it). Agent CLARIFY turns skip extraction entirely: a question is never a requirement.
- **Seeding + echo hygiene:** each replayed session is seeded with its arm's actual initial prompt (raw ambiguous / the deterministic rewrite / the explicit spec), so the scripted oracle's verbatim echoes ("Q: …\nA: <earlier spec text>") are recognized as echoes — not new requirements — and the seed itself is never mined for memory events (the spec is not a correction).
- **Two complementary drift layers per message:** structural ledger conflicts (prohibition violated, numeric drift, plus a new `quantity-for-prohibited-feature` type — "3 attachments" against "no attachments" — with plural-tolerant key matching) and the **shared** transparent drift judge imported from `phase2/drift-judge.js` so ground truth cannot diverge from the A/B analyzer.
- **Loopback semantics (never judge intent):** a violation cannot know which side is right, so the violated entry's **canonical feature** is recorded as a CANDIDATE prohibition ("no attachments") in a per-arm memory store — over-fit guard (count > 1) still applies. `--shared-memory` accumulates across runs, so repeated drift **promotes to standing** exactly as user corrections do.
- **Dedup:** one canonical preference per feature per session — a structural violation and a judge flag on the same feature are one drift signal, not two.

**Real-run results (9 sessions from the REGENERATED batch — current-code evidence, `npm run phase2:ab:ledger`):**

| arm | ledger violations | agent-flagged turns | memory events | shared-memory standing |
|---|---|---|---|---|
| raw | 0 | 5 | 4 | `additional-users` |
| optimized | 5 | 7 | 7 | `attachments` |
| explicit | 0 | 0 | 0 | — |

All 5 optimized violations are genuine: run0's "attachments and labels to cards" against "Attachments (out of scope)" (the session the judge marked *silent* — the ledger catches it structurally), and run1's attachment/label additions ×3 plus "user management functionalities" against "without login for v1" (auth-family canonicalization doing exactly its job). The clean optimized session produced zero violations — the structural layer agrees with the judge layer on *which* sessions drifted. Raw's zero violations is *correct*, not a miss: nothing was prohibited there, so nothing could be structurally violated — its inventions ("multiple users", "up to 10 users", extra metrics) are precisely what the marker layer caught. The layers are complementary: structural conflicts fire where the spec set prohibitions; markers fire where inventions had no explicit prohibition to collide with.

**Fresh-regen robustness fixes (both caught by replaying the new batch):** (1) user replies quoting the agent's question ("Q: …what functionalities are considered out of scope…") leaked the echoed question into extraction — "Q:"-prefixed lines are now dropped before extraction (a question is never a requirement); (2) quantified prohibitions lost their qualifier, so "multiple boards are out of scope" collided with a later compliant "single board" — prohibitions now carry quantity qualifiers ("multiple" ⇒ ≥2) and only conflict with quantities that exceed them.

**Harness-caught bugs (all fixed, regression-covered):** (1) the inclusion regex swallowed the article into the word — "add attachments" captured `"ttachments"`, so prohibitions never collided (word-bounded article groups now); (2) user-reply corrections were stamped `ledger-violation` — `CorrectionStore.record()` now honors per-event `source`; (3) agent-voice quote chunks produced junk memory keys (`add-attachments-cards`) — violations now reuse the violated entry's canonical key; (4) agent CLARIFY turns were judge-shaped as BUILDs, phantoming flags — `kind` passes through now.

```bash
npm run phase2:ab:ledger                # replay the 9 A/B sessions through the ledger
npm run phase2:ab:ledger -- --shared-memory   # accumulate per-arm, watch drift promote
npm run phase6:wiring-verify            # 25-check harness incl. regressions
```
