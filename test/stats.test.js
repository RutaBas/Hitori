/*
 * stats.test.js — cross-mode stats: activity log, overall streak, free-stats
 * migration, technique mastery, and the combined stats screen data.
 * Run with: node test/stats.test.js
 */
const path = require("path");
const S = require(path.join(__dirname, "..", "js", "stats.js"));

let pass = 0, fail = 0;
function check(label, cond) {
  console.log((cond ? "  ok  " : " FAIL ") + label);
  cond ? pass++ : fail++;
}

console.log("Stats 1: activity log and overall streak");
{
  // 2026-10-19 is a Monday
  let log = S.recordActivity({}, "2026-10-19", "level", 0);
  log = S.recordActivity(log, "2026-10-20", "daily", 2);
  const s = S.overallStreak(log, "2026-10-20");
  check("level Mon + daily Tue -> current 2", s.current === 2 && s.best === 2);
  check("counts and hints recorded", log["2026-10-20"].daily === 1 && log["2026-10-20"].hints === 2 &&
    log["2026-10-19"].level === 1 && log["2026-10-19"].free === 0);
  check("unsolved today does not break the streak", S.overallStreak(log, "2026-10-21").current === 2);
  check("a missed day does", S.overallStreak(log, "2026-10-22").current === 0 && S.overallStreak(log, "2026-10-22").best === 2);
  check("empty log", JSON.stringify(S.overallStreak({}, "2026-10-20")) === '{"current":0,"best":0}');
  const before = JSON.stringify(log);
  S.recordActivity(log, "2026-10-20", "free", 1);
  check("does not mutate its input", JSON.stringify(log) === before);
  let l2 = S.recordActivity({}, "2026-10-19", "free", 0, { started: true });
  check("started flag counts an attempt per mode, not a solve", l2["2026-10-19"].started.free === 1 &&
    l2["2026-10-19"].started.level === 0 && l2["2026-10-19"].free === 0 && S.overallStreak(l2, "2026-10-19").current === 0);
  l2 = S.recordActivity(l2, "2026-10-19", "free", 0);
  check("solve after start keeps started", l2["2026-10-19"].started.free === 1 && l2["2026-10-19"].free === 1);
  l2 = S.recordActivity(l2, "2026-10-19", "daily", 0, { started: true });
  check("a second mode's start is kept apart", l2["2026-10-19"].started.daily === 1 && l2["2026-10-19"].started.free === 1);
  const old = { "2026-10-18": { free: 1, level: 2, daily: 0, hints: 3, started: 4 } };
  const up = S.recordActivity(old, "2026-10-18", "level", 0, { started: true });
  check("an old numeric started is upgraded, never wiped", up["2026-10-18"].started.level === 1 &&
    up["2026-10-18"].started.unknown === 4 && up["2026-10-18"].level === 2 && up["2026-10-18"].hints === 3);
  check("upgrading does not mutate the old day", old["2026-10-18"].started === 4);
  let l3 = S.recordActivity({}, "2026-10-19", "free", 0);
  l3 = S.recordActivity(l3, "2026-10-21", "free", 0);
  l3 = S.recordActivity(l3, "2026-10-22", "free", 0);
  l3 = S.recordActivity(l3, "2026-10-23", "free", 0);
  check("best streak survives a gap", S.overallStreak(l3, "2026-10-23").best === 3 && S.overallStreak(l3, "2026-10-23").current === 3);
}

console.log("Stats 2: migrateFreeStats");
{
  const old = { 3: { played: 5, won: 4, bestMs: 91000, sumMs: 400000, currentStreak: 2, bestStreak: 3 } };
  const m = S.migrateFreeStats(old);
  check("keeps bestMs and every field", m[3].bestMs === 91000 && m[3].played === 5 && m[3].sumMs === 400000 &&
    m[3].currentStreak === 2 && m[3].bestStreak === 3);
  check("adds hintsUsed 0", m[3].hintsUsed === 0);
  check("keeps an existing hintsUsed", S.migrateFreeStats({ 1: { played: 1, hintsUsed: 4 } })[1].hintsUsed === 4);
  check("null/empty is fine", JSON.stringify(S.migrateFreeStats(null)) === "{}");
  check("does not mutate", old[3].hintsUsed === undefined);
}

console.log("Stats 3: masteredTechniques");
{
  const lv = {};
  lv[1] = {}; lv[3] = {}; lv[4] = {};
  for (let n = 1; n <= 10; n++) lv[1][n] = { stars: 3, bestMs: 1, noHint: true };
  for (let n = 1; n <= 6; n++) lv[3][n] = { stars: 3, bestMs: 1, noHint: true };
  for (let n = 7; n <= 15; n++) lv[4][n] = { stars: 1, bestMs: 1, noHint: false };
  const m = S.masteredTechniques(lv);
  check("three techniques 3,4,6", m.map((x) => x.tier).join() === "3,4,6");
  check("names come from the solver", m[0].name === "Connectivity" && m[1].name === "Reachability" && m[2].name === "Contradiction");
  check("technique 3 (tiers 1-2): 10 noHint -> mastered", m[0].done === 10 && m[0].need === 10 && m[0].mastered === true);
  check("technique 4 (tiers 3-4), only noHint: 6 -> not mastered", m[1].done === 6 && m[1].mastered === false);
  check("technique 6 empty", m[2].done === 0 && !m[2].mastered);
  check("null progress", S.masteredTechniques(null).every((x) => x.done === 0));
}

console.log("Stats 4: allStats");
{
  const e = S.allStats({ freeStats: null, levels: null, daily: null, activity: null }, "2026-10-20");
  check("empty -> zeros, no NaN", e.streak.current === 0 && e.streak.best === 0 && e.solved === 0 && e.finishedPct === 0 &&
    e.perfect === 0 && e.hintsPerGame === 0);
  check("empty has no NaN anywhere", !/NaN/.test(JSON.stringify(e)) && e.byTier.every((b) => b.solved === 0 && b.bestMs === 0 && b.avgMs === 0));
  check("grid length is 84", e.grid.length === 84);
  check("byTier lists tiers 1..6", e.byTier.map((b) => b.tier).join() === "1,2,3,4,5,6");

  // 2026-10-20 is a Tuesday: week starts Mon 10-19, grid starts 11 weeks earlier
  const input = {
    freeStats: { 3: { played: 4, won: 3, bestMs: 50000, sumMs: 240000, currentStreak: 0, bestStreak: 0 } },
    levels: { 3: { 1: { stars: 3, bestMs: 30000, noHint: true }, 2: { stars: 2, bestMs: 70000, noHint: false } } },
    daily: { "2026-10-17": { stars: 3, bestMs: 20000, onTime: true }, "2026-10-19": { stars: 1, bestMs: 90000, onTime: true } },
    activity: {},
  };
  let a = {};
  a = S.recordActivity(a, "2026-10-19", "level", 1, { started: true });
  a = S.recordActivity(a, "2026-10-19", "level", 1);
  a = S.recordActivity(a, "2026-10-20", "daily", 0);
  a = S.recordActivity(a, "2026-10-20", "free", 2);
  a = S.recordActivity(a, "2026-10-20", "free", 0, { started: true });
  input.activity = a;
  const r = S.allStats(input, "2026-10-20");
  check("solved = free won + levels + dailies", r.solved === 3 + 2 + 2);
  check("perfect = 3-star levels + dailies", r.perfect === 2);
  check("hintsPerGame = log hints / log solves", r.hintsPerGame === 1);
  // free 3 won / 4 played (hitori.stats); level 1 solve / 1 start; daily 1 solve, start not logged -> 1 attempt
  check("finishedPct per source: (3 + 1 + 1) / (4 + 1 + 1)", r.finishedPct === Math.round(5 / 6 * 100) && r.attempts === 6);
  check("streak from log", r.streak.current === 2);
  const t3 = r.byTier[2];
  check("tier 3 combines free, levels and dailies (day 0 is tier 3)", t3.solved === 3 + 2 + 1);
  check("tier 3 best is the fastest of all", t3.bestMs === 20000);
  check("tier 3 avg = (free sum + level/daily bests) / solved", t3.avgMs === Math.round((240000 + 30000 + 70000 + 20000) / 6));
  check("daily on tier 4 (10-18 is tier 4, 10-19 is tier 5)", r.byTier[4].solved === 1 && r.byTier[4].bestMs === 90000);
  const g = r.grid;
  check("grid is Monday-first columns ending on this week", g[0].key === "2026-08-03" && g[77].key === "2026-10-19" && g[78].key === "2026-10-20");
  check("grid marks daily / other / none", g[77].status === "other" && g[78].status === "daily" && g[79].status === "none" && g[0].status === "none");
  check("grid cells hold a daily when the log has one", g[78].status === "daily");
  const half = S.allStats({ freeStats: null, levels: null, daily: null,
    activity: S.recordActivity(S.recordActivity({}, "2026-10-20", "level", 0, { started: true }), "2026-10-20", "daily", 0, { started: true }) }, "2026-10-20");
  check("started but unsolved -> 0%", half.finishedPct === 0 && half.attempts === 2);
}

console.log("Stats 5: % finished counts attempts, not unique puzzles");
{
  // Replay: the same level started 5 times and solved 5 times -> 100%, not 20%.
  let log = {};
  for (let k = 0; k < 5; k++) {
    log = S.recordActivity(log, "2026-10-20", "level", 0, { started: true });
    log = S.recordActivity(log, "2026-10-20", "level", 0);
  }
  const rep = S.allStats({ freeStats: null, levels: { 1: { 1: { stars: 3, bestMs: 5000, noHint: true } } }, daily: null, activity: log }, "2026-10-20");
  check("5 starts + 5 solves of one level -> 100%", rep.finishedPct === 100);
  check("solved still counts unique puzzles", rep.solved === 1);
  // Same level replayed 4 times, abandoned once.
  let log2 = {};
  for (let k = 0; k < 5; k++) log2 = S.recordActivity(log2, "2026-10-20", "level", 0, { started: true });
  for (let k = 0; k < 4; k++) log2 = S.recordActivity(log2, "2026-10-20", "level", 0);
  check("5 starts + 4 solves -> 80%", S.allStats({ levels: { 1: { 1: { stars: 3, bestMs: 1, noHint: true } } }, activity: log2 }, "2026-10-20").finishedPct === 80);

  // Migrated player: pre-update free records and level/daily progress, no activity log yet.
  const mig = S.allStats({
    freeStats: { 2: { played: 10, won: 6, bestMs: 1000, sumMs: 6000 } },
    levels: { 1: { 1: { stars: 2, bestMs: 1, noHint: false }, 2: { stars: 3, bestMs: 1, noHint: true } } },
    daily: { "2026-10-17": { stars: 3, bestMs: 1, onTime: true } },
    activity: {},
  }, "2026-10-20");
  check("migrated player: free won/played from full history -> 60%, not 100%", mig.finishedPct === 60 && mig.attempts === 10);
  check("migrated player: solved still counts every source", mig.solved === 6 + 2 + 1);
  const migOnly = S.allStats({ levels: { 1: { 1: { stars: 1, bestMs: 1, noHint: false } } }, activity: {} }, "2026-10-20");
  check("level progress with no logged attempts -> no %, not 100", migOnly.finishedPct === 0 && migOnly.attempts === 0);

  // A day logged in the old shape (numeric started) still reads.
  const legacy = S.allStats({ freeStats: null, levels: null, daily: null,
    activity: { "2026-10-20": { free: 0, level: 1, daily: 0, hints: 0, started: 3 } } }, "2026-10-20");
  check("old numeric started never pushes past 100% and has no NaN", legacy.finishedPct === 100 && !/NaN/.test(JSON.stringify(legacy)));
}

console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
