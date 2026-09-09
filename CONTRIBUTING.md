# Lemonade — contributing

Thanks for looking at Lemonade. The project has four non-negotiable constraints; every contribution is judged against them:

1. **Meaning preservation** — never silently invent scope, drop requirements, or reinterpret user intent. Only labeled assumptions or clarifying questions.
2. **Cost discipline** — deterministic/heuristic logic first; model calls default to free/local (Ollama); paid APIs are opt-in only.
3. **Every phase ships runnable + verified** — code-complete ≠ done.
4. **Evidence-first** — claims need measured evidence in the relevant `phase*/PHASE*_REPORT.md`, not adjectives.

## Ground rules

- **Zero runtime dependencies.** Node standard library only. If you genuinely need a package, argue for it in the PR — the default is no.
- **Node ≥ 18.17, ESM** (`"type": "module"`). Match the existing style: small focused modules, deterministic by default, explicit comments where behavior is subtle (trust models, key canonicalization, echo hygiene).
- **Every verification harness must stay green.** Run before you push:

  ```bash
  npm test        # all 8 harnesses + endpoint smoke
  ```

- **New behavior needs a check.** If you add a rule, pattern, conflict type, or CLI mode, extend the corresponding `verify-*.js` harness — including a case that *fails* without your change. Plant ground truth; don't tune to pass.
- **Detector changes must not regress recall/FP.** The bar: 100% planted recall on `phase1/prompts.dataset.json` + `phase1/stress-prompts.json`, 0 false positives on the explicit side. If your lexicon change helps one case, prove it didn't break the other 100+.
- **Keep evidence honest.** When re-running experiments (A/B sessions, stress sets), report less-flattering batches, keep both batches in the reports, and never update a number without re-running its harness.

## Repo hygiene

- Runtime state (`data/`, `phase*/results/`) is gitignored — never commit it; reports carry the distilled numbers.
- Never commit `.env`, API keys, or the `.freebuff/` workspace directory.
- Deterministic output preferred over timestamps where possible so diffs stay meaningful.

## Where things live

See the Layout section in `README.md`. When touching a cross-cutting config (e.g. `phase1/rules.json` feeds the detector, rewriter, and linter), re-run **all** harnesses, not just the one you edited.
