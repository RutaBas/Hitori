/*
 * rules.js — the three Hitori rules as pure, headless functions.
 *
 * These operate on a flat `shadedMask` (Int8/boolean array, length N*N) describing
 * which cells are shaded in a *candidate solution*. They know nothing about player
 * marks or the DOM. The solver's counting mode and the generator's uniqueness check
 * both reuse these, so they live on their own with no dependencies.
 *
 * Board rules:
 *   1. No number repeats in any row/column, counting only un-shaded (white) cells.
 *   2. Shaded cells never touch orthogonally.
 *   3. All white cells form a single orthogonally-connected region.
 *
 * Indexing: cell (r, c) is at index r * N + c. Row-major, 0-based.
 */

// Rule 2 — no two shaded cells orthogonally adjacent.
function noAdjacentShaded(shadedMask, N) {
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      const i = r * N + c;
      if (!shadedMask[i]) continue;
      // Only need to check right and down; left/up are covered symmetrically.
      if (c + 1 < N && shadedMask[i + 1]) return false;
      if (r + 1 < N && shadedMask[i + N]) return false;
    }
  }
  return true;
}

/*
 * Rule 3 helper — flood-fill over the white (un-shaded) cells.
 *
 * Returns { order, count }:
 *   order — the white cell indices in BFS visitation order from the first white cell
 *           (reused later for the win-animation light sweep — do NOT fake that sweep).
 *   count — number of white cells reached.
 * The region is connected iff count === (total white cells).
 *
 * `startIndex` is optional; when omitted, BFS starts from the first white cell found.
 * Passing a start lets callers (e.g. the win animation) sweep from the last-tapped cell.
 */
function floodWhite(shadedMask, N, startIndex) {
  const total = N * N;
  const visited = new Uint8Array(total);
  const order = [];
  const dist = new Int32Array(total).fill(-1); // BFS distance from start, -1 = unreached

  let start = startIndex;
  if (start == null || shadedMask[start]) {
    start = -1;
    for (let i = 0; i < total; i++) {
      if (!shadedMask[i]) { start = i; break; }
    }
  }
  if (start === -1) return { order, count: 0, rings: [], dist };

  // Simple queue via index cursor to avoid Array.shift() cost on the 10x10 tier.
  const queue = [start];
  visited[start] = 1;
  dist[start] = 0;
  let head = 0;
  while (head < queue.length) {
    const i = queue[head++];
    order.push(i);
    const r = (i / N) | 0;
    const c = i - r * N;
    // up, down, left, right
    if (r > 0)     { const n = i - N; if (!shadedMask[n] && !visited[n]) { visited[n] = 1; dist[n] = dist[i] + 1; queue.push(n); } }
    if (r + 1 < N) { const n = i + N; if (!shadedMask[n] && !visited[n]) { visited[n] = 1; dist[n] = dist[i] + 1; queue.push(n); } }
    if (c > 0)     { const n = i - 1; if (!shadedMask[n] && !visited[n]) { visited[n] = 1; dist[n] = dist[i] + 1; queue.push(n); } }
    if (c + 1 < N) { const n = i + 1; if (!shadedMask[n] && !visited[n]) { visited[n] = 1; dist[n] = dist[i] + 1; queue.push(n); } }
  }
  // Group indices by BFS distance — the concentric "rings" the win light-sweep lights up.
  const rings = [];
  for (const i of order) {
    const d = dist[i];
    (rings[d] || (rings[d] = [])).push(i);
  }
  return { order, count: queue.length, rings, dist };
}

// Rule 3 — every white cell reachable from any other white cell (one region).
function whiteRegionConnected(shadedMask, N) {
  const total = N * N;
  let whiteCount = 0;
  for (let i = 0; i < total; i++) if (!shadedMask[i]) whiteCount++;
  if (whiteCount === 0) return false; // an all-shaded board has no connected white region
  const { count } = floodWhite(shadedMask, N);
  return count === whiteCount;
}

// Rule 1 — among white cells only, no number repeats in a row or column.
function noDuplicateInLines(numbers, shadedMask, N) {
  // Rows
  for (let r = 0; r < N; r++) {
    const seen = new Set();
    for (let c = 0; c < N; c++) {
      const i = r * N + c;
      if (shadedMask[i]) continue;
      const v = numbers[i];
      if (seen.has(v)) return false;
      seen.add(v);
    }
  }
  // Columns
  for (let c = 0; c < N; c++) {
    const seen = new Set();
    for (let r = 0; r < N; r++) {
      const i = r * N + c;
      if (shadedMask[i]) continue;
      const v = numbers[i];
      if (seen.has(v)) return false;
      seen.add(v);
    }
  }
  return true;
}

// All three rules, cheapest-to-most-expensive so early rejection is fast.
function isValidSolution(numbers, shadedMask, N) {
  return (
    noAdjacentShaded(shadedMask, N) &&
    noDuplicateInLines(numbers, shadedMask, N) &&
    whiteRegionConnected(shadedMask, N)
  );
}

// Node-only export. In the browser these are ambient globals from the <script> tag.
if (typeof module !== "undefined") {
  module.exports = {
    noAdjacentShaded,
    floodWhite,
    whiteRegionConnected,
    noDuplicateInLines,
    isValidSolution,
  };
}
