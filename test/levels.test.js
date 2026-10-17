/*
 * levels.test.js — the frozen level packs (js/levels.js, built by tools/build-levels.js).
 * Run with: node test/levels.test.js
 *
 * Checks every level is valid (unique, exactly its tier's technique), that no level is
 * repeated, that each batch of 100 climbs in difficulty, and that batch 1 never changes
 * (BATCH1_FINGERPRINTS) — adding batches later must leave existing levels untouched.
 */

const path = require("path");
const L = require(path.join(__dirname, "..", "js", "levels.js"));
const G = require(path.join(__dirname, "..", "js", "generator.js"));
const P = require(path.join(__dirname, "..", "js", "progress.js"));
const T = require(path.join(__dirname, "..", "tools", "build-levels.js"));

let pass = 0, fail = 0;
function check(label, cond) {
  console.log((cond ? "  ok  " : " FAIL ") + label);
  cond ? pass++ : fail++;
}

// hashString of each tier's first 100 strings joined by ",". Filled from the batch-1 build;
// these must never change (adding batches appends, it never rewrites).
const BATCH1_FINGERPRINTS = {
  1: 487871509, 2: 4110827629, 3: 2187924140,
  4: 37723364, 5: 3324834110, 6: 2583807601,
};

// Spearman rank correlation with average ranks for ties.
function ranks(arr) {
  const idx = arr.map((v, i) => i).sort((a, b) => arr[a] - arr[b]);
  const r = new Array(arr.length);
  for (let i = 0; i < idx.length;) {
    let j = i;
    while (j + 1 < idx.length && arr[idx[j + 1]] === arr[idx[i]]) j++;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) r[idx[k]] = avg;
    i = j + 1;
  }
  return r;
}
function spearman(xs, ys) {
  const rx = ranks(xs), ry = ranks(ys), n = xs.length;
  const mx = rx.reduce((a, b) => a + b, 0) / n, my = ry.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (rx[i] - mx) * (ry[i] - my);
    sxx += (rx[i] - mx) ** 2;
    syy += (ry[i] - my) ** 2;
  }
  return sxx && syy ? sxy / Math.sqrt(sxx * syy) : NaN;
}

console.log("level counts / data shape");
check("LEVELS_VERSION is 1", L.LEVELS_VERSION === 1);
for (let t = 1; t <= 6; t++) {
  const n = L.levelCount(t);
  check("tier " + t + ": levelCount " + n + " is a multiple of " + P.LEVELS_PER_BATCH + " and >= 100",
    n >= 100 && n % P.LEVELS_PER_BATCH === 0 && n === L.LEVELS[t].length);
}
check("levelCount of an unknown tier is 0", L.levelCount(7) === 0);

console.log("every level is valid");
const all = new Set();
let dupes = 0;
for (let t = 1; t <= 6; t++) {
  const N = G.TIERS[t].size, want = G.TIERS[t].technique;
  let bad = [];
  for (let n = 1; n <= L.levelCount(t); n++) {
    const nums = L.levelNumbers(t, n);
    const okShape = nums instanceof Int8Array && nums.length === N * N &&
      G.encodeNumbers(nums) === L.LEVELS[t][n - 1];
    const c = okShape ? G.classify(nums, N) : null;
    if (!okShape || !c.unique || c.tier !== want) bad.push(n);
    if (all.has(L.LEVELS[t][n - 1])) dupes++;
    all.add(L.LEVELS[t][n - 1]);
  }
  check("tier " + t + ": all levels decode to " + N + "x" + N + ", unique, technique T" + want +
    (bad.length ? " (bad: " + bad.slice(0, 5).join(",") + ")" : ""), bad.length === 0);
}
check("no duplicate level strings across all tiers", dupes === 0);

console.log("in-batch difficulty ramp");
for (let t = 1; t <= 6; t++) {
  const N = G.TIERS[t].size, top = G.TIERS[t].technique;
  const batches = L.levelCount(t) / P.LEVELS_PER_BATCH;
  for (let b = 0; b < batches; b++) {
    // Primary key = hardWork (tier-weighted cells decided by T3+ steps), the build's sort
    // key. It must never decrease within a batch, and must itself carry the ramp: Spearman
    // on the primary key alone (opening is only a tie-break) must be >= 0.8.
    const idx = [], work = [];
    for (let k = 0; k < P.LEVELS_PER_BATCH; k++) {
      const n = b * P.LEVELS_PER_BATCH + k + 1;
      idx.push(k);
      work.push(T.scorePuzzle(L.levelNumbers(t, n), N, top).hardWork);
    }
    let drops = 0;
    for (let k = 1; k < work.length; k++) if (work[k] < work[k - 1]) drops++;
    const label = "tier " + t + " batch " + (b + 1) + ": ";
    check(label + "hardWork never decreases (" + work[0] + " -> " + work[work.length - 1] + ")", drops === 0);
    const rho = spearman(idx, work);
    check(label + "Spearman(index, hardWork) = " + rho.toFixed(3) + " >= 0.8", rho >= 0.8);
    // No outlier finale: the step into the batch's last level is at most a quarter of the
    // batch's whole climb (floor 1 for tiny integer ranges). "3x the median step" cannot be
    // used: most neighbours tie on hardWork, so the median step is 0 in every tier.
    const last = work[work.length - 1] - work[work.length - 2];
    const climb = work[work.length - 1] - work[0];
    const bound = Math.max(1, 0.25 * climb);
    check(label + "last step " + last + " <= max(1, 0.25 x climb " + climb + ") = " + bound, last <= bound);
  }
}

console.log("batch-1 fingerprints (frozen levels)");
for (let t = 1; t <= 6; t++) {
  const fp = G.hashString(L.LEVELS[t].slice(0, P.LEVELS_PER_BATCH).join(","));
  check("tier " + t + ": fingerprint " + fp + " === " + BATCH1_FINGERPRINTS[t], fp === BATCH1_FINGERPRINTS[t]);
}

console.log("scorePuzzle sanity");
{
  const nums = L.levelNumbers(1, 1);
  const s1 = T.scorePuzzle(nums, 5, 3), s2 = T.scorePuzzle(nums, 5, 3);
  check("scorePuzzle is deterministic and credits >= 1 top-tier step",
    s1.topSteps === s2.topSteps && s1.opening === s2.opening && s1.topSteps >= 1 &&
    s1.hardWork === s2.hardWork && s1.hardWork >= s1.topSteps);
  check("opening is within 0..N^2", s1.opening >= 0 && s1.opening <= 25);
}

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
