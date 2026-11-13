// One pooled particle system for contrails, tyre smoke and crash smoke.
// A puff's whole life is worked out in the shader from its birth time, so
// spawning writes a few numbers into a ring buffer and the per-frame cost is
// one uniform.

import * as THREE from 'three';

const vert = /* glsl */`
#include <common>
attribute float aBirth;
attribute vec2 aKind;       // kind, seed
uniform float uTime, uScale;
varying float vA;
varying vec3 vCol;
#include <fog_pars_vertex>
#include <logdepthbuf_pars_vertex>
void main() {
  float age = uTime - aBirth;
  float kind = aKind.x;
  float life, s0, s1, a0; vec3 drift; vec3 col;
  if (kind < 0.5) { life = 22.0; s0 = 4.0; s1 = 46.0; a0 = 0.55; drift = vec3(1.2, 0.2, 0.6); col = vec3(1.0); }           // contrail
  else if (kind < 1.5) { life = 2.6; s0 = 2.0; s1 = 16.0; a0 = 0.6; drift = vec3(0.5, 1.2, 0.3); col = vec3(0.92); }        // tyre smoke
  else if (kind < 2.5) { life = 12.0; s0 = 14.0; s1 = 110.0; a0 = 0.7; drift = vec3(3.0, 6.0, 1.5); col = vec3(0.18); }     // crash smoke
  else { life = 1.6; s0 = 8.0; s1 = 26.0; a0 = 0.9; drift = vec3(0.0, 5.0, 0.0); col = vec3(1.0, 0.55, 0.15); }             // fire
  float t = clamp(age / life, 0.0, 1.0);
  vec3 p = position + drift * age * (0.6 + aKind.y);
  vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  float size = mix(s0, s1, sqrt(t)) * (0.7 + 0.6 * aKind.y);
  gl_PointSize = (age < 0.0 || t >= 1.0) ? 0.0 : size * uScale / -mvPosition.z;
  vA = a0 * (1.0 - t) * smoothstep(0.0, 0.05, t + 0.02);
  vCol = col;
  #include <fog_vertex>
  #include <logdepthbuf_vertex>
}`;
const frag = /* glsl */`
varying float vA;
varying vec3 vCol;
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>
void main() {
  #include <logdepthbuf_fragment>
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c);
  float a = smoothstep(0.5, 0.0, d) * vA;
  if (a < 0.01) discard;
  gl_FragColor = vec4(vCol, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

export class Effects {
  constructor(scene, size = 3000) {
    this.size = size;
    this.next = 0;
    const g = new THREE.BufferGeometry();
    this.pos = new THREE.BufferAttribute(new Float32Array(size * 3), 3);
    this.birth = new THREE.BufferAttribute(new Float32Array(size).fill(-1e6), 1);
    this.kind = new THREE.BufferAttribute(new Float32Array(size * 2), 2);
    for (const a of [this.pos, this.birth, this.kind]) a.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.pos);
    g.setAttribute('aBirth', this.birth);
    g.setAttribute('aKind', this.kind);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7);
    this.uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: { value: 0 }, uScale: { value: 400 } }]);
    const m = new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: vert, fragmentShader: frag, transparent: true, depthWrite: false, fog: true });
    this.points = new THREE.Points(g, m);
    this.points.frustumCulled = false;
    this.points.renderOrder = 6;
    scene.add(this.points);
    this.time = 0;
    this.dirty = false;
  }

  spawn(kind, x, y, z) {
    const i = this.next;
    this.next = (this.next + 1) % this.size;
    this.pos.array[i * 3] = x; this.pos.array[i * 3 + 1] = y; this.pos.array[i * 3 + 2] = z;
    this.birth.array[i] = this.time;
    this.kind.array[i * 2] = kind; this.kind.array[i * 2 + 1] = Math.random();
    this.dirty = true;
  }

  clear() {
    this.birth.array.fill(-1e6);
    this.birth.needsUpdate = true;
  }

  update(dt, viewportHeight, fov) {
    this.time += dt;
    this.uniforms.uTime.value = this.time;
    this.uniforms.uScale.value = viewportHeight / (2 * Math.tan((fov * Math.PI) / 360));
    if (this.dirty) {
      this.pos.needsUpdate = true; this.birth.needsUpdate = true; this.kind.needsUpdate = true;
      this.dirty = false;
    }
  }
}
