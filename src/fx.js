import * as THREE from 'three';
import { glowTexture, ringTexture, smokeTexture, sparkTexture, scorchTexture, hazardTexture } from './textures.js';

const PARTICLE_VERT = `
  attribute float size;
  attribute vec3 pcolor;
  attribute float alpha;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vColor = pcolor;
    vAlpha = alpha;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = size * (420.0 / max(1.0, -mv.z));
    gl_Position = projectionMatrix * mv;
  }
`;
const PARTICLE_FRAG = `
  uniform sampler2D map;
  uniform float globalAlpha;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vec4 tex = texture2D(map, gl_PointCoord);
    if (tex.a < 0.01) discard;
    gl_FragColor = vec4(vColor * tex.rgb, tex.a * vAlpha * globalAlpha);
  }
`;

class ParticleSystem {
  constructor(scene, count, texture, blending, baseSize = 1) {
    this.count = count;
    this.scene = scene;
    this.baseSize = baseSize;
    const geo = new THREE.BufferGeometry();
    this.positions = new Float32Array(count * 3);
    this.colors = new Float32Array(count * 3);
    this.sizes = new Float32Array(count);
    this.alphas = new Float32Array(count);
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    geo.setAttribute('pcolor', new THREE.BufferAttribute(this.colors, 3));
    geo.setAttribute('size', new THREE.BufferAttribute(this.sizes, 1));
    geo.setAttribute('alpha', new THREE.BufferAttribute(this.alphas, 1));
    this.mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: texture }, globalAlpha: { value: 1 } },
      vertexShader: PARTICLE_VERT,
      fragmentShader: PARTICLE_FRAG,
      transparent: true,
      depthWrite: false,
      blending,
    });
    this.points = new THREE.Points(geo, this.mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
    this.parts = [];
    for (let i = 0; i < count; i++) {
      this.parts.push({ alive: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 0, maxLife: 1, size: 1, gravity: 0, drag: 0.98, r: 1, g: 1, b: 1 });
    }
    this.cursor = 0;
  }

  spawn(opts) {
    const p = this.parts[this.cursor];
    this.cursor = (this.cursor + 1) % this.count;
    p.alive = true;
    p.x = opts.x; p.y = opts.y ?? 0.5; p.z = opts.z;
    p.vx = opts.vx ?? 0; p.vy = opts.vy ?? 0; p.vz = opts.vz ?? 0;
    p.life = 0;
    p.maxLife = opts.life ?? 0.6;
    p.size = (opts.size ?? 1) * this.baseSize;
    p.gravity = opts.gravity ?? 0;
    p.drag = opts.drag ?? 0.97;
    const c = opts.color instanceof THREE.Color ? opts.color : new THREE.Color(opts.color || '#ffffff');
    p.r = c.r; p.g = c.g; p.b = c.b;
    p.fade = opts.fade ?? 0.6;
  }

  update(dt) {
    const pos = this.positions, col = this.colors, sz = this.sizes, al = this.alphas;
    for (let i = 0; i < this.count; i++) {
      const p = this.parts[i];
      if (!p.alive) { al[i] = 0; continue; }
      p.life += dt;
      if (p.life >= p.maxLife) { p.alive = false; al[i] = 0; continue; }
      p.vy -= p.gravity * dt;
      p.vx *= Math.pow(p.drag, dt * 60);
      p.vz *= Math.pow(p.drag, dt * 60);
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      if (p.y < 0.03) { p.y = 0.03; p.vy *= -0.28; p.vx *= 0.6; p.vz *= 0.6; }
      const t = p.life / p.maxLife;
      const alpha = t < 0.15 ? t / 0.15 : 1 - (t - 0.15) / 0.85;
      pos[i * 3] = p.x; pos[i * 3 + 1] = p.y; pos[i * 3 + 2] = p.z;
      col[i * 3] = p.r; col[i * 3 + 1] = p.g; col[i * 3 + 2] = p.b;
      sz[i] = p.size * (0.7 + t * 0.8);
      al[i] = Math.max(0, alpha);
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.pcolor.needsUpdate = true;
    this.points.geometry.attributes.size.needsUpdate = true;
    this.points.geometry.attributes.alpha.needsUpdate = true;
  }

  dispose() {
    this.scene.remove(this.points);
    this.points.geometry.dispose();
    this.mat.dispose();
  }
}

class RingPool {
  constructor(scene, count) {
    this.scene = scene;
    this.items = [];
    const geo = new THREE.PlaneGeometry(1, 1);
    for (let i = 0; i < count; i++) {
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
        map: ringTexture(), color: '#ffffff', transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
      }));
      m.rotation.x = -Math.PI / 2;
      m.visible = false;
      scene.add(m);
      this.items.push({ m, alive: false, life: 0, maxLife: 1, r0: 1, r1: 2, vertical: false });
    }
    this.cursor = 0;
  }
  spawn(x, z, opts = {}) {
    const it = this.items[this.cursor];
    this.cursor = (this.cursor + 1) % this.items.length;
    it.alive = true; it.life = 0; it.maxLife = opts.life ?? 0.55;
    it.r0 = opts.r0 ?? 0.3; it.r1 = opts.r1 ?? 2.2;
    it.m.position.set(x, opts.y ?? 0.06, z);
    it.m.rotation.set(opts.vertical ? 0 : -Math.PI / 2, 0, 0);
    it.m.material.color.set(opts.color || '#9fe9ff');
    it.m.material.opacity = opts.opacity ?? 0.9;
    it.m.visible = true;
    it.m.scale.setScalar(it.r0);
  }
  update(dt) {
    for (const it of this.items) {
      if (!it.alive) continue;
      it.life += dt;
      const t = it.life / it.maxLife;
      if (t >= 1) { it.alive = false; it.m.visible = false; continue; }
      const s = it.r0 + (it.r1 - it.r0) * t;
      it.m.scale.setScalar(s);
      it.m.material.opacity = (1 - t) * 0.9;
      if (it.m.rotation.x === 0) it.m.rotation.z += dt * 2;
    }
  }
}

class DecalPool {
  constructor(scene, count, tex, color = '#000000') {
    this.items = [];
    const geo = new THREE.PlaneGeometry(1, 1);
    for (let i = 0; i < count; i++) {
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0, depthWrite: false, color }));
      m.rotation.x = -Math.PI / 2;
      m.visible = false;
      m.renderOrder = 1;
      scene.add(m);
      this.items.push({ m, life: 0, maxLife: 12, alive: false });
    }
    this.cursor = 0;
  }
  spawn(x, z, size = 2.4, life = 14, rot = 0) {
    const it = this.items[this.cursor];
    this.cursor = (this.cursor + 1) % this.items.length;
    it.alive = true; it.life = 0; it.maxLife = life;
    it.m.position.set(x, 0.02, z);
    it.m.scale.setScalar(size);
    it.m.rotation.z = rot;
    it.m.material.opacity = 0.85;
    it.m.visible = true;
  }
  update(dt) {
    for (const it of this.items) {
      if (!it.alive) continue;
      it.life += dt;
      const t = it.life / it.maxLife;
      if (t >= 1) { it.alive = false; it.m.visible = false; continue; }
      it.m.material.opacity = t < 0.7 ? 0.8 : (1 - t) / 0.3 * 0.8;
    }
  }
}

export class Fx {
  constructor(scene, quality = 'high') {
    this.scene = scene;
    this.quality = quality;
    this.density = quality === 'low' ? 0.5 : quality === 'med' ? 0.75 : 1;
    this.sparks = new ParticleSystem(scene, quality === 'low' ? 500 : 900, sparkTexture(), THREE.AdditiveBlending, 0.22);
    this.smoke = new ParticleSystem(scene, quality === 'low' ? 160 : 300, smokeTexture(), THREE.NormalBlending, 1.6);
    this.rings = new RingPool(scene, 36);
    this.decals = new DecalPool(scene, 24, scorchTexture());
    this.debris = [];
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mats = ['#4c4238', '#2e2f2b', '#7b4b2d'].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.85, metalness: 0.4 }));
    for (let i = 0; i < 48; i++) {
      const m = new THREE.Mesh(geo, mats[i % mats.length]);
      m.visible = false;
      m.castShadow = quality !== 'low';
      scene.add(m);
      this.debris.push({ m, alive: false, life: 0, maxLife: 2, vx: 0, vy: 0, vz: 0, rx: 0, ry: 0, rz: 0, sx: 0.2 });
    }
    this.debrisCursor = 0;
    this.flashes = [];
    for (let i = 0; i < 10; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: '#ffffff', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
      s.visible = false;
      scene.add(s);
      this.flashes.push({ s, alive: false, life: 0, maxLife: 0.3, size: 4 });
    }
    this.flashCursor = 0;
    this.beams = [];
    const beamGeo = new THREE.CylinderGeometry(0.06, 0.06, 1, 6, 1, true);
    for (let i = 0; i < 24; i++) {
      const m = new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({ color: '#aef6ff', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
      m.visible = false;
      scene.add(m);
      this.beams.push({ m, alive: false, life: 0, maxLife: 0.25 });
    }
    this.beamCursor = 0;
    this.lights = [];
    for (let i = 0; i < 3; i++) {
      const l = new THREE.PointLight('#ffb060', 0, 12, 2);
      scene.add(l);
      this.lights.push({ l, alive: false, life: 0, maxLife: 0.4, peak: 3 });
    }
    this.lightCursor = 0;
    this.clawArms = [];
    this.scorches = this.decals;
  }

  setQuality(q) {
    this.quality = q;
    this.density = q === 'low' ? 0.5 : q === 'med' ? 0.75 : 1;
    this.sparks.mat.uniforms.globalAlpha.value = q === 'low' ? 0.8 : 1;
  }

  sparkBurst(x, y, z, color, n = 14, speed = 5, size = 1, life = 0.6, opts = {}) {
    const count = Math.ceil(n * (this.density ?? 1));
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = speed * (0.3 + Math.random() * 0.7);
      this.sparks.spawn({
        x, y, z,
        vx: Math.cos(a) * v * (opts.spread ?? 1),
        vy: (opts.up ?? 0.35) * speed * Math.random() * 1.2 + (opts.lift ?? 1.5),
        vz: Math.sin(a) * v * (opts.spread ?? 1),
        life: life * (0.5 + Math.random()),
        size: size * (0.6 + Math.random() * 0.7),
        color, gravity: opts.gravity ?? 9,
      });
    }
  }

  smokePuff(x, y, z, n = 6, color = '#8b8074', size = 1.4, life = 1.6, speed = 0.8) {
    const count = Math.ceil(n * (this.density ?? 1));
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = speed * (0.3 + Math.random() * 0.7);
      this.smoke.spawn({
        x: x + Math.cos(a) * 0.25, y: y + Math.random() * 0.4, z: z + Math.sin(a) * 0.25,
        vx: Math.cos(a) * v, vy: 0.5 + Math.random() * 0.8, vz: Math.sin(a) * v,
        life: life * (0.7 + Math.random() * 0.6), size: size * (0.6 + Math.random() * 0.8),
        color, gravity: -0.4, drag: 0.985, fade: 1,
      });
    }
  }

  flash(x, y, z, color, size = 4, life = 0.28) {
    const f = this.flashes[this.flashCursor];
    this.flashCursor = (this.flashCursor + 1) % this.flashes.length;
    f.alive = true; f.life = 0; f.maxLife = life; f.size = size;
    f.s.position.set(x, y, z);
    f.s.material.color.set(color);
    f.s.visible = true;
  }

  ring(x, z, opts = {}) { this.rings.spawn(x, z, opts); }

  beam(x1, y1, z1, x2, y2, z2, color = '#aef6ff', life = 0.18, width = 0.06) {
    const b = this.beams[this.beamCursor];
    this.beamCursor = (this.beamCursor + 1) % this.beams.length;
    b.alive = true; b.life = 0; b.maxLife = life;
    const dx = x2 - x1, dy = y2 - y1, dz = z2 - z1;
    const len = Math.hypot(dx, dy, dz) || 0.001;
    b.m.position.set((x1 + x2) / 2, (y1 + y2) / 2, (z1 + z2) / 2);
    b.m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(dx / len, dy / len, dz / len));
    b.m.scale.set(width / 0.06, len, width / 0.06);
    b.m.material.color.set(color);
    b.m.material.opacity = 0.95;
    b.m.visible = true;
  }

  debrisBurst(x, z, n = 8, color = null) {
    const count = this.quality === 'low' ? Math.ceil(n * 0.5) : n;
    for (let i = 0; i < count; i++) {
      const d = this.debris[this.debrisCursor];
      this.debrisCursor = (this.debrisCursor + 1) % this.debris.length;
      d.alive = true; d.life = 0; d.maxLife = 1.5 + Math.random() * 1.7;
      d.m.position.set(x + (Math.random() - 0.5) * 0.6, 0.4 + Math.random() * 0.8, z + (Math.random() - 0.5) * 0.6);
      d.m.scale.setScalar(0.15 + Math.random() * 0.3);
      d.vx = (Math.random() - 0.5) * 8;
      d.vy = 3 + Math.random() * 7;
      d.vz = (Math.random() - 0.5) * 8;
      d.rx = (Math.random() - 0.5) * 12;
      d.ry = (Math.random() - 0.5) * 12;
      d.rz = (Math.random() - 0.5) * 12;
      d.sx = d.m.scale.x;
      d.m.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
      if (color) d.m.material = d.m.material; // shared grey metal debris
      d.m.visible = true;
    }
  }

  explosion(x, z, opts = {}) {
    const scale = opts.scale ?? 1;
    this.flash(x, 1.0, z, opts.color || '#ffd08a', 6 * scale, 0.3);
    this.sparkBurst(x, 0.7, z, '#ffb45c', 28, 12, 1.5, 0.9, { up: 0.9, lift: 3, gravity: 8 });
    this.sparkBurst(x, 0.5, z, '#fff3c0', 12, 6, 1.1, 0.5, { up: 1.2, lift: 2 });
    this.ring(x, z, { color: '#ffd9a0', r0: 0.5, r1: 4.2 * scale, life: 0.5, opacity: 0.9 });
    this.ring(x, z, { color: '#ff8a3d', r0: 0.2, r1: 2.6 * scale, life: 0.7, opacity: 0.7 });
    this.smokePuff(x, 0.6, z, 10, '#6a5d50', 2.2, 2.2, 1.4);
    this.debrisBurst(x, z, 10);
    this.decals.spawn(x, z, 2.8 * scale, 16, Math.random() * 6.28);
    this.lightPulse(x, z, opts.color || '#ff9a4a', 5 * scale, 0.5);
  }

  shortCircuit(x, z, opts = {}) {
    const scale = 1.25;
    this.explosion(x, z, { scale, color: opts.color || '#ffe0a0' });
    this.flash(x, 1.1, z, '#eafaff', 9, 0.35);
    this.sparkBurst(x, 0.9, z, '#9fe9ff', 30, 16, 1.4, 1.0, { up: 1.2, lift: 2 });
    this.sparkBurst(x, 1.1, z, '#ffcf6a', 20, 10, 1.2, 0.9);
    this.ring(x, z, { color: '#8ff0ff', r0: 0.4, r1: 6, life: 0.8, opacity: 1 });
    this.smokePuff(x, 1.2, z, 16, '#3a3632', 2.6, 3, 1.8);
    this.debrisBurst(x, z, 16);
    this.decals.spawn(x, z, 4.2, 22, Math.random() * 6.28);
    this.lightPulse(x, z, '#bfefff', 8, 0.7);
    for (let i = 0; i < 5; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 1 + Math.random() * 2;
      this.beam(x + Math.cos(a) * r, 0.1, z + Math.sin(a) * r, x + Math.cos(a) * (r + 1.2), 2 + Math.random() * 2.5, z + Math.sin(a) * (r + 1.2), '#9fe9ff', 0.16, 0.05);
    }
  }

  lightPulse(x, z, color, intensity, life) {
    const l = this.lights[this.lightCursor];
    this.lightCursor = (this.lightCursor + 1) % this.lights.length;
    l.alive = true; l.life = 0; l.maxLife = life; l.peak = intensity;
    l.l.position.set(x, 2.2, z);
    l.l.color.set(color);
    l.l.intensity = intensity;
  }

  bounce(x, z, color = '#9fe9ff', y = 0.8) {
    this.ring(x, z, { color, r0: 0.15, r1: 1.1, life: 0.35 });
    this.sparkBurst(x, y, z, color, 6, 4, 0.7, 0.4);
    this.flash(x, y, z, color, 1.3, 0.12);
  }

  /**
   * Bullet impact: a bright core flash, a flat ring on the floor, sparks in the
   * shooter's colour and a puff of dust. This is the "I hit something" moment —
   * the old 7-particle spark was too small to read at 20 m.
   */
  impact(x, z, color = '#9fe9ff', opts = {}) {
    const scale = opts.scale || 1;
    this.flash(x, opts.y ?? 0.95, z, color, 2.6 * scale, 0.14);
    this.ring(x, z, { color, r0: 0.18 * scale, r1: 1.35 * scale, life: 0.34, opacity: 0.9 });
    this.sparkBurst(x, opts.y ?? 0.9, z, color, 14, 7.5, 1.05 * scale, 0.42);
    this.sparkBurst(x, opts.y ?? 0.9, z, '#fff6e2', 5, 4.5, 0.7 * scale, 0.2);
    this.smokePuff(x, 0.6, z, 3, '#6c6257', 0.7 * scale, 0.45, 0.5);
    if (opts.bounced) this.flash(x, 1.0, z, '#b7ff9c', 3.4 * scale, 0.18);
  }

  muzzle(x, y, z, color = '#8fe4ff') {
    this.flash(x, y, z, color, 0.7, 0.08);
    this.sparkBurst(x, y, z, color, 3, 3, 0.45, 0.2, { up: 0.4, lift: 0.5, gravity: 2 });
  }

  update(dt) {
    this.sparks.update(dt);
    this.smoke.update(dt);
    this.rings.update(dt);
    this.decals.update(dt);
    for (const d of this.debris) {
      if (!d.alive) continue;
      d.life += dt;
      if (d.life >= d.maxLife) { d.alive = false; d.m.visible = false; continue; }
      d.vy -= 14 * dt;
      d.m.position.x += d.vx * dt;
      d.m.position.y += d.vy * dt;
      d.m.position.z += d.vz * dt;
      if (d.m.position.y < 0.12) { d.m.position.y = 0.12; d.vy *= -0.35; d.vx *= 0.6; d.vz *= 0.6; }
      d.m.rotation.x += d.rx * dt;
      d.m.rotation.y += d.ry * dt;
      d.m.rotation.z += d.rz * dt;
      const k = Math.min(1, (d.maxLife - d.life) / 0.5);
      d.m.scale.setScalar(d.sx * k);
    }
    for (const f of this.flashes) {
      if (!f.alive) continue;
      f.life += dt;
      const t = f.life / f.maxLife;
      if (t >= 1) { f.alive = false; f.s.visible = false; continue; }
      f.s.scale.setScalar(f.size * (0.6 + t * 1.6));
      f.s.material.opacity = (1 - t) * 0.9;
    }
    for (const b of this.beams) {
      if (!b.alive) continue;
      b.life += dt;
      const t = b.life / b.maxLife;
      if (t >= 1) { b.alive = false; b.m.visible = false; continue; }
      b.m.material.opacity = 1 - t;
    }
    for (const l of this.lights) {
      if (!l.alive) continue;
      l.life += dt;
      const t = l.life / l.maxLife;
      if (t >= 1) { l.alive = false; l.l.intensity = 0; continue; }
      l.l.intensity = l.peak * (1 - t) * (1 - t);
    }
  }

  cleanForArena() {
    this.rings.items.forEach((r) => { r.alive = false; r.m.visible = false; });
    this.decals.items.forEach((d) => { d.alive = false; d.m.visible = false; });
    this.parts = null;
  }

  dispose() {
    this.sparks.dispose();
    this.smoke.dispose();
    for (const r of this.rings.items) {
      this.scene.remove(r.m);
      r.m.material.dispose();
      r.m.geometry.dispose();
    }
    for (const d of this.decals.items) {
      this.scene.remove(d.m);
      d.m.material.dispose();
      d.m.geometry.dispose();
    }
    for (const d of this.debris) { this.scene.remove(d.m); }
    for (const f of this.flashes) { this.scene.remove(f.s); f.s.material.dispose(); }
    for (const b of this.beams) { this.scene.remove(b.m); b.m.geometry.dispose(); b.m.material.dispose(); }
    for (const l of this.lights) this.scene.remove(l.l);
  }
}
