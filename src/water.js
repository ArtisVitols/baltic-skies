// One huge sheet of water at sea level that follows the camera.
//
// Land sits on top of it wherever the terrain rises above zero, so the coast
// is simply where the two surfaces cross. The shader adds waves, the sky's
// reflection, the sun's glitter, and a turquoise shallows band read from the
// coast-distance texture World builds.

import * as THREE from 'three';
import { BOUNDS } from './geo.js';
import { SUN_DIR, COLORS } from './sky.js';

const vert = /* glsl */`
#include <common>
varying vec3 vW;
#include <fog_pars_vertex>
#include <logdepthbuf_pars_vertex>
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  vec4 mvPosition = viewMatrix * w;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
  #include <logdepthbuf_vertex>
}`;

const frag = /* glsl */`
uniform float uTime;
uniform vec3 uSun, uSunCol, uZenith, uHorizon;
uniform sampler2D uCoast;
uniform vec4 uBounds;
varying vec3 vW;
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>

uniform sampler2D uNormals;
vec2 slope(vec2 uv) { return texture2D(uNormals, uv).xy * 2.0 - 1.0; }
float swell(vec2 uv) { return texture2D(uNormals, uv).b; }
// Sample one layer through a rotation, and turn its slope back into world axes,
// so no two layers share a grid direction and the tiling never lines up.
vec2 layer(vec2 p, float ang, float size, vec2 drift) {
  float c = cos(ang), s = sin(ang);
  mat2 R = mat2(c, -s, s, c);
  return slope(R * p / size + uTime * drift) * R;
}

void main() {
  #include <logdepthbuf_fragment>
  vec3 toCam = cameraPosition - vW;
  float dist = length(toCam);
  vec3 v = toCam / dist;
  vec2 p = vW.xz;
  vec2 g = layer(p, 0.63, 173.0, vec2(0.006, 0.003)) * 0.8
         + layer(p, -1.27, 59.0, vec2(-0.010, 0.008)) * 0.6
         + layer(p, 2.41, 17.0, vec2(0.018, -0.021)) * 0.4;
  // Big slow patches of calmer and rougher water.
  float m = swell(p / 2700.0 + uTime * vec2(0.0007, 0.0004));
  float rough = 0.45 + 0.9 * m;
  // Detail fades with distance; far away the sea is a smooth reflection.
  float fade = (1.0 - smoothstep(250.0, 4500.0, dist)) * rough;
  vec3 n = normalize(vec3(-g.x * 0.32 * fade, 1.0, -g.y * 0.32 * fade));

  vec2 uv = (vW.xz - uBounds.xy) / uBounds.zw;
  float coast = (texture2D(uCoast, uv).r * 255.0 - 128.0) * 16.0;   // metres, + on land
  float shallow = smoothstep(0.0, 1.0, 1.0 - smoothstep(0.0, 900.0, -coast));

  // Fresnel, capped: at grazing angles real sea is a dimmed mirror of the
  // sky, not a white one - uncapped, every ripple facing the camera flashed.
  float fres = 0.02 + 0.6 * pow(1.0 - max(dot(n, v), 0.0), 5.0);
  vec3 r = reflect(-v, n);
  r.y = abs(r.y);
  vec3 sky = mix(uHorizon * 0.82, uZenith, pow(r.y, 0.45));
  vec3 deep = vec3(0.012, 0.075, 0.10);
  vec3 shal = vec3(0.06, 0.30, 0.30);
  vec3 body = mix(deep, shal, shallow * 0.8);
  vec3 col = mix(body, sky, fres);
  col *= 0.94 + 0.12 * m;
  float sd = max(dot(r, uSun), 0.0);
  col += uSunCol * (pow(sd, 600.0) * 6.0 + pow(sd, 60.0) * 0.35) * fade;
  // A soft line of foam right on the beach.
  // (coast is negative over water: -coast is metres out from the beach.
  // This test was once the wrong way round and striped the entire sea.)
  float surf = 0.5 + 0.5 * sin(uTime * 1.1 - coast * 0.35);          // lines that roll in
  float lace = swell(p / 90.0 + uTime * vec2(0.01, 0.0));            // broken up, not ruled
  float foam = (1.0 - smoothstep(4.0, 45.0, -coast)) * step(coast, 0.0) * smoothstep(0.35, 0.75, surf * lace + 0.25);
  col = mix(col, vec3(0.92, 0.95, 0.95), foam * 0.6 * fade);
  float alpha = mix(0.86, 0.98, fres) * mix(1.0, 0.75, shallow);
  gl_FragColor = vec4(col, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

/**
 * A tileable ripple map from value noise: several octaves on lattices that
 * divide the texture size, so it wraps exactly. Noise has no straight crests,
 * which is what the earlier sum-of-sines had - and from the air those crests
 * lined up into regular white bands. R/G hold the slope, B the height (used
 * at a huge scale for patches of rougher water). Mipmapped, so distant water
 * smooths out instead of shimmering.
 */
function rippleTexture() {
  const N = 256, h = new Float32Array(N * N);
  let seed = 9;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
  for (const [G, amp] of [[4, 1], [8, 0.55], [16, 0.3], [32, 0.16], [64, 0.08]]) {
    const lat = new Float32Array(G * G).map(() => rnd() * 2 - 1);
    const cell = N / G;
    for (let j = 0; j < N; j++) {
      const fy = j / cell, y0 = Math.floor(fy), ty = fade(fy - y0), y1 = (y0 + 1) % G;
      for (let i = 0; i < N; i++) {
        const fx = i / cell, x0 = Math.floor(fx), tx = fade(fx - x0), x1 = (x0 + 1) % G;
        const a = lat[y0 * G + x0] + (lat[y0 * G + x1] - lat[y0 * G + x0]) * tx;
        const b = lat[y1 * G + x0] + (lat[y1 * G + x1] - lat[y1 * G + x0]) * tx;
        h[j * N + i] += amp * (a + (b - a) * ty);
      }
    }
  }
  const sl = new Float32Array(N * N * 2), mags = [];
  let hmin = Infinity, hmax = -Infinity;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const k = j * N + i;
    sl[k * 2] = h[j * N + ((i + 1) % N)] - h[j * N + ((i + N - 1) % N)];
    sl[k * 2 + 1] = h[((j + 1) % N) * N + i] - h[((j + N - 1) % N) * N + i];
    mags.push(Math.abs(sl[k * 2]), Math.abs(sl[k * 2 + 1]));
    hmin = Math.min(hmin, h[k]); hmax = Math.max(hmax, h[k]);
  }
  // Scale by the 98th percentile, not the max, so typical ripples use the range.
  mags.sort((a, b) => a - b);
  const sc = mags[Math.floor(mags.length * 0.98)] || 1;
  const data = new Uint8Array(N * N * 4);
  for (let k = 0; k < N * N; k++) {
    data[k * 4] = Math.max(0, Math.min(255, Math.round(128 + 127 * sl[k * 2] / sc)));
    data[k * 4 + 1] = Math.max(0, Math.min(255, Math.round(128 + 127 * sl[k * 2 + 1] / sc)));
    data[k * 4 + 2] = Math.round(255 * (h[k] - hmin) / (hmax - hmin));
    data[k * 4 + 3] = 255;
  }
  const t = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}

/**
 * Rings around the camera, tiny triangles near it and huge ones far away.
 * The first version was a single 240 km quad - two triangles - and across a
 * triangle that size the interpolated world position loses precision in
 * bands, which drew regular white stripes all over the sea.
 */
function ringGrid() {
  const seg = 96, pos = [0, 0, 0], idx = [];
  const radii = [];
  for (let r = 4; r < 130000; r *= 1.1) radii.push(r);
  radii.push(130000);
  radii.forEach((r) => {
    for (let k = 0; k < seg; k++) {
      const a = (k / seg) * Math.PI * 2;
      pos.push(Math.cos(a) * r, 0, Math.sin(a) * r);
    }
  });
  for (let k = 0; k < seg; k++) idx.push(0, 1 + ((k + 1) % seg), 1 + k);
  for (let i = 0; i < radii.length - 1; i++) {
    const a0 = 1 + i * seg, b0 = a0 + seg;
    for (let k = 0; k < seg; k++) {
      const k1 = (k + 1) % seg;
      idx.push(a0 + k, a0 + k1, b0 + k, a0 + k1, b0 + k1, b0 + k);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  return g;
}

export class Water {
  constructor(scene, world) {
    const tex = new THREE.DataTexture(world.coastData, world.coastSize, world.coastSize, THREE.RedFormat, THREE.UnsignedByteType);
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearFilter;
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.needsUpdate = true;
    this.uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      uTime: { value: 0 },
      uSun: { value: SUN_DIR },
      uSunCol: { value: COLORS.sun },
      uZenith: { value: COLORS.zenith },
      uHorizon: { value: COLORS.horizon },
      uCoast: { value: null },
      uBounds: { value: new THREE.Vector4(BOUNDS.x0, BOUNDS.z0, BOUNDS.x1 - BOUNDS.x0, BOUNDS.z1 - BOUNDS.z0) },
    }]);
    // merge() clones values; hand the shared objects back in.
    this.uniforms.uCoast.value = tex;
    this.uniforms.uNormals = { value: rippleTexture() };
    this.uniforms.uSun.value = SUN_DIR;
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms, vertexShader: vert, fragmentShader: frag,
      transparent: true, fog: true,
    });
    const geo = ringGrid();
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    scene.add(this.mesh);
  }

  update(camera, time) {
    this.mesh.position.set(camera.position.x, 0, camera.position.z);
    this.uniforms.uTime.value = time;
  }
}
