// Deterministic helpers so every simulated run is reproducible from a seed.

/** FNV-1a hash of a string -> uint32 seed. */
export function hashSeed(str) {
  let h = 2166136261 >>> 0;
  for (const c of String(str)) {
    h ^= c.codePointAt(0);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** mulberry32 PRNG: small, fast, deterministic. */
export function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Rough token estimate: words * 1.33 (close enough for English prose). */
export function estimateTokens(text) {
  if (!text || !text.trim()) return 0;
  return Math.max(1, Math.round(text.trim().split(/\s+/).length * 1.33));
}
