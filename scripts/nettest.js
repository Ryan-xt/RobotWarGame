// Reproduces "moved, then got yanked back": a networked match with latency
// driving the real Game class.
//
// Metric: while the mech is genuinely moving (server speed > 2 m/s, so walls
// are excluded), count frames where the rendered position moves *opposite* to
// the travel direction by more than 2 cm. That is what rubber-banding looks
// like on screen.
//
// Usage: node scripts/nettest.js        LAT=120 HOLD=circle node scripts/nettest.js
import { setupDOM, fakeAudio, trackConsoleErrors } from './domsetup.js';

setupDOM();
const errors = trackConsoleErrors();

const { UI } = await import('../src/ui.js');
const { Game } = await import('../src/game.js');
const { buildArena, arenaSummary } = await import('../shared/arena.js');
const { MatchSim } = await import('../server/sim.js');

let failures = 0;
const ok = (cond, label, extra = '') => {
  if (!cond) { failures++; console.log('  ✗', label, extra); } else console.log('  ✓', label, extra);
};

const LATENCY = Number(process.env.LAT || 70) / 1000;
const JITTER = Number(process.env.JITTER || 20) / 1000;
const PATTERN = process.env.HOLD || 'circle';
// FIRE=1 holds the trigger: heat slows the mech down, which the client only
// learns from (stale) snapshots — a good stress test for the replay.
const FIRE = process.env.FIRE === '1';

const ui = new UI({ audio: fakeAudio(), handlers: {} });
ui.applySettings({ volume: 0, quality: 'low', renderScale: 1, maxFps: 60, shake: false, hints: false });
ui.hideLoading();

const stage = {
  is3D: true, quality: 'low', renderScale: 1,
  setQuality() {}, setActive() {}, render() {},
  getStats() { return {}; },
};

const game = new Game({ stage, audio: fakeAudio(), ui, send: (m) => { if (m.type === 'input') pendingInputs.push({ ...m, at: clock }); } });

const arena = buildArena(40, 4711);
const infos = [
  { id: 'p1', name: 'ME', color: '#59d8ff', colorId: 'cyan', mech: 'assault', team: 0 },
  { id: 'p2', name: 'D', color: '#ff5b4a', colorId: 'red', mech: 'guardian', team: 1 },
];
const settings = { mode: 'ffa', duration: 180, eventRate: 'low', heatRate: 'slow', difficulty: 'easy' };
const sim = new MatchSim({ arena, players: infos, settings, seed: 4711 });
game.start({
  type: 'start', roomCode: 'NET', arena: JSON.parse(JSON.stringify(arenaSummary(arena))),
  settings, seed: 4711, duration: 180, you: 'p1', players: infos,
  spawns: sim.spawnState(), matchCount: 1,
});

// --- fake network ------------------------------------------------------------
let clock = 0;
const DT = 1 / 60;
const pendingInputs = [];
const pendingSnaps = [];
let nextSnapAt = 0;

function deliver() {
  for (let i = pendingInputs.length - 1; i >= 0; i--) {
    const it = pendingInputs[i];
    if (clock >= it.at + LATENCY) {
      sim.applyInput('p1', { mx: it.mx, mz: it.mz, aim: it.aim, fire: it.fire, dash: it.dash, skill: it.skill, useItem: it.useItem, seq: it.seq });
      pendingInputs.splice(i, 1);
    }
  }
  // TCP keeps order: the head of the queue is delivered first, and jitter only
  // bunches the arrivals up. Delivering out of order would not happen live.
  while (pendingSnaps.length) {
    const s = pendingSnaps[0];
    if (clock < s.at + LATENCY + Math.random() * JITTER) break;
    game.onSnapshot(s.snap, 'p1');
    pendingSnaps.shift();
  }
}

for (let i = 0; i < 60 * 4; i++) { sim.step(DT); clock += DT; }  // countdown

// --- roam --------------------------------------------------------------------
// The bot pattern keeps the mech circling inside the arena instead of grinding
// into a wall, which would make any offset decay look like rubber-banding.
game.keys.clear();
if (FIRE) game.mouse.down = true;
let prev = null;
let backwards = 0;
let worstBack = 0;
let worstAt = 0;
let frames = 0;
let movingFrames = 0;
let travel = 0;
let srvTravel = 0;
let maxOff = 0;
let maxOffAt = 0;
const cliDashes = [];
const srvDashes = [];
let prevCliDash = false;
let prevSrvDash = false;
let offFrames = 0;
let prevSrv = null;
const backSamples = [];

function setDir(dx, dz) {
  game.keys.clear();
  if (dx > 0.3) game.keys.add('d');
  if (dx < -0.3) game.keys.add('a');
  if (dz > 0.3) game.keys.add('s');
  if (dz < -0.3) game.keys.add('w');
}

for (let i = 0; i < 60 * 20; i++) {
  clock += DT;

  // steer in a slow circle so we keep roaming (occasionally dashed)
  if (PATTERN === 'circle') {
    const a = i * 0.012;
    setDir(Math.cos(a), Math.sin(a));
  } else {
    setDir(PATTERN === 'd' ? 1 : PATTERN === 'a' ? -1 : 0, PATTERN === 's' ? 1 : PATTERN === 'w' ? -1 : 0);
  }
  if (i % 150 === 0) game.pending.dash = true;

  game.update(DT);
  sim.step(DT);
  if (clock >= nextSnapAt) {
    nextSnapAt = clock + 0.05;
    pendingSnaps.push({ at: clock, snap: JSON.parse(JSON.stringify(sim.snapshot())) });
  }
  deliver();

  const v = game.selfVisual;
  const p1 = sim.players.get('p1');
  if (!v) break;
  // ignore the first 1.5 s: the countdown -> live transition is a hard cut by
  // design (spawn placement), so measuring it would be meaningless
  if (clock > 5.5) {
    const cliDash = game.time < game.localDash.until;
  if (cliDash && !prevCliDash) {
    cliDashes.push({ t: clock, dx: game.localDash.dx, dz: game.localDash.dz });
  }
  prevCliDash = cliDash;
  const srvDash = p1.dashUntil > sim.t;
  if (srvDash && !prevSrvDash) {
    srvDashes.push({ t: clock, dx: p1.dashDirX, dz: p1.dashDirZ });
  }
  prevSrvDash = srvDash;

  const offLen = Math.hypot(game.visOff.x, game.visOff.z);
    if (offLen > maxOff) { maxOff = offLen; maxOffAt = +clock.toFixed(2); }
    if (offLen > 0.25) offFrames++;
  }
  if (prevSrv) srvTravel += Math.hypot(p1.x - prevSrv.x, p1.z - prevSrv.z);
  prevSrv = { x: p1.x, z: p1.z };
  const pos = { x: v.x, z: v.z };
  const serverSpeed = Math.hypot(p1.vx, p1.vz);
  if (prev) {
    frames++;
    const dx = pos.x - prev.x;
    const dz = pos.z - prev.z;
    const step = Math.hypot(dx, dz);
    travel += step;
    // direction of travel according to the server, not the keys
    const sx = p1.vx, sz = p1.vz;
    const sl = Math.hypot(sx, sz);
    // the countdown -> live transition is a hard cut by design (spawn), so the
    // first 1.5 s are excluded
    if (sl > 2 && serverSpeed > 2 && clock > 5.5) {
      movingFrames++;
      const along = (dx * sx + dz * sz) / sl;
      if (along < -0.02) {
        backwards++;
        if (along < worstBack) { worstBack = along; worstAt = +clock.toFixed(2); }
        if (backSamples.length < 6) backSamples.push({ t: +clock.toFixed(2), along: +along.toFixed(3) });
      }
    }
  }
  prev = pos;
}

const p1 = sim.players.get('p1');
const v = game.selfVisual;
const err = Math.hypot(p1.x - v.predicted.x, p1.z - v.predicted.z);
console.log({
  latency: `${LATENCY * 1000}ms one-way, jitter ${JITTER * 1000}ms`,
  pattern: PATTERN,
  firing: FIRE,
  frames, movingFrames, backwards,
  worstBackStep: +worstBack.toFixed(3),
  worstAt,
  travel: +travel.toFixed(1),
  predictionError: +err.toFixed(3),
  maxVisualOffset: +maxOff.toFixed(3),
  maxOffsetAt: maxOffAt,
  offsetFrames: offFrames,
  clientDashes: cliDashes.length,
  serverDashes: srvDashes.length,
  clientTravel: +travel.toFixed(1),
  serverTravel: +srvTravel.toFixed(1),
  samples: backSamples,
});

ok(frames > 900, 'measurement ran', String(frames));
ok(movingFrames > 500, 'the mech was actually moving', String(movingFrames));
ok(backwards <= Math.max(3, Math.round(movingFrames * 0.01)),
  'rubber-band frames stay under 1% of moving frames', `${backwards} / ${movingFrames}`);
ok(Math.abs(worstBack) < 0.05, 'worst backwards step stays under 5 cm', `${worstBack.toFixed(3)} m`);
ok(travel > (PATTERN === 'circle' ? 30 : 1), 'the mech actually travelled', `${travel.toFixed(1)} m`);
ok(Math.abs(travel - srvTravel) < Math.max(2, srvTravel * 0.03),
  'rendered distance matches the server', `${travel.toFixed(1)} vs ${srvTravel.toFixed(1)} m`);
// the offset is a trailing gap, not a yank: keep it sane, and rely on the
// frame-by-frame checks above for what the player actually sees
ok(maxOff < 3, 'the correction never runs away', `${maxOff.toFixed(2)} m`);
ok(offFrames < frames * 0.25, 'corrections are rare', `${offFrames} frames > 25 cm`);

// dashes must be predicted locally: same count as the server, same direction
ok(cliDashes.length >= 5 && srvDashes.length >= 5, 'dashes were exercised',
  `${cliDashes.length} client / ${srvDashes.length} server`);
let dashMisses = 0;
for (const c of cliDashes) {
  const match = srvDashes.find((d) => Math.abs(d.t - c.t) < 0.45 && d.dx * c.dx + d.dz * c.dz > 0.5);
  if (!match) dashMisses++;
}
ok(dashMisses === 0, 'every predicted dash matches a server dash', `${dashMisses} misses`);

// prediction must converge: stop input and let the two sides settle
game.keys.clear();
for (let i = 0; i < 90; i++) {
  clock += DT;
  game.update(DT);
  sim.step(DT);
  deliver();
}
const settled = Math.hypot(sim.players.get('p1').x - game.selfVisual.predicted.x,
  sim.players.get('p1').z - game.selfVisual.predicted.z);
ok(settled < 0.35, 'prediction converges after standing still', `${settled.toFixed(3)} m`);

// and while idle, the leftover offset must not yank the mech around
let idleWorst = 0;
let prevIdle = { x: game.selfVisual.x, z: game.selfVisual.z };
for (let i = 0; i < 45; i++) {
  clock += DT;
  game.update(DT);
  sim.step(DT);
  deliver();
  const cur = { x: game.selfVisual.x, z: game.selfVisual.z };
  idleWorst = Math.max(idleWorst, Math.hypot(cur.x - prevIdle.x, cur.z - prevIdle.z));
  prevIdle = cur;
}
ok(idleWorst < 0.03, 'standing still is rock solid', `${idleWorst.toFixed(3)} m / frame`);

console.log(errors.length ? 'CONSOLE ERRORS:\n' + errors.join('\n') : 'no console errors');
const pass = failures === 0 && errors.length === 0;
console.log(pass ? 'NET TEST OK' : `NET TEST FAILED (${failures})`);
process.exit(pass ? 0 : 1);
