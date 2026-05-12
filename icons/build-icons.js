#!/usr/bin/env node
'use strict';

/**
 * Generates icon16.png, icon32.png, icon48.png, icon128.png
 * using pure Node.js (zlib + Buffer) — no npm dependencies required.
 *
 * Usage:  node icons/build-icons.js
 */

const zlib = require('zlib');
const fs   = require('fs');
const path = require('path');

// ── CRC-32 ──────────────────────────────────────────────────────────────────
const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c;
}
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// ── PNG chunk builder ────────────────────────────────────────────────────────
function pngChunk(type, data) {
  const typeBytes = Buffer.from(type, 'ascii');
  const lenBuf    = Buffer.allocUnsafe(4); lenBuf.writeUInt32BE(data.length);
  const crcInput  = Buffer.concat([typeBytes, data]);
  const crcBuf    = Buffer.allocUnsafe(4); crcBuf.writeUInt32BE(crc32(crcInput));
  return Buffer.concat([lenBuf, typeBytes, data, crcBuf]);
}

// ── Brand colors ─────────────────────────────────────────────────────────────
const BG = [124, 58, 237]; // violet #7c3aed
const FG = [255, 255, 255]; // white

// ── "a/" glyph — two characters side by side ────────────────────────────────
//   "a": 5×7 pixel lowercase a
//   "/": 3×7 pixel forward slash
// Combined: columns 0-4 = "a", column 5 = gap, columns 6-8 = "/"
const A_COLS = 5, SLASH_COLS = 3, GAP = 1;
const GLYPH_W = A_COLS + GAP + SLASH_COLS; // 9
const GLYPH_H = 7;

// Each row: A pixels (5 bits), gap (1 bit off), slash pixels (3 bits)
const GLYPH = [
  //  a a a a a   / / /
  [0, 1, 1, 1, 0, 0, 0, 0, 1],  // row 0
  [1, 0, 0, 0, 1, 0, 0, 1, 0],  // row 1
  [0, 0, 1, 1, 1, 0, 0, 1, 0],  // row 2
  [0, 1, 0, 0, 1, 0, 0, 1, 0],  // row 3
  [0, 1, 1, 1, 1, 0, 1, 0, 0],  // row 4
  [0, 0, 0, 0, 0, 0, 1, 0, 0],  // row 5
  [0, 0, 0, 0, 0, 0, 1, 0, 0],  // row 6
];

// ── PNG generator ────────────────────────────────────────────────────────────
function makePng(size) {
  const scale   = Math.max(1, Math.floor(size / 10));
  const scaledW = GLYPH_W * scale;
  const scaledH = GLYPH_H * scale;
  const offX    = Math.floor((size - scaledW) / 2);
  const offY    = Math.floor((size - scaledH) / 2);

  // Raw image data: (filter_byte + RGB×width) × height
  const raw = Buffer.alloc(size * (1 + size * 3));

  for (let y = 0; y < size; y++) {
    const rowStart = y * (1 + size * 3);
    raw[rowStart] = 0; // filter: None

    for (let x = 0; x < size; x++) {
      const px   = rowStart + 1 + x * 3;
      const gx   = Math.floor((x - offX) / scale);
      const gy   = Math.floor((y - offY) / scale);
      const lit  = gx >= 0 && gx < GLYPH_W && gy >= 0 && gy < GLYPH_H
                   ? GLYPH[gy][gx] === 1 : false;
      const col  = lit ? FG : BG;
      raw[px]     = col[0];
      raw[px + 1] = col[1];
      raw[px + 2] = col[2];
    }
  }

  // IHDR
  const ihdr = Buffer.allocUnsafe(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8]  = 8; // bit depth
  ihdr[9]  = 2; // colour type: RGB
  ihdr[10] = 0; // compression: deflate
  ihdr[11] = 0; // filter:      adaptive
  ihdr[12] = 0; // interlace:   none

  const compressed = zlib.deflateSync(raw, { level: 9 });
  const sig        = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  return Buffer.concat([
    sig,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', compressed),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// ── Write all sizes ──────────────────────────────────────────────────────────
const dir = __dirname;
for (const size of [16, 32, 48, 128]) {
  const png  = makePng(size);
  const file = path.join(dir, `icon${size}.png`);
  fs.writeFileSync(file, png);
  console.log(`✓  icon${size}.png  (${png.length} bytes)`);
}
console.log('\nDone. Load the extension from the alias-extension/ folder.');
