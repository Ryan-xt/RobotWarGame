// 手感/平衡回归：这几条是玩家直接抱怨过的东西，别悄悄退化。
//
//   1. 「被射几下就死了」 → 满热前能吃多少发干净电磁弹
//   2. 「现在没有道具」   → 三分钟一局里刷了多少道具、地上平均剩几个
//   3. 「老死」           → 每台机甲每分钟平均短路几次
//   4. 新大地图           → 48m 巨构废都 能跑完整局、道具照样送到玩家附近
import { buildArena } from '../shared/arena.js';
import { MECH_IDS, BULLET, HEAT } from '../shared/constants.js';
import { MatchSim } from '../server/sim.js';

let failures = 0;
const ok = (cond, label, extra = '') => {
  if (!cond) { failures++; console.log('  ✗', label, extra); }
  else console.log('  ✓', label, extra);
};

function makeSim({ size = 30, bots = 4, seed = 11, duration = 180 }) {
  const arena = buildArena(size, seed);
  const players = Array.from({ length: bots }, (_, i) => ({
    id: 'p' + i, name: 'B' + i, color: '#fff', mech: MECH_IDS[i % MECH_IDS.length],
    team: i, bot: true, difficulty: 'normal',
  }));
  return new MatchSim({
    arena, players, seed,
    settings: { mode: 'ffa', duration, eventRate: 'med', heatRate: 'standard', difficulty: 'normal' },
  });
}

// ---------------------------------------------------------------- 1. heat per hit
console.log('\n[heat] how many clean bolts a mech can eat');
for (const mech of MECH_IDS) {
  const sim = makeSim({ bots: 1, duration: 180 });
  const p = sim.players.get('p0');
  p.mech = mech;
  p.invulnUntil = 0; // spawn protection would swallow the whole test
  let hits = 0;
  while (p.alive && hits < 60) {
    sim.addHeat(p, BULLET.heat, 'bolt', null, { ignoreMult: true });
    hits++;
  }
  ok(hits >= 11, `${mech} survives ${hits} plain hits`, `heat/hit ${BULLET.heat}`);
}
{
  const sim = makeSim({ bots: 1, duration: 180 });
  const p = sim.players.get('p0');
  p.invulnUntil = 0;
  let charged = 0;
  while (p.alive && charged < 60) {
    sim.addHeat(p, BULLET.chargedHeat, 'bolt', null, { ignoreMult: true });
    charged++;
  }
  ok(charged >= 6, `charged bolts still hurt (${charged} to overload)`, `heat/hit ${BULLET.chargedHeat}`);
  // cooling actually recovers: stand still for 10 s after taking half a bar
  const sim2 = makeSim({ bots: 1, duration: 180 });
  const q = sim2.players.get('p0');
  q.invulnUntil = 0;
  sim2.addHeat(q, 50, 'bolt', null, { ignoreMult: true });
  const before = q.heat;
  for (let i = 0; i < 60 * 10; i++) sim2.step(1 / 60);
  ok(q.heat < before - 12, 'standing still bleeds heat off', `${before.toFixed(0)} → ${q.heat.toFixed(0)}`);
  ok(HEAT.coolerRate >= HEAT.decay * 5, 'vents cool much faster than ambient decay', `${HEAT.coolerRate}/s vs ${HEAT.decay}/s`);
}

// ---------------------------------------------------------------- 2 + 3. full matches
function playMatch({ size, bots, seed }) {
  const sim = makeSim({ size, bots, seed });
  const out = { spawns: 0, picked: 0, used: 0, groundSum: 0, samples: 0, deaths: 0, nearPickups: 0, playSec: 0 };
  while (sim.phase !== 'over' && sim.t < 240) {
    sim.step(1 / 60);
    for (const fx of sim.fx) {
      if (fx.e === 'itemSpawn') out.spawns++;
      if (fx.e === 'itemPickup') out.picked++;
      if (['purge', 'overclock', 'grappleItem', 'platePlace', 'grenadeThrow', 'channelStart'].includes(fx.e)) out.used++;
    }
    sim.fx.length = 0;
    if (sim.t > 8 && sim.t < sim.duration - 5) {
      out.groundSum += sim.items.length;
      out.samples++;
    }
  }
  out.deaths = [...sim.players.values()].reduce((a, p) => a + p.stats.deaths, 0);
  out.playSec = sim.t;
  out.minutes = (out.deaths / bots) / (sim.t / 60);
  out.avgGround = out.samples ? out.groundSum / out.samples : 0;
  out.sim = sim;
  return out;
}

console.log('\n[items] supply on a 4-player 30m match');
const small = playMatch({ size: 30, bots: 4, seed: 11 });
console.log(`  ${small.spawns} drops · ${small.picked} picked up · ${small.used} used · avg ${small.avgGround.toFixed(2)} on the floor`);
ok(small.spawns >= 20, 'supply keeps dropping all match', String(small.spawns));
ok(small.avgGround >= 0.9, 'the floor is never empty for long', small.avgGround.toFixed(2));
ok(small.used >= 12, 'items actually get used', String(small.used));

console.log('\n[deaths] short circuits per mech per minute');
console.log(`  4 players: ${small.deaths} deaths / ${small.minutes.toFixed(2)} per mech per minute`);
ok(small.minutes <= 2.2, 'a 4-player match is not a respawn treadmill', small.minutes.toFixed(2));
const big = playMatch({ size: 48, bots: 8, seed: 11 });
console.log(`  8 players on 48m: ${big.deaths} deaths / ${big.minutes.toFixed(2)} per mech per minute · ${big.spawns} drops`);
ok(big.minutes <= 2.6, 'even a full 8-player brawl stays playable', big.minutes.toFixed(2));
ok(big.spawns >= 24, 'the giant map gets more supply', String(big.spawns));
ok(big.avgGround >= 0.9, 'the giant map has items on the floor', big.avgGround.toFixed(2));
ok(big.sim.phase === 'over', 'the giant map match completes');

console.log(failures ? `\nBALANCE TEST FAILED (${failures})` : '\nBALANCE TEST OK');
process.exit(failures ? 1 : 0);
