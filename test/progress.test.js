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

console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
