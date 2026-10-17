# Hitori Update Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Hitori a real home screen, explained hints, 600 levels, a daily puzzle, all-mode stats, pause, a tutorial, rules and settings, matching TicTacLogic's depth in Hitori's own look.

**Architecture:** All new logic lives in small headless modules (`explain`, `hints`, `progress`, `daily`, `stats`, `levels`), each tested with plain `node`, loaded as globals in the browser like the existing `rules/board/solver/generator`. Levels are frozen data built once by `tools/build-levels.js`. `js/ui.js` (one IIFE, as today, and as in TicTacLogic) gains the screens and wires the modules together.

**Tech Stack:** Vanilla HTML/CSS/JS, no build step; `node` for tests and the level build tool; `localStorage`; service-worker PWA.

**Spec:** `docs/superpowers/specs/2026-10-17-hitori-update-design.md`. Read it before any task. **Reference game:** `C:\Users\Ruta\ClaudeCode\Games\TicTacLogic` (`ui.js`, `daily.js`, `progress.js`, `tools/build-levels.js`). Copy its behaviour, never its look.

## Global Constraints

- No frameworks, no bundler, no npm dependencies. Tests are `node test/<name>.test.js`, and each test file ends by printing `N passed, M failed` and calling `process.exit(fail ? 1 : 0)` (the same `check(label, cond)` helper as `test/solver.test.js`).
- Every module uses the dual-use pattern of `js/solver.js`: top-level declarations become browser globals; `if (typeof module !== "undefined") module.exports = {...}`; node-only `require`s are pulled onto `global` the way `solver.js` does. **Top-level names must be unique across all `js/*.js` files**, because plain `<script>` tags share one global scope.
- Game logic modules never touch the DOM or `localStorage`. Only `js/ui.js` does.
- Visuals use only `css/tokens.css` variables. `--violation` is for rule violations only. No dark-mode toggle.
- Every puzzle shipped or generated must be uniquely solvable at tier ≤ T6 (as `classify` checks today).
- Level *n* of a tier must always map to the same puzzle forever (append-only batches of 100).
- Storage keys: `hitori.settings`, `hitori.stats`, `hitori.saveState` (existing), plus new `hitori.levels`, `hitori.daily`, `hitori.dailyCache`, `hitori.activity`, `hitori.tutorialDone`, `hitori.techSeen`. Existing players' data is migrated, never wiped.
- Paused time never counts. Restart asks for confirmation.
- Bump `CACHE_NAME` in `sw.js` and add every new `js/*.js` to `SHELL` and `index.html` (load order: rules, board, solver, generator, explain, hints, progress, levels, daily, stats, ui).
- Work on branch `feature/hitori-update`. The working tree already holds the user's own staged deletions and an `sw.js` edit; **commit only the files a task names** (`git add <paths>`, never `git add -A`). Before the first commit, ask the user whether to commit their pending changes separately first.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **An old save (no `mode` field)** from today's version must resume as a free-play game with its timer and marks intact. Test in Task 9.
2. **Midnight while playing a daily:** the puzzle stays the one it started as, and `onTime` follows `startedKey`, not the clock at the moment of winning. Test in Task 7.
3. **Hint on a board with a wrong mark that breaks no rule yet** (e.g. a circled cell that the solution shades): the hint must explain that mark, not deduce from a bad state. Test in Task 4.
4. **The walk-through is open when the player taps the board, presses Pause, or the app is hidden:** ghost marks vanish, real marks are untouched, and ghosts are never saved. Test in Task 11 (browser check plus a pure helper test).
5. **A 10×10 board at 320 px wide, and a 100-level grid:** the board fits with no horizontal scroll, and the grid scrolls to the pinned button with no empty band. Checked in Tasks 10 and 12.

---

### Task 1: Seeds and compact puzzle strings

**Files:**
- Modify: `js/generator.js` (add helpers; export them)
- Test: `test/generator.test.js` (new)

**Interfaces:**
- Produces: `hashString(str: string) -> uint32` (same algorithm as TicTacLogic `generator.js:42`); `encodeNumbers(numbers: ArrayLike<number>) -> string` (one base-36 char per cell, so 10 → `"a"`); `decodeNumbers(str: string) -> Int8Array`; `generateTier(tier, { rand })` already accepts `rand` via `opts`, so it must stay that way.

- [ ] **Step 1: Write the failing tests:** `hashString("daily-2026-10-17")` is stable across two calls and differs from `hashString("daily-2026-10-18")`; `decodeNumbers(encodeNumbers(x))` round-trips a 10×10 grid that contains a 10; `generateTier(6, { rand: mulberry32(hashString("x")) })` twice gives identical `numbers`.
- [ ] **Step 2: Run** `node test/generator.test.js`. Expected: FAIL (`hashString is not a function`).
- [ ] **Step 3: Implement** the three helpers in `js/generator.js` and add them to `module.exports`.
- [ ] **Step 4: Run** `node test/generator.test.js && node test/solver.test.js`. Expected: both report `0 failed`.
- [ ] **Step 5: Commit** `js/generator.js test/generator.test.js`, with message "Add seeded hashing and compact puzzle strings".

### Task 2: Explained deductions T1–T4 and clash detection

**Files:**
- Create: `js/explain.js`
- Test: `test/explain.test.js`

The existing `applyT*` functions stay untouched; they grade puzzles. `explain.js` re-derives deductions **with evidence**, and tests prove it agrees with the solver.

**Interfaces:**
- Consumes: `SolveCell`, `linesOf`, `neighborsOf`, `deduce` from `js/solver.js`.
- Produces:
  ```
  Explanation = { i, value /* SolveCell.WHITE|BLACK */, tier /* 1..6 */, technique /* TECHNIQUE_NAMES[tier] */,
                  rule, evidence: number[], short: string, text: string,
                  chain?: Explanation[], clash?: Clash }
  Clash = { rule: "duplicate"|"touching"|"split"|"stranded", cells: number[], text: string }
  explainTier(cells: Int8Array, numbers, N, tier: 1..4) -> Explanation[]   // every deduction of that tier available now
  findClash(cells, numbers, N) -> Clash|null                               // first rule violation in a partial state
  cellName(i, N) -> "row 3, column 5"                                       // 1-based, used in all text
  ```
  Rule ids: T1 `triple-middle`, `triple-outer`, `sandwich`, `pair-elsewhere`; T2 `neighbour-of-shaded`, `duplicate-of-lit`; T3 `lifeline`; T4 `cut-off`.
  - `findClash` treats UNKNOWN as possibly lit:
    - `duplicate`: two WHITE cells with the same number in a line
    - `touching`: two orthogonally adjacent BLACK cells
    - `stranded`: a WHITE cell with no non-black neighbour while other WHITE cells exist
    - `split`: WHITE cells not connected through non-black cells

  Text follows the spec's examples (spec §2). `short` is the stage-1 pointer ("Look at row 3: the two 4s side by side.").

- [ ] **Step 1: Write the failing tests:**
  - One hand-made fixture per rule id (boards of 3–5 cells per side). Each asserts that `explainTier` contains an entry with that `rule`, the expected `i`, the expected `value`, and the expected sorted `evidence`.
  - One fixture per clash rule for `findClash`.
  - **Soundness:** for 30 puzzles per tier (seeded, `generateTier`), walk the cheapest-first solve. At every intermediate state, every `explainTier(state, …, t)` entry for t = 1..4 has `value === solution[i] ? BLACK : WHITE`, and each tier's set of target cells equals the cells that `applyT<t>` changes on a copy of the same state.
- [ ] **Step 2: Run** `node test/explain.test.js`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement** `explainTier`, `findClash` and `cellName` in `js/explain.js`.
- [ ] **Step 4: Run** `node test/explain.test.js`. Expected: `0 failed`.
- [ ] **Step 5: Commit** `js/explain.js test/explain.test.js`, with message "Explain T1–T4 deductions with evidence".

### Task 3: Traced chains for T5/T6 and shortest-chain choice

**Files:**
- Modify: `js/explain.js`
- Test: `test/explain.test.js` (extend)

**Interfaces:**
- Produces:
  ```
  traceDeduce(cells, numbers, N, maxTier: 1..5) -> { steps: Explanation[], clash: Clash|null }
      // mutates cells; one deduction at a time, cheapest tier first, first entry of that tier
  explainTier(cells, numbers, N, 5|6) -> Explanation[]   // now also handles tiers 5 and 6
  ```
  - T6 entry: `rule: "contradiction"`. `chain[0]` is the assumption record (`rule: "assume"`, the cell, and the assumed value), followed by the traced `steps`. `clash` is the clash that ends it. `value` is the opposite of the assumption. `text` is the summary sentence ("Suppose this were shaded. That leads to a clash (rule 2: two shaded cells touch), so it stays lit.").
  - T5 entry: `rule: "both-ways"`. `chain` holds both branches' steps up to the cell they agree on.
  - Every step inside a chain carries its own `text` (inner T3/T4 too).

- [ ] **Step 1: Write the failing tests:**
  - On 30 Secluded and 30 Solitary puzzles, every T6 entry has a non-null `clash`. Replaying `chain` onto a copy of the state reproduces that clash with `findClash`. Every chain step has non-empty `text`. The value is sound against the solution.
  - On a fixture with two T6 deductions of different chain lengths, `pickShortest(entries)` returns the shorter one.
- [ ] **Step 2: Run** the tests. Expected: FAIL.
- [ ] **Step 3: Implement** `traceDeduce`, tier 5/6 support in `explainTier`, and `pickShortest(entries: Explanation[], lastTap: number|null, N) -> Explanation` (shortest `chain.length`, then nearest to `lastTap`, then lowest `i`).
- [ ] **Step 4: Run** the tests. Expected: `0 failed`.
- [ ] **Step 5: Commit** with message "Trace T5/T6 chains for walk-through hints".

### Task 4: Hint selection and explained mistakes

**Files:**
- Create: `js/hints.js`
- Test: `test/hints.test.js`

**Interfaces:**
- Consumes: `explainTier`, `findClash`, `pickShortest`, `cellName` (Tasks 2–3); `CellState` (board.js).
- Produces:
  ```
  stateToCells(state: Int8Array /*CellState*/) -> Int8Array /*SolveCell*/   // SHADED→BLACK, CIRCLED→WHITE
  nextHint(state, numbers, N, solution /*0/1 mask*/, lastTap: number|null) ->
      { kind: "mistake", i, cells: number[], text }
    | { kind: "deduction", exp: Explanation }
    | { kind: "stuck", i, text }
    | { kind: "done" }
  distanceTo(exp, lastTap, N) -> number   // min Manhattan distance from lastTap to exp.i ∪ exp.evidence; 0 if lastTap null
  ```
  - Order: (1) `findClash` on the player's marks gives a rule-break mistake (text names the rule; `cells` = the clash cells). (2) Otherwise the earliest mark that disagrees with `solution` gives a mistake ("This cell can't be shaded. The puzzle can't be finished with it dark." or the lit equivalent). (3) Otherwise, at the cheapest tier with entries, pick the nearest to `lastTap` (tie: lowest `i`); at tier 6, use `pickShortest`. (4) `stuck` reveals a correct cell, worded honestly. (5) `done` when the board matches the solution.

- [ ] **Step 1: Write the failing tests:**
  - **Review Focus 3:** a circled cell that the solution shades, with no rule broken, gives `kind:"mistake"` at that cell.
  - Two touching shaded cells give `kind:"mistake"` with both cells in `cells`.
  - Of two available T2 deductions, the one nearer `lastTap` is chosen.
  - **Replay:** for 100 puzzles per tier, starting from an empty board and applying each hint's `exp.value` until `done` solves the puzzle in fewer than N² + 1 hints, and every deduction hint has non-empty `text` and `evidence` (or `chain`).
  - **Timing:** on the hardest-scoring Solitary puzzle of the replay set, the slowest single `nextHint` call is under 150 ms. Print the measured value.
- [ ] **Step 2: Run** `node test/hints.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement** `js/hints.js`. If the timing assertion fails, cache T6 entries per board state (keyed by the encoded cells) inside `nextHint`.
- [ ] **Step 4: Run** the tests. Expected: `0 failed`, with the timing printed.
- [ ] **Step 5: Commit** `js/hints.js test/hints.test.js`, with message "Choose hints near the last move and explain mistakes".

### Task 5: Stars, unlocks and the mistake tracker

**Files:**
- Create: `js/progress.js`
- Test: `test/progress.test.js`

**Interfaces:**
- Produces:
  ```
  LEVELS_PER_BATCH = 100; SECTION_SIZE = 25; LINGER_MOVES = 3
  computeStars(hintsUsed, mistakes) -> 1..3                    // 1 + (hints===0) + (mistakes===0)
  mergeResult(old|null, stars, ms, noHint) -> { stars, bestMs, noHint }   // max stars, min ms, noHint sticky-true
  isUnlocked(tierProgress, n) -> bool                          // n===1 || tierProgress[n-1]
  nextPlayable(tierProgress, count) -> n|null                  // lowest unsolved unlocked level
  tierSummary(tierProgress, count) -> { solved, stars, maxStars, starCounts:{1,2,3}, bestMs }
  newMistakeTracker() -> { move:0, wrongSince:{}, counted:{}, mistakes:0 }
  trackMove(tracker, state, solution) -> tracker   // call after every board change
  flagMistake(tracker, i) -> tracker               // a hint pointed at cell i
  ```
  Mistake rule (spec §3): a cell whose mark disagrees with the solution counts once per wrong episode, either when it has stayed wrong through `LINGER_MOVES` further moves or when `flagMistake` fires. Fixing the cell ends the episode. The tracker is plain JSON so it can live in the save.

- [ ] **Step 1: Write the failing tests:**
  - wrong, then fixed on the next move → 0 mistakes
  - wrong and left for 3 moves → 1
  - still wrong after 10 moves → still 1
  - flagged by a hint, then left → 1
  - the same cell wrong again later → 2
  - `mergeResult` never lowers stars or raises `bestMs`
  - `isUnlocked` and `nextPlayable` on a progress map with gaps
- [ ] **Step 2: Run** the tests. Expected: FAIL.
- [ ] **Step 3: Implement** `js/progress.js`.
- [ ] **Step 4: Run** the tests. Expected: `0 failed`.
- [ ] **Step 5: Commit** with message "Add level progress and the lingering-mistake tracker".

### Task 6: Level build tool and the first 600 levels

**Files:**
- Create: `tools/build-levels.js`, `js/levels.js` (generated)
- Test: `test/levels.test.js`

**Interfaces:**
- Consumes: `generateTier`, `mulberry32`, `hashString`, `encodeNumbers`, `decodeNumbers`, `TIERS` (generator.js); `deduce`, `classify` (solver/generator); `LEVELS_PER_BATCH` (progress.js).
- Produces:
  - `js/levels.js` contains `const LEVELS_VERSION = 1; const LEVELS = { 1: [string…], …, 6: [string…] };` (100 × batches per tier, encoded numbers, level 1 first), plus `levelCount(tier) -> number` and `levelNumbers(tier, n) -> Int8Array`.
  - `tools/build-levels.js` exports `scorePuzzle(numbers, N, topTier) -> { topSteps, opening }`:
    - `topSteps` = number of `deduce` steps credited to `topTier` in a cheapest-first solve. Instrument by running `deduce` one step at a time, or by counting in a local copy of its loop.
    - `opening` = number of cells decided by tiers 1–2 alone from the empty board.

    It also exports `buildBatch(tier, batch, existing: Set<string>) -> string[]`.

**Build algorithm (per tier, per new batch b):**
1. Candidate c is seeded by `mulberry32(hashString("level-" + tier + "-batch-" + b + "-cand-" + c))`, for c = 0, 1, … Generate with `generateTier(tier, { rand })` and keep it if it hasn't failed, `classify` says unique with tier === `TIERS[tier].technique`, and the encoded string is not already in `existing` or this batch. Stop at 400 accepted candidates.
2. Sort by `topSteps` asc, then `opening` desc, then string asc. Take indices `round(k × 399 / 99)` for k = 0..99.
3. Usage: `node tools/build-levels.js --batches 1`. It reads the current `js/levels.js` if present, **keeps existing batches byte-for-byte**, builds only missing batches, and writes the file with a header comment explaining how to add batches.

- [ ] **Step 1: Write the failing tests** in `test/levels.test.js`:
  - `levelCount(t)` is a multiple of 100 and ≥ 100 for t = 1..6.
  - Every level decodes to N² numbers, `classify` is unique, and its tier equals `TIERS[t].technique`.
  - No duplicate strings across all levels.
  - Within each batch, `topSteps` never decreases more than it increases. Concretely: Spearman correlation between level index and `topSteps` is ≥ 0.8.
  - **Fingerprint:** a hash of each tier's batch-1 strings equals the committed constant `BATCH1_FINGERPRINTS[t]` in the test file.
- [ ] **Step 2: Time one tier first.** Run `node tools/build-levels.js --batches 1 --tier 6 --dry-run` and report the time to the user before the full build.
- [ ] **Step 3: Implement and run** `node tools/build-levels.js --batches 1` (run in the background if it's over 2 minutes). Run it a second time and confirm with `git diff --stat js/levels.js` that the file is unchanged (determinism).
- [ ] **Step 4: Fill** `BATCH1_FINGERPRINTS` from the built file, then run `node test/levels.test.js`. Expected: `0 failed`.
- [ ] **Step 5: Extensibility check (do not commit):** run with `--batches 2 --tier 1`, confirm tier 1's first 100 strings are unchanged and the fingerprint test still passes, then `git checkout js/levels.js`.
- [ ] **Step 6: Commit** `tools/build-levels.js js/levels.js test/levels.test.js`, with message "Build 600 frozen levels with an in-tier difficulty ramp".

### Task 7: Daily puzzle logic

**Files:**
- Create: `js/daily.js`
- Test: `test/daily.test.js`

**Interfaces:**
- Port from TicTacLogic `daily.js` (same names, same behaviour): `dateKey`, `parseKey`, `addDays`, `dayIndex`, `recordDaily`, `currentStreak`, `bestStreak`, `monthGrid`, `dailyStats`, `streakMilestones`, `activityGrid`, `STREAK_MILESTONES = [3, 7, 30, 100]`.
- Hitori-specific:
  - `DAILY_EPOCH` = the date this task is implemented, as `YYYY-MM-DD`
  - `DAILY_TIERS = [3, 4, 5, 6]`
  - `dailyTier(key) -> tier`
  - `dailyPuzzle(key) -> { tier, N, numbers, solution }` via `generateTier(dailyTier(key), { rand: mulberry32(hashString("daily-" + key)) })`
  - `dailyStats` reports `bySize` keyed by tier
  - `recordDaily(records, key, onTime, stars, ms)` keeps the TicTacLogic semantics: `onTime` is sticky-true, stars only rise, time only falls

- [ ] **Step 1: Write the failing tests** (port TicTacLogic's `tests/daily.test.js`, adapted):
  - The same key gives the same puzzle.
  - Tiers rotate 3, 4, 5, 6 from the epoch.
  - 30 consecutive dailies are unique and need tier ≤ T6.
  - Date math holds across month, year and DST boundaries.
  - Streak rules: gaps break, late solves don't count, today unsolved doesn't break, and best streak is correct.
  - `monthGrid` is Monday-first.
  - **Review Focus 2:** a game with `startedKey = "2026-11-02"` won on 2026-11-03 records `onTime` for 2026-11-02, via `recordDaily(r, dailyKey, startedKey === dailyKey, …)`.
- [ ] **Step 2: Run** the tests. Expected: FAIL.
- [ ] **Step 3: Implement** `js/daily.js`.
- [ ] **Step 4: Run** the tests. Expected: `0 failed`.
- [ ] **Step 5: Commit** with message "Add the daily puzzle, streaks and calendar logic".

### Task 8: Stats across all modes

**Files:**
- Create: `js/stats.js`
- Test: `test/stats.test.js`

**Interfaces:**
- Produces:
  ```
  recordActivity(log, key, mode /* "free"|"level"|"daily" */, hintsUsed) -> log
      // log = { "YYYY-MM-DD": { free, level, daily, hints } }  (counts of solves + total hints)
  overallStreak(log, todayKey) -> { current, best }   // a day counts if it has any solve; today unsolved doesn't break it
  migrateFreeStats(old) -> stats                        // adds hintsUsed:0 per tier; keeps every existing field
  masteredTechniques(levelsProgress) -> [{ tier: 3|4|6, name, done: count, need: 10, mastered: bool }]
      // counts levels with noHint === true in tiers whose TIERS[t].technique === tier
  allStats({ freeStats, levels, daily, activity }, todayKey) ->
      { streak, solved, finishedPct, perfect, hintsPerGame, grid /* 84 cells: none|daily|other */, byTier: [{ tier, solved, bestMs, avgMs }] }
  ```
  `finishedPct` = (free won + levels solved + dailies solved) ÷ (free played + level attempts + daily attempts), rounded. To support it, `recordActivity` also accepts a `started` call: `recordActivity(log, key, mode, 0, { started: true })` increments `log[key].started`.

- [ ] **Step 1: Write the failing tests:**
  - streaks across modes: a level on Mon and a daily on Tue give a current streak of 2
  - `migrateFreeStats` keeps `bestMs`
  - `masteredTechniques` counts only `noHint` solves
  - `allStats` on an empty input returns zeros and no NaN
  - `grid` length is 84
- [ ] **Step 2: Run** the tests. Expected: FAIL.
- [ ] **Step 3: Implement** `js/stats.js`.
- [ ] **Step 4: Run** the tests. Expected: `0 failed`.
- [ ] **Step 5: Commit** with message "Combine free, daily and level stats".

### Task 9: Home screen, footer overlays and save modes (UI)

**Files:**
- Modify: `index.html` (script tags, screen sections), `js/ui.js`, `css/styles.css`
- Create: `.claude/launch.json` with `{ "name": "hitori", "runtimeExecutable": "python", "runtimeArgs": ["-m", "http.server", "8731"], "port": 8731 }`

**Interfaces:**
- Consumes: everything above.
- Produces (inside `ui.js`):
  - `showScreen(name)` generalised to any `section.screen` with id `screen-<name>`
  - `showOverlay(html)` / `hideOverlay()`
  - `startGame(cfg)` with `cfg = { mode, tier, N, numbers, solution, level?, dailyKey?, startedKey? }`, the single entry point that all three modes use
  - the save shape `{ mode, tier, N, numbers, solution, state, elapsedMs, moves, hintsUsed, tracker, level?, dailyKey?, startedKey?, savedAt }`
  - `migrateSave(s)`: missing `mode` → `"free"`, `tierIndex` → `tier`

- [ ] **Step 1: Write the failing test** `test/save.test.js` for a pure `migrateSave` (put it in `js/progress.js` so node can test it). **Review Focus 1:** today's save shape `{ tierIndex: 4, tierName, N: 8, numbers, solution, state, elapsedMs: 61000, moves: 9 }` migrates to `mode: "free"`, `tier: 4`, the same state and elapsedMs, `hintsUsed: 0`, and a fresh tracker.
- [ ] **Step 2: Run** it. Expected: FAIL. **Step 3: Implement** `migrateSave` and run it. Expected: `0 failed`.
- [ ] **Step 4: Build the home screen** in the order of spec §1 Home: Continue (mode-aware subtitle), Daily card, first-run Learn card (`hitori.tutorialDone`), Levels card, free-play tiers, footer. Footer **Rules** and **Settings** open overlays with the spec's content; Settings includes the app version read from caches (`/^hitori-v(\d+)$/`). The in-game menu reuses the same settings rows.
- [ ] **Step 5: Verify in the browser** (`preview_start hitori`): at 390×844, the home order matches the spec and the skyline is visible. Plant an old-format save in `localStorage` and check that Continue resumes it. Settings toggles persist across a reload.
- [ ] **Step 6: Commit** the named files, with message "Add the new home screen, rules, settings and save modes".

### Task 10: Game screen layout v2, Pause, auto-pause, confirm Restart (UI)

**Files:** Modify `index.html`, `js/ui.js`, `css/styles.css`

- [ ] **Step 1: Re-lay out** the play screen as a full-height flex column:
  - HUD: `‹ Home`, title, timer, ⋯ menu
  - sub-row: stars in play, moves
  - flexible board zone with the board centred
  - fixed-height hint box (min 86 px), showing the three rules when idle
  - thumb row **Undo · Hint · Pause**

  `sizeBoard()` fits the board to the zone's width and height (smaller of the two), on load and on `resize`.
- [ ] **Step 2: Add** `pauseGame()` / `resumeGame()` with TicTacLogic semantics: stop the timer, hide the board (`.is-paused` blurs or hides the cells), save, and show an overlay with the time, **Resume** and Home. Paused time is excluded via `baseMs`. Auto-pause on `visibilitychange` (hidden) and `pagehide`. Restart opens a confirm overlay.
- [ ] **Step 3: Verify in the browser:**
  - Pause for 5 s, resume, and the timer has not advanced.
  - Switching tabs auto-pauses.
  - **Review Focus 5:** on Solitary at 320×640, the whole 10×10 board is visible with no horizontal scroll; at 390×844 the buttons sit at the bottom.
- [ ] **Step 4: Commit** with message "Rebalance the game screen and add Pause".

### Task 11: Three-stage hints and the walk-through (UI)

**Files:** Modify `js/ui.js`, `css/styles.css`; pure helper in `js/hints.js` + `test/hints.test.js`

**Interfaces:**
- Pure: `walkFrames(exp: Explanation) -> [{ ghosts: { i: value }, focus: number[], text }]`. Frame 0 is the assumption, each following frame adds one step, and the last frame shows the clash cells. It is used by the UI and tested in node.

- [ ] **Step 1: Write the failing test.** For a T6 explanation, `walkFrames` length = `chain.length + 1`, ghosts accumulate, and the last frame's `focus` equals `clash.cells`.
- [ ] **Step 2: Implement** `walkFrames`. Run the tests. Expected: `0 failed`.
- [ ] **Step 3: Wire the UI:**
  - Hint press 1 shows `exp.short` and outlines `evidence` (solid).
  - Press 2 adds the dashed target and `exp.text`. For T5/T6, a "walk me through it" link opens Next/Back stepping over `walkFrames`, drawn as ghost marks on a separate layer. The real `App.board.state` is never written, and closing restores the view.
  - Press 3 applies the move.
  - Any board tap resets the stage. Every press increments `hintsUsed`. A mistake hint calls `flagMistake`.
  - `trackMove` runs after every tap and undo.
  - Pass `App.lastTap` to `nextHint`.
- [ ] **Step 4: Verify in the browser** (**Review Focus 4**): open a walk-through on a Secluded puzzle, then tap the board, then reopen and press Pause, then reopen and switch tabs. Each time, the ghosts are gone, the real marks are unchanged, and after a reload the save has no ghosts. Hints on a fresh Crowded board point near the last tap.
- [ ] **Step 5: Commit** with message "Explain hints in three stages with a chain walk-through".

### Task 12: Levels screens, level play and the technique intro (UI)

**Files:** Modify `index.html`, `js/ui.js`, `css/styles.css`

- [ ] **Step 1: Build the Levels overview:** six tier cards with solved/count, stars/(3×count), technique, and a progress bar.
- [ ] **Step 2: Build the tier grid screen** (spec §1, "A tier's levels"):
  - summary card
  - a scrolling grid of 5 per row in sections of 25, with section star totals, built from `levelCount(t)` so new batches appear automatically
  - solved, next and locked states
  - a pinned **Play level N** button (`nextPlayable`); when the tier is fully solved it reads **Replay level 1**
  - re-entering a level already in progress resumes it
- [ ] **Step 3: Add level play and the win card.** `startGame({ mode: "level", … })`, HUD title `Hushed · Level 23`. On win: `computeStars` → `mergeResult` into `hitori.levels`, `recordActivity`, then a win card with stars revealed one by one, the time, and **Next level** (hidden on the last level) · **Replay** · **Levels**. Level games never touch `hitori.stats`.
- [ ] **Step 4: Add the technique intro.** Before the first level of a tier whose technique isn't yet in `hitori.techSeen`, show a one-time card explaining it, using the same text family as `explain.js` (export a `TECHNIQUE_INTROS` map from `explain.js`).
- [ ] **Step 5: Verify in the browser** (**Review Focus 5**): the Hushed grid at 390×844 scrolls to the pinned button with no empty band; solving level 1 unlocks level 2 and shows stars; the intro shows once.
- [ ] **Step 6: Commit** with message "Add level packs, level play and technique intros".

### Task 13: Daily screen, daily play and share (UI)

**Files:** Modify `index.html`, `js/ui.js`, `css/styles.css`

- [ ] **Step 1: Build the Daily screen** like TicTacLogic's: today's button, streaks, Monday-first calendar with paging bounded by `DAILY_EPOCH` and this month, four day-cell states, and a link to Stats → Daily.
- [ ] **Step 2: Add daily play.** Show a brief "building tonight's puzzle…" overlay, then `dailyPuzzle(key)`, cached in `hitori.dailyCache` as `{ key, numbers, solution }`. Start with `startGame({ mode: "daily", dailyKey, startedKey: dateKey(new Date()) })`. Re-opening the day that's already in progress resumes it instead of restarting it.
- [ ] **Step 3: Add the daily win card:** stars, time, streak. **Share** copies `Hitori Daily · Sat 17 Oct · 9×9 · 3:41 · ★★★ 🔥4` + newline + the existing emoji grid. Buttons: **Calendar**, **Home**. On win, call `recordDaily` and `recordActivity`.
- [ ] **Step 4: Verify in the browser.** Play today's daily. Check that the home card flips to "solved ✓ · new one tomorrow", the calendar marks today, and a past day is playable but doesn't change the streak.
- [ ] **Step 5: Commit** with message "Add the daily puzzle screens".

### Task 14: Stats screen (UI)

**Files:** Modify `index.html`, `js/ui.js`, `css/styles.css`

- [ ] **Step 1: Build the Stats screen** (`‹ Home`, tabs **All · Free · Daily · Levels**), rendering exactly the content listed in spec §1 Stats from `allStats`, `migrateFreeStats`, `dailyStats`/`streakMilestones`/`activityGrid`, and `tierSummary`/`masteredTechniques`. Show "—" for an empty time, never "NaN" or "0:00".
- [ ] **Step 2: Make free play record activity.** Free-play wins and starts call `recordActivity`; hints in free play add to `hintsUsed` in `hitori.stats`.
- [ ] **Step 3: Verify in the browser.** With empty storage, every tab renders without errors. After one free, one level and one daily win on the same day, the All tab shows solved 3 and a streak of 1.
- [ ] **Step 4: Commit** with message "Add the all-modes Stats screen".

### Task 15: Tutorial (UI)

**Files:** Modify `js/ui.js`, `css/styles.css`; lesson data as `TUTORIAL_LESSONS` in `js/progress.js` (pure data, testable)

- [ ] **Step 1: Write the failing test.** Every lesson in `TUTORIAL_LESSONS` (4 lessons: marking, rule 1, rule 2, rule 3) has an `answer` that is valid under `rules.js` for its tiny board, and its `givens` are consistent with the answer.
- [ ] **Step 2: Implement the lesson data.** Run the test. Expected: `0 failed`.
- [ ] **Step 3: Build the tutorial screen** like TicTacLogic's `renderTutorial`:
  - progress dots, Back/Next, and a skip link
  - the player must make the move before Next enables
  - a delayed "not quite" message after a wrong move
  - the last lesson's button is **Play a Crowded 5×5**

  Finishing or skipping sets `hitori.tutorialDone`. The Rules overlay has a **Tutorial** button.
- [ ] **Step 4: Verify in the browser.** Run a first-run walkthrough from the home card through to a Crowded game; afterwards the Learn card is gone.
- [ ] **Step 5: Commit** with message "Add the interactive tutorial".

### Task 16: PWA, README and full check

**Files:** Modify `sw.js`, `index.html`, `README.md`

- [ ] **Step 1: Update the PWA files.** Add `js/explain.js, js/hints.js, js/progress.js, js/levels.js, js/daily.js, js/stats.js` to `SHELL`, bump `CACHE_NAME` to `hitori-v2`, and confirm the script order in `index.html`.
- [ ] **Step 2: Update the README:** features, architecture table (new modules), tests list, and "Adding levels: `node tools/build-levels.js --batches 2`".
- [ ] **Step 3: Run every suite:** `for f in test/*.test.js; do node "$f" || exit 1; done`. Expected: every file reports `0 failed`.
- [ ] **Step 4: Verify in the browser.** Go offline after the first load, reload, and check that home, a level, the daily and stats all work. Settings shows `v2`.
- [ ] **Step 5: Commit** with message "Cache the new modules and document the update".
