// Minimal zero-dependency TUI helpers for watch mode (colors, spinner, history).
// Colors follow https://no-color.org: enabled when the stream is a TTY and
// NO_COLOR is unset, or when FORCE_COLOR is set. Everything degrades to plain
// text so spawned/piped output (tests, CI) stays byte-identical.
export const CODES = { bold: 1, dim: 2, red: 31, green: 32, yellow: 33, cyan: 36 };

export function makeColor(stream = process.stdout) {
  const enabled = !!process.env.FORCE_COLOR || (stream.isTTY && !process.env.NO_COLOR);
  return (code, s) => (enabled ? `\x1b[${code}m${String(s)}\x1b[0m` : String(s));
}

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

/**
 * Spinner on a TTY stream; a no-op when disabled (piped/CI) so tests see no
 * escape sequences. The pipeline is usually fast — the spinner earns its keep
 * on big stores and when the optional LLM fallback is enabled.
 */
export function startSpinner(label, { stream = process.stderr, enabled = true, intervalMs = 80 } = {}) {
  if (!enabled || !stream.isTTY) return { stop: () => {} };
  let i = 0;
  const timer = setInterval(() => {
    stream.write(`\r${FRAMES[i++ % FRAMES.length]} ${label}`);
  }, intervalMs);
  return {
    stop(final = "") {
      clearInterval(timer);
      stream.write(`\r\x1b[2K${final}`); // erase the spinner line, write final text
    },
  };
}

/** In-session prompt history, capped; numbered newest-first for one-key recopy. */
export class History {
  constructor(cap = 25) { this.cap = cap; this.items = []; }
  add(entry) {
    this.items.push(entry);
    if (this.items.length > this.cap) this.items.shift();
    return entry;
  }
  get size() { return this.items.length; }
  /** Up to n newest entries, newest first — display/pick order 1..n. */
  last(n = 9) { return this.items.slice(-n).reverse(); }
  /** 1-based pick, matching the numbers shown by last(). */
  get(n) { return this.items[this.items.length - n] ?? null; }
}

export function formatHistory(history, color) {
  const lines = ["recent prompts (newest first):"];
  const items = history.last(9);
  items.forEach((e, i) => {
    const verdict = e.ok ? color(CODES.green, "✔") : color(CODES.red, "✗");
    const gate = e.ok ? color(CODES.dim, "gate PASS") : color(CODES.dim, "gate FAIL");
    lines.push(`  ${i + 1}  ${verdict} ${e.text}  ${gate}`);
  });
  return lines.join("\n");
}
