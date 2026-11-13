// The sky dome, the sun, and the haze that ties the horizon together.
//
// One rule makes the far distance look right: the fog colour *is* the sky's
// horizon colour, so terrain fades into exactly the colour the sky has where
// they meet and there is never a visible edge to the world.

import * as THREE from 'three';

export const SUN_DIR = new THREE.Vector3();
{
  const elev = THREE.MathUtils.degToRad(36);
  const azim = THREE.MathUtils.degToRad(222);           // from north, clockwise
  SUN_DIR.set(Math.sin(azim) * Math.cos(elev), Math.sin(elev), -Math.cos(azim) * Math.cos(elev)).normalize();
}

export const COLORS = {
  zenith: new THREE.Color('#2f6fc4'),
  horizon: new THREE.Color('#c9def0'),
  sun: new THREE.Color('#fff1d6'),
  below: new THREE.Color('#9fb8c8'),
};

const vert = /* glsl */`
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;   // always on the far plane
}`;

const frag = /* glsl */`
uniform vec3 uSun, uZenith, uHorizon, uSunCol, uBelow;
uniform float uTime, uCirrus;
varying vec3 vDir;

float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y);
}
float fbm(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { s += a * vnoise(p); p = p * 2.07 + 13.1; a *= 0.5; }
  return s;
}

void main() {
  vec3 d = normalize(vDir);
  float y = d.y;
  float t = pow(smoothstep(-0.02, 0.75, y), 0.55);
  vec3 col = mix(uHorizon, uZenith, t);
  col = mix(col, uBelow, smoothstep(0.0, -0.25, y));

  float c = max(dot(d, uSun), 0.0);
  col += uSunCol * (pow(c, 6.0) * 0.18 + pow(c, 64.0) * 0.35);
  col += uSunCol * smoothstep(0.9993, 0.9997, c) * 6.0;

  // High, thin cirrus: streaks projected onto a plane far overhead.
  if (y > 0.02 && uCirrus > 0.0) {
    vec2 uv = d.xz / (y + 0.08) * 1.3 + vec2(uTime * 0.004, uTime * 0.0015);
    uv = mat2(0.94, 0.34, -0.34, 0.94) * uv;
    float n = fbm(uv * vec2(1.0, 3.5));
    float m = smoothstep(0.52, 0.78, n) * smoothstep(0.02, 0.25, y) * uCirrus;
    col = mix(col, vec3(1.0) + uSunCol * 0.1 * pow(c, 4.0), m * 0.5);
  }
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export class Sky {
  constructor(scene) {
    this.uniforms = {
      uSun: { value: SUN_DIR },
      uZenith: { value: COLORS.zenith },
      uHorizon: { value: COLORS.horizon },
      uSunCol: { value: COLORS.sun },
      uBelow: { value: COLORS.below },
      uTime: { value: 0 },
      uCirrus: { value: 1 },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms, vertexShader: vert, fragmentShader: frag,
      side: THREE.BackSide, depthWrite: false, fog: false,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1000, 48, 24), mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -10;
    scene.add(this.mesh);

    scene.fog = new THREE.FogExp2(COLORS.horizon.clone(), 0.000072);

    this.sun = new THREE.DirectionalLight(COLORS.sun, 2.8);
    this.sun.position.copy(SUN_DIR).multiplyScalar(300);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -45; sc.right = 45; sc.top = 45; sc.bottom = -45; sc.near = 10; sc.far = 700;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.04;
    scene.add(this.sun, this.sun.target);

    this.hemi = new THREE.HemisphereLight('#c4dcff', '#55663f', 1.15);
    scene.add(this.hemi);
  }

  /** Keep the dome and the shadow box on the camera / the plane. */
  update(camera, focus, time) {
    this.mesh.position.copy(camera.position);
    this.uniforms.uTime.value = time;
    this.sun.target.position.copy(focus);
    this.sun.position.copy(focus).addScaledVector(SUN_DIR, 350);
  }

  /** A blurred copy of the sky for reflections on the plane's paint. */
  makeEnvironment(renderer) {
    const pm = new THREE.PMREMGenerator(renderer);
    const s = new THREE.Scene();
    const dome = this.mesh.clone();
    dome.position.set(0, 0, 0);
    s.add(dome);
    // A green-grey ground half so the belly reflects land, not more sky.
    const ground = new THREE.Mesh(
      new THREE.SphereGeometry(500, 32, 16, 0, Math.PI * 2, Math.PI / 2 + 0.03, Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: '#5d7050', side: THREE.BackSide }),
    );
    s.add(ground);
    const rt = pm.fromScene(s, 0.02, 1, 2000);
    pm.dispose();
    return rt.texture;
  }
}
