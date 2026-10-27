import { PLAYER_SPEED, PLAYER_ACCEL, PLAYER_FRICTION } from './constants.js';

// Shared motion integration used by the authoritative sim and by client-side
// prediction. Keep this deterministic and free of side effects.
export function stepMotion(p, input, dt, mods = {}) {
  const stunned = !!mods.stunned;
  const immobile = !!mods.immobile;
  let mx = input.mx || 0;
  let mz = input.mz || 0;
  const len = Math.hypot(mx, mz);
  if (len > 1) { mx /= len; mz /= len; }
  if (stunned || immobile) { mx = 0; mz = 0; }

  const maxSpeed = PLAYER_SPEED * (mods.speedMult ?? 1);
  const accel = (PLAYER_ACCEL * (mods.accelMult ?? 1));
  const tx = mx * maxSpeed;
  const tz = mz * maxSpeed;

  if (mods.overrideVel) {
    p.vx = mods.overrideVel.x;
    p.vz = mods.overrideVel.z;
  } else {
    const ax = tx - p.vx;
    const az = tz - p.vz;
    const alen = Math.hypot(ax, az);
    if (alen > 1e-5) {
      const rate = (mx === 0 && mz === 0) || stunned ? PLAYER_FRICTION * (mods.frictionMult ?? 1) : accel;
      const step = Math.min(alen, rate * dt);
      p.vx += (ax / alen) * step;
      p.vz += (az / alen) * step;
    }
  }
  p.x += p.vx * dt;
  p.z += p.vz * dt;
  return p;
}

export function speedFactorForHeat(heat) {
  if (heat >= 90) return 0.85;
  if (heat >= 70) return 0.90;
  if (heat >= 40) return 0.97;
  return 1;
}
