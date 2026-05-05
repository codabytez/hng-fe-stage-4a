#!/usr/bin/env node
/**
 * Generates icons/icon16.png, icon48.png, icon128.png
 * Pure Node.js — no external dependencies required.
 *
 * Usage:  node scripts/generate-icons.js
 */

const zlib = require('zlib');
const fs   = require('fs');
const path = require('path');

// ── CRC-32 (required by PNG spec) ──────────────────────────────────────────
const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
  crcTable[n] = c;
}
function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function u32(n) {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n);
  return b;
}

function pngChunk(type, data) {
  const t = Buffer.from(type, 'ascii');
  const crcBuf = u32(crc32(Buffer.concat([t, data])));
  return Buffer.concat([u32(data.length), t, data, crcBuf]);
}

// ── RGBA PNG builder ───────────────────────────────────────────────────────
function buildPNG(size, pixelFn) {
  const sig  = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  // IHDR: width, height, 8-bit depth, color type 6 (RGBA)
  const ihdr = pngChunk('IHDR', Buffer.concat([u32(size), u32(size), Buffer.from([8, 6, 0, 0, 0])]));

  const rows = [];
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 4);
    row[0] = 0; // filter: None
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixelFn(x, y, size);
      const base = 1 + x * 4;
      row[base]     = r;
      row[base + 1] = g;
      row[base + 2] = b;
      row[base + 3] = a;
    }
    rows.push(row);
  }

  const raw        = Buffer.concat(rows);
  const compressed = zlib.deflateSync(raw, { level: 9 });
  const idat       = pngChunk('IDAT', compressed);
  const iend       = pngChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([sig, ihdr, idat, iend]);
}

// ── Icon design ────────────────────────────────────────────────────────────
// Rounded rectangle with a purple→blue gradient and three white lines
// representing text (matching the SVG in popup.html).

function lerp(a, b, t) { return Math.round(a + (b - a) * t); }

function iconPixel(x, y, size) {
  const cx = size / 2;
  const cy = size / 2;
  const pad    = size * 0.08;
  const corner = size * 0.22;
  const hw     = size / 2 - pad; // half-width of rounded rect
  const hh     = size / 2 - pad; // half-height

  // Signed distance to rounded rectangle
  const dx = Math.max(0, Math.abs(x - cx) - (hw - corner));
  const dy = Math.max(0, Math.abs(y - cy) - (hh - corner));
  const d  = Math.sqrt(dx * dx + dy * dy) - corner;

  if (d > 0) return [0, 0, 0, 0]; // transparent outside

  // Gradient: top-left #6C63FF → bottom-right #4FACFE
  const t  = (x / size * 0.5 + y / size * 0.5);
  const bg = [lerp(108, 79, t), lerp(99, 172, t), lerp(255, 254, t), 255];

  // Draw three white horizontal "lines" (text representation)
  const lineW  = size * 0.55;
  const lineH  = Math.max(1, Math.round(size * 0.08));
  const startX = cx - lineW / 2;
  const endX   = cx + lineW / 2;

  const lineYs = [
    cy - size * 0.18,
    cy,
    cy + size * 0.18,
  ];
  const shortLine = [startX, cx + lineW * 0.1]; // shorter last line

  for (let i = 0; i < lineYs.length; i++) {
    const ly  = lineYs[i];
    const lx0 = i === 2 ? startX : startX;
    const lx1 = i === 2 ? cx + lineW * 0.15 : endX; // 3rd line shorter
    if (x >= lx0 && x <= lx1 && Math.abs(y - ly) <= lineH / 2) {
      // Anti-alias soft edge
      const alpha = Math.max(0, 1 - Math.max(0, Math.abs(y - ly) - lineH / 2 + 0.5));
      return [
        lerp(bg[0], 255, alpha * 0.9),
        lerp(bg[1], 255, alpha * 0.9),
        lerp(bg[2], 255, alpha * 0.9),
        255,
      ];
    }
  }

  return bg;
}

// ── Write icons ────────────────────────────────────────────────────────────
const iconsDir = path.join(__dirname, '..', 'extension', 'icons');
fs.mkdirSync(iconsDir, { recursive: true });

for (const size of [16, 48, 128]) {
  const png  = buildPNG(size, iconPixel);
  const dest = path.join(iconsDir, `icon${size}.png`);
  fs.writeFileSync(dest, png);
  console.log(`✓ icons/icon${size}.png  (${png.length} bytes)`);
}

console.log('\nIcons generated successfully.');
