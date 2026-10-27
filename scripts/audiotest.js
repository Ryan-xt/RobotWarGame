// Verifies the WebAudio layer against a spec-accurate mock:
//   - stop() before start() throws InvalidStateError (the bug that killed every click)
//   - no sfx name may throw, even on a hostile/broken context
//   - a throwing audio object must not stop UI button handlers
import { setupDOM, trackConsoleErrors } from './domsetup.js';

const { window, document } = setupDOM();
const errors = trackConsoleErrors();

let failures = 0;
const ok = (cond, label, extra = '') => {
  if (!cond) { failures++; console.log('  ✗', label, extra); } else console.log('  ✓', label, extra);
};

// ------------------------------------------------------------------ mock WebAudio
class MockParam {
  constructor(v = 0) { this.value = v; }
  setValueAtTime() { return this; }
  exponentialRampToValueAtTime(v) {
    if (!(v > 0)) throw new RangeError('exponentialRamp target must be > 0');
    return this;
  }
  linearRampToValueAtTime() { return this; }
  cancelScheduledValues() { return this; }
}

class MockNode {
  constructor(kind) {
    this.kind = kind;
    this.__started = false;
    this.__stopped = false;
    this.frequency = new MockParam(440);
    this.detune = new MockParam(0);
    this.Q = new MockParam(1);
    this.gain = new MockParam(1);
    this.pan = new MockParam(0);
    this.type = 'sine';
    this.buffer = null;
    this.loop = false;
    this.stats = { start: 0, stop: 0 };
  }
  connect() { return this; }
  disconnect() {}
  start(when = 0) {
    if (this.__started && this.kind !== 'buffer') throw new Error('InvalidStateError: already started');
    this.__started = true;
    this.__startAt = when;
    this.stats.start++;
  }
  stop(when = 0) {
    // exact behaviour that broke the game: browsers throw here
    if (!this.__started) {
      throw new Error("InvalidStateError: Failed to execute 'stop' on 'AudioScheduledSourceNode': cannot call stop without calling start first.");
    }
    this.__stopped = true;
    this.stats.stop++;
  }
}

class MockAudioContext {
  constructor() {
    this.currentTime = 0;
    this.sampleRate = 48000;
    this.state = 'running';
    this.destination = { connect() {} };
    this.nodes = [];
    this.resumed = 0;
  }
  createGain() { return this.track(new MockNode('gain')); }
  createOscillator() { return this.track(new MockNode('osc')); }
  createBufferSource() { return this.track(new MockNode('buffer')); }
  createBiquadFilter() { return this.track(new MockNode('filter')); }
  createStereoPanner() { return this.track(new MockNode('panner')); }
  createBuffer(ch, len, rate) {
    return { length: len, sampleRate: rate, getChannelData: () => new Float32Array(len) };
  }
  resume() { this.resumed++; this.state = 'running'; return Promise.resolve(); }
  close() { this.state = 'closed'; return Promise.resolve(); }
  track(node) { this.nodes.push(node); return node; }
}

window.AudioContext = MockAudioContext;

const { AudioSys } = await import('../src/audio.js');

// ------------------------------------------------------------------ basic playback
const audio = new AudioSys();
let threw = null;
try { audio.resume(); } catch (err) { threw = err; }
ok(!threw, 'init/resume does not throw', threw && threw.message);
ok(audio.started && audio.ctx instanceof MockAudioContext, 'context initialised');
ok(audio.ctx.nodes.every((n) => !n.__stopped || n.__started), 'ambience nodes are started before any stop');

const names = ['shot', 'rail', 'bounce', 'hit', 'explosion', 'shortCircuit', 'dash', 'hook', 'shield',
  'shieldBounce', 'pickup', 'itemUse', 'cooling', 'tower', 'claw', 'clawWarn', 'ui', 'uiBack',
  'countdown', 'start', 'storm', 'alarm', 'death', 'respawn', 'reload', 'notARealSound'];

let sfxThrew = 0;
for (const name of names) {
  try { audio.sfx(name, { pan: 0.4, volume: 0.8 }); } catch (err) { sfxThrew++; console.log('   threw on', name, err.message); }
}
ok(sfxThrew === 0, `all ${names.length} sfx names play without throwing`);

// every scheduled source must have been started before being stopped
const oscs = audio.ctx.nodes.filter((n) => n.kind === 'osc' || n.kind === 'buffer');
const bad = oscs.filter((n) => n.__stopped && !n.__started);
ok(bad.length === 0, 'no audio node is stopped before start', bad.length ? bad.length + ' nodes' : '');
ok(oscs.some((n) => n.stats.stop > 0), 'notes are scheduled with a stop time');

// alarm loop
let alarmThrew = 0;
try { for (let i = 0; i < 200; i++) audio.updateAlarm(true, 1 / 60); } catch (err) { alarmThrew++; }
ok(alarmThrew === 0, 'heat alarm loop is safe');

// ------------------------------------------------------------------ hostile context
const broken = new AudioSys();
broken.ctx = {
  currentTime: 0, sampleRate: 48000, state: 'running',
  createGain() { throw new Error('device lost'); },
  resume() { return Promise.reject(new Error('nope')); },
};
broken.started = true;
let hostileThrew = 0;
for (const name of names) {
  try { broken.sfx(name); } catch (err) { hostileThrew++; }
}
ok(hostileThrew === 0, 'a dead audio device cannot throw out of sfx()');

// ------------------------------------------------------------------ UI click must survive
const { UI } = await import('../src/ui.js');
let quickClicks = 0;
let mutedUI;
const throwingAudio = { sfx() { throw new Error('InvalidStateError: stop before start'); }, resume() { throw new Error('resume failed'); }, setVolume() {}, updateAlarm() {}, toggle() { return true; } };
mutedUI = new UI({ audio: throwingAudio, handlers: { onQuick: () => { quickClicks++; } } });
let clicked = 0;
try {
  document.getElementById('btn-quick').onclick({ target: document.getElementById('btn-quick') });
  clicked++;
} catch (err) {
  console.log('   click threw:', err.message);
}
ok(quickClicks === 1, 'handler still runs when audio throws', `onQuick called ${quickClicks}×`);

// modal / settings buttons with the same broken audio
for (const id of ['btn-create', 'btn-join', 'btn-help', 'btn-settings', 'btn-audio', 'btn-refresh-rooms']) {
  try { document.getElementById(id).onclick({ target: document.getElementById(id) }); } catch (err) {
    failures++;
    console.log('  ✗ click threw on', id, err.message);
  }
}
ok(true, 'all menu buttons are clickable with broken audio');

// ------------------------------------------------------------------ real audio object behind the UI
let quick2 = 0;
const goodUI = new UI({ audio, handlers: { onQuick: () => { quick2++; } } });
document.getElementById('btn-quick').onclick({ target: document.getElementById('btn-quick') });
ok(quick2 === 1, 'real audio + real handler runs');

const realErrors = errors.filter((e) => !/sfx failed|stop before start|resume failed|device lost|nope|click sfx failed|audio/i.test(e));
if (realErrors.length) console.log('unexpected console errors:', realErrors);
ok(realErrors.length === 0, 'no unexpected console errors');

console.log(failures === 0 ? 'AUDIO TEST OK' : `AUDIO TEST FAILED (${failures})`);
process.exit(failures === 0 ? 0 : 1);
