#!/usr/bin/env python3
"""Correction smoothing: keep the rendered position continuous and drain the
offset at a bounded rate so a correction can never read as a backwards jerk."""
import io, sys

p = 'src/game.js'
s = io.open(p, encoding='utf-8').read()

old_drain = """        // smooth away reconciliation corrections instead of snapping
        const decay = Math.exp(-dt * 14);
        this.visOff.x *= decay;
        this.visOff.z *= decay;
        if (Math.abs(this.visOff.x) < 0.002) this.visOff.x = 0;
        if (Math.abs(this.visOff.z) < 0.002) this.visOff.z = 0;"""

new_drain = """        // Smooth away reconciliation corrections instead of snapping. The
        // offset is consumed with a hard per-frame cap (2 cm) so a correction
        // can never read as a backwards jerk, however large it was.
        const offLen = Math.hypot(this.visOff.x, this.visOff.z);
        if (offLen > 0) {
          const base = Math.exp(-dt * 12);
          const capped = 1 - Math.min(1, 0.02 / offLen);
          const keep = Math.max(base, capped);
          this.visOff.x *= keep;
          this.visOff.z *= keep;
          if (offLen * keep < 0.003) { this.visOff.x = 0; this.visOff.z = 0; }
        }"""

if old_drain not in s:
    sys.exit('drain block not found')
s = s.replace(old_drain, new_drain, 1)

old_snap = """    // genuine teleports must not be smoothed
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
    this.visOff.z = clamp(this.visOff.z - dz, -1.5, 1.5);"""

new_snap = """    // A match start is the one moment where a hard cut is expected; every
    // other correction keeps the rendered position continuous (the offset is
    // then drained at a bounded rate, so it never reads as a jerk).
    if (justWentLive) {
      v.predicted.x = replayed.x; v.predicted.z = replayed.z;
      v.predicted.vx = replayed.vx; v.predicted.vz = replayed.vz;
      this.visOff.x = 0; this.visOff.z = 0;
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

    // keep the pixels where they were; updatePlayers() drains the offset
    const limit = err > 1.5 ? 3 : 1.2;
    this.visOff.x = clamp(renderX - replayed.x, -limit, limit);
    this.visOff.z = clamp(renderZ - replayed.z, -limit, limit);"""

if old_snap not in s:
    sys.exit('reconcile snap block not found')
s = s.replace(old_snap, new_snap, 1)

io.open(p, 'w', encoding='utf-8').write(s)
print('correction smoothing installed')
