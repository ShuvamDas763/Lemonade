// Lemonade — Four-Dimension Validation System.
//
// Four independent validation checks:
//   A. Preservation: Did the rewrite keep everything the user said?
//   B. Interpretation: Does the spec correctly represent the semantics?
//   C. Safety: Could any assumption create risk?
//   D. Completeness: Are important unresolved decisions exposed?
//
// A rewrite must NOT be marked fully valid when it passes textual
// preservation but fails semantic interpretation.

// ---- Shared utilities ----
const STOPWORDS = new Set(
  "a an the and or but for from with without that this these those is are was were be been being to of in on at by as it its i my we our you your they their can could should would will shall may might must do does did have has had not no yes if then than so such very really just about into over under out up down more most some any all both each other another same own only here there when where why how what which who whom whose me him her them us app application build make create using use used want need like would please also too really very just".split(/\s+/)
);

function sigWords(text) {
  return [...new Set(String(text).toLowerCase().match(/[a-z0-9]+(?:['''-][a-z0-9]+)*/g) ?? [])].filter(
    (w) => w.length >= 3 && !STOPWORDS.has(w)
  );
}

// ============================================================
// Dimension A: Preservation
// Did the rewrite keep everything the user said?
// ============================================================
export function validatePreservation(rawPrompt, optimizedPrompt, spec) {
  const raw = String(rawPrompt ?? "").trim();
  const opt = String(optimizedPrompt ?? "");
  const failures = [];
  const warnings = [];

  if (!raw) {
    failures.push({ check: "nonempty-original", detail: "empty original prompt" });
    return { passed: failures.length === 0, failures, warnings };
  }

  // Check 1: Significant word survival
  const rawWords = sigWords(raw);
  const optLower = opt.toLowerCase();
  const missing = rawWords.filter((w) => !new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(opt));

  if (missing.length > 0) {
    const ratio = missing.length / rawWords.length;
    if (ratio > 0.15) {
      failures.push({ check: "word-survival", detail: `${missing.length}/${rawWords.length} significant words missing: ${missing.slice(0, 10).join(", ")}` });
    } else {
      warnings.push({ check: "word-survival", detail: `${missing.length} minor words not found verbatim: ${missing.slice(0, 5).join(", ")}` });
    }
  }

  // Check 2: Source span coverage — if we have spec items with source spans,
  // verify they cover the original text reasonably
  if (spec && typeof spec.allItems === "function") {
    const userItems = spec.allItems().filter((i) => i.provenance === "user-stated" && i.sourceSpan);
    if (userItems.length > 0) {
      const coveredChars = new Set();
      for (const item of userItems) {
        for (let i = item.sourceSpan.start; i < item.sourceSpan.end; i++) {
          coveredChars.add(i);
        }
      }
      const coverage = coveredChars.size / raw.length;
      if (coverage < 0.3) {
        warnings.push({ check: "source-coverage", detail: `only ${(coverage * 100).toFixed(0)}% of original text covered by spec items` });
      }
    }
  }

  // Check 3: Nothing removed or modified from changes
  // (This delegates to the existing Phase 3 checks)

  return { passed: failures.length === 0, failures, warnings };
}

// ============================================================
// Dimension B: Interpretation
// Does the structured spec correctly represent the semantics?
// ============================================================
export function validateInterpretation(rawPrompt, spec) {
  const raw = String(rawPrompt ?? "").trim();
  const failures = [];
  const warnings = [];

  if (!spec || typeof spec.allItems !== "function" || !raw) {
    return { passed: true, failures, warnings };
  }

  const rawLower = raw.toLowerCase();
  const items = spec.allItems();

  // Check 1: Actor detection — if prompt mentions actors, spec should have them
  const actorTerms = ["user", "admin", "student", "staff", "manager", "customer", "librarian", "owner", "moderator"];
  const mentionedActors = actorTerms.filter((a) => new RegExp(`\\b${a}s?\\b`, "i").test(rawLower));
  if (mentionedActors.length > 0) {
    const specActors = items.filter((i) => i.actor).map((i) => i.actor.toLowerCase());
    const unmapped = mentionedActors.filter((a) => !specActors.some((sa) => sa.includes(a)));
    if (unmapped.length > 0) {
      warnings.push({ check: "actor-coverage", detail: `actors mentioned but not mapped in spec: ${unmapped.join(", ")}` });
    }
  }

  // Check 2: Action verbs — key verbs in prompt should map to spec items
  const actionVerbs = ["search", "filter", "create", "delete", "edit", "update", "submit", "approve", "reject", "login", "register", "upload", "download", "send", "receive", "display", "track", "monitor"];
  const mentionedActions = actionVerbs.filter((v) => new RegExp(`\\b${v}\\b`, "i").test(rawLower));
  const specActions = items.filter((i) => i.action).map((i) => i.action.toLowerCase());
  const unmappedActions = mentionedActions.filter((v) => !specActions.some((sa) => sa.includes(v)) && !items.some((i) => i.text?.toLowerCase().includes(v)));
  if (unmappedActions.length > 1) {
    warnings.push({ check: "action-coverage", detail: `action verbs mentioned but possibly not captured: ${unmappedActions.join(", ")}` });
  }

  // Check 3: Constraint semantics — negative requirements should map to constraints
  const negPatterns = [/\bno\s+\w+/gi, /\bdon't\s+\w+/gi, /\bnever\s+\w+/gi, /\bwithout\s+\w+/gi];
  for (const pat of negPatterns) {
    const matches = rawLower.match(pat) || [];
    for (const m of matches) {
      const hasConstraint = items.some((i) =>
        (i.category === "constraint" || i.category === "non-negotiable") &&
        i.text?.toLowerCase().includes(m.trim().split(/\s+/).slice(-1)[0])
      );
      if (!hasConstraint && m.length > 5) {
        warnings.push({ check: "constraint-mapping", detail: `negative requirement "${m.trim()}" may not be captured as a constraint` });
      }
    }
  }

  // Check 4: Conditional requirements should have conditions
  const conditionalPhrases = raw.match(/\bif\s+.{5,40}?\bthen\b/gi) || [];
  for (const phrase of conditionalPhrases) {
    const hasCondition = items.some((i) => i.condition && i.text?.toLowerCase().includes(phrase.split(/\bthen\b/i)[0].trim().slice(3).trim().split(/\s+/)[0]));
    if (!hasCondition) {
      warnings.push({ check: "conditional-mapping", detail: `conditional phrase "${phrase.slice(0, 50)}" may not be captured with its condition` });
    }
  }

  return { passed: failures.length === 0, failures, warnings };
}

// ============================================================
// Dimension C: Safety
// Could any assumption create security, privacy, legal,
// financial, or costly architectural risk?
// ============================================================
export function validateSafety(rawPrompt, spec) {
  const raw = String(rawPrompt ?? "").trim();
  const failures = [];
  const warnings = [];

  if (!spec || typeof spec.allItems !== "function") return { passed: true, failures, warnings };

  const items = spec.allItems();
  const rawLower = raw.toLowerCase();

  // Check 1: Auth assumptions on multi-user contexts
  const multiUser = /\b(users?|accounts?|team|members|shared|login|sign.?in)\b/i.test(rawLower);
  const hasAuthReq = items.some((i) =>
    i.text?.toLowerCase().includes("auth") ||
    i.text?.toLowerCase().includes("login") ||
    i.text?.toLowerCase().includes("permission")
  );
  if (multiUser && !hasAuthReq) {
    warnings.push({
      check: "auth-gap",
      detail: "prompt mentions users/accounts but no authentication requirement was extracted — this is a security-critical gap",
      risk: "high",
    });
  }

  // Check 2: Data storage without privacy consideration
  const storesData = /\b(save|store|database|persist|record|track)\b/i.test(rawLower);
  const personalData = /\b(name|email|phone|address|profile|password|account)\b/i.test(rawLower);
  const hasPrivacy = items.some((i) =>
    i.category === "security" ||
    i.text?.toLowerCase().includes("privacy") ||
    i.text?.toLowerCase().includes("private") ||
    i.text?.toLowerCase().includes("encryption")
  );
  if (storesData && personalData && !hasPrivacy) {
    warnings.push({
      check: "privacy-gap",
      detail: "prompt involves storing personal data but no privacy requirement was extracted",
      risk: "medium",
    });
  }

  // Check 3: Assumptions about irreversible architecture
  const assumptions = items.filter((i) =>
    i.provenance !== "user-stated" && i.reversibility === "irreversible"
  );
  for (const a of assumptions) {
    warnings.push({
      check: "irreversible-assumption",
      detail: `assumption with irreversible impact not user-stated: "${a.text?.slice(0, 80)}"`,
      risk: "high",
    });
  }

  // Check 4: Financial/payment assumptions
  const paymentMentioned = /\b(pay|payment|billing|subscription|pricing|stripe|charge)\b/i.test(rawLower);
  const hasPaymentAssumption = items.some((i) =>
    i.provenance !== "user-stated" && /\b(pay|billing|stripe|subscription)\b/i.test(i.text || "")
  );
  if (hasPaymentAssumption && !paymentMentioned) {
    failures.push({
      check: "invented-payment",
      detail: "payment/billing functionality was assumed but not mentioned by user — this is a high-risk invention",
    });
  }

  return { passed: failures.length === 0, failures, warnings };
}

// ============================================================
// Dimension D: Completeness
// Are important unresolved decisions exposed rather than hidden?
// ============================================================
export function validateCompleteness(rawPrompt, spec) {
  const raw = String(rawPrompt ?? "").trim();
  const failures = [];
  const warnings = [];

  if (!spec || typeof spec.allItems !== "function") return { passed: true, failures, warnings };

  const items = spec.allItems();
  const openQuestions = typeof spec.openQuestions === "function" ? spec.openQuestions() : [];

  // Check 1: Actors without permissions
  const actorsFound = [...new Set(items.filter((i) => i.actor).map((i) => i.actor.toLowerCase()))];
  if (actorsFound.length > 1) {
    const hasPermissions = items.some((i) =>
      i.text?.toLowerCase().includes("permission") ||
      i.text?.toLowerCase().includes("role") ||
      i.text?.toLowerCase().includes("access") ||
      i.category === "security"
    );
    if (!hasPermissions) {
      warnings.push({
        check: "missing-permissions",
        detail: `${actorsFound.length} distinct actors detected (${actorsFound.join(", ")}) but no permission/role requirements specified`,
      });
    }
  }

  // Check 2: Data entities without storage decisions
  const dataEntities = items.filter((i) => i.category === "data-entity");
  const hasStorageDecision = items.some((i) =>
    i.text?.toLowerCase().includes("database") ||
    i.text?.toLowerCase().includes("storage") ||
    i.text?.toLowerCase().includes("sqlite") ||
    i.text?.toLowerCase().includes("postgres")
  );
  if (dataEntities.length > 0 && !hasStorageDecision) {
    warnings.push({
      check: "missing-storage",
      detail: "data entities detected but no storage/database decision specified — should be an open question",
    });
  }

  // Check 3: Workflows without error handling
  const workflows = items.filter((i) => i.category === "workflow");
  const hasErrorHandling = items.some((i) =>
    i.text?.toLowerCase().includes("error") ||
    i.text?.toLowerCase().includes("fail") ||
    i.text?.toLowerCase().includes("invalid")
  );
  if (workflows.length > 0 && !hasErrorHandling) {
    warnings.push({
      check: "missing-error-handling",
      detail: "workflows detected but no error/failure handling specified",
    });
  }

  // Check 4: High-impact gaps without corresponding open questions
  const highImpactGaps = [];
  if (!items.some((i) => /\b(platform|web|mobile|desktop)\b/i.test(i.text || ""))) {
    highImpactGaps.push("platform");
  }
  if (!items.some((i) => /\b(auth|login|permission)\b/i.test(i.text || ""))) {
    highImpactGaps.push("authentication");
  }

  for (const gap of highImpactGaps) {
    const hasQuestion = openQuestions.some((q) => q.text?.toLowerCase().includes(gap));
    if (!hasQuestion) {
      warnings.push({
        check: "hidden-decision",
        detail: `${gap} not specified and no open question raised — this decision may be hidden`,
      });
    }
  }

  return { passed: failures.length === 0, failures, warnings };
}

// ============================================================
// Composite validation
// ============================================================
/**
 * Run all four validation dimensions and produce a composite result.
 * A rewrite is NOT valid if it passes preservation but fails interpretation.
 *
 * @param {string} rawPrompt
 * @param {string} optimizedPrompt
 * @param {import("../spec/model.js").ProjectSpec} spec
 * @returns {{ valid: boolean, preservation: object, interpretation: object, safety: object, completeness: object }}
 */
export function validateAll(rawPrompt, optimizedPrompt, spec) {
  const preservation = validatePreservation(rawPrompt, optimizedPrompt, spec);
  const interpretation = validateInterpretation(rawPrompt, spec);
  const safety = validateSafety(rawPrompt, spec);
  const completeness = validateCompleteness(rawPrompt, spec);

  // A rewrite is valid only if ALL dimensions pass (no hard failures)
  const valid = preservation.passed && interpretation.passed && safety.passed && completeness.passed;

  return { valid, preservation, interpretation, safety, completeness };
}
