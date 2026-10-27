// Procedural WebAudio soundscape: no external assets, everything synthesized.
export class AudioSys {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.sfxGain = null;
    this.ambGain = null;
    this.enabled = true;
    this.musicOn = true;
    this.alarmOn = false;
    this.alarmTimer = 0;
    this.started = false;
    this.noiseBuffer = null;
    this.shotThrottle = 0;
  }

  init() {
    if (this.started) return;
    try {
      this._init();
    } catch (err) {
      // Audio is cosmetic: never let it break the game or the UI.
      console.warn('[audio] init failed, running muted:', err && err.message);
      this.started = false;
      this.enabled = false;
      this.ctx = null;
    }
  }

  _init() {
    if (this.started) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.75;
    this.master.connect(this.ctx.destination);
    this.sfxGain = this.ctx.createGain();
    this.sfxGain.gain.value = 0.9;
    this.sfxGain.connect(this.master);
    this.ambGain = this.ctx.createGain();
    this.ambGain.gain.value = 0.5;
    this.ambGain.connect(this.master);
    this.noiseBuffer = this.makeNoise(2.5);
    this.started = true;
    this.startAmbience();
    this.startDrone();
  }

  resume() {
    if (!this.enabled) return;
    try {
      if (!this.ctx) this.init();
      if (this.ctx && this.ctx.state === 'suspended') {
        const r = this.ctx.resume();
        if (r && typeof r.catch === 'function') r.catch(() => {});
      }
    } catch (err) {
      console.warn('[audio] resume failed:', err && err.message);
    }
  }

  makeNoise(seconds) {
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02;
      data[i] = last * 3.2;
    }
    return buf;
  }

  setVolume(v) {
    if (!this.master) return;
    try { this.master.gain.value = Math.max(0, Math.min(1, v)); } catch {}
  }

  startAmbience() {
    try {
      this._startAmbience();
    } catch (err) {
      console.warn('[audio] ambience failed:', err && err.message);
    }
  }

  _startAmbience() {
    const ctx = this.ctx;
    if (!ctx) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 420;
    filter.Q.value = 0.5;
    const gain = ctx.createGain();
    gain.gain.value = 0.09;
    src.connect(filter); filter.connect(gain); gain.connect(this.ambGain);
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.09;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.05;
    lfo.connect(lfoGain); lfoGain.connect(gain.gain);
    this.startNode(src);
    this.startNode(lfo);
    // occasional distant metal creaks
    const creak = () => {
      if (!this.ctx) return;
      const now = this.ctx.currentTime;
      const o = this.ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(80 + Math.random() * 60, now);
      o.frequency.exponentialRampToValueAtTime(40, now + 0.9);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, now);
      g.gain.exponentialRampToValueAtTime(0.025, now + 0.06);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 1.2);
      o.connect(g); g.connect(this.ambGain);
      this.startNode(o, now);
      this.scheduleStop(o, now + 1.3);
      setTimeout(creak, 6000 + Math.random() * 11000);
    };
    setTimeout(creak, 5000);
  }

  startDrone() {
    try {
      this._startDrone();
    } catch (err) {
      console.warn('[audio] drone failed:', err && err.message);
    }
  }

  _startDrone() {
    const ctx = this.ctx;
    if (!ctx) return;
    const gain = ctx.createGain();
    gain.gain.value = 0.035;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass'; filter.frequency.value = 200;
    gain.connect(filter); filter.connect(this.ambGain);
    for (const f of [36.7, 55, 82.4]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      o.detune.value = (Math.random() - 0.5) * 12;
      o.connect(gain);
      this.startNode(o);
    }
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.06;
    const lg = ctx.createGain();
    lg.gain.value = 0.02;
    lfo.connect(lg); lg.connect(gain.gain);
    this.startNode(lfo);
  }

  stopAll() {
    try { if (this.ctx) this.ctx.close(); } catch {}
    this.ctx = null;
    this.started = false;
    this.master = null;
    this.sfxGain = null;
    this.ambGain = null;
  }

  panner(pan) {
    if (!this.ctx) return null;
    const p = this.ctx.createStereoPanner ? this.ctx.createStereoPanner() : null;
    if (p) { p.pan.value = Math.max(-1, Math.min(1, pan || 0)); p.connect(this.sfxGain); }
    return p;
  }

  envelope(node, gainNode, t0, a, d, peak = 0.5) {
    const g = gainNode.gain;
    g.cancelScheduledValues(t0);
    g.setValueAtTime(0.0001, t0);
    g.exponentialRampToValueAtTime(Math.max(0.0002, peak), t0 + a);
    g.exponentialRampToValueAtTime(0.0001, t0 + a + d);
    // stop() is only legal after start(); every caller starts the node first.
    this.scheduleStop(node, t0 + a + d + 0.05);
  }

  scheduleStop(node, when) {
    if (!node || !node.__started) return;
    try { node.stop(when); } catch (err) { /* already stopped / not started */ }
  }

  startNode(node, when) {
    if (!node || node.__started) return;
    try {
      node.start(when);
      node.__started = true;
    } catch (err) {
      console.warn('[audio] start failed:', err && err.message);
    }
  }

  tone({ freq = 440, endFreq = null, type = 'sine', dur = 0.2, vol = 0.3, pan = 0, attack = 0.005, delay = 0 }) {
    if (!this.started || !this.enabled || !this.ctx) return;
    try {
      const ctx = this.ctx;
      const t0 = ctx.currentTime + delay;
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.setValueAtTime(freq, t0);
      if (endFreq) o.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), t0 + dur);
      const g = ctx.createGain();
      const out = this.panner(pan) || this.sfxGain;
      o.connect(g); g.connect(out);
      // start() must happen before envelope() schedules stop().
      this.startNode(o, t0);
      this.envelope(o, g, t0, attack, dur, vol);
    } catch (err) {
      console.warn('[audio] tone failed:', err && err.message);
    }
  }

  noise({ dur = 0.2, vol = 0.3, pan = 0, filter = 'lowpass', freq = 800, endFreq = null, q = 1, delay = 0, attack = 0.004 }) {
    if (!this.started || !this.enabled || !this.ctx) return;
    try {
      const ctx = this.ctx;
      const t0 = ctx.currentTime + delay;
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuffer;
      const f = ctx.createBiquadFilter();
      f.type = filter;
      f.frequency.setValueAtTime(freq, t0);
      if (endFreq) f.frequency.exponentialRampToValueAtTime(Math.max(30, endFreq), t0 + dur);
      f.Q.value = q;
      const g = ctx.createGain();
      const out = this.panner(pan) || this.sfxGain;
      src.connect(f); f.connect(g); g.connect(out);
      this.startNode(src, t0);
      this.envelope(src, g, t0, attack, dur, vol);
    } catch (err) {
      console.warn('[audio] noise failed:', err && err.message);
    }
  }

  sfx(name, opts = {}) {
    if (!this.started || !this.enabled) return;
    try {
      this._sfx(name, opts);
    } catch (err) {
      // A broken audio node must never abort the caller (UI handlers, game loop).
      console.warn('[audio] sfx failed', name, err && err.message);
    }
  }

  _sfx(name, opts = {}) {
    const pan = opts.pan || 0;
    const vol = opts.volume ?? 1;
    switch (name) {
      case 'shot':
        this.tone({ freq: opts.charged ? 900 : 1300, endFreq: opts.charged ? 160 : 320, type: 'square', dur: opts.charged ? 0.22 : 0.09, vol: 0.08 * vol, pan });
        this.noise({ dur: 0.06, vol: 0.06 * vol, filter: 'highpass', freq: 1600, pan });
        break;
      case 'rail':
        this.tone({ freq: 2100, endFreq: 180, type: 'sawtooth', dur: 0.35, vol: 0.12 * vol, pan });
        this.noise({ dur: 0.25, vol: 0.1 * vol, filter: 'bandpass', freq: 3000, q: 2, pan });
        break;
      case 'bounce':
        this.tone({ freq: 1600 + (opts.n || 0) * 400 + Math.random() * 200, endFreq: 900, type: 'triangle', dur: 0.18, vol: 0.14 * vol, pan });
        this.noise({ dur: 0.05, vol: 0.04 * vol, filter: 'highpass', freq: 3000, pan });
        break;
      case 'hit':
        this.tone({ freq: 240, endFreq: 90, type: 'square', dur: 0.12, vol: 0.1 * vol, pan });
        this.noise({ dur: 0.14, vol: 0.14 * vol, filter: 'bandpass', freq: 1200, q: 0.8, pan });
        break;
      case 'explosion':
        this.noise({ dur: 0.9, vol: 0.45 * vol, filter: 'lowpass', freq: 900, endFreq: 80, pan });
        this.tone({ freq: 90, endFreq: 28, type: 'sine', dur: 0.7, vol: 0.5 * vol, pan });
        break;
      case 'shortCircuit':
        this.noise({ dur: 1.4, vol: 0.55 * vol, filter: 'lowpass', freq: 1800, endFreq: 60, pan });
        this.tone({ freq: 120, endFreq: 24, type: 'sine', dur: 1.1, vol: 0.55 * vol, pan });
        for (let i = 0; i < 5; i++) this.tone({ freq: 1200 + Math.random() * 2500, endFreq: 300, type: 'sawtooth', dur: 0.08, vol: 0.06, pan, delay: 0.1 + Math.random() * 0.5 });
        break;
      case 'dash':
        this.noise({ dur: 0.18, vol: 0.16 * vol, filter: 'bandpass', freq: 900, endFreq: 2600, q: 1.5, pan });
        break;
      case 'hook':
        this.noise({ dur: 0.12, vol: 0.1, filter: 'highpass', freq: 2500, pan });
        for (let i = 0; i < 3; i++) this.tone({ freq: 2000 - i * 300, endFreq: 1200, type: 'square', dur: 0.04, vol: 0.05, pan, delay: i * 0.055 });
        break;
      case 'shield':
        this.tone({ freq: 320, endFreq: 640, type: 'triangle', dur: 0.3, vol: 0.14 * vol, pan });
        this.tone({ freq: 480, endFreq: 960, type: 'sine', dur: 0.35, vol: 0.08 * vol, pan, delay: 0.02 });
        break;
      case 'shieldBounce':
        this.tone({ freq: 900, endFreq: 240, type: 'square', dur: 0.22, vol: 0.1 * vol, pan });
        break;
      case 'pickup':
        this.tone({ freq: 620, endFreq: 930, type: 'square', dur: 0.09, vol: 0.09 * vol, pan });
        this.tone({ freq: 930, endFreq: 1240, type: 'square', dur: 0.08, vol: 0.07 * vol, pan, delay: 0.08 });
        break;
      case 'itemUse':
        this.tone({ freq: 300, endFreq: 140, type: 'sine', dur: 0.3, vol: 0.12, pan });
        break;
      case 'cooling':
        this.noise({ dur: 0.9, vol: 0.13, filter: 'highpass', freq: 2500, pan });
        this.tone({ freq: 900, endFreq: 300, type: 'sine', dur: 0.9, vol: 0.05, pan });
        break;
      case 'tower':
        this.noise({ dur: 0.3, vol: 0.2, filter: 'bandpass', freq: 2600, q: 2, pan });
        this.tone({ freq: 220, endFreq: 60, type: 'sawtooth', dur: 0.2, vol: 0.12, pan });
        break;
      case 'claw':
        this.noise({ dur: 0.7, vol: 0.4, filter: 'lowpass', freq: 500, endFreq: 50, pan });
        this.tone({ freq: 70, endFreq: 30, type: 'square', dur: 0.5, vol: 0.3, pan });
        break;
      case 'clawWarn':
        this.tone({ freq: 180, endFreq: 180, type: 'sawtooth', dur: 0.5, vol: 0.08, pan });
        this.tone({ freq: 240, endFreq: 240, type: 'sawtooth', dur: 0.5, vol: 0.05, pan, delay: 0.1 });
        break;
      case 'ui':
        this.tone({ freq: 520, endFreq: 660, type: 'square', dur: 0.06, vol: 0.05, pan });
        break;
      case 'uiBack':
        this.tone({ freq: 420, endFreq: 260, type: 'square', dur: 0.08, vol: 0.05, pan });
        break;
      case 'countdown':
        this.tone({ freq: 440, endFreq: 440, type: 'square', dur: 0.18, vol: 0.13, pan });
        break;
      case 'start':
        this.tone({ freq: 880, endFreq: 880, type: 'square', dur: 0.5, vol: 0.13, pan });
        this.tone({ freq: 440, endFreq: 660, type: 'sawtooth', dur: 0.9, vol: 0.08, pan });
        this.noise({ dur: 1.0, vol: 0.15, filter: 'lowpass', freq: 1200, endFreq: 200, pan });
        break;
      case 'storm':
        this.noise({ dur: 2.0, vol: 0.3, filter: 'highpass', freq: 1200, endFreq: 400, pan });
        this.tone({ freq: 60, endFreq: 40, type: 'sawtooth', dur: 1.8, vol: 0.15, pan });
        break;
      case 'alarm':
        this.tone({ freq: 900, endFreq: 700, type: 'square', dur: 0.12, vol: 0.06, pan });
        break;
      case 'death':
        this.tone({ freq: 160, endFreq: 40, type: 'sawtooth', dur: 1.2, vol: 0.16, pan });
        break;
      case 'respawn':
        this.tone({ freq: 160, endFreq: 640, type: 'triangle', dur: 0.5, vol: 0.1, pan });
        break;
      case 'reload':
        this.noise({ dur: 0.08, vol: 0.05, filter: 'highpass', freq: 1400, pan });
        break;
      default: break;
    }
  }

  updateAlarm(active, dt) {
    if (!this.started || !this.enabled) return;
    if (active !== this.alarmOn) { this.alarmOn = active; this.alarmTimer = 0; }
    if (!active) return;
    this.alarmTimer -= dt;
    if (this.alarmTimer <= 0) {
      this.alarmTimer = 0.85;
      this.sfx('alarm');
    }
  }
}
