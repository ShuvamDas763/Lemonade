// Lemonade Phase 6 ↔ Phase 4 ↔ Phase 2 integration.
//
// Feeds a multi-message session through the spec-drift ledger with role-based
// trust (USER messages add requirements; agent BUILD/DONE turns are checked
// but can never add or supersede — the agent does not own the spec), then
// routes detected drift into the Phase 4 correction-memory store.
//
// Loopback semantics (constraint #1 — never judge intent): a VIOLATION means
// "the later statement conflicts with an earlier one". We cannot know who is
// right, so the conflicting quote is recorded as a CANDIDATE correction
// ("no <X>") — the store's over-fit guard (count > 1) means it is never
// auto-applied, and the ledger entry id is returned so a human can resolve it
// with ledger.confirm(id). Nothing is auto-promoted, nothing auto-deleted.
//
// Echo hygiene: scripted-oracle and user answers often QUOTE earlier text
// ("Q: <agent question>\nA: <earlier user words>"). Question lines are never
// treated as requirements (handled in the ledger), and when an initial prompt
// is supplied it is SEEDED into the ledger first (it is the original spec) so
// later verbatim echoes of it are recognized as echoes, not new statements.
import { SpecLedger, phraseKey } from "./ledger.js";
import { CorrectionStore, extractCorrections, normKey, guessDimension } from "../phase4/corrections.js";

const ROLE_TRUST = { user: true, assistant: false, agent: false, system: true };

const isTrusted = (m) => {
  if (typeof m.trusted === "boolean") return m.trusted;
  if (typeof m.role === "string") return ROLE_TRUST[String(m.role).toLowerCase()] !== false;
  return true;
};

/** Shape-agnostic session reader. Accepts an A/B transcript record
 *  ({transcript: [{turn, role, kind, text}]}), a raw {messages: [...]} array,
 *  or a plain string (split on blank lines, all trusted). `label` uses the
 *  message POSITION so it aligns with ledger messageIndex (1-based). */
export function messagesFromSession(sessionOrRecord) {
  const tx = sessionOrRecord?.transcript ?? sessionOrRecord?.messages;
  if (Array.isArray(tx)) {
    return tx.map((t, i) => ({
      text: String(t.text ?? ""),
      trusted: isTrusted(t),
      kind: typeof t.kind === "string" ? t.kind : undefined,
      label: `${t.role ?? "?"}/${t.kind ?? "?"}#${i + 1}`,
      turn: t.turn ?? i + 1,
    }));
  }
  if (typeof sessionOrRecord === "string") {
    return sessionOrRecord.split(/\n+/).filter(Boolean)
      .map((t, i) => ({ text: t, trusted: true, label: `line#${i + 1}`, turn: i + 1 }));
  }
  return [];
}

/** Run all messages through the ledger in order. Returns per-message results. */
export function processSession(messages, ledger) {
  const results = [];
  for (const m of messages) {
    results.push({
      label: m.label,
      trusted: m.trusted,
      ...ledger.processMessage(m.text, { trusted: m.trusted, kind: m.kind }),
    });
  }
  return results;
}

/** First sentence-ish chunk of a quote, capped — the correction VALUE is a
 *  candidate for human review, not an executable rule, so coarse is fine. */
const quoteChunk = (s) => {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  const cut = t.search(/[.!?]/);
  return (cut >= 0 ? t.slice(0, cut) : t).trim().slice(0, 40);
};

/** Correction events from one ledger violation. The violated entry's canonical
 *  key IS the feature the user established — use it, not the raw quote chunk
 *  (which carries agent-voice verbs like "add/implement"). */
export function violationToEvents(v) {
  if (!v) return [];
  const feat = String(v.against?.key ?? "").trim();
  if (!feat) return [];
  return [{
    kind: "prohibition",
    dimension: guessDimension(feat),
    value: `no ${feat}`,
    key: normKey(`no ${feat}`),
    replaces: null,
    quote: String(v.quote ?? "").slice(0, 80),
  }];
}

/** Correction events from one drift-judge hit on an agent BUILD/DONE turn.
 *  Marker-specific extraction keeps values meaningful; anything unrecognized
 *  is skipped (conservative — a junk prohibition is worse than none). */
export function agentFlagToEvents(h) {
  if (!h) return [];
  const snippet = String(h.snippet ?? "");
  const pick = (re) => snippet.match(re)?.[0]?.toLowerCase() ?? null;
  let banned = null;
  if (h.marker === "out_of_scope_features") banned = pick(/\b(attachments?|labels?|multiple boards)\b/);
  else if (h.marker === "boards_or_users") banned = /\busers?\b/.test(snippet) ? "additional users" : pick(/\bboards?\b/) ? "additional boards" : null;
  else if (h.marker === "auth") banned = "user accounts";
  else if (h.marker === "extra_metrics") banned = "extra report metrics";
  if (!banned) return [];
  return [{
    kind: "prohibition",
    dimension: guessDimension(banned),
    value: `no ${banned}`,
    key: normKey(`no ${banned}`),
    replaces: null,
    quote: snippet.slice(0, 80),
  }];
}

/** Correction events from a USER message, with quote-hygiene: strip echoed
 *  question lines ("Q: …"), strip "A:"-prefixed bodies that repeat earlier
 *  trusted text (the scripted oracle / multi-answer format), then run the
 *  tested Phase 4 extractor on what remains. */
export function memoryEventsFromUserMessage(text, priorUserTexts = []) {
  const priorLines = new Set();
  const priorBodies = [];
  for (const p of priorUserTexts) {
    const s = String(p ?? "").trim();
    if (!s) continue;
    priorBodies.push(s);
    for (const line of s.split(/\n+/)) priorLines.add(line.trim());
  }
  const kept = [];
  for (const raw of String(text ?? "").split(/\n+/)) {
    const line = raw.trim();
    if (!line || /^Q:\s/i.test(line)) continue;
    const m = line.match(/^A:\s*(.*)$/);
    let body = m ? m[1].trim() : line;
    if (body) {
      for (const p of priorBodies) {
        if (p.includes(body) && body.length > 20) { body = ""; break; } // verbatim echo
      }
    }
    if (body && !priorLines.has(line)) kept.push(body);
  }
  return kept.length ? extractCorrections(kept.join("\n")) : [];
}

/** Record events in the correction store (candidate status; over-fit guard
 *  applies downstream). Source is honest per origin: user-reply corrections
 *  are "reply", ledger violations/agent flags are "ledger-violation". */
export function routeToMemory(events, store, sessionId = null, defaultSource = "ledger-violation") {
  if (!events.length || !store) return [];
  return store.record(
    events.map((e) => ({ source: e.__source ?? defaultSource, ...e })),
    { source: defaultSource, sessionId }
  );
}

/** Full pipeline for one session: seed prompt (optional) → transcript through
 *  the ledger → collect violations + agent flags → route to memory. */
export function wireSession({ record, ledger, store = null, sessionId = null, initialPrompt = null } = {}) {
  const transcriptMsgs = messagesFromSession(record);
  const msgs = initialPrompt
    ? [{ text: String(initialPrompt), trusted: true, label: "prompt#1", turn: 0 }, ...transcriptMsgs.map((m, i) => ({ ...m, label: m.label.replace(/#\d+$/, `#${i + 2}`) }))]
    : transcriptMsgs;
  const results = processSession(msgs, ledger);
  const seedCount = initialPrompt ? 1 : 0; // the seed is the spec, not a reply

  // One canonical preference per feature per session: a structural violation
  // and a judge flag on the same feature are ONE drift signal, not two.
  const canon = (value) => normKey(String(value)).replace(/s$/, "");
  const routed = [];
  const routedFeatures = new Set();
  const pushEvent = (from, messageIndex, entryId, e) => {
    const c = canon(e.value);
    if (!c || routedFeatures.has(c)) return;
    routedFeatures.add(c);
    routed.push({ from, messageIndex, entryId, event: { ...e, __source: from === "user-reply" ? "reply" : "ledger-violation" } });
  };
  results.forEach((r) => {
    for (const v of r.violations) {
      for (const e of violationToEvents(v)) pushEvent("violation", r.messageIndex, v.against?.id ?? null, e);
    }
    if (r.agentFlagged) {
      for (const h of r.judgeHits) {
        for (const e of agentFlagToEvents(h)) pushEvent("agent-flag", r.messageIndex, null, e);
      }
    }
    if (r.trusted && r.messageIndex > seedCount) {
      const priorUserTexts = msgs.slice(0, r.messageIndex - 1).filter((m) => m.trusted).map((m) => m.text);
      for (const e of memoryEventsFromUserMessage(msgs[r.messageIndex - 1].text, priorUserTexts)) {
        pushEvent("user-reply", r.messageIndex, null, e);
      }
    }
  });

  const storeStatuses = routeToMemory(routed.map((r) => r.event), store, sessionId)
    .map((rec) => ({ key: rec.key, value: rec.value, status: rec.status, count: rec.count }));

  return {
    sessionId,
    perMessage: results.map(({ label, trusted, messageIndex, violations, reversals, agentFlagged, judgeHits }) => ({
      label, trusted, messageIndex,
      violationCount: violations.length,
      reversals: reversals.length,
      agentFlagged, judgeHits,
      violations,
    })),
    routed,
    storeStatuses,
    totals: {
      violations: results.reduce((a, r) => a + r.violations.length, 0),
      agentFlaggedTurns: results.filter((r) => r.agentFlagged).length,
      memoryEventsRouted: routed.length,
    },
  };
}
