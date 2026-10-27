import {
  BULLET, DASH, HEAT, PLAYER_RADIUS, RESPAWN_TIME, PLAYER_COLORS,
  clamp, lerp, makeRng, dist, angleDiff, normAngle, EVENT_META,
} from '../shared/index.js';
import { mechOf } from '../shared/mechs.js';
import { resolvePlayerArena, rayArena, hasLineOfSight, pointBlocked } from '../shared/arena.js';
import { stepMotion, speedFactorForHeat } from '../shared/motion.js';
import { updateBot } from './bots.js';

let nextEntityId = 1000;

export function makeInput() {
  return { mx: 0, mz: 0, aim: 0, fire: false, seq: 0 };
}

export function emptyStats() {
  return {
    kills: 0, deaths: 0, assists: 0, bounceHits: 0, bounceDamage: 0,
    topHeatSurvival: 0, coolerTime: 0, clawHits: 0, explosionHits: 0,
    selfDestructKills: 0, damageDealt: 0, shots: 0, hits: 0, longestLife: 0,
  };
}

function arenaHazard(arena, x, z) {
  if (arena.acids.some((a) => Math.hypot(a.x - x, a.z - z) < a.r + 0.6)) return true;
  if (arena.coolers.some((c) => Math.hypot(c.x - x, c.z - z) < c.r + 0.4)) return true;
  if (arena.towers.some((t) => Math.hypot(t.x - x, t.z - z) < t.r + 1.2)) return true;
  return false;
}

export function createPlayer(info, index) {
  const mech = mechOf(info.mech);
  return {
    id: info.id, name: info.name, color: info.color || PLAYER_COLORS[index % 8].hex,
    colorId: info.colorId || PLAYER_COLORS[index % 8].id,
    mech: mech.id, team: info.team ?? index % 2, bot: !!info.bot, difficulty: info.difficulty || 'normal',
    isHost: !!info.isHost,
    x: 0, z: 0, vx: 0, vz: 0, aim: -Math.PI / 2, facing: -Math.PI / 2,
    heat: 0, alive: true, invulnUntil: 0, respawnAt: 0, spawnIdx: index % 8,
    score: 0, ammo: BULLET.magSize, reloadingUntil: 0, nextFireAt: 0,
    fireHeldSince: -1, fireLocked: false, chargeT: 0,
    dashUntil: 0, dashCdUntil: 0, dashDirX: 0, dashDirZ: 0,
    iframeUntil: 0, skillCdUntil: 0, skillState: null, skillHold: false,
    item: null, channelEnd: 0, channelType: null,
    overclockUntil: 0, slowUntil: 0, stunUntil: 0,
    shieldUntil: 0, shieldReflected: 0,
    pullUntil: 0, pullX: 0, pullZ: 0, pullDur: 0,
    mineCount: 0,
    fuseEnd: 0,
    lastDamageAt: -99, lastHeatAt: -99,
    lastHitters: new Map(),
    stats: emptyStats(),
    input: makeInput(),
    lastInputAt: 0, pendingDash: false, pendingSkill: false, pendingItem: false,
    disconnected: false, reconnectUntil: 0, connectedAt: 0,
    inCooler: false, inAcid: false, inStorm: false, inLeak: false,
    hitsTaken: 0, lastAttacker: null,
  };
}

export class MatchSim {
  constructor({ arena, players, settings, seed, now = 0, tutorial = false }) {
    this.arena = arena;
    this.arena.dynamicPlates = [];
    this.settings = settings;
    this.rng = makeRng(seed);
    // Items roll on their own stream: adding supply drops must never reshuffle
    // the event / bot randomness of an otherwise identical match.
    this.itemRng = makeRng((seed ^ 0x9e3779b9) >>> 0);
    this.seed = seed;
    this.t = 0;
    this.tick = 0;
    this.phase = 'countdown';
    this.duration = settings.duration || 180;
    this.countdown = 3.2;
    this.players = new Map();
    this.order = [];
    for (let i = 0; i < players.length; i++) {
      const p = createPlayer(players[i], i);
      this.players.set(p.id, p);
      this.order.push(p.id);
    }
    this.stormStart = this.duration - this.suddenDeathSeconds();
    this.bullets = [];
    this.bulletsById = new Map();
    this.grenades = [];
    this.mines = [];
    this.items = [];
    this.zones = []; // storm / leak
    this.markers = []; // claw warning
    this.fx = [];
    this.fxAll = [];
    this.nextEventAt = 16 + this.rng() * 6;
    this.nextItemAt = 2.2;
    this.lastItemSpawnAt = 0;
    this.itemSerial = 0;
    // Practice/tutorial sims respawn instantly instead of making the player
    // watch a 10 s timer (the server never sets this flag).
    this.respawnTime = tutorial ? 1.6 : RESPAWN_TIME;
    this.airdrop = null;
    this.stormActive = false;
    this.eventBanner = null;
    this.eventCount = 0;
    this.sandstormUntil = 0;
    this.lastStormTick = {};
    this.over = false;
    this.finishedAt = 0;
    const n = this.order.length;
    this.scaling = {
      heatMult: n <= 2 ? 1.25 : n <= 4 ? 1.0 : 0.83,
      bounceBonus: n <= 2 ? 0.25 : n <= 4 ? 0.20 : 0.15,
      eventBase: n <= 2 ? 36 : n <= 4 ? 27 : 21,
      itemMax: n <= 2 ? 4 : n <= 4 ? 6 : 9,
      pickupInterval: n <= 2 ? 9 : n <= 4 ? 7 : 6,
    };
    if (settings.heatRate === 'slow') this.scaling.heatMult *= 0.8;
    if (settings.heatRate === 'fast') this.scaling.heatMult *= 1.2;
    // What the room's difficulty actually means: on 简单 the bots hit softer
    // (not only less often), so a first-time player is not deleted instantly.
    this.botHeatMult = settings.difficulty === 'easy' ? 0.72 : settings.difficulty === 'hard' ? 1.12 : 1;
    this.eventRateMult = settings.eventRate === 'low' ? 1.35 : settings.eventRate === 'high' ? 0.68 : 1;
    this.itemUsePulse = new Map();
    this._spawnAll();
  }

  /** Current spawn positions, so clients place the mechs where the sim did. */
  spawnState() {
    const out = [];
    for (const p of this.players.values()) {
      out.push({ id: p.id, x: round2(p.x), z: round2(p.z), aim: round3(p.aim) });
    }
    return out;
  }

  suddenDeathSeconds() {
    const n = this.order.length;
    if (this.settings.stormLength) return this.settings.stormLength;
    return n <= 2 ? 15 : n <= 4 ? 20 : 30;
  }

  _spawnAll() {
    const spawns = this.arena.spawns;
    const start = Math.floor(this.rng() * spawns.length);
    let i = 0;
    for (const id of this.order) {
      const p = this.players.get(id);
      const s = spawns[(start + i * Math.max(1, Math.floor(spawns.length / this.order.length))) % spawns.length];
      this._placeAtSpawn(p, s);
      p.facing = Math.atan2(-s.x, -s.z);
      p.aim = p.facing;
      p.invulnUntil = HEAT.spawnInvuln;
      i++;
    }
  }

  _placeAtSpawn(p, s) {
    p.x = s.x; p.z = s.z; p.vx = 0; p.vz = 0;
    p.alive = true; p.heat = 0; p.ammo = BULLET.magSize;
    p.channelEnd = 0; p.channelType = null; p.fuseEnd = 0;
    p.overclockUntil = 0; p.stunUntil = 0; p.slowUntil = 0;
    p.dashUntil = 0; p.iframeUntil = 0; p.pullUntil = 0;
    p.skillState = null; p.shieldUntil = 0;
    p.fireHeldSince = -1; p.fireLocked = false; p.chargeT = 0;
    p.mineCount = 0;
    p.stats.topHeatSurvival = 0;
    p.lastHitters.clear();
  }

  get(id) { return this.players.get(id); }

  fxEmit(e) {
    e.t = this.t;
    this.fx.push(e);
    this.fxAll.push(e);
    if (this.fxAll.length > 400) this.fxAll.shift();
    if (this.onFx) this.onFx(e);
  }

  // ------------------------------------------------------------------ input
  applyInput(id, msg) {
    const p = this.players.get(id);
    if (!p || p.bot) return;
    const now = this.t;
    if (now - p.lastInputAt > 0.75) {
      // Gate stale inputs so a dragging connection cannot teleport.
      p.input = { ...p.input, mx: 0, mz: 0, fire: false };
    }
    p.lastInputAt = now;
    p.input = {
      mx: clamp(Number(msg.mx) || 0, -1, 1),
      mz: clamp(Number(msg.mz) || 0, -1, 1),
      aim: Number(msg.aim) || 0,
      fire: !!msg.fire,
      seq: msg.seq | 0,
    };
    if (msg.dash) p.pendingDash = true;
    if (msg.skill) p.pendingSkill = true;
    if (msg.useItem) p.pendingItem = true;
    p.disconnected = false;
  }

  // ---------------------------------------------------------------- helpers
  speedMult(p) {
    const mech = mechOf(p.mech);
    let m = mech.stats.speed;
    m *= speedFactorForHeat(p.heat);
    if (p.inAcid) m *= 0.8;
    if (p.stunUntil > this.t) m = 0;
    if (p.skillState && p.skillState.type === 'sniperCharge') m *= 0.8;
    if (p.channelEnd > this.t) m = 0;
    return m;
  }

  coolRate(p) {
    const mech = mechOf(p.mech);
    let r = 1;
    if (mech.id === 'guardian') r *= 1.2;
    return r;
  }

  heatMultFor(p) {
    let m = mechOf(p.mech).stats.heat;
    if (p.overclockUntil > this.t) m *= 1.5;
    if (p.stats && p.mech === 'assault') m *= 0.9;
    return m;
  }

  addHeat(p, amount, source, attackerId = null, opts = {}) {
    if (!p.alive || this.phase === 'over') return;
    if (p.invulnUntil > this.t) return;
    if (amount <= 0) return;
    if (this.settings.mode !== 'ffa' && attackerId != null && attackerId !== p.id) {
      const a = this.players.get(attackerId);
      if (a && a.team === p.team && this.settings.friendlyFire !== true) return;
    }
    let mult = this.heatMultFor(p);
    if (opts.ignoreMult) mult = 1;
    let applied = amount * mult;
    // AI difficulty scales how much a bot's hit costs (rooms with AI only)
    if (attackerId != null && this.botHeatMult !== 1) {
      const src = this.players.get(attackerId);
      if (src && src.bot) applied *= this.botHeatMult;
    }
    p.heat = Math.min(100, p.heat + applied);
    p.lastHeatAt = this.t;
    p.hitsTaken++;
    if (attackerId != null) {
      p.lastAttacker = attackerId;
      const attacker = this.players.get(attackerId);
      if (attacker) {
        attacker.lastHitters.set(p.id, this.t);
        p.lastHitters.set(attackerId, this.t);
        attacker.stats.damageDealt += applied;
      }
    }
    if (!opts.silent) {
      this.fxEmit({
        e: 'heatHit', x: p.x, z: p.z, id: p.id, amount: Math.round(applied),
        source, attacker: attackerId, bounced: !!opts.bounced,
      });
    }
    if (p.heat >= HEAT.max) this.shortCircuit(p, attackerId, source, opts);
  }

  shortCircuit(p, attackerId, source, opts = {}) {
    if (!p.alive) return;
    const mech = mechOf(p.mech);
    const isFurnace = mech.id === 'furnace';
    const radius = HEAT.explosionRadius * (isFurnace ? 1.5 : 1) * (opts.radiusMult || 1);
    p.alive = false;
    p.heat = 100;
    p.respawnAt = this.t + (this.respawnTime || RESPAWN_TIME);
    p.stats.deaths++;
    p.stats.longestLife = Math.max(p.stats.longestLife, this.t - (p.spawnedAt || 0));
    p.channelEnd = 0; p.fuseEnd = 0; p.skillState = null; p.shieldUntil = 0;
    p.invulnUntil = 0; p.dashUntil = 0; p.iframeUntil = 0;

    const suicide = attackerId == null || attackerId === p.id;
    if (!suicide) {
      const killer = this.players.get(attackerId);
      if (killer) {
        killer.score += 1;
        killer.stats.kills++;
        if (isFurnace && (source === 'furnace' || opts.chainSource === 'furnace')) killer.stats.selfDestructKills++;
      }
    }
    if (!suicide) p.score -= 1;

    // assist scoring
    for (const [aid, at] of p.lastHitters) {
      if (aid === attackerId || this.t - at > 6) continue;
      const assister = this.players.get(aid);
      if (assister) { assister.score += 0.5; assister.stats.assists++; }
    }

    this.fxEmit({
      e: 'shortCircuit', x: p.x, z: p.z, id: p.id, radius,
      color: p.color, killer: attackerId, source, furnace: isFurnace && opts.selfDestruct,
    });
    // shockwave heat + knockback
    for (const other of this.players.values()) {
      if (!other.alive || other.id === p.id) continue;
      const d = dist(other.x, other.z, p.x, p.z);
      if (d <= radius) {
        const falloff = 1 - (d / radius) * 0.45;
        this.addHeat(other, HEAT.explosionHeat * falloff, 'explosion', p.id, { chainSource: source });
        this.knockback(other, other.x - p.x, other.z - p.z, 9);
        if (attackerId === p.id || attackerId == null) { /* self-destruct chain */ }
        if (p.id != null) {
          const self = this.players.get(p.id);
          if (self) self.stats.explosionHits++;
        }
      }
    }
    if (p.input) p.input.fire = false;
    this.checkMatchEnd();
  }

  knockback(p, dx, dz, strength) {
    const l = Math.hypot(dx, dz) || 1;
    p.vx += (dx / l) * strength;
    p.vz += (dz / l) * strength;
  }

  // ------------------------------------------------------------------- step
  step(dt) {
    this.t += dt;
    this.tick++;
    if (this.phase === 'countdown') {
      this.countdown -= dt;
      if (this.countdown <= 0) {
        this.phase = 'live';
        for (const p of this.players.values()) {
          p.spawnedAt = this.t;
          p.invulnUntil = this.t + HEAT.spawnInvuln;
          p.fireHeldSince = -1;
          p.nextFireAt = this.t + 0.25;
        }
        this.fxEmit({ e: 'matchLive' });
      }
      return;
    }
    if (this.phase === 'over') return;

    this.stormActive = this.t >= this.stormStart;
    if (this.stormActive && !this.stormAnnounced) {
      this.stormAnnounced = true;
      this.fxEmit({ e: 'suddenDeath' });
      this.eventBanner = { type: 'storm', until: this.t + 3.5 };
    }

    if (this.t >= this.duration) { this.endMatch(); return; }

    for (const p of this.players.values()) this.stepPlayer(p, dt);
    this.stepBullets(dt);
    this.stepGrenades(dt);
    this.stepMines(dt);
    this.stepZones(dt);
    this.stepTowers(dt);
    this.stepItems(dt);
    this.stepEvents(dt);
    this.stepDynamicPlates(dt);
    this.stepRespawns(dt);
    if (this.t % 1 < dt) this.cleanup();
  }

  stepPlayer(p, dt) {
    if (!p.alive) return;
    if (p.bot) {
      const botInput = updateBot(this, p, dt);
      if (botInput) {
        // edge triggers from bot go through pending flags set in updateBot
        p.input = botInput;
      }
    }
    if (!p.bot && this.t - p.lastInputAt > 0.75) {
      p.input.mx = 0; p.input.mz = 0; p.input.fire = false;
    }

    p.aim = p.input.aim;
    if (p.pullUntil > this.t) {
      // grapple pull interpolation
      const rem = Math.max(0, p.pullUntil - this.t);
      const k = rem > 0 ? 1 - Math.min(1, dt / Math.max(0.016, rem)) : 0;
      p.x = lerp(p.x, p.pullX, dt * 12);
      p.z = lerp(p.z, p.pullZ, dt * 12);
      p.vx = 0; p.vz = 0;
      resolvePlayerArena(this.arena, p, PLAYER_RADIUS);
      this.afterMove(p);
      return;
    }

    // dash
    if (p.pendingDash) {
      p.pendingDash = false;
      if (this.t >= p.dashCdUntil && p.stunUntil <= this.t && p.channelEnd <= this.t) {
        const mv = Math.hypot(p.input.mx, p.input.mz);
        const dx = mv > 0.1 ? p.input.mx / mv : Math.cos(p.aim);
        const dz = mv > 0.1 ? p.input.mz / mv : Math.sin(p.aim);
        p.dashDirX = dx; p.dashDirZ = dz;
        p.dashUntil = this.t + DASH.duration;
        p.dashCdUntil = this.t + DASH.cooldown;
        p.iframeUntil = this.t + DASH.iframes;
        p.channelEnd = 0;
        this.fxEmit({ e: 'dash', x: p.x, z: p.z, dx, dz, id: p.id });
      }
    }

    // skill
    if (p.pendingSkill) {
      p.pendingSkill = false;
      this.useSkill(p);
    }

    // item use
    if (p.pendingItem) {
      p.pendingItem = false;
      this.useItem(p);
    }

    let override = null;
    if (p.dashUntil > this.t) {
      const sp = DASH.distance / DASH.duration * 1.02;
      override = { x: p.dashDirX * sp, z: p.dashDirZ * sp };
    }
    if (p.skillState && p.skillState.type === 'charge') {
      // Hold the state locally: hitting someone can explode a reactor and stun
      // (or kill) the very mech that is charging, which nulls p.skillState in
      // the middle of the loop. Reading it through the player object then threw
      // a TypeError and took the whole match down with it.
      const sk = p.skillState;
      if (sk.until > this.t) {
        const sp = 3.5 / 0.24;
        override = { x: sk.dirX * sp, z: sk.dirZ * sp };
        p.iframeUntil = Math.max(p.iframeUntil, this.t + 0.05);
        for (const q of this.players.values()) {
          if (p.skillState !== sk) break; // charge was interrupted mid-loop
          if (!q.alive || q.id === p.id || sk.hitIds.has(q.id)) continue;
          if (this.settings.mode !== 'ffa' && q.team === p.team) continue;
          if (dist(p.x, p.z, q.x, q.z) < PLAYER_RADIUS * 2 + 0.55) {
            sk.hitIds.add(q.id);
            this.addHeat(q, 18, 'charge', p.id);
            this.knockback(q, q.x - p.x, q.z - p.z, 12);
            this.fxEmit({ e: 'chargeHit', x: q.x, z: q.z, id: p.id, target: q.id });
          }
        }
      } else {
        p.skillState = null;
      }
    }

    stepMotion(p, p.input, dt, {
      speedMult: this.speedMult(p),
      stunned: p.stunUntil > this.t,
      immobile: p.channelEnd > this.t,
      overrideVel: override,
      accelMult: p.vx * p.vx + p.vz * p.vz > 3 ? 1 : 1,
    });
    resolvePlayerArena(this.arena, p, PLAYER_RADIUS);
    this.afterMove(p);

    // facing
    if (Math.hypot(p.vx, p.vz) > 0.5 && Math.hypot(p.input.mx, p.input.mz) > 0.1) {
      p.facing = Math.atan2(p.vz, p.vx);
    } else {
      const targetFacing = p.aim;
      p.facing = normAngle(p.facing + angleDiff(targetFacing, p.facing) * Math.min(1, dt * 12));
    }

    // channel (coolant)
    if (p.channelEnd > 0) {
      if (p.channelEnd <= this.t) {
        this.completeChannel(p);
      } else if (Math.hypot(p.input.mx, p.input.mz) > 0.1) {
        p.channelEnd = 0; p.channelType = null;
        this.fxEmit({ e: 'channelCancel', id: p.id });
      }
    }

    // shooting
    this.updateShooting(p, dt);

    // heat decay
    const coolMult = this.coolRate(p);
    if (this.t - p.lastHeatAt > HEAT.decayDelay) {
      p.heat = Math.max(0, p.heat - HEAT.decay * coolMult * dt);
    }
    if (p.inCooler) {
      p.heat = Math.max(0, p.heat - HEAT.coolerRate * coolMult * dt);
      p.stats.coolerTime += dt;
    }
    if (p.inAcid) {
      p.heat = Math.min(100, p.heat + HEAT.acidRate * dt);
      p.lastHeatAt = this.t;
      if (p.heat >= 100) this.shortCircuit(p, null, 'acid');
    }
    if (p.inLeak) {
      p.heat = Math.max(0, p.heat - 8 * coolMult * dt);
    }
    if (this.stormActive) {
      const drain = 1.7 * dt;
      p.heat = Math.min(100, p.heat + drain);
      p.lastHeatAt = this.t;
      if (p.heat >= 100) this.shortCircuit(p, null, 'storm');
    }
    if (p.heat > 89) p.stats.topHeatSurvival += dt;

    // furnace fuse
    if (p.fuseEnd > 0 && p.fuseEnd <= this.t) {
      p.fuseEnd = 0;
      this.detonateFurnace(p);
    }
    // overclock aura fx
    if (p.overclockUntil > this.t && Math.floor(this.t * 4) !== Math.floor((this.t - dt) * 4)) {
      this.fxEmit({ e: 'overclockPulse', id: p.id, x: p.x, z: p.z });
    }
    if (p.shieldUntil > this.t) {
      // guardian passive cooldown while shield is up
    }
    if (p.skillState && p.skillState.type === 'sniperCharge' && p.skillState.readyAt <= this.t) {
      this.fireSniper(p);
    }
  }

  afterMove(p) {
    // zone occupancy flags
    p.inCooler = this.arena.coolers.some((c) => dist(p.x, p.z, c.x, c.z) < c.r);
    p.inAcid = this.arena.acids.some((c) => dist(p.x, p.z, c.x, c.z) < c.r);
    let leak = false, storm = false;
    for (const z of this.zones) {
      if (this.t < z.bornAt) continue;
      if (dist(p.x, p.z, z.x, z.z) < z.r) {
        if (z.type === 'leak') leak = true;
        if (z.type === 'storm') storm = true;
      }
    }
    p.inLeak = leak;
    p.inStorm = storm;
  }

  updateShooting(p, dt) {
    if (p.stunUntil > this.t || p.channelEnd > this.t) { p.fireHeldSince = -1; p.chargeT = 0; return; }
    if (p.reloadingUntil > 0) {
      if (p.reloadingUntil <= this.t) {
        p.reloadingUntil = 0; p.ammo = BULLET.magSize;
        this.fxEmit({ e: 'reloadDone', id: p.id });
      } else return;
    }
    const wantFire = p.input.fire && p.alive;
    if (!wantFire) {
      p.fireHeldSince = -1; p.chargeT = 0;
      return;
    }
    if (p.fireHeldSince < 0) p.fireHeldSince = this.t;
    const held = this.t - p.fireHeldSince;
    p.chargeT = clamp(held / BULLET.chargeTime, 0, 1);
    if (this.t < p.nextFireAt) return;

    if (p.ammo <= 0) {
      p.reloadingUntil = this.t + BULLET.reloadTime;
      p.fireHeldSince = -1; p.chargeT = 0;
      this.fxEmit({ e: 'reloadStart', id: p.id });
      return;
    }
    const charged = held >= BULLET.chargeTime && p.ammo >= 1;
    // If the trigger has been held past charge time, every shot afterwards is charged.
    this.fireBullet(p, charged);
    p.ammo -= 1;
    p.nextFireAt = this.t + (charged ? BULLET.fireInterval * 1.35 : BULLET.fireInterval);
    if (charged) { p.fireHeldSince = this.t; p.chargeT = 0; }
    if (p.ammo <= 0) {
      p.reloadingUntil = this.t + BULLET.reloadTime;
      p.fireHeldSince = -1; p.chargeT = 0;
      this.fxEmit({ e: 'reloadStart', id: p.id });
    }
  }

  fireBullet(p, charged, opts = {}) {
    const mech = mechOf(p.mech);
    const jitter = 0;
    const aim = p.aim + (this.rng() - 0.5) * jitter;
    const speed = opts.speed || (charged ? BULLET.chargedSpeed : BULLET.speed);
    const heat = opts.heat ?? (charged ? BULLET.chargedHeat : BULLET.heat);
    const id = nextEntityId++;
    const b = {
      id, owner: p.id, x: p.x + Math.cos(aim) * 0.95, z: p.z + Math.sin(aim) * 0.95,
      vx: Math.cos(aim) * speed, vz: Math.sin(aim) * speed,
      bounces: 0, heat, charged: !!charged, expireAt: this.t + BULLET.life,
      type: opts.type || 'bolt', pierce: !!opts.pierce, hitIds: new Set(),
    };
    this.bullets.push(b);
    this.bulletsById.set(b.id, b);
    p.stats.shots++;
    this.fxEmit({
      e: 'shot', x: b.x, z: b.z, aim, id: p.id, owner: p.id, charged: !!charged,
      color: mech.accent, type: opts.type || 'bolt',
    });
    return b;
  }

  stepBullets(dt) {
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i];
      if (this.t > b.expireAt) { this.removeBullet(i); continue; }
      const steps = Math.max(1, Math.ceil((Math.hypot(b.vx, b.vz) * dt) / 0.28));
      const sdt = dt / steps;
      let dead = false;
      for (let s = 0; s < steps && !dead; s++) {
        b.x += b.vx * sdt;
        b.z += b.vz * sdt;

        // boundary
        const half = this.arena.half - BULLET.radius;
        let bx = 0, bz = 0, bounced = false;
        if (b.x < -half) { b.x = -half; bx = 1; bounced = true; }
        if (b.x > half) { b.x = half; bx = -1; bounced = true; }
        if (b.z < -half) { b.z = -half; bz = 1; bounced = true; }
        if (b.z > half) { b.z = half; bz = -1; bounced = true; }
        if (bounced) {
          if (bx) b.vx = Math.abs(b.vx) * bx;
          if (bz) b.vz = Math.abs(b.vz) * bz;
          b.bounces++;
          this.fxEmit({ e: 'bounce', x: b.x, z: b.z, n: b.bounces, id: b.id, wall: true });
          if (b.bounces > BULLET.maxBounces) { dead = true; break; }
        }

        // static walls
        for (const w of this.arena.walls) {
          if (!w.alive) continue;
          const hit = circleVsWall(b, BULLET.radius, w);
          if (hit) {
            b.x += hit.nx * (hit.depth + 0.005);
            b.z += hit.nz * (hit.depth + 0.005);
            const dot = b.vx * hit.nx + b.vz * hit.nz;
            b.vx -= 2 * dot * hit.nx;
            b.vz -= 2 * dot * hit.nz;
            b.bounces++;
            w.hp -= 1;
            this.fxEmit({ e: 'bounce', x: b.x, z: b.z, n: b.bounces, id: b.id, wall: true });
            this.fxEmit({ e: 'wallHit', x: b.x, z: b.z, wallId: w.id, hp: Math.max(0, w.hp) });
            if (w.hp <= 0) {
              w.alive = false;
              w.rubbleUntil = this.t + 3.5;
              w.bounced = true;
              this.fxEmit({ e: 'wallBreak', x: w.x, z: w.z, w: w.w, h: w.h });
              for (const q of this.players.values()) {
                if (q.alive && dist(q.x, q.z, w.x, w.z) < 2.2) this.addHeat(q, 6, 'wallBreak', null);
              }
            }
            if (b.bounces > BULLET.maxBounces) { dead = true; }
            break;
          }
        }
        if (dead) break;

        // destroyed walls leave a short-lived reflective rubble pile
        for (const w of this.arena.walls) {
          if (w.alive) continue;
          if (this.t < w.rubbleUntil) {
            if (this.reflectOffCircle(b, w.x, w.z, 0.95)) { dead = b.bounces > BULLET.maxBounces; break; }
          }
        }
        if (dead) break;

        // plates / towers
        for (const pobj of this.arena.plates) {
          if (this.reflectOffCircle(b, pobj.x, pobj.z, pobj.r)) { dead = b.bounces > BULLET.maxBounces; break; }
        }
        if (dead) break;
        for (const sh of this.arena.dynamicPlates) {
          if (sh.hp <= 0) continue;
          if (this.reflectOffCircle(b, sh.x, sh.z, sh.r)) {
            sh.hp -= 1;
            if (sh.hp <= 0) this.fxEmit({ e: 'plateBreak', x: sh.x, z: sh.z });
            dead = b.bounces > BULLET.maxBounces; break;
          }
        }
        if (dead) break;
        for (const tw of this.arena.towers) {
          if (this.reflectOffCircle(b, tw.x, tw.z, tw.r)) { dead = b.bounces > BULLET.maxBounces; break; }
        }
        if (dead) break;

        // guardian shields
        for (const g of this.players.values()) {
          if (!g.alive || g.shieldUntil <= this.t) continue;
          if (g.id === b.owner && b.bounces === 0) continue;
          const d = dist(b.x, b.z, g.x, g.z);
          const R = 1.72;
          if (d < R + BULLET.radius) {
            const nx = (b.x - g.x) / (d || 1), nz = (b.z - g.z) / (d || 1);
            b.x = g.x + nx * (R + BULLET.radius + 0.02);
            b.z = g.z + nz * (R + BULLET.radius + 0.02);
            const dot = b.vx * nx + b.vz * nz;
            b.vx -= 2 * dot * nx;
            b.vz -= 2 * dot * nz;
            b.bounces++;
            b.ignoreUntil = this.t + 0.15;
            g.shieldReflected++;
            this.fxEmit({ e: 'shieldBounce', x: b.x, z: b.z, id: g.id });
            dead = b.bounces > BULLET.maxBounces;
            break;
          }
        }
        if (dead) break;

        // players
        for (const target of this.players.values()) {
          if (!target.alive) continue;
          if (target.id === b.owner && b.bounces === 0) continue;
          if (target.id === b.owner && b.ignoreUntil > this.t) continue;
          if (target.iframeUntil > this.t) continue;
          if (b.hitIds.has(target.id)) continue;
          if (dist(b.x, b.z, target.x, target.z) < PLAYER_RADIUS + BULLET.radius) {
            let heat = b.heat;
            if (b.bounces > 0) {
              heat *= 1 + this.scaling.bounceBonus;
              heat += b.bounces * 1;
            }
            if (b.owner != null) {
              const src = this.players.get(b.owner);
              if (src && src.overclockUntil > this.t) heat *= 1.3;
              if (src) src.stats.hits++;
            }
            const attackerId = b.owner;
            const bounced = b.bounces > 0;
            if (bounced && attackerId != null) {
              const src = this.players.get(attackerId);
              if (src) src.stats.bounceHits++;
            }
            this.addHeat(target, heat, bounced ? 'bounceBolt' : 'bolt', attackerId, { bounced });
            this.fxEmit({
              e: 'hitMarker', x: target.x, z: target.z, target: target.id, owner: attackerId,
              amount: Math.round(heat)
            });
            b.hitIds.add(target.id);
            if (b.pierce) {
              if (b.hitIds.size >= 3) { dead = true; break; }
              continue;
            }
            dead = true;
            break;
          }
        }
        if (dead) break;

        // grenades can be shot
        for (const g of this.grenades) {
          if (g.exploded) continue;
          if (dist(b.x, b.z, g.x, g.z) < 0.42 + BULLET.radius) {
            this.explodeGrenade(g);
            dead = true;
            break;
          }
        }
        // mines shootable
        for (const m of this.mines) {
          if (m.dead) continue;
          if (dist(b.x, b.z, m.x, m.z) < 0.38 + BULLET.radius) {
            this.explodeMine(m, b.owner);
            dead = true;
            break;
          }
        }
      }
      if (dead) this.removeBullet(i);
    }
  }

  reflectOffCircle(b, cx, cz, r) {
    const d = dist(b.x, b.z, cx, cz);
    const min = r + BULLET.radius;
    if (d >= min) return false;
    let nx = (b.x - cx) / (d || 1), nz = (b.z - cz) / (d || 1);
    if (d < 0.001) { nx = 0; nz = 1; }
    b.x = cx + nx * (min + 0.01);
    b.z = cz + nz * (min + 0.01);
    const dot = b.vx * nx + b.vz * nz;
    if (dot > 0) { return true; } // already leaving; avoid sticking
    b.vx -= 2 * dot * nx;
    b.vz -= 2 * dot * nz;
    b.bounces++;
    this.fxEmit({ e: 'bounce', x: b.x, z: b.z, n: b.bounces, id: b.id });
    return true;
  }

  removeBullet(i) {
    const b = this.bullets[i];
    this.bulletsById.delete(b.id);
    this.bullets.splice(i, 1);
  }

  // ------------------------------------------------------------------ items
  stepItems(dt) {
    // pickup
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      if (it.expireAt && this.t > it.expireAt) { this.items.splice(i, 1); continue; }
      if (it.groundedAt > this.t) continue;
      for (const p of this.players.values()) {
        if (!p.alive) continue;
        if (dist(p.x, p.z, it.x, it.z) < 1.15) {
          if (p.item) continue;
          p.item = it.type;
          this.items.splice(i, 1);
          this.fxEmit({ e: 'itemPickup', x: it.x, z: it.z, id: p.id, item: it.type, itemId: it.id });
          break;
        }
      }
    }
    // Regular supply drops, plus a safety net: if the floor has been picked
    // clean for a few seconds, drop one more instead of letting the arena go dry.
    const empty = this.items.length === 0 && this.t - this.lastItemSpawnAt > 4 && this.t > 6;
    if (this.t >= this.nextItemAt || empty) {
      this.spawnRandomItem();
      this.nextItemAt = this.t + this.scaling.pickupInterval * (0.8 + this.rng() * 0.5);
    }
  }

  /** Item spawn points: the fixed pads plus spots a few metres from players. */
  itemSpots() {
    const spots = this.arena.pads.filter((pd) => !this.items.some((it) => dist(it.x, it.z, pd.x, pd.z) < 1.4));
    const alive = [...this.players.values()].filter((p) => p.alive);
    for (const p of alive) {
      // two candidate spots beside each player so drops are actually seen
      for (let i = 0; i < 2; i++) {
        const a = this.itemRng() * Math.PI * 2;
        const r = 2.4 + this.itemRng() * 1.6;
        const x = p.x + Math.cos(a) * r;
        const z = p.z + Math.sin(a) * r;
        if (Math.abs(x) > this.arena.half - 1.4 || Math.abs(z) > this.arena.half - 1.4) continue;
        if (pointBlocked(this.arena, x, z, 0.7)) continue;
        if (arenaHazard(this.arena, x, z)) continue;
        if (this.items.some((it) => dist(it.x, it.z, x, z) < 1.8)) continue;
        if (spots.some((sp) => dist(sp.x, sp.z, x, z) < 1.8)) continue;
        spots.push({ x, z, near: p.id });
      }
    }
    return spots;
  }

  spawnRandomItem(forceType = null, pad = null, opts = {}) {
    // airdrops are scripted events: they land even when the floor is already full
    if (!opts.ignoreCap && this.items.length >= this.scaling.itemMax) return;
    let spot = pad;
    if (!spot) {
      const open = this.itemSpots();
      spot = open.length ? open[Math.floor(this.itemRng() * open.length)] : null;
    }
    if (!spot) return;
    this.lastItemSpawnAt = this.t;
    let type = forceType;
    if (!type) {
      const roll = this.itemRng();
      if (spot.center) type = roll < 0.33 ? 'purge' : roll < 0.66 ? 'overclock' : 'coolant';
      else if (roll < 0.3) type = 'coolant';
      else if (roll < 0.48) type = 'grenade';
      else if (roll < 0.64) type = 'plate';
      else if (roll < 0.78) type = 'grapple';
      else if (roll < 0.9) type = 'overclock';
      else type = 'purge';
    }
    for (const p of this.players.values()) {
      if (p.alive && dist(p.x, p.z, spot.x, spot.z) < 1.4 && p.item == null) { /* allow, will pick up */ }
    }
    const item = { id: ++this.itemSerial, type, x: spot.x, z: spot.z, groundedAt: this.t + 0.2, expireAt: this.t + 45 };
    this.items.push(item);
    this.fxEmit({ e: 'itemSpawn', x: spot.x, z: spot.z, item: type, itemId: item.id, center: !!spot.center });
    return item;
  }

  useItem(p) {
    if (!p.alive || !p.item) return;
    if (this.t < (this.itemUsePulse.get(p.id) || 0)) return;
    this.itemUsePulse.set(p.id, this.t + 0.4);
    const type = p.item;
    if (type === 'coolant') {
      p.channelEnd = this.t + 1.5;
      p.channelType = 'coolant';
      p.item = null;
      this.fxEmit({ e: 'channelStart', id: p.id, type: 'coolant', x: p.x, z: p.z });
    } else if (type === 'purge') {
      p.heat = 0;
      p.item = null;
      this.fxEmit({ e: 'purge', id: p.id, x: p.x, z: p.z });
    } else if (type === 'overclock') {
      p.overclockUntil = this.t + 15;
      p.item = null;
      this.fxEmit({ e: 'overclock', id: p.id, x: p.x, z: p.z });
    } else if (type === 'grapple') {
      const aim = p.aim;
      const hit = rayArena(this.arena, p.x, p.z, Math.cos(aim), Math.sin(aim), 6, null);
      const d = Math.min(6, hit.d - 0.3);
      p.x += Math.cos(aim) * Math.max(0, d);
      p.z += Math.sin(aim) * Math.max(0, d);
      resolvePlayerArena(this.arena, p, PLAYER_RADIUS);
      p.item = null;
      this.fxEmit({ e: 'grappleItem', x: p.x, z: p.z, id: p.id, aim, len: Math.max(0, d) });
    } else if (type === 'plate') {
      const aim = p.aim;
      const px = p.x + Math.cos(aim) * 2.0;
      const pz = p.z + Math.sin(aim) * 2.0;
      this.arena.dynamicPlates.push({ id: nextEntityId++, x: px, z: pz, r: 1.15, hp: 3, owner: p.id, angle: aim, expireAt: this.t + 6, bornAt: this.t });
      p.item = null;
      this.fxEmit({ e: 'platePlace', x: px, z: pz, id: p.id });
    } else if (type === 'grenade') {
      const aim = p.aim;
      const g = {
        id: nextEntityId++, owner: p.id, x: p.x + Math.cos(aim) * 0.8, z: p.z + Math.sin(aim) * 0.8,
        vx: Math.cos(aim) * 9.5, vz: Math.sin(aim) * 9.5, explodeAt: this.t + 1.5, exploded: false,
      };
      this.grenades.push(g);
      p.item = null;
      this.fxEmit({ e: 'grenadeThrow', x: g.x, z: g.z, id: p.id, aim });
    }
  }

  completeChannel(p) {
    const type = p.channelType;
    p.channelEnd = 0; p.channelType = null;
    if (type === 'coolant') {
      p.heat = Math.max(0, p.heat - 40 * this.coolRate(p));
      this.fxEmit({ e: 'cooled', id: p.id, x: p.x, z: p.z, amount: 40 });
    }
  }

  // --------------------------------------------------------------- grenades
  stepGrenades(dt) {
    for (let i = this.grenades.length - 1; i >= 0; i--) {
      const g = this.grenades[i];
      if (g.exploded) { this.grenades.splice(i, 1); continue; }
      g.x += g.vx * dt; g.z += g.vz * dt;
      g.vx *= (1 - dt * 3.2); g.vz *= (1 - dt * 3.2);
      const half = this.arena.half - 0.4;
      if (Math.abs(g.x) > half) { g.x = Math.sign(g.x) * half; g.vx *= -0.5; }
      if (Math.abs(g.z) > half) { g.z = Math.sign(g.z) * half; g.vz *= -0.5; }
      if (this.t >= g.explodeAt) {
        this.explodeGrenade(g);
        this.grenades.splice(i, 1);
      }
    }
  }

  explodeGrenade(g) {
    if (g.exploded) return;
    g.exploded = true;
    const radius = 3;
    this.fxEmit({ e: 'grenadeBoom', x: g.x, z: g.z, radius });
    for (const p of this.players.values()) {
      if (!p.alive) continue;
      const d = dist(p.x, p.z, g.x, g.z);
      if (d <= radius) {
        const falloff = 1 - (d / radius) * 0.4;
        this.addHeat(p, 25 * falloff, 'grenade', g.owner);
        p.stunUntil = Math.max(p.stunUntil, this.t + 0.5);
        this.knockback(p, p.x - g.x, p.z - g.z, 7);
        const o = this.players.get(g.owner);
        if (o) o.stats.explosionHits++;
      }
    }
  }

  // ------------------------------------------------------------------ mines
  stepMines(dt) {
    for (let i = this.mines.length - 1; i >= 0; i--) {
      const m = this.mines[i];
      if (m.dead) { this.mines.splice(i, 1); continue; }
      if (this.t > m.expireAt) { this.fxEmit({ e: 'mineExpire', x: m.x, z: m.z }); this.mines.splice(i, 1); continue; }
      if (this.t < m.armedAt) continue;
      let triggered = false;
      for (const p of this.players.values()) {
        if (!p.alive || p.id === m.owner) continue;
        if (dist(p.x, p.z, m.x, m.z) < 1.35) { triggered = true; break; }
      }
      if (triggered) {
        this.explodeMine(m, m.owner);
        this.mines.splice(i, 1);
      }
    }
  }

  explodeMine(m, byId) {
    if (m.dead) return;
    m.dead = true;
    const radius = 3;
    this.fxEmit({ e: 'mineBoom', x: m.x, z: m.z, radius });
    for (const p of this.players.values()) {
      if (!p.alive) continue;
      const d = dist(p.x, p.z, m.x, m.z);
      if (d <= radius) {
        const falloff = 1 - (d / radius) * 0.4;
        this.addHeat(p, 25 * falloff, 'mine', m.owner);
        this.knockback(p, p.x - m.x, p.z - m.z, 6);
        const o = this.players.get(m.owner);
        if (o) o.stats.explosionHits++;
      }
    }
    const owner = this.players.get(m.owner);
    if (owner) owner.mineCount = Math.max(0, owner.mineCount - 1);
    if (byId != null) {
      const shooter = this.players.get(byId);
      if (shooter) this.fxEmit({ e: 'mineShot', x: m.x, z: m.z, id: byId });
    }
  }

  // ------------------------------------------------------------------ zones
  stepZones(dt) {
    for (let i = this.zones.length - 1; i >= 0; i--) {
      const z = this.zones[i];
      if (this.t > z.until) { this.zones.splice(i, 1); continue; }
      if (z.type === 'storm') {
        const key = z.id;
        if (!this.lastStormTick[key] || this.t - this.lastStormTick[key] > 0.12) {
          this.lastStormTick[key] = this.t;
          for (const p of this.players.values()) {
            if (!p.alive) continue;
            if (dist(p.x, p.z, z.x, z.z) < z.r) {
              this.addHeat(p, 10 * 0.12, 'emstorm', null, { silent: true });
              this.fxEmit({ e: 'stormTick', x: p.x, z: p.z, id: p.id });
            }
          }
        }
      }
    }
  }

  // -------------------------------------------------------------- electric towers
  stepTowers(dt) {
    for (const tw of this.arena.towers) {
      const cyc = 4.2;
      const phase = (this.t + tw.phase) % cyc;
      tw.charging = phase > cyc - 1.15;
      tw.chargeLevel = tw.charging ? (phase - (cyc - 1.15)) / 1.15 : 0;
      const firedKey = Math.floor((this.t + tw.phase) / cyc);
      tw.lastFiredKey = tw.lastFiredKey ?? firedKey;
      if (phase < 0.06 && firedKey !== tw.lastFiredKey) {
        tw.lastFiredKey = firedKey;
        this.fxEmit({ e: 'towerZap', x: tw.x, z: tw.z, r: tw.zapR });
        for (const p of this.players.values()) {
          if (!p.alive) continue;
          if (dist(p.x, p.z, tw.x, tw.z) < tw.zapR) {
            this.addHeat(p, HEAT.towerHeat, 'tower', null);
            p.stunUntil = Math.max(p.stunUntil, this.t + 0.28);
          }
        }
      }
    }
  }

  stepDynamicPlates(dt) {
    for (let i = this.arena.dynamicPlates.length - 1; i >= 0; i--) {
      const sh = this.arena.dynamicPlates[i];
      if (this.t > sh.expireAt || sh.hp <= 0) {
        this.fxEmit({ e: 'plateExpire', x: sh.x, z: sh.z });
        this.arena.dynamicPlates.splice(i, 1);
      }
    }
    for (const w of this.arena.walls) {
      if (!w.alive && w.rebuildAt && this.t > w.rebuildAt && !w.rebuilt) {
        w.rebuilt = true; w.alive = true; w.hp = w.maxHp; w.rubbleUntil = 0; w.rebuildAt = 0;
        this.fxEmit({ e: 'wallRebuild', x: w.x, z: w.z, w: w.w, h: w.h });
      }
    }
  }

  // ------------------------------------------------------------------ events
  stepEvents(dt) {
    if (this.t >= this.nextEventAt && this.phase === 'live') {
      this.triggerEvent();
    }
    if (this.airdrop && this.airdrop.resolvedAt <= this.t) {
      const ad = this.airdrop;
      ad.resolvedAt = Infinity;
      if (!ad.itemsSpawned) {
        ad.itemsSpawned = true;
        const count = this.order.length >= 6 ? 2 : 1;
        for (let i = 0; i < count; i++) {
          const angle = (i / count) * Math.PI * 2;
          const pad = { x: ad.x + Math.cos(angle) * 2.1, z: ad.z + Math.sin(angle) * 2.1, center: true };
          const type = i === 0 ? (this.rng() < 0.5 ? 'purge' : 'overclock') : 'coolant';
          this.spawnRandomItem(type, pad, { ignoreCap: true });
        }
      }
    }
    for (let i = this.markers.length - 1; i >= 0; i--) {
      const m = this.markers[i];
      if (m.strikeAt <= this.t) {
        this.fxEmit({ e: 'clawSlam', x: m.x, z: m.z, r: m.r });
        for (const p of this.players.values()) {
          if (!p.alive) continue;
          if (dist(p.x, p.z, m.x, m.z) < m.r) {
            this.addHeat(p, 30, 'claw', null);
            p.stunUntil = Math.max(p.stunUntil, this.t + 1);
            p.stats.clawHits++;
            p.vx = 0; p.vz = 0;
          }
        }
        this.markers.splice(i, 1);
      }
    }
    if (this.eventBanner && this.eventBanner.until < this.t) this.eventBanner = null;
    if (this.sandstormUntil && this.sandstormUntil < this.t) {
      this.sandstormUntil = 0;
      this.fxEmit({ e: 'sandstormEnd' });
    }
  }

  triggerEvent() {
    const n = this.order.length;
    const mult = this.eventRateMult * (this.stormActive ? 0.62 : 1);
    this.nextEventAt = this.t + this.scaling.eventBase * mult * (0.8 + this.rng() * 0.4);
    const pool = ['sandstorm', 'airdrop', 'claw', 'emstorm', 'leak'];
    // ensure variety: avoid repeating the previous event
    let type = pool[Math.floor(this.rng() * pool.length)];
    if (type === this.lastEventType) type = pool[(pool.indexOf(type) + 1 + Math.floor(this.rng() * 3)) % pool.length];
    this.lastEventType = type;
    this.eventCount++;
    const meta = EVENT_META[type];
    this.eventBanner = { type, until: this.t + meta.warn + 1.0, name: meta.name, desc: meta.desc, icon: meta.icon };
    this.fxEmit({ e: 'eventWarn', type, x: this.arena.half, z: this.arena.half });

    if (type === 'sandstorm') {
      this.sandstormUntil = this.t + 12;
      this.fxEmit({ e: 'sandstormStart' });
    } else if (type === 'airdrop') {
      const pads = this.arena.pads;
      const centerPad = pads.find((p) => p.center) || { x: 0, z: 0 };
      this.airdrop = {
        x: centerPad.x, z: centerPad.z, startAt: this.t + 1.2,
        resolvedAt: this.t + 1.2, itemsSpawned: false,
      };
      this.fxEmit({ e: 'airdropWarn', x: centerPad.x, z: centerPad.z, r: 4 });
    } else if (type === 'claw') {
      const alive = [...this.players.values()].filter((p) => p.alive);
      const targets = [];
      const count = n >= 6 ? 2 : 1;
      for (let i = 0; i < count && alive.length; i++) {
        const target = alive[Math.floor(this.rng() * alive.length)];
        if (!target || targets.some((t) => t.id === target.id)) continue;
        targets.push({ id: target.id });
        const m = { id: nextEntityId++, x: target.x, z: target.z, r: 2.2, strikeAt: this.t + 1.1, targetId: target.id };
        this.markers.push(m);
        this.fxEmit({ e: 'clawWarn', x: m.x, z: m.z, r: m.r, until: m.strikeAt });
      }
    } else if (type === 'emstorm') {
      const count = n >= 5 ? 2 : 1;
      for (let i = 0; i < count; i++) {
        const a = this.rng() * Math.PI * 2;
        const rad = this.arena.size * (0.12 + this.rng() * 0.24);
        const z = {
          id: nextEntityId++, type: 'storm', x: Math.cos(a) * rad, z: Math.sin(a) * rad,
          r: 3.3, bornAt: this.t + 1.3, until: this.t + 6.5,
        };
        this.zones.push(z);
        this.fxEmit({ e: 'stormWarn', x: z.x, z: z.z, r: z.r, until: z.bornAt });
      }
    } else if (type === 'leak') {
      const a = this.rng() * Math.PI * 2;
      const rad = this.arena.size * (0.15 + this.rng() * 0.15);
      const z = {
        id: nextEntityId++, type: 'leak', x: Math.cos(a) * rad, z: Math.sin(a) * rad,
        r: 4.2, bornAt: this.t + 1.3, until: this.t + 9.5,
      };
      this.zones.push(z);
      this.fxEmit({ e: 'leakWarn', x: z.x, z: z.z, r: z.r, until: z.bornAt });
    }
    this.fxEmit({ e: 'eventBanner', type, name: meta.name, desc: meta.desc, icon: meta.icon });
  }

  // ----------------------------------------------------------------- skills
  useSkill(p) {
    if (!p.alive || this.t < p.skillCdUntil || p.stunUntil > this.t || p.channelEnd > this.t) return;
    const mech = mechOf(p.mech);
    const setCd = (v) => { p.skillCdUntil = this.t + v; };
    if (p.mech === 'assault') {
      const aim = p.aim;
      p.skillCdUntil = this.t + mech.skill.cd;
      p.skillState = { type: 'charge', until: this.t + 0.24, dirX: Math.cos(aim), dirZ: Math.sin(aim), hitIds: new Set() };
      p.dashUntil = 0;
      this.fxEmit({ e: 'assaultCharge', x: p.x, z: p.z, id: p.id, aim });
    } else if (p.mech === 'grappler') {
      this.useHook(p);
      setCd(mech.skill.cd);
    } else if (p.mech === 'guardian') {
      p.shieldUntil = this.t + 1.5;
      setCd(mech.skill.cd);
      this.fxEmit({ e: 'shieldUp', x: p.x, z: p.z, id: p.id, r: 1.72, until: p.shieldUntil });
    } else if (p.mech === 'miner') {
      if (p.mineCount >= 3) return;
      const aim = p.aim;
      const mx = p.x + Math.cos(aim) * 1.2;
      const mz = p.z + Math.sin(aim) * 1.2;
      this.mines.push({
        id: nextEntityId++, x: mx, z: mz, owner: p.id, armedAt: this.t + 2,
        expireAt: this.t + 35, dead: false,
      });
      p.mineCount++;
      setCd(mech.skill.cd);
      this.fxEmit({ e: 'minePlace', x: mx, z: mz, id: p.id });
    } else if (p.mech === 'sniper') {
      if (p.skillState && p.skillState.type === 'sniperCharge') { p.skillState = null; return; }
      p.skillState = { type: 'sniperCharge', readyAt: this.t + 0.7 };
      setCd(mech.skill.cd);
      this.fxEmit({ e: 'sniperCharge', id: p.id, x: p.x, z: p.z, aim: p.aim });
    } else if (p.mech === 'furnace') {
      if (p.fuseEnd > 0) {
        p.fuseEnd = 0;
        p.skillCdUntil = this.t + 1.0;
        this.fxEmit({ e: 'fuseCancel', id: p.id });
      } else {
        p.fuseEnd = this.t + 3;
        p.skillCdUntil = this.t + 3.2;
        this.fxEmit({ e: 'fuseStart', id: p.id, until: p.fuseEnd });
      }
    }
  }

  useHook(p) {
    const maxLen = 9.5;
    const aim = p.aim;
    let best = { kind: 'none', d: maxLen, x: p.x + Math.cos(aim) * maxLen, z: p.z + Math.sin(aim) * maxLen, target: null };
    const hit = rayArena(this.arena, p.x, p.z, Math.cos(aim), Math.sin(aim), maxLen);
    best = { kind: hit.kind, d: hit.d, x: p.x + Math.cos(aim) * hit.d, z: p.z + Math.sin(aim) * hit.d, target: hit.target };
    // enemy check (closest)
    let enemy = null, enemyD = maxLen;
    for (const q of this.players.values()) {
      if (!q.alive || q.id === p.id) continue;
      if (this.settings.mode !== 'ffa' && q.team === p.team) continue;
      const dx = q.x - p.x, dz = q.z - p.z;
      const proj = dx * Math.cos(aim) + dz * Math.sin(aim);
      if (proj < 0.6 || proj > maxLen) continue;
      const perp = Math.abs(dx * Math.sin(aim) - dz * Math.cos(aim));
      if (perp < 0.95 && proj < enemyD) { enemy = q; enemyD = proj; }
    }
    if (enemy) {
      const d = dist(p.x, p.z, enemy.x, enemy.z);
      enemy.x = lerp(enemy.x, p.x, 0.55);
      enemy.z = lerp(enemy.z, p.z, 0.55);
      resolvePlayerArena(this.arena, enemy, PLAYER_RADIUS);
      this.addHeat(enemy, 8, 'hook', p.id);
      this.fxEmit({ e: 'hookHit', x: enemy.x, z: enemy.z, id: p.id, target: enemy.id, aim, len: d });
    } else if (best.kind !== 'none' && best.d < maxLen) {
      const d = Math.max(0, best.d - 0.9);
      p.x += Math.cos(aim) * d;
      p.z += Math.sin(aim) * d;
      resolvePlayerArena(this.arena, p, PLAYER_RADIUS);
      this.fxEmit({ e: 'hookMiss', x: p.x, z: p.z, id: p.id, aim, len: d });
    } else {
      this.fxEmit({ e: 'hookMiss', x: p.x, z: p.z, id: p.id, aim, len: 0 });
    }
  }

  fireSniper(p) {
    p.skillState = null;
    this.fireBullet(p, true, { speed: 34, heat: 20, type: 'rail', pierce: true });
    this.fxEmit({ e: 'sniperShot', x: p.x, z: p.z, id: p.id, aim: p.aim });
  }

  detonateFurnace(p) {
    this.shortCircuit(p, p.id, 'furnace', { selfDestruct: true, radiusMult: 1.5 });
    // credit the furnace player for kills caused by their own blast
  }

  // --------------------------------------------------------------- respawns
  stepRespawns(dt) {
    for (const p of this.players.values()) {
      if (p.alive) continue;
      if (p.respawnAt && this.t >= p.respawnAt) {
        const spawn = this.pickSpawn(p);
        this._placeAtSpawn(p, spawn);
        p.invulnUntil = this.t + HEAT.spawnInvuln;
        p.spawnedAt = this.t;
        this.fxEmit({ e: 'respawn', x: spawn.x, z: spawn.z, id: p.id });
      }
    }
  }

  pickSpawn(p) {
    let best = this.arena.spawns[0], bestScore = -Infinity;
    for (const s of this.arena.spawns) {
      let minD = Infinity;
      for (const q of this.players.values()) {
        if (!q.alive || q.id === p.id) continue;
        minD = Math.min(minD, dist(s.x, s.z, q.x, q.z));
      }
      const score = minD + this.rng() * 2;
      if (score > bestScore) { bestScore = score; best = s; }
    }
    return best;
  }

  cleanup() {
    for (let i = this.players.size - 1; i >= 0; i--) {
      const p = [...this.players.values()][i];
      if (p.disconnected && p.reconnectUntil && this.t > p.reconnectUntil) {
        this.players.delete(p.id);
        this.order = this.order.filter((id) => id !== p.id);
        this.fxEmit({ e: 'playerLeft', id: p.id, name: p.name });
      }
    }
  }

  // ------------------------------------------------------------------ state
  scoreboard() {
    const list = [...this.players.values()].map((p) => ({
      id: p.id, name: p.name, mech: p.mech, color: p.color, team: p.team,
      score: Math.round(p.score * 2) / 2, kills: p.stats.kills, deaths: p.stats.deaths,
      assists: p.stats.assists, bounceHits: p.stats.bounceHits, heat: Math.round(p.heat),
      alive: p.alive, respawnIn: p.alive ? 0 : Math.max(0, Math.ceil(p.respawnAt - this.t)),
      bot: p.bot,
    }));
    list.sort((a, b) => b.score - a.score || b.kills - a.kills || a.deaths - b.deaths);
    return list;
  }

  // Fun post-match titles for every pilot (GDD: 结算搞怪称号).
  funTitles() {
    const all = [...this.players.values()];
    const top = (fn, min = 1) => {
      let best = null, bv = min - 1;
      for (const p of all) { const v = fn(p); if (v > bv) { bv = v; best = p; } }
      return best;
    };
    const picks = [
      ['kills', top((p) => p.stats.kills), '废土烧烤师傅'],
      ['bounce', top((p) => p.stats.bounceHits), '反弹台球冠军'],
      ['self', top((p) => p.stats.selfDestructKills), '自爆艺术家'],
      ['boom', top((p) => p.stats.explosionHits), '爆炸波及王'],
      ['cooler', top((p) => Math.round(p.stats.coolerTime)), '散热区常驻代表'],
      ['claw', top((p) => p.stats.clawHits), '机械臂的人质'],
      ['deaths', top((p) => p.stats.deaths), '最耐热的短路王'],
      ['damage', top((p) => Math.round(p.stats.damageDealt)), '人形加热器'],
      ['heat', top((p) => Math.round(p.stats.topHeatSurvival)), '临界舞者'],
    ];
    const titles = new Map();
    for (const [, p, title] of picks) {
      if (p && !titles.has(p.id)) titles.set(p.id, title);
    }
    // least deaths among players who actually scored a kill
    const clean = all.filter((p) => p.stats.kills > 0).sort((a, b) => a.stats.deaths - b.stats.deaths)[0];
    if (clean && !titles.has(clean.id)) titles.set(clean.id, '绝缘体');
    const fallback = ['过载实习生', '废土观光客', '扳手收藏家', '电压不稳定', '移动掩体', '中央高台钉子户'];
    let i = 0;
    for (const p of all) {
      if (!titles.has(p.id)) titles.set(p.id, fallback[i++ % fallback.length]);
    }
    return titles;
  }

  awards() {
    const all = [...this.players.values()];
    const pick = (fn, key) => {
      let best = null, bv = -1;
      for (const p of all) { const v = fn(p); if (v > bv) { bv = v; best = p; } }
      return best && bv > 0 ? { id: best.id, name: best.name, color: best.color, mech: best.mech, value: bv, key } : null;
    };
    return {
      shortCircuit: pick((p) => p.stats.explosionHits, 'shortCircuit'),
      bounceKing: pick((p) => p.stats.bounceHits, 'bounceKing'),
      clawed: pick((p) => p.stats.clawHits, 'clawed'),
      coolerCamper: pick((p) => p.stats.coolerTime, 'coolerCamper'),
      demoArtist: pick((p) => p.stats.selfDestructKills, 'demoArtist'),
      hotShot: pick((p) => p.stats.damageDealt, 'hotShot'),
    };
  }

  endMatch() {
    if (this.phase === 'over') return;
    this.phase = 'over';
    this.finishedAt = this.t;
    const board = this.scoreboard();
    const titles = this.funTitles();
    for (const row of board) row.title = titles.get(row.id) || '废土观光客';
    const teams = {};
    for (const p of this.players.values()) {
      teams[p.team] = (teams[p.team] || 0) + p.score;
    }
    this.fxEmit({ e: 'matchOver' });
    this.result = {
      board,
      teams,
      awards: this.awards(),
      duration: this.t,
      seed: this.seed,
      arenaSize: this.arena.size,
      mode: this.settings.mode,
    };
    if (this.onEnd) this.onEnd(this.result);
  }

  checkMatchEnd() {
    if (this.settings.mode === 'elimination') {
      const alive = [...this.players.values()].filter((p) => p.alive);
      if (alive.length <= 1) this.endMatch();
    }
  }

  snapshot(forPlayerId = null) {
    const players = [];
    for (const p of this.players.values()) {
      players.push({
        id: p.id, name: p.name, color: p.color, colorId: p.colorId, mech: p.mech, team: p.team,
        x: round2(p.x), z: round2(p.z), vx: round2(p.vx), vz: round2(p.vz),
        aim: round3(p.aim), facing: round3(p.facing),
        heat: round2(p.heat), alive: p.alive,
        invuln: round2(Math.max(0, p.invulnUntil - this.t)),
        respawnIn: p.alive ? 0 : round2(Math.max(0, p.respawnAt - this.t)),
        ammo: p.ammo, reloading: Math.max(0, p.reloadingUntil - this.t),
        charge: round2(p.chargeT), fireHeldSince: p.fireHeldSince,
        dashCd: round2(Math.max(0, p.dashCdUntil - this.t)),
        skillCd: round2(Math.max(0, p.skillCdUntil - this.t)),
        shield: round2(Math.max(0, p.shieldUntil - this.t)),
        fuse: p.fuseEnd ? round2(Math.max(0, p.fuseEnd - this.t)) : 0,
        channel: round2(Math.max(0, p.channelEnd - this.t)), channelType: p.channelType,
        overclock: round2(Math.max(0, p.overclockUntil - this.t)),
        stunned: p.stunUntil > this.t,
        item: p.item, score: p.score, kills: p.stats.kills, deaths: p.stats.deaths,
        bot: p.bot, disconnected: p.disconnected,
        inCooler: p.inCooler, inAcid: p.inAcid, inLeak: p.inLeak, inStorm: p.inStorm,
        sniperCharge: p.skillState && p.skillState.type === 'sniperCharge' ? 1 : 0,
        seq: p.input.seq,
        dashIn: round2(Math.max(0, p.dashUntil - this.t)),
        dashDx: round3(p.dashDirX || 0),
        dashDz: round3(p.dashDirZ || 0),
        paused: p.disconnected,
      });
    }
    const bullets = this.bullets.map((b) => ({
      id: b.id, owner: b.owner, x: round2(b.x), z: round2(b.z),
      vx: round2(b.vx), vz: round2(b.vz), n: b.bounces, charged: b.charged, type: b.type,
    }));
    const mines = this.mines.map((m) => ({ id: m.id, x: round2(m.x), z: round2(m.z), owner: m.owner, armed: m.armedAt <= this.t, armIn: round2(Math.max(0, m.armedAt - this.t)) }));
    const grenades = this.grenades.map((g) => ({ id: g.id, x: round2(g.x), z: round2(g.z), fuse: round2(Math.max(0, g.explodeAt - this.t)), owner: g.owner }));
    const items = this.items.map((it) => ({ id: it.id, type: it.type, x: round2(it.x), z: round2(it.z) }));
    const zones = this.zones.filter((z) => z.bornAt <= this.t).map((z) => ({
      id: z.id, type: z.type, x: round2(z.x), z: round2(z.z), r: z.r,
      until: round2(z.until - this.t),
    }));
    const markers = this.markers.map((m) => ({
      id: m.id ?? 0, x: round2(m.x), z: round2(m.z), r: m.r, in: round2(m.strikeAt - this.t),
    }));
    const dynamicPlates = this.arena.dynamicPlates.map((s) => ({
      id: s.id, x: round2(s.x), z: round2(s.z), r: s.r, hp: s.hp, ttl: round2(Math.max(0, s.expireAt - this.t)), owner: s.owner, angle: s.angle || 0,
    }));
    const walls = [];
    for (const w of this.arena.walls) {
      walls.push({ id: w.id, alive: w.alive ? 1 : 0, hp: w.alive ? w.hp : 0, rubble: w.alive ? 0 : Math.max(0, round2((w.rubbleUntil || 0) - this.t)) });
    }
    const towers = this.arena.towers.map((t) => ({ id: t.id, charge: round2(t.chargeLevel || 0) }));
    return {
      t: round2(this.t), phase: this.phase, timeLeft: round2(Math.max(0, this.duration - this.t)),
      countdown: this.phase === 'countdown' ? round2(Math.max(0, this.countdown)) : 0,
      storm: this.stormActive, stormIn: round2(Math.max(0, this.stormStart - this.t)),
      sandstorm: round2(Math.max(0, this.sandstormUntil - this.t)),
      airdrop: this.airdrop && this.airdrop.resolvedAt > this.t && !this.airdrop.itemsSpawned
        ? { x: this.airdrop.x, z: this.airdrop.z } : null,
      event: this.eventBanner,
      players, bullets, mines, grenades, items, zones, markers, dynamicPlates, walls, towers,
      scores: this.scoreboard(),
      teamScores: this.teamScores(),
      fx: this.fx.splice(0, this.fx.length),
      over: this.phase === 'over',
      result: this.result || null,
    };
  }

  teamScores() {
    if (this.settings.mode === 'ffa') return null;
    const t = {};
    for (const p of this.players.values()) t[p.team] = (t[p.team] || 0) + p.score;
    return t;
  }
}

function circleVsWall(c, r, w) {
  const hx = w.w / 2, hz = w.h / 2;
  const dx = c.x - w.x, dz = c.z - w.z;
  const cx = clamp(dx, -hx, hx), cz = clamp(dz, -hz, hz);
  let nx = dx - cx, nz = dz - cz;
  let d = Math.hypot(nx, nz);
  if (d >= r) return null;
  if (d < 1e-5) {
    const overlapX = hx - Math.abs(dx);
    const overlapZ = hz - Math.abs(dz);
    if (overlapX < overlapZ) { nx = Math.sign(dx || 1); nz = 0; d = 0; }
    else { nx = 0; nz = Math.sign(dz || 1); d = 0; }
    return { nx, nz, depth: r };
  }
  return { nx: nx / d, nz: nz / d, depth: r - d };
}

const round2 = (v) => Math.round(v * 100) / 100;
const round3 = (v) => Math.round(v * 1000) / 1000;
