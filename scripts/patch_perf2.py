import re

p = 'src/ui.js'
s = open(p).read()

start = s.index('  drawMinimap(snap, youId, arena = this.arena) {')
end = s.index('  // ---------------------------------------------------------------- results', start) if '  // ---------------------------------------------------------------- results' in s[start:] else -1
# find the end of the method by locating the next top-level method after it
m = re.search(r"\n  (?!drawMinimap)[a-zA-Z_][\w]*\(", s[start + 10:])
end = start + 10 + m.start() + 1
old = s[start:end]

new = r'''  drawMinimap(snap, youId, arena = this.arena) {
    if (!arena) return;
    const c = $('minimap');
    if (!c) return;
    const g = c.getContext('2d');
    if (!g) return;
    const W = c.width, H = c.height;
    const pad = 12;
    const half = arena.half || arena.size / 2;
    const k = (W - pad * 2) / (half * 2);
    const px = (x) => W / 2 + x * k;
    const pz = (z) => H / 2 + z * k;

    // ---- static layer: rendered once per arena/canvas size, then blitted.
    const key = `${arena.seed || 0}:${arena.size}:${W}x${H}`;
    let base = this._mmBase;
    if (!base || this._mmKey !== key) {
      base = document.createElement('canvas');
      base.width = W; base.height = H;
      const b = base.getContext('2d');
      if (b) {
        b.fillStyle = '#0a0d0d'; b.fillRect(0, 0, W, H);
        b.strokeStyle = 'rgba(201,186,154,0.08)'; b.lineWidth = 1;
        for (let i = 1; i < 4; i++) {
          b.beginPath(); b.moveTo(pad + (W - pad * 2) * i / 4, pad); b.lineTo(pad + (W - pad * 2) * i / 4, H - pad); b.stroke();
          b.beginPath(); b.moveTo(pad, pad + (H - pad * 2) * i / 4); b.lineTo(W - pad, pad + (H - pad * 2) * i / 4); b.stroke();
        }
        b.strokeStyle = 'rgba(255,176,46,0.35)'; b.lineWidth = 1.5;
        b.strokeRect(px(-half), pz(-half), half * 2 * k, half * 2 * k);
        for (const a of arena.acids) {
          b.fillStyle = 'rgba(120,220,50,0.16)'; b.strokeStyle = 'rgba(157,255,87,0.5)';
          b.beginPath(); b.arc(px(a.x), pz(a.z), a.r * k, 0, 7); b.fill(); b.stroke();
        }
        for (const a of arena.coolers) {
          b.fillStyle = 'rgba(70,217,255,0.14)'; b.strokeStyle = 'rgba(70,217,255,0.55)';
          b.beginPath(); b.arc(px(a.x), pz(a.z), a.r * k, 0, 7); b.fill(); b.stroke();
        }
        b.strokeStyle = 'rgba(70,217,255,0.65)'; b.lineWidth = 1;
        for (const p of arena.plates) {
          b.beginPath(); b.arc(px(p.x), pz(p.z), p.r * k, 0, 7); b.stroke();
        }
        for (const t of arena.towers) {
          b.strokeStyle = 'rgba(255,208,90,0.35)';
          b.beginPath(); b.arc(px(t.x), pz(t.z), t.zapR * k, 0, 7); b.stroke();
        }
        for (const p of arena.pads) {
          b.fillStyle = p.center ? 'rgba(255,91,200,0.6)' : 'rgba(255,176,46,0.4)';
          b.beginPath(); b.arc(px(p.x), pz(p.z), 2, 0, 7); b.fill();
        }
      }
      this._mmBase = base;
      this._mmKey = key;
    }

    g.clearRect(0, 0, W, H);
    if (base) g.drawImage(base, 0, 0);

    // ---- dynamic layer -----------------------------------------------------
    const wallState = new Map((snap?.walls || []).map((w) => [w.id, w]));
    for (const w of arena.walls) {
      const st = wallState.get(w.id);
      const alive = st ? st.alive : 1;
      g.fillStyle = alive ? 'rgba(210,196,160,0.4)' : 'rgba(90,80,70,0.25)';
      g.fillRect(px(w.x - w.w / 2), pz(w.z - w.h / 2), w.w * k, w.h * k);
    }
    for (const t of arena.towers) {
      const ts = snap?.towers?.find((x) => x.id === t.id);
      g.fillStyle = ts?.charge > 0.2 ? '#ffd05a' : '#8a7a55';
      g.beginPath(); g.arc(px(t.x), pz(t.z), Math.max(2, t.r * k), 0, 7); g.fill();
    }
    for (const it of snap?.items || []) {
      g.fillStyle = ITEM_TYPES[it.type]?.color || '#ffb02e';
      g.beginPath(); g.arc(px(it.x), pz(it.z), 2.6, 0, 7); g.fill();
    }
    for (const z of snap?.zones || []) {
      g.strokeStyle = z.type === 'storm' ? 'rgba(90,220,255,0.8)' : 'rgba(157,255,87,0.55)';
      g.fillStyle = z.type === 'storm' ? 'rgba(70,217,255,0.1)' : 'rgba(120,220,50,0.08)';
      g.beginPath(); g.arc(px(z.x), pz(z.z), z.r * k, 0, 7); g.fill(); g.stroke();
    }
    for (const m of snap?.markers || []) {
      g.strokeStyle = '#ff4b3a'; g.lineWidth = 1.5;
      g.beginPath(); g.arc(px(m.x), pz(m.z), m.r * k, 0, 7); g.stroke();
      g.beginPath(); g.moveTo(px(m.x) - 4, pz(m.z)); g.lineTo(px(m.x) + 4, pz(m.z)); g.stroke();
    }
    for (const p of snap?.players || []) {
      const x = px(p.x), z = pz(p.z);
      if (!p.alive) {
        g.strokeStyle = 'rgba(255,75,58,0.6)'; g.lineWidth = 1;
        g.beginPath(); g.moveTo(x - 3, z - 3); g.lineTo(x + 3, z + 3); g.moveTo(x + 3, z - 3); g.lineTo(x - 3, z + 3); g.stroke();
        continue;
      }
      const heat = clamp(p.heat, 0, 100);
      g.fillStyle = p.color;
      g.beginPath(); g.arc(x, z, p.id === youId ? 4.5 : 3.6, 0, 7); g.fill();
      g.strokeStyle = heat >= 70 ? `rgba(255,${Math.round(120 - heat * 0.8)},60,0.95)` : 'rgba(255,255,255,0.18)';
      g.lineWidth = heat >= 70 ? 2 : 1;
      g.beginPath(); g.arc(x, z, p.id === youId ? 7 : 6, 0, 7); g.stroke();
      if (p.id === youId) {
        g.strokeStyle = '#ffffff'; g.lineWidth = 1.5;
        g.beginPath(); g.arc(x, z, 8.5, 0, 7); g.stroke();
        g.strokeStyle = 'rgba(255,255,255,0.7)';
        g.beginPath(); g.moveTo(x, z); g.lineTo(x + Math.cos(p.aim) * 9, z + Math.sin(p.aim) * 9); g.stroke();
      }
    }
    if (snap?.airdrop) {
      g.strokeStyle = '#ff5bc8'; g.setLineDash([3, 3]);
      g.beginPath(); g.arc(px(snap.airdrop.x), pz(snap.airdrop.z), 10, 0, 7); g.stroke();
      g.setLineDash([]);
    }
    this._mmDraws = (this._mmDraws || 0) + 1;
  }

'''

s = s[:start] + new + s[end:]
open(p, 'w').write(s)
print('minimap cached')
