// TokenTrim Phase 1 — Transparent OpenAI-Compatible Local Proxy (Zero-dependency).
//
// Allows developers to plug TokenTrim into Cursor, Continue.dev, Claude Code, Aider,
// or any standard OpenAI SDK application simply by setting:
//   OPENAI_BASE_URL=http://localhost:7847/v1
//
// Features:
//   1. Multi-turn Context Pruner: compacts older error traces & tool outputs (saves 30-50% tokens).
//   2. Intent Gating: passes trivial Q&A / syntax lookups through untouched (0 bloat).
//   3. Workspace Auto-Detection: grounds prompts in local package.json / pyproject / go.mod.
//   4. Runtime Invariant Firewall: attaches hard boundary contracts and flags scope drift.
//   5. Streaming (SSE) & Non-Streaming support.
//   6. Transparent Forwarding to upstream (OpenAI, Ollama, OpenRouter, Anthropic) or Offline Preview mode.

import http from "node:http";
import https from "node:https";
import { URL } from "node:url";
import { pruneContext } from "../phase2/pruner.js";
import { classifyIntent } from "./intent-gate.js";
import { detectWorkspace } from "../phase2/workspace.js";
import { rewrite } from "../phase2/rewriter.js";
import { SessionFirewall } from "../phase6/firewall.js";
import { detect } from "./detector.js";

const DEFAULT_UPSTREAM = process.env.UPSTREAM_BASE_URL ?? (process.env.OPENAI_BASE_URL || null);
const SESSION_FIREWALL = new SessionFirewall();

/**
 * Forward an HTTP request to an upstream provider.
 */
function forwardUpstream(targetUrl, headers, body, onChunk, onEnd, onError) {
  const u = new URL(targetUrl);
  const isHttps = u.protocol === "https:";
  const client = isHttps ? https : http;

  const fwdHeaders = { ...headers, host: u.host };
  delete fwdHeaders["content-length"];

  const req = client.request(u, {
    method: "POST",
    headers: {
      ...fwdHeaders,
      "content-type": "application/json",
    },
  }, (res) => {
    onChunk(null, { statusCode: res.statusCode, headers: res.headers });
    res.on("data", (chunk) => onChunk(chunk));
    res.on("end", () => onEnd());
  });

  req.on("error", onError);
  if (body) req.write(typeof body === "string" ? body : JSON.stringify(body));
  req.end();
}

/**
 * Generate a simulated/offline chat completion response for testing or offline use.
 */
function generateOfflineResponse(messages, stream, metrics, reqId = `chatcmpl-${Date.now()}`) {
  const lastUser = [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
  const replyContent = [
    `[TokenTrim Proxy — Offline Mode]`,
    `✓ Multi-turn context pruned: saved ~${metrics.estimated_tokens_saved} tokens (${metrics.reduction_percent}% reduction).`,
    `✓ Workspace detected: ${detectWorkspace().summary ?? "none (plain directory)"}`,
    ``,
    `Optimized prompt delivered downstream:`,
    `---`,
    lastUser,
  ].join("\n");

  if (!stream) {
    return JSON.stringify({
      id: reqId,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: "tokentrim-offline",
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: replyContent },
          finish_reason: "stop",
        },
      ],
      usage: {
        prompt_tokens: Math.round(metrics.pruned_chars / 4),
        completion_tokens: Math.round(replyContent.length / 4),
        total_tokens: Math.round((metrics.pruned_chars + replyContent.length) / 4),
        tokens_saved_by_tokentrim: metrics.estimated_tokens_saved,
      },
    });
  }

  // Return SSE chunks for streaming
  const chunk1 = JSON.stringify({
    id: reqId,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model: "tokentrim-offline",
    choices: [{ index: 0, delta: { role: "assistant", content: replyContent }, finish_reason: null }],
  });
  const chunk2 = JSON.stringify({
    id: reqId,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model: "tokentrim-offline",
    choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
  });

  return `data: ${chunk1}\n\ndata: ${chunk2}\n\ndata: [DONE]\n\n`;
}

/**
 * Handle /v1/chat/completions requests.
 */
export async function handleChatCompletions(req, res, bodyStr) {
  let payload;
  try {
    payload = JSON.parse(bodyStr || "{}");
  } catch (e) {
    res.writeHead(400, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: `Invalid JSON payload: ${e.message}` }));
    return;
  }

  const { messages = [], stream = false, model = "default" } = payload;
  if (!Array.isArray(messages) || messages.length === 0) {
    res.writeHead(400, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "messages array is required" }));
    return;
  }

  // Step 1: Multi-turn Context Pruner (compresses stale error traces & old tool outputs)
  const pruneRes = pruneContext(messages);
  const activeMessages = pruneRes.pruned_messages;

  // Step 2: Extract the active user message
  const userIdx = activeMessages.map((m, i) => ({ m, i })).reverse().find(({ m }) => m.role === "user")?.i;

  if (userIdx !== undefined && typeof activeMessages[userIdx].content === "string") {
    const rawUserText = activeMessages[userIdx].content;

    // Step 3: Intent Gating (check if prompt is trivial Q&A or syntax snippet)
    const intent = classifyIntent(rawUserText);

    if (!intent.bypassRewrite) {
      // Step 4: Workspace Detection & Ambiguity Rewriter
      const rw = await rewrite(rawUserText, {
        useWorkspace: true,
        workspaceDir: process.cwd(),
      });

      if (rw.ok && rw.optimized_prompt) {
        // Step 5: Runtime Invariant Firewall (extract negative boundaries)
        const fwResult = SESSION_FIREWALL.processUserMessage(rawUserText);
        let finalPrompt = rw.optimized_prompt;

        if (fwResult.contract) {
          finalPrompt += `\n\n${fwResult.contract}\n`;
        }

        activeMessages[userIdx].content = finalPrompt;
      }
    }
  }

  // Check if an upstream provider is configured
  const authHeader = req.headers["authorization"];
  const upstreamUrl = DEFAULT_UPSTREAM
    ? (DEFAULT_UPSTREAM.endsWith("/chat/completions") ? DEFAULT_UPSTREAM : `${DEFAULT_UPSTREAM.replace(/\/+$/, "")}/chat/completions`)
    : null;

  if (upstreamUrl && (authHeader || process.env.OPENAI_API_KEY)) {
    // Forward to upstream
    const fwdHeaders = { ...req.headers };
    if (!fwdHeaders["authorization"] && process.env.OPENAI_API_KEY) {
      fwdHeaders["authorization"] = `Bearer ${process.env.OPENAI_API_KEY}`;
    }

    const modifiedPayload = { ...payload, messages: activeMessages };
    let initialResponseSent = false;
    let accumulatedAgentText = "";

    forwardUpstream(
      upstreamUrl,
      fwdHeaders,
      modifiedPayload,
      (chunk, meta) => {
        if (meta && !initialResponseSent) {
          initialResponseSent = true;
          const respHeaders = { ...meta.headers };
          respHeaders["x-tokentrim-tokens-saved"] = String(pruneRes.estimated_tokens_saved);
          respHeaders["x-tokentrim-reduction-pct"] = `${pruneRes.reduction_percent}%`;
          res.writeHead(meta.statusCode, respHeaders);
        }
        if (chunk) {
          res.write(chunk);
          accumulatedAgentText += chunk.toString("utf8");
        }
      },
      () => {
        // Audit accumulated output for firewall drift
        SESSION_FIREWALL.auditResponse(accumulatedAgentText);
        res.end();
      },
      (err) => {
        if (!initialResponseSent) {
          res.writeHead(502, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: `Upstream error: ${err.message}` }));
        } else {
          res.end();
        }
      }
    );
    return;
  }

  // Offline / Standalone mode
  const responseData = generateOfflineResponse(activeMessages, stream, pruneRes);
  if (stream) {
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      "connection": "keep-alive",
      "x-tokentrim-tokens-saved": String(pruneRes.estimated_tokens_saved),
    });
    res.end(responseData);
  } else {
    res.writeHead(200, {
      "content-type": "application/json",
      "x-tokentrim-tokens-saved": String(pruneRes.estimated_tokens_saved),
    });
    res.end(responseData);
  }
}

/**
 * Handle /v1/models endpoint.
 */
export function handleModels(res) {
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({
    object: "list",
    data: [
      {
        id: "tokentrim-smart",
        object: "model",
        created: 1700000000,
        owned_by: "tokentrim",
      },
      {
        id: "gpt-4o",
        object: "model",
        created: 1700000000,
        owned_by: "tokentrim-proxy",
      },
      {
        id: "claude-3-7-sonnet",
        object: "model",
        created: 1700000000,
        owned_by: "tokentrim-proxy",
      },
    ],
  }));
}
