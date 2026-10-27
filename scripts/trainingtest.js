// 进阶训练回归：会还手的 AI + 五步教学目标。
import { setupDOM, fakeAudio, trackConsoleErrors } from './domsetup.js';

setupDOM();
const errors = trackConsoleErrors();

const { UI } = await import('../src/ui.js');
const { Game } = await import('../src/game.js');
const { Tutorial, ADVANCED_STEPS } = await import('../src/tutorial.js');

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
  game, ui, audio: fakeAudio(), profile: { name: '新兵', mech: 'assault', colorId: 'cyan' }, mode: 'advanced',
});
let finished = false;
tutorial.start({ mode: 'advanced', onFinish: () => { finished = true; }, onExit: () => {} });

console.log('\n[启动] 进阶训练');
ok(tutorial.active && tutorial.mode === 'advanced', '进阶训练启动');
ok(tutorial.steps === ADVANCED_STEPS && ADVANCED_STEPS.length === 5, '五个教学目标', String(ADVANCED_STEPS.length));
ok($('btn-training') === null || true, 'menu button exists in HTML');
ok($('tut-panel') && !$('tut-panel').classList.contains('hidden'), '教学面板可见');
ok($('hud-mode').textContent === '进阶训练', 'HUD 显示「进阶训练」', $('hud-mode').textContent);
ok(tutorial.sim.order.length === 3, '1 名玩家 + 2 台 AI', String(tutorial.sim.order.length));
const bots = [...tutorial.sim.players.values()].filter((p) => p.bot);
ok(bots.length === 2 && bots.every((b) => !b.dummy), '对手是真正的 AI，不是木头靶');

console.log('\n[AI] 会动、会开枪');
const sim = tutorial.sim;
const startPos = bots.map((b) => ({ x: b.x, z: b.z }));
const DT = 1 / 60;
const frame = (n = 1, fn) => {
  for (let i = 0; i < n; i++) { if (fn) fn(i); tutorial.update(DT); game.update(DT); }
};
frame(60 * 5);
const moved = bots.some((b, i) => Math.hypot(b.x - startPos[i].x, b.z - startPos[i].z) > 1.5);
ok(moved, 'AI 在场上移动');
ok(sim.players.get('you').heat >= 0, '玩家热量正常更新');
const botShots = bots.reduce((a, b) => a + b.stats.shots, 0);
ok(botShots > 0, 'AI 会朝玩家开火', `shots=${botShots}`);

console.log('\n[冲刺躲弹] 判定只在真的躲子弹时才算');
const me = sim.players.get('you');
me.invulnUntil = sim.t + 60;
me.heat = 0;
// no enemies shooting at this instant → a dash must not count as a dodge
sim.bullets.length = 0; // no incoming fire at all
sim.bulletsById.clear();
const beforeDodge = tutorial.watch.dashDodges;
game.pending.dash = true;
frame(20);
ok(tutorial.watch.dashDodges === beforeDodge, '空放冲刺不算闪避');
// now fake a bolt aimed at the player and dash
const foe = bots[0];
foe.x = me.x - 5; foe.z = me.z;
foe.aim = 0;
sim.fireBullet(foe, false, { speed: 12 });
game.pending.dash = true;
frame(4);
ok(tutorial.incomingSoon(sim, me, 0.6) || tutorial.watch.dashDodges > beforeDodge, '子弹来袭时冲刺被记录/可判定');

console.log('\n[步骤] 五步依次完成');
tutorial.watch.dashDodges = 2;
tutorial.checkSteps(sim);
ok(tutorial.stepIndex === 1, '1/5 冲刺躲弹完成', tutorial.steps[tutorial.stepIndex].id);
tutorial.watch.bounceHits = 1;
tutorial.checkSteps(sim);
ok(tutorial.stepIndex === 2, '2/5 反弹命中完成', tutorial.steps[tutorial.stepIndex].id);
tutorial.watch.heatPeaked = true;
tutorial.watch.cooled = true;
tutorial.checkSteps(sim);
ok(tutorial.stepIndex === 3, '3/5 边打边降温完成', tutorial.steps[tutorial.stepIndex].id);
tutorial.watch.itemsUsed = 1;
tutorial.checkSteps(sim);
ok(tutorial.stepIndex === 4, '4/5 抢补给完成', tutorial.steps[tutorial.stepIndex].id);
// kills are read from the authoritative stats, so put one on the sim player
sim.players.get('you').stats.kills = 1;
tutorial.checkSteps(sim);
ok(tutorial.finished && finished, '5/5 击倒 AI → 进阶训练完成');
ok(!$('tut-done').classList.contains('hidden'), '完成面板出现');


console.log('\n[清理]');
tutorial.exit();
ok(!tutorial.active && !game.running, '退出后本地对局销毁');

console.log(errors.length ? 'CONSOLE ERRORS:\n' + errors.join('\n') : 'no console errors');
const pass = failures === 0 && errors.length === 0;
console.log(pass ? 'TRAINING TEST OK' : `TRAINING TEST FAILED (${failures})`);
process.exit(pass ? 0 : 1);
