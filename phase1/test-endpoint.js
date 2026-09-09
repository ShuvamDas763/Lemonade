// Endpoint smoke test: boots server.js on a port, hits /detect + /health, kills it.
import { spawn } from "node:child_process";

const PORT = 7899;
const srv = spawn(process.execPath, ["phase1/server.js"], {
  env: { ...process.env, PORT: String(PORT) },
  stdio: "ignore",
});

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  await wait(800);
  const health = await fetch(`http://localhost:${PORT}/health`);
  console.log(`GET  /health -> ${health.status} ${await health.text()}`);

  const res = await fetch(`http://localhost:${PORT}/detect`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prompt: "make me a tinder clone but for books, with a nice modern look" }),
  });
  const j = await res.json();
  console.log(`POST /detect -> ${res.status} flags=${j.flags.length} score=${j.ambiguity_score}`);
  for (const f of j.flags) console.log(`  [${f.id}] ${f.category} sev=${f.severity} -> ${f.resolution}`);

  const bad = await fetch(`http://localhost:${PORT}/detect`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ nope: 1 }),
  });
  console.log(`POST /detect (bad body) -> ${bad.status} ${await bad.text()}`);
  console.log("ENDPOINT OK");
} catch (e) {
  console.error("ENDPOINT FAIL:", e.message);
  process.exitCode = 1;
} finally {
  srv.kill();
  process.exit(process.exitCode ?? 0);
}
