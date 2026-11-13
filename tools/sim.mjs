// Flight-model checks run inside the page (no rendering needed):
// a full take-off from Riga, and an autopilot approach + landing at Tallinn.
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const puppeteer = require('/home/artis/PROJECTS/mcqueen/tools/node/node_modules/puppeteer-core');
const browser = await puppeteer.launch({
  executablePath: `${process.env.HOME}/.local/chrome/chrome-headless-shell-linux64/chrome-headless-shell`,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'], protocolTimeout: 600000,
});
const page = await browser.newPage();
await page.setViewport({ width: 640, height: 360 });
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.goto(`http://localhost:${process.env.PORT || 8123}/index.html?fast&q=low`, { waitUntil: 'load' });
await page.waitForFunction(() => window.game && window.game.state === 'menu', { timeout: 600000 });
const r = await page.evaluate(() => {
  const g = window.game, f = g.flight, out = {};
  g.state = 'test';
  const D2R = Math.PI / 180;
  // ---- take-off
  g.placeAtDeparture();
  f.throttle = 1;
  let t = 0, ev = [];
  const log = () => { for (const e of f.events) ev.push(`${t.toFixed(1)}s ${e.type}${e.vs !== undefined ? ' vs=' + e.vs.toFixed(2) : ''}${e.why ? ' ' + e.why : ''}`); f.events.length = 0; };
  const x0 = f.x, z0 = f.z;
  while (t < 240 && !f.crashed) {
    const pitch = f.onGround ? (f.V > 72 ? 1 : 0) : (f.theta < 12 * D2R && f.y < 1500 ? 0.4 : 0);
    if (!f.onGround && f.y > 1500 && f.throttle > 0.7) f.throttle = 0.7;
    f.step(0.01, { pitch, roll: 0, brake: false }); t += 0.01; log();
    if (!out.lift && !f.onGround) out.lift = { t: +t.toFixed(1), dist: Math.round(Math.hypot(f.x - x0, f.z - z0)), kmh: Math.round(f.V * 3.6) };
    if (!out.at1000 && f.y > 1000) out.at1000 = { t: +t.toFixed(1), kmh: Math.round(f.V * 3.6), gear: f.gearPos.toFixed(2) };
  }
  out.end = { t, alt: Math.round(f.y), kmh: Math.round(f.V * 3.6), vs: f.vs.toFixed(1), crashed: f.crashed };
  out.takeoffEvents = ev;
  // ---- turn check: hold right bank for 20 s
  const psi0 = f.psi; let tt = 0; const y0 = f.y;
  while (tt < 20) { f.step(0.01, { pitch: 0, roll: 1, brake: false }); tt += 0.01; }
  out.turn = { deg: Math.round((f.psi - psi0) / D2R), bank: Math.round(f.phi / D2R), altChange: Math.round(f.y - y0) };
  while (tt < 30) { f.step(0.01, { pitch: 0, roll: 0, brake: false }); tt += 0.01; }
  out.levelled = Math.round(f.phi / D2R);
  // ---- approach + landing at Tallinn
  const d = g.airport('TLL'), e = d.ends[0];
  const D = 9000;
  f.resetAir(e.x - e.dx * D, e.z - e.dz * D, d.elev + 3.97 + Math.tan(3 * D2R) * (D + 300), e.hdg, 95);
  f.flapIdx = 0; f.gearCmd = false; f.gearPos = 0; f.autoGearDown = true;
  ev = []; t = 0;
  const tdx = e.x + e.dx * 300, tdz = e.z + e.dz * 300;
  while (t < 400 && !f.crashed) {
    const along = (tdx - f.x) * e.dx + (tdz - f.z) * e.dz;    // metres to go to touchdown point
    const cross = -(f.x - tdx) * e.dz + (f.z - tdz) * e.dx;
    if (f.V < 100 && f.flapIdx < 4) f.setFlaps(f.flapIdx + 1);
    const want = d.elev + 3.97 + Math.tan(3 * D2R) * Math.max(0, along);
    let pitch = 0;
    if (!f.onGround) {
      const gw = Math.atan2(want - f.y, 400) - 3 * D2R;   // flight path wanted
      pitch = Math.max(-1, Math.min(1, (gw - f.gamma) * 8));
      if (f.agl < 12) { pitch = f.vs < -1.2 ? 0.8 : 0; f.throttle = 0; }
      else f.throttle = Math.max(0, Math.min(1, f.throttle + (72 - f.V) * 0.002));
    }
    // steer onto the centreline
    const hdgErr = Math.atan2(Math.sin(e.hdg * D2R - f.psi), Math.cos(e.hdg * D2R - f.psi));
    const wantHdg = -cross * 0.002;
    const roll = f.onGround ? 0 : Math.max(-1, Math.min(1, (hdgErr + wantHdg) * 6));
    f.step(0.01, { pitch, roll, brake: false }); t += 0.01; log();
    if (f.events.length === 0 && ev.some((s) => s.includes('stopped'))) break;
  }
  out.landingEvents = ev;
  out.landing = { t: +t.toFixed(1), V: f.V.toFixed(1), onGround: f.onGround, crashed: f.crashed, onRunway: !!g.airports.onRunway(f.x, f.z) };
  return out;
});
console.log(JSON.stringify(r, null, 1));
await browser.close();
