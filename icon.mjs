/*
 * icon.mjs
 *
 * Draws the app icon and writes the PNGs a home screen needs.
 *
 * There is exactly one place the mark is defined - the geometry below - and
 * everything else is generated from it: the four PNGs, and the inline SVG in
 * index.html that serves as the favicon. Change a number here, re-run, and the
 * whole set moves together. An icon that has to be redrawn by hand at four
 * sizes is an icon that ends up subtly different at four sizes.
 *
 * Node stdlib only, like the rest of the tooling, which here means rasterising
 * by hand: every shape in the mark is a triangle, a circle or a rounded
 * rectangle, so each pixel can simply be asked which of them it is inside.
 * Sampling 4x4 within each pixel is what gives the edges their smoothness -
 * there is no antialiasing to inherit when nothing is drawing but you.
 *
 * PNG comes out of zlib, which Node has. The format is a handful of
 * length-prefixed chunks with CRC32s, and writing it directly is a smaller and
 * more durable thing to own than a dependency that rasterises SVG.
 *
 * Usage:  node icon.mjs
 */

import { deflateSync } from "node:zlib";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));

/* --- the mark ------------------------------------------------------------ */

/*
 * A camera iris: six blades around an opening, drawn in a 128-unit box.
 *
 * The blades alternate between two tones rather than one tone at two
 * opacities. At 40px - which is what a home screen actually gives you - a
 * 55% blade over blue and a 100% blade over blue are close enough in value to
 * merge, and the whole thing collapses into one pale blob. Two explicit tones
 * keep the blade structure legible all the way down.
 */
const BOX = 128;
const RADIUS = 28;            // tile corner
const CENTRE = 64;
const BLADE_OUT = 40;         // how much of the tile the mark fills
const BLADE_IN = 0.28;        // inner edge, as a fraction of the outer
const HOLE = 10;

const SKY = [[0, [0x35, 0x93, 0xff]], [0.22, [0x00, 0x57, 0xe5]], [1, [0x00, 0x3d, 0xd7]]];
const LIT = [0xee, 0xf4, 0xff];
const SHADE = [0x8a, 0xb8, 0xff];
const OPENING = [0x00, 0x3d, 0xd7];

const blades = [];
for (let k = 0; k < 6; k++) {
  const a0 = (k * Math.PI) / 3;
  const a1 = ((k + 1) * Math.PI) / 3;
  const at = (a, r) => [CENTRE + Math.cos(a) * r, CENTRE + Math.sin(a) * r];
  blades.push({
    tri: [at(a0, BLADE_OUT), at(a1, BLADE_OUT), at(a1, BLADE_OUT * BLADE_IN)],
    tone: k % 2 ? SHADE : LIT,
  });
}

function gradient(t) {
  for (let i = 1; i < SKY.length; i++) {
    const [t1, c1] = SKY[i];
    const [t0, c0] = SKY[i - 1];
    if (t <= t1) {
      const f = (t - t0) / (t1 - t0);
      return [0, 1, 2].map((j) => c0[j] + (c1[j] - c0[j]) * f);
    }
  }
  return SKY[SKY.length - 1][1];
}

/** Winding test, so a point either is or is not inside the blade. */
function inTriangle(px, py, [[ax, ay], [bx, by], [cx, cy]]) {
  const d1 = (px - bx) * (ay - by) - (ax - bx) * (py - by);
  const d2 = (px - cx) * (by - cy) - (bx - cx) * (py - cy);
  const d3 = (px - ax) * (cy - ay) - (cx - ax) * (py - ay);
  const neg = d1 < 0 || d2 < 0 || d3 < 0;
  const pos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(neg && pos);
}

function inRoundedBox(x, y, r) {
  if (r <= 0) return x >= 0 && y >= 0 && x <= BOX && y <= BOX;
  const cx = Math.min(Math.max(x, r), BOX - r);
  const cy = Math.min(Math.max(y, r), BOX - r);
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= r * r;
}

/** The colour at one point of the design, or null where the tile is not. */
function sample(x, y, corner) {
  if (!inRoundedBox(x, y, corner)) return null;
  const dx = x - CENTRE;
  const dy = y - CENTRE;
  if (dx * dx + dy * dy <= HOLE * HOLE) return OPENING;
  for (const blade of blades) if (inTriangle(x, y, blade.tri)) return blade.tone;
  return gradient(y / BOX);
}

/* --- raster -------------------------------------------------------------- */

const SUB = 4;   // samples per pixel per axis

function raster(size, corner) {
  const out = Buffer.alloc(size * size * 4);
  const scale = BOX / size;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0, hits = 0;
      for (let sy = 0; sy < SUB; sy++) {
        for (let sx = 0; sx < SUB; sx++) {
          const c = sample((px + (sx + 0.5) / SUB) * scale,
                           (py + (sy + 0.5) / SUB) * scale, corner);
          if (!c) continue;
          r += c[0]; g += c[1]; b += c[2]; hits += 1;
        }
      }
      const i = (py * size + px) * 4;
      const total = SUB * SUB;
      if (hits) {
        out[i] = Math.round(r / hits);
        out[i + 1] = Math.round(g / hits);
        out[i + 2] = Math.round(b / hits);
        out[i + 3] = Math.round((hits / total) * 255);
      }
    }
  }
  return out;
}

/* --- PNG ----------------------------------------------------------------- */

const CRC = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = -1;
  for (const byte of buf) c = CRC[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const head = Buffer.alloc(4);
  head.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(body));
  return Buffer.concat([head, body, tail]);
}

function png(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;    // bit depth
  ihdr[9] = 6;    // truecolour with alpha
  // Every scanline is prefixed with filter type 0. Filtering would compress
  // better; this is a few kilobytes either way and stays readable.
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/* --- the set ------------------------------------------------------------- */

// A maskable icon is squared off on purpose: Android applies its own mask, and
// a rounded tile inside that mask gets its corners clipped twice.
const WANTED = [
  ["icons/icon-180.png", 180, RADIUS],
  ["icons/icon-192.png", 192, RADIUS],
  ["icons/icon-512.png", 512, RADIUS],
  ["icons/maskable-512.png", 512, 0],
];

await mkdir(join(ROOT, "icons"), { recursive: true });
for (const [name, size, corner] of WANTED) {
  // The radius stays in design units. raster() maps every pixel back into the
  // 128-unit box before sampling, so scaling the radius to the output size
  // scales it twice - at 512 that made it 112 in a box 128 across, the corner
  // clamp inverted, and a quarter of the icon vanished.
  const file = png(size, raster(size, corner));
  await writeFile(join(ROOT, name), file);
  console.log(`${name.padEnd(24)} ${size}x${size}  ${(file.length / 1024).toFixed(1)} KB`);
}

/* The same mark as one line of SVG, for the favicon in index.html. */
const svg =
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">`
  + `<defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1">`
  + SKY.map(([t, c]) => `<stop offset="${t}" stop-color="rgb(${c.join(",")})"/>`).join("")
  + `</linearGradient></defs>`
  + `<rect width="128" height="128" rx="${RADIUS}" fill="url(#s)"/>`
  + blades.map((b) =>
      `<path d="M${b.tri.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join("L")}Z"`
      + ` fill="rgb(${b.tone.join(",")})"/>`).join("")
  + `<circle cx="${CENTRE}" cy="${CENTRE}" r="${HOLE}" fill="rgb(${OPENING.join(",")})"/></svg>`;

console.log("\nfavicon SVG, for the <link rel=icon> in index.html:\n");
console.log(svg);
