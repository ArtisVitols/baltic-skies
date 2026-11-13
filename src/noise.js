// Deterministic 2D gradient noise. The terrain, the trees and the collision
// height all come from these functions, so they must give the same answer
// every time they are asked - no Math.random() anywhere in the world.

const perm = new Uint8Array(512);
const gx = new Float32Array(256);
const gy = new Float32Array(256);

(function seed(s) {
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  let r = s >>> 0;
  const rnd = () => ((r = (r * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    const t = p[i]; p[i] = p[j]; p[j] = t;
  }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  for (let i = 0; i < 256; i++) {
    const a = rnd() * Math.PI * 2;
    gx[i] = Math.cos(a); gy[i] = Math.sin(a);
  }
})(1337);

/** Gradient noise, roughly in [-1, 1]. */
export function noise2(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const X = xi & 255, Y = yi & 255;
  const a = perm[X + perm[Y]], b = perm[X + 1 + perm[Y]];
  const c = perm[X + perm[Y + 1]], d = perm[X + 1 + perm[Y + 1]];
  const u = xf * xf * xf * (xf * (xf * 6 - 15) + 10);
  const v = yf * yf * yf * (yf * (yf * 6 - 15) + 10);
  const n00 = gx[a] * xf + gy[a] * yf;
  const n10 = gx[b] * (xf - 1) + gy[b] * yf;
  const n01 = gx[c] * xf + gy[c] * (yf - 1);
  const n11 = gx[d] * (xf - 1) + gy[d] * (yf - 1);
  const x1 = n00 + u * (n10 - n00);
  const x2 = n01 + u * (n11 - n01);
  return (x1 + v * (x2 - x1)) * 1.42;
}

export function fbm(x, y, oct = 4) {
  let s = 0, a = 0.5, f = 1, n = 0;
  for (let i = 0; i < oct; i++) {
    s += a * noise2(x * f + i * 17.3, y * f - i * 9.1);
    n += a; a *= 0.5; f *= 2.03;
  }
  return s / n;
}

/** Integer hash to [0, 1). */
export function hash2(ix, iy, seed = 0) {
  let h = (ix * 374761393 + iy * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Small seeded PRNG for placing things inside one tile. */
export function rng(seed) {
  let r = seed >>> 0 || 1;
  return () => ((r = (r * 1664525 + 1013904223) >>> 0) / 4294967296);
}

export const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
export const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
export const lerp = (a, b, t) => a + (b - a) * t;
