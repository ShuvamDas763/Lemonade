// Lemonade Phase 4 — Correction-Memory Layer.
//
// Learns STANDING USER PREFERENCES from repeated corrections, so recurring
// context ("always TypeScript", "no comments") stops being re-typed.
//
// Design (constraint #1 — meaning preservation, and the brief):
//   - A "correction event" is detected by deterministic patterns over a user's
//     reply text: replacement ("no, use X instead of Y"), standing statements
//     ("always use TypeScript", "I prefer Vue"), prohibitions ("never use
//     comments", "no CSS frameworks"), and affirmations of a known preference.
//   - Store: JSON file (zero-dep), atomic writes, one record per preference
//     key with count/firstSeen/lastSeen/excerpts.
//   - Promotion ladder: candidate (seen once) -> standing (seen >1x AND fresh)
//     -> stale (not seen for STALE_DAYS). The brief's rule: a single correction
//     NEVER auto-applies (over-fit guard). Forgetting is explicit only —
//     records are never auto-deleted (human in the loop).
//   - Standing preferences are injected by the rewriter into Assumptions Made,
//     ALWAYS labeled [USER PREFERENCE], still visible (constraint #1).
import fs from "node:fs";
import path from "node:path";

export const STANDING_THRESHOLD = 2;      // count > 1 required (brief: avoid one-off over-fit)
export const STALE_DAYS = 45;             // unused for this long -> stale (needs re-confirmation)

const nowIso = () => new Date().toISOString();
const DAY_MS = 24 * 60 * 60 * 1000;

// ---- Correction-event patterns (deterministic, inspectable) ----
// Each pattern yields {dimension, value, kind}. `dimension` groups preferences
// (stack, style, testing...); `value` is the user's stated preference.
const PATTERNS = [
  // "no, use X instead of Y" / "use X instead of Y"
  { re: /\b(?:no,?\s*)?use\s+(.{2,60}?)\s+instead\s+of\s+(.{2,60}?)(?:[.,;]|$)/i, kind: "replacement" },
  // "use X, not Y" / "use X not Y" (same correction shape without "instead of")
  { re: /\buse\s+(.{2,60}?)\s*,?\s+not\s+(.{2,60}?)(?:[.,;]|$)/i, kind: "replacement" },
  // "always use X" / "always X"
  { re: /\balways\s+(?:use\s+)?(.{2,60}?)(?:[.,;]|$)/i, kind: "standing" },
  // "never use X" / "no X" (in reply context) / "don't use X"
  { re: /\b(?:never\s+use|don't\s+use|do\s+not\s+use|no)\s+(.{2,60}?)(?:[.,;]|$)/i, kind: "prohibition" },
  // "I prefer X" / "I like X better" / "from now on X" / "switch to X" / "go with X" / "I said (use) X"
  { re: /\b(?:i\s+(?:prefer|like|said)|from\s+now\s+on|switch\s+to|go\s+with)\s+(?:use\s+)?(.{2,60}?)(?:[.,;]|$)/i, kind: "standing" },
];

const clean = (s) =>
  String(s ?? "").trim().replace(/\s+/g, " ")
    .replace(/\s+(?:from\s+now\s+on|for\s+everything|everywhere|instead)$/i, "") // trailing filler
    .slice(0, 80);
const KEY_STOPWORDS = new Set("from now for the and with use instead please just really very stuff things also too a an in on of to at by as is are was were be been my our your me i we you it its this that these those said make made want need like prefer always never avoid dont don't no not yes ok okay fine good great well then than so such about into over under more most some any all both each other another same own only here there when where why how what which who whose can could should would will shall may might must do does did done".split(/\s+/));
export const normKey = (s) =>
  String(s ?? "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim()
    .split(" ").filter((w) => w.length > 2 && !KEY_STOPWORDS.has(w)).sort().join("-")
  || String(s ?? "").toLowerCase().trim();

const isProhibition = (v) => /^(no|not|never|avoid|without|don't|do not)\b/i.test(v) || /\b(no|none|never|avoid)\b/i.test(v);

/** Extract correction events from a user reply. Deterministic; returns [] for
 *  non-correction text. `knownValues` lets an affirmation confirm an existing
 *  preference ("yes, TypeScript") instead of creating a weird new key. */
export function extractCorrections(replyText, { knownValues = [] } = {}) {
  const text = String(replyText ?? "");
  if (!text.trim()) return [];
  const events = [];
  const seen = new Set();
  for (const p of PATTERNS) {
    const re = new RegExp(p.re.source, "gi");
    let m;
    while ((m = re.exec(text)) !== null) {
      let value;
      if (p.kind === "replacement") {
        value = clean(m[1]);
        const old = clean(m[2]);
        if (!value) continue;
        events.push({ kind: p.kind, dimension: guessDimension(value), value, replaces: old || null, quote: m[0] });
      } else {
        value = clean(m[1]);
        if (!value || value.length < 2) continue;
        // prohibitions keep their marker word so "no comments" != "comments"
        const val = p.kind === "prohibition" && !isProhibition(value) ? `no ${value}` : value;
        events.push({ kind: p.kind, dimension: guessDimension(val), value: val, replaces: null, quote: m[0] });
      }
    }
  }
  // Affirmation of a known preference: "yes, TypeScript" / "TypeScript is fine"
  for (const kv of knownValues) {
    const rx = new RegExp(`\\b${kv.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}\\b`, "i");
    if (rx.test(text) && /\b(yes|yeah|yep|correct|right|fine|good|exactly|confirm)\b/i.test(text)) {
      events.push({ kind: "affirmation", dimension: guessDimension(kv), value: kv, replaces: null, quote: text.slice(0, 80) });
    }
  }
  // dedup by normalized value
  const out = [];
  for (const e of events) {
    const k = normKey(e.value);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ ...e, key: k });
  }
  return out;
}

export function guessDimension(value) {
  const v = String(value).toLowerCase();
  if (/typescript|javascript|python|react|vue|svelte|angular|node|express|fastapi|django|postgres|sqlite|mongo|prisma|tailwind|css|html|next|vite/.test(v)) return "stack";
  if (/test|vitest|jest|pytest|cypress|playwright/.test(v)) return "testing";
  if (/comment|docstring|readme|docs|naming/.test(v)) return "style";
  if (/auth|login|session|cookie|token/.test(v)) return "auth";
  if (/deploy|docker|vercel|ci|github/.test(v)) return "devops";
  return "general";
}

// ---- Store (JSON file, atomic writes) ----
export class CorrectionStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.data = { version: 1, preferences: {} };
    if (fs.existsSync(filePath)) {
      try { this.data = JSON.parse(fs.readFileSync(filePath, "utf8")); }
      catch (e) { throw new Error(`correction store corrupt (${e.message}): ${filePath}`); }
    }
    for (const rec of Object.values(this.data.preferences)) refreshStatus(rec);
  }

  /** Record correction events (from extractCorrections). Returns updated records. */
  record(events, { source = "reply", sessionId = null } = {}) {
    const updated = [];
    for (const e of events) {
      let rec = this.data.preferences[e.key];
      if (!rec) {
        rec = this.data.preferences[e.key] = {
          key: e.key, dimension: e.dimension, value: e.value,
          count: 0, status: "candidate",
          firstSeen: nowIso(), lastSeen: nowIso(),
          excerpts: [], sources: [],
        };
      }
      rec.count += 1;
      rec.lastSeen = nowIso();
      if (e.replaces && rec.lastReplaces !== e.replaces) rec.lastReplaces = e.replaces;
      if (e.quote && !rec.excerpts.includes(e.quote)) rec.excerpts = [e.quote, ...rec.excerpts].slice(0, 5);
      const src = { source: e.source ?? source, sessionId, at: nowIso(), kind: e.kind };
      rec.sources = [src, ...rec.sources].slice(0, 10);
      refreshStatus(rec);
      updated.push(rec);
    }
    if (updated.length) this.save();
    return updated;
  }

  /** All records (any status). */
  all() { return Object.values(this.data.preferences); }

  /** Standing preferences only: promoted (count > 1) and not stale. */
  standing() { return this.all().filter((r) => r.status === "standing"); }

  /** Explicitly forget (never automatic; human-in-the-loop per the brief). */
  forget(key) {
    if (!this.data.preferences[key]) return false;
    delete this.data.preferences[key];
    this.save();
    return true;
  }

  save() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this.filePath);
  }
}

function refreshStatus(rec) {
  const ageDays = (Date.now() - new Date(rec.lastSeen).getTime()) / DAY_MS;
  if (rec.count >= STANDING_THRESHOLD && ageDays <= STALE_DAYS) rec.status = "standing";
  else if (ageDays > STALE_DAYS) rec.status = "stale";
  else rec.status = "candidate";
  return rec;
}
