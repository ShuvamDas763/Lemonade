// TokenTrim Phase 2 — Workspace Context Auto-Detector (Deterministic, zero-dependency).
//
// Inspects the local repository structure to ground prompt rewrites in actual project
// reality rather than guessing generic defaults (e.g. "TypeScript + React").
//
// Invariants:
//   1. 100% offline, local filesystem only.
//   2. Sub-millisecond execution; in-memory cache keyed by canonical directory path.
//   3. High precision: returns detected=false if no recognizable project manifests exist.

import fs from "node:fs";
import path from "node:path";

const CACHE = new Map();

/**
 * Inspect a package.json file for framework, language, and tool signals.
 */
function inspectPackageJson(dir) {
  const pkgPath = path.join(dir, "package.json");
  if (!fs.existsSync(pkgPath)) return null;

  try {
    const raw = fs.readFileSync(pkgPath, "utf8");
    const pkg = JSON.parse(raw);
    const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
    const depKeys = Object.keys(deps);

    const isTs = fs.existsSync(path.join(dir, "tsconfig.json")) || depKeys.some((d) => d.includes("typescript"));
    const language = isTs ? "TypeScript" : "JavaScript";

    const frameworks = [];
    if (deps["next"]) frameworks.push("Next.js");
    else if (deps["nuxt"]) frameworks.push("Nuxt");
    else if (deps["@sveltejs/kit"] || deps["svelte"]) frameworks.push("Svelte");
    else if (deps["vue"]) frameworks.push("Vue");
    else if (deps["react"]) frameworks.push("React");
    else if (deps["express"]) frameworks.push("Express");
    else if (deps["fastify"]) frameworks.push("Fastify");
    else if (deps["@nestjs/core"]) frameworks.push("NestJS");

    if (deps["vite"]) frameworks.push("Vite");
    if (deps["tailwindcss"]) frameworks.push("Tailwind CSS");

    let database = null;
    if (deps["@prisma/client"] || deps["prisma"]) database = "Prisma";
    else if (deps["drizzle-orm"]) database = "Drizzle";
    else if (deps["mongoose"]) database = "MongoDB";
    else if (deps["better-sqlite3"] || deps["sqlite3"]) database = "SQLite";
    else if (deps["pg"]) database = "PostgreSQL";

    let pm = "npm";
    if (fs.existsSync(path.join(dir, "pnpm-lock.yaml"))) pm = "pnpm";
    else if (fs.existsSync(path.join(dir, "yarn.lock"))) pm = "yarn";
    else if (fs.existsSync(path.join(dir, "bun.lockb")) || fs.existsSync(path.join(dir, "bun.lock"))) pm = "bun";

    const parts = [
      `Node.js (${language})`,
      frameworks.length > 0 ? frameworks.join(" + ") : null,
      database ? `DB: ${database}` : null,
      `pkg-manager: ${pm}`,
    ].filter(Boolean);

    return {
      detected: true,
      evidenceFile: "package.json",
      ecosystem: "node",
      language,
      frameworks,
      database,
      packageManager: pm,
      summary: parts.join(", "),
    };
  } catch {
    return null;
  }
}

/**
 * Inspect Python project manifests (pyproject.toml, requirements.txt, Pipfile).
 */
function inspectPythonProject(dir) {
  const pyproject = path.join(dir, "pyproject.toml");
  const requirements = path.join(dir, "requirements.txt");
  const pipfile = path.join(dir, "Pipfile");

  let evidenceFile = null;
  let content = "";

  if (fs.existsSync(pyproject)) {
    evidenceFile = "pyproject.toml";
    try { content = fs.readFileSync(pyproject, "utf8"); } catch {}
  } else if (fs.existsSync(requirements)) {
    evidenceFile = "requirements.txt";
    try { content = fs.readFileSync(requirements, "utf8"); } catch {}
  } else if (fs.existsSync(pipfile)) {
    evidenceFile = "Pipfile";
    try { content = fs.readFileSync(pipfile, "utf8"); } catch {}
  }

  if (!evidenceFile) return null;

  const frameworks = [];
  if (/fastapi/i.test(content)) frameworks.push("FastAPI");
  if (/django/i.test(content)) frameworks.push("Django");
  if (/flask/i.test(content)) frameworks.push("Flask");
  if (/sqlalchemy/i.test(content)) frameworks.push("SQLAlchemy");
  if (/pytest/i.test(content)) frameworks.push("pytest");

  const summary = frameworks.length > 0
    ? `Python (${frameworks.join(" + ")})`
    : "Python project";

  return {
    detected: true,
    evidenceFile,
    ecosystem: "python",
    language: "Python",
    frameworks,
    database: /postgres|psycopg/i.test(content) ? "PostgreSQL" : /sqlite/i.test(content) ? "SQLite" : null,
    packageManager: evidenceFile === "Pipfile" ? "pipenv" : evidenceFile === "pyproject.toml" ? "poetry/pip" : "pip",
    summary,
  };
}

/**
 * Inspect Go project manifests (go.mod).
 */
function inspectGoProject(dir) {
  const gomod = path.join(dir, "go.mod");
  if (!fs.existsSync(gomod)) return null;

  try {
    const content = fs.readFileSync(gomod, "utf8");
    const modMatch = content.match(/^module\s+([^\s\n]+)/m);
    const moduleName = modMatch ? modMatch[1] : "Go module";

    const frameworks = [];
    if (/github\.com\/gin-gonic\/gin/i.test(content)) frameworks.push("Gin");
    if (/github\.com\/labstack\/echo/i.test(content)) frameworks.push("Echo");
    if (/gorm\.io\/gorm/i.test(content)) frameworks.push("GORM");

    return {
      detected: true,
      evidenceFile: "go.mod",
      ecosystem: "go",
      language: "Go",
      frameworks,
      database: /pq|pgx/i.test(content) ? "PostgreSQL" : null,
      packageManager: "go modules",
      summary: `Go (${moduleName}${frameworks.length > 0 ? " with " + frameworks.join(", ") : ""})`,
    };
  } catch {
    return null;
  }
}

/**
 * Inspect Rust project manifests (Cargo.toml).
 */
function inspectRustProject(dir) {
  const cargo = path.join(dir, "Cargo.toml");
  if (!fs.existsSync(cargo)) return null;

  try {
    const content = fs.readFileSync(cargo, "utf8");
    const frameworks = [];
    if (/axum/i.test(content)) frameworks.push("Axum");
    if (/actix-web/i.test(content)) frameworks.push("Actix-Web");
    if (/tokio/i.test(content)) frameworks.push("Tokio");

    return {
      detected: true,
      evidenceFile: "Cargo.toml",
      ecosystem: "rust",
      language: "Rust",
      frameworks,
      database: /diesel|sqlx/i.test(content) ? "SQLx/Diesel" : null,
      packageManager: "cargo",
      summary: `Rust (${frameworks.length > 0 ? frameworks.join(" + ") : "Cargo project"})`,
    };
  } catch {
    return null;
  }
}

/**
 * Auto-detect the workspace stack for a given directory.
 *
 * @param {string} [targetDir] Defaults to process.cwd()
 * @param {boolean} [useCache=true]
 * @returns {Object} Detected workspace metadata
 */
export function detectWorkspace(targetDir = process.cwd(), useCache = true) {
  const resolved = path.resolve(targetDir);
  if (useCache && CACHE.has(resolved)) {
    return CACHE.get(resolved);
  }

  // Probe in order of likelihood
  const node = inspectPackageJson(resolved);
  if (node) {
    if (useCache) CACHE.set(resolved, node);
    return node;
  }

  const python = inspectPythonProject(resolved);
  if (python) {
    if (useCache) CACHE.set(resolved, python);
    return python;
  }

  const go = inspectGoProject(resolved);
  if (go) {
    if (useCache) CACHE.set(resolved, go);
    return go;
  }

  const rust = inspectRustProject(resolved);
  if (rust) {
    if (useCache) CACHE.set(resolved, rust);
    return rust;
  }

  const empty = {
    detected: false,
    evidenceFile: null,
    ecosystem: null,
    language: null,
    frameworks: [],
    database: null,
    packageManager: null,
    summary: null,
  };

  if (useCache) CACHE.set(resolved, empty);
  return empty;
}

/**
 * Format a detected workspace into an assumption string.
 */
export function formatWorkspaceAssumption(ws) {
  if (!ws || !ws.detected) return null;
  return `[WORKSPACE DETECTED (from ${ws.evidenceFile}): ${ws.summary}]`;
}
