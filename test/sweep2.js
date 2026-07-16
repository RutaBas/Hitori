/*
 * sweep2.js — THROWAWAY batch verification (brief KVP 4) for the RECOMMENDED ladder.
 * Generates 100 puzzles per tier and reports: solutions != 1, guessing (>T6), exact
 * tier-match rate, and generation-attempt stats. Run: node test/sweep2.js
 */
const path = require("path");
const G = require(path.join(__dirname, "..", "js", "generator.js"));
const S = require(path.join(__dirname, "..", "js", "solver.js"));
const rules = require(path.join(__dirname, "..", "js", "rules.js"));

// tier, name, size, technique, density
const LADDER = [
  [1, "Crowded",  5, 3, 0.30],
  [2, "Bustling", 6, 3, 0.30],
  [3, "Murmur",   7, 4, 0.30],
  [4, "Hushed",   8, 4, 0.30],
  [5, "Secluded", 9, 6, 0.34],
  [6, "Solitary", 10, 6, 0.36],
];
const PER_TIER = 100;

const rand = G.mulberry32(424242);

console.log(`Batch verification — ${PER_TIER} puzzles per tier\n`);
console.log("tier name      size tech dens  ok   badCount guess mismatch | attempts avg/min/max  time");
console.log("-----------------------------------------------------------------------------------------");

const grand = { badCount: 0, guess: 0, mismatch: 0 };
const tGlobal = Date.now();

for (const [tier, name, N, tech, dens] of LADDER) {
  let ok = 0, badCount = 0, guess = 0, mismatch = 0;
  let attSum = 0, attMin = Infinity, attMax = 0, fails = 0;
  const t0 = Date.now();

  for (let k = 0; k < PER_TIER; k++) {
    const p = G.generatePuzzle(N, tech, { densityFrac: dens, maxAttempts: 20000, rand });
    if (p.failed) { fails++; continue; }

    // Independent re-verification of the returned puzzle.
    const sols = S.countSolutions(p.numbers, N, 2);
    if (sols !== 1) badCount++;
    const r = S.solve(p.numbers, N);
    if (!r.solved) guess++;                         // needed guessing beyond T6
    else if (r.tier !== tech) mismatch++;           // tier not an exact match
    // sanity: the stored solution mask really is a valid solution
    if (!rules.isValidSolution(p.numbers, p.solution, N)) badCount++;

    if (sols === 1 && r.solved && r.tier === tech) ok++;
    attSum += p.attempts; attMin = Math.min(attMin, p.attempts); attMax = Math.max(attMax, p.attempts);
  }

  grand.badCount += badCount; grand.guess += guess; grand.mismatch += mismatch;
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  const avg = (attSum / Math.max(1, PER_TIER - fails)).toFixed(1);
  const failNote = fails ? ` FAILS=${fails}` : "";
  console.log(
    `  ${tier}  ${name.padEnd(9)} ${N}x${N} T${tech}  ${dens.toFixed(2)} ${String(ok).padStart(3)}   ` +
    `${String(badCount).padStart(6)} ${String(guess).padStart(5)} ${String(mismatch).padStart(8)} | ` +
    `${avg.padStart(7)} ${String(attMin).padStart(3)}/${String(attMax).padStart(4)}   ${secs}s${failNote}`
  );
}

console.log("\nTOTthis run — solutions!=1: " + grand.badCount + ", guessing(>T6): " + grand.guess + ", tier mismatch: " + grand.mismatch);
console.log(`Total elapsed ${((Date.now() - tGlobal) / 1000).toFixed(1)}s`);
