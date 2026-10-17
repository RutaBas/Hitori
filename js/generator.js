/*
 * generator.js — Hitori puzzle generator.
 *
 * Pipeline (see the brief's GENERATOR section):
 *   1. Pick a shaded pattern satisfying rules 2 & 3 (no two shaded orthogonally adjacent;
 *      white region connected) at a density appropriate to the tier.
 *   2. Assign numbers: white cells get values distinct within their row AND column (taken
 *      from a random Latin square); every shaded cell gets a value that DUPLICATES a white
 *      cell in its own row or column — condition (a), the hard necessary condition. Without
 *      it, un-shading that cell would yield another valid solution.
 *   3. Count solutions exhaustively. Reject unless exactly 1.
 *   4. Solve deductively. Reject unless the MAX tier required is an EXACT match for target.
 *   5. Retry on rejection.
 *
 * Output puzzle = { N, numbers, solution (shadedMask), tier, attempts }.
 */

if (typeof module !== "undefined") {
  Object.assign(global, require("./rules.js"));
  Object.assign(global, require("./solver.js"));
}

// --- small PRNG so sweeps/generation are reproducible when a seed is supplied ----------
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// String -> uint32 seed (FNV-1a + Murmur3 finalizer; same as TicTacLogic generator.js).
function hashString(str) {
  let h = 0x811c9dc5 >>> 0; // FNV-1a offset basis
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193); // FNV prime
  }
  h ^= h >>> 16; h = Math.imul(h, 0x45d9f3b);
  h ^= h >>> 16; h = Math.imul(h, 0x45d9f3b);
  h ^= h >>> 16;
  return h >>> 0;
}

// Compact puzzle string: one base-36 char per cell (values 1..10 -> "1".."9","a").
function encodeNumbers(numbers) {
  let s = "";
  for (let i = 0; i < numbers.length; i++) s += numbers[i].toString(36);
  return s;
}
function decodeNumbers(str) {
  const out = new Int8Array(str.length);
  for (let i = 0; i < str.length; i++) out[i] = parseInt(str[i], 36);
  return out;
}

function shuffle(arr, rand) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = (rand() * (i + 1)) | 0;
    const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
  }
  return arr;
}

function nbrs(i, N) {
  const r = (i / N) | 0, c = i - r * N, out = [];
  if (r > 0) out.push(i - N);
  if (r + 1 < N) out.push(i + N);
  if (c > 0) out.push(i - 1);
  if (c + 1 < N) out.push(i + 1);
  return out;
}

/*
 * Step 1 — grow a shaded pattern up to `targetShaded` cells, keeping shaded cells
 * mutually non-adjacent and the white region connected at every step.
 * Returns { mask, placed }.
 */
function buildPattern(N, targetShaded, rand) {
  const total = N * N;
  const mask = new Int8Array(total); // 0 = white, 1 = shaded
  const order = shuffle([...Array(total).keys()], rand);
  let placed = 0;
  for (const i of order) {
    if (placed >= targetShaded) break;
    if (mask[i]) continue;
    if (nbrs(i, N).some((x) => mask[x])) continue; // rule 2: no adjacent shaded
    mask[i] = 1;
    if (whiteRegionConnected(mask, N)) placed++; // rule 3 held
    else mask[i] = 0;                            // revert
  }
  return { mask, placed };
}

/*
 * Step 2a — a random Latin square (cyclic base with permuted rows, columns, symbols).
 * Every row and column is a permutation of 1..N, so any subset of cells (e.g. the white
 * cells) is automatically distinct within each line.
 */
function randomLatin(N, rand) {
  const rows = shuffle([...Array(N).keys()], rand);
  const cols = shuffle([...Array(N).keys()], rand);
  const syms = shuffle([...Array(N).keys()], rand);
  const L = new Array(N * N);
  for (let r = 0; r < N; r++)
    for (let c = 0; c < N; c++)
      L[r * N + c] = syms[(rows[r] + cols[c]) % N] + 1;
  return L;
}

/*
 * Step 2b — assign numbers. White cells take their Latin value. Each shaded cell borrows a
 * value that already appears on a white cell in its row or column (condition (a)). Returns
 * numbers, or null if some shaded cell has no white cell to borrow from (regenerate).
 */
function assignNumbers(N, mask, L, rand) {
  const numbers = L.slice();
  for (let i = 0; i < N * N; i++) {
    if (!mask[i]) continue;
    const r = (i / N) | 0, c = i - r * N;
    const candidates = [];
    for (let cc = 0; cc < N; cc++) { const j = r * N + cc; if (!mask[j]) candidates.push(L[j]); }
    for (let rr = 0; rr < N; rr++) { const j = rr * N + c; if (!mask[j]) candidates.push(L[j]); }
    if (candidates.length === 0) return null;
    numbers[i] = candidates[(rand() * candidates.length) | 0];
  }
  return numbers;
}

/*
 * Classify a finished candidate: how many solutions, and (if unique) the deductive tier.
 * tier === Infinity means it is unique but needs guessing beyond T6 (reject).
 */
function classify(numbers, N) {
  const solutions = countSolutions(numbers, N, 2);
  if (solutions !== 1) return { solutions, unique: false, tier: null };
  const r = solve(numbers, N);
  return { solutions, unique: true, tier: r.solved ? r.tier : Infinity };
}

/*
 * Generate one candidate (pattern + numbers) at a given shaded density. No filtering.
 */
function generateCandidate(N, densityFrac, rand) {
  const target = Math.round(densityFrac * N * N);
  const { mask } = buildPattern(N, target, rand);
  const L = randomLatin(N, rand);
  const numbers = assignNumbers(N, mask, L, rand);
  return numbers ? { N, numbers, mask } : null;
}

/*
 * Generate a puzzle whose required tier EXACTLY equals `targetTier`.
 * opts: { densityFrac, maxAttempts, seed }. Returns the puzzle or null if it ran out of
 * attempts (with the attempt count either way).
 */
function generatePuzzle(N, targetTier, opts) {
  opts = opts || {};
  const densityFrac = opts.densityFrac != null ? opts.densityFrac : 0.28;
  const maxAttempts = opts.maxAttempts != null ? opts.maxAttempts : 4000;
  const rand = opts.rand || mulberry32((opts.seed != null ? opts.seed : (Math.random() * 2 ** 31)) | 0);

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const cand = generateCandidate(N, densityFrac, rand);
    if (!cand) continue;
    const c = classify(cand.numbers, N);
    if (c.unique && c.tier === targetTier) {
      return { N, numbers: cand.numbers, solution: cand.mask, tier: targetTier, attempts: attempt };
    }
  }
  return { failed: true, attempts: maxAttempts };
}

/*
 * The Solitude ladder — locked empirically (see test/sweep.js + test/sweep2.js). Only
 * three technique tiers (T3/T4/T6) are producible as exact ceilings; T1/T2/T5 essentially
 * never occur, so the six tiers map onto those three bands, each spanning two sizes so
 * difficulty rises on both the technique and size axes. Densities are the sweep's picks.
 */
const TIERS = [
  null, // 1-indexed
  { tier: 1, name: "Crowded",  size: 5,  technique: 3, density: 0.30 },
  { tier: 2, name: "Bustling", size: 6,  technique: 3, density: 0.30 },
  { tier: 3, name: "Murmur",   size: 7,  technique: 4, density: 0.30 },
  { tier: 4, name: "Hushed",   size: 8,  technique: 4, density: 0.30 },
  { tier: 5, name: "Secluded", size: 9,  technique: 6, density: 0.34 },
  { tier: 6, name: "Solitary", size: 10, technique: 6, density: 0.36 },
];

// Generate a puzzle for a ladder tier (1..6). Returns the puzzle augmented with the tier
// index and name, or a { failed:true } object if it exhausted attempts.
function generateTier(tier, opts) {
  const cfg = TIERS[tier];
  if (!cfg) throw new Error("unknown tier " + tier);
  const p = generatePuzzle(cfg.size, cfg.technique, Object.assign({ densityFrac: cfg.density, maxAttempts: 20000 }, opts || {}));
  if (p && !p.failed) { p.tierIndex = tier; p.name = cfg.name; }
  return p;
}

if (typeof module !== "undefined") {
  module.exports = {
    mulberry32, shuffle, hashString, encodeNumbers, decodeNumbers,
    buildPattern, randomLatin, assignNumbers,
    generateCandidate, classify, generatePuzzle,
    TIERS, generateTier,
  };
}
