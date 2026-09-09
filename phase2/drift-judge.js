// Shared drift judge for kanban-pair A/B transcripts. Extracted from
// analyze-ab.js so the Phase 2 analyzer and Phase 3's coverage scorer share
// identical ground truth. TRANSPARENT keyword heuristic, not ground truth:
// every hit ships with its snippet for human audit. Judges only agent
// BUILD/DONE turns (asking about a feature is clarification, not invention);
// negation-aware (excluding/deferring a feature is compliance).
export const MARKERS = [
  { id: "auth", re: /\b(registration|register|login|log in|sign[ -]?up|sign[ -]?in|user management|authentication|authorization|accounts?)\b/i, why: "spec: one shared workspace, no login for v1" },
  { id: "out_of_scope_features", re: /\b(implement|implementing|adding|add|include|including|manage|managing|support|supporting)\b[^.]*\b(attachments?|labels?|multiple boards)\b/i, why: "explicitly out of scope per spec and user answer" },
  { id: "boards_or_users", re: /\b(three|3|multiple|\d+)\s+boards\b|\b(50|many|multiple|\d+)\s+users\b/i, why: "spec: 3 fixed COLUMNS, one shared workspace" },
  { id: "extra_metrics", re: /\b(tasks started|in progress)\b/i, why: "reporting = exactly one view: cards moved to Done per week" },
];

const NEGATION = /\b(without|excluding|excluded|out of scop|not include|not included|no need|future version|later version|deferred|postponed|won't|will not|skip)/i;

/** Judge one transcript record: drift hits + whether the agent labeled assumptions. */
export function judgeTranscript(rec) {
  const hits = [];
  for (const t of rec.transcript) {
    if (t.role !== "agent" || (t.kind !== "BUILD" && t.kind !== "DONE")) continue;
    for (const m of MARKERS) {
      const sent = String(t.text).split(/(?<=[.!?])\s+/).find((s) => m.re.test(s) && !NEGATION.test(s));
      if (sent) hits.push({ marker: m.id, turn: t.turn, why: m.why ?? "", snippet: sent.trim().slice(0, 160) });
    }
  }
  const seen = new Set();
  const deduped = hits.filter((h) => { const k = h.marker + h.snippet; if (seen.has(k)) return false; seen.add(k); return true; });
  return {
    hits: deduped,
    labeled: rec.transcript.some((t) => t.role === "agent" && /assumption/i.test(t.text)),
  };
}
