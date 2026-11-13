// The world: a stylised Baltic region squeezed to fit a phone game.
//
// Everything is in metres with Y up, north = -Z, east = +X, and Riga airport
// at the origin. Distances between places are compressed by SCALE so a flight
// to Tallinn takes about three minutes at a real airliner's cruise speed, but
// the things you look at up close - runways, the plane, trees, buildings -
// are real size. That mismatch is deliberate: real distances would make every
// flight half an hour of empty fields.
//
// The coast is drawn from hand-placed lat/lon polygons into a 1024² mask,
// turned into a signed distance field, and sampled through a domain warp so
// the shoreline wiggles naturally without changing what is land and what is
// sea. Heights, land cover and collision all come from the same functions.

import { noise2, fbm, smoothstep, clamp } from './noise.js';

export const SCALE = 0.14;
const LAT0 = 56.9236, LON0 = 23.9711;            // Riga airport
const MX = 111320 * Math.cos(LAT0 * Math.PI / 180) * SCALE;
const MZ = 110574 * SCALE;

export function toWorld(lat, lon) {
  return { x: (lon - LON0) * MX, z: -(lat - LAT0) * MZ };
}

export const BOUNDS = { x0: -60000, x1: 44000, z0: -64000, z1: 40000 };
const N = 1024;
const CELL = (BOUNDS.x1 - BOUNDS.x0) / N;

// ---------------------------------------------------------------- geography
// [lat, lon] pairs. Approximate on purpose - this is a picture of the Baltic,
// not a chart of it - but every airport sits on the right side of the water.

const SEA = [
  [53.8, 16.0], [54.45, 17.0], [54.8, 18.3], [54.45, 18.65], [54.4, 19.6],
  [54.9, 19.95], [54.96, 20.5], [55.25, 20.85], [55.5, 21.0], [55.72, 21.07],
  [55.95, 21.05], [56.2, 21.02], [56.5, 20.98], [56.8, 21.05], [57.1, 21.35],
  [57.4, 21.52], [57.6, 21.85], [57.76, 22.58],
  // Gulf of Riga, west shore down to Jūrmala
  [57.55, 22.9], [57.35, 23.12], [57.15, 23.22], [57.02, 23.42], [56.97, 23.75],
  [57.0, 23.95], [57.06, 24.03], [57.08, 24.12], [57.26, 24.38], [57.5, 24.37],
  [57.87, 24.35], [58.1, 24.45], [58.37, 24.5],
  // Pärnu bay and the west Estonian coast
  [58.3, 24.2], [58.25, 23.8], [58.45, 23.6], [58.58, 23.52], [58.75, 23.45],
  [58.95, 23.5], [59.1, 23.42], [59.25, 23.6], [59.35, 24.05], [59.45, 24.4],
  [59.47, 24.75], [59.55, 25.1], [59.6, 25.7], [59.55, 26.3], [59.47, 27.0],
  [59.45, 27.7], [59.45, 28.05], [59.7, 28.4], [59.9, 29.0], [59.95, 29.8],
  // Gulf of Finland, north shore heading west
  [60.25, 29.8], [60.55, 28.6], [60.57, 27.2], [60.47, 26.6], [60.32, 25.7],
  [60.16, 24.95], [60.08, 24.4], [60.02, 23.9], [59.83, 22.95], [60.15, 22.4],
  [60.35, 21.6], [60.75, 21.3], [61.5, 21.35], [61.5, 16.0],
];

const ISLANDS = [
  // Saaremaa + Muhu
  [[57.91, 22.05], [58.1, 21.95], [58.33, 21.85], [58.48, 22.15], [58.55, 22.5],
   [58.6, 23.0], [58.64, 23.3], [58.52, 23.42], [58.42, 23.05], [58.3, 22.75],
   [58.22, 22.45], [58.08, 22.25]],
  // Hiiumaa
  [[58.72, 22.4], [58.92, 22.05], [59.08, 22.45], [59.0, 22.85], [58.82, 23.0],
   [58.75, 22.75]],
  // Gotland
  [[57.97, 19.05], [57.75, 18.75], [57.45, 18.3], [57.1, 18.12], [56.9, 18.3],
   [57.15, 18.6], [57.45, 18.85], [57.7, 19.0]],
  // Sweden, the bit that fits
  [[58.4, 16.0], [58.7, 16.8], [59.0, 17.6], [59.3, 18.4], [59.6, 19.0],
   [60.0, 18.9], [60.4, 18.4], [60.7, 17.4], [61.5, 17.2], [61.5, 16.0]],
  // Åland
  [[60.42, 19.6], [60.45, 20.2], [60.15, 20.35], [60.05, 19.85]],
];

const LAKES = [
  // Peipus
  [[58.98, 26.98], [59.02, 27.6], [58.93, 28.05], [58.7, 27.75], [58.45, 27.55],
   [58.3, 27.65], [58.1, 27.85], [57.85, 28.2], [57.8, 27.95], [58.0, 27.55],
   [58.3, 27.4], [58.6, 27.3], [58.8, 27.05]],
  // Võrtsjärv
  [[58.42, 26.0], [58.32, 26.12], [58.15, 26.06], [58.2, 25.93], [58.36, 25.9]],
  // Lubāns
  [[56.81, 26.72], [56.79, 26.98], [56.71, 26.96], [56.73, 26.74]],
  // Curonian lagoon
  [[55.68, 21.12], [55.45, 21.25], [55.28, 21.35], [55.08, 21.2], [54.95, 21.05],
   [54.92, 20.7], [55.05, 20.6], [55.25, 20.92], [55.5, 21.03]],
  // Burtnieks
  [[57.75, 25.2], [57.73, 25.33], [57.66, 25.32], [57.68, 25.19]],
];

// [width in metres, points]
const RIVERS = [
  [300, [[57.06, 24.03], [56.97, 24.09], [56.93, 24.18], [56.86, 24.32], [56.82, 24.55],
         [56.75, 24.85], [56.62, 25.1], [56.6, 25.4], [56.48, 25.8], [56.33, 26.15],
         [56.15, 26.4], [55.95, 26.5], [55.88, 26.55], [55.75, 26.9], [55.7, 27.4]]], // Daugava
  [200, [[56.65, 23.72], [56.78, 23.78], [56.92, 23.7], [56.97, 23.8], [57.05, 23.97]]], // Lielupe
  [200, [[57.17, 24.38], [57.15, 24.6], [57.3, 24.85], [57.33, 25.05], [57.3, 25.25],
         [57.45, 25.5], [57.55, 25.7]]],                                                   // Gauja
  [260, [[54.9, 23.92], [54.95, 23.5], [55.08, 22.8], [55.07, 22.2], [55.1, 21.85],
         [55.3, 21.35]]],                                                                  // Nemunas
  [200, [[54.69, 25.28], [54.75, 25.0], [54.85, 24.6], [54.9, 24.3], [54.9, 23.92]]],      // Neris
  [200, [[58.3, 26.05], [58.37, 26.4], [58.38, 26.72], [58.4, 27.0], [58.42, 27.32]]],     // Emajõgi
  [220, [[59.45, 28.05], [59.2, 28.12], [59.0, 27.75]]],                                   // Narva
  [200, [[57.4, 21.55], [57.2, 21.8], [56.97, 21.97], [56.7, 22.1]]],                      // Venta
];

// Airports: real coordinates, real runway headings (true), lengths rounded up
// a little where the real strip is short - this is a game, and landing should
// be the fun part.
export const AIRPORTS = [
  { code: 'RIX', name: 'Riga',      lat: 56.9236, lon: 23.9711, hdg: 176, len: 3200 },
  { code: 'TLL', name: 'Tallinn',   lat: 59.4133, lon: 24.8328, hdg: 83,  len: 3480 },
  { code: 'HEL', name: 'Helsinki',  lat: 60.3172, lon: 24.9633, hdg: 44,  len: 3500 },
  { code: 'VNO', name: 'Vilnius',   lat: 54.6341, lon: 25.2858, hdg: 15,  len: 2600 },
  { code: 'KUN', name: 'Kaunas',    lat: 54.9639, lon: 24.0848, hdg: 80,  len: 3250 },
  { code: 'PLQ', name: 'Palanga',   lat: 55.9733, lon: 21.0939, hdg: 10,  len: 2400 },
  { code: 'LPX', name: 'Liepāja',   lat: 56.5175, lon: 21.0969, hdg: 128, len: 2400 },
  { code: 'VNT', name: 'Ventspils', lat: 57.3578, lon: 21.5442, hdg: 150, len: 2200 },
  { code: 'TAY', name: 'Tartu',     lat: 58.3075, lon: 26.6904, hdg: 77,  len: 2400 },
  { code: 'EPU', name: 'Pärnu',     lat: 58.4190, lon: 24.4728, hdg: 160, len: 2600 },
  { code: 'URE', name: 'Kuressaare', lat: 58.2299, lon: 22.5095, hdg: 90, len: 2400 },
  { code: 'DGP', name: 'Daugavpils', lat: 55.9447, lon: 26.6650, hdg: 90, len: 2600 },
  { code: 'SQQ', name: 'Šiauliai',  lat: 55.8939, lon: 23.3950, hdg: 140, len: 3000 },
  { code: 'VIS', name: 'Visby',     lat: 57.6628, lon: 18.3462, hdg: 30,  len: 2400 },
];

// [name, lat, lon, radius m (game), building count]
export const CITIES = [
  ['Riga', 56.95, 24.11, 2000, 2200], ['Tallinn', 59.43, 24.75, 1600, 1500],
  ['Helsinki', 60.18, 24.94, 1800, 1700], ['Vilnius', 54.69, 25.28, 1500, 1300],
  ['Kaunas', 54.9, 23.9, 1200, 900], ['Tartu', 58.38, 26.72, 800, 450],
  ['Pärnu', 58.39, 24.5, 700, 350], ['Liepāja', 56.51, 21.02, 800, 450],
  ['Ventspils', 57.39, 21.58, 600, 280], ['Jūrmala', 56.97, 23.75, 900, 380],
  ['Jelgava', 56.65, 23.72, 700, 380], ['Daugavpils', 55.875, 26.53, 900, 500],
  ['Klaipėda', 55.71, 21.14, 900, 550], ['Šiauliai', 55.93, 23.31, 800, 420],
  ['Valmiera', 57.54, 25.42, 450, 200], ['Cēsis', 57.31, 25.27, 350, 130],
  ['Kuressaare', 58.25, 22.49, 450, 180], ['Narva', 59.38, 28.19, 650, 320],
  ['Panevėžys', 55.73, 24.36, 700, 380], ['Ogre', 56.82, 24.6, 450, 200],
  ['Sigulda', 57.15, 24.86, 350, 130], ['Visby', 57.64, 18.3, 450, 200],
  ['Tukums', 56.97, 23.15, 400, 160], ['Rakvere', 59.35, 26.36, 400, 160],
  ['Viljandi', 58.36, 25.59, 400, 170], ['Haapsalu', 58.94, 23.54, 350, 130],
  ['Porvoo', 60.39, 25.66, 400, 160], ['Kotka', 60.47, 26.95, 450, 200],
];

// Rolling uplands: [lat, lon, amplitude m, sigma km (real)]
const UPLANDS = [
  [56.85, 25.9, 260, 35], [56.25, 27.2, 180, 40], [57.7, 27.0, 280, 30],
  [58.05, 26.5, 180, 25], [56.95, 22.2, 120, 40], [55.95, 22.2, 190, 35],
  [54.9, 25.6, 180, 45], [59.0, 26.2, 150, 35], [60.4, 25.0, 90, 60],
  [59.7, 18.0, 90, 70], [57.5, 18.6, 40, 30],
];

export function runwayNumber(hdg) {
  let n = Math.round((((hdg % 360) + 360) % 360) / 10);
  if (n === 0) n = 36;
  return String(n).padStart(2, '0');
}

// ------------------------------------------------------------------ World

export class World {
  constructor() {
    this.airports = AIRPORTS.map((a) => {
      const p = toWorld(a.lat, a.lon);
      const r = (a.hdg * Math.PI) / 180;
      const dir = { x: Math.sin(r), z: -Math.cos(r) };
      const hl = a.len / 2;
      const ap = { ...a, x: p.x, z: p.z, dir, hl, width: 45, elev: 0 };
      ap.ends = [
        { num: runwayNumber(a.hdg), hdg: a.hdg,
          x: p.x - dir.x * hl, z: p.z - dir.z * hl, dx: dir.x, dz: dir.z },
        { num: runwayNumber(a.hdg + 180), hdg: (a.hdg + 180) % 360,
          x: p.x + dir.x * hl, z: p.z + dir.z * hl, dx: -dir.x, dz: -dir.z },
      ];
      return ap;
    });
    this.cities = CITIES.map(([name, lat, lon, r, n]) => ({ name, ...toWorld(lat, lon), r, n }));
    this.uplands = UPLANDS.map(([lat, lon, amp, sig]) => {
      const p = toWorld(lat, lon);
      const s = sig * 1000 * SCALE;
      return { x: p.x, z: p.z, amp, k: 1 / (2 * s * s) };
    });
  }

  /** Rasterise the coast and build the signed distance field. */
  build() {
    const T = [performance.now()];
    const cv = document.createElement('canvas');
    cv.width = cv.height = N;
    // A CPU canvas: reading 4 MB back from a GPU one took seconds on some devices.
    const g = cv.getContext('2d', { willReadFrequently: true });
    const px = (lat, lon) => {
      const p = toWorld(lat, lon);
      return [(p.x - BOUNDS.x0) / CELL, (p.z - BOUNDS.z0) / CELL];
    };
    const poly = (pts, col) => {
      g.fillStyle = col; g.beginPath();
      pts.forEach(([la, lo], i) => { const [x, y] = px(la, lo); i ? g.lineTo(x, y) : g.moveTo(x, y); });
      g.closePath(); g.fill();
    };
    g.fillStyle = '#fff'; g.fillRect(0, 0, N, N);
    // Everything west of the sea polygon's far edge is open water too.
    g.fillStyle = '#000'; g.fillRect(0, 0, px(0, 16.0)[0] + 1, N);
    poly(SEA, '#000');
    ISLANDS.forEach((p) => poly(p, '#fff'));
    LAKES.forEach((p) => poly(p, '#000'));
    g.strokeStyle = '#000'; g.lineCap = 'round'; g.lineJoin = 'round';
    for (const [w, pts] of RIVERS) {
      g.lineWidth = Math.max(2, w / CELL);
      g.beginPath();
      pts.forEach(([la, lo], i) => { const [x, y] = px(la, lo); i ? g.lineTo(x, y) : g.moveTo(x, y); });
      g.stroke();
    }
    // Airports always stand on dry land, whatever the squeezed coast says.
    g.fillStyle = '#fff';
    for (const a of this.airports) {
      g.save();
      g.translate((a.x - BOUNDS.x0) / CELL, (a.z - BOUNDS.z0) / CELL);
      g.rotate((a.hdg * Math.PI) / 180);
      const L = (a.len + 3000) / CELL, W = 2800 / CELL;
      g.fillRect(-W / 2, -L / 2, W, L);
      g.restore();
    }
    T.push(performance.now());
    const img = g.getImageData(0, 0, N, N).data;
    T.push(performance.now());
    const land = new Uint8Array(N * N);
    for (let i = 0; i < N * N; i++) land[i] = img[i * 4] > 127 ? 1 : 0;
    this.land = land;

    const dW = edt(land, N, 0);   // for land cells: distance to nearest water
    const dL = edt(land, N, 1);   // for water cells: distance to nearest land
    const sdf = new Float32Array(N * N);
    for (let i = 0; i < N * N; i++) {
      sdf[i] = land[i] ? (Math.sqrt(dW[i]) - 0.5) * CELL : -(Math.sqrt(dL[i]) - 0.5) * CELL;
    }
    this.sdfGrid = sdf;
    T.push(performance.now());

    for (const a of this.airports) {
      a.elev = clamp(this.natural(a.x, a.z), 4, 90);
    }
    T.push(performance.now());
    this.buildCoastTexture();
    T.push(performance.now());
    this.timing = T.slice(1).map((t, i) => Math.round(t - T[i]));
  }

  /** Bilinear sample of the raw SDF. */
  sdfRaw(x, z) {
    let fx = (x - BOUNDS.x0) / CELL - 0.5, fz = (z - BOUNDS.z0) / CELL - 0.5;
    fx = clamp(fx, 0, N - 1.001); fz = clamp(fz, 0, N - 1.001);
    const ix = fx | 0, iz = fz | 0, tx = fx - ix, tz = fz - iz;
    const s = this.sdfGrid, i = iz * N + ix;
    const a = s[i] + (s[i + 1] - s[i]) * tx;
    const b = s[i + N] + (s[i + N + 1] - s[i + N]) * tx;
    return a + (b - a) * tz;
  }

  /** Signed metres to the coast (+ on land), through the domain warp. */
  coast(x, z) {
    const wx = 300 * noise2(x / 2600, z / 2600) + 80 * noise2(x / 700 + 5.2, z / 700 - 1.3);
    const wz = 300 * noise2(x / 2600 + 9.7, z / 2600 + 3.1) + 80 * noise2(x / 700 - 7.7, z / 700 + 2.9);
    return this.sdfRaw(x + wx, z + wz);
  }

  regional(x, z) {
    let u = 0;
    for (const r of this.uplands) {
      const dx = x - r.x, dz = z - r.z;
      u += r.amp * Math.exp(-(dx * dx + dz * dz) * r.k);
    }
    return u;
  }

  /** Height before airports are carved in. */
  natural(x, z, d = this.coast(x, z)) {
    if (d < 0) return -1.2 + Math.max(d, -4000) * 0.01;
    const up = this.regional(x, z);
    const n1 = fbm(x * 1.1e-4, z * 1.1e-4, 4) * 0.5 + 0.5;
    let h = 5 + n1 * n1 * (55 + up) + up * 0.55 + fbm(x * 7e-4, z * 7e-4, 3) * 6;
    const k = smoothstep(0, 1100, d);
    return 0.7 + (h - 0.7) * k;
  }

  /** Distance from (x,z) to an airport's runway segment, and that airport. */
  airportNear(x, z) {
    let best = null, bd = Infinity;
    for (const a of this.airports) {
      const dx = x - a.x, dz = z - a.z;
      if (Math.abs(dx) > 9000 || Math.abs(dz) > 9000) continue;
      const along = clamp(dx * a.dir.x + dz * a.dir.z, -a.hl, a.hl);
      const ex = dx - a.dir.x * along, ez = dz - a.dir.z * along;
      const d = Math.sqrt(ex * ex + ez * ez);
      if (d < bd) { bd = d; best = a; }
    }
    return { airport: best, dist: bd };
  }

  /**
   * Everything the terrain needs about one spot. `out` is reused.
   * h: height, forest/airport/city: 0..1 cover weights, d: coast distance.
   */
  info(x, z, out) {
    const d = this.coast(x, z);
    let h = this.natural(x, z, d);
    const near = this.airportNear(x, z);
    let ap = 0;
    if (near.airport) {
      const t = smoothstep(1100, 2900, near.dist);
      h = near.airport.elev + (h - near.airport.elev) * t;
      ap = 1 - smoothstep(700, 1100, near.dist);
    }
    let city = 0;
    for (const c of this.cities) {
      const dx = x - c.x, dz = z - c.z;
      if (Math.abs(dx) > c.r * 1.3 || Math.abs(dz) > c.r * 1.3) continue;
      city = Math.max(city, 1 - smoothstep(c.r * 0.45, c.r * 1.2, Math.sqrt(dx * dx + dz * dz)));
    }
    city *= 1 - ap;
    let forest = smoothstep(0.07, 0.17, fbm(x * 3.2e-4 + 31.7, z * 3.2e-4 - 7.3, 4));
    forest *= smoothstep(2.5, 6, h) * (1 - smoothstep(0, 0.6, ap + (near.dist < 2900 ? 0.4 : 0))) * (1 - city);
    out.h = h; out.d = d; out.forest = forest; out.airport = ap; out.city = city;
    return out;
  }

  height(x, z) {
    const d = this.coast(x, z);
    let h = this.natural(x, z, d);
    const near = this.airportNear(x, z);
    if (near.airport) {
      const t = smoothstep(1100, 2900, near.dist);
      h = near.airport.elev + (h - near.airport.elev) * t;
    }
    return h;
  }

  /** An 8-bit coast-distance texture for the water shader and the map. */
  buildCoastTexture() {
    const M = 512, data = new Uint8Array(M * M);
    const sx = (BOUNDS.x1 - BOUNDS.x0) / M, sz = (BOUNDS.z1 - BOUNDS.z0) / M;
    for (let j = 0; j < M; j++) {
      for (let i = 0; i < M; i++) {
        const d = this.coast(BOUNDS.x0 + (i + 0.5) * sx, BOUNDS.z0 + (j + 0.5) * sz);
        data[j * M + i] = clamp(Math.round(128 + d / 16), 0, 255);
      }
    }
    this.coastData = data;
    this.coastSize = M;
  }

  /** A painted overview map, 1 pixel per mask cell. */
  mapCanvas() {
    if (this._map) return this._map;
    const M = this.coastSize, cv = document.createElement('canvas');
    cv.width = cv.height = M;
    const g = cv.getContext('2d');
    const im = g.createImageData(M, M);
    const sx = (BOUNDS.x1 - BOUNDS.x0) / M;
    for (let j = 0; j < M; j++) {
      for (let i = 0; i < M; i++) {
        const d = (this.coastData[j * M + i] - 128) * 16;
        const k = (j * M + i) * 4;
        if (d < 0) {
          const t = clamp(-d / 1800, 0, 1);
          im.data[k] = 120 - 70 * t; im.data[k + 1] = 190 - 70 * t; im.data[k + 2] = 220 - 40 * t;
        } else {
          const x = BOUNDS.x0 + (i + 0.5) * sx, z = BOUNDS.z0 + (j + 0.5) * sx;
          const u = clamp(this.regional(x, z) / 250, 0, 1);
          const f = fbm(x * 3.2e-4 + 31.7, z * 3.2e-4 - 7.3, 2) > 0.12 ? 1 : 0;
          im.data[k] = 140 - 40 * f + 60 * u; im.data[k + 1] = 185 - 30 * f + 20 * u; im.data[k + 2] = 105 - 30 * f + 40 * u;
          if (d < 120) { im.data[k] = 225; im.data[k + 1] = 210; im.data[k + 2] = 160; }
        }
        im.data[k + 3] = 255;
      }
    }
    g.putImageData(im, 0, 0);
    g.fillStyle = 'rgba(110,110,120,0.75)';
    for (const c of this.cities) {
      g.beginPath();
      g.arc((c.x - BOUNDS.x0) / sx, (c.z - BOUNDS.z0) / sx, Math.max(1.5, c.r / sx * 0.7), 0, Math.PI * 2);
      g.fill();
    }
    this._map = cv;
    return cv;
  }
}

/**
 * Squared Euclidean distance transform (Felzenszwalb & Huttenlocher).
 * Returns, for every cell, the squared distance in cells to the nearest cell
 * whose `mask` value equals `target`.
 */
function edt(mask, n, target) {
  const INF = 1e20;
  const f = new Float64Array(n * n);
  for (let i = 0; i < n * n; i++) f[i] = mask[i] === target ? 0 : INF;
  const line = new Float64Array(n), d = new Float64Array(n);
  const v = new Int32Array(n), z = new Float64Array(n + 1);
  const run = () => {
    let k = 0;
    v[0] = 0; z[0] = -INF; z[1] = INF;
    for (let q = 1; q < n; q++) {
      const fq = line[q] + q * q;
      let p = v[k];
      let s = (fq - (line[p] + p * p)) / (2 * (q - p));
      while (s <= z[k]) {
        k--;
        p = v[k];
        s = (fq - (line[p] + p * p)) / (2 * (q - p));
      }
      k++;
      v[k] = q; z[k] = s; z[k + 1] = INF;
    }
    k = 0;
    for (let q = 0; q < n; q++) {
      while (z[k + 1] < q) k++;
      const p = v[k];
      d[q] = (q - p) * (q - p) + line[p];
    }
  };
  for (let y = 0; y < n; y++) {            // rows
    const o = y * n;
    for (let x = 0; x < n; x++) line[x] = f[o + x];
    run();
    for (let x = 0; x < n; x++) f[o + x] = d[x];
  }
  for (let x = 0; x < n; x++) {            // columns
    for (let y = 0; y < n; y++) line[y] = f[y * n + x];
    run();
    for (let y = 0; y < n; y++) f[y * n + x] = d[y];
  }
  return f;
}
