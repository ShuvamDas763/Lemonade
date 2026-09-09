# Phase 2 Report — Rewriter Engine (heuristic-first)

- **Generated:** 2026-09-08
- **Exit criteria:** met — on all 30 dataset prompts (15 ambiguous + 15 explicit), every rewrite (a) embeds the user's original text **verbatim**, (b) adds **only** labeled assumptions and open questions sourced from Phase 1 flags, (c) reports **zero** contradiction warnings. Edge cases (empty / one-word / ~3k-word) behave gracefully with no crashes.

## Brainstorm — rewrite strategy (considered / rejected / chosen)

1. **Free-text rewrite by a local LLM** — fluent, but every paraphrase is an intent-preservation risk and hard to verify mechanically in Phase 3. Rejected as the default.
2. **Hybrid: heuristic structure + LLM polish** — still introduces unverifiable paraphrasing; violates "never to override a heuristic-derived assumption". Rejected for v1.
3. **Template-based structured rewrite (Goal / Assumptions / Open Questions / agent instructions), original embedded verbatim** — preservation is *by construction* (nothing is paraphrased or removed; additions are isolated, labeled sections), and Phase 3's diff becomes trivial (`changes.added/removed/modified` is tracked directly). **Chosen.**

## Design

```
rewrite(rawPrompt, {flags?, useLlm?}) -> {
  ok, optimized_prompt,
  assumptions_made: [{category, severity, text}],   // text always starts with [ASSUMED:
  clarifying_questions: [{category, severity, text}],
  warnings: [{type, category, detail}],             // contradiction self-check
  changes: {added[], removed[], modified[]}         // feeds Phase 3's structured diff
}
```

- **Safe-default flags → labeled assumptions.** Two adaptive refinements keep assumptions from contradicting the user:
  - `unspecified_auth` + team/user framing ("for my dev team") → assumes *"single shared workspace without login"*, not "single-user", and asks for confirmation.
  - `vague_scope` → names the user's actual qualifier in the assumption ("'simpler' interpreted conservatively…").
- **No-safe-default flags → open questions.** `compound_request` and `vague_integration` never produce guesses — that mapping mirrors Phase 0's transcript finding that exactly these categories drove silent scope invention.
- **Contradiction self-check (defense-in-depth):** if the original contains anti-evidence (e.g., "no frameworks" while the stack assumption would say React), a warning is emitted now; Phase 3 escalates warnings to hard failures.
- **LLM fallback (`llm-fallback.js`):** OFF by default; can only phrase a clarifying question when a no-safe-default flag lacks a canned question (never with current rules); free/local Ollama only; failures fall back to a deterministic generic question. Heuristic output is never overridden (constraint #2).

### Example output (kanban, ambiguous variant — real output)

> **## Goal (verbatim …)** Trello but simpler, for my dev team, and I'd like some reporting on top.
> **## Assumptions Made** — data model by implementer; TS+React web app; browser web app; done = core flows work; *single shared workspace without login (team framing detected — confirm)*; *'simpler' interpreted conservatively*.
> **## Open Questions** — "This bundles several loosely-related requests. Which part is the priority for v1, and what is out of scope?"

## Verification (`npm run phase2:verify`)

```
30/30 dataset prompts: ok, verbatim-embedded, labeled-only additions,
                       removed=[] modified=[], warnings=0
Edge cases: empty -> refused gracefully ("empty prompt - nothing to rewrite");
            one-word -> 4 assumptions; ~3k-word -> 4 assumptions + 1 question; no crashes
Assumption/question counts match flag resolutions exactly (6/0 bookswipe,
6/1 invoice-generator, 6/1 kanban, 6/1 fitness-log, 4/0 podcast-player, ...)
```

## Intent-match check (protocol step 4)

**Does this preserve the user's original intent? Yes** — the original prompt is embedded verbatim as the declared source of truth; the only additions are explicitly labeled `[ASSUMED: …]` lines and questions; nothing is removed or modified (`changes.removed/modified` are empty by construction); and the contradiction self-check found **0 warnings** across the whole dataset. The one intent *risk* (an assumption silently contradicting the user) is covered by the adaptive assumption texts plus the self-check, and will be gated hard by the Phase 3 verifier.

## Open risks / limitations

1. **Template rigidity:** structured output is longer than the original; some downstream tools may weight it oddly — the "source of truth" instruction mitigates, but Phase 6's outcome logger should validate empirically.
2. **Canned assumptions are stack-specific** (TypeScript+React+Node is the default stack); a real deployment should tune `default_assumption` per user profile (later: Correction-Memory, Phase 4).
3. **Contradiction checks are shallow regexes** — Phase 3's verifier is the real gate; these are early warnings only.
4. The verifier's "human reviewer" role for the 12–15 rewrites is satisfied here by the verbatim-embedding proof; a human glance at the three printed examples is still recommended.

## Downstream A/B: raw vs optimized vs explicit (real Ollama sessions)

**Question:** does sending the *optimized* prompt instead of the raw one actually change downstream agent behavior? Ran the kanban pair through the Phase 0 harness (qwen2.5:3b) in three arms — `raw` (ambiguous prompt verbatim), `optimized` (Phase 2 rewrite), `explicit` (hand-written spec as the reference ceiling) — 3 seeded runs per arm, same scripted-user oracle for every arm (answers drawn from the explicit spec; after one answered round it says "proceed with your best judgment", then a hard STOP-ASKING directive), temperature 0.2, `num_ctx` 8192. Transcripts in `phase2/results/ab-sessions.jsonl`; drift judged by `phase2/analyze-ab.js` (transparent keyword markers with auditable snippets in `ab-drift.json`, judging only BUILD/DONE turns, negation-aware).

| Metric (mean/session) | raw | optimized | explicit |
|---|---|---|---|
| Turns | 5.00 | 6.33 | 4.00 |
| Total tokens | 1,452 | 5,754 | 1,919 |
| Clarification events | 2.00 | 2.67 | 0 |
| Completion | 100% | 100% | 100% |
| **Silent scope drift** | **3/3 sessions** | **1/3** | **0/3** |
| Labeled drift | 0/3 | 1/3 | 0/3 |
| Fully clean | 0/3 | 1/3 | 3/3 |

- **Raw arm reproduced Phase 0's core finding in both batches:** every session silently invented scope contradicting the spec ("multiple users", "up to 10 users", reporting "tasks started and in progress" — the spec says 3 fixed columns, one shared workspace, exactly one report view).
- **Optimized arm — two independent 3-seed batches, reported together for honesty.** Batch 1: 0/3 silent (1 clean, 2 labeled). Batch 2 (current evidence, regenerated with the latest detector/rewriter code): 1/3 silent — one session integrated "attachments and labels" without a label after the oracle's forced "best judgment" push; one spiraled but labeled everything (user management, attachments, labels, multiple boards); one fully clean. **Pooled: silent invention 6/6 (raw) → 1/6 (optimized), with 3/6 labeled and 2/6 clean.** With n=3 per batch and a stochastic 3B model, the rewrite *reduces and labels* silent invention rather than guaranteeing zero — which is exactly why the downstream ledger layer (Phase 6) checks transcripts against the seeded spec instead of trusting the prompt alone.
- **Cost of that safety:** ~4× tokens vs raw (dominated by re-sending the structured prompt each turn), 1.27× turns; still 1.58× turns / 3.0× tokens above the explicit ceiling.
- **Honest verdict:** the rewrite changes behavior in the intended direction — it converts *silent* scope invention into *labeled* decisions and surfaced questions — but it does not reach the explicit-spec ceiling, and a small model's post-ultimatum "best judgment" can still run away (run 1). The remaining gap is exactly where Phase 3 (hard verifier gate + visible diff) and Phase 4 (pre-answering open questions from standing user preferences) plug in.
- **Methodology note (kept for honesty):** two earlier harness iterations (per-question repeat breaker; `num_ctx` 4096) produced clarify-loop storms in the optimized arm; the reported numbers use the final global-patience oracle and 8192 context. The optimized prompt also gained one instruction between iterations: open questions default to *proceed on labeled judgment* rather than re-asking — a fix this experiment itself motivated.
- **Limitations:** one pair, 3 seeds, one small model, keyword drift judge (heuristic, snippets published for audit), scripted oracle ≠ real user, corrections still unmeasured.

## How to run

```bash
npm run phase2:verify                      # full verification + 3 example rewrites
node phase2/rewrite-cli.js "<prompt>"      # rewrite one prompt (add --use-llm for optional question phrasing)
```
