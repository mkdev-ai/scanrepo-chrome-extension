// Generates the extension's PNG icons with no image dependencies.
// Draws a green rounded square containing a white shield with a scan bar.
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'icons');

const GREEN = [31, 136, 61];
const WHITE = [255, 255, 255];

function crc32(buf) {
  let c;
  const table = [];
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (const byte of buf) crc = table[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crc]);
}

function encodePng(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filter type: none
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Rounded-square background, then a white shield with a transparent scan gap. */
function render(size) {
  const px = Buffer.alloc(size * size * 4);
  const radius = size * 0.22;
  const ss = 3; // supersampling factor for smooth edges

  const inRoundedSquare = (u, v) => {
    const x = u * size;
    const y = v * size;
    const cx = Math.min(Math.max(x, radius), size - radius);
    const cy = Math.min(Math.max(y, radius), size - radius);
    const dx = x - cx;
    const dy = y - cy;
    if (dx === 0 && dy === 0) return true;
    return dx * dx + dy * dy <= radius * radius;
  };

  // Shield: straight sides in the upper body, tapering to a point below.
  const inShield = (u, v) => {
    const top = 0.2;
    const shoulders = 0.52;
    const bottom = 0.82;
    if (v < top || v > bottom) return false;
    let halfWidth;
    if (v <= shoulders) {
      halfWidth = 0.3;
    } else {
      const t = (v - shoulders) / (bottom - shoulders);
      halfWidth = 0.3 * Math.sqrt(Math.max(0, 1 - t * t)); // elliptical taper to a point
    }
    const dx = Math.abs(u - 0.5);
    if (dx > halfWidth) return false;
    // Notch: the scan bar cutting across the shield, so the mark reads as "scanning".
    const barTop = 0.455;
    const barBottom = 0.545;
    if (v >= barTop && v <= barBottom) return false;
    return true;
  };

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let bgHits = 0;
      let shieldHits = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const u = (x + (sx + 0.5) / ss) / size;
          const v = (y + (sy + 0.5) / ss) / size;
          if (inRoundedSquare(u, v)) bgHits++;
          if (inShield(u, v)) shieldHits++;
        }
      }
      const total = ss * ss;
      const bgAlpha = bgHits / total;
      const shieldAlpha = shieldHits / total;

      // Composite white shield over green background, then over transparency.
      const r = Math.round(GREEN[0] * (1 - shieldAlpha) + WHITE[0] * shieldAlpha);
      const g = Math.round(GREEN[1] * (1 - shieldAlpha) + WHITE[1] * shieldAlpha);
      const b = Math.round(GREEN[2] * (1 - shieldAlpha) + WHITE[2] * shieldAlpha);

      const i = (y * size + x) * 4;
      px[i] = r;
      px[i + 1] = g;
      px[i + 2] = b;
      px[i + 3] = Math.round(bgAlpha * 255);
    }
  }
  return encodePng(size, size, px);
}

mkdirSync(outDir, { recursive: true });
for (const size of [16, 48, 128]) {
  const name = `icon${size}.png`;
  writeFileSync(path.join(outDir, name), render(size));
  console.log(`wrote icons/${name}`);
}
writeFileSync(path.join(outDir, 'manifest.txt'), 'icon16.png\nicon48.png\nicon128.png\n');
console.log('wrote icons/manifest.txt');