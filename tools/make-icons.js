/*
 * make-icons.js — generate the PWA app icons with no image library.
 *
 * The icon is the Hitori mark: a 3x3 of cells on night (#16192B), all "gone dark"
 * (#0D0F1A) except one lit sodium window (#E8935B) — the same object as the wordmark's
 * boxed I. No text (unreadable at icon size). Rendered at 3x and box-downsampled for AA.
 *
 * Run: node tools/make-icons.js   -> writes icons/icon-{180,192,512}.png
 */
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

// --- minimal PNG encoder (RGBA, 8-bit) -------------------------------------
function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1));
  }
  return (~c) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}
function encodePng(width, height, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; // bit depth 8, colour type 6 (RGBA)
  const raw = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    raw[y * (1 + width * 4)] = 0; // filter: none
    rgba.copy(raw, y * (1 + width * 4) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
}

// --- drawing ----------------------------------------------------------------
const BG = [0x16, 0x19, 0x2B], DARK = [0x0D, 0x0F, 0x1A], SODIUM = [0xE8, 0x93, 0x5B];
const LIT_INDEX = 4; // centre cell is lit

function inRounded(x, y, w, h, r) {
  if (x < 0 || y < 0 || x >= w || y >= h) return false;
  if (x < r && y < r) return Math.hypot(r - x, r - y) <= r;
  if (x > w - r && y < r) return Math.hypot(x - (w - r), r - y) <= r;
  if (x < r && y > h - r) return Math.hypot(r - x, y - (h - r)) <= r;
  if (x > w - r && y > h - r) return Math.hypot(x - (w - r), y - (h - r)) <= r;
  return true;
}

function render(S) {
  const SS = 3, W = S * SS;
  const hi = Buffer.alloc(W * W * 4);
  function px(x, y, rgb, a) {
    const o = (y * W + x) * 4;
    a = a == null ? 1 : a;
    hi[o]     = Math.round(rgb[0] * a + hi[o] * (1 - a));
    hi[o + 1] = Math.round(rgb[1] * a + hi[o + 1] * (1 - a));
    hi[o + 2] = Math.round(rgb[2] * a + hi[o + 2] * (1 - a));
    hi[o + 3] = 255;
  }
  for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) px(x, y, BG, 1);

  const margin = W * 0.15, gap = W * 0.05, grid = W - 2 * margin;
  const cell = (grid - 2 * gap) / 3, radius = cell * 0.2;

  // soft sodium glow spilling from the lit window (drawn under the cells)
  const gcx = margin + (LIT_INDEX % 3) * (cell + gap) + cell / 2;
  const gcy = margin + Math.floor(LIT_INDEX / 3) * (cell + gap) + cell / 2;
  const glowR = cell * 1.7;
  for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
    const d = Math.hypot(x - gcx, y - gcy);
    if (d < glowR) px(x, y, SODIUM, 0.30 * (1 - d / glowR));
  }

  for (let gi = 0; gi < 9; gi++) {
    const gx = gi % 3, gy = Math.floor(gi / 3);
    const x0 = margin + gx * (cell + gap), y0 = margin + gy * (cell + gap);
    const col = gi === LIT_INDEX ? SODIUM : DARK;
    for (let y = Math.floor(y0); y < Math.ceil(y0 + cell); y++)
      for (let x = Math.floor(x0); x < Math.ceil(x0 + cell); x++)
        if (inRounded(x - x0, y - y0, cell, cell, radius)) px(x, y, col, 1);
  }

  // box downsample SS -> 1
  const out = Buffer.alloc(S * S * 4);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    let r = 0, g = 0, b = 0;
    for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
      const o = ((y * SS + sy) * W + (x * SS + sx)) * 4;
      r += hi[o]; g += hi[o + 1]; b += hi[o + 2];
    }
    const n = SS * SS, o = (y * S + x) * 4;
    out[o] = Math.round(r / n); out[o + 1] = Math.round(g / n); out[o + 2] = Math.round(b / n); out[o + 3] = 255;
  }
  return out;
}

const outDir = path.join(__dirname, "..", "icons");
fs.mkdirSync(outDir, { recursive: true });
for (const S of [180, 192, 512]) {
  const png = encodePng(S, S, render(S));
  fs.writeFileSync(path.join(outDir, "icon-" + S + ".png"), png);
  console.log("wrote icons/icon-" + S + ".png (" + png.length + " bytes)");
}
