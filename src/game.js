import * as THREE from 'three';
import { ArenaView } from './arenaView.js';
import { Fx } from './fx.js';
import { createMech, updateMech, disposeMech, muzzleWorld } from './mech.js';
import { mechOf } from '../shared/mechs.js';
import {
  ITEM_TYPES, PLAYER_COLORS, TEAM_COLORS, BULLET, PLAYER_RADIUS, DASH,
  clamp, angleDiff, normAngle, dist,
} from '../shared/constants.js';
import { stepMotion, speedFactorForHeat } from '../shared/motion.js';
import { resolvePlayerArena } from '../shared/arena.js';
import {
  glowTexture, iconTexture, skyTexture, hazardTexture, smokeTexture, scorchTexture,
} from './textures.js';

const lerpAngle = (a, b, k) => a + angleDiff(b, a) * k;

// Reused every frame: allocating Raycaster/Vector/Plane objects at 60 fps was
// producing megabytes of garbage per match (and periodic GC hitches).
const _ndc = new THREE.Vector2();
const _ray = new THREE.Raycaster();
const _aimPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -1.0);
const _aimHit = new THREE.Vector3();
const easeOut = (t) => 1 - Math.pow(1 - t, 3);
// Server dash velocity (sim.js): distance / duration * 1.02
const DASH_SPEED = (DASH.distance / DASH.duration) * 1.02;

const SOURCE_NAMES = {
  bolt: '电磁弹', bounceBolt: '反弹弹', charge: '冲撞', hook: '钩爪', mine: '电磁地雷',
  grenade: '电磁手雷', tower: '电磁塔', acid: '酸液池', storm: '电磁风暴', claw: '巨型机械臂',
  explosion: '连锁爆炸', furnace: '炉心自爆', wallBreak: '铁皮墙',
};

export class Game {
  constructor({ stage, audio, ui, send }) {
    this.stage = stage;
    this.audio = audio;
    this.ui = ui;
    this.send = send;
    this.running = false;
    this.scene = null;
    this.camera = null;
    this.arenaView = null;
    this.fx = null;
    this.running = false;
    this.keys = new Set();
    this.mouse = { x: window.innerWidth / 2, y: window.innerHeight / 2, down: false };
    this.pending = { dash: false, skill: false, item: false };
    this.seq = 0;
    this.sendAcc = 0;
    this.shakeTrauma = 0;
    this.fps = 60;
    this.fpsAcc = 0;
    this.fpsFrames = 0;
    this.lowFpsTime = 0;
    this.degraded = false;
    this.lastMinimap = 0;
    this.localShotAt = -1;
    this.localFireNextAt = 0;
    this.predAmmo = null;
    this.ghosts = [];
    this.threat = null;
    this.threatArc = null;
    this.sendNow = false;
    this.time = 0;
    this.bindInputs();
  }

  // ------------------------------------------------------------------ setup
  start(info) {
    this.disposeWorld();
    this.info = info;
    this.myId = info.you;
    this.ended = false;
    this.players = new Map();
    this.bullets = new Map();
    this.items = new Map();
    this.mines = new Map();
    this.grenades = new Map();
    this.zones = new Map();
    this.markers = new Map();
    this.airdropMesh = null;
    this.snap = null;
    this.selfData = null;
    this.time = 0;
    this.shakeTrauma = 0;
    this.killInfo = null;
    this.spectateId = null;
    this.spectatePos = null;
    this.prevAlive = true;
    this.deathPos = null;
    this.roundOver = false;
    this.heatFx = new Map();
    this.localAim = 0;
    this.localVel = { x: 0, z: 0 };
    this.localCharge = 0;
    this.localFireHeld = 0;
    this.localFireNextAt = 0;
    this.predAmmo = null;
    this.ghosts = [];
    this.threat = null;
    this.inputHistory = [];
    this.localDash = { until: 0, dx: 0, dz: 0 };
    this.visOff = { x: 0, z: 0 };
    this.selfDashCd = 0;
    this.selfSnapAt = 0;
    this.phasePrev = 'countdown';
    // Remote players are drawn from a small snapshot buffer instead of being
    // snapped to each 20 Hz packet (see sampleRemote). `remoteClock` is the
    // server timeline we draw at: it advances with the frame, only ever slews
    // slowly towards the newest snapshot, and therefore never jumps — that is
    // what turned 20 Hz bot movement into stutter before.
    this.remoteClock = 0;
    this.remoteTarget = 0;
    this.remoteSet = false;
    this.interpDelay = 0.08;
    this.interpTarget = 0.08;
    this.arrivalOffs = [];

    const arena = info.arena;
    this.arena = arena;
    this.half = arena.half;
    this.size = arena.size;
    this.clientArena = {
      ...arena,
      walls: arena.walls.map((w) => ({ ...w })),
      dynamicPlates: [],
    };
    this.scene = new THREE.Scene();
    const sky = skyTexture();
    sky.mapping = THREE.EquirectangularReflectionMapping;
    sky.needsUpdate = true;
    this.scene.background = sky;
    this.scene.backgroundIntensity = 0.75;
    this.camera = new THREE.PerspectiveCamera(43, window.innerWidth / window.innerHeight, 0.5, 300);
    this.camOffset = { height: this.size * 0.63, back: this.size * 0.45 };
    this.arenaView = new ArenaView(this.scene, arena, this.stage.quality);
    this.fx = new Fx(this.scene, this.stage.quality);

    // The sim shuffles spawns, so trust the positions it actually used
    // (info.spawns) instead of guessing — guessing caused a 30 m pop on GO.
    const spawns = arena.spawns;
    const spawnById = new Map((info.spawns || []).map((s) => [s.id, s]));
    info.players.forEach((p, i) => {
      const sp = spawnById.get(p.id) || spawns[i % spawns.length];
      this.addPlayerVisual(p, sp.x, sp.z);
    });
    const self = this.players.get(this.myId);
    if (self) {
      self.predicted = { x: self.x, z: self.z, vx: 0, vz: 0 };
      const ownSpawn = spawnById.get(this.myId);
      if (ownSpawn && typeof ownSpawn.aim === 'number') this.localAim = ownSpawn.aim;
      this.selfVisual = self;
      this.ui.setKiller(null);
      this.ui.beginMatch({ ...info, roomCode: this.currentRoomCode }, arena);
    }
    this.stage.setActive(this.scene, this.camera);
    this.camera.position.set(self ? self.x : 0, this.camOffset.height, (self ? self.z : 0) + this.camOffset.back);
    this.camera.lookAt(self ? self.x : 0, 0.9, self ? self.z : 0);
    this.camFocus = { x: self ? self.x : 0, z: self ? self.z : 0 };
    this.running = true;
    this.mouse.down = false;
    this.keys.clear();
    this.ui.showScreen('game');
    this.audio?.sfx('countdown');
    this.applyQuality(this.ui.settings.quality, this.ui.settings.renderScale);
    this.lowFpsTime = 0;
    this.autoDegrades = 0;
  }

  setRoomCode(code) { this.currentRoomCode = code; }

  /** Push a graphics preset through every layer that owns visual density. */
  applyQuality(quality, renderScale) {
    const q = quality || this.ui.settings.quality || 'high';
    const scale = renderScale ?? this.ui.settings.renderScale ?? 1;
    try { this.stage?.setQuality(q, scale); } catch (err) { console.warn('[quality] stage', err); }
    try { this.fx?.setQuality(q); } catch (err) { console.warn('[quality] fx', err); }
    try { this.arenaView?.setQuality(q); } catch (err) { console.warn('[quality] arena', err); }
    // CSS switches off the expensive full-screen blend/backdrop filters
    document.body.dataset.quality = q;
    this.quality = q;
    this.minimapInterval = q === 'low' ? 1 / 4 : q === 'med' ? 1 / 6 : 1 / 10;
    return q;
  }

  addPlayerVisual(info, x, z) {
    const parts = createMech(info.mech, info.color, info.name);
    parts.group.position.set(x, 0, z);
    this.scene.add(parts.group);
    const visual = {
      id: info.id, info, parts, x, z, rx: x, rz: z, aim: -Math.PI / 2,
      team: info.team, alive: true, heat: 0, lastShotAt: -1, sniperLine: null,
      heatTimer: Math.random() * 0.3, speed: 0,
    };
    this.players.set(info.id, visual);
    return visual;
  }

  disposeWorld() {
    this.running = false;
    if (this.players) {
      for (const v of this.players.values()) {
        if (v.sniperLine) { this.scene.remove(v.sniperLine); v.sniperLine.geometry.dispose(); v.sniperLine.material.dispose(); }
        this.scene.remove(v.parts.group);
        disposeMech(v.parts);
      }
    }
    if (this.bullets) for (const b of this.bullets.values()) this.removeBullet(b);
    if (this.ghosts) { for (const g of this.ghosts) this.removeBullet(g); this.ghosts.length = 0; }
    if (this.items) for (const it of this.items.values()) this.sceneRemoveGroup(it.group);
    if (this.mines) for (const m of this.mines.values()) this.sceneRemoveGroup(m.group);
    if (this.grenades) for (const g of this.grenades.values()) this.sceneRemoveGroup(g.group);
    if (this.zones) for (const z of this.zones.values()) this.sceneRemoveGroup(z.group);
    if (this.markers) for (const m of this.markers.values()) this.sceneRemoveGroup(m.group);
    if (this.airdropMesh) { this.sceneRemoveGroup(this.airdropMesh.group); this.airdropMesh = null; }
    if (this.threatArc) {
      this.scene.remove(this.threatArc);
      this.threatArc.geometry?.dispose?.();
      this.threatArc.material?.dispose?.();
      this.threatArc = null;
      this.threat = null;
    }
    if (this.fx) this.fx.dispose();
    if (this.arenaView) this.arenaView.dispose();
    this.fx = null;
    this.arenaView = null;
    this.scene = null;
    this.camera = null;
    this.players = new Map();
    this.bullets = new Map();
    this.items = new Map();
    this.mines = new Map();
    this.grenades = new Map();
    this.zones = new Map();
    this.markers = new Map();
  }

  sceneRemoveGroup(g) {
    if (!g || !this.scene) return;
    this.scene.remove(g);
    g.traverse((o) => {
      if (o.isMesh || o.isPoints) {
        o.geometry?.dispose?.();
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) m?.dispose?.();
      } else if (o.isSprite) {
        o.material?.dispose?.();
      }
    });
  }

  // ------------------------------------------------------------------ input
  bindInputs() {
    this.onKeyDown = (e) => {
      if (!this.running || this.ended) return;
      const tag = e.target && e.target.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      const k = e.key.toLowerCase();
      if (['w', 'a', 's', 'd'].includes(k)) {
        if (!this.keys.has(k)) this.sendNow = true;
        this.keys.add(k);
      }
      if (e.code === 'Space') { e.preventDefault(); if (!e.repeat) { this.pending.dash = true; this.sendNow = true; } }
      if (k === 'e') { if (!e.repeat) { this.pending.item = true; this.sendNow = true; } }
      if (k === 'h') { this.mouse.down = false; this.ui?.openModal?.('modal-help'); }
      if (e.code === 'Tab') {
        e.preventDefault();
        this.ui.toggleScoreboard(true);
      }
    };
    this.onKeyUp = (e) => {
      const k = (e.key || '').toLowerCase();
      this.keys.delete(k);
      if (e.code === 'Tab') { e.preventDefault(); this.ui.toggleScoreboard(false); }
    };
    this.onMouseMove = (e) => { this.mouse.x = e.clientX; this.mouse.y = e.clientY; };
    this.onMouseDown = (e) => {
      if (!this.running || this.ended) return;
      // clicks on HUD buttons / modals must not also pull the trigger
      const t = e.target;
      if (t && t.closest && t.closest('button, .modal, input, select, textarea')) return;
      // fire immediately: waiting for the next 30 Hz input tick added up to
      // 33 ms of dead trigger travel on top of the network round trip
      if (e.button === 0) { this.mouse.down = true; this.sendNow = true; }
      if (e.button === 2) { this.pending.skill = true; this.sendNow = true; }
    };
    this.onMouseUp = (e) => { if (e.button === 0) { this.mouse.down = false; this.sendNow = true; } };
    this.onContext = (e) => { if (this.running) e.preventDefault(); };
    this.onBlur = () => { this.keys.clear(); this.mouse.down = false; };
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('mousemove', this.onMouseMove);
    window.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mouseup', this.onMouseUp);
    window.addEventListener('contextmenu', this.onContext);
    window.addEventListener('blur', this.onBlur);
  }

  updateAim() {
    if (!this.camera) return;
    // The camera moves slowly and the mouse only changes on events, so the
    // projected aim point is refreshed at most 30 times per second.
    const now = this.time;
    if (this._aimAt && now - this._aimAt < 1 / 30 && this._aimMouse === this.mouse.x + ':' + this.mouse.y) return;
    this._aimAt = now;
    this._aimMouse = this.mouse.x + ':' + this.mouse.y;
    _ndc.set(
      (this.mouse.x / window.innerWidth) * 2 - 1,
      -(this.mouse.y / window.innerHeight) * 2 + 1,
    );
    _ray.setFromCamera(_ndc, this.camera);
    const got = _ray.ray.intersectPlane(_aimPlane, _aimHit);
    const v = this.selfVisual;
    if (!v) return;
    if (got) {
      const sx = v.rx ?? v.predicted?.x ?? v.x;
      const sz = v.rz ?? v.predicted?.z ?? v.z;
      this.localAim = Math.atan2(_aimHit.z - sz, _aimHit.x - sx);
    }
  }

  sendInputs(dt) {
    if (!this.running) return;
    this.sendAcc += dt;
    let mx = 0, mz = 0;
    if (this.keys.has('w')) mz -= 1;
    if (this.keys.has('s')) mz += 1;
    if (this.keys.has('a')) mx -= 1;
    if (this.keys.has('d')) mx += 1;
    const self = this.selfData;
    const canAct = self && self.alive && this.snap && this.snap.phase === 'live';
    if (!canAct) { mx = 0; mz = 0; }
    if (this.sendAcc >= 1 / 30 || this.sendNow) {
      this.sendAcc = 0;
      this.sendNow = false;
      // Predict the dash locally so the server's 2.8 m burst does not arrive
      // as a surprise correction (that was one source of the "yank back").
      // The cooldown read from the snapshot is already a few ms old, so age it
      // before deciding: a Space press on the boundary must still feel instant.
      const cdLeft = Math.max(0, this.selfDashCd - (this.time - this.selfSnapAt));
      if (this.pending.dash && canAct && cdLeft <= 0.03 && !self.stunned && !(self.channel > 0)) {
        this.localDash.until = this.time + DASH.duration;
        this.selfDashCd = DASH.cooldown;
        this.selfSnapAt = this.time;
        const mv = Math.hypot(mx, mz);
        this.localDash.dx = mv > 0.1 ? mx / mv : Math.cos(this.localAim);
        this.localDash.dz = mv > 0.1 ? mz / mv : Math.sin(this.localAim);
      }
      this.send({
        type: 'input',
        mx, mz,
        aim: Math.round(this.localAim * 1000) / 1000,
        fire: !!(this.mouse.down && canAct),
        // actions pressed during the countdown must not fire on GO: the server
        // would dash somewhere the client never predicted (a 2.8 m yank)
        dash: !!(this.pending.dash && canAct),
        skill: !!(this.pending.skill && canAct),
        useItem: !!(this.pending.item && canAct),
        seq: ++this.seq,
      });
      this.pending.dash = false;
      this.pending.skill = false;
      this.pending.item = false;
    }
  }

  predict(dt) {
    const v = this.selfVisual;
    if (!v || !this.snap) return;
    const s = this.selfData;
    if (!s) return;
    const live = this.snap.phase === 'live';
    if (!s.alive || !live) {
      if (this.snap.phase === 'countdown') { v.predicted.x = s.x; v.predicted.z = s.z; v.predicted.vx = 0; v.predicted.vz = 0; }
      return;
    }
    let mx = 0, mz = 0;
    if (this.keys.has('w')) mz -= 1;
    if (this.keys.has('s')) mz += 1;
    if (this.keys.has('a')) mx -= 1;
    if (this.keys.has('d')) mx += 1;
    const mech = mechOf(s.mech);
    let speedMult = mech.stats.speed * speedFactorForHeat(s.heat || 0);
    if (s.inAcid) speedMult *= 0.8;
    if (s.sniperCharge) speedMult *= 0.8;
    const dashing = this.time < this.localDash.until;
    const overrideVel = dashing ? { x: this.localDash.dx * DASH_SPEED, z: this.localDash.dz * DASH_SPEED } : null;
    stepMotion(v.predicted, { mx, mz }, dt, {
      speedMult,
      stunned: !!s.stunned,
      immobile: (s.channel || 0) > 0,
      overrideVel,
    });
    resolvePlayerArena(this.clientArena, v.predicted, PLAYER_RADIUS);
    // Record exactly what this frame simulated, tagged with the newest input
    // sequence that had been sent. Replaying these frames on top of an
    // authoritative snapshot reproduces the motion the player already saw.
    this.inputHistory.push({
      seq: this.seq, mx, mz, dt, speedMult,
      stunned: !!s.stunned,
      immobile: (s.channel || 0) > 0,
      ov: overrideVel ? { x: overrideVel.x, z: overrideVel.z } : null,
    });
    if (this.inputHistory.length > 240) this.inputHistory.splice(0, this.inputHistory.length - 240);
    // position = prediction + the decaying visual offset that hides corrections
    v.x = v.predicted.x + this.visOff.x;
    v.z = v.predicted.z + this.visOff.z;
    v.rx = v.predicted.x;
    v.rz = v.predicted.z;
    v.speed = Math.hypot(v.predicted.vx, v.predicted.vz);
  }

  /**
   * Authoritative snapshot vs local prediction.
   *
   * The old code compared the *current* predicted position with the snapshot's
   * (already stale) position. At 6.4 m/s that gap is simply the network
   * latency converted to metres, so every snapshot dragged the mech backwards
   * and any jitter crossed the 2.4 m limit and teleported it — the "yanked
   * back" bug.
   *
   * Now the authoritative state is used as a starting point and the frames the
   * server has not simulated yet are replayed on top (Quake-style). The result
   * is where the player *should* be given the same inputs, so the residual is
   * near zero even with 120 ms of latency, and dashes/acceleration replay
   * exactly instead of fighting the correction.
   */
  reconcileSelf(v, p, wasAlive) {
    if (!v.predicted) return;
    const hist = this.inputHistory;
    const ack = p.seq | 0;
    // the cooldown estimate must never move backwards: snapshots taken before
    // a dash we already predicted still say "ready"
    if (typeof p.dashCd === 'number') {
      const localCd = Math.max(0, this.selfDashCd - (this.time - this.selfSnapAt));
      this.selfDashCd = Math.max(p.dashCd, localCd);
      this.selfSnapAt = this.time;
    }

    if (!wasAlive && p.alive) {
      v.predicted.x = p.x; v.predicted.z = p.z; v.predicted.vx = 0; v.predicted.vz = 0;
      this.visOff.x = 0; this.visOff.z = 0;
      this.prevSrvPos = { x: p.x, z: p.z };
      this.prevAlive = true;
      this.ui.setKiller(null);
      this.fx.ring(p.x, p.z, { color: '#9fe9ff', r0: 0.3, r1: 2.6, life: 0.6 });
      this.audio?.sfx('respawn');
      this.camFocus.x = p.x; this.camFocus.z = p.z;
      hist.length = 0;
      return;
    }
    if (!p.alive) {
      this.prevAlive = false;
      this.deathPos = { x: p.x, z: p.z };
      v.predicted.x = p.x; v.predicted.z = p.z;
      v.x = p.x; v.z = p.z;
      this.visOff.x = 0; this.visOff.z = 0;
      this.prevSrvPos = { x: p.x, z: p.z };
      hist.length = 0;
      return;
    }

    // frames the server has not simulated yet: everything sent after the ack
    let i0 = 0;
    while (i0 < hist.length && hist[i0].seq <= ack) i0++;

    const justWentLive = this.phasePrev === 'countdown' && this.snap && this.snap.phase === 'live';
    this.phasePrev = this.snap ? this.snap.phase : this.phasePrev;

    const beforeX = v.predicted.x;
    const beforeZ = v.predicted.z;

    // replay the pending frames on top of the authoritative state
    const replayed = { x: p.x, z: p.z, vx: p.vx || 0, vz: p.vz || 0 };
    for (let i = i0; i < hist.length; i++) {
      const h = hist[i];
      stepMotion(replayed, { mx: h.mx, mz: h.mz }, h.dt, {
        speedMult: h.speedMult,
        stunned: h.stunned,
        immobile: h.immobile,
        overrideVel: h.ov,
      });
      resolvePlayerArena(this.clientArena, replayed, PLAYER_RADIUS);
    }
    // keep only the frames still in flight
    if (i0 > 0) hist.splice(0, i0);

    const dx = replayed.x - beforeX;
    const dz = replayed.z - beforeZ;
    const err = Math.hypot(dx, dz);

    // A match start is the one moment where a hard cut is expected; every
    // other correction keeps the rendered position continuous (the offset is
    // then drained at a bounded rate, so it never reads as a jerk).
    if (justWentLive) {
      v.predicted.x = replayed.x; v.predicted.z = replayed.z;
      v.predicted.vx = replayed.vx; v.predicted.vz = replayed.vz;
      this.visOff.x = 0; this.visOff.z = 0;
      this.prevSrvPos = { x: p.x, z: p.z };
      return;
    }

    // where the player actually sees the mech right now
    const renderX = beforeX + this.visOff.x;
    const renderZ = beforeZ + this.visOff.z;

    v.predicted.x = replayed.x;
    v.predicted.z = replayed.z;
    v.predicted.vx = replayed.vx;
    v.predicted.vz = replayed.vz;
    if (err < 0.002) return;

    // A real teleport (claw grab, respawn hook, admin move) cannot be hidden by
    // trailing behind for two seconds — cut instead.
    const srvJump = this.prevSrvPos
      ? Math.hypot(p.x - this.prevSrvPos.x, p.z - this.prevSrvPos.z)
      : 0;
    this.prevSrvPos = { x: p.x, z: p.z };
    if (srvJump > 4 || err > 5) {
      this.visOff.x = 0; this.visOff.z = 0;
      return;
    }

    // keep the pixels where they were; updatePlayers() drains the offset at a
    // fixed 2 cm per frame, so it never reads as a jerk
    this.visOff.x = renderX - replayed.x;
    this.visOff.z = renderZ - replayed.z;
  }

  // --------------------------------------------------------------- snapshots
  onSnapshot(snap, youId = this.myId) {
    if (!snap || !this.running) return;
    this.snap = snap;
    this.myId = youId || this.myId;
    const now = performance.now();
    this.snapAt = now;
    this.updateServerClock(snap.t);
    for (const p of snap.players) {
      const v = this.players.get(p.id);
      if (!v) continue;
      const wasAlive = v.alive;
      v.data = p;
      v.alive = p.alive;
      if (p.id !== this.myId) this.pushSample(v, p, snap.t || 0);
      v.heat = p.heat;
      v.targetX = p.x; v.targetZ = p.z;
      v.aim = p.id === this.myId ? this.localAim : v.aim;
      if (p.id === this.myId) {
        this.selfData = p;
        this.reconcileSelf(v, p, wasAlive);
      } else {
        if (!wasAlive && p.alive) {
          v.rx = p.x; v.rz = p.z;
          this.audio?.sfx('respawn', { pan: this.panFor(p.x) });
        }
        if (wasAlive && !p.alive) {
          this.fx.smokePuff(p.x, 1.0, p.z, 6, '#3a3632', 1.5, 1.2, 0.7);
        }
      }
    }
    // walls & props
    this.clientArena.walls = snap.walls.map((w) => {
      const base = this.arena.walls.find((x) => x.id === w.id);
      return { ...base, alive: !!w.alive, hp: w.hp };
    });
    this.arenaView.updateWalls(snap.walls);
    this.arenaView.updateTowers(snap.towers);
    this.arenaView.updateDynamicPlates(snap.dynamicPlates);
    this.clientArena.dynamicPlates = snap.dynamicPlates.map((p) => ({ ...p, alive: p.hp > 0 }));
    this.syncBullets(snap.bullets);
    this.syncItems(snap.items);
    this.syncMines(snap.mines);
    this.syncGrenades(snap.grenades);
    this.syncZones(snap.zones);
    this.syncMarkers(snap.markers);
    this.syncAirdrop(snap.airdrop);
    this.processFx(snap.fx);
    this.ui.updateHUD(snap, this.selfData, { dt: this.lastDt || 0.05 });
    if (this.snap && this.snap.sandstorm > 0) this.ui.setSandstorm(true);
    else this.ui.setSandstorm(false);
    if (this.snap.over) this.roundOver = true;
  }

  processFx(list) {
    if (!list || !list.length) return;
    const players = this.snap?.players || [];
    const byId = new Map(players.map((p) => [p.id, p]));
    for (const e of list) {
      switch (e.e) {
        case 'shot': {
          const v = this.players.get(e.id);
          if (v && e.id !== this.myId) {
            this.fx.muzzle(e.x + Math.cos(e.aim) * 0.7, 1.05, e.z + Math.sin(e.aim) * 0.7, e.charged ? '#ffd27a' : '#9fe9ff');
            this.audio?.sfx(e.type === 'rail' ? 'rail' : 'shot', { pan: this.panFor(e.x), volume: this.volFor(e.x, e.z), charged: e.charged });
          }
          break;
        }
        case 'bounce':
          this.fx.bounce(e.x, e.z, e.n >= 2 ? '#ffe08a' : '#9fe9ff', 0.85);
          this.audio?.sfx('bounce', { pan: this.panFor(e.x), volume: this.volFor(e.x, e.z) * 0.8, n: e.n });
          break;
        case 'wallHit': {
          this.fx.sparkBurst(e.x, 0.8, e.z, '#ffd9a0', 4, 3, 0.5, 0.3);
          break;
        }
        case 'wallBreak': {
          this.fx.debrisBurst(e.x, e.z, 8);
          this.fx.smokePuff(e.x, 0.6, e.z, 5, '#8b8074', 1.4, 1.1, 0.7);
          this.fx.explosion(e.x, e.z, { scale: 0.6, color: '#c9b08a' });
          this.audio?.sfx('explosion', { pan: this.panFor(e.x), volume: this.volFor(e.x, e.z) * 0.55 });
          this.shake(0.25, e.x, e.z);
          break;
        }
        case 'wallRebuild': {
          this.fx.sparkBurst(e.x, 0.6, e.z, '#ffb02e', 8, 3, 0.7, 0.5);
          break;
        }
        case 'heatHit': {
          const victim = byId.get(e.id);
          if (!victim) break;
          this.fx.sparkBurst(e.x, 0.9, e.z, e.source === 'tower' ? '#9fe9ff' : '#ffb45c', 7, 5, 0.8, 0.45);
          const dmg = Math.round(e.amount);
          if (e.attacker === this.myId && e.id !== this.myId) {
            this.ui.hitmarker(dmg >= 20);
            this.floatWorld(victim.x, 1.8, victim.z, '+' + dmg, e.bounced ? 'bounce' : 'dmg');
            this.audio?.sfx('hit', { pan: this.panFor(victim.x), volume: 0.9 });
          } else if (e.id === this.myId) {
            this.floatWorld(victim.x, 1.8, victim.z, '+' + dmg, 'self');
            this.flashDamage(0.35);
            this.shake(0.18, victim.x, victim.z);
            this.audio?.sfx('hit', { pan: 0, volume: 0.8 });
          }
          break;
        }
        case 'hitMarker': {
          if (e.owner === this.myId && e.target !== this.myId) this.ui.hitmarker(false);
          break;
        }
        case 'shortCircuit': {
          this.fx.shortCircuit(e.x, e.z, { color: e.color });
          this.audio?.sfx('shortCircuit', { pan: this.panFor(e.x), volume: this.volFor(e.x, e.z) });
          this.shake(0.75, e.x, e.z);
          const victim = byId.get(e.id);
          const attacker = e.killer != null ? byId.get(e.killer) : null;
          const tag = this.tagFor(e.source, e.furnace);
          if (victim && attacker && attacker.id !== victim.id) this.ui.killfeed(attacker, victim, tag);
          else if (victim) this.ui.killfeed(null, victim, tag || '温度失控');
          if (e.id === this.myId) {
            const src = e.source === 'bounceBolt' ? '反弹电磁弹' : SOURCE_NAMES[e.source] || '过载';
            this.ui.setKiller(attacker && attacker.id !== e.id ? attacker.name : src, attacker?.color);
            this.spectateId = attacker && attacker.id !== e.id ? attacker.id : null;
            this.deathPos = { x: e.x, z: e.z };
            this.audio?.sfx('death');
            this.ui.hitmarker(false);
            this.spectatePos = null;
          }
          if (e.killer === this.myId && e.id !== this.myId) this.ui.hitmarker(true);
          break;
        }
        case 'dash':
          this.fx.smokePuff(e.x, 0.4, e.z, 4, '#a9a294', 0.9, 0.6, 1.2);
          this.fx.sparkBurst(e.x, 0.4, e.z, '#9fe9ff', 5, 3, 0.6, 0.3);
          if (e.id === this.myId) this.audio?.sfx('dash');
          else this.audio?.sfx('dash', { pan: this.panFor(e.x), volume: 0.5 });
          break;
        case 'chargeHit':
          this.fx.explosion(e.x, e.z, { scale: 0.45, color: '#ffcf6a' });
          this.shake(0.3, e.x, e.z);
          this.audio?.sfx('explosion', { pan: this.panFor(e.x), volume: 0.4 });
          break;
        case 'minePlace':
          this.audio?.sfx('pickup', { pan: this.panFor(e.x), volume: 0.4 });
          break;
        case 'mineBoom':
        case 'grenadeBoom':
          this.fx.explosion(e.x, e.z, { scale: Math.max(0.8, (e.radius || 3) / 3), color: '#ffac5a' });
          this.audio?.sfx('explosion', { pan: this.panFor(e.x), volume: this.volFor(e.x, e.z) });
          this.shake(0.5, e.x, e.z);
          break;
        case 'shieldUp':
          this.fx.ring(e.x, e.z, { color: '#5ad8ff', r0: 0.4, r1: 2.4, life: 0.5 });
          this.audio?.sfx('shield', { pan: this.panFor(e.x), volume: 0.7 });
          break;
        case 'shieldBounce':
          this.fx.bounce(e.x, e.z, '#aef6ff', 1.0);
          this.audio?.sfx('shieldBounce', { pan: this.panFor(e.x) });
          break;
        case 'hookHit':
        case 'hookMiss':
          this.fx.beam(e.x, 1.1, e.z, e.x + Math.cos(e.aim) * (e.len || 2), 1.1, e.z + Math.sin(e.aim) * (e.len || 2), '#ffd83d', 0.2, 0.05);
          this.fx.sparkBurst(e.x, 1.0, e.z, '#ffd83d', 5, 3, 0.6, 0.3);
          this.audio?.sfx('hook', { pan: this.panFor(e.x), volume: 0.6 });
          break;
        case 'sniperCharge':
          this.audio?.sfx('rail', { pan: this.panFor(e.x), volume: 0.25 });
          break;
        case 'sniperShot':
          this.fx.beam(e.x, 1.2, e.z, e.x + Math.cos(e.aim) * 30, 1.2, e.z + Math.sin(e.aim) * 30, '#bff6ff', 0.12, 0.09);
          this.audio?.sfx('rail', { pan: this.panFor(e.x), volume: 0.9 });
          this.shake(0.15, e.x, e.z);
          break;
        case 'itemPickup': {
          this.fx.ring(e.x, e.z, { color: ITEM_TYPES[e.item]?.color || '#fff', r0: 0.2, r1: 1.6, life: 0.4 });
          if (e.id === this.myId) {
            this.audio?.sfx('pickup');
            const it = ITEM_TYPES[e.item];
            if (it) this.ui.toast(`拾取 ${it.name} · ${it.desc}`, 'ok');
          }
          break;
        }
        case 'itemSpawn':
          this.fx.ring(e.x, e.z, { color: ITEM_TYPES[e.item]?.color || '#fff', r0: 0.4, r1: 2.2, life: 0.6 });
          this.audio?.sfx('pickup', { pan: this.panFor(e.x), volume: 0.3 });
          break;
        case 'overclock':
          this.fx.ring(e.x, e.z, { color: '#ff5bc8', r0: 0.4, r1: 2.2, life: 0.6 });
          if (e.id === this.myId) { this.audio?.sfx('itemUse'); this.ui.toast('超载核心启动 · 攻击 +30%，过载 +50%', 'err'); }
          break;
        case 'purge':
          this.fx.ring(e.x, e.z, { color: '#9dff57', r0: 0.3, r1: 2.8, life: 0.7 });
          this.fx.sparkBurst(e.x, 0.8, e.z, '#9dff57', 14, 5, 0.7, 0.6);
          if (e.id === this.myId) this.audio?.sfx('cooling');
          break;
        case 'cooled':
          this.fx.ring(e.x, e.z, { color: '#8fe9ff', r0: 0.3, r1: 2.0, life: 0.6 });
          this.fx.smokePuff(e.x, 1.0, e.z, 5, '#cfefff', 1.2, 1.4, 0.5);
          this.audio?.sfx('cooling', { pan: this.panFor(e.x), volume: 0.7 });
          break;
        case 'channelStart':
          this.audio?.sfx('cooling', { pan: this.panFor(e.x), volume: 0.5 });
          break;
        case 'platePlace':
          this.audio?.sfx('pickup', { pan: this.panFor(e.x), volume: 0.4 });
          this.fx.ring(e.x, e.z, { color: '#5ad8ff', r0: 0.3, r1: 1.6, life: 0.4 });
          break;
        case 'plateBreak':
        case 'plateExpire':
          this.fx.sparkBurst(e.x, 0.8, e.z, '#9fe9ff', 8, 4, 0.6, 0.4);
          break;
        case 'towerZap': {
          this.fx.ring(e.x, e.z, { color: '#9fe9ff', r0: e.r * 0.2, r1: e.r, life: 0.35, opacity: 0.7 });
          const victims = players.filter((p) => p.alive && dist(p.x, p.z, e.x, e.z) < e.r);
          for (const v of victims) {
            this.fx.beam(e.x, 4.2, e.z, v.x, 1.0, v.z, '#bff6ff', 0.18, 0.07);
            this.fx.sparkBurst(v.x, 1.0, v.z, '#bff6ff', 5, 4, 0.7, 0.4);
          }
          this.audio?.sfx('tower', { pan: this.panFor(e.x), volume: this.volFor(e.x, e.z) });
          if (victims.some((v) => v.id === this.myId)) { this.shake(0.25, e.x, e.z); this.flashDamage(0.25); }
          break;
        }
        case 'clawWarn':
          this.audio?.sfx('clawWarn', { pan: this.panFor(e.x), volume: 0.6 });
          break;
        case 'clawSlam':
          this.fx.debrisBurst(e.x, e.z, 12);
          this.fx.smokePuff(e.x, 0.6, e.z, 12, '#8a7c6b', 2.2, 1.6, 1.6);
          this.fx.explosion(e.x, e.z, { scale: 0.9, color: '#c9b08a' });
          this.audio?.sfx('claw', { pan: this.panFor(e.x), volume: this.volFor(e.x, e.z) });
          this.shake(0.75, e.x, e.z);
          break;
        case 'eventWarn':
          this.audio?.sfx('alarm');
          break;
        case 'airdropWarn':
          this.fx.ring(e.x, e.z, { color: '#ff5bc8', r0: 0.5, r1: 4, life: 0.8 });
          this.audio?.sfx('alarm');
          break;
        case 'sandstormStart':
          this.audio?.sfx('storm');
          this.ui.setSandstorm(true);
          this.ui.toast('沙尘暴来袭 · 视野下降', 'err');
          break;
        case 'sandstormEnd':
          this.ui.setSandstorm(false);
          break;
        case 'eventBanner':
          this.ui.toast(`${e.icon || '⚠'} ${e.name} · ${e.desc}`, '');
          break;
        case 'matchLive':
          this.audio?.sfx('start');
          break;
        case 'suddenDeath':
          this.audio?.sfx('storm');
          this.ui.toast('电磁风暴启动 · 全场过载加速', 'err');
          break;
        case 'mineExpire':
          break;
        case 'respawn':
          this.fx.ring(e.x, e.z, { color: '#9fe9ff', r0: 0.2, r1: 2.0, life: 0.5 });
          break;
        default: break;
      }
    }
  }

  tagFor(source, furnace) {
    if (furnace) return '自爆';
    return {
      bounceBolt: '反弹', bolt: '短路', charge: '冲撞', hook: '钩爪', mine: '地雷',
      grenade: '手雷', tower: '电磁塔', acid: '酸液', storm: '风暴', claw: '机械臂',
      explosion: '连锁', furnace: '自爆', wallBreak: '铁皮墙',
    }[source] || '';
  }

  flashDamage(v) {
    this.damageFlash = Math.max(this.damageFlash || 0, v);
  }

  shake(amount, x, z) {
    if (!this.ui.settings.shake) return;
    const d = this.selfVisual ? dist(x, z, this.selfVisual.x, this.selfVisual.z) : 12;
    const k = clamp(1 - d / 20, 0.1, 1);
    this.shakeTrauma = Math.min(1.2, this.shakeTrauma + amount * k);
  }

  panFor(x) {
    if (!this.camera || !this.selfVisual) return 0;
    return clamp((x - this.selfVisual.x) / (this.size * 0.35), -1, 1);
  }
  volFor(x, z) {
    if (!this.selfVisual) return 1;
    const d = dist(x, z, this.selfVisual.x, this.selfVisual.z);
    return clamp(1 - d / 38, 0.08, 1);
  }

  // ------------------------------------------------------------------ bullets
  syncBullets(list) {
    const seen = new Set();
    const t = typeof this.snap?.t === 'number' ? this.snap.t : this.remoteClock;
    for (const b of list) {
      seen.add(b.id);
      let mesh = this.bullets.get(b.id);
      if (!mesh) {
        mesh = this.makeBullet(b);
        this.bullets.set(b.id, mesh);
        mesh.x = b.x; mesh.z = b.z;
        // our own shot came back from the server: retire the predicted tracer
        if (b.owner === this.myId && this.ghosts.length) this.handOffGhost();
      }
      mesh.seenAt = performance.now();
      mesh.owner = b.owner;
      mesh.vx = b.vx; mesh.vz = b.vz;
      mesh.type = b.type;
      mesh.charged = b.charged;
      // Same treatment as remote mechs: keep the samples and interpolate.
      // Extrapolating from the newest packet and pulling back towards it is
      // what made a 18 m/s bolt advance in 0.9 m hops.
      const samples = mesh.samples;
      const last = samples[samples.length - 1];
      if (!last || t > last.t) {
        samples.push({ t, x: b.x, z: b.z, vx: b.vx, vz: b.vz });
        if (samples.length > 10) samples.shift();
      }
    }
    for (const [id, mesh] of this.bullets) {
      mesh.gone = !seen.has(id);
    }
  }

  makeBullet(b) {
    const g = new THREE.Group();
    const colour = b.type === 'rail' ? '#ff8fe6' : b.charged ? '#ffd27a' : '#9fe9ff';
    const core = new THREE.Mesh(
      new THREE.SphereGeometry(b.type === 'rail' ? 0.12 : 0.09, 8, 6),
      new THREE.MeshBasicMaterial({ color: '#ffffff' })
    );
    g.add(core);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: colour, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
    glow.scale.set(b.type === 'rail' ? 2.2 : 1.2, b.type === 'rail' ? 2.2 : 1.2, 1);
    g.add(glow);
    const trail = new THREE.Mesh(
      new THREE.BoxGeometry(b.type === 'rail' ? 2.4 : 0.85, 0.045, 0.045),
      new THREE.MeshBasicMaterial({ color: colour, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    trail.position.x = -(b.type === 'rail' ? 1.2 : 0.44);
    g.add(trail);
    this.scene.add(g);
    return {
      group: g, x: b.x, z: b.z, vx: b.vx, vz: b.vz, type: b.type, charged: b.charged,
      owner: b.owner, colour, core, trail, seenAt: performance.now(), samples: [],
    };
  }

  removeBullet(mesh) {
    if (!mesh) return;
    this.scene.remove(mesh.group);
    mesh.group.traverse((o) => {
      if (o.isMesh) { o.geometry?.dispose?.(); o.material?.dispose?.(); }
      else if (o.isSprite) { o.material?.dispose?.(); }
    });
    for (const [id, m] of this.bullets) if (m === mesh) this.bullets.delete(id);
  }

  /**
   * Position of a bolt at render time `rt`, from its sample history.
   *
   * Bolts fly straight between bounces, so between two samples plain
   * interpolation is exact; outside the history we continue along the segment
   * direction (never along `mesh.vx`, which is the *latest* velocity and flips
   * at a bounce — using it made a bolt that bounced right after spawning jump
   * to the far side of its last sample).
   */
  sampleBullet(mesh, rt) {
    const s = mesh.samples;
    const n = s.length;
    if (!n) return null;
    const first = s[0];
    const last = s[n - 1];
    const speed = Math.hypot(last.vx, last.vz) || Math.hypot(mesh.vx, mesh.vz) || BULLET.speed;

    if (rt >= last.t) {
      let ux = last.vx;
      let uz = last.vz;
      if (n > 1) { ux = last.x - s[n - 2].x; uz = last.z - s[n - 2].z; }
      const len = Math.hypot(ux, uz) || 1;
      const ahead = clamp(rt - last.t, 0, 0.2);
      return { x: last.x + (ux / len) * speed * ahead, z: last.z + (uz / len) * speed * ahead, dirX: ux, dirZ: uz };
    }
    if (rt <= first.t) {
      let ux = first.vx;
      let uz = first.vz;
      if (n > 1) { ux = s[1].x - first.x; uz = s[1].z - first.z; }
      const len = Math.hypot(ux, uz) || 1;
      // before our oldest sample: run the shot back towards the muzzle rather
      // than parking it until the render clock catches up
      const back = Math.max(-0.4, rt - first.t);
      return { x: first.x + (ux / len) * speed * back, z: first.z + (uz / len) * speed * back, dirX: ux, dirZ: uz };
    }
    let i = n - 1;
    while (i > 0 && s[i].t > rt) i--;
    const a = s[i];
    const b = s[i + 1] || a;
    const f = b.t > a.t ? clamp((rt - a.t) / (b.t - a.t), 0, 1) : 0;
    const x = a.x + (b.x - a.x) * f;
    const z = a.z + (b.z - a.z) * f;
    return { x, z, dirX: b.x - a.x, dirZ: b.z - a.z };
  }

  /**
   * Incoming-fire warning.
   *
   * Losing to bots that shoot from off-screen reads as "I died for no reason".
   * Every frame we look for the enemy bolt whose closest approach to the local
   * mech happens within ~0.55 s and inside ~1.2 m, and paint a red arc on the
   * floor pointing at it. Being able to see the danger is enough to dodge.
   */
  updateThreat() {
    const v = this.players.get(this.myId);
    const self = this.selfData;
    if (!v || !self || !self.alive || !this.running) { this.threat = null; this.drawThreat(); return; }
    let best = null;
    for (const b of this.bullets.values()) {
      if (b.owner === this.myId || b.ghost || b.gone) continue;
      const dx = b.x - v.x;
      const dz = b.z - v.z;
      const d = Math.hypot(dx, dz);
      if (d > 14) continue;
      const speed = Math.hypot(b.vx, b.vz) || BULLET.speed;
      // how close does it come to us on its current heading?
      const t = -(dx * b.vx + dz * b.vz) / (speed * speed);
      if (t < -0.02 || t > 0.55) continue;
      const px = dx + b.vx * t;
      const pz = dz + b.vz * t;
      const miss = Math.hypot(px, pz);
      if (miss > 1.25) continue;
      const score = t;
      if (!best || score < best.score) {
        best = {
          score, t, miss,
          angle: Math.atan2(b.z - v.z, b.x - v.x),
          dist: d,
        };
      }
    }
    this.threat = best;
    this.drawThreat();
    if (best && this.time - (this.lastThreatSfxAt || -9) > 1.1) {
      this.lastThreatSfxAt = this.time;
      this.audio?.sfx('dash', { volume: 0.18 });
    }
  }

  drawThreat() {
    const v = this.players.get(this.myId);
    if (!v) { if (this.threatArc) this.threatArc.visible = false; return; }
    if (!this.threatArc) {
      const geo = new THREE.RingGeometry(1.0, 1.28, 26, 1, -0.42, 0.84);
      const mat = new THREE.MeshBasicMaterial({
        color: '#ff3b2f', transparent: true, opacity: 0.85,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
      });
      this.threatArc = new THREE.Mesh(geo, mat);
      this.threatArc.rotation.x = -Math.PI / 2;
      this.threatArc.position.y = 0.06;
      this.threatArc.visible = false;
      this.scene.add(this.threatArc);
    }
    const arc = this.threatArc;
    if (!this.threat || !v.alive) { arc.visible = false; return; }
    arc.visible = true;
    arc.position.set(v.x, 0.06, v.z);
    arc.rotation.z = 0; // keep the x-rotation flat, orient with Y below
    arc.rotation.y = -this.threat.angle;
    const urgency = 1 - clamp(this.threat.t / 0.55, 0, 1);
    arc.material.opacity = 0.45 + urgency * 0.5;
    const s = 1 + urgency * 0.12;
    arc.scale.set(s, s, s);
  }

  updateBullets(dt) {
    const rt = this.remoteClock;
    for (const mesh of this.bullets.values()) {
      if (!this.clientArena) continue;
      const p = this.sampleBullet(mesh, rt);
      if (!p) continue;
      // The server stopped listing it (hit, expired). Keep drawing it until
      // the render clock reaches the last sample we got, then drop it — the
      // old wall-clock timer removed bolts before they had visibly reached
      // their target, because the client draws a little in the past.
      const last = mesh.samples[mesh.samples.length - 1];
      if (mesh.gone && (rt >= last.t + 0.02 || this.time - last.t > 3)) {
        this.removeBullet(mesh);
        continue;
      }
      const half = this.half - 0.2;
      const x = Math.abs(p.x) > half ? Math.sign(p.x) * half : p.x;
      const z = Math.abs(p.z) > half ? Math.sign(p.z) * half : p.z;
      mesh.x = x; mesh.z = z;
      mesh.rendered = true;
      mesh.group.position.set(x, 0.95, z);
      mesh.group.rotation.y = -Math.atan2(p.dirZ, p.dirX);
    }
  }

  // ------------------------------------------------------------------ items
  syncItems(list) {
    const seen = new Set();
    for (const it of list) {
      seen.add(it.id);
      let m = this.items.get(it.id);
      if (!m) {
        m = this.makeItem(it);
        this.items.set(it.id, m);
      }
      m.x = it.x; m.z = it.z;
    }
    for (const [id, m] of this.items) {
      if (!seen.has(id)) { this.sceneRemoveGroup(m.group); this.items.delete(id); }
    }
  }

  makeItem(it) {
    const def = ITEM_TYPES[it.type] || { color: '#fff', icon: 'box', name: '道具' };
    const g = new THREE.Group();
    g.position.set(it.x, 0, it.z);
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.55, 0.7, 24),
      new THREE.MeshBasicMaterial({ color: def.color, transparent: true, opacity: 0.55, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.04;
    g.add(ring);
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.1, 0.42, 2.2, 12, 1, true),
      new THREE.MeshBasicMaterial({ color: def.color, transparent: true, opacity: 0.1, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    beam.position.y = 1.1;
    g.add(beam);
    const icon = new THREE.Sprite(new THREE.SpriteMaterial({ map: iconTexture(def.icon, def.color), transparent: true, depthWrite: false }));
    icon.scale.set(0.9, 0.9, 1);
    icon.position.y = 1.05;
    g.add(icon);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: def.color, transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false }));
    glow.scale.set(2.2, 2.2, 1);
    glow.position.y = 0.8;
    g.add(glow);
    const cube = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.26, 0.26), new THREE.MeshStandardMaterial({ color: def.color, emissive: def.color, emissiveIntensity: 0.7, metalness: 0.6, roughness: 0.3 }));
    cube.position.y = 0.55;
    g.add(cube);
    this.scene.add(g);
    return { group: g, icon, cube, x: it.x, z: it.z, phase: Math.random() * 6.28 };
  }

  // ------------------------------------------------------------------ mines etc.
  syncMines(list) {
    const seen = new Set();
    for (const m of list) {
      seen.add(m.id);
      let mesh = this.mines.get(m.id);
      if (!mesh) {
        mesh = this.makeMine(m);
        this.mines.set(m.id, mesh);
      }
      mesh.armed = m.armed;
      mesh.x = m.x; mesh.z = m.z;
    }
    for (const [id, m] of this.mines) {
      if (!seen.has(id)) { this.sceneRemoveGroup(m.group); this.mines.delete(id); }
    }
  }

  makeMine(m) {
    const owner = this.players.get(m.owner);
    const color = owner?.info?.color || '#ffb02e';
    const g = new THREE.Group();
    g.position.set(m.x, 0, m.z);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.42, 0.16, 10), new THREE.MeshStandardMaterial({ color: '#2d3233', metalness: 0.8, roughness: 0.4 }));
    base.position.y = 0.08;
    g.add(base);
    const light = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), new THREE.MeshBasicMaterial({ color }));
    light.position.y = 0.22;
    g.add(light);
    const ring = new THREE.Mesh(new THREE.RingGeometry(1.1, 1.2, 28), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.2, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.03;
    g.add(ring);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false }));
    glow.scale.set(1.6, 1.6, 1); glow.position.y = 0.25;
    g.add(glow);
    this.scene.add(g);
    return { group: g, light, ring, glow, armed: false, phase: Math.random() * 6.28, x: m.x, z: m.z };
  }

  syncGrenades(list) {
    const seen = new Set();
    for (const gr of list) {
      seen.add(gr.id);
      let mesh = this.grenades.get(gr.id);
      if (!mesh) {
        mesh = this.makeGrenade(gr);
        this.grenades.set(gr.id, mesh);
      }
      mesh.x = gr.x; mesh.z = gr.z; mesh.fuse = gr.fuse;
    }
    for (const [id, m] of this.grenades) {
      if (!seen.has(id)) { this.sceneRemoveGroup(m.group); this.grenades.delete(id); }
    }
  }

  makeGrenade(gr) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 8), new THREE.MeshStandardMaterial({ color: '#3a3f3d', metalness: 0.7, roughness: 0.45 }));
    body.position.y = 0.3;
    g.add(body);
    const light = new THREE.Mesh(new THREE.SphereGeometry(0.07, 6, 6), new THREE.MeshBasicMaterial({ color: '#ff7043' }));
    light.position.y = 0.46;
    g.add(light);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: '#ff8a3d', transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false }));
    glow.scale.set(1.4, 1.4, 1); glow.position.y = 0.4;
    g.add(glow);
    const ring = new THREE.Mesh(new THREE.RingGeometry(2.8, 3, 40), new THREE.MeshBasicMaterial({ color: '#ff5a36', transparent: true, opacity: 0.2, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.04;
    g.add(ring);
    g.position.set(gr.x, 0, gr.z);
    this.scene.add(g);
    return { group: g, light, glow, ring, x: gr.x, z: gr.z, fuse: gr.fuse, phase: Math.random() * 6.28 };
  }

  // ------------------------------------------------------------------ zones
  syncZones(list) {
    const seen = new Set();
    for (const z of list) {
      seen.add(z.id);
      let mesh = this.zones.get(z.id);
      if (!mesh) {
        mesh = this.makeZone(z);
        this.zones.set(z.id, mesh);
      }
      mesh.data = z;
    }
    for (const [id, m] of this.zones) {
      if (!seen.has(id)) { this.sceneRemoveGroup(m.group); this.zones.delete(id); }
    }
  }

  makeZone(z) {
    const g = new THREE.Group();
    g.position.set(z.x, 0, z.z);
    let color = z.type === 'storm' ? '#5ae0ff' : '#9dff57';
    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(z.r, 40),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: z.type === 'storm' ? 0.08 : 0.28, blending: z.type === 'storm' ? THREE.AdditiveBlending : THREE.NormalBlending, depthWrite: false })
    );
    disc.rotation.x = -Math.PI / 2; disc.position.y = 0.03;
    g.add(disc);
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(z.r - 0.14, z.r, 48),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.6, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.05;
    g.add(ring);
    if (z.type === 'storm') {
      for (let i = 0; i < 4; i++) {
        const a = Math.random() * Math.PI * 2, rr = Math.random() * z.r * 0.8;
        const bolt = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.05, 3.5, 4), new THREE.MeshBasicMaterial({ color: '#c9f8ff', transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending }));
        bolt.position.set(Math.cos(a) * rr, 1.8, Math.sin(a) * rr);
        bolt.rotation.z = (Math.random() - 0.5) * 0.4;
        g.add(bolt);
      }
    }
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color, transparent: true, opacity: 0.2, blending: THREE.AdditiveBlending, depthWrite: false }));
    glow.scale.set(z.r * 2.4, z.r * 2.4, 1);
    glow.position.y = 0.3;
    g.add(glow);
    this.scene.add(g);
    return { group: g, disc, ring, glow, data: z, phase: Math.random() * 6.28 };
  }

  syncMarkers(list) {
    const seen = new Set();
    for (const m of list) {
      seen.add(m.id);
      let mesh = this.markers.get(m.id);
      if (!mesh) {
        mesh = this.makeMarker(m);
        this.markers.set(m.id, mesh);
      }
      mesh.in = m.in;
    }
    for (const [id, m] of this.markers) {
      if (!seen.has(id)) { this.sceneRemoveGroup(m.group); this.markers.delete(id); }
    }
  }

  makeMarker(m) {
    const g = new THREE.Group();
    g.position.set(m.x, 0, m.z);
    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(m.r, 32),
      new THREE.MeshBasicMaterial({ color: '#ff4b3a', transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    disc.rotation.x = -Math.PI / 2; disc.position.y = 0.05;
    g.add(disc);
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(m.r - 0.1, m.r, 40),
      new THREE.MeshBasicMaterial({ color: '#ff4b3a', transparent: true, opacity: 0.8, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.06;
    g.add(ring);
    const hz = hazardTexture().clone(); hz.repeat.set(4, 1); hz.needsUpdate = true;
    const stripes = new THREE.Mesh(new THREE.PlaneGeometry(m.r * 1.6, 0.28), new THREE.MeshBasicMaterial({ map: hz, transparent: true, opacity: 0.5 }));
    stripes.rotation.x = -Math.PI / 2; stripes.position.y = 0.07;
    g.add(stripes);
    // claw arm
    const arm = new THREE.Group();
    const metal = new THREE.MeshStandardMaterial({ color: '#5e5b54', metalness: 0.85, roughness: 0.4 });
    const seg = new THREE.Mesh(new THREE.BoxGeometry(0.7, 4.2, 0.7), metal);
    seg.position.y = 2.1; arm.add(seg);
    const joint = new THREE.Mesh(new THREE.CylinderGeometry(0.65, 0.65, 0.7, 10), metal);
    joint.position.y = 4.3; joint.rotation.z = Math.PI / 2; arm.add(joint);
    for (const side of [-1, 1]) {
      const claw = new THREE.Mesh(new THREE.ConeGeometry(0.32, 1.7, 6), metal);
      claw.position.set(side * 0.45, -0.85, 0);
      claw.rotation.z = side * 0.45;
      arm.add(claw);
    }
    const warning = new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 6), new THREE.MeshBasicMaterial({ color: '#ff5a36' }));
    warning.position.y = 4.6; arm.add(warning);
    arm.position.y = 12;
    g.add(arm);
    this.scene.add(g);
    return { group: g, disc, ring, arm, stripes, in: m.in, phase: 0 };
  }

  syncAirdrop(a) {
    if (!a) {
      if (this.airdropMesh) { this.sceneRemoveGroup(this.airdropMesh.group); this.airdropMesh = null; }
      return;
    }
    if (!this.airdropMesh || this.airdropMesh.x !== a.x || this.airdropMesh.z !== a.z) {
      if (this.airdropMesh) this.sceneRemoveGroup(this.airdropMesh.group);
      const g = new THREE.Group();
      g.position.set(a.x, 0, a.z);
      const crate = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.1, 1.4), new THREE.MeshStandardMaterial({ map: hazardTexture(), color: '#9c7b45', metalness: 0.5, roughness: 0.6 }));
      crate.position.y = 0.55;
      crate.castShadow = true;
      g.add(crate);
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: '#ff5bc8', transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false }));
      glow.scale.set(3.4, 3.4, 1); glow.position.y = 0.8;
      g.add(glow);
      const chute = new THREE.Mesh(new THREE.ConeGeometry(1.7, 0.7, 12, 1, true), new THREE.MeshStandardMaterial({ color: '#5a4a3c', side: THREE.DoubleSide, metalness: 0.1, roughness: 0.9 }));
      chute.position.y = 3.4;
      g.add(chute);
      const ring = new THREE.Mesh(new THREE.RingGeometry(3.8, 4, 40), new THREE.MeshBasicMaterial({ color: '#ff5bc8', transparent: true, opacity: 0.35, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }));
      ring.rotation.x = -Math.PI / 2; ring.position.y = 0.04;
      g.add(ring);
      this.scene.add(g);
      this.airdropMesh = { group: g, crate, chute, glow, ring, x: a.x, z: a.z, y: 16, landedAt: performance.now() };
    }
  }

  // ------------------------------------------------------------------ frame
  update(dt) {
    if (!this.scene) return;
    // remote players are pure playback, so they follow the real elapsed time
    // even when this frame is long; the local sim below is clamped separately
    const rawDt = dt;
    this.slowFrame = rawDt > 0.05;
    dt = Math.min(0.05, dt);
    this.lastDt = dt;
    this.time += dt;

    this.fpsFrames++;
    this.fpsAcc += dt;
    if (this.fpsAcc > 0.5) {
      this.fps = Math.round(this.fpsFrames / this.fpsAcc);
      this.fpsFrames = 0; this.fpsAcc = 0;
      this.ui.setFps(this.fps);
      // Step the preset down one notch at a time (high -> med -> low) so a
      // weak GPU keeps a playable frame rate without nuking the look at once.
      const tiers = ['high', 'med', 'low'];
      const current = this.ui.settings.quality || 'high';
      const idx = tiers.indexOf(current);
      if (this.fps < 40 && idx >= 0 && idx < tiers.length - 1) {
        this.lowFpsTime += 0.5;
        const limit = current === 'high' ? 3 : 4;
        if (this.lowFpsTime >= limit) {
          this.lowFpsTime = 0;
          const next = tiers[idx + 1];
          this.ui.settings.quality = next;
          this.applyQuality(next);
          try { this.ui.syncQualitySelect?.(next); } catch {}
          this.ui.toast(`帧率 ${this.fps} · 已自动降到「${next === 'med' ? '中' : '低'}」画质`, 'err');
          this.autoDegrades = (this.autoDegrades || 0) + 1;
        }
      } else {
        this.lowFpsTime = Math.max(0, this.lowFpsTime - 0.25);
      }
    }
    this.advanceRemoteClock(Math.min(0.25, rawDt));
    this.updateAim();
    if (this.running && !this.ended) {
      this.predict(dt);
      this.sendInputs(dt);
      this.updateLocalShot(dt);
    }
    this.updatePlayers(dt);
    this.updateBullets(dt);
    this.updateThreat();
    this.updateItems(dt);
    this.updateMines(dt);
    this.updateGrenades(dt);
    this.updateZones(dt);
    this.updateMarkers(dt);
    this.updateAirdrop(dt);
    this.updateCamera(dt);
    this.updateDamagedOverlay(dt);
    if (this.fx) this.fx.update(dt);
    if (this.arenaView) {
      const ambEvery = this.quality === 'low' ? 2 : 1;
      this.ambFrame = (this.ambFrame || 0) + 1;
      if (this.ambFrame % ambEvery === 0) {
        this.arenaView.update(dt * ambEvery, this.time, this.snap);
      }
    }
    // crosshair follows mouse & local charge (30 Hz, only when it changed)
    if (this.running) {
      this.crossAt = (this.crossAt || 0) + dt;
      const charging = !!(this.mouse.down && this.localCharge > 0.05);
      const hot = (this.selfData?.heat || 0) >= 70;
      const sig = `${Math.round(this.mouse.x)},${Math.round(this.mouse.y)},${Math.round(this.localCharge * 12)},${charging},${hot}`;
      if (this.crossAt >= 1 / 30 && sig !== this.crossSig) {
        this.crossAt = 0;
        this.crossSig = sig;
        this.ui.setCrosshair(this.mouse.x, this.mouse.y, {
          charging,
          charge: this.localCharge,
          heat: this.selfData?.heat || 0,
        });
      }
    }
    const now = performance.now();
    const mmEvery = (this.minimapInterval || 0.1) * 1000;
    if (this.snap && now - this.lastMinimap > mmEvery) {
      this.lastMinimap = now;
      this.ui.drawMinimap(this.snap, this.myId, this.arena);
    }
    this.stage.setActive(this.scene, this.camera);
  }

  updateLocalShot(dt) {
    const s = this.selfData;
    const can = s && s.alive && this.snap?.phase === 'live';
    if (this.mouse.down && can) {
      this.localFireHeld += dt;
      this.localCharge = clamp((this.localFireHeld - 0.1) / BULLET.chargeTime, 0, 1);
      this.tryLocalShot(s);
    } else {
      this.localFireHeld = 0;
      this.localCharge = 0;
      this.localFireNextAt = Math.min(this.localFireNextAt, this.time);
    }
    this.updateGhosts(dt);
  }

  /**
   * Fire the *visual* bolt the moment the trigger is pulled.
   *
   * The authoritative bullet still comes from the server, so a shot at 120 ms
   * latency used to appear on screen a sixth of a second after the click —
   * players read that as "my bullets are laggy" and kept clicking. Here the
   * muzzle flash, recoil, sound and a predicted tracer appear in the same
   * frame; when the server's real bolt shows up it silently takes over.
   */
  tryLocalShot(s) {
    if (!s || !s.alive) return;
    if (this.time < this.localFireNextAt) return;
    if (s.stunned) return;
    const reloadLeft = s.reloading || 0;
    if (reloadLeft > 0.02) return;
    // predicted ammo: the snapshot lags, so trust the local count until the
    // server sends a bigger number (a reload finished)
    if (this.predAmmo == null || s.ammo > this.predAmmo) this.predAmmo = s.ammo ?? BULLET.magSize;
    if (this.predAmmo <= 0) return;
    const held = this.localFireHeld;
    const charged = held >= BULLET.chargeTime && this.predAmmo >= 1;
    this.predAmmo -= 1;
    this.localFireNextAt = this.time + (charged ? BULLET.fireInterval * 1.35 : BULLET.fireInterval);
    if (charged) this.localFireHeld = 0;
    this.localShotAt = this.time;

    const aim = this.localAim;
    const v = this.players.get(this.myId);
    const sx = v ? v.x : s.x;
    const sz = v ? v.z : s.z;
    const muzzle = { x: sx + Math.cos(aim) * 0.95, z: sz + Math.sin(aim) * 0.95 };
    this.spawnGhost(muzzle.x, muzzle.z, aim, charged);
    // the same feedback the other players get from the server's `shot` event
    if (v && v.parts) {
      v.parts.flashT = 0.07;
      v.parts.recoil = 1;
      const m = muzzleWorld(v.parts);
      if (m) this.fx.muzzle(m.x, m.y, m.z, charged ? '#ffd27a' : '#9fe9ff');
    }
    this.audio?.sfx('shot', { volume: 0.55, charged });
    this.shake(charged ? 0.18 : 0.1, sx, sz);
  }

  /** Predicted bolt: pure eye candy, never authoritative. */
  spawnGhost(x, z, aim, charged) {
    const g = this.makeBullet({ x, z, vx: Math.cos(aim) * (charged ? BULLET.chargedSpeed : BULLET.speed),
      vz: Math.sin(aim) * (charged ? BULLET.chargedSpeed : BULLET.speed),
      type: 'bolt', charged });
    g.ghost = true;
    g.dir = aim;
    g.life = 0.55;
    g.group.position.set(x, 0.95, z);
    g.group.rotation.y = -aim;
    this.ghosts.push(g);
    return g;
  }

  updateGhosts(dt) {
    if (!this.ghosts.length) return;
    const speed = BULLET.speed;
    for (let i = this.ghosts.length - 1; i >= 0; i--) {
      const g = this.ghosts[i];
      g.life -= dt;
      const v = g.charged ? BULLET.chargedSpeed : speed;
      g.x += Math.cos(g.dir) * v * dt;
      g.z += Math.sin(g.dir) * v * dt;
      g.group.position.set(g.x, 0.95, g.z);
      if (g.life <= 0) {
        this.removeBullet(g);
        this.ghosts.splice(i, 1);
      }
    }
  }

  /** The server's real bolt arrived: drop the oldest predicted one. */
  handOffGhost() {
    if (!this.ghosts.length) return;
    const g = this.ghosts.shift();
    this.removeBullet(g);
  }

  /**
   * A snapshot arrived: move the target render time just behind it and keep an
   * eye on how much the arrival timing wobbles (packet jitter), which is what
   * decides how much buffer remote players need.
   */
  updateServerClock(t) {
    if (typeof t !== 'number') return;
    // Arrival jitter: how much the delay of a packet varies. Measured as a
    // percentile spread rather than min/max so that one long frame (a hitch,
    // a tab throttle) cannot inflate the buffer for the rest of the match.
    const off = t - this.time;
    const arr = this.arrivalOffs;
    arr.push(off);
    if (arr.length > 60) arr.shift();
    let spread = 0;
    if (arr.length >= 12) {
      const sorted = [...arr].sort((a, b) => a - b);
      const p10 = sorted[Math.floor(sorted.length * 0.1)];
      const p90 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.9))];
      spread = Math.max(0, p90 - p10);
    }
    // grow the delay quickly when the link is jittery, shrink it slowly
    this.interpTarget = clamp(0.05 + spread * 1.2, 0.06, 0.2);
    const k = this.interpTarget > this.interpDelay ? 0.25 : 0.03;
    this.interpDelay += (this.interpTarget - this.interpDelay) * k;

    this.remoteTarget = t - this.interpDelay;
    if (!this.remoteSet || Math.abs(this.remoteTarget - this.remoteClock) > 1.5) {
      this.remoteClock = this.remoteTarget; // first snapshot, reconnect, resume
      this.remoteSet = true;
    }
  }

  /**
   * Advance the render clock by the real frame time and slew it towards the
   * newest snapshot at a bounded rate. Remote players are pure playback, so a
   * long frame should move them by the full elapsed time (that is what the
   * screen shows anyway); the slew keeps the buffer healthy afterwards.
   */
  advanceRemoteClock(dt) {
    if (!this.remoteSet) return;
    this.remoteClock += dt;
    const err = this.remoteTarget - this.remoteClock;
    if (!err) return;
    const maxSlew = dt * 0.12; // at most 12% faster/slower than real time
    this.remoteClock += clamp(err * 0.2, -maxSlew, maxSlew);
  }

  /**
   * Keep the last ~1.2 s of authoritative samples for a remote player.
   *
   * 20 Hz snapshots alone make a mech move in 50 ms steps, and the old code
   * ran them through an exponential filter that also fought the snapshot's own
   * extrapolation — the visible result was a bot that stutters, freezes for a
   * frame and then jumps. Recording the samples lets us interpolate between
   * them at the real frame rate instead.
   */
  pushSample(v, p, t) {
    const buf = v.buf || (v.buf = []);
    const last = buf[buf.length - 1];
    if (last && t <= last.t) return; // duplicate / out of order
    // a respawn, a claw pull or a teleport is not something to slide across
    if (last && (Math.hypot(p.x - last.x, p.z - last.z) > 2.5 || last.alive !== p.alive)) buf.length = 0;
    buf.push({ t, x: p.x, z: p.z, vx: p.vx || 0, vz: p.vz || 0, alive: p.alive });
    const cutoff = t - 1.2;
    while (buf.length > 2 && buf[1].t < cutoff) buf.shift();
    if (buf.length > 64) buf.splice(0, buf.length - 64);
  }

  /**
   * Draw a remote player at (server clock - interpDelay): normally between two
   * snapshots, so it moves at the true speed every frame. If the buffer runs
   * dry (packet loss, hitch) fall back to dead reckoning from the last sample
   * for at most 300 ms, then hold still — never a backwards jump.
   */
  sampleRemote(v) {
    const buf = v.buf;
    if (!buf || !buf.length) return;
    const rt = this.remoteClock;
    let i = buf.length - 1;
    while (i > 0 && buf[i].t > rt) i--;
    const a = buf[i];
    const b = buf[i + 1];
    let x;
    let z;
    if (b && b.t > a.t && rt <= b.t) {
      const f = clamp((rt - a.t) / (b.t - a.t), 0, 1);
      x = a.x + (b.x - a.x) * f;
      z = a.z + (b.z - a.z) * f;
    } else {
      // Ran out of samples: ask for a slightly bigger buffer next time. Not
      // when this frame itself was long (a hitch or a tab throttle), though —
      // that starves the buffer on every frame of the stall and would inflate
      // the delay for the rest of the match.
      if (rt > a.t + 0.002 && !this.slowFrame) this.interpDelay = Math.min(0.2, this.interpDelay + 0.004);
      const ahead = clamp(rt - a.t, 0, 0.3);
      x = a.x + a.vx * ahead;
      z = a.z + a.vz * ahead;
    }
    v.rx = x; v.rz = z;
    v.x = x; v.z = z;
  }

  updatePlayers(dt) {
    const snap = this.snap;
    for (const v of this.players.values()) {
      const d = v.data;
      if (!d) continue;
      const isSelf = v.id === this.myId;
      if (isSelf) {
        if (v.predicted) {
          v.rx = v.predicted.x; v.rz = v.predicted.z;
          v.x = v.predicted.x + this.visOff.x;
          v.z = v.predicted.z + this.visOff.z;
        }
        // Smooth away reconciliation corrections instead of snapping. The
        // offset is always drained at most 2 cm per frame, so a correction can
        // never read as a jerk (at 60 fps that is 1.2 m/s, slower than any
        // mech) — a big correction becomes a short trail rather than a yank.
        const offLen = Math.hypot(this.visOff.x, this.visOff.z);
        if (offLen > 0) {
          const cap = 0.02;
          const keep = Math.max(0, 1 - cap / offLen);
          this.visOff.x *= keep;
          this.visOff.z *= keep;
          if (offLen * keep < 0.003) { this.visOff.x = 0; this.visOff.z = 0; }
        }
        v.aim = this.localAim;
      } else {
        this.sampleRemote(v);
        if (d.alive) v.aim = lerpAngle(v.aim, d.aim, 1 - Math.exp(-dt * 16));
        v.speed = Math.hypot(d.vx, d.vz);
      }
      v.speed = Math.hypot(v.predicted ? v.predicted.vx : d.vx, v.predicted ? v.predicted.vz : d.vz);
      const parts = v.parts;
      parts.group.position.set(v.x, 0, v.z);
      parts.group.rotation.y = -v.aim;
      const teamMode = this.info.settings.mode !== 'ffa';
      const teamColor = teamMode ? TEAM_COLORS[(d.team || 0) % 2] : null;
      if (teamColor && parts.ringMat) parts.ringMat.color.set(teamColor);
      updateMech(parts, {
        speed: v.speed, heat: d.heat || 0, time: this.time + (v.id % 5),
        alive: d.alive !== false, shield: d.shield || 0, stunned: d.stunned,
        showName: !isSelf,
        teamColor,
        // your own mech gets the loudest facing cues
        aimLine: isSelf ? 1 : 0.55,
        isSelf,
      }, dt);
      // sniper aim line
      if (d.sniperCharge && d.alive) {
        if (!v.sniperLine) {
          const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
          const mat = new THREE.LineBasicMaterial({ color: '#bff6ff', transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending });
          v.sniperLine = new THREE.Line(geo, mat);
          this.scene.add(v.sniperLine);
        }
        const pts = v.sniperLine.geometry.attributes.position.array;
        pts[0] = v.x; pts[1] = 1.1; pts[2] = v.z;
        pts[3] = v.x + Math.cos(v.aim) * 22; pts[4] = 1.1; pts[5] = v.z + Math.sin(v.aim) * 22;
        v.sniperLine.geometry.attributes.position.needsUpdate = true;
        v.sniperLine.visible = true;
        v.sniperLine.material.opacity = 0.22 + Math.sin(this.time * 18) * 0.1;
      } else if (v.sniperLine) v.sniperLine.visible = false;
      // heater effects
      if (d.alive) {
        v.heatTimer -= dt;
        if (d.heat >= 45 && v.heatTimer <= 0) {
          v.heatTimer = d.heat >= 90 ? 0.1 : d.heat >= 70 ? 0.22 : 0.45;
          const y = 0.9 + Math.random() * 0.8;
          this.fx.sparkBurst(v.x, y, v.z, d.heat >= 90 ? '#ff6a4a' : '#ffcf6a', d.heat >= 90 ? 10 : 4, 2.5, 0.6, 0.35, { up: 0.3, lift: 0.8 });
          if (d.heat >= 70 && Math.random() < 0.22) this.fx.smokePuff(v.x, 1.6, v.z, 1, '#4a443d', 0.7, 1.3, 0.4);
          if (d.heat >= 90) {
            this.fx.beam(v.x + (Math.random() - 0.5) * 1.2, 0.6, v.z + (Math.random() - 0.5) * 1.2, v.x + (Math.random() - 0.5) * 1.2, 1.6, v.z + (Math.random() - 0.5) * 1.2, '#ff9f7a', 0.08, 0.035);
          }
        }
        v.overTimer = (v.overTimer || 0) - dt;
        if (d.overclock > 0 && v.overTimer <= 0) {
          v.overTimer = 0.45;
          this.fx.ring(v.x, v.z, { color: '#ff5bc8', r0: 0.5, r1: 1.4, life: 0.4, opacity: 0.35 });
        }
        if (d.fuse > 0) {
          this.fx.ring(v.x, v.z, { color: '#ffb02e', r0: 0.6, r1: 1.5 + (3 - d.fuse) * 0.5, life: 0.35, opacity: 0.6 });
          if (Math.random() < dt * 8) this.fx.sparkBurst(v.x, 1.2, v.z, '#ffb02e', 3, 3, 0.5, 0.4);
        }
        if (d.channel > 0) {
          this.fx.ring(v.x, v.z, { color: '#8fe9ff', r0: 0.5, r1: 1.6, life: 0.45, opacity: 0.4 });
        }
        // dead body cleanup smoke
      }
      // low-health style warning sprite? skip
    }
    // spectate target
    if (this.selfData && !this.selfData.alive) {
      const killer = this.spectateId ? this.players.get(this.spectateId) : null;
      if (killer && killer.data?.alive) this.spectatePos = { x: killer.x, z: killer.z };
    }
  }

  updateItems(dt) {
    for (const it of this.items.values()) {
      it.icon.position.y = 1.02 + Math.sin(this.time * 2.5 + it.phase) * 0.12;
      it.cube.rotation.y += dt * 1.6;
      it.cube.rotation.x += dt * 0.7;
      it.cube.position.y = 0.58 + Math.sin(this.time * 2 + it.phase) * 0.08;
    }
  }

  updateMines(dt) {
    for (const m of this.mines.values()) {
      const blink = (Math.sin(this.time * (m.armed ? 14 : 5) + m.phase) + 1) / 2;
      m.light.material.color.set(m.armed ? '#ff3b2a' : '#ffb02e');
      m.light.scale.setScalar(0.6 + blink * 0.7);
      m.glow.material.opacity = (m.armed ? 0.25 : 0.1) + blink * 0.35;
      m.ring.material.opacity = m.armed ? 0.12 + blink * 0.12 : 0.05;
    }
  }

  updateGrenades(dt) {
    for (const gr of this.grenades.values()) {
      const t = 1 - Math.max(0, gr.fuse) / 1.5;
      gr.ring.scale.setScalar(0.2 + t * 0.85);
      gr.ring.material.opacity = 0.1 + t * 0.25;
      gr.light.material.color.set(Math.sin(this.time * 22) > 0 ? '#ff8a3d' : '#ff3b2a');
      gr.glow.material.opacity = 0.3 + Math.sin(this.time * 18) * 0.2;
    }
  }

  updateZones(dt) {
    for (const z of this.zones.values()) {
      const d = z.data;
      const p = (Math.sin(this.time * 2 + z.phase) + 1) / 2;
      z.ring.material.opacity = 0.4 + p * 0.3;
      z.glow.material.opacity = 0.08 + p * 0.1;
      z.group.rotation.y += dt * 0.15;
      if (d.type === 'storm' && Math.random() < dt * 5) {
        const a = Math.random() * Math.PI * 2, rr = Math.random() * d.r * 0.85;
        this.fx.beam(d.x + Math.cos(a) * rr, 0.1, d.z + Math.sin(a) * rr, d.x + Math.cos(a) * rr, 4.5, d.z + Math.sin(a) * rr, '#bff6ff', 0.1, 0.04);
      }
    }
  }

  updateMarkers(dt) {
    for (const m of this.markers.values()) {
      const d = m.group.position;
      m.ring.rotation.z += dt * 1.4;
      m.stripes.rotation.z -= dt * 0.8;
      const t = clamp(1 - (m.in || 0) / 1.1, 0, 1);
      m.arm.position.y = 12 - easeOut(t) * 10.5;
      m.disc.material.opacity = 0.12 + t * 0.15;
      m.group.position.y = 0;
    }
  }

  updateAirdrop(dt) {
    if (!this.airdropMesh) return;
    const a = this.airdropMesh;
    a.y = Math.max(0.4, a.y - dt * 14);
    a.group.position.y = a.y;
    a.chute.rotation.y += dt * 1.2;
    a.glow.material.opacity = 0.35 + Math.sin(this.time * 6) * 0.15;
  }

  updateCamera(dt) {
    if (!this.camera) return;
    const self = this.selfVisual;
    let fx, fz;
    if (self && self.data?.alive) { fx = self.x; fz = self.z; this.spectatePos = null; }
    else if (this.spectatePos) { fx = this.spectatePos.x; fz = this.spectatePos.z; }
    else if (this.deathPos) { fx = this.deathPos.x; fz = this.deathPos.z; }
    else { fx = 0; fz = 0; }
    const k = 1 - Math.exp(-dt * 7);
    this.camFocus.x += (fx - this.camFocus.x) * k;
    this.camFocus.z += (fz - this.camFocus.z) * k;
    this.shakeTrauma = Math.max(0, this.shakeTrauma - dt * 2.6);
    const sh = this.shakeTrauma * this.shakeTrauma;
    const sx = (Math.random() - 0.5) * sh * 1.1;
    const sz = (Math.random() - 0.5) * sh * 1.1;
    const sy = (Math.random() - 0.5) * sh * 0.6;
    // slight aim lead, purely visual
    const aimLead = 1.1;
    const cx = this.camFocus.x + Math.cos(this.localAim) * aimLead * 0.25;
    const cz = this.camFocus.z + Math.sin(this.localAim) * aimLead * 0.25;
    this.camera.position.set(cx + sx, this.camOffset.height + sy, cz + this.camOffset.back + sz);
    this.camera.lookAt(cx, 0.9, cz - 0.6);
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
  }

  updateDamagedOverlay(dt) {
    const s = this.selfData;
    this.damageFlash = Math.max(0, (this.damageFlash || 0) - dt * 1.6);
    const el = document.getElementById('damage-vignette');
    if (el) {
      const heat = s?.heat || 0;
      const base = heat >= 90 ? 0.18 + Math.sin(performance.now() / 120) * 0.08 : heat >= 70 ? 0.08 : 0;
      el.style.opacity = Math.max(base, this.damageFlash);
    }
  }

  floatWorld(x, y, z, text, cls = '') {
    const v = new THREE.Vector3(x, y, z);
    v.project(this.camera);
    if (v.z > 1) return;
    const sx = (v.x * 0.5 + 0.5) * window.innerWidth;
    const sy = (-v.y * 0.5 + 0.5) * window.innerHeight;
    this.ui.float(sx, sy, text, cls);
  }

  finish(result, room = this.ui.currentRoom, isHost = false) {
    this.ended = true;
    this.mouse.down = false;
    this.keys.clear();
    this.roundOver = true;
    this.ui.showResults(result, this.myId, room, isHost);
  }

  stop() {
    this.running = false;
    this.mouse.down = false;
    this.keys.clear();
  }
}
