// How smooth does a remote (bot) mech look on the client?
//
// A client that interpolates remote players deliberately draws them slightly in
// the past, so "position error versus the live server" is not the question. The
// questions are:
//
//   1. does the mech move every frame at the speed it really had, or does it
//      freeze for a packet and then jump?  (frozen / jump frames)
//   2. is the drawn path a smooth copy of the real one?  (position error at the
//      client's own render delay)
//
// The server is simulated at a fixed 60 Hz; the client renders at FPS with
// optional hitches. Ground truth is kept as a dense timeline so the reference
// is exact at any render rate.
//
// Usage: node scripts/botmotion.js
//        LAT=120 JITTER=40 FPS=30 HITCH=1 WATCH=p3 SCAN=1 node scripts/botmotion.js
import { setupDOM, fakeAudio } from './domsetup.js';

setupDOM();
const { UI } = await import('../src/ui.js');
const { Game } = await import('../src/game.js');
const { buildArena, arenaSummary } = await import('../shared/arena.js');
const { MatchSim } = await import('../server/sim.js');

const LAT = Number(process.env.LAT || 30) / 1000;      // one-way latency
const JIT = Number(process.env.JITTER || 10) / 1000;   // arrival jitter
const FPS = Number(process.env.FPS || 60);             // client render rate
const HITCH = process.env.HITCH === '1';               // 150 ms freeze every 40 frames
const WATCH = process.env.WATCH || 'p2';
const SECONDS = Number(process.env.SECONDS || 20);

let clock = 0; // simulated seconds; also drives performance.now()
performance.now = () => clock * 1000;

const ui = new UI({ audio: fakeAudio(), handlers: {} });
ui.applySettings({ volume: 0, quality: 'low', renderScale: 1, maxFps: 60, shake: false, hints: false });
ui.hideLoading();
const stage = {
  is3D: true, quality: 'low', renderScale: 1,
  setQuality() {}, setActive() {}, render() {}, getStats() { return {}; },
};

const sent = [];
const game = new Game({ stage, audio: fakeAudio(), ui, send: (m) => { if (m.type === 'input') sent.push({ ...m, at: clock }); } });
const arena = buildArena(30, 991);
const infos = [
  { id: 'p1', name: 'ME', color: '#59d8ff', colorId: 'cyan', mech: 'assault', team: 0 },
  { id: 'p2', name: 'B1', color: '#ff5b4a', colorId: 'red', mech: 'guardian', team: 1, bot: true },
  { id: 'p3', name: 'B2', color: '#ffd24a', colorId: 'amber', mech: 'sniper', team: 0, bot: true },
  { id: 'p4', name: 'B3', color: '#a06bff', colorId: 'violet', mech: 'miner', team: 1, bot: true },
];
const settings = { mode: 'ffa', duration: 300, eventRate: 'low', heatRate: 'slow', difficulty: 'normal' };
const sim = new MatchSim({ arena, players: infos, settings, seed: 991 });
game.start({
  type: 'start', roomCode: 'BOT', arena: JSON.parse(JSON.stringify(arenaSummary(arena))),
  settings, seed: 991, duration: 300, you: 'p1', players: infos,
  spawns: sim.spawnState(), matchCount: 1,
});

const SIM_DT = 1 / 60;
const RENDER_DT = 1 / FPS;
const snaps = [];
let nextSnap = 0;
for (let i = 0; i < 240; i++) { sim.step(SIM_DT); clock += SIM_DT; } // countdown

// --- ground truth: one entry per server step, plus the values the bot had --
const truth = [];
const truthOf = (t) => {
  // binary search the dense timeline, then lerp
  let lo = 0, hi = truth.length - 1;
  if (!truth.length) return null;
  if (t <= truth[0].t) return truth[0];
  if (t >= truth[hi].t) return truth[hi];
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (truth[mid].t <= t) lo = mid; else hi = mid;
  }
  const a = truth[lo], b = truth[hi];
  const f = b.t > a.t ? (t - a.t) / (b.t - a.t) : 0;
  return { x: a.x + (b.x - a.x) * f, z: a.z + (b.z - a.z) * f, speed: a.speed + (b.speed - a.speed) * f, alive: a.alive, dash: a.dash };
};

const renders = []; // { clock, dt, x, z }
let lastHitch = -99;
let liveStart = null;
let simAcc = 0;
for (let i = 0; i < Math.round(SECONDS * FPS); i++) {
  const hitchFrame = HITCH && i % 40 === 20;
  const frameDt = hitchFrame ? 0.15 : RENDER_DT;
  if (hitchFrame) lastHitch = clock;
  clock += frameDt;
  game.update(frameDt);
  simAcc += frameDt;
  while (simAcc >= SIM_DT) { sim.step(SIM_DT); simAcc -= SIM_DT; }
  if (clock >= nextSnap) {
    nextSnap = clock + 0.05;
    snaps.push({ at: clock, snap: JSON.parse(JSON.stringify(sim.snapshot())) });
  }
  while (snaps.length) {
    const s = snaps[0];
    if (clock < s.at + LAT + Math.random() * JIT) break;
    game.onSnapshot(s.snap, 'p1');
    snaps.shift();
  }
  for (let k = sent.length - 1; k >= 0; k--) {
    const it = sent[k];
    if (clock >= it.at + LAT) { sim.applyInput('p1', it); sent.splice(k, 1); }
  }

  const sp = sim.players.get(WATCH);
  if (sp) {
    truth.push({
      t: sim.t, x: sp.x, z: sp.z, alive: sp.alive,
      speed: Math.hypot(sp.vx, sp.vz), dash: (sp.dashUntil || 0) > sim.t,
    });
  }

  const cv = game.players.get(WATCH);
  if (!cv || !cv.data) continue;
  if (sim.phase !== 'live') continue;
  if (liveStart === null) liveStart = sim.t;
  // the first moment of the match is a placement cut by design
  if (sim.t - liveStart < 1.5) continue;
  // the frames right after a stall are a recovery, judge them separately
  renders.push({
    clock, dt: frameDt, x: cv.x, z: cv.z, alive: sp.alive,
    rc: game.remoteClock, delay: game.interpDelay,
    recovering: clock - lastHitch < 0.5,
  });
}

const settle = renders.filter((r) => !r.recovering);
console.log(`frames after a stall: ${renders.length - settle.length} (excluded from the checks)`);

// --- what render delay is the client running at? ----------------------------
const delays = [];
for (let d = 0; d <= 0.4; d += 0.008) {
  let sum = 0, n = 0;
  for (const r of settle) {
    const g = truthOf(r.clock - d);
    if (!g || !g.alive || r.alive === false) continue;
    sum += Math.hypot(r.x - g.x, r.z - g.z);
    n++;
  }
  delays.push({ d, err: sum / (n || 1) });
}
let bestDelay = delays[0];
for (const l of delays) if (l.err < bestDelay.err) bestDelay = l;
if (process.env.SCAN) {
  console.log('delay scan:', delays.filter((_, i) => i % 4 === 0).map((l) => `${Math.round(l.d * 1000)}ms:${l.err.toFixed(3)}`).join('  '));
}

// --- frame by frame ---------------------------------------------------------
let frozen = 0;
let jumps = 0;
let measured = 0;
let moving = 0;
let backward = 0;
let worstBack = 0;
const errs = [];
const relSpeeds = [];  // rendered speed / true speed, while moving steadily
let prev = null;
for (const r of settle) {
  const g = truthOf(r.clock - bestDelay.d);
  const gPrev = truthOf(prev ? prev.clock - bestDelay.d : 0);
  if (!g || !prev || !gPrev) { prev = r; continue; }
  if (!g.alive || !prev.alive || r.alive === false) { prev = r; continue; }
  if (r.dt <= 0) { prev = r; continue; }
  const cStep = Math.hypot(r.x - prev.x, r.z - prev.z);
  const tStep = Math.hypot(g.x - gPrev.x, g.z - gPrev.z);
  if (tStep > 1) { prev = r; continue; }        // server teleport / respawn hop
  measured++;
  errs.push(Math.hypot(r.x - g.x, r.z - g.z));
  if (tStep > 0.02) {
    moving++;
    if (cStep < tStep * 0.25) frozen++;
    if (cStep > tStep * 2) jumps++;
    relSpeeds.push(cStep / tStep);
    // backwards: rendered motion opposing the direction of travel
    const ux = (g.x - gPrev.x) / (tStep || 1);
    const uz = (g.z - gPrev.z) / (tStep || 1);
    const along = (r.x - prev.x) * ux + (r.z - prev.z) * uz;
    if (along < -0.02) { backward++; worstBack = Math.min(worstBack, along); }
  }
  prev = r;
}

const stats = (arr) => {
  const n = arr.length || 1;
  const mean = arr.reduce((a, b) => a + b, 0) / n;
  const varr = arr.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
  const sorted = [...arr].sort((a, b) => a - b);
  const q = (p) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] || 0;
  return {
    mean: +mean.toFixed(3), sd: +Math.sqrt(varr).toFixed(3),
    cv: +(Math.sqrt(varr) / (mean || 1)).toFixed(2),
    p95: +q(0.95).toFixed(3), max: +(sorted[sorted.length - 1] || 0).toFixed(3),
  };
};

// --- the client's own render clock: exact check -----------------------------
let clockErrSum = 0;
let clockErrN = 0;
let maxClockErr = 0;
let lagSum = 0;
if (renders.length && renders[0].rc !== undefined) {
  for (const r of renders) {
    if (r.recovering) continue;
    const g = truthOf(r.rc);
    if (!g || !g.alive || r.alive === false) continue;
    const e = Math.hypot(r.x - g.x, r.z - g.z);
    clockErrSum += e; clockErrN++;
    maxClockErr = Math.max(maxClockErr, e);
    lagSum += r.clock - r.rc;
    if (process.env.DBG && e > 0.3) {
      const ahead = r.rc - g.t;
      console.log('BIG', r.clock.toFixed(2), 'e', e.toFixed(2), 'rc', r.rc.toFixed(2), 'truthT', g.t.toFixed(2),
        'ahead', ahead.toFixed(3), 'delay', r.delay.toFixed(3), 'dash', g.dash ? 1 : 0, 'speed', g.speed.toFixed(1));
    }
  }
}
const es = stats(errs);
const rs = stats(relSpeeds);
// how much the rendered speed wobbles while the bot is clearly walking
const movers = relSpeeds.filter((v) => v > 0.5 && v < 1.6);
const wobble = movers.length ? stats(movers).sd : 0;

const result = {
  watch: WATCH,
  network: `${LAT * 1000}ms one-way, jitter ${JIT * 1000}ms`,
  render: `${FPS} fps${HITCH ? ' + 150ms hitch/40f' : ''}`,
  renderDelayMs: Math.round(bestDelay.d * 1000),
  clockLagMs: Math.round((lagSum / Math.max(1, clockErrN)) * 1000),
  errorVsRenderClock: { mean: +(clockErrSum / Math.max(1, clockErrN)).toFixed(3), max: +maxClockErr.toFixed(3) },
  frames: measured,
  movingFrames: moving,
  positionError: { mean: es.mean, p95: es.p95, max: es.max },
  motion: {
    frozen, frozenPct: +((frozen / Math.max(1, moving)) * 100).toFixed(1),
    jumps, jumpsPct: +((jumps / Math.max(1, moving)) * 100).toFixed(1),
    backwardFrames: backward, worstBackStep: +worstBack.toFixed(3),
    speedRatio: +rs.mean.toFixed(2), speedWobble: +wobble.toFixed(2),
  },
};
console.log(result);
if (clockErrN) console.log(`fidelity vs render clock: ${(clockErrSum / clockErrN).toFixed(3)} m (max ${maxClockErr.toFixed(3)})`);

// a render frame is a sample of a moving target: allow half a frame of motion
// at typical mech speed (~8 m/s) on top of a fixed tolerance
// When the client exposes its render clock, the honest smoothness check is the
// error against the truth *at that clock*. Otherwise (the old implementation)
// fall back to the best-fit constant delay.
const tol = 0.06 + 3 * RENDER_DT;
const fidelity = clockErrN ? clockErrSum / clockErrN : Infinity;
const maxTol = HITCH ? 1.2 : 0.6;
const pass = (clockErrN ? fidelity < 0.06 && maxClockErr < maxTol : es.p95 < tol)
  && frozen <= moving * 0.01 + 2
  && jumps <= moving * 0.02 + 2
  && backward <= 2
  && worstBack > -0.05
  && rs.mean > 0.9 && rs.mean < 1.1;
console.log(pass ? 'BOT MOTION OK' : 'BOT MOTION FAILED');
process.exit(pass ? 0 : 1);
