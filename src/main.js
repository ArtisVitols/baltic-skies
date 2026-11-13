// Baltic Skies: fly an airliner from Riga to anywhere around the Baltic.
//
// main.js owns the renderer, the screens, the controls and the camera. The
// world (geo/terrain/water/sky/clouds/airports/scenery), the aircraft model
// (plane.js) and the flight model (flight.js) know nothing about the page.

import * as THREE from 'three';
import { World, BOUNDS } from './geo.js';
import { Sky } from './sky.js';
import { Water } from './water.js';
import { Terrain } from './terrain.js';
import { Clouds } from './clouds.js';
import { Airports } from './airport.js';
import { Scenery } from './scenery.js';
import { Airliner, GEAR_HEIGHT } from './plane.js';
import { Flight, FLAP_NAMES } from './flight.js';
import { Effects } from './effects.js';
import { Sound } from './audio.js';
import { CrabBuilder } from './crab.js';

const $ = (id) => document.getElementById(id);
const D2R = Math.PI / 180;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const params = new URLSearchParams(location.search);
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

const SETTINGS_KEY = 'balticskies.settings', STAMPS_KEY = 'balticskies.stamps';
function loadJSON(key, def) {
  try { const v = JSON.parse(localStorage.getItem(key) || 'null'); return v ?? def; } catch { return def; }
}
function saveJSON(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* private mode */ } }

const CRASH_TEXT = {
  water: 'Splash! That was the sea. Land on a runway.',
  belly: 'The wheels were up! Press GEAR before you land.',
  gear: 'The wheels were still coming down. Lower them earlier.',
  hard: 'Too hard! Come down more gently - keep CLIMB above −4.',
  wing: 'A wing touched the ground. Keep the wings level when you land.',
  field: 'That is not an airport! Fly to a runway to land.',
  nose: 'Nose first! Lift the nose a little just before touching down.',
  overrun: 'Ran off the runway! Use BRAKE and pull the thrust back.',
};

class Game {
  constructor() {
    this.settings = { quality: 'high', sound: 'on', invert: 'off', help: 'on', from: 'RIX', to: 'TLL', ...loadJSON(SETTINGS_KEY, {}) };
    if (params.get('from')) this.settings.from = params.get('from');
    if (params.get('to')) this.settings.to = params.get('to');
    if (params.get('q')) this.settings.quality = params.get('q');
    this.stamps = new Set(loadJSON(STAMPS_KEY, []));
    this.state = 'loading';
    this.paused = false;
    this.input = { up: false, down: false, left: false, right: false, thrUp: false, thrDown: false, brake: false };
    this.camMode = 0;
    this.orbitYaw = 0; this.orbitPitch = 0; this.orbitIdle = 0;
    this.camPsi = 0; this.camTheta = 0; this.shake = 0;
    this.time = 0;
    this.sound = new Sound();
    this.sound.muted = this.settings.sound === 'off';
    this.tmp = new THREE.Vector3(); this.tmp2 = new THREE.Vector3();
    this.euler = new THREE.Euler(0, 0, 0, 'YXZ');
    window.game = this;
    this.boot().catch((e) => {
      console.error(e);
      $('loading-status').textContent = 'Something went wrong: ' + e.message;
    });
  }

  // ------------------------------------------------------------- loading

  async boot() {
    $('build-tag').textContent = 'build ' + (window.__BUILD__ || 'dev');
    const crab = new CrabBuilder($('crab'));
    crab.start();
    const step = async (p, text) => {
      crab.setProgress(p);
      $('loading-bar').style.width = Math.round(p * 100) + '%';
      $('loading-status').textContent = text;
      await wait(params.has('fast') ? 0 : 60);
    };
    const low = this.settings.quality === 'low';

    await step(0.04, 'Drawing the Baltic Sea…');
    const world = this.world = new World();
    world.build();

    await step(0.18, 'Painting the sky…');
    const renderer = this.renderer = new THREE.WebGLRenderer({
      canvas: $('scene'), antialias: !low, powerPreference: 'high-performance',
      logarithmicDepthBuffer: true, preserveDrawingBuffer: params.has('shot'),
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, low ? 1 : 1.75));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = !low;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    const scene = this.scene = new THREE.Scene();
    const camera = this.camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.5, 160000);
    this.sky = new Sky(scene);
    this.env = this.sky.makeEnvironment(renderer);
    scene.environment = this.env;

    await step(0.28, 'Filling the sea…');
    this.water = new Water(scene, world);

    await step(0.36, 'Building the airports…');
    this.airports = new Airports(scene, world, this.env);

    await step(0.5, 'Building Riga, Tallinn and friends…');
    this.scenery = new Scenery(scene, world, this.settings.quality);

    await step(0.62, 'Painting your plane…');
    this.plane = new Airliner({ big: !low });
    this.plane.setEnv(this.env);
    scene.add(this.plane.root);
    this.flight = new Flight(world, this.airports);

    await step(0.72, 'Fluffing up the clouds…');
    this.clouds = new Clouds(scene, this.settings.quality);
    this.effects = new Effects(scene, low ? 1500 : 3000);
    this.buildGuides();

    await step(0.8, 'Planting the forests…');
    this.terrain = new Terrain(world, scene, this.settings.quality);
    this.placeAtDeparture();
    this.terrain.fill(this.flight);

    await step(0.94, 'Warming up the engines…');
    this.resize();
    this.updateModel(0);
    this.menuCamera(0);
    renderer.compile(scene, camera);
    renderer.render(scene, camera);

    await step(1, 'Ready!');
    await wait(params.has('fast') ? 0 : 500);
    crab.stop();
    this.bindUI();
    addEventListener('resize', () => this.resize());
    $('loading').classList.add('hidden');
    this.showMenu();
    this.last = performance.now();
    requestAnimationFrame((t) => this.frame(t));
    if (params.has('fly')) this.startFlight();
    if (params.has('air')) this.startInAir();
  }

  resize() {
    const w = innerWidth, h = innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    const mm = $('minimap'), dpr = Math.min(2, devicePixelRatio || 1);
    mm.width = mm.clientWidth * dpr || 236; mm.height = mm.clientHeight * dpr || 236;
  }

  airport(code) { return this.world.airports.find((a) => a.code === code) || this.world.airports[0]; }

  /** Choose the runway end that points most nearly towards the destination. */
  departureEnd(a, dest) {
    if (!dest || dest === a) return 1;
    const brg = Math.atan2(dest.x - a.x, -(dest.z - a.z));
    let best = 0, bd = Infinity;
    a.ends.forEach((e, i) => { const d = Math.abs(wrap(e.hdg * D2R - brg)); if (d < bd) { bd = d; best = i; } });
    return best;
  }

  placeAtDeparture() {
    const from = this.airport(this.settings.from);
    let to = this.airport(this.settings.to);
    if (to === from) to = this.world.airports.find((a) => a !== from);
    this.from = from; this.dest = to;
    this.flight.reset(from, this.departureEnd(from, to));
    this.effects?.clear();
    this.plane.root.visible = true;
    this.camPsi = this.flight.psi; this.camTheta = 0;
    this.hintStage = 0;
    this.approachEnd = null;
  }

  // ------------------------------------------------------------- screens

  showScreen(id) {
    for (const s of ['menu', 'picker', 'options', 'pause', 'arrive', 'crash', 'bigmap']) $(s).classList.toggle('hidden', s !== id);
  }

  showMenu() {
    this.state = 'menu';
    this.paused = false;
    $('hud').classList.add('hidden');
    $('menu-from').textContent = this.from.name;
    $('menu-to').textContent = this.dest.name;
    const n = this.stamps.size;
    $('stamps').textContent = n ? `✈ Airports visited: ${n} of ${this.world.airports.length}` : 'Take off from Riga and land anywhere you like.';
    this.showScreen('menu');
    if (!this.smallCrab) { this.smallCrab = new CrabBuilder($('crab-small')); this.smallCrab.setProgress(1); }
    this.smallCrab.shown = 1;
    this.smallCrab.start();
  }

  openPicker(which) {
    this.pickerFor = which;
    $('picker-title').textContent = which === 'from' ? 'Take off from…' : which === 'next' ? 'Where to next?' : 'Fly to…';
    const list = $('picker-list');
    list.innerHTML = '';
    const cur = which === 'from' ? this.from : this.dest;
    const origin = which === 'next' ? this.landedAt : this.from;
    for (const a of this.world.airports) {
      if (which !== 'from' && a === origin) continue;
      const b = document.createElement('button');
      const km = origin ? Math.round(Math.hypot(a.x - origin.x, a.z - origin.z) / 1000) : 0;
      b.innerHTML = `<b>${a.name}</b><small>${a.code}${which !== 'from' ? ' · ' + km + ' km' : ''}</small>`;
      if (a === cur && which !== 'next') b.classList.add('sel');
      if (this.stamps.has(a.code)) b.classList.add('stamp');
      b.onclick = () => this.picked(a);
      list.appendChild(b);
    }
    this.showScreen('picker');
  }

  picked(a) {
    const which = this.pickerFor;
    if (which === 'from') {
      this.settings.from = a.code;
      if (this.settings.to === a.code) this.settings.to = this.world.airports.find((x) => x !== a).code;
    } else this.settings.to = a.code;
    saveJSON(SETTINGS_KEY, this.settings);
    if (which === 'next') {
      this.settings.from = this.landedAt.code;
      saveJSON(SETTINGS_KEY, this.settings);
      this.placeAtDeparture();
      this.terrain.fill(this.flight);
      this.startFlight(true);
      return;
    }
    this.placeAtDeparture();
    this.terrain.fill(this.flight);
    this.showMenu();
  }

  bindUI() {
    $('btn-fly').onclick = () => this.startFlight();
    $('btn-from').onclick = () => this.openPicker('from');
    $('btn-to').onclick = () => this.openPicker('to');
    $('picker-back').onclick = () => (this.pickerFor === 'next' ? this.showScreen('arrive') : this.showMenu());
    $('btn-options').onclick = () => { this.paintOptions(); this.showScreen('options'); };
    $('options-back').onclick = () => this.showMenu();
    document.querySelectorAll('.seg').forEach((seg) => {
      seg.querySelectorAll('button').forEach((b) => {
        b.onclick = () => {
          this.settings[seg.dataset.opt] = b.dataset.v;
          saveJSON(SETTINGS_KEY, this.settings);
          if (seg.dataset.opt === 'sound') this.sound.setMuted(b.dataset.v === 'off');
          this.paintOptions();
        };
      });
    });
    $('btn-pause').onclick = () => this.pause();
    $('btn-resume').onclick = () => this.resume();
    $('btn-restart').onclick = () => { this.placeAtDeparture(); this.terrain.fill(this.flight); this.startFlight(true); };
    $('btn-menu').onclick = () => { this.placeAtDeparture(); this.terrain.fill(this.flight); this.showMenu(); };
    $('btn-retry').onclick = () => { this.placeAtDeparture(); this.terrain.fill(this.flight); this.startFlight(true); };
    $('btn-crash-menu').onclick = () => { this.placeAtDeparture(); this.terrain.fill(this.flight); this.showMenu(); };
    $('btn-flyon').onclick = () => this.openPicker('next');
    $('btn-arrive-menu').onclick = () => {
      if (this.landedAt) { this.settings.from = this.landedAt.code; saveJSON(SETTINGS_KEY, this.settings); }
      this.placeAtDeparture(); this.terrain.fill(this.flight); this.showMenu();
    };
    $('btn-cam').onclick = () => { this.camMode = (this.camMode + 1) % 3; this.msg(['Chase view', 'Far view', 'Cockpit view'][this.camMode], 1.2); };
    $('minimap').onclick = () => this.openBigMap();
    $('bigmap-close').onclick = () => { this.showScreen(null); this.paused = false; };
    $('bigmap-canvas').addEventListener('pointerdown', (e) => this.bigMapTap(e));

    // Hold-to-act flight controls.
    document.querySelectorAll('#hud .ctl[data-k]').forEach((el) => {
      const k = el.dataset.k;
      const on = (e) => {
        e.preventDefault();
        el.setPointerCapture?.(e.pointerId);
        this.input[k] = true; el.classList.add('held');
        this.sound.start();
        if (k === 'thrUp') this.nudgeThrottle(0.1);
        if (k === 'thrDown') this.nudgeThrottle(-0.1);
        this.holdStart = performance.now();
      };
      const off = () => { this.input[k] = false; el.classList.remove('held'); };
      el.addEventListener('pointerdown', on);
      el.addEventListener('pointerup', off);
      el.addEventListener('pointercancel', off);
      el.addEventListener('lostpointercapture', off);
      el.addEventListener('contextmenu', (e) => e.preventDefault());
    });
    $('c-gear').addEventListener('pointerdown', (e) => { e.preventDefault(); this.gear(); });
    $('c-flaps').addEventListener('pointerdown', (e) => { e.preventDefault(); this.flaps(); });

    // Drag on the sky to look around the aircraft.
    const cv = $('scene');
    let drag = null;
    cv.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY, id: e.pointerId }; cv.setPointerCapture?.(e.pointerId); });
    cv.addEventListener('pointermove', (e) => {
      if (!drag || drag.id !== e.pointerId) return;
      this.orbitYaw -= (e.clientX - drag.x) * 0.006;
      this.orbitPitch = Math.max(-0.5, Math.min(1.2, this.orbitPitch + (e.clientY - drag.y) * 0.004));
      drag.x = e.clientX; drag.y = e.clientY;
      this.orbitIdle = 0;
    });
    const end = () => { drag = null; };
    cv.addEventListener('pointerup', end);
    cv.addEventListener('pointercancel', end);

    // Keyboard.
    const keys = {
      ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', KeyW: 'thrUp', KeyS: 'thrDown',
      PageUp: 'thrUp', PageDown: 'thrDown', Equal: 'thrUp', Minus: 'thrDown', KeyB: 'brake', Space: 'brake',
    };
    addEventListener('keydown', (e) => {
      if (this.state !== 'fly') return;
      const k = keys[e.code];
      if (k) { e.preventDefault(); if (!this.input[k] && (k === 'thrUp' || k === 'thrDown')) this.nudgeThrottle(k === 'thrUp' ? 0.1 : -0.1); this.input[k] = true; this.sound.start(); return; }
      if (e.code === 'KeyG') this.gear();
      else if (e.code === 'KeyF') this.flaps();
      else if (e.code === 'KeyC') $('btn-cam').onclick();
      else if (e.code === 'KeyM') this.openBigMap();
      else if (e.code === 'KeyP' || e.code === 'Escape') (this.paused ? this.resume() : this.pause());
    });
    addEventListener('keyup', (e) => { const k = keys[e.code]; if (k) this.input[k] = false; });

    this.watchOrientation();
    addEventListener('blur', () => { if (this.state === 'fly' && !this.paused) this.pause(); });
    document.addEventListener('visibilitychange', () => { if (document.hidden && this.state === 'fly' && !this.paused) this.pause(); });
  }

  paintOptions() {
    document.querySelectorAll('.seg').forEach((seg) => {
      seg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', this.settings[seg.dataset.opt] === b.dataset.v));
    });
  }

  startFlight(again = false) {
    this.sound.start();
    this.state = 'fly';
    this.paused = false;
    this.showScreen(null);
    this.smallCrab?.stop();
    $('hud').classList.remove('hidden');
    this.flightTime = 0;
    this.camPsi = this.flight.psi;
    this.orbitYaw = 0; this.orbitPitch = 0;
    this.camMode = this.camMode === 2 ? 2 : 0;
    this.hintStage = 0;
    this.msg(`${this.from.name} → ${this.dest.name}`, 2.5);
    this.goFullscreen();
    if (!again) this.resize();
  }

  /** Debug / test helper: start in the air south of the destination. */
  startInAir() {
    this.startFlight();
    const d = this.dest;
    this.flight.resetAir(d.x - 9000, d.z + 12000, d.elev + 1200, 330, 160);
    this.camPsi = this.flight.psi;
    this.terrain.fill(this.flight);
  }

  pause() {
    if (this.state !== 'fly') return;
    this.paused = true;
    this.showScreen('pause');
  }
  resume() {
    this.paused = false;
    this.showScreen(null);
    this.goFullscreen();
  }

  msg(text, secs = 2) {
    const el = $('msg');
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(this.msgT);
    this.msgT = setTimeout(() => el.classList.remove('show'), secs * 1000);
  }

  nudgeThrottle(d) {
    this.flight.throttle = Math.max(0, Math.min(1, Math.round((this.flight.throttle + d) * 10) / 10));
  }

  gear() {
    if (this.flight.onGround && !this.flight.gearCmd) return;
    if (this.flight.onGround) { this.msg('Not on the ground!', 1.2); return; }
    const down = this.flight.toggleGear();
    this.msg(down ? 'Gear down' : 'Gear up', 1.2);
    this.sound.bump(0.25, 160, 0.4);
  }

  flaps() {
    const f = this.flight;
    const next = f.flapIdx >= 4 ? 0 : f.flapIdx + 1;
    if (!f.setFlaps(next)) { this.msg('Too fast for more flaps', 1.4); return; }
    this.msg(`Flaps ${FLAP_NAMES[next]}`, 1.1);
  }

  // ------------------------------------------------------------- guides

  buildGuides() {
    const mat = new THREE.MeshBasicMaterial({ color: '#5dff95', transparent: true, opacity: 0.7, depthWrite: false, fog: false });
    this.rings = new THREE.Group();
    const geo = new THREE.TorusGeometry(30, 2.2, 6, 40);
    for (let k = 0; k < 11; k++) this.rings.add(new THREE.Mesh(geo, mat));
    this.rings.visible = false;
    this.scene.add(this.rings);
    // A tall light over the destination, to find it from far away.
    const cv = document.createElement('canvas'); cv.width = 4; cv.height = 128;
    const g = cv.getContext('2d'), gr = g.createLinearGradient(0, 0, 0, 128);
    gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.7, 'rgba(255,255,255,0.7)'); gr.addColorStop(1, 'rgba(255,255,255,1)');
    g.fillStyle = gr; g.fillRect(0, 0, 4, 128);
    const tex = new THREE.CanvasTexture(cv);
    this.beacon = new THREE.Mesh(new THREE.CylinderGeometry(60, 60, 2400, 16, 1, true),
      new THREE.MeshBasicMaterial({ map: tex, color: '#ffcc4d', transparent: true, opacity: 0.5, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, fog: false }));
    this.scene.add(this.beacon);
  }

  updateGuides() {
    const d = this.dest, f = this.flight;
    const dist = Math.hypot(f.x - d.x, f.z - d.z);
    this.beacon.position.set(d.x, d.elev + 1200, d.z);
    this.beacon.visible = this.state === 'fly' && dist > 2500;
    const help = this.settings.help === 'on' && this.state === 'fly' && !f.onGround;
    if (!help || dist > 26000) { this.rings.visible = false; if (dist > 16000) this.approachEnd = null; return; }
    if (!this.approachEnd || dist > 16000) {
      // Approach from whichever end the aircraft is nearer to lining up with.
      let best = null, bs = -Infinity;
      for (const e of d.ends) {
        const vx = f.x - e.x, vz = f.z - e.z, l = Math.hypot(vx, vz) || 1;
        const s = -(vx * e.dx + vz * e.dz) / l;
        if (s > bs) { bs = s; best = e; }
      }
      this.approachEnd = best;
    }
    const e = this.approachEnd;
    const tdx = e.x + e.dx * 300, tdz = e.z + e.dz * 300;
    this.rings.visible = true;
    this.rings.children.forEach((r, k) => {
      const dd = 700 + k * 800;
      r.position.set(tdx - e.dx * dd, d.elev + GEAR_HEIGHT + Math.tan(3 * D2R) * dd + 4, tdz - e.dz * dd);
      r.rotation.set(0, -e.hdg * D2R, 0);
    });
  }

  // ------------------------------------------------------------- map

  drawMinimap() {
    const cv = $('minimap'), g = cv.getContext('2d'), S = cv.width;
    if (!S) return;
    const f = this.flight, map = this.world.mapCanvas();
    const mpp = (BOUNDS.x1 - BOUNDS.x0) / map.width;
    const range = 30000, sc = S / range;
    g.save();
    g.clearRect(0, 0, S, S);
    g.beginPath(); g.arc(S / 2, S / 2, S / 2, 0, Math.PI * 2); g.clip();
    g.fillStyle = '#2d5f7d'; g.fillRect(0, 0, S, S);
    g.translate(S / 2, S / 2);
    g.rotate(-f.psi);
    g.scale(sc * mpp, sc * mpp);
    g.imageSmoothingEnabled = true;
    g.drawImage(map, -(f.x - BOUNDS.x0) / mpp, -(f.z - BOUNDS.z0) / mpp);
    g.restore();
    const c = Math.cos(f.psi), s = Math.sin(f.psi);
    const toS = (x, z) => { const dx = x - f.x, dz = z - f.z; return [S / 2 + (dx * c + dz * s) * sc, S / 2 + (-dx * s + dz * c) * sc]; };
    g.save();
    g.beginPath(); g.arc(S / 2, S / 2, S / 2 - 1, 0, Math.PI * 2); g.clip();
    g.font = `bold ${Math.round(S * 0.085)}px sans-serif`; g.textAlign = 'center';
    for (const a of this.world.airports) {
      const [x0, y0] = toS(a.ends[0].x, a.ends[0].z), [x1, y1] = toS(a.ends[1].x, a.ends[1].z);
      g.strokeStyle = a === this.dest ? '#ffcc4d' : '#ffffff'; g.lineWidth = Math.max(2, S * 0.022);
      g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
      const [x, y] = toS(a.x, a.z);
      g.fillStyle = a === this.dest ? '#ffcc4d' : 'rgba(255,255,255,0.9)';
      g.fillText(a.code, x, y - S * 0.05);
    }
    // Line to the destination.
    const [dx, dy] = toS(this.dest.x, this.dest.z);
    g.strokeStyle = 'rgba(255,204,77,0.8)'; g.setLineDash([S * 0.03, S * 0.03]); g.lineWidth = S * 0.012;
    g.beginPath(); g.moveTo(S / 2, S / 2); g.lineTo(dx, dy); g.stroke(); g.setLineDash([]);
    g.restore();
    // The aircraft, always pointing up.
    g.save(); g.translate(S / 2, S / 2);
    g.fillStyle = '#ffffff'; g.strokeStyle = '#0b1a2e'; g.lineWidth = S * 0.012;
    const u = S * 0.05;
    g.beginPath();
    g.moveTo(0, -u * 1.4); g.lineTo(u * 0.25, -u * 0.3); g.lineTo(u * 1.3, u * 0.3); g.lineTo(u * 0.25, u * 0.15);
    g.lineTo(u * 0.2, u * 0.9); g.lineTo(u * 0.55, u * 1.2); g.lineTo(-u * 0.55, u * 1.2); g.lineTo(-u * 0.2, u * 0.9);
    g.lineTo(-u * 0.25, u * 0.15); g.lineTo(-u * 1.3, u * 0.3); g.lineTo(-u * 0.25, -u * 0.3); g.closePath();
    g.stroke(); g.fill();
    g.restore();
    g.fillStyle = '#fff'; g.font = `bold ${Math.round(S * 0.08)}px sans-serif`; g.textAlign = 'center';
    // North marker on the rim.
    const nx = S / 2 + Math.sin(-f.psi) * S * 0.43, ny = S / 2 - Math.cos(-f.psi) * S * 0.43;
    g.fillStyle = '#ff5a4f'; g.fillText('N', nx, ny + S * 0.03);
  }

  openBigMap() {
    if (this.state !== 'fly') return;
    this.paused = true;
    this.showScreen('bigmap');
    const cv = $('bigmap-canvas');
    const px = Math.min(1024, Math.round(cv.clientHeight * Math.min(2, devicePixelRatio || 1))) || 600;
    cv.width = cv.height = px;
    this.drawBigMap();
  }

  drawBigMap() {
    const cv = $('bigmap-canvas'), g = cv.getContext('2d'), S = cv.width;
    const map = this.world.mapCanvas();
    g.imageSmoothingEnabled = true;
    g.drawImage(map, 0, 0, S, S);
    const sc = S / (BOUNDS.x1 - BOUNDS.x0);
    const P = (x, z) => [(x - BOUNDS.x0) * sc, (z - BOUNDS.z0) * sc];
    const f = this.flight;
    const [fx, fy] = P(f.x, f.z), [tx, ty] = P(this.dest.x, this.dest.z);
    g.strokeStyle = 'rgba(255,204,77,0.9)'; g.lineWidth = S / 250; g.setLineDash([S / 80, S / 120]);
    g.beginPath(); g.moveTo(fx, fy); g.lineTo(tx, ty); g.stroke(); g.setLineDash([]);
    g.textAlign = 'center';
    for (const a of this.world.airports) {
      const [x, y] = P(a.x, a.z);
      const isDest = a === this.dest;
      g.fillStyle = isDest ? '#ffcc4d' : this.stamps.has(a.code) ? '#46d27a' : '#ffffff';
      g.strokeStyle = '#0b1a2e'; g.lineWidth = S / 300;
      g.beginPath(); g.arc(x, y, S / 70, 0, Math.PI * 2); g.fill(); g.stroke();
      g.font = `bold ${Math.round(S / 34)}px sans-serif`;
      g.lineWidth = S / 160; g.strokeStyle = 'rgba(11,26,46,0.85)';
      g.strokeText(a.name, x, y - S / 45); g.fillText(a.name, x, y - S / 45);
    }
    g.save(); g.translate(fx, fy); g.rotate(f.psi);
    g.fillStyle = '#fff'; g.strokeStyle = '#0b1a2e'; g.lineWidth = S / 300;
    const u = S / 60;
    g.beginPath(); g.moveTo(0, -u * 1.4); g.lineTo(u * 1.2, u * 0.6); g.lineTo(0, u * 0.2); g.lineTo(-u * 1.2, u * 0.6); g.closePath();
    g.fill(); g.stroke(); g.restore();
  }

  bigMapTap(e) {
    const cv = $('bigmap-canvas'), r = cv.getBoundingClientRect();
    const sx = (e.clientX - r.left) / r.width, sy = (e.clientY - r.top) / r.height;
    const x = BOUNDS.x0 + sx * (BOUNDS.x1 - BOUNDS.x0), z = BOUNDS.z0 + sy * (BOUNDS.z1 - BOUNDS.z0);
    let best = null, bd = Infinity;
    for (const a of this.world.airports) { const d = Math.hypot(a.x - x, a.z - z); if (d < bd) { bd = d; best = a; } }
    if (best && bd < 6000) {
      this.dest = best; this.settings.to = best.code; saveJSON(SETTINGS_KEY, this.settings);
      this.approachEnd = null;
      this.drawBigMap();
      this.msg(`Flying to ${best.name}`, 1.6);
    }
  }

  // ------------------------------------------------------------- frame

  frame(now) {
    requestAnimationFrame((t) => this.frame(t));
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.time += dt;
    const f = this.flight;

    if (this.state === 'fly' && !this.paused) {
      this.flightTime += dt;
      const inv = this.settings.invert === 'on' ? -1 : 1;
      const ip = { pitch: ((this.input.up ? 1 : 0) - (this.input.down ? 1 : 0)) * inv, roll: (this.input.right ? 1 : 0) - (this.input.left ? 1 : 0), brake: this.input.brake };
      const held = (performance.now() - (this.holdStart || 0)) > 250;
      if (this.input.thrUp && held) f.throttle = Math.min(1, f.throttle + dt * 0.6);
      if (this.input.thrDown && held) f.throttle = Math.max(0, f.throttle - dt * 0.6);
      const prevRolled = f.rolled;
      const n = Math.ceil(dt / 0.01);
      for (let i = 0; i < n; i++) f.step(dt / n, ip);
      this.plane.rollWheels(f.rolled - prevRolled);
      this.handleEvents();
      this.spawnEffects(dt);
    }
    if (this.state === 'crashed') this.flightTime += dt;

    this.updateModel(dt);
    if (this.state === 'menu' || this.state === 'loading') this.menuCamera(dt);
    else this.updateCamera(dt);

    const cam = this.camera;
    this.terrain.update(cam.position, 4);
    this.sky.update(cam, this.plane.root.position, this.time);
    this.water.update(cam, this.time);
    this.clouds.update(cam);
    this.airports.update(this.plane.root.position);
    this.scenery.update(dt, cam.position);
    this.effects.update(dt, this.renderer.domElement.height, cam.fov);
    this.updateGuides();
    this.sound.update(f, cam.position.distanceTo(this.plane.root.position));
    this.renderer.render(this.scene, cam);
    if (this.state === 'fly' || this.state === 'crashed') this.updateHud(dt);
  }

  updateModel(dt) {
    const f = this.flight, p = this.plane;
    p.root.position.set(f.x, f.y, f.z);
    this.euler.set(f.theta, -f.psi, -f.phi, 'YXZ');
    p.root.quaternion.setFromEuler(this.euler);
    p.setGear(f.gearPos);
    p.setFlaps(f.flapPos);
    p.setSpoilers(f.spoilers);
    p.setControls(f.rollIn, f.pitchIn, f.onGround ? f.rollIn * 0.5 : 0);
    p.steerNose(f.onGround ? -f.rollIn * 0.5 * Math.max(0, 1 - f.V / 40) : 0);
    p.spinFans(f.n1 * 55, dt);
    p.updateLights(this.time);
  }

  spawnEffects(dt) {
    const f = this.flight, p = this.plane.root;
    if (!f.onGround && f.y > 2300 && f.n1 > 0.4) {
      this.trailT = (this.trailT || 0) + dt;
      while (this.trailT > 0.045) {
        this.trailT -= 0.045;
        for (const s of [1, -1]) {
          this.tmp.set(s * 5.75, -2.2, 6).applyMatrix4(p.matrixWorld);
          this.effects.spawn(0, this.tmp.x, this.tmp.y, this.tmp.z);
        }
      }
    }
  }

  handleEvents() {
    const f = this.flight;
    for (const e of f.events) {
      switch (e.type) {
        case 'liftoff': this.msg('Lift-off!', 1.6); break;
        case 'gearUp': this.msg('Wheels up!', 1.6); this.sound.bump(0.3, 140, 0.5); this.sound.say('Positive climb. Gear up.'); break;
        case 'gearDown': this.msg('Gear down - getting ready to land', 2.2); this.sound.bump(0.3, 140, 0.5); this.sound.say('Gear down.'); break;
        case 'flapsAuto': this.msg(`Flaps ${FLAP_NAMES[e.idx]} - too fast for more`, 1.6); break;
        case 'touchdown': {
          const p = this.plane.root;
          for (let k = 0; k < 26; k++) {
            this.tmp.set((k % 2 ? 1 : -1) * 3.05, -3.8, 1.35).applyMatrix4(p.matrixWorld);
            this.effects.spawn(1, this.tmp.x + Math.random() * 2, this.tmp.y, this.tmp.z + Math.random() * 2);
          }
          this.sound.bump(0.6, 300, 0.35);
          const v = -e.vs;
          this.landingStars = !e.runway ? 1 : v < 1.2 ? 3 : v < 2.4 ? 2 : 1;
          this.landingWord = !e.runway ? 'A grass landing!' : v < 1.2 ? 'Butter landing!' : v < 2.4 ? 'Nice landing!' : 'Firm landing!';
          this.msg(this.landingWord, 2.2);
          break;
        }
        case 'stopped':
          if (e.airport) this.arrived(e.airport);
          break;
        case 'crash': this.crashed(e.why); break;
      }
    }
    f.events.length = 0;
  }

  arrived(a) {
    this.landedAt = a;
    this.stamps.add(a.code);
    saveJSON(STAMPS_KEY, [...this.stamps]);
    this.sound.chime();
    this.sound.say(`Welcome to ${a.name}!`);
    setTimeout(() => {
      if (this.state !== 'fly') return;
      this.paused = true;
      $('arrive-title').textContent = `Welcome to ${a.name}!`;
      const n = this.landingStars || 1;
      $('arrive-stars').innerHTML = '★'.repeat(n) + `<span class="off">${'★'.repeat(3 - n)}</span>`;
      const mins = Math.floor(this.flightTime / 60), secs = Math.round(this.flightTime % 60);
      $('arrive-text').textContent = `${this.landingWord || 'Landed!'} Flight time ${mins}:${String(secs).padStart(2, '0')}. Airports visited: ${this.stamps.size}/${this.world.airports.length}`;
      this.showScreen('arrive');
    }, 1200);
  }

  crashed(why) {
    this.state = 'crashed';
    this.shake = 1.2;
    const f = this.flight;
    for (let k = 0; k < 60; k++) this.effects.spawn(k < 20 ? 3 : 2, f.x + (Math.random() - 0.5) * 30, Math.max(0, f.y - 2), f.z + (Math.random() - 0.5) * 30);
    this.sound.bump(1, 500, 1.4);
    if (why === 'water') this.plane.root.visible = false;
    $('crash-text').textContent = CRASH_TEXT[why] || 'Crashed!';
    setTimeout(() => { if (this.state === 'crashed') this.showScreen('crash'); }, 2200);
  }

  // ------------------------------------------------------------- camera

  menuCamera(dt) {
    const f = this.flight, cam = this.camera;
    this.menuAng = (this.menuAng ?? 2.4) + dt * 0.07;
    const r = 52, a = this.menuAng + f.psi;
    cam.position.set(f.x + Math.sin(a) * r, f.y + 4 + Math.sin(this.time * 0.15) * 2, f.z - Math.cos(a) * r);
    cam.up.set(0, 1, 0);
    cam.fov = 50; cam.updateProjectionMatrix();
    cam.lookAt(f.x, f.y - 0.5, f.z);
    // Shift the aircraft to the right of the screen, away from the menu card.
    cam.rotateY(0.22);
  }

  updateCamera(dt) {
    const f = this.flight, cam = this.camera;
    const k = 1 - Math.exp(-dt * 2.6);
    this.camPsi += wrap(f.psi - this.camPsi) * k;
    this.camTheta += (f.theta - this.camTheta) * (1 - Math.exp(-dt * 2));
    this.orbitIdle += dt;
    if (this.orbitIdle > 2.5) {
      const d = 1 - Math.exp(-dt * 1.3);
      this.orbitYaw = wrap(this.orbitYaw) * (1 - d); this.orbitPitch *= 1 - d;
    }
    if (this.camMode === 2) {
      this.tmp.set(0, 1.0, -15.2).applyMatrix4(this.plane.root.matrixWorld);
      cam.position.copy(this.tmp);
      cam.quaternion.copy(this.plane.root.quaternion);
      cam.rotateY(this.orbitYaw); cam.rotateX(this.orbitPitch * 0.6 - 0.05);
      if (cam.fov !== 68) { cam.fov = 68; cam.updateProjectionMatrix(); }
      return;
    }
    const D = this.camMode === 1 ? 120 : 44, H = this.camMode === 1 ? 26 : 8.5;
    if (cam.fov !== 60) { cam.fov = 60; cam.updateProjectionMatrix(); }
    const yaw = this.camPsi + this.orbitYaw;
    const elev = Math.atan2(H, D) + this.orbitPitch - this.camTheta * 0.4;
    const R = Math.hypot(D, H);
    cam.position.set(
      f.x - Math.sin(yaw) * Math.cos(elev) * R,
      f.y + Math.sin(elev) * R,
      f.z + Math.cos(yaw) * Math.cos(elev) * R,
    );
    const gh = Math.max(0, this.world.height(cam.position.x, cam.position.z));
    cam.position.y = Math.max(cam.position.y, gh + 2.5);
    this.tmp.set(f.x + Math.sin(f.psi) * 8, f.y + 2.2, f.z - Math.cos(f.psi) * 8);
    cam.up.set(0, 1, 0);
    cam.lookAt(this.tmp);
    cam.rotateZ(-f.phi * 0.3);
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt);
      const s = this.shake * 0.6;
      cam.position.x += (Math.random() - 0.5) * s; cam.position.y += (Math.random() - 0.5) * s;
    }
  }

  // ------------------------------------------------------------- HUD

  updateHud(dt) {
    this.hudT = (this.hudT || 0) + dt;
    this.mapT = (this.mapT || 0) + dt;
    if (this.mapT > 0.07) { this.mapT = 0; this.drawMinimap(); }
    if (this.hudT < 0.1) return;
    this.hudT = 0;
    const f = this.flight;
    $('ro-spd').textContent = Math.round(f.speedKmh);
    $('ro-alt').textContent = Math.max(0, Math.round(f.agl));
    const vs = f.vs;
    const vsEl = $('ro-vs');
    vsEl.textContent = (vs > 0.05 ? '+' : '') + vs.toFixed(1);
    vsEl.className = vs > 0.5 ? 'up' : vs < -0.5 ? 'down' : '';
    const d = this.dest;
    const dist = Math.hypot(d.x - f.x, d.z - f.z);
    $('dest-name').textContent = d.name.toUpperCase();
    $('dest-dist').textContent = dist > 1000 ? (dist / 1000).toFixed(dist > 10000 ? 0 : 1) + ' km' : Math.round(dist) + ' m';
    const brg = Math.atan2(d.x - f.x, -(d.z - f.z));
    $('dest-arrow').style.transform = `rotate(${(wrap(brg - f.psi) / D2R - 90).toFixed(1)}deg)`;
    const g = $('st-gear');
    g.textContent = f.gearPos > 0.98 ? 'GEAR ▼' : f.gearPos < 0.02 ? 'GEAR ▲' : 'GEAR …';
    g.className = 'pill ' + (f.gearPos > 0.98 ? 'green' : f.gearPos < 0.02 ? '' : 'amber');
    $('c-gear').classList.toggle('on', f.gearCmd);
    const fl = $('st-flaps');
    fl.textContent = 'FLAPS ' + FLAP_NAMES[f.flapIdx];
    fl.className = 'pill ' + (f.flapIdx ? 'amber' : '');
    $('st-brake').classList.toggle('hidden', !(f.onGround && (this.input.brake || (f.flown && f.throttle < 0.15 && f.V > 1))));
    $('thr-fill').style.height = Math.round(f.throttle * 100) + '%';
    $('thr-n1').style.bottom = Math.round(((f.n1 - 0.22) / 0.78) * 100) + '%';
    $('thr-txt').textContent = f.throttle >= 0.999 ? 'MAX' : Math.round(f.throttle * 100) + '%';
    this.updateHint(dist);
  }

  updateHint(dist) {
    const f = this.flight;
    let h = '';
    if (this.state !== 'fly') h = '';
    else if (f.onGround && !f.flown) {
      if (f.throttle < 0.9) h = 'Hold <b>+</b> to push the thrust to MAX';
      else if (f.V < 60) h = 'Rolling… speeding up';
      else h = 'Now hold <b>▲ UP</b> to lift off!';
    } else if (!f.onGround && this.flightTime < 200 && f.agl < 400 && f.vs > -1 && dist > 15000) h = 'Climbing! The wheels fold away by themselves';
    else if (!f.onGround && dist > 15000) h = `Follow the green arrow to ${this.dest.name}. Tap the map to change`;
    else if (!f.onGround && dist <= 15000) {
      if (f.V > 105) h = 'Slow down: pull the thrust back, aim for about 280 km/h';
      else if (this.settings.help === 'on') h = 'Fly through the green rings to the runway';
      else h = 'Line up with the runway and come down gently';
    } else if (f.onGround && f.flown && f.V > 1) h = 'Thrust to 0% - the brakes stop you';
    if (h !== this.lastHint) { $('hint').innerHTML = h; this.lastHint = h; }
  }

  // ------------------------------------------------------------- phones

  watchOrientation() {
    const el = $('rotate');
    const phone = isPhone();
    let offer = phone;
    let wasPortrait = innerHeight > innerWidth;
    const paint = () => {
      const portrait = innerHeight > innerWidth;
      const wants = !portrait && offer && !document.fullscreenElement && this.state === 'fly';
      el.classList.toggle('full', wants && !portrait);
      el.classList.toggle('hidden', !(phone && portrait) && !wants);
    };
    const turned = () => {
      offer = phone;
      if (offer && innerHeight <= innerWidth && !document.fullscreenElement && this.state === 'fly') this.goFullscreen();
      paint();
    };
    addEventListener('resize', () => {
      const portrait = innerHeight > innerWidth;
      if (portrait !== wasPortrait) { wasPortrait = portrait; turned(); } else paint();
    });
    document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement) offer = false; paint(); });
    el.addEventListener('click', () => { offer = true; this.goFullscreen(); paint(); });
    this.paintRotate = paint;
    paint();
    addEventListener('popstate', () => {
      this.backGuard = false;
      screen.orientation?.unlock?.();
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      this.pause();
    });
  }

  goFullscreen() {
    if (!isPhone()) return;
    const el = document.documentElement;
    if (!document.fullscreenElement && el.requestFullscreen) el.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
    screen.orientation?.lock?.('landscape').catch(() => {});
    if (!this.backGuard) { this.backGuard = true; history.pushState({ balticskies: 'fullscreen' }, ''); }
    this.paintRotate?.();
  }
}

function isPhone() {
  return matchMedia('(hover: none) and (pointer: coarse)').matches && !!document.documentElement.requestFullscreen;
}

new Game();
