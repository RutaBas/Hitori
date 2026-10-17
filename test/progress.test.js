/* progress.test.js — run with: node test/progress.test.js */
const path = require("path");
const P = require(path.join(__dirname, "..", "js", "progress.js"));

let pass = 0, fail = 0;
function check(label, cond) {
  console.log((cond ? "  ok  " : " FAIL ") + label);
  cond ? pass++ : fail++;
}

// 4 cells; solution shades cell 0 only.
const sol = Int8Array.from([1, 0, 0, 0]);
const right = () => Int8Array.from([0, 0, 0, 0]);
const wrong = () => Int8Array.from([0, 1, 0, 0]); // cell 1 shaded but lit in solution
const wrongCircle = () => Int8Array.from([2, 0, 0, 0]); // cell 0 circled but shaded in solution

function run(tr, states) { for (const s of states) P.trackMove(tr, s, sol); return tr; }

check("constants", P.LEVELS_PER_BATCH === 100 && P.SECTION_SIZE === 25 && P.LINGER_MOVES === 3);
check("computeStars", P.computeStars(0, 0) === 3 && P.computeStars(1, 0) === 2 && P.computeStars(0, 2) === 2 && P.computeStars(3, 3) === 1);

let t = run(P.newMistakeTracker(), [wrong(), right()]);
check("wrong then fixed next move -> 0", t.mistakes === 0);

t = run(P.newMistakeTracker(), [wrong(), wrong(), wrong()]);
check("wrong for 2 further moves -> not yet", t.mistakes === 0);
t = run(P.newMistakeTracker(), [wrong(), wrong(), wrong(), wrong()]);
check("wrong and left for 3 moves -> 1", t.mistakes === 1);

t = run(P.newMistakeTracker(), [wrong(), ...Array(10).fill(wrong())]);
check("still wrong after 10 moves -> still 1", t.mistakes === 1);

t = run(P.newMistakeTracker(), [wrong()]);
P.flagMistake(t, 1);
check("flagged by a hint -> 1", t.mistakes === 1);
P.flagMistake(t, 1);
run(t, Array(5).fill(wrong()));
check("flag + linger same episode counts once", t.mistakes === 1);

t = run(P.newMistakeTracker(), [wrong(), wrong(), wrong(), wrong(), right(), wrong(), wrong(), wrong(), wrong()]);
check("same cell wrong again later -> 2", t.mistakes === 2);

t = run(P.newMistakeTracker(), [wrongCircle(), wrongCircle(), wrongCircle(), wrongCircle()]);
check("circled shaded-cell counts as wrong", t.mistakes === 1);
t = run(P.newMistakeTracker(), Array(6).fill(right()));
check("unmarked never wrong", t.mistakes === 0);
t = P.newMistakeTracker();
P.flagMistake(t, 2);
check("flag on a non-wrong cell ignored", t.mistakes === 0);
check("tracker is plain JSON", JSON.stringify(JSON.parse(JSON.stringify(run(P.newMistakeTracker(), [wrong(), wrong()])))) !== undefined);

const o = { stars: 3, bestMs: 5000, noHint: true };
let m = P.mergeResult(o, 1, 9000, false);
check("mergeResult never lowers stars / raises bestMs / clears noHint", m.stars === 3 && m.bestMs === 5000 && m.noHint === true);
m = P.mergeResult({ stars: 1, bestMs: 9000, noHint: false }, 2, 4000, true);
check("mergeResult improves", m.stars === 2 && m.bestMs === 4000 && m.noHint === true);
m = P.mergeResult(null, 2, 7000, false);
check("mergeResult from null", m.stars === 2 && m.bestMs === 7000 && m.noHint === false);

const prog = { 1: { stars: 3, bestMs: 100 }, 2: { stars: 1, bestMs: 300 }, 5: { stars: 2, bestMs: 200 } };
check("isUnlocked 1 always", P.isUnlocked({}, 1) && P.isUnlocked(null, 1));
check("isUnlocked after solved", P.isUnlocked(prog, 3) && P.isUnlocked(prog, 6));
check("isUnlocked locked past gap", !P.isUnlocked(prog, 4) && !P.isUnlocked(prog, 7));
check("nextPlayable lowest unsolved unlocked", P.nextPlayable(prog, 100) === 3);
check("nextPlayable empty", P.nextPlayable({}, 100) === 1);
const full = {}; for (let i = 1; i <= 5; i++) full[i] = { stars: 1, bestMs: 1 };
check("nextPlayable null when all solved", P.nextPlayable(full, 5) === null);

const s = P.tierSummary(prog, 100);
check("tierSummary", s.solved === 3 && s.stars === 6 && s.maxStars === 300 &&
  s.starCounts[1] === 1 && s.starCounts[2] === 1 && s.starCounts[3] === 1 && s.bestMs === 100);
check("tierSummary empty", P.tierSummary(null, 100).solved === 0 && P.tierSummary({}, 100).bestMs === null);

// ---- tutorial lessons (Task 15) ----------------------------------------------
const Rl = require(path.join(__dirname, "..", "js", "rules.js"));
const MARK = { ".": 0, "S": 1, "O": 2 };
const marksOf = (s) => s.split("").map((ch) => MARK[ch]);
const L = P.TUTORIAL_LESSONS || [];
check("tutorial: 4 lessons", L.length === 4);

/** Every shading of the cells that have a same-number partner in their row or column
 *  (the only cells a Hitori ever shades), keeping the given shades, that obeys all rules. */
function candidateSolutions(lesson) {
  const N = lesson.N, nums = lesson.numbers, cand = [];
  for (let i = 0; i < N * N; i++) {
    const r = (i / N) | 0, c = i % N;
    let dup = false;
    for (let k = 0; k < N; k++) {
      if (k !== c && nums[r * N + k] === nums[i]) dup = true;
      if (k !== r && nums[k * N + c] === nums[i]) dup = true;
    }
    if (dup && lesson.givens[i] !== "O") cand.push(i);
  }
  const out = [];
  for (let s = 0; s < (1 << cand.length); s++) {
    const m = new Int8Array(N * N);
    cand.forEach((i, b) => { if (s >> b & 1) m[i] = 1; });
    if (lesson.givens.split("").some((ch, i) => ch === "S" && !m[i])) continue;
    if (Rl.isValidSolution(nums, m, N)) out.push(Array.from(m).join(""));
  }
  return out;
}

L.forEach((lesson, k) => {
  const tag = "tutorial lesson " + (k + 1) + ": ";
  const N = lesson.N, cells = N * N;
  check(tag + "has title, text, task and a not-quite message",
    ["title", "text", "task", "wrong"].every((f) => typeof lesson[f] === "string" && lesson[f].length > 0));
  check(tag + "tiny board (3x3 to 4x4)", N >= 3 && N <= 4 && lesson.numbers.length === cells &&
    lesson.numbers.every((v) => Number.isInteger(v) && v >= 1 && v <= N));
  check(tag + "givens and answer are mark strings for the board",
    [lesson.givens, lesson.answer].every((s) => typeof s === "string" && s.length === cells && /^[.SO]+$/.test(s)));
  const shaded = lesson.answer.split("").map((ch) => (ch === "S" ? 1 : 0));
  check(tag + "answer obeys all three rules", Rl.isValidSolution(lesson.numbers, shaded, N));
  check(tag + "givens agree with the answer", lesson.givens.split("").every((ch, i) =>
    ch === "." || (ch === "S" ? lesson.answer[i] === "S" : lesson.answer[i] !== "S")));
  const sols = candidateSolutions(lesson);
  check(tag + "answer is the only solution from the givens",
    sols.length === 1 && sols[0] === shaded.join(""));
  const start = P.tutorialProgress(lesson, 0, marksOf(lesson.givens));
  check(tag + "the givens alone don't finish it (the player must move)", !start.solved && !start.wrong);
});

// Lesson 1 teaches the tap cycle: shade, circle, clear, one tap each on the same cell.
const L1 = L[0];
if (L1) {
  check("lesson 1: three steps", Array.isArray(L1.steps) && L1.steps.length === 3 &&
    L1.steps.every((s) => typeof s.task === "string" && s.task && s.marks.length === L1.N * L1.N));
  let prev = marksOf(L1.givens), cyc = true, cell = null;
  L1.steps.forEach((s) => {
    const m = marksOf(s.marks), diff = [];
    m.forEach((v, i) => { if (v !== prev[i]) diff.push(i); });
    if (diff.length !== 1 || m[diff[0]] !== (prev[diff[0]] + 1) % 3) cyc = false;
    if (cell === null) cell = diff[0]; else if (diff[0] !== cell) cyc = false;
    prev = m;
  });
  check("lesson 1: each step is one tap of the same cell (unmarked -> shaded -> circled -> unmarked)", cyc);
  check("lesson 1: the last step is the answer", L1.steps[2].marks === L1.answer);
  check("lesson 1: first task line is step 1's", L1.task === L1.steps[0].task);

  // Walk it with tutorialProgress.
  const tp = P.tutorialProgress;
  let r = tp(L1, 0, marksOf(L1.steps[0].marks));
  check("progress: step 1 met -> step 2", r.step === 1 && !r.solved && !r.wrong);
  r = tp(L1, 1, marksOf(L1.steps[0].marks).map((v, i) => (i === (cell + 1) % 9 ? 1 : v)));
  check("progress: a stray tap is wrong and stays on the step", r.step === 1 && r.wrong && !r.solved);
  r = tp(L1, 1, marksOf(L1.steps[1].marks));
  check("progress: step 2 met -> step 3", r.step === 2 && !r.solved);
  r = tp(L1, 2, marksOf(L1.steps[2].marks));
  check("progress: last step -> solved", r.step === 3 && r.solved && !r.wrong);
}

// Rule lessons: the shades must match; circles are free on lit cells.
const L2 = L[1];
if (L2) {
  const tp = P.tutorialProgress, ans = marksOf(L2.answer);
  check("progress: the answer solves it", tp(L2, 0, ans).solved);
  const lit = ans.findIndex((v, i) => v === 0 && L2.givens[i] === ".");
  const withCircle = ans.slice(); withCircle[lit] = 2;
  check("progress: an extra circle on a lit cell still solves it", tp(L2, 0, withCircle).solved);
  const extra = ans.slice(); extra[lit] = 1;
  const rx = tp(L2, 0, extra);
  check("progress: an extra shade is wrong, not solved", rx.wrong && !rx.solved);
  const target = ans.indexOf(1);
  const circ = marksOf(L2.givens); circ[target] = 2;
  check("progress: circling the cell that must be shaded is wrong", tp(L2, 0, circ).wrong);
  check("progress: nothing yet is neither", (() => { const z = tp(L2, 0, marksOf(L2.givens)); return !z.wrong && !z.solved; })());
}

console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
