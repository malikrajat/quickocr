import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const iconsDir = join(root, 'icons');
const sizes = [16, 32, 48, 128];
const SUPERSAMPLE = 4;

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuffer = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function encodePng(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  header[10] = 0;
  header[11] = 0;
  header[12] = 0;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function mix(a, b, t) {
  return Math.round(a + (b - a) * clamp(t, 0, 1));
}

function segmentDistance(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared === 0 ? 0 : clamp(((px - ax) * dx + (py - ay) * dy) / lengthSquared, 0, 1);
  const x = ax + t * dx;
  const y = ay + t * dy;
  return Math.hypot(px - x, py - y);
}

function roundedRectSdf(u, v, x, y, width, height, radius) {
  const cx = x + width / 2;
  const cy = y + height / 2;
  const qx = Math.abs(u - cx) - (width / 2 - radius);
  const qy = Math.abs(v - cy) - (height / 2 - radius);
  return Math.min(Math.max(qx, qy), 0) + Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) - radius;
}

function blend(base, color, alpha) {
  return {
    r: mix(base.r, color.r, alpha),
    g: mix(base.g, color.g, alpha),
    b: mix(base.b, color.b, alpha),
    a: Math.max(base.a, alpha),
  };
}

function sample(u, v) {
  if (roundedRectSdf(u, v, 0.055, 0.055, 0.89, 0.89, 0.22) > 0) {
    return { r: 0, g: 0, b: 0, a: 0 };
  }

  const gradient = (u + v) / 2;
  let color = {
    r: mix(36, 15, gradient),
    g: mix(52, 23, gradient),
    b: mix(92, 42, gradient),
    a: 255,
  };

  const glow = Math.max(0, 1 - Math.hypot(u - 0.24, v - 0.18) / 0.72);
  color = {
    ...color,
    r: clamp(color.r + Math.round(glow * 18), 0, 255),
    g: clamp(color.g + Math.round(glow * 22), 0, 255),
    b: clamp(color.b + Math.round(glow * 48), 0, 255),
  };

  const lines = [
    { y: 0.36, x0: 0.34, x1: 0.55 },
    { y: 0.46, x0: 0.34, x1: 0.5 },
    { y: 0.56, x0: 0.34, x1: 0.53 },
  ];
  for (const line of lines) {
    if (segmentDistance(u, v, line.x0, line.y, line.x1, line.y) <= 0.017) {
      color = blend(color, { r: 219, g: 230, b: 255, a: 235 }, 0.82);
    }
  }

  const centerX = 0.46;
  const centerY = 0.46;
  const ringDistance = Math.hypot(u - centerX, v - centerY);
  if (Math.abs(ringDistance - 0.185) <= 0.032) {
    const angle = (Math.atan2(v - centerY, u - centerX) + Math.PI) / (Math.PI * 2);
    const accent = { r: mix(122, 155, angle), g: mix(162, 123, angle), b: mix(255, 255, angle), a: 255 };
    color = blend(color, accent, 0.98);
  }

  if (segmentDistance(u, v, 0.61, 0.61, 0.78, 0.78) <= 0.045) {
    color = blend(color, { r: 155, g: 123, b: 255, a: 255 }, 0.98);
  }

  if (Math.hypot(u - 0.8, v - 0.2) <= 0.075) {
    color = blend(color, { r: 255, g: 77, b: 103, a: 255 }, 1);
  }

  return color;
}

function render(size) {
  const high = size * SUPERSAMPLE;
  const highPixels = new Float32Array(high * high * 4);
  for (let y = 0; y < high; y += 1) {
    for (let x = 0; x < high; x += 1) {
      const color = sample((x + 0.5) / high, (y + 0.5) / high);
      const index = (y * high + x) * 4;
      highPixels[index] = color.r;
      highPixels[index + 1] = color.g;
      highPixels[index + 2] = color.b;
      highPixels[index + 3] = color.a;
    }
  }

  const rgba = Buffer.alloc(size * size * 4);
  const sampleCount = SUPERSAMPLE * SUPERSAMPLE;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let red = 0;
      let green = 0;
      let blue = 0;
      let alpha = 0;
      for (let sy = 0; sy < SUPERSAMPLE; sy += 1) {
        for (let sx = 0; sx < SUPERSAMPLE; sx += 1) {
          const index = ((y * SUPERSAMPLE + sy) * high + (x * SUPERSAMPLE + sx)) * 4;
          const a = highPixels[index + 3] / 255;
          red += highPixels[index] * a;
          green += highPixels[index + 1] * a;
          blue += highPixels[index + 2] * a;
          alpha += a;
        }
      }
      const out = (y * size + x) * 4;
      if (alpha > 0) {
        rgba[out] = Math.round(red / alpha);
        rgba[out + 1] = Math.round(green / alpha);
        rgba[out + 2] = Math.round(blue / alpha);
        rgba[out + 3] = Math.round((alpha / sampleCount) * 255);
      }
    }
  }
  return encodePng(size, size, rgba);
}

mkdirSync(iconsDir, { recursive: true });
for (const size of sizes) {
  const file = join(iconsDir, `icon${size}.png`);
  writeFileSync(file, render(size));
  console.log(`wrote ${file}`);
}
