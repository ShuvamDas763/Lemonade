# Phase 3 Report — Intent-Preservation Verifier (hard gate)

- **Generated:** 2026-09-08
- **Exit criteria:** met — full pipeline (detect → rewrite → verify) run over the 15-pair dataset + 10-prompt stress set (40 prompts): **zero false negatives by construction and by mutation testing** (9 hand-built tampered rewrites, all correctly rejected), **zero false positives** (all 40 genuine rewrites pass), edge cases clean. Verified in `node phase3/verify-pipeline.js` → `ALL CHECKS PASSED: 95 passed, 0 failed`.

## Brainstorm — verification approach (considered / rejected / chosen)

1. **Embedding similarity** — needs a model, and near-identical vectors can hide real drift ("3 columns" → "5 columns"). Rejected as a gate.
2. **Reverse-reconstruction as the gate** — a small local model guessing the original from the rewrite is too noisy to trust as a hard gate. Rejected as gate; **kept as opt-in advisory** (`deep-check.js`, free/local Ollama).
3. **Structured diff as a hard gate** (chosen): Phase 2's template already embeds the original verbatim and tracks everything it adds. That makes preservation *checkable by construction*: rebuild the canonical prompt from declared parts, prove the original survived, prove every addition is labeled and traceable. Free, deterministic, and every check is a hard failure rather than a similarity score.

## The hard-failure gate (`phase3/verifier.js`)

Any single failure ⇒ the rewrite MUST NOT be sent downstream (CLI exits 1; usable as a send-gate):

| Check | Catches |
|---|---|
| F1 `nonempty-original` | empty input |
| F2 `verbatim-embedding` | original text missing from the prompt |
| F3 `canonical-rebuild` | post-rewrite tampering (prompt ≠ rebuild from declared parts) |
| F4 `word-survival` | subtraction/paraphrase of user words (belt-and-braces to F2) |
| F5 `addition-trace` | silent invention — untraceable content lines, or categories the detector never fired on this prompt |
| F6 `no-removal` / F7 `no-modification` | declared removed/modified content |
| F8 `no-contradiction` | rewriter's contradiction warnings **escalated from warning to hard failure** |
| F9 `assumption-form` | assumptions smuggling imperative requirements ("must require Google sign-in") |

Non-blocking warnings: `boilerplate-only`, `high-assumption-load` (e.g., 6 assumptions on a 4-word prompt).

Output: `{ ok, hard_failures[], warnings[], diff, diff_report }` — `diff_report` is a glance-confirmable box (unchanged core requirements verbatim → labeled additions → removed → assumptions/questions → PASS/HARD FAIL verdict).

## Verification results (real output)

```
Genuine rewrites (40 = 30 dataset + 10 stress):  gate PASS 40/40, 0 false positives
Tampered rewrites (9 mutations):                 ALL rejected (0 false negatives):
  dropped-phrase, paraphrased-phrase, altered-number, smuggled-imperative,
  imperative-assumption, category-smuggling, nonempty-removed,
  nonempty-modified, injected-contradiction
Edge cases: empty (gate refuses), one-word, ~3k-word — no crashes
CLI: exit 0 on pass / 1 on hard fail; deep check (Ollama qwen2.5:3b) ran, advisory only
Regressions: phase2 verify 30/30 ok, phase1 recall 81/81 = 100%
```

One bug was caught and fixed by this verification: the word-survival tokenizer kept sentence punctuation (`"v1."`), producing 34 false positives on genuine rewrites — fixed by tokenizing words only; F2 verbatim-embedding remains the primary survival guarantee.

## Intent-match check (protocol step 4)

Does the verifier preserve the user's original intent? **Yes — that is its sole function, and it now gates the pipeline**: nothing ships unless the original is embedded verbatim, nothing was removed/modified, and every addition is a labeled, traceable assumption or question. The one verified residual risk is **labeled** drift downstream (Phase 2 A/B: 2/3 optimized sessions drifted *with* labels after a forced "best judgment" push) — a downstream-model behavior, not a rewrite defect; the verifier makes such additions visible rather than silent.

## Open risks / limitations

1. The gate verifies the **rewrite artifact**, not the downstream model's execution — Phase 4/5 outcome logging covers that layer.
2. F4/F5 are word-based heuristics; exotic paraphrase inside a *modified template* could slip past F4 (F3 canonical-rebuild still catches template drift deterministically).
3. Deep check is advisory only (3B reconstruction is noisy); it never flips the gate.
4. Contradiction checks remain shallow regexes inherited from Phase 2 — escalated to hard failures here, but the lexicon is limited.

## Coverage experiment: the gate vs the A/B drift transcripts

**Question:** how much of the A/B experiment's downstream drift would the Phase 3 gate have caught? Ran `phase3/ab-gate-coverage.js` over all 9 A/B sessions, scoring two layers (ground truth: the same `phase2/drift-judge.js` used by `analyze-ab.js`, regression-checked to reproduce the published numbers after extraction into a shared module). **Re-run on the regenerated (current-code) session batch: results identical in structure — 14/14 drift hits caught, 0 traced hits.** Numbers below are the current batch.

**Layer 1 — as-built pre-send gate on what was actually sent:** applies only to the optimized arm (only it had a rewrite artifact): **PASS** — the rewrite contained no F1–F9 violation. Raw/explicit sessions had no rewrite to verify → N/A, not failures. **All 14 observed drift hits happened downstream, where the artifact gate by design cannot see.** This is the honest coverage boundary: the gate certifies the prompt, not the executor.

**Layer 2 — gate traceability philosophy ported to transcripts:** if the "every significant word must trace to source (original + Lemonade's declared additions)" check ran on each BUILD/DONE sentence post-hoc, it would flag **14/14 = 100% of the observed drift hits** — every drifted sentence used at least one novel significant word ("multiple users", "up to 10 users", "attachments", "labels", "user management"…). A deterministic, free, post-send transcript lint would have caught every drift in this dataset.

**The polarity gap (0 hits here, still real):** drift that uses ONLY assumption-sourced words — e.g. building "login" straight from the labeled "without login" assumption — is invisible to traceability and needs a polarity check (does the transcript USE what the assumption only MENTIONED as excluded?). It did not occur in this small dataset; recorded as a Phase 3+ gap rather than claimed as solved.

**Practical implication:** traceability-based outcome checking is cheap enough (zero model calls) to become the spine of Phase 5's outcome logger — flag transcripts whose BUILD/DONE sentences contain novel requirements, and route them to correction-memory.

## How to run

```bash
node phase3/verify-pipeline.js                    # full harness (95 checks)
node phase3/verify-cli.js "<prompt>"              # rewrite + gate + diff report (exit 1 on fail)
node phase3/verify-cli.js "<prompt>" --deep       # + opt-in Ollama reverse-reconstruction advisory
node phase3/ab-gate-coverage.js                   # gate coverage over A/B transcripts
```
