// Optional local-LLM fallback for the Rewriter (OFF by default).
// Scope is deliberately tiny: it can ONLY phrase a clarifying question when a
// no-safe-default flag has no canned question (currently never — all rules
// ship canned questions). It never rewrites, paraphrases, or overrides
// heuristic output. Any failure returns null and the caller falls back to a
// deterministic generic question. Free/local (Ollama) only, per constraint #2.
const OLLAMA_URL = process.env.OLLAMA_URL ?? "http://localhost:11434";
const MODEL = process.env.OLLAMA_MODEL ?? "qwen2.5:3b";

export async function phraseClarifyingQuestion(rawPrompt, flag) {
  try {
    const res = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        stream: false,
        options: { temperature: 0.2, num_predict: 80 },
        messages: [
          {
            role: "system",
            content: "You write ONE short clarifying question for a coding request. Reply with the question only - no preamble, no numbering.",
          },
          {
            role: "user",
            content: `Request: "${String(rawPrompt).slice(0, 800)}"\nAmbiguous aspect: ${flag.category} (${flag.evidence}).\nWrite one concrete question asking the user to specify this aspect.`,
          },
        ],
      }),
      signal: AbortSignal.timeout(60000),
    });
    if (!res.ok) return null;
    const j = await res.json();
    const text = (j.message?.content ?? "").trim();
    return text ? text.split("\n")[0].slice(0, 300) : null;
  } catch {
    return null;
  }
}
