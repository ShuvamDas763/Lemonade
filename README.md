# Lemonade 🍋
### Local-First Specification Integrity Platform for AI-Assisted Software Development

> **Core Product Thesis:**  
> Lemonade is **not merely a prompt rewriter**. It is an agent-independent **specification integrity platform**. It transforms raw ideas into living project specifications, exposes ambiguity, prevents silent requirement invention or loss, asks high-impact clarification questions, tracks implementation drift over time, and verifies whether downstream coding agents stay strictly aligned with accepted requirements.

```
┌─────────────────┐       ┌────────────────────────┐       ┌────────────────────────┐
│  Raw User Idea  │ ────► │  Ambiguity Detector    │ ────► │  Living Spec Model     │
└─────────────────┘       │  (8 Deterministic Rules│       │  (ProjectSpec Core)    │
                          └────────────────────────┘       └───────────┬────────────┘
                                                                       │
           ┌───────────────────────────────────────────────────────────┴───────────────────────┐
           ▼                                                           ▼                       ▼
┌──────────────────────┐                                    ┌──────────────────────┐  ┌──────────────────────┐
│ Four-Dimension Gate  │                                    │  Control Room Web UI │  │ Multi-Mode Exporters │
│ A: Preservation      │                                    │  • Provenance Cards  │  │ • agent (compact)    │
│ B: Interpretation    │                                    │  • Ranked Queue      │  │ • builder (detailed) │
│ C: Safety & Risk     │                                    │  • Decision Timeline │  │ • minimal / audit    │
│ D: Completeness      │                                    │  • Drift Ledger      │  │ • structured json    │
└──────────┬───────────┘                                    └──────────────────────┘  └──────────┬───────────┘
           ▼                                                                                     ▼
┌──────────────────────┐                                                              ┌──────────────────────┐
│ Intent Verification  │ ◄────────────────────────────────────────────────────────────┤ Transparent Proxy    │
│ (Zero-Tamper Gate)   │                                                              │ (Cursor/Claude/Aider)│
└──────────────────────┘                                                              └──────────────────────┘
```

---

## What Problem Lemonade Solves

When developers pass ambiguous prompts to AI coding assistants (Cursor, Claude Code, Aider, Copilot), the model silently invents missing details:
- It assumes a single-user architecture when team collaboration was needed.
- It silently invents third-party integrations (Stripe, SMTP, Mailgun) that were never requested.
- It loses negative constraints (*"no login for v1"*, *"pickup only"*) across multi-turn chats.
- It forgets earlier requirements when new instructions arrive.

**Lemonade enforces specification integrity by construction:**
1. **Verbatim User Authority:** User-stated text is the non-negotiable source of truth. Lemonade never reinterprets, paraphrases, or drops user intent.
2. **Strict Provenance Hierarchy:**
   - `user-stated`: Binding requirements extracted directly from user text.
   - `inferred`: Necessary assumptions labeled visibly with `[ASSUMED: ...]`.
   - `system-recommended`: Optional domain best-practices (non-binding).
   - `model-guess`: Strictly non-binding; never silently promoted without explicit user confirmation.
3. **Four-Dimension Validation:** Passes textual preservation, semantic interpretation, risk safety, and completeness.
4. **Drift Ledger with Evidence Linking:** Tracks requirements across turns, detects contradictions, and links implementation evidence (files, tests, commits).
5. **Zero External Dependencies:** Built entirely with Node.js built-ins. Local-first, loopback-only (`127.0.0.1`), zero telemetry, zero mandatory API keys.

---

## Quick Start (30 Seconds)

Requires **Node.js ≥ 18.17**. Zero `npm install` needed.

### 1. Launch the Local Engineering Control Room (Web UI)
```bash
npm run ui
```
Opens the dark-themed **Specification Control Room** on `http://127.0.0.1:7890`:
- **Real-Time Ambiguity Highlighting:** Live detection of unstated stacks, missing data models, unspecified auth, and scope vagueness.
- **Requirement Cards:** Visual provenance indicators (`user-stated`, `inferred`, `system-recommended`, `model-guess`), confidence bars, and priority badges (`MUST`, `SHOULD`, `COULD`, `WONT`).
- **Interactive Decision Controls:** Accept (`a`), Reject (`r`), Edit (`e`), Defer (`d`), or navigate with `j`/`k`.
- **Clarification Queue:** Open questions ranked strictly by **Ambiguity Severity × Implementation Impact × Reversibility Cost**.
- **Implementation Drift Ledger:** Real-time coverage bars, contradiction flags, and evidence links.

### 2. Transparent IDE Proxy (Cursor, Claude Code, Continue.dev, Aider)
```bash
npm run proxy
```
Point your IDE to `http://localhost:7847/v1`:
- **Cursor / Continue.dev:** Set `Base URL` to `http://localhost:7847/v1`.
- **Claude Code / Aider:** Set `OPENAI_BASE_URL=http://localhost:7847/v1`.

**What the proxy does automatically:**
- **Multi-Turn Pruner:** Compacts stale compiler errors, old stack traces, and verbose tool outputs, saving **30%–50% of tokens**.
- **Workspace Grounding:** Inspects local `package.json`, `pyproject.toml`, or `go.mod` to ground tech stack assumptions.
- **Intent Gating:** Trivial snippets (*"how to center a div"*) pass through untouched; architecture requests get the full integrity envelope.
- **Invariant Firewall:** Blocks unauthorized auth/payment inventions before code is written.

### 3. Clipboard Hotkey Daemon
```bash
npm run hotkey
```
Select any rough idea in any app and press **`Ctrl + Alt + T`** (or run `npm run clipwatch` for `Ctrl+C+C` watch):
- The prompt is enriched, checked against the specification gate, and copied back to your clipboard ready to paste (`Ctrl+V`).

### 4. Terminal Watch Mode / REPL
```bash
npm run watch
# or one-shot:
npm run watch -- "build a markdown note taker with tagging and search"
```

---

## Output Modes

Lemonade supports six output modes for different stages of the development lifecycle:

| Mode | Purpose | Format |
|---|---|---|
| `agent` *(default)* | Compact, high-signal instruction prompt optimized for AI coding agents | Markdown |
| `builder` | Complete software architecture specification with entities, workflows, and acceptance criteria | Markdown |
| `minimal` | Compact goal, must-build requirements, and labeled assumptions only | Markdown |
| `audit` | Comprehensive audit report with provenance breakdown, retention scores, and risk flags | Markdown |
| `json` | Canonical `ProjectSpec` object with item IDs, source spans, and decision history | JSON |
| `interactive` | Surfaces living spec and top-N ranked clarification questions without safe defaults | Markdown + Queue |

---

## The Four Validation Dimensions

Lemonade refuses to mark a rewrite as "valid" simply because words were preserved. A specification must pass all four independent dimensions:

```
                      ┌────────────────────────────────┐
                      │  Composite Validation Gate     │
                      └──────────────┬─────────────────┘
                                     │
         ┌───────────────────┬───────┴───────────┬───────────────────┐
         ▼                   ▼                   ▼                   ▼
┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐
│  Dimension A    │ │  Dimension B    │ │  Dimension C    │ │  Dimension D    │
│  Preservation   │ │  Interpretation │ │  Safety & Risk  │ │  Completeness   │
├─────────────────┤ ├─────────────────┤ ├─────────────────┤ ├─────────────────┤
│ • 95%+ word     │ │ • Actor mapping │ │ • Auth gaps on  │ │ • Actors missing│
│   survival      │ │ • Action verbs  │ │   multi-user    │   permissions     │
│ • Source-span   │ │ • Negative      │ │ • Privacy leaks │ • Entities without│
│   coverage      │ │   constraints   │ │ • Invented pay- │   storage scheme  │
│ • Verbatim user │ │ • Conditional   │ │   ment gateways │ • Unresolved gaps │
│   goal embedded │ │   branching     │ │ • Irreversible  │   surfaced as     │
│ • Zero unautho- │ │                 │ │   architecture  │   open questions  │
│   rized removals│ │                 │ │                 │                   │
└─────────────────┘ └─────────────────┘ └─────────────────┘ └─────────────────┘
```

---

## Verification & Quality Gates

Run the entire verification battery across all 14 test suites:
```bash
npm test
```

### Verification Suites

| Test Suite | File | Checks | Status |
|---|---|---|---|
| Phase 1: Ambiguity Detector | `phase1/verify-detector.js` | 81/81 recall | ✅ PASS |
| Phase 2: Rewriter & Optimizer | `phase2/verify-rewriter.js` | 30/30 | ✅ PASS |
| Phase 3: Pipeline & Gate | `phase3/verify-pipeline.js` | 96/96 | ✅ PASS |
| Phase 4: Correction Memory | `phase4/verify-memory.js` | 21/21 | ✅ PASS |
| Phase 5: Feedback Loop | `phase5/verify-feedback.js` | 23/23 | ✅ PASS |
| Phase 6: Drift & Linter | `phase6/verify-drift.js` | 32/32 | ✅ PASS |
| Phase 6: Firewall Wiring | `phase6/verify-ab-wiring.js` | 25/25 | ✅ PASS |
| Watch & Clipboard Engine | `demo/verify-watch.js` | 5/5 | ✅ PASS |
| Market-Ready Suite | `test/verify-market-ready.js` | 33/33 | ✅ PASS |
| Cross-Contamination Guard | `test/verify-cross-contamination.js` | 10/10 runs | ✅ PASS |
| Boundary & Contradiction | `test/verify-boundaries.js` | 25/25 | ✅ PASS |
| Canonical Spec Model | `test/verify-spec-model.js` | 24/24 | ✅ PASS |
| Four-Dimension Validation | `test/verify-validation.js` | 12/12 | ✅ PASS |
| Adversarial & Injection | `test/verify-adversarial.js` | 30/30 | ✅ PASS |
| Web UI & REST API | `test/verify-ui.js` | 19/19 | ✅ PASS |
| 10-Domain Benchmark Corpus | `test/corpus/run-corpus.js` | 51/51 | ✅ PASS |

**Total: 500+ automated checks, 0 failures.**

---

## Evaluation Benchmark Corpus

The evaluation benchmark (`test/corpus/benchmark.json`) tests Lemonade against 10 novel domains never used during template training:
1. **SaaS / B2B:** Multi-tenant customer feedback portal with SSO and tenant data isolation.
2. **E-Commerce:** Indie digital audio download store with preview streams and expiring URLs.
3. **Healthcare:** HIPAA-compliant patient appointment portal with encrypted notes.
4. **Developer Tools:** Conventional commit message CLI linter.
5. **Gaming:** Real-time arcade score leaderboard with anti-cheat thresholds.
6. **IoT / Hardware:** Smart greenhouse sensor telemetry with threshold alerts.
7. **Fintech:** Personal expense and federal tax deduction tracker with SQLite storage.
8. **EdTech:** University peer tutoring matcher with course-code algorithm.
9. **Internal Tools:** Office hardware checkout inventory management.
10. **Data Systems:** HTTP webhook ingest and append-only event relay.

Run the benchmark runner:
```bash
npm run verify:corpus
```

---

## Architectural Principles & Guarantees

1. **Local-First & Privacy-Locked:** All processing happens locally on your machine. Server binds to `127.0.0.1` only. No telemetry, no third-party cloud dependencies.
2. **Deterministic-First:** Parsing, extraction, diffing, validation, and firewalling run via deterministic heuristic engines with zero latency and zero token cost.
3. **Optional Local-LLM Acceleration:** Free local models via Ollama (`qwen2.5:3b`) can optionally rephrase clarifying questions, but can **never override heuristic safety gates**.
4. **Immutable User Goal:** The user's goal statement is preserved verbatim as the anchor of the specification.
5. **No Blind Decisions:** Ambiguities without safe defaults are surfaced as impact-ranked questions rather than silently guessed.

---

## License

MIT © Lemonade Contributors.
