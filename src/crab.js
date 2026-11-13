// Claude the crab, in a hard hat, hammering the plane together while the
// world loads. Pixel art on a tiny canvas, scaled up crisp by CSS. The plane
// gains parts as loading progresses, so the picture *is* the progress bar.

const ORANGE = '#d97757', DARK = '#a9553a', HAT = '#f2c230', HATD = '#c99a1a';
const CRAB = [
  '..OO..........OO..',
  '.O..O........O..O.',
  '.OO.O..YYYY..O.OO.',
  '..OOO.YYYYYY.OOO..',
  '...O.YHHHHHHY.O...',
  '...O...E..E...O...',
  '...O...O..O...O...',
  '....OOOOOOOOOO....',
  '...OOOOOOOOOOOO...',
  '..OOOOOOOOOOOOOO..',
  '..ODOOOOOOOOOODO..',
  '...OOOOOOOOOOOO...',
  '..O.O.O....O.O.O..',
  '.O..O..O..O..O..O.',
];
const COL = { O: ORANGE, D: DARK, Y: HAT, H: HATD, E: '#1b1b1b' };

export class CrabBuilder {
  constructor(canvas) {
    this.cv = canvas;
    this.g = canvas.getContext('2d');
    canvas.width = 120; canvas.height = 44;
    this.p = 0;
    this.shown = 0;
    this.sparks = [];
    this.t0 = performance.now();
    this.running = false;
  }

  setProgress(p) { this.p = Math.max(this.p, p); }

  start() {
    if (this.running) return;
    this.running = true;
    const tick = () => {
      if (!this.running) return;
      this.draw();
      requestAnimationFrame(tick);
    };
    tick();
  }
  stop() { this.running = false; }

  px(x, y, c, w = 1, h = 1) { this.g.fillStyle = c; this.g.fillRect(Math.round(x), Math.round(y), w, h); }

  draw() {
    const g = this.g, t = (performance.now() - this.t0) / 1000;
    this.shown += (this.p - this.shown) * 0.08;
    const s = this.shown;
    g.clearRect(0, 0, 120, 44);

    // Ground line.
    this.px(0, 41, 'rgba(255,255,255,0.15)', 120, 1);

    // The plane under construction, facing right.
    const X = 46, Y = 18;
    const P = (x, y, c, w = 1, h = 1) => this.px(X + x, Y + y, c, w, h);
    const body = Math.min(1, s / 0.3);
    const len = Math.round(60 * body);
    if (len > 0) {
      P(4, 6, '#e9edf2', Math.min(len, 54), 6);
      P(4, 11, '#c5cad1', Math.min(len, 54), 1);
      if (len > 54) { P(58, 7, '#e9edf2', 3, 4); P(61, 8, '#e9edf2', 1, 3); }
      P(2, 7, '#e9edf2', 2, 4);     // tail cone
    }
    if (s > 0.3) for (let x = 14; x < 52; x += 3) P(x, 8, '#2a3a4c');
    if (s > 0.35) P(56, 7, '#1b2430', 3, 2);                     // cockpit
    if (s > 0.45) { P(22, 11, '#cdd2d8', 18, 2); P(26, 13, '#cdd2d8', 10, 1); }   // wing
    if (s > 0.6) { P(28, 13, '#13315c', 8, 3); P(36, 14, '#b8bec6', 1, 1); }      // engine
    if (s > 0.75) { P(2, 0, '#13315c', 4, 7); P(4, -2, '#13315c', 3, 2); P(0, 5, '#cdd2d8', 6, 1); } // fin
    if (s > 0.88) { P(6, 10, '#f2a900', Math.min(len, 48), 1); P(3, 2, '#f2a900', 2, 2); }   // stripe + logo
    if (s > 0.95) { P(18, 12, '#333', 1, 4); P(17, 16, '#111', 3, 2); P(50, 12, '#333', 1, 4); P(49, 16, '#111', 3, 2); } // gear

    // Claude.
    const bob = Math.round(Math.sin(t * 6) * 0.6);
    const cx = 10, cy = 25 + bob;
    CRAB.forEach((row, y) => {
      for (let x = 0; x < row.length; x++) {
        const c = COL[row[x]];
        if (c) this.px(cx + x, cy + y, c);
      }
    });
    // Blink.
    if ((t % 3.2) < 0.12) { this.px(cx + 7, cy + 5, ORANGE); this.px(cx + 10, cy + 5, ORANGE); }

    // The hammer, swinging from the right claw.
    const sw = Math.sin(t * 7);
    const ang = -0.9 + (sw * 0.5 + 0.5) * 1.6;
    const hx = cx + 16, hy = cy + 2;
    g.save();
    g.translate(hx, hy);
    g.rotate(ang);
    g.fillStyle = '#8a5a35'; g.fillRect(0, -1, 12, 2);
    g.fillStyle = '#9aa3ad'; g.fillRect(10, -3, 4, 6);
    g.restore();
    // Sparks at the bottom of each swing, where the work is.
    if (sw > 0.97 && s < 0.999) {
      const wx = X + 4 + Math.min(56, len) * 0.5 + (Math.random() - 0.5) * 30;
      for (let k = 0; k < 4; k++) this.sparks.push({ x: wx, y: Y + 8, vx: (Math.random() - 0.5) * 1.6, vy: -Math.random() * 1.5, life: 1 });
    }
    this.sparks = this.sparks.filter((p) => (p.life -= 0.05) > 0);
    for (const p of this.sparks) {
      p.x += p.vx; p.y += p.vy; p.vy += 0.08;
      this.px(p.x, p.y, p.life > 0.5 ? '#fff6a0' : '#f2a900');
    }
  }
}
