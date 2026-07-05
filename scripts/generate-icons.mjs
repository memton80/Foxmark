#!/usr/bin/env node
/**
 * generate-icons.mjs — Génère les icônes PNG de Foxmark (src-tauri/icons/).
 *
 * Sans dépendance : encodage PNG manuel (zlib de Node). L'icône est un
 * carré arrondi dégradé orange (clin d'œil renard) portant un « F » blanc.
 *
 * Usage : node scripts/generate-icons.mjs
 */
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), "../src-tauri/icons");

// ---- Encodage PNG minimal -------------------------------------------------

const CRC_TABLE = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(width, height, rgba) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // profondeur
  ihdr[9] = 6; // type couleur RGBA
  const scanlines = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    const rowStart = y * (1 + width * 4);
    scanlines[rowStart] = 0; // filtre : aucun
    rgba.copy(scanlines, rowStart + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    signature,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(scanlines, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---- Dessin de l'icône ----------------------------------------------------

/** Anti-aliasing simple : couverture d'un pixel dans le carré arrondi. */
function roundedRectCoverage(x, y, size, radius) {
  const min = 0.5;
  const max = size - 0.5;
  const cx = Math.min(Math.max(x, min + radius), max - radius);
  const cy = Math.min(Math.max(y, min + radius), max - radius);
  const dx = x - cx;
  const dy = y - cy;
  const dist = Math.sqrt(dx * dx + dy * dy);
  return Math.min(1, Math.max(0, radius - dist + 0.5));
}

function drawIcon(size) {
  const rgba = Buffer.alloc(size * size * 4);
  const radius = size * 0.22;

  // Dégradé Firefox-orange, du haut-gauche au bas-droite.
  const top = { r: 0xff, g: 0x9a, b: 0x3c };
  const bottom = { r: 0xe3, g: 0x56, b: 0x2a };

  // « F » en blocs, proportionnel à la taille.
  const u = size / 16;
  const bars = [
    { x: 4.5 * u, y: 4 * u, w: 2.2 * u, h: 8 * u }, // fût vertical
    { x: 4.5 * u, y: 4 * u, w: 7 * u, h: 2.2 * u }, // barre haute
    { x: 4.5 * u, y: 7.4 * u, w: 5.4 * u, h: 2 * u }, // barre médiane
  ];

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const coverage = roundedRectCoverage(x + 0.5, y + 0.5, size, radius);
      const offset = (y * size + x) * 4;
      if (coverage <= 0) continue;

      const t = (x + y) / (2 * size);
      let r = Math.round(top.r + (bottom.r - top.r) * t);
      let g = Math.round(top.g + (bottom.g - top.g) * t);
      let b = Math.round(top.b + (bottom.b - top.b) * t);

      for (const bar of bars) {
        if (
          x + 0.5 >= bar.x &&
          x + 0.5 <= bar.x + bar.w &&
          y + 0.5 >= bar.y &&
          y + 0.5 <= bar.y + bar.h
        ) {
          r = g = b = 0xff;
        }
      }

      rgba[offset] = r;
      rgba[offset + 1] = g;
      rgba[offset + 2] = b;
      rgba[offset + 3] = Math.round(coverage * 255);
    }
  }
  return encodePng(size, size, rgba);
}

// ---- Écriture -------------------------------------------------------------

mkdirSync(OUT_DIR, { recursive: true });
const targets = [
  ["32x32.png", 32],
  ["128x128.png", 128],
  ["128x128@2x.png", 256],
  ["icon.png", 512],
];
for (const [name, size] of targets) {
  writeFileSync(join(OUT_DIR, name), drawIcon(size));
  console.log(`✓ ${name} (${size}×${size})`);
}
