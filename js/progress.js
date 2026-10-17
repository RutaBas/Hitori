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
 * Returns a new object, or null when there is nothing resumable. Never mutates `s`.
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

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    LEVELS_PER_BATCH, SECTION_SIZE, LINGER_MOVES,
    computeStars, mergeResult, isUnlocked, nextPlayable, tierSummary,
    newMistakeTracker, trackMove, flagMistake, migrateSave,
  };
}
