import re

p = 'src/game.js'
s = open(p).read()

# ---------------------------------------------------------------- imports
s = s.replace("""import {
  ITEM_TYPES, PLAYER_COLORS, TEAM_COLORS, BULLET, PLAYER_RADIUS,
  clamp, angleDiff, normAngle, dist,
} from '../shared/constants.js';""",
"""import {
  ITEM_TYPES, PLAYER_COLORS, TEAM_COLORS, BULLET, PLAYER_RADIUS, DASH,
  clamp, angleDiff, normAngle, dist,
} from '../shared/constants.js';""")

s = s.replace("""const easeOut = (t) => 1 - Math.pow(1 - t, 3);""",
"""const easeOut = (t) => 1 - Math.pow(1 - t, 3);
// Server dash velocity (sim.js): distance / duration * 1.02
const DASH_SPEED = (DASH.distance / DASH.duration) * 1.02;""")

# ---------------------------------------------------------------- start(): spawns + state
s = s.replace("""    const spawns = arena.spawns;
    info.players.forEach((p, i) => {
      const sp = spawns[i % spawns.length];
      this.addPlayerVisual(p, sp.x, sp.z);
    });""",
"""    // The sim shuffles spawns, so trust the positions it actually used
    // (info.spawns) instead of guessing — guessing caused a 30 m pop on GO.
    const spawns = arena.spawns;
    const spawnById = new Map((info.spawns || []).map((s) => [s.id, s]));
    info.players.forEach((p, i) => {
      const sp = spawnById.get(p.id) || spawns[i % spawns.length];
      this.addPlayerVisual(p, sp.x, sp.z);
    });""")

s = s.replace("""    this.localCharge = 0;
    this.localFireHeld = 0;""",
"""    this.localCharge = 0;
    this.localFireHeld = 0;
    this.inputHistory = [];
    this.localDash = { until: 0, dx: 0, dz: 0 };
    this.visOff = { x: 0, z: 0 };
    this.lastAckSeq = 0;
    this.phasePrev = 'countdown';""")

# also snap aim from the spawn data
s = s.replace("""    const self = this.players.get(this.myId);
    if (self) {
      self.predicted = { x: self.x, z: self.z, vx: 0, vz: 0 };""",
"""    const self = this.players.get(this.myId);
    if (self) {
      self.predicted = { x: self.x, z: self.z, vx: 0, vz: 0 };
      const ownSpawn = spawnById.get(this.myId);
      if (ownSpawn && typeof ownSpawn.aim === 'number') this.localAim = ownSpawn.aim;""")

# ---------------------------------------------------------------- sendInputs: record history + dash prediction
s = s.replace("""    if (this.sendAcc >= 1 / 30) {
      this.sendAcc = 0;
      this.send({
        type: 'input',
        mx, mz,
        aim: Math.round(this.localAim * 1000) / 1000,
        fire: !!(this.mouse.down && canAct),
        dash: this.pending.dash,
        skill: this.pending.skill,
        useItem: this.pending.item,
        seq: ++this.seq,
      });""",
"""    if (this.sendAcc >= 1 / 30) {
      this.sendAcc = 0;
      const v = this.selfVisual;
      // Predict the dash locally so the server's 2.8 m burst does not arrive
      // as a surprise correction (that was one source of the "yank back").
      if (this.pending.dash && canAct && self.dashCd <= 0 && !self.stunned && !(self.channel > 0)) {
        const mv = Math.hypot(mx, mz);
        this.localDash = {
          until: this.time + DASH.duration,
          dx: mv > 0.1 ? mx / mv : Math.cos(this.localAim),
          dz: mv > 0.1 ? mz / mv : Math.sin(this.localAim),
        };
      }
      this.send({
        type: 'input',
        mx, mz,
        aim: Math.round(this.localAim * 1000) / 1000,
        fire: !!(this.mouse.down && canAct),
        dash: this.pending.dash,
        skill: this.pending.skill,
        useItem: this.pending.item,
        seq: ++this.seq,
      });
      // Remember where we were when this input left the machine: that is the
      // state the server is about to simulate, so it is the only fair thing to
      // compare an authoritative snapshot against.
      if (v?.predicted) {
        this.inputHistory.push({ seq: this.seq, x: v.predicted.x, z: v.predicted.z });
        if (this.inputHistory.length > 180) this.inputHistory.shift();
      }""")

# ---------------------------------------------------------------- predict(): mirror dash, apply visual offset
s = s.replace("""    if (s.inAcid) speedMult *= 0.8;
    if (s.sniperCharge) speedMult *= 0.8;
    stepMotion(v.predicted, { mx, mz }, dt, {
      speedMult,
      stunned: !!s.stunned,
      immobile: (s.channel || 0) > 0,
    });
    resolvePlayerArena(this.clientArena, v.predicted, PLAYER_RADIUS);
    v.x = v.predicted.x;
    v.z = v.predicted.z;
    v.speed = Math.hypot(v.predicted.vx, v.predicted.vz);""",
"""    if (s.inAcid) speedMult *= 0.8;
    if (s.sniperCharge) speedMult *= 0.8;
    const dashing = this.time < this.localDash.until;
    stepMotion(v.predicted, { mx, mz }, dt, {
      speedMult,
      stunned: !!s.stunned,
      immobile: (s.channel || 0) > 0,
      overrideVel: dashing ? { x: this.localDash.dx * DASH_SPEED, z: this.localDash.dz * DASH_SPEED } : null,
    });
    resolvePlayerArena(this.clientArena, v.predicted, PLAYER_RADIUS);
    // position = prediction + the decaying visual offset that hides corrections
    v.x = v.predicted.x + this.visOff.x;
    v.z = v.predicted.z + this.visOff.z;
    v.rx = v.predicted.x;
    v.rz = v.predicted.z;
    v.speed = Math.hypot(v.predicted.vx, v.predicted.vz);""")

# ---------------------------------------------------------------- reconciliation
old_reconcile = """      if (p.id === this.myId) {
        this.selfData = p;
        if (v.predicted) {
          if (!wasAlive && p.alive) {
            v.predicted.x = p.x; v.predicted.z = p.z; v.predicted.vx = 0; v.predicted.vz = 0;
            this.prevAlive = true;
            this.ui.setKiller(null);
            this.fx.ring(p.x, p.z, { color: '#9fe9ff', r0: 0.3, r1: 2.6, life: 0.6 });
            this.audio?.sfx('respawn');
            this.camFocus.x = p.x; this.camFocus.z = p.z;
          }
          if (!p.alive) { this.prevAlive = false; this.deathPos = { x: p.x, z: p.z }; }
          // soft reconciliation, unless the server clearly teleported us
          const dx = p.x - v.predicted.x, dz = p.z - v.predicted.z;
          const err = Math.hypot(dx, dz);
          if (p.alive) {
            if (err > 2.4 || (p.stunned && err > 0.8)) {
              v.predicted.x = p.x; v.predicted.z = p.z;
            } else if (err > 0.55) {
              const k = Math.min(1, (err > 1.4 ? 9 : 2.5) * 0.05);
              v.predicted.x += dx * k;
              v.predicted.z += dz * k;
            }
            v.rx = v.predicted.x;
            v.rz = v.predicted.z;
          } else {
            v.predicted.x = p.x; v.predicted.z = p.z;
            v.x = p.x; v.z = p.z;
          }
        }
      } else {"""

new_reconcile = """      if (p.id === this.myId) {
        this.selfData = p;
        this.reconcileSelf(v, p, wasAlive);
      } else {"""
assert old_reconcile in s
s = s.replace(old_reconcile, new_reconcile)

# insert the reconcileSelf method before onSnapshot
s = s.replace("""  // --------------------------------------------------------------- snapshots
  onSnapshot(snap, youId = this.myId) {""",
"""  /**
   * Authoritative snapshot vs local prediction.
   *
   * The old code compared the *current* predicted position with the snapshot's
   * (already stale) position. At 6.4 m/s that difference is just the network
   * latency in metres, so every snapshot dragged the mech backwards and any
   * jitter exceeded the 2.4 m limit and teleported it — the "yanked back"
   * bug. Now the snapshot is compared against the prediction we had *when that
   * input was sent* (same instant in simulated time), so the residual only
   * contains real divergence (collisions, knockback). The residual is applied
   * to the physics immediately but hidden from the eye by a decaying offset.
   */
  reconcileSelf(v, p, wasAlive) {
    if (!v.predicted) return;
    const hist = this.inputHistory;
    const ack = p.seq | 0;

    if (!wasAlive && p.alive) {
      v.predicted.x = p.x; v.predicted.z = p.z; v.predicted.vx = 0; v.predicted.vz = 0;
      this.visOff.x = 0; this.visOff.z = 0;
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
      return;
    }

    // pick the prediction snapshot that lines up with the acknowledged input
    let ref = null;
    for (let i = hist.length - 1; i >= 0; i--) {
      if (hist[i].seq <= ack) { ref = hist[i]; break; }
    }
    // drop history the server has already simulated
    while (hist.length > 1 && hist[0].seq <= ack) hist.shift();

    const serverDashing = (p.dashIn || 0) > 0;
    const dashingLocally = this.time < this.localDash.until;
    if (serverDashing && !dashingLocally) {
      // we missed the dash request (resync / late join): follow the server
      this.localDash = {
        until: this.time + p.dashIn,
        dx: p.dashDx || 0,
        dz: p.dashDz || 0,
      };
    }

    const refX = ref ? ref.x : v.predicted.x;
    const refZ = ref ? ref.z : v.predicted.z;
    const dx = p.x - refX;
    const dz = p.z - refZ;
    const err = Math.hypot(dx, dz);
    const justWentLive = this.phasePrev === 'countdown' && this.snap && this.snap.phase === 'live';
    this.phasePrev = this.snap ? this.snap.phase : this.phasePrev;
    if (err < 0.004) return;

    // genuine teleports (spawn, hook, knockback, stun) must not be smoothed
    if (justWentLive || err > 3 || p.stunned || !ref) {
      v.predicted.x = p.x; v.predicted.z = p.z;
      v.predicted.vx = p.vx || 0; v.predicted.vz = p.vz || 0;
      this.visOff.x = 0; this.visOff.z = 0;
      return;
    }

    // shift the whole prediction by the residual, keep the rendered position
    // continuous, then let the offset decay over ~120 ms
    v.predicted.x += dx;
    v.predicted.z += dz;
    this.visOff.x = clamp(this.visOff.x - dx, -2.5, 2.5);
    this.visOff.z = clamp(this.visOff.z - dz, -2.5, 2.5);
    if (Math.abs(dx) + Math.abs(dz) > 0.6) {
      v.predicted.vx = p.vx || 0;
      v.predicted.vz = p.vz || 0;
    }
  }

  // --------------------------------------------------------------- snapshots
  onSnapshot(snap, youId = this.myId) {""")

# ---------------------------------------------------------------- updatePlayers: apply/decay the offset
s = s.replace("""      if (isSelf) {
        if (v.predicted) { v.x = v.predicted.x; v.z = v.predicted.z; v.rx = v.x; v.rz = v.z; }
        v.aim = this.localAim;""",
"""      if (isSelf) {
        if (v.predicted) {
          v.rx = v.predicted.x; v.rz = v.predicted.z;
          v.x = v.predicted.x + this.visOff.x;
          v.z = v.predicted.z + this.visOff.z;
        }
        // smooth away reconciliation corrections instead of snapping
        const decay = Math.exp(-dt * 14);
        this.visOff.x *= decay;
        this.visOff.z *= decay;
        if (Math.abs(this.visOff.x) < 0.002) this.visOff.x = 0;
        if (Math.abs(this.visOff.z) < 0.002) this.visOff.z = 0;
        v.aim = this.localAim;""")

open(p, 'w').write(s)
print('game.js reconciliation replaced')
