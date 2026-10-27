// 瞄准线 / 准星回归测试。
//
// 问题：屏幕上那条瞄准线（和自己机甲的方向、长钉的蓄力指示线）跟鼠标经常
// 不在同一条线上。原因是「拿哪块地面去和光标求交」和「用哪一帧的相机求交」
// 出了错：
//   · 交点算在 y = 1 的平面上（机甲胸口高度），不是脚下的地面；
//   · 相机带了一点「朝瞄准方向偏移」，而瞄准又用上一帧的相机算 → 死循环，
//     最后稳定在偏 3～4° 的地方（屏幕边缘最明显）。
//
// 这个测试量的是"眼睛能看到的东西"：
//   1. 世界角度：机甲朝向 vs「机甲 → 光标脚下的地面点」，误差必须 ≈ 0；
//   2. 屏幕像素：把瞄准线投影到屏幕，光标到这条线的垂直距离必须很小；
//   3. 走动 / 转向 / 长钉蓄力线，都要成立。
import { setupDOM, fakeAudio, trackConsoleErrors } from './domsetup.js';

setupDOM();
const errors = trackConsoleErrors();

const { UI } = await import('../src/ui.js');
const { Game } = await import('../src/game.js');
const { Tutorial } = await import('../src/tutorial.js');
const THREE = await import('three');

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
const tutorial = new Tutorial({
  game, ui, audio: fakeAudio(), profile: { name: '准星', colorId: 'cyan', mech: 'sniper' },
});
tutorial.start({ mode: 'basic', onFinish() {}, onExit() {} });

const DT = 1 / 60;
const frames = (n, fn) => {
  for (let i = 0; i < n; i++) {
    if (fn) fn(i);
    tutorial.update(DT);
    game.update(DT);
  }
};

const GROUND = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const hit = new THREE.Vector3();
const _p = new THREE.Vector3();

const W = () => window.innerWidth;
const H = () => window.innerHeight;

function groundUnderCursor() {
  ndc.set((game.mouse.x / W()) * 2 - 1, -(game.mouse.y / H()) * 2 + 1);
  ray.setFromCamera(ndc, game.camera);
  return ray.ray.intersectPlane(GROUND, hit) ? { x: hit.x, z: hit.z } : null;
}

function screenOf(x, y, z) {
  _p.set(x, y, z).project(game.camera);
  return { x: (_p.x * 0.5 + 0.5) * W(), y: (-_p.y * 0.5 + 0.5) * H() };
}

/**
 * 三条量法，全部按"玩家眼睛看到的"来：
 *   angleErr —— 机甲朝向 vs 机甲→光标地面点 的角度差（度）
 *   pxErr    —— 光标到「瞄准线在屏幕上那条线」的垂直距离（像素）
 */
function measure(label) {
  const v = game.selfVisual;
  const p = groundUnderCursor();
  if (!p) return { label, angleErr: NaN, pxErr: NaN };
  const want = Math.atan2(p.z - v.z, p.x - v.x);
  let d = ((want - v.aim + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
  const angleErr = Math.abs((d * 180) / Math.PI);

  // 瞄准线（和玩家看到的一样）：从机甲脚下沿朝向延伸 4 米
  const a = screenOf(v.x, 0.04, v.z);
  const b = screenOf(v.x + Math.cos(v.aim) * 4, 0.04, v.z + Math.sin(v.aim) * 4);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  // 光标到无限长直线的垂直距离
  const pxErr = Math.abs((game.mouse.x - a.x) * dy - (game.mouse.y - a.y) * dx) / len;
  return { label, angleErr, pxErr, dist: Math.hypot(p.x - v.x, p.z - v.z) };
}

frames(60 * 4); // 倒计时
ok(!!game.selfVisual, '本地机甲存在');
ok(tutorial.sim.phase === 'live', '对局进入 live', tutorial.sim.phase);

// ---------------------------------------------------------------- 1. 定点 ---
console.log('\n[定点] 光标放在屏幕各处，瞄准线都要压在准星上');
const spots = [
  ['正中', 0.5, 0.5],
  ['左上', 0.16, 0.22],
  ['右上', 0.84, 0.22],
  ['左下', 0.16, 0.78],
  ['右下', 0.84, 0.78],
  ['正上', 0.5, 0.12],
  ['正下', 0.5, 0.88],
  ['左中', 0.08, 0.5],
  ['右中', 0.92, 0.5],
];
let worstAngle = 0;
let worstPx = 0;
for (const [name, fx, fy] of spots) {
  game.mouse.x = W() * fx;
  game.mouse.y = H() * fy;
  frames(12);
  const m = measure(name);
  worstAngle = Math.max(worstAngle, m.angleErr);
  worstPx = Math.max(worstPx, m.pxErr);
  ok(m.angleErr < 0.35 && m.pxErr < 3, `光标${name} · 误差 ${m.angleErr.toFixed(2)}° / ${m.pxErr.toFixed(1)} px`,
    `${m.dist.toFixed(1)} m`);
}
ok(worstAngle < 0.35, '所有位置的角度误差都在 0.35° 以内', `${worstAngle.toFixed(2)}°`);
ok(worstPx < 3, '所有位置在屏幕上的偏差都在 3 px 以内', `${worstPx.toFixed(1)} px`);

// ------------------------------------------------------------ 2. 边转向边打 ---
console.log('\n[走动 + 转向] 一边走一边甩鼠标，瞄准线不能掉队');
const dirs = [['d', 'w'], ['a', 's'], ['w', 'a'], ['s', 'd']];
let worstMoving = 0;
for (const [k1, k2] of dirs) {
  game.keys.clear();
  game.keys.add(k1);
  game.keys.add(k2);
  for (let i = 0; i < 10; i++) {
    const t = i / 10;
    game.mouse.x = W() * (0.2 + 0.6 * t);
    game.mouse.y = H() * (0.25 + 0.5 * Math.sin(t * Math.PI));
    frames(4);
    const m = measure('move');
    worstMoving = Math.max(worstMoving, m.angleErr);
  }
}
game.keys.clear();
frames(10);
ok(worstMoving < 0.6, '走动中角度误差 < 0.6°', `${worstMoving.toFixed(2)}°`);

// ---------------------------------------------------------- 3. 长钉蓄力线 ---
console.log('\n[长钉] 蓄力时那条 22 米长的指示线也要压在准星上');
const me = tutorial.sim.players.get('you');
me.skillCdUntil = 0;
game.mouse.x = W() * 0.78;
game.mouse.y = H() * 0.3;
frames(6);
game.pending.skill = true;
frames(20);
ok(!!me.skillState && me.skillState.type === 'sniperCharge', '蓄力状态已开启');
const v = game.selfVisual;
const line = v.sniperLine;
ok(!!line && line.visible, '蓄力指示线已画出');
if (line) {
  const arr = line.geometry.attributes.position.array;
  ok(Math.abs(arr[1] - 0.1) < 0.001 && Math.abs(arr[4] - 0.1) < 0.001,
    '指示线贴地（不会因为抬高而在屏幕上飘到准星上方）', `y=${arr[1].toFixed(2)}`);
  // 把这条线投影到屏幕，量光标到它的垂直距离
  const a = screenOf(arr[0], arr[1], arr[2]);
  const b = screenOf(arr[3], arr[4], arr[5]);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const pxErr = Math.abs((game.mouse.x - a.x) * dy - (game.mouse.y - a.y) * dx) / len;
  ok(pxErr < 6, '屏幕偏差 < 6 px', `${pxErr.toFixed(1)} px`);
}

// -------------------------------------------------------- 4. 相机不再抢方向 ---
console.log('\n[相机] 相机不能跟着瞄准方向跑（那会让准星和线互相追）');
const camA = { x: game.camera.position.x, z: game.camera.position.z };
game.mouse.x = W() * 0.5;
game.mouse.y = H() * 0.5;
frames(30);
const camB = { x: game.camera.position.x, z: game.camera.position.z };
const aimA = game.localAim;
game.mouse.x = W() * 0.95;
game.mouse.y = H() * 0.5;
frames(30);
const camC = { x: game.camera.position.x, z: game.camera.position.z };
ok(Math.abs(game.localAim - aimA) > 0.6, '鼠标左右移动确实改变了朝向',
  `${aimA.toFixed(2)} → ${game.localAim.toFixed(2)}`);
const drift = Math.hypot(camC.x - camB.x, camC.z - camB.z);
ok(drift < 0.35, '机甲不动时相机不会因为甩鼠标而漂移', `${drift.toFixed(2)} m`);
ok(Math.hypot(camB.x - camA.x, camB.z - camA.z) < 0.35, '鼠标居中也不会拉走相机');

ok(errors.length === 0, '没有控制台错误', errors.slice(0, 2).join(' | '));

console.log('');
if (failures) {
  console.log(`AIM TEST FAILED (${failures} checks)`);
  process.exit(1);
}
console.log('AIM TEST OK');
