// Cross-platform clipboard writer with graceful degradation (zero deps).
//
// Candidates are tried in turn per platform; the first that spawns wins.
// Encoding note (tested on Windows): piping UTF-8 bytes into clip.exe stdin
// round-trips unicode correctly — do NOT switch to PowerShell Set-Clipboard,
// whose argument passing mangles non-ASCII text. If no tool exists (or spawn
// fails), returns { ok: false } so the caller can fall back to printing the
// text — watch mode must never hard-fail because a clipboard is missing
// (SSH/headless/CI sessions, minimal Linux boxes).
import { spawn } from "node:child_process";

const CANDIDATES = process.platform === "darwin"
  ? [["pbcopy", []]]
  : process.platform === "win32"
    ? [["clip", []]]
    : [
        ["wl-copy", []],           // Wayland
        ["xclip", ["-selection", "clipboard"]], // X11
        ["xsel", ["--clipboard", "--input"]],
      ];

export function copyToClipboard(text) {
  return new Promise((resolve) => {
    if (!text) return resolve({ ok: false, reason: "nothing to copy" });
    let idx = 0;
    const tryNext = () => {
      if (idx >= CANDIDATES.length) {
        return resolve({ ok: false, reason: "no clipboard tool found (tried: " + CANDIDATES.map((c) => c[0]).join(", ") + ")" });
      }
      const [cmd, args] = CANDIDATES[idx++];
      let child;
      try {
        child = spawn(cmd, args, { stdio: ["pipe", "ignore", "ignore"] });
      } catch {
        return tryNext();
      }
      child.on("error", () => tryNext());
      child.on("close", (code) => {
        if (code === 0) resolve({ ok: true, tool: cmd });
        else tryNext();
      });
      child.stdin.on("error", () => {}); // EPIPE if the tool exits early — handled by close
      child.stdin.end(text, "utf8");
    };
    tryNext();
  });
}
