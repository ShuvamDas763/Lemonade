# Lemonade Architecture & API Reference

**Category:** The Intent Integrity Layer between a Human Request and an AI Execution System.  
**Version:** 2.1.0 (Production Core)  
**Runtime:** Node.js >= 18.17 (ESM, zero external runtime npm dependencies).

---

## 1. System Overview & Core Invariants

Lemonade acts as a proof-carrying intent compiler that sits between ambiguous human requirements and downstream AI execution environments (e.g., Cursor, Claude Code, OpenAI API, Aider, and autonomous agents).

### Core Invariants:
1. **Never Silently Invent Scope:** Only statements explicitly grounded in user text are marked `user-stated` and binding. Domain patterns, common workflows, and heuristics emit non-binding **proposals** (`system-recommended`, `requiresApproval: true`).
2. **Deterministic-First:** The core integrity and verification pipeline is local, deterministic, and requires zero paid API calls or cloud dependencies.
3. **Traceable Compilation:** Every generated prompt carries provenance markers, confidence ratings, explicit assumption wrappers `[ASSUMED: ...]`, and verifiable acceptance criteria.
4. **Resilient Persistence:** Specifications survive process restarts with atomic writes and full `ProjectSpec` class rehydration.

```text
       Raw Intent (Human Prompt)
                   ↓
   1. Deterministic Ambiguity Detector (phase1/detector.js)
                   ↓
   2. Semantic Extractor & Entity Parser (src/spec/extractor.js)
                   ↓
   3. Domain Proposal Enhancer (src/domains/registry.js)
                   ↓
   4. Human Decision Gating (Capture → Decide → Compile)
                   ↓
   5. Target-Aware Compiler (src/core/compiler.js)
                   ↓
   6. 4D Integrity Verification (src/validation/validate.js)
                   ↓
   7. Downstream AI Execution & Spec-Drift Ledger (phase6/ledger.js)
```

---

## 2. Core API Layer (`src/core/index.js`)

The core package exposes pure, deterministic functions:

### `detect(prompt: string): { flags: object[], ambiguity_score: number }`
Scans raw text for lexical ambiguities (unspecified data models, missing stacks, vague scope, unstated auth) and returns severity-weighted flags.

### `extractSpec(prompt: string, options?: { title?: string }): ProjectSpec`
Parses raw text into an Actor-Action-Object-Condition-Result model, attributing character spans, priorities, and default scopes.

### `compilePrompt(spec: ProjectSpec, target?: string): string | object[]`
Compiles a canonical `ProjectSpec` into target-specific agent prompts without altering the underlying specification. Supported targets:
- `coding-agent` (default): Structured markdown adhering to Rules 3.1–3.6 (Deliverable Format, Must Build, Negative Scope, State Preservation, Hard Stop Condition, Lightweight Self-Test).
- `cursor`: Optimized `.cursorrules` / agent contract format with checkbox checklists and invariant boundaries.
- `claude-code`: Structured XML tags (`<project_intent>`, `<spec_requirements>`, `<constraints>`, `<visible_assumptions>`, `<stop_condition>`).
- `openai-chat`: Array of system and user messages ready for `POST /v1/chat/completions`.
- `markdown`: Full builder specification.
- `json`: Canonical JSON serialization.
- `image-gen`: Visual prompt compiler specifying style, subject, palette, and negative prompt boundaries.
- `research`: Systematic research inquiry format with inquiry bounds and citation criteria.

### `verifyCompilation(originalPrompt: string, compiledPrompt: string, spec: ProjectSpec): object`
Performs dual-axis verification:
- **Intent Integrity:** `preserved`, `missingWords`, `safetyPassed`, `inventedConcepts`, `contradictionsDetected`, `additionsTraceable`.
- **Task Quality:** `clarity`, `completeness`, `efficiency`, `scopeControl`, `verifiability`, `estimatedTurns`, `tokenCount`, `loopRisk`.

### `compileTraceable(spec: ProjectSpec, target?: string): object`
Emits the complete proof-carrying compilation payload:
```json
{
  "originalPrompt": "...",
  "compiledPrompt": "...",
  "target": "cursor",
  "preservedItems": [...],
  "clarifiedItems": [...],
  "inferredItems": [...],
  "recommendedItems": [...],
  "unresolvedQuestions": [...],
  "removedItems": [...],
  "contradictions": [],
  "acceptanceCriteria": [...],
  "negativeScope": [...],
  "stopConditions": [...],
  "verification": { ... }
}
```

### `evaluateOutput(spec: ProjectSpec, agentOutput: string): object`
Audits downstream code or agent replies against original specification requirements to catch implementation drift or partial completion.

---

## 3. Persistence & Repository Layer (`src/spec/repository.js`)

All storage operations flow through `SpecRepository`:

```js
class SpecRepository {
  constructor(dataDir)
  create(spec: ProjectSpec): ProjectSpec
  get(id: string): ProjectSpec | null
  update(id: string, updater: (spec: ProjectSpec) => void): ProjectSpec
  list(): Array<{ id, title, version, createdAt, updatedAt, itemCount }>
  delete(id: string): boolean
}
```

### Persistence Invariants:
- **Atomic Disk Writes:** Writes to `${filePath}.tmp.${Date.now()}.${rand}` and renames via `fs.renameSync` to eliminate file corruption.
- **Hydration:** Raw JSON files are reconstructed via `ProjectSpec.fromJSON()` on read, guaranteeing that methods (`findItem`, `acceptItem`, `rejectItem`, `deferItem`, `answerQuestion`) are fully available after server restarts.

---

## 4. Local REST API Endpoints (`src/ui/server.js`)

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/health` | Service health, version, and request ID |
| `POST`| `/api/detect` | Lexical ambiguity detection |
| `GET` | `/api/specs` | List all saved specifications |
| `POST`| `/api/spec/create` | Parse prompt, build `ProjectSpec`, run 4D validation, return exports |
| `GET` | `/api/spec/:id` | Hydrate and fetch specification |
| `PUT` | `/api/spec/:id/item/:itemId` | Update requirement status (`accept`, `edit`, `reject`, `defer`) |
| `POST`| `/api/spec/:id/question/:qid/answer`| Answer open question and generate accepted decision |
| `POST`| `/api/spec/:id/export` | Export spec into target format (`agent`, `cursor`, `claude`, `json`, `markdown`) |
| `DELETE`| `/api/spec/:id` | Delete saved specification |
| `GET` | `/api/ledger` | Query implementation drift report and active ledger entries |
| `POST`| `/api/ledger/evidence` | Link code or file evidence to a spec item |

---

## 5. UI Architecture & Workflow

The user interface implements progressive disclosure across three primary stages:
1. **Capture (`#panel-step-1`):** Focuses solely on prompt entry, target selection, and compile triggering. No distracting metrics or preloaded demos on first run.
2. **Decide (`#panel-step-2`):** Presents human-in-the-loop decisions (inferred assumptions, ambiguity gaps, proposals). Users can accept, edit, reject, or defer with one click.
3. **Compile (`#panel-step-3`):** Delivers the verified compiled contract, side-by-side original-vs-compiled diff, and 1-click clipboard export.
4. **Audit Drawer (`#audit-drawer`):** Houses secondary telemetry (4D Validation, Quota Economics, 5-Axis Radar, Spec-Drift Ledger, and raw JSON).
