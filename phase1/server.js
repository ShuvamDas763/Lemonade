#!/usr/bin/env node
// Endpoint: node phase1/server.js  ->  POST /detect  { "prompt": "..." }
// Zero-dependency. Responds with { flags, ambiguity_score, flagged }.
import http from "node:http";
import { detect } from "./detector.js";

const PORT = Number(process.env.PORT ?? 7847);
// Loopback by default: the endpoint runs prompts through the detector and
// returns them (echo), so it must not silently expose user text on the LAN.
// Set HOST=0.0.0.0 to deliberately bind all interfaces.
const HOST = process.env.HOST ?? "127.0.0.1";
const MAX_BODY_BYTES = 1_000_000; // 1 MB — prompts are small; reject junk early

const server = http.createServer((req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, service: "lemonade-detector", version: 1 }));
    return;
  }
  if (req.method === "POST" && req.url === "/detect") {
    let body = "";
    let overflow = false;
    req.on("data", (c) => {
      body += c;
      if (body.length > MAX_BODY_BYTES) {
        overflow = true;
        try {
          res.writeHead(413, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: `body too large (max ${MAX_BODY_BYTES} bytes)` }));
        } catch {}
        req.destroy(); // stop reading the rest of an oversized body
      }
    });
    req.on("end", () => {
      if (overflow) return;
      try {
        const { prompt } = JSON.parse(body || "{}");
        if (typeof prompt !== "string") {
          res.writeHead(400, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "body must be JSON: { prompt: string }" }));
          return;
        }
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(detect(prompt), null, 2));
      } catch (e) {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }
  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: "not found (POST /detect, GET /health)" }));
});

server.listen(PORT, HOST, () => console.log(`Lemonade detector listening on http://${HOST === "0.0.0.0" ? "localhost" : HOST}:${PORT} (POST /detect)`));
