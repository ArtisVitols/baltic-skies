// Cities, landmarks, wind farms and ferries.
//
// Cities are one instanced mesh of blocks and one of gabled houses each, laid
// out on a rotated street grid so they read as towns from the air rather than
// as scattered boxes. Landmarks are the tall things a pilot navigates by: the
// TV towers and the church spires of the old towns.

import * as THREE from 'three';
import { toWorld } from './geo.js';
import { rng, hash2 } from './noise.js';
import { vcolor } from './terrain.js';

function facadeTexture() {
  const cv = document.createElement('canvas');
  cv.width = 128; cv.height = 256;
  const g = cv.getContext('2d');
  g.fillStyle = '#e8e6e1'; g.fillRect(0, 0, 128, 256);
  for (let y = 10; y < 250; y += 22) {
    for (let x = 8; x < 124; x += 20) {
      g.fillStyle = Math.random() < 0.15 ? '#8fa4b8' : '#3b4b5c';
      g.fillRect(x, y, 12, 13);
    }
  }
  // Roof patch in the top-left corner, sampled by the box's top face.
  g.fillStyle = '#6c6f73'; g.fillRect(0, 0, 6, 6);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function blockGeometry() {
  const g = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
  const uv = g.attributes.uv;
  // Face order is +x,-x,+y,-y,+z,-z with four vertices each: send the top
  // and bottom to the plain roof patch.
  for (let i = 8; i < 16; i++) uv.setXY(i, 0.02, 0.98);
  return g;
}

function houseGeometries() {
  const walls = vcolor(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), '#ffffff');
  // Gable roof: a triangular prism, ridge along Z, drawn double-sided.
  const roof = new THREE.BufferGeometry();
  roof.setAttribute('position', new THREE.Float32BufferAttribute([
    -0.56, 1, -0.56, 0.56, 1, -0.56, 0, 1.42, -0.56,
    -0.56, 1, 0.56, 0, 1.42, 0.56, 0.56, 1, 0.56,
    -0.56, 1, -0.56, 0, 1.42, -0.56, 0, 1.42, 0.56, -0.56, 1, -0.56, 0, 1.42, 0.56, -0.56, 1, 0.56,
    0.56, 1, -0.56, 0.56, 1, 0.56, 0, 1.42, 0.56, 0.56, 1, -0.56, 0, 1.42, 0.56, 0, 1.42, -0.56,
  ], 3));
  roof.computeVertexNormals();
  vcolor(roof, '#ffffff');
  return { walls, roof };
}

export class Scenery {
  constructor(scene, world, quality) {
    this.scene = scene;
    this.world = world;
    this.turbines = [];
    this.cityParts = [];
    this.ships = [];
    const facade = facadeTexture();
    this.blockMat = new THREE.MeshLambertMaterial({ map: facade });
    this.houseMat = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.roofMat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
    this.blockGeo = blockGeometry();
    this.house = houseGeometries();
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    const col = new THREE.Color();
    const scale = quality === 'low' ? 0.55 : 1;

    for (const c of world.cities) {
      const r = rng(hash2(Math.round(c.x), Math.round(c.z), 3) * 4e9);
      const ang = r() * Math.PI;
      const ca = Math.cos(ang), sa = Math.sin(ang);
      const blocks = [], houses = [];
      const capital = c.n > 1000;
      const n = Math.round(c.n * scale);
      const used = new Set();
      for (let k = 0; k < n * 1.6 && blocks.length + houses.length < n; k++) {
        const rr = c.r * Math.pow(r(), 0.75), th = r() * Math.PI * 2;
        let lx = Math.cos(th) * rr, lz = Math.sin(th) * rr;
        // Snap to a street grid in the city's own orientation.
        const cell = 46;
        const gx = Math.round(lx / cell), gz = Math.round(lz / cell);
        const sub = Math.floor(r() * 4);
        const key = gx + ',' + gz + ',' + sub;
        if (used.has(key)) continue;
        used.add(key);
        lx = gx * cell + ((sub & 1) ? 10 : -10); lz = gz * cell + ((sub & 2) ? 10 : -10);
        const x = c.x + lx * ca - lz * sa, z = c.z + lx * sa + lz * ca;
        const h = world.height(x, z);
        if (h < 1.6) continue;
        const near = world.airportNear(x, z);
        if (near.dist < 1300) continue;
        const centre = 1 - rr / c.r;
        if (centre < 0.35 && r() < 0.65) {
          houses.push([x, h, z, ang + (r() < 0.5 ? 0 : Math.PI / 2), r(), r()]);
        } else {
          const tall = capital ? 12 + Math.pow(centre, 2.2) * 70 * (0.4 + r()) : 9 + centre * 22 * r();
          blocks.push([x, h, z, ang, 14 + r() * 8, tall, 14 + r() * 8, r()]);
        }
      }
      if (blocks.length) {
        const im = new THREE.InstancedMesh(this.blockGeo, this.blockMat, blocks.length);
        blocks.forEach(([x, h, z, a, w, ht, d, u], k) => {
          q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, a);
          im.setMatrixAt(k, m.compose(p.set(x, h - 1, z), q, s.set(w, ht + 1, d)));
          col.setHSL(0.08 + u * 0.08, 0.15 + u * 0.2, 0.62 + u * 0.25);
          im.setColorAt(k, col);
        });
        im.computeBoundingSphere();
        scene.add(im);
        this.cityParts.push({ obj: im, x: c.x, z: c.z });
      }
      if (houses.length) {
        const wl = new THREE.InstancedMesh(this.house.walls, this.houseMat, houses.length);
        const rf = new THREE.InstancedMesh(this.house.roof, this.roofMat, houses.length);
        const roofs = ['#9c3b26', '#b0472a', '#6b4232', '#5a5f66', '#8a2f22'];
        const walls = ['#f2ead8', '#e8d9b5', '#f5f1e8', '#d9c9a8', '#cbd5d9'];
        houses.forEach(([x, h, z, a, u, w], k) => {
          q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, a);
          m.compose(p.set(x, h - 0.3, z), q, s.set(9 + u * 6, 5 + w * 3, 8 + w * 3));
          wl.setMatrixAt(k, m); rf.setMatrixAt(k, m);
          wl.setColorAt(k, col.set(walls[Math.floor(u * walls.length)]));
          rf.setColorAt(k, col.set(roofs[Math.floor(w * roofs.length)]));
        });
        wl.computeBoundingSphere(); rf.computeBoundingSphere();
        scene.add(wl, rf);
        this.cityParts.push({ obj: wl, x: c.x, z: c.z, small: true }, { obj: rf, x: c.x, z: c.z, small: true });
      }
    }

    this.landmarks();
    this.windFarms();
    this.ferries();
  }

  landmarks() {
    const grey = new THREE.MeshStandardMaterial({ color: '#c9cdd2', roughness: 0.6 });
    const red = new THREE.MeshStandardMaterial({ color: '#c8352b', roughness: 0.6 });
    const white = new THREE.MeshStandardMaterial({ color: '#f1f1ee', roughness: 0.6 });
    const copper = new THREE.MeshStandardMaterial({ color: '#4f8f74', roughness: 0.5, metalness: 0.2 });
    const brick = new THREE.MeshStandardMaterial({ color: '#8a4b38', roughness: 0.9 });
    const place = (obj, lat, lon) => {
      const w = toWorld(lat, lon);
      obj.position.set(w.x, this.world.height(w.x, w.z) - 1, w.z);
      this.scene.add(obj);
    };
    const tvTower = (H, legs) => {
      const g = new THREE.Group();
      const cyl = (r0, r1, h, mat, y) => { const m = new THREE.Mesh(new THREE.CylinderGeometry(r0, r1, h, 12), mat); m.position.y = y + h / 2; g.add(m); return m; };
      if (legs) {
        for (let k = 0; k < 3; k++) {
          const a = (k / 3) * Math.PI * 2;
          const leg = new THREE.Mesh(new THREE.CylinderGeometry(2, 3.5, H * 0.33, 6), grey);
          leg.position.set(Math.cos(a) * 14, H * 0.16, Math.sin(a) * 14);
          leg.rotation.set(Math.sin(a) * 0.14, 0, -Math.cos(a) * 0.14);
          g.add(leg);
        }
      }
      cyl(4, 7, H * 0.62, grey, 0);
      cyl(12, 9, 9, white, H * 0.45);
      cyl(2.2, 4, H * 0.3, red, H * 0.62);
      cyl(0.8, 2.2, H * 0.08, white, H * 0.92);
      return g;
    };
    const spire = (H) => {
      const g = new THREE.Group();
      const body = new THREE.Mesh(new THREE.BoxGeometry(14, H * 0.4, 14), brick);
      body.position.y = H * 0.2; g.add(body);
      let y = H * 0.4;
      for (const [r, h] of [[7, H * 0.12], [4, H * 0.1], [2.5, H * 0.38]]) {
        const c = new THREE.Mesh(new THREE.ConeGeometry(r, h, 8), copper);
        c.position.y = y + h / 2; g.add(c); y += h * 0.7;
      }
      const church = new THREE.Mesh(new THREE.BoxGeometry(22, 22, 60), brick);
      church.position.set(0, 11, 34); g.add(church);
      const roof = new THREE.Mesh(new THREE.CylinderGeometry(13, 13, 60, 3).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#7d3123' }));
      roof.position.set(0, 26, 34); roof.rotation.z = Math.PI; g.add(roof);
      return g;
    };
    place(tvTower(368, true), 56.925, 24.137);   // Riga, Zaķusala
    place(tvTower(314, false), 59.471, 24.887);  // Tallinn
    place(tvTower(326, false), 54.687, 25.215);  // Vilnius
    place(spire(123), 56.9475, 24.109);          // St Peter's, Riga
    place(spire(124), 59.4415, 24.749);          // St Olaf's, Tallinn
    place(spire(80), 54.682, 25.29);             // Vilnius old town
  }

  windFarms() {
    const mat = new THREE.MeshStandardMaterial({ color: '#f4f5f6', roughness: 0.5 });
    const farms = [[56.62, 21.18, 8], [58.95, 23.75, 7], [57.55, 21.75, 6], [55.5, 21.25, 6]];
    for (const [lat, lon, n] of farms) {
      const c = toWorld(lat, lon);
      for (let k = 0; k < n; k++) {
        const x = c.x + (k % 4) * 420 + (k > 3 ? 210 : 0), z = c.z + Math.floor(k / 4) * 520;
        const h = this.world.height(x, z);
        if (h < 1.5) continue;
        const g = new THREE.Group();
        g.position.set(x, h - 1, z);
        const tower = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 2.6, 95, 10), mat);
        tower.position.y = 47.5; g.add(tower);
        const nac = new THREE.Mesh(new THREE.BoxGeometry(3.4, 3.6, 10), mat);
        nac.position.set(0, 96, 1); g.add(nac);
        const rotor = new THREE.Group();
        rotor.position.set(0, 96, -4.2);
        for (let b = 0; b < 3; b++) {
          const blade = new THREE.Mesh(new THREE.BoxGeometry(2.2, 52, 0.5).translate(0, 26, 0), mat);
          blade.rotation.z = (b / 3) * Math.PI * 2;
          rotor.add(blade);
        }
        rotor.rotation.z = k;
        g.add(rotor);
        // Face roughly into a south-westerly.
        g.rotation.y = 0.8;
        this.scene.add(g);
        this.turbines.push(rotor);
        this.cityParts.push({ obj: g, x, z, small: true });
      }
    }
  }

  ferries() {
    const hull = new THREE.MeshStandardMaterial({ color: '#1f3a66', roughness: 0.6 });
    const white = new THREE.MeshStandardMaterial({ color: '#f4f4f2', roughness: 0.5 });
    const routes = [
      [[59.48, 24.77], [60.14, 24.97]], [[60.1, 24.9], [59.5, 24.8]],
      [[57.1, 24.02], [57.7, 23.4]], [[57.42, 21.48], [57.6, 19.4]], [[56.53, 20.9], [56.4, 19.0]],
    ];
    routes.forEach(([a, b], k) => {
      const A = toWorld(...a), B = toWorld(...b);
      const g = new THREE.Group();
      const h = new THREE.Mesh(new THREE.BoxGeometry(26, 9, 170).translate(0, 2, 0), hull);
      const top = new THREE.Mesh(new THREE.BoxGeometry(24, 14, 120).translate(0, 13, 8), white);
      const bow = new THREE.Mesh(new THREE.CylinderGeometry(13, 13, 9, 3, 1).translate(0, 2, 0), hull);
      bow.position.z = -88; bow.rotation.y = Math.PI / 6;
      const funnel = new THREE.Mesh(new THREE.CylinderGeometry(3, 3.5, 8, 10), new THREE.MeshStandardMaterial({ color: '#c33' }));
      funnel.position.set(0, 24, 40);
      g.add(h, top, bow, funnel);
      this.scene.add(g);
      this.ships.push({ g, A, B, t: k * 0.37 % 1, len: Math.hypot(B.x - A.x, B.z - A.z) });
    });
  }

  update(dt, camPos) {
    for (const p of this.cityParts) {
      const d = Math.hypot(p.x - camPos.x, p.z - camPos.z);
      p.obj.visible = d < (p.small ? 14000 : 32000);
    }
    for (const r of this.turbines) r.rotation.z += dt * 1.6;
    for (const s of this.ships) {
      s.t += (dt * 14) / s.len;
      const ph = s.t % 2, fwd = ph < 1, u = fwd ? ph : 2 - ph;
      const x = s.A.x + (s.B.x - s.A.x) * u, z = s.A.z + (s.B.z - s.A.z) * u;
      s.g.position.set(x, 0, z);
      s.g.rotation.y = Math.atan2(-(s.B.x - s.A.x) * (fwd ? 1 : -1), -(s.B.z - s.A.z) * (fwd ? 1 : -1));
      s.g.visible = Math.hypot(x - camPos.x, z - camPos.z) < 30000;
    }
  }
}
