import re

# =============================================================== server/sim.js
p = 'server/sim.js'
s = open(p).read()

# 1) normalize the dash direction (diagonal dashes used to travel 1.41x further,
#    on the server only — a guaranteed client/server divergence)
old_dash = """      if (this.t >= p.dashCdUntil && p.stunUntil <= this.t && p.channelEnd <= this.t) {
        const mv = Math.hypot(p.input.mx, p.input.mz);
        const dx = mv > 0.1 ? p.input.mx : Math.cos(p.aim);
        const dz = mv > 0.1 ? p.input.mz : Math.sin(p.aim);"""
new_dash = """      if (this.t >= p.dashCdUntil && p.stunUntil <= this.t && p.channelEnd <= this.t) {
        const mv = Math.hypot(p.input.mx, p.input.mz);
        const dx = mv > 0.1 ? p.input.mx / mv : Math.cos(p.aim);
        const dz = mv > 0.1 ? p.input.mz / mv : Math.sin(p.aim);"""
assert old_dash in s
s = s.replace(old_dash, new_dash)

# 2) expose the dash window so the client can mirror it after a resync
s = s.replace("""        seq: p.input.seq,
        paused: p.disconnected,""",
"""        seq: p.input.seq,
        dashIn: round2(Math.max(0, p.dashUntil - this.t)),
        dashDx: round3(p.dashDirX || 0),
        dashDz: round3(p.dashDirZ || 0),
        paused: p.disconnected,""")

# 3) helper used by the room to tell clients where everyone actually spawned
s = s.replace("""  suddenDeathSeconds() {""",
"""  /** Current spawn positions, so clients place the mechs where the sim did. */
  spawnState() {
    const out = [];
    for (const p of this.players.values()) {
      out.push({ id: p.id, x: round2(p.x), z: round2(p.z), aim: round3(p.aim) });
    }
    return out;
  }

  suddenDeathSeconds() {""")
open(p, 'w').write(s)
print('sim patched')

# =============================================================== server/rooms.js
p = 'server/rooms.js'
s = open(p).read()
s = s.replace("""        players: infos,
        matchCount: this.matchCount,""",
"""        players: infos,
        spawns: this.sim.spawnState(),
        matchCount: this.matchCount,""")
open(p, 'w').write(s)
print('rooms patched')

# =============================================================== server/index.js
p = 'server/index.js'
s = open(p).read()
s = s.replace("""          players: [...target.members.values()].map((m) => ({
            id: m.playerId, name: m.name, color: m.color, colorId: m.colorId,
            mech: m.mech, team: m.team || 0, bot: m.bot, isHost: m.clientId === target.host,
          })),""",
"""          players: [...target.members.values()].map((m) => ({
            id: m.playerId, name: m.name, color: m.color, colorId: m.colorId,
            mech: m.mech, team: m.team || 0, bot: m.bot, isHost: m.clientId === target.host,
          })),
          spawns: target.sim.spawnState(),""")
open(p, 'w').write(s)
print('index patched')
