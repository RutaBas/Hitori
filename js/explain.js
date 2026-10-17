/*
 * explain.js — explained deductions (T1–T4) and clash detection for the hint system.
 *
 * The solver's applyT* functions grade puzzles and stay untouched. This module re-derives
 * the same deductions WITH EVIDENCE: for each forced cell it records which cells force it
 * and a plain sentence saying why. test/explain.test.js proves it agrees with the solver.
 *
 *   explainTier(cells, numbers, N, tier 1..4) -> Explanation[]  (every deduction available now)
 *   findClash(cells, numbers, N)              -> Clash | null   (first rule violation)
 *   cellName(i, N)                            -> "row 3, column 5" (1-based)
 *
 * Explanation = { i, value, tier, technique, rule, evidence (sorted), short, text }
 * Clash       = { rule: "duplicate"|"touching"|"split"|"stranded", cells (sorted), text }
 *
 * Only UNKNOWN cells are explained (one entry per target cell, first rule found wins).
 * Explanations use the state as given — no cascading within a call — so every target is a
 * cell the matching applyT<t> would also set.
 */

// Node-only: pull solver.js (and rules.js) onto global. In the browser these are ambient.
if (typeof module !== "undefined") Object.assign(global, require("./solver.js"));

// solver.js does not export linesOf to node; use it when it is ambient (browser), else build.
function explainLinesOf(N) {
  if (typeof linesOf === "function") return linesOf(N);
  const lines = [];
  for (let r = 0; r < N; r++) { const L = []; for (let c = 0; c < N; c++) L.push(r * N + c); lines.push(L); }
  for (let c = 0; c < N; c++) { const L = []; for (let r = 0; r < N; r++) L.push(r * N + c); lines.push(L); }
  return lines;
}

function cellName(i, N) {
  const r = (i / N) | 0, c = i - r * N;
  return "row " + (r + 1) + ", column " + (c + 1);
}

// Line index li (0..N-1 rows, N..2N-1 columns) -> "row 3" / "column 2".
function explainLineName(li, N) {
  return li < N ? "row " + (li + 1) : "column " + (li - N + 1);
}

function explainCap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

function explainSorted(arr) { return arr.slice().sort((a, b) => a - b); }

// --- T1: patterns ----------------------------------------------------------
function explainT1(cells, numbers, N, add) {
  const lines = explainLinesOf(N);
  for (let li = 0; li < lines.length; li++) {
    const L = lines[li], n = L.length, line = explainLineName(li, N), Line = explainCap(line);
    for (let k = 0; k + 2 < n; k++) {
      const a = L[k], b = L[k + 1], c = L[k + 2], v = numbers[b];
      if (numbers[a] === numbers[b] && numbers[b] === numbers[c]) {
        const short = "Look at " + line + ": three " + v + "s in a row.";
        add(b, WHITE_, "triple-middle", [a, c], short,
          Line + " has three " + v + "s in a row. If the middle one were shaded, the two outer " + v +
          "s would both have to stay lit (shaded cells can't touch), giving " + line + " two lit " + v +
          "s. So the middle " + v + " stays lit.");
        for (const [t, o1, o2] of [[a, b, c], [c, a, b]]) {
          add(t, BLACK_, "triple-outer", [o1, o2], short,
            Line + " has three " + v + "s in a row, and the middle one must stay lit. This " + v +
            " would repeat it, so it must be shaded.");
        }
      } else if (numbers[a] === numbers[c]) {
        const w = numbers[a];
        add(b, WHITE_, "sandwich", [a, c], "Look at " + line + ": the two " + w + "s with one cell between them.",
          "This cell sits between two " + w + "s. If it were shaded, both " + w +
          "s would have to stay lit (shaded cells can't touch), giving " + line + " two lit " + w +
          "s. So it stays lit.");
      }
    }
    for (let k = 0; k + 1 < n; k++) {
      const a = L[k], b = L[k + 1];
      if (numbers[a] !== numbers[b]) continue;
      const v = numbers[a];
      for (let j = 0; j < n; j++) {
        if (j === k || j === k + 1 || numbers[L[j]] !== v) continue;
        add(L[j], BLACK_, "pair-elsewhere", [a, b], "Look at " + line + ": the two " + v + "s side by side.",
          Line + " has two " + v + "s side by side. One of them must stay lit, so any other " + v +
          " in " + line + " must be shaded.");
      }
    }
  }
}

// --- T2: propagation -------------------------------------------------------
function explainT2(cells, numbers, N, add) {
  const total = N * N;
  for (let i = 0; i < total; i++) {
    if (cells[i] !== BLACK_) continue;
    for (const nb of neighborsOf(i, N)) {
      add(nb, WHITE_, "neighbour-of-shaded", [i], "Look at the shaded cell at " + cellName(i, N) + ".",
        "This cell touches a shaded cell, and shaded cells can't touch, so it stays lit.");
    }
  }
  const lines = explainLinesOf(N);
  for (let li = 0; li < lines.length; li++) {
    const L = lines[li], kind = li < N ? "row" : "column";
    for (let k = 0; k < L.length; k++) {
      if (cells[L[k]] !== WHITE_) continue;
      const v = numbers[L[k]];
      for (let j = 0; j < L.length; j++) {
        if (j === k || numbers[L[j]] !== v) continue;
        add(L[j], BLACK_, "duplicate-of-lit", [L[k]], "Look at the lit " + v + " in " + explainLineName(li, N) + ".",
          "There's already a lit " + v + " in this " + kind + ", so this " + v + " must be shaded.");
      }
    }
  }
}

// --- T3: lifeline ----------------------------------------------------------
function explainT3(cells, numbers, N, add) {
  const total = N * N;
  for (let i = 0; i < total; i++) {
    if (cells[i] !== WHITE_) continue;
    const nbs = neighborsOf(i, N);
    const open = nbs.filter((x) => cells[x] !== BLACK_);
    if (open.length !== 1) continue;
    const walls = nbs.filter((x) => cells[x] === BLACK_);
    add(open[0], WHITE_, "lifeline", [i].concat(walls), "Look at the lit cell at " + cellName(i, N) + " and its neighbours.",
      "The lit cell at " + cellName(i, N) + " has only one open neighbour: this one. Shade it and that cell is cut off, so it stays lit.");
  }
}

// --- T4: cut-off -----------------------------------------------------------
// Where a group of cells sits on the board, e.g. "top-left", "bottom", "middle".
function explainRegionWord(group, N) {
  let rs = 0, cs = 0;
  for (const i of group) { const r = (i / N) | 0; rs += r; cs += i - r * N; }
  const rm = rs / group.length, cm = cs / group.length, mid = (N - 1) / 2, band = N / 6;
  const v = rm < mid - band ? "top" : rm > mid + band ? "bottom" : "";
  const h = cm < mid - band ? "left" : cm > mid + band ? "right" : "";
  return v && h ? v + "-" + h : v || h || "middle";
}

function explainT4(cells, numbers, N, add) {
  const total = N * N;
  const whites = [];
  for (let i = 0; i < total; i++) if (cells[i] === WHITE_) whites.push(i);
  if (whites.length < 2) return;
  const reach = (block) => {
    const seen = new Uint8Array(total);
    const q = [whites[0]]; seen[whites[0]] = 1; let h = 0;
    while (h < q.length) {
      const x = q[h++];
      for (const nb of neighborsOf(x, N)) {
        if (cells[nb] === BLACK_ || nb === block || seen[nb]) continue;
        seen[nb] = 1; q.push(nb);
      }
    }
    return seen;
  };
  const base = reach(-1);
  for (const w of whites) if (!base[w]) return; // already split: a clash, not a deduction
  for (let u = 0; u < total; u++) {
    if (cells[u] !== UNKNOWN_) continue;
    const seen = reach(u);
    const near = whites.filter((w) => seen[w]), far = whites.filter((w) => !seen[w]);
    if (far.length === 0) continue;
    const group = far.length <= near.length ? far : near; // the smaller side is the one cut off
    const where = group.length === 1 ? "the lit cell at " + cellName(group[0], N)
      : "the " + explainRegionWord(group, N) + " lit cells";
    add(u, WHITE_, "cut-off", group, "Look at how the lit cells connect through " + cellName(u, N) + ".",
      "Shading this cell would split the lit cells in two (" + where + " from the rest), so it stays lit.");
  }
}

const EXPLAIN_FNS = [null, explainT1, explainT2, explainT3, explainT4];

function explainTier(cells, numbers, N, tier) {
  const fn = EXPLAIN_FNS[tier];
  if (!fn) throw new Error("explainTier: tier must be 1..4, got " + tier);
  const out = [], taken = new Set();
  const add = (i, value, rule, evidence, short, text) => {
    if (cells[i] !== UNKNOWN_ || taken.has(i)) return;
    taken.add(i);
    out.push({ i, value, tier, technique: TECHNIQUE_NAMES[tier], rule,
      evidence: explainSorted(evidence), short, text });
  };
  fn(cells, numbers, N, add);
  return out;
}

// --- clashes ---------------------------------------------------------------
// UNKNOWN counts as possibly lit (it does not block connectivity).
function findClash(cells, numbers, N) {
  const total = N * N;
  const lines = explainLinesOf(N);
  for (let li = 0; li < lines.length; li++) {
    const first = new Map();
    for (const idx of lines[li]) {
      if (cells[idx] !== WHITE_) continue;
      const v = numbers[idx];
      if (first.has(v)) {
        return { rule: "duplicate", cells: explainSorted([first.get(v), idx]),
          text: explainCap(explainLineName(li, N)) + " has two lit " + v + "s. A number can't repeat among the lit cells of a row or column." };
      }
      first.set(v, idx);
    }
  }
  for (let i = 0; i < total; i++) {
    if (cells[i] !== BLACK_) continue;
    const r = (i / N) | 0, c = i - r * N;
    for (const j of [c + 1 < N ? i + 1 : -1, r + 1 < N ? i + N : -1]) {
      if (j >= 0 && cells[j] === BLACK_) {
        return { rule: "touching", cells: [i, j], text: "These two shaded cells touch. Shaded cells can't be side by side." };
      }
    }
  }
  const whites = [];
  for (let i = 0; i < total; i++) if (cells[i] === WHITE_) whites.push(i);
  if (whites.length < 2) return null;
  for (const w of whites) {
    const nbs = neighborsOf(w, N);
    if (nbs.every((x) => cells[x] === BLACK_)) {
      return { rule: "stranded", cells: explainSorted([w].concat(nbs)),
        text: "This lit cell is boxed in by shaded cells, so it can't connect to the other lit cells." };
    }
  }
  const seen = new Uint8Array(total);
  const q = [whites[0]]; seen[whites[0]] = 1; let h = 0;
  while (h < q.length) {
    const x = q[h++];
    for (const nb of neighborsOf(x, N)) {
      if (cells[nb] === BLACK_ || seen[nb]) continue;
      seen[nb] = 1; q.push(nb);
    }
  }
  const cut = whites.filter((w) => !seen[w]);
  if (cut.length) {
    return { rule: "split", cells: explainSorted([whites[0]].concat(cut)),
      text: "The lit cells are split into separate groups by shaded cells. All lit cells must connect." };
  }
  return null;
}

// Local aliases for the solver's cell values (SolveCell is ambient in the browser).
const UNKNOWN_ = SolveCell.UNKNOWN, WHITE_ = SolveCell.WHITE, BLACK_ = SolveCell.BLACK;

if (typeof module !== "undefined") {
  module.exports = { explainTier, findClash, cellName };
}
