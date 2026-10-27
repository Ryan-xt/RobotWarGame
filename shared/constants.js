// 《废土过载》 shared game constants — used by the authoritative server sim and the client.
export const SIM_HZ = 60;
export const SNAPSHOT_HZ = 20;
export const TICK_DT = 1 / SIM_HZ;

export const PLAYER_RADIUS = 0.62;
export const PLAYER_SPEED = 6.4;
export const PLAYER_ACCEL = 34;
export const PLAYER_FRICTION = 26;

export const BULLET = {
  speed: 18,
  chargedSpeed: 27,
  radius: 0.17,
  life: 2.4,
  // Heat per hit is what kills: the GDD budget is "a duel lasts long enough to
  // feel the heat rise". 8 per bolt = ~12 clean hits before a short circuit, so
  // a single burst no longer ends a mech and cover/venting actually matter.
  heat: 8,
  chargedHeat: 14,
  bouncedBonus: 0.18, // bounced hits +18% heat at baseline, adjusted by arena scaling
  magSize: 8,
  fireInterval: 1 / 3,
  reloadTime: 1.25,
  chargeTime: 0.6,
  maxBounces: 2,
};

export const DASH = {
  distance: 2.8,
  duration: 0.15,
  cooldown: 1.2,
  iframes: 0.12,
};

export const HEAT = {
  max: 100,
  decay: 2.6,
  decayDelay: 2.5,
  coolerRate: 18,
  acidRate: 6,
  acidSlow: 0.2,
  towerHeat: 11,
  towerRadius: 2.75,
  towerInterval: 4.2,
  towerCharge: 1.15,
  explosionHeat: 24,
  explosionRadius: 3,
  respawnTime: 10,
  spawnInvuln: 2,
};

export const RESPAWN_TIME = HEAT.respawnTime;
export const MATCH_DURATION = 180;
export const SUDDEN_DEATH = 30;

export const PLAYER_COLORS = [
  { id: 'orange', name: '锈橙', hex: '#ff8a3d' },
  { id: 'cyan', name: '电弧青', hex: '#46d9ff' },
  { id: 'lime', name: '酸液绿', hex: '#9dff57' },
  { id: 'magenta', name: '霓虹粉', hex: '#ff5bc8' },
  { id: 'yellow', name: '警示黄', hex: '#ffd83d' },
  { id: 'violet', name: '脉冲紫', hex: '#b88bff' },
  { id: 'red', name: '熔炉红', hex: '#ff5147' },
  { id: 'white', name: '冷光白', hex: '#e8f4ff' },
];

export const TEAM_COLORS = ['#46d9ff', '#ff8a3d'];

export const BOT_NAMES = [
  '废铁阿强', '扳手老K', '齿轮姐', '拾荒者7号', '锈血', '火花塞', '焦炭', '螺丝玛丽',
  '电站幽灵', '冷却液大亨', '废土阿飞', '扳机手指', '老式发动机', '电弧小丑', '铁皮狗',
];

export const ITEM_TYPES = {
  coolant: {
    id: 'coolant', name: '冷却罐', short: '冷却', color: '#5ad8ff',
    desc: '-40 过载 · 使用需站定 1.5 秒', icon: 'coolant',
  },
  grenade: {
    id: 'grenade', name: '电磁手雷', short: '手雷', color: '#ffb03a',
    desc: '掷出后 1.5 秒爆炸 · +25 过载并麻痹', icon: 'grenade',
  },
  plate: {
    id: 'plate', name: '便携钢板', short: '钢板', color: '#c6d1da',
    desc: '放置 6 秒反弹掩体', icon: 'plate',
  },
  overclock: {
    id: 'overclock', name: '超载核心', short: '核心', color: '#ff5bc8',
    desc: '15 秒伤害 +30%，受到过载 +50%', icon: 'overclock',
  },
  grapple: {
    id: 'grapple', name: '钩爪索', short: '钩索', color: '#ffd83d',
    desc: '瞬间位移 6 米', icon: 'grapple',
  },
  purge: {
    id: 'purge', name: '清空过载', short: '清空', color: '#9dff57',
    desc: '立即将过载清零', icon: 'purge',
  },
};

export const EVENT_META = {
  sandstorm: { name: '沙尘暴', icon: '🌪', warn: 1.4, desc: '能见度骤降 · 风声逼近' },
  airdrop: { name: '空投争夺', icon: '📦', warn: 1.2, desc: '高级道具正在坠落' },
  claw: { name: '巨型机械臂', icon: '🦾', warn: 1.1, desc: '阴影锁定 · 立刻离开红圈' },
  emstorm: { name: '电磁风暴', icon: '⚡', warn: 1.3, desc: '随机区域持续放电' },
  leak: { name: '冷却液泄漏', icon: '🧊', warn: 1.3, desc: '低地积液 · 减速但降温' },
};

export const MECH_IDS = ['assault', 'grappler', 'guardian', 'miner', 'sniper', 'furnace'];

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const randRange = (rng, a, b) => a + (b - a) * rng();
export const dist2 = (ax, az, bx, bz) => (ax - bx) ** 2 + (az - bz) ** 2;
export const dist = (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz);
export const angleDiff = (a, b) => {
  let d = (a - b) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
};
export const normAngle = (a) => {
  a = a % (Math.PI * 2);
  if (a > Math.PI) a -= Math.PI * 2;
  if (a < -Math.PI) a += Math.PI * 2;
  return a;
};

// Mulberry32 deterministic RNG
export function makeRng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashStr(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
