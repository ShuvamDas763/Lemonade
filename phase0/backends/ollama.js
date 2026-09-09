// REAL backend — Ollama (free/local). The model plays the coding agent in a
// multi-turn loop; a scripted "user" (wizard-of-oz) answers clarifying questions
// out of the pair's EXPLICIT spec, or says "use your best judgment" when the
// spec doesn't cover it. Tokens/turns are measured from the real API responses.
// Corrections are NOT auto-detected in real mode (needs human judging) and are
// reported as 0 — see PHASE0_REPORT.md limitations.
const OLLAMA_URL = process.env.OLLAMA_URL ?? "http://localhost:11434";
const MODEL = process.env.OLLAMA_MODEL ?? "qwen2.5:3b";

const SYSTEM = `You are a coding agent working inside an IDE. The user gives you an app request.
Each turn reply in EXACTLY one of these formats, starting your reply with one of these exact words:
CLARIFY: <question 1> | <question 2>   (at most 2 questions, ONLY if a critical requirement is missing or ambiguous)
BUILD: <one sentence describing what you build this turn>
DONE: <one sentence summarizing the finished app>   (when the app is complete)`;

export async function checkOllama() {
  try {
    const res = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const tags = await res.json();
    const models = (tags.models ?? []).map((m) => m.name);
    if (!models.some((m) => m.startsWith(MODEL))) {
      throw new Error(
        `Ollama is running but model '${MODEL}' is missing. Run: ollama pull ${MODEL} (or set OLLAMA_MODEL). Installed: ${models.join(", ") || "none"}`
      );
    }
  } catch (e) {
    throw new Error(
      `Ollama not usable at ${OLLAMA_URL} (${e.message}). Start it with \`ollama serve\` and run \`ollama pull ${MODEL}\`.`
    );
  }
}

/** Classify a model reply even when it's sloppily formatted: bold markers,
 *  markdown, numbering, or trailing prose after the keyword.
 *  If the reply contains >=2 distinct keywords (e.g. "CLARIFY: ... | BUILD: ..."
 *  or "BUILD: ... DONE: ..."), treat it as a BUILD turn: the agent did work this
 *  turn and effectively self-answered, which prevents clarify-loop stalls. */
export function parseResponse(text) {
  const t = String(text);
  const re = /\b(Clarify|Build|Done)\s*[:：]/gi;
  const found = [...t.matchAll(re)];
  if (found.length === 0) return { kind: "BUILD", rest: t.trim() };
  const kinds = new Set(found.map((m) => m[1].toUpperCase()));
  if (kinds.size >= 2) return { kind: "BUILD", rest: t.trim() };
  const m = found[0];
  return { kind: m[1].toUpperCase(), rest: t.slice(m.index + m[0].length).trim() };
}

/** Extract up to 2 questions from the text after CLARIFY (pipes, newlines or
 *  "1." / "2." numbering all count as separators). */
export function parseQuestions(rest) {
  const cleaned = String(rest).replace(/^\s*\d+[.)]\s*/gm, "|");
  return cleaned
    .split(/\||\n+/)
    .map((s) => s.replace(/^[-*•:\d.)\s]+/, "").trim())
    .filter((s) => s.length > 3)
    .slice(0, 2);
}

/** Best-matching sentence from the explicit spec for a question, else "best judgment". */
export function scriptedAnswer(question, explicitText) {
  const qWords = new Set((question.toLowerCase().match(/[a-z]{4,}/g) ?? []));
  let best = null, bestScore = 0;
  for (const sentence of explicitText.split(/(?<=[.!?])\s+/)) {
    const sWords = new Set((sentence.toLowerCase().match(/[a-z]{4,}/g) ?? []));
    let score = 0;
    for (const w of qWords) if (sWords.has(w)) score++;
    if (score > bestScore) { bestScore = score; best = sentence.trim(); }
  }
  return bestScore > 0 ? best : "Not specified - use your best judgment.";
}

async function chat(messages, seed) {
  const res = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      messages,
      stream: false,
      options: { temperature: 0.2, seed, num_ctx: 8192, num_predict: 300 },
    }),
    signal: AbortSignal.timeout(180000),
  });
  if (!res.ok) throw new Error(`Ollama chat HTTP ${res.status}: ${await res.text()}`);
  const j = await res.json();
  return {
    content: j.message?.content ?? "",
    promptTokens: j.prompt_eval_count ?? 0,
    completionTokens: j.eval_count ?? 0,
  };
}

export async function runSession(prompt, { pairId, variant, runIndex = 0, referenceText = "" } = {}) {
  await checkOllama();
  const seed = 42 + runIndex;
  const messages = [
    { role: "system", content: SYSTEM },
    { role: "user", content: prompt.text },
  ];
  let turns = 0, inTok = 0, outTok = 0, corrections = 0;
  let progress = 0, completed = false;
  const events = [];
  const transcript = [];

  // Oracle state: a real user has limited patience - they answer ONE round of
  // clarifications thoroughly, then push the agent to build. Global escalation
  // ladder, identical for every arm/session:
  //   1st clarify turn  -> best-match spec sentences (or "not specified")
  //   2nd clarify turn  -> "proceed with your best judgment now"
  //   3rd+ clarify turn -> hard STOP-ASKING directive naming the required format
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
        let base = scriptedAnswer(q, referenceText);
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
    const r = await chat(messages, seed);
    inTok += r.promptTokens;
    outTok += r.completionTokens;
    const { kind, rest } = parseResponse(r.content);
    transcript.push({ turn: turns, role: "agent", kind, text: r.content.trim().slice(0, 600) });

    if (kind === "CLARIFY") {
      const questions = parseQuestions(rest);
      if (questions.length === 0) {
        // Malformed clarify -> treat as a build turn.
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
      // BUILD or unparseable -> treat as a build turn.
      progress += 2.5;
      if (progress >= 10) completed = true;
      messages.push({ role: "assistant", content: r.content.trim() || "(empty)" }, { role: "user", content: "Continue." });
    }
  }

  return {
    pairId,
    variant,
    runIndex,
    backend: "ollama",
    model: MODEL,
    turns,
    inputTokens: inTok,
    outputTokens: outTok,
    totalTokens: inTok + outTok,
    corrections, // always 0 in real mode; manual judging via transcript (documented limitation)
    completed,
    events,
    plantedCategories: (prompt.plantedPatterns ?? []).map((p) => p.category),
    silentAssumptions: [],
    transcript,
  };
}
