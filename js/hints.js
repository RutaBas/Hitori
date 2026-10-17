/*
 * hints.js — what the Hint button says next.
 *
 *   stateToCells(state: CellState[])  -> Int8Array of SolveCell (SHADED->BLACK, CIRCLED->WHITE)
 *   nextHint(state, numbers, N, solution: 0/1 shaded mask, lastTap|null) ->
 *       { kind: "mistake", i, cells, text }     a mark is wrong: explained, never silently fixed
 *     | { kind: "deduction", exp }              the next logical step (an Explanation, explain.js)
 *     | { kind: "stuck", i, value, text }       no step found: reveal one cell, said honestly
 *     | { kind: "done" }                        the shaded cells match the solution
 *   distanceTo(exp, lastTap, N) -> min Manhattan distance from lastTap to exp.i or any
 *       evidence cell (0 when lastTap is null)
 *
 * Order: (1) a mark that breaks a rule right now (findClash names the rule and the cells);
 * (2) the earliest mark that disagrees with the solution; (3) done; (4) the cheapest tier
 * with any deduction, nearest the last tap (tie: lowest i) — at T6 the shortest chain first
 * (pickShortest); (5) stuck. Circled cells are the player's "lit"; unmarked lit cells are
 * fine, so the board is done once exactly the solution's cells are shaded.
 *
 * Listings are cached per board state (bounded), so a repeat press is instant even when the
 * cheapest tier is the T6 lookahead. Cached Explanation objects are shared: treat as read-only.
 */

// Node-only: pull board.js, solver.js and explain.js onto global. In the browser these are ambient.
if (typeof module !== "undefined") {
  Object.assign(global, require("./board.js"), require("./solver.js"), require("./explain.js"));
}

function stateToCells(state) {
  const out = new Int8Array(state.length);
  for (let i = 0; i < state.length; i++) {
    out[i] = state[i] === CellState.SHADED ? SolveCell.BLACK
      : state[i] === CellState.CIRCLED ? SolveCell.WHITE : SolveCell.UNKNOWN;
  }
  return out;
}

function distanceTo(exp, lastTap, N) {
  if (lastTap == null) return 0;
  const tr = (lastTap / N) | 0, tc = lastTap - tr * N;
  let best = Infinity;
  for (const x of [exp.i].concat(exp.evidence || [])) {
    const r = (x / N) | 0, d = Math.abs(r - tr) + Math.abs(x - r * N - tc);
    if (d < best) best = d;
  }
  return best;
}

// --- per-board-state cache of the cheapest tier's listing -----------------------------
// key = numbers + cells (one char per cell); value = { tier, entries } (tier 0: nothing).
// A Map keeps insertion order, so deleting the first key evicts the oldest entry.
const HINTS_CACHE_MAX = 32;
const hintsCache = new Map();

function hintsKey(numbers, cells) {
  let s = "";
  for (let i = 0; i < numbers.length; i++) s += numbers[i].toString(36);
  s += "|";
  for (let i = 0; i < cells.length; i++) s += cells[i];
  return s;
}

function hintsListing(cells, numbers, N) {
  const key = hintsKey(numbers, cells);
  const hit = hintsCache.get(key);
  if (hit) {
    hintsCache.delete(key); hintsCache.set(key, hit); // refresh: most recently used last
    return hit;
  }
  let found = { tier: 0, entries: [] };
  for (let t = 1; t <= 6; t++) {
    const entries = explainTier(cells, numbers, N, t);
    if (entries.length) { found = { tier: t, entries }; break; }
  }
  hintsCache.set(key, found);
  if (hintsCache.size > HINTS_CACHE_MAX) hintsCache.delete(hintsCache.keys().next().value);
  return found;
}

// Nearest to lastTap, tie lowest i (T1–T5).
function hintsNearest(entries, lastTap, N) {
  let best = null, bd = Infinity;
  for (const e of entries) {
    const d = distanceTo(e, lastTap, N);
    if (d < bd || (d === bd && e.i < best.i)) { best = e; bd = d; }
  }
  return best;
}

function nextHint(state, numbers, N, solution, lastTap) {
  const total = N * N;
  const cells = stateToCells(state);

  // (1) a rule broken right now
  const clash = findClash(cells, numbers, N);
  if (clash) return { kind: "mistake", i: clash.cells[0], cells: clash.cells.slice(), text: clash.text };

  // (2) the earliest mark the solution disagrees with
  for (let i = 0; i < total; i++) {
    if (state[i] === CellState.SHADED && !solution[i]) {
      return { kind: "mistake", i, cells: [i], text: "This cell can't be shaded. The puzzle can't be finished with it dark." };
    }
    if (state[i] === CellState.CIRCLED && solution[i]) {
      return { kind: "mistake", i, cells: [i], text: "This cell can't stay lit. The puzzle can't be finished with it lit." };
    }
  }

  // (3) done: exactly the solution's cells are shaded (every mark is already correct)
  let done = true;
  for (let i = 0; i < total && done; i++) if (solution[i] && state[i] !== CellState.SHADED) done = false;
  if (done) return { kind: "done" };

  // (4) the cheapest tier with a deduction
  const { tier, entries } = hintsListing(cells, numbers, N);
  if (tier) {
    const exp = tier === 6 ? pickShortest(entries, lastTap, N) : hintsNearest(entries, lastTap, N);
    return { kind: "deduction", exp };
  }

  // (5) stuck: reveal one correct cell, nearest the last tap, preferring a shaded one
  // (unmarked lit cells already count as correct).
  let pick = -1, pd = Infinity;
  for (const wantShade of [1, 0]) {
    for (let i = 0; i < total; i++) {
      if (state[i] !== CellState.UNMARKED || solution[i] !== wantShade) continue;
      const d = distanceTo({ i }, lastTap, N);
      if (d < pd) { pick = i; pd = d; }
    }
    if (pick >= 0) break;
  }
  const value = solution[pick] ? SolveCell.BLACK : SolveCell.WHITE;
  return { kind: "stuck", i: pick, value,
    text: "I can't find a step to explain from here, so here's one cell from the solution: " +
      cellName(pick, N) + (value === SolveCell.BLACK ? " is shaded." : " stays lit.") };
}

if (typeof module !== "undefined") {
  module.exports = { stateToCells, nextHint, distanceTo };
}
