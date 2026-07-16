/*
 * board.js — Hitori data model.
 *
 * Separates three distinct things that must never be conflated:
 *   - numbers      the immutable puzzle digits (fixed once a puzzle is generated)
 *   - state        the player's marks (unmarked / shaded / circled), mutable
 *   - shadedMask   a candidate *solution* mask, used by rules.js / solver / generator
 *
 * All geometry is index-based (i = r * N + c) to stay allocation-light on the 10x10 tier.
 * No DOM here — this file is headless and node-testable.
 */

// Pull rules.js in under Node ONLY. Assign onto global rather than declaring new
// bindings — declaring `const { ... } = require(...)` here would collide with the
// ambient globals the <script> tag creates in the browser and throw a duplicate-
// declaration SyntaxError. In the browser, rules.js already ran, so its names exist.
if (typeof module !== "undefined") Object.assign(global, require("./rules.js"));

// Three cell states, cycled by tap. Circled = "confirmed white" (the pencil mark).
const CellState = { UNMARKED: 0, SHADED: 1, CIRCLED: 2 };

class Board {
  /**
   * @param {number} N        grid size (N x N)
   * @param {number[]} numbers  length N*N, row-major puzzle digits
   * @param {Int8Array|number[]} [state]  optional initial player marks
   */
  constructor(N, numbers, state) {
    this.N = N;
    this.numbers = numbers;
    this.state = state ? Int8Array.from(state) : new Int8Array(N * N); // defaults to UNMARKED
  }

  // ---- geometry ------------------------------------------------------------
  idx(r, c) { return r * this.N + c; }
  rc(i) { const r = (i / this.N) | 0; return { r, c: i - r * this.N }; }
  inBounds(r, c) { return r >= 0 && c >= 0 && r < this.N && c < this.N; }

  // Orthogonal neighbour indices of cell i (up to 4, board-edge aware).
  orthoNeighbors(i) {
    const N = this.N;
    const r = (i / N) | 0;
    const c = i - r * N;
    const out = [];
    if (r > 0)     out.push(i - N);
    if (r + 1 < N) out.push(i + N);
    if (c > 0)     out.push(i - 1);
    if (c + 1 < N) out.push(i + 1);
    return out;
  }

  rowIndices(r) {
    const N = this.N, base = r * N, out = new Array(N);
    for (let c = 0; c < N; c++) out[c] = base + c;
    return out;
  }
  colIndices(c) {
    const N = this.N, out = new Array(N);
    for (let r = 0; r < N; r++) out[r] = r * N + c;
    return out;
  }

  // ---- player state --------------------------------------------------------
  getState(i) { return this.state[i]; }
  setState(i, s) { this.state[i] = s; }

  // Tap: UNMARKED -> SHADED -> CIRCLED -> UNMARKED.
  cycle(i) {
    this.state[i] = (this.state[i] + 1) % 3;
    return this.state[i];
  }

  // Derive a shadedMask from player marks — for live rule-violation checks. Only
  // SHADED cells count as shaded; CIRCLED and UNMARKED are treated as white here.
  shadedMaskFromState() {
    const total = this.N * this.N;
    const mask = new Int8Array(total);
    for (let i = 0; i < total; i++) mask[i] = this.state[i] === CellState.SHADED ? 1 : 0;
    return mask;
  }

  // ---- copy / persistence --------------------------------------------------
  clone() {
    return new Board(this.N, this.numbers.slice(), Int8Array.from(this.state));
  }

  // Plain object for JSON / localStorage (key: hitori.saveState, wired up in Step 6).
  serialize() {
    return {
      N: this.N,
      numbers: Array.from(this.numbers),
      state: Array.from(this.state),
    };
  }

  static deserialize(obj) {
    return new Board(obj.N, obj.numbers.slice(), obj.state);
  }
}

// Node-only export. In the browser, CellState/Board are ambient globals.
if (typeof module !== "undefined") {
  module.exports = { CellState, Board };
}
