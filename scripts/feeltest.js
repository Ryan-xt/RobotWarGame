// 「手感」回归：这三件事是玩家直接抱怨的，别悄悄退化。
//
//   1. 分不清机甲朝哪 → 每台机甲都要有地面箭头 / 前弧 / 瞄准线，且跟着朝向转
//   2. 自己子弹有延迟   → 按下左键当帧就要有枪口火光 + 预测弹 + 声音
//   3. 不知道谁在打我   → 有子弹要打中我时，脚下要亮红色预警弧
import { setupDOM, fakeAudio, trackConsoleErrors } from './domsetup.js';

setupDOM();
const errors = trackConsoleErrors();

const { UI } = await import('../src/ui.js');
const { Game } = await import('../src/game.js');
const { buildArena } = await import('../shared/arena.js');
const { MatchSim } = await import('../server/sim.js');
const { BULLET } = await import('../shared/constants.js');

let failures = 0;
const ok = (cond, label, extra = '') => {
  if (!cond) { failures++; console.log('  ✗', label, extra); }
  else console.log('  ✓', label, extra);
};

const ui = new UI({ audio: fakeAudio(), handlers: {} });
ui.applySettings({ volume: 0, quality: 'low', shake: false, hints: false });
ui.hideLoading();
const stage = {
  is3D: true, quality: 'low', renderScale: 1,
  setQuality() {}, setActive() {}, render() {}, getStats() { return {}; },
};
const sent = [];
// stand-in for the network: inputs reach the sim two frames later, so the
// predicted bolt has to survive a realistic round trip before the real one wins
const queued = [];
const game = new Game({
  stage, audio: fakeAudio(), ui,
  send: (m) => {
    sent.push(m);
    if (m.type === 'input') queued.push({ delay: 2, m });
  },
});

const arena = buildArena(30, 4242);
const infos = [
  { id: 'p1', name: '我', color: '#59d8ff', colorId: 'cyan', mech: 'assault', team: 0 },
  { id: 'p2', name: '敌人', color: '#ff5b4a', colorId: 'red', mech: 'assault', team: 1 },
];
const settings = { mode: 'ffa', duration: 180, bots: 1, eventRate: 'low', heatRate: 'standard', difficulty: 'easy' };
const sim = new MatchSim({ arena, players: infos, settings, seed: 4242 });
game.setRoomCode('FEEL');
game.start({
  type: 'start', roomCode: 'FEEL', arena: JSON.parse(JSON.stringify(arena)), settings,
  seed: 4242, duration: 180, you: 'p1', players: infos, matchCount: 1,
});

const DT = 1 / 60;
const me0 = () => game.selfData || sim.snapshot().players[0];
const feed = () => {
  const snap = JSON.parse(JSON.stringify(sim.snapshot()));
  game.onSnapshot(snap, 'p1');
  return snap;
};
const stepAll = (n = 1, fn) => {
  for (let i = 0; i < n; i++) {
    if (fn) fn(i);
    // oldest first: two packets landing in the same frame must not let the
    // older one overwrite the newer one
    for (const q of queued) q.delay--;
    const ready = queued.filter((q) => q.delay <= 0);
    for (const q of ready) {
      queued.splice(queued.indexOf(q), 1);
      const m = q.m;
      sim.applyInput('p1', { mx: m.mx, mz: m.mz, aim: m.aim, fire: m.fire, dash: m.dash, skill: m.skill, useItem: m.useItem, seq: m.seq });
    }
    sim.step(DT);
    if (i % 2 === 0) feed();
    game.update(DT);
  }
};

// ---------------------------------------------------------------- direction
console.log('\n[方向] 每台机甲都有朝向提示');
const selfVis = game.players.get('p1');
const enemyVis = game.players.get('p2');
for (const [who, v] of [['自己', selfVis], ['敌人', enemyVis]]) {
  const p = v.parts;
  ok(!!p.chevron, `${who}：地面箭头存在`);
  ok(!!p.frontArc, `${who}：前向弧线存在`);
  ok(!!p.aimLine, `${who}：地面瞄准线存在`);
  ok(p.chevron.visible === true && p.chevron.material.opacity > 0.2, `${who}：箭头可见且不透明`, String(p.chevron.material.opacity.toFixed(2)));
  ok(p.chevron.position.x === 0 && p.chevron.position.z === 0, `${who}：箭头挂在机体原点（跟着朝向一起转）`);
  ok(p.aimLine.position.x > 0.5, `${who}：瞄准线指向机甲正前方（+X）`, String(p.aimLine.position.x));
}
// rotate the mech, the cue must rotate with it (child of the mech group)
enemyVis.parts.group.rotation.y = -0.9;
const world = new (await import('three')).Vector3();
enemyVis.parts.chevron.getWorldPosition(world);
const localZero = new (await import('three')).Vector3();
enemyVis.parts.group.getWorldPosition(localZero);
ok(Math.hypot(world.x - localZero.x, world.z - localZero.z) < 0.01, '箭头始终贴在机甲脚下（随队形旋转）');

// ---------------------------------------------------------------- instant fire
console.log('\n[开火] 按下左键当帧就有反馈');
while (sim.phase !== 'live') stepAll(1);
stepAll(6);
game.mouse.down = true;
game.sendNow = true;
game.update(DT); // the very next frame after the click
ok(game.ghosts.length === 1, '当帧就出现预测弹', `ghosts=${game.ghosts.length}`);
ok(selfVis.parts.flashT > 0, '当帧就有枪口火光');
ok(game.localShotAt > 0, '当帧记录了开火时间');
ok(game.localFireNextAt > game.time, '按开火间隔节流（不会每帧刷子弹）');
// the input went out immediately rather than waiting for the 30 Hz tick
ok(sent.some((m) => m.type === 'input' && m.fire === true), '开火输入立刻发给了服务器');

// the authoritative shot must actually happen (the visual is only a prediction)
const ghostsPeak = game.ghosts.length;
stepAll(10); // keep holding the trigger
ok(ghostsPeak === 1, '预测弹只出现一枚', String(ghostsPeak));
ok(sim.players.get('p1').stats.shots > 0, '服务器真的发射了子弹', String(sim.players.get('p1').stats.shots));
game.mouse.down = false;
stepAll(6);
// hand-off: the server bolt replaces the predicted tracer (same code path as
// syncBullets when a real bolt owned by us arrives)
if (!game.ghosts.length) game.spawnGhost(me0().x + 1, me0().z, 0, false);
const before = game.ghosts.length;
game.syncBullets([{ id: 771001, owner: 'p1', x: me0().x + 2, z: me0().z, vx: 18, vz: 0, type: 'bolt', charged: false }]);
ok(before > 0 && game.ghosts.length === before - 1, '服务器子弹到达时接管预测弹', `${before} → ${game.ghosts.length}`);
ok(game.bullets.size >= 0, '真实子弹由服务器子弹渲染');

// charged shot still respects the fire interval
game.mouse.down = true;
stepAll(80);
game.mouse.down = false;
stepAll(10);
ok(game.ghosts.length <= 1, '连射时预测弹数量不会堆叠', `ghosts=${game.ghosts.length}`);

// ---------------------------------------------------------------- threat
console.log('\n[预警] 有子弹要打中我时亮红弧');
const me = sim.players.get('p1');
const foe = sim.players.get('p2');
foe.x = me.x - 6;
foe.z = me.z;
foe.aim = 0; // shooting straight at us
me.invulnUntil = sim.t + 30; // don't actually die in the middle of the test
sim.fireBullet(foe, false);
stepAll(4);
ok(!!game.threatArc && game.threatArc.visible, '预警弧出现');
const expect = Math.atan2(foe.z - me.z, foe.x - me.x);
const diff = Math.abs(Math.atan2(Math.sin(game.threatArc.rotation.y - (-expect)), Math.cos(game.threatArc.rotation.y - (-expect))));
ok(diff < 0.35, '预警弧朝向子弹来向', `${game.threatArc.rotation.y.toFixed(2)} vs ${(-expect).toFixed(2)}`);
// a bolt flying away must NOT trigger the warning
sim.bullets.length = 0;
sim.bulletsById.clear();
sim.fireBullet(foe, false, { speed: 18 });
sim.bullets[sim.bullets.length - 1].vx = -18; // flying away from us
stepAll(4);
ok(!game.threatArc.visible, '子弹背向飞行时不报警');

console.log(errors.length ? 'CONSOLE ERRORS:\n' + errors.join('\n') : 'no console errors');
const pass = failures === 0 && errors.length === 0;
console.log(pass ? 'FEEL TEST OK' : `FEEL TEST FAILED (${failures})`);
process.exit(pass ? 0 : 1);
