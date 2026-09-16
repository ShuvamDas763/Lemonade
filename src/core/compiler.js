// Lemonade — Target-Aware Intent Compiler.
//
// Compiles a canonical ProjectSpec into target-specific agent prompts:
//   - generic markdown
//   - Cursor (.cursorrules / agent mode)
//   - Claude Code (XML structured blocks)
//   - OpenAI-compatible chat messages
//   - structured JSON
//   - coding-agent mode
//   - image-generation mode
//   - research mode
//
// INVARIANT: The underlying ProjectSpec remains identical and stable
// while the presentation format adapts to the target environment.

import { ITEM_CATEGORY, STATUS, PROVENANCE, SCOPE } from "../spec/model.js";
import { exportAgentPrompt, exportToMarkdown, exportToJSON } from "../spec/exporter.js";

/**
 * Compile a ProjectSpec into target-specific format.
 *
 * @param {import("../spec/model.js").ProjectSpec} spec
 * @param {string} [target="coding-agent"]
 * @returns {string|object}
 */
export function compilePrompt(spec, target = "coding-agent") {
  if (!spec) return "";

  const targetLower = String(target).toLowerCase().trim();
  const raw = spec.rawPrompt?.trim() || "";
  const title = spec.title || "Project Specification";

  const bindingReqs = spec.allItems().filter((i) =>
    (i.category === ITEM_CATEGORY.REQUIREMENT || i.category === ITEM_CATEGORY.ACCEPTED_DECISION) &&
    (i.provenance === PROVENANCE.USER_STATED || i.status === STATUS.ACCEPTED) &&
    i.status !== STATUS.REJECTED &&
    i.scope === SCOPE.V1
  );

  const constraints = spec.allItems().filter((i) =>
    (i.category === ITEM_CATEGORY.CONSTRAINT || i.category === ITEM_CATEGORY.NON_NEGOTIABLE) &&
    i.status !== STATUS.REJECTED
  );

  const assumptions = spec.allItems().filter((i) =>
    (i.provenance === PROVENANCE.INFERRED || i.provenance === PROVENANCE.SYSTEM_RECOMMENDED) &&
    i.category !== ITEM_CATEGORY.OPEN_QUESTION &&
    i.status !== STATUS.REJECTED
  );

  const acceptance = spec.allItems().filter((i) =>
    i.category === ITEM_CATEGORY.ACCEPTANCE_CRITERION &&
    i.status !== STATUS.REJECTED
  );

  // 1. Claude Code (Structured XML format)
  if (targetLower === "claude-code" || targetLower === "claude") {
    const lines = [];
    lines.push(`<project_intent title="${escapeXml(title)}">`);
    lines.push(`  <raw_goal>${escapeXml(raw)}</raw_goal>`);
    lines.push("");
    lines.push("  <spec_requirements>");
    for (const r of bindingReqs) {
      lines.push(`    <requirement id="${r.id}" priority="${r.priority}">${escapeXml(r.text)}</requirement>`);
    }
    lines.push("  </spec_requirements>");

    if (constraints.length > 0) {
      lines.push("");
      lines.push("  <constraints>");
      for (const c of constraints) {
        lines.push(`    <constraint>${escapeXml(c.text)}</constraint>`);
      }
      lines.push("  </constraints>");
    }

    if (assumptions.length > 0) {
      lines.push("");
      lines.push("  <visible_assumptions>");
      for (const a of assumptions) {
        lines.push(`    <assumption id="${a.id}" provenance="${a.provenance}">${escapeXml(a.text)}</assumption>`);
      }
      lines.push("  </visible_assumptions>");
    }

    lines.push("");
    lines.push("  <execution_rules>");
    lines.push("    <rule>Build incrementally: verify smallest testable unit first.</rule>");
    lines.push("    <rule>Do not regress or rewrite working code.</rule>");
    lines.push("    <stop_condition>Stop immediately once all specified requirements are verified.</stop_condition>");
    lines.push("  </execution_rules>");
    lines.push("</project_intent>");
    return lines.join("\n");
  }

  // 2. Cursor (.cursorrules / Agent context)
  if (targetLower === "cursor") {
    const lines = [];
    lines.push(`<!-- CURSOR SPEC CONTRACT: ${title} -->`);
    lines.push("## Core Intent");
    lines.push(raw);
    lines.push("");
    lines.push("## Invariant Constraints (DO NOT VIOLATE)");
    lines.push("* Single-shot completion: do not leave placeholder or TODO functions.");
    lines.push("* State preservation: preserve existing patterns and do not delete working code.");
    for (const c of constraints) {
      lines.push(`* ${c.text}`);
    }
    lines.push("");
    lines.push("## Deliverable Requirements");
    for (const r of bindingReqs) {
      lines.push(`- [ ] ${r.text}`);
    }
    if (assumptions.length > 0) {
      lines.push("");
      lines.push("## Active Assumptions");
      for (const a of assumptions) {
        lines.push(`- [ASSUMED: ${a.text}]`);
      }
    }
    lines.push("");
    lines.push("## Verification Checklist");
    if (acceptance.length > 0) {
      for (const ac of acceptance) lines.push(`- [ ] ${ac.text}`);
    } else {
      lines.push("- [ ] Verify code runs with zero console warnings or uncaught exceptions.");
      lines.push("- [ ] Verify core happy-path flow operates end-to-end.");
    }
    return lines.join("\n");
  }

  // 3. OpenAI-Compatible Chat Messages
  if (targetLower === "openai-chat" || targetLower === "chat") {
    const systemPrompt = [
      "You are an expert autonomous software engineer.",
      "Your contract is defined by the following verifiable intent specification.",
      "Strict Rules:",
      "1. Build ONLY what is requested in the V1 specification.",
      "2. Do not silently introduce unrequested libraries, accounts, or telemetry.",
      "3. Stop and explain your changes once acceptance criteria are met.",
    ].join(" ");

    const userPrompt = exportAgentPrompt(spec);

    return [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ];
  }

  // 4. Structured JSON Output
  if (targetLower === "json") {
    return exportToJSON(spec);
  }

  // 5. Image Generation Mode
  if (targetLower === "image-gen" || targetLower === "image") {
    const visualElements = [];
    visualElements.push(`Subject: ${raw}`);
    visualElements.push("Style: clean, editorial, modern digital interface presentation, high aesthetic craftsmanship");
    visualElements.push("Color Palette: restrained neutral graphite canvas, subtle warm lemon accent, crisp contrast");
    visualElements.push("Avoid: cluttered text, random floating elements, low quality, artifacts, watermarks, blurry details");
    return visualElements.join("\n\n");
  }

  // 6. Research Mode
  if (targetLower === "research") {
    const lines = [];
    lines.push(`# Research Inquiry: ${title}`);
    lines.push("");
    lines.push("## Core Objective");
    lines.push(raw);
    lines.push("");
    lines.push("## Key Questions & Investigation Bounds");
    const questions = spec.openQuestions();
    if (questions.length > 0) {
      for (const q of questions) lines.push(`* ${q.text}`);
    } else {
      lines.push("* What are the primary technical trade-offs of this approach?");
      lines.push("* What are the state-of-the-art patterns for this architecture?");
    }
    lines.push("");
    lines.push("## Verification & Evidence Criteria");
    lines.push("1. Cite exact documentation or empirical benchmarks for every assertion.");
    lines.push("2. Clearly distinguish verified facts from speculative assumptions.");
    lines.push("3. Summarize findings with concrete, actionable recommendations.");
    return lines.join("\n");
  }

  // 7. Generic Markdown
  if (targetLower === "markdown") {
    return exportToMarkdown(spec, { mode: "builder" });
  }

  // Default: Coding-Agent Mode (Rules 3.1 - 3.6)
  return exportAgentPrompt(spec);
}

function escapeXml(unsafe) {
  return String(unsafe || "")
    .replace(/[<>&'"]/g, (c) => {
      switch (c) {
        case "<": return "&lt;";
        case ">": return "&gt;";
        case "&": return "&amp;";
        case "'": return "&apos;";
        case '"': return "&quot;";
        default: return c;
      }
    });
}
