# Lemonade Security Architecture & Threat Model

**Status:** Production Standard  
**Last Audit:** September 2026  
**Scope:** Core Integrity Engine, Local Web UI, REST API, and Proxy Service.

---

## 1. Threat Model & Security Philosophy

Lemonade is designed as a **local-first, privacy-preserving developer tool**. Because the application accepts arbitrary user prompts and delivers prompts to code-generating agents, it must protect against:
1. Malicious prompt injection attempting Cross-Site Scripting (XSS) in local browser UI.
2. Memory exhaustion / DoS via oversized HTTP request payloads.
3. Network exposure and unauthorized LAN access.
4. Proxy recursion and self-looping denial of service.
5. Accidental leakage of local environment tokens or authorization headers.
6. Silent invention of security-critical requirements (e.g. ungrounded auth/payment mechanisms).

---

## 2. Core Security Mitigations

### 2.1 Cross-Site Scripting (XSS) Defense
- **Strict HTML Escaping:** All user-controlled text (`prompt`, `item.text`, `item.category`, `f.resolution`, `q.text`, `e.phrase`, warnings) is filtered through a dedicated `escapeHtml()` function that converts `&`, `<`, `>`, `"`, and `'` into safe HTML character entities before DOM insertion.
- **Elimination of Inline Event Handlers:** Generated HTML never uses inline `onclick`, `onkeydown`, or `onerror` attributes. All interactions use programmatic event delegation via standard `data-action` and `data-id` attributes.
- **Content Security Policy (CSP):** The UI server emits strict CSP headers on all responses:
  ```http
  Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self';
  ```
  This completely forbids loading external scripts, executing inline script blocks, or sending out-of-band telemetry.

### 2.2 Request Body & Memory Exhaustion Protection
- Both `src/ui/server.js` and `phase1/server.js` enforce strict byte counting on incoming HTTP request streams.
- Maximum payload limit is capped at **1 MB** (`1,048,576 bytes`).
- If an incoming payload exceeds this limit, the server immediately terminates the stream, destroys the socket, and returns:
  ```http
  HTTP/1.1 413 Payload Too Large
  {"ok": false, "error": "Payload Too Large", "statusCode": 413}
  ```

### 2.3 Network Binding & Loopback Isolation
- All servers default strictly to loopback binding (`127.0.0.1` / `localhost`).
- The application never binds to `0.0.0.0` or public interfaces unless explicitly requested by setting `HOST=0.0.0.0`.
- When `HOST` is configured for non-loopback access, an explicit bearer token (`LEMONADE_AUTH_TOKEN` or `TOKEN_TRIM_AUTH_TOKEN`) is strictly enforced; unauthenticated requests receive `401 Unauthorized`.
- Wildcard CORS (`Access-Control-Allow-Origin: *`) has been eliminated in favor of strict loopback origin matching (`http://127.0.0.1:*`, `http://localhost:*`) or explicit allowlists.

### 2.4 Proxy Self-Loop & Header Hygiene (`phase1/proxy.js`)
- **Self-Loop Prevention:** When proxying requests to an upstream LLM provider (`OPENAI_BASE_URL` or `UPSTREAM_BASE_URL`), the proxy inspects the hostname and port. If the upstream target points to the local proxy itself (e.g. `http://localhost:7847`), the request is immediately rejected with `400 Bad Request` to prevent infinite recursion.
- **Header Sanitization:** When forwarding requests to upstream providers, incoming browser cookies, internal trace headers, and unwhitelisted headers are stripped. Only `authorization`, `content-type`, `accept`, `user-agent`, and `x-request-id` are passed upstream.
- **Request Timeout:** Upstream requests have an enforced **30-second socket timeout**. Unresponsive upstream providers are destroyed cleanly rather than leaving hung connections.

### 2.5 Offline & Zero Third-Party Asset Integrity
- External Google Fonts CDN dependencies (`fonts.googleapis.com` and `fonts.gstatic.com`) have been completely removed from `src/ui/public/index.html`.
- Lemonade renders using an accessible, high-contrast native system typography stack (`-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Inter, sans-serif`).
- Zero third-party JavaScript libraries or CSS frameworks are bundled or loaded at runtime.

---

## 3. Security Verification Checklist

- [x] Input sanitization against script and SVG vectors (`test/verify-security.js`).
- [x] Body size limit returning 413 on oversized requests (`test/verify-security.js`).
- [x] CSP headers present on all HTTP responses (`test/verify-security.js`).
- [x] Proxy self-loop detection verified (`test/verify-security.js`).
- [x] Atomic file writes with `.tmp` staging preventing disk corruption (`test/verify-persistence.js`).
- [x] Zero external CDN network calls during local UI execution.
