// Headless smoke test for the three.js game layer with a stubbed renderer.
// Usage: npm i --no-save linkedom && node scripts/gamesmoke.js
import { setupDOM, fakeAudio, trackConsoleErrors } from './domsetup.js';

setupDOM();
const errors = trackConsoleErrors();

const { UI } = await import('../src/ui.js');
const { Game } = await import('../src/game.js');
const { buildArena } = await import('../shared/arena.js');
const { MatchSim } = await import('../server/sim.js');

const ui = new UI({ audio: fakeAudio(), handlers: {} });
ui.applyProfile({ name: '测试机', colorId: 'cyan', mech: 'sniper' });
ui.applySettings({ volume: 0, quality: 'low', shake: true, hints: false });
ui.hideLoading();

const stage = {
  quality: 'low',
  active: null,
  setQuality() {},
  getStats() { return { calls: 10, triangles: 100, points: 10, geometries: 1, textures: 1, programs: 1, pixelRatio: 1, buffer: '1×1', shadows: false, bloom: false }; },
  setActive(scene, camera) { this.active = { scene, camera }; },
  render() {},
};
const sent = [];
const game = new Game({ stage, audio: fakeAudio(), ui, send: (m) => sent.push(m) });

const seed = 777;
const arena = buildArena(20, seed);
const infos = [
  { id: 'p1', name: '测试机', color: '#59d8ff', colorId: 'cyan', mech: 'assault', team: 0 },
  { id: 'p2', name: '铁皮狗', color: '#ff5b4a', colorId: 'red', mech: 'sniper', team: 1 },
  { id: 'p3', name: '冷却液大亨', color: '#7bd66b', colorId: 'green', mech: 'guardian', team: 2 },
];
const settings = { mode: 'ffa', duration: 60, bots: 2, eventRate: 'high', heatRate: 'fast', difficulty: 'hard' };
const sim = new MatchSim({ arena, players: infos, settings, seed });
const startInfo = {
  type: 'start', roomCode: 'TEST', arena: JSON.parse(JSON.stringify(arena)), settings,
  seed, duration: 60, you: 'p1', players: infos, matchCount: 1,
};
game.setRoomCode('TEST');
game.start(startInfo);

let frames = 0, snaps = 0;
const myId = 'p1';
let lastSnap = null;
for (let i = 0; i < 900; i++) {
  const t = i / 60;
  const input = {
    mx: Math.sin(t * 0.9), mz: Math.cos(t * 0.7), aim: (t * 0.8) % (Math.PI * 2),
    fire: i % 50 < 22, dash: i === 200, skill: i === 260, useItem: i % 300 === 150,
    seq: i,
  };
  if (i < 20) { input.mx = 1; input.mz = 0; }
  sim.applyInput(myId, input);
  // mirror into local input state so prediction/aim paths run
  game.keys.clear();
  if (input.mx > 0.25) game.keys.add('d');
  if (input.mx < -0.25) game.keys.add('a');
  if (input.mz > 0.25) game.keys.add('s');
  if (input.mz < -0.25) game.keys.add('w');
  game.mouse.down = input.fire;
  game.mouse.x = 900 + Math.sin(t) * 300;
  game.mouse.y = 420 + Math.cos(t * 1.3) * 160;
  game.update(1 / 60);
  frames++;
  if (i % 3 === 0 && sim.phase !== 'over') {
    sim.step(1 / 60);
    if (sim.phase !== 'over') {
      const snap = JSON.parse(JSON.stringify(sim.snapshot()));
      lastSnap = snap;
      game.onSnapshot(snap, myId);
      snaps++;
    }
  } else if (sim.phase !== 'over') {
    sim.step(1 / 60);
  }
  if (sim.phase === 'over') break;
}
// force through the remaining phases quickly
for (let i = 0; i < 200 && sim.phase !== 'over'; i++) {
  sim.applyInput(myId, { mx: 0, mz: 0, aim: 0, fire: true, seq: 1000 + i });
  sim.step(1 / 60);
  if (i % 3 === 0) { const snap = JSON.parse(JSON.stringify(sim.snapshot())); game.onSnapshot(snap, myId); }
}

const count = {
  frames, snaps,
  players: game.players.size,
  bullets: game.bullets.size,
  items: game.items.size,
  mines: game.mines.size,
  grenades: game.grenades.size,
  zones: game.zones.size,
  fxParticles: game.fx.sparks.count,
  sceneChildren: game.scene.children.length,
  camY: +game.camera.position.y.toFixed(2),
  sentInputs: sent.filter((m) => m.type === 'input').length,
  selfX: +(game.selfVisual?.x || 0).toFixed(2),
  selfZ: +(game.selfVisual?.z || 0).toFixed(2),
  heat: game.selfData?.heat,
  hudTime: document.getElementById('hud-time').textContent,
  minimap: game.ui.lastSnapshot ? 'drawn' : 'none',
};
console.log(count);

const checks = {
  'frames ran': frames > 100,
  'snapshots applied': snaps > 50,
  'players visualised': game.players.size === 3,
  'local input sent': count.sentInputs > 5,
  'self moved': Math.hypot(count.selfX, count.selfZ) > 0.2,
  'hud updated': /^\d+:\d\d$/.test(count.hudTime),
  'minimap drawn': count.minimap === 'drawn',
  'scene populated': count.sceneChildren > 20,
};
if (sim.phase !== 'over') sim.endMatch();
game.finish(sim.result, { code: 'TEST', host: 'c1' }, true);
checks['results shown'] = !document.getElementById('screen-results').classList.contains('hidden');
game.disposeWorld();
checks['world disposed'] = game.scene === null;

// ---------------------------------------------------------------- long ffa
const arena2 = buildArena(40, 999);
const infos2 = Array.from({ length: 8 }, (_, i) => ({
  id: 'b' + (i + 1), name: 'BOT' + (i + 1), color: '#fff', colorId: 'orange',
  mech: ['assault', 'grappler', 'guardian', 'miner', 'sniper', 'furnace', 'assault', 'sniper'][i], team: i,
}));
const settings2 = { mode: 'ffa', duration: 80, bots: 8, eventRate: 'high', heatRate: 'fast', difficulty: 'hard' };
const sim2 = new MatchSim({ arena: arena2, players: infos2, settings: settings2, seed: 999 });
game.start({
  type: 'start', roomCode: 'LONG', arena: JSON.parse(JSON.stringify(arena2)), settings: settings2,
  seed: 999, duration: 80, you: 'b1', players: infos2, matchCount: 1,
});
const peak = { mines: 0, grenades: 0, zones: 0, markers: 0, airdrop: 0, items: 0, maxHeat: 0, scoreboard: 0 };
let longSnaps = 0;
for (let i = 0; i < 60 * 85 && sim2.phase !== 'over'; i++) {
  sim2.step(1 / 60);
  if (i % 3 === 0) {
    const snap = JSON.parse(JSON.stringify(sim2.snapshot()));
    game.onSnapshot(snap, 'b1');
    longSnaps++;
    peak.maxHeat = Math.max(peak.maxHeat, ...snap.players.map((p) => p.heat));
    if (snap.airdrop) peak.airdrop++;
    if (i % 300 === 0) {
      game.ui.toggleScoreboard(true);
      peak.scoreboard = Math.max(peak.scoreboard, document.getElementById('scoreboard-body').innerHTML.length);
      game.ui.toggleScoreboard(false);
    }
  }
  if (i % 6 === 0) game.update(1 / 60);
  peak.mines = Math.max(peak.mines, game.mines.size);
  peak.grenades = Math.max(peak.grenades, game.grenades.size);
  peak.zones = Math.max(peak.zones, game.zones.size);
  peak.markers = Math.max(peak.markers, game.markers.size);
  peak.items = Math.max(peak.items, game.items.size);
}
console.log('long match', longSnaps, 'snapshots', peak);
checks['8-player match ran'] = longSnaps > 500;
checks['mines/grenades/zones rendered'] = peak.mines + peak.grenades + peak.zones > 0;
checks['event markers rendered'] = peak.markers > 0;
checks['airdrop visual appears'] = peak.airdrop > 0;
checks['scoreboard populated'] = peak.scoreboard > 100;
checks['heat reaches short circuit'] = peak.maxHeat >= 85;
if (sim2.phase !== 'over') sim2.endMatch();
game.finish(sim2.result, { code: 'LONG', host: 'c1' }, true);
checks['long match results shown'] = !document.getElementById('screen-results').classList.contains('hidden');
game.disposeWorld();
checks['long world disposed'] = game.scene === null;


let bad = 0;
for (const [k, v] of Object.entries(checks)) if (!v) { bad++; console.log('FAIL', k); }
console.log(errors.length ? 'CONSOLE ERRORS:\n' + errors.join('\n') : 'no console errors');
console.log(bad === 0 && errors.length === 0 ? 'GAME SMOKE OK' : 'GAME SMOKE FAILED');
process.exit(bad === 0 && errors.length === 0 ? 0 : 1);
