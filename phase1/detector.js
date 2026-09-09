// Lemonade Phase 1 — Ambiguity Detector (heuristic rule engine).
// Deterministic, zero-dependency. Rules live in rules.json (JSON in, flags out):
//   detect(rawPrompt) -> { flags: [{id, category, severity, evidence, resolution,
//                                assumption, question}], ambiguity_score }
// Resolution: safe_default=true rules produce a labeled ASSUMPTION;
// safe_default=false rules produce a CLARIFYING QUESTION (no safe default exists).
// This module never rewrites the prompt — that's Phase 2.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RULES = JSON.parse(fs.readFileSync(path.join(__dirname, "rules.json"), "utf8")).rules;

const rxCache = new Map();
function rx(pattern) {
  let r = rxCache.get(pattern);
  if (!r) {
    r = new RegExp(pattern, "gi");
    rxCache.set(pattern, r);
  }
  r.lastIndex = 0;
  return r;
}

/** All distinct matched terms for a pattern list, with match positions. */
function findMatches(patterns, text) {
  const hits = [];
  for (const p of patterns ?? []) {
    const re = rx(p);
    let m;
    while ((m = re.exec(text)) !== null) {
      hits.push({ term: m[0].toLowerCase(), index: m.index, pattern: p });
      if (m.index === re.lastIndex) re.lastIndex++;
    }
  }
  return hits;
}

function isNegated(text, index, window) {
  if (!window) return false;
  const before = text.slice(Math.max(0, index - window), index);
  return /\b(no|without|never)\b/i.test(before);
}

function evaluate(rule, text) {
  const spec = rule.match;
  if (spec.type === "absence") {
    const required = (spec.require_any ?? []).length === 0 || findMatches(spec.require_any, text).length > 0;
    if (!required) return null;
    if (findMatches(spec.suppress_any, text).length > 0) return null;
    const hits = findMatches(spec.any_of, text);
    if (hits.length > 0) return null; // signal present -> not missing
    return { evidence: spec.evidence_missing ?? "required signals absent" };
  }
  if (spec.type === "presence") {
    if (findMatches(spec.suppress_any, text).length > 0) return null;
    const hits = findMatches(spec.any_of, text).filter((h) => !isNegated(text, h.index, spec.negation_window));
    if (hits.length === 0) return null;
    const terms = [...new Set(hits.map((h) => h.term))].slice(0, 5).join(", ");
    return { evidence: `${spec.evidence_prefix ?? "pattern matched"}: "${terms}"` };
  }
  if (spec.type === "presence_minus") {
    if (findMatches(spec.suppress_any, text).length > 0) return null;
    // Global semantics: if the spec addresses the concern ANYWHERE (minus_any),
    // the gap isn't ambiguous — don't fire. Real prompts specify things far
    // from where they mention the user/integration signal.
    if (findMatches(spec.minus_any, text).length > 0) return null;
    const plus = findMatches(spec.any_of, text).filter((h) => !isNegated(text, h.index, spec.negation_window));
    if (plus.length === 0) return null;
    const terms = [...new Set(plus.map((h) => h.term))].slice(0, 5).join(", ");
    return { evidence: `${spec.evidence_prefix ?? "pattern matched"}: "${terms}"` };
  }
  if (spec.type === "clause_count") {
    if (findMatches(spec.suppress_any, text).length > 0) return null;
    const clauses = text
      .split(new RegExp(spec.split_on, "i"))
      .map((c) => c.trim())
      .filter((c) => c.split(/\s+/).length >= spec.min_words);
    const distinctNouns = new Set(findMatches(spec.feature_nouns, text).map((h) => h.term)).size;
    const byClauses = clauses.length >= spec.min_clauses;
    const byNouns = distinctNouns >= (spec.min_distinct_nouns ?? Infinity);
    if (!byClauses && !byNouns) return null;
    const how = byClauses && byNouns ? "clauses+nouns" : byClauses ? "clauses" : "feature-nouns";
    return { evidence: `${spec.evidence_prefix ?? "clauses detected"} (${how}): ${clauses.length} segments, ${distinctNouns} distinct feature nouns` };
  }
  return null;
}

export function detect(rawPrompt) {
  const text = String(rawPrompt ?? "");
  const flags = [];
  for (const rule of RULES) {
    const hit = evaluate(rule, text);
    if (!hit) continue;
    flags.push({
      id: rule.id,
      category: rule.category,
      severity: rule.severity,
      evidence: hit.evidence,
      resolution: rule.safe_default ? "assumption" : "clarifying_question",
      assumption: rule.safe_default ? rule.default_assumption : null,
      question: rule.safe_default ? null : rule.clarifying_question,
    });
  }
  flags.sort((a, b) => b.severity - a.severity || a.id.localeCompare(b.id));
  return {
    flags,
    ambiguity_score: flags.reduce((a, f) => a + f.severity, 0),
    flagged: flags.length > 0,
  };
}

/** Phase 6 — inline linter support: same rules, same semantics as detect(),
 *  plus localizable spans (character offsets into the raw text).
 *  presence/presence_minus -> the matched terms (negation-filtered);
 *  clause_count -> the feature nouns; absence -> anchored to the build-intent
 *  token when present, else no span (prompt-level note). */
export function detectSpans(rawPrompt) {
  const text = String(rawPrompt ?? "");
  const out = [];
  for (const rule of RULES) {
    const hit = evaluate(rule, text);
    if (!hit) continue;
    const spec = rule.match;
    let spans = [];
    if (spec.type === "presence" || spec.type === "presence_minus") {
      spans = findMatches(spec.any_of, text)
        .filter((h) => !isNegated(text, h.index, spec.negation_window ?? 0))
        .map((h) => ({ start: h.index, end: h.index + h.term.length, text: text.slice(h.index, h.index + h.term.length) }));
    } else if (spec.type === "clause_count") {
      spans = findMatches(spec.feature_nouns ?? [], text)
        .map((h) => ({ start: h.index, end: h.index + h.term.length, text: text.slice(h.index, h.index + h.term.length) }));
    } else {
      const req = findMatches(spec.require_any ?? [], text);
      if (req.length > 0) {
        spans = [{ start: req[0].index, end: req[0].index + req[0].term.length, text: text.slice(req[0].index, req[0].index + req[0].term.length) }];
      }
    }
    out.push({
      id: rule.id,
      category: rule.category,
      severity: rule.severity,
      resolution: rule.safe_default ? "assumption" : "clarifying_question",
      suggestion: rule.safe_default ? rule.default_assumption : rule.clarifying_question,
      evidence: hit.evidence,
      spans: spans.sort((a, b) => a.start - b.start || a.end - b.end),
    });
  }
  out.sort((a, b) => (a.spans[0]?.start ?? -1) - (b.spans[0]?.start ?? -1) || a.id.localeCompare(b.id));
  return out;
}

export function listRules() {
  return RULES.map(({ id, category, severity, safe_default }) => ({ id, category, severity, safe_default }));
}
