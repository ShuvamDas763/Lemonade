// Lemonade — Specification Differ.
// Computes diffs between spec versions and tracks the decision timeline.

import { STATUS, PROVENANCE } from "./model.js";

/**
 * Compare two ProjectSpec instances and produce a structured diff.
 * @param {import("./model.js").ProjectSpec} oldSpec
 * @param {import("./model.js").ProjectSpec} newSpec
 * @returns {{ added: object[], removed: object[], modified: object[], unchanged: number }}
 */
export function diffSpecs(oldSpec, newSpec) {
  const oldIds = new Set(oldSpec ? [...oldSpec.items.keys()] : []);
  const newIds = new Set(newSpec ? [...newSpec.items.keys()] : []);

  const added = [];
  const removed = [];
  const modified = [];
  let unchanged = 0;

  // Items in new but not old
  for (const id of newIds) {
    if (!oldIds.has(id)) {
      const item = newSpec.getItem(id);
      added.push({ id, category: item.category, text: item.text, provenance: item.provenance });
    }
  }

  // Items in old but not new
  for (const id of oldIds) {
    if (!newIds.has(id)) {
      const item = oldSpec.getItem(id);
      removed.push({ id, category: item.category, text: item.text });
    }
  }

  // Items in both — check for changes
  for (const id of newIds) {
    if (!oldIds.has(id)) continue;
    const oldItem = oldSpec.getItem(id);
    const newItem = newSpec.getItem(id);
    const changes = [];

    if (oldItem.status !== newItem.status) changes.push({ field: "status", from: oldItem.status, to: newItem.status });
    if (oldItem.priority !== newItem.priority) changes.push({ field: "priority", from: oldItem.priority, to: newItem.priority });
    if (oldItem.scope !== newItem.scope) changes.push({ field: "scope", from: oldItem.scope, to: newItem.scope });
    if (oldItem.text !== newItem.text) changes.push({ field: "text", from: oldItem.text?.slice(0, 80), to: newItem.text?.slice(0, 80) });
    if (oldItem.implementationStatus !== newItem.implementationStatus) changes.push({ field: "implementationStatus", from: oldItem.implementationStatus, to: newItem.implementationStatus });

    if (changes.length > 0) {
      modified.push({ id, category: newItem.category, text: newItem.text?.slice(0, 80), changes });
    } else {
      unchanged++;
    }
  }

  return { added, removed, modified, unchanged };
}

/**
 * Build a decision timeline from a spec's change history.
 * @param {import("./model.js").ProjectSpec} spec
 * @returns {Array<{ timestamp: string, action: string, itemId: string, detail: string, itemText: string }>}
 */
export function buildTimeline(spec) {
  if (!spec?.changeHistory) return [];
  return spec.changeHistory.map((entry) => {
    const item = spec.getItem(entry.itemId);
    return {
      timestamp: entry.timestamp,
      action: entry.action,
      itemId: entry.itemId,
      detail: entry.detail,
      itemText: item?.text?.slice(0, 100) || "(deleted)",
    };
  });
}

/**
 * Render a human-readable diff report.
 * @param {object} diff - Result from diffSpecs()
 * @returns {string}
 */
export function renderDiffReport(diff) {
  const lines = [];
  lines.push("╔══════════════════════════════════════════════════════════════════╗");
  lines.push("║ SPECIFICATION DIFF REPORT                                        ║");
  lines.push("╚══════════════════════════════════════════════════════════════════╝");
  lines.push("");

  lines.push(`ADDED (${diff.added.length}):`);
  if (diff.added.length === 0) lines.push("  (none)");
  for (const a of diff.added) lines.push(`  + [${a.category}] ${a.text?.slice(0, 80)} (${a.provenance})`);
  lines.push("");

  lines.push(`REMOVED (${diff.removed.length}):`);
  if (diff.removed.length === 0) lines.push("  (none)");
  for (const r of diff.removed) lines.push(`  - [${r.category}] ${r.text?.slice(0, 80)}`);
  lines.push("");

  lines.push(`MODIFIED (${diff.modified.length}):`);
  if (diff.modified.length === 0) lines.push("  (none)");
  for (const m of diff.modified) {
    lines.push(`  ~ [${m.category}] ${m.text}`);
    for (const c of m.changes) lines.push(`    ${c.field}: "${c.from}" → "${c.to}"`);
  }
  lines.push("");

  lines.push(`UNCHANGED: ${diff.unchanged}`);
  return lines.join("\n");
}
