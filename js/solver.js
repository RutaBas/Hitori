/*
 * solver.js — Hitori solver: deductive tiers T1–T6 + exhaustive counting mode.
 *
 * Two modes (see the brief):
 *   - deductive: apply human techniques in escalating tiers, report the MAX tier that
 *     was required. Difficulty is graded by which techniques are needed, not by size.
 *   - counting: exhaustive DFS (with cheap sound propagation) returning the exact number
 *     of solutions, capped at `cap` (default 2 — the generator only needs ">1").
 *
 * Solving works on a `cells` Int8Array (length N*N) whose values are UNKNOWN/WHITE/BLACK
 * — the solver's partial assignment, distinct from board.js's player-facing CellState.
 * WHITE = definitely un-shaded, BLACK = definitely shaded.
 *
 * Every tier is SOUND: it only forces a cell to a value that MUST hold in every valid
 * solution. That is what lets counting-mode reuse the low tiers as propagation without
 * changing the solution count.
 *
 * Grading is greedy-cheapest: after ANY deduction the engine restarts at T1, so a higher
 * tier is only ever credited when all cheaper tiers are stuck — i.e. genuinely required.
 */

// Node-only: pull rules.js onto global (isValidSolution, floodWhite, ...). Never declare
// new bindings here — in the browser these are ambient globals from the <script> tag.
if (typeof module !== "undefined") Object.assign(global, require("./rules.js"));

const SolveCell = { UNKNOWN: 0, WHITE: 1, BLACK: 2 };

// --- line + neighbour helpers (cached per N) ---------------------------------
const _lineCache = new Map();
function linesOf(N) {
  if (_lineCache.has(N)) return _lineCache.get(N);
  const lines = [];
  for (let r = 0; r < N; r++) { const L = []; for (let c = 0; c < N; c++) L.push(r * N + c); lines.push(L); }
  for (let c = 0; c < N; c++) { const L = []; for (let r = 0; r < N; r++) L.push(r * N + c); lines.push(L); }
  _lineCache.set(N, lines);
  return lines;
}

function neighborsOf(i, N) {
  const r = (i / N) | 0, c = i - r * N, out = [];
  if (r > 0)     out.push(i - N);
  if (r + 1 < N) out.push(i + N);
  if (c > 0)     out.push(i - 1);
  if (c + 1 < N) out.push(i + 1);
  return out;
}

// Set a cell. Returns 1 = changed, 0 = already that value, -1 = conflict (opposite set).
function setCell(cells, i, val) {
  const cur = cells[i];
  if (cur === val) return 0;
  if (cur !== SolveCell.UNKNOWN) return -1;
  cells[i] = val;
  return 1;
}

function shadedMaskOf(cells) {
  const mask = new Int8Array(cells.length);
  for (let i = 0; i < cells.length; i++) mask[i] = cells[i] === SolveCell.BLACK ? 1 : 0;
  return mask;
}

/*
 * partialConflict — is the current partial assignment already impossible?
 * Sound early-out: adjacency (two blacks touch), duplicate whites in a line, and white
 * cells that are already split across the non-black graph (can never reconnect).
 */
function partialConflict(cells, numbers, N) {
  const total = N * N;
  // rule 2: two BLACK orthogonally adjacent
  for (let i = 0; i < total; i++) {
    if (cells[i] !== SolveCell.BLACK) continue;
    const r = (i / N) | 0, c = i - r * N;
    if (c + 1 < N && cells[i + 1] === SolveCell.BLACK) return true;
    if (r + 1 < N && cells[i + N] === SolveCell.BLACK) return true;
  }
  // rule 1: two WHITE with the same number in a line
  for (const L of linesOf(N)) {
    const seen = new Set();
    for (const idx of L) {
      if (cells[idx] !== SolveCell.WHITE) continue;
      const v = numbers[idx];
      if (seen.has(v)) return true;
      seen.add(v);
    }
  }
  // rule 3 (prune): known whites must stay reachable through non-black cells
  const whites = [];
  for (let i = 0; i < total; i++) if (cells[i] === SolveCell.WHITE) whites.push(i);
  if (whites.length >= 2) {
    const seen = new Uint8Array(total);
    const q = [whites[0]]; seen[whites[0]] = 1; let h = 0;
    while (h < q.length) {
      const x = q[h++];
      for (const nb of neighborsOf(x, N)) {
        if (cells[nb] === SolveCell.BLACK) continue;
        if (!seen[nb]) { seen[nb] = 1; q.push(nb); }
      }
    }
    for (const w of whites) if (!seen[w]) return true;
  }
  return false;
}

// --- T1: pattern rules -------------------------------------------------------
// Triple  X X X          -> middle WHITE, both outer BLACK
// Sandwich X ? X         -> the middle cell WHITE
// Pair X X + another X   -> that other X BLACK
function applyT1(cells, numbers, N) {
  let changed = 0;
  for (const L of linesOf(N)) {
    const n = L.length;
    for (let k = 0; k + 2 < n; k++) {
      const a = L[k], b = L[k + 1], c = L[k + 2];
      if (numbers[a] === numbers[b] && numbers[b] === numbers[c]) {
        let s;
        s = setCell(cells, b, SolveCell.WHITE); if (s < 0) return { changed, contradiction: true }; changed += s;
        s = setCell(cells, a, SolveCell.BLACK); if (s < 0) return { changed, contradiction: true }; changed += s;
        s = setCell(cells, c, SolveCell.BLACK); if (s < 0) return { changed, contradiction: true }; changed += s;
      } else if (numbers[a] === numbers[c]) {
        const s = setCell(cells, b, SolveCell.WHITE); if (s < 0) return { changed, contradiction: true }; changed += s;
      }
    }
    for (let k = 0; k + 1 < n; k++) {
      const a = L[k], b = L[k + 1];
      if (numbers[a] !== numbers[b]) continue;
      const v = numbers[a];
      for (let j = 0; j < n; j++) {
        if (j === k || j === k + 1) continue;
        if (numbers[L[j]] === v) {
          const s = setCell(cells, L[j], SolveCell.BLACK); if (s < 0) return { changed, contradiction: true }; changed += s;
        }
      }
    }
  }
  return { changed, contradiction: false };
}

// --- T2: propagation ---------------------------------------------------------
// BLACK -> all orthogonal neighbours WHITE.   WHITE -> same number elsewhere in line BLACK.
function applyT2(cells, numbers, N) {
  let changed = 0;
  const total = N * N;
  for (let i = 0; i < total; i++) {
    if (cells[i] !== SolveCell.BLACK) continue;
    for (const nb of neighborsOf(i, N)) {
      const s = setCell(cells, nb, SolveCell.WHITE); if (s < 0) return { changed, contradiction: true }; changed += s;
    }
  }
  for (const L of linesOf(N)) {
    for (let k = 0; k < L.length; k++) {
      if (cells[L[k]] !== SolveCell.WHITE) continue;
      const v = numbers[L[k]];
      for (let j = 0; j < L.length; j++) {
        if (j === k) continue;
        if (numbers[L[j]] === v) {
          const s = setCell(cells, L[j], SolveCell.BLACK); if (s < 0) return { changed, contradiction: true }; changed += s;
        }
      }
    }
  }
  return { changed, contradiction: false };
}

// --- T3: basic connectivity --------------------------------------------------
// Corner rule + articulation: a WHITE cell with a single non-black neighbour forces that
// neighbour WHITE (it is the cell's only lifeline); zero non-black neighbours -> stranded.
function applyT3(cells, numbers, N) {
  let changed = 0;
  const total = N * N;
  for (const [r, c] of [[0, 0], [0, N - 1], [N - 1, 0], [N - 1, N - 1]]) {
    const i = r * N + c;
    const nb = neighborsOf(i, N);
    if (nb.length && nb.every((x) => cells[x] === SolveCell.BLACK)) return { changed, contradiction: true };
  }
  let whiteCount = 0;
  for (let i = 0; i < total; i++) if (cells[i] === SolveCell.WHITE) whiteCount++;
  for (let i = 0; i < total; i++) {
    if (cells[i] !== SolveCell.WHITE) continue;
    const nonBlack = neighborsOf(i, N).filter((x) => cells[x] !== SolveCell.BLACK);
    if (nonBlack.length === 0) {
      if (whiteCount > 1) return { changed, contradiction: true };
    } else if (nonBlack.length === 1) {
      const s = setCell(cells, nonBlack[0], SolveCell.WHITE); if (s < 0) return { changed, contradiction: true }; changed += s;
    }
  }
  return { changed, contradiction: false };
}

// --- T4: reachability --------------------------------------------------------
// Global cut-vertex: any UNKNOWN cell whose shading would disconnect the known-white set
// (over the non-black graph) MUST be white.
function applyT4(cells, numbers, N) {
  let changed = 0;
  const total = N * N;
  const whites = [];
  for (let i = 0; i < total; i++) if (cells[i] === SolveCell.WHITE) whites.push(i);
  if (whites.length < 2) return { changed, contradiction: false };

  const reach = (block) => {
    const seen = new Uint8Array(total);
    const q = [whites[0]]; seen[whites[0]] = 1; let h = 0;
    while (h < q.length) {
      const x = q[h++];
      for (const nb of neighborsOf(x, N)) {
        if (cells[nb] === SolveCell.BLACK || nb === block) continue;
        if (!seen[nb]) { seen[nb] = 1; q.push(nb); }
      }
    }
    return seen;
  };
  const base = reach(-1);
  for (const w of whites) if (!base[w]) return { changed, contradiction: true };
  for (let u = 0; u < total; u++) {
    if (cells[u] !== SolveCell.UNKNOWN) continue;
    const seen = reach(u);
    let disconnects = false;
    for (const w of whites) if (!seen[w]) { disconnects = true; break; }
    if (disconnects) {
      const s = setCell(cells, u, SolveCell.WHITE); if (s < 0) return { changed, contradiction: true }; changed += s;
    }
  }
  return { changed, contradiction: false };
}

// --- T5: chains (common consequence) -----------------------------------------
// For an UNKNOWN cell u: propagate (T1–T2) both u=WHITE and u=BLACK. Any OTHER cell that
// lands on the SAME value in both branches is forced regardless of u — a sound multi-step
// chain with no contradiction reasoning (that is T6's job). Branches that contradict are
// left untouched here so the tier boundary stays clean.
function applyT5(cells, numbers, N) {
  const total = N * N;
  for (let u = 0; u < total; u++) {
    if (cells[u] !== SolveCell.UNKNOWN) continue;
    const cw = cells.slice(); cw[u] = SolveCell.WHITE; const rw = deduce(cw, numbers, N, 2);
    const cb = cells.slice(); cb[u] = SolveCell.BLACK; const rb = deduce(cb, numbers, N, 2);
    if (rw.contradiction && rb.contradiction) return { changed: 0, contradiction: true };
    if (rw.contradiction || rb.contradiction) continue;
    let changed = 0;
    for (let z = 0; z < total; z++) {
      if (z === u || cells[z] !== SolveCell.UNKNOWN) continue;
      if (cw[z] !== SolveCell.UNKNOWN && cw[z] === cb[z]) {
        const s = setCell(cells, z, cw[z]); if (s < 0) return { changed, contradiction: true }; changed += s;
      }
    }
    if (changed) return { changed, contradiction: false }; // apply, then restart from T1
  }
  return { changed: 0, contradiction: false };
}

// --- T6: limited contradiction ----------------------------------------------
// One-step lookahead: assume a cell BLACK, propagate T1–T5; if it contradicts, the cell
// must be WHITE. Symmetric for the WHITE assumption. This is the deductive ceiling —
// anything past it is guessing and the generator must reject it.
function applyT6(cells, numbers, N) {
  const total = N * N;
  for (let u = 0; u < total; u++) {
    if (cells[u] !== SolveCell.UNKNOWN) continue;
    const cb = cells.slice(); cb[u] = SolveCell.BLACK;
    if (deduce(cb, numbers, N, 5).contradiction) {
      const s = setCell(cells, u, SolveCell.WHITE); if (s < 0) return { changed: 0, contradiction: true };
      return { changed: 1, contradiction: false };
    }
    const cw = cells.slice(); cw[u] = SolveCell.WHITE;
    if (deduce(cw, numbers, N, 5).contradiction) {
      const s = setCell(cells, u, SolveCell.BLACK); if (s < 0) return { changed: 0, contradiction: true };
      return { changed: 1, contradiction: false };
    }
  }
  return { changed: 0, contradiction: false };
}

const TIER_FNS = [null, applyT1, applyT2, applyT3, applyT4, applyT5, applyT6];

/*
 * deduce — run tiers 1..maxTier to a fixpoint on `cells` (mutated in place).
 * After any deduction, restart at T1 so the cheapest sufficient technique is always used
 * (this is what makes maxTierUsed a faithful difficulty grade).
 * Returns { contradiction, maxTierUsed }.
 */
function deduce(cells, numbers, N, maxTier) {
  let maxTierUsed = 0;
  for (;;) {
    if (partialConflict(cells, numbers, N)) return { contradiction: true, maxTierUsed };
    let progressed = false;
    for (let t = 1; t <= maxTier; t++) {
      const r = TIER_FNS[t](cells, numbers, N);
      if (r.contradiction) return { contradiction: true, maxTierUsed };
      if (r.changed > 0) {
        if (t > maxTierUsed) maxTierUsed = t;
        progressed = true;
        break;
      }
    }
    if (!progressed) break;
  }
  return { contradiction: false, maxTierUsed };
}

/*
 * solve — deductive mode. Returns { solved, tier, contradiction, cells }.
 * `tier` is the highest technique tier that was required (0 if nothing fired).
 * `solved` is true only when every cell is determined AND the result is a valid solution.
 */
function solve(numbers, N) {
  const cells = new Int8Array(N * N);
  const r = deduce(cells, numbers, N, 6);
  let solved = false;
  if (!r.contradiction) {
    let allDet = true;
    for (let i = 0; i < cells.length; i++) if (cells[i] === SolveCell.UNKNOWN) { allDet = false; break; }
    if (allDet) solved = isValidSolution(numbers, shadedMaskOf(cells), N);
  }
  return { solved, tier: r.maxTierUsed, contradiction: r.contradiction, cells };
}

/*
 * countSolutions — exhaustive DFS with sound T1–T2 propagation + partial pruning.
 * Returns min(trueCount, cap). Default cap 2, since the generator only needs to know
 * whether the count exceeds 1.
 */
function countSolutions(numbers, N, cap) {
  cap = cap == null ? 2 : cap;
  return _dfsCount(new Int8Array(N * N), numbers, N, cap);
}

function _dfsCount(cells, numbers, N, cap) {
  if (deduce(cells, numbers, N, 3).contradiction) return 0; // sound propagation (T1-T3)
  if (partialConflict(cells, numbers, N)) return 0;
  let u = -1;
  for (let i = 0; i < cells.length; i++) if (cells[i] === SolveCell.UNKNOWN) { u = i; break; }
  if (u === -1) return isValidSolution(numbers, shadedMaskOf(cells), N) ? 1 : 0;
  let count = 0;
  for (const val of [SolveCell.BLACK, SolveCell.WHITE]) {
    const c2 = cells.slice(); c2[u] = val;
    count += _dfsCount(c2, numbers, N, cap);
    if (count >= cap) return cap;
  }
  return count;
}

// Friendly technique names for hints (see hintNext).
var TECHNIQUE_NAMES = {
  1: "Pattern", 2: "Propagation", 3: "Connectivity",
  4: "Reachability", 5: "Chain", 6: "Contradiction",
};

/*
 * hintNext — the single next deduction available from a partial state `seed`
 * (UNKNOWN/WHITE/BLACK). Returns the CHEAPEST-tier technique that can force a not-yet-
 * determined cell, so the hint teaches the simplest applicable step. The caller must pass
 * a seed CONSISTENT with the solution (correct player marks only) — inconsistent marks
 * should be corrected before asking for a deduction.
 *
 * Escalation is valid because a tier is only tried when every cheaper tier produced no new
 * cell on `seed` (i.e. `seed` is already closed under them). Returns:
 *   { status:"deduction", i, value, tier, technique }
 *   { status:"contradiction", tier }   // seed leads to a dead end (player error)
 *   { status:"stuck" }                 // nothing forced (solved, or needs guessing)
 */
function hintNext(seed, numbers, N) {
  for (var t = 1; t <= 6; t++) {
    var copy = seed.slice();
    var r = TIER_FNS[t](copy, numbers, N);
    if (r.contradiction) return { status: "contradiction", tier: t };
    for (var i = 0; i < seed.length; i++) {
      if (seed[i] === SolveCell.UNKNOWN && copy[i] !== SolveCell.UNKNOWN) {
        return { status: "deduction", i: i, value: copy[i], tier: t, technique: TECHNIQUE_NAMES[t] };
      }
    }
  }
  return { status: "stuck" };
}

// Node-only export. In the browser these are ambient globals.
if (typeof module !== "undefined") {
  module.exports = {
    SolveCell,
    solve,
    countSolutions,
    deduce,
    partialConflict,
    applyT1, applyT2, applyT3, applyT4, applyT5, applyT6,
    shadedMaskOf,
    linesOf,
    neighborsOf,
    hintNext,
    TECHNIQUE_NAMES,
  };
}
