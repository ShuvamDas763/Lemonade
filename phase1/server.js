#!/usr/bin/env node
// TokenTrim Server & OpenAI-Compatible Proxy:
//   node phase1/server.js
//
// Endpoints:
//   POST /v1/chat/completions   (OpenAI-compatible: Cursor, Continue.dev, Claude Code, Aider)
//   GET  /v1/models             (OpenAI-compatible models list)
//   POST /detect                (Legacy Phase 1 ambiguity detector)
//   GET  /health                (Health check + service discovery)
//
// Zero-dependency, native Node.js ESM.
import http from "node:http";
import { detect } from "./detector.js";
import { handleChatCompletions, handleModels } from "./proxy.js";

const PORT = Number(process.env.PORT ?? 7847);
const HOST = process.env.HOST ?? "127.0.0.1";
const MAX_BODY_BYTES = 5_000_000; // 5 MB — allows multi-turn chat histories

const server = http.createServer((req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);
  const pathname = parsedUrl.pathname;

  // CORS headers for browser/web-ui clients
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  // Health check
  if (req.method === "GET" && (pathname === "/health" || pathname === "/")) {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      ok: true,
      service: "tokentrim-proxy",
      version: "2.0.0",
      endpoints: ["/v1/chat/completions", "/v1/models", "/detect", "/health"],
    }));
    return;
  }

  // Models list
  if (req.method === "GET" && pathname === "/v1/models") {
    handleModels(res);
    return;
  }

  // POST endpoints: read request body
  if (req.method === "POST" && (pathname === "/v1/chat/completions" || pathname === "/detect")) {
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
        req.destroy();
      }
    });

    req.on("end", async () => {
      if (overflow) return;

      if (pathname === "/v1/chat/completions") {
        await handleChatCompletions(req, res, body);
        return;
      }

      if (pathname === "/detect") {
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
        return;
      }
    });
    return;
  }

  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: `not found (${req.method} ${pathname})` }));
});

server.listen(PORT, HOST, () => {
  console.log(`TokenTrim Proxy listening on http://${HOST === "0.0.0.0" ? "localhost" : HOST}:${PORT}`);
  console.log(`  -> OpenAI API Base: http://${HOST === "0.0.0.0" ? "localhost" : HOST}:${PORT}/v1`);
  console.log(`  -> Health:          http://${HOST === "0.0.0.0" ? "localhost" : HOST}:${PORT}/health`);
});
