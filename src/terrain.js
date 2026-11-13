// Terrain tiles around the camera, with level of detail, forests and villages.
//
// The land is never stored: every tile is computed from World.info() when the
// camera comes near it and thrown away when it leaves. Field patterns, beaches
// and forest floor are painted in the fragment shader from world position, so
// they stay sharp however coarse the mesh under them is.
//
// Normals are taken from the height *function*, not from the mesh, so tiles
// of different resolution light identically where they meet. Skirts hang off
// every edge to hide the cracks a coarse tile leaves beside a fine one.

import * as THREE from 'three';
import { hash2, rng } from './noise.js';

export const TILE = 4000;

const terrainChunk = /* glsl */`
varying vec4 vCover;
varying vec3 vWPos;
float th21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float tnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(th21(i), th21(i + vec2(1, 0)), f.x), mix(th21(i + vec2(0, 1)), th21(i + vec2(1, 1)), f.x), f.y);
}
vec3 lin(vec3 c) { return pow(c, vec3(2.2)); }

vec3 fieldColor(vec2 p, float px, out float hedge) {
  vec2 reg = floor(p / 3400.0);
  float ang = th21(reg) * 3.14159;
  float ca = cos(ang), sa = sin(ang);
  vec2 q = mat2(ca, -sa, sa, ca) * p;
  vec2 sz = vec2(260.0, 160.0) * (0.65 + 0.7 * th21(reg + 7.0));
  // Shift alternate rows so fields do not line up like a chessboard.
  float row = floor(q.y / sz.y);
  q.x += th21(vec2(row, reg.x)) * sz.x;
  vec2 c = floor(q / sz);
  float r = th21(c + reg * 13.0);
  vec3 col;
  if (r < 0.26) col = vec3(0.40, 0.58, 0.22);
  else if (r < 0.44) col = vec3(0.53, 0.64, 0.27);
  else if (r < 0.58) col = vec3(0.80, 0.72, 0.40);
  else if (r < 0.67) col = vec3(0.56, 0.46, 0.31);
  else if (r < 0.84) col = vec3(0.33, 0.50, 0.20);
  else if (r < 0.92) col = vec3(0.74, 0.76, 0.30);
  else col = vec3(0.46, 0.56, 0.30);
  vec2 f = fract(q / sz);
  float stripes = 0.5 + 0.5 * sin(q.x * 1.3);
  col *= 1.0 - 0.07 * stripes * (1.0 - smoothstep(0.4, 1.6, px));
  float edge = min(min(f.x, 1.0 - f.x) * sz.x, min(f.y, 1.0 - f.y) * sz.y);
  hedge = (1.0 - smoothstep(1.0, 4.0 + px, edge)) * (1.0 - smoothstep(4.0, 14.0, px));
  return col;
}

vec3 terrainColor() {
  vec2 p = vWPos.xz;
  float y = vWPos.y;
  float px = length(fwidth(p));                     // metres per pixel
  float hedge;
  vec3 fields = fieldColor(p, px, hedge);
  vec3 avg = vec3(0.50, 0.60, 0.28);
  fields = mix(fields, avg, smoothstep(30.0, 90.0, px));
  vec3 hedgeCol = vec3(0.20, 0.32, 0.12);
  fields = mix(fields, hedgeCol, hedge * 0.85);

  float n1 = tnoise(p / 23.0), n2 = tnoise(p / 170.0), n3 = tnoise(p / 1700.0);
  vec3 forest = mix(vec3(0.15, 0.29, 0.11), vec3(0.27, 0.40, 0.16), n1 * 0.5 + n2 * 0.5);
  forest = mix(forest, mix(vec3(0.18, 0.31, 0.12), vec3(0.26, 0.38, 0.15), n2), smoothstep(8.0, 40.0, px));
  // Some forest is birch and some is pine: patches of lighter and bluer green.
  forest = mix(forest, vec3(0.30, 0.44, 0.18), smoothstep(0.55, 0.8, n3) * 0.6);

  vec3 grass = mix(vec3(0.38, 0.56, 0.23), vec3(0.44, 0.62, 0.26), step(0.5, fract(dot(p, vec2(0.7, 0.7)) / 30.0)) * (1.0 - smoothstep(1.0, 4.0, px)));
  vec3 city = mix(vec3(0.52, 0.53, 0.50), vec3(0.40, 0.47, 0.34), n2);

  vec3 col = fields;
  col = mix(col, forest, smoothstep(0.35, 0.65, vCover.x));
  col = mix(col, city, vCover.z * 0.85);
  col = mix(col, grass, vCover.y);

  // Big lazy colour drift so the whole country is not one green.
  col *= 0.86 + 0.28 * n3;
  col *= 0.93 + 0.14 * mix(n1, 0.5, smoothstep(2.0, 12.0, px));

  vec3 sand = vec3(0.86, 0.80, 0.62);
  float beach = 1.0 - smoothstep(1.2, 2.4 + n1, y);
  col = mix(col, sand, beach * (1.0 - vCover.y));
  vec3 seabed = mix(vec3(0.80, 0.76, 0.58), vec3(0.08, 0.20, 0.20), smoothstep(-0.2, -14.0, y));
  col = mix(col, seabed, step(y, 0.4) * (1.0 - vCover.y));
  return lin(col);
}
`;

export function makeTerrainMaterial() {
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aCover;\nvarying vec4 vCover;\nvarying vec3 vWPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvCover = aCover;\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + terrainChunk)
      .replace('#include <color_fragment>', 'diffuseColor.rgb = terrainColor();');
  };
  return mat;
}

// ------------------------------------------------------------ tree & house kit

function vcolor(geo, hex) {
  const c = new THREE.Color(hex);
  const n = geo.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return geo;
}
function merge(geos) {
  // Tiny merge (positions, normals, colours) so we need no addons.
  let n = 0, idx = 0;
  for (const g of geos) { n += g.attributes.position.count; idx += g.index ? g.index.count : g.attributes.position.count; }
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), col = new Float32Array(n * 3);
  const ind = new Uint32Array(idx);
  let o = 0, io = 0;
  for (const g of geos) {
    const c = g.attributes.position.count;
    pos.set(g.attributes.position.array, o * 3);
    nor.set(g.attributes.normal.array, o * 3);
    col.set(g.attributes.color.array, o * 3);
    if (g.index) { for (let i = 0; i < g.index.count; i++) ind[io++] = g.index.array[i] + o; }
    else { for (let i = 0; i < c; i++) ind[io++] = i + o; }
    o += c;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.setIndex(new THREE.BufferAttribute(ind, 1));
  return out;
}
export { merge as mergeGeometries, vcolor };

function treeKit() {
  const conifer = merge([
    vcolor(new THREE.CylinderGeometry(0.05, 0.07, 0.3, 5).translate(0, 0.15, 0), '#4a3423'),
    vcolor(new THREE.ConeGeometry(0.26, 0.55, 7).translate(0, 0.42, 0), '#21401f'),
    vcolor(new THREE.ConeGeometry(0.2, 0.45, 7).translate(0, 0.72, 0), '#264a22'),
  ]);
  const leafy = merge([
    vcolor(new THREE.CylinderGeometry(0.05, 0.07, 0.4, 5).translate(0, 0.2, 0), '#5a4028'),
    vcolor(new THREE.IcosahedronGeometry(0.34, 1).scale(1, 0.9, 1).translate(0, 0.62, 0), '#3d6a2a'),
  ]);
  const walls = vcolor(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), '#ffffff');
  // A gable roof: a triangular prism sitting on a unit box.
  const roof = new THREE.BufferGeometry();
  const v = [
    -0.55, 1, -0.55, 0.55, 1, -0.55, 0, 1.45, -0.55,
    -0.55, 1, 0.55, 0, 1.45, 0.55, 0.55, 1, 0.55,
    -0.55, 1, -0.55, 0, 1.45, -0.55, 0, 1.45, 0.55, -0.55, 1, -0.55, 0, 1.45, 0.55, -0.55, 1, 0.55,
    0.55, 1, -0.55, 0.55, 1, 0.55, 0, 1.45, 0.55, 0.55, 1, -0.55, 0, 1.45, 0.55, 0, 1.45, -0.55,
  ];
  roof.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  roof.computeVertexNormals();
  vcolor(roof, '#ffffff');
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  // The prism's winding is not worth getting right by hand; draw both sides.
  const roofMat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  return { conifer, leafy, walls, roof, mat, roofMat };
}

const WALLS = ['#f2ead8', '#e8d9b5', '#f5f1e8', '#d9c9a8', '#e9e0cc', '#c9d3d8'].map((c) => new THREE.Color(c));
const ROOFS = ['#9c3b26', '#b0472a', '#6b4232', '#5a5f66', '#8a2f22', '#3f4a52'].map((c) => new THREE.Color(c));

// ------------------------------------------------------------------ Terrain

export class Terrain {
  constructor(world, scene, quality) {
    this.world = world;
    this.scene = scene;
    this.material = makeTerrainMaterial();
    this.kit = treeKit();
    this.tiles = new Map();
    this.quality = quality;
    this.radius = 32000;
    this.frameBudgetMs = 6;
    this._info = {};
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._s = new THREE.Vector3();
    this._p = new THREE.Vector3();
    this._c = new THREE.Color();
  }

  lodFor(dist) {
    if (dist < 6500) return 0;
    if (dist < 13500) return 1;
    if (dist < 22000) return 2;
    return 3;
  }

  /**
   * Bring the tile set up to date around `cam`. Builds at most `budget`
   * tiles, nearest first, so a frame never stalls on a whole ring of them.
   */
  update(cam, budget = 3) {
    const { radius } = this;
    const agl = Math.max(0, cam.y - 50);
    const i0 = Math.floor((cam.x - radius) / TILE), i1 = Math.floor((cam.x + radius) / TILE);
    const j0 = Math.floor((cam.z - radius) / TILE), j1 = Math.floor((cam.z + radius) / TILE);
    const want = [];
    const keep = new Set();
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const cx = (i + 0.5) * TILE, cz = (j + 0.5) * TILE;
        const dx = Math.max(0, Math.abs(cam.x - cx) - TILE / 2), dz = Math.max(0, Math.abs(cam.z - cz) - TILE / 2);
        const flat = Math.hypot(dx, dz);
        if (flat > radius) continue;
        const d = Math.hypot(flat, agl * 0.8);
        const lod = this.lodFor(d);
        const key = i + ',' + j;
        keep.add(key);
        const t = this.tiles.get(key);
        if (!t || t.lod !== lod) want.push({ i, j, lod, key, d, has: !!t });
      }
    }
    for (const [key, t] of this.tiles) {
      if (!keep.has(key)) { this.disposeTile(t); this.tiles.delete(key); }
    }
    // Missing tiles first (holes are worse than blur), then nearest.
    want.sort((a, b) => (a.has - b.has) || (a.d - b.d));
    const t0 = performance.now();
    for (let k = 0; k < Math.min(budget, want.length); k++) {
      if (k > 0 && performance.now() - t0 > this.frameBudgetMs) break;
      const w = want[k];
      const old = this.tiles.get(w.key);
      const t = this.buildTile(w.i, w.j, w.lod);
      if (old) this.disposeTile(old);
      this.tiles.set(w.key, t);
    }
    return want.length;
  }

  /** Build everything in reach right now (used after a teleport). */
  fill(cam) {
    let left;
    do { left = this.update(cam, 64); } while (left > 64);
    this.update(cam, 64);
  }

  disposeTile(t) {
    for (const o of t.objects) {
      this.scene.remove(o);
      if (o.isInstancedMesh) o.dispose();
      else o.geometry.dispose();
    }
  }

  buildTile(i, j, lod) {
    const seg = [72, 26, 10, 5][lod];
    const x0 = i * TILE, z0 = j * TILE;
    const step = TILE / seg, n = seg + 1, nb = n + 2;
    const W = this.world, info = this._info;

    const H = new Float32Array(nb * nb);
    const C = new Float32Array(n * n * 3);
    for (let b = 0; b < nb; b++) {
      for (let a = 0; a < nb; a++) {
        const x = x0 + (a - 1) * step, z = z0 + (b - 1) * step;
        if (a === 0 || b === 0 || a === nb - 1 || b === nb - 1) { H[b * nb + a] = W.height(x, z); continue; }
        W.info(x, z, info);
        H[b * nb + a] = info.h;
        const v = ((b - 1) * n + a - 1) * 3;
        C[v] = info.forest; C[v + 1] = info.airport; C[v + 2] = info.city;
      }
    }
    const skirt = 4 * n;
    const vcount = n * n + skirt;
    const pos = new Float32Array(vcount * 3), nor = new Float32Array(vcount * 3), cov = new Float32Array(vcount * 4);
    const hx = x0 + TILE / 2, hz = z0 + TILE / 2;
    for (let b = 0; b < n; b++) {
      for (let a = 0; a < n; a++) {
        const v = b * n + a, x = x0 + a * step, z = z0 + b * step;
        const h = H[(b + 1) * nb + a + 1];
        pos[v * 3] = x - hx; pos[v * 3 + 1] = h; pos[v * 3 + 2] = z - hz;
        const dhx = H[(b + 1) * nb + a + 2] - H[(b + 1) * nb + a];
        const dhz = H[(b + 2) * nb + a + 1] - H[b * nb + a + 1];
        const nx = -dhx, ny = 2 * step, nz = -dhz, l = Math.hypot(nx, ny, nz);
        nor[v * 3] = nx / l; nor[v * 3 + 1] = ny / l; nor[v * 3 + 2] = nz / l;
        cov[v * 4] = C[v * 3]; cov[v * 4 + 1] = C[v * 3 + 1]; cov[v * 4 + 2] = C[v * 3 + 2]; cov[v * 4 + 3] = 0;
      }
    }
    // Skirts: copies of the edge rows, dropped.
    const drop = step * 0.5 + 8;
    const edges = [
      (k) => k, (k) => (n - 1) * n + k, (k) => k * n, (k) => k * n + n - 1,
    ];
    let sv = n * n;
    const index = [];
    for (let b = 0; b < seg; b++) {
      for (let a = 0; a < seg; a++) {
        const p = b * n + a, q = p + 1, r = p + n, s = r + 1;
        index.push(p, r, q, q, r, s);
      }
    }
    edges.forEach((edge, e) => {
      const base = sv;
      for (let k = 0; k < n; k++) {
        const src = edge(k);
        pos[sv * 3] = pos[src * 3]; pos[sv * 3 + 1] = pos[src * 3 + 1] - drop; pos[sv * 3 + 2] = pos[src * 3 + 2];
        nor.copyWithin(sv * 3, src * 3, src * 3 + 3);
        cov.copyWithin(sv * 4, src * 4, src * 4 + 4);
        sv++;
      }
      for (let k = 0; k < seg; k++) {
        const a = edge(k), b = edge(k + 1), a2 = base + k, b2 = base + k + 1;
        if (e === 0 || e === 3) index.push(a, b, a2, b, b2, a2);
        else index.push(a, a2, b, b, a2, b2);
      }
    });

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geo.setAttribute('aCover', new THREE.BufferAttribute(cov, 4));
    geo.setIndex(index);
    geo.computeBoundingSphere();
    const mesh = new THREE.Mesh(geo, this.material);
    mesh.position.set(hx, 0, hz);
    mesh.receiveShadow = lod === 0;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    this.scene.add(mesh);
    const objects = [mesh];
    if (lod === 0) this.addTrees(i, j, objects);
    if (lod <= 1) this.addVillages(i, j, objects);
    return { lod, objects };
  }

  addTrees(i, j, objects) {
    const W = this.world, info = this._info, r = rng(hash2(i, j, 5) * 4e9);
    const tries = this.quality === 'low' ? 500 : 1100;
    const pts = [];
    for (let k = 0; k < tries; k++) {
      const x = (i + r()) * TILE, z = (j + r()) * TILE;
      W.info(x, z, info);
      if (info.forest < 0.5 || info.h < 2) continue;
      pts.push([x, info.h, z, r(), r()]);
    }
    // A few lone trees and tree lines in the fields too.
    for (let k = 0; k < tries / 6; k++) {
      const x = (i + r()) * TILE, z = (j + r()) * TILE;
      W.info(x, z, info);
      if (info.forest > 0.3 || info.airport > 0.01 || info.city > 0.3 || info.h < 2.2) continue;
      pts.push([x, info.h, z, r(), 0.9]);
    }
    if (!pts.length) return;
    const con = pts.filter((p) => p[4] < 0.55), lea = pts.filter((p) => p[4] >= 0.55);
    for (const [list, geo] of [[con, this.kit.conifer], [lea, this.kit.leafy]]) {
      if (!list.length) continue;
      const im = new THREE.InstancedMesh(geo, this.kit.mat, list.length);
      list.forEach(([x, h, z, a], k) => {
        const s = 13 + a * 13;
        this._q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, a * 6.28);
        this._s.set(s * (0.85 + a * 0.3), s, s * (0.85 + a * 0.3));
        this._p.set(x, h - 0.5, z);
        im.setMatrixAt(k, this._m.compose(this._p, this._q, this._s));
        this._c.setHSL(0.27 + a * 0.06, 0.45, 0.42 + a * 0.18);
        im.setColorAt(k, this._c);
      });
      im.computeBoundingSphere();
      this.scene.add(im);
      objects.push(im);
    }
  }

  addVillages(i, j, objects) {
    const W = this.world, info = this._info;
    const r = rng(hash2(i, j, 11) * 4e9);
    const houses = [];
    const nv = Math.floor(r() * 2.4);
    for (let v = 0; v < nv; v++) {
      const cx = (i + 0.15 + r() * 0.7) * TILE, cz = (j + 0.15 + r() * 0.7) * TILE;
      W.info(cx, cz, info);
      if (info.h < 2.5 || info.airport > 0 || info.city > 0.2) continue;
      const count = 8 + Math.floor(r() * 26);
      const ang = r() * Math.PI;
      for (let k = 0; k < count; k++) {
        // Strung along a road: most villages here are a street, not a blob.
        const t = (r() - 0.5) * 900, side = (r() < 0.5 ? -1 : 1) * (14 + r() * 30);
        const x = cx + Math.cos(ang) * t - Math.sin(ang) * side;
        const z = cz + Math.sin(ang) * t + Math.cos(ang) * side;
        W.info(x, z, info);
        if (info.h < 2 || info.airport > 0) continue;
        houses.push([x, info.h, z, ang + (r() < 0.8 ? 0 : Math.PI / 2), r(), r()]);
      }
    }
    // Farmsteads scattered on their own.
    for (let k = 0; k < 6; k++) {
      const x = (i + r()) * TILE, z = (j + r()) * TILE;
      W.info(x, z, info);
      if (info.h < 2.5 || info.airport > 0 || info.forest > 0.4 || info.city > 0.2) continue;
      const a = r() * 3;
      houses.push([x, info.h, z, a, r(), r()], [x + 22, info.h, z + 9, a + 1.57, r(), r()]);
    }
    if (!houses.length) return;
    const walls = new THREE.InstancedMesh(this.kit.walls, this.kit.mat, houses.length);
    const roofs = new THREE.InstancedMesh(this.kit.roof, this.kit.roofMat, houses.length);
    houses.forEach(([x, h, z, a, u, w], k) => {
      this._q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, a);
      this._s.set(9 + u * 8, 4.5 + w * 2.5, 7 + w * 4);
      this._p.set(x, h - 0.3, z);
      this._m.compose(this._p, this._q, this._s);
      walls.setMatrixAt(k, this._m); roofs.setMatrixAt(k, this._m);
      walls.setColorAt(k, WALLS[Math.floor(u * WALLS.length)]);
      roofs.setColorAt(k, ROOFS[Math.floor(w * ROOFS.length)]);
    });
    walls.computeBoundingSphere(); roofs.computeBoundingSphere();
    this.scene.add(walls, roofs);
    objects.push(walls, roofs);
  }
}

