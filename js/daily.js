/* daily.js — daily puzzle rules: which puzzle a date gets, records, streaks,
 * stats and the calendar grid.
 *
 * Pure and headless (no DOM, no storage). Dual-use: browser <script> globals,
 * node require (see progress.js / generator.js). Ported from TicTacLogic.
 *
 * Days are LOCAL calendar days, keyed "YYYY-MM-DD". There is no server: the
 * puzzle is generated on the device from the date, so everyone on the same
 * version gets the same board each day.
 *
 * Records: { "2026-10-17": { stars, bestMs, onTime } }. onTime = the attempt
 * was started on the puzzle's own day; only on-time days build a streak.
 * Callers pass onTime as (game.startedKey === dailyKey), so a game started on
 * its day and won after midnight still counts.
 */
if (typeof module !== "undefined") {
  Object.assign(global, require("./generator.js"));
}

const DAILY_EPOCH = "2026-10-17"; // day 0 of the daily, and the calendar's first day
const DAILY_TIERS = [3, 4, 5, 6]; // ladder tier, rotating by day

const DAILY_DAY_MS = 86400000;
const DAILY_MAX_TRIES = 10;       // the date's seed plus 9 retries, then give up

function dailyPad2(n) { return (n < 10 ? "0" : "") + n; }

/** Local calendar day of a Date, as "YYYY-MM-DD". */
function dateKey(d) {
  return d.getFullYear() + "-" + dailyPad2(d.getMonth() + 1) + "-" + dailyPad2(d.getDate());
}

/** Local midnight of a key. */
function parseKey(key) {
  const p = key.split("-");
  return new Date(+p[0], +p[1] - 1, +p[2]);
}

/** key shifted by n calendar days (setDate handles months, years, DST). */
function addDays(key, n) {
  const d = parseKey(key);
  d.setDate(d.getDate() + n);
  return dateKey(d);
}

/** Days since DAILY_EPOCH. Rounded, because a DST day is 23 or 25 hours long. */
function dayIndex(key) {
  return Math.round((parseKey(key) - parseKey(DAILY_EPOCH)) / DAILY_DAY_MS);
}

/** The day's ladder tier: 3, 4, 5, 6, 3, ... from the epoch. */
function dailyTier(key) {
  const n = DAILY_TIERS.length;
  return DAILY_TIERS[((dayIndex(key) % n) + n) % n];
}

/**
 * The day's puzzle, seeded by the date: { tier, N, numbers, solution }.
 * If generateTier ever fails for the date's seed, retry deterministically with
 * seeds hashString("daily-" + key + "-retry-" + k), k = 1, 2, ... so every
 * device still gets the same board. After DAILY_MAX_TRIES failures it returns
 * null (the UI says that daily won't open).
 */
function dailyPuzzle(key) {
  const tier = dailyTier(key);
  let p = generateTier(tier, { rand: mulberry32(hashString("daily-" + key)) });
  for (let k = 1; (!p || p.failed) && k < DAILY_MAX_TRIES; k++) {
    p = generateTier(tier, { rand: mulberry32(hashString("daily-" + key + "-retry-" + k)) });
  }
  if (!p || p.failed) return null;
  return { tier: tier, N: p.N, numbers: p.numbers, solution: p.solution };
}

/**
 * Merge a solve into the records (returns a new object). Once on time, always
 * on time; replays only raise stars and only lower the best time.
 */
function recordDaily(records, key, onTime, stars, ms) {
  const out = Object.assign({}, records);
  const old = out[key];
  out[key] = old
    ? { stars: Math.max(old.stars || 0, stars), bestMs: old.bestMs ? Math.min(old.bestMs, ms) : ms,
        onTime: !!old.onTime || !!onTime }
    : { stars: stars, bestMs: ms, onTime: !!onTime };
  return out;
}

function solvedOnTime(records, key) {
  return !!(records[key] && records[key].onTime);
}

/** On-time days in a row ending today — or yesterday, while today is still open. */
function currentStreak(records, todayKey) {
  let k = solvedOnTime(records, todayKey) ? todayKey : addDays(todayKey, -1);
  let n = 0;
  while (solvedOnTime(records, k)) { n++; k = addDays(k, -1); }
  return n;
}

function bestStreak(records) {
  const keys = Object.keys(records).filter((k) => solvedOnTime(records, k)).sort();
  let best = 0, run = 0, prev = null;
  for (const k of keys) {
    run = prev && addDays(prev, 1) === k ? run + 1 : 1;
    if (run > best) best = run;
    prev = k;
  }
  return best;
}

/** Monday-first month grid: keys for the month's days, null for blank cells. */
function monthGrid(year, month0) {
  const first = new Date(year, month0, 1);
  const lead = (first.getDay() + 6) % 7; // Mon=0 .. Sun=6
  const days = new Date(year, month0 + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < lead; i++) cells.push(null);
  for (let d = 1; d <= days; d++) cells.push(dateKey(new Date(year, month0, d)));
  while (cells.length % 7) cells.push(null);
  return cells;
}

/* ---- stats screen: everything is derived from the records ---- */

const STREAK_MILESTONES = [3, 7, 30, 100];

/** Totals, streaks, per-tier times and the star breakdown. Times are each day's best. */
function dailyStats(records, todayKey) {
  const keys = Object.keys(records);
  const bySize = {};
  DAILY_TIERS.forEach((t) => { bySize[t] = { solved: 0, bestMs: 0, avgMs: 0, sumMs: 0 }; });
  const stars = { 1: 0, 2: 0, 3: 0 };
  let onTime = 0;
  for (const k of keys) {
    const r = records[k];
    if (r.onTime) onTime++;
    stars[r.stars] = (stars[r.stars] || 0) + 1;
    const b = bySize[dailyTier(k)];
    b.solved++;
    b.sumMs += r.bestMs;
    if (!b.bestMs || r.bestMs < b.bestMs) b.bestMs = r.bestMs;
  }
  DAILY_TIERS.forEach((t) => {
    const b = bySize[t];
    b.avgMs = b.solved ? Math.round(b.sumMs / b.solved) : 0;
    delete b.sumMs;
  });
  return {
    solved: keys.length,
    onTimePct: keys.length ? Math.round(onTime / keys.length * 100) : 0,
    perfect: stars[3],
    current: currentStreak(records, todayKey),
    best: bestStreak(records),
    bySize: bySize,
    stars: stars,
  };
}

/** Milestones are earned by the best streak; only the next unearned one counts down. */
function streakMilestones(current, best) {
  let nextShown = false;
  return STREAK_MILESTONES.map((days) => {
    const done = best >= days;
    let toGo = done ? 0 : null;
    if (!done && !nextShown) { toGo = days - current; nextShown = true; }
    return { days: days, done: done, toGo: toGo };
  });
}

/**
 * The last `weeks` weeks ending with the current one, column-major (one
 * column per week, Monday first) for a GitHub-style grid. Each cell is
 * { key, status }: "on" | "late" | "missed" | "future" | "before".
 */
function activityGrid(records, todayKey, weeks) {
  const today = parseKey(todayKey);
  const monday = addDays(todayKey, -((today.getDay() + 6) % 7));
  let k = addDays(monday, -(weeks - 1) * 7);
  const cells = [];
  for (let i = 0; i < weeks * 7; i++, k = addDays(k, 1)) {
    const r = records[k];
    let status;
    if (k > todayKey) status = "future";
    else if (k < DAILY_EPOCH) status = "before";
    else if (r) status = r.onTime ? "on" : "late";
    else status = "missed";
    cells.push({ key: k, status: status });
  }
  return cells;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    DAILY_EPOCH, DAILY_TIERS, DAILY_MAX_TRIES, STREAK_MILESTONES,
    dateKey, parseKey, addDays, dayIndex, dailyTier, dailyPuzzle,
    recordDaily, currentStreak, bestStreak, monthGrid,
    dailyStats, streakMilestones, activityGrid,
  };
}
