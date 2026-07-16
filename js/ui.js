/*
 * ui.js — screens, rendering, and tap interaction (Step 4).
 *
 * Owns two screens (start / play) that crossfade while the skyline stays put. Renders the
 * board from a generated puzzle, cycles cell state on tap (unmarked -> shaded -> circled),
 * and handles undo / restart / new puzzle. Depth + motion come from styles.css; this file
 * only toggles classes and drives the model in board.js.
 *
 * Deferred hooks (left intentionally minimal): win animation -> Step 6, "city goes to
 * sleep" window fading -> Step 8, hints -> Step 5, auto-save/stats -> Step 6.
 */
(function () {
  "use strict";

  var LS = {
    settings: "hitori.settings",
    stats: "hitori.stats",
    save: "hitori.saveState",
  };

  var App = {
    board: null,          // Board instance (board.js)
    solution: null,       // Int8Array shaded mask of the unique solution
    N: 0,
    tierIndex: null,
    tierName: "",
    moves: 0,
    undoStack: [],        // [{ i, prev }]
    won: false,
    lastTap: null,        // index of the last tapped cell (win sweep origin)
    timerId: null,
    startedAt: 0,
    baseMs: 0,            // accumulated elapsed ms (survives resume)
    settings: null,
    activeUnsolvedTier: null, // tier of an in-progress game (for streak/abandon logic)
    hintTimer: null,
    winOrder: [],         // skyline windows, nearest-first (city-goes-to-sleep order)
    darkCount: 0,         // how many windows are currently darkened
    splashTimers: [],
  };

  // ---- tiny helpers ---------------------------------------------------------
  function $(sel, root) { return (root || document).querySelector(sel); }
  function el(tag, cls) { var e = document.createElement(tag); if (cls) e.className = cls; return e; }
  function readJSON(key, fallback) {
    try { var v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch (e) { return fallback; }
  }
  function writeJSON(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) {} }

  function loadSettings() {
    return Object.assign({ violations: false, sound: true, haptics: true, dark: true }, readJSON(LS.settings, {}));
  }
  function saveSettings() { writeJSON(LS.settings, App.settings); }

  function fmtTime(ms) {
    var s = Math.floor(ms / 1000);
    var m = Math.floor(s / 60);
    s = s % 60;
    return m + ":" + (s < 10 ? "0" : "") + s;
  }

  // ---- feedback: sound + haptics -------------------------------------------
  var Sound = (function () {
    var ctx;
    function ac() { if (!ctx) { var C = window.AudioContext || window.webkitAudioContext; if (C) ctx = new C(); } return ctx; }
    function blip(freq, dur, gain) {
      if (!App.settings || !App.settings.sound) return;
      var c = ac(); if (!c) return;
      try {
        var o = c.createOscillator(), g = c.createGain();
        o.type = "sine"; o.frequency.value = freq;
        o.connect(g); g.connect(c.destination);
        var t = c.currentTime;
        g.gain.setValueAtTime(gain, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        o.start(t); o.stop(t + dur);
      } catch (e) {}
    }
    function chime() {
      if (!App.settings || !App.settings.sound) return;
      var c = ac(); if (!c) return;
      var notes = [523.25, 659.25, 783.99, 1046.5]; // C5 E5 G5 C6 — soft ascending
      notes.forEach(function (f, k) {
        try {
          var o = c.createOscillator(), g = c.createGain();
          o.type = "sine"; o.frequency.value = f;
          o.connect(g); g.connect(c.destination);
          var t = c.currentTime + k * 0.12;
          g.gain.setValueAtTime(0.0001, t);
          g.gain.exponentialRampToValueAtTime(0.06, t + 0.02);
          g.gain.exponentialRampToValueAtTime(0.0001, t + 0.42);
          o.start(t); o.stop(t + 0.45);
        } catch (e) {}
      });
    }
    return {
      click: function () { blip(170, 0.09, 0.05); }, // soft low click on shade
      tick: function () { blip(430, 0.05, 0.035); },  // higher soft tick on circle
      winChime: chime,
    };
  })();

  function haptic(ms) {
    if (App.settings && App.settings.haptics && navigator.vibrate) { try { navigator.vibrate(ms); } catch (e) {} }
  }

  // ---- skyline treatment ----------------------------------------------------
  function setSkyline(mode) {
    var sky = document.getElementById("skyline");
    if (!sky) return;
    sky.classList.toggle("skyline--start", mode === "start");
    sky.classList.toggle("skyline--play", mode === "play");
  }

  // ---- persistence: auto-save + stats ---------------------------------------
  function saveGame() {
    if (!App.board || App.won) return;
    writeJSON(LS.save, {
      tierIndex: App.tierIndex, tierName: App.tierName, N: App.N,
      numbers: Array.from(App.board.numbers),
      solution: Array.from(App.solution),
      state: Array.from(App.board.state),
      elapsedMs: currentMs(), moves: App.moves, savedAt: Date.now(),
    });
  }
  function clearSave() { try { localStorage.removeItem(LS.save); } catch (e) {} }

  function blankStats() { return { played: 0, won: 0, bestMs: 0, sumMs: 0, currentStreak: 0, bestStreak: 0 }; }
  function statsFor(t) { var s = readJSON(LS.stats, {}); return s[t] || blankStats(); }
  function recordStart(t) {
    var s = readJSON(LS.stats, {});
    // Abandoning an unsolved game breaks that tier's win streak.
    if (App.activeUnsolvedTier != null) {
      var prev = s[App.activeUnsolvedTier] || (s[App.activeUnsolvedTier] = blankStats());
      prev.currentStreak = 0;
    }
    var e = s[t] || (s[t] = blankStats());
    e.played++;
    App.activeUnsolvedTier = t;
    writeJSON(LS.stats, s);
  }
  function recordWin() {
    var s = readJSON(LS.stats, {});
    var e = s[App.tierIndex] || (s[App.tierIndex] = blankStats());
    var ms = currentMs();
    e.won++; e.sumMs += ms;
    if (!e.bestMs || ms < e.bestMs) e.bestMs = ms;
    e.currentStreak = (e.currentStreak || 0) + 1;
    if (e.currentStreak > e.bestStreak) e.bestStreak = e.currentStreak;
    App.activeUnsolvedTier = null;
    writeJSON(LS.stats, s);
  }

  // ---- screen switching (crossfade; skyline stays) --------------------------
  function showScreen(name) {
    var start = document.getElementById("screen-start");
    var play = document.getElementById("screen-play");
    var isStart = name === "start";
    start.classList.toggle("screen--active", isStart);
    play.classList.toggle("screen--active", !isStart);
    setSkyline(isStart ? "start" : "play");
  }

  // ==========================================================================
  // START SCREEN
  // ==========================================================================
  function renderStart() {
    var list = document.getElementById("tier-list");
    list.innerHTML = "";
    var stats = readJSON(LS.stats, {});

    // Continue button (only when an in-progress save exists — wired up in Step 6).
    var save = readJSON(LS.save, null);
    if (save && save.tierIndex) {
      var cont = el("button", "tier tier--continue");
      cont.innerHTML = '<span class="tier-name">Continue</span>' +
        '<span class="tier-meta">' + (save.tierName || "") + " &middot; " + (save.N || "") + "×" + (save.N || "") +
        " &middot; " + fmtTime(save.elapsedMs || 0) + "</span>";
      cont.addEventListener("click", resumeSaved);
      list.appendChild(cont);
    }

    for (var t = 1; t <= 6; t++) {
      var cfg = TIERS[t];
      var best = stats[t] && stats[t].bestMs ? fmtTime(stats[t].bestMs) : "—";
      var b = el("button", "tier");
      b.setAttribute("data-tier", t);
      b.innerHTML =
        '<span class="tier-name">' + cfg.name + "</span>" +
        '<span class="tier-meta"><span class="tier-size">' + cfg.size + "×" + cfg.size + "</span>" +
        '<span class="tier-best">' + best + "</span></span>";
      b.addEventListener("click", makeTierHandler(t, b));
      list.appendChild(b);
    }
  }

  function makeTierHandler(t, btn) {
    return function () {
      if (btn.classList.contains("is-working")) return;
      btn.classList.add("is-working");
      var name = btn.querySelector(".tier-name");
      var prev = name.textContent;
      name.textContent = "Building…";
      // Yield a frame so the label paints before the (synchronous) generator runs.
      setTimeout(function () {
        startTier(t);
        name.textContent = prev;
        btn.classList.remove("is-working");
      }, 20);
    };
  }

  // ==========================================================================
  // PLAY: build + render
  // ==========================================================================
  function startTier(t) {
    var puzzle = generateTier(t);
    if (!puzzle || puzzle.failed) {
      // Extremely unlikely given the sweep; retry once, then bail gracefully.
      puzzle = generateTier(t);
      if (!puzzle || puzzle.failed) { alert("Could not build a puzzle — please try again."); return; }
    }
    recordStart(t);
    App.board = new Board(puzzle.N, puzzle.numbers);
    App.solution = puzzle.solution;
    App.N = puzzle.N;
    App.tierIndex = t;
    App.tierName = puzzle.name;
    App.moves = 0;
    App.undoStack = [];
    App.won = false;
    App.lastTap = null;
    App.baseMs = 0;

    // HUD
    $(".hud-tier").textContent = App.tierName;
    $(".hud-size").textContent = App.N + "×" + App.N;
    document.getElementById("win-overlay").classList.remove("is-visible");
    document.getElementById("skyline").classList.remove("skyline--asleep");

    buildBoardDom();
    renderAllCells();
    resetCitySleep();      // fresh board: the whole city is awake again
    startTimer();
    showScreen("play");
    sizeBoard();
    saveGame();
  }

  // Resume the in-progress game from localStorage (Continue button).
  function resumeSaved() {
    var s = readJSON(LS.save, null);
    if (!s) return;
    App.board = new Board(s.N, s.numbers, s.state);
    App.solution = Int8Array.from(s.solution);
    App.N = s.N;
    App.tierIndex = s.tierIndex;
    App.tierName = s.tierName;
    App.moves = s.moves || 0;
    App.undoStack = [];
    App.won = false;
    App.lastTap = null;
    App.baseMs = s.elapsedMs || 0;
    App.activeUnsolvedTier = s.tierIndex;

    $(".hud-tier").textContent = App.tierName;
    $(".hud-size").textContent = App.N + "×" + App.N;
    document.getElementById("win-overlay").classList.remove("is-visible");
    document.getElementById("skyline").classList.remove("skyline--asleep");

    buildBoardDom();
    renderAllCells();
    resetCitySleep();
    updateCitySleep();       // reflect the resumed shaded count
    App.startedAt = 0;       // baseMs already holds elapsed; startTimer resumes from there
    startTimer();
    showScreen("play");
    sizeBoard();
  }

  function buildBoardDom() {
    var board = document.getElementById("board");
    board.innerHTML = "";
    board.style.setProperty("--n", App.N);
    board.style.gridTemplateColumns = "repeat(" + App.N + ", 1fr)";
    var frag = document.createDocumentFragment();
    for (var i = 0; i < App.N * App.N; i++) {
      var cell = el("div", "cell");
      cell.setAttribute("data-i", i);
      var digit = el("span", "digit");
      digit.textContent = App.board.numbers[i];
      cell.appendChild(digit);
      // Circle annotation ring (draws in via stroke-dashoffset when circled).
      var ns = "http://www.w3.org/2000/svg";
      var svg = document.createElementNS(ns, "svg");
      svg.setAttribute("class", "ring");
      svg.setAttribute("viewBox", "0 0 100 100");
      var c = document.createElementNS(ns, "circle");
      c.setAttribute("cx", "50"); c.setAttribute("cy", "50"); c.setAttribute("r", "38");
      svg.appendChild(c);
      cell.appendChild(svg);
      frag.appendChild(cell);
    }
    board.appendChild(frag);
  }

  function renderCell(i) {
    var cell = document.querySelector('#board .cell[data-i="' + i + '"]');
    if (!cell) return;
    var s = App.board.getState(i);
    cell.classList.toggle("cell--shaded", s === CellState.SHADED);
    cell.classList.toggle("cell--circled", s === CellState.CIRCLED);
  }
  function renderAllCells() { for (var i = 0; i < App.N * App.N; i++) renderCell(i); }

  function sizeBoard() {
    var board = document.getElementById("board");
    if (!board || !App.N) return;
    var w = board.clientWidth;
    if (!w) return;
    var cell = w / App.N;
    board.style.fontSize = Math.round(cell * 0.46) + "px";
  }

  // ==========================================================================
  // TAP -> cycle state
  // ==========================================================================
  function onBoardClick(ev) {
    if (App.won) return;
    var cell = ev.target.closest ? ev.target.closest(".cell") : null;
    if (!cell) return;
    clearHint();
    var i = parseInt(cell.getAttribute("data-i"), 10);
    var prev = App.board.getState(i);
    var next = App.board.cycle(i);
    App.undoStack.push({ i: i, prev: prev });
    App.moves++;
    App.lastTap = i;

    // Feedback per the DESIGN map.
    if (next === CellState.SHADED) {
      Sound.click(); haptic(10);
      pulseScaleDip(cell);
    } else if (next === CellState.CIRCLED) {
      Sound.tick(); // circle: no haptic
    } else {
      Sound.click(); haptic(10); // back to unmarked reads as an un-shade
    }

    renderCell(i);
    updateCitySleep();
    if (App.settings.violations) showViolations();
    saveGame();     // auto-save before a possible win (win then clears the save)
    checkWin();
  }

  function pulseScaleDip(cell) {
    cell.classList.remove("dip");
    // reflow to restart the animation
    void cell.offsetWidth;
    cell.classList.add("dip");
    cell.addEventListener("animationend", function h() { cell.classList.remove("dip"); cell.removeEventListener("animationend", h); });
  }

  // ---- undo / restart / new -------------------------------------------------
  function undo() {
    if (App.won || !App.undoStack.length) return;
    var m = App.undoStack.pop();
    App.board.setState(m.i, m.prev);
    App.moves++;
    App.lastTap = m.i;
    Sound.click(); haptic(10);
    renderCell(m.i);
    updateCitySleep();
    if (App.settings.violations) showViolations();
    saveGame();
  }

  function restart() {
    if (!App.board) return;
    for (var i = 0; i < App.N * App.N; i++) App.board.setState(i, CellState.UNMARKED);
    App.undoStack = [];
    App.moves = 0;
    App.won = false;
    App.lastTap = null;
    document.getElementById("win-overlay").classList.remove("is-visible");
    document.getElementById("skyline").classList.remove("skyline--asleep");
    renderAllCells();
    resetCitySleep();
    // strip any transient animation classes left over
    var nodes = document.querySelectorAll("#board .cell");
    for (var d = 0; d < nodes.length; d++) nodes[d].classList.remove("dip", "win-lit", "win-vanish", "hint");
    clearViolations();
    App.baseMs = 0;
    startTimer();
    closeMenu();
  }

  function newPuzzle() { closeMenu(); startTier(App.tierIndex); }

  function quitToMenu() {
    stopTimer();
    saveGame();        // no-op after a win (save already cleared); keeps mid-game resumable
    closeMenu();
    renderStart();     // re-reads the save so Continue appears when a game is in progress
    showScreen("start");
  }

  // ---- violation feedback (only when the setting is ON) ---------------------
  function violationCells() {
    var flagged = {};
    var N = App.N, st = App.board.state, nums = App.board.numbers;
    // rule 2: two SHADED orthogonally adjacent
    for (var i = 0; i < N * N; i++) {
      if (st[i] !== CellState.SHADED) continue;
      var r = (i / N) | 0, c = i - r * N;
      if (c + 1 < N && st[i + 1] === CellState.SHADED) { flagged[i] = 1; flagged[i + 1] = 1; }
      if (r + 1 < N && st[i + N] === CellState.SHADED) { flagged[i] = 1; flagged[i + N] = 1; }
    }
    // rule 1: two CIRCLED (committed-white) with the same number in a line
    function scanLine(idxs) {
      var byVal = {};
      for (var k = 0; k < idxs.length; k++) {
        var idx = idxs[k];
        if (st[idx] !== CellState.CIRCLED) continue;
        var v = nums[idx];
        if (byVal[v] != null) { flagged[idx] = 1; flagged[byVal[v]] = 1; }
        else byVal[v] = idx;
      }
    }
    for (var rr = 0; rr < N; rr++) { var row = []; for (var cc = 0; cc < N; cc++) row.push(rr * N + cc); scanLine(row); }
    for (var c2 = 0; c2 < N; c2++) { var col = []; for (var r2 = 0; r2 < N; r2++) col.push(r2 * N + c2); scanLine(col); }
    return Object.keys(flagged).map(Number);
  }
  function clearViolations() {
    var nodes = document.querySelectorAll("#board .cell.violation");
    for (var k = 0; k < nodes.length; k++) nodes[k].classList.remove("violation");
  }
  function showViolations() {
    clearViolations();
    var cells = violationCells();
    for (var k = 0; k < cells.length; k++) {
      var node = document.querySelector('#board .cell[data-i="' + cells[k] + '"]');
      if (node) node.classList.add("violation");
    }
  }

  // ---- hints (solver-powered next deduction) --------------------------------
  function clearHint() {
    var nodes = document.querySelectorAll("#board .cell.hint");
    for (var k = 0; k < nodes.length; k++) nodes[k].classList.remove("hint");
    document.getElementById("hint-toast").classList.remove("is-visible");
    if (App.hintTimer) { clearTimeout(App.hintTimer); App.hintTimer = null; }
  }
  function highlightHint(i) {
    clearHint();
    var cell = document.querySelector('#board .cell[data-i="' + i + '"]');
    if (cell) cell.classList.add("hint");
  }
  function showToast(tech, msg) {
    var toast = document.getElementById("hint-toast");
    toast.innerHTML = (tech ? '<span class="tech">' + tech + "</span> — " : "") + msg;
    toast.classList.add("is-visible");
    if (App.hintTimer) clearTimeout(App.hintTimer);
    App.hintTimer = setTimeout(clearHint, 6000);
  }
  function showHint() {
    if (App.won || !App.board) return;
    var N = App.N, st = App.board.state, sol = App.solution;

    // 1. Correct a player mistake before offering a deduction — a deductive hint on an
    //    inconsistent board would point at the wrong thing.
    for (var i = 0; i < N * N; i++) {
      if (st[i] === CellState.SHADED && sol[i] !== 1) {
        highlightHint(i); showToast(null, "This cell can’t be shaded — un-shade it."); return;
      }
      if (st[i] === CellState.CIRCLED && sol[i] === 1) {
        highlightHint(i); showToast(null, "This cell should be dark, not lit."); return;
      }
    }

    // 2. Next deduction from the (now known-consistent) player progress.
    var seed = new Int8Array(N * N);
    for (var j = 0; j < N * N; j++) {
      seed[j] = st[j] === CellState.SHADED ? SolveCell.BLACK
              : st[j] === CellState.CIRCLED ? SolveCell.WHITE
              : SolveCell.UNKNOWN;
    }
    var h = hintNext(seed, App.board.numbers, N);
    if (h.status === "deduction") {
      highlightHint(h.i);
      showToast(h.technique, h.value === SolveCell.BLACK ? "this cell must be shaded." : "this cell must stay lit.");
    } else if (h.status === "contradiction") {
      showToast(null, "Something doesn’t add up — check your shaded cells.");
    } else {
      // Stuck (shouldn't happen for our tier-bounded puzzles): reveal a correct next cell.
      var rev = -1;
      for (var k = 0; k < N * N; k++) if (st[k] === CellState.UNMARKED && sol[k] === 1) { rev = k; break; }
      if (rev >= 0) { highlightHint(rev); showToast(null, "This cell must be shaded."); }
      else showToast(null, "No more deductions — you’re nearly there.");
    }
  }

  // ---- win (placeholder; full animation is Step 6) --------------------------
  function isSolved() {
    var st = App.board.state, sol = App.solution;
    for (var i = 0; i < App.N * App.N; i++) {
      var shaded = st[i] === CellState.SHADED ? 1 : 0;
      if (shaded !== sol[i]) return false;
    }
    return true;
  }
  function checkWin() {
    if (!isSolved()) return;
    App.won = true;
    stopTimer();
    recordWin();
    clearSave();
    runWinAnimation();
  }

  var DARK_FADE_MS = 520; // dark cells sink into the night before the light sweep
  var RING_MS = 45;       // per BFS ring — a contemplative wave, not a snap

  function runWinAnimation() {
    var board = document.getElementById("board");
    clearHint();
    // (a) dark cells fade fully into the background; the city goes to sleep.
    var darks = board.querySelectorAll(".cell--shaded");
    for (var k = 0; k < darks.length; k++) darks[k].classList.add("win-vanish");
    document.getElementById("skyline").classList.add("skyline--asleep");

    setTimeout(function () {
      // (b) light sweep over the REAL connectivity graph, from the last-tapped cell out.
      var fw = floodWhite(App.solution, App.N, winSweepStart());
      var rings = fw.rings || [];
      rings.forEach(function (ring, r) {
        setTimeout(function () {
          for (var m = 0; m < ring.length; m++) {
            var cell = board.querySelector('.cell[data-i="' + ring[m] + '"]');
            if (cell) cell.classList.add("win-lit");
          }
        }, r * RING_MS);
      });
      // (c) after the wave, the tier name + time fade in; chime + haptic.
      setTimeout(function () {
        Sound.winChime();
        haptic([15, 60, 25]);
        showWinOverlay();
      }, rings.length * RING_MS + 160);
    }, DARK_FADE_MS);
  }

  // The sweep starts where the player last acted. The winning tap usually shades a cell
  // (now vanished), so fall back to a white orthogonal neighbour of it.
  function winSweepStart() {
    var i = App.lastTap, N = App.N;
    if (i == null || i < 0) return -1;
    if (App.solution[i] === 0) return i;
    var r = (i / N) | 0, c = i - r * N;
    if (r > 0 && App.solution[i - N] === 0) return i - N;
    if (r + 1 < N && App.solution[i + N] === 0) return i + N;
    if (c > 0 && App.solution[i - 1] === 0) return i - 1;
    if (c + 1 < N && App.solution[i + 1] === 0) return i + 1;
    return -1;
  }

  function showWinOverlay() {
    document.querySelector(".win-tier").textContent = App.tierName;
    document.querySelector(".win-time").textContent = fmtTime(currentMs());
    var s = statsFor(App.tierIndex);
    document.querySelector(".win-extra").textContent =
      "best " + (s.bestMs ? fmtTime(s.bestMs) : "—") + " · streak " + (s.currentStreak || 0);
    document.getElementById("win-overlay").classList.add("is-visible");
  }

  // ---- timer ----------------------------------------------------------------
  function currentMs() { return App.baseMs + (App.startedAt ? Date.now() - App.startedAt : 0); }
  function startTimer() {
    stopTimer();
    App.startedAt = Date.now();
    updateTimerLabel();
    App.timerId = setInterval(updateTimerLabel, 500);
  }
  function stopTimer() {
    if (App.timerId) { clearInterval(App.timerId); App.timerId = null; }
    if (App.startedAt) { App.baseMs = currentMs(); App.startedAt = 0; }
  }
  function updateTimerLabel() { var l = $(".hud-timer"); if (l) l.textContent = fmtTime(currentMs()); }

  // ---- menu -----------------------------------------------------------------
  function openMenu() {
    document.getElementById("menu-overlay").classList.add("is-visible");
    syncSettingsUi();
    var s = statsFor(App.tierIndex);
    var rate = s.played ? Math.round((100 * s.won) / s.played) : 0;
    var avg = s.won ? fmtTime(Math.round(s.sumMs / s.won)) : "—";
    document.querySelector(".menu-stats").innerHTML =
      App.tierName + " — played " + s.played + " · won " + s.won + " (" + rate + "%)<br>" +
      "best " + (s.bestMs ? fmtTime(s.bestMs) : "—") + " · avg " + avg +
      " · streak " + (s.currentStreak || 0) + " (best " + (s.bestStreak || 0) + ")";
  }
  function closeMenu() { document.getElementById("menu-overlay").classList.remove("is-visible"); }
  function syncSettingsUi() {
    ["violations", "sound", "haptics"].forEach(function (key) {
      var t = document.querySelector('.toggle[data-setting="' + key + '"]');
      if (t) t.classList.toggle("is-on", !!App.settings[key]);
    });
  }

  // ---- "the city goes to sleep": window fading ------------------------------
  // Windows darken nearest-first (reverse document order) as cells are shaded; the count
  // of dark windows tracks the count of shaded cells, so undo/circle relight exactly.
  function resetCitySleep() {
    for (var k = 0; k < App.winOrder.length; k++) {
      App.winOrder[k].style.opacity = App.winOrder[k].getAttribute("data-lit");
    }
    App.darkCount = 0;
  }
  function updateCitySleep() {
    if (!App.board) return;
    var shaded = 0, st = App.board.state;
    for (var i = 0; i < st.length; i++) if (st[i] === CellState.SHADED) shaded++;
    var target = Math.min(shaded, App.winOrder.length); // never wrap past the last window
    while (App.darkCount < target) { App.winOrder[App.darkCount].style.opacity = "0"; App.darkCount++; }
    while (App.darkCount > target) { App.darkCount--; var w = App.winOrder[App.darkCount]; w.style.opacity = w.getAttribute("data-lit"); }
  }

  // ---- shareable emoji grid (Wordle-style) ----------------------------------
  function shareResult() {
    var N = App.N, sol = App.solution, lines = [];
    for (var r = 0; r < N; r++) {
      var row = "";
      for (var c = 0; c < N; c++) row += sol[r * N + c] ? "⬛" : "⬜";
      lines.push(row);
    }
    var text = "Hitori — " + App.tierName + " " + N + "×" + N + "\n" + fmtTime(currentMs()) + "\n\n" + lines.join("\n");
    var btn = document.querySelector(".win-share");
    function done(ok) { btn.textContent = ok ? "Copied!" : "Copy failed"; setTimeout(function () { btn.textContent = "Share"; }, 1600); }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { done(true); }, function () { fallbackCopy(text, done); });
    } else fallbackCopy(text, done);
  }
  function fallbackCopy(text, done) {
    try {
      var ta = document.createElement("textarea");
      ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.focus(); ta.select();
      var ok = document.execCommand("copy");
      document.body.removeChild(ta); done(ok);
    } catch (e) { done(false); }
  }

  // ---- cold-start splash (once per launch; skip on tap) ---------------------
  function setupSplash() {
    var splash = document.getElementById("splash");
    if (sessionStorage.getItem("hitori.splashShown")) { splash.classList.add("is-hidden"); return; }
    function finish() {
      if (splash.classList.contains("is-hidden")) return;
      App.splashTimers.forEach(clearTimeout); App.splashTimers = [];
      sessionStorage.setItem("hitori.splashShown", "1");
      splash.classList.add("is-hidden");
    }
    splash.addEventListener("click", finish);       // skip on tap
    // The final I dims out (the title solves itself), then the splash fades away.
    App.splashTimers.push(setTimeout(function () { document.getElementById("splash-last").classList.add("is-solved"); }, 400));
    App.splashTimers.push(setTimeout(finish, 1000)); // 400ms + ~600ms hold
  }

  // ==========================================================================
  // INIT
  // ==========================================================================
  function init() {
    App.settings = loadSettings();
    document.body.classList.toggle("no-violations", !App.settings.violations);

    // Skyline windows, nearest-first (document order is far->near, so reverse it).
    App.winOrder = Array.prototype.slice.call(document.querySelectorAll("#skyline .win")).reverse();

    setupSplash();
    renderStart();
    showScreen("start");

    document.getElementById("board").addEventListener("click", onBoardClick);
    $(".btn-undo").addEventListener("click", undo);
    $(".btn-hint").addEventListener("click", showHint);
    $(".hud-menu").addEventListener("click", openMenu);

    // Menu actions
    $(".menu-restart").addEventListener("click", restart);
    $(".menu-new").addEventListener("click", newPuzzle);
    $(".menu-quit").addEventListener("click", quitToMenu);
    $(".menu-close").addEventListener("click", closeMenu);
    document.getElementById("menu-overlay").addEventListener("click", function (e) {
      if (e.target.id === "menu-overlay") closeMenu();
    });

    // Settings toggles
    var toggles = document.querySelectorAll(".toggle[data-setting]");
    for (var k = 0; k < toggles.length; k++) {
      toggles[k].addEventListener("click", function () {
        var key = this.getAttribute("data-setting");
        App.settings[key] = !App.settings[key];
        saveSettings();
        syncSettingsUi();
        if (key === "violations") {
          document.body.classList.toggle("no-violations", !App.settings.violations);
          if (App.settings.violations) showViolations(); else clearViolations();
        }
      });
    }

    // Win overlay actions
    $(".win-again").addEventListener("click", function () { newPuzzle(); });
    $(".win-share").addEventListener("click", shareResult);
    $(".win-menu").addEventListener("click", quitToMenu);

    window.addEventListener("resize", sizeBoard);

    // PWA service worker (cache-first app shell).
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("sw.js").catch(function () {});
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
