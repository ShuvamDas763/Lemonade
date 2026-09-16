// Lemonade Phase 6 — Spec-Drift Detector (requirements ledger over a conversation).
//
// Long sessions drift: a requirement stated early ("no login", "exactly 3
// columns") gets contradicted later without anyone noticing. This module keeps
// a running LEDGER of stated requirements and flags contradictions in later
// messages. Deterministic, zero model calls.
//
// Philosophy (constraint #1 — never judge intent):
//   - A LATER message that contradicts an earlier requirement is a FLAG, not
//     an error: the user may legitimately have changed their mind. Unmarked
//     contradictions surface as violations for confirmation.
//   - Reversal markers ("actually", "change of plan", "scratch that", ...)
//     mark the change INTENTIONAL: the old entry is superseded, no violation.
//   - Supersession keeps history (never silent deletion); explicit `confirm`
//     resolves a flagged contradiction going forward.
//
// Requirement extraction reuses the TESTED Phase 4 correction patterns for
// prohibitions; additions are conservative (precision over recall — a drift
// detector that cries wolf gets ignored).
import fs from "node:fs";
import path from "node:path";
import { extractCorrections } from "../phase4/corrections.js";
import { judgeTranscript } from "../phase2/drift-judge.js";

export const REVERSAL_MARKERS = /\b(actually|instead|change of plan|scratch|scrap|ignore (?:that|what i said)|no longer|switched? to|switching to|going with|let's go with|revised?|updated?)\b/i;

const STOP = new Set(
  "the a an and or in on for with of to at by as is are was were be been being my our your me i we you it its this that these those there here when where why how what which who whom can could should would will shall may might must do does did done have has had use uses used using want wants needed needs need like likes make makes made making please also too very really just some any all new old more most less least app application program code stuff things thing section page screen part piece bit lot kind sort type when while while so such then than if because but however however add adds added include includes included support supports supported display displays shows show implement implements implemented give gives gave has have one two three four five six seven eight nine ten single much many lot plenty about into over under out up down own same other another each both few manage manages managed managing user users multiple various several ability capability option way functionality feature features them only within core necessary handle handles handling".split(
    /\s+/
  )
);

// Modifier+noun compounds mapped to CANONICAL keys, so surface variants of
// the same feature collide ("no login" vs "add a login page" -> both "login")
// while genuinely different features don't ("dark mode" vs "light mode").
// Auth-family surface forms all canonicalize to one key ("auth") so that
// "no login for v1" collides with later "add a login page" / "user management"
// — that collision IS the drift the detector exists to catch.
const ATOMIC_PHRASES = [
  { phrase: "dark mode", key: "dark mode" }, { phrase: "light mode", key: "light mode" },
  { phrase: "admin panel", key: "admin" }, { phrase: "admin page", key: "admin" }, { phrase: "admin account", key: "admin" },
  { phrase: "user profile", key: "profile" }, { phrase: "landing page", key: "landing" }, { phrase: "home page", key: "home" },
  { phrase: "guest mode", key: "guest" },
  { phrase: "user management", key: "auth" }, { phrase: "user account", key: "auth" },
  { phrase: "login page", key: "auth" }, { phrase: "log in", key: "auth" }, { phrase: "sign in", key: "auth" },
  { phrase: "sign up", key: "auth" }, { phrase: "sign-in", key: "auth" }, { phrase: "sign-up", key: "auth" },
  { phrase: "login", key: "auth" }, { phrase: "registration", key: "auth" }, { phrase: "register", key: "auth" },
  { phrase: "authentication", key: "auth" }, { phrase: "authorization", key: "auth" },
];

/** Normalized key for a feature phrase: atomic phrase if present, else the
 *  first content word (head). "no comments in the code" -> "comments";
 *  "comments section" -> "comments" (they collide — that's the point). */
export function phraseKey(phrase) {
  const words = String(phrase ?? "").toLowerCase().match(/[a-z0-9]+(?:['’-][a-z0-9]+)*/g) ?? [];
  for (const a of ATOMIC_PHRASES) {
    if (a.phrase.split(" ").every((w) => words.includes(w))) return a.key;
  }
  const content = words.filter((w) => w.length >= 3 && !STOP.has(w));
  return content[0] ?? null;
}

const NUM_WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, single: 1 };
const normNoun = (w) => w.toLowerCase().replace(/s$/, "");

/** Extract stated requirements from one message. Conservative by design.
 *  Lines starting with "Q:" are ECHOED agent questions inside a user reply
 *  (scripted-oracle / multi-answer format) — a question is never a
 *  requirement, so they are dropped before extraction. */
export function extractRequirements(text) {
  const t = String(text ?? "")
    .split(/\n+/)
    .filter((line) => !/^\s*Q:\s/i.test(line))
    .join("\n");
  const reqs = [];
  const seen = new Set();
  const push = (r) => {
    const k = `${r.kind}:${r.key}:${r.number ?? ""}`;
    if (!r.key || seen.has(k)) return;
    seen.add(k);
    reqs.push(r);
  };

  // Prohibition phrase -> {key, qualifier}: "multiple boards" keeps its
  // quantity qualifier so a later "single board" statement (COMPLIANCE) does
  // not collide — only quantities that actually exceed the qualifier do.
  const qWords = { single: 1 };
  const parseProhibition = (bare) => {
    const qm = bare.match(/^(\d+|single|multiple)\s+/i);
    if (!qm) return { bare, qualifier: null, qNum: null };
    const qualifier = qm[1].toLowerCase();
    return { bare: bare.slice(qm[0].length).trim(), qualifier, qNum: /^\d+$/.test(qualifier) ? Number(qualifier) : (qWords[qualifier] ?? 2) };
  };

  // 1) Prohibitions — reuse the tested Phase 4 extractor ("no X", "never use X", ...)
  for (const e of extractCorrections(t)) {
    if (e.kind !== "prohibition") continue;
    let bare = String(e.value ?? "").replace(/^no\s+/i, "").split(/\s+-\s+/)[0].replace(/[^a-z0-9 '’-]+$/, "").trim();
    const { bare: core, qualifier, qNum } = parseProhibition(bare);
    const key = phraseKey(core);
    if (key) push({ kind: "prohibition", key, phrase: `no ${bare}`.trim().slice(0, 60), qualifier, qNum });
  }

  // 2) Explicit scope exclusions ("attachments are out of scope"), including
  //    comma lists ("Attachments, labels and multiple boards are out of scope")
  const oos = /\b([a-z][a-z0-9 ,'’-]{1,60}?)\s+(?:is|are|'s)?\s*(?:out of scope|off the table|excluded)\b/gi;
  let m;
  while ((m = oos.exec(t)) !== null) {
    for (const part of m[1].split(/,|\band\b|\bor\b/)) {
      const { bare: core, qualifier, qNum } = parseProhibition(part.trim());
      const key = phraseKey(core);
      if (key) push({ kind: "prohibition", key, phrase: `${part.trim()} (out of scope)`.slice(0, 60), qualifier, qNum });
    }
  }

  // 2b) Exclusion phrasings: "excluding/except X" and "without X"
  const exc = /\b(?:excluding|except(?:\s+for)?|other than|apart from)\s+([a-z][a-z0-9 ,'’-]{1,50}?)(?=[.,;!?]|$|\n)/gi;
  while ((m = exc.exec(t)) !== null) {
    for (const part of m[1].split(/,|\band\b|\bor\b/)) {
      const key = phraseKey(part);
      if (key) push({ kind: "prohibition", key, phrase: `excluding ${part.trim()}`.slice(0, 60) });
    }
  }
  const wo = /\bwithout\s+([a-z][a-z0-9 '’-]{1,60}?)(?=[.,;!?]|$|\n)/gi;
  while ((m = wo.exec(t)) !== null) {
    const key = phraseKey(m[1]);
    if (key) push({ kind: "prohibition", key, phrase: `without ${m[1].trim()}`.slice(0, 60) });
  }

  // 3) Inclusions — explicit feature verbs only (precision over recall)
  // 3) Inclusions — explicit feature verbs only (precision over recall).
  //    Agent-voice filler ("implement the ability to add X") is stripped so the
  //    key lands on the FEATURE, not on "ability".
  const inc = /\b(?:add|adds|added|adding|include|includes|included|including|implement|implements|implemented|implementing|support|supports|supported|supporting|must have|should have|displays?|shows?|showing|i want)\s+(?:\b(?:a|an|the|some)\b)?\s*([a-z][a-z0-9 '’-]{1,38}?)(?=[.,;!?]|$|\n)/gi;
  const FILLER = /^(?:the\s+|a\s+|an\s+)?(?:ability|capability|option|way|functionality|support)\s+(?:for\s+|to\s+)/i;
  while ((m = inc.exec(t)) !== null) {
    if (/\d/.test(m[1])) continue; // quantities are rule 4's job, not inclusions
    const stripped = m[1].replace(FILLER, "");
    const key = phraseKey(stripped);
    if (key) push({ kind: "inclusion", key, phrase: stripped.trim().slice(0, 60) });
  }

  // 4) Quantities ("<n> <noun>" — flags numeric drift on the same noun).
  // Skip common adjectives so "3 fixed columns" keys on "column", not "fixed".
  const ADJ = new Set("fixed main core separate different individual custom simple basic primary distinct shared unique active max maximum minimum minimum whole entire full total per each every current initial default standard regular normal single multiple various several".split(/\s+/));
  const qty = /\b(\d{1,4}|one|two|three|four|five|six|seven|eight|nine|ten|single)\s+([a-z]{3,20})(?:\s+([a-z]{3,20}))?/gi;
  while ((m = qty.exec(t)) !== null) {
    const w1 = m[2], w2 = m[3];
    const adj = ADJ.has(w1.toLowerCase());
    const noun = adj && w2 ? w2 : w1;
    if (STOP.has(noun.toLowerCase())) continue;
    const number = /^\d+$/.test(m[1]) ? Number(m[1]) : NUM_WORDS[m[1].toLowerCase()];
    // include the second word only for adjective compounds ("3 fixed columns"),
    // not for connectors ("3 columns and ...")
    const phrase = `${m[1]} ${m[2]}${adj && w2 ? " " + w2 : ""}`.slice(0, 40);
    push({ kind: "quantity", key: normNoun(noun), phrase, number });
  }
  return reqs;
}

const nowIso = () => new Date().toISOString();

/** Requirements ledger for one conversation/workspace. JSON file, atomic writes. */
export class SpecLedger {
  constructor(filePath) {
    this.filePath = filePath;
    this.data = { version: 1, messageCount: 0, entries: [], log: [] };
    if (fs.existsSync(filePath)) {
      try { this.data = JSON.parse(fs.readFileSync(filePath, "utf8")); }
      catch (e) { throw new Error(`spec ledger corrupt (${e.message}): ${filePath}`); }
    }
  }

  activeEntries() { return this.data.entries.filter((e) => !e.supersededBy); }

  /** Process one conversation message. Returns {messageIndex, additions,
   *  violations, reversals}. Violations reference the earlier entry so a UI
   *  can show both statements side by side. */
  processMessage(text, { sessionId = null, trusted = true, kind = null } = {}) {
    const idx = ++this.data.messageCount;
    // Reversals and requirement EXTRACTION are user statements. Agent turns
    // (BUILD/DONE) are checked against the ledger but can never add or
    // supersede requirements — the agent does not own the spec.
    const intentional = trusted && REVERSAL_MARKERS.test(String(text ?? ""));
    // Agent turns ARE extracted and checked against the ledger (that is how a
    // BUILD turn drifts into a violation) — but the write-path below refuses
    // to let untrusted messages add, reaffirm, or supersede requirements.
    // CLARIFY turns only ASK about features ("can X be supported?") — a
    // question is never a requirement, so extraction is skipped entirely.
    const isClarify = !trusted && /^\s*clarify/i.test(String(kind ?? ""));
    const reqs = isClarify ? [] : extractRequirements(text);
    const additions = [], violations = [], reversals = [];

    // Surface variants collide: "attachments" (prohibition) vs "3 attachments"
    // (quantity) vs "attachment" (singular) are the same feature.
    const sameKey = (a, b) => a === b || normNoun(String(a)) === normNoun(String(b));
    for (const r of reqs) {
      let conflicted = false;
      for (const e of this.activeEntries()) {
        if (!sameKey(e.key, r.key)) continue;
        const conflict =
          e.kind === "prohibition" && r.kind === "inclusion" ? "prohibition-violated"
          : e.kind === "inclusion" && r.kind === "prohibition" ? "requirement-reversed"
          : e.kind === "quantity" && r.kind === "quantity" && e.number !== r.number ? "numeric-drift"
          : (e.kind === "prohibition" && r.kind === "quantity") || (e.kind === "quantity" && r.kind === "prohibition")
            ? // "no multiple boards" vs "single board" is compliance, not drift:
              // quantified prohibitions only conflict with quantities that exceed them.
              (e.kind === "prohibition" ? (e.qNum == null || r.number > e.qNum) : (r.qNum == null || e.number > r.qNum)) ? "quantity-for-prohibited-feature" : null
          : null;
        if (!conflict) continue;
        conflicted = true;
        if (intentional) {
          e.supersededBy = idx;
          e.supersededAt = nowIso();
          reversals.push({ entryId: e.id, key: e.key, oldPhrase: e.phrase, newPhrase: r.phrase, messageIndex: idx });
        } else {
          violations.push({
            type: conflict,
            messageIndex: idx,
            against: { id: e.id, kind: e.kind, key: e.key, phrase: e.phrase, firstSeenMessage: e.firstSeen },
            quote: r.phrase,
            detail:
              conflict === "numeric-drift"
                ? `earlier statement said ${e.number} ${e.key}(s), this message says ${r.number}`
                : `earlier statement (${e.firstSeen}): "${e.phrase}" vs now: "${r.phrase}"`,
          });
        }
      }
      // Reaffirm (same kind + same key + same number) or add as new entry.
      const same = this.activeEntries().find(
        (e) => sameKey(e.key, r.key) && e.kind === r.kind && (e.kind !== "quantity" || e.number === r.number)
      );
      // For UNCONFIRMED violations, don't record the new requirement either —
      // we don't yet know which state is true. For intentional reversals the
      // old entry was just superseded, so the new requirement MUST be added
      // (it is the current truth).
      // Untrusted turns (agent BUILD/DONE): check-only — never record.
      if (!trusted) continue;
      if (conflicted && !same && !intentional) continue;
      if (same) {
        same.count++;
        same.lastSeen = idx;
      } else {
        const entry = {
          id: `${r.kind}-${r.key}-${idx}`,
          kind: r.kind, key: r.key, phrase: r.phrase, number: r.number ?? null, qualifier: r.qualifier ?? null, qNum: r.qNum ?? null,
          firstSeen: idx, lastSeen: idx, count: 1, supersededBy: null, supersededAt: null,
          implementationStatus: "unverified",
          evidence: [],
        };
        this.data.entries.push(entry);
        additions.push({ id: entry.id, kind: r.kind, key: r.key, phrase: r.phrase, number: r.number ?? null });
      }
    }

    // Drift-judge every message (transparent keyword markers; agent turns are
    // the interesting ones). Kept SEPARATE from ledger violations: markers are
    // advisory evidence, conflicts are structural.
    const judgeHits = judgeTranscript({
      transcript: [{ turn: idx, role: trusted ? "user" : "agent", kind: kind ?? (trusted ? "ANSWER" : "BUILD"), text: String(text ?? "") }],
    }).hits.map((h) => ({ marker: h.marker, turn: h.turn, why: h.why, snippet: h.snippet }));
    this.data.log.push({
      messageIndex: idx, sessionId, trusted, at: nowIso(), chars: String(text ?? "").length,
      violations: violations.length, reversals: reversals.length,
      agentFlagged: !trusted && judgeHits.length > 0, judgeHits,
    });
    this.save();
    return { messageIndex: idx, intentional, trusted, agentFlagged: !trusted && judgeHits.length > 0, additions, violations, reversals, judgeHits };
  }

  /** Link implementation evidence (file path, test name, commit, or PR) to an entry. */
  linkEvidence(entryId, { type = "file", ref = "", note = "" } = {}) {
    const e = this.data.entries.find((x) => x.id === entryId || x.key === entryId);
    if (!e) return false;
    if (!Array.isArray(e.evidence)) e.evidence = [];
    e.evidence.push({ type, ref, note, at: nowIso() });
    this.save();
    return true;
  }

  /** Update implementation status of a requirement. */
  updateImplementationStatus(entryId, status, { reason = "", evidence = null } = {}) {
    const validStatuses = ["implemented", "partially-implemented", "not-implemented", "contradicted", "unverified"];
    if (!validStatuses.includes(status)) {
      throw new Error(`Invalid status "${status}". Must be one of: ${validStatuses.join(", ")}`);
    }
    const e = this.data.entries.find((x) => x.id === entryId || x.key === entryId);
    if (!e) return false;
    e.implementationStatus = status;
    if (reason) e.statusReason = reason;
    if (evidence) {
      if (!Array.isArray(e.evidence)) e.evidence = [];
      e.evidence.push({ ...evidence, at: nowIso() });
    }
    this.save();
    return true;
  }

  /** Generate an audit report of implementation coverage and drift. */
  implementationDriftReport() {
    const active = this.activeEntries();
    const stats = {
      total: active.length,
      implemented: 0,
      partiallyImplemented: 0,
      notImplemented: 0,
      contradicted: 0,
      unverified: 0,
      withEvidence: 0,
    };

    const details = [];
    for (const e of active) {
      const st = e.implementationStatus || "unverified";
      if (st === "implemented") stats.implemented++;
      else if (st === "partially-implemented") stats.partiallyImplemented++;
      else if (st === "not-implemented") stats.notImplemented++;
      else if (st === "contradicted") stats.contradicted++;
      else stats.unverified++;

      if (Array.isArray(e.evidence) && e.evidence.length > 0) stats.withEvidence++;
      details.push({
        id: e.id,
        key: e.key,
        kind: e.kind,
        phrase: e.phrase,
        status: st,
        evidenceCount: (e.evidence || []).length,
      });
    }

    const coverage = stats.total === 0 ? 1 : Math.round(((stats.implemented + 0.5 * stats.partiallyImplemented) / stats.total) * 100);
    return {
      stats,
      coveragePercent: coverage,
      isFullyVerified: stats.unverified === 0 && stats.notImplemented === 0 && stats.contradicted === 0,
      details,
    };
  }

  /** Explicitly resolve a flagged contradiction: the newer state wins and the
   *  old entry stops firing. History is kept (supersededBy), never deleted. */
  confirm(entryId) {
    const e = this.data.entries.find((x) => x.id === entryId);
    if (!e || e.supersededBy) return false;
    e.supersededBy = this.data.messageCount;
    e.supersededAt = nowIso();
    this.save();
    return true;
  }

  all() { return this.data.entries; }
  violations() { return this.data.log.reduce((a, l) => a + l.violations, 0); }
  save() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this.filePath);
  }
}
