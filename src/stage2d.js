// Canvas2D fallback renderer.
//
// If WebGL is unavailable (embedded preview iframes, old GPUs, blocklisted
// drivers) the game still needs to be playable, so this class mirrors the
// Stage API and draws the same simulation state as a top-down 2D view.
// It reads only snapshot data, never the three.js scene.

const TAU = Math.PI * 2;
const lerp = (a, b, k) => a + (b - a) * k;

export class Stage2D {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.is3D = false;
    this.quality = 'low';
    this.scene = null;
    this.camera = null;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.width = 0;
    this.height = 0;
    this.time = 0;
    this.game = null;
    this.getMode = () => 'menu';
    this.getProfile = () => ({ mech: 'assault', color: '#ffb02e' });
    this.cam = { x: 0, z: 0 };
    this.stars = null;
    if (!this.ctx) throw new Error('Canvas2D 不可用');
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  attach(opts) {
    Object.assign(this, opts);
  }

  setQuality(q, renderScale = 1) {
    this.quality = q;
    this.renderScale = renderScale;
  }

  getStats() {
    return {
      calls: null, triangles: null, dpr: this.dpr,
      buffer: `${this.canvas.width}×${this.canvas.height}`,
      shadows: false, bloom: false, adapter: 'canvas2d', mode: '2d',
    };
  }

  setActive() { /* no scene graph in 2D mode */ }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.width = w;
    this.height = h;
    this.canvas.width = Math.max(1, Math.floor(w * this.dpr));
    this.canvas.height = Math.max(1, Math.floor(h * this.dpr));
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    if (this.ctx) this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  // ------------------------------------------------------------------ helpers
  scaleFor(size) {
    return Math.min(this.width, this.height) / (size * 1.28);
  }

  worldToScreen(x, z, scale, camX, camZ) {
    return [this.width / 2 + (x - camX) * scale, this.height / 2 + (z - camZ) * scale];
  }

  roundRect(x, y, w, h, r) {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // ------------------------------------------------------------------- render
  render(dt = 0.016) {
    const ctx = this.ctx;
    if (!ctx) return;
    this.time += dt;
    ctx.save();
    ctx.clearRect(0, 0, this.width, this.height);
    if (this.getMode() === 'game' && this.game && this.game.running) this.drawGame(dt);
    else this.drawMenu();
    ctx.restore();
  }

  // --------------------------------------------------------------------- menu
  drawMenu() {
    const ctx = this.ctx;
    const w = this.width;
    const h = this.height;
    const g = ctx.createLinearGradient(0, 0, w * 0.7, h);
    g.addColorStop(0, '#0a0c0d');
    g.addColorStop(0.55, '#12100e');
    g.addColorStop(1, '#070909');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    // horizon glow
    const glow = ctx.createRadialGradient(w * 0.66, h * 0.58, 10, w * 0.66, h * 0.58, Math.max(w, h) * 0.55);
    glow.addColorStop(0, 'rgba(255, 176, 46, 0.16)');
    glow.addColorStop(0.4, 'rgba(255, 110, 40, 0.06)');
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, w, h);

    // hangar floor grid
    const horizon = h * 0.56;
    ctx.strokeStyle = 'rgba(255, 190, 120, 0.10)';
    ctx.lineWidth = 1;
    for (let i = -12; i <= 12; i++) {
      const x = w * 0.66 + i * (w * 0.055);
      ctx.beginPath();
      ctx.moveTo(w * 0.66 + i * 14, horizon);
      ctx.lineTo(x + i * 26, h);
      ctx.stroke();
    }
    for (let i = 1; i <= 9; i++) {
      const y = horizon + Math.pow(i / 9, 2.1) * (h - horizon);
      ctx.globalAlpha = 0.5 - i * 0.04;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // dust motes
    if (!this.stars) {
      this.stars = Array.from({ length: 60 }, () => ({
        x: Math.random(), y: Math.random(), s: 0.3 + Math.random() * 1.4, p: Math.random() * TAU,
      }));
    }
    ctx.fillStyle = 'rgba(255, 200, 150, 0.35)';
    for (const d of this.stars) {
      const x = (d.x + Math.sin(this.time * 0.1 + d.p) * 0.01) * w;
      const y = ((d.y - this.time * 0.006 * d.s) % 1 + 1) % 1 * h;
      ctx.fillRect(x, y, d.s, d.s);
    }

    // hero silhouette on the turntable
    const cx = w * 0.66;
    const cy = h * 0.7;
    const bob = Math.sin(this.time * 1.4) * 4;
    const prof = this.getProfile();
    const color = prof.color || '#ffb02e';
    ctx.save();
    ctx.translate(cx, cy + bob);

    const podGlow = ctx.createRadialGradient(0, 0, 4, 0, 0, Math.min(w, h) * 0.24);
    podGlow.addColorStop(0, 'rgba(255, 176, 46, 0.22)');
    podGlow.addColorStop(1, 'rgba(255, 176, 46, 0)');
    ctx.fillStyle = podGlow;
    ctx.beginPath();
    ctx.ellipse(0, 0, Math.min(w, h) * 0.26, Math.min(w, h) * 0.13, 0, 0, TAU);
    ctx.fill();

    ctx.strokeStyle = 'rgba(255, 190, 120, 0.28)';
    ctx.lineWidth = 1.5;
    for (let i = 0; i < 3; i++) {
      const r = 90 + i * 26 + Math.sin(this.time * 1.1 + i) * 3;
      ctx.globalAlpha = 0.5 - i * 0.13;
      ctx.beginPath();
      ctx.ellipse(0, 0, r, r * 0.36, 0, 0, TAU);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    const s = Math.min(w, h) * 0.0035;
    ctx.translate(0, -26);
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.beginPath();
    ctx.ellipse(0, 34, 62 * s * 0.9, 16 * s * 0.9, 0, 0, TAU);
    ctx.fill();

    // legs
    ctx.fillStyle = '#2b2f31';
    for (const side of [-1, 1]) {
      ctx.save();
      ctx.translate(side * 34 * s, -10 * s);
      ctx.rotate(side * 0.08);
      this.roundRect(-13 * s, 0, 26 * s, 78 * s, 8 * s);
      ctx.fill();
      ctx.fillStyle = '#1d2022';
      this.roundRect(-18 * s, 62 * s, 36 * s, 18 * s, 5 * s);
      ctx.fill();
      ctx.fillStyle = '#2b2f31';
      ctx.restore();
    }
    // torso
    const body = ctx.createLinearGradient(-60 * s, -40 * s, 60 * s, 40 * s);
    body.addColorStop(0, '#3a4043');
    body.addColorStop(0.5, '#222628');
    body.addColorStop(1, '#161a1c');
    ctx.fillStyle = body;
    this.roundRect(-64 * s, -96 * s, 128 * s, 96 * s, 16 * s);
    ctx.fill();
    // chest core
    const core = ctx.createRadialGradient(0, -48 * s, 2, 0, -48 * s, 34 * s);
    core.addColorStop(0, color);
    core.addColorStop(0.35, hexA(color, 0.55));
    core.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = core;
    ctx.beginPath();
    ctx.arc(0, -48 * s, 34 * s, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = hexA(color, 0.85);
    ctx.lineWidth = 2 * s;
    ctx.beginPath();
    ctx.arc(0, -48 * s, 15 * s, 0, TAU);
    ctx.stroke();

    // shoulders
    for (const side of [-1, 1]) {
      ctx.fillStyle = '#2f3437';
      ctx.save();
      ctx.translate(side * 74 * s, -74 * s);
      ctx.rotate(side * 0.12);
      this.roundRect(-20 * s, -14 * s, 40 * s, 42 * s, 9 * s);
      ctx.fill();
      ctx.fillStyle = hexA(color, 0.75);
      ctx.fillRect(-13 * s, -4 * s, 26 * s, 4 * s);
      ctx.restore();
    }
    // head
    ctx.fillStyle = '#2a2e30';
    this.roundRect(-24 * s, -132 * s, 48 * s, 34 * s, 9 * s);
    ctx.fill();
    ctx.fillStyle = hexA(color, 0.95);
    this.roundRect(-16 * s, -122 * s, 32 * s, 7 * s, 3 * s);
    ctx.fill();

    // antenna + warning lamp
    ctx.strokeStyle = '#4a5054';
    ctx.lineWidth = 2 * s;
    ctx.beginPath();
    ctx.moveTo(18 * s, -132 * s);
    ctx.lineTo(30 * s, -158 * s);
    ctx.stroke();
    ctx.fillStyle = `rgba(255, 90, 60, ${0.45 + Math.sin(this.time * 3) * 0.4})`;
    ctx.beginPath();
    ctx.arc(30 * s, -158 * s, 3.4 * s, 0, TAU);
    ctx.fill();
    ctx.restore();

    // 2D-mode notice
    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = '#8e8779';
    ctx.font = '11px ui-monospace, monospace';
    ctx.textAlign = 'right';
    ctx.fillText('2D 兼容渲染模式 · WebGL 不可用', w - 22, h - 18);
    ctx.restore();
  }

  // --------------------------------------------------------------------- game
  drawGame(dt) {
    const ctx = this.ctx;
    const game = this.game;
    const snap = game.snap;
    const arena = game.clientArena || game.arena;
    if (!arena) return;
    const size = arena.size || 30;
    const scale = this.scaleFor(size);
    const self = snap?.players?.find((p) => p.id === game.myId);
    const selfVis = game.players?.get(game.myId);
    const tx = self ? (selfVis?.x ?? self.x) : 0;
    const tz = self ? (selfVis?.z ?? self.z) : 0;
    const k = snap ? Math.min(1, dt * 6) : 1;
    this.cam.x = lerp(this.cam.x, tx, k);
    this.cam.z = lerp(this.cam.z, tz, k);
    const camX = this.cam.x;
    const camZ = this.cam.z;
    const P = (x, z) => this.worldToScreen(x, z, scale, camX, camZ);

    // ground
    const bg = ctx.createRadialGradient(this.width / 2, this.height / 2, 40, this.width / 2, this.height / 2, Math.max(this.width, this.height) * 0.75);
    bg.addColorStop(0, '#1a1712');
    bg.addColorStop(1, '#0a0b0b');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, this.width, this.height);

    const [ax, ay] = P(-arena.half, -arena.half);
    const aw = arena.size * scale;
    ctx.fillStyle = '#15130f';
    ctx.fillRect(ax, ay, aw, aw);

    // floor grid
    ctx.strokeStyle = 'rgba(255, 190, 120, 0.055)';
    ctx.lineWidth = 1;
    const step = 2.5;
    for (let v = -arena.half; v <= arena.half + 0.01; v += step) {
      const [gx, gy] = P(v, -arena.half);
      const [, gy2] = P(v, arena.half);
      ctx.beginPath(); ctx.moveTo(gx, gy); ctx.lineTo(gx, gy2); ctx.stroke();
      const [hx, hy] = P(-arena.half, v);
      const [hx2] = P(arena.half, v);
      ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(hx2, hy); ctx.stroke();
    }

    // acid pools
    for (const a of arena.acids || []) {
      const [x, y] = P(a.x, a.z);
      const r = a.r * scale;
      const g = ctx.createRadialGradient(x, y, r * 0.15, x, y, r);
      g.addColorStop(0, 'rgba(150, 255, 90, 0.30)');
      g.addColorStop(0.7, 'rgba(90, 200, 60, 0.16)');
      g.addColorStop(1, 'rgba(60, 140, 40, 0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = 'rgba(140, 240, 90, 0.35)';
      ctx.setLineDash([6, 6]);
      ctx.lineDashOffset = -this.time * 8;
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // cooling vents
    for (const c of arena.coolers || []) {
      const [x, y] = P(c.x, c.z);
      const r = (c.r || 1.5) * scale;
      const g = ctx.createRadialGradient(x, y, 2, x, y, r);
      g.addColorStop(0, 'rgba(90, 216, 255, 0.30)');
      g.addColorStop(1, 'rgba(90, 216, 255, 0.02)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
      ctx.strokeStyle = 'rgba(120, 225, 255, 0.45)';
      ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.arc(x, y, r * 0.72, 0, TAU); ctx.stroke();
      ctx.beginPath(); ctx.arc(x, y, r * 0.34, 0, TAU); ctx.stroke();
    }

    // center platform
    if (arena.platform) {
      const [x, y] = P(arena.platform.x || 0, arena.platform.z || 0);
      const r = (arena.platform.r || 4) * scale;
      ctx.strokeStyle = 'rgba(255, 176, 46, 0.35)';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.stroke();
      ctx.fillStyle = 'rgba(255, 176, 46, 0.05)';
      ctx.fill();
    }

    // rebound plates
    for (const pl of arena.plates || []) {
      const [x, y] = P(pl.x, pl.z);
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(pl.angle || 0);
      ctx.fillStyle = 'rgba(198, 209, 218, 0.16)';
      ctx.strokeStyle = 'rgba(198, 209, 218, 0.55)';
      ctx.lineWidth = 1.2;
      const s = (pl.r || 1.1) * scale;
      this.roundRect(-s, -s * 0.28, s * 2, s * 0.56, 3);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }

    // dynamic plates placed by players
    for (const pl of snap?.dynamicPlates || []) {
      const [x, y] = P(pl.x, pl.z);
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(pl.angle || 0);
      ctx.fillStyle = 'rgba(210, 225, 235, 0.28)';
      ctx.strokeStyle = 'rgba(230, 245, 255, 0.8)';
      ctx.lineWidth = 1.6;
      const s = (pl.r || 1.15) * scale;
      this.roundRect(-s, -s * 0.3, s * 2, s * 0.6, 3);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }

    // walls (destructible)
    const wallState = new Map((snap?.walls || []).map((w) => [w.id, w]));
    for (const w of arena.walls || []) {
      const st = wallState.get(w.id);
      const alive = st ? !!st.alive : w.alive !== false;
      const [x, y] = P(w.x, w.z);
      const ww = w.w * scale;
      const hh = w.h * scale;
      if (!alive) {
        ctx.strokeStyle = 'rgba(120, 110, 95, 0.35)';
        ctx.setLineDash([5, 5]);
        ctx.lineWidth = 1.2;
        ctx.strokeRect(x - ww / 2, y - hh / 2, ww, hh);
        ctx.setLineDash([]);
        ctx.fillStyle = 'rgba(90, 82, 70, 0.16)';
        ctx.fillRect(x - ww / 2, y - hh / 2, ww, hh);
        continue;
      }
      const hp = st ? st.hp : (w.hp ?? 3);
      const dmg = Math.max(0, Math.min(1, 1 - hp / (w.maxHp || 3)));
      const g = ctx.createLinearGradient(x - ww / 2, y - hh / 2, x + ww / 2, y + hh / 2);
      g.addColorStop(0, '#4b4740');
      g.addColorStop(0.5, '#332f2a');
      g.addColorStop(1, '#232019');
      ctx.fillStyle = g;
      ctx.fillRect(x - ww / 2, y - hh / 2, ww, hh);
      ctx.strokeStyle = 'rgba(200, 170, 120, 0.35)';
      ctx.lineWidth = 1.2;
      ctx.strokeRect(x - ww / 2, y - hh / 2, ww, hh);
      if (dmg > 0.05) {
        ctx.strokeStyle = `rgba(255, 150, 80, ${0.25 + dmg * 0.4})`;
        ctx.beginPath();
        ctx.moveTo(x - ww * 0.3, y - hh * 0.45);
        ctx.lineTo(x - ww * 0.05, y + hh * 0.1);
        ctx.lineTo(x + ww * 0.25, y - hh * 0.2);
        ctx.lineTo(x + ww * 0.4, y + hh * 0.45);
        ctx.stroke();
      }
    }

    // EM towers
    for (const t of arena.towers || []) {
      const [x, y] = P(t.x, t.z);
      const r = (t.r || 0.9) * scale;
      const st = (snap?.towers || []).find((v) => v.id === t.id);
      const charge = st ? st.charge || 0 : 0;
      ctx.fillStyle = `rgba(80, 220, 255, ${0.1 + charge * 0.25})`;
      ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
      ctx.strokeStyle = `rgba(140, 240, 255, ${0.45 + charge * 0.5})`;
      ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.stroke();
      if (charge > 0.02) {
        ctx.strokeStyle = `rgba(160, 245, 255, ${charge * 0.35})`;
        ctx.beginPath(); ctx.arc(x, y, (t.zapR || 3) * scale * charge, 0, TAU); ctx.stroke();
      }
    }

    // storm / leak zones
    for (const z of snap?.zones || []) {
      const [x, y] = P(z.x, z.z);
      const r = z.r * scale;
      const storm = z.type === 'storm';
      const g = ctx.createRadialGradient(x, y, r * 0.2, x, y, r);
      if (storm) {
        g.addColorStop(0, 'rgba(180, 120, 255, 0.30)');
        g.addColorStop(1, 'rgba(120, 60, 220, 0.05)');
      } else {
        g.addColorStop(0, 'rgba(80, 210, 255, 0.22)');
        g.addColorStop(1, 'rgba(40, 140, 200, 0.03)');
      }
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
      ctx.strokeStyle = storm ? 'rgba(200, 150, 255, 0.5)' : 'rgba(120, 220, 255, 0.45)';
      ctx.setLineDash([8, 6]);
      ctx.lineDashOffset = -this.time * 20;
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // claw / event markers
    for (const m of snap?.markers || []) {
      const [x, y] = P(m.x, m.z);
      const r = m.r * scale;
      const pulse = 0.5 + Math.sin(this.time * 6) * 0.2;
      ctx.strokeStyle = `rgba(255, 90, 70, ${pulse + 0.2})`;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.stroke();
      ctx.fillStyle = 'rgba(255, 70, 50, 0.12)';
      ctx.fill();
      ctx.strokeStyle = `rgba(255, 120, 90, ${pulse})`;
      ctx.beginPath();
      ctx.moveTo(x - r * 0.3, y - r * 0.3); ctx.lineTo(x + r * 0.3, y + r * 0.3);
      ctx.moveTo(x + r * 0.3, y - r * 0.3); ctx.lineTo(x - r * 0.3, y + r * 0.3);
      ctx.stroke();
    }

    // items
    for (const it of snap?.items || []) {
      const [x, y] = P(it.x, it.z);
      const bob = Math.sin(this.time * 3 + it.id) * 2;
      const colors = {
        coolant: '#5ad8ff', grenade: '#ffb03a', plate: '#c6d1da',
        overclock: '#ff5bc8', grapple: '#ffd83d', purge: '#9dff57',
      };
      const c = colors[it.type] || '#ffffff';
      ctx.save();
      ctx.translate(x, y + bob);
      ctx.rotate(this.time * 1.2);
      ctx.fillStyle = hexA(c, 0.22);
      ctx.strokeStyle = hexA(c, 0.9);
      ctx.lineWidth = 1.4;
      this.roundRect(-7, -7, 14, 14, 3);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
      ctx.fillStyle = c;
      ctx.beginPath(); ctx.arc(x, y + bob, 2.4, 0, TAU); ctx.fill();
    }

    // airdrop crate
    if (snap?.airdrop) {
      const [x, y] = P(snap.airdrop.x, snap.airdrop.z);
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(Math.sin(this.time) * 0.05);
      ctx.fillStyle = 'rgba(255, 176, 46, 0.22)';
      ctx.strokeStyle = 'rgba(255, 176, 46, 0.9)';
      ctx.lineWidth = 2;
      this.roundRect(-16, -16, 32, 32, 4);
      ctx.fill(); ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-16, 0); ctx.lineTo(16, 0);
      ctx.moveTo(0, -16); ctx.lineTo(0, 16);
      ctx.stroke();
      ctx.restore();
    }

    // mines
    for (const m of snap?.mines || []) {
      const [x, y] = P(m.x, m.z);
      const armed = m.armed;
      ctx.fillStyle = armed ? 'rgba(255, 120, 60, 0.9)' : 'rgba(255, 200, 120, 0.5)';
      ctx.beginPath(); ctx.arc(x, y, 4.2, 0, TAU); ctx.fill();
      ctx.strokeStyle = armed ? 'rgba(255, 90, 40, 0.55)' : 'rgba(255, 200, 120, 0.25)';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(x, y, 7 + Math.sin(this.time * 5) * 1.5, 0, TAU); ctx.stroke();
    }

    // grenades
    for (const g of snap?.grenades || []) {
      const [x, y] = P(g.x, g.z);
      ctx.fillStyle = '#ffb03a';
      ctx.beginPath(); ctx.arc(x, y, 3.6, 0, TAU); ctx.fill();
      ctx.strokeStyle = `rgba(255, 90, 40, ${0.3 + Math.sin(this.time * 14) * 0.2})`;
      ctx.beginPath(); ctx.arc(x, y, 9, 0, TAU); ctx.stroke();
    }

    // bullets with short trails
    for (const b of snap?.bullets || []) {
      const [x, y] = P(b.x, b.z);
      const sp = Math.hypot(b.vx || 0, b.vz || 0) || 1;
      const tx = x - (b.vx / sp) * 9;
      const ty = y - (b.vz / sp) * 9;
      ctx.strokeStyle = b.charged ? '#ffe9a8' : '#9fe9ff';
      ctx.lineWidth = b.charged ? 2.4 : 1.6;
      ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(x, y); ctx.stroke();
    }

    // players
    const players = snap?.players || [];
    for (const p of players) {
      const vis = game.players?.get(p.id);
      const wx = vis && p.id === game.myId ? vis.x : (vis && vis.alive ? lerp(vis.rx ?? p.x, p.x, 0.5) : p.x);
      const wz = vis && p.id === game.myId ? vis.z : (vis && vis.alive ? lerp(vis.rz ?? p.z, p.z, 0.5) : p.z);
      const [x, y] = P(wx, wz);
      const isSelf = p.id === game.myId;
      if (!p.alive) {
        ctx.strokeStyle = hexA(p.color || '#888', 0.35);
        ctx.setLineDash([3, 4]);
        ctx.beginPath(); ctx.arc(x, y, 11, 0, TAU); ctx.stroke();
        ctx.setLineDash([]);
        continue;
      }
      const heat = Math.min(100, p.heat || 0);
      const bodyR = 11;
      // heat halo
      const halo = ctx.createRadialGradient(x, y, bodyR * 0.5, x, y, bodyR * 2.6);
      halo.addColorStop(0, `rgba(255, ${Math.max(60, 200 - heat * 1.4) | 0}, 40, ${0.05 + heat / 100 * 0.3})`);
      halo.addColorStop(1, 'rgba(255, 80, 40, 0)');
      ctx.fillStyle = halo;
      ctx.beginPath(); ctx.arc(x, y, bodyR * 2.6, 0, TAU); ctx.fill();

      // aim line
      const aim = p.aim || 0;
      const len = isSelf ? 62 : 46;
      ctx.strokeStyle = hexA(p.color || '#fff', 0.55);
      ctx.lineWidth = isSelf ? 2 : 1.2;
      ctx.beginPath();
      ctx.moveTo(x + Math.cos(aim) * bodyR, y + Math.sin(aim) * bodyR);
      ctx.lineTo(x + Math.cos(aim) * (bodyR + len), y + Math.sin(aim) * (bodyR + len));
      ctx.stroke();

      // chassis
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(aim + Math.PI / 2);
      ctx.fillStyle = '#202423';
      ctx.strokeStyle = p.color || '#fff';
      ctx.lineWidth = isSelf ? 2.4 : 1.8;
      this.roundRect(-bodyR * 0.72, -bodyR * 0.95, bodyR * 1.44, bodyR * 1.9, 4);
      ctx.fill();
      ctx.stroke();
      // barrel
      ctx.fillStyle = hexA(p.color || '#fff', 0.85);
      ctx.fillRect(-1.6, -bodyR * 1.9, 3.2, bodyR * 0.95);
      ctx.restore();

      // heat ring
      ctx.strokeStyle = 'rgba(255,255,255,0.14)';
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(x, y, bodyR + 6, 0, TAU); ctx.stroke();
      const heatColor = heat >= 90 ? '#ff4b3a' : heat >= 70 ? '#ff7a2e' : heat >= 40 ? '#ffcf5a' : '#46d9ff';
      ctx.strokeStyle = heatColor;
      ctx.beginPath();
      ctx.arc(x, y, bodyR + 6, -Math.PI / 2, -Math.PI / 2 + (heat / 100) * TAU);
      ctx.stroke();

      if (p.shield > 0) {
        ctx.strokeStyle = 'rgba(160, 240, 255, 0.8)';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(x, y, bodyR + 11, 0, TAU); ctx.stroke();
      }
      if (p.stunned) {
        ctx.fillStyle = 'rgba(160, 240, 255, 0.9)';
        ctx.beginPath(); ctx.arc(x + 12, y - 14, 2.5, 0, TAU); ctx.fill();
      }
      // name for others
      if (!isSelf) {
        ctx.font = '10px ui-monospace, monospace';
        ctx.textAlign = 'center';
        ctx.fillStyle = hexA(p.color || '#fff', 0.8);
        ctx.fillText(p.name || '', x, y - bodyR - 12);
      } else {
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(x, y, bodyR + 13, 0, TAU); ctx.stroke();
      }
    }

    // crosshair-like aim guide for self
    if (game.mouse && game.running) {
      const mx = game.mouse.x;
      const my = game.mouse.y;
      ctx.strokeStyle = 'rgba(255, 235, 200, 0.28)';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(mx - 9, my); ctx.lineTo(mx - 3, my);
      ctx.moveTo(mx + 3, my); ctx.lineTo(mx + 9, my);
      ctx.moveTo(mx, my - 9); ctx.lineTo(mx, my - 3);
      ctx.moveTo(mx, my + 3); ctx.lineTo(mx, my + 9);
      ctx.stroke();
    }
    if (isFinite(camX)) this.cam = { x: camX, z: camZ };
  }
}

function hexA(hex, a) {
  if (!hex) return `rgba(255,255,255,${a})`;
  if (hex.startsWith('rgba')) return hex;
  if (hex.startsWith('rgb(')) return hex.replace('rgb(', 'rgba(').replace(')', `,${a})`);
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(full.slice(0, 6), 16);
  if (Number.isNaN(n)) return `rgba(255,255,255,${a})`;
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}
