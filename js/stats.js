/* stats.js — statistics across ALL modes (free play, daily, levels).
 *
 * Pure and headless (no DOM, no storage). Dual-use: browser <script> globals,
 * node require (see daily.js / progress.js). Loads after daily.js and before
 * ui.js; uses its dateKey/parseKey/addDays/dailyTier and generator.js's TIERS.
 *
 * Inputs it reads (it never writes them):
 *   freeStats  { "<tier 1..6>": { played, won, bestMs, sumMs, ..., hintsUsed } }
 *   levels     { "<tier>": { "<n>": { stars, bestMs, noHint } } }
 *   daily      { "YYYY-MM-DD": { stars, bestMs, onTime } }
 *   activity   { "YYYY-MM-DD": { free, level, daily, hints, started } }
 *
 * The activity log is the one source for streaks, the calendar grid, hints per
 * game and ATTEMPTS: `started` counts games begun (recordActivity with
 * { started: true }) and is summed over all three modes for finishedPct, so a
 * daily attempt is counted exactly like a free or level one. Solves
 * (free/level/daily) count games finished that day; `hints` is the total hints
 * used in those solves.
 *
 * Times: free play averages use its own sumMs; levels and dailies only keep a
 * best time, so that best stands in as their time (same as dailyStats).
 */
if (typeof module !== "undefined") {
  Object.assign(global, require("./generator.js"), require("./solver.js"), require("./daily.js"));
}

const STATS_GRID_WEEKS = 12;
const STATS_MASTERY_NEED = 10; // no-hint solves to master a technique
const STATS_TIERS = [1, 2, 3, 4, 5, 6];

function statsBlankDay() { return { free: 0, level: 0, daily: 0, hints: 0, started: 0 }; }

/**
 * Add to the day's activity (returns a new log). With { started: true} it only
 * counts an attempt; otherwise it counts one solve of `mode` plus its hints.
 */
function recordActivity(log, key, mode, hintsUsed, opts) {
  const out = Object.assign({}, log);
  const day = Object.assign(statsBlankDay(), out[key]);
  if (opts && opts.started) day.started++;
  else {
    day[mode] = (day[mode] || 0) + 1;
    day.hints += hintsUsed || 0;
  }
  out[key] = day;
  return out;
}

function statsDaySolves(d) { return d ? (d.free || 0) + (d.level || 0) + (d.daily || 0) : 0; }

/**
 * Days in a row with any solve. current ends today, or yesterday while today
 * is still unsolved; best is the longest run ever.
 */
function overallStreak(log, todayKey) {
  log = log || {};
  const solved = (k) => statsDaySolves(log[k]) > 0;
  let k = solved(todayKey) ? todayKey : addDays(todayKey, -1);
  let current = 0;
  while (solved(k)) { current++; k = addDays(k, -1); }
  let best = 0, run = 0, prev = null;
  for (const d of Object.keys(log).filter(solved).sort()) {
    run = prev && addDays(prev, 1) === d ? run + 1 : 1;
    if (run > best) best = run;
    prev = d;
  }
  return { current: current, best: best };
}

/** Old free stats gain hintsUsed:0 per tier; every existing field is kept. */
function migrateFreeStats(old) {
  const out = {};
  for (const t of Object.keys(old || {})) {
    out[t] = Object.assign({}, old[t]);
    if (typeof out[t].hintsUsed !== "number") out[t].hintsUsed = 0;
  }
  return out;
}

/** Progress per distinct technique (3, 4, 6): no-hint level solves, need 10. */
function masteredTechniques(levelsProgress) {
  const out = [];
  const seen = {};
  STATS_TIERS.forEach((t) => { seen[TIERS[t].technique] = true; });
  Object.keys(seen).map(Number).sort((a, b) => a - b).forEach((tech) => {
    let done = 0;
    STATS_TIERS.forEach((t) => {
      if (TIERS[t].technique !== tech) return;
      const tp = (levelsProgress && levelsProgress[t]) || {};
      for (const n of Object.keys(tp)) if (tp[n] && tp[n].noHint === true) done++;
    });
    out.push({ tier: tech, name: TECHNIQUE_NAMES[tech], done: done, need: STATS_MASTERY_NEED,
               mastered: done >= STATS_MASTERY_NEED });
  });
  return out;
}

/**
 * The last 12 weeks, column-major (a column per week, Monday first, ending on
 * today's week) like daily.js's activityGrid: 84 cells { key, status } with
 * status "daily" (the day had a daily solve), "other" (any other solve) or "none".
 */
function statsGrid(log, todayKey) {
  const today = parseKey(todayKey);
  let k = addDays(addDays(todayKey, -((today.getDay() + 6) % 7)), -(STATS_GRID_WEEKS - 1) * 7);
  const cells = [];
  for (let i = 0; i < STATS_GRID_WEEKS * 7; i++, k = addDays(k, 1)) {
    const d = log[k];
    cells.push({ key: k, status: d && d.daily > 0 ? "daily" : statsDaySolves(d) > 0 ? "other" : "none" });
  }
  return cells;
}

/**
 * Everything the stats screen shows. finishedPct = (free won + levels solved +
 * dailies solved) / games started in the log, rounded. Attempts never fall below
 * solves, so solves saved before attempts were logged cannot push it past 100.
 */
function allStats(src, todayKey) {
  const freeStats = (src && src.freeStats) || {};
  const levels = (src && src.levels) || {};
  const daily = (src && src.daily) || {};
  const log = (src && src.activity) || {};

  const byTier = STATS_TIERS.map((t) => ({ tier: t, solved: 0, bestMs: 0, avgMs: 0, sumMs: 0 }));
  const at = (t) => byTier[t - 1];
  const addTime = (b, ms) => { b.solved++; b.sumMs += ms || 0; if (ms && (!b.bestMs || ms < b.bestMs)) b.bestMs = ms; };

  let freeWon = 0, levelsSolved = 0, dailiesSolved = 0, perfect = 0;
  for (const t of STATS_TIERS) {
    const f = freeStats[t];
    if (f && f.won) {
      freeWon += f.won;
      const b = at(t);
      b.solved += f.won; b.sumMs += f.sumMs || 0;
      if (f.bestMs && (!b.bestMs || f.bestMs < b.bestMs)) b.bestMs = f.bestMs;
    }
    const tp = levels[t] || {};
    for (const n of Object.keys(tp)) {
      levelsSolved++;
      if (tp[n].stars === 3) perfect++;
      addTime(at(t), tp[n].bestMs);
    }
  }
  for (const k of Object.keys(daily)) {
    dailiesSolved++;
    if (daily[k].stars === 3) perfect++;
    addTime(at(dailyTier(k)), daily[k].bestMs);
  }

  let started = 0, logSolves = 0, hints = 0;
  for (const k of Object.keys(log)) {
    started += log[k].started || 0;
    logSolves += statsDaySolves(log[k]);
    hints += log[k].hints || 0;
  }
  const solved = freeWon + levelsSolved + dailiesSolved;
  const attempts = Math.max(started, solved);
  byTier.forEach((b) => { b.avgMs = b.solved ? Math.round(b.sumMs / b.solved) : 0; delete b.sumMs; });

  return {
    streak: overallStreak(log, todayKey),
    solved: solved,
    finishedPct: attempts ? Math.round(solved / attempts * 100) : 0,
    perfect: perfect,
    hintsPerGame: logSolves ? Math.round(hints / logSolves * 10) / 10 : 0,
    grid: statsGrid(log, todayKey),
    byTier: byTier,
  };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    STATS_MASTERY_NEED,
    recordActivity, overallStreak, migrateFreeStats, masteredTechniques, allStats,
  };
}
