/*
 * ui.js — screens, overlays, rendering, and tap interaction.
 *
 * Screens are <section class="screen" id="screen-<name>"> elements that crossfade via
 * showScreen(name) while the skyline stays put (it only switches between its home and
 * play treatments). One generic sheet overlay (#overlay) serves Rules, Settings and any
 * later modal via showOverlay(html) / hideOverlay(); the in-game menu and the win panel
 * keep their own overlays.
 *
 * Every game, whatever its mode, starts or resumes through startGame(cfg):
 *   cfg = { mode: "free" | "level" | "daily", tier: 1..6, N, numbers, solution,
 *           level?, dailyKey?, startedKey? }
 *   plus, to RESUME a saved game, the save's { state, elapsedMs, moves, hintsUsed, tracker }.
 * The in-progress save (hitori.saveState) has the shape documented on migrateSave in
 * js/progress.js; old pre-update saves are upgraded by migrateSave before use.
 *
 * Depth + motion come from styles.css; this file only toggles classes and drives the
 * model in board.js. Game logic lives in the headless modules (rules, board, solver,
 * generator, explain, hints, progress, levels, daily, stats).
 */
(function () {
  "use strict";

  var LS = {
    settings: "hitori.settings",
    stats: "hitori.stats",
    save: "hitori.saveState",
    levels: "hitori.levels",
    daily: "hitori.daily",
    tutorialDone: "hitori.tutorialDone",
  };

  var App = {
    board: null,          // Board instance (board.js)
    solution: null,       // Int8Array shaded mask of the unique solution
    N: 0,
    mode: "free",         // "free" | "level" | "daily"
    tier: null,           // ladder tier 1..6
    level: null,          // level number (mode "level")
    dailyKey: null,       // "YYYY-MM-DD" of the daily puzzle (mode "daily")
    startedKey: null,     // local day the daily attempt began (onTime = startedKey === dailyKey)
    title: "",            // HUD / win / share title
    moves: 0,
    hintsUsed: 0,         // every Hint press this attempt (stars)
    tracker: null,        // lingering-mistake tracker (progress.js)
    undoStack: [],        // [{ i, prev }]
    won: false,
    lastTap: null,        // index of the last tapped cell (win sweep origin, nearest hint)
    timerId: null,
    startedAt: 0,
    baseMs: 0,            // accumulated elapsed ms (survives resume; paused time never lands here)
    paused: false,        // pauseGame(): clock stopped, board hidden, Paused overlay up
    settings: null,
    hint: null,           // the open staged hint (see renderHint), or null
    hintHeld: null,       // the hint put aside while paused; resumeGame shows it again
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
  /** "Sat 17 Oct" for a "YYYY-MM-DD" key. */
  function fmtDay(key) {
    var d = parseKey(key);
    var wd = d.toLocaleDateString("en-GB", { weekday: "short" });
    var mon = d.toLocaleDateString("en-GB", { month: "short" });
    return wd + " " + d.getDate() + " " + mon;
  }
  function tierName(t) { return TIERS[t] ? TIERS[t].name : ""; }
  function sizeLabel(n) { return n + "×" + n; }
  /** HUD / win title: tier name, "Hushed · Level 23" or "Daily · Sat 17 Oct". */
  function gameTitle(mode, tier, level, dailyKey) {
    if (mode === "level") return tierName(tier) + " · Level " + level;
    if (mode === "daily") return "Daily · " + fmtDay(dailyKey);
    return tierName(tier);
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
  /** The in-progress save; shape documented on migrateSave (js/progress.js). */
  function saveGame() {
    if (!App.board || App.won) return;
    var s = {
      mode: App.mode, tier: App.tier, N: App.N,
      numbers: Array.from(App.board.numbers),
      solution: Array.from(App.solution),
      state: Array.from(App.board.state),
      elapsedMs: currentMs(), moves: App.moves,
      hintsUsed: App.hintsUsed, tracker: App.tracker,
      savedAt: Date.now(),
    };
    if (App.level != null) s.level = App.level;
    if (App.dailyKey != null) s.dailyKey = App.dailyKey;
    if (App.startedKey != null) s.startedKey = App.startedKey;
    writeJSON(LS.save, s);
  }
  function clearSave() { try { localStorage.removeItem(LS.save); } catch (e) {} }
  /** The resumable save in the current shape (old saves migrated), or null. */
  function loadSave() { return migrateSave(readJSON(LS.save, null)); }

  // Free-play records (hitori.stats). Levels and dailies never touch them.
  function blankStats() { return { played: 0, won: 0, bestMs: 0, sumMs: 0, currentStreak: 0, bestStreak: 0 }; }
  function statsFor(t) { var s = readJSON(LS.stats, {}); return s[t] || blankStats(); }
  /** Starting a new game over an unsolved free-play save abandons it: that tier's streak breaks. */
  function recordAbandon(prev) {
    if (!prev || prev.mode !== "free") return;
    var s = readJSON(LS.stats, {});
    var e = s[prev.tier] || (s[prev.tier] = blankStats());
    e.currentStreak = 0;
    writeJSON(LS.stats, s);
  }
  function recordStart(t) {
    var s = readJSON(LS.stats, {});
    var e = s[t] || (s[t] = blankStats());
    e.played++;
    writeJSON(LS.stats, s);
  }
  function recordWin() {
    var s = readJSON(LS.stats, {});
    var e = s[App.tier] || (s[App.tier] = blankStats());
    var ms = currentMs();
    e.won++; e.sumMs += ms;
    if (!e.bestMs || ms < e.bestMs) e.bestMs = ms;
    e.currentStreak = (e.currentStreak || 0) + 1;
    if (e.currentStreak > e.bestStreak) e.bestStreak = e.currentStreak;
    writeJSON(LS.stats, s);
  }

  // ---- screens (crossfade; skyline stays) + the generic overlay -------------
  /** Show section#screen-<name>; every other section.screen fades out. */
  function showScreen(name) {
    var screens = document.querySelectorAll("section.screen");
    for (var k = 0; k < screens.length; k++) {
      screens[k].classList.toggle("screen--active", screens[k].id === "screen-" + name);
    }
    setSkyline(name === "play" ? "play" : "start");
  }
  /** Fill the sheet overlay with html and show it. [data-close] inside closes it. */
  function showOverlay(html) {
    document.getElementById("overlay-panel").innerHTML = html;
    document.getElementById("overlay").classList.add("is-visible");
  }
  function hideOverlay() {
    document.getElementById("overlay").classList.remove("is-visible");
  }

  /** Stand-in screen for parts built in later tasks (Levels, Daily, Stats, How to play). */
  function showSoon(title) {
    $(".soon-title").textContent = title;
    hideOverlay();
    showScreen("soon");
  }
  function goHome() {
    hideOverlay();
    renderHome();
    showScreen("home");
  }

  // ==========================================================================
  // HOME SCREEN (spec §1 Home: Continue, Daily, Learn, Levels, Free play, footer)
  // ==========================================================================
  function continueSubtitle(s) {
    var parts = [];
    if (s.mode === "daily") parts.push("Daily", fmtDay(s.dailyKey));
    else {
      parts.push(tierName(s.tier));
      if (s.mode === "level") parts.push("Level " + s.level);
    }
    parts.push(sizeLabel(s.N), fmtTime(s.elapsedMs || 0));
    return parts.join(" · ");
  }

  function arrow(cls) { return '<span class="hc-arrow' + (cls ? " " + cls : "") + '" aria-hidden="true">→</span>'; }

  function renderHome() {
    var list = document.getElementById("home-list");
    var html = "";

    // 1. Continue — only when a resumable save exists.
    var save = loadSave();
    if (save) {
      html += '<button class="home-card home-card--continue" data-nav="continue">' +
        '<span class="hc-text"><span class="hc-main">Continue</span>' +
        '<span class="hc-sub">' + continueSubtitle(save) + "</span></span>" + arrow() + "</button>";
    }

    // 2. Daily — tear-off calendar tile, today's size and the streak.
    var today = dateKey(new Date());
    var drec = readJSON(LS.daily, {});
    var dTier = dailyTier(today), dN = TIERS[dTier].size;
    var streak = currentStreak(drec, today);
    var tday = parseKey(today);
    var dSub = fmtDay(today) + " · " + (drec[today] ? "solved ✓ · new one tomorrow" : sizeLabel(dN)) +
      (streak ? " · 🔥 " + streak : "");
    html += '<button class="home-card home-card--daily" data-nav="daily">' +
      '<span class="dc-tile" aria-hidden="true"><span class="dc-mon">' +
      tday.toLocaleDateString("en-GB", { month: "short" }).toUpperCase() + '</span>' +
      '<span class="dc-day">' + tday.getDate() + "</span></span>" +
      '<span class="hc-text"><span class="hc-main">Daily puzzle</span>' +
      '<span class="hc-sub">' + dSub + "</span></span>" + arrow() + "</button>";

    // 3. First run only, until the tutorial is finished or skipped.
    if (!readJSON(LS.tutorialDone, false)) {
      html += '<button class="home-card home-card--learn" data-nav="howto">' +
        '<span class="hc-badge" aria-hidden="true">?</span>' +
        '<span class="hc-text"><span class="hc-main">New here? Learn to play</span>' +
        '<span class="hc-sub">three rules, two minutes</span></span>' + arrow() + "</button>";
    }

    // 4. Levels — every tier's progress, summed.
    var lp = readJSON(LS.levels, {});
    var total = 0, solved = 0, stars = 0;
    for (var t = 1; t <= 6; t++) {
      var count = levelCount(t);
      var sum = tierSummary(lp[t], count);
      total += count; solved += sum.solved; stars += sum.stars;
    }
    var pct = solved ? Math.max(2, Math.round((100 * solved) / total)) : 0;
    html += '<button class="home-card home-card--levels" data-nav="levels">' +
      '<span class="hc-badge" aria-hidden="true">★</span>' +
      '<span class="hc-text"><span class="hc-main">Levels</span>' +
      '<span class="hc-sub">' + solved + " / " + total + " solved · ★ " + stars + "</span>" +
      '<span class="lv-bar" aria-hidden="true"><span style="width:' + pct + '%"></span></span></span>' +
      arrow() + "</button>";

    // 5. Free play — the six tiers as before (name, size, best time).
    html += '<div class="section-label">Free play</div><div class="tier-list">';
    var fstats = readJSON(LS.stats, {});
    for (var ft = 1; ft <= 6; ft++) {
      var best = fstats[ft] && fstats[ft].bestMs ? fmtTime(fstats[ft].bestMs) : "—";
      html += '<button class="tier" data-tier="' + ft + '">' +
        '<span class="tier-name">' + TIERS[ft].name + "</span>" +
        '<span class="tier-meta"><span class="tier-size">' + sizeLabel(TIERS[ft].size) + "</span>" +
        '<span class="tier-best">' + best + "</span></span></button>";
    }
    html += "</div>";

    // 6. Footer.
    html += '<nav class="home-footer">' +
      '<button data-nav="howto">How to play</button>' +
      '<button data-nav="rules">Rules</button>' +
      '<button data-nav="stats">Stats</button>' +
      '<button data-nav="settings">Settings</button></nav>';

    list.innerHTML = html;
  }

  function onHomeClick(ev) {
    var tierBtn = ev.target.closest(".tier[data-tier]");
    if (tierBtn) { onTierTap(tierBtn); return; }
    var nav = ev.target.closest("[data-nav]");
    if (!nav) return;
    switch (nav.getAttribute("data-nav")) {
      case "continue": resumeSaved(); break;
      case "daily": showSoon("Daily puzzle"); break;   // Task 13
      case "levels": showSoon("Levels"); break;        // Task 12
      case "stats": showSoon("Stats"); break;          // Task 14
      case "howto": showSoon("How to play"); break;    // Task 15
      case "rules": openRules(); break;
      case "settings": openSettings(); break;
    }
  }

  function onTierTap(btn) {
    if (btn.classList.contains("is-working")) return;
    var t = parseInt(btn.getAttribute("data-tier"), 10);
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
  }

  // ---- Rules + Settings overlays -------------------------------------------
  function openRules() {
    showOverlay(
      '<div class="sheet-head"><span class="sheet-title">The rules</span>' +
      '<button class="sheet-x" data-close aria-label="Close">✕</button></div>' +
      '<ol class="rules-list">' +
      "<li>Shade cells so that no number repeats among the <b>lit</b> cells of any row or column.</li>" +
      "<li>Shaded cells never touch side by side (corners are fine).</li>" +
      "<li>All lit cells stay connected in one piece.</li>" +
      "</ol>" +
      '<p class="rules-note">Every puzzle has one answer, reachable by logic alone.</p>' +
      '<div class="sheet-buttons">' +
      '<button class="btn btn--secondary" data-nav="howto">Tutorial</button>' +
      '<button class="btn btn--primary" data-close>Got it</button></div>');
  }

  /** The settings rows, shared by the home Settings sheet and the in-game menu. */
  function renderSettingsRows() {
    function row(key, label) {
      var on = !!App.settings[key];
      return '<div class="setting-row"><span>' + label + "</span>" +
        '<button class="toggle' + (on ? " is-on" : "") + '" data-setting="' + key +
        '" role="switch" aria-checked="' + on + '" aria-label="' + label + '"><span class="knob"></span></button></div>';
    }
    return row("violations", "Show rule violations") + row("sound", "Sound") + row("haptics", "Haptics") +
      '<div class="setting-row"><span>Version</span><span class="setting-value app-version">…</span></div>';
  }

  /* The installed version = the service worker's cache name (sw.js CACHE_NAME, e.g.
   * "hitori-v2"). sw.js deletes older caches on activate, so the newest one present is
   * what this device runs; reading it keeps the number in exactly one place. */
  function showAppVersion() {
    var els = document.querySelectorAll(".app-version");
    function set(txt) { for (var k = 0; k < els.length; k++) els[k].textContent = txt; }
    if (!els.length) return;
    if (!window.caches) { set("not installed"); return; }
    caches.keys().then(function (keys) {
      var nums = keys.map(function (k) { var m = /^hitori-v(\d+)$/.exec(k); return m ? +m[1] : 0; })
        .filter(Boolean);
      set(nums.length ? "v" + Math.max.apply(null, nums) : "not installed");
    }, function () { set("unknown"); });
  }

  function openSettings() {
    showOverlay(
      '<div class="sheet-head"><span class="sheet-title">Settings</span>' +
      '<button class="sheet-x" data-close aria-label="Close">✕</button></div>' +
      '<div class="settings">' + renderSettingsRows() + "</div>" +
      '<div class="sheet-buttons"><button class="btn btn--primary" data-close>Close</button></div>');
    showAppVersion();
  }

  function toggleSetting(key) {
    App.settings[key] = !App.settings[key];
    saveSettings();
    syncSettingsUi();
    if (key === "violations") {
      document.body.classList.toggle("no-violations", !App.settings.violations);
      if (App.board && !App.won) { if (App.settings.violations) showViolations(); else clearViolations(); }
    }
  }

  // ==========================================================================
  // PLAY: build + render
  // ==========================================================================
  /** Free play: generate a fresh puzzle for ladder tier t and start it. */
  function startTier(t) {
    var puzzle = generateTier(t);
    if (!puzzle || puzzle.failed) {
      // Extremely unlikely given the sweep; retry once, then bail gracefully.
      puzzle = generateTier(t);
      if (!puzzle || puzzle.failed) { alert("Could not build a puzzle — please try again."); return; }
    }
    startGame({ mode: "free", tier: t, N: puzzle.N, numbers: puzzle.numbers, solution: puzzle.solution });
  }

  /**
   * The single entry point for every game (free, level, daily), new or resumed.
   * cfg = { mode, tier, N, numbers, solution, level?, dailyKey?, startedKey? }; a cfg that
   * also carries `state` (a migrated save) resumes with its elapsedMs, moves, hintsUsed and
   * tracker instead of starting fresh.
   */
  function startGame(cfg) {
    var resume = !!cfg.state;
    if (!resume) {
      recordAbandon(loadSave());              // overwriting an unsolved free game breaks its streak
      if (cfg.mode === "free") recordStart(cfg.tier);
    }
    clearHint();
    App.mode = cfg.mode || "free";
    App.tier = cfg.tier;
    App.level = cfg.level != null ? cfg.level : null;
    App.dailyKey = cfg.dailyKey || null;
    App.startedKey = cfg.startedKey || null;
    App.title = gameTitle(App.mode, App.tier, App.level, App.dailyKey);
    App.board = new Board(cfg.N, cfg.numbers, resume ? cfg.state : undefined);
    App.solution = Int8Array.from(cfg.solution);
    App.N = cfg.N;
    App.moves = resume ? cfg.moves || 0 : 0;
    App.hintsUsed = resume ? cfg.hintsUsed || 0 : 0;
    App.tracker = resume && cfg.tracker ? cfg.tracker : newMistakeTracker();
    App.undoStack = [];
    App.won = false;
    App.lastTap = null;
    App.startedAt = 0;
    App.baseMs = resume ? cfg.elapsedMs || 0 : 0;
    setPaused(false);

    // HUD
    $(".hud-tier").textContent = App.title;
    $(".hud-size").textContent = sizeLabel(App.N);
    updateHudSub();
    document.getElementById("win-overlay").classList.remove("is-visible");
    document.getElementById("skyline").classList.remove("skyline--asleep");
    hideOverlay();
    closeMenu();

    buildBoardDom();
    renderAllCells();
    resetCitySleep();        // the whole city is awake again...
    updateCitySleep();       // ...minus one window per shaded cell on a resumed board
    if (App.settings.violations) showViolations();
    startTimer();            // resumes from baseMs
    showScreen("play");
    sizeBoard();
    saveGame();
  }

  // Resume the in-progress game from localStorage (Continue card).
  function resumeSaved() {
    var s = loadSave();
    if (!s) { renderHome(); return; }
    startGame(s);
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
      // Walk-through ghost layer: drawn by .ghost-shade / .ghost-lit on the cell, never
      // by the cell's real state.
      cell.appendChild(el("span", "ghost"));
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

  /** Fit the square board to the flexible middle zone: the smaller of its width and height. */
  function sizeBoard() {
    var board = document.getElementById("board");
    var zone = board && board.parentNode;
    if (!board || !zone || !App.N) return;
    var size = Math.floor(Math.min(zone.clientWidth, zone.clientHeight));
    if (size <= 0) return;
    board.style.width = size + "px";
    board.style.height = size + "px";
    board.style.fontSize = Math.round((size / App.N) * 0.46) + "px";
  }

  /** Sub-row: stars still in play (levels and daily only) and the move count. */
  function updateHudSub() {
    var stars = "";
    if (App.mode !== "free" && App.tracker) {
      var n = computeStars(App.hintsUsed, App.tracker.mistakes || 0);
      stars = "★★★".slice(0, n) + "☆☆☆".slice(0, 3 - n) + " in play";
    }
    $(".hud-stars").textContent = stars;
    $(".hud-moves").textContent = "moves " + App.moves;
  }

  // ==========================================================================
  // TAP -> cycle state
  // ==========================================================================
  function onBoardClick(ev) {
    if (App.won || App.paused) return;
    var cell = ev.target.closest ? ev.target.closest(".cell") : null;
    if (!cell) return;
    // During a walk-through a tap only closes it (the ghosts go, no mark changes). Either
    // way a board tap ends the current hint, so the next press starts at stage 1 again.
    if (App.hint && App.hint.walk) { clearHint(); return; }
    clearHint();
    var i = parseInt(cell.getAttribute("data-i"), 10);
    var prev = App.board.getState(i);
    var next = App.board.cycle(i);
    App.undoStack.push({ i: i, prev: prev });
    App.moves++;
    App.lastTap = i;
    trackMove(App.tracker, App.board.state, App.solution);

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
    updateHudSub();
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
    if (App.won || App.paused || !App.undoStack.length) return;
    clearHint();
    var m = App.undoStack.pop();
    App.board.setState(m.i, m.prev);
    App.moves++;
    App.lastTap = m.i;
    trackMove(App.tracker, App.board.state, App.solution);
    Sound.click(); haptic(10);
    renderCell(m.i);
    updateCitySleep();
    updateHudSub();
    if (App.settings.violations) showViolations();
    saveGame();
  }

  /** Restart asks first; its Restart button calls restart(). */
  function askRestart() {
    if (!App.board || App.won) return;
    closeMenu();
    showOverlay(
      '<div class="sheet-head"><span class="sheet-title">Restart?</span>' +
      '<button class="sheet-x" data-close aria-label="Close">✕</button></div>' +
      '<p class="sheet-text">Clear every mark and start this puzzle again. The clock and hints start over too.</p>' +
      '<div class="sheet-buttons">' +
      '<button class="btn btn--secondary" data-close>Cancel</button>' +
      '<button class="btn btn--primary" data-act="restart">Restart</button></div>');
  }

  /** A fresh attempt at the same puzzle: marks, clock, hintsUsed and the mistake tracker reset. */
  function restart() {
    if (!App.board) return;
    hideOverlay();
    setPaused(false);
    for (var i = 0; i < App.N * App.N; i++) App.board.setState(i, CellState.UNMARKED);
    App.undoStack = [];
    App.moves = 0;
    App.hintsUsed = 0;                    // a restart is a fresh attempt (spec: stars)
    App.tracker = newMistakeTracker();
    App.won = false;
    App.lastTap = null;
    document.getElementById("win-overlay").classList.remove("is-visible");
    document.getElementById("skyline").classList.remove("skyline--asleep");
    renderAllCells();
    resetCitySleep();
    // strip any transient animation classes left over
    var nodes = document.querySelectorAll("#board .cell");
    for (var d = 0; d < nodes.length; d++) nodes[d].classList.remove("dip", "win-lit", "win-vanish");
    clearViolations();
    clearHint();
    stopTimer();
    App.startedAt = 0;      // so startTimer's stopTimer can't fold the old run back into baseMs
    App.baseMs = 0;
    startTimer();
    updateHudSub();
    closeMenu();
    saveGame();
  }

  // Free play only: another puzzle of the same tier. Level/daily "next" flows are Tasks 12/13.
  function newPuzzle() {
    closeMenu();
    if (App.mode === "free") startTier(App.tier); else quitToMenu();
  }

  function quitToMenu() {
    stopTimer();
    setPaused(false);       // the clock is already stopped; unhide the board for next time
    saveGame();        // no-op after a win (save already cleared); keeps mid-game resumable
    closeMenu();
    goHome();          // re-renders home, so Continue appears when a game is in progress
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

  // ---- hints: three stages + the walk-through (spec §2) ----------------------
  // App.hint = null | { h, stage, walk, fix }. h is nextHint()'s result for the board as
  // it was when Hint was first pressed; any board change (tap, undo, an applied hint)
  // drops it. Explanations inside h are cached and shared by hints.js: read-only here.
  //   deduction: 1 nudge (short + evidence) -> 2 explain (text + dashed target; T5/T6 can
  //              "walk me through it") -> 3 apply the move
  //   mistake:   1 nudge -> 2 explain -> 3 clear the wrong mark(s) in `fix`
  //   stuck:     1 reveal (text + target) -> 2 apply
  // Ghosts and outlines are classes on the cells, drawn by each cell's own .ghost layer and
  // outline; renderCell and App.board.state never see them, so clearing them restores the
  // board exactly.
  var HINT_CLASSES = ["hint-ev", "hint-tg", "hint-clash", "ghost-shade", "ghost-lit"];

  function hintStages(h) { return h.kind === "stuck" ? 2 : h.kind === "done" ? 1 : 3; }
  function hintCell(i) { return document.querySelector('#board .cell[data-i="' + i + '"]'); }
  function markCells(list, cls) {
    for (var k = 0; k < list.length; k++) { var c = hintCell(list[k]); if (c) c.classList.add(cls); }
  }
  function isWrongCell(i) {
    var s = App.board.getState(i);
    return (s === CellState.SHADED && !App.solution[i]) || (s === CellState.CIRCLED && !!App.solution[i]);
  }
  /** Marks a mistake hint clears at stage 3: the wrong ones among its cells, else the wrong
   *  mark nearest them (a "split" names the lit cells, not the shading that splits them). */
  function mistakeFix(h) {
    var fix = h.cells.filter(isWrongCell);
    if (fix.length) return fix;
    var area = { i: h.cells[0], evidence: h.cells }, best = -1, bd = Infinity;
    for (var i = 0; i < App.N * App.N; i++) {
      if (!isWrongCell(i)) continue;
      var d = distanceTo(area, i, App.N);
      if (d < bd) { bd = d; best = i; }
    }
    return best >= 0 ? [best] : [];
  }

  /** Remove every hint outline and ghost from the board, and leave walk mode. */
  function clearHintMarks() {
    for (var k = 0; k < HINT_CLASSES.length; k++) {
      var nodes = document.querySelectorAll("#board .cell." + HINT_CLASSES[k]);
      for (var m = 0; m < nodes.length; m++) nodes[m].classList.remove(HINT_CLASSES[k]);
    }
    document.getElementById("screen-play").classList.remove("is-walking", "can-walk");
  }
  /** Drop the current hint (board changed, restart, new game, win): the rules come back. */
  function clearHint() {
    App.hint = null;
    App.hintHeld = null;
    clearHintMarks();
    document.getElementById("hint-toast").classList.remove("is-visible");
    document.getElementById("hint-box").classList.remove("has-hint");   // idle: the rules again
  }

  function esc(t) { return String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }

  /** Draw App.hint (its stage, or its walk-through frame) into the hint box and onto the board. */
  function renderHint() {
    clearHintMarks();
    var toast = document.getElementById("hint-toast"), box = document.getElementById("hint-box");
    var H = App.hint;
    if (!H) { toast.classList.remove("is-visible"); box.classList.remove("has-hint"); return; }
    var h = H.h, label = "Hint", count = H.stage + " / " + hintStages(h), body = "", foot = "";

    if (H.walk) {
      var fr = H.walk.frames, k = H.walk.k, f = fr[k], lastF = k === fr.length - 1;
      var clashF = lastF && !!h.exp.clash;
      label = "Walk-through · " + (k === 0 ? "Suppose" : clashF ? "Clash" : f.technique || "Step");
      count = (k + 1) + " / " + fr.length;
      body = esc(f.text);
      // Footnote on the first and last frames only, so the step text keeps the room.
      foot = lastF ? "Close to go back to the hint"
        : k === 0 ? "Ghost marks are only a “what if”." : "";
      for (var g in f.ghosts) {
        if (Object.prototype.hasOwnProperty.call(f.ghosts, g)) {
          markCells([+g], f.ghosts[g] === SolveCell.BLACK ? "ghost-shade" : "ghost-lit");
        }
      }
      markCells(f.focus, clashF ? "hint-clash" : "hint-ev");
      markCells([f.i], "hint-tg");
      document.getElementById("screen-play").classList.add("is-walking");
      $(".walk-back").disabled = k === 0;
      $(".walk-next").disabled = lastF;
    } else if (h.kind === "deduction") {
      var e = h.exp;
      label = "Hint · " + e.technique;
      if (H.stage === 1) {
        body = esc(e.short);
        foot = "tap Hint again for the reason";
        markCells(e.evidence, "hint-ev");
      } else {
        body = esc(e.text);
        foot = "tap Hint again to " + (e.value === SolveCell.BLACK ? "shade it" : "mark it lit");
        // T5/T6: a full-size Walk button joins the thumb row (a 44px+ target; an inline
        // link in the 86px box can't be one).
        if (e.chain) {
          foot += ", or Walk to see each step";
          document.getElementById("screen-play").classList.add("can-walk");
        }
        markCells(e.evidence, "hint-ev");
        markCells([e.i], "hint-tg");
      }
    } else if (h.kind === "mistake") {
      label = "Hint · Mistake";
      if (H.stage === 1) {
        body = h.cells.length > 1 ? "Something in the outlined cells breaks a rule. Can you spot it?"
          : "Take another look at the outlined cell.";
        foot = "tap Hint again for the reason";
        markCells(h.cells, "hint-ev");
      } else {
        body = esc(h.text);
        foot = H.fix.length ? "tap Hint again to clear " + (H.fix.length > 1 ? "those marks" : "that mark") : "";
        markCells(h.cells, "hint-ev");
        markCells(H.fix, "hint-tg");
      }
    } else if (h.kind === "stuck") {
      label = "Hint · Reveal";
      body = esc(h.text);
      foot = "tap Hint again to " + (h.value === SolveCell.BLACK ? "shade it" : "mark it lit");
      markCells([h.i], "hint-tg");
    } else {
      body = "Every shaded cell is already in place.";
      count = "";
    }
    toast.innerHTML = '<div class="hint-head"><span>' + esc(label) + "</span><span>" + count + "</span></div>" +
      '<div class="hint-body">' + body + "</div>" + (foot ? '<div class="hint-foot">' + foot + "</div>" : "");
    toast.classList.add("is-visible");
    box.classList.add("has-hint");
    var bodyEl = toast.querySelector(".hint-body");
    if (bodyEl) bodyEl.scrollTop = 0;
  }

  /** The Hint button: open stage 1, advance a stage, or apply the move. Every press counts. */
  function showHint() {
    if (App.won || App.paused || !App.board) return;
    if (App.hint && App.hint.walk) return;           // the walk-through has its own controls
    App.hintsUsed++;                                 // every press counts (stars)
    var H = App.hint;
    if (!H) {
      var h = nextHint(App.board.state, App.board.numbers, App.N, App.solution, App.lastTap);
      H = App.hint = { h: h, stage: 1, walk: null, fix: [] };
      if (h.kind === "mistake") {
        H.fix = mistakeFix(h);
        // A hint pointing at a wrong mark counts it as a mistake. flagMistake only counts a
        // cell trackMove has already seen wrong (not yet, e.g., on a migrated save), so let
        // trackMove see the board first when it hasn't.
        var unseen = H.fix.some(function (i) { return App.tracker.wrongSince[i] === undefined; });
        if (unseen) trackMove(App.tracker, App.board.state, App.solution);
        for (var k = 0; k < H.fix.length; k++) flagMistake(App.tracker, H.fix[k]);
      }
    } else if (H.stage < hintStages(H.h) - 1) {    // the last press applies; it has no view
      H.stage++;
    } else {
      applyHint(H);
      updateHudSub();
      return;
    }
    renderHint();
    updateHudSub();
    saveGame();
  }

  /** Final stage: make the move the hint explained, as ordinary undoable moves. */
  function applyHint(H) {
    var h = H.h, moves = [];
    if (h.kind === "deduction") {
      moves.push({ i: h.exp.i, next: h.exp.value === SolveCell.BLACK ? CellState.SHADED : CellState.CIRCLED });
    } else if (h.kind === "stuck") {
      moves.push({ i: h.i, next: h.value === SolveCell.BLACK ? CellState.SHADED : CellState.CIRCLED });
    } else if (h.kind === "mistake") {
      H.fix.forEach(function (i) { moves.push({ i: i, next: CellState.UNMARKED }); });
    }
    clearHint();
    if (!moves.length) { saveGame(); return; }
    for (var k = 0; k < moves.length; k++) {
      var m = moves[k];
      App.undoStack.push({ i: m.i, prev: App.board.getState(m.i) });
      App.board.setState(m.i, m.next);
      App.moves++;
      App.lastTap = m.i;
      trackMove(App.tracker, App.board.state, App.solution);
      renderCell(m.i);
    }
    if (moves[moves.length - 1].next === CellState.CIRCLED) Sound.tick(); else Sound.click();
    updateCitySleep();
    if (App.settings.violations) showViolations();
    saveGame();
    checkWin();
  }

  // ---- the walk-through: Next / Back over walkFrames, as ghosts only -------------
  function openWalk() {
    var H = App.hint;
    if (!H || H.h.kind !== "deduction" || !H.h.exp.chain || App.paused) return;
    var frames = walkFrames(H.h.exp);
    if (!frames.length) return;
    H.walk = { frames: frames, k: 0 };
    renderHint();
  }
  function stepWalk(d) {
    var H = App.hint;
    if (!H || !H.walk) return;
    H.walk.k = Math.max(0, Math.min(H.walk.frames.length - 1, H.walk.k + d));
    renderHint();
  }
  /** Close the walk-through: the ghosts go and the hint is back at stage 2. */
  function closeWalk() {
    if (!App.hint || !App.hint.walk) return;
    App.hint.walk = null;
    renderHint();
  }

  /** Pause: hide the hint's marks but keep the (paid-for) hint, to show again on resume. */
  function suspendHint() {
    var held = App.hint;
    clearHint();
    if (held) { held.walk = null; App.hintHeld = held; }   // a walk-through closes to stage 2
  }
  function restoreHint() {
    if (!App.hintHeld) return;
    App.hint = App.hintHeld;
    App.hintHeld = null;
    renderHint();
  }

  // ---- win ------------------------------------------------------------------
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
    if (App.mode === "free") recordWin();   // level/daily records: Tasks 12/13
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
    document.querySelector(".win-tier").textContent = App.title;
    document.querySelector(".win-time").textContent = fmtTime(currentMs());
    var extra = "";
    if (App.mode === "free") {
      var s = statsFor(App.tier);
      extra = "best " + (s.bestMs ? fmtTime(s.bestMs) : "—") + " · streak " + (s.currentStreak || 0);
    }
    document.querySelector(".win-extra").textContent = extra;
    $(".win-again").style.display = App.mode === "free" ? "" : "none";
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

  // ---- pause (TicTacLogic semantics) ----------------------------------------
  // stopTimer() folds the running time into baseMs and startTimer() restarts from there,
  // so the paused stretch never counts.
  function setPaused(on) {
    App.paused = on;
    document.getElementById("screen-play").classList.toggle("is-paused", on);
  }
  function isPlaying() {
    return !!App.board && !App.won && document.getElementById("screen-play").classList.contains("screen--active");
  }
  function pauseGame() {
    if (!isPlaying() || App.paused) return;
    stopTimer();
    updateTimerLabel();
    setPaused(true);
    suspendHint();          // ghosts and outlines go; the same hint comes back on resume
    closeMenu();
    saveGame();
    showOverlay(
      '<div class="pause-panel"><div class="sheet-title">Paused</div>' +
      '<div class="pause-time">' + fmtTime(currentMs()) + "</div>" +
      '<div class="pause-label">on the clock</div>' +
      '<div class="sheet-buttons">' +
      '<button class="btn btn--secondary" data-act="pause-home">Home</button>' +
      '<button class="btn btn--primary" data-act="resume">Resume</button></div></div>');
  }
  function resumeGame() {
    if (!App.paused) return;
    setPaused(false);
    hideOverlay();
    startTimer();
    restoreHint();
  }
  /** Backdrop, close buttons and Escape: a paused game resumes; any other sheet just closes. */
  function dismissOverlay() {
    if (App.paused) resumeGame(); else hideOverlay();
  }
  /** Leaving the app mid-game pauses it (and saves), so time spent elsewhere never counts. */
  function pauseIfPlaying() { if (isPlaying()) pauseGame(); }

  // ---- menu -----------------------------------------------------------------
  function openMenu() {
    document.getElementById("menu-settings").innerHTML = renderSettingsRows();
    showAppVersion();
    var stats = "";
    if (App.mode === "free") {
      var s = statsFor(App.tier);
      var rate = s.played ? Math.round((100 * s.won) / s.played) : 0;
      var avg = s.won ? fmtTime(Math.round(s.sumMs / s.won)) : "—";
      stats = App.title + " — played " + s.played + " · won " + s.won + " (" + rate + "%)<br>" +
        "best " + (s.bestMs ? fmtTime(s.bestMs) : "—") + " · avg " + avg +
        " · streak " + (s.currentStreak || 0) + " (best " + (s.bestStreak || 0) + ")";
    }
    document.querySelector(".menu-stats").innerHTML = stats;
    $(".menu-new").style.display = App.mode === "free" ? "" : "none";
    document.getElementById("menu-overlay").classList.add("is-visible");
  }
  function closeMenu() { document.getElementById("menu-overlay").classList.remove("is-visible"); }
  function syncSettingsUi() {
    var toggles = document.querySelectorAll(".toggle[data-setting]");
    for (var k = 0; k < toggles.length; k++) {
      var on = !!App.settings[toggles[k].getAttribute("data-setting")];
      toggles[k].classList.toggle("is-on", on);
      toggles[k].setAttribute("aria-checked", on);
    }
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
    var text = "Hitori — " + App.title + " " + N + "×" + N + "\n" + fmtTime(currentMs()) + "\n\n" + lines.join("\n");
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
    renderHome();
    showScreen("home");

    // Home cards, tiers and footer; the sheet overlay can route too (Rules -> Tutorial).
    document.getElementById("home-list").addEventListener("click", onHomeClick);
    $(".soon-back").addEventListener("click", goHome);
    document.getElementById("overlay").addEventListener("click", function (e) {
      if (e.target.id === "overlay" || e.target.closest("[data-close]")) { dismissOverlay(); return; }
      var act = e.target.closest("[data-act]");
      if (act) {
        switch (act.getAttribute("data-act")) {
          case "resume": resumeGame(); break;
          case "pause-home": quitToMenu(); break;
          case "restart": restart(); break;
        }
        return;
      }
      onHomeClick(e);
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") {
        if (document.getElementById("menu-overlay").classList.contains("is-visible")) { closeMenu(); return; }
        if (App.hint && App.hint.walk && !App.paused) { closeWalk(); return; }
        dismissOverlay(); closeMenu();
      }
    });

    document.getElementById("board").addEventListener("click", onBoardClick);
    $(".btn-undo").addEventListener("click", undo);
    $(".btn-hint").addEventListener("click", showHint);
    $(".btn-pause").addEventListener("click", pauseGame);
    $(".walk-pause").addEventListener("click", pauseGame);
    $(".walk-back").addEventListener("click", function () { stepWalk(-1); });
    $(".walk-next").addEventListener("click", function () { stepWalk(1); });
    $(".walk-close").addEventListener("click", closeWalk);
    $(".btn-walk").addEventListener("click", openWalk);
    $(".hud-home").addEventListener("click", quitToMenu);
    $(".hud-menu").addEventListener("click", openMenu);

    // Menu actions
    $(".menu-restart").addEventListener("click", askRestart);
    $(".menu-new").addEventListener("click", newPuzzle);
    $(".menu-quit").addEventListener("click", quitToMenu);
    $(".menu-close").addEventListener("click", closeMenu);
    document.getElementById("menu-overlay").addEventListener("click", function (e) {
      if (e.target.id === "menu-overlay") closeMenu();
    });

    // Settings toggles, wherever their rows are rendered (home sheet or in-game menu).
    document.addEventListener("click", function (e) {
      var t = e.target.closest ? e.target.closest(".toggle[data-setting]") : null;
      if (t) toggleSetting(t.getAttribute("data-setting"));
    });

    // Win overlay actions
    $(".win-again").addEventListener("click", function () { newPuzzle(); });
    $(".win-share").addEventListener("click", shareResult);
    $(".win-menu").addEventListener("click", quitToMenu);

    window.addEventListener("resize", sizeBoard);
    // Auto-pause (and save) when the app is hidden or closed mid-game.
    window.addEventListener("pagehide", pauseIfPlaying);
    document.addEventListener("visibilitychange", function () { if (document.hidden) pauseIfPlaying(); });

    // PWA service worker (cache-first app shell).
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("sw.js").catch(function () {});
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
