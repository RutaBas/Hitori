/*
 * hints.test.js — hint selection and explained mistakes (js/hints.js). Run with:
 *   node test/hints.test.js
 *
 * Fixtures: a rule-breaking mark, a quietly wrong mark, nearest-to-last-tap selection.
 * Replay: 100 seeded puzzles per tier, solved from an empty board by applying hints only.
 * Timing: the hardest Solitary puzzle of the replay set is replayed again in a FRESH child
 * process (node test/hints.test.js --timing <k>), because a long test process slows the
 * solver's allocation-heavy lookahead several-fold (see the Task 4 report).
 */

const path = require("path");
const { spawnSync } = require("child_process");
const S = require(path.join(__dirname, "..", "js", "solver.js"));
const G = require(path.join(__dirname, "..", "js", "generator.js"));
const B = require(path.join(__dirname, "..", "js", "board.js"));
const E = require(path.join(__dirname, "..", "js", "explain.js"));
const H = require(path.join(__dirname, "..", "js", "hints.js"));
const { UNKNOWN, WHITE, BLACK } = S.SolveCell;
const { UNMARKED, SHADED, CIRCLED } = B.CellState;

const seedOf = (tier, k) => G.mulberry32(G.hashString("hints-" + tier + "-" + k));
const puzzleOf = (tier, k) => G.generateTier(tier, { rand: seedOf(tier, k) });
const toMark = (v) => (v === BLACK ? SHADED : CIRCLED);

/*
 * Replay one puzzle from an empty board: ask for a hint, apply it, repeat until "done".
 * lastTap = the cell the previous hint set (as if the player had just tapped it).
 * Returns stats; with `time`, also the slowest call and a repeat press on that state.
 */
function replay(p, time) {
  const { N, numbers, solution } = p;
  const state = new Int8Array(N * N);
  const r = { hints: 0, done: false, t6: 0, wrong: 0, noText: 0, mistakes: 0, stuck: 0, maxMs: 0, slowState: null, slowTap: null };
  let lastTap = null;
  for (let guard = 0; guard <= N * N + 1; guard++) {
    const t0 = time ? process.hrtime.bigint() : 0n;
    const h = H.nextHint(state, numbers, N, solution, lastTap);
    if (time) {
      const ms = Number(process.hrtime.bigint() - t0) / 1e6;
      if (ms > r.maxMs) { r.maxMs = ms; r.slowState = state.slice(); r.slowTap = lastTap; }
    }
    if (h.kind === "done") { r.done = true; break; }
    r.hints++;
    if (h.kind === "mistake") { r.mistakes++; break; }
    if (h.kind === "stuck") { r.stuck++; state[h.i] = solution[h.i] ? SHADED : CIRCLED; lastTap = h.i; continue; }
    const e = h.exp;
    if (e.tier === 6) r.t6++;
    if (e.value !== (solution[e.i] ? BLACK : WHITE) || state[e.i] !== UNMARKED) r.wrong++;
    const hasWhy = (e.evidence && e.evidence.length > 0) || (e.chain && e.chain.length > 0);
    if (!(typeof e.text === "string" && e.text.length > 0) || !hasWhy) r.noText++;
    state[e.i] = toMark(e.value);
    lastTap = e.i;
  }
  return r;
}

// --- child mode: time the replay of one Solitary puzzle in a fresh process --------------
if (process.argv[2] === "--timing") {
  const k = Number(process.argv[3]);
  const p = puzzleOf(6, k);
  const r = replay(p, true);
  const t0 = process.hrtime.bigint();
  H.nextHint(r.slowState, p.numbers, p.N, p.solution, r.slowTap); // repeat press on the slowest state
  const repeatMs = Number(process.hrtime.bigint() - t0) / 1e6;
  console.log(JSON.stringify({ k, maxMs: r.maxMs, repeatMs, hints: r.hints, t6: r.t6, done: r.done }));
  process.exit(0);
}

let pass = 0, fail = 0;
function check(label, cond) {
  console.log((cond ? "  ok  " : " FAIL ") + label);
  cond ? pass++ : fail++;
}
const sameArr = (a, b) => a.length === b.length && a.every((v, k) => v === b[k]);

try {
  // --- stateToCells ----------------------------------------------------------
  {
    const c = H.stateToCells(Int8Array.from([UNMARKED, SHADED, CIRCLED]));
    check("stateToCells: SHADED->BLACK, CIRCLED->WHITE, UNMARKED->UNKNOWN", sameArr(Array.from(c), [UNKNOWN, BLACK, WHITE]));
  }

  // --- distanceTo ------------------------------------------------------------
  {
    const e = { i: 0, evidence: [55] };
    check("distanceTo: 0 when lastTap is null", H.distanceTo(e, null, 10) === 0);
    check("distanceTo: nearest of target and evidence", H.distanceTo(e, 56, 10) === 1 && H.distanceTo(e, 2, 10) === 2);
  }

  const p1 = puzzleOf(1, 0);
  const N1 = p1.N;

  // --- Review Focus 3: a circled cell the solution shades, no rule broken -----
  {
    const i = Array.from(p1.solution).indexOf(1);
    const state = new Int8Array(N1 * N1); state[i] = CIRCLED;
    check("fixture: the lone circle breaks no rule", E.findClash(H.stateToCells(state), p1.numbers, N1) === null);
    const h = H.nextHint(state, p1.numbers, N1, p1.solution, null);
    check("Focus 3: circled cell the solution shades -> mistake at that cell",
      h.kind === "mistake" && h.i === i && sameArr(h.cells, [i]) && h.text.length > 0);
    check("Focus 3: wording says it can't stay lit", /can't stay lit/.test(h.text));
  }
  {
    const i = Array.from(p1.solution).indexOf(0);
    const state = new Int8Array(N1 * N1); state[i] = SHADED;
    const h = H.nextHint(state, p1.numbers, N1, p1.solution, null);
    check("shaded cell the solution lights -> mistake, spec wording",
      h.kind === "mistake" && h.i === i && h.text === "This cell can't be shaded. The puzzle can't be finished with it dark.");
  }
  {
    // two quietly wrong marks (no rule broken): the earlier one in reading order wins,
    // whatever lastTap says
    const sol = Array.from(p1.solution);
    const late = sol.lastIndexOf(0), early = sol.indexOf(1);
    const state = new Int8Array(N1 * N1); state[late] = SHADED; state[early] = CIRCLED;
    const quiet = E.findClash(H.stateToCells(state), p1.numbers, N1) === null;
    const h = H.nextHint(state, p1.numbers, N1, p1.solution, late);
    check("earliest wrong mark is reported first", quiet && early < late && h.kind === "mistake" && h.i === early);
  }

  // --- two touching shaded cells ---------------------------------------------
  {
    const state = new Int8Array(N1 * N1); state[0] = SHADED; state[1] = SHADED;
    const h = H.nextHint(state, p1.numbers, N1, p1.solution, null);
    check("touching shaded cells -> mistake with both cells",
      h.kind === "mistake" && h.cells.includes(0) && h.cells.includes(1));
    check("touching: text names the rule", /can't be side by side/.test(h.text));
  }

  // --- done ------------------------------------------------------------------
  {
    const state = Int8Array.from(p1.solution, (s) => (s ? SHADED : UNMARKED));
    check("board matching the solution -> done", H.nextHint(state, p1.numbers, N1, p1.solution, 3).kind === "done");
  }

  // --- nearest to lastTap among two T2 deductions -----------------------------
  // Walk seeded puzzles cheapest-first until a state has no T1 deduction and two or more
  // T2 deductions where a lastTap makes a non-default entry the unique nearest.
  {
    let found = null;
    for (let k = 0; k < 40 && !found; k++) {
      const p = puzzleOf(1, k);
      const { N, numbers, solution } = p;
      const state = new Int8Array(N * N);
      for (let g = 0; g < N * N && !found; g++) {
        const cells = H.stateToCells(state);
        if (E.explainTier(cells, numbers, N, 1).length === 0) {
          const t2 = E.explainTier(cells, numbers, N, 2);
          if (t2.length >= 2) {
            const lowest = t2.reduce((m, e) => (e.i < m.i ? e : m));
            for (const target of t2) {
              if (target === lowest) continue;
              const tap = target.i;
              const d = t2.map((e) => H.distanceTo(e, tap, N));
              const best = Math.min(...d);
              if (d.filter((x) => x === best).length === 1 && H.distanceTo(target, tap, N) === best) {
                found = { p, state: state.slice(), tap, target, lowest };
                break;
              }
            }
          }
        }
        const h = H.nextHint(state, numbers, N, solution, null);
        if (h.kind !== "deduction") break;
        state[h.exp.i] = toMark(h.exp.value);
      }
    }
    check("fixture: a state with two T2 deductions was found", found !== null);
    if (found) {
      const { p, state, tap, target, lowest } = found;
      const near = H.nextHint(state, p.numbers, p.N, p.solution, tap);
      check("two T2 deductions: the one nearer lastTap is chosen",
        near.kind === "deduction" && near.exp.tier === 2 && near.exp.i === target.i);
      const none = H.nextHint(state, p.numbers, p.N, p.solution, null);
      check("two T2 deductions: without lastTap, lowest i", none.kind === "deduction" && none.exp.i === lowest.i);
    }
  }

  // --- replay: 100 puzzles per tier ------------------------------------------
  const PER_TIER = 100;
  const tot = { gen: 0, unsolved: 0, over: 0, wrong: 0, noText: 0, mistakes: 0, stuck: 0, hints: 0 };
  let hardest = null;
  const t0 = Date.now();
  for (let tier = 1; tier <= 6; tier++) {
    for (let k = 0; k < PER_TIER; k++) {
      const p = puzzleOf(tier, k);
      if (p.failed) { tot.gen++; continue; }
      const r = replay(p, false);
      tot.hints += r.hints;
      if (!r.done) tot.unsolved++;
      if (r.hints >= p.N * p.N + 1) tot.over++;
      tot.wrong += r.wrong; tot.noText += r.noText; tot.mistakes += r.mistakes; tot.stuck += r.stuck;
      if (tier === 6 && (!hardest || r.t6 > hardest.t6)) hardest = { k, t6: r.t6 };
    }
  }
  console.log(`  (replay: ${6 * PER_TIER} puzzles, ${tot.hints} hints, ${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  check("replay: all puzzles generated", tot.gen === 0);
  check("replay: every puzzle reaches done", tot.unsolved === 0);
  check("replay: fewer than N*N + 1 hints each", tot.over === 0);
  check("replay: every deduction is sound and targets an unmarked cell", tot.wrong === 0);
  check("replay: every deduction has text and evidence (or chain)", tot.noText === 0);
  check("replay: no mistake or stuck hints on a correct board", tot.mistakes === 0 && tot.stuck === 0);

  // --- timing: hardest Solitary puzzle, fresh process -------------------------
  check("timing: a hardest Solitary puzzle was picked", hardest !== null && hardest.t6 > 0);
  if (hardest) {
    const out = spawnSync(process.execPath, [__filename, "--timing", String(hardest.k)], { encoding: "utf8" });
    let t = null;
    try { t = JSON.parse(out.stdout.trim().split("\n").pop()); } catch (_) { console.log(out.stdout, out.stderr); }
    if (t) {
      console.log(`  (timing: Solitary #${t.k}, ${t.t6} T6 hints of ${t.hints}; slowest nextHint ${t.maxMs.toFixed(1)} ms, ` +
        `repeat press ${t.repeatMs.toFixed(2)} ms, fresh process)`);
    }
    check("timing: child replay finished", t !== null && t.done);
    check("timing: slowest single nextHint under 150 ms", t !== null && t.maxMs < 150);
    check("timing: repeat press on the same board is instant (< 5 ms, cached)", t !== null && t.repeatMs < 5);
  }
} catch (e) {
  check("no exception: " + e.message, false);
  console.log(e.stack);
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
