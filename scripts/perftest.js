// CPU-side frame budget test. Rendering itself needs a GPU, but everything the
// client does *around* the draw call (simulation bookkeeping, snapshot apply,
// HUD/minimap updates, FX spawning) runs here, so a regression shows up.
import { performance } from 'node:perf_hooks';
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

const ui = new UI({ audio: fakeAudio(), handlers: {} });
ui.applySettings({ volume: 0, quality: 'low', renderScale: 1, shake: true, hints: false });
ui.hideLoading();

// Stage stub: records quality calls so we can assert the adaptive ladder.
const stage = {
  quality: 'high',
  renderScale: 1,
  is3D: true,
  qualityCalls: [],
  setQuality(q, s) { this.quality = q; this.renderScale = s || 1; this.qualityCalls.push(q); },
  setActive() {},
  render() {},
  getStats() { return { calls: 120, triangles: 45000, points: 2600, geometries: 90, textures: 40, programs: 12, pixelRatio: 1, buffer: '1600×900', shadows: true, bloom: true, adapter: 'stub' }; },
};
const game = new Game({ stage, audio: fakeAudio(), ui, send: () => {} });

const arena = buildArena(40, 909);
const infos = Array.from({ length: 8 }, (_, i) => ({
  id: 'p' + (i + 1), name: 'BOT' + (i + 1), color: '#fff', colorId: 'orange',
  mech: ['assault', 'grappler', 'guardian', 'miner', 'sniper', 'furnace', 'sniper', 'guardian'][i], team: i,
}));
const settings = { mode: 'ffa', duration: 120, eventRate: 'high', heatRate: 'fast', difficulty: 'hard' };
const sim = new MatchSim({ arena, players: infos, settings, seed: 909 });
const summary = JSON.parse(JSON.stringify(arenaSummary(arena)));
game.start({ type: 'start', roomCode: 'PERF', arena: summary, settings, seed: 909, duration: 120, you: 'p1', players: infos, matchCount: 1 });

// ------------------------------------------------------------------ measure
const snapshots = [];
for (let i = 0; i < 60 * 40; i++) {
  sim.step(1 / 60);
  if (i % 3 === 0) snapshots.push(JSON.parse(JSON.stringify(sim.snapshot())));
}

let snapMs = 0;
let snaps = 0;
for (const snap of snapshots) {
  const t0 = performance.now();
  game.onSnapshot(snap, 'p1');
  snapMs += performance.now() - t0;
  snaps++;
}

let frameMs = 0;
let frames = 0;
let hudMs = 0;
let huds = 0;
let mmMs = 0;
let mms = 0;
const lastSnap = snapshots[snapshots.length - 1];
const self = lastSnap.players.find((p) => p.id === 'p1');
for (let i = 0; i < 1200; i++) {
  game.mouse.down = i % 30 < 12;
  game.keys.clear();
  game.keys.add(i % 2 ? 'd' : 'w');
  const t0 = performance.now();
  game.update(1 / 60);
  frameMs += performance.now() - t0;
  frames++;
  if (i % 20 === 0) {
    const t1 = performance.now();
    ui.updateHUD(JSON.parse(JSON.stringify(lastSnap)), self, { dt: 1 / 60 });
    hudMs += performance.now() - t1;
    huds++;
    const t2 = performance.now();
    ui.drawMinimap(lastSnap, 'p1', game.arena);
    mmMs += performance.now() - t2;
    mms++;
  }
}

const avg = (total, n) => total / Math.max(1, n);
const report = {
  'snapshot apply (ms)': +avg(snapMs, snaps).toFixed(3),
  'game.update (ms/frame)': +avg(frameMs, frames).toFixed(3),
  'ui.updateHUD (ms)': +avg(hudMs, huds).toFixed(3),
  'drawMinimap (ms)': +avg(mmMs, mms).toFixed(3),
  frames, snaps,
};
console.log(report);

// The browser budget for all client work at 60 fps is 16.6 ms; the CPU side
// should stay far below that so the GPU has room.
ok(report['game.update (ms/frame)'] < 4, 'game.update stays under 4 ms/frame', `${report['game.update (ms/frame)']} ms`);
ok(report['snapshot apply (ms)'] < 2.5, 'snapshot apply stays under 2.5 ms', `${report['snapshot apply (ms)']} ms`);
ok(report['ui.updateHUD (ms)'] < 2, 'HUD update stays under 2 ms', `${report['ui.updateHUD (ms)']} ms`);
ok(report['drawMinimap (ms)'] < 1.2, 'minimap redraw stays under 1.2 ms (cached base layer)', `${report['drawMinimap (ms)']} ms`);

// ------------------------------------------------------------------ adaptive ladder
game.fps = 28;
game.ui.settings.quality = 'high';
game.lowFpsTime = 0;
const before = stage.qualityCalls.length;
for (let i = 0; i < 40; i++) {
  game.fpsAcc = 1;
  game.fpsFrames = 30;
  game.update(0.05);
}
const ladder = stage.qualityCalls.slice(before);
ok(ladder[0] === 'med', 'low FPS steps high → med first', ladder.join('→'));
game.ui.settings.quality = 'med';
game.lowFpsTime = 0;
game.lowFpsTime = 0;
for (let i = 0; i < 60; i++) {
  game.fpsAcc = 1;
  game.fpsFrames = 28;
  game.update(0.05);
}
ok(game.ui.settings.quality === 'low', 'sustained low FPS steps med → low', game.ui.settings.quality);
ok(stage.qualityCalls.length > before, 'stage received the new preset', stage.qualityCalls.join('→'));

game.applyQuality('low', 0.7);
ok(stage.renderScale === 0.7, 'render scale is forwarded to the stage', String(stage.renderScale));
ok(['high', 'med', 'low'].includes(document.body.dataset.quality), 'body exposes the quality preset for CSS', document.body.dataset.quality);
ok(game.minimapInterval > 0.1, 'low preset throttles the minimap', `${game.minimapInterval}s`);
game.applyQuality('high', 1);
ok(stage.renderScale === 1 && stage.quality === 'high', 'quality can be raised again from settings');

console.log(errors.length ? 'CONSOLE ERRORS:\n' + errors.join('\n') : 'no console errors');
const pass = failures === 0 && errors.length === 0;
console.log(pass ? 'PERF TEST OK' : `PERF TEST FAILED (${failures})`);
process.exit(pass ? 0 : 1);
