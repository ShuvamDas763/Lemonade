// Optional deeper check (opt-in): feed ONLY the optimized prompt to a free
// local model and ask what the user asked for; diff its reconstruction against
// the real original. ADVISORY ONLY — a small model's reconstruction is noisy,
// so this can never flip the deterministic gate; it adds flagged "hmm" signals
// for human review. Zero cost (Ollama), consistent with constraint #2.
const OLLAMA_URL = process.env.OLLAMA_URL ?? "http://localhost:11434";
const MODEL = process.env.OLLAMA_MODEL ?? "qwen2.5:3b";

const PROMPT = `Below is a prompt that was sent to a coding agent. Reconstruct the user's ORIGINAL request in your own words: what did they ask for? Reply with only the user's apparent requirements as plain sentences, no preamble.

---
PROMPT:
`;

async function chat(text) {
  const res = await fetch(`${OLLAMA_URL}/api/generate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: MODEL, prompt: text, stream: false, options: { temperature: 0.2, num_predict: 220 } }),
    signal: AbortSignal.timeout(120000),
  });
  if (!res.ok) throw new Error(`Ollama HTTP ${res.status}: ${await res.text()}`);
  const j = await res.json();
  return j.response ?? "";
}

const words = (t) => new Set(String(t).toLowerCase().match(/[a-z0-9][a-z0-9'+.-]*/g) ?? []);

/** Returns advisory flags: original requirements words the reconstruction omitted. */
export async function deepCheck(rawPrompt, optimizedPrompt) {
  let recon;
  try {
    recon = await chat(PROMPT + optimizedPrompt + "\n---");
  } catch (e) {
    return { available: false, reason: e.message, flags: [] };
  }
  const have = words(recon);
  const missing = [...words(rawPrompt)]
    .filter((w) => w.length >= 5)
    .filter((w) => !have.has(w));
  return { available: true, reconstruction: recon.trim().slice(0, 500), flags: missing.slice(0, 12).map((w) => w) };
}
