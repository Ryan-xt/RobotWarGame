#!/usr/bin/env python3
"""Final polish for the reconciliation:

* the visual offset is always drained at most 2 cm per frame (1.2 m/s at 60 fps),
  so a correction can never read as a jerk; severe offsets (teleport-sized) are
  drained faster instead of lingering for seconds;
* the local dash prediction uses an ageing estimate of the server cooldown, so a
  Space press exactly on the cooldown boundary is still predicted locally;
* tidy unused fields.
"""
import io, sys

p = 'src/game.js'
s = io.open(p, encoding='utf-8').read()


def sub(old, new, why):
    global s
    if old not in s:
        sys.exit('not found: ' + why)
    s = s.replace(old, new, 1)


# ---- 1. drain cap -----------------------------------------------------------
sub("""        // Smooth away reconciliation corrections instead of snapping. The
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
        }""",
"""        // Smooth away reconciliation corrections instead of snapping. The
        // offset is always drained at most 2 cm per frame, so a correction can
        // never read as a jerk (at 60 fps that is 1.2 m/s, slower than any
        // mech). Teleport-sized offsets are drained faster: trailing by metres
        // for seconds is worse than the (already large) correction itself.
        const offLen = Math.hypot(this.visOff.x, this.visOff.z);
        if (offLen > 0) {
          const cap = offLen > 2 ? Math.max(0.02, offLen * 0.12) : 0.02;
          const keep = Math.max(0, 1 - cap / offLen);
          this.visOff.x *= keep;
          this.visOff.z *= keep;
          if (offLen * keep < 0.003) { this.visOff.x = 0; this.visOff.z = 0; }
        }""",
    'drain cap')

# ---- 2. dash cooldown ageing -----------------------------------------------
sub("""    this.inputHistory = [];
    this.localDash = { until: 0, dx: 0, dz: 0 };
    this.visOff = { x: 0, z: 0 };
    this.lastAckSeq = 0;
    this.phasePrev = 'countdown';""",
"""    this.inputHistory = [];
    this.localDash = { until: 0, dx: 0, dz: 0 };
    this.visOff = { x: 0, z: 0 };
    this.selfDashCd = 0;
    this.selfSnapAt = 0;
    this.phasePrev = 'countdown';""",
    'init fields')

sub("""      const v = this.selfVisual;
      // Predict the dash locally so the server's 2.8 m burst does not arrive
      // as a surprise correction (that was one source of the \"yank back\").
      if (this.pending.dash && canAct && self.dashCd <= 0 && !self.stunned && !(self.channel > 0)) {""",
"""      // Predict the dash locally so the server's 2.8 m burst does not arrive
      // as a surprise correction (that was one source of the \"yank back\").
      // The cooldown read from the snapshot is already a few ms old, so age it
      // before deciding: a Space press on the boundary must still feel instant.
      const cdLeft = Math.max(0, this.selfDashCd - (this.time - this.selfSnapAt));
      if (this.pending.dash && canAct && cdLeft <= 0.03 && !self.stunned && !(self.channel > 0)) {
        this.localDash.until = this.time + DASH.duration;
        this.selfDashCd = DASH.cooldown;
        this.selfSnapAt = this.time;""",
    'dash predict guard')

# the original body of the old `if` assigned this.localDash; strip the leftover
sub("""        const mv = Math.hypot(mx, mz);
        this.localDash = {
          until: this.time + DASH.duration,
          dx: mv > 0.1 ? mx / mv : Math.cos(this.localAim),
          dz: mv > 0.1 ? mz / mv : Math.sin(this.localAim),
        };
      }""",
"""        const mv = Math.hypot(mx, mz);
        this.localDash.dx = mv > 0.1 ? mx / mv : Math.cos(this.localAim);
        this.localDash.dz = mv > 0.1 ? mz / mv : Math.sin(this.localAim);
      }""",
    'dash direction')

# ---- 3. remember the snapshot cooldown -------------------------------------
sub("""  reconcileSelf(v, p, wasAlive) {
    if (!v.predicted) return;
    const hist = this.inputHistory;
    const ack = p.seq | 0;""",
"""  reconcileSelf(v, p, wasAlive) {
    if (!v.predicted) return;
    const hist = this.inputHistory;
    const ack = p.seq | 0;
    if (typeof p.dashCd === 'number') { this.selfDashCd = p.dashCd; this.selfSnapAt = this.time; }""",
    'snapshot cooldown')

# ---- 4. tidy ---------------------------------------------------------------
sub("""  }


  // --------------------------------------------------------------- snapshots""",
"""  }

  // --------------------------------------------------------------- snapshots""",
    'double blank line')

io.open(p, 'w', encoding='utf-8').write(s)
print('reconciliation polish installed')
