// 新手教程回归测试：真的把六步走完。
//
// 用真实 Game + 真实 MatchSim（教程那份），模拟按键、瞄准、开火、冲刺、
// 技能、散热、捡道具，检查每一步会被判完成、面板会更新、不会报错。
import { setupDOM, fakeAudio, trackConsoleErrors } from './domsetup.js';

setupDOM();
const errors = trackConsoleErrors();

const { UI } = await import('../src/ui.js');
const { Game } = await import('../src/game.js');
const { Tutorial, TUTORIAL_STEPS } = await import('../src/tutorial.js');

let failures = 0;
const ok = (cond, label, extra = '') => {
  if (!cond) { failures++; console.log('  ✗', label, extra); } else console.log('  ✓', label, extra);
};

const ui = new UI({ audio: fakeAudio(), handlers: {} });
ui.applySettings({ volume: 0, quality: 'low', renderScale: 1, maxFps: 60, shake: false, hints: false });
ui.hideLoading();
const stage = {
  is3D: true, quality: 'low', renderScale: 1,
  setQuality() {}, setActive() {}, render() {}, getStats() { return {}; },
};
const game = new Game({ stage, audio: fakeAudio(), ui, send: () => {} });
const profile = { name: '新兵', colorId: 'cyan', mech: 'assault' };
const tutorial = new Tutorial({ game, ui, audio: fakeAudio(), profile });

let finished = false;
tutorial.start({ onFinish: () => { finished = true; }, onExit: () => {} });

ok(tutorial.active, 'tutorial starts');
ok(!!game.scene && game.running, 'a local match is running');
ok(game.myId === 'you', 'the tutorial player is wired as "you"');
ok(tutorial.sim.players.size === 3, 'player + 2 training dummies', String(tutorial.sim.players.size));
const $ = (id) => document.getElementById(id);
ok($('tut-panel') && !$('tut-panel').classList.contains('hidden'), 'the step panel is visible');

const sim = tutorial.sim;
const me = () => sim.players.get('you');
const dummy = () => [...sim.players.values()].find((p) => p.dummy);
const stepNow = () => tutorial.stepIndex;
const DT = 1 / 60;

function frame(n = 1, fn) {
  for (let i = 0; i < n; i++) {
    if (fn) fn(i);
    tutorial.update(DT);
    game.update(DT);
  }
}
function face(x, z) {
  const p = me();
  game.localAim = Math.atan2(z - p.z, x - p.x);
}

// let the countdown run out
frame(60 * 4);
ok(sim.phase === 'live', 'the local match goes live', sim.phase);
ok(stepNow() === 0, 'starts on step 1', TUTORIAL_STEPS[stepNow()].id);

// ---- 1. walk ---------------------------------------------------------------
const start = { x: me().x, z: me().z };
// the range is laid out with open ground on all sides; cycle the keys so the
// walk test does not depend on which spot planLayout picked
const route = ['d', 's', 'a', 'w'];
frame(60 * 4, (i) => {
  if (tutorial.watch.moved > 9) { game.keys.clear(); return; }
  game.keys.clear();
  game.keys.add(route[Math.floor(i / 35) % route.length]);
});
game.keys.clear();
const walked = Math.hypot(me().x - start.x, me().z - start.z);
ok(tutorial.watch.moved >= 8, 'walking 8 m completes step 1', `${tutorial.watch.moved.toFixed(1)} m`);
ok(stepNow() === 1, 'advanced to step 2', TUTORIAL_STEPS[stepNow()].id);

// ---- 2. shoot the dummy down ----------------------------------------------
// walk back to the range home so the dummies are where planLayout put them
me().x = tutorial.layout.home.x; me().z = tutorial.layout.home.z;
tutorial.layout.spots.forEach((sp, i) => {
  const p = tutorial.sim.players.get(i === 0 ? 'dummy1' : 'dummy2');
  if (!p.alive) return;
  p.x = sp.x; p.z = sp.z; p.vx = 0; p.vz = 0;
});
const d = dummy();
face(d.x, d.z);
game.mouse.down = true;
frame(60 * 12, (i) => {
  const t = dummy();
  if (t && t.alive) face(t.x, t.z);
  if (tutorial.watch.kills > 0) game.mouse.down = false;
});
game.mouse.down = false;
ok(tutorial.watch.kills >= 1, 'the dummy short-circuits from gunfire', `kills=${tutorial.watch.kills}`);
ok(stepNow() === 2, 'advanced to step 3', TUTORIAL_STEPS[stepNow()].id);

// ---- 3. dash ---------------------------------------------------------------
// one dash per cooldown (1.2 s): press, wait out the cooldown, press again
frame(90);
game.pending.dash = true;
frame(100);
game.pending.dash = true;
frame(60);
ok(tutorial.watch.dashes >= 2, 'two dashes complete step 3', `dashes=${tutorial.watch.dashes}`);
ok(stepNow() === 3, 'advanced to step 4', TUTORIAL_STEPS[stepNow()].id);

// ---- 4. mech skill ---------------------------------------------------------
sim.players.get('you').skillCdUntil = 0;
frame(20);
game.pending.skill = true;
frame(20);
ok(tutorial.watch.skills >= 1, 'using the mech skill completes step 4', `skills=${tutorial.watch.skills}`);
ok(stepNow() === 4, 'advanced to step 5', TUTORIAL_STEPS[stepNow()].id);

// ---- 5. overheat then cool down -------------------------------------------
// the training dummy shoots the player: standing still takes hits, which is the
// real "no HP, only heat" rule
frame(60 * 10);
ok(tutorial.watch.heatPeaked, 'the dummy heating the player counts as 过载', `${tutorial.watch.maxHeat}`);
ok(me().heat >= 60, 'the dummy actually lands its shots', me().heat.toFixed(0));
// now walk into the cooling vent (real input, not teleporting)
const cooler = tutorial.layout.cooler;
frame(60 * 20, () => {
  const p = me();
  game.keys.clear();
  if (p.heat < 36) return;
  const dx = cooler.x - p.x;
  const dz = cooler.z - p.z;
  if (Math.hypot(dx, dz) > cooler.r * 0.6) {
    if (dx > 0.4) game.keys.add('d');
    if (dx < -0.4) game.keys.add('a');
    if (dz > 0.4) game.keys.add('s');
    if (dz < -0.4) game.keys.add('w');
  }
});
game.keys.clear();
ok(tutorial.watch.cooled, 'walking into the vent cools to below 35', `${me().heat.toFixed(0)}`);
ok(stepNow() === 5, 'advanced to step 6', TUTORIAL_STEPS[stepNow()].id);

// ---- 6. item ---------------------------------------------------------------
ok(tutorial.itemDropped, 'an overclock is dropped for the item step');
const item = sim.items[sim.items.length - 1];
ok(!!item, 'an item exists on the ground');
frame(60 * 6, () => {
  const p = me();
  if (p.item) return;
  const dx = item.x - p.x;
  const dz = item.z - p.z;
  game.keys.clear();
  if (dx > 0.5) game.keys.add('d');
  if (dx < -0.5) game.keys.add('a');
  if (dz > 0.5) game.keys.add('s');
  if (dz < -0.5) game.keys.add('w');
});
game.keys.clear();
ok(!!me().item, 'the item is picked up by walking over it', String(me().item));
game.pending.item = true;
frame(10);
ok(tutorial.watch.itemsUsed >= 1, 'pressing E uses it', `used=${tutorial.watch.itemsUsed}`);
ok(tutorial.finished, 'the tutorial finishes');
ok(finished, 'the finish callback fires');
ok(!$('tut-done').classList.contains('hidden'), 'the 完成 panel is shown');

// ---- exit ------------------------------------------------------------------
tutorial.exit();
ok(!tutorial.active, 'exiting stops the tutorial');
ok(!game.running, 'the local match is torn down');

console.log(errors.length ? 'CONSOLE ERRORS:\n' + errors.join('\n') : 'no console errors');
const pass = failures === 0 && errors.length === 0;
console.log(pass ? 'TUTORIAL TEST OK' : `TUTORIAL TEST FAILED (${failures})`);
process.exit(pass ? 0 : 1);
