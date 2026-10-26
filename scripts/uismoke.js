// Headless smoke test for the DOM UI layer (no WebGL / no real browser).
// Usage: npm i --no-save linkedom && node scripts/uismoke.js
import { setupDOM, fakeAudio, trackConsoleErrors } from './domsetup.js';

setupDOM();
const errors = trackConsoleErrors();

const { UI } = await import('../src/ui.js');
const audio = fakeAudio();
const ui = new UI({ audio, handlers: {} });

// profile + menu
ui.applyProfile({ name: '测试机', colorId: 'cyan', mech: 'sniper' });
ui.applySettings({ volume: 55, quality: 'med', shake: false, hints: true });
ui.setConnection('online', '主机在线');
ui.hideLoading();
ui.setMechanic('miner', true);

// rooms + lobby
ui.setRooms([{ code: 'AB12', players: 3, bots: 1, max: 8, mode: 'ffa', status: 'lobby', mapSize: 30, settings: { mode: 'ffa', bots: 3, mapSize: 'auto', eventRate: 'med', heatRate: 'standard', difficulty: 'normal' } }]);
const room = {
  code: 'AB12', status: 'lobby', host: 'c1',
  settings: { mode: 'ffa', bots: 3, mapSize: 'auto', eventRate: 'med', heatRate: 'standard', difficulty: 'normal', duration: 180 },
  players: [{ clientId: 'c1', name: '房主', color: '#ffb02e', mech: 'assault', ready: true, isHost: true, bot: false }],
};
ui.showLobby(room, 'c1');
ui.addChat({ name: '房主', color: '#ffb02e', text: '准备好了吗' });
ui.addChat({ text: 'AI 已加入', sys: true });

// build a real arena + snapshot from the server sim
const { buildArena } = await import('../shared/arena.js');
const { MatchSim } = await import('../server/sim.js');
const arena = buildArena(30, 4242);
const infos = [
  { id: 'p1', name: '测试机', color: '#59d8ff', colorId: 'cyan', mech: 'sniper', team: 0, bot: false },
  { id: 'p2', name: '敌人', color: '#ff5b4a', colorId: 'red', mech: 'assault', team: 1, bot: true },
];
const sim = new MatchSim({ arena, players: infos, settings: { duration: 180, mode: 'ffa', eventRate: 'med', heatRate: 'standard', difficulty: 'normal' }, seed: 4242 });
for (let i = 0; i < 240; i++) {
  sim.applyInput('p1', { mx: 0.5, mz: 0.2, aim: 0.3, fire: i % 30 < 8, dash: i === 90, skill: i === 120, useItem: false });
  sim.step(1 / 60);
}
let snap = JSON.parse(JSON.stringify(sim.snapshot()));
// inject some fake states for the HUD paths that need them
snap.event = { type: 'sandstorm', name: '沙暴', desc: '能见度下降', icon: 'storm', until: 12 };
snap.sandstorm = 12;
snap.storm = true;
snap.phase = 'live';
snap.countdown = 0;
snap.players[1] && (snap.players[1].heat = 100);
const you = snap.players[0].id;
const startInfo = { you, players: infos, settings: { mode: 'ffa', duration: 180, bots: 3 }, duration: 180, roomCode: 'AB12', matchCount: 1 };

ui.beginMatch(startInfo, arena);
const self = snap.players.find((p) => p.id === you);
for (let i = 0; i < 5; i++) ui.updateHUD(snap, self, { dt: 1 / 60 });
ui.setPing(42); ui.setFps(58);
ui.setCrosshair(700, 400, { charging: true, charge: 0.6, heat: 74 });
ui.hitmarker(); ui.float(700, 400, '+15', 'heat'); ui.killfeed({ a: '测试机', b: '敌人', w: 'sniper', heat: 100 });
ui.toggleScoreboard(true);
const mm = document.getElementById('minimap');
ui.drawMinimap(snap, you, arena);
ui.toggleScoreboard(false);
ui.setKiller({ name: '敌人', color: '#ff5b4a', heat: 100 }, { x: 0, z: 0 });
ui.updateHUD({ ...snap, players: snap.players.map((p) => (p.id === you ? { ...p, alive: 0, respawn: 7 } : p)) }, { ...self, alive: 0, respawn: 7 }, { dt: 0.016 });
ui.showDisconnect(true, '重连中');
ui.showDisconnect(false);
ui.toast('测试提示', 'ok');
ui.showError('测试错误');

// results
const result = {
  board: [
    { id: 'p1', name: '测试机', color: '#59d8ff', colorId: 'cyan', mech: 'sniper', score: 3, kills: 2, deaths: 1, bounceHits: 4, bot: false },
    { id: 'p2', name: '敌人', color: '#ff5b4a', colorId: 'red', mech: 'assault', score: 1, kills: 1, deaths: 2, bounceHits: 1, bot: true },
  ],
  teams: null,
  awards: {
    shortCircuit: { name: '敌人', color: '#ff5b4a', mech: 'assault', value: 2 },
    bounceKing: { name: '测试机', color: '#59d8ff', mech: 'sniper', value: 4 },
    clawed: null, coolerCamper: null, demoArtist: null,
    hotShot: { name: '测试机', color: '#59d8ff', mech: 'sniper', value: 340 },
  },
  duration: 182.4, arenaSize: 30, mode: 'ffa', seed: 4242,
};
ui.showResults(result, 'p1', { ...room, status: 'results' }, true);
ui.setSandstorm(false); ui.setStorm(false); ui.toggleTutorial(false);

// verify key text actually rendered
const checks = [
  ['#hud-mech-name', (el) => el.textContent.length > 0],
  ['#hud-mode', (el) => el.textContent.length > 0],
  ['#lobby-code', (el) => el.textContent === 'AB12'],
  ['#result-table', (el) => el.innerHTML.includes('测试机')],
  ['#killfeed', (el) => el.innerHTML.length > 0],
  ['#scoreboard-body', (el) => el.innerHTML.length > 0],
];
let bad = 0;
for (const [sel, ok] of checks) {
  const el = document.querySelector(sel);
  const pass = !!el && ok(el);
  if (!pass) { bad++; console.log('FAIL', sel); }
}
console.log(errors.length ? 'CONSOLE ERRORS:\n' + errors.join('\n') : 'no console errors');
console.log(bad === 0 ? 'UI SMOKE OK' : `UI SMOKE FAILED (${bad})`);
process.exit(bad === 0 && errors.length === 0 ? 0 : 1);
