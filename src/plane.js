// A twin-engine narrow-body airliner, built from code.
//
// Real proportions (37.6 m long, 34 m span, 3.95 m fuselage), nose towards -Z,
// Y up, right wing on +X. Nothing is loaded: the fuselage is lofted from a
// profile, wings and tail are swept airfoil panels, and the paint is a canvas
// wrapped round the fuselage. The moving parts move: gear folds into the
// belly, flaps run out, ailerons/elevators/rudder follow the controls,
// spoilers pop on touchdown, fans spin with the engines.

import * as THREE from 'three';

export const GEAR_HEIGHT = 3.97;   // origin to ground, gear down, level
export const BELLY_HEIGHT = 3.2;   // origin to the bottom of the engines
const ZN = -18.8, LEN = 37.6;
const R = 1.98, HH = 2.05;

export const LIVERIES = {
  amber: { main: '#13315c', accent: '#f2a900', name: 'AMBER AIR', reg: 'YL-CLD', flag: true },
  red: { main: '#8a1c2b', accent: '#c9c9c9', name: 'NORDIC RED', reg: 'ES-NRD' },
  green: { main: '#0f5a46', accent: '#8fcf5f', name: 'BALTIC GREEN', reg: 'LY-BGR' },
  blue: { main: '#26308a', accent: '#41b6e6', name: 'SKYLINE', reg: 'OH-SKY' },
};

// ------------------------------------------------------------ fuselage shape

function section(s) {
  // Returns half-width, top and bottom of the fuselage at fraction s (0 = nose).
  if (s < 0.135) {
    const t = s / 0.135;
    const k = Math.pow(1 - Math.pow(1 - t, 2.1), 0.5);
    const cy = -0.42 * (1 - t) * (1 - t);
    return { w: R * k, top: cy + HH * k * (0.96 + 0.04 * t), bot: cy - HH * k };
  }
  if (s < 0.66) return { w: R, top: HH, bot: -HH };
  const t = (s - 0.66) / 0.34;
  return {
    w: R * (1 - 0.86 * Math.pow(t, 1.35)),
    top: HH - 0.62 * Math.pow(t, 1.6),
    bot: -HH + 3.25 * Math.pow(t, 1.45),
  };
}

function fuselageGeometry(rings, ringSegs) {
  const pos = [], uv = [], idx = [];
  const ss = [];
  for (let i = 0; i <= rings; i++) {
    // Denser stations at the nose and tail, where the shape changes.
    const u = i / rings;
    ss.push(u < 0.2 ? 0.135 * Math.pow(u / 0.2, 1.6) : u < 0.65 ? 0.135 + (u - 0.2) / 0.45 * 0.525 : 0.66 + (u - 0.65) / 0.35 * 0.34);
  }
  for (const s of ss) {
    const { w, top, bot } = section(s);
    const cy = (top + bot) / 2, hy = (top - bot) / 2;
    for (let j = 0; j <= ringSegs; j++) {
      const th = (j / ringSegs) * Math.PI * 2;
      // Slightly squarer than an ellipse: real fuselages are double-bubble.
      const sn = Math.sin(th), cs = Math.cos(th);
      const ex = 0.92, sx = Math.sign(sn) * Math.pow(Math.abs(sn), ex), sy = Math.sign(cs) * Math.pow(Math.abs(cs), ex);
      pos.push(-w * sx, cy - hy * sy, ZN + s * LEN);
      uv.push(s, 1 - j / ringSegs);
    }
  }
  const rs = ringSegs + 1;
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < ringSegs; j++) {
      const a = i * rs + j, b = a + 1, c = a + rs, d = c + 1;
      idx.push(a, b, c, b, d, c);
    }
  }
  // Tail cap.
  const last = rings * rs, tip = pos.length / 3;
  const st = section(1);
  pos.push(0, (st.top + st.bot) / 2, ZN + LEN + 0.25); uv.push(1, 0.5);
  for (let j = 0; j < ringSegs; j++) idx.push(last + j, last + j + 1, tip);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  // Weld the seam's normals and point the nose tip straight ahead.
  const n = g.attributes.normal;
  for (let i = 0; i <= rings; i++) {
    const a = i * rs, b = a + ringSegs;
    const x = n.getX(a) + n.getX(b), y = n.getY(a) + n.getY(b), z = n.getZ(a) + n.getZ(b);
    const l = Math.hypot(x, y, z) || 1;
    n.setXYZ(a, x / l, y / l, z / l); n.setXYZ(b, x / l, y / l, z / l);
  }
  for (let j = 0; j <= ringSegs; j++) n.setXYZ(j, 0, -0.2, -1);
  // Make sure the outside faces out (the winding above depends on handedness).
  const p0 = new THREE.Vector3().fromBufferAttribute(g.attributes.position, rs * Math.floor(rings / 2) + Math.floor(ringSegs / 4));
  const n0 = new THREE.Vector3().fromBufferAttribute(n, rs * Math.floor(rings / 2) + Math.floor(ringSegs / 4));
  if (n0.x * p0.x + n0.y * p0.y < 0) flipGeometry(g);
  return g;
}

function flipGeometry(g) {
  const ix = g.index.array;
  for (let i = 0; i < ix.length; i += 3) { const t = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = t; }
  g.index.needsUpdate = true;
  const n = g.attributes.normal;
  if (n) for (let i = 0; i < n.count; i++) n.setXYZ(i, -n.getX(i), -n.getY(i), -n.getZ(i));
}

// ------------------------------------------------------------ airfoil panels

const V = (x, y, z) => new THREE.Vector3(x, y, z);

function foil(c, t) {
  const yt = 5 * t * (0.2969 * Math.sqrt(c) - 0.126 * c - 0.3516 * c * c + 0.2843 * c ** 3 - 0.1036 * c ** 4);
  const yc = 0.018 * 4 * c * (1 - c);
  return [yc + yt, yc - yt];
}

/**
 * Loft an airfoil panel through sections, between chord fractions c0..c1.
 * Each section: { le: Vector3, chord: Vector3 (LE→TE), up: Vector3, t }.
 * `uvFn(point)` may supply planar UVs (used for the fin's logo).
 */
function panel(secs, c0 = 0, c1 = 1, nf = 9, uvFn = null) {
  const ring = [];
  for (let k = 0; k <= nf; k++) ring.push([c0 + (c1 - c0) * (1 - Math.cos((Math.PI * k) / nf)) / 2, 0]);
  for (let k = nf; k >= 0; k--) ring.push([c0 + (c1 - c0) * (1 - Math.cos((Math.PI * k) / nf)) / 2, 1]);
  const rn = ring.length;
  const pos = [], uv = [], idx = [];
  const pt = (s, c, lower) => {
    const [yu, yl] = foil(c, s.t);
    const y = (lower ? yl : yu) * s.chord.length();
    return s.le.clone().addScaledVector(s.chord, c).addScaledVector(s.up, y);
  };
  secs.forEach((s, i) => {
    for (const [c, lo] of ring) {
      const p = pt(s, c, lo);
      pos.push(p.x, p.y, p.z);
      if (uvFn) uv.push(...uvFn(p)); else uv.push((c - c0) / (c1 - c0 || 1), i / (secs.length - 1));
    }
  });
  for (let i = 0; i < secs.length - 1; i++) {
    for (let k = 0; k < rn - 1; k++) {
      const a = i * rn + k, b = a + 1, c = a + rn, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  // End caps with their own vertices so they shade flat.
  for (const [si, dir] of [[0, -1], [secs.length - 1, 1]]) {
    const base = pos.length / 3;
    const cen = new THREE.Vector3();
    for (let k = 0; k < rn; k++) {
      const p = V(pos[(si * rn + k) * 3], pos[(si * rn + k) * 3 + 1], pos[(si * rn + k) * 3 + 2]);
      cen.add(p);
      pos.push(p.x, p.y, p.z); uv.push(0.5, si ? 1 : 0);
    }
    cen.divideScalar(rn);
    pos.push(cen.x, cen.y, cen.z); uv.push(0.5, si ? 1 : 0);
    const ci = base + rn;
    for (let k = 0; k < rn - 1; k++) {
      if (dir < 0) idx.push(base + k, base + k + 1, ci); else idx.push(base + k + 1, base + k, ci);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  // Orientation check on the upper surface of the first strip.
  const a = V(pos[0], pos[1], pos[2]), b = V(pos[3 * rn], pos[3 * rn + 1], pos[3 * rn + 2]);
  const c = V(pos[3], pos[4], pos[5]);
  const nrm = new THREE.Vector3().crossVectors(b.clone().sub(a), c.clone().sub(a));
  if (nrm.dot(secs[0].up) < 0) {
    const ix = g.index.array;
    for (let i = 0; i < ix.length; i += 3) { const t = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = t; }
    g.computeVertexNormals();
  }
  return g;
}

/** Put a geometry on a hinge: returns a pivot whose rotation swings it. */
function hinged(geo, mat, a, b) {
  const pivot = new THREE.Group();
  pivot.position.copy(a);
  geo.translate(-a.x, -a.y, -a.z);
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = true;
  pivot.add(m);
  pivot.userData.axis = b.clone().sub(a).normalize();
  return pivot;
}
function swing(pivot, angle) { pivot.quaternion.setFromAxisAngle(pivot.userData.axis, angle); }

// ------------------------------------------------------------ paint

function liveryTexture(L, big) {
  const W = big ? 4096 : 2048, H = big ? 1024 : 512;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  const X = (s) => s * W, Y = (th) => (th / (Math.PI * 2)) * H;
  const both = (fn) => { fn(); g.save(); g.translate(0, H); g.scale(1, -1); fn(); g.restore(); };

  g.fillStyle = '#f7f8fa'; g.fillRect(0, 0, W, H);
  // Belly.
  both(() => { g.fillStyle = '#c5cad1'; g.fillRect(0, 0, W, Y(0.7)); });
  // The swoosh: a band that sweeps up into the tail.
  const hi = (s) => Math.min(Math.PI + 0.02, 0.82 + Math.pow(Math.max(0, s - 0.48), 1.55) * 6.8);
  const lo = (s) => 0.42 + 0.25 * s;
  both(() => {
    g.fillStyle = L.accent; g.beginPath();
    for (let s = 0.1; s <= 1.0001; s += 0.01) g.lineTo(X(s), Y(hi(s) + 0.13 * Math.min(1, (s - 0.1) * 6)));
    for (let s = 1.0; s >= 0.1; s -= 0.01) g.lineTo(X(s), Y(lo(s)));
    g.fill();
    g.fillStyle = L.main; g.beginPath();
    for (let s = 0.08; s <= 1.0001; s += 0.01) g.lineTo(X(s), Y(hi(s)));
    for (let s = 1.0; s >= 0.08; s -= 0.01) g.lineTo(X(s), Y(lo(s)));
    g.fill();
  });
  // Cabin windows.
  const winTh = 1.8, pitch = 0.53 / LEN;
  both(() => {
    for (let s = 0.158; s < 0.665; s += pitch) {
      if (s > 0.418 && s < 0.46) continue;
      g.fillStyle = '#1d2733';
      roundRect(g, X(s) - X(0.13 / LEN), Y(winTh - 0.03), X(0.26 / LEN), Y(0.11), X(0.06 / LEN));
    }
    // Over-wing exits and their windows.
    for (const s of [0.425, 0.447]) {
      g.strokeStyle = '#9aa3ad'; g.lineWidth = Math.max(1, W / 2048);
      g.strokeRect(X(s) - X(0.3 / LEN), Y(1.55), X(0.6 / LEN), Y(0.5));
      g.fillStyle = '#1d2733';
      roundRect(g, X(s) - X(0.13 / LEN), Y(winTh - 0.03), X(0.26 / LEN), Y(0.11), X(0.06 / LEN));
    }
    // Doors.
    g.strokeStyle = '#8f99a3'; g.lineWidth = Math.max(1.5, W / 1400);
    for (const s of [0.128, 0.705]) {
      roundStroke(g, X(s) - X(0.42 / LEN), Y(1.02), X(0.84 / LEN), Y(0.95), X(0.12 / LEN));
      g.fillStyle = '#1d2733';
      roundRect(g, X(s) - X(0.11 / LEN), Y(1.72), X(0.22 / LEN), Y(0.09), X(0.05 / LEN));
    }
    // Cockpit windows.
    g.fillStyle = '#131a22';
    const cw = [[0.078, 0.095, 2.06, 2.42], [0.072, 0.088, 2.5, 2.84], [0.066, 0.082, 2.9, 3.11]];
    for (const [s0, s1, t0, t1] of cw) {
      g.beginPath();
      g.moveTo(X(s0 + 0.004), Y(t0)); g.lineTo(X(s1), Y(t0 + 0.04));
      g.lineTo(X(s1 - 0.003), Y(t1)); g.lineTo(X(s0), Y(t1 - 0.02));
      g.closePath(); g.fill();
    }
  });
  // Lettering, on each side the right way round.
  const text = (str, s, th, hM, col, weight = 800) => {
    for (const side of ['left', 'right']) {
      g.save();
      const y = side === 'left' ? Y(th) : H - Y(th);
      g.translate(X(s), y);
      const sx = (W / LEN) / 100, sy = (H / 12.6) / 100;
      if (side === 'left') g.scale(sx, -sy); else g.scale(-sx, sy);
      g.fillStyle = col;
      g.font = `italic ${weight} ${hM * 100}px "Trebuchet MS", "Segoe UI", Arial, sans-serif`;
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(str, 0, 0);
      g.restore();
    }
  };
  text(L.name, 0.37, 2.32, 1.05, L.main);
  text(L.reg, 0.79, 1.05, 0.48, '#ffffff', 700);
  if (L.flag) {
    both(() => {
      const s0 = 0.112, s1 = 0.128, t0 = 2.18, t1 = 2.36;
      g.fillStyle = '#9e3039'; g.fillRect(X(s0), Y(t0), X(s1 - s0), Y(t1 - t0));
      g.fillStyle = '#ffffff'; g.fillRect(X(s0), Y(t0 + (t1 - t0) * 0.4), X(s1 - s0), Y((t1 - t0) * 0.2));
    });
  }
  // Panel lines, very faint.
  g.strokeStyle = 'rgba(0,0,0,0.06)'; g.lineWidth = 1;
  for (let s = 0.14; s < 0.9; s += 1.6 / LEN) { g.beginPath(); g.moveTo(X(s), 0); g.lineTo(X(s), H); g.stroke(); }

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}
function roundRect(g, x, y, w, h, r) {
  g.beginPath(); g.roundRect ? g.roundRect(x, y, w, h, r) : g.rect(x, y, w, h); g.fill();
}
function roundStroke(g, x, y, w, h, r) {
  g.beginPath(); g.roundRect ? g.roundRect(x, y, w, h, r) : g.rect(x, y, w, h); g.stroke();
}

function finTexture(L) {
  const S = 512, cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d');
  g.fillStyle = L.main; g.fillRect(0, 0, S, S);
  // A rising sun over a wing - the airline's mark.
  const cx = S * 0.55, cy = S * 0.48;
  g.fillStyle = L.accent;
  g.beginPath(); g.arc(cx, cy, S * 0.15, 0, Math.PI * 2); g.fill();
  g.strokeStyle = L.accent; g.lineWidth = S * 0.025; g.lineCap = 'round';
  for (let k = 0; k < 9; k++) {
    const a = Math.PI * (0.05 + k * 0.1125);
    g.beginPath();
    g.moveTo(cx + Math.cos(a) * S * 0.2, cy + Math.sin(a) * S * 0.2);
    g.lineTo(cx + Math.cos(a) * S * 0.28, cy + Math.sin(a) * S * 0.28);
    g.stroke();
  }
  g.fillStyle = '#ffffff';
  g.beginPath();
  g.moveTo(S * 0.15, cy + S * 0.02); g.quadraticCurveTo(S * 0.55, cy - S * 0.12, S * 0.95, cy - S * 0.02);
  g.quadraticCurveTo(S * 0.55, cy - S * 0.01, S * 0.15, cy + S * 0.06); g.fill();
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function fanTexture() {
  const S = 256, cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d');
  g.fillStyle = '#0d0f12'; g.fillRect(0, 0, S, S);
  g.translate(S / 2, S / 2);
  for (let k = 0; k < 22; k++) {
    g.rotate((Math.PI * 2) / 22);
    const gr = g.createLinearGradient(0, 0, S / 2, 0);
    gr.addColorStop(0, '#3a3f46'); gr.addColorStop(1, '#8a929c');
    g.fillStyle = gr;
    g.beginPath(); g.moveTo(S * 0.08, -2); g.quadraticCurveTo(S * 0.3, -S * 0.07, S * 0.5, -S * 0.04);
    g.lineTo(S * 0.5, S * 0.02); g.quadraticCurveTo(S * 0.3, -S * 0.01, S * 0.08, 4); g.fill();
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

let glowTex = null;
export function glowTexture() {
  if (glowTex) return glowTex;
  const S = 64, cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d');
  const gr = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.2, 'rgba(255,255,255,0.8)');
  gr.addColorStop(0.5, 'rgba(255,255,255,0.15)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, S, S);
  glowTex = new THREE.CanvasTexture(cv);
  return glowTex;
}

// ------------------------------------------------------------ the aircraft

export class Airliner {
  constructor({ livery = LIVERIES.amber, detail = 1, lights = true, big = true } = {}) {
    this.root = new THREE.Group();
    this.root.name = 'airliner';
    const hi = detail >= 1;

    const paint = new THREE.MeshStandardMaterial({ map: liveryTexture(livery, big && hi), metalness: 0.2, roughness: 0.32 });
    const wingMat = new THREE.MeshStandardMaterial({ color: '#cdd2d8', metalness: 0.45, roughness: 0.42 });
    const flapMat = new THREE.MeshStandardMaterial({ color: '#bfc5cc', metalness: 0.45, roughness: 0.5, side: THREE.DoubleSide });
    const finMat = new THREE.MeshStandardMaterial({ map: finTexture(livery), metalness: 0.2, roughness: 0.35 });
    const blue = new THREE.MeshStandardMaterial({ color: livery.main, metalness: 0.25, roughness: 0.35, side: THREE.DoubleSide });
    const metal = new THREE.MeshStandardMaterial({ color: '#b8bec6', metalness: 0.95, roughness: 0.22, side: THREE.DoubleSide });
    const dark = new THREE.MeshStandardMaterial({ color: '#15181c', metalness: 0.4, roughness: 0.6, side: THREE.DoubleSide });
    const gearMat = new THREE.MeshStandardMaterial({ color: '#d9dbde', metalness: 0.3, roughness: 0.5 });
    const chrome = new THREE.MeshStandardMaterial({ color: '#f0f0f0', metalness: 1, roughness: 0.12 });
    const tire = new THREE.MeshStandardMaterial({ color: '#151515', metalness: 0, roughness: 0.92 });
    const hubMat = new THREE.MeshStandardMaterial({ color: '#9da3aa', metalness: 0.7, roughness: 0.35 });
    const belly = new THREE.MeshStandardMaterial({ color: '#c5cad1', metalness: 0.2, roughness: 0.4 });
    this.materials = [paint, wingMat, flapMat, finMat, blue, metal, dark, gearMat, chrome, tire, hubMat, belly];

    const add = (geo, mat, parent = this.root) => {
      const m = new THREE.Mesh(geo, mat);
      m.castShadow = true; m.receiveShadow = hi;
      parent.add(m);
      return m;
    };

    // Fuselage.
    add(fuselageGeometry(hi ? 72 : 36, hi ? 48 : 24), paint);

    // Wings ------------------------------------------------------------
    const nf = hi ? 9 : 5;
    const wingSec = (x, side) => {
      const chord = x < 6.2 ? 6.9 + (4.3 - 6.9) * (x - 1.2) / 5.0 : 4.3 + (1.5 - 4.3) * (x - 6.2) / 10.8;
      const le = V(side * x, -1.2 + (x - 1.2) * 0.096, -3.4 + (x - 1.2) * 0.5095);
      return { le, chord: V(0, 0, chord), up: V(0, 1, 0), t: 0.15 - 0.05 * (x - 1.2) / 15.8 };
    };
    const secsAt = (xs, side) => xs.map((x) => wingSec(x, side));
    const hingeA = (s, c) => s.le.clone().addScaledVector(s.chord, c);
    this.flaps = []; this.ailerons = []; this.spoilers = [];
    for (const side of [1, -1]) {
      add(panel(secsAt([1.2, 2.0, 4.0, 6.2, 9, 12, 15, 17], side), 0, 0.76, nf), wingMat);
      add(panel(secsAt([1.2, 2.0], side), 0.76, 1, 4), wingMat);
      add(panel(secsAt([15.2, 17], side), 0.76, 1, 4), wingMat);
      for (const [x0, x1] of [[2.0, 6.2], [6.2, 11.8]]) {
        const ss = secsAt([x0, x1], side);
        const p = hinged(panel(ss, 0.76, 1, 4), flapMat, hingeA(ss[0], 0.78), hingeA(ss[1], 0.78));
        p.userData.side = side;
        this.root.add(p); this.flaps.push(p);
      }
      const as = secsAt([11.8, 15.2], side);
      const ail = hinged(panel(as, 0.76, 1, 4), flapMat, hingeA(as[0], 0.77), hingeA(as[1], 0.77));
      ail.userData.side = side;
      this.root.add(ail); this.ailerons.push(ail);
      // Spoilers: plates lying on the upper surface.
      for (let k = 0; k < 5; k++) {
        const x0 = 2.6 + k * 1.8, x1 = x0 + 1.7;
        const s0 = wingSec(x0, side), s1 = wingSec(x1, side);
        const P = (s, c) => { const [yu] = foil(c, s.t); return s.le.clone().addScaledVector(s.chord, c).addScaledVector(s.up, yu * s.chord.length() + 0.015); };
        const a0 = P(s0, 0.54), a1 = P(s1, 0.54), b0 = P(s0, 0.74), b1 = P(s1, 0.74);
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute([...a0.toArray(), ...a1.toArray(), ...b0.toArray(), ...b1.toArray()], 3));
        g.setIndex([0, 2, 1, 1, 2, 3]);
        g.computeVertexNormals();
        const sp = hinged(g, flapMat, a0, a1);
        sp.userData.side = side;
        this.root.add(sp); this.spoilers.push(sp);
      }
      // Sharklet.
      const tip = wingSec(17, side);
      add(panel([
        { le: V(side * 16.95, tip.le.y, 4.75), chord: V(0, 0, 1.45), up: V(side, 0, 0), t: 0.09 },
        { le: V(side * 17.1, tip.le.y + 0.6, 5.2), chord: V(0, 0, 1.05), up: V(side, 0, 0), t: 0.09 },
        { le: V(side * 17.35, tip.le.y + 2.35, 6.25), chord: V(0, 0, 0.55), up: V(side, 0, 0), t: 0.08 },
      ], 0, 1, 4), blue);
    }
    // Wing-to-body fairing.
    const fair = add(new THREE.SphereGeometry(1, hi ? 24 : 12, hi ? 12 : 6), belly);
    fair.scale.set(2.05, 0.95, 6.6); fair.position.set(0, -1.45, 0.4);

    // Tailplane ----------------------------------------------------------
    this.elevators = [];
    const stab = (x, side) => ({
      le: V(side * x, 0.95 + (x - 0.2) * 0.105, 12.4 + (x - 0.2) * 0.577),
      chord: V(0, 0, 4.0 + (1.5 - 4.0) * (x - 0.2) / 6.1), up: V(0, 1, 0), t: 0.11 - 0.02 * (x - 0.2) / 6.1,
    });
    for (const side of [1, -1]) {
      const ss = [stab(0.2, side), stab(3, side), stab(6.3, side)];
      add(panel(ss, 0, 0.7, nf), wingMat);
      const es = [stab(0.6, side), stab(6.1, side)];
      const el = hinged(panel(es, 0.7, 1, 4), flapMat, hingeA(es[0], 0.71), hingeA(es[1], 0.71));
      this.root.add(el); this.elevators.push(el);
    }
    // Fin.
    const finUV = (p) => [(p.z - 8) / 9.2, (p.y - 1.3) / 6.7];
    const fin = [
      { le: V(0, 1.4, 8.1), chord: V(0, 0, 8.3), up: V(1, 0, 0), t: 0.08 },
      { le: V(0, 2.6, 10.8), chord: V(0, 0, 5.6), up: V(1, 0, 0), t: 0.11 },
      { le: V(0, 7.9, 14.8), chord: V(0, 0, 2.25), up: V(1, 0, 0), t: 0.1 },
    ];
    add(panel([fin[0], fin[1]], 0, 1, nf, finUV), finMat);
    add(panel([fin[1], fin[2]], 0, 0.68, nf, finUV), finMat);
    const rs = [fin[1], fin[2]];
    this.rudder = hinged(panel(rs, 0.68, 1, 4, finUV), finMat, hingeA(rs[0], 0.69), hingeA(rs[1], 0.69));
    this.root.add(this.rudder);

    // Engines --------------------------------------------------------------
    this.fans = [];
    const fanTex = fanTexture();
    for (const side of [1, -1]) {
      const eng = new THREE.Group();
      eng.position.set(side * 5.75, -2.2, -3.6);
      this.root.add(eng);
      const prof = [
        [0.84, -1.5], [0.86, -2.05], [0.93, -2.24], [1.0, -2.24], [1.05, -2.12], [1.09, -1.7],
        [1.09, -0.6], [1.03, 0.6], [0.94, 1.45], [0.86, 1.9],
      ].map(([r, z]) => new THREE.Vector2(r, z));
      const nac = new THREE.LatheGeometry(prof, hi ? 40 : 18).rotateX(Math.PI / 2);
      add(nac, blue, eng);
      const lip = new THREE.LatheGeometry([[0.85, -2.0], [0.88, -2.16], [0.94, -2.26], [1.0, -2.25], [1.04, -2.14]]
        .map(([r, z]) => new THREE.Vector2(r, z)), hi ? 40 : 18).rotateX(Math.PI / 2);
      lip.translate(0, 0, -0.005);
      add(lip, metal, eng);
      add(new THREE.CylinderGeometry(0.85, 0.85, 1.2, hi ? 32 : 14, 1, true).rotateX(Math.PI / 2).translate(0, 0, -1.2), dark, eng);
      const fan = new THREE.Group();
      fan.position.z = -1.05;
      const disk = add(new THREE.CircleGeometry(0.85, hi ? 32 : 14), new THREE.MeshStandardMaterial({ map: fanTex, metalness: 0.6, roughness: 0.4 }), fan);
      disk.rotation.y = Math.PI;
      const spin = add(new THREE.ConeGeometry(0.27, 0.6, hi ? 20 : 10).rotateX(-Math.PI / 2).translate(0, 0, -0.3), dark, fan);
      spin.material = new THREE.MeshStandardMaterial({ color: '#1a1d22', metalness: 0.6, roughness: 0.3 });
      // The white swirl on the spinner, as a thin twisted ribbon.
      const sw = new THREE.Mesh(new THREE.TorusGeometry(0.14, 0.018, 4, 12, Math.PI * 1.2), new THREE.MeshBasicMaterial({ color: '#f4f4f4' }));
      sw.position.z = -0.33; sw.rotation.x = 0.25;
      fan.add(sw);
      eng.add(fan);
      this.fans.push(fan);
      const core = new THREE.LatheGeometry([[0.62, 1.7], [0.58, 2.3], [0.42, 2.9], [0.3, 2.95], [0.0, 3.6]]
        .map(([r, z]) => new THREE.Vector2(r, z)), hi ? 28 : 12).rotateX(Math.PI / 2);
      add(core, metal, eng);
      // Pylon.
      const pylon = add(new THREE.BoxGeometry(0.34, 1.1, 4.2), wingMat, eng);
      pylon.position.set(0, 1.05, 0.9);
      pylon.rotation.x = -0.06;
    }

    // Landing gear ----------------------------------------------------------
    this.wheels = [];
    const cyl = (r, h, seg = hi ? 16 : 8) => new THREE.CylinderGeometry(r, r, h, seg);
    const wheel = (r, w, parent, x) => {
      const wg = new THREE.Group();
      wg.position.x = x;
      add(cyl(r, w, hi ? 24 : 12).rotateZ(Math.PI / 2), tire, wg);
      const hub = add(cyl(r * 0.55, w + 0.02, hi ? 16 : 8).rotateZ(Math.PI / 2), hubMat, wg);
      hub.castShadow = false;
      parent.add(wg);
      this.wheels.push({ g: wg, r });
      return wg;
    };
    this.mainGear = [];
    for (const side of [1, -1]) {
      const pivot = new THREE.Group();
      pivot.position.set(side * 3.05, -1.5, 1.35);
      this.root.add(pivot);
      add(cyl(0.14, 1.35).translate(0, -0.67, 0), gearMat, pivot);
      add(cyl(0.095, 0.75).translate(0, -1.55, 0), chrome, pivot);
      const axle = new THREE.Group();
      axle.position.y = -1.9;
      pivot.add(axle);
      add(cyl(0.07, 1.0).rotateZ(Math.PI / 2), gearMat, axle);
      wheel(0.57, 0.36, axle, 0.42);
      wheel(0.57, 0.36, axle, -0.42);
      const door = add(new THREE.BoxGeometry(0.05, 1.45, 1.0), belly, pivot);
      door.position.set(side * 0.22, -0.78, 0);
      const brace = add(cyl(0.06, 1.6).translate(0, -0.8, 0), gearMat, pivot);
      brace.position.set(-side * 0.0, 0, 0); brace.rotation.z = side * 0.45; brace.scale.y = 0.9;
      pivot.userData.side = side;
      this.mainGear.push(pivot);
    }
    this.noseGear = new THREE.Group();
    this.noseGear.position.set(0, -1.55, -13.6);
    this.root.add(this.noseGear);
    add(cyl(0.11, 1.2).translate(0, -0.6, 0), gearMat, this.noseGear);
    this.noseSteer = new THREE.Group();
    this.noseGear.add(this.noseSteer);
    add(cyl(0.075, 0.95).translate(0, -1.4, 0), chrome, this.noseSteer);
    const naxle = new THREE.Group();
    naxle.position.y = -2.05;
    this.noseSteer.add(naxle);
    add(cyl(0.05, 0.6).rotateZ(Math.PI / 2), gearMat, naxle);
    wheel(0.37, 0.24, naxle, 0.2);
    wheel(0.37, 0.24, naxle, -0.2);
    // Taxi/landing light on the nose leg.
    this.noseLamp = add(new THREE.SphereGeometry(0.09, 8, 6), new THREE.MeshBasicMaterial({ color: '#fffbe8' }), this.noseGear);
    this.noseLamp.position.set(0, -0.9, -0.16);
    this.noseDoors = [];
    for (const side of [1, -1]) {
      const d = new THREE.Group();
      d.position.set(side * 0.42, -1.92, -13.55);
      const m = add(new THREE.BoxGeometry(0.4, 0.04, 2.0), belly, d);
      m.position.x = -side * 0.2;
      d.userData.side = side;
      this.root.add(d); this.noseDoors.push(d);
    }

    // Lights -----------------------------------------------------------------
    this.lights = [];
    if (lights) {
      const glow = (color, x, y, z, size, kind) => {
        const mat = new THREE.SpriteMaterial({ map: glowTexture(), color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, sizeAttenuation: false, fog: false });
        const s = new THREE.Sprite(mat);
        s.position.set(x, y, z);
        s.scale.setScalar(size);
        s.userData = { kind, size };
        s.renderOrder = 8;
        this.root.add(s);
        this.lights.push(s);
        const bulb = add(new THREE.SphereGeometry(0.08, 6, 4), new THREE.MeshBasicMaterial({ color }));
        bulb.position.set(x, y, z);
        bulb.castShadow = false;
      };
      glow('#ff2a2a', -17.42, -0.1, 5.6, 0.018, 'nav');
      glow('#2aff5a', 17.42, -0.1, 5.6, 0.018, 'nav');
      glow('#ffffff', 0, 1.45, 19.1, 0.014, 'nav');
      glow('#ffffff', -17.45, -0.05, 5.9, 0.05, 'strobe');
      glow('#ffffff', 17.45, -0.05, 5.9, 0.05, 'strobe');
      glow('#ff3030', 0, 2.1, 1.0, 0.03, 'beacon');
      glow('#ff3030', 0, -2.1, 3.0, 0.03, 'beacon');
      glow('#fffbe8', 0, -2.45, -13.76, 0.06, 'landing');
    }

    this.state = { gear: 1, flaps: 0, spoilers: 0 };
    this.setGear(1);
    this.setFlaps(0);
    this.setControls(0, 0, 0);
    this.setSpoilers(0);
  }

  setEnv(env) {
    for (const m of this.materials) { m.envMap = env; m.envMapIntensity = 1.0; m.needsUpdate = true; }
  }

  /** 0 = stowed, 1 = down and locked. */
  setGear(p) {
    this.state.gear = p;
    // Doors open first, the legs swing, then the doors close behind them.
    const leg = 1 - smooth(0.12, 0.95, p);
    for (const g of this.mainGear) g.rotation.z = -g.userData.side * leg * Math.PI / 2;
    this.noseGear.rotation.x = leg * Math.PI / 2 * 0.98;
    const door = p > 0.98 ? 0.75 : Math.min(1, Math.min(p, 1 - p) * 8);
    for (const d of this.noseDoors) d.rotation.z = d.userData.side * door * Math.PI / 2 * 0.9;
    this.noseLamp.visible = p > 0.9;
    for (const l of this.lights) if (l.userData.kind === 'landing') l.visible = p > 0.9;
  }

  /** 0 = clean, 1 = full. */
  setFlaps(f) {
    this.state.flaps = f;
    for (const p of this.flaps) {
      swing(p, p.userData.side * f * 0.62);
      // Flaps slide aft as well as drooping.
      p.children[0].position.z = f * 0.7;
    }
  }

  /** Control surfaces, each -1..1. */
  setControls(aileron, elevator, rudder) {
    for (const a of this.ailerons) swing(a, -aileron * 0.35);
    for (const e of this.elevators) swing(e, (e.userData.axis.x > 0 ? 1 : -1) * -elevator * 0.4);
    swing(this.rudder, rudder * 0.45);
  }

  setSpoilers(s) {
    this.state.spoilers = s;
    for (const p of this.spoilers) swing(p, -p.userData.side * s * 0.85);
  }

  spinFans(rate, dt) {
    for (const f of this.fans) f.rotation.z += rate * dt;
  }

  rollWheels(dist) {
    for (const w of this.wheels) w.g.rotation.x -= dist / w.r;
  }

  steerNose(a) { this.noseSteer.rotation.y = a; }

  updateLights(t) {
    for (const l of this.lights) {
      const k = l.userData.kind;
      if (k === 'strobe') { const ph = t % 1.2; l.visible = ph < 0.05 || (ph > 0.12 && ph < 0.17); }
      else if (k === 'beacon') l.material.opacity = Math.max(0, Math.sin(t * Math.PI * 1.1)) ** 6;
    }
  }
}

/**
 * Collapse a static aircraft into one mesh per material. A parked airliner is
 * ninety-odd meshes that never move; merged, it is about a dozen draw calls.
 */
export function bakeStatic(root) {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const groups = new Map();
  root.traverse((o) => {
    if (!o.isMesh || !o.visible) return;
    let g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
    g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld));
    if (!g.attributes.normal) g.computeVertexNormals();
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    const key = o.material.uuid;
    if (!groups.has(key)) groups.set(key, { mat: o.material, list: [] });
    groups.get(key).list.push(g);
  });
  const out = new THREE.Group();
  out.name = 'parked';
  for (const { mat, list } of groups.values()) {
    let n = 0;
    for (const g of list) n += g.attributes.position.count;
    const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = new Float32Array(n * 2);
    let o = 0;
    for (const g of list) {
      pos.set(g.attributes.position.array, o * 3);
      nor.set(g.attributes.normal.array, o * 3);
      uv.set(g.attributes.uv.array.subarray(0, g.attributes.position.count * 2), o * 2);
      o += g.attributes.position.count;
      g.dispose();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.computeBoundingSphere();
    out.add(new THREE.Mesh(geo, mat));
  }
  root.traverse((o) => { if (o.isMesh) o.geometry.dispose(); });
  return out;
}

function smooth(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
