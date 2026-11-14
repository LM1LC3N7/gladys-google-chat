// Draws cover.png (800 x 534): a house posting into a chat window. No logo.
// Generates cover.png (800x534) for gladys-energi-data-service: plain Node, no
// dependency. A power pylon with its lines, the 24 hourly prices of a Danish
// grid tariff (the 17-21 peak in red) and a day/night price band, on a
// red-to-dark gradient (no logo).
// Usage: node scripts/cover.mjs cover.png
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const W = 800;
const H = 534;
const px = Buffer.alloc(W * H * 3);
const set = (x, y, [r, g, b], a = 1) => {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (y * W + x) * 3;
  px[i] = px[i] * (1 - a) + r * a;
  px[i + 1] = px[i + 1] * (1 - a) + g * a;
  px[i + 2] = px[i + 2] * (1 - a) + b * a;
};
// A green to teal background (Google Chat colours, no logo).
const skyAt = (x, y) => {
  const t = (x / W) * 0.6 + (y / H) * 0.4;
  return [20 + 10 * t, 120 - 40 * t, 90 + 30 * t];
};
for (let y = 0; y < H; y += 1) {
  for (let x = 0; x < W; x += 1) {
    set(x, y, skyAt(x, y));
  }
}
const white = [255, 255, 255];
const dark = [28, 38, 64];
const disc = (cx, cy, r, color, alpha = 1) => {
  for (let y = Math.floor(cy - r - 1); y <= cy + r + 1; y += 1) {
    for (let x = Math.floor(cx - r - 1); x <= cx + r + 1; x += 1) {
      const a = Math.max(0, Math.min(1, r - Math.hypot(x - cx, y - cy) + 0.5));
      if (a > 0) set(x, y, color, a * alpha);
    }
  }
};
const box = (x0, y0, x1, y1, r, color, alpha = 1) => {
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const cx = Math.min(Math.max(x, x0 + r), x1 - r);
      const cy = Math.min(Math.max(y, y0 + r), y1 - r);
      const a = Math.max(0, Math.min(1, r - Math.hypot(x - cx, y - cy) + 0.5));
      if (a > 0) set(x, y, color, a * alpha);
    }
  }
};
const line = (x0, y0, x1, y1, width, color) => {
  const minX = Math.floor(Math.min(x0, x1) - width);
  const maxX = Math.ceil(Math.max(x0, x1) + width);
  const minY = Math.floor(Math.min(y0, y1) - width);
  const maxY = Math.ceil(Math.max(y0, y1) + width);
  const len2 = (x1 - x0) ** 2 + (y1 - y0) ** 2 || 1;
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const t = Math.max(0, Math.min(1, ((x - x0) * (x1 - x0) + (y - y0) * (y1 - y0)) / len2));
      const d = Math.hypot(x - (x0 + t * (x1 - x0)), y - (y0 + t * (y1 - y0)));
      const a = Math.max(0, Math.min(1, width / 2 - d + 0.5));
      if (a > 0) set(x, y, color, a);
    }
  }
};

// A house on the left, its messages going into a chat window on the right.
const roof = [250, 250, 250];
const yellow = [251, 188, 4];
const green = [52, 168, 83];
const blue = [66, 133, 244];
disc(400, 270, 260, white, 0.05);
line(90, 260, 200, 160, 10, roof);
line(200, 160, 310, 260, 10, roof);
box(115, 255, 285, 420, 10, white, 0.92);
box(180, 330, 220, 420, 6, dark, 0.8);
box(130, 280, 170, 315, 4, yellow);
box(230, 280, 270, 315, 4, yellow);
for (const [x, y] of [
  [330, 250],
  [370, 235],
  [410, 220],
]) {
  disc(x, y, 9, white, 0.9);
}
box(450, 90, 740, 450, 22, white, 0.96);
box(450, 90, 740, 140, 22, dark, 0.85);
box(450, 120, 740, 140, 0, dark, 0.85);
disc(480, 115, 11, green);
box(500, 108, 640, 122, 6, white, 0.85);
const bubble = (y, w, color) => {
  box(475, y, 475 + w, y + 54, 16, color);
  box(492, y + 14, 475 + w - 24, y + 24, 5, white, 0.9);
  box(492, y + 32, 475 + Math.round(w * 0.6), y + 42, 5, white, 0.75);
};
bubble(165, 220, green);
bubble(240, 190, blue);
bubble(315, 240, [234, 67, 53]);
box(475, 395, 715, 425, 12, grey(), 1);
function grey() {
  return [220, 224, 230];
}
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const c = Buffer.alloc(4);
  c.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, c]);
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8;
ihdr[9] = 2;
const raw = Buffer.alloc((W * 3 + 1) * H);
for (let y = 0; y < H; y += 1) {
  raw[y * (W * 3 + 1)] = 0;
  px.copy(raw, y * (W * 3 + 1) + 1, y * W * 3, (y + 1) * W * 3);
}
const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);
writeFileSync(process.argv[2] ?? 'cover.png', png);
console.log('cover', png.length, 'bytes');
