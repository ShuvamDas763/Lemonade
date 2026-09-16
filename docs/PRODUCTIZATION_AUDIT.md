# Lemonade: Productization & Architecture Audit

**Target Repository:** `ShuvamDas763/Lemonade`  
**Evaluation Date:** September 2026  
**Runtime Environment:** Node.js v24.18.1 (Native ESM, zero runtime npm dependencies)  
**Positioning Paradigm:** The Intent Integrity Layer between a Human Request and an AI Execution System.

---

## Executive Summary

Lemonade has a remarkably strong deterministic safety foundation: verbatim original prompt preservation, word-survival verification, explicit assumption form requirements, an intent gate, correction memory, and a spec-drift ledger.

However, the codebase was originally structured as sequential phase prototypes (`phase1` through `phase6`) and a dense demonstration dashboard rather than a coherent application platform. Crucially, the repository contained a divergence between its **trustworthy integrity engine** and a **heuristic-heavy optimizer layer** that silently invented scope through hardcoded domain templates.

This audit maps all existing modules, diagnoses the critical vulnerabilities, and defines the structural refactoring required to transform Lemonade into a production-grade, proof-carrying intent compiler.

---

## 1. Module Classification Matrix

Every file in the repository is mapped to its operational role:

| Module Path | Primary Classification | Status / Assessment |
|---|---|---|
| `phase1/detector.js` | **Trusted Core** | Deterministic lexical ambiguity detector (81/81 recall on planted patterns). English-only, regex-based baseline. |
| `phase1/intent-gate.js` | **Trusted Core** | Prevents bloat on trivial lookups, syntax queries, and lightweight edits. |
| `phase1/rules.json` | **Trusted Core** | Declarative ambiguity rules and severity weights. |
| `phase1/server.js` | **API Integration** | Local HTTP server exposing `/detect` and `/v1/chat/completions`. Requires CORS hardening and loopback auth guards. |
| `phase1/proxy.js` | **API Integration** | OpenAI-compatible proxy with context pruning and workspace injection. Needs self-loop protection. |
| `phase2/rewriter.js` | **Trusted Core** | Embeds original prompt as source of truth, formats assumptions, open questions, and rules. |
| `phase2/optimizer.js` | **Experimental Heuristic** | **High Risk (P0)**: Contained hardcoded domain templates (Library, Canteen, Lost & Found, Study, Expense) that directly synthesized requirements. Must be decoupled into proposal plugins. |
| `phase2/pruner.js` | **Trusted Core** | Compresses historical error traces and tool outputs in multi-turn contexts. |
| `phase2/workspace.js` | **Trusted Core** | Zero-dependency local environment detection (`package.json`, `pyproject.toml`, `go.mod`). |
| `phase3/verifier.js` | **Trusted Core** | Core verifier: verbatim embedding, canonical rebuild, word survival, addition traceability, and contradiction detection. |
| `phase4/corrections.js` | **Trusted Core** | Candidate $\rightarrow$ Standing $\rightarrow$ Stale preference lifecycle. Protects against single-turn overfitting. |
| `phase5/feedback.js` | **Trusted Core** | Rolling acceptance/rejection statistics for rules. Useful instrumentation foundation. |
| `phase6/ledger.js` | **Trusted Core** | Spec-drift ledger tracking supersessions and unmarked contradictions across sessions. |
| `phase6/firewall.js` | **Trusted Core** | Invariant boundary enforcement for agent turns. |
| `src/spec/model.js` | **Trusted Core** | Canonical data model (`ProjectSpec`, `SpecItem`) with provenance, confidence, reversibility, and impact. |
| `src/spec/extractor.js` | **Trusted Core** | Domain-independent Actor-Action-Object-Condition-Result extractor with source character spans. |
| `src/spec/exporter.js` | **Trusted Core** | Exports `ProjectSpec` to Markdown, Agent Prompts, JSON, and Audit Reports. Implements rules 3.1–3.6. |
| `src/spec/scoring.js` | **Trusted Core** | 5-Axis Quality Scoring (Clarity, Completeness, Efficiency, Scope Control, Verifiability) and Quota Economics. |
| `src/validation/validate.js`| **Trusted Core** | 4D validation engine (Preservation, Interpretation, Safety & Risk, Completeness). |
| `src/domains/registry.js` | **Trusted Core** | Plugin registration and non-binding proposal dispatch interface. |
| `src/domains/college-apps.js`| **Experimental Heuristic** | Domain recommendations for college workflows. Emits `system-recommended` items. |
| `src/domains/finance.js` | **Experimental Heuristic** | Domain recommendations for financial/expense workflows. |
| `src/ui/server.js` | **UI / Application Layer** | Local REST API and static server. Needed body size limits, atomic writes, and restart hydration. |
| `src/ui/public/index.html`| **UI-only Behavior** | Frontend markup. Needed removal of external fonts and 3-column clutter reduction. |
| `src/ui/public/app.js` | **UI-only Behavior** | Frontend application logic. Contained XSS vectors (`innerHTML`) and first-run auto-execution. |
| `src/ui/public/styles.css` | **UI-only Behavior** | CSS presentation layer. Refined to calm, editorial developer tool aesthetic. |
| `test/*` | **Test-only Behavior** | Comprehensive test suites: adversarial, boundaries, cross-contamination, market-ready, UI, and optimizer rules. |

---

## 2. Identified Vulnerabilities & Technical Debt

### P0: Semantic Optimizer Inventions (`phase2/optimizer.js`)
- **Diagnosis:** The optimizer contained hardcoded detectors (`isLostFound`, `isLibrary`, etc.) that directly injected pre-scripted requirement entities (e.g. `REQ-LF-01` through `REQ-LF-06`) and boundary rules into `extracted.v1Requirements` and `extracted.boundaries`.
- **Impact:** If a user asked for a "simple lost and found board", the system automatically injected authentication, admin moderation, claim blocking, and photo uploads as binding requirements, directly violating Lemonade's core principle: *Never silently invent scope*.
- **Remediation:** Ground all extracted requirements strictly in user statements. Convert unstated domain workflows into non-binding proposals (`system-recommended`, `requiresApproval: true`).

### P0: Frontend Cross-Site Scripting (`src/ui/public/app.js`)
- **Diagnosis:** Unescaped dynamic interpolation into `innerHTML` for `item.text`, `item.category`, `f.resolution`, `q.text`, `e.phrase`, and validation messages, coupled with inline `onclick` handlers.
- **Impact:** Any user prompt or third-party spec containing `<script>`, `<img>` error handlers, or HTML tags could execute arbitrary JavaScript in the user's browser context.
- **Remediation:** Implement strict `escapeHtml()` sanitization, replace dynamic HTML interpolation with safe text bindings where practical, remove inline event handler attributes, and enforce a strict Content Security Policy (`CSP`).

### P0: Server Restart Persistence & Spec Hydration Gap (`src/ui/server.js`)
- **Diagnosis:** Active specifications lived solely in an in-memory `Map`. On disk, specs were written as raw JSON. `GET /api/spec/:id` loaded raw JSON, but `PUT /api/spec/:id/item/:itemId`, `POST /api/spec/:id/question/:qid/answer`, and `POST /api/spec/:id/export` only looked up in `activeSpecs`.
- **Impact:** After any server restart or process crash, previously saved specifications could not be updated, questions could not be answered, and exports failed with `404 Not Found`.
- **Remediation:** Introduce a persistent `SpecRepository` abstraction with atomic disk writes (`.tmp` write followed by `fs.renameSync`) and automatic `ProjectSpec.fromJSON()` hydration on read.

### P0: Unbounded Request Body Parsing (`src/ui/server.js`)
- **Diagnosis:** `parseBody()` accumulated raw request stream chunks indefinitely without byte accounting.
- **Impact:** Vulnerable to memory exhaustion / heap out-of-memory denial of service from oversized payloads.
- **Remediation:** Cap incoming request streams at 1MB, immediately destroying the connection and returning `413 Payload Too Large` when exceeded.

### P1: Negative Constraint Overreach (`src/spec/exporter.js`)
- **Diagnosis:** The exporter automatically generated hard prohibitions: `"DO NOT implement user authentication, login screens, or multi-user accounts for V1"` whenever authentication was not mentioned in the prompt.
- **Impact:** Absence of a feature is not proof of an explicit negative prohibition. It risked confusing agents when downstream systems actually needed auth.
- **Remediation:** Convert unmentioned infrastructure into visible labeled assumptions: `[ASSUMED: authentication is not defined; defaulting to single-user local execution for this draft]` unless explicitly forbidden by the user.

### P1: First-Run UI Overwhelm & External CDN Dependencies
- **Diagnosis:** The UI automatically loaded and ran a SaaS prompt on first load, presented 14+ simultaneous diagnostic panels, and pulled fonts from Google Fonts CDNs.
- **Impact:** Degraded offline reliability and created a cluttered "demo dashboard" experience rather than a clean, professional intent workspace.
- **Remediation:** Replace with an empty-canvas **Capture $\rightarrow$ Decide $\rightarrow$ Compile** flow, switch to high-contrast native system typography, and move metrics to an on-demand collapsible Audit Drawer.

---

## 3. Baseline Verification Suite Results

Verified on Node.js v24.18.1 in the execution environment:

| Test Suite | Command | Result | Pass / Fail |
|---|---|---|---|
| Phase 1 Detector | `node phase1/verify-detector.js` | 81/81 planted patterns flagged (100% recall), 0 false positives | **PASS** |
| Phase 2 Rewriter | `node phase2/verify-rewriter.js` | 30/30 checks passed, all edge cases handled | **PASS** |
| Phase 3 Verifier | `node phase3/verify-pipeline.js` | Verification gate passed across test prompts | **PASS** |
| Phase 4 Memory | `node phase4/verify-memory.js` | Memory preference lifecycle verified | **PASS** |
| Phase 5 Feedback | `node phase5/verify-feedback.js` | Rolling rule feedback metrics verified | **PASS** |
| Phase 6 Drift | `node phase6/verify-drift.js` | Supersessions and unmarked contradictions flagged | **PASS** |
| Cross-Contamination | `node test/verify-cross-contamination.js`| 10/10 sequential runs clean, 0 concept leakage | **PASS** |
| Specification Model | `node test/verify-spec-model.js` | 24/24 invariant checks passed | **PASS** |
| 4D Validation | `node test/verify-validation.js` | 12/12 validation dimensions verified | **PASS** |
| Optimizer Rules | `node test/test-optimizer-rules.js` | 20/20 rules (3.1–3.6) and quota checks passed | **PASS** |
| UI Server API | `node test/verify-ui.js` | 19/19 REST endpoints and static assets verified | **PASS** |

**Total Baseline Test Runs:** 11 suites, 0 failures.

---

## 4. Productization Architecture Plan

The application is refactored into clean architectural layers:

```text
Lemonade Platform
 ├── src/core/             Pure, deterministic intent compiler API
 │    ├── index.js         detect(), extractSpec(), compilePrompt(), verifyCompilation()
 │    ├── compiler/        Target-aware prompt compilation (Cursor, Claude, OpenAI, etc.)
 │    └── proposal/        Non-binding suggestion and proposal engine
 ├── src/spec/             Domain-independent data modeling & persistence
 │    ├── model.js         ProjectSpec, SpecItem, Provenance, Priority, Scope, Status
 │    ├── extractor.js     Generic semantic parsing & ambiguity detection
 │    ├── repository.js    Atomic file-backed persistence & hydration
 │    ├── exporter.js      Markdown, Agent Prompt, JSON, and Audit generation
 │    └── scoring.js       5-Axis quality scoring & quota economics
 ├── src/domains/          Optional domain recommendation plugins (non-binding proposals)
 │    ├── registry.js      Plugin registration & proposal dispatch
 │    ├── college-apps.js  College app recommendations
 │    └── finance.js       Financial app recommendations
 ├── src/ui/               Local-first web application & REST API
 │    ├── server.js        Loopback HTTP server, SpecRepository routes, CSP, 413 limits
 │    └── public/          Modern 3-step UI: Capture -> Decide -> Compile
 │         ├── index.html  Accessible, font-free, progressive layout
 │         ├── app.js      Sanitized DOM rendering, event delegation, step workflow
 │         └── styles.css  Calm, editorial, premium developer tool styling
 └── docs/                 Architecture, Security, Product Positioning, and Audit
```
