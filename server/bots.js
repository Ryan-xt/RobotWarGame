import { BULLET, PLAYER_RADIUS, dist, clamp, normAngle, angleDiff } from '../shared/constants.js';
import { mechOf } from '../shared/mechs.js';
import { rayArena, hasLineOfSight } from '../shared/arena.js';

const TAU = Math.PI * 2;

function initBot(p) {
  p.botState = {
    targetId: null, retargetAt: 0, strafe: 1, strafeUntil: 0,
    aimErr: 0, aimErrTarget: 0, errAt: 0,
    burstUntil: 0, pauseUntil: 0,
    goal: null, goalAt: 0, reactionAt: 0, dodgeAt: 0,
    skillCoolUntil: 0, chatAt: 20 + Math.random() * 40,
    wander: 0, lookAt: 0,
    level: p.difficulty === 'easy' ? 0.5 : p.difficulty === 'hard' ? 1.25 : 1,
  };
  return p.botState;
}

function nearestCooler(sim, p) {
  let best = null, bd = Infinity;
  for (const c of sim.arena.coolers) {
    const d = dist(p.x, p.z, c.x, c.z);
    if (d < bd) { bd = d; best = c; }
  }
  return best;
}

function nearestItem(sim, p) {
  let best = null, bd = 11;
  for (const it of sim.items) {
    const d = dist(p.x, p.z, it.x, it.z);
    if (d < bd && ![...sim.players.values()].some((q) => q !== p && q.alive && dist(q.x, q.z, it.x, it.z) < 1.2)) {
      bd = d; best = it;
    }
  }
  return best;
}

function dangerAt(sim, x, z) {
  let danger = 0;
  for (const a of sim.arena.acids) if (dist(x, z, a.x, a.z) < a.r + 0.4) danger += 2;
  for (const zz of sim.zones) {
    if (sim.t < zz.bornAt) continue;
    if (zz.type === 'storm' && dist(x, z, zz.x, zz.z) < zz.r + 0.4) danger += 3;
  }
  for (const m of sim.markers) if (dist(x, z, m.x, m.z) < m.r + 0.4) danger += 3;
  for (const tw of sim.arena.towers) if (dist(x, z, tw.x, tw.z) < tw.zapR + 0.5 && tw.charging) danger += 0.6;
  return danger;
}

function avoidObstacle(sim, p, dx, dz) {
  // rotate the desired direction until a short probe is clear
  const base = Math.atan2(dz, dx);
  const offsets = [0, 0.55, -0.55, 1.05, -1.05, 1.7, -1.7, Math.PI];
  for (const off of offsets) {
    const a = base + off;
    const hit = rayArena(sim.arena, p.x, p.z, Math.cos(a), Math.sin(a), 2.6);
    if (hit.kind === 'none' || hit.d > 1.7) return { x: Math.cos(a), z: Math.sin(a) };
  }
  return { x: Math.cos(base + Math.PI), z: Math.sin(base + Math.PI) };
}

function moveToward(sim, p, goal) {
  const dx = goal.x - p.x, dz = goal.z - p.z;
  const d = Math.hypot(dx, dz);
  if (d < 0.4) return { mx: 0, mz: 0 };
  const dir = avoidObstacle(sim, p, dx / d, dz / d);
  return { mx: dir.x, mz: dir.z };
}

function pickTarget(sim, p, st) {
  let best = null, bd = Infinity;
  for (const q of sim.players.values()) {
    if (!q.alive || q.id === p.id) continue;
    if (sim.settings.mode !== 'ffa' && q.team === p.team) continue;
    let d = dist(p.x, p.z, q.x, q.z);
    if (!hasLineOfSight(sim.arena, p.x, p.z, q.x, q.z)) d += 5;
    if (d < bd) { bd = d; best = q; }
  }
  st.targetId = best ? best.id : null;
  return best;
}

export function updateBot(sim, p, dt) {
  const st = p.botState || initBot(p);
  const mech = mechOf(p.mech);
  const input = { mx: 0, mz: 0, aim: p.aim, fire: false, seq: 0 };
  const t = sim.t;
  if (!p.alive) return input;

  // Channeling coolant: stand still.
  if (p.channelEnd > t) {
    input.aim = p.aim;
    return input;
  }

  // periodic aim imperfection
  if (t > st.errAt) {
    st.errAt = t + 0.35 + Math.random() * 0.5;
    const base = 0.11 / st.level;
    st.aimErrTarget = (Math.random() * 2 - 1) * base;
  }
  st.aimErr += (st.aimErrTarget - st.aimErr) * Math.min(1, dt * 7);

  const target = pickTarget(sim, p, st);
  const inAcid = sim.arena.acids.some((a) => dist(p.x, p.z, a.x, a.z) < a.r + 0.3);
  const cooler = nearestCooler(sim, p);
  const coolerD = cooler ? dist(p.x, p.z, cooler.x, cooler.z) : Infinity;

  let goal = null;
  let wantFire = false;
  let aimPoint = target ? { x: target.x, z: target.z } : null;

  // -- item decisions
  if (p.item) {
    const type = p.item;
    if (type === 'coolant' && p.heat > 68) { p.pendingItem = true; return input; }
    if (type === 'purge' && p.heat > 55) { p.pendingItem = true; return input; }
    if (type === 'overclock' && target && dist(p.x, p.z, target.x, target.z) < 12 && p.heat < 55) p.pendingItem = true;
    if (type === 'grenade' && target) {
      const d = dist(p.x, p.z, target.x, target.z);
      if (d < 8.5 && d > 2 && hasLineOfSight(sim.arena, p.x, p.z, target.x, target.z) && Math.random() < dt * 0.35) {
        input.aim = Math.atan2(target.z - p.z, target.x - p.x);
        p.pendingItem = true;
        return input;
      }
    }
    if (type === 'plate' && p.heat > 45 && Math.random() < dt * 0.15) p.pendingItem = true;
    if (type === 'grapple' && target && p.heat > 72) {
      const d = dist(p.x, p.z, target.x, target.z);
      if (d > 2 && Math.random() < dt * 0.3) {
        input.aim = Math.atan2(target.z - p.z, target.x - p.x) + Math.PI;
        p.pendingItem = true;
      }
    }
  }

  // -- survival: cooling
  if (p.heat > 62 && cooler) {
    if (coolerD > 0.7) goal = { x: cooler.x, z: cooler.z };
    else goal = null; // stand in the cooler
  } else if (inAcid || dangerAt(sim, p.x, p.z) > 0) {
    const safe = nearestCooler(sim, p) || { x: 0, z: 0 };
    goal = { x: p.x * 0.4 + safe.x * 0.6, z: p.z * 0.4 + safe.z * 0.6 };
  } else if (!p.item && nearestItem(sim, p)) {
    const it = nearestItem(sim, p);
    if (dist(p.x, p.z, it.x, it.z) < 7) goal = it;
  }

  // -- dodge incoming bullets
  if (t > st.dodgeAt && p.dashCdUntil <= t) {
    for (const b of sim.bullets) {
      if (b.owner === p.id) continue;
      const d = dist(b.x, b.z, p.x, p.z);
      if (d > 4.2 || d < 0.6) continue;
      const sp = Math.hypot(b.vx, b.vz) || 1;
      const ttc = ((p.x - b.x) * b.vx + (p.z - b.z) * b.vz) / (sp * sp);
      if (ttc < 0 || ttc > 0.45) continue;
      const cx = b.x + b.vx * ttc, cz = b.z + b.vz * ttc;
      if (dist(cx, cz, p.x, p.z) < 1.15 && Math.random() < 0.5) {
        p.pendingDash = true;
        st.dodgeAt = t + 0.8;
        const away = Math.atan2(p.z - b.z, p.x - b.x);
        input.mx = Math.cos(away); input.mz = Math.sin(away);
        break;
      }
    }
  }

  if (target) {
    const td = dist(p.x, p.z, target.x, target.z);
    const los = hasLineOfSight(sim.arena, p.x, p.z, target.x, target.z);
    const mySpeed = BULLET.speed;
    const flight = td / mySpeed;
    const lead = { x: target.x + target.vx * flight * 0.85, z: target.z + target.vz * flight * 0.85 };
    if (los) aimPoint = lead;
    else aimPoint = { x: target.x, z: target.z };

    if (!goal) {
      // preferred engagement range by mech
      const prefs = { sniper: 11, grappler: 6, assault: 4.2, guardian: 5.5, miner: 7, furnace: 3.2 };
      const pref = prefs[p.mech] || 6;
      if (p.heat > 85) {
        goal = cooler;
      } else if (td > pref + 2.5) {
        goal = { x: target.x, z: target.z };
      } else if (td < pref - 2) {
        goal = { x: p.x - (target.x - p.x), z: p.z - (target.z - p.z) };
      } else {
        // strafe around the target
        if (t > st.strafeUntil) {
          st.strafe = Math.random() < 0.5 ? -1 : 1;
          st.strafeUntil = t + 0.9 + Math.random() * 1.6;
        }
        const a = Math.atan2(p.z - target.z, p.x - target.x) + Math.PI / 2 * st.strafe;
        goal = { x: p.x + Math.cos(a) * 3, z: p.z + Math.sin(a) * 3 };
        if (los && t > st.reactionAt) {
          // jitter aim while strafing
        }
      }
    }

    // fire control
    const isTargetVisible = los;
    const aimAngle = Math.atan2(aimPoint.z - p.z, aimPoint.x - p.x);
    if (isTargetVisible && td < 17) {
      if (t <= st.burstUntil) {
        wantFire = true;
      } else if (t > st.pauseUntil) {
        st.burstUntil = t + 0.5 + Math.random() * 0.9;
        st.pauseUntil = st.burstUntil + 0.18 + Math.random() * 0.45;
        wantFire = true;
      }
    }
    input.aim = normAngle(aimAngle + st.aimErr);
    p.botDesiredAim = input.aim;
    if (!isTargetVisible && los === false) {
      // still turn toward last known point
      input.aim = Math.atan2(target.z - p.z, target.x - p.x) + st.aimErr;
    }

    // skill use
    if (t > st.skillCoolUntil && p.skillCdUntil <= t && p.stunUntil < t) {
      let use = false;
      const aimAt = Math.atan2(target.z - p.z, target.x - p.x);
      if (p.mech === 'assault' && td < 4.2) { input.aim = aimAt; use = true; }
      else if (p.mech === 'grappler' && td > 2.5 && td < 9.5) { input.aim = aimAt; use = true; }
      else if (p.mech === 'guardian' && (p.heat > 62 || sim.bullets.some((b) => b.owner !== p.id && dist(b.x, b.z, p.x, p.z) < 2.6))) use = true;
      else if (p.mech === 'miner' && td > 3 && Math.random() < 0.6) use = true;
      else if (p.mech === 'sniper' && los && td > 6) use = true;
      else if (p.mech === 'furnace' && td < 3 && p.heat > 68 && Math.random() < 0.25) use = true;
      if (use) {
        p.pendingSkill = true;
        st.skillCoolUntil = t + 0.6;
      }
    }
  } else {
    // no enemy visible: patrol the middle
    if (!goal) goal = { x: (Math.random() - 0.5) * sim.arena.size * 0.5, z: (Math.random() - 0.5) * sim.arena.size * 0.5 };
    input.aim = st.lookAt += 0;
  }

  // -- cancel furnace fuse if nobody close
  if (p.mech === 'furnace' && p.fuseEnd > t) {
    const near = [...sim.players.values()].some((q) => q.alive && q.id !== p.id && dist(q.x, q.z, p.x, p.z) < 4);
    if (!near) p.pendingSkill = true;
  }

  if (goal) {
    const mv = moveToward(sim, p, goal);
    input.mx = mv.mx; input.mz = mv.mz;
    // avoid running blindly while shooting: slow strafing handled by motion
    if (p.heat > 95) { input.fire = false; }
  }
  input.fire = wantFire;
  if (p.stunUntil > t) { input.mx = 0; input.mz = 0; }
  if (p.heat >= 100) input.fire = false;

  // Face movement direction when not engaging.
  if (!target) input.aim = Math.atan2(p.vz, p.vx) || p.aim;

  // clamp goal inside arena bounds by motion collision anyway; nothing else.
  return input;
}
