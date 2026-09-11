#!/usr/bin/env node
// Phase 2 verification against the Phase 0 dataset (exit criteria):
//   - every rewrite embeds the original prompt VERBATIM (preservation by
//     construction)
//   - additions are ONLY labeled assumptions + open questions from flags
//   - contradiction self-check reports 0 warnings (intent-match gate)
//   - edge cases: empty / one-word / ~3k-word prompts, no crashes
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { rewrite } from "./rewriter.js";
import { verify } from "../phase3/verifier.js";
import { extractCorrections, CorrectionStore } from "../phase4/corrections.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataset = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "phase0", "prompts.dataset.json"), "utf8"));

let failures = 0;
const check = (label, cond) => {
  if (!cond) {
    failures++;
    console.log(`  FAIL: ${label}`);
  }
  return cond;
};

for (const pair of dataset.pairs) {
  for (const variant of ["ambiguous", "explicit"]) {
    const raw = pair[variant].text;
    const r = await rewrite(raw, { mode: "verbatim" });
    console.log(`${pair.id}/${variant.padEnd(9)} ok=${r.ok} assumptions=${r.assumptions_made.length} questions=${r.clarifying_questions.length} warnings=${r.warnings.length}`);
    check(`${pair.id}/${variant} ok`, r.ok);
    check(`${pair.id}/${variant} verbatim`, r.optimized_prompt.includes(raw.trim()));
    check(`${pair.id}/${variant} additions labeled`, r.assumptions_made.every((a) => a.text.startsWith("[ASSUMED:") && r.optimized_prompt.includes(a.text)));
    check(`${pair.id}/${variant} removals empty`, r.changes.removed.length === 0 && r.changes.modified.length === 0);
    check(`${pair.id}/${variant} zero warnings`, r.warnings.length === 0);
  }
}

console.log("\n=== EDGE CASES ===");
const cases = [
  ["empty prompt", ""],
  ["one-word prompt", "app"],
  ["very long prompt (~3k words)", "Build an app with these details. ".repeat(400)],
];
for (const [label, text] of cases) {
  const r = await rewrite(text, { mode: "verbatim" });
  if (label === "empty prompt") {
    check("empty refused gracefully", r.ok === false && Array.isArray(r.warnings));
    console.log(`EDGE OK  ${label.padEnd(30)} -> refused: "${r.error}"`);
  } else {
    check(`edge ${label} ok`, r.ok && r.optimized_prompt.includes(text.trim()));
    console.log(`EDGE OK  ${label.padEnd(30)} -> assumptions=${r.assumptions_made.length} questions=${r.clarifying_questions.length}`);
  }
}

console.log("\n=== PROMPT OPTIMIZER (Requirements Engineer + Prompt Compressor) ===");
{
  const expensePrompt = `i want to make a website for tracking expenses because i always forget where my money is going 😭
basically i want to add an expense like food 250 or travel 500 and it should save it and show me how much i spent.
i want a dashboard where i can see total spending and maybe a pie chart or something showing food travel shopping etc.
also there should be like monthly spending so i can select a month and see what i spent that month. maybe add income also so it can tell me how much money i have left.
i want login also so each user has their own expenses and nobody else can see them.
i dont really care what database you use, just use something that is easy and free for now. frontend can be react. make the design nice but dont make it too complicated.
can you build it from scratch and explain what i need to install because im not very experienced with this.
first make the basic version actually work and then we can add things like editing expenses, exporting data and notifications later.
if you think something should be added just tell me first instead of randomly adding it.`;

  const optR = await rewrite(expensePrompt, { mode: "optimize" });
  check("optimizer ok", optR.ok);
  check("goal preserved concisely", optR.optimized_prompt.includes("## Goal") && optR.optimized_prompt.includes("Build a basic expense-tracking web app"));
  check("auth requirement preserved", optR.optimized_prompt.includes("User registration/login"));
  check("privacy requirement preserved", optR.optimized_prompt.includes("access their own expenses"));
  check("expense entry preserved", optR.optimized_prompt.includes("Add and save expenses"));
  check("dashboard & pie chart preserved", optR.optimized_prompt.includes("Dashboard showing total spending") && optR.optimized_prompt.includes("pie chart"));
  check("monthly spending preserved", optR.optimized_prompt.includes("Monthly spending view with month selection"));
  check("income preserved", optR.optimized_prompt.includes("Income entry and remaining-balance calculation"));
  check("tech direction distinguishes preference vs decision", optR.optimized_prompt.includes("React is preferred") && optR.optimized_prompt.includes("simple, free/easy-to-run"));
  check("future scope preserved without deletion", optR.optimized_prompt.includes("Editing, exporting, and notifications are future features"));
  check("stop condition present", optR.optimized_prompt.includes("Stop once the V1 requirements work end-to-end"));
  check("gate passes requirement-preservation check", verify(expensePrompt, optR).ok);

  const studyPrompt = `i want to make a website for college students to find study partners.

basically students should be able to make a profile with their name, course and what subjects they are studying, and then find other students who are studying the same subjects.

there should be some kind of search where i can type a subject like maths and see people who have maths in their profile.

also maybe show them based on college if possible because it would be better to find someone from the same college.

i want users to be able to send a request to another student and if they accept then they can chat with each other.

login should be there obviously and users should only be able to edit their own profile.

i want the homepage to show some recommended study partners too, maybe based on subjects they have in common.

make it look modern and kind of like a social app but not too much, it should still feel like a study website.

i dont know what backend or database to use so you decide something simple. react is probably fine for frontend.

for now just make the basic thing work, later we can add notifications, group study rooms and maybe video calls.

also please dont make it super complicated because i want to understand the code and run it locally.`;

  const studyR = await rewrite(studyPrompt, { mode: "optimize" });
  check("study optimizer ok", studyR.ok);
  check("study retention >= 90%", studyR.quality?.retentionPercent >= 90);
  check("study composite score >= 90", studyR.quality?.compositeScore >= 90);
  check("study profiles with fields", studyR.optimized_prompt.includes("Student profiles containing name, course, college, and subjects"));
  check("study search subject", studyR.optimized_prompt.includes("Search students by subject"));
  check("study college filter", studyR.optimized_prompt.includes("college"));
  check("study partner requests", studyR.optimized_prompt.includes("requests"));
  check("study chat", studyR.optimized_prompt.includes("chat"));
  check("study edit own profile", studyR.optimized_prompt.includes("edit only their own profile"));
  check("study recommendations", studyR.optimized_prompt.includes("recommended study partners"));
  check("study UX", studyR.optimized_prompt.includes("social-app feel") && studyR.optimized_prompt.includes("study-focused"));
  check("study tech", studyR.optimized_prompt.includes("React is preferred"));
  check("study future scope", studyR.optimized_prompt.includes("Notifications, group study rooms, and video calls are future features"));
  check("study gate passes", verify(studyPrompt, studyR).ok);
}

console.log("\n=== MEMORY PREFERENCES (Phase 4 integration, isolated temp store) ===");
{
  const storePath = path.join(os.tmpdir(), `lemonade-p2-verify-${process.pid}-${Date.now()}.json`);
  const store = new CorrectionStore(storePath);
  // Same correction twice -> standing (over-fit guard), dimension=stack.
  store.record(extractCorrections("no, use Vue, not React"), { source: "p2-verify-1" });
  store.record(extractCorrections("no, use Vue, not React"), { source: "p2-verify-2" });

  const raw1 = "build me a portfolio website to showcase my design work";
  const r1 = await rewrite(raw1, { memoryPath: storePath });
  const texts = r1.assumptions_made.map((a) => a.text);
  const hasPref = texts.some((t) => t.includes("USER PREFERENCE") && t.includes("Vue"));
  const hasStackDefault = texts.some((t) => t.startsWith("[ASSUMED:") && /react|typescript/i.test(t));
  check("standing preference applied as labeled assumption", hasPref);
  check("stack default REPLACED by preference (no contradictory pair)", hasPref && !hasStackDefault);
  check("override recorded visibly in memory.overrides", (r1.memory.overrides ?? []).some((o) => o.category === "missing_stack"));
  check("phase 3 gate still passes with preference applied", verify(raw1, r1).ok);

  const store2Path = path.join(os.tmpdir(), `lemonade-p2-verify-c-${process.pid}-${Date.now()}.json`);
  const store2 = new CorrectionStore(store2Path);
  store2.record(extractCorrections("no, use Vue, not React"), { source: "p2-verify-3" }); // candidate only
  const r2 = await rewrite("build a recipe box web app", { memoryPath: store2Path });
  check("candidate-only store is never applied (over-fit guard)", r2.memory.applied.length === 0);

  fs.rmSync(storePath, { force: true });
  fs.rmSync(store2Path, { force: true });
  console.log(`MEM OK   pref applied=${JSON.stringify(r1.memory.applied)}  overrides=${JSON.stringify((r1.memory.overrides ?? []).map((o) => o.category))}`);
}

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);

// Show 3 full examples for human intent-review (Self-Verification Protocol).
if (failures === 0) {
  for (const id of ["bookswipe", "invoice-generator", "kanban"]) {
    const pair = dataset.pairs.find((p) => p.id === id);
    const r = await rewrite(pair.ambiguous.text);
    console.log(`\n${"=".repeat(72)}\nEXAMPLE: ${id} (ambiguous variant)\n${"=".repeat(72)}`);
    console.log(r.optimized_prompt);
  }
}
process.exit(failures === 0 ? 0 : 1);
