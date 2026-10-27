// Verifies the Canvas2D fallback renderer used when WebGL is unavailable.
// Usage: npm i --no-save linkedom && node scripts/stage2dtest.js
import { setupDOM, fakeAudio, trackConsoleErrors } from './domsetup.js';

const { document } = setupDOM();
const errors = trackConsoleErrors();

let draws = 0;
const canvasEl = document.getElementById('stage');
const realGetContext = canvasEl.getContext.bind(canvasEl);
canvasEl.getContext = function (type, ...rest) {
  const ctx = realGetContext(type, ...rest);
  if (!ctx) return ctx;
  return new Proxy(ctx, {
    get(t, k) {
      const v = t[k];
      if (typeof v === 'function') {
        return (...args) => {
          draws++;
          return v.apply(t, args);
        };
      }
      return v;
    },
    set(t, k, v) { t[k] = v; return true; },
  });
};

const { Stage2D } = await import('../src/stage2d.js');
const { Game } = await import('../src/game.js');
const { UI } = await import('../src/ui.js');
const { buildArena } = await import('../shared/arena.js');
const { MatchSim } = await import('../server/sim.js');

let failures = 0;
const ok = (cond, label, extra = '') => {
  if (!cond) { failures++; console.log('  ✗', label, extra); } else console.log('  ✓', label, extra);
};

const stage = new Stage2D(canvasEl);
ok(stage.is3D === false, 'Stage2D reports non-3D mode');
ok(canvasEl.width > 0 && canvasEl.height > 0, 'canvas sized');

// ---------------------------------------------------------------- menu draw
let view = 'menu';
stage.attach({ getMode: () => view, getProfile: () => ({ mech: 'sniper', color: '#59d8ff' }) });
const beforeMenu = draws;
for (let i = 0; i < 30; i++) stage.render(1 / 60);
ok(draws - beforeMenu > 200, 'menu draws procedurally', `${draws - beforeMenu} calls`);

// ------------------------------------------------------------------ game draw
const ui = new UI({ audio: fakeAudio(), handlers: {} });
ui.applySettings({ volume: 0, quality: 'low', shake: true, hints: false });
ui.hideLoading();
const game = new Game({ stage, audio: fakeAudio(), ui, send: () => {} });

const arena = buildArena(30, 31337);
const infos = [
  { id: 'p1', name: '我', color: '#59d8ff', colorId: 'cyan', mech: 'sniper', team: 0 },
  { id: 'p2', name: '敌人', color: '#ff5b4a', colorId: 'red', mech: 'assault', team: 1 },
  { id: 'p3', name: 'BOT', color: '#7bd66b', colorId: 'green', mech: 'miner', team: 1, bot: true },
];
const settings = { mode: 'ffa', duration: 90, bots: 2, eventRate: 'high', heatRate: 'fast', difficulty: 'hard' };
const sim = new MatchSim({ arena, players: infos, settings, seed: 31337 });
game.start({
  type: 'start', roomCode: '2D', arena: JSON.parse(JSON.stringify(arena)), settings,
  seed: 31337, duration: 90, you: 'p1', players: infos, matchCount: 1,
});
stage.attach({ game });
view = 'game';

let drawn = 0;
for (let i = 0; i < 60 * 20; i++) {
  sim.applyInput('p1', {
    mx: Math.sin(i / 40), mz: Math.cos(i / 55), aim: (i / 30) % 6.28,
    fire: i % 20 < 10, dash: i % 120 === 5, skill: i % 190 === 7, useItem: i % 300 === 11, seq: i,
  });
  sim.step(1 / 60);
  if (i % 3 === 0) {
    const snap = JSON.parse(JSON.stringify(sim.snapshot()));
    game.onSnapshot(snap, 'p1');
  }
  game.mouse.x = 800 + Math.sin(i / 30) * 200;
  game.mouse.y = 450 + Math.cos(i / 40) * 120;
  game.mouse.down = i % 20 < 10;
  const before = draws;
  stage.render(1 / 60);
  game.update(1 / 60);
  if (draws > before) drawn++;
}
ok(drawn > 60 * 18, 'game frames are painted', `${drawn} frames`);
ok(game.snap && game.snap.players.length === 3, 'renderer reads live snapshot state');
ok(stage.cam.x !== 0 || stage.cam.z !== 0, 'camera follows the local mech', `${stage.cam.x.toFixed(1)},${stage.cam.z.toFixed(1)}`);

// events that must not crash the 2D path
for (const fx of [
  { type: 'storm' }, { type: 'leak' },
]) {
  const snap = JSON.parse(JSON.stringify(sim.snapshot()));
  snap.zones.push({ id: 9001, type: fx.type, x: 2, z: 3, r: 4, until: 5 });
  snap.markers.push({ id: 9002, x: -3, z: 1, r: 2, in: 1 });
  snap.airdrop = { x: 4, z: -4 };
  snap.dynamicPlates.push({ id: 9003, x: 1, z: 1, r: 1.15, hp: 3, angle: 0.5, ttl: 4 });
  game.onSnapshot(snap, 'p1');
  stage.render(1 / 60);
}
ok(true, 'storm/leak/marker/airdrop/plate overlays render without throwing');

// the new 48 × 48 giant map must draw in the 2D fallback too
{
  const giant = buildArena(48, 20251026);
  const sim3 = new MatchSim({
    arena: giant, players: infos, seed: 20251026,
    settings: { ...settings, mapSize: 48 },
  });
  game.start({
    type: 'start', roomCode: 'GIANT2D', arena: JSON.parse(JSON.stringify(giant)),
    settings: { ...settings, mapSize: 48 }, seed: 20251026, duration: 90, you: 'p1',
    players: infos, matchCount: 1,
  });
  const before = draws;
  for (let i = 0; i < 60 * 4; i++) {
    sim3.applyInput('p1', { mx: 1, mz: 0, aim: 0.4, fire: true, seq: i });
    sim3.step(1 / 60);
    if (i % 3 === 0) game.onSnapshot(JSON.parse(JSON.stringify(sim3.snapshot())), 'p1');
    stage.render(1 / 60);
    game.update(1 / 60);
  }
  ok(draws - before > 60 * 3, 'the 48m giant map renders in 2D', `${draws - before} frames`);
  ok(document.getElementById('minimap-size').textContent === '48m', 'HUD labels the giant map');
}

game.disposeWorld();
view = 'menu';
for (let i = 0; i < 5; i++) stage.render(1 / 60);
ok(true, 'returns to the menu renderer after disposal');

console.log(errors.length ? 'CONSOLE ERRORS:\n' + errors.join('\n') : 'no console errors');
const pass = failures === 0 && errors.length === 0;
console.log(pass ? '2D STAGE OK' : `2D STAGE FAILED (${failures})`);
process.exit(pass ? 0 : 1);
