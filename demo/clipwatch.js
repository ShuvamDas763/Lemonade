#!/usr/bin/env node
// TokenTrim Smart Clipboard Watcher (Zero external dependencies).
//
// Background daemon that watches the system clipboard:
//   - When you select text and copy it twice (Ctrl+C+C) or copy any prompt,
//     TokenTrim automatically enriches it and replaces your clipboard with
//     the verified, structured prompt!
//
// Usage:
//   npm run clipwatch
//   npm run clipwatch -- --auto   (optimizes every copied text without needing double-copy)

import { execSync, spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { processPrompt } from "./watch.js";
import { copyToClipboard } from "./clipboard.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isAutoMode = process.argv.includes("--auto");

function getClipboardText() {
  try {
    if (process.platform === "win32") {
      return execSync("powershell -NoProfile -Command Get-Clipboard", { encoding: "utf8", stdio: ["pipe", "pipe", "ignore"] }).trim();
    } else if (process.platform === "darwin") {
      return execSync("pbpaste", { encoding: "utf8", stdio: ["pipe", "pipe", "ignore"] }).trim();
    } else {
      return execSync("xclip -selection clipboard -o || wl-paste", { encoding: "utf8", stdio: ["pipe", "pipe", "ignore"] }).trim();
    }
  } catch {
    return "";
  }
}

function playBeep() {
  try {
    if (process.platform === "win32") {
      execSync('powershell -NoProfile -Command "[System.Media.SystemSounds]::Asterisk.Play()"', { stdio: "ignore" });
    } else {
      process.stdout.write("\x07"); // ASCII terminal bell
    }
  } catch {}
}

console.log("=================================================");
console.log("TokenTrim Smart Clipboard Watcher Active");
console.log("=================================================");
console.log(`Mode: ${isAutoMode ? "Auto (optimizes newly copied text)" : "Double-Copy (tap Ctrl+C twice in <600ms)"}`);
console.log(`\nWorkflow:`);
console.log(`  1. Highlight rough prompt text anywhere`);
console.log(`  2. ${isAutoMode ? "Copy it (Ctrl+C)" : "Press Ctrl+C twice (Ctrl+C+C)"}`);
console.log(`  3. Hear the chime -> Press Ctrl+V to paste your structured prompt!`);
console.log(`\nPress Ctrl+C here to exit.\n`);

let lastText = getClipboardText();
let lastCopyTime = 0;
let isProcessing = false;

setInterval(async () => {
  if (isProcessing) return;

  const currentText = getClipboardText();
  if (!currentText || currentText === lastText || currentText.startsWith("## Goal")) {
    return;
  }

  const now = Date.now();
  const timeDiff = now - lastCopyTime;

  if (isAutoMode || (timeDiff < 700 && currentText.length > 5)) {
    isProcessing = true;
    console.log(`\n[TokenTrim] Detected prompt: "${currentText.slice(0, 50)}..."`);
    console.log(`[TokenTrim] Optimizing and verifying...`);

    try {
      const res = await processPrompt(currentText, { copy: true });
      if (res.ok) {
        lastText = res.optimized_prompt;
        playBeep();
        console.log(`✓ [SUCCESS] Optimized prompt placed on clipboard! Ready to paste (Ctrl+V).`);
      } else {
        console.log(`✗ Verification failed; clipboard untouched.`);
      }
    } catch (e) {
      console.error(`Error processing prompt: ${e.message}`);
    } finally {
      isProcessing = false;
      lastCopyTime = 0;
    }
  } else {
    lastCopyTime = now;
  }
}, 300);
