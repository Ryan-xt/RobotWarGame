// Do bullets move smoothly on the client?
//
// A bolt flies at 18 m/s (27 charged) but the server only sends its position
// 20 times per second, so a naive client shows it in ~0.9 m hops. This probe
// drives the real Game against the real MatchSim with latency, tracks every
// rendered bolt frame by frame and compares the distance it moved on screen
// with the distance it really travelled.
//
// Usage: node scripts/bulletmotion.js
//        LAT=120 JITTER=40 node scripts/bulletmotion.js
import { setupDOM, fakeAudio } from './domsetup.js';

setupDOM();
const { UI } = await import('../src/ui.js');
const { Game } = await import('../src/game.js');
const { buildArena, arenaSummary } = await import('../shared/arena.js');
const { MatchSim } = await import('../server/sim.js');

const LAT = Number(process.env.LAT || 30) / 1000;
const JIT = Number(process.env.JITTER || 10) / 1000;
const FPS = Number(process.env.FPS || 60);
const SECONDS = Number(process.env.SECONDS || 18);

let clock = 0;
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
const arena = buildArena(30, 4711);
const infos = [
  { id: 'p1', name: 'ME', color: '#59d8ff', colorId: 'cyan', mech: 'assault', team: 0 },
  { id: 'p2', name: 'B1', color: '#ff5b4a', colorId: 'red', mech: 'sniper', team: 1, bot: true },
  { id: 'p3', name: 'B2', color: '#ffd24a', colorId: 'amber', mech: 'assault', team: 0, bot: true },
  { id: 'p4', name: 'B3', color: '#a06bff', colorId: 'violet', mech: 'guardian', team: 1, bot: true },
];
const settings = { mode: 'ffa', duration: 300, eventRate: 'low', heatRate: 'slow', difficulty: 'hard' };
const sim = new MatchSim({ arena, players: infos, settings, seed: 4711 });
game.start({
  type: 'start', roomCode: 'BUL', arena: JSON.parse(JSON.stringify(arenaSummary(arena))),
  settings, seed: 4711, duration: 300, you: 'p1', players: infos,
  spawns: sim.spawnState(), matchCount: 1,
});

const SIM_DT = 1 / 60;
const RENDER_DT = 1 / FPS;
const snaps = [];
let nextSnap = 0;
for (let i = 0; i < 240; i++) { sim.step(SIM_DT); clock += SIM_DT; }

// per bullet id: last rendered position + the truth at its render time
const track = new Map();
const steps = [];      // rendered distance per frame
const ratios = [];     // rendered distance / real distance over the same gap
let frozen = 0;
let jumps = 0;
let measured = 0;
let bulletsSeen = 0;

let simAcc = 0;
for (let i = 0; i < Math.round(SECONDS * FPS); i++) {
  clock += RENDER_DT;
  game.update(RENDER_DT);
  simAcc += RENDER_DT;
  // the server always runs at a fixed 60 Hz, whatever the client renders at
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

  for (const [id, mesh] of game.bullets) {
    const prev = track.get(id);
    // the first frame a bolt is observed is not a render step: the mesh was
    // created from the snapshot and is drawn from the next update on
    const pos = { x: mesh.x, z: mesh.z, clock, fresh: !prev };
    if (prev && !prev.fresh) {
      const rStep = Math.hypot(pos.x - prev.x, pos.z - prev.z);
      // what the bolt really did in the same wall-clock gap (straight flight)
      const speed = Math.hypot(mesh.vx, mesh.vz) || 18;
      const expect = speed * (pos.clock - prev.clock);
      steps.push(rStep);
      if (expect > 0.05) {
        measured++;
        ratios.push(rStep / expect);
        if (rStep < expect * 0.4) {
          frozen++;
          if (process.env.DBG && frozen <= 6) {
            const sm = mesh.samples;
            console.log('FROZEN', id, 'r', rStep.toFixed(3), 'exp', expect.toFixed(3), 'samples', sm.length,
              'rt-last', (game.remoteClock - sm[sm.length - 1].t).toFixed(3),
              'rt-first', (game.remoteClock - sm[0].t).toFixed(3), 'v', Math.hypot(mesh.vx, mesh.vz).toFixed(1), 'gone', !!mesh.gone);
          }
        }
        if (rStep > expect * 2.2) {
          jumps++;
          if (process.env.DBG && jumps <= 6) {
            const sm = mesh.samples;
            const last = sm[sm.length - 1];
            console.log('JUMP', id, 'r', rStep.toFixed(2), 'exp', expect.toFixed(2), 'n', sm.length,
              'rt-last', (game.remoteClock - last.t).toFixed(3), 'v', Math.hypot(mesh.vx, mesh.vz).toFixed(1),
              'gone', !!mesh.gone, 'pos', mesh.x.toFixed(1), mesh.z.toFixed(1));
          }
        }
      }
    }
    track.set(id, pos);
    bulletsSeen++;
  }
  const live = new Set(game.bullets.keys());
  for (const id of [...track.keys()]) if (!live.has(id)) track.delete(id);
}

const stats = (arr) => {
  const n = arr.length || 1;
  const mean = arr.reduce((a, b) => a + b, 0) / n;
  const varr = arr.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
  const sorted = [...arr].sort((a, b) => a - b);
  return {
    mean: +mean.toFixed(3), sd: +Math.sqrt(varr).toFixed(3),
    p05: +sorted[Math.floor(sorted.length * 0.05)].toFixed(2),
    p95: +sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))].toFixed(2),
    max: +sorted[sorted.length - 1].toFixed(2),
  };
};

const rs = stats(ratios);
const result = {
  network: `${LAT * 1000}ms one-way, jitter ${JIT * 1000}ms`,
  fps: FPS,
  framesWithBullets: bulletsSeen,
  measured,
  frozenFrames: frozen,
  jumpFrames: jumps,
  frozenPct: +((frozen / Math.max(1, measured)) * 100).toFixed(2),
  jumpPct: +((jumps / Math.max(1, measured)) * 100).toFixed(2),
  stepRatio: rs,
};
console.log(result);

const pass = measured > 200
  && frozen <= measured * 0.02
  && jumps <= measured * 0.02
  && rs.mean > 0.85 && rs.mean < 1.15;
console.log(pass ? 'BULLET MOTION OK' : 'BULLET MOTION FAILED');
process.exit(pass ? 0 : 1);
