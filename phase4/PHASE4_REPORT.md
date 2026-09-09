# Phase 4 Report — Correction-Memory Layer

- **Generated:** 2026-09-08
- **Exit criteria:** met — a user making the same correction twice across mock sessions is promoted to a standing preference and appears (clearly labeled) in the next rewrite automatically. Verified in `node phase4/verify-memory.js` → `ALL CHECKS PASSED: 21 passed, 0 failed`, plus a real CLI demo (below). All deterministic, zero model calls (cost discipline).

## Brainstorm — design choices (considered / rejected / chosen)

1. **Correction detection:** LLM-judged conversation parsing (rejected: non-deterministic, costs calls, hard to audit) vs **deterministic pattern extraction** over user replies — replacement ("no, use X instead of Y"), standing statements ("always use TypeScript", "I prefer Vue"), prohibitions ("never use comments"), and affirmations of known values ("yes, TypeScript"). **Chosen.** Edit-diff mining (did the user edit the optimized prompt?) is the other big signal but needs an edit stream the middleware doesn't observe yet — noted as the first integration point for Phase 5.
2. **Store:** SQLite (rejected: native dependency vs the project's zero-dep ethos for this scale) vs **JSON file store** with atomic writes (tmp+rename), one record per preference key with `count / firstSeen / lastSeen / excerpts / sources`. **Chosen.**
3. **Promotion:** status ladder `candidate (seen 1×) → standing (seen >1× AND fresh) → stale (unused >45 days)`. The brief's threshold (>1 occurrence) is the over-fit guard: a single correction is never auto-applied. **Forgetting is explicit only** (`forget` command) — records are never auto-deleted (human in the loop).

## Design

```
extractCorrections(replyText, {knownValues}) -> [{kind, dimension, value, replaces?, key}]
CorrectionStore(filePath) -> { record(events), standing(), all(), forget(key) }
rewrite(raw, {memoryPath?}) -> { ..., memory: { applied: [keys], skipped: [{key, reason}] } }
```

- **Rewriter integration:** every `standing` preference is injected as an assumption line — always labeled, never silent:
  `[USER PREFERENCE (learned from corrections - edit or remove freely): TypeScript]`
- **Conflict guard:** a standing *prohibition* ("no comments") is **skipped** — with a recorded reason — when the current prompt asks for that thing ("a comments section under each post"). Matching is on the prohibition's head noun (users phrase prohibitions with filler: "no comments in the code"; prompts mention the noun in any clothing: "a comments section"). Over-skipping is the safe direction: the preference is simply not applied; the prompt outranks the preference either way.
- **Graceful degradation:** a corrupt or missing store never breaks rewriting — the failure is recorded in `memory.skipped` and the rewrite proceeds.
- **Phase 3 gate extension (F10):** `memory_applied` assumptions are exempt from detector-flag matching (they come from memory, not ambiguity) but MUST carry the visible `[USER PREFERENCE` label — stripping the label is a **hard failure** ("never silently hidden", constraint #1).

## Verification results (real output)

```
== Promotion & over-fit guard ==       extract ✓, 1× candidate NEVER applied ✓,
                                       2× standing ✓, auto-injected labeled ✓, gate PASS ✓
== Conflict guard ==                   "never use comments" standing ✓; prompt asking for a
                                       "comments section" → skipped with reason ✓; neutral
                                       prompt → applied ✓
== Staleness ==                        60-day-old preference → stale, not injected ✓
== Graceful degradation ==             corrupt store → rewrite still ok, failure recorded ✓
== Gate: memory label is mandatory ==  label stripped → HARD FAIL (memory-label) ✓
== Regressions ==                      phase1 recall 100% ✓, phase2 30/30 ✓, phase3 ALL PASSED ✓
ALL CHECKS PASSED: 21 passed, 0 failed
```

**CLI demo (exit-criteria path, real run):**
```
$ memory add "no, use TypeScript instead of JavaScript"      → [candidate] TypeScript (count=1)
$ memory add "yeah TypeScript is fine, always TypeScript from now on"
                                                             → [standing] TypeScript (count=2)
$ rewrite "build a tiny pomodoro timer"
  memory: {"applied":["typescript"]}
  → [USER PREFERENCE (learned from corrections - edit or remove freely): TypeScript]
  Phase 3 gate: PASS
```

Two bugs the harness caught and fixed along the way: the conflict matcher originally required the prohibition's whole phrase to appear in the prompt (missed "comments section" vs "no comments in the code") — fixed to head-noun matching; and the `always` pattern captured trailing filler ("TypeScript from now on" became a junk candidate key) — fixed with a filler-stripping rule in `clean()`.

## Intent-match check (protocol step 4)

Does memory change what the user wanted? **No — by construction:** preferences are injected only when standing (≥2 observations), always carry the visible `[USER PREFERENCE … edit or remove freely]` label, are skipped when the current prompt contradicts them, and the original prompt remains the verbatim source of truth that outranks everything. One-off corrections are never applied; stale preferences drop out until re-confirmed.

## Open risks / limitations

1. **Pattern recall is modest** — deterministic regexes catch explicit corrections; implicit corrections ("hmm, actually make it dark") and edit-diff signals are not yet mined (Phase 5's outcome logger is the right home).
2. **Dimension guessing is keyword-based** — used for reporting only; keys are value-derived, so a mislabeled dimension never misroutes anything.
3. **45-day staleness is a guess** — should be tuned by Phase 5 acceptance data.
4. **Single-user store** — `data/corrections.json` is one profile; multi-user keyspacing is deferred until there's a real deployment shape.

## How to run

```bash
npm run phase4:verify                       # 21-check harness (incl. regressions)
npm run memory -- add "<user reply>"        # record correction events
npm run memory -- list [--standing]         # inspect store
npm run memory -- forget <key>              # explicit removal (never automatic)
```
