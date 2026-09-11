#!/usr/bin/env node
// TokenTrim Global Hotkey Launcher (Zero external dependencies).
//
// Launches the background daemon that captures highlighted text on hotkey,
// enriches it through TokenTrim, and puts the result on your clipboard.
//
// Usage:
//   npm run hotkey
//   npm run hotkey -- --key L --modifier Ctrl+Alt
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, "..");

const args = process.argv.slice(2);
let key = "T";
let modifier = "Ctrl+Alt";

for (let i = 0; i < args.length; i++) {
  if (args[i] === "--key" && args[i + 1]) key = args[++i];
  if (args[i] === "--modifier" && args[i + 1]) modifier = args[++i];
}

console.log("=================================================");
console.log("TokenTrim Background Hotkey Daemon");
console.log("=================================================");

if (process.platform === "win32") {
  const psScript = path.join(repoRoot, "scripts", "tokentrim-daemon.ps1");
  console.log(`Starting Windows Hotkey Daemon...`);
  console.log(`  Hotkey:       ${modifier}+${key}`);
  console.log(`  Instructions: 1. Select text anywhere (Cursor, Chrome, VS Code)`);
  console.log(`                2. Press ${modifier}+${key}`);
  console.log(`                3. Listen for chime -> Press Ctrl+V to paste!`);
  console.log(`\nPress Ctrl+C in this terminal to stop the daemon.\n`);

  const ps = spawn("powershell.exe", [
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-File", psScript,
    "-Key", key,
    "-Modifier", modifier,
    "-RepoDir", repoRoot,
  ], {
    stdio: "inherit",
  });

  ps.on("close", (code) => {
    console.log(`\nHotkey daemon stopped (exit code: ${code}).`);
    process.exit(code ?? 0);
  });

  process.on("SIGINT", () => {
    ps.kill();
    process.exit(0);
  });
} else {
  console.log(`Platform "${process.platform}":`);
  console.log(`  Use the universal clipboard watcher: npm run clipwatch`);
  console.log(`  Or Raycast integration: scripts/tokentrim-raycast.sh`);
}
