// Lemonade — Domain Plugin Registry.
//
// Domain-specific adapters live here as optional plugins.
// The generic pipeline ALWAYS runs first; plugins only ADD context.
// They NEVER replace user-stated requirements.

import { SpecItem, PROVENANCE, PRIORITY, SCOPE, STATUS, ITEM_CATEGORY, IMPACT, REVERSIBILITY } from "../spec/model.js";

/**
 * Plugin interface:
 * {
 *   name: string,
 *   description: string,
 *   match(rawPrompt: string): boolean,
 *   enhance(spec: ProjectSpec, rawPrompt: string): ProjectSpec
 * }
 */

const plugins = [];

/** Register a domain plugin. */
export function registerPlugin(plugin) {
  if (!plugin.name || !plugin.match || !plugin.enhance) {
    throw new Error(`Invalid plugin: must have name, match, and enhance`);
  }
  plugins.push(plugin);
}

/** Get all registered plugins. */
export function listPlugins() {
  return plugins.map((p) => ({ name: p.name, description: p.description }));
}

/**
 * Run matching plugins against a spec. Plugins only ADD recommendations;
 * they never modify user-stated items.
 *
 * @param {import("../spec/model.js").ProjectSpec} spec
 * @param {string} rawPrompt
 * @returns {{ spec: import("../spec/model.js").ProjectSpec, applied: string[] }}
 */
export function applyPlugins(spec, rawPrompt) {
  const applied = [];
  for (const plugin of plugins) {
    try {
      if (plugin.match(rawPrompt)) {
        plugin.enhance(spec, rawPrompt);
        applied.push(plugin.name);
      }
    } catch (e) {
      // Plugins must never break the core pipeline
      console.error(`Plugin "${plugin.name}" failed: ${e.message}`);
    }
  }
  return { spec, applied };
}

/** Helper: add a system recommendation to a spec (labeled, non-binding). */
export function addRecommendation(spec, text, { category = ITEM_CATEGORY.SYSTEM_RECOMMENDATION, priority = PRIORITY.SHOULD, impact = IMPACT.MEDIUM } = {}) {
  return spec.addItem(new SpecItem({
    category,
    text,
    provenance: PROVENANCE.SYSTEM_RECOMMENDED,
    confidence: 0.5,
    priority,
    scope: SCOPE.V1,
    status: STATUS.PROPOSED,
    implementationImpact: impact,
    reversibility: REVERSIBILITY.REVERSIBLE,
  }));
}
