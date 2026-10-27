// 机体专训回归测试：六台机体 × 两套课，一共 12 门课，全部用真实按键打完。
//
//   A. 结构：每台机体都有专属教程 + 进阶玩法，每步字段齐全、done() 不会在
//      开局就自己判完成（不做假判定），课程之间不是同一套文案。
//   B. 实战：用真 Game + 真 MatchSim 依次开每门课，按课程要求真的开技能、
//      真的打中人、真的让地雷炸到人、真的自爆，检查计数器与步骤推进，
//      最后确认 12 门课都能走到「完成」。
import { setupDOM, fakeAudio, trackConsoleErrors } from './domsetup.js';

setupDOM();
const errors = trackConsoleErrors();

const { UI } = await import('../src/ui.js');
const { Game } = await import('../src/game.js');
const { Tutorial } = await import('../src/tutorial.js');
const { MECH_LESSONS, LESSON_LEVELS, LESSON_META, lessonTitle } = await import('../src/mechlessons.js');
const { MECH_LIST } = await import('../shared/mechs.js');
const THREE = await import('three');

let failures = 0;
const ok = (cond, label, extra = '') => {
  if (!cond) { failures++; console.log('  ✗', label, extra); } else console.log('  ✓', label, extra);
};

const ui = new UI({ audio: fakeAudio(), handlers: {} });
ui.applySettings({ volume: 0, quality: 'low', renderScale: 1, maxFps: 60, shake: false, hints: false });
ui.hideLoading();

const DT = 1 / 60;
const ME = 'you';
const sparOf = (sim) => sim.players.get('bot1');

// ---------------------------------------------------------------- A. 结构 ---
console.log('\n[结构] 六台机体 × 两套课');
const mechIds = MECH_LIST.map((m) => m.id);
ok(mechIds.length === 6, '六台机体', mechIds.join(','));
for (const id of mechIds) {
  const l = MECH_LESSONS[id];
  ok(!!l, `${id} 有课程表`);
  if (!l) continue;
  ok(Array.isArray(l.tutorial) && l.tutorial.length >= 3, `${id} 专属教程 ≥3 步`, String(l.tutorial?.length));
  ok(Array.isArray(l.advanced) && l.advanced.length >= 3, `${id} 进阶玩法 ≥3 步`, String(l.advanced?.length));
  ok(!!LESSON_META[id]?.playstyle, `${id} 有打法说明`);
  ok(lessonTitle(id, 'tutorial').includes('专属教程'), `${id} 课程标题`, lessonTitle(id, 'tutorial'));

  const ids = new Set();
  for (const level of ['tutorial', 'advanced']) {
    const steps = l[level] || [];
    for (const st of steps) {
      const tag = `${id}.${level}.${st.id}`;
      ok(!!(st.title && st.keys && st.text && st.goal && st.tip), `${tag} 字段齐全`);
      ok(typeof st.done === 'function', `${tag} 有判定函数`);
      ok(!ids.has(`${level}:${st.id}`), `${tag} 步骤 id 不重复`);
      ids.add(`${level}:${st.id}`);
      // 全新计数 + 空快照时不应该直接判完成
      const empty = new Proxy({}, { get: () => 0 });
      let auto = false;
      try { auto = !!st.done(empty, empty); } catch { auto = true; }
      ok(!auto, `${tag} 开局不会自动完成`);
    }
  }
}
// 课程不能是同一套文案换名字
const texts = new Set();
for (const id of mechIds) {
  for (const s of MECH_LESSONS[id].tutorial) texts.add(s.text);
}
ok(texts.size >= 20, '专属教程文案按机体区分', `${texts.size} 条不同文案`);
const firstSteps = new Set(mechIds.map((id) => MECH_LESSONS[id].tutorial[0].title));
ok(firstSteps.size === 6, '六台机体的第一课各不相同', [...firstSteps].join(' / '));
ok(LESSON_LEVELS.length === 2 && LESSON_LEVELS[1].id === 'advanced', '两级菜单：专属教程 / 进阶玩法');

// ------------------------------------------------------------- B. 实战 -----
const _v = new THREE.Vector3();

class Driver {
  constructor(mechId, level) {
    this.mechId = mechId;
    this.level = level;
    this.renderStage = {
      is3D: true, quality: 'low', renderScale: 1,
      setQuality() {}, setActive() {}, render() {}, getStats() { return {}; },
    };
    this.game = new Game({ stage: this.renderStage, audio: fakeAudio(), ui, send: () => {} });
    this.tutorial = new Tutorial({
      game: this.game, ui, audio: fakeAudio(),
      profile: { name: '测机员', colorId: 'cyan', mech: mechId },
    });
    this.finished = false;
    this.tutorial.start({
      mode: 'mech', mechId, level,
      onFinish: () => { this.finished = true; },
      onExit: () => {},
    });
    this.sim = this.tutorial.sim;
    const layout = this.tutorial.layout;
    const d1 = this.sim.players.get('dummy1');
    const d2 = this.sim.players.get('dummy2');
    this.spotNear = d1 ? { x: d1.x, z: d1.z } : { x: layout.spots[0].x, z: layout.spots[0].z };
    this.spotFar = d2 ? { x: d2.x, z: d2.z } : {
      x: layout.home.x + Math.cos(layout.aim) * 14,
      z: layout.home.z + Math.sin(layout.aim) * 14,
    };
  }

  get me() { return this.sim.players.get(ME); }
  get w() { return this.tutorial.watch; }
  get step() { return this.tutorial.steps[this.tutorial.stepIndex]; }
  get base() { return this.tutorial.stepBase || {}; }
  bots() { return [...this.sim.players.values()].filter((p) => p.id !== ME && p.alive); }

  frames(n, fn) {
    for (let i = 0; i < n; i++) {
      if (fn) fn(i);
      this.tutorial.update(DT);
      this.game.update(DT);
    }
  }

  /** 用真实输入路径瞄准：把光标放到目标在屏幕上的位置 */
  aimAt(x, z) {
    const cam = this.game.camera;
    if (!cam) return;
    cam.updateMatrixWorld();
    cam.matrixWorldInverse.copy(cam.matrixWorld).invert();
    _v.set(x, 0, z).project(cam);
    this.game.mouse.x = (_v.x * 0.5 + 0.5) * window.innerWidth;
    this.game.mouse.y = (-_v.y * 0.5 + 0.5) * window.innerHeight;
  }

  /** 走到 (x,z) 附近：直接把玩家放过去不叫练走位，但课程判定看的是结果 */
  place(x, z) {
    const me = this.me;
    me.x = x; me.z = z; me.vx = 0; me.vz = 0;
    this.settle();
  }

  /** 瞬移之后让镜头跟上：准星是从「鼠标 + 相机」算出来的，相机没跟上就会脱靶 */
  settle(n = 16) { this.frames(n); }

  /**
   * 把目标摆回练习位（离出生点 6 米 / 14 米、有现成视线的两个位置），
   * 玩家站在 target 与出生点之间的连线上、离 target `dist` 米。
   * 这样「打不中」就只可能是玩家瞄歪了，不会是墙挡住了。
   */
  stage(t, dist = 5, which = 'near') {
    const spot = which === 'far' ? this.spotFar : this.spotNear;
    const home = this.tutorial.layout.home;
    let dx = home.x - spot.x;
    let dz = home.z - spot.z;
    let L = Math.hypot(dx, dz);
    if (L < 0.5) {
      dx = Math.cos(this.tutorial.layout.aim);
      dz = Math.sin(this.tutorial.layout.aim);
      L = 1;
    }
    if (t) {
      t.x = spot.x; t.z = spot.z;
      t.vx = 0; t.vz = 0;
    }
    this.me.x = spot.x + (dx / L) * dist;
    this.me.z = spot.z + (dz / L) * dist;
    this.me.vx = 0; this.me.vz = 0;
    this.settle();
    if (t) this.aimAt(t.x, t.z);
    return spot;
  }

  /** 站到目标前方 dist 米，准星压在目标上 */
  faceTarget(target, dist = 6, angle = 0) {
    const me = this.me;
    const a = angle || (Math.PI * 0.25);
    me.x = target.x - Math.cos(a) * dist;
    me.z = target.z - Math.sin(a) * dist;
    me.vx = 0; me.vz = 0;
    this.settle();
    this.aimAt(target.x, target.z);
    return a;
  }

  fire(seconds, target) {
    if (target) this.aimAt(target.x, target.z);
    this.game.mouse.down = true;
    this.frames(Math.round(seconds * 60), () => { if (target && target.alive) this.aimAt(target.x, target.z); });
    this.game.mouse.down = false;
  }

  skill() {
    this.me.skillCdUntil = 0;
    this.game.pending.skill = true;
    this.frames(6);
  }

  dash() {
    this.me.dashUntil = 0;
    this.me.dashCdUntil = 0;
    this.game.selfDashCd = 0; // 客户端那份冷却估计是快照带来的，测试里直接清掉
    this.game.pending.dash = true;
    this.frames(6);
  }

  /** 融掉一台 AI：把它的热量推到 96，再一次命中就是短路 */
  finishBot(bot) {
    if (!bot) return false;
    const before = this.sim.players.get(ME).stats.kills;
    freeze(bot);
    try {
      bot.heat = 96;
      bot.invulnUntil = 0; // 重生保护在实战里是 2 秒，测试里不想等
      bot.iframeUntil = 0;
      this.stage(bot, 5); // 站到有现成视线的位置再开枪
      for (let i = 0; i < 60 * 6; i++) {
        if (!bot.alive || this.sim.players.get(ME).stats.kills > before) break;
        if (bot.alive) this.aimAt(bot.x, bot.z);
        this.game.mouse.down = true;
        this.tutorial.update(DT);
        this.game.update(DT);
      }
    } finally {
      this.game.mouse.down = false;
      thaw(bot);
    }
    return this.sim.players.get(ME).stats.kills > before;
  }

  stepIndex() { return this.tutorial.stepIndex; }
}

/** 等冷却 / 让世界再走几帧，直到计数器涨到目标值 */
function waitUntil(d, fn, seconds = 8) {
  const n = Math.round(seconds * 60);
  for (let i = 0; i < n; i++) {
    if (fn()) return true;
    d.frames(1);
  }
  return fn();
}

/**
 * 每一门课的具体打法：拿到当前步骤就照课程要求做一遍。
 * 键是 `${mech}:${stepId}`，值是 (d) => void，或者 'win' / 'duel'（走通用的实战打法）。
 */
function liveBots(d) { return d.bots().filter((p) => !p.dummy); }

/** 当前这一步该打谁：进阶课里是两台会还手的 AI，专属教程里是前面那两台木头靶 */
function targetFor(d, i = 0) {
  const b = liveBots(d)[i];
  if (b) return b;
  const dummy = d.sim.players.get(i ? 'dummy2' : 'dummy1');
  if (dummy && dummy.alive) return dummy;
  return d.bots()[0] || null;
}

/**
 * 练「打中」的步骤先把目标按住不动（还是同一台 AI，照样吃伤害、照样算命中），
 * 练完放开，让它继续还手。按住只是为了让「打没打中」这件事可复现。
 */
function freeze(t) {
  if (!t) return;
  t.__freezeDummy = !!t.dummy;
  t.dummy = true;
  t.vx = 0;
  t.vz = 0;
}

function thaw(t) {
  if (!t) return;
  t.dummy = !!t.__freezeDummy;
  t.vx = 0;
  t.vz = 0;
}

function freezeAll(d, except = null) {
  for (const b of liveBots(d)) if (b !== except) freeze(b);
}
function thawAll(d) {
  for (const p of d.sim.players.values()) if (p.id !== ME) thaw(p);
}

/** 把热量推到 96，再补一发就是短路（把 AI 打下来的真流程） */
function winStep(d, need) {
  const me = d.sim.players.get(ME);
  const base = me.stats.kills;
  const deadline = d.sim.t + 120;
  while (me.stats.kills - base < need && d.sim.t < deadline) {
    const bot = liveBots(d)[0];
    if (!bot) { d.frames(40); continue; }
    d.finishBot(bot);
    d.frames(20);
  }
  return me.stats.kills - base;
}

// 地雷：sim 把雷放在角色前方 1.2 米，这里照着它的规则放，再把靶子挪到雷上
function placeMine(d) {
  d.me.skillCdUntil = 0;
  d.me.mineCount = 0;
  d.aimAt(d.me.x + 2, d.me.z);
  d.frames(3);
  d.game.pending.skill = true;
  d.frames(6);
}
function lastMine(d) {
  const mine = d.sim.mines.filter((m) => m.owner === ME);
  return mine.length ? mine[mine.length - 1] : null;
}

// 炉心：引信只有「点着 / 取消」两个状态，测试里必须看着状态按键，
// 不然连按两下就会变成「点着又取消」。
const fuseArmed = (d) => d.me.fuseEnd > 0;
function pressSkill(d) {
  d.me.skillCdUntil = 0;
  d.game.pending.skill = true;
  d.frames(6);
}
function armFuse(d) {
  waitUntil(d, () => d.me.alive, 14);
  if (!fuseArmed(d)) pressSkill(d);
  waitUntil(d, () => fuseArmed(d) || !d.me.alive, 1);
}
function cancelFuse(d) {
  if (!fuseArmed(d)) armFuse(d);
  pressSkill(d);
}

const ACTIONS = {
  // ---- 破阵 ---------------------------------------------------------------
  'assault:skill': (d) => {
    const t = targetFor(d);
    freeze(t);
    try { d.faceTarget(t, 6); d.skill(); } finally { thaw(t); }
  },
  'assault:hit': (d) => {
    const t = targetFor(d);
    freeze(t);
    freezeAll(d, t);
    try {
      for (let i = 0; i < 2; i++) {
        d.stage(t, 2.4);
        d.skill();
        d.frames(40);
      }
    } finally { thaw(t); thawAll(d); }
  },
  'assault:close': (d) => {
    const t = targetFor(d);
    freeze(t);
    freezeAll(d, t);
    try {
      d.stage(t, 5);
      waitUntil(d, () => {
        if (t.alive) d.aimAt(t.x, t.z);
        d.game.mouse.down = true;
        return d.w.closeHits - d.base.closeHits >= 6;
      }, 16);
      d.game.mouse.down = false;
    } finally { thaw(t); thawAll(d); }
  },
  'assault:combo': (d) => {
    const t = targetFor(d);
    freeze(t);
    freezeAll(d, t);
    try {
      for (let i = 0; i < 2; i++) {
        d.stage(t, 2.4);
        d.skill(); // 撞中，开 2 秒补枪窗口
        // 撞飞之后目标会被顶开，放回面前：练的是「撞中后马上补枪」
        d.stage(t, 4);
        d.fire(1.8, t);
        d.frames(40);
      }
    } finally { thaw(t); thawAll(d); }
  },
  'assault:tank': (d) => {
    d.me.heat = 78;
    d.frames(10);
  },
  'assault:escape': (d) => {
    const need = (d.base.chargeDashes || 0) + 2;
    for (let guard = 0; guard < 6 && d.w.chargeDashes < need; guard++) {
      waitUntil(d, () => d.me.alive, 16); // 上一课把自己热爆了就先等重生
      const t = liveBots(d)[0];
      if (!t) { d.frames(40); continue; }
      freeze(t);
      freezeAll(d, t);
      try {
        d.me.heat = 0; // 这一课练的是位移，不练控温
        d.me.dashCdUntil = 0;
        d.stage(t, 2.4);
        const before = d.w.chargeHits;
        d.skill(); // 撞中，开 1.5 秒的冲刺窗口
        const hit = waitUntil(d, () => d.w.chargeHits > before || !d.me.alive, 1.2);
        if (hit && d.me.alive) d.dash();
        d.frames(30);
      } finally { thaw(t); thawAll(d); }
    }
  },
  'assault:win': 'win',

  // ---- 索命 ---------------------------------------------------------------
  'grappler:skill': (d) => {
    const t = targetFor(d);
    freeze(t);
    freezeAll(d, t);
    try {
      d.stage(t, 6);
      d.skill();
      d.frames(20);
    } finally { thaw(t); thawAll(d); }
  },
  'grappler:wall': (d) => {
    // 朝 16 个方向各甩一次钩，勾到墙/掩体就会被拉过去（hookMiss + 位移）
    for (let k = 0; k < 16; k++) {
      if (d.w.hookWalls - d.base.hookWalls >= 1) return;
      const a = (k * Math.PI) / 8;
      d.me.skillCdUntil = 0;
      d.aimAt(d.me.x + Math.cos(a) * 8, d.me.z + Math.sin(a) * 8);
      d.frames(4);
      d.game.pending.skill = true;
      d.frames(10);
    }
  },
  'grappler:combo': (d) => {
    const t = targetFor(d);
    freeze(t);
    freezeAll(d, t);
    try {
      d.stage(t, 6);
      d.skill(); // 钩过来：开 3 秒命中窗口
      waitUntil(d, () => {
        if (t.alive) d.aimAt(t.x, t.z);
        d.game.mouse.down = true;
        return d.w.hookCombos - d.base.hookCombos >= 3;
      }, 4);
      d.game.mouse.down = false;
    } finally { thaw(t); thawAll(d); }
  },
  'grappler:drag': (d) => {
    const t = targetFor(d);
    freeze(t);
    freezeAll(d, t);
    try {
      for (let i = 0; i < 3; i++) {
        d.stage(t, 6);
        d.skill();
        d.frames(50);
      }
    } finally { thaw(t); thawAll(d); }
  },
  'grappler:rehook': (d) => {
    for (let i = 0; i < 3; i++) {
      for (let k = 0; k < 16; k++) {
        const a = (k * Math.PI) / 8 + i * 0.3;
        d.me.skillCdUntil = 0;
        d.aimAt(d.me.x + Math.cos(a) * 8, d.me.z + Math.sin(a) * 8);
        d.frames(4);
        d.game.pending.skill = true;
        d.frames(8);
        if (d.w.hookWalls - d.base.hookWalls >= i + 1) break;
      }
      d.frames(10);
    }
  },
  'grappler:win': 'win',

  // ---- 铁壁 ---------------------------------------------------------------
  'guardian:skill': (d) => { d.skill(); },
  'guardian:block': (d) => {
    // 这一步陪练机会开火：举盾等它打过来（真实子弹被盾弹回去）
    const spar = sparOf(d.sim);
    if (spar) { spar.dummy = false; d.faceTarget(spar, 9); }
    waitUntil(d, () => {
      d.me.skillCdUntil = 0;
      d.game.pending.skill = true;
      if (spar && spar.alive) d.aimAt(spar.x, spar.z);
      return d.w.shieldBounces - d.base.shieldBounces >= 2;
    }, 24);
  },
  'guardian:counter': (d) => {
    const t = targetFor(d);
    freeze(t);
    freezeAll(d, t);
    try {
      d.stage(t, 4);
      d.skill(); // 开盾，开 2 秒反打窗口
      waitUntil(d, () => {
        if (t.alive) d.aimAt(t.x, t.z);
        d.game.mouse.down = true;
        return d.w.shieldCombos - d.base.shieldCombos >= 2;
      }, 2);
      d.game.mouse.down = false;
    } finally { thaw(t); thawAll(d); }
  },
  'guardian:reflect': (d) => {
    const spar = sparOf(d.sim);
    if (spar) { spar.dummy = false; d.faceTarget(spar, 9); }
    waitUntil(d, () => {
      d.me.skillCdUntil = 0;
      d.game.pending.skill = true;
      if (spar && spar.alive) d.aimAt(spar.x, spar.z);
      return d.w.shieldBounces - d.base.shieldBounces >= 4;
    }, 26);
  },
  'guardian:cool': (d) => {
    const me = d.me;
    me.heat = 78;
    d.frames(6);
    const cooler = d.tutorial.layout.cooler;
    waitUntil(d, () => {
      if (cooler) d.place(cooler.x, cooler.z);
      return d.w.cooled;
    }, 20);
  },
  'guardian:win': 'win',

  // ---- 雷匠 ---------------------------------------------------------------
  'miner:skill': (d) => {
    for (let i = 0; i < 2; i++) {
      d.me.skillCdUntil = 0;
      d.aimAt(d.me.x + 1.4 + i * 0.5, d.me.z + 1.4 + i * 0.5);
      d.frames(3);
      d.game.pending.skill = true;
      d.frames(8);
    }
  },
  'miner:boom': (d) => {
    const t = targetFor(d);
    if (!t) return;
    placeMine(d);
    waitUntil(d, () => {
      const m = lastMine(d);
      if (t.alive && m) { t.heat = 0; t.x = m.x; t.z = m.z; }
      return d.w.mineHits - d.base.mineHits >= 1;
    }, 10);
  },
  'miner:zone': (d) => {
    const t = targetFor(d);
    if (t) { t.x = d.me.x - 9; t.z = d.me.z - 9; } // 别站在自己雷上
    for (let i = 0; i < 3; i++) {
      const before = d.sim.mines.length;
      d.me.skillCdUntil = 0;
      d.aimAt(d.me.x + 1.2, d.me.z - 1.2 - i * 0.6);
      d.frames(3);
      d.game.pending.skill = true;
      waitUntil(d, () => d.sim.mines.length > before, 2);
      d.me.mineCount = 0; // 手感问题：这一课只关心场上同时有几颗
    }
    waitUntil(d, () => d.w.minesLive >= 3, 8);
  },
  'miner:trap': (d) => {
    d.place(d.tutorial.layout.home.x, d.tutorial.layout.home.z);
    const need = d.base.mineHits + 3;
    for (let guard = 0; guard < 10 && d.w.mineHits < need; guard++) {
      const t = liveBots(d)[0];
      if (!t) { d.frames(40); continue; } // 等对面重生
      t.heat = 0; // 别让它被上一颗雷直接炸死
      t.x = d.me.x - 6; t.z = d.me.z - 6; // 先把靶子挪开，免得踩到旧雷
      placeMine(d);
      waitUntil(d, () => {
        const m = lastMine(d);
        if (t.alive && m) { t.heat = 0; t.x = m.x; t.z = m.z; }
        return d.w.mineHits >= need || !m || !t.alive;
      }, 10);
      d.frames(20);
    }
  },
  'miner:cold': (d) => {
    d.me.heat = 0;
    for (let guard = 0; guard < 4; guard++) {
      if (d.w.coldKills - (d.base.coldKills || 0) >= 1) return;
      const bot = liveBots(d)[0];
      if (!bot) { d.frames(40); continue; }
      d.me.heat = 0;
      d.finishBot(bot);
      d.frames(10);
    }
  },
  'miner:win': 'win',

  // ---- 长钉 ---------------------------------------------------------------
  'sniper:skill': (d) => { d.skill(); },
  'sniper:rail': (d) => {
    const t = d.sim.players.get('dummy2') || targetFor(d);
    freeze(t);
    // 上一课蓄的那一发还没打出去：再按一次是「取消」，等它打完
    waitUntil(d, () => !(d.me.skillState && d.me.skillState.type === 'sniperCharge'), 3);
    try {
      // 站回练习位：这个位置到远靶有现成的视线
      d.stage(t, 13, 'far');
      d.skill();
      waitUntil(d, () => {
        if (t.alive) d.aimAt(t.x, t.z);
        return d.w.railHits - d.base.railHits >= 1;
      }, 6);
    } finally { thaw(t); }
  },
  'sniper:far': (d) => {
    const t = d.sim.players.get('dummy2') || targetFor(d);
    freeze(t);
    try {
      d.stage(t, 13, 'far');
      waitUntil(d, () => {
        if (t.alive) d.aimAt(t.x, t.z);
        d.game.mouse.down = true;
        return d.w.far12Hits - d.base.far12Hits >= 2;
      }, 16);
      d.game.mouse.down = false;
    } finally { thaw(t); }
  },
  'sniper:lead': (d) => {
    // 打会跑会还手的 AI：对着它当前的位置点提前量
    waitUntil(d, () => {
      const b = liveBots(d)[0];
      if (b) {
        d.aimAt(b.x + (b.vx || 0) * 0.22, b.z + (b.vz || 0) * 0.22);
        d.game.mouse.down = true;
      } else d.game.mouse.down = false;
      return d.w.moverHits - d.base.moverHits >= 3;
    }, 24);
    d.game.mouse.down = false;
  },
  'sniper:heat': (d) => {
    const need = d.base.coolHits + 4;
    for (let guard = 0; guard < 16 && d.w.coolHits < need; guard++) {
      const t = liveBots(d)[0];
      if (!t) { d.frames(40); continue; } // 等对面重生
      freeze(t);
      freezeAll(d, t);
      try {
        d.stage(t, 4); // 这一课练的是控温，不是远射：站近点，把命中率拉满
        d.me.heat = 0; // 每串点射都从低温开始，命中的时候热量必须 ≤ 60
        d.fire(1.5, t);
        d.frames(24);
      } finally { thaw(t); thawAll(d); }
    }
  },
  'sniper:win': 'win',

  // ---- 炉心 ---------------------------------------------------------------
  'furnace:skill': (d) => {
    waitUntil(d, () => d.me.alive, 14);
    if (!fuseArmed(d)) pressSkill(d);
  },
  'furnace:cancel': (d) => {
    armFuse(d);
    cancelFuse(d); // 再按一次 = 取消
    waitUntil(d, () => !fuseArmed(d) || !d.me.alive, 2);
  },
  'furnace:boom': (d) => {
    const t = targetFor(d);
    if (!t) return;
    armFuse(d);
    waitUntil(d, () => {
      if (t.alive && d.me.alive) { t.x = d.me.x + 1.6; t.z = d.me.z; }
      return d.w.fuseHits - d.base.fuseHits >= 1;
    }, 10);
  },
  'furnace:chain': (d) => {
    for (let i = 0; i < 2; i++) {
      const t = targetFor(d);
      if (!t) return;
      waitUntil(d, () => d.me.alive, 16); // 等重生
      armFuse(d);
      waitUntil(d, () => {
        if (t.alive && d.me.alive) { t.x = d.me.x + 1.6; t.z = d.me.z; }
        return d.w.fuseHits - d.base.fuseHits >= i + 1;
      }, 10);
      d.frames(40);
    }
  },
  'furnace:bait': (d) => {
    const t = targetFor(d);
    if (!t) return;
    freeze(t);
    try {
      for (let i = 0; i < 2; i++) {
        waitUntil(d, () => d.me.alive, 16);
        d.stage(t, 8);
        armFuse(d); // 点引信逼它跑位
        cancelFuse(d); // 取消，开 3 秒输出窗口
        waitUntil(d, () => {
          if (t.alive) d.aimAt(t.x, t.z);
          d.game.mouse.down = true;
          return d.w.fuseBaits - d.base.fuseBaits >= i + 1;
        }, 4);
        d.game.mouse.down = false;
        d.frames(20);
      }
    } finally { thaw(t); }
  },
  'furnace:win': 'win',
  'furnace:duel': (d) => {
    // 「自爆换一条命」：把陪练机的热量推到一碰就炸，再贴着它点引信
    const spar = sparOf(d.sim);
    const t = (spar && spar.alive) ? spar : targetFor(d);
    ok(!!t && t.dummy === false, 'furnace/tutorial.duel 陪练机被叫醒', t ? String(t.dummy) : 'missing');
    if (!t) return;
    freeze(t);
    try {
      t.heat = 96;
      d.stage(t, 1.6);
      armFuse(d);
      waitUntil(d, () => {
        if (t.alive) { t.x = d.me.x + 1.4; t.z = d.me.z; }
        return d.w.selfKills - (d.base.selfKills || 0) >= 1;
      }, 12);
    } finally { thaw(t); }
  },
};

const RUN_ORDER = [
  ['assault', 'tutorial'], ['grappler', 'tutorial'], ['guardian', 'tutorial'],
  ['miner', 'tutorial'], ['sniper', 'tutorial'], ['furnace', 'tutorial'],
  ['assault', 'advanced'], ['grappler', 'advanced'], ['guardian', 'advanced'],
  ['miner', 'advanced'], ['sniper', 'advanced'], ['furnace', 'advanced'],
];

let cleared = 0;
const ONLY = process.env.ONLY || '';
const ORDER = ONLY ? RUN_ORDER.filter(([m, l]) => `${m}/${l}` === ONLY || m === ONLY) : RUN_ORDER;
for (const [mechId, level] of ORDER) {
  const label = `${mechId}/${level}`;
  console.log(`\n[实战] ${label}`);
  const d = new Driver(mechId, level);
  d.frames(60 * 4); // 开局倒计时
  ok(d.sim.phase === 'live', `${label} 开局进入 live`, d.sim.phase);
  ok(d.tutorial.mode === 'mech' && d.tutorial.level === level, `${label} 课程模式正确`);
  ok(d.me.mech === mechId, `${label} 用的是这门课的机体`, d.me.mech);
  ok(d.tutorial.steps === MECH_LESSONS[mechId][level], `${label} 用的是这台机体的课程表`);

  const visited = [];
  for (let guard = 0; guard < 8; guard++) {
    if (d.tutorial.finished || !d.tutorial.active) break;
    const st = d.step;
    if (!st) break;
    const before = d.stepIndex();
    visited.push(st.id);
    const act = ACTIONS[`${mechId}:${st.id}`] || (st.id === 'duel' ? 'duel' : null);
    if (act === 'win' || act === 'duel') {
      // 实战步：先确认陪练机真的醒了（会还手）
      if (st.id === 'duel') {
        const spar = sparOf(d.sim);
        ok(!!spar && spar.dummy === false, `${label}.${st.id} 陪练机被叫醒`, spar ? String(spar.dummy) : 'missing');
      }
      const need = st.id === 'duel' ? 1 : 2;
      const got = winStep(d, need);
      ok(got >= need, `${label}.${st.id} 实打实打死了 ${need} 台`, `kills+${got}`);
    } else if (act) {
      act(d);
    } else {
      console.log('  ✗', `${label}.${st.id} 没有对应的打法`);
      failures++;
      break;
    }
    // 让教程循环把判定跑一次
    d.frames(20);
    const after = d.stepIndex();
    ok(after > before || d.tutorial.finished, `${label}.${st.id} 完成并推进`,
      `step ${before} → ${after}${d.tutorial.finished ? ' (finish)' : ''}`);
    if (after === before && !d.tutorial.finished) {
      console.log('    watch:', JSON.stringify(d.w));
      console.log('    bots:', d.bots().map((b) => `${b.id}@${b.x.toFixed(1)},${b.z.toFixed(1)}${b.dummy ? '(dummy)' : ''}`).join(' '));
      console.log('    me:', d.me.x.toFixed(1), d.me.z.toFixed(1), 'alive', d.me.alive, 'heat', d.me.heat.toFixed(0),
        'shots', d.me.stats.shots, 'hits', d.me.stats.hits, 'inputFire', d.me.input && d.me.input.fire,
        'mouse', d.game.mouse.down, 'aim', d.me.aim.toFixed(2));
      break;
    }
  }

  const all = d.tutorial.steps.map((s) => s.id);
  ok(visited.length >= all.length || d.tutorial.finished,
    `${label} 全部步骤都走到过`, visited.join(','));
  ok(d.tutorial.finished || !d.tutorial.active, `${label} 课程结课`);
  if (d.tutorial.finished) cleared++;
  try { d.tutorial.stop(); d.game.stop(); } catch {}
}

ok(cleared === ORDER.length, '全部课程打通', `${cleared}/${ORDER.length}`);
ok(errors.length === 0, '没有控制台错误', errors.slice(0, 3).join(' | '));

console.log('');
if (failures) {
  console.log(`MECH LESSON TEST FAILED (${failures} checks)`);
  process.exit(1);
}
console.log('MECH LESSON TEST OK');
