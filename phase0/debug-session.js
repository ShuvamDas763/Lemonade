// Debug: run one pair's two sessions and print full transcripts.
import { runSession } from "./backends/ollama.js";
import fs from "node:fs";

const dataset = JSON.parse(fs.readFileSync(new URL("./prompts.dataset.json", import.meta.url), "utf8"));
const pairId = process.argv[2] ?? "bookswipe";
const pair = dataset.pairs.find((p) => p.id === pairId);

for (const variant of ["ambiguous", "explicit"]) {
  const rec = await runSession(
    { text: pair[variant].text, plantedPatterns: [] },
    { pairId, variant, runIndex: 0, referenceText: pair.explicit.text }
  );
  console.log(`\n=== ${pairId} / ${variant} === turns=${rec.turns} tokens=${rec.totalTokens} completed=${rec.completed}`);
  for (const t of rec.transcript) console.log(`  [T${t.turn} ${t.kind ?? t.role}] ${t.text.replace(/\n+/g, " | ").slice(0, 300)}`);
}
