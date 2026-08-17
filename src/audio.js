// Allt ljud syntetiseras i WebAudio — inga ljudfiler behövs.

export class Sound {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.muted = false;
  }

  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.32;
    this.master.connect(this.ctx.destination);
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }

  get ready() { return this.ctx && !this.muted; }

  tone({ f = 440, f2 = null, dur = 0.15, type = 'square', vol = 0.3, attack = 0.005, delay = 0 }) {
    if (!this.ready) return;
    const c = this.ctx, t = c.currentTime + delay;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f, t);
    if (f2 !== null) o.frequency.exponentialRampToValueAtTime(Math.max(1, f2), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  noise({ dur = 0.2, vol = 0.3, freq = 900, q = 1.2, type = 'bandpass', delay = 0, sweep = null }) {
    if (!this.ready) return;
    const c = this.ctx, t = c.currentTime + delay;
    const n = Math.floor(c.sampleRate * dur);
    const buf = c.createBuffer(1, n, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = c.createBufferSource();
    src.buffer = buf;
    const filt = c.createBiquadFilter();
    filt.type = type;
    filt.frequency.setValueAtTime(freq, t);
    if (sweep) filt.frequency.exponentialRampToValueAtTime(Math.max(40, sweep), t + dur);
    filt.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filt).connect(g).connect(this.master);
    src.start(t);
  }

  /** Liten slumpvariation i tonhöjd, annars låter hundra slag som ett enda. */
  v(amount = 0.08) { return 1 + (Math.random() * 2 - 1) * amount; }

  shoot() {
    this.tone({ f: 720, f2: 240, dur: 0.09, type: 'square', vol: 0.10 });
    this.noise({ dur: 0.06, vol: 0.06, freq: 2400, sweep: 700 });
  }

  // ------------------------------------------------------------- svärdet
  // Tungt och metalliskt: en luftig vissling, en köttig duns och en klang
  // som ringer ut. Varje slag varieras något i tonhöjd.

  swing() {
    const p = this.v(0.14);
    this.noise({ dur: 0.14 * p, vol: 0.11, freq: 400 * p, sweep: 2500 * p, q: 0.8 });
    this.tone({ f: 190 * p, f2: 350 * p, dur: 0.09, type: 'sine', vol: 0.04 });
  }
  swordHit() {
    const p = this.v(0.10);
    this.tone({ f: 195 * p, f2: 62 * p, dur: 0.13, type: 'triangle', vol: 0.13 });
    this.tone({ f: 1180 * p, f2: 700 * p, dur: 0.11, type: 'square', vol: 0.045 });
    this.tone({ f: 1790 * p, f2: 980 * p, dur: 0.08, type: 'square', vol: 0.025, delay: 0.006 });
    this.noise({ dur: 0.09, vol: 0.085, freq: 1500 * p, sweep: 480, q: 1.1 });
  }
  swordCrit() {
    const p = this.v(0.07);
    this.tone({ f: 150 * p, f2: 46 * p, dur: 0.24, type: 'sawtooth', vol: 0.14 });
    this.tone({ f: 1520 * p, f2: 620 * p, dur: 0.3, type: 'square', vol: 0.06 });
    this.tone({ f: 2270 * p, f2: 1380 * p, dur: 0.34, type: 'triangle', vol: 0.045, delay: 0.02 });
    this.noise({ dur: 0.19, vol: 0.12, freq: 2200 * p, sweep: 420, q: 0.9 });
  }

  // -------------------------------------------------------------- lasern
  // Torrt och elektriskt: tunnare, kortare och ljusare än stålet, utan bas.

  laserHit() {
    const p = this.v(0.11);
    this.tone({ f: 920 * p, f2: 215 * p, dur: 0.07, type: 'square', vol: 0.07 });
    this.noise({ dur: 0.07, vol: 0.07, freq: 3200 * p, sweep: 900, q: 1.6, type: 'highpass' });
  }
  laserCrit() {
    const p = this.v(0.08);
    this.tone({ f: 1400 * p, f2: 250 * p, dur: 0.12, type: 'sawtooth', vol: 0.09 });
    this.tone({ f: 2500 * p, f2: 3500 * p, dur: 0.17, type: 'sine', vol: 0.05, delay: 0.02 });
    this.noise({ dur: 0.13, vol: 0.09, freq: 4000 * p, sweep: 1100, q: 1.2, type: 'highpass' });
  }
  droneDive() {
    this.tone({ f: 320, f2: 1500, dur: 0.35, type: 'sawtooth', vol: 0.05 });
  }
  snipe() {
    this.tone({ f: 2200, f2: 420, dur: 0.09, type: 'square', vol: 0.09 });
    this.noise({ dur: 0.16, vol: 0.09, freq: 3000, sweep: 500, q: 1.4 });
  }
  salvo() {
    for (let i = 0; i < 3; i++) {
      this.tone({ f: 420, f2: 150, dur: 0.09, type: 'square', vol: 0.07, delay: i * 0.07 });
    }
  }
  finisher() {
    this.noise({ dur: 0.22, vol: 0.15, freq: 300, sweep: 2800, q: 0.7 });
    this.tone({ f: 130, f2: 48, dur: 0.3, type: 'sawtooth', vol: 0.13 });
    this.tone({ f: 640, f2: 250, dur: 0.16, type: 'triangle', vol: 0.08, delay: 0.06 });
  }
  fireball() {
    this.tone({ f: 190, f2: 55, dur: 0.45, type: 'sawtooth', vol: 0.15 });
    this.noise({ dur: 0.5, vol: 0.16, freq: 600, sweep: 90, q: 0.6, type: 'lowpass' });
    this.tone({ f: 520, f2: 900, dur: 0.18, type: 'sine', vol: 0.06 });
  }
  laser() {
    const p = this.v(0.07);
    this.tone({ f: 1650 * p, f2: 330 * p, dur: 0.11, type: 'sawtooth', vol: 0.085 });
    this.tone({ f: 2500 * p, f2: 900 * p, dur: 0.05, type: 'sine', vol: 0.045 });
    this.noise({ dur: 0.05, vol: 0.04, freq: 4200 * p, sweep: 1400 });
  }
  hit() { this.tone({ f: 300, f2: 120, dur: 0.06, type: 'triangle', vol: 0.12 }); }
  crit() {
    this.tone({ f: 900, f2: 300, dur: 0.10, type: 'sawtooth', vol: 0.13 });
    this.noise({ dur: 0.08, vol: 0.08, freq: 3200, sweep: 900 });
  }
  kill() {
    this.noise({ dur: 0.22, vol: 0.16, freq: 1400, sweep: 160, q: 0.7 });
    this.tone({ f: 180, f2: 60, dur: 0.18, type: 'sawtooth', vol: 0.08 });
  }
  explode() {
    this.noise({ dur: 0.45, vol: 0.24, freq: 700, sweep: 70, q: 0.5, type: 'lowpass' });
    this.tone({ f: 110, f2: 34, dur: 0.35, type: 'sine', vol: 0.16 });
  }
  dash() {
    this.noise({ dur: 0.20, vol: 0.14, freq: 500, sweep: 3200, q: 0.9 });
    this.tone({ f: 260, f2: 880, dur: 0.14, type: 'sine', vol: 0.07 });
  }
  jump() { this.tone({ f: 340, f2: 620, dur: 0.10, type: 'sine', vol: 0.07 }); }
  land() { this.noise({ dur: 0.09, vol: 0.07, freq: 320, sweep: 120, q: 0.8 }); }
  hurt() {
    this.tone({ f: 200, f2: 70, dur: 0.22, type: 'sawtooth', vol: 0.16 });
    this.noise({ dur: 0.18, vol: 0.12, freq: 500, sweep: 120 });
  }
  pickup() { this.tone({ f: 880, f2: 1320, dur: 0.07, type: 'sine', vol: 0.06 }); }
  /** Mynt: två klara toner ovanpå varandra — ska inte gå att blanda ihop med XP. */
  coin() {
    const v = this.v(0.03);
    this.tone({ f: 1180 * v, dur: 0.05, type: 'square', vol: 0.045 });
    this.tone({ f: 1770 * v, dur: 0.10, type: 'square', vol: 0.030, delay: 0.035 });
  }
  /** Klirret när något köps i shoppen. */
  buy() {
    [660, 990, 1320].forEach((f, i) =>
      this.tone({ f, dur: 0.16, type: 'triangle', vol: 0.09, delay: i * 0.05 }));
  }
  /** Nekat köp: kort, torr och otvetydig. */
  denied() { this.tone({ f: 180, f2: 120, dur: 0.14, type: 'square', vol: 0.08 }); }
  heal() {
    this.tone({ f: 520, f2: 780, dur: 0.16, type: 'sine', vol: 0.10 });
    this.tone({ f: 780, f2: 1170, dur: 0.18, type: 'sine', vol: 0.07, delay: 0.06 });
  }
  levelUp() {
    [523, 659, 784, 1047].forEach((f, i) =>
      this.tone({ f, dur: 0.30, type: 'triangle', vol: 0.12, delay: i * 0.07 }));
  }
  waveStart() {
    [196, 262, 330].forEach((f, i) =>
      this.tone({ f, dur: 0.45, type: 'sawtooth', vol: 0.09, delay: i * 0.10 }));
  }
  bossSpawn() {
    this.tone({ f: 70, f2: 40, dur: 1.6, type: 'sawtooth', vol: 0.20 });
    this.tone({ f: 105, f2: 60, dur: 1.6, type: 'square', vol: 0.10, delay: 0.1 });
    this.noise({ dur: 1.4, vol: 0.12, freq: 260, sweep: 60, q: 0.4 });
  }
  /** Åska. far 0 = strax intill och skarpt, 1 = långt bort och dovt. */
  thunder(far = 0.5) {
    const delay = far * 2.6;            // ljudet hinner ifatt ljuset
    const vol = 0.26 * (1 - far * 0.6);
    this.noise({ dur: 0.9 + far * 1.4, vol, freq: 190 - far * 110, q: 0.35,
      sweep: 55, delay });
    this.noise({ dur: 1.6 + far * 1.8, vol: vol * 0.7, freq: 95 - far * 45, q: 0.3,
      delay: delay + 0.18 });
    this.tone({ f: 44, f2: 26, dur: 1.5 + far, type: 'sine', vol: vol * 0.5, delay: delay + 0.05 });
    if (far < 0.5) this.noise({ dur: 0.12, vol: vol * 0.9, freq: 2600, q: 0.9, delay });
  }

  gameOver() {
    [392, 330, 262, 196].forEach((f, i) =>
      this.tone({ f, f2: f * 0.5, dur: 0.7, type: 'triangle', vol: 0.14, delay: i * 0.22 }));
  }
}
