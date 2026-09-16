# Lemonade Product Positioning

**Core Definition:**  
> **The Intent Integrity Layer between a Human Request and an AI Execution System.**

---

## 1. The Category Problem: The Fragility of Prompting

The market is saturated with two categories of prompt tools:
1. **Generic Rewriters:** "Make my prompt 10x better" tools that inject paragraphs of polite filler, hallucinate unrequested architecture, and bloat token costs without verifying whether the user's core intent survived.
2. **Post-Hoc Observability Dashboards:** Tools like PromptLayer, LangSmith, and Humanloop that excel at tracing tokens, latency, and cost *after* the agent has already executed, but do not prevent the agent from misunderstanding the contract in the first place.

When developers use coding assistants (Cursor, Claude Code, Aider, Copilot Workspace), the single largest source of failure is **Silent Intent Invention & Runaway Scope Drift**:
- The human asks for a simple to-do list; the model generates a complex multi-tenant JWT microservice.
- The human asks for an iterative update; the model rewrites the entire file and breaks working event handlers.
- The model makes ungrounded architectural choices that require costly rework later.

Lemonade solves this problem before the first token of code is written.

---

## 2. What Lemonade Is NOT

To maintain product discipline, Lemonade explicitly refuses to be:
- **Not a generic chatbot or prompt rewriter:** We do not replace developer intent with LLM flowery prose.
- **Not a prompt CMS:** We are not a static database of prompt templates.
- **Not an observability trace dump:** We do not flood users with hundreds of telemetry cards before they have even stated their intent.
- **Not a black-box optimizer:** We never claim "S-Tier" quality without mathematical breakdown across clarity, completeness, efficiency, scope control, and verifiability.

---

## 3. The Differentiating Product Loop

Lemonade implements a closed-loop proof-carrying lifecycle:

```text
Raw Intent
    ↓
Structured Requirements & Entities (Actor, Action, Object, Condition, Result)
    ↓
Ambiguity & Invariant Risk Detection (Unspecified data models, platforms, auth)
    ↓
Human-Approved Decisions (Accept, Edit, Reject, Defer)
    ↓
Target-Specific Prompt Compilation (Cursor, Claude Code, OpenAI Chat, Agent)
    ↓
Executable Acceptance Contract (Lightweight self-test verification steps)
    ↓
Downstream AI Execution
    ↓
Output Audit & Implementation Drift Detection
    ↓
Correction Memory (Personalized preferences without overfitting)
```

---

## 4. Key Differentiated Capabilities

### 4.1 Proof-Carrying Prompts
Every requirement, constraint, and assumption carries:
- **Stable ID** (e.g. `REQ-01`, `RULE-03`)
- **Provenance** (`user-stated`, `inferred`, `system-recommended`, `model-guess`)
- **Confidence Rating** (0.0 to 1.0)
- **Source Span** (exact character offsets into original text)
- **Reversibility Rating** (`reversible`, `costly`, `irreversible`)
- **Implementation Impact** (`low`, `medium`, `high`, `critical`)

### 4.2 Zero Silent Inventions
Only `user-stated` requirements are binding by default. Common domain patterns (canteen menus, library circulation, lost-and-found claims) emit non-binding **proposals** (`requiresApproval: true`). If the user does not approve them, they are never injected into the downstream prompt.

### 4.3 Semantic Delta Map
Instead of relying only on raw textual diffs, Lemonade outputs a structured delta map:
- **Preserved:** Unaltered human requirements.
- **Clarified:** Questions answered during drafting.
- **Assumed:** Explicitly labeled implementation defaults `[ASSUMED: ...]`.
- **Proposals:** Non-binding domain recommendations.
- **Negative Scope:** Prohibitions (`DO NOT build ...`) protecting free-tier quota.

### 4.4 Target-Aware Compilation
The same human intent compiles into native formats tailored for specific tools:
- **Cursor:** Invariant boundaries, `.cursorrules` contracts, and checklist tasks.
- **Claude Code:** Machine-parseable XML tags (`<project_intent>`, `<spec_requirements>`, `<stop_condition>`).
- **OpenAI Chat:** Structured system/user message array.
- **Coding Agents:** Strict 1-shot completion contracts with explicit deliverable formats and self-tests.

---

## 5. Summary Value Proposition

> **Lemonade guarantees that what you intended is what the agent receives, what the agent builds matches what you approved, and not a single token of quota is wasted on unrequested scope.**
