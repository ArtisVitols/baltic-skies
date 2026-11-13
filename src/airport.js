// Airports: runways with proper markings, taxiways, an apron, a terminal,
// a control tower, hangars, edge and approach lights, a PAPI that tells you
// whether you are on the glide path, and parked aircraft once you are close.
//
// Each airport is built in its own frame: local -Z is the runway heading
// (runway end 0 lands that way), local +X is the side the terminal is on.

import * as THREE from 'three';
import { Airliner, LIVERIES, glowTexture, bakeStatic } from './plane.js';

const RW = 45;               // runway width
const DECAL = 420;           // length of the painted end sections

// --------------------------------------------------------------- textures

function canvasTex(w, h, draw, repeat = false) {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  draw(cv.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function speckle(g, w, h, base, n, spread) {
  g.fillStyle = base; g.fillRect(0, 0, w, h);
  for (let i = 0; i < n; i++) {
    const v = Math.floor((Math.random() - 0.5) * spread);
    g.fillStyle = `rgba(${v > 0 ? 255 : 0},${v > 0 ? 255 : 0},${v > 0 ? 255 : 0},${Math.abs(v) / 255})`;
    g.fillRect(Math.random() * w, Math.random() * h, 2, 2);
  }
}

let TEX = null;
function textures() {
  if (TEX) return TEX;
  const pxm = 256 / RW;
  TEX = {
    runway: canvasTex(256, 512, (g, w, h) => {
      speckle(g, w, h, '#3d4045', 2500, 40);
      // Rubber in the middle where the wheels run.
      const gr = g.createLinearGradient(0, 0, w, 0);
      gr.addColorStop(0.3, 'rgba(20,20,22,0)'); gr.addColorStop(0.42, 'rgba(20,20,22,0.25)');
      gr.addColorStop(0.58, 'rgba(20,20,22,0.25)'); gr.addColorStop(0.7, 'rgba(20,20,22,0)');
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
      g.fillStyle = '#e9e9e4';
      g.fillRect(1.2 * pxm, 0, 0.9 * pxm, h);
      g.fillRect(w - 2.1 * pxm, 0, 0.9 * pxm, h);
      g.fillRect(w / 2 - 0.45 * pxm, 0, 0.9 * pxm, h * 0.6);
    }, true),
    end: (num) => canvasTex(256, 2048, (g, w, h) => {
      speckle(g, w, h, '#3d4045', 9000, 40);
      const my = h / DECAL;                      // px per metre along
      const Y = (m) => h - m * my;               // metres from the threshold → canvas y
      g.fillStyle = '#ecece6';
      // Threshold piano keys.
      for (let k = 0; k < 8; k++) {
        const x = 3 * pxm + k * 2.4 * pxm;
        g.fillRect(x, Y(36), 1.6 * pxm, 30 * my);
        g.fillRect(w - x - 1.6 * pxm, Y(36), 1.6 * pxm, 30 * my);
      }
      // Runway number.
      g.save();
      g.translate(w / 2, Y(54));
      g.scale(1, (18 * my) / (12 * pxm));
      g.font = `bold ${12 * pxm}px "Arial Narrow", Arial, sans-serif`;
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(num, 0, 0);
      g.restore();
      // Touchdown zone bars and the aiming point.
      for (const [m, n] of [[150, 3], [300, 0], [450, 2]]) {
        for (let k = 0; k < n; k++) {
          const x = 4 * pxm + k * 2.2 * pxm;
          g.fillRect(x, Y(m + 22), 1.6 * pxm, 22 * my);
          g.fillRect(w - x - 1.6 * pxm, Y(m + 22), 1.6 * pxm, 22 * my);
        }
      }
      g.fillRect(6 * pxm, Y(345), 6 * pxm, 45 * my);
      g.fillRect(w - 12 * pxm, Y(345), 6 * pxm, 45 * my);
      // Centreline dashes through the decal, matching the main strip.
      for (let m = 72; m < DECAL; m += 50) g.fillRect(w / 2 - 0.45 * pxm, Y(m + 30), 0.9 * pxm, 30 * my);
      // Edge lines.
      g.fillRect(1.2 * pxm, 0, 0.9 * pxm, h);
      g.fillRect(w - 2.1 * pxm, 0, 0.9 * pxm, h);
    }),
    taxi: canvasTex(64, 128, (g, w, h) => {
      speckle(g, w, h, '#45484c', 300, 40);
      g.fillStyle = '#e8b51c'; g.fillRect(w / 2 - 2, 0, 4, h);
      g.fillRect(2, 0, 2, h); g.fillRect(w - 4, 0, 2, h);
    }, true),
    apron: canvasTex(256, 256, (g, w, h) => {
      speckle(g, w, h, '#9a9c9a', 1800, 30);
      g.strokeStyle = 'rgba(60,60,60,0.35)'; g.lineWidth = 1;
      for (let i = 0; i <= w; i += 32) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, h); g.stroke(); g.beginPath(); g.moveTo(0, i); g.lineTo(w, i); g.stroke(); }
    }, true),
    glass: canvasTex(256, 128, (g, w, h) => {
      const gr = g.createLinearGradient(0, 0, 0, h);
      gr.addColorStop(0, '#5f87a8'); gr.addColorStop(1, '#22384f');
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
      g.fillStyle = '#c9d1d8';
      for (let x = 0; x < w; x += 16) g.fillRect(x, 0, 2, h);
      for (let y = 0; y < h; y += 32) g.fillRect(0, y, w, 3);
    }, true),
  };
  return TEX;
}

function signTexture(text) {
  return canvasTex(1024, 128, (g, w, h) => {
    g.fillStyle = '#0e2a4d'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#ffffff';
    g.font = 'bold 84px "Trebuchet MS", Arial, sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(text, w / 2, h / 2 + 4);
  });
}

// --------------------------------------------------------------- geometry

/** A flat quad from four local XZ corners, with explicit UVs. */
function quad(p00, p10, p01, p11, uvs = [[0, 0], [1, 0], [0, 1], [1, 1]], y = 0) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([
    p00[0], y, p00[1], p10[0], y, p10[1], p01[0], y, p01[1], p11[0], y, p11[1]], 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs.flat(), 2));
  g.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
  // Wind so the face points up whatever order the corners came in.
  const ax = p10[0] - p00[0], az = p10[1] - p00[1], bx = p01[0] - p00[0], bz = p01[1] - p00[1];
  const up = az * bx - ax * bz;           // y of (p10-p00) × (p01-p00)
  g.setIndex(up > 0 ? [0, 1, 2, 2, 1, 3] : [0, 2, 1, 1, 2, 3]);
  return g;
}

function flatMat(map, offset) {
  return new THREE.MeshLambertMaterial({
    map, polygonOffset: true,
    polygonOffsetFactor: -offset, polygonOffsetUnits: -offset * 2,
  });
}

// --------------------------------------------------------------- Airports

export class Airports {
  constructor(scene, world, env) {
    this.scene = scene;
    this.world = world;
    this.env = env;
    this.list = world.airports;
    this.parked = new Map();
    for (const a of this.list) this.build(a);
  }

  build(a) {
    const T = textures();
    const big = a.len >= 3000;
    const grp = new THREE.Group();
    grp.position.set(a.x, a.elev, a.z);
    grp.rotation.y = -(a.hdg * Math.PI) / 180;
    a.group = grp;
    const hl = a.hl;
    const add = (geo, mat, y = 0) => { const m = new THREE.Mesh(geo, mat); m.position.y = y; grp.add(m); return m; };

    // Runway.
    const rwTex = T.runway.clone(); rwTex.needsUpdate = true;
    rwTex.repeat.set(1, (2 * hl) / 50);
    add(quad([-RW / 2, hl], [RW / 2, hl], [-RW / 2, -hl], [RW / 2, -hl]), flatMat(rwTex, 1), 0.12);
    // Shoulders.
    const sh = new THREE.MeshLambertMaterial({ color: '#5b5e5a', polygonOffset: true, polygonOffsetFactor: -0.5, polygonOffsetUnits: -1 });
    add(quad([-RW / 2 - 7, hl + 60], [RW / 2 + 7, hl + 60], [-RW / 2 - 7, -hl - 60], [RW / 2 + 7, -hl - 60]), sh, 0.08);
    // Painted ends.
    const e0 = flatMat(T.end(a.ends[0].num), 2), e1 = flatMat(T.end(a.ends[1].num), 2);
    add(quad([-RW / 2, hl], [RW / 2, hl], [-RW / 2, hl - DECAL], [RW / 2, hl - DECAL]), e0, 0.14);
    add(quad([RW / 2, -hl], [-RW / 2, -hl], [RW / 2, -hl + DECAL], [-RW / 2, -hl + DECAL]), e1, 0.14);

    // Everything below here only matters within a few kilometres.
    const runwayGroup = grp;
    const detail = new THREE.Group();
    runwayGroup.add(detail);
    const add2 = (geo, mat, y = 0) => { const m = new THREE.Mesh(geo, mat); m.position.y = y; detail.add(m); return m; };
    a.detail = detail;
    // Taxiways: a parallel one and three links.
    const tx = 190, tw = 23;
    const taxiMat = flatMat(T.taxi, 1);
    const L = (2 * hl) / 40;
    add2(quad([tx - tw / 2, hl], [tx + tw / 2, hl], [tx - tw / 2, -hl], [tx + tw / 2, -hl], [[0, 0], [1, 0], [0, L], [1, L]]), taxiMat, 0.1);
    for (const z of [hl - 30, 0, -hl + 30]) {
      add2(quad([RW / 2, z + tw / 2], [RW / 2, z - tw / 2], [tx, z + tw / 2], [tx, z - tw / 2], [[0, 0], [1, 0], [0, tx / 40], [1, tx / 40]]), taxiMat, 0.1);
    }

    // Apron.
    const aw = big ? 520 : 320, ad = 150, ax0 = tx + tw / 2, ax1 = ax0 + ad;
    add2(quad([ax0, aw / 2], [ax1, aw / 2], [ax0, -aw / 2], [ax1, -aw / 2], [[0, 0], [ad / 40, 0], [0, aw / 40], [ad / 40, aw / 40]]), flatMat(T.apron, 1), 0.1);

    // Terminal.
    const termLen = aw * 0.8, termD = 34, termH = big ? 18 : 13;
    const glass = T.glass.clone(); glass.needsUpdate = true; glass.repeat.set(termLen / 40, 1);
    const termMat = [
      new THREE.MeshStandardMaterial({ color: '#d7dbe0', roughness: 0.6 }),
      new THREE.MeshStandardMaterial({ color: '#d7dbe0', roughness: 0.6 }),
      new THREE.MeshStandardMaterial({ color: '#b9c0c8', roughness: 0.7 }),
      new THREE.MeshStandardMaterial({ color: '#555', roughness: 0.9 }),
      new THREE.MeshStandardMaterial({ map: glass, metalness: 0.55, roughness: 0.18, envMap: this.env }),
      new THREE.MeshStandardMaterial({ map: glass, metalness: 0.55, roughness: 0.18, envMap: this.env }),
    ];
    const term = new THREE.Mesh(new THREE.BoxGeometry(termLen, termH, termD), termMat);
    term.rotation.y = Math.PI / 2;
    term.position.set(ax1 + termD / 2 + 5, termH / 2, 0);
    detail.add(term);
    // A swooping roof.
    const roof = new THREE.Mesh(new THREE.CylinderGeometry(30, 30, termLen + 10, 24, 1, false, -0.5, 1.0),
      new THREE.MeshStandardMaterial({ color: '#eef1f4', metalness: 0.5, roughness: 0.3, envMap: this.env, side: THREE.DoubleSide }));
    roof.rotation.x = -Math.PI / 2;
    roof.position.set(ax1 + termD / 2 + 5, termH - 26.5, 0);
    detail.add(roof);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(64, 8), new THREE.MeshBasicMaterial({ map: signTexture(a.name.toUpperCase()) }));
    sign.position.set(ax1 + 4.5, termH + 4.5, 0);
    sign.rotation.y = -Math.PI / 2;
    detail.add(sign);
    // Jet bridges.
    const bridgeMat = new THREE.MeshStandardMaterial({ color: '#cfd3d7', roughness: 0.5 });
    const gates = big ? [-150, -50, 50, 150] : [-70, 70];
    for (const z of gates) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(22, 3.2, 3.4), bridgeMat);
      b.position.set(ax1 - 11, 5.2, z + 18);
      detail.add(b);
    }
    a.gates = gates.map((z) => ({ x: ax1 - 36, z }));

    // Control tower.
    const towerX = ax1 + 20, towerZ = aw / 2 + 40;
    const towerH = big ? 46 : 32;
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 3.4, towerH, 16), new THREE.MeshStandardMaterial({ color: '#e9ecef', roughness: 0.6 }));
    shaft.position.set(towerX, towerH / 2, towerZ);
    detail.add(shaft);
    const cab = new THREE.Mesh(new THREE.CylinderGeometry(6.5, 5.2, 5, 16), new THREE.MeshStandardMaterial({ color: '#2b4a63', metalness: 0.7, roughness: 0.15, envMap: this.env }));
    cab.position.set(towerX, towerH + 2.5, towerZ);
    detail.add(cab);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(4, 7, 2, 16), new THREE.MeshStandardMaterial({ color: '#dfe3e7' }));
    cap.position.set(towerX, towerH + 6, towerZ);
    detail.add(cap);
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 8, 6), new THREE.MeshStandardMaterial({ color: '#c33' }));
    mast.position.set(towerX, towerH + 11, towerZ);
    detail.add(mast);

    // Hangars.
    const hangMat = new THREE.MeshStandardMaterial({ color: '#b7bdc4', metalness: 0.5, roughness: 0.4, envMap: this.env, side: THREE.DoubleSide });
    for (let k = 0; k < (big ? 3 : 1); k++) {
      const hg = new THREE.Mesh(new THREE.CylinderGeometry(24, 24, 60, 20, 1, false, -Math.PI / 2, Math.PI), hangMat);
      hg.rotation.x = -Math.PI / 2;
      hg.position.set(ax0 + 70, 0, -aw / 2 - 60 - k * 70);
      detail.add(hg);
    }

    // Windsock.
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 8, 6), new THREE.MeshLambertMaterial({ color: '#ddd' }));
    pole.position.set(-RW / 2 - 60, 4, hl - 300);
    detail.add(pole);
    const sock = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.25, 4, 10, 1, true).rotateZ(Math.PI / 2), new THREE.MeshLambertMaterial({ color: '#ff6a00', side: THREE.DoubleSide }));
    sock.position.set(-RW / 2 - 58, 7.6, hl - 300);
    detail.add(sock);

    // Lights: edges (white), thresholds (green), ends (red), approach (white).
    const pts = [], cols = [];
    const c = (hex) => new THREE.Color(hex);
    const W = c('#fff6dc'), G = c('#3dff6a'), Rr = c('#ff3b3b');
    for (let z = -hl; z <= hl + 0.1; z += 60) for (const x of [-RW / 2 - 1.5, RW / 2 + 1.5]) { pts.push(x, 0.6, z); cols.push(W.r, W.g, W.b); }
    for (let x = -RW / 2; x <= RW / 2; x += 4) {
      pts.push(x, 0.6, hl + 1, x, 0.6, -hl - 1);
      cols.push(G.r, G.g, G.b, G.r, G.g, G.b);
      pts.push(x, 0.6, hl + 4, x, 0.6, -hl - 4);
      cols.push(Rr.r, Rr.g, Rr.b, Rr.r, Rr.g, Rr.b);
    }
    for (const s of [1, -1]) {
      for (let d = 60; d <= 900; d += 30) {
        pts.push(0, 0.8, s * (hl + d)); cols.push(W.r, W.g, W.b);
        if (d % 150 === 0) for (const x of [-12, -6, 6, 12]) { pts.push(x, 0.8, s * (hl + d)); cols.push(W.r, W.g, W.b); }
      }
    }
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    lg.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    const lights = new THREE.Points(lg, new THREE.PointsMaterial({
      size: 3.5, sizeAttenuation: false, vertexColors: true, map: glowTexture(),
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    }));
    grp.add(lights);

    // PAPI: four lights left of each touchdown zone.
    a.papi = [];
    for (const [e, s] of [[0, 1], [1, -1]]) {
      const set = [];
      for (let k = 0; k < 4; k++) {
        const x = s * (-RW / 2 - 15 - k * 9);
        const box = new THREE.Mesh(new THREE.BoxGeometry(2, 1, 1.2), new THREE.MeshLambertMaterial({ color: '#333' }));
        box.position.set(x, 0.6, s * (hl - 300));
        grp.add(box);
        const spr = new THREE.Sprite(new THREE.SpriteMaterial({
          map: glowTexture(), color: '#ffffff', blending: THREE.AdditiveBlending,
          depthWrite: false, transparent: true, sizeAttenuation: false, fog: false,
        }));
        spr.scale.setScalar(0.022);
        spr.position.set(x, 1.4, s * (hl - 300));
        grp.add(spr);
        set.push(spr);
      }
      a.papi[e] = set;
    }

    this.scene.add(grp);
  }

  /** Is a world point on (or just beside) a runway? Returns the airport or null. */
  onRunway(x, z, margin = 0) {
    for (const a of this.list) {
      const dx = x - a.x, dz = z - a.z;
      if (Math.abs(dx) > a.hl + 200 || Math.abs(dz) > a.hl + 200) continue;
      const along = dx * a.dir.x + dz * a.dir.z;
      const perp = -dx * a.dir.z + dz * a.dir.x;
      if (Math.abs(along) <= a.hl + 60 + margin && Math.abs(perp) <= RW / 2 + 8 + margin) return a;
    }
    return null;
  }

  /** PAPI colours, and parked aircraft within reach. */
  update(pos) {
    for (const a of this.list) {
      const d = Math.hypot(pos.x - a.x, pos.z - a.z);
      a.group.visible = d < 34000;
      a.detail.visible = d < 14000;
      if (d < 25000) {
        for (let e = 0; e < 2; e++) {
          const end = a.ends[e];
          // Touchdown point, 300 m in from the threshold.
          const tx = end.x + end.dx * 300, tz = end.z + end.dz * 300;
          const vx = pos.x - tx, vz = pos.z - tz;
          const behind = -(vx * end.dx + vz * end.dz);    // metres out on the approach
          const ang = behind > 0 ? Math.atan2(pos.y - a.elev, Math.hypot(vx, vz)) * 180 / Math.PI : 0;
          const th = [3.5, 3.17, 2.83, 2.5];
          a.papi[e].forEach((s, k) => s.material.color.set(ang > th[k] ? '#ffffff' : '#ff2020'));
        }
      }
      const want = d < 9000;
      const has = this.parked.has(a.code);
      if (want && !has) this.park(a);
      else if (!want && has && d > 12000) {
        for (const p of this.parked.get(a.code)) {
          a.group.remove(p.root);
          p.root.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
          for (const m of p.materials) { m.map?.dispose(); m.dispose(); }
        }
        this.parked.delete(a.code);
      }
    }
  }

  park(a) {
    const ls = [LIVERIES.red, LIVERIES.green, LIVERIES.blue, LIVERIES.amber];
    const list = [];
    a.gates.forEach((g, k) => {
      if (k % 2 === 1 && a.gates.length > 2 && (a.code.charCodeAt(1) + k) % 3 === 0) return;
      const p = new Airliner({ livery: ls[(k + a.code.charCodeAt(0)) % ls.length], detail: 0, lights: false, big: false });
      p.setEnv(this.env);
      const baked = bakeStatic(p.root);
      baked.position.set(g.x, 3.97 + 0.1, g.z);
      baked.rotation.y = -Math.PI / 2;      // nose to the terminal (+X)
      a.group.add(baked);
      list.push({ root: baked, materials: p.materials });
    });
    this.parked.set(a.code, list);
  }
}
