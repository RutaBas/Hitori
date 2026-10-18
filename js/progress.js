/* progress.js — level-pack rules: stars, unlocking, merging results, the
 * lingering-mistake tracker, and the in-progress save shape (migrateSave).
 *
 * Pure and headless (no DOM, no storage). Dual-use: browser <script> globals,
 * node require (see generator.js / hints.js).
 *
 * A tier's progress is { "1": {stars, bestMs, noHint}, ... }; a level is solved
 * iff it has an entry.
 *
 * Mistake rule: a cell whose mark disagrees with the solution (SHADED where the
 * solution leaves it lit, CIRCLED where it shades it) counts once per wrong
 * episode, either after staying wrong through LINGER_MOVES further moves or when
 * a hint points at it (flagMistake). Fixing the cell ends the episode.
 */

const LEVELS_PER_BATCH = 100;
const SECTION_SIZE = 25;
const LINGER_MOVES = 3;

/** 1 star solved, +1 no hints, +1 no mistakes. */
function computeStars(hintsUsed, mistakes) {
  return 1 + (hintsUsed === 0 ? 1 : 0) + (mistakes === 0 ? 1 : 0);
}

/** Replays never make things worse; noHint is sticky-true. */
function mergeResult(old, stars, ms, noHint) {
  if (!old) return { stars: stars, bestMs: ms, noHint: !!noHint };
  return {
    stars: Math.max(old.stars || 0, stars),
    bestMs: old.bestMs ? Math.min(old.bestMs, ms) : ms,
    noHint: !!(old.noHint || noHint),
  };
}

/** Level 1 is always open; level n opens once level n-1 is solved. */
function isUnlocked(tierProgress, n) {
  return n === 1 || !!(tierProgress && tierProgress[n - 1]);
}

/** Lowest unsolved unlocked level, or null when all are solved. */
function nextPlayable(tierProgress, count) {
  for (let n = 1; n <= count; n++) {
    if (isUnlocked(tierProgress, n) && !(tierProgress && tierProgress[n])) return n;
  }
  return null;
}

function tierSummary(tierProgress, count) {
  const out = { solved: 0, stars: 0, maxStars: count * 3, starCounts: { 1: 0, 2: 0, 3: 0 }, bestMs: null };
  if (!tierProgress) return out;
  for (let n = 1; n <= count; n++) {
    const r = tierProgress[n];
    if (!r) continue;
    out.solved++;
    out.stars += r.stars || 0;
    if (out.starCounts[r.stars] !== undefined) out.starCounts[r.stars]++;
    if (r.bestMs && (out.bestMs === null || r.bestMs < out.bestMs)) out.bestMs = r.bestMs;
  }
  return out;
}

/** Plain JSON so it can live in the save. wrongSince/counted are keyed by cell index. */
function newMistakeTracker() {
  return { move: 0, wrongSince: {}, counted: {}, mistakes: 0 };
}

function isWrongMark(mark, solutionCell) {
  return (mark === 1 && !solutionCell) || (mark === 2 && !!solutionCell);
}

/** Call after every board change. */
function trackMove(tracker, state, solution) {
  tracker.move++;
  for (let i = 0; i < state.length; i++) {
    if (isWrongMark(state[i], solution[i])) {
      if (tracker.wrongSince[i] === undefined) tracker.wrongSince[i] = tracker.move;
      if (!tracker.counted[i] && tracker.move - tracker.wrongSince[i] >= LINGER_MOVES) {
        tracker.counted[i] = true;
        tracker.mistakes++;
      }
    } else {
      delete tracker.wrongSince[i];
      delete tracker.counted[i];
    }
  }
  return tracker;
}

/** A hint pointed at cell i: counts if it is currently wrong and not yet counted. */
function flagMistake(tracker, i) {
  if (tracker.wrongSince[i] !== undefined && !tracker.counted[i]) {
    tracker.counted[i] = true;
    tracker.mistakes++;
  }
  return tracker;
}

/*
 * The in-progress save (hitori.saveState), one shape for all three modes:
 *   { mode: "free" | "level" | "daily", tier: 1..6, N, numbers, solution, state,
 *     elapsedMs, moves, hintsUsed, tracker, level?, dailyKey?, startedKey?, savedAt }
 * migrateSave upgrades a pre-update save ({ tierIndex, tierName, N, numbers, solution,
 * state, elapsedMs, moves, savedAt }, always free play) and fills missing counters.
 * Returns a new object, or null when there is nothing resumable (including a daily save
 * without a "YYYY-MM-DD" dailyKey, or a level save without a positive whole `level`).
 * Never mutates `s`.
 */
const SAVE_MODES = { free: true, level: true, daily: true };

function migrateSave(s) {
  if (!s || typeof s !== "object") return null;
  const out = Object.assign({}, s);
  if (out.mode === undefined) out.mode = "free";
  if (out.tier === undefined && out.tierIndex !== undefined) out.tier = out.tierIndex;
  delete out.tierIndex;
  delete out.tierName; // the name comes from TIERS[tier]
  if (!SAVE_MODES[out.mode]) return null;
  if (out.mode === "daily" && !(typeof out.dailyKey === "string" && /^\d{4}-\d{2}-\d{2}$/.test(out.dailyKey))) return null;
  if (out.mode === "level" && !(Number.isInteger(out.level) && out.level > 0)) return null;
  if (!(out.tier >= 1 && out.tier <= 6) || !out.N ||
      !Array.isArray(out.numbers) || !Array.isArray(out.solution) || !Array.isArray(out.state)) return null;
  const cells = out.N * out.N;
  if (out.numbers.length !== cells || out.solution.length !== cells || out.state.length !== cells) return null;
  if (typeof out.elapsedMs !== "number") out.elapsedMs = 0;
  if (typeof out.moves !== "number") out.moves = 0;
  if (typeof out.hintsUsed !== "number") out.hintsUsed = 0;
  if (!out.tracker || typeof out.tracker !== "object") out.tracker = newMistakeTracker();
  return out;
}

/*
 * The tutorial's lessons (the UI is renderTutorial in ui.js). Each lesson is a tiny board:
 *   N, numbers   the digits, row-major
 *   givens       pre-set marks, one char per cell: "." unmarked, "S" shaded, "O" circled.
 *                Given cells are locked.
 *   answer       the finished board: "S" must be shaded, "O" must be circled, "." must
 *                stay lit (unmarked or circled — a circle on a lit cell is never wrong)
 *   task         the line under the board (what to do now); wrong = the delayed
 *                "not quite" line for the anticipated mistake; done = the line once
 *                it's solved
 *   trap         (rule lessons) the cells whose shading is the anticipated mistake:
 *                `wrong` is shown only when every off-answer mark is one of these,
 *                shaded; any other mistake gets TUTORIAL_WRONG_GENERIC
 *   steps        (lesson 1 only) marks to reach in order, each matched exactly, with its
 *                own task line; the last one is the answer. Off a step, the only
 *                possible mistake is a mark on another cell, which `wrong` names.
 * text may hold <b>; everything else is plain text.
 */
const TUTORIAL_LESSONS = [
  {
    title: "Tap to mark",
    text: "Each tap changes a cell. <b>Once</b> shades it dark. <b>Twice</b> circles it: " +
      "your note that it stays lit. <b>Three times</b> clears it again.",
    N: 3,
    numbers: [1, 2, 3,
              2, 3, 1,
              3, 1, 2],
    givens: ".........",
    answer: ".........",
    task: "Tap the middle 3 to shade it.",
    steps: [
      { marks: "....S....", task: "Tap the middle 3 to shade it." },
      { marks: "....O....", task: "Now tap it again to circle it." },
      { marks: ".........", task: "Tap once more to clear it." },
    ],
    wrong: "That's a different cell. Tap it until it's clear, then go back to the middle 3.",
    done: "Nice. That's the whole cycle: shade, circle, clear.",
  },
  {
    title: "Rule 1: no repeats",
    text: "No number may repeat among the <b>lit</b> cells of a row or column. " +
      "Shading a cell takes its number out of both.",
    N: 3,
    numbers: [1, 2, 3,
              2, 3, 1,
              3, 1, 1],
    givens: ".........",
    answer: "........S",
    task: "The bottom row and the right column each have two lit 1s. Shade one 1 to fix both.",
    trap: [5, 7],        // a 1 that fixes only the column or only the row
    wrong: "That still leaves two lit 1s in a line. Try the 1 where the row and column meet.",
    done: "Nice. One shade, two lines fixed.",
  },
  {
    title: "Rule 2: no touching",
    text: "Shaded cells <b>can't touch side by side</b>. Touching at the corners is fine. " +
      "The 3 at the top is already shaded.",
    N: 4,
    numbers: [1, 2, 3, 4,
              2, 3, 3, 1,
              3, 4, 1, 2,
              4, 1, 2, 3],
    givens: "..S.............",
    answer: "..S..S..........",
    task: "The second row has two 3s. Shade the one that doesn't touch the shaded cell.",
    trap: [6],           // the 3 right below the given shade
    wrong: "Not quite: those two shaded cells touch side by side. Shade the other 3.",
    done: "Nice. Diagonal neighbours are fine.",
  },
  {
    title: "Rule 3: stay connected",
    text: "All the lit cells must <b>stay connected</b> in one piece, through their sides. " +
      "Shade the wrong cell and you can wall a lit cell in. The 1 below the corner is already shaded.",
    N: 4,
    numbers: [1, 4, 3, 4,
              1, 3, 4, 1,
              3, 4, 1, 2,
              4, 1, 2, 3],
    givens: "....S...........",
    answer: "...SS....S......",
    task: "Fix the two 4s in the top row and the two in the second column, without walling in the corner 1.",
    trap: [1],           // the 4 beside the corner 1, walling it in
    wrong: "Not quite: the corner 1 needs a lit neighbour to stay connected. Leave the 4 beside it lit.",
    done: "That's all three rules. Every puzzle has one answer, reachable by logic alone.",
  },
];

/** The "not quite" line for a mistake the lesson's own line doesn't describe. */
const TUTORIAL_WRONG_GENERIC = "That cell isn't part of the answer — tap it until it's clear.";

/**
 * Where a lesson stands after a tap. marks: the board's marks (0 unmarked, 1 shaded,
 * 2 circled). step: the lesson-1 step being worked on (ignored for other lessons).
 * Returns { step, solved, wrong, trap } — wrong = a move off the answer (the UI waits a
 * moment before it says "not quite"); trap = that mistake is the lesson's anticipated one
 * (see tutorialWrongLine).
 */
function tutorialProgress(lesson, step, marks) {
  const CODE = { ".": 0, S: 1, O: 2 };
  const same = (s) => s.split("").every((ch, i) => marks[i] === CODE[ch]);
  if (lesson.steps) {
    const s = step || 0;
    if (s >= lesson.steps.length) return { step: s, solved: true, wrong: false };
    if (same(lesson.steps[s].marks)) {
      return { step: s + 1, solved: s + 1 === lesson.steps.length, wrong: false, trap: false };
    }
    const prev = s === 0 ? lesson.givens : lesson.steps[s - 1].marks;
    const off = !same(prev);
    return { step: s, solved: false, wrong: off, trap: off };
  }
  let solved = true, wrong = false, trap = true;
  const traps = lesson.trap || [];
  for (let i = 0; i < lesson.answer.length; i++) {
    const want = lesson.answer[i], m = marks[i];
    let bad = false;
    if (want === "S") {
      if (m !== 1) solved = false;
      if (m === 2) bad = true;
    } else {
      if (m === 1) { bad = true; solved = false; }
      if (want === "O" && m !== 2) solved = false;
    }
    if (bad) {
      wrong = true;
      if (!(m === 1 && traps.indexOf(i) >= 0)) trap = false;
    }
  }
  return { step: step || 0, solved: solved && !wrong, wrong: wrong, trap: wrong && trap };
}

/** The "not quite" line for a tutorialProgress result: "" when nothing is wrong. */
function tutorialWrongLine(lesson, r) {
  if (!r || !r.wrong) return "";
  return r.trap ? lesson.wrong : TUTORIAL_WRONG_GENERIC;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    LEVELS_PER_BATCH, SECTION_SIZE, LINGER_MOVES,
    computeStars, mergeResult, isUnlocked, nextPlayable, tierSummary,
    newMistakeTracker, trackMove, flagMistake, migrateSave,
    TUTORIAL_LESSONS, TUTORIAL_WRONG_GENERIC, tutorialProgress, tutorialWrongLine,
  };
}
