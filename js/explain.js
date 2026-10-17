/*
 * explain.js — explained deductions (T1–T6), traced chains and clash detection for the
 * hint system.
 *
 * The solver's applyT* functions grade puzzles and stay untouched. This module re-derives
 * the same deductions WITH EVIDENCE: for each forced cell it records which cells force it
 * and a plain sentence saying why. test/explain.test.js proves it agrees with the solver.
 *
 *   explainTier(cells, numbers, N, tier 1..6) -> Explanation[]  (every deduction available now)
 *   traceDeduce(cells, numbers, N, maxTier 1..5) -> { steps: Explanation[], clash: Clash|null }
 *       mutates cells: one deduction at a time, cheapest tier first, first entry of that
 *       tier, until a clash appears or nothing more follows.
 *   pickShortest(entries, lastTap, N)         -> Explanation (shortest chain, nearest, lowest i)
 *   findClash(cells, numbers, N)              -> Clash | null   (first rule violation)
 *   cellName(i, N)                            -> "row 3, column 5" (1-based)
 *
 * Explanation = { i, value, tier, technique, rule, evidence (sorted), short, text
 *                 [, chain: Explanation[], clash: Clash] }     // chain/clash: T5, T6 only
 * Clash       = { rule: "duplicate"|"touching"|"split"|"stranded", cells (sorted), text }
 *
 * T5 "both-ways": chain = [assume u lit, ...lit-branch steps, assume u shaded, ...shaded-
 *   branch steps], each branch cut at the step that sets the target.
 * T5 "dead-end" (only inside a T6 lookahead, where the state is already doomed): both values
 *   of u clash; chain = [assume u lit, ...steps], clash = that branch's clash, value BLACK.
 * T6 "contradiction": chain = [assume the target, ...traced steps]; replaying the chain's
 *   (i, value) pairs onto the state reproduces `clash` exactly. value = opposite assumption.
 * Every step in a chain carries its own text (inner chains too).
 *
 * Only UNKNOWN cells are explained (one entry per target cell, first rule found wins).
 * Explanations use the state as given — no cascading within a call — so every T1–T4 target
 * is a cell the matching applyT<t> would also set.
 */

// Node-only: pull solver.js (and rules.js) onto global. In the browser these are ambient.
if (typeof module !== "undefined") Object.assign(global, require("./solver.js"));

// Cells reachable from `start` over non-black cells, treating `block` as shaded too.
function explainReach(cells, N, start, block) {
  const total = N * N, seen = new Uint8Array(total);
  const q = [start]; seen[start] = 1; let h = 0;
  while (h < q.length) {
    const x = q[h++];
    for (const nb of neighborsOf(x, N)) {
      if (cells[nb] === BLACK_ || nb === block || seen[nb]) continue;
      seen[nb] = 1; q.push(nb);
    }
  }
  return seen;
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
  const lines = linesOf(N);
  for (let li = 0; li < lines.length && !add.full; li++) {
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
  for (let i = 0; i < total && !add.full; i++) {
    if (cells[i] !== BLACK_) continue;
    for (const nb of neighborsOf(i, N)) {
      add(nb, WHITE_, "neighbour-of-shaded", [i], "Look at the shaded cell at " + cellName(i, N) + ".",
        "This cell touches a shaded cell, and shaded cells can't touch, so it stays lit.");
    }
  }
  const lines = linesOf(N);
  for (let li = 0; li < lines.length && !add.full; li++) {
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
  for (let i = 0; i < total && !add.full; i++) {
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
  const base = explainReach(cells, N, whites[0], -1);
  for (const w of whites) if (!base[w]) return; // already split: a clash, not a deduction
  for (let u = 0; u < total && !add.full; u++) {
    if (cells[u] !== UNKNOWN_) continue;
    const seen = explainReach(cells, N, whites[0], u);
    const near = whites.filter((w) => seen[w]), far = whites.filter((w) => !seen[w]);
    if (far.length === 0) continue;
    const group = far.length <= near.length ? far : near; // the smaller side is the one cut off
    const where = group.length === 1 ? "the lit cell at " + cellName(group[0], N)
      : "the " + explainRegionWord(group, N) + " lit cells";
    add(u, WHITE_, "cut-off", group, "Look at how the lit cells connect through " + cellName(u, N) + ".",
      "Shading this cell would split the lit cells in two (" + where + " from the rest), so it stays lit.");
  }
}

// --- chains: shared pieces --------------------------------------------------
// The clash, named by the rule it breaks, for summary sentences.
function explainClashPhrase(clash) {
  switch (clash.rule) {
    case "duplicate": return "rule 1: a number repeats among the lit cells";
    case "touching": return "rule 2: two shaded cells touch";
    case "stranded": return "rule 3: a lit cell gets boxed in";
    default: return "rule 3: the lit cells get split apart";
  }
}

function explainSupposeWord(value) { return value === BLACK_ ? "were shaded" : "stayed lit"; }

// The first record of a chain: the supposition the chain follows.
function explainAssume(i, value, N) {
  return { i, value, rule: "assume", evidence: [],
    short: "Suppose " + cellName(i, N) + " " + explainSupposeWord(value) + ".",
    text: "Suppose " + cellName(i, N) + " " + explainSupposeWord(value) + "." };
}

// Cells a chain touches (steps + clash), minus the target: what the hint highlights.
function explainChainCells(chain, clash, target) {
  const s = new Set();
  for (const step of chain) s.add(step.i);
  if (clash) for (const c of clash.cells) s.add(c);
  s.delete(target);
  return Array.from(s);
}

// --- T5: both ways ---------------------------------------------------------
// Mirrors applyT5: the first UNKNOWN u where both T1–T2 branches survive and agree on some
// cell explains every such cell; if both branches die first, that is a dead end (only
// possible inside a doomed T6 lookahead). Detection uses the solver's bulk deduce; only the
// branch actually told is traced step by step.
function explainT5(cells, numbers, N, add) {
  const total = N * N;
  for (let u = 0; u < total; u++) {
    if (cells[u] !== UNKNOWN_) continue;
    const cw = cells.slice(); cw[u] = WHITE_; const rw = deduce(cw, numbers, N, 2);
    const cb = cells.slice(); cb[u] = BLACK_; const rb = deduce(cb, numbers, N, 2);
    if (rw.contradiction && rb.contradiction) {
      const tw = cells.slice(); tw[u] = WHITE_;
      const tr = traceDeduce(tw, numbers, N, 2);
      if (!tr.clash) return; // trace and solver disagree: explain nothing rather than guess
      const chain = [explainAssume(u, WHITE_, N)].concat(tr.steps);
      add(u, BLACK_, "dead-end", explainChainCells(chain, tr.clash, u),
        "Try " + cellName(u, N) + " both ways.",
        "If this cell stayed lit, that leads to a clash (" + explainClashPhrase(tr.clash) +
        "), so it would have to be shaded. Shading it runs into trouble too.",
        { chain, clash: tr.clash });
      return;
    }
    if (rw.contradiction || rb.contradiction) continue;
    const agree = [];
    for (let z = 0; z < total; z++) {
      if (z !== u && cells[z] === UNKNOWN_ && cw[z] !== UNKNOWN_ && cw[z] === cb[z]) agree.push(z);
    }
    if (!agree.length) continue;
    // Trace each branch once; each target's chain is each branch cut where it gets set.
    const branches = [WHITE_, BLACK_].map((val) => {
      const t = cells.slice(); t[u] = val;
      const steps = traceDeduce(t, numbers, N, 2).steps, at = new Map();
      steps.forEach((s, k) => at.set(s.i, k));
      return { val, steps, at };
    });
    for (const z of agree) {
      if (!branches.every((b) => b.at.has(z))) continue;
      const chain = [];
      for (const b of branches) chain.push(explainAssume(u, b.val, N), ...b.steps.slice(0, b.at.get(z) + 1));
      const v = cw[z], ends = v === BLACK_ ? "shaded, so it must be shaded." : "lit, so it stays lit.";
      add(z, v, "both-ways", [u].concat(explainChainCells(chain, null, z)),
        "Try " + cellName(u, N) + " both ways.",
        "Whether " + cellName(u, N) + " is shaded or lit, this cell ends up " + ends, { chain });
    }
    return;
  }
}

// --- T6: contradiction -----------------------------------------------------
// Mirrors applyT6 (shaded first, then lit) for EVERY unknown cell, so the caller can pick
// the shortest chain. The solver's bulk deduce detects the contradiction; only cells that
// contradict are traced step by step.
function explainT6(cells, numbers, N, add) {
  const total = N * N;
  for (let u = 0; u < total; u++) {
    if (cells[u] !== UNKNOWN_) continue;
    for (const val of [BLACK_, WHITE_]) {
      const c = cells.slice(); c[u] = val;
      if (!deduce(c, numbers, N, 5).contradiction) continue;
      const t = cells.slice(); t[u] = val;
      const tr = traceDeduce(t, numbers, N, 5);
      if (!tr.clash) continue; // trace and solver disagree: explain nothing rather than guess
      const chain = [explainAssume(u, val, N)].concat(tr.steps);
      const opp = val === BLACK_ ? WHITE_ : BLACK_;
      add(u, opp, "contradiction", explainChainCells(chain, tr.clash, u),
        "Look at what happens if " + cellName(u, N) + " " + explainSupposeWord(val) + ".",
        "Suppose this " + explainSupposeWord(val) + ". That leads to a clash (" + explainClashPhrase(tr.clash) +
        "), so " + (opp === WHITE_ ? "it stays lit." : "it must be shaded."),
        { chain, clash: tr.clash });
      break;
    }
  }
}

const EXPLAIN_FNS = [null, explainT1, explainT2, explainT3, explainT4, explainT5, explainT6];

// firstOnly: stop at the first entry (add.full tells the tier loops to bail out early);
// the entry is the same one a full call would list first.
function explainCollect(cells, numbers, N, tier, firstOnly) {
  const fn = EXPLAIN_FNS[tier];
  if (!fn) throw new Error("explainTier: tier must be 1..6, got " + tier);
  const out = [], taken = new Set();
  const add = (i, value, rule, evidence, short, text, extra) => {
    if (add.full || cells[i] !== UNKNOWN_ || taken.has(i)) return;
    taken.add(i);
    out.push(Object.assign({ i, value, tier, technique: TECHNIQUE_NAMES[tier], rule,
      evidence: explainSorted(evidence), short, text }, extra));
    if (firstOnly) add.full = true;
  };
  add.full = false;
  fn(cells, numbers, N, add);
  return out;
}

function explainTier(cells, numbers, N, tier) { return explainCollect(cells, numbers, N, tier, false); }

// One deduction at a time, cheapest tier first, first entry of that tier, until a clash
// shows or nothing more follows. Mutates cells. Each step sets one UNKNOWN cell, so it ends.
function traceDeduce(cells, numbers, N, maxTier) {
  if (!(maxTier >= 1 && maxTier <= 5)) throw new Error("traceDeduce: maxTier must be 1..5, got " + maxTier);
  const steps = [];
  for (;;) {
    const clash = findClash(cells, numbers, N);
    if (clash) return { steps, clash };
    let e = null;
    for (let t = 1; t <= maxTier && !e; t++) e = explainCollect(cells, numbers, N, t, true)[0] || null;
    if (!e) return { steps, clash: null };
    cells[e.i] = e.value;
    steps.push(e);
  }
}

// Shortest chain first, then nearest to the last tap (Manhattan distance to the target or
// any evidence cell), then lowest cell index. Entries without a chain count as length 0.
function pickShortest(entries, lastTap, N) {
  const dist = (e) => {
    if (lastTap == null) return 0;
    const tr = (lastTap / N) | 0, tc = lastTap - tr * N;
    let best = Infinity;
    for (const x of [e.i].concat(e.evidence || [])) {
      const r = (x / N) | 0, d = Math.abs(r - tr) + Math.abs(x - r * N - tc);
      if (d < best) best = d;
    }
    return best;
  };
  let best = null, bk = null;
  for (const e of entries) {
    const k = [e.chain ? e.chain.length : 0, dist(e), e.i];
    if (!bk || k[0] < bk[0] || (k[0] === bk[0] && (k[1] < bk[1] || (k[1] === bk[1] && k[2] < bk[2])))) {
      best = e; bk = k;
    }
  }
  return best;
}

// --- clashes ---------------------------------------------------------------
// UNKNOWN counts as possibly lit (it does not block connectivity).
function findClash(cells, numbers, N) {
  const total = N * N;
  const lines = linesOf(N);
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
  const seen = explainReach(cells, N, whites[0], -1);
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
  module.exports = { explainTier, traceDeduce, pickShortest, findClash, cellName };
}
