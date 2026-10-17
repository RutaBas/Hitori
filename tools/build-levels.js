/* tools/build-levels.js — builds js/levels.js, the frozen level packs.
 *
 * Run from the project root:
 *   node tools/build-levels.js --batches 1            build batch 1 for every tier
 *   node tools/build-levels.js --batches 2 --tier 1   add batch 2 for tier 1 only
 *   ... --dry-run                                     build and report, write nothing
 *
 * Levels come in batches of LEVELS_PER_BATCH (100) per tier. Each batch has its own
 * easy -> hard ramp. The script reads the current js/levels.js, keeps every existing
 * batch byte-for-byte, builds only the missing ones, and appends them, so level n of a
 * tier always maps to the same puzzle (saved progress stays valid).
 *
 * Per tier, per new batch b: candidate c is seeded by
 *   mulberry32(hashString("level-" + tier + "-batch-" + b + "-cand-" + c))
 * and kept if it is unique, needs exactly TIERS[tier].technique, and is new. 400 kept
 * candidates are sorted by scorePuzzle (hardWork asc, opening desc, string asc), the
 * hardest TRIM_FRACTION (2%, i.e. the last 8 of 400) are dropped so level 100 is not an
 * extreme outlier, and 100 are taken evenly spaced from the remaining 392
 * (index round(k * 391 / 99)). Fully deterministic: two runs write identical files.
 */
const fs = require("fs");
const path = require("path");
const G = require("../js/generator.js");
const S = require("../js/solver.js");
const P = require("../js/progress.js");

const POOL = 400;
const TRIM_FRACTION = 0.02; // hardest share of the sorted pool dropped before selection
const KEPT = POOL - Math.round(POOL * TRIM_FRACTION); // 392
const MAX_CANDIDATES = 20000;
const OUT = path.join(__dirname, "..", "js", "levels.js");
const TIER_FNS_LOCAL = [null, S.applyT1, S.applyT2, S.applyT3, S.applyT4, S.applyT5, S.applyT6];

/*
 * Difficulty score from a cheapest-first solve (same loop as solver.js deduce, recording
 * which tier made each step and how many cells it decided).
 *   hardWork      = PRIMARY key: tier-weighted count of cells decided by hard steps
 *                   (T3=1, T4=2, T5=3, T6=4 per cell; T1/T2 count 0). It measures how much
 *                   of the board needs hard reasoning, and unlike step counts it still
 *                   spreads out at 5x5/6x6, where a T3 puzzle usually needs only 1 T3 step.
 *   hardSteps     = number of steps at tier >= 3
 *   weightedSteps = tier-weighted step count (same weights)
 *   topSteps      = steps credited to topTier
 *   opening       = cells decided by T1-T2 alone from the empty board (tie-break: more = easier)
 */
const HARD_WEIGHT = [0, 0, 0, 1, 2, 3, 4];
function scorePuzzle(numbers, N, topTier) {
  const cells = new Int8Array(N * N);
  const counts = [0, 0, 0, 0, 0, 0, 0];
  const cellsBy = [0, 0, 0, 0, 0, 0, 0];
  for (;;) {
    if (S.partialConflict(cells, numbers, N)) break;
    let progressed = false;
    for (let t = 1; t <= 6; t++) {
      const r = TIER_FNS_LOCAL[t](cells, numbers, N);
      if (r.contradiction) break;
      if (r.changed > 0) { counts[t]++; cellsBy[t] += r.changed; progressed = true; break; }
    }
    if (!progressed) break;
  }
  const open = new Int8Array(N * N);
  S.deduce(open, numbers, N, 2);
  let opening = 0;
  for (let i = 0; i < open.length; i++) if (open[i] !== S.SolveCell.UNKNOWN) opening++;
  let hardWork = 0, hardSteps = 0, weightedSteps = 0;
  for (let t = 3; t <= 6; t++) {
    hardWork += cellsBy[t] * HARD_WEIGHT[t];
    hardSteps += counts[t];
    weightedSteps += counts[t] * HARD_WEIGHT[t];
  }
  return { hardWork, hardSteps, weightedSteps, topSteps: counts[topTier], opening };
}

function byScore(a, b) {
  return a.hardWork - b.hardWork || b.opening - a.opening || (a.str < b.str ? -1 : a.str > b.str ? 1 : 0);
}

/* Build batch `batch` (1-based) of `tier`. `existing` = strings to avoid (earlier batches). */
function buildBatch(tier, batch, existing) {
  const cfg = G.TIERS[tier];
  const per = P.LEVELS_PER_BATCH;
  const seen = new Set();
  const pool = [];
  let c = 0;
  for (; pool.length < POOL; c++) {
    if (c >= MAX_CANDIDATES) {
      throw new Error("build-levels: tier " + tier + " batch " + batch + ": only " + pool.length +
        " candidates after " + c + " tries");
    }
    const rand = G.mulberry32(G.hashString("level-" + tier + "-batch-" + batch + "-cand-" + c));
    const p = G.generateTier(tier, { rand });
    if (!p || p.failed) continue;
    const k = G.classify(p.numbers, cfg.size);
    if (!k.unique || k.tier !== cfg.technique) continue;
    const str = G.encodeNumbers(p.numbers);
    if (existing.has(str) || seen.has(str)) continue;
    seen.add(str);
    const s = scorePuzzle(p.numbers, cfg.size, cfg.technique);
    pool.push({ str, hardWork: s.hardWork, opening: s.opening });
  }
  pool.sort(byScore);
  const picks = [];
  for (let k = 0; k < per; k++) picks.push(pool[Math.round(k * (KEPT - 1) / (per - 1))]);
  console.log("  tier " + tier + " (" + cfg.name + " " + cfg.size + "x" + cfg.size + ") batch " + batch +
    ": " + pool.length + " candidates from " + c + " tries, hardWork " + picks[0].hardWork +
    " -> " + picks[per - 1].hardWork);
  return picks.map((x) => x.str);
}

function readExisting() {
  if (!fs.existsSync(OUT)) return {};
  delete require.cache[require.resolve(OUT)];
  return require(OUT).LEVELS;
}

function render(levels) {
  const per = P.LEVELS_PER_BATCH;
  const lines = [
    "/* levels.js — GENERATED by tools/build-levels.js. Do not edit by hand.",
    " *",
    " * LEVELS[tier] = the tier's fixed levels, level 1 first, as encodeNumbers strings",
    " * (one base-36 char per cell, row-major). The solution is recomputed by the solver",
    " * when a level opens. Levels come in batches of " + per + "; each batch ramps easy -> hard.",
    " *",
    " * To add levels: node tools/build-levels.js --batches <n>   (optionally --tier <t>).",
    " * Existing batches are kept byte-for-byte and new ones appended, so level numbers",
    " * never move. levelCount() reads the data, so no other code changes are needed.",
    " */",
    "const LEVELS_VERSION = 1;",
    "const LEVELS = {",
  ];
  for (let t = 1; t <= 6; t++) {
    const arr = levels[t] || [];
    lines.push("  " + t + ": [");
    for (let i = 0; i < arr.length; i++) {
      if (i % per === 0) lines.push("    // batch " + (i / per + 1));
      lines.push('    "' + arr[i] + '",');
    }
    lines.push("  ],");
  }
  lines.push(
    "};",
    "",
    "/** Number of levels in a tier (0 for an unknown tier). */",
    "function levelCount(tier) {",
    "  return LEVELS[tier] ? LEVELS[tier].length : 0;",
    "}",
    "",
    "/** Level n (1-based) of a tier as an Int8Array of cell numbers. */",
    "function levelNumbers(tier, n) {",
    "  const str = LEVELS[tier][n - 1];",
    "  const out = new Int8Array(str.length);",
    "  for (let i = 0; i < str.length; i++) out[i] = parseInt(str[i], 36);",
    "  return out;",
    "}",
    "",
    'if (typeof module !== "undefined" && module.exports) {',
    "  module.exports = { LEVELS_VERSION, LEVELS, levelCount, levelNumbers };",
    "}",
    ""
  );
  return lines.join("\n");
}

function main(argv) {
  const opt = { batches: 1, tier: null, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--batches") opt.batches = parseInt(argv[++i], 10);
    else if (argv[i] === "--tier") opt.tier = parseInt(argv[++i], 10);
    else if (argv[i] === "--dry-run") opt.dryRun = true;
    else throw new Error("unknown argument " + argv[i]);
  }
  if (!(opt.batches >= 1)) throw new Error("--batches must be >= 1");
  const per = P.LEVELS_PER_BATCH;
  const old = readExisting();
  const levels = {};
  const t0 = Date.now();
  for (let t = 1; t <= 6; t++) {
    const arr = (old[t] || []).slice();
    if (arr.length % per !== 0) throw new Error("tier " + t + " has a partial batch (" + arr.length + ")");
    if (opt.tier === null || opt.tier === t) {
      const existing = new Set(arr);
      for (let b = arr.length / per + 1; b <= opt.batches; b++) {
        const ts = Date.now();
        const batch = buildBatch(t, b, existing);
        for (const s of batch) { existing.add(s); arr.push(s); }
        console.log("    (" + ((Date.now() - ts) / 1000).toFixed(1) + " s)");
      }
    }
    levels[t] = arr;
  }
  console.log("built in " + ((Date.now() - t0) / 1000).toFixed(1) + " s");
  if (opt.dryRun) { console.log("dry run: nothing written"); return; }
  fs.writeFileSync(OUT, render(levels));
  console.log("wrote " + OUT + " (" + fs.statSync(OUT).size + " bytes)");
}

if (require.main === module) main(process.argv.slice(2));

module.exports = { scorePuzzle, buildBatch, render, TRIM_FRACTION };
