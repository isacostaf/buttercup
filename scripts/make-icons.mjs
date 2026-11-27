// Gera os ícones PNG (sem transparência) desenhando uma flor "buttercup".
// Uso: node scripts/make-icons.mjs   — sem dependências.
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const OUT = fileURLToPath(new URL('../public/', import.meta.url));

const CRC = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, rgb) {
  const raw = Buffer.alloc((size * 3 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0;
    rgb.copy(raw, y * (size * 3 + 1) + 1, y * size * 3, (y + 1) * size * 3);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 2; // 8 bits, RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
  ]);
}

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

const BG_TOP = hex('#FCE6EB'), BG_BOT = hex('#F6C9D3');
const PETAL_IN = hex('#FFE48A'), PETAL_OUT = hex('#FFC23D');
const CENTER = hex('#E8843A'), CENTER_HI = hex('#F6A65A');

const cx = 0.5, cy = 0.5;
const petals = Array.from({ length: 5 }, (_, k) => {
  const a = (-90 + k * 72) * Math.PI / 180;
  return { x: cx + Math.cos(a) * 0.165, y: cy + Math.sin(a) * 0.165, r: 0.165 };
});

function color(u, v) {
  let c = mix(BG_TOP, BG_BOT, v);
  // sombra suave da flor
  const ds = Math.hypot(u - cx, v - (cy + 0.03));
  if (ds < 0.36) c = mix(c, hex('#E9A7B5'), 0.35 * (1 - ds / 0.36));
  for (const p of petals) {
    const d = Math.hypot(u - p.x, v - p.y);
    if (d < p.r) c = mix(PETAL_IN, PETAL_OUT, Math.min(1, d / p.r) ** 1.6);
  }
  const dc = Math.hypot(u - cx, v - cy);
  if (dc < 0.1) c = mix(CENTER_HI, CENTER, dc / 0.1);
  if (Math.hypot(u - (cx - 0.03), v - (cy - 0.03)) < 0.025) c = mix(c, [255, 240, 210], 0.6);
  return c;
}

function draw(size, ss = 4) {
  const buf = Buffer.alloc(size * size * 3);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0;
      for (let j = 0; j < ss; j++) for (let i = 0; i < ss; i++) {
        const [cr, cg, cb] = color((x + (i + 0.5) / ss) / size, (y + (j + 0.5) / ss) / size);
        r += cr; g += cg; b += cb;
      }
      const n = ss * ss, o = (y * size + x) * 3;
      buf[o] = Math.round(r / n); buf[o + 1] = Math.round(g / n); buf[o + 2] = Math.round(b / n);
    }
  }
  return png(size, buf);
}

for (const s of [180, 192, 512]) {
  writeFileSync(`${OUT}icon-${s}.png`, draw(s));
  console.log(`icon-${s}.png`);
}
