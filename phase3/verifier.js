// Lemonade Phase 3 — Intent-Preservation Verifier (hard gate, deterministic, zero-dep).
//
// Verifies that a Phase 2 rewrite result has NOT changed the user's intent.
// HARD FAILURES (any one => the rewrite must not be sent downstream):
//   F1 nonempty-original  — nothing to verify on empty input
//   F2 verbatim-embedding — the original text must appear verbatim in the prompt
//   F3 canonical-rebuild  — prompt must equal a rebuild from its declared parts
//                           (catches any post-rewrite tampering)
//   F4 word-survival      — every significant original word survives
//                           (catches subtraction even if embedding logic changes)
//   F5 addition-trace     — every added line traces to a declared assumption,
//                           question, or fixed template section
//                           (catches silent invention)
//   F6 no-removal         — changes.removed must be empty
//   F7 no-modification    — changes.modified must be empty
//   F8 no-contradiction   — rewriter's own contradiction warnings are escalated
//                           from warning to HARD FAILURE
//   F9 assumption-form    — every declared addition must (a) map to a category
//                           the detector actually fired on this prompt, and
//                           (b) assumptions must use placeholder wording, not
//                           imperative requirements ("must/require/shall")
//  F10 memory-label       — memory_applied assumptions must carry the visible
//                           [USER PREFERENCE label (never silently hidden)
// Warnings (non-blocking): boilerplate-only output, high assumption load.
// The diff report is human-readable, for glance-confirm before sending onward.
import { buildSections } from "../phase2/rewriter.js";
import { detect } from "../phase1/detector.js";

// Words too generic to prove intent by themselves.
const STOPWORDS = new Set(
  "a an the and or but for from with without that this these those is are was were be been being to of in on at by as it its i my we our you your they their can could should would will shall may might must do does did have has had not no yes if then than so such very really just about into over under out up down more most some any all both each other another same own only here there when where why how what which who whom whose me him her them us app application build make create using use used want need like would".split(
    /\s+/
  )
);

const sigWords = (text) =>
  [...new Set(String(text).toLowerCase().match(/[a-z0-9]+(?:['’-][a-z0-9]+)*/g) ?? [])].filter(
    (w) => w.length >= 3 && !STOPWORDS.has(w)
  );

function isTemplateBoilerplate(line) {
  const l = line.trim();
  return (
    /^##\s/.test(l) ||
    /^-?\s*_\(.*\)_$/.test(l) ||
    /^\d+\.\s/.test(l) ||
    /^- \[ASSUMED:/.test(l) ||
    /^- /.test(l)
  );
}

/**
 * verify(rawPrompt, rewriteResult) -> {
 *   ok,                 // true only if zero hard failures
 *   hard_failures: [{check, detail}],
 *   warnings: [{check, detail}],
 *   diff_report,        // human-readable string
 *   diff: {added, removed, unchanged_core_requirements, assumptions, open_questions}
 * }
 */
export function verify(rawPrompt, rewriteResult) {
  const failures = [];
  const warnings = [];
  const raw = String(rawPrompt ?? "");
  const trimmed = raw.trim();
  const result = rewriteResult ?? {};
  const prompt = String(result.optimized_prompt ?? "");
  const assumptions = result.assumptions_made ?? [];
  const questions = result.clarifying_questions ?? [];
  const changes = result.changes ?? { added: [], removed: [], modified: [] };

  const fail = (check, detail) => failures.push({ check, detail });

  // F1 — nonempty original
  if (!trimmed) fail("nonempty-original", "the original prompt is empty; nothing to verify");

  // F2 — verbatim embedding of the original as the source of truth
  if (trimmed && !prompt.includes(trimmed)) {
    fail("verbatim-embedding", "the original prompt text does not appear verbatim in the optimized prompt");
  }

  // F3 — canonical rebuild matches what ships (tamper detection)
  if (trimmed) {
    let rebuilt = null;
    try {
      rebuilt = buildSections(trimmed, assumptions, questions);
    } catch (e) {
      fail("canonical-rebuild", `reconstruction threw: ${e.message}`);
    }
    if (rebuilt !== null && rebuilt !== prompt) {
      fail("canonical-rebuild", "optimized prompt differs from a canonical rebuild of its declared parts (post-rewrite tampering?)");
    }
  }

  // F4 — every significant original word survives
  const missing = sigWords(trimmed).filter((w) => !new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(prompt));
  if (trimmed && missing.length > 0) {
    fail("word-survival", `significant original words missing from the optimized prompt: ${missing.slice(0, 10).join(", ")}`);
  }

  // F5 — every added line traces to a declared addition or template boilerplate
  const declared = new Set([
    ...assumptions.map((a) => a.text),
    ...questions.map((q) => q.text),
  ]);
  const rawSig = new Set(sigWords(raw));
  // Traceability: content lines that are neither boilerplate, nor declared
  // additions, nor part of the verbatim original block.
  const originalLines = new Set(trimmed.split("\n").map((l) => l.trim()).filter(Boolean));
  const untraceable2 = prompt
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => {
      if (!l || isTemplateBoilerplate(l) || declared.has(l) || originalLines.has(l)) return false;
      // A line fully composed of original significant words is paraphrase-adjacent;
      // anything with new significant content is invention.
      const lineSig = sigWords(l);
      const novel = lineSig.filter((w) => !rawSig.has(w));
      return novel.length > 0;
    });
  if (untraceable2.length > 0) {
    fail("addition-trace", `added content not traceable to declared assumptions/questions: "${untraceable2.slice(0, 3).join('"; "')}"`);
  }

  // F5b — declared additions must trace to categories the detector actually
  // fired on this prompt (deterministic re-detection; blocks category smuggling).
  // memory_applied assumptions are exempt from flag-matching but governed by F10.
  if (trimmed) {
    const flagCats = new Set(detect(trimmed).flags.map((f) => f.category));
    const undeclared = [...assumptions, ...questions].filter(
      (a) => !flagCats.has(a.category) && a.category !== "memory_applied"
    );
    if (undeclared.length > 0) {
      fail("addition-trace", `declared additions with no matching detected ambiguity flag: ${[...new Set(undeclared.map((a) => a.category))].join(", ")}`);
    }
  }

  // F10 — memory-applied assumptions must be visibly labeled as user preferences.
  for (const a of assumptions.filter((x) => x.category === "memory_applied")) {
    if (!/\[USER PREFERENCE/i.test(a.text ?? "")) {
      fail("memory-label", `memory-applied assumption lacks the [USER PREFERENCE label: "${String(a.text ?? "").slice(0, 90)}"`);
    }
  }

  // F9 — assumptions are placeholders, not new requirements: no imperative
  // requirement wording in assumption text.
  const imperative = assumptions.filter((a) => /\b(must |require|required|requires|shall |needs to|has to)\b/i.test(a.text ?? ""));
  if (imperative.length > 0) {
    fail("assumption-form", `assumption text contains imperative requirement wording: "${imperative[0].text.slice(0, 120)}"`);
  }

  // F6/F7 — nothing removed or modified
  if ((changes.removed ?? []).length > 0) fail("no-removal", `changes.removed is non-empty: ${JSON.stringify(changes.removed).slice(0, 200)}`);
  if ((changes.modified ?? []).length > 0) fail("no-modification", `changes.modified is non-empty: ${JSON.stringify(changes.modified).slice(0, 200)}`);

  // F8 — rewriter's contradiction warnings escalate to hard failures
  for (const w of result.warnings ?? []) {
    fail("no-contradiction", `${w.type}${w.category ? ` (${w.category})` : ""}: ${w.detail}`);
  }

  // Warnings (non-blocking)
  if (trimmed && assumptions.length === 0 && questions.length === 0) {
    warnings.push({ check: "boilerplate-only", detail: "no assumptions or questions declared; prompt is the original plus template only" });
  }
  const assumptionLoad = assumptions.length / Math.max(1, sigWords(trimmed).length);
  if (assumptionLoad > 1) {
    warnings.push({ check: "high-assumption-load", detail: `${assumptions.length} assumptions for ${sigWords(trimmed).length} significant words — review whether defaults are justified` });
  }

  const diff = {
    added: [...assumptions.map((a) => a.text), ...questions.map((q) => q.text)],
    removed: changes.removed ?? [],
    unchanged_core_requirements: [trimmed],
    assumptions: assumptions.map((a) => ({ category: a.category, text: a.text })),
    open_questions: questions.map((q) => ({ category: q.category, text: q.text })),
  };

  return { ok: failures.length === 0, hard_failures: failures, warnings, diff, diff_report: renderDiffReport(trimmed, diff, failures, warnings) };
}

/** Human-readable, glance-confirmable diff report. */
export function renderDiffReport(original, diff, hardFailures, warnings) {
  const out = [];
  out.push("╔══════════════════════════════════════════════════════════════════╗");
  out.push("║ LEMONADE INTENT-PRESERVATION REPORT                              ║");
  out.push("╚══════════════════════════════════════════════════════════════════╝");
  out.push("");
  out.push("UNCHANGED CORE REQUIREMENTS (verbatim source of truth):");
  out.push(`  ${String(original).replace(/\n/g, "\n  ")}`);
  out.push("");
  out.push(`ADDED (${diff.added.length}) — all labeled, none user-stated:`);
  if (diff.added.length === 0) out.push("  (nothing added)");
  for (const a of diff.added) out.push(`  + ${a}`);
  out.push("");
  out.push(`REMOVED (${diff.removed.length}):`);
  out.push(diff.removed.length === 0 ? "  (nothing removed)" : `  - ${diff.removed.join("\n  - ")}`);
  out.push("");
  out.push(`ASSUMPTIONS (${diff.assumptions.length}) / OPEN QUESTIONS (${diff.open_questions.length}):`);
  for (const a of diff.assumptions) out.push(`  [A] (${a.category}) ${a.text}`);
  for (const q of diff.open_questions) out.push(`  [Q] (${q.category}) ${q.text}`);
  out.push("");
  if (hardFailures.length > 0) {
    out.push(`VERDICT: ✗ HARD FAIL — DO NOT SEND (${hardFailures.length} failure${hardFailures.length === 1 ? "" : "s"}):`);
    for (const f of hardFailures) out.push(`  ✗ [${f.check}] ${f.detail}`);
  } else {
    out.push("VERDICT: ✓ PASS — intent preserved by construction (verbatim goal, labeled-only additions, nothing removed or modified).");
  }
  for (const w of warnings ?? []) out.push(`  ⚠ [${w.check}] ${w.detail}`);
  return out.join("\n");
}
