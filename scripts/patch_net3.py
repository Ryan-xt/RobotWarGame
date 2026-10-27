import re

p = 'src/game.js'
s = open(p).read()

# ---------------------------------------------------------------- history per frame
# The old history entry (position at send time) cannot describe a dash: the
# local dash happens after the input was sent, so the reference lags by the
# whole burst. Record the exact per-frame simulation instead and replay it.
s = s.replace("""      // Remember where we were when this input left the machine: that is the
      // state the server is about to simulate, so it is the only fair thing to
      // compare an authoritative snapshot against.
      if (v?.predicted) {
        this.inputHistory.push({ seq: this.seq, x: v.predicted.x, z: v.predicted.z });
        if (this.inputHistory.length > 180) this.inputHistory.shift();
      }
""", "")

s = s.replace("""    stepMotion(v.predicted, { mx, mz }, dt, {
      speedMult,
      stunned: !!s.stunned,
      immobile: (s.channel || 0) > 0,
      overrideVel: dashing ? { x: this.localDash.dx * DASH_SPEED, z: this.localDash.dz * DASH_SPEED } : null,
    });
    resolvePlayerArena(this.clientArena, v.predicted, PLAYER_RADIUS);""",
"""    const overrideVel = dashing ? { x: this.localDash.dx * DASH_SPEED, z: this.localDash.dz * DASH_SPEED } : null;
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
    if (this.inputHistory.length > 240) this.inputHistory.splice(0, this.inputHistory.length - 240);""")

# ---------------------------------------------------------------- replay reconciliation
start = s.index('  reconcileSelf(v, p, wasAlive) {')
# find the end of the method: next "\n  }\n\n  // ----" after start
end_marker = "\n  // --------------------------------------------------------------- snapshots"
end = s.index(end_marker, start)
old = s[start:end]

new = '''  reconcileSelf(v, p, wasAlive) {
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
      hist.length = 0;
      return;
    }

    // follow a dash we did not predict ourselves (resync / reconnect)
    if ((p.dashIn || 0) > 0 && this.time >= this.localDash.until) {
      this.localDash = { until: this.time + p.dashIn, dx: p.dashDx || 0, dz: p.dashDz || 0 };
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

    // genuine teleports must not be smoothed
    if (justWentLive || err > 4 || p.stunned || hist.length === 0) {
      v.predicted.x = replayed.x; v.predicted.z = replayed.z;
      v.predicted.vx = replayed.vx; v.predicted.vz = replayed.vz;
      this.visOff.x = 0; this.visOff.z = 0;
      return;
    }

    v.predicted.x = replayed.x;
    v.predicted.z = replayed.z;
    v.predicted.vx = replayed.vx;
    v.predicted.vz = replayed.vz;
    if (err < 0.002) return;
    // hide the correction: shift the render the other way, then decay it
    this.visOff.x = clamp(this.visOff.x - dx, -1.5, 1.5);
    this.visOff.z = clamp(this.visOff.z - dz, -1.5, 1.5);
  }

'''
s = s[:start] + new + s[end:]

# ---------------------------------------------------------------- doc comment
s = s.replace("""   * The old code compared the *current* predicted position with the snapshot's
   * (already stale) position. At 6.4 m/s that difference is just the network
   * latency in metres, so every snapshot dragged the mech backwards and any
   * jitter exceeded the 2.4 m limit and teleported it — the "yanked back"
   * bug. Now the snapshot is compared against the prediction we had *when that
   * input was sent* (same instant in simulated time), so the residual only
   * contains real divergence (collisions, knockback). The residual is applied
   * to the physics immediately but hidden from the eye by a decaying offset.""",
"""   * The old code compared the *current* predicted position with the snapshot's
   * (already stale) position. At 6.4 m/s that gap is simply the network
   * latency converted to metres, so every snapshot dragged the mech backwards
   * and any jitter crossed the 2.4 m limit and teleported it — the "yanked
   * back" bug.
   *
   * Now the authoritative state is used as a starting point and the frames the
   * server has not simulated yet are replayed on top (Quake-style). The result
   * is where the player *should* be given the same inputs, so the residual is
   * near zero even with 120 ms of latency, and dashes/acceleration replay
   * exactly instead of fighting the correction.""")

open(p, 'w').write(s)
print('replay reconciliation installed')
