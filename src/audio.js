// Engine, wind and runway sounds, synthesised - nothing is downloaded.
// Browsers only allow audio after a tap, so start() is called from a button.

export class Sound {
  constructor() { this.ctx = null; this.muted = false; }

  start() {
    if (this.ctx) { this.ctx.resume?.(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const c = this.ctx = new AC();
    this.master = c.createGain();
    this.master.gain.value = this.muted ? 0 : 0.8;
    this.master.connect(c.destination);

    const noise = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
    const d = noise.getChannelData(0);
    let b = 0;
    for (let i = 0; i < d.length; i++) { b = 0.97 * b + 0.03 * (Math.random() * 2 - 1); d[i] = b * 6 + (Math.random() * 2 - 1) * 0.15; }
    const src = (n = noise) => { const s = c.createBufferSource(); s.buffer = n; s.loop = true; s.start(); return s; };

    // Jet roar: filtered noise whose brightness follows N1.
    this.roarF = c.createBiquadFilter(); this.roarF.type = 'lowpass'; this.roarF.frequency.value = 300;
    this.roarG = c.createGain(); this.roarG.gain.value = 0;
    src().connect(this.roarF).connect(this.roarG).connect(this.master);
    // Fan whine.
    this.whine = c.createOscillator(); this.whine.type = 'sawtooth'; this.whine.frequency.value = 400;
    this.whine2 = c.createOscillator(); this.whine2.type = 'triangle'; this.whine2.frequency.value = 600;
    this.whineF = c.createBiquadFilter(); this.whineF.type = 'bandpass'; this.whineF.Q.value = 6; this.whineF.frequency.value = 900;
    this.whineG = c.createGain(); this.whineG.gain.value = 0;
    this.whine.connect(this.whineF); this.whine2.connect(this.whineF);
    this.whineF.connect(this.whineG).connect(this.master);
    this.whine.start(); this.whine2.start();
    // Wind.
    this.windF = c.createBiquadFilter(); this.windF.type = 'bandpass'; this.windF.frequency.value = 700; this.windF.Q.value = 0.6;
    this.windG = c.createGain(); this.windG.gain.value = 0;
    src().connect(this.windF).connect(this.windG).connect(this.master);
    // Runway rumble.
    this.rumbleF = c.createBiquadFilter(); this.rumbleF.type = 'lowpass'; this.rumbleF.frequency.value = 120;
    this.rumbleG = c.createGain(); this.rumbleG.gain.value = 0;
    src().connect(this.rumbleF).connect(this.rumbleG).connect(this.master);
    this.noiseBuf = noise;
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.8, this.ctx.currentTime, 0.05);
  }

  update(f, camDist) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime, k = 0.08;
    const n = Math.max(0, (f.n1 - 0.22) / 0.78);
    const near = 1 / (1 + Math.max(0, camDist - 40) / 120);
    this.roarF.frequency.setTargetAtTime(250 + 1400 * n, t, k);
    this.roarG.gain.setTargetAtTime((0.05 + 0.32 * n * n) * near, t, k);
    this.whine.frequency.setTargetAtTime(420 + 2300 * f.n1, t, k);
    this.whine2.frequency.setTargetAtTime(700 + 3100 * f.n1, t, k);
    this.whineF.frequency.setTargetAtTime(600 + 2600 * f.n1, t, k);
    this.whineG.gain.setTargetAtTime(0.018 * f.n1 * near, t, k);
    const v = Math.min(1, f.V / 240);
    this.windG.gain.setTargetAtTime(0.16 * v * v, t, k);
    this.windF.frequency.setTargetAtTime(400 + 900 * v, t, k);
    this.rumbleG.gain.setTargetAtTime(f.onGround ? Math.min(0.5, f.V / 90) : 0, t, k);
    if (f.crashed) { this.roarG.gain.setTargetAtTime(0, t, 0.3); this.whineG.gain.setTargetAtTime(0, t, 0.3); this.windG.gain.setTargetAtTime(0, t, 0.3); this.rumbleG.gain.setTargetAtTime(0, t, 0.1); }
  }

  /** Short noise burst: gear clunk, touchdown, crash. */
  bump(gain = 0.5, freq = 200, dur = 0.25) {
    if (!this.ctx) return;
    const c = this.ctx, s = c.createBufferSource();
    s.buffer = this.noiseBuf;
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = freq;
    const g = c.createGain();
    g.gain.setValueAtTime(gain, c.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + dur);
    s.connect(f).connect(g).connect(this.master);
    s.start(); s.stop(c.currentTime + dur + 0.05);
  }

  /** A two-tone chime, for messages. */
  chime() {
    if (!this.ctx) return;
    const c = this.ctx;
    [880, 660].forEach((fr, i) => {
      const o = c.createOscillator(), g = c.createGain();
      o.type = 'sine'; o.frequency.value = fr;
      const t0 = c.currentTime + i * 0.28;
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(0.12, t0 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.6);
      o.connect(g).connect(this.master);
      o.start(t0); o.stop(t0 + 0.65);
    });
  }

  say(text) {
    if (this.muted || !window.speechSynthesis) return;
    try {
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 1; u.pitch = 1; u.volume = 0.9;
      speechSynthesis.cancel();
      speechSynthesis.speak(u);
    } catch { /* not available */ }
  }
}
