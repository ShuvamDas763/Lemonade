#!/usr/bin/env node
// Phase 6 — Inline Ambiguity Linter (reuses Phase 1's rule engine verbatim).
//
//   node phase6/lint-cli.js <file> [--json] [--min-severity N] [--strict]
//   cat <file> | node phase6/lint-cli.js --stdin
//
// Highlights every phrase the detector flags, in place:
//   path:line:col  [R3] vague_scope (sev 1) -> assumption available
//       evidence: subjective/open-ended qualifier: "nice, stuff"
//       12 | make it look nice and simple
//          |               ^^^^      ^^^^^^
//       suggestion: [ASSUMED: ...]
//
// Exit codes: 0 normally; with --strict, 1 when any flag >= --min-severity
// (default 1) is found — usable as a commit/CI gate. --json emits machine-
// readable spans for editor integrations. No model calls, no dependencies.
import fs from "node:fs";
import path from "node:path";
import { detectSpans } from "../phase1/detector.js";

/** Map character spans to 1-based line/col. */
export function withLineCol(text, spans) {
  const lineStarts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === "\n") lineStarts.push(i + 1);
  const loc = (start) => {
    let lo = 0, hi = lineStarts.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (lineStarts[mid] <= start) lo = mid; else hi = mid - 1; }
    return { line: lo + 1, col: start - lineStarts[lo] + 1 };
  };
  return spans.map((s) => ({ ...s, ...loc(s.start) }));
}

/** Render one flag with caret underlines under its phrases. */
export function renderFlag(text, flag, sourceLabel) {
  const lines = text.split("\n");
  const out = [];
  const first = flag.spans[0];
  const where = first ? `${sourceLabel}:${first.line}:${first.col}` : sourceLabel;
  out.push(`${where}  [${flag.id}] ${flag.category} (sev ${flag.severity}) -> ${flag.resolution === "assumption" ? "assumption available" : "needs an answer"}`);
  out.push(`    evidence: ${flag.evidence}`);
  if (first) {
    const lineNo = String(first.line).padStart(4);
    const lineText = (lines[first.line - 1] ?? "").replace(/\t/g, "  ");
    const carets = Array.from({ length: lines.length }, () => "");
    for (const s of flag.spans) {
      const col = s.col - 1;
      carets[s.line - 1] = (carets[s.line - 1].padEnd(col, " ") + "^".repeat(Math.max(1, s.end - s.start))).trimEnd();
    }
    out.push(`    ${lineNo} | ${lineText}`);
    for (let i = 0; i < carets.length; i++) {
      if (carets[i]) out.push(`      ${String(i + 1).padStart(String(lineNo).trim().length)} | ${carets[i]}`);
    }
  } else {
    out.push(`    (prompt-level: no specific phrase)`);
  }
  out.push(`    suggestion: ${flag.suggestion ?? "(none)"}`);
  return out.join("\n");
}

// ---- main ----
const args = process.argv.slice(2);
const json = args.includes("--json");
const strict = args.includes("--strict");
const minSev = (() => { const i = args.indexOf("--min-severity"); return i >= 0 ? Number(args[i + 1]) || 1 : 1; })();
const stdin = args.includes("--stdin");
const fileArg = args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--min-severity");

let text, sourceLabel;
if (stdin) {
  text = fs.readFileSync(0, "utf8");
  sourceLabel = "<stdin>";
} else if (fileArg) {
  const p = path.resolve(fileArg);
  if (!fs.existsSync(p) || !fs.statSync(p).isFile()) {
    console.error(`not a file: ${p}`);
    process.exit(2);
  }
  text = fs.readFileSync(p, "utf8");
  sourceLabel = fileArg;
} else {
  console.log("Usage: lint-cli.js <file> [--json] [--min-severity N] [--strict]  |  --stdin");
  process.exit(2);
}

const flags = detectSpans(text)
  .map((f) => ({ ...f, spans: withLineCol(text, f.spans) }))
  .filter((f) => f.severity >= minSev);

if (json) {
  console.log(JSON.stringify({ file: sourceLabel, chars: text.length, flagCount: flags.length, ok: !strict || flags.length === 0, flags }, null, 2));
} else {
  if (flags.length === 0) {
    console.log(`${sourceLabel}: no ambiguity flags (min severity ${minSev})`);
  } else {
    for (const f of flags) console.log(renderFlag(text, f, sourceLabel) + "\n");
    console.log(`${flags.length} flag(s) (min severity ${minSev})${strict ? "" : " — use --json for editor integration, --strict to gate"}`);
  }
}
process.exit(strict && flags.length > 0 ? 1 : 0);
