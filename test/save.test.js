/* save.test.js — the in-progress save shape and migrateSave. Run with: node test/save.test.js
 *
 * Review Focus 1: a save written by the pre-update game (no `mode`, `tierIndex`
 * instead of `tier`) must resume as a free-play game with its timer and marks intact.
 */
const path = require("path");
const P = require(path.join(__dirname, "..", "js", "progress.js"));

let pass = 0, fail = 0;
function check(label, cond) {
  console.log((cond ? "  ok  " : " FAIL ") + label);
  cond ? pass++ : fail++;
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

check("migrateSave is exported", typeof P.migrateSave === "function");
const migrateSave = P.migrateSave || (() => null);

// Today's save shape, exactly as ui.js saveGame() writes it before the update.
const numbers = Array.from({ length: 64 }, (_, i) => (i % 8) + 1);
const solution = Array.from({ length: 64 }, (_, i) => (i % 3 === 0 ? 1 : 0));
const state = Array.from({ length: 64 }, (_, i) => (i % 5 === 0 ? 1 : i % 7 === 0 ? 2 : 0));
const old = {
  tierIndex: 4, tierName: "Hushed", N: 8,
  numbers: numbers.slice(), solution: solution.slice(), state: state.slice(),
  elapsedMs: 61000, moves: 9, savedAt: 1760000000000,
};
const oldCopy = JSON.parse(JSON.stringify(old));
const m = migrateSave(old) || {};

check("old save -> mode free", m.mode === "free");
check("old save -> tier 4", m.tier === 4);
check("old save -> no tierIndex left", !("tierIndex" in m));
check("old save -> same N", m.N === 8);
check("old save -> same numbers", same(m.numbers, numbers));
check("old save -> same solution", same(m.solution, solution));
check("old save -> same state (marks intact)", same(m.state, state));
check("old save -> same elapsedMs (timer intact)", m.elapsedMs === 61000);
check("old save -> same moves", m.moves === 9);
check("old save -> hintsUsed 0", m.hintsUsed === 0);
check("old save -> fresh tracker", same(m.tracker, P.newMistakeTracker()));
check("old save -> savedAt kept", m.savedAt === 1760000000000);
check("input is not mutated", same(old, oldCopy));

// A new-shape save passes through untouched.
const tr = P.newMistakeTracker(); tr.move = 5; tr.mistakes = 1; tr.wrongSince = { 3: 2 }; tr.counted = { 3: true };
const lvl = {
  mode: "level", tier: 3, N: 1, level: 23, numbers: [1], solution: [0], state: [1],
  elapsedMs: 5000, moves: 4, hintsUsed: 2, tracker: tr, savedAt: 1,
};
const ml = migrateSave(JSON.parse(JSON.stringify(lvl)));
check("new level save unchanged", same(ml, lvl));
const daily = {
  mode: "daily", tier: 5, N: 1, dailyKey: "2026-10-17", startedKey: "2026-10-17",
  numbers: [1], solution: [0], state: [0], elapsedMs: 0, moves: 0, hintsUsed: 0,
  tracker: P.newMistakeTracker(), savedAt: 2,
};
check("new daily save unchanged", same(migrateSave(JSON.parse(JSON.stringify(daily))), daily));

// Missing optional counters are filled in, not invented elsewhere.
const partial = migrateSave({ mode: "free", tier: 1, N: 1, numbers: [3], solution: [0], state: [0] });
check("missing hintsUsed -> 0", partial.hintsUsed === 0);
check("missing tracker -> fresh", same(partial.tracker, P.newMistakeTracker()));
check("missing elapsedMs/moves -> 0", partial.elapsedMs === 0 && partial.moves === 0);

// Nothing to resume.
check("null -> null", migrateSave(null) === null);
check("undefined -> null", migrateSave(undefined) === null);
check("non-object -> null", migrateSave("x") === null && migrateSave(42) === null);
check("no board data -> null", migrateSave({ tierIndex: 2 }) === null);
check("board arrays of the wrong length -> null", migrateSave(Object.assign({}, old, { state: [0, 1] })) === null);
check("unknown tier -> null", migrateSave({ tierIndex: 0, N: 5, numbers: [1], solution: [0], state: [0] }) === null);

// A daily save needs a real day key; a level save needs a positive whole level number.
const withKey = (k) => Object.assign({}, daily, { dailyKey: k });
check("daily without dailyKey -> null", migrateSave(withKey(undefined)) === null);
check("daily with a malformed dailyKey -> null",
  migrateSave(withKey("2026-1-7")) === null && migrateSave(withKey("today")) === null &&
  migrateSave(withKey(20261017)) === null);
const withLevel = (n) => Object.assign({}, lvl, { level: n });
check("level without level -> null", migrateSave(withLevel(undefined)) === null);
check("level 0, negative, fractional or string -> null",
  migrateSave(withLevel(0)) === null && migrateSave(withLevel(-3)) === null &&
  migrateSave(withLevel(2.5)) === null && migrateSave(withLevel("23")) === null);
check("free save needs neither dailyKey nor level", migrateSave(Object.assign({}, partial)) !== null);

console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
