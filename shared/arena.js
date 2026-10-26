import { makeRng } from './constants.js';

// ---------------------------------------------------------------------------
// Symmetric wasteland arena generation. Layouts are described in one quadrant
// and mirrored so every match is visually noisy but perfectly fair.
// ---------------------------------------------------------------------------

const LAYOUTS = {
  20: {
    quad: [
      { type: 'plate', x: 0.24, z: 0.13, r: 1.1 },
      { type: 'wall', x: 0.32, z: 0.23, w: 0.7, h: 2.7 },
      { type: 'cooler', x: 0.33, z: 0.33, r: 2.0 },
    ],
    pairX: [
      { type: 'wall', x: 0.12, z: 0.34, w: 3.2, h: 0.7 },
      { type: 'acid', x: 0.37, z: 0.04, r: 2.0 },
    ],
    pairZ: [
      { type: 'tower', x: 0.0, z: 0.31, r: 0.92 },
    ],
    single: [],
    // duel arena: two acid runoffs keep the rim honest
    pairX2: [],
  },
  30: {
    quad: [
      { type: 'plate', x: 0.24, z: 0.12, r: 1.22 },
      { type: 'plate', x: 0.06, z: 0.34, r: 1.22 },
      { type: 'wall', x: 0.32, z: 0.24, w: 0.7, h: 2.9 },
      { type: 'wall', x: 0.15, z: 0.34, w: 3.2, h: 0.7 },
      { type: 'cooler', x: 0.34, z: 0.34, r: 2.2 },
    ],
    pairX: [
      { type: 'acid', x: 0.36, z: 0.02, r: 2.35 },
    ],
    pairZ: [
      { type: 'tower', x: 0.0, z: 0.32, r: 0.95 },
      { type: 'plate', x: 0.40, z: 0.10, r: 1.2 },
    ],
    single: [],
  },
  40: {
    quad: [
      { type: 'plate', x: 0.25, z: 0.10, r: 1.35 },
      { type: 'plate', x: 0.08, z: 0.36, r: 1.35 },
      { type: 'plate', x: 0.42, z: 0.21, r: 1.3 },
      { type: 'wall', x: 0.33, z: 0.25, w: 0.75, h: 3.2 },
      { type: 'wall', x: 0.16, z: 0.35, w: 3.4, h: 0.75 },
      { type: 'wall', x: 0.30, z: 0.40, w: 2.4, h: 0.7 },
      { type: 'cooler', x: 0.36, z: 0.36, r: 2.35 },
      { type: 'cooler', x: 0.31, z: 0.05, r: 2.1 },
    ],
    pairX: [
      { type: 'acid', x: 0.38, z: 0.02, r: 2.6 },
      { type: 'acid', x: 0.22, z: 0.41, r: 2.2 },
    ],
    pairZ: [
      { type: 'tower', x: 0.02, z: 0.33, r: 0.98 },
      { type: 'tower', x: 0.38, z: 0.33, r: 0.98 },
    ],
    single: [],
  },
};

function scaleType(entry, size) {
  const s = size;
  return { ...entry, x: entry.x * s, z: entry.z * s };
}

export function buildArena(size, seed) {
  const rng = makeRng(seed);
  const half = size / 2;
  const layout = LAYOUTS[size] || LAYOUTS[40];
  const arena = {
    size, half, seed,
    walls: [], plates: [], towers: [], coolers: [], acids: [], spawns: [], pads: [], props: [],
    platform: { x: 0, z: 0, r: size >= 30 ? 4.4 : 3.8 },
  };

  let id = 0;
  const addQuad = (e) => {
    for (const [sx, sz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
      add({ ...scaleType(e, size), x: e.x * size * sx, z: e.z * size * sz });
    }
  };
  const addPairX = (e) => {
    for (const sx of [1, -1]) add({ ...scaleType(e, size), x: e.x * size * sx });
  };
  const addPairZ = (e) => {
    for (const sz of [1, -1]) add({ ...scaleType(e, size), z: e.z * size * sz });
  };
  const add = (e) => {
    if (e.type === 'plate') arena.plates.push({ id: id++, x: e.x, z: e.z, r: e.r, kind: 'plate' });
    else if (e.type === 'wall') arena.walls.push({
      id: id++, x: e.x, z: e.z, w: e.w, h: e.h, hp: 3, maxHp: 3, alive: true,
      rubbleUntil: 0, angle: rng() * 0.05,
    });
    else if (e.type === 'tower') arena.towers.push({
      id: id++, x: e.x, z: e.z, r: e.r, zapR: 2.75, phase: rng() * 4.2,
    });
    else if (e.type === 'cooler') arena.coolers.push({ id: id++, x: e.x, z: e.z, r: e.r });
    else if (e.type === 'acid') arena.acids.push({ id: id++, x: e.x, z: e.z, r: e.r });
  };

  for (const e of layout.single) add(scaleType(e, size));
  for (const e of layout.pairX) addPairX(e);
  for (const e of layout.pairZ) addPairZ(e);
  for (const e of layout.quad) addQuad(e);

  // A couple of extra coolers on the big map so 8 players can survive the storm.
  if (size >= 40) {
    arena.coolers.push({ id: id++, x: 0, z: 0.28 * size, r: 2.0 });
    arena.coolers.push({ id: id++, x: 0, z: -0.28 * size, r: 2.0 });
  }

  // High-value item pads + center purge spawn.
  arena.pads.push({ id: 'pad-center', x: 0, z: 0, center: true });
  const padRing = size >= 40 ? 0.28 : 0.23;
  for (let i = 0; i < 4; i++) {
    const a = Math.PI / 4 + i * Math.PI / 2;
    arena.pads.push({ id: 'pad-' + i, x: Math.cos(a) * size * padRing, z: Math.sin(a) * size * padRing });
  }
  if (size >= 40) {
    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 2;
      arena.pads.push({ id: 'pado-' + i, x: Math.cos(a) * size * 0.44, z: Math.sin(a) * size * 0.44 });
    }
  }
  // Drop pads that landed inside an obstacle.
  arena.pads = arena.pads.filter((p) => p.center || !pointBlocked(arena, p.x, p.z, 0.5));

  // Spawn ring: 24 candidates, filter blocked, pick 8 spread evenly.
  const candidates = [];
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2 + 0.13;
    for (const rr of [0.445, 0.40, 0.47]) {
      const x = Math.cos(a) * size * rr;
      const z = Math.sin(a) * size * rr;
      if (!pointBlocked(arena, x, z, 1.15)) {
        candidates.push({ x, z, a, rr });
        break;
      }
    }
  }
  // prefer outer ring & unique angles
  const chosen = [];
  const step = Math.max(1, Math.floor(candidates.length / 8));
  for (let i = 0; i < candidates.length && chosen.length < 8; i += step) chosen.push(candidates[i]);
  for (let i = 0; i < candidates.length && chosen.length < 8; i++) {
    if (!chosen.includes(candidates[i])) chosen.push(candidates[i]);
  }
  while (chosen.length < 8) {
    const a = chosen.length * Math.PI / 4;
    chosen.push({ x: Math.cos(a) * size * 0.44, z: Math.sin(a) * size * 0.44 });
  }
  arena.spawns = chosen.slice(0, 8).map((s) => ({ x: s.x, z: s.z }));

  // Purely decorative props outside the playable rims / near walls.
  for (let i = 0; i < 26; i++) {
    const a = rng() * Math.PI * 2;
    const rad = half + 1.5 + rng() * 7;
    arena.props.push({
      x: Math.cos(a) * rad, z: Math.sin(a) * rad,
      kind: ['barrel', 'pipe', 'scrap', 'tank'][Math.floor(rng() * 4)],
      rot: rng() * Math.PI, s: 0.7 + rng() * 1.1,
    });
  }
  return arena;
}

export function pointBlocked(arena, x, z, pad = 0) {
  for (const w of arena.walls) {
    if (!w.alive) continue;
    if (circleAabbOverlap(x, z, pad, w)) return true;
  }
  for (const t of arena.towers) if (Math.hypot(x - t.x, z - t.z) < t.r + pad) return true;
  for (const p of arena.plates) if (Math.hypot(x - p.x, z - p.z) < p.r + pad) return true;
  if (Math.hypot(x, z) < arena.platform.r * 0.55) return true;
  return Math.abs(x) > arena.half - pad || Math.abs(z) > arena.half - pad;
}

function circleAabbOverlap(cx, cz, r, w) {
  const hx = w.w / 2, hz = w.h / 2;
  const dx = Math.max(Math.abs(cx - w.x) - hx, 0);
  const dz = Math.max(Math.abs(cz - w.z) - hz, 0);
  return dx * dx + dz * dz < r * r;
}

function resolveCircleAabb(p, r, w) {
  const hx = w.w / 2, hz = w.h / 2;
  const dx = p.x - w.x, dz = p.z - w.z;
  const clampedX = Math.max(-hx, Math.min(hx, dx));
  const clampedZ = Math.max(-hz, Math.min(hz, dz));
  let nx = dx - clampedX, nz = dz - clampedZ;
  let d = Math.hypot(nx, nz);
  if (d >= r) return false;
  if (d < 1e-5) {
    // Inside the box: push out along the closest face.
    const ox = hx + r - Math.abs(dx);
    const oz = hz + r - Math.abs(dz);
    if (ox < oz) { p.x += Math.sign(dx || 1) * ox; p.z = p.z; }
    else { p.z += Math.sign(dz || 1) * oz; }
    return true;
  }
  const push = r - d;
  p.x += (nx / d) * push;
  p.z += (nz / d) * push;
  return true;
}

// Resolve a circle (player/mine) against static arena geometry.
export function resolvePlayerArena(arena, p, r) {
  let hit = false;
  for (const w of arena.walls) {
    if (!w.alive) continue;
    if (resolveCircleAabb(p, r, w)) hit = true;
  }
  for (const t of arena.towers) {
    const dx = p.x - t.x, dz = p.z - t.z;
    const d = Math.hypot(dx, dz), min = t.r + r;
    if (d < min && d > 1e-5) {
      p.x = t.x + (dx / d) * min;
      p.z = t.z + (dz / d) * min;
      hit = true;
    }
  }
  for (const pl of arena.plates) {
    const dx = p.x - pl.x, dz = p.z - pl.z;
    const d = Math.hypot(dx, dz), min = pl.r + r;
    if (d < min && d > 1e-5) {
      p.x = pl.x + (dx / d) * min;
      p.z = pl.z + (dz / d) * min;
      hit = true;
    }
  }
  for (const sh of arena.dynamicPlates || []) {
    if (sh.hp <= 0) continue;
    const dx = p.x - sh.x, dz = p.z - sh.z;
    const d = Math.hypot(dx, dz), min = sh.r + r;
    if (d < min && d > 1e-5) {
      p.x = sh.x + (dx / d) * min;
      p.z = sh.z + (dz / d) * min;
      hit = true;
    }
  }
  p.x = Math.max(-arena.half + r, Math.min(arena.half - r, p.x));
  p.z = Math.max(-arena.half + r, Math.min(arena.half - r, p.z));
  return hit;
}

// Ray vs arena (for hooks, line-of-sight, bots). Returns nearest hit.
export function rayArena(arena, x, z, dx, dz, maxDist, ignorePlayers = null) {
  let best = { d: maxDist, kind: 'none', nx: 0, nz: 0, target: null };
  for (const w of arena.walls) {
    if (!w.alive) continue;
    const hit = rayAabb(x, z, dx, dz, w.x, w.z, w.w / 2, w.h / 2, best.d);
    if (hit && hit.t < best.d) best = { d: hit.t, kind: 'wall', nx: hit.nx, nz: hit.nz, target: w };
  }
  for (const t of arena.towers) {
    const hit = rayCircle(x, z, dx, dz, t.x, t.z, t.r, best.d);
    if (hit && hit.t < best.d) best = { d: hit.t, kind: 'tower', nx: hit.nx, nz: hit.nz, target: t };
  }
  for (const p of arena.plates) {
    const hit = rayCircle(x, z, dx, dz, p.x, p.z, p.r, best.d);
    if (hit && hit.t < best.d) best = { d: hit.t, kind: 'plate', nx: hit.nx, nz: hit.nz, target: p };
  }
  for (const sh of arena.dynamicPlates || []) {
    if (sh.hp <= 0) continue;
    const hit = rayCircle(x, z, dx, dz, sh.x, sh.z, sh.r, best.d);
    if (hit && hit.t < best.d) best = { d: hit.t, kind: 'plate', nx: hit.nx, nz: hit.nz, target: sh };
  }
  // boundary
  const tbx = dx > 0 ? (arena.half - x) / dx : dx < 0 ? (-arena.half - x) / dx : Infinity;
  const tbz = dz > 0 ? (arena.half - z) / dz : dz < 0 ? (-arena.half - z) / dz : Infinity;
  const tb = Math.min(tbx, tbz);
  if (tb < best.d && tb > 0) best = { d: tb, kind: 'wall', nx: 0, nz: 0, target: null };
  return best;
}

function rayAabb(ox, oz, dx, dz, cx, cz, hx, hz, maxT) {
  let tmin = 0, tmax = maxT;
  let nx = 0, nz = 0;
  for (const [o, d, c, h, axis] of [[ox, dx, cx, hx, 'x'], [oz, dz, cz, hz, 'z']]) {
    if (Math.abs(d) < 1e-8) {
      if (Math.abs(o - c) > h) return null;
    } else {
      let t1 = (c - h - o) / d, t2 = (c + h - o) / d;
      let n1 = -1, n2 = 1;
      if (t1 > t2) { [t1, t2] = [t2, t1]; n1 = 1; n2 = -1; }
      if (t1 > tmin) { tmin = t1; if (axis === 'x') { nx = n1; nz = 0; } else { nx = 0; nz = n1; } }
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return null;
    }
  }
  if (tmin <= 0 || tmin > maxT) return null;
  return { t: tmin, nx, nz };
}

function rayCircle(ox, oz, dx, dz, cx, cz, r, maxT) {
  const fx = ox - cx, fz = oz - cz;
  const b = 2 * (fx * dx + fz * dz);
  const c = fx * fx + fz * fz - r * r;
  const disc = b * b - 4 * c;
  if (disc < 0) return null;
  const sq = Math.sqrt(disc);
  let t = (-b - sq) / 2;
  if (t < 0) t = (-b + sq) / 2;
  if (t < 0 || t > maxT) return null;
  const px = ox + dx * t - cx, pz = oz + dz * t - cz;
  const l = Math.hypot(px, pz) || 1;
  return { t, nx: px / l, nz: pz / l };
}

export function hasLineOfSight(arena, x1, z1, x2, z2) {
  const dx = x2 - x1, dz = z2 - z1;
  const len = Math.hypot(dx, dz);
  if (len < 1e-4) return true;
  const hit = rayArena(arena, x1, z1, dx / len, dz / len, len - 0.2);
  return hit.kind === 'none';
}

export function arenaSummary(arena) {
  return {
    size: arena.size, half: arena.half, seed: arena.seed,
    walls: arena.walls.map((w) => ({ id: w.id, x: w.x, z: w.z, w: w.w, h: w.h, hp: w.hp, maxHp: w.maxHp, alive: w.alive })),
    plates: arena.plates, towers: arena.towers, coolers: arena.coolers, acids: arena.acids,
    spawns: arena.spawns, pads: arena.pads, platform: arena.platform, props: arena.props,
  };
}
