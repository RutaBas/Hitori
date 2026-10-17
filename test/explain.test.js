/*
 * explain.test.js — explained deductions T1–T6, traced chains, pickShortest + clash detection. Run with:
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

  // --- traceDeduce ---------------------------------------------------------
  {
    // Sandwich 1 ? 1 with the middle assumed shaded: its neighbours light up, giving row 1
    // two lit 1s.
    const b = board(3, [[1, 2, 1], [2, 3, 4], [3, 4, 2]], [[1, BLACK]]);
    const tr = E.traceDeduce(b.cells, b.numbers, 3, 2);
    check("traceDeduce ends in the duplicate clash", tr.clash && tr.clash.rule === "duplicate" && sameArr(tr.clash.cells, [0, 2]));
    check("traceDeduce steps are one cell each, cheapest first, with text",
      tr.steps.length === 3 && tr.steps.every((s) => s.tier === 2 && s.rule === "neighbour-of-shaded" && s.text.length > 0));
    check("traceDeduce mutated cells", b.cells[0] === WHITE && b.cells[2] === WHITE && b.cells[4] === WHITE);
    check("traceDeduce state ends in that clash", sameArr(E.findClash(b.cells, b.numbers, 3).cells, tr.clash.cells));
  }
  {
    const b = board(3, LATIN3, [[4, BLACK]]);
    const tr = E.traceDeduce(b.cells, b.numbers, 3, 1);
    check("traceDeduce respects maxTier (no T2 steps at maxTier 1)", tr.steps.length === 0 && tr.clash === null);
  }

  // --- pickShortest (synthetic entries) ------------------------------------
  {
    const mk = (i, len, evidence) => ({ i, value: WHITE, evidence: evidence || [i], chain: new Array(len).fill({}) });
    const a = mk(40, 5), b2 = mk(3, 3), c = mk(7, 3), d = mk(99, 3);
    check("pickShortest: shortest chain wins", E.pickShortest([a, b2], null, 10) === b2);
    check("pickShortest: tie -> lowest i without lastTap", E.pickShortest([c, d, b2], null, 10) === b2);
    check("pickShortest: tie -> nearest to lastTap", E.pickShortest([b2, c, d], 98, 10) === d);
    check("pickShortest: length beats distance", E.pickShortest([a, b2], 40, 10) === b2);
    check("pickShortest: distance uses evidence too", E.pickShortest([mk(0, 2, [0, 55]), mk(9, 2)], 56, 10).i === 0);
    // Length counts the frames the player taps through: nested T5 chain steps count too.
    // `nested` has 3 top-level records, one a T5 step with 4 inner steps -> 3 + 4 = 7 frames.
    const t5 = { i: 1, rule: "both-ways", tier: 5, chain: new Array(4).fill({}) };
    const nested = { i: 2, value: WHITE, evidence: [2], chain: [{}, t5, {}] };
    const flat = mk(50, 5);
    check("pickShortest: nested T5 steps count toward chain length", E.pickShortest([nested, flat], null, 10) === flat);
    check("explainChainLength counts nested steps", E.explainChainLength(nested.chain) === 7 && E.explainChainLength(flat.chain) === 5);
  }

  // --- soundness on generated puzzles --------------------------------------
  const TIER_FNS = [null, S.applyT1, S.applyT2, S.applyT3, S.applyT4, S.applyT5, S.applyT6];
  const PER_TIER = 30;
  let states = 0, entries = 0;
  const bad = { value: 0, subset: 0, missing: 0, form: 0, clash: 0, gen: 0 };
  // T5/T6 chains (checked on Secluded + Solitary walks, at states where T6 is the cheapest tier)
  const t6 = { states: 0, entries: 0, maxMs: 0, maxLen: 0, lens: [], inner5: {} };
  const bad6 = { clash: 0, replay: 0, text: 0, value: 0, form: 0, missing: 0, t5: 0 };
  let shortestFixture = null;
  // Every step (recursively, through nested chains) must carry its own reason.
  const allStepsHaveText = (chain) => chain.every((s) =>
    typeof s.text === "string" && s.text.length > 0 && (!s.chain || allStepsHaveText(s.chain)));
  const checkT6 = (cells, numbers, N, solution) => {
    t6.states++;
    const copy6 = cells.slice();
    S.applyT6(copy6, numbers, N);
    // Timing (10x10 only): best of 3 runs per state, so a GC pause doesn't count as the hint's cost.
    let ex, ms = Infinity;
    for (let run = 0; run < (N === 10 ? 3 : 1); run++) {
      const t0 = process.hrtime.bigint();
      ex = E.explainTier(cells, numbers, N, 6);
      ms = Math.min(ms, Number(process.hrtime.bigint() - t0) / 1e6);
    }
    if (N === 10) t6.maxMs = Math.max(t6.maxMs, ms);
    let changed = false;
    for (let i = 0; i < cells.length; i++) if (cells[i] === UNKNOWN && copy6[i] !== UNKNOWN) changed = true;
    if (changed && ex.length === 0) bad6.missing++;
    for (const e of ex) {
      t6.entries++; t6.lens.push(e.chain.length);
      for (const st of e.chain) if (st.tier === 5) t6.inner5[st.rule] = (t6.inner5[st.rule] || 0) + 1;
      t6.maxLen = Math.max(t6.maxLen, e.chain.length);
      if (!e.clash) { bad6.clash++; continue; }
      if (e.value !== (solution[e.i] ? BLACK : WHITE)) bad6.value++;
      const a = e.chain[0];
      if (e.rule !== "contradiction" || e.tier !== 6 || e.technique !== S.TECHNIQUE_NAMES[6] ||
        !a || a.rule !== "assume" || a.i !== e.i || a.value === e.value || a.value === UNKNOWN ||
        !(e.evidence.length > 0) || !(e.short.length > 0)) bad6.form++;
      if (!allStepsHaveText(e.chain) || !(e.text.length > 0) || !(e.clash.text.length > 0)) bad6.text++;
      const replay = cells.slice();
      for (const s of e.chain) replay[s.i] = s.value;
      const c = E.findClash(replay, numbers, N);
      if (!c || c.rule !== e.clash.rule || !sameArr(c.cells, e.clash.cells)) bad6.replay++;
    }
    const lens = ex.map((e) => E.explainChainLength(e.chain));
    if (!shortestFixture && ex.length >= 2 && Math.min(...lens) < Math.max(...lens)) {
      shortestFixture = { ex, N, min: Math.min(...lens) };
    }
  };
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
          if (t === 5) {
            // T5 entries (rare at top level): sound and with a two-branch chain
            for (const e of E.explainTier(cells, numbers, N, 5)) {
              if (e.value !== (solution[e.i] ? BLACK : WHITE) || e.rule !== "both-ways" ||
                e.chain.filter((s) => s.rule === "assume").length !== 2 || !allStepsHaveText(e.chain)) bad6.t5++;
            }
          }
          if (t === 6 && tier >= 5) checkT6(cells, numbers, N, solution);
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

  const lens = t6.lens.sort((a, b) => a - b);
  console.log(`  (T6: ${t6.states} states, ${t6.entries} entries, chain length median ${lens[lens.length >> 1]}, max ${t6.maxLen}; ` +
    `10x10 explainTier(6) max ${t6.maxMs.toFixed(1)} ms in this long-running process; inner T5 steps ${JSON.stringify(t6.inner5)})`);
  check("T6: some T6 states were checked", t6.states > 0 && t6.entries > 0);
  check("T6: every entry has a clash", bad6.clash === 0);
  check("T6: replaying the chain reproduces the clash", bad6.replay === 0);
  check("T6: every chain step has its own text", bad6.text === 0);
  check("T6: every value matches the solution", bad6.value === 0);
  check("T6: entries well formed (rule, assume record, opposite value)", bad6.form === 0);
  check("T6: explainTier(6) non-empty whenever applyT6 changes something", bad6.missing === 0);
  check("T5: entries sound and two-branched", bad6.t5 === 0);
  check("pickShortest: a real state with two T6 chains of different length was found", shortestFixture !== null);
  if (shortestFixture) {
    const p = E.pickShortest(shortestFixture.ex, null, shortestFixture.N);
    check("pickShortest: picks the shorter real T6 chain", E.explainChainLength(p.chain) === shortestFixture.min);
  }
} catch (e) {
  check("no exception: " + e.message, false);
  console.log(e.stack);
}

// --- TECHNIQUE_INTROS: the one-time card before a tier's first level ---------
console.log("Technique intros");
{
  const I = E.TECHNIQUE_INTROS;
  check("TECHNIQUE_INTROS is exported", !!I && typeof I === "object");
  const techs = Array.from(new Set(Object.values(G.TIERS).filter((t) => t && t.technique).map((t) => t.technique)));
  check("every tier's technique has an intro (3, 4, 6)", techs.length === 3 && techs.every((k) => I && I[k]));
  for (const k of techs) {
    const it = (I && I[k]) || {};
    check("intro " + k + ": technique is the hint's name (" + S.TECHNIQUE_NAMES[k] + ")", it.technique === S.TECHNIQUE_NAMES[k]);
    check("intro " + k + ": has a title and a short explanation",
      typeof it.title === "string" && it.title.length > 0 &&
      typeof it.text === "string" && it.text.length > 40 && it.text.length < 400);
    check("intro " + k + ": plain text (no markup)", !/[<>]/.test(it.text + it.title + (it.tip || "")));
  }
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
