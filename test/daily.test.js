/*
 * daily.test.js — daily puzzle: dates, tier rotation, puzzle, streaks, calendar, stats.
 * Run with: node test/daily.test.js
 */
const path = require("path");
const D = require(path.join(__dirname, "..", "js", "daily.js"));
const G = require(path.join(__dirname, "..", "js", "generator.js"));

let pass = 0, fail = 0;
function check(label, cond) {
  console.log((cond ? "  ok  " : " FAIL ") + label);
  cond ? pass++ : fail++;
}

console.log("Daily 1: dates");
check("epoch is 2026-10-17", D.DAILY_EPOCH === "2026-10-17");
check("dateKey uses local day, zero-padded", D.dateKey(new Date(2026, 9, 8, 23, 59)) === "2026-10-08");
check("dateKey pads month and day", D.dateKey(new Date(2027, 0, 5)) === "2027-01-05");
check("month boundary", D.addDays("2026-10-31", 1) === "2026-11-01");
check("year boundary", D.addDays("2026-12-31", 1) === "2027-01-01");
check("leap day", D.addDays("2028-03-01", -1) === "2028-02-29");
check("DST weekends", D.addDays("2026-10-25", 1) === "2026-10-26" && D.addDays("2026-03-29", 1) === "2026-03-30" &&
  D.addDays("2026-03-08", 1) === "2026-03-09" && D.addDays("2026-11-01", 1) === "2026-11-02");
check("dayIndex counts from the epoch", D.dayIndex(D.DAILY_EPOCH) === 0 && D.dayIndex("2026-10-18") === 1 && D.dayIndex("2027-10-17") === 365);
{
  let exact = true;
  for (let i = 0, k = D.DAILY_EPOCH; i < 400; i++, k = D.addDays(k, 1)) if (D.dayIndex(k) !== i) exact = false;
  check("dayIndex exact across 400 consecutive days (incl. DST)", exact);
}

console.log("Daily 2: tier rotation and puzzle");
check("DAILY_TIERS is [3,4,5,6]", JSON.stringify(D.DAILY_TIERS) === "[3,4,5,6]");
check("tiers rotate 3,4,5,6 from the epoch",
  D.dailyTier("2026-10-17") === 3 && D.dailyTier("2026-10-18") === 4 &&
  D.dailyTier("2026-10-19") === 5 && D.dailyTier("2026-10-20") === 6 && D.dailyTier("2026-10-21") === 3);
check("tier before the epoch still rotates", D.dailyTier("2026-10-16") === 6);
{
  const a = D.dailyPuzzle("2026-10-19"), b = D.dailyPuzzle("2026-10-19");
  check("puzzle carries tier and N", a.tier === 5 && a.N === 9 && a.numbers.length === 81 && a.solution.length === 81);
  check("same date -> same puzzle", JSON.stringify(a.numbers) === JSON.stringify(b.numbers) &&
    JSON.stringify(a.solution) === JSON.stringify(b.solution));
  check("different dates (same tier) -> different puzzles",
    JSON.stringify(a.numbers) !== JSON.stringify(D.dailyPuzzle("2026-10-23").numbers));

  const seen = new Set();
  let valid = true, tiersOk = true;
  for (let i = 0, k = D.DAILY_EPOCH; i < 30; i++, k = D.addDays(k, 1)) {
    const p = D.dailyPuzzle(k);
    const c = G.classify(p.numbers, p.N);
    if (!c.unique || !(c.tier <= 6)) valid = false;
    if (p.tier !== D.dailyTier(k)) tiersOk = false;
    seen.add(p.N + ":" + Array.from(p.numbers).join(","));
  }
  check("30 consecutive dailies each unique-solution and need tier <= T6", valid);
  check("30 consecutive dailies carry the rotating tier", tiersOk);
  check("30 consecutive dailies are all distinct", seen.size === 30);
}

console.log("Daily 3: records and streaks");
{
  let rec = {};
  rec = D.recordDaily(rec, "2026-10-17", true, 3, 90000);
  check("on-time solve recorded", rec["2026-10-17"].onTime && rec["2026-10-17"].stars === 3);
  rec = D.recordDaily(rec, "2026-10-17", false, 1, 200000);
  check("worse replay keeps onTime, stars, best time",
    rec["2026-10-17"].onTime && rec["2026-10-17"].stars === 3 && rec["2026-10-17"].bestMs === 90000);
  rec = D.recordDaily(rec, "2026-10-17", false, 3, 50000);
  check("faster replay lowers best time", rec["2026-10-17"].bestMs === 50000);
  check("late first solve is not on time", D.recordDaily({}, "2026-10-17", false, 2, 1)["2026-10-17"].onTime === false);
  const orig = {};
  D.recordDaily(orig, "2026-10-17", true, 1, 1);
  check("recordDaily does not mutate its input", Object.keys(orig).length === 0);

  const r = {
    "2026-10-17": { stars: 3, bestMs: 1, onTime: true },
    "2026-10-18": { stars: 3, bestMs: 1, onTime: true },
    "2026-10-19": { stars: 3, bestMs: 1, onTime: true },
    "2026-10-21": { stars: 3, bestMs: 1, onTime: true },
    "2026-10-22": { stars: 3, bestMs: 1, onTime: true },
    "2026-10-20": { stars: 3, bestMs: 1, onTime: false },
  };
  check("late solve does not bridge the gap", D.currentStreak(r, "2026-10-22") === 2);
  check("unsolved today does not break the streak", D.currentStreak(r, "2026-10-23") === 2);
  check("a fully missed day breaks it", D.currentStreak(r, "2026-10-24") === 0);
  check("best streak is the longest on-time run", D.bestStreak(r) === 3);
  check("empty records", D.currentStreak({}, "2026-10-22") === 0 && D.bestStreak({}) === 0);
  const across = { "2026-10-31": { onTime: true, stars: 1, bestMs: 1 }, "2026-11-01": { onTime: true, stars: 1, bestMs: 1 } };
  check("streaks cross month ends", D.currentStreak(across, "2026-11-01") === 2 && D.bestStreak(across) === 2);

  // Review Focus 2: started 11-02, won 11-03 -> counts on time for 11-02.
  const dailyKey = "2026-11-02", startedKey = "2026-11-02";
  const fin = D.recordDaily({}, dailyKey, startedKey === dailyKey, 3, 60000);
  check("game started on its own day but won the next day records onTime for that day",
    fin["2026-11-02"].onTime === true && !fin["2026-11-03"] && D.currentStreak(fin, "2026-11-03") === 1);
}

console.log("Daily 4: calendar");
{
  const g = D.monthGrid(2026, 9); // Oct 2026 starts on Thursday
  check("grid is whole weeks", g.length % 7 === 0);
  check("Monday-first: Oct 1 2026 under Thu", g[0] === null && g[1] === null && g[2] === null && g[3] === "2026-10-01");
  check("all 31 days in order", g.filter(Boolean).length === 31 && g.filter(Boolean)[30] === "2026-10-31");
  const feb = D.monthGrid(2027, 1);
  check("Feb 2027 starts on Monday, 28 days", feb.filter(Boolean).length === 28 && feb[0] === "2027-02-01");
}

console.log("Daily 5: stats");
{
  // tiers by day: 10-17 T3, 10-18 T4, 10-19 T5, 10-20 T6, 10-21 T3
  const r = {
    "2026-10-17": { stars: 3, bestMs: 200000, onTime: true },
    "2026-10-18": { stars: 2, bestMs: 400000, onTime: true },
    "2026-10-19": { stars: 3, bestMs: 600000, onTime: false },
    "2026-10-21": { stars: 1, bestMs: 100000, onTime: true },
  };
  const s = D.dailyStats(r, "2026-10-22");
  check("totals", s.solved === 4 && s.onTimePct === 75 && s.perfect === 2);
  check("current and best streak", s.current === 1 && s.best === 2);
  check("bySize keyed by tier: T3 count/best/avg", s.bySize[3].solved === 2 && s.bySize[3].bestMs === 100000 && s.bySize[3].avgMs === 150000);
  check("T4 and T5 and T6", s.bySize[4].solved === 1 && s.bySize[5].solved === 1 && s.bySize[5].bestMs === 600000 && s.bySize[6].solved === 0);
  check("star breakdown", s.stars[3] === 2 && s.stars[2] === 1 && s.stars[1] === 1);
  const e = D.dailyStats({}, "2026-10-22");
  check("empty records give zeros", e.solved === 0 && e.onTimePct === 0 && e.bySize[3].bestMs === 0 && e.bySize[3].avgMs === 0);

  check("STREAK_MILESTONES", JSON.stringify(D.STREAK_MILESTONES) === "[3,7,30,100]");
  const ms = D.streakMilestones(12, 21);
  check("milestones", JSON.stringify(ms.map((m) => [m.days, m.done, m.toGo])) ===
    JSON.stringify([[3, true, 0], [7, true, 0], [30, false, 18], [100, false, null]]));

  const hm = D.activityGrid(r, "2026-10-22", 12);
  check("12 weeks x 7 days", hm.length === 84);
  check("last column is this week, Monday first", hm[77].key === "2026-10-19" && hm[83].key === "2026-10-25");
  check("solved on the day -> on", hm[77 - 7 + 5].key === "2026-10-17" && hm[77 - 7 + 5].status === "on");
  check("solved later -> late", hm[77].status === "late");
  check("after today -> future", hm[82].status === "future");
  check("before epoch -> before", hm[0].status === "before");
  check("unsolved past day -> missed", hm[77 + 1].status === "missed");
}

console.log("\ndaily.test.js: " + pass + " passed, " + fail + " failed");
if (fail) process.exit(1);
