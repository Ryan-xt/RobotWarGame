#!/usr/bin/env python3
"""Stop re-triggering a dash from the snapshot.

The client already predicts its own dash when the input is sent, and the replay
turns the server's `dashIn` into the remaining motion. Re-starting a dash from
the snapshot (the old resync branch) made the client dash for a second time
~latency after the real one, which is what produced the 2.8 m "snap back".
"""
import io, sys

p = 'src/game.js'
s = io.open(p, encoding='utf-8').read()

old = """    // follow a dash we did not predict ourselves (resync / reconnect)
    if ((p.dashIn || 0) > 0 && this.time >= this.localDash.until) {
      this.localDash = { until: this.time + p.dashIn, dx: p.dashDx || 0, dz: p.dashDz || 0 };
    }

"""
if old not in s:
    sys.exit('dash resync block not found')
s = s.replace(old, '', 1)

io.open(p, 'w', encoding='utf-8').write(s)
print('dash re-trigger removed')
