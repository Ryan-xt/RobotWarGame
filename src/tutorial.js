// 教学 / 训练：一局本地练习。
//
// 不连服务器 —— 客户端直接跑一份 MatchSim（和服务器同一份代码），每帧把它当成
// 「零延迟的快照」喂给渲染层，所以物理、过载、短路、道具全都是真实规则。
//
// 三种模式：
//   basic    —— 新手教程：两个站着不动的训练靶，六步认识按键和过载规则。
//   advanced —— 进阶训练：两台会走会打的简单 AI，五步练走位/反弹/散热/补给/击杀。
//   shooting —— 射击训练（射击篇）：固定靶 / 移动靶 / 远靶 / 点射控温 / 会还手的靶机，
//               五步练准星、提前量、距离和热量，练完就能在实战里打到人。
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

const ADV_BOTS = [
  { id: 'bot1', name: '训练机 · 甲', mech: 'assault', color: '#ff5b4a', colorId: 'red' },
  { id: 'bot2', name: '训练机 · 乙', mech: 'sniper', color: '#ffd24a', colorId: 'amber' },
];

/** 进阶训练：面对会还手的 AI，练真正能赢的打法。 */
export const ADVANCED_STEPS = [
  {
    id: 'dodge',
    title: '冲刺躲弹',
    keys: '空格 + 红色预警弧',
    text: '脚下亮红弧 = 有子弹正朝你飞来。这时候按空格冲刺，冲刺前 0.12 秒无敌，' +
      '可以白拿一次闪避。用冲刺躲开 2 次来袭就算过关。',
    goal: '用冲刺躲过 2 次来袭',
    tip: '别乱冲：看到红弧再冲，冲刺冷却 1.2 秒。',
    done: (w) => w.dashDodges >= 2,
  },
  {
    id: 'bounce',
    title: '反弹弹',
    keys: '左键 · 打墙',
    text: '电磁弹能弹墙、弹钢板、弹护盾，反弹后伤害更高，而且能打到掩体后面的敌人。' +
      '对着墙或钢板开火，让反弹弹命中 AI 一次。',
    goal: '用反弹弹命中 1 次',
    tip: '在废墟墙或钢板旁边斜着打，角度越小反弹越远。',
    done: (w) => w.bounceHits >= 1,
  },
  {
    id: 'cool',
    title: '边打边降温',
    keys: '蓝色散热区',
    text: '热量 70 以上会被减速，90 以上一碰就炸。真正的赢法是：打一波 → 进散热区 → ' +
      '热量回到 25 以下再出去。先把热量顶到 55，再降到 25 以下。',
    goal: '热量到 55 后降到 25 以下',
    tip: '散热区每秒降 18 度，比自然散热快 7 倍，但站在里面会暴露位置。',
    done: (w) => w.heatPeaked && w.cooled,
  },
  {
    id: 'item',
    title: '抢补给',
    keys: 'E',
    text: '地上亮圈就是道具，AI 也会抢。走过去捡一个，按 E 用掉——' +
      '冷却罐救命、超频器 15 秒爆发、手雷能把人从掩体后炸出来。',
    goal: '捡起并使用 1 个道具',
    tip: '被追着打时优先抢冷却罐；血量（热量）健康就抢超频器反打。',
    done: (w) => w.itemsUsed >= 1,
  },
  {
    id: 'kill',
    title: '击倒 AI',
    keys: '左键 + 技能',
    text: '现在把它打爆：瞄准时把准星放在它移动方向的前面一点（预判提前量），' +
      '它靠近就用右键技能，热量高了就退回散热区。击倒 1 台训练机过关。',
    goal: '击倒 1 台 AI',
    tip: '它绕着掩体走时，用反弹弹或者手雷把它逼出来。',
    done: (w) => w.kills >= 1,
  },
];

const SHOOT_TARGETS = [
  { id: 'tgt1', name: '固定靶', mech: 'guardian', color: '#ff5b4a', colorId: 'red' },
  { id: 'tgt2', name: '移动靶', mech: 'miner', color: '#ffd24a', colorId: 'amber' },
  { id: 'tgt3', name: '远靶', mech: 'sniper', color: '#a06bff', colorId: 'violet' },
];
const SHOOT_BOT = { id: 'bot1', name: '实战靶机', mech: 'assault', color: '#ff8a3d', colorId: 'orange' };

/** 射击篇：五步练到「打得中」。 */
export const SHOOTING_STEPS = [
  {
    id: 'fixed',
    title: '打固定靶',
    keys: '鼠标左键',
    text: '先把准星压上去：红色固定靶就在正前方，按住左键把它打到短路爆炸。' +
      '电磁弹沿准星方向直线飞出，这就是全部规则。',
    goal: '击毁 1 台固定靶',
    tip: '准星就是弹道：站定 → 准星压在靶上 → 再开枪。',
    done: (w) => w.fixedKills >= 1,
  },
  {
    id: 'lead',
    title: '打移动靶',
    keys: '预判提前量',
    text: '黄色靶机会左右横移。子弹要飞一会儿才到，所以准星要放在它前进方向的前面：' +
      '它往右走，就瞄它右边一点。命中 3 次过关。',
    goal: '命中移动靶 3 次',
    tip: '打偏多半是瞄在原地：目标越远、横移越快，提前量越大。',
    done: (w) => w.moverHits >= 3,
  },
  {
    id: 'range',
    title: '远距离射击',
    keys: '提前量 + 距离',
    text: '紫色远靶在 11 米开外，子弹飞到要小半秒。站远一点打：命中 11 米外的目标 2 次。' +
      '（走到它面前打不算——这一步练的是距离感。）',
    goal: '命中 11 米外的目标 2 次',
    tip: '远靶横移慢，提前量反而好算；一发一发看落点，比乱扫更快。',
    done: (w) => w.farHits >= 2,
  },
  {
    id: 'control',
    title: '点射控温',
    keys: '松开左键就降温',
    text: '按住左键会一直开火，热量顶到 100 就短路。实战打法是点射：打 2–3 发停一下。' +
      '热量保持在 60 以下命中 4 次过关；一旦超过 75，连击清零。',
    goal: '热量 ≤ 60 时命中 4 次',
    tip: '热量越高移动越慢、越容易被反打；宁可少打一发。',
    done: (w) => w.coolHits >= 4,
  },
  {
    id: 'duel',
    title: '打会还手的靶机',
    keys: '走位 + 射击',
    text: '橙色靶机醒了：它会绕着你走、会还火、会躲子弹。用前四步学的东西——压准星、算提前量、' +
      '点射控温、看到红弧按空格——把它打爆，射击篇就毕业了。',
    goal: '击倒 1 台会还手的靶机',
    tip: '它绕掩体时打反弹弹；它冲脸时先按空格拉开距离再打。',
    done: (w) => w.duelKills >= 1,
  },
];

/** Where the three targets and the duel bot stand, from the practice layout. */
function planShooting(arena, layout) {
  const { home, aim } = layout;
  const t1 = layout.spots[0] || { x: home.x + Math.cos(aim) * 6, z: home.z + Math.sin(aim) * 6 };

  // far target: as far as the lane allows, ideally 12-15 m
  let far = null;
  for (let d = 15.5; d >= 11 && !far; d -= 0.5) {
    for (const off of [0, 0.16, -0.16, 0.32, -0.32, 0.5, -0.5]) {
      const a = aim + off;
      const x = home.x + Math.cos(a) * d;
      const z = home.z + Math.sin(a) * d;
      if (Math.abs(x) > arena.half - 2 || Math.abs(z) > arena.half - 2) continue;
      if (pointBlocked(arena, x, z, 0.85)) continue;
      if (!hasLineOfSight(arena, home.x, home.z, x, z)) continue;
      far = { x, z, d };
      break;
    }
  }
  if (!far) far = { x: home.x + Math.cos(aim) * 11, z: home.z + Math.sin(aim) * 11, d: 11 };

  // moving target: 8 m out, sweeping across the line of fire
  const base = { x: home.x + Math.cos(aim) * 8, z: home.z + Math.sin(aim) * 8 };
  const clear = (x, z) => Math.abs(x) < arena.half - 2 && Math.abs(z) < arena.half - 2
    && !pointBlocked(arena, x, z, 0.6) && hasLineOfSight(arena, home.x, home.z, x, z);
  let axis = { x: -Math.sin(aim), z: Math.cos(aim) };
  let half = 1.6;
  let bestHalf = -1;
  for (let k = 0; k < 8; k++) {
    const a = aim + Math.PI / 2 + (k * Math.PI) / 4;
    const ax = Math.cos(a), az = Math.sin(a);
    let fwd = 0, back = 0;
    for (let t = 0.4; t <= 3.4; t += 0.4) { if (!clear(base.x + ax * t, base.z + az * t)) break; fwd = t; }
    for (let t = 0.4; t <= 3.4; t += 0.4) { if (!clear(base.x - ax * t, base.z - az * t)) break; back = t; }
    const run = Math.min(fwd, back, 3.2);
    if (run > bestHalf) { bestHalf = run; axis = { x: ax, z: az }; half = Math.max(0.9, run); }
  }
  if (bestHalf < 0.8) { axis = { x: -Math.sin(aim), z: Math.cos(aim) }; half = 1.2; }

  // duel bot: 9 m away, off to the side so it does not stand in front of the targets
  let bot = { x: home.x + Math.cos(aim + 0.7) * 9, z: home.z + Math.sin(aim + 0.7) * 9 };
  for (const off of [0.7, -0.7, 1.1, -1.1, 1.6, -1.6, 2.4, -2.4]) {
    const a = aim + off;
    const x = home.x + Math.cos(a) * 9;
    const z = home.z + Math.sin(a) * 9;
    if (Math.abs(x) > arena.half - 2.5 || Math.abs(z) > arena.half - 2.5) continue;
    if (pointBlocked(arena, x, z, 0.9)) continue;
    if (!hasLineOfSight(arena, home.x, home.z, x, z)) continue;
    bot = { x, z };
    break;
  }

  return { t1, mover: { base, axis, half }, far, bot };
}

export class Tutorial {
  constructor({ game, ui, audio, profile, mode = 'basic' }) {
    this.mode = mode;
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
  start({ onFinish, onExit, mode = null } = {}) {
    if (mode) this.mode = mode;
    this.onFinish = onFinish || null;
    this.onExit = onExit || null;
    this.active = true;
    this.finished = false;
    this.stepIndex = 0;
    this.acc = 0;
    this.clock = 0;
    this.itemDropped = false;
    const advanced = this.mode === 'advanced';
    const shooting = this.mode === 'shooting';
    this.steps = shooting ? SHOOTING_STEPS : advanced ? ADVANCED_STEPS : TUTORIAL_STEPS;
    this.watch = {
      moved: 0, kills: 0, dashes: 0, skills: 0, heatPeaked: false, cooled: false,
      dead: 0, itemsUsed: 0, maxHeat: 0, bounceHits: 0, dashDodges: 0,
      // 射击篇
      hits: 0, fixedKills: 0, moverHits: 0, farHits: 0, coolHits: 0, duelKills: 0,
    };
    this.bounceBase = 0;
    this.lastDashAt = -9;
    this.dashDodgeArmed = false;
    this.rangeLabel = shooting ? '射击训练' : advanced ? '进阶训练' : '新手教程';
    this.targetHome = new Map();

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
    const foes = shooting ? [...SHOOT_TARGETS, SHOOT_BOT] : advanced ? ADV_BOTS : DUMMIES;
    const infos = [
      meInfo,
      ...foes.map((d) => ({ ...d, team: 1, bot: true, difficulty: 'easy' })),
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
    // the basic tutorial drops its own single item; the advanced one plays with
    // the real supply rhythm so抢补给 is actually practised
    if (!advanced) sim.nextItemAt = Infinity;
    // Training bots must fight the trainee, not each other: two bots that pick
    // the closest target ended up duelling in a corner while the player was
    // never shot at ("AI 会闪避但不会射击").
    sim.duelFocus = advanced || shooting;
    this.sim = sim;

    this.dummyHome.clear();
    this.dummyAlive.clear();
    this.targetHome.clear();
    if (shooting) {
      const layout = planLayout(arena, sim);
      this.layout = layout;
      const plan = planShooting(arena, layout);
      this.shootPlan = plan;
      const me = sim.players.get(YOU);
      me.x = layout.home.x;
      me.z = layout.home.z;
      me.aim = layout.aim;
      me.facing = layout.aim;
      me.vx = 0; me.vz = 0;
      const place = (id, spot, extra = {}) => {
        const p = sim.players.get(id);
        if (!p) return null;
        p.dummy = true;
        p.x = spot.x;
        p.z = spot.z;
        p.vx = 0; p.vz = 0; p.heat = 0;
        p.aim = Math.atan2(me.z - p.z, me.x - p.x);
        Object.assign(p, extra);
        this.targetHome.set(id, { x: spot.x, z: spot.z });
        this.dummyAlive.set(id, true);
        return p;
      };
      place('tgt1', plan.t1);
      place('tgt2', plan.mover.base);
      place('tgt3', plan.far);
      const bot = place(SHOOT_BOT.id, plan.bot);
      if (bot) { bot.active = false; }
    } else if (advanced) {
      // real bots: let the arena place them; the player gets the spot with a
      // cooling vent nearby so the "退回去降温" lesson is possible
      const layout = planLayout(arena, sim);
      this.layout = layout;
      const me = sim.players.get(YOU);
      me.x = layout.home.x;
      me.z = layout.home.z;
      me.aim = layout.aim;
      me.facing = layout.aim;
      me.vx = 0; me.vz = 0;
      for (const d of ADV_BOTS) {
        const p = sim.players.get(d.id);
        if (!p) continue;
        p.x = layout.home.x + (d.id === 'bot1' ? -9 : 9);
        p.z = layout.home.z - (d.id === 'bot1' ? 2 : 6);
        p.aim = Math.atan2(me.z - p.z, me.x - p.x);
      }
      this.bounceBase = me.stats.bounceHits || 0;
    } else {
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
    }

    // hand the render layer a normal "start" message
    const players = infos.map((p) => ({
      id: p.id, name: p.name, color: p.color, colorId: p.colorId,
      mech: p.mech, team: p.team, bot: !!p.bot,
    }));
    this.prevSend = this.game.send;
    this.game.send = (msg) => this.onInput(msg);
    this.game.start({
      type: 'start',
      roomCode: advanced ? 'TRAINING' : 'TUTORIAL',
      arena: JSON.parse(JSON.stringify(arenaSummary(arena))),
      settings,
      seed: ARENA_SEED,
      duration: settings.duration,
      you: YOU,
      players,
      spawns: sim.spawnState(),
      matchCount: 1,
    });

    this.ui?.setTutorialMode?.(true, this.mode);
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
    this.tallyHits(this.sim);
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
    if (this.mode === 'advanced') return;
    if (this.mode === 'shooting') return this.keepTargets(sim);
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

  /**
   * 射击篇的靶位：固定靶站着，移动靶沿找好的横向通道来回走，远靶在 11 m 外，
   * 实战靶机在最后一步之前一直冻着。靶子被打爆后 1.6 s 重生，回到原位。
   */
  keepTargets(sim) {
    const me = sim.players.get(YOU);
    if (!me || !this.shootPlan) return;
    const plan = this.shootPlan;
    const w = this.watch;
    const spots = { tgt1: plan.t1, tgt2: plan.mover.base, tgt3: plan.far, [SHOOT_BOT.id]: plan.bot };
    for (const id of Object.keys(spots)) {
      const p = sim.players.get(id);
      if (!p) continue;
      const was = this.dummyAlive.get(id);
      const home = this.targetHome.get(id) || spots[id];
      if (p.alive && was === false) {
        p.x = home.x; p.z = home.z;
        p.vx = 0; p.vz = 0;
        p.respawnAt = 0;
        p.heat = 0;
        if (id === SHOOT_BOT.id && !p.active) p.dummy = true;
      }
      if (was === true && !p.alive) {
        if (id === 'tgt1') w.fixedKills++;
        if (id === SHOOT_BOT.id) w.duelKills++;
      }
      this.dummyAlive.set(id, p.alive);
      if (!p.alive) continue;
      if (id === 'tgt2') {
        // phase from the sim clock: a long frame (several sim steps) must not
        // slow the target down, otherwise the lead practice changes with fps
        const ph = sim.t * 1.25;
        const off = Math.sin(ph) * plan.mover.half;
        p.x = home.x + plan.mover.axis.x * off;
        p.z = home.z + plan.mover.axis.z * off;
        const v = Math.cos(ph) * plan.mover.half * 1.25;
        p.vx = plan.mover.axis.x * v;
        p.vz = plan.mover.axis.z * v;
      } else if (id === SHOOT_BOT.id && !p.active) {
        p.x = home.x; p.z = home.z;
        p.vx = 0; p.vz = 0;
      }
      // targets always face the shooter; the live sparring bot aims for itself
      if (p.dummy) p.aim = Math.atan2(me.z - p.z, me.x - p.x);
    }
  }

  /** Count the hits the sim reports for us (before snapshot() drains the queue). */
  tallyHits(sim) {
    const w = this.watch;
    if (!w || !sim) return;
    for (const e of sim.fx) {
      if (e.e !== 'heatHit' || e.attacker !== YOU) continue;
      w.hits++;
      const me = sim.players.get(YOU);
      const d = me ? Math.hypot(e.x - me.x, e.z - me.z) : 0;
      if (d >= 11) w.farHits++;
      if (e.id === 'tgt2') w.moverHits++;
      if (me && me.heat <= 60) w.coolHits++;
    }
    if (this.mode !== 'shooting') return;
    const me = sim.players.get(YOU);
    if (me && me.heat > 75 && w.coolHits > 0) {
      w.coolHits = 0;
      this.ui?.toast?.('热量超过 75 · 点射连击断了，先停手降到 60 以下', 'err');
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
    if (me.skillCdUntil > (this.lastSkillCd || 0)) w.skills++;
    this.lastSkillCd = me.skillCdUntil;
    w.maxHeat = Math.max(w.maxHeat, Math.round(me.heat));
    const peakAt = this.mode === 'advanced' ? 55 : 70;
    const coolAt = this.mode === 'advanced' ? 25 : 35;
    if (me.heat >= peakAt) w.heatPeaked = true;
    if (w.heatPeaked && me.heat < coolAt) w.cooled = true;

    // bounce hits are cumulative on the player's stats; only ever grow, so a
    // test / statistic reset can never un-complete a step
    w.bounceHits = Math.max(w.bounceHits, (me.stats.bounceHits || 0) - (this.bounceBase || 0));

    // dash dodge: a dash that starts while an enemy bolt is about to arrive
    const nowDash = me.dashUntil > sim.t;
    if (nowDash && !this.wasDashing) {
      w.dashes++;
      this.dashDodgeArmed = this.incomingSoon(sim, me, 0.45);
    }
    if (nowDash && this.dashDodgeArmed && !this.dashCounted) {
      w.dashDodges++;
      this.dashCounted = true;
      this.ui?.toast?.('闪避成功 · 冲刺无敌帧躲掉了子弹', 'ok');
    }
    if (!nowDash) { this.dashCounted = false; this.dashDodgeArmed = false; }
    this.wasDashing = nowDash;

    // items: picked up then used
    if (me.item) this.lastItem = me.item;
    else if (this.lastItem) { w.itemsUsed++; this.lastItem = null; }

    if (this.mode === 'shooting') {
      const shots = me.stats.shots || 0;
      const acc = shots ? Math.round(((me.stats.hits || 0) / shots) * 100) : 0;
      this.ui?.setTutorialStat?.(`命中 ${me.stats.hits || 0} / 射击 ${shots} · 命中率 ${acc}% · 热量 ${Math.round(me.heat)}`);
    }

    const step = this.steps[this.stepIndex];
    if (step && step.done(w)) {
      this.audio?.sfx?.('ui', { volume: 0.5 });
      this.goToStep(this.stepIndex + 1);
    }
  }

  /** Is an enemy bolt going to reach `p` within `within` seconds? */
  incomingSoon(sim, p, within = 0.45) {
    for (const b of sim.bullets) {
      if (b.owner === p.id) continue;
      const d = Math.hypot(b.x - p.x, b.z - p.z);
      if (d > 9) continue;
      const sp = Math.hypot(b.vx, b.vz) || 1;
      const ttc = ((p.x - b.x) * b.vx + (p.z - b.z) * b.vz) / (sp * sp);
      if (ttc < -0.05 || ttc > within) continue;
      const cx = b.x + b.vx * ttc;
      const cz = b.z + b.vz * ttc;
      if (Math.hypot(cx - p.x, cz - p.z) < 1.3) return true;
    }
    return false;
  }

  /** Show step `index` and arm whatever it needs; past the last step = fin. */
  goToStep(index) {
    if (index >= this.steps.length) {
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
    const st = this.steps[index];
    this.ui?.showTutorial?.(this.steps, index, this.rangeLabel, this.mode);
    if (!st || !this.sim) return;
    if (st.id === 'heat') this.armHeatBurst();
    // 点射控温 counts a fresh streak inside its own step
    if (st.id === 'control' && this.watch) this.watch.coolHits = 0;
    if (st.id === 'duel') {
      // wake the sparring bot: up to here it has been a frozen prop
      const bot = this.sim.players.get(SHOOT_BOT.id);
      if (bot) {
        bot.dummy = false;
        bot.active = true;
        bot.alive = true;
        bot.heat = Math.min(bot.heat, 20);
        bot.x = this.shootPlan?.bot?.x ?? bot.x;
        bot.z = this.shootPlan?.bot?.z ?? bot.z;
      }
    }
    if (st.tip) this.ui?.toast?.(st.tip, 'ok');
    // the basic tutorial hands you one item; the advanced one uses the real
    // supply rhythm (bots steal drops, which is the lesson)
    if (st.id === 'item' && this.mode !== 'advanced' && !this.itemDropped) {
      this.dropItem(this.sim, this.sim.players.get(YOU));
    }
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
    if (me?.inCooler) this.ui?.toast?.('你正站在散热区里：先走出蓝色光圈，才感觉得到中弹升温', 'err');
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
    // The trainee wanders while practising, and the other dummy may end up in
    // the line of fire. Both would send bolts into a wall and the heat bar —
    // the whole point of this step — would not move, so hop the shooter to a
    // clear spot around the player first.
    const otherDummyInTheWay = (x, z) => {
      const dx = me.x - x, dz = me.z - z;
      const len2 = dx * dx + dz * dz || 1;
      for (const q of sim.players.values()) {
        if (q === shooter || !q.dummy || !q.alive) continue;
        let t = ((q.x - x) * dx + (q.z - z) * dz) / len2;
        t = Math.max(0, Math.min(1, t));
        if (Math.hypot(q.x - (x + dx * t), q.z - (z + dz * t)) < 1.7) return true;
      }
      return false;
    };
    const clear = (x, z) => Math.abs(x) < sim.arena.half - 1.5 && Math.abs(z) < sim.arena.half - 1.5
      && !pointBlocked(sim.arena, x, z, 0.8)
      && hasLineOfSight(sim.arena, x, z, me.x, me.z)
      && !otherDummyInTheWay(x, z);
    if (!clear(shooter.x, shooter.z)) {
      for (let k = 0; k < 16 && !clear(shooter.x, shooter.z); k++) {
        const a = (k / 16) * Math.PI * 2;
        for (const d of [6.5, 8, 5]) {
          const x = me.x + Math.cos(a) * d;
          const z = me.z + Math.sin(a) * d;
          if (!clear(x, z)) continue;
          shooter.x = x; shooter.z = z;
          shooter.vx = 0; shooter.vz = 0;
          break;
        }
      }
    }
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
