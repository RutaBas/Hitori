/*
 * explain.test.js — explained deductions T1–T4 + clash detection. Run with:
 *   node test/explain.test.js
 *
 * Fixtures: one tiny hand-made board per rule id and per clash rule.
 * Soundness: on seeded generated puzzles, walk the cheapest-first solve and check that
 * every explanation agrees with the solution and with the solver's own applyT<t>.
 */

const path = require("path");
const S = require(path.join(__dirname, "..", "js", "solver.js"));
const G = require(path.join(__dirname, "..", "js", "generator.js"));
const E = require(path.join(__dirname, "..", "js", "explain.js"));
const { UNKNOWN, WHITE, BLACK } = S.SolveCell;

let pass = 0, fail = 0;
function check(label, cond) {
  console.log((cond ? "  ok  " : " FAIL ") + label);
  cond ? pass++ : fail++;
}

const sameArr = (a, b) => a.length === b.length && a.every((v, k) => v === b[k]);

// Does explainTier(...) contain an entry with this rule / target / value / evidence?
function hasEntry(list, rule, i, value, evidence) {
  return list.some((e) => e.rule === rule && e.i === i && e.value === value && sameArr(e.evidence, evidence));
}

function wellFormed(e, tier) {
  return e.tier === tier && e.technique === S.TECHNIQUE_NAMES[tier] &&
    typeof e.text === "string" && e.text.length > 0 &&
    typeof e.short === "string" && e.short.length > 0 &&
    Array.isArray(e.evidence) && e.evidence.length > 0 &&
    sameArr(e.evidence, e.evidence.slice().sort((a, b) => a - b));
}

function board(N, rows, cellsInit) {
  const numbers = Int8Array.from(rows.flat());
  const cells = new Int8Array(N * N);
  for (const [i, v] of cellsInit || []) cells[i] = v;
  return { N, numbers, cells };
}

const LATIN3 = [[1, 2, 3], [2, 3, 1], [3, 1, 2]];

try {
  // --- cellName ------------------------------------------------------------
  check("cellName 1-based", E.cellName(0, 5) === "row 1, column 1" && E.cellName(2 * 5 + 4, 5) === "row 3, column 5");

  // --- T1 ------------------------------------------------------------------
  {
    const b = board(3, [[1, 1, 1], [2, 3, 4], [3, 4, 2]]);
    const ex = E.explainTier(b.cells, b.numbers, 3, 1);
    check("T1 triple-middle: middle 1 lit, evidence the outer 1s", hasEntry(ex, "triple-middle", 1, WHITE, [0, 2]));
    check("T1 triple-outer: outer 1 shaded, evidence the other two", hasEntry(ex, "triple-outer", 0, BLACK, [1, 2]));
    check("T1 entries well formed", ex.length > 0 && ex.every((e) => wellFormed(e, 1)));
    check("T1 text names the line", ex.find((e) => e.rule === "triple-middle").text.includes("row 1"));
  }
  {
    const b = board(3, [[1, 2, 1], [2, 3, 4], [3, 4, 2]]);
    const ex = E.explainTier(b.cells, b.numbers, 3, 1);
    check("T1 sandwich: cell between two 1s lit", hasEntry(ex, "sandwich", 1, WHITE, [0, 2]));
  }
  {
    const b = board(4, [[4, 4, 1, 4], [1, 2, 3, 5], [2, 3, 5, 1], [3, 5, 2, 6]]);
    const ex = E.explainTier(b.cells, b.numbers, 4, 1);
    check("T1 pair-elsewhere: other 4 shaded, evidence the pair", hasEntry(ex, "pair-elsewhere", 3, BLACK, [0, 1]));
    const e = ex.find((x) => x.rule === "pair-elsewhere");
    check("T1 pair-elsewhere short pointer", e && e.short === "Look at row 1: the two 4s side by side.");
  }
  {
    // already-decided targets are not re-explained
    const b = board(3, [[1, 2, 1], [2, 3, 4], [3, 4, 2]], [[1, WHITE]]);
    check("T1 skips decided cells", E.explainTier(b.cells, b.numbers, 3, 1).every((e) => e.i !== 1));
  }

  // --- T2 ------------------------------------------------------------------
  {
    const b = board(3, LATIN3, [[4, BLACK]]);
    const ex = E.explainTier(b.cells, b.numbers, 3, 2);
    check("T2 neighbour-of-shaded", hasEntry(ex, "neighbour-of-shaded", 1, WHITE, [4]));
    check("T2 neighbour-of-shaded covers all four neighbours", [1, 3, 5, 7].every((i) => hasEntry(ex, "neighbour-of-shaded", i, WHITE, [4])));
    check("T2 entries well formed", ex.every((e) => wellFormed(e, 2)));
  }
  {
    const b = board(3, [[1, 2, 3], [2, 3, 2], [3, 1, 1]], [[3, WHITE]]);
    const ex = E.explainTier(b.cells, b.numbers, 3, 2);
    check("T2 duplicate-of-lit", hasEntry(ex, "duplicate-of-lit", 5, BLACK, [3]));
  }

  // --- T3 ------------------------------------------------------------------
  {
    const b = board(3, LATIN3, [[0, WHITE], [1, BLACK]]);
    const ex = E.explainTier(b.cells, b.numbers, 3, 3);
    check("T3 lifeline: only open neighbour lit", hasEntry(ex, "lifeline", 3, WHITE, [0, 1]));
    check("T3 entries well formed", ex.length > 0 && ex.every((e) => wellFormed(e, 3)));
  }

  // --- T4 ------------------------------------------------------------------
  {
    const b = board(3, LATIN3, [[0, WHITE], [8, WHITE], [2, BLACK], [4, BLACK]]);
    const ex = E.explainTier(b.cells, b.numbers, 3, 4);
    check("T4 cut-off: shading row 2 col 1 would separate the lit cells", hasEntry(ex, "cut-off", 3, WHITE, [8]));
    check("T4 entries well formed", ex.length > 0 && ex.every((e) => wellFormed(e, 4)));
  }

  // --- findClash -----------------------------------------------------------
  {
    const b = board(3, [[1, 2, 3], [2, 3, 2], [3, 1, 1]], [[3, WHITE], [5, WHITE]]);
    const c = E.findClash(b.cells, b.numbers, 3);
    check("clash duplicate", c && c.rule === "duplicate" && sameArr(c.cells, [3, 5]) && c.text.length > 0);
  }
  {
    const b = board(3, LATIN3, [[0, BLACK], [1, BLACK]]);
    const c = E.findClash(b.cells, b.numbers, 3);
    check("clash touching", c && c.rule === "touching" && sameArr(c.cells, [0, 1]));
  }
  {
    const b = board(3, LATIN3, [[0, WHITE], [1, BLACK], [3, BLACK], [8, WHITE]]);
    const c = E.findClash(b.cells, b.numbers, 3);
    check("clash stranded", c && c.rule === "stranded" && sameArr(c.cells, [0, 1, 3]));
  }
  {
    const b = board(3, LATIN3, [[0, WHITE], [8, WHITE], [2, BLACK], [4, BLACK], [6, BLACK]]);
    const c = E.findClash(b.cells, b.numbers, 3);
    check("clash split", c && c.rule === "split" && sameArr(c.cells, [0, 8]));
  }
  {
    const b = board(3, LATIN3, [[0, WHITE], [4, BLACK]]);
    check("no clash on a clean state", E.findClash(b.cells, b.numbers, 3) === null);
    check("lone white with no open neighbour but no other whites is not stranded",
      E.findClash(board(3, LATIN3, [[0, WHITE], [1, BLACK], [3, BLACK]]).cells, Int8Array.from(LATIN3.flat()), 3) === null);
  }

  // --- soundness on generated puzzles --------------------------------------
  const TIER_FNS = [null, S.applyT1, S.applyT2, S.applyT3, S.applyT4, S.applyT5, S.applyT6];
  const PER_TIER = 30;
  let states = 0, entries = 0;
  const bad = { value: 0, subset: 0, missing: 0, form: 0, clash: 0, gen: 0 };
  for (let tier = 1; tier <= 6; tier++) {
    for (let k = 0; k < PER_TIER; k++) {
      const p = G.generateTier(tier, { rand: G.mulberry32(G.hashString("explain-" + tier + "-" + k)) });
      if (p.failed) { bad.gen++; continue; }
      const { N, numbers, solution } = p;
      const cells = new Int8Array(N * N);
      for (let guard = 0; guard < 4 * N * N; guard++) {
        states++;
        if (E.findClash(cells, numbers, N) !== null) bad.clash++;
        for (let t = 1; t <= 4; t++) {
          const copy = cells.slice();
          TIER_FNS[t](copy, numbers, N);
          const changedSet = new Set();
          for (let i = 0; i < cells.length; i++) if (cells[i] === UNKNOWN && copy[i] !== UNKNOWN) changedSet.add(i);
          const ex = E.explainTier(cells, numbers, N, t);
          entries += ex.length;
          for (const e of ex) {
            if (e.value !== (solution[e.i] ? BLACK : WHITE)) bad.value++;
            if (!changedSet.has(e.i)) bad.subset++;
            if (!wellFormed(e, t)) bad.form++;
          }
          if (changedSet.size > 0 && ex.length === 0) bad.missing++;
        }
        // cheapest-first step, one cell at a time (as hints are applied) so many
        // intermediate states get checked
        let stepped = false;
        for (let t = 1; t <= 6 && !stepped; t++) {
          const copy = cells.slice();
          TIER_FNS[t](copy, numbers, N);
          for (let i = 0; i < cells.length; i++) {
            if (cells[i] === UNKNOWN && copy[i] !== UNKNOWN) { cells[i] = copy[i]; stepped = true; break; }
          }
        }
        if (!stepped) break;
      }
    }
  }
  console.log(`  (soundness: ${states} states, ${entries} explanations)`);
  check("soundness: all puzzles generated", bad.gen === 0);
  check("soundness: every explanation value matches the solution", bad.value === 0);
  check("soundness: every target is a cell applyT<t> changes", bad.subset === 0);
  check("soundness: explainTier non-empty whenever applyT<t> changes something", bad.missing === 0);
  check("soundness: every explanation well formed", bad.form === 0);
  check("soundness: no clash on solution-consistent states", bad.clash === 0);
} catch (e) {
  check("no exception: " + e.message, false);
  console.log(e.stack);
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
