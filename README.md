# Hitori

A browser-based Hitori logic puzzle — mobile-first, installable on iPhone as a home-screen
web app. Vanilla HTML/CSS/JS, no frameworks, no build step, no backend.

Hitori means "alone". The board is an apartment block at dusk: windows go dark one by one
until only a connected few stay awake.

## Rules

The board is an N×N grid with a number in every square. Shade squares so that:

1. **No number appears more than once** in any row or column, counting only un-shaded (lit) squares.
2. **Shaded squares never touch** each other vertically or horizontally (diagonal is fine).
3. **All lit squares form a single orthogonally-connected region.**

Tap a cell to cycle: unmarked → shaded → circled (*confirmed lit*) → unmarked.

## Difficulty — the Solitude ladder

Difficulty is graded by **which solver technique a puzzle requires**, not by grid size.

| Tier | Name | Size | Technique required |
|---|---|---|---|
| 1 | Crowded | 5×5 | T3 Connectivity |
| 2 | Bustling | 6×6 | T3 Connectivity |
| 3 | Murmur | 7×7 | T4 Reachability |
| 4 | Hushed | 8×8 | T4 Reachability |
| 5 | Secluded | 9×9 | T6 Contradiction |
| 6 | Solitary | 10×10 | T6 Contradiction |

The six tiers map onto **three** technique bands rather than six. An empirical sweep
(`test/sweep.js`, `test/sweep2.js`) showed T1/T2 never occur as an exact ceiling (Hitori
uniqueness almost always needs connectivity reasoning) and T5 is a near-empty niche. So
each band spans two sizes, and difficulty rises on both the technique and size axes.
Puzzles requiring guessing beyond T6 are rejected outright.

## Architecture

Solver-first. Game logic is strictly separated from the DOM so it runs headlessly in `node`.

| File | Role |
|---|---|
| `js/rules.js` | The three rules as pure functions + the white-region flood-fill |
| `js/board.js` | Data model: cell states, geometry, serialization |
| `js/solver.js` | Deductive tiers T1–T6, exhaustive solution counter, hint engine |
| `js/generator.js` | Puzzle generation + the locked tier config |
| `js/explain.js` | Explained deductions T1–T6 with evidence cells, traced chains, clash detection |
| `js/hints.js` | What the Hint button says next: mistakes, deductions, stuck reveals, T5/T6 walk-through frames |
| `js/progress.js` | Level stars, unlocking, result merging, lingering-mistake tracker, save migration |
| `js/levels.js` | The frozen level packs (generated — never edited by hand) |
| `js/daily.js` | Daily puzzle by date, records, streaks, calendar grid |
| `js/stats.js` | Statistics across free play, levels and daily |
| `js/ui.js` | Screens, rendering, tap interaction, persistence, win flow |
| `tools/build-levels.js` | Builds and extends `js/levels.js` in batches |

**Why uniqueness is the hard part:** shading more never violates rule 1, so uniqueness comes
almost entirely from rules 2 and 3. A naive generator produces puzzles with dozens of
solutions. Two things guard against that:

- Every shaded square's number **must** appear on a lit square in the same row or column —
  otherwise un-shading it yields another valid solution.
- Generation verifies uniqueness with a **real solution-counting search** that enumerates all
  solutions (capped at 2), not a solver that stops at the first one.

### Solver technique tiers

- **T1 Pattern** — triple `X X X`, sandwich `X ? X`, adjacent pair + another `X` in the line
- **T2 Propagation** — shaded ⇒ neighbours lit; lit ⇒ same number in the line is shaded
- **T3 Connectivity** — corner rule + a lit cell's single remaining lifeline
- **T4 Reachability** — global flood-fill; shading that would cut the lit region
- **T5 Chains** — cells forced identically down both branches of a hypothesis
- **T6 Contradiction** — one-step lookahead: assume shaded, propagate, force lit on conflict

## Features

- Home screen with free play, **600 levels** (six tiers of 100, in a stars-and-unlock
  progression), a **daily puzzle** with streaks and a calendar, all-mode **stats**, rules,
  settings and an interactive **tutorial**
- Technique intros introduce each solver technique the first time its tier needs it
- Three-state tap marking, undo, restart, pause
- **Explained hints** in three stages — a nudge, the area, then the exact cell — each naming
  the technique and why it works; never a random answer. A wrong mark is explained and
  corrected first. The hardest deductions (T5/T6) come with a step-by-step walk-through
- Auto-save (a refresh or app close loses nothing), timer, stats across every mode
- Live rule-violation feedback (**off by default** — being stranded later is the point)
- Win animation: dark cells sink into the night, then light sweeps the connected lit region
  in true BFS order over the actual connectivity graph
- Shareable emoji-grid result (Wordle-style), installable PWA, works offline

## Adding levels

```bash
node tools/build-levels.js --batches 2   # appends batch 2 (levels 101-200) to every tier
```

Existing levels never change: the script keeps every existing batch byte-for-byte and only
appends new ones, so level numbers stay put and saved progress stays valid.

## Run locally

No build step. Serve the folder over HTTP (a service worker needs `http`/`https`, not `file://`):

```bash
python -m http.server 8731
# open http://localhost:8731
```

## Tests

```bash
for f in test/*.test.js; do node "$f" || exit 1; done   # every suite; each reports "0 failed"
```

- `test/solver.test.js` — solver, solution counter, hint engine
- `test/generator.test.js` — generation, tier config, seeding, round-trips
- `test/explain.test.js` — explained deductions agree with the solver
- `test/hints.test.js` — hint stages, mistakes, stuck reveals, timing
- `test/progress.test.js` — stars, unlocking, mistake tracking
- `test/levels.test.js` — the frozen level packs
- `test/daily.test.js` — daily puzzle, records, streaks, calendar
- `test/stats.test.js` — all-mode statistics
- `test/save.test.js` — in-progress save shape and migration
- `test/sweep.js`, `test/sweep2.js` — difficulty distribution and 100-per-tier batch
  verification (run manually with `node`)

The key test: a Latin square must report **≥2** solutions. Every row and column is already
all-distinct, so all-lit is valid — but shading the centre of a 3×3 is *also* valid. A counter
that reports 1 here is only checking rule 1 and would pass garbage puzzles.

Batch verification (100 per tier, 600 total): **0** with solutions ≠ 1, **0** requiring
guessing, **0** tier mismatches.

## Icons

```bash
node tools/make-icons.js   # writes icons/icon-{180,192,512}.png
```

A dependency-free PNG encoder draws the mark: a 3×3 of darkened windows with one lit sodium
cell on night — the same object as the wordmark's boxed `I`.

## Install on iPhone

Deploy, then open the URL in **Safari** → Share → **Add to Home Screen**.

Bump `CACHE_NAME` in `sw.js` on every deploy (currently `hitori-v2`) — that is the update
strategy. Add any new `js/` file to its `SHELL` list.

## Notes

`skyline.svg` is a design source: its markup is **inlined** into `index.html` so individual
windows are script-addressable (the city darkens a window each time you shade a cell). It is
not a runtime asset and is not precached.
