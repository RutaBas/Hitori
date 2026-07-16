/*
 * solver.test.js — Step 2 verification. Run with: node test/solver.test.js
 *
 * Covers the brief's KEY VERIFICATION POINTS 1–3 (point 4, the generator batch, is
 * Step 3), plus a brute-force cross-check that validates counting mode exhaustively on
 * small boards by comparing against an independent 2^(N*N) enumeration.
 */

const path = require("path");
const rules = require(path.join(__dirname, "..", "js", "rules.js"));
const S = require(path.join(__dirname, "..", "js", "solver.js"));
const { SolveCell } = S;
const { UNKNOWN, WHITE, BLACK } = SolveCell;

let pass = 0, fail = 0;
function check(label, cond) {
  console.log((cond ? "  ok  " : " FAIL ") + label);
  cond ? pass++ : fail++;
}
function idx(r, c, N) { return r * N + c; }

// Independent reference counter: brute-force every 2^(N*N) shading, count valid ones.
function bruteCount(numbers, N, cap) {
  const total = N * N;
  let count = 0;
  for (let m = 0; m < (1 << total); m++) {
    const mask = new Int8Array(total);
    for (let i = 0; i < total; i++) mask[i] = (m >> i) & 1;
    if (rules.isValidSolution(numbers, mask, N)) {
      count++;
      if (count >= cap) return cap;
    }
  }
  return count;
}

// Deterministic RNG (mulberry32) for reproducible random boards.
function rng(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function randomBoard(N, rand) {
  const nums = new Array(N * N);
  for (let i = 0; i < N * N; i++) nums[i] = 1 + Math.floor(rand() * N);
  return nums;
}

// ============================================================================
console.log("== KVP 1: a Latin square has MULTIPLE solutions (the make-or-break test) ==");
// Every row/column already all-distinct -> rule 1 never bites. All-white is valid, and
// shading the centre of a 3x3 is ALSO valid. A counter that reports 1 here only checks
// rule 1 and would pass garbage puzzles.
{
  const N = 3;
  const latin3 = []; // (r+c)%N + 1
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) latin3.push(((r + c) % N) + 1);
  check("3x3 Latin: countSolutions >= 2", S.countSolutions(latin3, N, 2) === 2);
  check("3x3 Latin: brute agrees (>= 2)", bruteCount(latin3, N, 2) === 2);

  // Explicit demonstration: all-white valid AND centre-shaded valid.
  const white = new Int8Array(9);
  const centre = new Int8Array(9); centre[4] = 1;
  check("3x3 Latin: all-white is a valid solution", rules.isValidSolution(latin3, white, N) === true);
  check("3x3 Latin: centre-shaded is ALSO a valid solution", rules.isValidSolution(latin3, centre, N) === true);
}
{
  const N = 4;
  const latin4 = [];
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) latin4.push(((r + c) % N) + 1);
  check("4x4 Latin: countSolutions >= 2", S.countSolutions(latin4, N, 2) === 2);
}

// ============================================================================
console.log("\n== KVP 2: triple rule (X X X -> middle white, both outer shaded) ==");
{
  const N = 5;
  // Row 0 = [3,3,3,1,2]; rows 1-4 a Latin square of 1..5 (no adjacent equals, no triples).
  const nums = new Array(N * N);
  for (let r = 1; r < N; r++) for (let c = 0; c < N; c++) nums[r * N + c] = ((r + c) % N) + 1;
  nums[0] = 3; nums[1] = 3; nums[2] = 3; nums[3] = 1; nums[4] = 2;

  const cells = new Int8Array(N * N);
  const r1 = S.applyT1(cells, nums, N);
  check("T1 reports no contradiction", r1.contradiction === false);
  check("triple: middle (0,1) forced WHITE", cells[idx(0, 1, N)] === WHITE);
  check("triple: outer (0,0) forced BLACK", cells[idx(0, 0, N)] === BLACK);
  check("triple: outer (0,2) forced BLACK", cells[idx(0, 2, N)] === BLACK);
}

// ============================================================================
console.log("\n== KVP 3: corner connectivity (the boxed corner can't be stranded) ==");
{
  const N = 4;
  // Row 0 = [7,5,5,5]: the triple forces (0,1) BLACK. That makes corner (0,0) a white
  // cell whose ONLY non-black neighbour is (1,0) — so (1,0) is forced white by the
  // connectivity/corner reasoning (T3), and NOT by pure propagation (T2).
  const nums = [
    7, 5, 5, 5,
    1, 2, 3, 4,
    2, 3, 4, 1,
    3, 4, 1, 2,
  ];
  const c10 = idx(1, 0, N);

  const upToT2 = new Int8Array(N * N);
  S.deduce(upToT2, nums, N, 2);
  check("(0,1) forced BLACK by the triple", upToT2[idx(0, 1, N)] === BLACK);
  check("(0,0) forced WHITE (neighbour of a black)", upToT2[idx(0, 0, N)] === WHITE);
  check("(1,0) still UNKNOWN with only T1+T2 (needs connectivity)", upToT2[c10] === UNKNOWN);

  const upToT3 = new Int8Array(N * N);
  const r = S.deduce(upToT3, nums, N, 3);
  check("(1,0) forced WHITE once T3 is allowed", upToT3[c10] === WHITE);
  check("T3 was the tier required (maxTierUsed === 3)", r.maxTierUsed === 3);
}

// ============================================================================
console.log("\n== counter correctness: DFS vs brute-force over random boards ==");
// The strongest counter test: min(trueCount, cap) from DFS must equal the independent
// enumeration for many random boards. Cap 3 so 0 / 1 / 2 / >=3 are all distinguished —
// this inherently exercises exact-uniqueness (count === 1) wherever it occurs.
{
  const cap = 3;
  const dist = { 0: 0, 1: 0, 2: 0, 3: 0 };
  let mismatches = 0, boards = 0;

  const rand3 = rng(12345);
  for (let t = 0; t < 60; t++) {
    const nums = randomBoard(3, rand3);
    const b = bruteCount(nums, 3, cap);
    const d = S.countSolutions(nums, 3, cap);
    if (b !== d) { mismatches++; if (mismatches <= 3) console.log(`    MISMATCH 3x3 brute=${b} dfs=${d} nums=${nums}`); }
    dist[b]++; boards++;
  }
  const rand4 = rng(67890);
  for (let t = 0; t < 12; t++) {
    const nums = randomBoard(4, rand4);
    const b = bruteCount(nums, 4, cap);
    const d = S.countSolutions(nums, 4, cap);
    if (b !== d) { mismatches++; if (mismatches <= 3) console.log(`    MISMATCH 4x4 brute=${b} dfs=${d} nums=${nums}`); }
    dist[b]++; boards++;
  }
  console.log(`    ${boards} random boards; count distribution (capped @3): ` +
    `0-sol=${dist[0]}, 1-sol=${dist[1]}, 2-sol=${dist[2]}, >=3-sol=${dist[3]}`);
  check("DFS counter matches brute-force on every random board", mismatches === 0);
  check("the random set actually included a UNIQUE (count === 1) board", dist[1] > 0);
  check("the random set included a multi-solution board", dist[2] + dist[3] > 0);
}

// ============================================================================
console.log("\n== sanity: solver never crashes and counts stay consistent ==");
{
  const nums = [7, 5, 5, 5, 1, 2, 3, 4, 2, 3, 4, 1, 3, 4, 1, 2];
  const res = S.solve(nums, 4);
  check("solve() returns a tier value", typeof res.tier === "number");
  check("countSolutions matches brute on the corner board", S.countSolutions(nums, 4, 3) === bruteCount(nums, 4, 3));
}

// ============================================================================
console.log("\n== hints: next deduction from a partial state, cheapest tier first ==");
{
  // Triple board from KVP2: from an empty seed the first hint should be a T1 pattern move.
  const N = 5;
  const nums = new Array(N * N);
  for (let r = 1; r < N; r++) for (let c = 0; c < N; c++) nums[r * N + c] = ((r + c) % N) + 1;
  nums[0] = 3; nums[1] = 3; nums[2] = 3; nums[3] = 1; nums[4] = 2;
  const seed = new Int8Array(N * N);
  const h = S.hintNext(seed, nums, N);
  check("hint from empty triple board is a deduction", h.status === "deduction");
  check("hint names the T1 technique (Pattern)", h.tier === 1 && h.technique === "Pattern");
  check("hint targets a triple cell with a determined value", [0, 1, 2].indexOf(h.i) >= 0 && h.value !== UNKNOWN);

  // A generated Crowded puzzle: driving hints to completion must reproduce the solution.
  const G = require(path.join(__dirname, "..", "js", "generator.js"));
  const p = G.generateTier(1, { rand: G.mulberry32(99) });
  const cells = new Int8Array(p.N * p.N); // all UNKNOWN
  let steps = 0, ok = true;
  while (steps < 500) {
    const hint = S.hintNext(cells, p.numbers, p.N);
    if (hint.status !== "deduction") break;
    // every hinted cell must agree with the unique solution
    const solVal = p.solution[hint.i] ? BLACK : WHITE;
    if (hint.value !== solVal) { ok = false; break; }
    cells[hint.i] = hint.value;
    steps++;
  }
  let complete = true;
  for (let i = 0; i < cells.length; i++) if (cells[i] === UNKNOWN) { complete = false; break; }
  check("following hints only ever agrees with the solution", ok);
  check("following hints solves the whole puzzle", complete);
}

console.log("\n---");
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
