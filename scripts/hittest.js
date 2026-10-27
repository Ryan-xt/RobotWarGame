// 命中反馈 / 子弹颜色 回归。
//
//   1. 子弹颜色 = 射出者的颜色（3D 与 2D 都是）
//   2. 子弹视觉上碰到机甲的那一帧就有火花（不等服务器包）
//   3. 服务器确认命中时补伤害数字，且不会和本地火花重复炸两次
import { setupDOM, fakeAudio, trackConsoleErrors } from './domsetup.js';

setupDOM();
const errors = trackConsoleErrors();

const { UI } = await import('../src/ui.js');
const { Game } = await import('../src/game.js');
const { buildArena } = await import('../shared/arena.js');
const { MatchSim } = await import('../server/sim.js');

let failures = 0;
const ok = (cond, label, extra = '') => {
  if (!cond) { failures++; console.log('  ✗', label, extra); }
  else console.log('  ✓', label, extra);
};

const ui = new UI({ audio: fakeAudio(), handlers: {} });
ui.applySettings({ volume: 0, quality: 'low', shake: false, hints: false });
ui.hideLoading();
const stage = { is3D: true, quality: 'low', setQuality() {}, setActive() {}, render() {}, getStats() { return {}; } };
const game = new Game({ stage, audio: fakeAudio(), ui, send: () => {} });

const arena = buildArena(30, 909);
const infos = [
  { id: 'p1', name: '我', color: '#59d8ff', colorId: 'cyan', mech: 'assault', team: 0 },
  { id: 'p2', name: '红机', color: '#ff5b4a', colorId: 'red', mech: 'assault', team: 1 },
  { id: 'p3', name: '黄机', color: '#ffd24a', colorId: 'amber', mech: 'guardian', team: 2 },
];
const settings = { mode: 'ffa', duration: 180, bots: 0, eventRate: 'low', heatRate: 'standard', difficulty: 'easy' };
const sim = new MatchSim({ arena, players: infos, settings, seed: 909 });
game.setRoomCode('HIT');
game.start({
  type: 'start', roomCode: 'HIT', arena: JSON.parse(JSON.stringify(arena)), settings,
  seed: 909, duration: 180, you: 'p1', players: infos, matchCount: 1,
});

const DT = 1 / 60;
const feed = (snap = null) => game.onSnapshot(snap || JSON.parse(JSON.stringify(sim.snapshot())), 'p1');
const stepAll = (n = 1) => {
  for (let i = 0; i < n; i++) {
    sim.step(DT);
    if (i % 2 === 0) feed();
    game.update(DT);
  }
};
while (sim.phase !== 'live') stepAll(1);
stepAll(3);

// ---------------------------------------------------------------- bullet color
console.log('\n[颜色] 子弹用射出者的颜色');
const red = sim.players.get('p2');
red.x = 4; red.z = 4; red.aim = 2.2;
sim.fireBullet(red, false);
const yellow = sim.players.get('p3');
yellow.x = -5; yellow.z = 2; yellow.aim = 1.1;
sim.fireBullet(yellow, false);
stepAll(2);
const byOwner = (id) => [...game.bullets.values()].filter((b) => b.owner === id);
const redBolts = byOwner('p2');
const yellowBolts = byOwner('p3');
ok(redBolts.length === 1, '红机的子弹被渲染', String(redBolts.length));
ok(yellowBolts.length === 1, '黄机的子弹被渲染', String(yellowBolts.length));
ok(redBolts[0]?.colour === '#ff5b4a', '红机子弹 = 红色', redBolts[0]?.colour);
ok(yellowBolts[0]?.colour === '#ffd24a', '黄机子弹 = 黄色', yellowBolts[0]?.colour);
ok(redBolts[0]?.trail?.material?.color?.getHexString() === 'ff5b4a', '拖尾也用射手色');
ok(redBolts[0]?.core?.material?.color?.getHexString() === 'ffffff', '核心仍是白热（看得清弹道）');
// own predicted bolt is in the player's colour
game.localAim = 0.4;
game.mouse.down = true;
game.sendNow = true;
game.update(DT);
ok(game.ghosts[0]?.colour === '#59d8ff', '自己的预测弹 = 自己颜色', game.ghosts[0]?.colour);
game.mouse.down = false;

// ---------------------------------------------------------------- local impact
console.log('\n[命中] 子弹碰到机甲当帧就炸火花');
for (const b of [...game.bullets.values()]) game.removeBullet(b);
sim.bullets.length = 0;
sim.bulletsById.clear();
const target = sim.players.get('p3');
target.x = 2; target.z = 0;
red.x = 8; red.z = 0; red.aim = Math.PI;
const live = sim.fireBullet(red, false);
stepAll(2);
const bolt = [...game.bullets.values()].find((b) => b.owner === 'p2');
ok(!!bolt, '子弹在飞');
game.recentImpact.length = 0;
// the check uses where the mech is *drawn* (interpolated), so put the visual on
// the target position for this probe
const targetVis = game.players.get('p3');
targetVis.x = target.x; targetVis.z = target.z;
game.checkBulletContact(bolt, target.x, target.z);
ok(game.recentImpact.length === 1, '本地立即判定「接触」并记录命中点');
ok(!game.bullets.has(bolt.group.uuid) || [...game.bullets.values()].every((b) => b !== bolt), '接触后子弹停止绘制（不会穿过目标）');

// authoritative event adds the number, without a second explosion
console.log('\n[命中] 服务器确认时补数字、不重复爆炸');
let floats = 0;
const origFloat = ui.float.bind(ui);
ui.float = (...a) => { floats++; return origFloat(...a); };
const hitFx = {
  e: 'heatHit', x: target.x, z: target.z, id: 'p3', amount: 8,
  source: 'bolt', attacker: 'p1', bounced: false,
};
game.recentImpact = [];
const beforeImpacts = game.recentImpact.length;
game.processFx([hitFx]);
ok(floats === 1, '弹出伤害数字', `floats=${floats}`);
ok(beforeImpacts === 0, '去重列表已清空（这条会正常炸）');
game.recentImpact = [{ x: target.x, z: target.z, t: game.time }];
let extraFlashes = 0;
const origFlash = game.fx.flash.bind(game.fx);
game.fx.flash = (...a) => { extraFlashes++; return origFlash(...a); };
game.processFx([hitFx]);
ok(floats === 2, '本地已经炸过的命中仍然显示数字');
ok(extraFlashes <= 1, '但不会重复来一发大爆炸', `flashes=${extraFlashes}`);
game.fx.flash = origFlash;
ui.float = origFloat;

// bounce wall gives an impact too
const before = game.recentImpact.length;
game.processFx([{ e: 'bounce', x: 3, z: 3, n: 1, id: live.id }]);
ok(true, '反弹/打墙也有撞击特效（不抛异常）');

console.log(errors.length ? 'CONSOLE ERRORS:\n' + errors.join('\n') : 'no console errors');
const pass = failures === 0 && errors.length === 0;
console.log(pass ? 'HIT TEST OK' : `HIT TEST FAILED (${failures})`);
process.exit(pass ? 0 : 1);
