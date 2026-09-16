// Lemonade — Local Web UI Server & Specification Integrity API.
//
// Zero external dependencies (Node.js standard library only).
// Local-first, privacy-preserving: binds to loopback (127.0.0.1) only.

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildSpec } from "../spec/extractor.js";
import { exportToMarkdown, exportToJSON, exportAgentPrompt, exportAuditReport } from "../spec/exporter.js";
import { evaluatePromptQualityAndQuota } from "../spec/scoring.js";
import { validateAll } from "../validation/validate.js";
import { detect } from "../../phase1/detector.js";
import { rewrite } from "../../phase2/rewriter.js";
import { SpecLedger } from "../../phase6/ledger.js";
import { STATUS } from "../spec/model.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, "public");
const DATA_DIR = path.join(__dirname, "..", "..", "data", "specs");

// Ensure data directory exists
fs.mkdirSync(DATA_DIR, { recursive: true });

// In-memory active spec store (backed by disk)
const activeSpecs = new Map();

function saveSpecToDisk(spec) {
  try {
    const filePath = path.join(DATA_DIR, `${spec.id}.json`);
    fs.writeFileSync(filePath, JSON.stringify(spec.toJSON(), null, 2), "utf8");
  } catch (err) {
    console.error("Failed to persist spec:", err.message);
  }
}

function loadSpecFromDisk(id) {
  try {
    const filePath = path.join(DATA_DIR, `${id}.json`);
    if (fs.existsSync(filePath)) {
      const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
      return data;
    }
  } catch (err) {
    console.error("Failed to load spec:", err.message);
  }
  return null;
}

// MIME types for static assets
const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

export function createServer({ port = 7890, host = "127.0.0.1" } = {}) {
  const ledgerPath = path.join(__dirname, "..", "..", "data", "drift-ledger.json");
  const ledger = new SpecLedger(ledgerPath);

  const server = http.createServer(async (req, res) => {
    // Security headers
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Access-Control-Allow-Origin", `http://${host}:${port}`);
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    const pathname = url.pathname;

    // JSON response helper
    const sendJson = (status, data) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(data));
    };

    // Body parsing helper
    const parseBody = () => new Promise((resolve, reject) => {
      let body = "";
      req.on("data", (chunk) => { body += chunk; });
      req.on("end", () => {
        if (!body) return resolve({});
        try { resolve(JSON.parse(body)); }
        catch (e) { reject(new Error("Invalid JSON body")); }
      });
      req.on("error", reject);
    });

    try {
      // API Routes
      if (pathname === "/api/health" && req.method === "GET") {
        sendJson(200, { ok: true, status: "healthy", service: "lemonade-integrity-platform", version: "2.0.0" });
        return;
      }

      if (pathname === "/api/detect" && req.method === "POST") {
        const body = await parseBody();
        const prompt = body.prompt || "";
        const detection = detect(prompt);
        sendJson(200, detection);
        return;
      }

      if (pathname === "/api/spec/create" && req.method === "POST") {
        const body = await parseBody();
        const prompt = body.prompt || "";
        const title = body.title || "";
        const mode = body.mode || "agent";

        if (!prompt.trim()) {
          sendJson(400, { error: "Prompt cannot be empty" });
          return;
        }

        // Build canonical ProjectSpec
        const spec = buildSpec(prompt, title);
        activeSpecs.set(spec.id, spec);
        saveSpecToDisk(spec);

        // Run rewriter to get optimized prompt & diff
        const rewriteResult = await rewrite(prompt, { mode: "optimize" });

        // Run four-dimension validation
        const validation = validateAll(prompt, rewriteResult.optimized_prompt, spec);

        const agentPrompt = exportAgentPrompt(spec);
        const quota = evaluatePromptQualityAndQuota(prompt, agentPrompt, spec);

        sendJson(201, {
          ok: true,
          spec: spec.toJSON(),
          validation,
          quota,
          exports: {
            markdown: exportToMarkdown(spec, { mode }),
            agentPrompt,
            auditReport: exportAuditReport(spec),
            json: exportToJSON(spec),
          },
          rewrite: {
            optimized_prompt: rewriteResult.optimized_prompt,
            assumptions: rewriteResult.assumptions_made,
            questions: rewriteResult.clarifying_questions,
            quality: rewriteResult.quality,
          },
        });
        return;
      }

      if (pathname.startsWith("/api/spec/") && req.method === "GET") {
        const id = pathname.replace("/api/spec/", "").split("/")[0];
        let spec = activeSpecs.get(id);
        if (!spec) {
          const fromDisk = loadSpecFromDisk(id);
          if (fromDisk) {
            sendJson(200, { ok: true, spec: fromDisk });
            return;
          }
          sendJson(404, { error: `Spec ${id} not found` });
          return;
        }
        sendJson(200, { ok: true, spec: spec.toJSON() });
        return;
      }

      // Update requirement item decision (accept/reject/defer/edit)
      const itemMatch = pathname.match(/^\/api\/spec\/([^/]+)\/item\/([^/]+)$/);
      if (itemMatch && req.method === "PUT") {
        const [, specId, itemId] = itemMatch;
        const body = await parseBody();
        const spec = activeSpecs.get(specId);

        if (!spec) {
          sendJson(404, { error: `Spec ${specId} not found` });
          return;
        }

        const item = spec.findItem(itemId);
        if (!item) {
          sendJson(404, { error: `Item ${itemId} not found in spec` });
          return;
        }

        if (body.action === "accept") {
          spec.acceptItem(itemId, body.reason || "Accepted by user");
        } else if (body.action === "reject") {
          spec.rejectItem(itemId, body.reason || "Rejected by user");
        } else if (body.action === "defer") {
          spec.deferItem(itemId, body.reason || "Deferred by user");
        } else if (body.action === "edit") {
          if (body.text) item.text = body.text;
          if (body.priority) item.priority = body.priority;
          if (body.scope) item.scope = body.scope;
          item.status = STATUS.ACCEPTED;
          spec.timeline.push({
            at: new Date().toISOString(),
            action: "edited",
            itemId: item.id,
            reason: body.reason || "Edited by user",
          });
        }

        saveSpecToDisk(spec);
        sendJson(200, { ok: true, item: item.toJSON(), spec: spec.toJSON() });
        return;
      }

      // Answer open question
      const questionMatch = pathname.match(/^\/api\/spec\/([^/]+)\/question\/([^/]+)\/answer$/);
      if (questionMatch && req.method === "POST") {
        const [, specId, questionId] = questionMatch;
        const body = await parseBody();
        const spec = activeSpecs.get(specId);

        if (!spec) {
          sendJson(404, { error: `Spec ${specId} not found` });
          return;
        }

        const answer = body.answer || "";
        spec.answerQuestion(questionId, answer);
        saveSpecToDisk(spec);

        sendJson(200, { ok: true, spec: spec.toJSON() });
        return;
      }

      // Export spec
      const exportMatch = pathname.match(/^\/api\/spec\/([^/]+)\/export$/);
      if (exportMatch && req.method === "POST") {
        const [, specId] = exportMatch;
        const body = await parseBody();
        const mode = body.mode || "agent";
        const spec = activeSpecs.get(specId);

        if (!spec) {
          sendJson(404, { error: `Spec ${specId} not found` });
          return;
        }

        let content = "";
        if (mode === "json") content = exportToJSON(spec);
        else if (mode === "audit") content = exportAuditReport(spec);
        else if (mode === "agent") content = exportAgentPrompt(spec);
        else content = exportToMarkdown(spec, { mode });

        sendJson(200, { ok: true, mode, content });
        return;
      }

      // Ledger endpoints
      if (pathname === "/api/ledger" && req.method === "GET") {
        const report = ledger.implementationDriftReport();
        sendJson(200, { ok: true, activeEntries: ledger.activeEntries(), report });
        return;
      }

      if (pathname === "/api/ledger/evidence" && req.method === "POST") {
        const body = await parseBody();
        const ok = ledger.linkEvidence(body.entryId, {
          type: body.type || "file",
          ref: body.ref || "",
          note: body.note || "",
        });
        if (body.status) {
          ledger.updateImplementationStatus(body.entryId, body.status, { reason: body.note });
        }
        sendJson(200, { ok, report: ledger.implementationDriftReport() });
        return;
      }

      // Static Asset Serving
      let filePath = pathname === "/" ? path.join(PUBLIC_DIR, "index.html") : path.join(PUBLIC_DIR, pathname);
      filePath = path.normalize(filePath);

      // Prevent directory traversal outside PUBLIC_DIR
      if (!filePath.startsWith(PUBLIC_DIR)) {
        res.writeHead(403, { "Content-Type": "text/plain" });
        res.end("Forbidden");
        return;
      }

      if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
        const ext = path.extname(filePath);
        const mime = MIME_TYPES[ext] || "application/octet-stream";
        res.writeHead(200, { "Content-Type": mime });
        fs.createReadStream(filePath).pipe(res);
        return;
      }

      // Fallback 404
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Not Found", pathname }));
    } catch (err) {
      console.error("Server Error:", err);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Internal Server Error", detail: err.message }));
    }
  });

  return {
    server,
    listen: () => new Promise((resolve) => {
      server.listen(port, host, () => {
        console.log(`Lemonade Control Room listening on http://${host}:${port}`);
        resolve({ host, port });
      });
    }),
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

// Start standalone if invoked directly
if (process.argv[1] && process.argv[1].endsWith("server.js")) {
  const port = parseInt(process.env.PORT || "7890", 10);
  const host = "127.0.0.1";
  const { listen } = createServer({ port, host });
  listen();
}
