import { readFileSync, existsSync } from "node:fs";
import { rewrite } from "./rewriter.js";
import { readFromClipboard } from "../demo/clipboard.js";

const argv = process.argv.slice(2);
let text = "";

if (argv.includes("--clip") || argv.includes("-c")) {
  const clip = await readFromClipboard();
  if (clip.ok && clip.text) text = clip.text.trim();
} else if (argv.includes("--file") || argv.includes("-f")) {
  const idx = argv.findIndex((a) => a === "--file" || a === "-f");
  const file = argv[idx + 1];
  if (file && existsSync(file)) text = readFileSync(file, "utf8").trim();
} else {
  let arg = argv.join(" ").trim();
  if (!arg && !process.stdin.isTTY) {
    try { text = readFileSync(0, "utf8").trim(); } catch {}
  } else {
    text = arg;
  }
}

// Shell truncation recovery (Windows cmd/powershell drops lines on npm run rewrite -- "...")
if (text && !text.includes("\n")) {
  try {
    const clip = await readFromClipboard();
    if (clip.ok && clip.text && clip.text.includes("\n")) {
      const clipNorm = clip.text.trim().toLowerCase();
      const promptNorm = text.trim().toLowerCase();
      if (clipNorm.startsWith(promptNorm.slice(0, Math.min(promptNorm.length, 30)))) {
        text = clip.text.trim();
      }
    }
  } catch {}
}

if (!text) {
  console.log('Usage: node phase2/rewrite-cli.js "<prompt>"  (--clip, -f <file>, or pipe stdin)');
  process.exit(0);
}

const r = await rewrite(text);
if (!r.ok) {
  console.log(`REWRITE REFUSED: ${r.error}`);
  process.exit(1);
}
console.log(r.optimized_prompt);
console.log("\n--- meta ---");
if (r.quality) {
  console.log(`retention: ${r.quality.retentionPercent}%  quality score: ${r.quality.compositeScore}  gate: ${r.quality.passed ? "PASS" : "FAIL"}`);
}
console.log(`assumptions: ${r.assumptions_made.length}  questions: ${r.clarifying_questions.length}  warnings: ${r.warnings.length}`);
for (const w of r.warnings) console.log(`  WARNING [${w.category}] ${w.detail}`);

