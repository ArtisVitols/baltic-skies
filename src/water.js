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

void main() {
  #include <logdepthbuf_fragment>
  vec3 toCam = cameraPosition - vW;
  float dist = length(toCam);
  vec3 v = toCam / dist;
  // Three scales of the same tileable ripple map, drifting different ways.
  vec2 p = vW.xz;
  vec2 g = slope(p / 140.0 + uTime * vec2(0.010, 0.004)) * 0.9
         + slope(p / 47.0 + uTime * vec2(-0.013, 0.011)) * 0.6
         + slope(p / 13.0 + uTime * vec2(0.02, -0.025)) * 0.35;
  float fade = 1.0 - smoothstep(400.0, 6000.0, dist);
  vec3 n = normalize(vec3(-g.x * 0.55 * fade, 1.0, -g.y * 0.55 * fade));

  vec2 uv = (vW.xz - uBounds.xy) / uBounds.zw;
  float coast = (texture2D(uCoast, uv).r * 255.0 - 128.0) * 16.0;   // metres, + on land
  float shallow = 1.0 - smoothstep(-900.0, -60.0, -coast);          // 1 near the shore
  shallow = smoothstep(0.0, 1.0, 1.0 - smoothstep(0.0, 900.0, -coast));

  float fres = 0.02 + 0.98 * pow(1.0 - max(dot(n, v), 0.0), 5.0);
  vec3 r = reflect(-v, n);
  vec3 sky = mix(uHorizon, uZenith, pow(max(r.y, 0.0), 0.5));
  vec3 deep = vec3(0.012, 0.075, 0.10);
  vec3 shal = vec3(0.06, 0.30, 0.30);
  vec3 body = mix(deep, shal, shallow * 0.8);
  vec3 col = mix(body, sky, fres);
  float sd = max(dot(r, uSun), 0.0);
  col += uSunCol * (pow(sd, 600.0) * 6.0 + pow(sd, 60.0) * 0.35) * fade;
  // A soft line of foam right on the beach.
  float foam = smoothstep(-40.0, -5.0, -coast) * (0.5 + 0.5 * sin(uTime * 1.3 + vW.x * 0.05 + vW.z * 0.04));
  col = mix(col, vec3(0.9), foam * 0.35 * fade);
  float alpha = mix(0.82, 0.97, fres) * mix(1.0, 0.75, shallow);
  gl_FragColor = vec4(col, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

/**
 * A tileable slope map: a sum of sine waves with whole-number frequencies
 * (so it wraps exactly), stored as x/y slope. Mipmapped, so far water
 * smooths out instead of shimmering.
 */
function rippleTexture() {
  const N = 256, h = new Float32Array(N * N);
  let seed = 9;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let k = 0; k < 60; k++) {
    const fx = Math.round((rnd() - 0.5) * 2 * (2 + k * 0.5)), fy = Math.round((rnd() - 0.5) * 2 * (2 + k * 0.5));
    if (!fx && !fy) continue;
    const a = 1 / Math.hypot(fx, fy), ph = rnd() * Math.PI * 2;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      h[j * N + i] += a * Math.sin((2 * Math.PI * (fx * i + fy * j)) / N + ph);
    }
  }
  const data = new Uint8Array(N * N * 4);
  let mx = 0;
  const sl = new Float32Array(N * N * 2);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const dx = h[j * N + ((i + 1) % N)] - h[j * N + ((i + N - 1) % N)];
    const dy = h[((j + 1) % N) * N + i] - h[((j + N - 1) % N) * N + i];
    sl[(j * N + i) * 2] = dx; sl[(j * N + i) * 2 + 1] = dy;
    mx = Math.max(mx, Math.abs(dx), Math.abs(dy));
  }
  for (let i = 0; i < N * N; i++) {
    data[i * 4] = Math.round(128 + 127 * sl[i * 2] / mx);
    data[i * 4 + 1] = Math.round(128 + 127 * sl[i * 2 + 1] / mx);
    data[i * 4 + 2] = 255; data[i * 4 + 3] = 255;
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
    const geo = new THREE.PlaneGeometry(240000, 240000, 1, 1).rotateX(-Math.PI / 2);
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
