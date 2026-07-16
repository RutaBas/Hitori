# DESIGN

Paste this section into the Claude Code prompt, directly after TECH STACK.
Ship `skyline.svg` in the project folder alongside it.

---

CONCEPT: Hitori feels like an apartment block at dusk — windows going dark one by one until only a connected few stay awake. Nocturnal urban, not Japanese-contemplative: sodium streetlamps, mono type, a city that goes to sleep as you play.

## COLORS

| Role | Hex | Notes |
|---|---|---|
| night / background | `#16192B` | |
| lit cell (lamplight) | `#EFE3CA` | digit `#2A2318` (12.2:1) |
| shaded cell (gone dark) | `#0D0F1A` | digit `#6B7291` (4.04:1) |
| sodium light | `#E8935B` | on night = 7.25:1 — buttons, tier names, HUD accent |
| sodium dark | `#A35A2E` | on cream = 4.07:1 — the circled mark, anything drawn on a lit cell |
| violation rose | `#C4695E` | rule violations ONLY, never decorative |
| skyline bands (far→near) | `#1E2238` / `#191C2E` / `#101322` | |

Rules that must not be broken:

- **Sodium is a two-stop ramp, and the stop is chosen by what's underneath it.** Light on night, dark on cream. One stop cannot serve both — a single mid-amber measures 1.61:1 on cream, which makes the player's own annotation invisible.
- **Full-strength sodium never touches a digit or a skyline window.** It marks player intent only. Sodium always reads "you did this," never "the puzzle says this."
- **Nothing decorative may use the violation rose.** It's close enough to the sodium family that a decorative use would make errors ambiguous.

Eliminated digits stay visible on purpose. On paper you shade with a pencil and the digit remains underneath; players need it to re-check a deduction. `#6B7291` is cool blue-grey against the lit cells' warm near-black — temperature does the work, so a shaded digit reads "extinguished," not merely "faint."

## FONTS

IBM Plex Mono only, via one Google Fonts `<link>` — weights 300/400/500.

| Weight | Use |
|---|---|
| 300 | wordmark, labels, stats, secondary text |
| 400 | board digits, timer |
| 500 | tier names, buttons |

Mono is a functional choice, not just a stylistic one: digits are tabular by default, so grid columns align exactly — and scanning a column for duplicates is the entire visual task in Hitori.

Caps + tracking for the wordmark, tier names, and buttons (all short). Stats and settings stay sentence case, or the caps stop meaning anything.

## SPACING SCALE

4 / 8 / 16 / 24 / 32

## WORDMARK

**Standing mark (start screen, everywhere):** `HITOR` in Plex Mono 300, `letter-spacing: 0.42em`, `#EFE3CA` — then the final `I` in a `#E8935B` filled cell, 4px radius, digit `#16192B` weight 500.

- Match the cell to the cap height of the surrounding letters, and strip `letter-spacing` from the final character before the box — otherwise tracking leaves a floating gap after the R.
- The app icon is this same idea cropped: one lit sodium cell among dark ones on `#16192B`. Mark and icon are the same object.

**Cold-start splash:** `HITORI` as six 36px cells, all lit (`#EFE3CA`, digits `#2A2318`, weight 500). After 400ms the final `I` dims to `#0D0F1A` with its glyph at `#838BAD` — the title solves itself. Hold ~600ms, fade out, fade in the start screen.

Why this works: HITORI contains exactly one duplicate (the I). Shading the final I leaves every remaining letter unique *and* contiguous; shading the first I strands the H and breaks the connectivity rule. So the splash is a real solved Hitori row, and it demonstrates the entire rule set before the player taps anything.

Two hard constraints:

- **`#838BAD` (5.69:1) for the splash's shaded letter — NOT the board's `#6B7291`.** In a grid a dim digit is inferable from context; in a logo it isn't, and at 4:1 a glance reads "HITOR".
- **Once per cold launch only** — gate on a `sessionStorage` flag, and skip on tap. It must never appear when the player returns to the start screen from a game. A splash you can't escape is charming on day one and irritating by day three.

Do not use the cell-row wordmark on the start screen itself: stacked above six bordered tier rows it stops reading as a logo and reads as the first row of the list.

## BACKGROUND — use the provided `skyline.svg`, don't redraw it

- Inline it into the DOM (not `<img>`, not `background-image`) — individual windows must be script-addressable. Pinned to the bottom of the app container, `preserveAspectRatio="xMidYMax slice"`, `pointer-events: none`, behind everything.
- Start screen: full skyline, opacity 0.95, roughly the bottom half.
- Play screen: hide `#band-far` and `#win-far`, whole thing at opacity 0.5, cropped to a short band at the bottom. Same file, different treatment — the board must stay dominant.
- Flat fills only, never gradients. Distant bands are *lighter* than near ones (atmospheric perspective) — that's what sells the depth, and it avoids banding on OLED.
- Pin to the app container rather than the viewport if the board ever scrolls on the 10×10 tier.

## THE CITY GOES TO SLEEP

- Every `<rect class="win">` in `skyline.svg` carries `data-lit` with its intended opacity. On shading a cell, fade one still-lit window to 0 over 0.6s — slow enough to stay peripheral. Undo restores the most recently darkened window to its `data-lit` value.
- Pick windows nearest-first (reverse document order: `#win-near` → `#win-mid` → `#win-far`) so the city empties from the foreground back.
- Keep a stack of darkened windows so undo is exact. If shaded cells outnumber lit windows, stop — never wrap around.
- This is atmosphere, not information: a skyline window must never encode puzzle state.

## DEPTH — "lamplight on paper at night"

One language, and it carries the game's meaning:

- **Lit cell:** raised. Cream fill, 1px light inset top edge, soft drop shadow, faint sodium glow — `0 1px 0 rgba(255,255,255,0.25) inset, 0 2px 6px rgba(0,0,0,0.35), 0 0 14px rgba(232,147,91,0.10)`.
- **Shaded cell:** recessed. `inset 0 2px 5px rgba(0,0,0,0.75)`, no glow, digit dimmed. Shading = pressing the cell in and switching its light off.
- **Buttons:** same raised language. Sodium fill for primary, `#3A3F58` hairline outline for secondary.

## MOTION — contemplative, not snappy

Default `transition: all 0.22s cubic-bezier(0.4, 0, 0.2, 1)`.

- Shade a cell: 0.25s — digit fades, inset shadow eases in, brief 0.98 scale dip. Paired skyline window fades over 0.6s.
- Circle a cell: 0.18s sodium-dark ring draws in via stroke-dashoffset.
- Screen transitions: 0.3s crossfade. The skyline does NOT crossfade — it stays put and only changes opacity/crop, so it reads as one continuous city across screens.

## FEEDBACK MAP

- **Shade/unshade** (small): dim animation + soft low click + 10ms haptic tick.
- **Circle** (small): ring draw + higher soft tick, no haptic.
- **Violation** (only if the setting is on): the offending pair pulses `#C4695E` for 0.4s. NO screen shake — too loud for a contemplative game, and it would rob the win moment.
- **WIN** (the big one): dark cells fade fully into the background, disappearing into the night. Then a wave of light sweeps across the connected white region — starting at the last-tapped cell, brightening each cell in BFS order over the actual connectivity graph, ~25ms per ring. The win animation literally demonstrates rule 3: the white cells are one connected area. Reuse the solver's flood-fill for the ordering — do not fake it with a diagonal sweep. Then the tier name fades in with the final time. Soft ascending chime; haptic pattern `[15, 60, 25]`.
- On win, leave the skyline dark. The city sleeps; the board is the last thing awake.

## LAYOUT

- **Start screen:** D wordmark, then the six Solitude tiers as stacked full-width buttons (name + grid size + best time), ascending, over the skyline. Continue button at top when a save exists. All visible without scrolling at 390px — buttons 46px, 8px gaps.
- **In-game HUD:** tier name (sodium light, 500, tracked caps), grid size, timer. Nothing else. Settings and stats behind a menu icon.
- **Board dominant:** full width minus 16px padding. Undo and Hint below it in thumb reach.
- `env(safe-area-inset-*)` padding throughout. The skyline extends INTO the bottom inset — it should run to the physical screen edge, under the home indicator.
- **PWA icons:** crop the near band of `skyline.svg` — two dark blocks, one lit sodium window on `#16192B`. Render at 180/192/512 via the canvas + `toDataURL` method.
