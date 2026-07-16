/*
 * sweep.js — THROWAWAY empirical difficulty-curve sweep (brief: run before locking the
 * curve). Two passes:
 *   A. Distribution: per (size, density), generate K candidates and report unique-rate and
 *      the tier histogram among unique puzzles. Shows which tiers are naturally producible.
 *   B. (run separately in sweep2.js) targeted generation success + mean attempts per tier.
 *
 * Run: node test/sweep.js
 */
const path = require("path");
const G = require(path.join(__dirname, "..", "js", "generator.js"));

const rand = G.mulberry32(20260716);

const SIZES = [5, 6, 7, 8, 9, 10];
const DENSITIES = [0.20, 0.28, 0.36];
const K = 120; // candidates per (size, density)

function pct(x, n) { return n ? ((100 * x) / n).toFixed(0).padStart(3) : "  0"; }

console.log(`Distribution sweep — ${K} candidates per cell\n`);
console.log("size dens   uniq%   |  tier histogram among unique (T1..T6, >T6=guess)");
console.log("-----------------------------------------------------------------------");

const t0 = Date.now();
for (const N of SIZES) {
  for (const d of DENSITIES) {
    let unique = 0, badNumbers = 0;
    const hist = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, guess: 0 };
    for (let k = 0; k < K; k++) {
      const cand = G.generateCandidate(N, d, rand);
      if (!cand) { badNumbers++; continue; }
      const c = G.classify(cand.numbers, N);
      if (!c.unique) continue;
      unique++;
      if (c.tier === Infinity) hist.guess++;
      else hist[c.tier]++;
    }
    const h = `T1=${pct(hist[1], unique)} T2=${pct(hist[2], unique)} T3=${pct(hist[3], unique)} ` +
              `T4=${pct(hist[4], unique)} T5=${pct(hist[5], unique)} T6=${pct(hist[6], unique)} ` +
              `>T6=${pct(hist.guess, unique)}`;
    console.log(`${String(N).padStart(2)}x${N}  ${d.toFixed(2)}  ${pct(unique, K)}%   |  ${h}`);
  }
}
console.log(`\nElapsed ${((Date.now() - t0) / 1000).toFixed(1)}s`);
