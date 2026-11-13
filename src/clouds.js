// Fair-weather cumulus: puffy billboards grouped into clouds.
//
// The cloud field repeats every DOMAIN metres and is wrapped around the
// camera in the vertex shader, so the sky is endless without the CPU moving a
// single cloud. Puffs are lit from their place in the cloud - bright on top
// and on the sun side, blue-grey underneath - which is what makes a pile of
// soft circles read as a cumulus rather than as fog.
//
// Transparent things must be drawn back to front, so the instance order is
// re-sorted by distance a few times a second. That is a couple of thousand
// numbers, not a scene graph.

import * as THREE from 'three';
import { rng } from './noise.js';
import { SUN_DIR, COLORS } from './sky.js';

const DOMAIN = 56000;

const vert = /* glsl */`
#include <common>
attribute vec3 aPos;
attribute vec4 aData;   // size, shade(0 bottom..1 top), sun-side, rotation
uniform vec3 uCam;
uniform float uDomain;
varying vec2 vUv;
varying vec3 vLight;
varying float vAlpha;
uniform vec3 uTop, uBottom, uSunCol;
#include <fog_pars_vertex>
#include <logdepthbuf_pars_vertex>
void main() {
  vec3 p = aPos;
  p.xz += uDomain * floor((uCam.xz - p.xz) / uDomain + 0.5);
  vec4 mvPosition = viewMatrix * vec4(p, 1.0);
  float c = cos(aData.w), s = sin(aData.w);
  vec2 q = mat2(c, -s, s, c) * position.xy;
  mvPosition.xy += q * aData.x;
  gl_Position = projectionMatrix * mvPosition;
  vUv = uv;
  float d = length(p - uCam);
  vAlpha = smoothstep(40.0, 260.0, d) * (1.0 - smoothstep(uDomain * 0.40, uDomain * 0.48, d));
  vec3 base = mix(uBottom, uTop, aData.y);
  vLight = base + uSunCol * 0.22 * aData.z;
  #include <fog_vertex>
  #include <logdepthbuf_vertex>
}`;

const frag = /* glsl */`
uniform sampler2D uTex;
varying vec2 vUv;
varying vec3 vLight;
varying float vAlpha;
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>
void main() {
  #include <logdepthbuf_fragment>
  vec4 t = texture2D(uTex, vUv);
  float a = t.a * vAlpha;
  if (a < 0.01) discard;
  // The texture's red channel carries a soft inner shading.
  vec3 col = vLight * (0.82 + 0.18 * t.r);
  gl_FragColor = vec4(col, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

function puffTexture() {
  const S = 128, cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d');
  const r = rng(77);
  // Several overlapping soft blobs make a lumpy puff instead of a disc.
  for (let k = 0; k < 14; k++) {
    const a = r() * Math.PI * 2, d = r() * S * 0.18;
    const x = S / 2 + Math.cos(a) * d, y = S / 2 + Math.sin(a) * d;
    const rad = S * (0.18 + r() * 0.16);
    const gr = g.createRadialGradient(x, y - rad * 0.2, 0, x, y, rad);
    const lum = Math.round(200 + 55 * (1 - (y - S * 0.3) / (S * 0.4)));
    gr.addColorStop(0, `rgba(${lum},255,255,0.55)`);
    gr.addColorStop(0.55, `rgba(${lum},255,255,0.32)`);
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, S, S);
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.NoColorSpace;
  return tex;
}

export class Clouds {
  constructor(scene, quality = 'high') {
    const r = rng(2024);
    const puffs = [];
    const count = quality === 'low' ? 70 : 130;
    for (let c = 0; c < count; c++) {
      const cx = (r() - 0.5) * DOMAIN, cz = (r() - 0.5) * DOMAIN;
      const base = 1100 + r() * 500;
      const W = 500 + r() * 1300 * (r() < 0.25 ? 1.6 : 1);
      const H = W * (0.38 + r() * 0.25);
      const elong = 0.6 + r() * 0.8, ang = r() * Math.PI;
      const n = Math.round(10 + W / 90) * (quality === 'low' ? 0.6 : 1);
      for (let k = 0; k < n; k++) {
        const a = r() * Math.PI * 2, rr = Math.sqrt(r());
        let ox = Math.cos(a) * rr * W * 0.5, oz = Math.sin(a) * rr * W * 0.5 * elong;
        const rx = ox * Math.cos(ang) - oz * Math.sin(ang), rz = ox * Math.sin(ang) + oz * Math.cos(ang);
        ox = rx; oz = rz;
        // Domed: puffs near the middle stack higher.
        const top = H * (1 - rr * rr);
        const oy = Math.pow(r(), 0.7) * top;
        const size = W * (0.26 + r() * 0.16) * (1 - 0.35 * oy / H);
        const shade = Math.min(1, 0.35 + oy / H * 0.75 + 0.08 * r());
        const len = Math.hypot(ox, oy - H * 0.3, oz) || 1;
        const sun = (ox * SUN_DIR.x + (oy - H * 0.3) * SUN_DIR.y + oz * SUN_DIR.z) / len;
        puffs.push([cx + ox, base + oy + size * 0.25, cz + oz, size, shade, sun, r() * 6.28]);
      }
    }
    this.puffs = puffs;
    const N = puffs.length;
    const geo = new THREE.InstancedBufferGeometry();
    const quad = new THREE.PlaneGeometry(1, 1);
    geo.index = quad.index;
    geo.setAttribute('position', quad.attributes.position);
    geo.setAttribute('uv', quad.attributes.uv);
    this.aPos = new THREE.InstancedBufferAttribute(new Float32Array(N * 3), 3);
    this.aData = new THREE.InstancedBufferAttribute(new Float32Array(N * 4), 4);
    this.aPos.setUsage(THREE.DynamicDrawUsage);
    this.aData.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aPos', this.aPos);
    geo.setAttribute('aData', this.aData);
    geo.instanceCount = N;

    this.uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      uTex: { value: null },
      uCam: { value: new THREE.Vector3() },
      uDomain: { value: DOMAIN },
      uTop: { value: new THREE.Color('#ffffff') },
      uBottom: { value: new THREE.Color('#bcc7d6') },
      uSunCol: { value: COLORS.sun },
    }]);
    this.uniforms.uTex.value = puffTexture();
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms, vertexShader: vert, fragmentShader: frag,
      transparent: true, depthWrite: false, fog: true,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
    scene.add(this.mesh);

    this.order = puffs.map((_, i) => i);
    this.dist = new Float32Array(N);
    this.frame = 0;
    this.sort(new THREE.Vector3());
  }

  sort(cam) {
    const { puffs, dist, order } = this;
    for (let i = 0; i < puffs.length; i++) {
      const p = puffs[i];
      const x = p[0] + DOMAIN * Math.floor((cam.x - p[0]) / DOMAIN + 0.5);
      const z = p[2] + DOMAIN * Math.floor((cam.z - p[2]) / DOMAIN + 0.5);
      dist[i] = (x - cam.x) ** 2 + (p[1] - cam.y) ** 2 + (z - cam.z) ** 2;
    }
    order.sort((a, b) => dist[b] - dist[a]);
    const P = this.aPos.array, D = this.aData.array;
    order.forEach((i, k) => {
      const p = puffs[i];
      P[k * 3] = p[0]; P[k * 3 + 1] = p[1]; P[k * 3 + 2] = p[2];
      D[k * 4] = p[3]; D[k * 4 + 1] = p[4]; D[k * 4 + 2] = p[5]; D[k * 4 + 3] = p[6];
    });
    this.aPos.needsUpdate = true;
    this.aData.needsUpdate = true;
  }

  update(camera) {
    this.uniforms.uCam.value.copy(camera.position);
    if ((this.frame++ % 8) === 0) this.sort(camera.position);
  }
}
