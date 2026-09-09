// REAL backend — Anthropic Messages API (PAID; must be explicitly opted into
// via `--yes`). Same scripted-user protocol as the Ollama backend. Tokens are
// measured from real API usage; we print a cost estimate with rough list
// prices so the run stays within the project's cost-discipline constraint.
const MODEL = process.env.ANTHROPIC_MODEL ?? "claude-3-5-haiku-latest";
// Rough list prices ($/MTok) for the cost estimate printout only.
const PRICE_IN = 0.8;
const PRICE_OUT = 4.0;

const SYSTEM = `You are a coding agent working inside an IDE. The user gives you an app request.
Each turn reply in EXACTLY one of these formats:
CLARIFY: <question 1> | <question 2>   (at most 2 questions, ONLY if a critical requirement is missing or ambiguous)
BUILD: <one sentence describing what you build this turn>
DONE: <one sentence summarizing the finished app>   (when the app is complete)`;

export function assertConsent(consented) {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is not set. This backend is PAID - set the key only if you accept the cost.");
  }
  if (!consented) {
    throw new Error("Anthropic backend costs real money. Re-run with --yes to confirm you accept the cost.");
  }
}

async function chat(messages) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 300,
      temperature: 0.2,
      system: SYSTEM,
      messages,
    }),
    signal: AbortSignal.timeout(120000),
  });
  if (!res.ok) throw new Error(`Anthropic HTTP ${res.status}: ${await res.text()}`);
  const j = await res.json();
  return {
    content: j.content?.map((c) => c.text).join("\n") ?? "",
    promptTokens: j.usage?.input_tokens ?? 0,
    completionTokens: j.usage?.output_tokens ?? 0,
  };
}

function parseResponse(text) {
  const t = String(text);
  const re = /\b(Clarify|Build|Done)\s*[:：]/gi;
  const found = [...t.matchAll(re)];
  if (found.length === 0) return { kind: "BUILD", rest: t.trim() };
  const kinds = new Set(found.map((m) => m[1].toUpperCase()));
  if (kinds.size >= 2) return { kind: "BUILD", rest: t.trim() };
  const m = found[0];
  return { kind: m[1].toUpperCase(), rest: t.slice(m.index + m[0].length).trim() };
}

function parseQuestions(rest) {
  const cleaned = String(rest).replace(/^\s*\d+[.)]\s*/gm, "|");
  return cleaned
    .split(/\||\n+/)
    .map((s) => s.replace(/^[-*•:\d.)\s]+/, "").trim())
    .filter((s) => s.length > 3)
    .slice(0, 2);
}

export async function runSession(prompt, { pairId, variant, runIndex = 0, referenceText = "" } = {}) {
  const messages = [{ role: "user", content: prompt.text }];
  let turns = 0, inTok = 0, outTok = 0, corrections = 0;
  let progress = 0, completed = false;
  const events = [];
  const transcript = [];

  // Oracle state: same global patience ladder as the Ollama backend
  // (1st clarify turn -> spec sentences, 2nd -> proceed directive, 3rd+ -> hard stop).
  const scriptedAnswer = (question) => {
    const qWords = new Set((question.toLowerCase().match(/[a-z]{4,}/g) ?? []));
    let best = null, bestScore = 0;
    for (const sentence of referenceText.split(/(?<=[.!?])\s+/)) {
      const sWords = new Set((sentence.toLowerCase().match(/[a-z]{4,}/g) ?? []));
      let score = 0;
      for (const w of qWords) if (sWords.has(w)) score++;
      if (score > bestScore) { bestScore = score; best = sentence.trim(); }
    }
    return bestScore > 0 ? best : "Not specified - use your best judgment.";
  };
  let clarifyTurns = 0;
  const usedAnswers = new Set();
  const oracleReply = (questions) => {
    clarifyTurns++;
    if (clarifyTurns >= 3) {
      return "STOP ASKING QUESTIONS. Use your best judgment, proceed with the build, and state any assumptions you make. Your next reply must start with BUILD: or DONE:.";
    }
    if (clarifyTurns === 2) {
      return "I answered a round of questions already - please proceed with your best judgment now.";
    }
    return questions
      .map((q) => {
        let base = scriptedAnswer(q);
        if (usedAnswers.has(base)) {
          base = "You already asked something like this - use your best judgment.";
        } else {
          usedAnswers.add(base);
        }
        return `Q: ${q}\nA: ${base}`;
      })
      .join("\n");
  };

  while (turns < 12 && !completed) {
    turns++;
    const r = await chat(messages);
    inTok += r.promptTokens;
    outTok += r.completionTokens;
    const { kind, rest } = parseResponse(r.content);
    transcript.push({ turn: turns, role: "agent", kind, text: r.content.trim().slice(0, 600) });

    if (kind === "CLARIFY") {
      const questions = parseQuestions(rest);
      if (questions.length === 0) {
        progress += 2.5;
        messages.push({ role: "assistant", content: r.content.trim() }, { role: "user", content: "Continue." });
        continue;
      }
      const answers = oracleReply(questions);
      transcript.push({ turn: turns, role: "user", kind: "ANSWER", text: answers });
      messages.push({ role: "assistant", content: r.content.trim() }, { role: "user", content: answers });
      for (const _ of questions) events.push({ turn: turns, type: "clarify", pattern: null });
    } else if (kind === "DONE") {
      completed = true;
    } else {
      progress += 2.5;
      if (progress >= 10) completed = true;
      messages.push({ role: "assistant", content: r.content.trim() || "(empty)" }, { role: "user", content: "Continue." });
    }
  }

  const costUsd = (inTok / 1e6) * PRICE_IN + (outTok / 1e6) * PRICE_OUT;
  return {
    pairId,
    variant,
    runIndex,
    backend: "anthropic",
    model: MODEL,
    turns,
    inputTokens: inTok,
    outputTokens: outTok,
    totalTokens: inTok + outTok,
    costUsd: +costUsd.toFixed(4),
    corrections, // manual judging required (documented limitation)
    completed,
    events,
    plantedCategories: (prompt.plantedPatterns ?? []).map((p) => p.category),
    silentAssumptions: [],
    transcript,
  };
}
