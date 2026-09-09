// Lemonade Phase 2 — Rewriter Engine (heuristic-first, deterministic).
//
// Takes the raw prompt + Phase 1 flags and produces a structured optimized
// prompt. Design invariants (constraint #1 — meaning preservation):
//   1. The original prompt is embedded VERBATIM as the "source of truth" —
//      the rewriter never paraphrases, drops, or reinterprets user text.
//   2. The only additions are clearly-labeled assumptions (from safe-default
//      flags) and open questions (from no-safe-default flags).
//   3. A contradiction self-check warns if any assumption conflicts with
//      something the user actually wrote (Phase 3 turns warnings into hard
//      failures).
// Local-LLM fallback exists (llm-fallback.js) but is OFF by default and can
// only phrase questions — it never overrides heuristic output.
import { detect } from "../phase1/detector.js";
import { phraseClarifyingQuestion } from "./llm-fallback.js";
import { CorrectionStore } from "../phase4/corrections.js";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Default memory store lives in the project root regardless of cwd.
const DEFAULT_MEMORY_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)), "..", "data", "corrections.json"
);

const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Phase 4 conflict guard: a standing PROHIBITION ("no comments") must not be
// injected when the user's current prompt explicitly asks for that thing.
// Positive preferences never conflict-check in v1 (the prompt is the source of
// truth and outranks preferences anyway).
const STOPWORDS_LIGHT = new Set("the a an and or in on for with of my our your to at by from is are be been was were use using used code general stuff things please thanks very really just into over under about it its this that these those me him her them us i we you they he she do does did done make made building want need like prefer always never avoid dont don't no not yes if then than so such very more most some any all both each other another same own only here there when where why how what which who whose can could should would will shall may might must".split(/\s+/));

function preferenceConflict(pref, raw) {
  const m = String(pref.value ?? "").match(/^(?:no|never|don't|do not|avoid)\s+(?:use\s+)?(.+)$/i);
  if (!m) return null;
  // Match the prohibition's HEAD NOUN, not the whole captured phrase: users
  // phrase prohibitions with filler ("no comments in the code"), and the prompt
  // may mention the noun in any grammatical clothing ("a comments section").
  // Over-skipping is the safe direction (preference not applied, reason logged).
  const words = m[1].toLowerCase().match(/[a-z0-9]+(?:['’-][a-z0-9]+)*/g) ?? [];
  const head = words.find((w) => w.length >= 3 && !STOPWORDS_LIGHT.has(w));
  if (!head) return null;
  const wants = new RegExp(`\\b${escapeRe(head)}(?:s|es)?\\b`, "i").test(raw);
  if (!wants) return null;
  const excludesIt = new RegExp(`\\b(?:no|without|never|don't)\\s+(?:use\\s+)?${escapeRe(head)}`, "i").test(raw);
  return excludesIt ? null : `prompt mentions "${head}", which this standing preference excludes - the prompt outranks the preference`;
}

// Anti-evidence patterns: if present in the ORIGINAL text, the canned
// assumption for this category may contradict the user. Defense-in-depth —
// the detector should already have suppressed the rule.
const CONTRADICTION_CHECKS = [
  { category: "missing_platform", pattern: "\\b(mobile|ios|android|desktop|cli)\\b" },
  { category: "missing_stack", pattern: "\\b(vanilla|no frameworks?|without frameworks?|plain (js|javascript|html))\\b" },
  { category: "unspecified_auth", pattern: "\\b(multi-user|accounts?|login|log in|sign[ -]?in|auth)\\b" },
  { category: "missing_data_model", pattern: "\\b(no database|stateless|in-memory|no storage)\\b" },
];

// Adaptive variant: "for my dev team" + no auth spec should NOT assume
// "single-user" (that would contradict the team framing) — assume a shared
// workspace instead and mark it for confirmation.
function authAssumption(raw) {
  // Same social vocabulary as the detector's R7 (wife/family/roommates/...):
  // multi-user framing should never produce a "single-user" assumption.
  const teamish = /\b(team|members|users|shared|collaborat|wife|husband|partner|girlfriend|boyfriend|spouse|famil(?:y|ies)|friends?|budd(?:y|ies)|parents?|household|roommates?|coworkers?|colleagues?|classmates?|couple|group)/i.test(raw);
  return teamish
    ? "[ASSUMED: single shared workspace without login for v1 - accounts not stated by user, but team/user framing detected; confirm if per-user accounts are needed]"
    : "[ASSUMED: single-user, no authentication - accounts/permissions not stated by user]";
}

function assumptionText(flag, raw) {
  if (flag.category === "unspecified_auth") return authAssumption(raw);
  if (flag.category === "vague_scope") {
    // Evidence-driven: name the actual qualifier(s) the user wrote.
    const terms = (flag.evidence.match(/"([^"]+)"/) ?? [])[1] ?? "the subjective wording";
    return `[ASSUMED: '${terms}' interpreted conservatively as a minimal, conventional implementation - subjective bar not stated by user]`;
  }
  return flag.assumption;
}

// Exported so Phase 3's verifier can rebuild the canonical prompt from parts
// and compare it to what actually ships (tamper detection).
export function buildSections(raw, assumptions, questions) {
  const lines = [];
  lines.push("## Goal (verbatim from the user - treat as the source of truth)");
  lines.push("");
  lines.push(raw.trim());
  lines.push("");
  if (assumptions.length === 0 && questions.length === 0) {
    lines.push("_(Lemonade found no ambiguity: no assumptions added, no open questions.)_");
    lines.push("");
  }
  if (assumptions.length > 0) {
    lines.push("## Assumptions Made (auto-added by Lemonade - labeled placeholders, NOT user requirements)");
    lines.push("");
    for (const a of assumptions) lines.push(`- ${a.text}`);
    lines.push("");
  }
  if (questions.length > 0) {
    lines.push("## Open Questions (Lemonade did NOT guess these - answer them if you can; otherwise the agent proceeds on labeled judgment)");
    lines.push("");
    for (const q of questions) lines.push(`- ${q.text}`);
    lines.push("");
  }
  lines.push("## Instructions to the implementing agent");
  lines.push("1. The Goal section above is the source of truth - do not reinterpret, drop, or add scope beyond it.");
  lines.push("2. Assumptions are placeholders, not requirements: implement them only where needed, keep them isolated and easy to swap, and state in your summary where an assumption shaped a decision.");
  lines.push("3. Open Questions: if the user answered them above, use those answers. Otherwise do NOT wait, stall, or re-ask - choose the most conservative interpretation, state it explicitly as an assumption in your summary, and proceed with the build.");
  return lines.join("\n");
}

export async function rewrite(rawPrompt, { flags = null, useLlm = false, memoryPath = DEFAULT_MEMORY_PATH } = {}) {
  const raw = String(rawPrompt ?? "");
  const trimmed = raw.trim();
  if (!trimmed) {
    return {
      ok: false,
      error: "empty prompt - nothing to rewrite",
      optimized_prompt: "",
      assumptions_made: [],
      clarifying_questions: [],
      warnings: [],
      changes: { added: [], removed: [], modified: [] },
      memory: { applied: [], skipped: [] },
    };
  }

  const resolved = flags ?? detect(raw).flags;
  const assumptions = [];
  const questions = [];
  const warnings = [];

  for (const flag of resolved) {
    if (flag.resolution === "assumption") {
      const text = assumptionText(flag, raw) ?? flag.assumption;
      if (text) assumptions.push({ category: flag.category, severity: flag.severity, text });
    } else {
      let text = flag.question ?? null;
      // Optional LLM fallback: only when a no-safe-default flag has no canned
      // question, and only when explicitly enabled. Never overrides heuristics.
      if (!text && useLlm) text = await phraseClarifyingQuestion(raw, flag);
      if (!text) text = `Please clarify the ${flag.category.replace(/_/g, " ")} before implementation.`;
      questions.push({ category: flag.category, severity: flag.severity, text });
    }
  }

  // Phase 4 — Correction-Memory: inject STANDING user preferences as labeled
  // assumptions (always visible, never silent — constraint #1). A one-off
  // correction is never applied (over-fit guard lives in the store); conflicts
  // with the current prompt are skipped with a reason; memory failures degrade
  // gracefully and never break rewriting.
  const memory = { applied: [], skipped: [], overrides: [] };
  try {
    const store = new CorrectionStore(memoryPath);
    const appliedPrefs = [];
    for (const pref of store.standing()) {
      const conflict = preferenceConflict(pref, raw);
      if (conflict) {
        memory.skipped.push({ key: pref.key, value: pref.value, reason: conflict });
        continue;
      }
      assumptions.push({
        category: "memory_applied",
        severity: 0,
        text: `[USER PREFERENCE (learned from corrections - edit or remove freely): ${pref.value}]`,
      });
      memory.applied.push(pref.key);
      appliedPrefs.push(pref);
    }
    // A learned preference in a dimension the detector also defaults on
    // (e.g. stack, auth) REPLACES the canned default assumption in that
    // dimension — emitting both would give the downstream agent two
    // contradictory instructions ("React" + "user prefers Vue"). The
    // replacement is still fully visible: the preference line is labeled and
    // traceable, and the override is recorded in memory.overrides.
    const PREF_DIMENSION_CATEGORY = { stack: "missing_stack", auth: "unspecified_auth" };
    const overrideCats = new Set(
      appliedPrefs.map((p) => PREF_DIMENSION_CATEGORY[p.dimension]).filter(Boolean),
    );
    if (overrideCats.size) {
      for (let i = assumptions.length - 1; i >= 0; i--) {
        const a = assumptions[i];
        if (a.category === "memory_applied" || !overrideCats.has(a.category)) continue;
        assumptions.splice(i, 1);
        memory.overrides.push({
          category: a.category,
          replacedBy: appliedPrefs.find((p) => PREF_DIMENSION_CATEGORY[p.dimension] === a.category)?.key,
          replacedText: a.text,
        });
      }
    }
  } catch (e) {
    memory.skipped.push({ key: "(store)", value: null, reason: `memory unavailable: ${e.message}` });
  }

  // Contradiction self-check (Phase 3 will escalate these to hard failures).
  for (const chk of CONTRADICTION_CHECKS) {
    if (!assumptions.some((a) => a.category === chk.category)) continue;
    const m = raw.match(new RegExp(chk.pattern, "i"));
    if (m) {
      warnings.push({
        type: "possible_contradiction",
        category: chk.category,
        detail: `assumption may conflict with "${m[0]}" in the original`,
      });
    }
  }

  const optimized_prompt = buildSections(raw, assumptions, questions);
  const added = [...assumptions.map((a) => a.text), ...questions.map((q) => q.text)];
  return {
    ok: true,
    optimized_prompt,
    assumptions_made: assumptions,
    clarifying_questions: questions,
    warnings,
    changes: { added, removed: [], modified: [] },
    memory,
  };
}
