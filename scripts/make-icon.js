// Generates media/icon.png (128x128) for the Marketplace without any image dependency: a rounded dark tile with
// three connected nodes, drawn pixel-by-pixel and encoded as PNG via zlib. Run: node scripts/make-icon.js
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SIZE = 128;
const BG = [0x1f, 0x24, 0x30];
const ACCENT = [0x4f, 0xc3, 0xf7];
const NODE = [0xff, 0xff, 0xff];
const px = new Uint8Array(SIZE * SIZE * 4);

function blend(x, y, rgb, alpha) {
  if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) {
    return;
  }
  const i = (y * SIZE + x) * 4;
  const a = Math.max(0, Math.min(1, alpha));
  const prevA = px[i + 3] / 255;
  const outA = a + prevA * (1 - a);
  for (let c = 0; c < 3; c++) {
    px[i + c] = outA ? Math.round((rgb[c] * a + px[i + c] * prevA * (1 - a)) / outA) : 0;
  }
  px[i + 3] = Math.round(outA * 255);
}

function roundedRect(radius) {
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const cx = Math.max(radius, Math.min(SIZE - 1 - radius, x));
      const cy = Math.max(radius, Math.min(SIZE - 1 - radius, y));
      const d = Math.hypot(x - cx, y - cy);
      blend(x, y, BG, Math.min(1, radius + 0.5 - d));
    }
  }
}

function circle(cx, cy, r, rgb) {
  for (let y = Math.floor(cy - r - 1); y <= cy + r + 1; y++) {
    for (let x = Math.floor(cx - r - 1); x <= cx + r + 1; x++) {
      blend(x, y, rgb, r + 0.5 - Math.hypot(x - cx, y - cy));
    }
  }
}

function line(x0, y0, x1, y1, width, rgb) {
  const len = Math.hypot(x1 - x0, y1 - y0);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const t = Math.max(0, Math.min(1, ((x - x0) * (x1 - x0) + (y - y0) * (y1 - y0)) / (len * len)));
      const d = Math.hypot(x - (x0 + t * (x1 - x0)), y - (y0 + t * (y1 - y0)));
      blend(x, y, rgb, width / 2 + 0.5 - d);
    }
  }
}

roundedRect(24);
// Collaborator hub on top, two specialist nodes below, connected.
const hub = [64, 40];
const left = [36, 90];
const right = [92, 90];
line(hub[0], hub[1], left[0], left[1], 6, ACCENT);
line(hub[0], hub[1], right[0], right[1], 6, ACCENT);
line(left[0], left[1], right[0], right[1], 6, ACCENT);
circle(hub[0], hub[1], 16, ACCENT);
circle(hub[0], hub[1], 9, NODE);
circle(left[0], left[1], 12, NODE);
circle(right[0], right[1], 12, NODE);

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body) >>> 0);
  return Buffer.concat([len, body, crc]);
}

function crc32(buf) {
  let c = -1;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
  }
  return ~c;
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // RGBA
const raw = Buffer.alloc((SIZE * 4 + 1) * SIZE);
for (let y = 0; y < SIZE; y++) {
  raw[y * (SIZE * 4 + 1)] = 0; // filter: none
  Buffer.from(px.buffer, y * SIZE * 4, SIZE * 4).copy(raw, y * (SIZE * 4 + 1) + 1);
}
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);

const out = path.join(__dirname, '..', 'media', 'icon.png');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, png);
console.log(`wrote ${path.relative(path.join(__dirname, '..'), out)} (${png.length} bytes)`);
