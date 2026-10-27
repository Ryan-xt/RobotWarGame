// 新手教程：一局本地练习。
//
// 不连服务器 —— 客户端直接跑一份 MatchSim（和服务器同一份代码），每帧把它当成
// 「零延迟的快照」喂给渲染层，所以物理、过载、短路、道具全都是真实规则，
// 只是对手换成了两个站着不动的训练靶。
import { MatchSim } from '../server/sim.js';
import { buildArena, arenaSummary, pointBlocked, hasLineOfSight } from '../shared/arena.js';

const ARENA_SEED = 20251026;
const ARENA_SIZE = 30;
const FIXED_DT = 1 / 60;
const YOU = 'you';
const DUMMIES = [
  { id: 'dummy1', name: '训练靶 · 甲', mech: 'guardian', color: '#ff5b4a', colorId: 'red' },
  { id: 'dummy2', name: '训练靶 · 乙', mech: 'miner', color: '#ffd24a', colorId: 'amber' },
];

/**
 * Find a spot where the player stands in the open, two dummies sit 6–9 m in
 * front of them with a clear line of fire, and a cooling vent is close enough
 * to walk to. Purely deterministic — same arena, same layout.
 */
function planLayout(arena, sim) {
  const half = arena.half;
  const lim = half - 4;
  const inHazard = (x, z, pad) => arena.acids.some((a) => Math.hypot(a.x - x, a.z - z) < a.r + pad)
    || arena.coolers.some((c) => Math.hypot(c.x - x, c.z - z) < c.r + pad * 0.5)
    || arena.towers.some((t) => Math.hypot(t.x - x, t.z - z) < t.r + pad);
  // how many of the 8 compass directions are walkable from (x, z)
  const openness = (x, z, dist = 3.2) => {
    let n = 0;
    for (let k = 0; k < 8; k++) {
      const a = (k * Math.PI) / 4;
      if (!pointBlocked(arena, x + Math.cos(a) * dist, z + Math.sin(a) * dist, 0.5)) n++;
    }
    return n;
  };

  let best = null;
  for (let hx = -lim; hx <= lim; hx += 1.5) {
    for (let hz = -lim; hz <= lim; hz += 1.5) {
      if (pointBlocked(arena, hx, hz, 0.8) || inHazard(hx, hz, 1.8)) continue;
      if (openness(hx, hz) < 7) continue;
      let cooler = null;
      let coolerDist = Infinity;
      for (const c of arena.coolers) {
        const d = Math.hypot(c.x - hx, c.z - hz);
        if (d < coolerDist) { coolerDist = d; cooler = c; }
      }
      if (coolerDist > 13) continue;
      const centerDist = Math.hypot(hx, hz);
      const score = coolerDist * 0.7 + centerDist * 0.25;
      if (best && score >= best.score) continue;
      for (let k = 0; k < 16; k++) {
        const aim = -Math.PI / 2 + (k * Math.PI) / 8;
        const fx = Math.cos(aim);
        const fz = Math.sin(aim);
        const spots = [
          { dist: 6, off: -2.2 },
          { dist: 8.5, off: 2.2 },
        ].map(({ dist, off }) => ({
          x: hx + fx * dist - fz * off,
          z: hz + fz * dist + fx * off,
          dist,
        }));
        const ok = spots.every((sp) => !pointBlocked(arena, sp.x, sp.z, 0.9)
          && hasLineOfSight(arena, hx, hz, sp.x, sp.z)
          && !inHazard(sp.x, sp.z, 1.2));
        if (!ok) continue;
        best = { score, aim, home: { x: hx, z: hz }, spots, cooler, coolerDist };
        break; // the first clear direction from this spot is enough
      }
    }
  }
  if (!best) {
    // defensive fallback: spawn 0 and the default facing
    const arena0 = arena.spawns?.[0] || { x: 0, z: 0 };
    best = {
      score: 0, aim: -Math.PI / 2, home: { x: arena0.x, z: arena0.z },
      cooler: arena.coolers[0] || null, coolerDist: 0,
      spots: [
        { x: arena0.x, z: arena0.z - 6, dist: 6 },
        { x: arena0.x + 2.2, z: arena0.z - 8.5, dist: 8.5 },
      ],
    };
  }
  return best;
}

/**
 * What the player has to do. Each step is a plain predicate over the watched
 * numbers, so it does not matter how they achieve it.
 */
export const TUTORIAL_STEPS = [
  {
    id: 'move',
    title: '走路',
    keys: 'W / A / S / D',
    text: '用 WASD 在场上走动，先走够 8 米。',
    goal: '走动 8 米',
    done: (w) => w.moved >= 8,
  },
  {
    id: 'shoot',
    title: '开火',
    keys: '鼠标左键',
    text: '鼠标瞄准正前方的训练靶，按住左键把它打到短路爆炸。',
    goal: '击毁 1 个训练靶',
    done: (w) => w.kills >= 1,
  },
  {
    id: 'dash',
    title: '冲刺',
    keys: '空格',
    text: '按空格向前冲刺闪避，冲刺瞬间不会被打中。',
    goal: '冲刺 2 次',
    done: (w) => w.dashes >= 2,
  },
  {
    id: 'skill',
    title: '机甲技能',
    keys: '鼠标右键',
    text: '每台机体的技能不同：按右键释放你的机体技能。',
    goal: '释放 1 次技能',
    done: (w) => w.skills >= 1,
  },
  {
    id: 'heat',
    title: '过载与散热',
    keys: '热量条 + 散热区',
    text: '这里没有血条：被打中只会升温，热量满 100 就短路爆炸。' +
      '训练靶现在朝你开火——把热量顶到 70 以上，再走进蓝色散热区压回 35 以下。',
    goal: '热量到 70 后再降到 35 以下',
    done: (w) => w.heatPeaked && w.cooled,
  },
  {
    id: 'item',
    title: '捡道具',
    keys: 'E',
    text: '战场上会随机刷道具。走过去捡起地上发光的那一个，按 E 使用——' +
      '冷却罐降热、超频器强化机体、手雷把人从掩体后炸出来。',
    goal: '使用 1 个道具',
    done: (w) => w.itemsUsed >= 1,
  },
];

export class Tutorial {
  constructor({ game, ui, audio, profile }) {
    this.game = game;
    this.ui = ui;
    this.audio = audio;
    this.profile = profile;
    this.active = false;
    this.finished = false;
    this.sim = null;
    this.acc = 0;
    this.stepIndex = 0;
    this.watch = null;
    this.prevSend = null;
    this.dummyHome = new Map();
    this.dummyAlive = new Map();
    this.itemDropped = false;
    this.heatBurst = null;
    this.clock = 0;
    this.onFinish = null;
    this.onExit = null;
  }

  // --------------------------------------------------------------- lifecycle
  start({ onFinish, onExit } = {}) {
    this.onFinish = onFinish || null;
    this.onExit = onExit || null;
    this.active = true;
    this.finished = false;
    this.stepIndex = 0;
    this.acc = 0;
    this.clock = 0;
    this.itemDropped = false;
    this.watch = {
      moved: 0, kills: 0, dashes: 0, skills: 0, heatPeaked: false, cooled: false,
      dead: 0, itemsUsed: 0, maxHeat: 0,
    };

    const arena = buildArena(ARENA_SIZE, ARENA_SEED);
    const mechId = this.profile?.mech || 'assault';
    const meInfo = {
      id: YOU,
      name: this.profile?.name || '新兵',
      color: this.colorHex(this.profile?.colorId),
      colorId: this.profile?.colorId || 'cyan',
      mech: mechId,
      team: 0,
    };
    const infos = [
      meInfo,
      ...DUMMIES.map((d) => ({ ...d, team: 1, bot: true, difficulty: 'easy' })),
    ];
    const settings = {
      mode: 'ffa', duration: 900, eventRate: 'low', heatRate: 'slow', difficulty: 'easy',
    };
    const sim = new MatchSim({ arena, players: infos, settings, seed: ARENA_SEED, tutorial: true });
    // the practice range never "ends" and has no random events / end-game storm:
    // a new player should be looking at the tutorial, not at a sandstorm
    sim.endMatch = () => {};
    sim.nextEventAt = Infinity;
    sim.stormStart = Infinity;
    sim.nextItemAt = Infinity; // no random pickups: the tutorial drops its own
    this.sim = sim;

    // stand the player in open ground facing the dummies, with a cooling vent
    // within walking distance (see planLayout)
    const layout = planLayout(arena, sim);
    this.layout = layout;
    const me = sim.players.get(YOU);
    me.x = layout.home.x;
    me.z = layout.home.z;
    me.aim = layout.aim;
    me.facing = layout.aim;
    me.vx = 0; me.vz = 0;
    this.dummyHome.clear();
    this.dummyAlive.clear();
    DUMMIES.forEach((d, i) => {
      const p = sim.players.get(d.id);
      const spot = layout.spots[i];
      p.dummy = true;
      p.x = spot.x;
      p.z = spot.z;
      p.vx = 0; p.vz = 0;
      p.aim = Math.atan2(me.z - p.z, me.x - p.x);
      this.dummyHome.set(d.id, { x: p.x, z: p.z });
      this.dummyAlive.set(d.id, true);
    });

    // hand the render layer a normal "start" message
    const players = infos.map((p) => ({
      id: p.id, name: p.name, color: p.color, colorId: p.colorId,
      mech: p.mech, team: p.team, bot: !!p.bot,
    }));
    this.prevSend = this.game.send;
    this.game.send = (msg) => this.onInput(msg);
    this.game.start({
      type: 'start',
      roomCode: 'TUTORIAL',
      arena: JSON.parse(JSON.stringify(arenaSummary(arena))),
      settings,
      seed: ARENA_SEED,
      duration: settings.duration,
      you: YOU,
      players,
      spawns: sim.spawnState(),
      matchCount: 1,
    });

    this.setStep(0);
    this.pushSnapshot();
  }

  stop() {
    this.active = false;
    this.heatBurst = null;
    this.sim = null;
    if (this.prevSend) this.game.send = this.prevSend;
    this.prevSend = null;
  }

  colorHex(id) {
    const map = { cyan: '#59d8ff', red: '#ff5b4a', amber: '#ffd24a', violet: '#a06bff', orange: '#ff8a3d', green: '#5ddc8b' };
    return map[id] || '#59d8ff';
  }

  // ------------------------------------------------------------------- input
  onInput(msg) {
    if (!this.active || !this.sim) return;
    if (msg.type === 'input') this.sim.applyInput(YOU, msg);
  }

  pushSnapshot() {
    const snap = this.sim.snapshot();
    this.game.onSnapshot(snap, YOU);
    return snap;
  }

  // -------------------------------------------------------------------- loop
  update(dt) {
    if (!this.active || !this.sim) return;
    const sim = this.sim;
    this.clock += dt;
    this.acc += dt;
    let steps = 0;
    while (this.acc >= FIXED_DT && steps < 4) {
      sim.step(FIXED_DT);
      this.acc -= FIXED_DT;
      steps++;
    }
    if (steps === 0) return;
    this.keepDummies(sim);
    this.runHeatBurst(sim);
    this.pushSnapshot();
    if (!this.finished) this.checkSteps(sim);
  }

  /** Dummies stay where they were put, face the player and come back fast. */
  keepDummies(sim) {
    const me = sim.players.get(YOU);
    if (!me) return;
    for (const d of DUMMIES) {
      const p = sim.players.get(d.id);
      if (!p) continue;
      const alive = p.alive;
      const was = this.dummyAlive.get(d.id);
      const home = this.dummyHome.get(d.id);
      if (alive && !was && home) {
        // just respawned: bring it back to the practice line instead of the
        // far corner the arena would pick
        const spot = this.layout?.spots[DUMMIES.indexOf(d)] || home;
        const backAtLine = Math.hypot(me.x - spot.x, me.z - spot.z) < 15;
        let x = spot.x;
        let z = spot.z;
        if (!backAtLine) {
          const fx = Math.cos(me.aim);
          const fz = Math.sin(me.aim);
          const off = d.id === 'dummy1' ? -2.4 : 2.4;
          const cx = me.x + fx * 7 - fz * off;
          const cz = me.z + fz * 7 + fx * off;
          if (!pointBlocked(sim.arena, cx, cz, 0.9)) { x = cx; z = cz; }
        }
        p.x = x;
        p.z = z;
        p.vx = 0; p.vz = 0;
        home.x = x; home.z = z;
        p.respawnAt = 0;
      }
      this.dummyAlive.set(d.id, alive);
      if (alive) p.aim = Math.atan2(me.z - p.z, me.x - p.x);
    }
  }

  checkSteps(sim) {
    const me = sim.players.get(YOU);
    if (!me) return;
    const w = this.watch;

    // distance walked
    if (this.lastPos) w.moved += Math.hypot(me.x - this.lastPos.x, me.z - this.lastPos.z);
    this.lastPos = { x: me.x, z: me.z };

    // stats the sim keeps for us
    w.kills = me.stats.kills;
    if (me.dashUntil > sim.t && !this.wasDashing) w.dashes++;
    this.wasDashing = me.dashUntil > sim.t;
    if (me.skillCdUntil > (this.lastSkillCd || 0)) w.skills++;
    this.lastSkillCd = me.skillCdUntil;
    w.maxHeat = Math.max(w.maxHeat, Math.round(me.heat));
    if (me.heat >= 70) w.heatPeaked = true;
    if (w.heatPeaked && me.heat < 35) w.cooled = true;

    // items: picked up then used
    if (me.item) this.lastItem = me.item;
    else if (this.lastItem) { w.itemsUsed++; this.lastItem = null; }

    const step = TUTORIAL_STEPS[this.stepIndex];
    if (step && step.done(w)) {
      this.audio?.sfx?.('ui', { volume: 0.5 });
      this.goToStep(this.stepIndex + 1);
    }
  }

  /** Show step `index` and arm whatever it needs; past the last step = fin. */
  goToStep(index) {
    if (index >= TUTORIAL_STEPS.length) {
      this.finished = true;
      this.heatBurst = null;
      this.ui?.completeTutorial?.();
      this.onFinish?.();
      return;
    }
    this.setStep(index);
  }

  setStep(index) {
    this.stepIndex = index;
    const st = TUTORIAL_STEPS[index];
    this.ui?.showTutorial?.(TUTORIAL_STEPS, index);
    if (!st || !this.sim) return;
    if (st.id === 'heat') this.armHeatBurst();
    if (st.id === 'item' && !this.itemDropped) this.dropItem(this.sim, this.sim.players.get(YOU));
  }

  // ------------------------------------------------------- 过载演示（第 5 步）
  /**
   * The training dummy opens fire on the player so the heat bar actually moves:
   * this is the only way to feel "no HP, hits only add heat" without a bot that
   * fights back. It stops at 70 and tops up if the player dodged everything.
   */
  armHeatBurst() {
    const sim = this.sim;
    const me = sim.players.get(YOU);
    this.heatBurst = { active: true, next: sim.t + 0.8, shots: 0, until: sim.t + 9, topped: false };
    const cooler = this.layout?.cooler;
    if (cooler && this.ui?.toast) {
      const d = Math.round(Math.hypot(cooler.x - me.x, cooler.z - me.z));
      this.ui.toast(`训练靶开火了 · 蓝色散热区离你约 ${d} 米（小地图蓝点）`, 'ok');
    }
  }

  runHeatBurst(sim) {
    const hb = this.heatBurst;
    if (!hb || !hb.active) return;
    const me = sim.players.get(YOU);
    if (!me || !me.alive) { hb.active = false; return; }
    if (me.heat >= 70) { hb.active = false; return; }
    if (sim.t > hb.until) {
      hb.active = false;
      // very dodgy player: hand them the heat so the step is still finishable
      if (!hb.topped) me.heat = Math.max(me.heat, 72);
      return;
    }
    if (hb.shots >= 9 || sim.t < hb.next) return;
    const shooter = [...sim.players.values()].find((p) => p.dummy && p.alive);
    if (!shooter) return;
    shooter.aim = Math.atan2(me.z - shooter.z, me.x - shooter.x);
    // slightly hotter than a live bolt so the lesson lands in a few seconds
    sim.fireBullet(shooter, false, { speed: 14, heat: 11 });
    hb.shots++;
    hb.next = sim.t + 0.45;
  }

  dropItem(sim, me) {
    const dist = 2.6;
    const x = me.x + Math.cos(me.aim) * dist;
    const z = me.z + Math.sin(me.aim) * dist;
    sim.items.push({
      id: ++sim.itemSerial,
      type: 'overclock',
      x, z,
      groundedAt: sim.t,
      expireAt: sim.t + 120,
    });
    this.itemDropped = true;
  }

  /** 「跳过这一步」 */
  skipStep() {
    if (!this.active || this.finished) return;
    this.heatBurst = null;
    this.goToStep(this.stepIndex + 1);
  }

  /** 「退出教程」 */
  exit() {
    this.stop();
    this.ui?.hideTutorial?.();
    try { this.game.disposeWorld(); } catch {}
    this.onExit?.();
  }
}
