// Headless balance/invariant test: runs complete bot matches across all arena
// sizes and every mech skill, then checks the authoritative sim's guarantees.
import { buildArena, resolvePlayerArena, arenaSummary, pointBlocked } from '../shared/arena.js';
import { MECH_IDS } from '../shared/constants.js';
import { MatchSim } from '../server/sim.js';

let failures = 0;
const ok = (cond, label, extra = '') => {
  if (!cond) { failures++; console.log('  ✗', label, extra); }
  else console.log('  ✓', label);
};

// ------------------------------------------------------------------ arenas
console.log('\n[arena] deterministic layouts');
for (const size of [20, 30, 40, 48]) {
  for (const seed of [1, 99999]) {
    const a = buildArena(size, seed);
    const b = buildArena(size, seed);
    ok(JSON.stringify(a) === JSON.stringify(b), `${size}m seed ${seed} deterministic`);
    ok(a.spawns.length === 8, `${size}m has 8 spawns`);
    ok(a.walls.length >= 6, `${size}m walls built (${a.walls.length})`);
    ok(a.walls.every((w) => w.alive && w.maxHp > 0), `${size}m walls start intact`);
    ok(a.plates.length > 0 && a.coolers.length > 0 && a.towers.length > 0 && a.acids.length > 0,
      `${size}m props present (plates ${a.plates.length}, coolers ${a.coolers.length}, towers ${a.towers.length}, acids ${a.acids.length})`);
    const inside = (p) => Math.abs(p.x) <= a.half && Math.abs(p.z) <= a.half;
    for (const sp of a.spawns) ok(inside(sp), `${size}m spawn ${sp.x},${sp.z} inside arena`);
    const sum = arenaSummary(a);
    ok(sum.walls.length === a.walls.length && sum.size === size, `${size}m summary complete`);
    // player pushed into a wall must be resolved back out
    const wall = a.walls.find((w) => w.alive && !w.x && !w.z) || a.walls[0];
    const p = { x: wall.x, z: wall.z, vx: 0, vz: 0 };
    resolvePlayerArena({ ...a, dynamicPlates: [] }, p, 0.6);
    const overlapsWall = Math.abs(p.x - wall.x) < wall.w * 0.5 && Math.abs(p.z - wall.z) < wall.h * 0.5;
    ok(!overlapsWall, `${size}m wall collision pushes players out`);
  }
}

// ------------------------------------------------------------------ matches
console.log('\n[match] 8 bots, full length, ffa + team');
function runMatch({ size, seed, mode, duration, eventRate = 'high', heatRate = 'fast', difficulty = 'normal', bots = 8 }) {
  const arena = buildArena(size, seed);
  const players = Array.from({ length: bots }, (_, i) => ({
    id: 'p' + (i + 1), name: 'BOT' + (i + 1), color: '#fff', mech: MECH_IDS[i % MECH_IDS.length],
    team: mode === 'ffa' ? i : i % 2, bot: true, difficulty,
  }));
  const sim = new MatchSim({ arena, players, settings: { mode, duration, eventRate, heatRate, difficulty }, seed });
  const seen = { fx: new Set(), events: new Set(), maxHeat: 0, shortCircuit: 0, respawns: 0, wallBreaks: 0, wallHits: 0, phases: new Set(), badSnap: 0, finite: true };
  let ticks = 0;
  while (sim.phase !== 'over' && ticks < 60 * (duration + 20)) {
    sim.step(1 / 60);
    ticks++;
    if (ticks % 20 !== 0) continue;
    const snap = sim.snapshot();
    seen.phases.add(snap.phase);
    for (const p of snap.players) {
      if (p.heat > seen.maxHeat) seen.maxHeat = p.heat;
      for (const k of ['x', 'z', 'heat', 'ammo']) {
        if (!Number.isFinite(p[k])) { seen.finite = false; seen.badSnap++; }
      }
      if (Math.abs(p.x) > arena.half + 0.01 || Math.abs(p.z) > arena.half + 0.01) seen.badSnap++;
    }
    if (snap.walls.length !== arena.walls.length) seen.badSnap++;
    for (const e of snap.fx) {
      seen.fx.add(e.e);
      if (e.e === 'shortCircuit') seen.shortCircuit++;
      if (e.e === 'respawn') seen.respawns++;
      if (e.e === 'wallBreak') seen.wallBreaks++;
      if (e.e === 'wallHit') seen.wallHits++;
      if (e.e === 'eventBanner') seen.events.add(e.type);
    }
    // snapshot must be JSON safe (the network path)
    try { JSON.parse(JSON.stringify(snap)); } catch { seen.badSnap++; }
  }
  return { sim, arena, seen, ticks };
}

const ffa = runMatch({ size: 30, seed: 4242, mode: 'ffa', duration: 90 });
const s = ffa.seen;
console.log(`  ticks ${ffa.ticks} · heat peak ${s.maxHeat.toFixed(0)} · short circuits ${s.shortCircuit} · respawns ${s.respawns}`);
console.log(`  wall hits ${s.wallHits} breaks ${s.wallBreaks} · events ${[...s.events].join(',') || 'none'}`);
ok(ffa.sim.phase === 'over', 'match reaches the over phase');
ok(!!ffa.sim.result, 'match produces a result');
ok(s.badSnap === 0, 'snapshots stay finite, in-bounds and JSON safe', String(s.badSnap));
ok(s.maxHeat >= 60, 'heat builds up under bot fire', s.maxHeat.toFixed(1));
ok(s.shortCircuit > 0, 'at least one short circuit happens', String(s.shortCircuit));
ok(s.respawns > 0, 'eliminated mechs respawn', String(s.respawns));
ok(s.wallBreaks > 0, 'destructible walls get destroyed', String(s.wallBreaks));
ok(s.events.size >= 2, 'random events fire (sandstorm/claw/airdrop...)', [...s.events].join(','));
ok(ffa.sim.result.board.length === 8, 'result board lists every player');
const scores = ffa.sim.result.board.map((p) => p.score);
ok(scores.every((v, i) => i === 0 || scores[i - 1] >= v), 'board sorted by score', scores.join(','));
ok(typeof ffa.sim.result.awards === 'object', 'awards computed');
ok(ffa.sim.result.board.every((p) => typeof p.title === 'string' && p.title.length >= 3), 'every pilot gets a fun title', ffa.sim.result.board.map((p) => p.title).join(' / '));
ok(new Set(ffa.sim.result.board.map((p) => p.title)).size >= 4, 'titles vary across the board');
ok(ffa.sim.result.duration >= 60, 'duration recorded', String(ffa.sim.result.duration.toFixed(1)));
ok(ffa.sim.snapshot().phase === 'over', 'post-match snapshot stays available');

console.log('\n[map] 48m 巨构废都 · 8 bots');
const giant = runMatch({ size: 48, seed: 5150, mode: 'ffa', duration: 75, eventRate: 'med', heatRate: 'standard' });
ok(giant.sim.phase === 'over', 'giant map match completes');
ok(giant.seen.badSnap === 0, 'giant map snapshots valid', String(giant.seen.badSnap));
ok(giant.arena.spawns.every((sp) => !pointBlocked(giant.arena, sp.x, sp.z, 0.8)), 'giant map spawns are clear');
ok(giant.arena.coolers.length >= 8 && giant.arena.acids.length >= 2, 'giant map has vents and acid', `${giant.arena.coolers.length} vents`);
const giantSnap = giant.sim.snapshot();
ok(giantSnap.players.every((p) => Math.abs(p.x) <= 24 && Math.abs(p.z) <= 24), 'giant map keeps everyone inside');

console.log('\n[team] 4v4');
const team = runMatch({ size: 40, seed: 77, mode: '4v4', duration: 75, eventRate: 'med', heatRate: 'standard' });
ok(team.sim.phase === 'over', 'team match ends');
ok(Object.keys(team.sim.result.teams).length === 2, 'two team scores', JSON.stringify(team.sim.result.teams));
ok(team.seen.badSnap === 0, 'team snapshots valid', String(team.seen.badSnap));

// ------------------------------------------------------------------ mechs
console.log('\n[mechs] every skill fires without errors');
for (const mech of MECH_IDS) {
  const arena = buildArena(20, 1234);
  const players = [
    { id: 'p1', name: 'T', color: '#fff', mech, team: 0, bot: false },
    { id: 'p2', name: 'D', color: '#fff', mech: 'guardian', team: 1, bot: false },
  ];
  const sim = new MatchSim({ arena, players, settings: { mode: 'ffa', duration: 60, eventRate: 'low', heatRate: 'standard', difficulty: 'normal' }, seed: 1234 });
  let skillCasts = 0, dashes = 0, items = 0;
  for (let i = 0; i < 60 * 30 && sim.phase !== 'over'; i++) {
    const doSkill = i % 90 === 20;
    const doDash = i % 47 === 0;
    const doItem = i % 130 === 40;
    if (doSkill) skillCasts++;
    if (doDash) dashes++;
    if (doItem) items++;
    sim.applyInput('p1', {
      mx: Math.sin(i / 30), mz: Math.cos(i / 41), aim: (i / 60) % 6.28,
      fire: i % 40 < 20, dash: doDash, skill: doSkill, useItem: doItem, seq: i,
    });
    sim.applyInput('p2', {
      mx: Math.cos(i / 25), mz: Math.sin(i / 37), aim: Math.PI + Math.sin(i / 20),
      fire: i % 33 < 16, dash: i % 61 === 0, skill: i % 100 === 30, useItem: i % 210 === 60, seq: i,
    });
    sim.step(1 / 60);
    if (i % 120 === 0) sim.snapshot();
  }
  const p1 = sim.players.get('p1');
  const snap = sim.snapshot();
  ok(snap.players.length === 2 && skillCasts > 10 && dashes > 10 && items > 5,
    `${mech} ran ${skillCasts} skills / ${dashes} dashes / ${items} items · heat ${p1.heat.toFixed(0)} · alive ${p1.alive}`);
  if (sim.phase === 'over') sim.endMatch();
}

// sudden death pressure
console.log('\n[storm] last 30 seconds');
const late = runMatch({ size: 20, seed: 5, mode: 'ffa', duration: 65, eventRate: 'low', heatRate: 'fast', bots: 4 });
ok(late.sim.phase === 'over', 'short match completes');
const stormSnaps = late.seen.phases.has('live');
ok(stormSnaps, 'match passes through the live phase');

console.log(failures === 0 ? '\nSIM TEST OK' : `\nSIM TEST FAILED (${failures})`);
process.exit(failures === 0 ? 0 : 1);
