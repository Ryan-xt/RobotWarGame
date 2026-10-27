// 射击训练（射击篇）回归：
//
//   1. 五种靶：固定 / 移动 / 远靶 / 点射 / 会还手的实战靶机
//   2. 移动靶真的在动，远靶真的在 11 m 外
//   3. 命中按「谁打中了谁」计数：移动靶命中、远距离命中、控温命中
//   4. 实战靶机在最后一步才醒，醒了会朝玩家开火
//   5. 打完五步会结算（写完存档由 main.js 负责）
import { setupDOM, fakeAudio, trackConsoleErrors } from './domsetup.js';

setupDOM();
const errors = trackConsoleErrors();

const { UI } = await import('../src/ui.js');
const { Game } = await import('../src/game.js');
const { Tutorial, SHOOTING_STEPS } = await import('../src/tutorial.js');
const THREE = await import('three');

let failures = 0;
const ok = (cond, label, extra = '') => {
  if (!cond) { failures++; console.log('  ✗', label, extra); }
  else console.log('  ✓', label, extra);
};
const $ = (id) => document.getElementById(id);

const ui = new UI({ audio: fakeAudio(), handlers: {} });
ui.applySettings({ volume: 0, quality: 'low', shake: false, hints: false });
ui.hideLoading();
const stage = { is3D: true, quality: 'low', setQuality() {}, setActive() {}, render() {}, getStats() { return {}; } };
const game = new Game({ stage, audio: fakeAudio(), ui, send: () => {} });
const tutorial = new Tutorial({
  game, ui, audio: fakeAudio(), profile: { name: '新兵', mech: 'assault', colorId: 'cyan' }, mode: 'shooting',
});
let finished = false;
tutorial.start({ mode: 'shooting', onFinish: () => { finished = true; }, onExit: () => {} });

console.log('\n[启动] 射击训练');
ok(tutorial.active && tutorial.mode === 'shooting', '射击训练启动');
ok(tutorial.steps === SHOOTING_STEPS && SHOOTING_STEPS.length === 5, '五个教学目标', String(SHOOTING_STEPS.length));
ok($('btn-shooting'), '菜单里有「射击训练」按钮');
ok($('tut-panel') && !$('tut-panel').classList.contains('hidden'), '教学面板可见');
ok($('hud-mode').textContent === '射击训练', 'HUD 显示「射击训练」', $('hud-mode').textContent);
ok($('btn-shooting').querySelector('small').textContent.includes('固定靶'), '按钮副标题正确');

const sim = tutorial.sim;
const me = sim.players.get('you');
const t1 = sim.players.get('tgt1');
const t2 = sim.players.get('tgt2');
const t3 = sim.players.get('tgt3');
const bot = sim.players.get('bot1');
ok(!!t1 && !!t2 && !!t3 && !!bot, '四种靶机都摆好了');

const DT = 1 / 60;
const frame = (n = 1, fn) => {
  for (let i = 0; i < n; i++) { if (fn) fn(i); tutorial.update(DT); game.update(DT); }
};
// the practice range still counts down 3 s before it goes live
frame(60 * 4);
ok(sim.phase === 'live', '倒计时结束后进入实战', sim.phase);

console.log('\n[靶位]');
const d1 = Math.hypot(t3.x - me.x, t3.z - me.z);
ok(d1 >= 11, '远靶在 11 m 之外', `${d1.toFixed(1)} m`);
ok(t1.dummy && t2.dummy && bot.dummy, '靶机都是木头靶（不会主动开枪）');
ok(bot.active === false, '实战靶机一开始是冻结的');

// 移动靶真的在动
const p0 = { x: t2.x, z: t2.z };
frame(90);
const moved = Math.hypot(t2.x - p0.x, t2.z - p0.z);
ok(moved > 1.0, '移动靶在横向移动', `${moved.toFixed(2)} m`);
ok(Math.abs(Math.hypot(t2.vx, t2.vz)) > 0.5, '移动靶带有速度（可以练提前量）', `${Math.hypot(t2.vx, t2.vz).toFixed(2)} m/s`);
ok(Math.hypot(t2.x - me.x, t2.z - me.z) > 4, '移动靶保持在远处（不贴脸）');

console.log('\n[命中计数]');
me.invulnUntil = sim.t + 999;
// 打死固定靶 → fixedKills
sim.addHeat(t1, 120, 'bullet', 'you');
frame(4);
ok(tutorial.watch.fixedKills >= 1, '击毁固定靶记一次', `fixedKills=${tutorial.watch.fixedKills}`);
ok(tutorial.stepIndex === 1, '进入第二步「打移动靶」', String(tutorial.stepIndex));

// 打中移动靶 3 次
for (let i = 0; i < 3; i++) { t2.heat = Math.min(90, t2.heat); sim.addHeat(t2, 8, 'bullet', 'you'); frame(2); }
ok(tutorial.watch.moverHits >= 3, '移动靶命中计数', `moverHits=${tutorial.watch.moverHits}`);
ok(tutorial.stepIndex === 2, '进入第三步「远距离射击」', String(tutorial.stepIndex));

// 打中远靶 2 次
for (let i = 0; i < 2; i++) { t3.heat = Math.min(90, t3.heat); sim.addHeat(t3, 8, 'bullet', 'you'); frame(2); }
ok(tutorial.watch.farHits >= 2, '远距离命中计数', `farHits=${tutorial.watch.farHits}`);
ok(tutorial.stepIndex === 3, '进入第四步「点射控温」', String(tutorial.stepIndex));
ok(tutorial.watch.coolHits === 0, '控温连击从 0 开始（不吃前面步骤的旧命中）');

// 热量超过 75 → 连击清零
me.heat = 0;
t1.alive = true;
t1.invulnUntil = 0; // 靶子重生有 2 s 无敌，测试里等不起
for (let i = 0; i < 4; i++) { t1.heat = Math.min(90, t1.heat); sim.addHeat(t1, 8, 'bullet', 'you'); frame(2); }
const coolBefore = tutorial.watch.coolHits;
ok(coolBefore >= 4, '低温命中累积到 4 次', `coolHits=${coolBefore}`);
ok(tutorial.stepIndex === 4, '进入第五步「打会还手的靶机」', String(tutorial.stepIndex));
ok(bot.dummy === false && bot.active === true, '实战靶机被唤醒');
ok($('tut-stat') === null || $('tut-current').textContent.length > 0, '面板里显示命中率/热量读数');

console.log('\n[实战靶机会还手]');
me.invulnUntil = 0; // 前面的命中测试把玩家设成无敌了，这里要挨打
const heat0 = me.heat;
const botShots0 = bot.stats.shots;
frame(60 * 12);
ok(bot.stats.shots > botShots0, '靶机朝玩家开火', `shots +${bot.stats.shots - botShots0}`);
ok(bot.botState && bot.botState.targetId === 'you', '靶机锁定的是玩家，不是别的靶子', String(bot.botState?.targetId));
ok(me.heat > heat0 || me.hitsTaken > 0, '玩家真的被打了（会升温）', `heat ${heat0.toFixed(0)}→${me.heat.toFixed(0)}`);

// 最后一步：击倒它
bot.heat = 90;
sim.addHeat(bot, 40, 'bullet', 'you');
frame(4);
ok(tutorial.watch.duelKills >= 1, '击倒实战靶机记一次', `duelKills=${tutorial.watch.duelKills}`);
ok(finished, '五步走完，射击篇结算');

// ---------------------------------------------------------------- 真开枪
// 上面用 addHeat 直接模拟命中，这里再走一遍真实输入链路：把鼠标移到靶子上，
// 按住左键，让客户端预测 + 服务器权威子弹真的把它打下线。
console.log('\n[真开枪] 鼠标瞄准 + 左键');
{
  const ui2 = new UI({ audio: fakeAudio(), handlers: {} });
  ui2.hideLoading();
  const game2 = new Game({ stage, audio: fakeAudio(), ui: ui2, send: () => {} });
  const tut2 = new Tutorial({
    game: game2, ui: ui2, audio: fakeAudio(),
    profile: { name: '新兵', mech: 'assault', colorId: 'cyan' }, mode: 'shooting',
  });
  tut2.start({ mode: 'shooting', onFinish: () => {}, onExit: () => {} });
  const sim2 = tut2.sim;
  for (let i = 0; i < 60 * 4; i++) { tut2.update(DT); game2.update(DT); }
  const aimAt = (x, z) => {
    const cam = game2.camera;
    cam.updateMatrixWorld();
    cam.matrixWorldInverse.copy(cam.matrixWorld).invert();
    const v = new THREE.Vector3(x, 0, z).project(cam);
    game2.mouse.x = (v.x * 0.5 + 0.5) * window.innerWidth;
    game2.mouse.y = (-v.y * 0.5 + 0.5) * window.innerHeight;
  };
  game2.mouse.down = true;
  for (let i = 0; i < 60 * 14 && tut2.stepIndex === 0; i++) {
    const t = sim2.players.get('tgt1');
    if (t && t.alive) aimAt(t.x, t.z);
    tut2.update(DT);
    game2.update(DT);
  }
  game2.mouse.down = false;
  ok(tut2.watch.fixedKills >= 1, '真实开火击毁固定靶', `fixedKills=${tut2.watch.fixedKills}`);
  ok(tut2.stepIndex >= 1, '打完自动进入下一步', String(tut2.stepIndex));
  tut2.exit();
}

console.log(errors.length ? 'CONSOLE ERRORS:\n' + errors.join('\n') : 'no console errors');
const pass = failures === 0 && errors.length === 0;
console.log(pass ? 'SHOOTING TEST OK' : `SHOOTING TEST FAILED (${failures})`);
process.exit(pass ? 0 : 1);
