/*
 * generator.test.js — seeded hashing and compact puzzle strings. Run: node test/generator.test.js
 */

const path = require("path");
const G = require(path.join(__dirname, "..", "js", "generator.js"));

let pass = 0, fail = 0;
function check(label, cond) {
  console.log((cond ? "  ok  " : " FAIL ") + label);
  cond ? pass++ : fail++;
}

try {
  const a = G.hashString("daily-2026-10-17");
  check("hashString stable", a === G.hashString("daily-2026-10-17"));
  check("hashString differs per day", a !== G.hashString("daily-2026-10-18"));
  check("hashString is uint32", Number.isInteger(a) && a >= 0 && a <= 0xffffffff);

  const grid = new Int8Array(100);
  for (let i = 0; i < 100; i++) grid[i] = (i % 10) + 1; // includes 10
  const s = G.encodeNumbers(grid);
  check("encode length 100", s.length === 100);
  check("10 encodes to 'a'", s[9] === "a");
  const back = G.decodeNumbers(s);
  check("decode is Int8Array", back instanceof Int8Array);
  check("round-trip 10x10 with a 10", back.length === 100 && back.every((v, i) => v === grid[i]));

  const p1 = G.generateTier(6, { rand: G.mulberry32(G.hashString("x")) });
  const p2 = G.generateTier(6, { rand: G.mulberry32(G.hashString("x")) });
  check("seeded generateTier is reproducible", !p1.failed && Array.from(p1.numbers).join() === Array.from(p2.numbers).join());
} catch (e) {
  check("no exception: " + e.message, false);
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
