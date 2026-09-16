// Lemonade — Atomic Specification Persistence Repository.
//
// Provides reliable, thread-safe (single-process atomic) disk storage and
// hydration for canonical ProjectSpec instances.
//
// INVARIANTS:
//   1. Atomic writes via write-to-temp and atomic rename.
//   2. Rehydrates raw JSON into real ProjectSpec instances with full methods intact.
//   3. Survives server restarts: any persisted spec can be fetched, updated,
//      question-answered, and exported after process resurrection.
//   4. Zero external dependencies (Node.js standard library only).

import fs from "node:fs";
import path from "node:path";
import { ProjectSpec } from "./model.js";

export class SpecRepository {
  /**
   * @param {string} dataDir - Directory where spec JSON files are stored.
   */
  constructor(dataDir) {
    this.dataDir = dataDir;
    fs.mkdirSync(this.dataDir, { recursive: true });
    /** @type {Map<string, ProjectSpec>} */
    this.cache = new Map();
  }

  /**
   * Resolve disk file path for a given spec ID.
   * @private
   */
  _filePath(id) {
    const safeId = String(id).replace(/[^a-zA-Z0-9_-]/g, "");
    return path.join(this.dataDir, `${safeId}.json`);
  }

  /**
   * Atomically save a ProjectSpec instance to disk.
   * @param {ProjectSpec} spec
   */
  save(spec) {
    if (!(spec instanceof ProjectSpec)) {
      throw new TypeError("SpecRepository.save requires an instance of ProjectSpec");
    }

    spec.updatedAt = new Date().toISOString();
    this.cache.set(spec.id, spec);

    const targetPath = this._filePath(spec.id);
    const tempPath = `${targetPath}.tmp.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;

    const jsonStr = JSON.stringify(spec.toJSON(), null, 2);
    try {
      fs.writeFileSync(tempPath, jsonStr, "utf8");
      fs.renameSync(tempPath, targetPath);
    } catch (err) {
      // Clean up orphaned temp file if rename failed
      try {
        if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
      } catch {}
      throw new Error(`Failed to atomically save spec ${spec.id}: ${err.message}`);
    }

    return spec;
  }

  /**
   * Alias for save() when creating new specification.
   * @param {ProjectSpec} spec
   */
  create(spec) {
    return this.save(spec);
  }

  /**
   * Retrieve and rehydrate a ProjectSpec by ID.
   * Checks in-memory cache first; if missing (e.g. after restart),
   * reads from disk and reconstructs a full ProjectSpec instance.
   * @param {string} id
   * @returns {ProjectSpec|null}
   */
  get(id) {
    if (!id) return null;

    if (this.cache.has(id)) {
      return this.cache.get(id);
    }

    const filePath = this._filePath(id);
    if (!fs.existsSync(filePath)) {
      return null;
    }

    try {
      const raw = fs.readFileSync(filePath, "utf8");
      const parsed = JSON.parse(raw);
      const spec = ProjectSpec.fromJSON(parsed);
      this.cache.set(spec.id, spec);
      return spec;
    } catch (err) {
      console.error(`SpecRepository.get failed to hydrate ${id}:`, err.message);
      return null;
    }
  }

  /**
   * Mutate a spec using an updater function and atomically save the result.
   * @param {string} id
   * @param {(spec: ProjectSpec) => void} updater
   * @returns {ProjectSpec}
   */
  update(id, updater) {
    const spec = this.get(id);
    if (!spec) {
      throw new Error(`Spec ${id} not found`);
    }

    if (typeof updater === "function") {
      updater(spec);
    }

    return this.save(spec);
  }

  /**
   * List all stored specifications with summarized metadata.
   * @returns {Array<{ id: string, title: string, version: number, createdAt: string, updatedAt: string, itemCount: number }>}
   */
  list() {
    try {
      const files = fs.readdirSync(this.dataDir).filter((f) => f.endsWith(".json") && !f.includes(".tmp."));
      const specs = [];

      for (const file of files) {
        const id = file.replace(/\.json$/, "");
        const spec = this.get(id);
        if (spec) {
          specs.push({
            id: spec.id,
            title: spec.title,
            version: spec.version,
            createdAt: spec.createdAt,
            updatedAt: spec.updatedAt,
            itemCount: spec.items.size,
          });
        }
      }

      return specs.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    } catch (err) {
      console.error("SpecRepository.list error:", err.message);
      return [];
    }
  }

  /**
   * Delete a specification from cache and disk.
   * @param {string} id
   * @returns {boolean}
   */
  delete(id) {
    this.cache.delete(id);
    const filePath = this._filePath(id);
    if (fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
        return true;
      } catch (err) {
        console.error(`Failed to delete spec ${id}:`, err.message);
        return false;
      }
    }
    return false;
  }

  /**
   * Clear in-memory cache (simulates server restart for testing).
   */
  clearCache() {
    this.cache.clear();
  }
}
