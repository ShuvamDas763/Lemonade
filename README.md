# Lemonade 🍋

You type a rough idea like *"build me a habit tracker, make it feel fast"* — and the coding agent behind it has to guess the platform, stack, data model, and what "done" means. Those guesses are where silent scope invention comes from. Lemonade fixes that: it **detects** the ambiguities, **rewrites** your prompt into a structured version — your words embedded verbatim, every guess turned into a clearly labeled assumption or an open question — and **verifies** the rewrite changed nothing you actually said. Heuristics-first, free/local models only, never a mandatory paid API.

```
raw prompt → [Ambiguity Detector] → [Rewriter] → [Intent-Preservation Verifier]
           → optimized_prompt + assumptions_made[] + clarifying_questions[] + diff_report
           → (downstream LLM) → [Spec-Drift Ledger] → [Outcome Logger] → [Correction Memory] → [Feedback Loop]
```

**What that buys you in practice** (measured, not claimed — see the phase reports): raw ambiguous prompts made a real downstream model *silently invent scope* in **6/6** sessions; the same model receiving Lemonade's optimized prompt invented silently in **1/6** (labeled its drift in 3/6, stayed clean in 2/6) — and every drifted session was caught structurally by the spec-drift ledger after the fact.

## New here? Your first 5 minutes

You need Node 18.17+ and this repo — there is nothing to install (`npm install` is a no-op; zero dependencies).

**1. The Zero-Friction Daily Driver: Transparent IDE Proxy (Recommended)**

```bash
npm run proxy
```

Point **Cursor**, **Claude Code**, **Continue.dev**, or **Aider** to `http://localhost:7847/v1`:
- **In Cursor / Continue.dev:** Set `Base URL` to `http://localhost:7847/v1`.
- **In Claude Code / Aider:** Set `OPENAI_BASE_URL=http://localhost:7847/v1`.

**What happens automatically in your IDE:**
- **Context Pruning (Real Token Savings):** Stale compiler errors, 300-line stack traces, and old tool outputs from earlier turns are compacted — saving **30%–50% of tokens** in multi-turn sessions.
- **Workspace Auto-Detection:** Reads your local `package.json`, `pyproject.toml`, or `go.mod` to ground assumptions in your real stack (no blind guessing).
- **Intent Gating:** Trivial queries ("how to center a div", "regex for uuid") pass through with **0 bloat**; only greenfield/architecture requests get the full safety envelope.
- **Runtime Invariant Firewall:** Negative constraints ("no auth for v1") become hard boundary contracts; agent outputs are audited for drift.

**2. Global Hotkey Daemon (Select Text Anywhere -> Hotkey -> Paste Ready)**

```bash
npm run hotkey
```
Highlight any rough idea in **Cursor**, **Chrome**, **VS Code**, or **Slack**, and press **`Ctrl + Alt + T`**:
1. It copies the text automatically.
2. TokenTrim enriches and verifies it in milliseconds.
3. Chimes and updates your clipboard.
4. Press **`Ctrl + V`** to paste the structured prompt!

*(Prefer a universal clipboard watcher? Run `npm run clipwatch` to trigger optimization whenever you double-copy `Ctrl+C+C`!)*

**3. See it work on one prompt in terminal (30 seconds)**

```bash
npm run demo -- "build me a habit tracker with streaks, make it feel fast and look modern"
```

**4. Try terminal watch mode (interactive REPL)**

```bash
npm run watch
```

Type any idea and press Enter: the optimized prompt lands on your clipboard. Paste it into any chat.

**5. Verify the entire system on your machine**

```bash
npm test
```

Ten verification harnesses run (~a minute, no network). If every one ends in `ALL CHECKS PASSED`, everything this README claims holds on your machine.

## Non-negotiable constraints

1. **Meaning preservation** — never silently invent scope, drop requirements, or reinterpret intent. Only labeled assumptions or clarifying questions. The verifier is a hard gate: a rewrite that fails any check is never sent downstream.
2. **Cost discipline** — deterministic/heuristic logic first; model calls default to free/local (Ollama); paid APIs are opt-in only (`--yes` + key).
3. **Every phase ships runnable + verified** — code-complete ≠ done.
4. **Evidence-first** — Phase 0 tested the premise before building: ambiguity's cost showed up as clarification load and silent scope invention, not turn/token count.

## Requirements

- **Node.js ≥ 18.17** (uses built-in `fetch`, `AbortSignal.timeout`, ESM). No npm dependencies — nothing to install beyond the repo itself.
- **Optional:** [Ollama](https://ollama.com) with `ollama pull qwen2.5:3b` for the real-model A/B experiments (`phase2:ab`). Everything else is deterministic and model-free.
- **Optional, paid:** `ANTHROPIC_API_KEY` only if you explicitly run `npm run phase0:anthropic`.

## Quick start

```bash
npm test                                  # full verification battery (9 harnesses + endpoint smoke)

npm run watch                             # ⭐ daily driver: type a prompt -> optimized prompt in your clipboard
npm run watch -- "build a todo app"       # one-shot variant
npm run watch -- "build a todo app" --quiet  # status line only; paste straight from the clipboard

npm run watch -- "no attachments for v1" --ledger   # session ledger: every prompt is a message;
                                                    # contradictions print with their confirm command

cat brief.md | npm run watch              # pipe a multiline prompt through once

npm run demo -- "make me a meal planner for my family with a shopping list"
# -> Stage 1 flags | Stage 2 optimized prompt | Stage 3 intent-preservation report

npm run demo -- --loop
# -> correction-memory story: candidate held once -> promoted on repeat ->
#    auto-applied labeled -> conflict guard skips it when the prompt asks for it

npm run demo -- "build a REST API for invoices" --store data/my-profile.json
# -> same pipeline, separate memory profile per store file
```

**Watch mode** is the intended loop for daily use: type your rough idea, hit Enter, paste into Cursor/Claude Code/any agent. Every rewrite passes the Phase 3 intent-preservation gate *before* it touches the clipboard — a failed gate is reported, never copied. Learned preferences from your correction store are applied (and override generic defaults), `.clear` forgets them, and with no clipboard tool available (SSH/CI) the block is printed for manual copy instead of failing.

Add `--ledger` and watch mode becomes a *conversation*: every prompt joins the Phase 6 spec-drift ledger, so requirements you state along the way ("no attachments for v1") are remembered and contradictions ("add an attachments page") surface immediately, tagged with the exact `confirm` command if the change was intentional. `ledger show` inside the REPL lists what's recorded; the file is the same one `npm run drift` reads.

## The user journey

- **Day 1 — new user:** type a rough idea, get an ambiguity report and a structured prompt with labeled assumptions and open questions — no silent guessing. Paste the optimized prompt into any coding agent (Cursor, Claude Code, a raw LLM session); it carries your words verbatim as the source of truth.
- **Ongoing — it learns you:** when output misses ("no, use Vue, not React"), record the reply once (`npm run memory -- add "..."`). Say the same thing twice and it becomes a **standing preference**: future rewrites carry it, visibly labeled, and it *replaces* the generic default in that dimension (a Vue user no longer receives a canned "TypeScript + React" assumption — the rewriter overrides it and logs the override).
- **Always safe to disagree:** a standing preference never overrides the current prompt. Ask for a comments section while holding a "no comments" preference and the preference skips that rewrite with a logged reason — the prompt wins.
- **Everything is auditable:** `npm run memory -- list` / `forget <key>` inspects and removes what was learned; the verifier gate reports every addition and removal; the drift ledger replays any transcript against its spec.

## How to read the output

Watch and demo output uses a small fixed vocabulary:

- **flag** — one detected ambiguity: a rule id (`R1`–`R8`), the evidence that triggered it, and a severity (1–3). Flags are *information*, not errors.
- **ambiguity score** — the sum of severities: a quick "how much guessing would this prompt invite" number. There is no pass/fail threshold; a fully specified prompt scores 0 and produces zero assumptions.
- **`[ASSUMED: …]`** — a placeholder Lemonade added because you didn't specify something (stack, platform, data model, …). Instructions in the prompt tell the implementing agent to treat these as swappable defaults, not requirements. Always labeled, never silent.
- **open question** — something the system refused to guess (e.g. which part of a bundled request matters most). Answer it if you can; otherwise the optimized prompt instructs the agent to proceed conservatively and state what it chose.
- **gate PASS / FAIL** — the Phase 3 verifier re-checked the rewrite against your original text: nothing removed, nothing reworded, every addition labeled. PASS means safe to send downstream; a FAIL is reported and *never* copied to the clipboard.
- **memory applied / overrides** — which of your learned standing preferences were injected, and which generic defaults they replaced.
- **ledger msg #N** (with `--ledger`) — your prompt was also checked against requirements stated earlier in the session; contradictions print with their `confirm` command.

## FAQ for first-time users

**Do I need an API key or internet access?** No. The core pipeline is 100% local and deterministic. Models only appear in the optional A/B experiments you run explicitly.

**Does it rewrite or shorten my prompt?** No — the opposite. Your words are embedded verbatim as the source of truth, and the gate fails if anything you wrote is touched. The optimized prompt is *longer*: it adds labeled assumptions and open questions instead of letting the downstream model guess silently (measured effect: silent scope invention 6/6 → 1/6, at ~4× tokens).

**What do I do with the optimized prompt?** Paste it wherever you'd normally type your request — Cursor, Claude Code, ChatGPT, a CLI agent. It's plain markdown.

**How does it learn my preferences?** `npm run memory -- add "no, use Vue, not React"`. Said once, it's a candidate and is never auto-applied; said twice, it becomes standing and rides along (labeled) in future rewrites — while still losing to whatever your current prompt explicitly asks for.

**A flag looks wrong.** Flags are heuristics, not truth — ignore them or answer the open question in your own words; your text is untouched either way. Genuine false positives are welcome issues: the lexicon lives in `phase1/rules.json`, and `CONTRIBUTING.md` explains the verification bar for changing it.

**Where does my data live?** In `data/` inside the repo (gitignored). Delete the folder and Lemonade forgets everything; `npm run memory -- forget <key>` removes a single preference.

## Everyday commands

| Command | What it does |
|---|---|
| `npm run proxy` | **⭐ Zero-friction IDE proxy**: OpenAI-compatible `/v1` endpoint for Cursor, Claude Code, Continue.dev |
| `npm run hotkey` | **⭐ Global hotkey daemon**: Select text anywhere -> press `Ctrl+Alt+T` -> optimized prompt on clipboard |
| `npm run clipwatch` | **Smart clipboard watcher**: Select text -> tap `Ctrl+C+C` twice -> auto-optimized clipboard |
| `npm run verify:market` | Run the full market-ready verification battery (proxy, pruner, workspace, intent, firewall) |
| `npm run watch -- "<prompt>"` | **Terminal daily driver**: optimized prompt copied to your clipboard (`--quiet`, `--json`, `--no-copy`, `--store`, `--ledger`; REPL when run bare) |
| `npm run detect -- "<prompt>"` | Flag ambiguity in one prompt (rules + score + evidence) |
| `npm run rewrite -- "<prompt>"` | Structured rewrite: verbatim original + labeled assumptions + open questions |
| `npm run lint -- examples/ambiguous-prompt.md` | Inline ambiguity linter for files (`--json` for editors, `--strict` for CI gates, `--min-severity N`) |
| `npm run drift -- say "<message>"` | Feed a conversation to the spec-drift ledger (`show`, `stats`, `confirm <id>`; `--strict` gates on violations) |
| `npm run memory -- add "<user reply>"` | Record a correction (`list --standing`, `forget <key>`) |
| `npm run feedback -- record --edit "[ASSUMED: React]=>Vue"` | Log an outcome/edit-diff; learns preferences through the Phase 4 extractor |
| `npm run phase1:serve` | HTTP endpoint: `/v1/chat/completions` + `POST /detect` + `GET /health` |

## HTTP endpoint

```bash
npm run phase1:serve                      # 127.0.0.1:7847 by default
curl -s localhost:7847/health
curl -s -X POST localhost:7847/detect -H "content-type: application/json" \
  -d '{"prompt":"make me a tinder clone but for books, with a nice modern look"}'
```

- `POST /detect` takes `{ "prompt": "..." }`, returns `{ flags, ambiguity_score, flagged }`.
- Binds to **loopback by default** — it echoes prompt text back, so it must not silently expose user input on the LAN. Set `HOST=0.0.0.0` deliberately if you need otherwise; `PORT` overrides the port.
- Bodies are capped at 1 MB (413 beyond); malformed JSON or a non-string `prompt` gets a 400.

## Phase status (all evidence regenerated with current code)

| Phase | Deliverable | Status |
|---|---|---|
| 0 | Ambiguity-Cost Profiler | ✅ **done, real data** (qwen2.5:3b via Ollama, 30 sessions): ambiguity did **not** raise session turns/tokens (1.11× / 0.68×); its cost showed up as clarification load + silent scope invention. See `phase0/PHASE0_REPORT.md` |
| 1 | Ambiguity Detector (rule engine) | ✅ **done** — 8 rules, 100% planted-recall (81/81) / 0 FP on the dataset, 26/26 on an out-of-dataset stress set, `detect()` + CLI + `POST /detect`. See `phase1/PHASE1_REPORT.md` |
| 2 | Rewriter Engine | ✅ **done** — template-based, original embedded verbatim, labeled assumptions + open questions only, 30/30 checks; **downstream A/B on real Ollama sessions**: silent scope drift 6/6 (raw) → **1/6 pooled** (optimized, 3/6 labeled + 2/6 clean), at ~4× token cost. See `phase2/PHASE2_REPORT.md` |
| 3 | Intent-Preservation Verifier | ✅ **done** — 9-check hard-failure gate (verbatim embedding, canonical rebuild, word survival, addition traceability, no removal/modification, contradiction escalation, assumption-form), human-readable diff report, CLI send-gate; 95/0 harness incl. 9-mutation battery; coverage experiment: pre-send gate PASS, post-hoc traceability flags 14/14 drift hits. See `phase3/PHASE3_REPORT.md` |
| 4 | Correction-Memory Layer | ✅ **done** — deterministic correction extraction, JSON store, `candidate → standing (≥2×) → stale` promotion, labeled `[USER PREFERENCE]` injection, conflict guard (prompt outranks preference); 21/0 harness. See `phase4/PHASE4_REPORT.md` |
| 5 | Feedback Loop | ✅ **done** — outcome store (`accepted/edited/rejected` + edit diffs), rolling per-rule hit-rate scoring (`provisional/healthy/watch/flagged`, MIN_OBSERVATIONS=8), periodic report with recommendations (never auto-removal), edit-diff learning into correction memory; 23/0 harness. See `phase5/PHASE5_REPORT.md` |
| 6 | Extensions | ✅ **done** — inline linter (`detectSpans()`, caret highlights, `--json`, `--strict`; 90/0), spec-drift ledger (requirements ledger, contradiction flagging, supersession markers, confirm flow; 32/0), and ledger wired into real A/B sessions with role-based trust + drift routed into correction memory under the over-fit guard (25/0). See `phase6/PHASE6_REPORT.md` |

## Security & privacy notes

- **No network by default.** The entire pipeline is deterministic and offline. The only code that talks to a model is the optional Ollama backends (localhost) and the explicitly opt-in Anthropic backend (requires `--yes` and `ANTHROPIC_API_KEY`).
- **No telemetry, no dependencies.** `npm install` is a no-op; there is no supply chain to audit.
- **Local data stays local.** Correction memory, outcome stores, and ledger state live under `data/` (gitignored). Delete the directory to forget everything — or `npm run memory -- forget <key>` for surgical removal.
- **The endpoint is loopback-only by default** and reflects input back in responses; keep it that way unless you have a reason.
- **Secrets never touch the repo.** `.env` is gitignored; provide `ANTHROPIC_API_KEY` through your environment.

## Layout

```
phase0/   Ambiguity-Cost Profiler: prompts.dataset.json (15 paired prompts),
          patterns.taxonomy.json (shared taxonomy), backends/ (simulated|ollama|anthropic),
          run-phase0.js orchestrator, PHASE0_REPORT.md
phase1/   Ambiguity Detector: rules.json (8 rules), detector.js (detect + detectSpans),
          detect-cli.js, server.js (POST /detect), stress sets, verify-detector.js
phase2/   Rewriter: rewriter.js, rewrite-cli.js, llm-fallback.js (optional, off),
          A/B harness (ab-kanban.js, analyze-ab.js, ab-ledger.js, drift-judge.js)
phase3/   Intent-Preservation Verifier: verifier.js (9-check hard gate), verify-cli.js,
          ab-gate-coverage.js (post-hoc traceability over A/B transcripts)
phase4/   Correction Memory: corrections.js (extraction + store + promotion), memory-cli.js
phase5/   Feedback Loop: feedback.js (outcome store + rolling rule scoring), feedback-cli.js
phase6/   Extensions: lint-cli.js (inline linter), ledger.js + drift-cli.js (spec drift),
          ab-wiring.js (ledger ↔ A/B ↔ memory integration)
demo/     end-to-end.js — the full pipeline on any prompt (npm run demo)
          watch.js + clipboard.js — watch mode: prompts straight to your clipboard (npm run watch)
examples/ sample inputs for the linter and drift CLI
phase*/PHASE*_REPORT.md — the written evidence per phase (committed; raw results/ are not)
```

## Known limitations (honest)

- **Heuristics are English-only** and lexical: semantic drift with zero word overlap ("no auth" → "JWT sessions") is invisible to the ledger; regex extraction misses some correction phrasings (documented per phase).
- **The A/B result is a small-sample measurement of a stochastic 3B model**, not a guarantee: the rewrite *reduces and labels* silent invention (1/6 vs 6/6 pooled), it cannot force zero — which is exactly why the verifier gate and spec-drift ledger exist behind it.
- **Multi-flag attribution is coarse**: an "edited" outcome debits every rule that fired on that rewrite.
- **Feedback thresholds** (healthy/watch/flagged) await real acceptance data; they are calibrated defaults, not empirically tuned values.
- `npm test` verifies all deterministic layers; the Ollama A/B experiments are separate (`npm run phase2:ab`) because they need a running model server.

## License

MIT — see [LICENSE](LICENSE).
