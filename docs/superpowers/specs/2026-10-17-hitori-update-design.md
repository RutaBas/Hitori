# Hitori Update — Design

**Date:** 2026-10-17 · **Status:** design agreed with the user in chat; builder review done (one open question, answered); awaiting the user's review of this document

## Why

Hitori was the user's first puzzle game. They have since brought a sibling game,
**TicTacLogic** (`C:\Users\Ruta\ClaudeCode\Games\TicTacLogic`), up to a fuller standard: a
daily puzzle, level packs, detailed statistics, a tutorial, and pause. Today Hitori's home
screen is only the six free-play tiers. Settings exist but only inside the in-game menu.
Stats are recorded but only shown as a best time. There are no rules or tutorial in the app,
and no pause. The goal is to give Hitori the same depth and polish as TicTacLogic while
keeping Hitori's own identity: the night-city skyline, the sodium-lamp palette, and the
Solitude difficulty ladder.

TicTacLogic is the **reference implementation** for behaviour and structure. Where this
document says "like TicTacLogic", read that project's `ui.js`, `daily.js`, `progress.js`,
`tools/build-levels.js` and its two specs in `docs/superpowers/specs/`. Copy the behaviour,
not the look: Hitori keeps its own design tokens (`css/tokens.css`).

## Goals

1. A real home screen with Continue, Daily, Learn to play (first run), Levels, the free-play tiers, and a footer for How to play · Rules · Stats · Settings.
2. **Levels:** 100 fixed levels for each of the six tiers (600 total), with a smooth easy → hard climb inside each tier. They must be easy to extend later.
3. **Daily puzzle** with streak, calendar, and share.
4. **Statistics** covering all play (free, daily, levels), not just the daily.
5. **Hints that explain the next logical move.** No more random-feeling "this cell must be shaded".
6. **Pause** during play.
7. **Tutorial and Rules** inside the app, and **Settings** reachable from home.

## Non-goals

- No accounts, backend, cloud sync, or leaderboards. Everything stays in `localStorage`.
- No framework or build step. The app stays vanilla HTML/CSS/JS, and the level-building tool runs in `node`.
- No change to the six-tier Solitude ladder (names, sizes, technique bands) or the free-play generator's behaviour.
- No dark-mode toggle. Hitori is always the night city.
- No visual redesign. New screens use the existing tokens, fonts, and skyline.

## Anti-goals (would count as failure even if it "works")

- A hint that names a cell without saying **why**, or that jumps to a cell unrelated to what the player is doing.
- Adding levels later shifts existing level numbers or invalidates saved stars.
- Any level, daily, or free-play puzzle that is not uniquely solvable by logic alone (beyond T6).
- Dead space at the bottom of the level grid screen (see Screens).
- Paused time counting on the clock.

---

## 1. Screens

Mockups were reviewed with the user in `.superpowers/brainstorm/…/content/`
(`screens-overview.html`, `screens-v2.html`). They show layout and are not pixel specs.

### Home (top to bottom)
1. **Wordmark** (existing).
2. **Continue card**, only when a save exists. Shows mode + tier + size + elapsed time, e.g. `Hushed · Level 23 · 8×8 · 4:12` or `Daily · Sat 17 Oct · 9×9 · 2:05`.
3. **Daily card** with a tear-off calendar tile (month and day), `Daily puzzle`, `Sat 17 Oct · 9×9 · 🔥 4`. When today is solved: `solved ✓ · new one tomorrow`.
4. **"New here? Learn to play"** card. First run only, until the tutorial is finished or skipped.
5. **Levels card**: solid sodium background, ★ badge, `87 / 600 solved · ★ 214`, a progress bar.
6. Section label **Free play**, then the six tiers as today (name, size, best time).
7. **Footer** links: How to play · Rules · Stats · Settings.

The skyline stays behind everything, as today.

### Levels overview
`‹ Home` and the title "Levels". There are six cards, one per tier. Each shows the tier name and size, `solved / 100`, `★ n / 300`, the technique it needs, and a progress bar. All six tiers are open from the start.

### A tier's levels
- Top: `‹ Levels`, title `Hushed · 8×8`. A summary card shows `22 / 100 solved`, `★ 58 of 300`, the technique needed, and a progress bar.
- A **scrolling** grid of level buttons, 5 per row, in sections of 25 (`Levels 1–25`, with the section's star total). States:
  - solved: number plus stars (★/☆)
  - next playable: outlined in sodium
  - locked: dark with a lock glyph, not tappable
- The grid runs to the bottom edge and fades out (no empty space).
- **Pinned primary button at the bottom:** `Play level 23 · next up`. It plays the lowest unsolved unlocked level. When the whole tier is solved, it becomes `Replay level 100` or is hidden; builder's choice.
- Tap targets are at least 44 px.

### Playing (layout "v2", chosen by the user)
A full-height column:
1. **HUD:** `‹ Home`, title (`Hushed · Level 23`, `Daily · Sat 17 Oct`, or the tier name for free play), timer. A sub-row shows `☆☆☆ in play` (levels and daily only) and the move count.
2. **Board**, centred in the flexible middle and sized to fill the space available. Size it on load and on resize, like TicTacLogic's `applyBoardSizing`.
3. **Hint box**, fixed height so the board never jumps. With no hint open, it shows the three rules as a quiet reminder.
4. **Thumb row:** **Undo · Hint · Pause**, bigger buttons.

The existing ⋯ menu (Restart, New puzzle, Quit, settings toggles) stays reachable. Put it in the HUD.

### Pause
Like TicTacLogic's `pauseGame` / `resumeGame`:
- Pause stops the timer and **hides the board** (no solving while paused).
- An overlay shows `Paused`, the time so far, **Resume**, and a Home link.
- Paused time never counts.
- **Auto-pause** when the app is hidden (`visibilitychange` / `pagehide`). Save at that moment.
- **Restart asks for confirmation.**

### Win cards
- **Level:** the existing win animation, then a card with the 3 stars revealed one by one (earned ones lit), the time, and **Next level** (primary; hidden on the last level of a tier), **Replay**, **Levels**.
- **Daily:** stars, time, and streak. **Share** copies `Hitori Daily · Sat 17 Oct · 9×9 · 3:41 · ★★★ 🔥4` plus the existing emoji grid. Buttons: **Calendar**, **Home**.
- **Free play:** as today.

### Daily screen
Like TicTacLogic:
- today's button
- current and best streak
- a Monday-first month calendar with paging (no earlier than the epoch month, no later than this month)
- day cells: solved on the day / solved later / missed but playable / future (greyed)
- a link to **Stats → Daily**

### Stats screen
`‹ Home`, title, then tabs **All · Free · Daily · Levels**.
- **All:** a streak hero (🔥 current, best). Any puzzle solved in any mode counts for that day. Then totals (solved, % finished, ★★★ count, average hints per game), a **12-week activity grid** (daily vs. other play), a **by-tier table** (solved, best, average time), and **techniques mastered**.
- **Free:** the per-tier table from existing data (played, won, best, average, current and best streak).
- **Daily:** TicTacLogic's daily-stats content (streak hero, solved, % on the day, perfect count, 12-week grid, by-size table, star distribution, streak milestones).
- **Levels:** per tier: solved/100, stars/300, star distribution, best times.

"Techniques mastered" (the builder decides the exact rule): a technique counts as mastered after the player solves a set number of levels or puzzles that require it, *without a hint*.

### Tutorial and Rules
- **Tutorial:** like TicTacLogic's interactive lessons, on tiny boards (about 3×3 to 4×4), where the player must make the move to continue:
  1. tap to shade, tap again to circle, tap again to clear
  2. rule 1: no repeated number in a lit row or column
  3. rule 2: shaded cells never touch side by side
  4. rule 3: all lit cells stay connected

  Back/Next, a skip link, and progress dots. The last lesson's button is **Play a Crowded 5×5**. Finishing or skipping hides the home "Learn to play" card.
- **Rules:** a short overlay listing the three rules plus "every puzzle has one answer, reachable by logic alone", with a **Tutorial** button.

### Settings
Reachable from the home footer **and** the in-game menu:
- show rule violations (off by default, as today)
- sound
- haptics
- app version (read from the service-worker cache name, like TicTacLogic's `showAppVersion`)

---

## 2. Hints that explain (the most important change)

### The problem today
`hintNext` (`js/solver.js`) finds the cheapest technique tier that sets *some* cell, then returns the **first** changed cell in reading order. The UI shows `"<Technique>: this cell must be shaded."` The technique functions don't record *which cells caused* the move, so there is nothing to explain with. Mistake correction says only "this cell should be dark, not lit."

### What to build
**Every technique reports its reasoning.** Each deduction yields an explanation record:

```
{ i, value,                 // target cell and WHITE/BLACK
  tier, technique,          // 1..6 and friendly name
  rule,                     // a specific sub-rule id, e.g. "sandwich", "triple", "pair-elsewhere",
                            //   "neighbour-of-shaded", "duplicate-of-lit", "corner", "lifeline",
                            //   "cut-off", "chain", "contradiction"
  evidence: [cells],        // the cells that force it
  text }                    // one plain sentence: the WHY
```

Example sentences (the builder writes the final wording; tone is plain and friendly, and every sentence names the reason):
- *Sandwich:* "This cell sits between two 3s. If it were shaded, both 3s would have to stay lit (shaded cells can't touch), giving row 2 two lit 3s. So it stays lit."
- *Pair elsewhere:* "Row 3 has two 4s side by side. One of them must stay lit, so any other 4 in row 3 must be shaded."
- *Neighbour of shaded:* "This cell touches a shaded cell, and shaded cells can't touch, so it stays lit."
- *Duplicate of lit:* "There's already a lit 4 in this row, so this 4 must be shaded."
- *Lifeline (T3):* "This lit cell's only open neighbour is here. Shade it and the cell is cut off, so it stays lit."
- *Cut-off (T4):* "Shading this cell would split the lit cells in two (top-left from the rest), so it stays lit."
- *Contradiction (T6), decided with the user after review:* the builder review measured T6 chains at a median of 4 cells, 8 at the 90th percentile, and up to 25. So:
  - **Summary first.** Stage 2 gives one sentence: "Suppose this were shaded. That leads to a clash (rule 2: two shaded cells touch), so it stays lit." The cells on the path are highlighted, and the clash is named.
  - **"Walk me through it."** A link in the hint box steps through the chain **on the board**, one step per tap (Next / Back). Each step shows that cell as a ghost mark (not the player's real marks) with its own reason sentence, using the same per-technique explanation as a normal hint, including inner T3/T4/T5 steps. The last step shows the clash. Closing the walk-through restores the board exactly as it was.
  - **Prefer the shortest chain.** When the cheapest available tier is T6, list every T6 deduction and pick the one with the shortest chain. Use nearest-to-last-tap only to break ties between equal lengths. This replaces "first found" for T6 only.
  - T6 (and T5) must record the steps taken inside the lookahead, as an ordered list of explanation records, so the chain can be told.
- *T5 chains:* "Whether this cell is shaded or lit, [X] ends up lit, so [X] is lit."

**Choosing which deduction to show:**
1. Use the cheapest tier that has any deduction (as today).
2. Among that tier's deductions, prefer the one **nearest the player's last tap**. Measure distance to the target or evidence cells, and break ties by reading order.

**Three-stage hint (like TicTacLogic):**
1. **Nudge:** outline the evidence cells, plus a short pointer ("Look at row 3: the two 4s side by side.").
2. **Explain:** also mark the target cell (dashed outline) and show the full sentence.
3. **Do it:** pressing Hint again applies the move.

Moving on (any tap on the board) resets to stage 1 for the next hint. Every press of Hint counts as hint use, for stars.

**Mistakes first, explained.** If the board has a wrong mark, the hint explains what's wrong instead of just naming the cell:
- If a placed mark breaks a rule right now, name the rule and the cells: "These two shaded cells touch. Shaded cells can't be side by side."
- Otherwise, if a mark disagrees with the solution but breaks no rule yet, say so gently and point at the earliest such mark: "This cell can't be shaded. The puzzle can't be finished with it dark." There is no deduction chain to show here, and that's acceptable.

**Stuck fallback** (shouldn't happen, because every shipped puzzle is T6-solvable): keep the current reveal, worded honestly.

### Tests (headless, `node`)
- For every technique and sub-rule, a tiny fixture board where the hint returns that rule with the expected target and evidence cells.
- Nearest-to-last-tap selection picks the closer of two available deductions.
- On 100 generated puzzles per tier, repeatedly applying hints from an empty board solves the puzzle, and every hint has non-empty `text` and `evidence` (except stuck/mistake cases).
- Every T6 explanation chain ends in a named rule violation, and every step in it has its own reason. Replaying the chain's steps from the board state reproduces the clash.
- When two T6 deductions are available, the one with the shorter chain is chosen.
- Measure hint response time on a hard 10×10 position. Listing all T6 deductions must still feel instant on a phone (aim for under about 150 ms; if not, the builder may cache per board state).

---

## 3. Levels

### Structure
- Six **chapters**, one per existing tier (Crowded 5×5 … Solitary 10×10), with **100 levels each** to start.
- Levels unlock in order within a tier: solving level *n* unlocks *n + 1*. All tiers are open from the start.
- **Stars:** ★ solved, ★ no hints, ★ no mistakes. Replays only raise stars and only lower best times.

### The difficulty ramp inside a tier
Every level in a tier needs that tier's top technique (T3, T4 or T6, from `TIERS`), but the climb from level 1 to 100 comes from **how much** of the hard reasoning it needs:
- **Difficulty score**, from a cheapest-first solve (`deduce` already restarts at T1 after each step): the primary score is the **number of deduction steps that needed the tier's top technique**. Secondary: fewer cells decided by T1–T2 at the start means harder. Grid size is fixed per tier.
- The build tool generates a candidate pool much larger than 100 per tier, removes duplicates, sorts by score, and picks 100 **evenly spaced** candidates, so level 1 is the gentlest and level 100 the toughest. Ties are broken deterministically.
- **First-time technique card:** the first level whose tier needs a technique the player hasn't seen in levels yet (T3 at Crowded 1, T4 at Murmur 1, T6 at Secluded 1) opens with a one-time card explaining that technique, in the same words the hints use.

### Building the levels (frozen data, built once)
Like TicTacLogic's `tools/build-levels.js` → `levels.js`:
- `node tools/build-levels.js` writes `js/levels.js`. The game **never** generates levels at runtime.
- Seeds are deterministic: candidates are seeded by `hashString("level-" + tier + "-batch-" + b + "-cand-" + c)` (or similar). The output must be byte-identical across runs.
- The data stores only the number grids (compact strings). The solution comes from the solver at level start, which takes milliseconds.
- Validation, built in and also in tests: every level has exactly one solution, is solvable at depth ≤ T6, needs exactly its tier's technique, and is not a duplicate of any other level.
- **Timing:** the builder review measured `generateTier(5|6)` at about 10–20 ms in node, so even a large candidate pool is quick. The extra scoring work (counting steps, chain lengths) adds to that, so still time one tier before running the full build.

### Easy to extend later (user requirement)
- Levels are organised in **batches of 100 per tier** ("Volume 1", "Volume 2", …). Each batch has its **own** easy → hard ramp.
- **Adding a batch never changes existing levels.** The seeds include the batch number, the build appends, and level *n* always maps to the same puzzle. Do **not** re-sort across batches, because that would renumber levels and break saved progress.
- The build tool takes the number of batches per tier as a setting. The game reads the level count from the data, so the screens need no code changes when levels are added. In the tier grid, sections of 25 simply continue.
- Test: a committed fingerprint (e.g. a hash per batch) of Volume 1 must not change when later batches are added.

### Progress storage
`hitori.levels`: `{ "<tier>": { "<n>": { stars, bestMs } } }`. A level is solved if it has an entry. Level *n* is unlocked if *n* = 1 or level *n − 1* is solved. Keep the pure helpers in a headless module (like TicTacLogic's `progress.js`): `computeStars`, `mergeResult`, `isUnlocked`, plus summaries.

### "No mistakes" star (decided with the user)
Rule-violation warnings are off by default in Hitori, so they can't define a mistake. Instead:
- A mark that disagrees with the solution counts as **one mistake** if it is **still on the board after a few more moves** (builder picks the number; around 3), **or** if a hint has to point it out.
- A quick wrong tap that is undone or changed right away doesn't count.
- Restart resets the attempt's hint and mistake counts.

---

## 4. Daily puzzle
Like TicTacLogic's daily (see its spec):
- One puzzle per local calendar day, generated on the device from a seed of the date: `generateTier(tier, { rand: mulberry32(hashString("daily-" + YYYY-MM-DD)) })`. The day rolls over at local midnight, and a game started on a day stays that day's puzzle.
- **Size rotates by day index** from an epoch (the release date) through **Murmur 7×7 → Hushed 8×8 → Secluded 9×9 → Solitary 10×10**, then repeats.
- Generation is fast (around 10–20 ms measured in node). Show a brief "building tonight's puzzle…" state anyway for slower phones, and cache the generated puzzle for the day.
- Records `hitori.daily`: `{ "YYYY-MM-DD": { stars, bestMs, onTime } }`. Streaks, the calendar, and "late solves don't repair a streak" work like TicTacLogic.
- Known trade-off (same as TicTacLogic): a generator change in an update can change a day's puzzle for someone who updates mid-day.

## 5. Statistics data
- **Free play:** keep the existing `hitori.stats` per-tier records. Add `hintsUsed` totals and a per-day solved log, both needed for the All tab's streak and activity grid.
- **Levels / daily:** derived from `hitori.levels` and `hitori.daily`. Levels and daily do **not** feed the free-play records (like TicTacLogic).
- **All tab:** computed from all three. Its streak counts days on which at least one puzzle was solved in any mode. It needs a per-day record for free play and levels, so store a solve date with each win, or keep a small `hitori.activity` log keyed by date. Builder's choice.
- Existing players' current stats must survive the update. Migrate; never wipe.

## 6. Housekeeping
- **Mode in the save:** the in-progress save gains `mode: "free" | "level" | "daily"`, plus `level`, `dailyKey`, `startedKey`, `hintsUsed` and `mistakes`. Re-entering the level or day that is already in progress resumes it instead of wiping it (TicTacLogic commit `6c68dbb`).
- **Service worker:** add the new JS files to `SHELL`, and bump `CACHE_NAME` each deploy.
- **`.gitignore`:** add `!docs/**/*.md` (it currently ignores all `.md` except README), and ignore `.superpowers/`.
- **README:** update Features, Architecture and Tests.
- Keep game logic headless and DOM-free (`rules`, `board`, `solver`, `generator`, plus the new `levels`/`progress`/`daily`/hint-explanation modules), all testable with `node`.

## Left to the builder
- Exact hint wording, as long as every hint states its reason.
- Exact number of moves before a lingering wrong mark counts as a mistake (around 3).
- The rule for "technique mastered".
- The pinned button's behaviour when a tier is fully solved.
- Theming touches (e.g. calling volumes "nights" or "districts"), offered as options and kept light.
- Build order. Suggested: hint explanations (solver + tests) → levels build tool + data + tests → progress/daily modules + tests → screens → stats → tutorial → pause/settings polish → PWA bump.
