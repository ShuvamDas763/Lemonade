// Lemonade Phase 5 — Feedback Loop (self-improving rule engine).
//
// Consumes real acceptance/correction signals and scores every heuristic rule:
//   outcome events  = { flags: [ruleIds], outcome: "accepted"|"edited"|"rejected" }
//   rule stats      = rolling hit-rate (accepted / total, last ROLLING events)
//   statuses        = provisional (< MIN_OBSERVATIONS) | healthy | watch | flagged
// Flagged rules are SURFACED for review — never auto-deleted (human in the loop,
// per the brief). The periodic report ranks rules and recommends actions.
// Also: edit-diff learning — a user's edit of an added line becomes a synthetic
// natural-language correction ("use <new> instead of <old>") processed by the
// SAME Phase 4 extractor, so it inherits promotion thresholds and guards.
import fs from "node:fs";
import path from "node:path";
import { extractCorrections, CorrectionStore } from "../phase4/corrections.js";

export const ROLLING = 50;          // rolling window per rule
export const MIN_OBSERVATIONS = 8;  // before a rule can be flagged (over-reaction guard)
const MAX_EVENTS = 2000;            // store cap (FIFO)

const nowIso = () => new Date().toISOString();
const OUTCOMES = new Set(["accepted", "edited", "rejected"]);

export class OutcomeStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.data = { version: 1, events: [] };
    if (fs.existsSync(filePath)) {
      try { this.data = JSON.parse(fs.readFileSync(filePath, "utf8")); }
      catch (e) { throw new Error(`outcome store corrupt (${e.message}): ${filePath}`); }
    }
  }

  /** outcome: "accepted" | "edited" | "rejected"; flags: rule ids that fired;
   *  edits: [{original, replacement}] additions the user changed before send. */
  record({ flags = [], outcome, edits = [], sessionId = null, pairId = null }) {
    if (!OUTCOMES.has(outcome)) throw new Error(`unknown outcome '${outcome}' (use: ${[...OUTCOMES].join(", ")})`);
    const ev = { at: nowIso(), outcome, flags: [...new Set(flags)], edits, sessionId, pairId };
    this.data.events.push(ev);
    if (this.data.events.length > MAX_EVENTS) this.data.events = this.data.events.slice(-MAX_EVENTS);
    this.save();
    return ev;
  }

  all() { return this.data.events; }
  save() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this.filePath);
  }
}

/** Rolling per-rule stats over all events. */
export function ruleStats(store) {
  const stats = new Map();
  const touch = (id) => {
    if (!stats.has(id)) stats.set(id, { id, total: 0, accepted: 0, edited: 0, rejected: 0, recent: [] });
    return stats.get(id);
  };
  for (const ev of store.all()) {
    for (const id of ev.flags ?? []) {
      const s = touch(id);
      s.total++;
      s[ev.outcome] = (s[ev.outcome] ?? 0) + 1;
      s.recent.push(ev.outcome);
    }
  }
  for (const s of stats.values()) {
    if (s.recent.length > ROLLING) s.recent = s.recent.slice(-ROLLING);
    const n = s.recent.length;
    s.acceptRate = +(s.recent.filter((o) => o === "accepted").length / n).toFixed(3);
    s.status =
      n < MIN_OBSERVATIONS ? "provisional"
      : s.acceptRate >= 0.6 ? "healthy"
      : s.acceptRate >= 0.4 ? "watch"
      : "flagged";
  }
  return [...stats.values()].sort((a, b) => a.acceptRate - b.acceptRate);
}

/** Human-readable periodic report (also written as markdown by the CLI). */
export function generateReport(store, { title = "Rule quality report" } = {}) {
  const rows = ruleStats(store);
  const total = store.all().length;
  const byStatus = (st) => rows.filter((r) => r.status === st);
  const lines = [];
  lines.push(`# ${title}`);
  lines.push("");
  lines.push(`- outcomes recorded: **${total}**  |  rules tracked: **${rows.length}**  |  window: rolling ${ROLLING}`);
  lines.push(`- healthy: ${byStatus("healthy").length}  watch: ${byStatus("watch").length}  flagged: ${byStatus("flagged").length}  provisional: ${byStatus("provisional").length}`);
  lines.push("");
  lines.push("| rule | n | acceptRate | edited | rejected | status |");
  lines.push("|---|---|---|---|---|---|");
  for (const r of rows) {
    lines.push(`| ${r.id} | ${r.total} | ${(r.acceptRate * 100).toFixed(0)}% | ${r.edited} | ${r.rejected} | ${r.status} |`);
  }
  const flagged = byStatus("flagged");
  const watch = byStatus("watch");
  if (flagged.length || watch.length) {
    lines.push("");
    lines.push("## Recommendations (human review — never auto-removed)");
    for (const r of flagged) lines.push(`- **${r.id}**: acceptRate ${(r.acceptRate * 100).toFixed(0)}% over ${r.total} outcomes — revise assumption/question text or demote the rule.`);
    for (const r of watch) lines.push(`- **${r.id}**: borderline (${(r.acceptRate * 100).toFixed(0)}%) — watch next batch before changing anything.`);
  }
  return { rows, text: lines.join("\n") };
}

// ---- Edit-diff learning: user edits of added lines -> correction memory ----
const words = (t) => (String(t ?? "").toLowerCase().match(/[a-z0-9]+(?:['’-][a-z0-9]+)*/g) ?? []);
const MAX_EDIT_WORDS = 8; // only learn from SHORT replacement-shaped edits; big rewrites are content, not preference

/** Feed user edits ({original, replacement} of ADDED lines only) into the
 *  correction store via the same deterministic extractor. Returns the number
 *  of correction events recorded. Guard: skip if either side is empty or too
 *  long, or if nothing actually changed. Promotion still requires 2 occurrences
 *  (the store's over-fit guard) — a single edit never becomes a preference. */
export function learnFromEdits(edits, correctionStore) {
  let recorded = 0;
  for (const e of edits ?? []) {
    const orig = String(e.original ?? "").trim();
    const repl = String(e.replacement ?? "").trim();
    if (!orig || !repl || orig === repl) continue;
    if (words(orig).length > MAX_EDIT_WORDS || words(repl).length > MAX_EDIT_WORDS) continue;
    // Strip Lemonade's own labels so "use Vue" not "[ASSUMED: React] use Vue".
    const strip = (s) => s.replace(/\[(?:ASSUMED|USER PREFERENCE)[^\]]*\]\s*:?/gi, "").trim();
    const o = strip(orig), r = strip(repl);
    if (!r || o.toLowerCase() === r.toLowerCase()) continue;
    // Label-only replacement (user swapped the whole assumption line for their
    // own value, e.g. "[ASSUMED: React (Vite)]" -> "Vue") is the most common
    // real edit shape: express it as a standing statement instead.
    const sentence = o ? `no, use ${r} instead of ${o}` : `from now on use ${r}`;
    const events = extractCorrections(sentence, { knownValues: correctionStore.all().map((x) => x.value) });
    if (events.length > 0) {
      correctionStore.record(events, { source: "edit-diff" });
      recorded += events.length;
    }
  }
  return recorded;
}
