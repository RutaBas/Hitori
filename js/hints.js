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
 *       evidence cell (0 when lastTap is null) — explain.js's explainDistance, the one rule
 *   walkFrames(exp) -> the walk-through frames of a T5/T6 explanation (see below)
 *
 * Order: (1) a mark that breaks a rule right now (findClash names the rule and the cells);
 * (2) the mark that disagrees with the solution nearest the last tap (tie: reading order);
 * (3) done; (4) the cheapest tier with any deduction, nearest the last tap (tie: lowest
 * i) — at T6 the shortest chain first (pickShortest); (5) stuck. Circled cells are the player's "lit"; unmarked lit cells are
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

// One distance rule for every "nearest the last tap" choice (explain.js owns it).
const distanceTo = explainDistance;

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

  // (2) a mark the solution disagrees with, nearest the last tap (tie: reading order)
  let wrong = -1, wd = Infinity;
  for (let i = 0; i < total; i++) {
    const bad = (state[i] === CellState.SHADED && !solution[i]) || (state[i] === CellState.CIRCLED && solution[i]);
    if (!bad) continue;
    const d = distanceTo({ i }, lastTap, N);
    if (d < wd) { wrong = i; wd = d; }
  }
  if (wrong >= 0) {
    return { kind: "mistake", i: wrong, cells: [wrong], text: state[wrong] === CellState.SHADED
      ? "This cell can't be shaded. The puzzle can't be finished with it dark."
      : "This cell can't stay lit. The puzzle can't be finished with it lit." };
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

// --- the walk-through: an explanation's chain as board frames ----------------------------
function walkSuppose(value) { return value === SolveCell.BLACK ? "were shaded" : "stayed lit"; }

// Appends one frame per record of `chain` (nested chains flattened in, depth-first).
// `base` = the ghosts already on the board when this chain starts; it is never changed.
// An "assume" record starts a branch afresh from `base` (T5 tries both values in turn), so
// a branch's ghosts never leak into the next branch or back into the enclosing chain: once
// a nested chain is told, only the step it concludes stays as a ghost.
function walkChain(chain, base, depth, frames) {
  let cur = base, assumes = 0;
  for (const s of chain) {
    if (s.rule === "assume") {
      cur = Object.assign({}, base); cur[s.i] = s.value;
      let text;
      if (assumes === 0 && depth === 0) {
        text = "Suppose this cell " + walkSuppose(s.value) + "… Tap Next to follow what that forces.";
      } else if (assumes === 0) {
        text = "To see the next step, try this cell both ways. First, suppose it " + walkSuppose(s.value) + ".";
      } else {
        text = "Now suppose this cell " + walkSuppose(s.value) + " instead.";
      }
      assumes++;
      frames.push({ ghosts: cur, focus: [], i: s.i, technique: null, text });
      continue;
    }
    if (s.chain) walkChain(s.chain, cur, depth + 1, frames);
    cur = Object.assign({}, cur); cur[s.i] = s.value;
    frames.push({ ghosts: cur, focus: s.evidence.slice(), i: s.i, technique: s.technique || null, text: s.text });
  }
  return cur;
}

/*
 * walkFrames(exp) -> [{ ghosts: { i: SolveCell value }, focus: number[], i, technique, text }]
 * The frames a "walk me through it" steps over, for an explanation with a chain (T5/T6).
 * Frame 0 is the assumption; each following frame adds one step (its own ghost, its own
 * evidence as `focus`, its own reason); nested T5 chains are flattened in (so the count is
 * explainChainLength(chain) + 1). The last frame shows the clash (focus = clash.cells) or,
 * for a T5 "both-ways", the agreed result. `i` is the cell the frame is about (drawn as the
 * target). Pure: never mutates exp (cached explanations are shared); every frame owns its
 * ghosts object. The board state is never touched; ghosts are drawn on their own layer.
 */
function walkFrames(exp) {
  const frames = [];
  if (!exp || !exp.chain || !exp.chain.length) return frames;
  const last = walkChain(exp.chain, {}, 0, frames);
  const verdict = exp.value === SolveCell.BLACK ? "this cell must be shaded." : "this cell stays lit.";
  if (exp.clash) {
    frames.push({ ghosts: Object.assign({}, last), focus: exp.clash.cells.slice(), i: exp.i, technique: null,
      text: exp.clash.text + " So the supposition was wrong: " + verdict });
  } else {
    const g = {}; g[exp.i] = exp.value;
    frames.push({ ghosts: g, focus: exp.evidence.slice(), i: exp.i, technique: exp.technique || null, text: exp.text });
  }
  return frames;
}

if (typeof module !== "undefined") {
  module.exports = { stateToCells, nextHint, distanceTo, walkFrames };
}
