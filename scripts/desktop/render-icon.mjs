// Renders the CactusGen app icon (lime cactus on a dark rounded square, from
// public/cactus.svg) to src-tauri/icon-source.png at 1024 × 1024. Then:
//
//   node scripts/desktop/render-icon.mjs
//   npx tauri icon src-tauri/icon-source.png
//
// and copy src-tauri/icons/icon.ico to app/favicon.ico.

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const glyph = readFileSync(join(ROOT, "public", "cactus.svg"), "utf8");
const inner = glyph.replace(/^[\s\S]*?<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "");

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 32 32">
  <rect x="1" y="1" width="30" height="30" rx="7" fill="#11130c"/>
  <g transform="translate(16 16) scale(0.78) translate(-16 -16.25)">${inner}</g>
</svg>`;

const out = join(ROOT, "src-tauri", "icon-source.png");
await sharp(Buffer.from(svg)).png().toFile(out);
console.log(`wrote ${out}`);
