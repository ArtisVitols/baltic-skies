// Flight model: point-mass aerodynamics with a fly-by-wire feel.
//
// Lift, drag, thrust and weight are real numbers for a 64-tonne narrow-body,
// so it accelerates, rotates, climbs and floats like one. The controls are
// what make it playable with four buttons:
//
//  - Holding ▲/▼ changes pitch; letting go holds the flight path you had
//    (the way an Airbus behaves), so the plane does not wander.
//  - Holding ◀/▶ banks up to 33°; letting go rolls wings level by itself.
//  - The wing can never stall: angle of attack is capped below the stall,
//    so flying too slowly means sinking, not falling out of the sky.
//  - The gear comes up by itself after take-off and down by itself on final.

import { GEAR_HEIGHT, BELLY_HEIGHT } from './plane.js';
import { clamp } from './noise.js';

const D2R = Math.PI / 180;
const G = 9.81, M = 64000, S = 122.6, CLA = 5.2;
const FLAP_LIMIT = [999, 118, 103, 95, 90];      // m/s, per flap setting
export const FLAP_NAMES = ['UP', '1', '2', '3', 'FULL'];
// The main wheels' contact point in the aircraft's frame.
const MAIN_Y = -GEAR_HEIGHT, MAIN_Z = 1.35;

export class Flight {
  constructor(world, airports) {
    this.world = world;
    this.airports = airports;
    this.events = [];
  }

  /** Line up on a runway end, engines idling, ready to go. */
  reset(airport, endIdx) {
    const e = airport.ends[endIdx];
    this.x = e.x + e.dx * 60;
    this.z = e.z + e.dz * 60;
    this.psi = e.hdg * D2R;
    this.theta = 0; this.phi = 0; this.gamma = 0; this.gammaHold = 0;
    this.V = 0;
    this.onGround = true;
    this.y = airport.elev + GEAR_HEIGHT;
    this.gearPos = 1; this.gearCmd = true;
    this.flapIdx = 1; this.flapPos = 0.25;
    this.throttle = 0; this.n1 = 0.22;
    this.spoilers = 0; this.spoilerCmd = 0;
    this.crashed = null;
    this.flown = false;           // has it left the ground since the reset?
    this.stoppedFired = false;
    this.autoGearUp = true;
    this.autoGearDown = true;
    this.from = airport;
    this.time = 0;
    this.agl = 0;
    this.vs = 0;
    this.alpha = 0;
    this.rolled = 0;
    this.pitchIn = 0; this.rollIn = 0;
    this.touchdown = null;
  }

  /** Put the aircraft in the air (tests, and "start in flight"). */
  resetAir(x, z, alt, hdgDeg, V) {
    this.reset(this.airports.list[0], 1);
    this.x = x; this.z = z; this.y = alt; this.psi = hdgDeg * D2R; this.V = V;
    this.onGround = false; this.flown = true;
    this.gearPos = 0; this.gearCmd = false; this.flapIdx = 0; this.flapPos = 0;
    this.throttle = 0.6; this.n1 = 0.22 + 0.78 * 0.6;
    this.theta = 2 * D2R; this.gamma = 0; this.gammaHold = 0;
  }

  toggleGear() {
    this.gearCmd = !this.gearCmd;
    // A pilot who touches the gear has taken over from the automatic.
    this.autoGearUp = false;
    if (this.gearCmd) this.autoGearDown = false;
    return this.gearCmd;
  }

  setFlaps(idx) {
    idx = clamp(idx, 0, 4);
    if (idx > this.flapIdx && this.V > FLAP_LIMIT[idx] + 2) return false;
    this.flapIdx = idx;
    return true;
  }

  get speedKmh() { return this.V * 3.6; }
  get heading() { return ((this.psi / D2R) % 360 + 360) % 360; }

  emit(type, data = {}) { this.events.push({ type, ...data }); }

  step(dt, input) {
    if (this.crashed) return;
    this.time += dt;
    const W = this.world;
    // Smooth the digital buttons into something an aircraft can follow.
    const ramp = (cur, want, rate) => cur + clamp(want - cur, -rate * dt, rate * dt);
    this.pitchIn = ramp(this.pitchIn, input.pitch, 3);
    this.rollIn = ramp(this.rollIn, input.roll, 3);

    // Systems.
    this.n1 += ((0.22 + 0.78 * this.throttle) - this.n1) * Math.min(1, dt * 0.55);
    this.flapPos = ramp(this.flapPos, this.flapIdx / 4, 0.14);
    this.gearPos = ramp(this.gearPos, this.gearCmd ? 1 : 0, 1 / 6.5);
    if (this.onGround && this.flown && this.throttle < 0.2 && this.V > 20) this.spoilerCmd = 1;
    if (this.throttle > 0.5 || !this.onGround) this.spoilerCmd = 0;
    this.spoilers = ramp(this.spoilers, this.spoilerCmd, 1.5);
    if (this.V > FLAP_LIMIT[this.flapIdx] + 4 && this.flapIdx > 0) {
      this.flapIdx--;
      this.emit('flapsAuto', { idx: this.flapIdx });
    }

    const rho = 1.225 * Math.exp(-this.y / 8500);
    const q = 0.5 * rho * this.V * this.V;
    const thr = 0.035 + 0.965 * Math.max(0, (this.n1 - 0.22) / 0.78);
    const T = 2 * 118000 * thr * (1 - this.V / 560) * Math.pow(rho / 1.225, 0.75);
    const alphaStall = (15 - 3 * this.flapPos) * D2R;
    const cl0 = 0.22 + 0.78 * this.flapPos;
    const mach = this.V / 330;
    const cdExtra = 0.055 * this.flapPos + 0.022 * this.gearPos + 0.06 * this.spoilers + 3 * Math.max(0, mach - 0.8) ** 2;

    const gh = W.height(this.x, this.z);
    if (this.onGround) this.groundStep(dt, q, T, cl0, cdExtra, gh, input);
    else this.airStep(dt, q, T, cl0, cdExtra, alphaStall, gh);

    // Height above whatever is below: water counts as ground.
    const surf = Math.max(gh, 0);
    this.agl = this.y - GEAR_HEIGHT - surf;
    this.vs = this.onGround ? 0 : this.V * Math.sin(this.gamma);

    // Automatic gear.
    if (!this.onGround && this.flown) {
      if (this.autoGearUp && this.gearCmd && this.agl > 15 && this.vs > 1) {
        this.gearCmd = false; this.autoGearUp = false; this.autoGearDown = true;
        this.emit('gearUp');
      }
      if (this.autoGearDown && !this.gearCmd && this.agl < 320 && this.vs < -0.5) {
        const near = W.airportNear(this.x, this.z);
        if (near.airport && near.dist < 9000) {
          this.gearCmd = true; this.autoGearDown = false;
          this.emit('gearDown');
        }
      }
    }
  }

  airStep(dt, q, T, cl0, cdExtra, alphaStall, gh) {
    // Pitch: buttons command a rate; hands off holds the flight path.
    if (Math.abs(this.pitchIn) > 0.05) {
      this.theta += this.pitchIn * 5 * D2R * clamp(this.V / 80, 0.35, 1) * dt;
      this.gammaHold = this.gamma;
      this.gInt = 0;
    } else {
      // PI hold, so a long turn does not slowly bleed height away.
      const err = this.gammaHold - this.gamma;
      this.gInt = clamp((this.gInt || 0) + err * dt, -0.2, 0.2);
      this.theta += clamp(err * 2.2 + this.gInt * 1.2, -4 * D2R, 4 * D2R) * dt;
    }
    const aMax = alphaStall - 2 * D2R;
    this.theta = clamp(this.theta, this.gamma - 5 * D2R, this.gamma + aMax);
    this.theta = clamp(this.theta, -20 * D2R, 27 * D2R);
    // Keep the hold target reachable, or a slow aircraft would fight itself.
    this.gammaHold = clamp(this.gammaHold, -12 * D2R, 18 * D2R);

    // Roll: bank towards the button, wings level when let go.
    const target = this.rollIn * 33 * D2R;
    const rate = (Math.abs(this.rollIn) > 0.05 ? 13 : 9) * D2R;
    this.phi += clamp(target - this.phi, -rate * dt, rate * dt);

    const alpha = this.theta - this.gamma;
    this.alpha = alpha;
    const CL = cl0 + CLA * alpha;
    const CD = 0.022 + 0.042 * CL * CL + cdExtra;
    const L = q * S * CL, D = q * S * CD;
    const V = Math.max(this.V, 25);
    const Vdot = (T * Math.cos(alpha) - D) / M - G * Math.sin(this.gamma);
    const gdot = (L * Math.cos(this.phi) + T * Math.sin(alpha) - M * G * Math.cos(this.gamma)) / (M * V);
    const pdot = (L * Math.sin(this.phi)) / (M * V * Math.cos(this.gamma));
    this.V = Math.max(0, this.V + Vdot * dt);
    this.gamma = clamp(this.gamma + gdot * dt, -40 * D2R, 40 * D2R);
    this.psi += pdot * dt;
    const ch = Math.cos(this.gamma);
    this.x += this.V * ch * Math.sin(this.psi) * dt;
    this.z -= this.V * ch * Math.cos(this.psi) * dt;
    this.y += this.V * Math.sin(this.gamma) * dt;

    // Contact?
    const geared = this.gearPos > 0.95;
    const low = geared
      ? this.y + (MAIN_Y * Math.cos(this.theta) - MAIN_Z * Math.sin(this.theta))
      : this.y - BELLY_HEIGHT;
    const surf = Math.max(gh, 0);
    if (low > surf) return;
    const vs = this.V * Math.sin(this.gamma);
    const near = this.world.airportNear(this.x, this.z);
    let why = null;
    if (gh < 0.05) why = 'water';
    else if (!geared) why = this.gearPos > 0.05 ? 'gear' : 'belly';
    else if (vs < -4.6) why = 'hard';
    else if (Math.abs(this.phi) > 12 * D2R) why = 'wing';
    else if (!near.airport || near.dist > 1150) why = 'field';
    else if (this.theta < -3 * D2R) why = 'nose';
    if (why) { this.crash(why, vs); return; }
    this.onGround = true;
    this.phi = 0; this.gamma = 0; this.gammaHold = 0;
    const rw = this.airports.onRunway(this.x, this.z);
    this.touchdown = { vs, runway: !!rw, airport: near.airport };
    this.stoppedFired = false;
    this.emit('touchdown', this.touchdown);
  }

  groundStep(dt, q, T, cl0, cdExtra, gh, input) {
    // Nose-wheel steering, fading into rudder authority with speed.
    const steer = 16 * D2R * clamp(1 - this.V / 70, 0.07, 1);
    this.psi += this.rollIn * steer * dt;
    if (this.pitchIn > 0.1 && this.V > 48) this.theta = Math.min(11.5 * D2R, this.theta + 3 * D2R * this.pitchIn * dt);
    else if (this.theta > 0) this.theta = Math.max(0, this.theta - 2.2 * D2R * dt);
    else this.theta = 0;
    const alpha = this.theta;
    this.alpha = alpha;
    const CL = cl0 + CLA * alpha - 0.6 * this.spoilers;
    const CD = 0.022 + 0.042 * CL * CL + cdExtra;
    const L = q * S * CL, D = q * S * CD;
    const N = Math.max(0, M * G - L);
    let brake = 0;
    if (input.brake) brake = 3.4;
    else if (this.flown && this.throttle < 0.15 && this.V > 1) brake = 1.8;   // autobrake
    else if (this.throttle < 0.02 && this.V < 12) brake = 0.6;                // taxi drag
    const Vdot = (T - D - 0.016 * N) / M - brake * (N / (M * G));
    this.V = Math.max(0, this.V + Vdot * dt);
    const dist = this.V * dt;
    this.rolled += dist;
    this.x += Math.sin(this.psi) * dist;
    this.z -= Math.cos(this.psi) * dist;
    // Sit on the main wheels, pivoting about them as the nose comes up.
    this.y = gh - (MAIN_Y * Math.cos(this.theta) - MAIN_Z * Math.sin(this.theta));
    this.gamma = 0;
    if (L > M * G * 1.005 && this.V > 40) {
      this.onGround = false;
      this.gamma = 0.3 * D2R; this.gammaHold = 3 * D2R;
      this.flown = true;
      this.autoGearUp = this.gearCmd;
      this.emit('liftoff');
      return;
    }
    const near = this.world.airportNear(this.x, this.z);
    if (!near.airport || near.dist > 1150 || gh < 0.3) {
      if (this.V > 3) { this.crash('overrun', 0); return; }
    }
    if (this.flown && this.V < 1.2 && !this.stoppedFired) {
      this.stoppedFired = true;
      this.emit('stopped', { airport: near.airport, runway: !!this.airports.onRunway(this.x, this.z, 30) });
    }
  }

  crash(why, vs) {
    this.crashed = why;
    this.emit('crash', { why, vs });
  }
}
