import re

p = 'src/audio.js'
s = open(p).read()

# ---------------------------------------------------------------- helpers
s = s.replace("""  init() {
    if (this.started) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();""",
"""  init() {
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
    this.ctx = new AC();""")

s = s.replace("""  resume() {
    if (!this.ctx) this.init();
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }""",
"""  resume() {
    try {
      if (!this.ctx) this.init();
      if (this.ctx && this.ctx.state === 'suspended') {
        const r = this.ctx.resume();
        if (r && typeof r.catch === 'function') r.catch(() => {});
      }
    } catch (err) {
      console.warn('[audio] resume failed:', err && err.message);
    }
  }""")

s = s.replace("""  setVolume(v) {
    if (!this.master) return;
    this.master.gain.value = v;
  }""",
"""  setVolume(v) {
    if (!this.master) return;
    try { this.master.gain.value = Math.max(0, Math.min(1, v)); } catch {}
  }""")

# ---------------------------------------------------------------- envelope / tone / noise
s = s.replace("""  envelope(node, gainNode, t0, a, d, peak = 0.5) {
    const g = gainNode.gain;
    g.cancelScheduledValues(t0);
    g.setValueAtTime(0.0001, t0);
    g.exponentialRampToValueAtTime(peak, t0 + a);
    g.exponentialRampToValueAtTime(0.0001, t0 + a + d);
    node.stop(t0 + a + d + 0.05);
  }""",
"""  envelope(node, gainNode, t0, a, d, peak = 0.5) {
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
  }""")

s = s.replace("""  tone({ freq = 440, endFreq = null, type = 'sine', dur = 0.2, vol = 0.3, pan = 0, attack = 0.005, delay = 0 }) {
    if (!this.started) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (endFreq) o.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), t0 + dur);
    const g = ctx.createGain();
    const out = this.panner(pan) || this.sfxGain;
    o.connect(g); g.connect(out);
    this.envelope(o, g, t0, attack, dur, vol);
    o.start(t0);
  }""",
"""  tone({ freq = 440, endFreq = null, type = 'sine', dur = 0.2, vol = 0.3, pan = 0, attack = 0.005, delay = 0 }) {
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
  }""")

s = s.replace("""  noise({ dur = 0.2, vol = 0.3, pan = 0, filter = 'lowpass', freq = 800, endFreq = null, q = 1, delay = 0, attack = 0.004 }) {
    if (!this.started) return;
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
    this.envelope(src, g, t0, attack, dur, vol);
    src.start(t0);
  }""",
"""  noise({ dur = 0.2, vol = 0.3, pan = 0, filter = 'lowpass', freq = 800, endFreq = null, q = 1, delay = 0, attack = 0.004 }) {
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
  }""")

# ---------------------------------------------------------------- sfx wrapper
s = s.replace("""  sfx(name, opts = {}) {
    if (!this.started || !this.enabled) return;
    const pan = opts.pan || 0;
    const vol = opts.volume ?? 1;
    switch (name) {""",
"""  sfx(name, opts = {}) {
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
    switch (name) {""")

# ---------------------------------------------------------------- ambience safety
s = s.replace("""    src.start(); lfo.start();""",
"""    this.startNode(src);
    this.startNode(lfo);""")
s = s.replace("""    o.start(now); o.stop(now + 1.3);
      setTimeout(creak, 6000 + Math.random() * 11000);""",
"""    this.startNode(o, now);
      this.scheduleStop(o, now + 1.3);
      setTimeout(creak, 6000 + Math.random() * 11000);""")
s = s.replace("""      o.connect(gain);
      o.start();""",
"""      o.connect(gain);
      this.startNode(o);""")
s = s.replace("""    lfo.connect(lg); lg.connect(gain.gain);
    lfo.start();""",
"""    lfo.connect(lg); lg.connect(gain.gain);
    this.startNode(lfo);""")

# startAmbience/startDrone themselves must be guarded (init already is, but be explicit)
s = s.replace("""  startAmbience() {
    const ctx = this.ctx;""",
"""  startAmbience() {
    try {
      this._startAmbience();
    } catch (err) {
      console.warn('[audio] ambience failed:', err && err.message);
    }
  }

  _startAmbience() {
    const ctx = this.ctx;
    if (!ctx) return;""")

s = s.replace("""  startDrone() {
    const ctx = this.ctx;""",
"""  startDrone() {
    try {
      this._startDrone();
    } catch (err) {
      console.warn('[audio] drone failed:', err && err.message);
    }
  }

  _startDrone() {
    const ctx = this.ctx;
    if (!ctx) return;""")

s = s.replace("""  updateAlarm(active, dt) {
    if (!this.started) return;""",
"""  updateAlarm(active, dt) {
    if (!this.started || !this.enabled) return;""")

# toggle() also needs to be safe
s = s.replace("""  stopAll() {
    if (this.ctx) { this.ctx.close(); this.ctx = null; this.started = false; }
  }""",
"""  stopAll() {
    try { if (this.ctx) this.ctx.close(); } catch {}
    this.ctx = null;
    this.started = false;
    this.master = null;
    this.sfxGain = null;
    this.ambGain = null;
  }""")

open(p, 'w').write(s)
print('audio hardened')

# ---------------------------------------------------------------- UI safety
p = 'src/ui.js'
s = open(p).read()
s = s.replace("""  click() { this.audio?.sfx('ui'); }""",
"""  // Sound must never be able to swallow a click: the action always runs.
  click() {
    try { this.audio?.sfx('ui'); } catch (err) { console.warn('[ui] click sfx failed', err); }
  }""")
s = s.replace("""    const tap = (id, fn) => { const el = $(id); if (el) el.onclick = () => { this.click(); fn && fn(); }; };""",
"""    const tap = (id, fn) => {
      const el = $(id);
      if (!el) return;
      el.onclick = (ev) => {
        try { this.click(); } catch (err) { console.warn('[ui] sfx failed', err); }
        try { fn && fn(ev); } catch (err) {
          console.error('[ui] handler failed for', id, err);
          this.toast('操作失败: ' + (err && err.message || id), 'err');
        }
      };
    };""")
open(p, 'w').write(s)
print('ui hardened')
