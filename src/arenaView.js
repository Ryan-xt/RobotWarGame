import * as THREE from 'three';
import {
  groundTexture, metalTexture, hazardTexture, glowTexture, iconTexture, signTexture,
  scorchTexture, smokeTexture, noiseTexture,
} from './textures.js';

function mat(opts) { return new THREE.MeshStandardMaterial(opts); }

function makeGlowSprite(color, size = 3, opacity = 0.5) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTexture(), color, transparent: true, opacity,
    blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  s.scale.set(size, size, 1);
  return s;
}

function makeIconSprite(kind, color, size = 1.1) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({
    map: iconTexture(kind, color), color: '#ffffff', transparent: true,
    depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  s.scale.set(size, size, 1);
  return s;
}

export class ArenaView {
  constructor(scene, arena, quality = 'high') {
    this.scene = scene;
    this.arena = arena;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.quality = quality;
    this.time = 0;
    this.wallMeshes = new Map();
    this.dynamicPlates = new Map();
    this.pads = arena.pads;
    this.shadowLights = [];
    this.coolers = [];
    this.acids = [];
    this.towers = [];
    this.exhaust = [];
    this.buildEnvironment();
    this.buildFloor();
    this.buildCenter();
    this.buildWalls();
    this.buildPlates();
    this.buildCoolers();
    this.buildAcids();
    this.buildTowers();
    this.buildPads();
    // Decorative meshes (barrels, pipes, floodlight towers) are the first
    // thing to drop when the player needs frames back.
    const baseline = new Set(this.group.children);
    this.buildProps();
    this.decor = this.group.children.filter((c) => !baseline.has(c));
    this.buildBoundary();
    this.buildDust();
  }

  buildEnvironment() {
    const { scene } = this;
    scene.fog = new THREE.FogExp2(new THREE.Color('#3a2a20'), 0.011);
    const hemi = new THREE.HemisphereLight('#a8c6d8', '#3b2b1f', 0.65);
    this.group.add(hemi);
    const sun = new THREE.DirectionalLight('#ffc08a', 2.5);
    sun.position.set(-this.arena.size * 0.7, this.arena.size * 0.95, this.arena.size * 0.5);
    sun.target.position.set(0, 0, 0);
    sun.castShadow = true;
    const sc = Math.max(24, this.arena.size * 1.15);
    sun.shadow.camera.left = -sc;
    sun.shadow.camera.right = sc;
    sun.shadow.camera.top = sc;
    sun.shadow.camera.bottom = -sc;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = this.arena.size * 3.5;
    sun.shadow.mapSize.set(this.quality === 'low' ? 1024 : 2048, this.quality === 'low' ? 1024 : 2048);
    sun.shadow.bias = -0.0006;
    sun.shadow.normalBias = 0.03;
    this.group.add(sun);
    this.group.add(sun.target);
    this.sun = sun;
    const fill = new THREE.DirectionalLight('#5f8fa8', 0.5);
    fill.position.set(this.arena.size * 0.6, 12, -this.arena.size * 0.7);
    this.group.add(fill);

  }

  buildFloor() {
    const size = this.arena.size;
    const gtex = groundTexture();
    const gm = new THREE.MeshStandardMaterial({ map: gtex, color: '#d9c9b2', roughness: 0.95, metalness: 0.14 });
    gm.map = gtex.clone();
    gm.map.needsUpdate = true;
    gm.map.repeat.set(size / 9, size / 9);
    gm.map.colorSpace = THREE.SRGBColorSpace;
    const floor = new THREE.Mesh(new THREE.BoxGeometry(size, 0.5, size), gm);
    floor.position.y = -0.26;
    floor.receiveShadow = true;
    this.group.add(floor);
    this.floorMat = gm;
    this.floor = floor;

    // surrounding wasteland
    const wm = new THREE.MeshStandardMaterial({ map: gm.map.clone(), color: '#6b5943', roughness: 1, metalness: 0.04 });
    wm.map.repeat.set(18, 18);
    wm.map.needsUpdate = true;
    const wasteland = new THREE.Mesh(new THREE.PlaneGeometry(420, 420, 1, 1), wm);
    wasteland.rotation.x = -Math.PI / 2;
    wasteland.position.y = -0.55;
    wasteland.receiveShadow = true;
    this.group.add(wasteland);

    // hazard border paint
    const hz = hazardTexture().clone();
    hz.needsUpdate = true;
    hz.repeat.set(size / 4, 1);
    const borderMat = new THREE.MeshBasicMaterial({ map: hz, transparent: true, opacity: 0.75, color: '#c9a85a' });
    for (const z of [-size / 2 + 0.55, size / 2 - 0.55]) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(size - 1, 0.5), borderMat);
      m.rotation.x = -Math.PI / 2;
      m.position.set(0, 0.005, z);
      this.group.add(m);
    }
    const hz2 = hz.clone(); hz2.repeat.set(size / 4, 1); hz2.needsUpdate = true;
    const borderMat2 = new THREE.MeshBasicMaterial({ map: hz2, transparent: true, opacity: 0.75, color: '#c9a85a' });
    for (const x of [-size / 2 + 0.55, size / 2 - 0.55]) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(size - 1, 0.5), borderMat2);
      m.rotation.x = -Math.PI / 2;
      m.rotation.z = Math.PI / 2;
      m.position.set(x, 0.006, 0);
      this.group.add(m);
    }

    // arena floor grid glow lines
    const lineMat = new THREE.LineBasicMaterial({ color: '#8a7a5a', transparent: true, opacity: 0.14 });
    const pts = [];
    for (let i = -size / 2; i <= size / 2; i += 4) {
      pts.push(new THREE.Vector3(i, 0.012, -size / 2), new THREE.Vector3(i, 0.012, size / 2));
      pts.push(new THREE.Vector3(-size / 2, 0.012, i), new THREE.Vector3(size / 2, 0.012, i));
    }
    this.group.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), lineMat));
  }

  buildCenter() {
    const p = this.arena.platform;
    const metal = new THREE.MeshStandardMaterial({ map: metalTexture(), color: '#8b8b84', roughness: 0.6, metalness: 0.7 });
    const base = new THREE.Mesh(new THREE.CylinderGeometry(p.r, p.r + 0.25, 0.18, 40), metal);
    base.position.y = 0.09;
    base.receiveShadow = true;
    this.group.add(base);
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(p.r - 0.18, p.r - 0.05, 48),
      new THREE.MeshBasicMaterial({ color: '#ffb02e', transparent: true, opacity: 0.55, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.185;
    this.group.add(ring);
    const inner = new THREE.Mesh(
      new THREE.RingGeometry(1.15, 1.3, 32),
      new THREE.MeshBasicMaterial({ color: '#46d9ff', transparent: true, opacity: 0.5, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    inner.rotation.x = -Math.PI / 2;
    inner.position.y = 0.19;
    this.group.add(inner);
    // pedestal for the center purge
    const ped = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.85, 0.55, 8), metal);
    ped.position.y = 0.36;
    ped.castShadow = true; ped.receiveShadow = true;
    this.group.add(ped);
    const pedGlow = makeGlowSprite('#46d9ff', 3.2, 0.35);
    pedGlow.position.set(0, 0.75, 0);
    this.group.add(pedGlow);
    this.centerGlow = pedGlow;
    // hazard spokes
    const hz = hazardTexture().clone(); hz.needsUpdate = true; hz.repeat.set(2, 0.5);
    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 2 + Math.PI / 4;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(p.r * 0.8, 0.38), new THREE.MeshBasicMaterial({ map: hz, transparent: true, opacity: 0.5 }));
      m.rotation.x = -Math.PI / 2; m.rotation.z = -a;
      m.position.set(Math.cos(a) * (p.r * 0.55), 0.19, Math.sin(a) * (p.r * 0.55));
      this.group.add(m);
    }
  }

  buildWalls() {
    const metal = metalTexture();
    const wallMat = new THREE.MeshStandardMaterial({ map: metal, color: '#8a7f70', roughness: 0.66, metalness: 0.6 });
    const hz = hazardTexture();
    for (const w of this.arena.walls) {
      const g = new THREE.Group();
      g.position.set(w.x, 0, w.z);
      const body = new THREE.Mesh(new THREE.BoxGeometry(w.w, 1.15, w.h), wallMat);
      body.position.y = 0.575;
      body.castShadow = true; body.receiveShadow = true;
      g.add(body);
      const cap = new THREE.Mesh(new THREE.BoxGeometry(w.w + 0.12, 0.14, w.h + 0.12), new THREE.MeshStandardMaterial({ color: '#33352f', metalness: 0.8, roughness: 0.4 }));
      cap.position.y = 1.2;
      cap.castShadow = true;
      g.add(cap);
      const stripeMat = new THREE.MeshBasicMaterial({ map: hz.clone(), transparent: true, opacity: 0.8 });
      stripeMat.map.needsUpdate = true;
      stripeMat.map.repeat.set(Math.max(1, Math.round(w.w / 1.5)), 1);
      const stripe = new THREE.Mesh(new THREE.PlaneGeometry(w.w * 0.9, 0.24), stripeMat);
      stripe.position.set(0, 0.4, w.h / 2 + 0.006);
      g.add(stripe);
      const stripe2 = stripe.clone();
      stripe2.position.z = -w.h / 2 - 0.006;
      stripe2.rotation.y = Math.PI;
      g.add(stripe2);
      // rivets / plates
      for (const s of [-1, 1]) {
        const side = new THREE.Mesh(new THREE.BoxGeometry(w.w * 0.2, 0.7, w.h + 0.06), new THREE.MeshStandardMaterial({ map: metal, color: '#6f665b', roughness: 0.7, metalness: 0.6 }));
        side.position.set(s * w.w * 0.35, 0.55, 0);
        g.add(side);
      }
      // crack overlays
      const cracks = [];
      for (let i = 0; i < 2; i++) {
        const cm = new THREE.SpriteMaterial({ map: makeCrackTexture(), transparent: true, opacity: 0.8, depthWrite: false, color: '#1b1512' });
        const cr = new THREE.Sprite(cm);
        cr.scale.set(w.w * 0.5, 0.8, 1);
        cr.position.set((i ? 1 : -1) * w.w * 0.2, 0.6, w.h / 2 + 0.05);
        cr.visible = false;
        g.add(cr);
        cracks.push(cr);
      }
      // rubble
      const rubble = new THREE.Group();
      const rubbleMat = new THREE.MeshStandardMaterial({ map: metal, color: '#5b5147', roughness: 0.9, metalness: 0.4 });
      for (let i = 0; i < 3; i++) {
        const r = new THREE.Mesh(new THREE.BoxGeometry(0.45 + i * 0.2, 0.25 + i * 0.1, 0.5 + i * 0.15), rubbleMat);
        r.position.set((i - 1) * 0.5, 0.15, (i % 2 ? 0.2 : -0.2));
        r.rotation.y = i * 0.7;
        r.castShadow = true;
        rubble.add(r);
      }
      rubble.visible = false;
      g.add(rubble);
      const scorch = new THREE.Mesh(new THREE.PlaneGeometry(w.w + 1.6, w.h + 1.8), new THREE.MeshBasicMaterial({ map: scorchTexture(), transparent: true, opacity: 0.7, depthWrite: false }));
      scorch.rotation.x = -Math.PI / 2;
      scorch.position.y = 0.015;
      scorch.visible = false;
      g.add(scorch);
      this.group.add(g);
      this.wallMeshes.set(w.id, { group: g, body, cap, cracks, rubble, scorch, w, wasAlive: true });
    }
  }

  buildPlates() {
    const metal = new THREE.MeshStandardMaterial({ map: metalTexture(), color: '#9b9488', roughness: 0.5, metalness: 0.75 });
    const rim = new THREE.MeshBasicMaterial({ color: '#46d9ff', transparent: true, opacity: 0.7 });
    for (const p of this.arena.plates) {
      const g = new THREE.Group();
      g.position.set(p.x, 0, p.z);
      const base = new THREE.Mesh(new THREE.CylinderGeometry(p.r * 1.02, p.r * 1.12, 0.16, 24), new THREE.MeshStandardMaterial({ color: '#2b2b27', metalness: 0.6, roughness: 0.7 }));
      base.position.y = 0.08; base.receiveShadow = true;
      g.add(base);
      const drum = new THREE.Mesh(new THREE.CylinderGeometry(p.r * 0.74, p.r * 0.92, 1.05, 8), metal);
      drum.position.y = 0.68; drum.castShadow = true; drum.receiveShadow = true;
      g.add(drum);
      const band = new THREE.Mesh(new THREE.CylinderGeometry(p.r * 0.76, p.r * 0.76, 0.16, 8, 1, true), rim);
      band.position.y = 0.92;
      g.add(band);
      const top = new THREE.Mesh(new THREE.ConeGeometry(p.r * 0.7, 0.32, 8), new THREE.MeshStandardMaterial({ map: metalTexture(), color: '#b8ada0', metalness: 0.8, roughness: 0.4 }));
      top.position.y = 1.35; top.castShadow = true;
      g.add(top);
      const glow = makeGlowSprite('#46d9ff', p.r * 3.4, 0.22);
      glow.position.y = 1.55;
      g.add(glow);
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(p.r * 1.15, p.r * 1.3, 32),
        new THREE.MeshBasicMaterial({ color: '#46d9ff', transparent: true, opacity: 0.45, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false })
      );
      ring.rotation.x = -Math.PI / 2; ring.position.y = 0.02;
      g.add(ring);
      const icon = makeIconSprite('bolt', '#46d9ff', 1.0);
      icon.position.y = 2.0;
      g.add(icon);
      this.group.add(g);
      this.wallPlates = this.wallPlates || [];
      this.wallPlates.push({ g, glow, ring, p });
    }
  }

  buildCoolers() {
    const gridMat = new THREE.MeshStandardMaterial({ color: '#1e2528', metalness: 0.85, roughness: 0.35 });
    for (const c of this.arena.coolers) {
      const g = new THREE.Group();
      g.position.set(c.x, 0, c.z);
      const base = new THREE.Mesh(new THREE.CylinderGeometry(c.r, c.r + 0.1, 0.12, 32), new THREE.MeshStandardMaterial({ color: '#2a3237', metalness: 0.7, roughness: 0.5 }));
      base.position.y = 0.06; base.receiveShadow = true;
      g.add(base);
      for (let i = 1; i <= 3; i++) {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(c.r * (0.35 + i * 0.2), 0.035, 6, 36), gridMat);
        ring.rotation.x = -Math.PI / 2;
        ring.position.y = 0.13;
        g.add(ring);
      }
      for (let i = 0; i < 8; i++) {
        const a = i / 8 * Math.PI * 2;
        const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.02, c.r * 1.6), gridMat);
        spoke.position.y = 0.13;
        spoke.rotation.y = a;
        g.add(spoke);
      }
      const glow = new THREE.Mesh(
        new THREE.CircleGeometry(c.r * 0.96, 32),
        new THREE.MeshBasicMaterial({ color: '#8ce9ff', transparent: true, opacity: 0.14, blending: THREE.AdditiveBlending, depthWrite: false })
      );
      glow.rotation.x = -Math.PI / 2; glow.position.y = 0.14;
      g.add(glow);
      const edge = new THREE.Mesh(
        new THREE.RingGeometry(c.r * 0.98, c.r * 1.06, 40),
        new THREE.MeshBasicMaterial({ color: '#a9f0ff', transparent: true, opacity: 0.55, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false })
      );
      edge.rotation.x = -Math.PI / 2; edge.position.y = 0.15;
      g.add(edge);
      // cold mist particles
      const N = 40;
      const positions = new Float32Array(N * 3);
      for (let i = 0; i < N; i++) {
        const a = Math.random() * Math.PI * 2, rr = Math.random() * c.r * 0.9;
        positions[i * 3] = Math.cos(a) * rr;
        positions[i * 3 + 1] = Math.random() * 1.4;
        positions[i * 3 + 2] = Math.sin(a) * rr;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      const pm = new THREE.PointsMaterial({ map: glowTexture(), color: '#c9f6ff', size: 0.55, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true });
      const mist = new THREE.Points(geo, pm);
      mist.position.y = 0.2;
      g.add(mist);
      const icon = makeIconSprite('coolant', '#c9f6ff', 1.3);
      icon.position.y = 0.9;
      g.add(icon);
      const light = new THREE.PointLight('#8ce9ff', 0.6, c.r * 3.2, 2);
      light.position.y = 1.2;
      g.add(light);
      this.group.add(g);
      this.coolers.push({ g, mist, glow, edge, icon, c });
    }
  }

  buildAcids() {
    const bubbleTex = makeBubbleTexture();
    for (const a of this.arena.acids) {
      const g = new THREE.Group();
      g.position.set(a.x, 0, a.z);
      const rim = new THREE.Mesh(
        new THREE.CylinderGeometry(a.r + 0.18, a.r + 0.28, 0.28, 32),
        new THREE.MeshStandardMaterial({ color: '#2f2a21', metalness: 0.5, roughness: 0.8 })
      );
      rim.position.y = 0.1; rim.receiveShadow = true;
      g.add(rim);
      const liquid = new THREE.Mesh(
        new THREE.CircleGeometry(a.r, 40),
        new THREE.MeshBasicMaterial({ color: '#9be63c', transparent: true, opacity: 0.85, map: bubbleTex })
      );
      liquid.rotation.x = -Math.PI / 2;
      liquid.position.y = 0.24;
      g.add(liquid);
      const glow = new THREE.Mesh(
        new THREE.CircleGeometry(a.r * 1.1, 40),
        new THREE.MeshBasicMaterial({ color: '#6bff33', transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false })
      );
      glow.rotation.x = -Math.PI / 2; glow.position.y = 0.22;
      g.add(glow);
      const edge = new THREE.Mesh(
        new THREE.RingGeometry(a.r * 0.98, a.r * 1.05, 48),
        new THREE.MeshBasicMaterial({ color: '#d3ff5a', transparent: true, opacity: 0.6, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false })
      );
      edge.rotation.x = -Math.PI / 2; edge.position.y = 0.27;
      g.add(edge);
      const icon = makeIconSprite('hazard', '#d3ff5a', 1.3);
      icon.position.y = 0.9;
      g.add(icon);
      this.group.add(g);
      this.acids.push({ g, liquid, glow, edge, icon, a, texture: bubbleTex.clone() });
      this.acids[this.acids.length - 1].liquid.material.map = this.acids[this.acids.length - 1].texture;
      this.acids[this.acids.length - 1].liquid.material.map.needsUpdate = true;
    }
  }

  buildTowers() {
    const metal = new THREE.MeshStandardMaterial({ map: metalTexture(), color: '#7f7a70', roughness: 0.55, metalness: 0.75 });
    for (const t of this.arena.towers) {
      const g = new THREE.Group();
      g.position.set(t.x, 0, t.z);
      const base = new THREE.Mesh(new THREE.CylinderGeometry(t.r * 1.3, t.r * 1.6, 0.5, 8), metal);
      base.position.y = 0.25; base.castShadow = true; base.receiveShadow = true;
      g.add(base);
      const legGeo = new THREE.BoxGeometry(0.14, 4.2, 0.14);
      for (let i = 0; i < 4; i++) {
        const a = i / 4 * Math.PI * 2 + Math.PI / 4;
        const leg = new THREE.Mesh(legGeo, metal);
        leg.position.set(Math.cos(a) * 0.62, 2.3, Math.sin(a) * 0.62);
        leg.rotation.z = -Math.cos(a) * 0.12;
        leg.rotation.x = Math.sin(a) * 0.12;
        leg.castShadow = true;
        g.add(leg);
      }
      for (let i = 0; i < 3; i++) {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.7 - i * 0.1, 0.07, 6, 12), metal);
        ring.rotation.x = Math.PI / 2;
        ring.position.y = 1 + i * 0.6;
        g.add(ring);
      }
      const coil = new THREE.Group();
      coil.position.y = 3.35;
      for (let i = 0; i < 4; i++) {
        const c = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.085, 6, 16), new THREE.MeshStandardMaterial({ color: '#3d5a66', metalness: 0.8, roughness: 0.35 }));
        c.rotation.x = Math.PI / 2;
        c.position.y = i * 0.24;
        coil.add(c);
      }
      g.add(coil);
      const orb = new THREE.Mesh(new THREE.SphereGeometry(0.24, 12, 8), new THREE.MeshBasicMaterial({ color: '#6fe3ff' }));
      orb.position.y = 4.35;
      g.add(orb);
      const orbGlow = makeGlowSprite('#6fe3ff', 2.8, 0.55);
      orbGlow.position.y = 4.35;
      g.add(orbGlow);
      const zapRing = new THREE.Mesh(
        new THREE.RingGeometry(t.zapR - 0.12, t.zapR, 48),
        new THREE.MeshBasicMaterial({ color: '#d6f8ff', transparent: true, opacity: 0, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false })
      );
      zapRing.rotation.x = -Math.PI / 2;
      zapRing.position.y = 0.055;
      g.add(zapRing);
      const light = new THREE.PointLight('#6fe3ff', 1.0, 8, 2);
      light.position.y = 4.1;
      g.add(light);
      const icon = makeIconSprite('bolt', '#a9efff', 1.1);
      icon.position.y = 5.3;
      g.add(icon);
      this.group.add(g);
      this.towers.push({ g, orb, orbGlow, zapRing, light, icon, t, coil });
    }
  }

  buildPads() {
    this.padMeshes = [];
    for (const p of this.arena.pads) {
      const g = new THREE.Group();
      g.position.set(p.x, 0, p.z);
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.75, 0.95, 24),
        new THREE.MeshBasicMaterial({ color: p.center ? '#ff5bc8' : '#ffb02e', transparent: true, opacity: 0.32, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false })
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.035;
      g.add(ring);
      const cross = new THREE.Group();
      for (let i = 0; i < 4; i++) {
        const bar = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 0.34), new THREE.MeshBasicMaterial({ color: p.center ? '#ff5bc8' : '#ffb02e', transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false }));
        bar.rotation.x = -Math.PI / 2;
        bar.position.set(Math.cos(i * Math.PI / 2) * 0.5, 0.035, Math.sin(i * Math.PI / 2) * 0.5);
        bar.rotation.z = -i * Math.PI / 2;
        cross.add(bar);
      }
      g.add(cross);
      this.group.add(g);
      this.padMeshes.push({ g, ring, center: p.center, x: p.x, z: p.z });
    }
  }

  buildProps() {
    const metal = new THREE.MeshStandardMaterial({ map: metalTexture(), color: '#7d7265', roughness: 0.7, metalness: 0.55 });
    const rust = new THREE.MeshStandardMaterial({ color: '#7a4327', roughness: 0.9, metalness: 0.25 });
    const dark = new THREE.MeshStandardMaterial({ color: '#2a2d2e', roughness: 0.75, metalness: 0.5 });
    const barrelGeo = new THREE.CylinderGeometry(0.36, 0.4, 0.95, 10);
    const crateGeo = new THREE.BoxGeometry(0.8, 0.8, 0.8);
    const pipeGeo = new THREE.CylinderGeometry(0.18, 0.18, 2.4, 8);

    for (const prop of this.arena.props) {
      const g = new THREE.Group();
      g.position.set(prop.x, 0, prop.z);
      g.rotation.y = prop.rot;
      if (prop.kind === 'barrel') {
        const m = new THREE.Mesh(barrelGeo, Math.random() < 0.5 ? metal : rust);
        m.position.y = 0.47 * prop.s;
        m.scale.setScalar(prop.s);
        m.castShadow = true; m.receiveShadow = true;
        g.add(m);
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.39 * prop.s, 0.035, 5, 12), dark);
        ring.rotation.x = Math.PI / 2; ring.position.y = 0.6 * prop.s;
        g.add(ring);
      } else if (prop.kind === 'pipe') {
        const m = new THREE.Mesh(pipeGeo, metal);
        m.rotation.z = Math.PI / 2;
        m.position.y = 0.18 * prop.s;
        m.scale.setScalar(prop.s);
        m.castShadow = true;
        g.add(m);
        const m2 = m.clone(); m2.position.y = 0.42 * prop.s; g.add(m2);
      } else if (prop.kind === 'tank') {
        const m = new THREE.Mesh(new THREE.CylinderGeometry(0.65, 0.65, 1.5, 12), rust);
        m.position.y = 0.75 * prop.s;
        m.scale.setScalar(prop.s);
        m.castShadow = true;
        g.add(m);
        const cap = new THREE.Mesh(new THREE.SphereGeometry(0.65, 12, 8), metal);
        cap.scale.set(prop.s, 0.5 * prop.s, prop.s);
        cap.position.y = 1.5 * prop.s;
        cap.castShadow = true;
        g.add(cap);
      } else {
        for (let i = 0; i < 2; i++) {
          const m = new THREE.Mesh(crateGeo, i ? rust : metal);
          m.position.set(i * 0.5 - 0.25, 0.4 * prop.s, i * 0.3);
          m.rotation.y = i * 0.4;
          m.scale.setScalar(prop.s * (1 - i * 0.15));
          m.castShadow = true; m.receiveShadow = true;
          g.add(m);
        }
      }
      this.group.add(g);
    }

    // floodlight towers around the arena rim
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    for (let ci = 0; ci < corners.length; ci++) {
      const [sx, sz] = corners[ci];
      const g = new THREE.Group();
      g.position.set(sx * (this.arena.half + 3.4), 0, sz * (this.arena.half + 3.4));
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.22, 7.5, 8), dark);
      mast.position.y = 3.75; mast.castShadow = true;
      g.add(mast);
      const cross = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.16, 0.16), dark);
      cross.position.y = 7.3; g.add(cross);
      for (const off of [-0.8, 0.8]) {
        const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.46, 0.3), new THREE.MeshStandardMaterial({ color: '#2c2f2d', emissive: '#ffbb6a', emissiveIntensity: 1.2 }));
        lamp.position.set(off, 7.3, 0.2);
        g.add(lamp);
        const glow = makeGlowSprite('#ffcf8a', 2.8, 0.65);
        glow.position.set(off, 7.3, 0.35);
        g.add(glow);
      }
      // fake light cone
      const cone = new THREE.Mesh(
        new THREE.ConeGeometry(3.2, 8.5, 16, 1, true),
        new THREE.MeshBasicMaterial({ color: '#ffd9a0', transparent: true, opacity: 0.045, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false })
      );
      cone.position.set(0, 3.2, 0);
      cone.rotation.z = Math.PI;
      g.add(cone);
      const light = new THREE.PointLight('#ffbd80', 0.7, 18, 2);
      light.position.set(0, 7, 0);
      g.add(light);
      this.group.add(g);
    }

    // distant wasteland silhouettes
    const far = new THREE.Group();
    for (let i = 0; i < 26; i++) {
      const a = (i / 26) * Math.PI * 2 + Math.random() * 0.15;
      const r = 55 + Math.random() * 55;
      const h = 8 + Math.random() * 28;
      const w = 3 + Math.random() * 9;
      const m = new THREE.Mesh(
        new THREE.BoxGeometry(w, h, w),
        new THREE.MeshStandardMaterial({ color: '#241d18', roughness: 1, metalness: 0.1 })
      );
      m.position.set(Math.cos(a) * r, h / 2 - 1, Math.sin(a) * r);
      m.rotation.y = Math.random() * 3;
      far.add(m);
      if (i % 4 === 0) {
        const stack = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 2.2, h * 1.3, 8), new THREE.MeshStandardMaterial({ color: '#1c1713', roughness: 1 }));
        stack.position.set(Math.cos(a + 0.12) * (r + 8), h * 0.6, Math.sin(a + 0.12) * (r + 8));
        far.add(stack);
        const glow = makeGlowSprite('#ff7b33', 5, 0.14);
        glow.position.set(Math.cos(a) * r, h * 0.4, Math.sin(a) * r);
        far.add(glow);
      }
    }
    this.group.add(far);
    this.far = far;

    // giant billboard
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(7, 3.5), new THREE.MeshBasicMaterial({ map: signTexture('WASTE 07', '废土竞技场 · 直播中', '#e0a93b'), side: THREE.DoubleSide }));
    sign.position.set(-this.arena.half - 10, 4.6, this.arena.half + 2);
    sign.rotation.y = Math.PI / 4;
    this.group.add(sign);
    const signLight = makeGlowSprite('#ffb02e', 8, 0.16);
    signLight.position.copy(sign.position); signLight.position.y += 1;
    this.group.add(signLight);

    // exhaust smoke plumes for atmosphere
    for (const prop of this.arena.props.slice(0, 4)) {
      this.exhaust.push({ x: prop.x, z: prop.z, t: Math.random() * 10 });
    }
  }

  buildBoundary() {
    const size = this.arena.size;
    const half = size / 2;
    const metal = new THREE.MeshStandardMaterial({ map: metalTexture(), color: '#6c6256', roughness: 0.75, metalness: 0.5 });
    const hz = hazardTexture();
    const postMat = new THREE.MeshStandardMaterial({ color: '#2f2e2a', metalness: 0.7, roughness: 0.6 });
    const seg = 4;
    const n = Math.ceil(size / seg);
    for (let side = 0; side < 4; side++) {
      for (let i = 0; i < n; i++) {
        if (Math.random() < 0.06) continue; // broken sections
        const along = -half + seg * i + seg / 2;
        const off = half + 0.18;
        let x, z, rot;
        if (side === 0) { x = along; z = -off; rot = 0; }
        else if (side === 1) { x = along; z = off; rot = Math.PI; }
        else if (side === 2) { x = -off; z = along; rot = Math.PI / 2; }
        else { x = off; z = along; rot = -Math.PI / 2; }
        const g = new THREE.Group();
        g.position.set(x, 0, z);
        g.rotation.y = rot;
        const wall = new THREE.Mesh(new THREE.BoxGeometry(seg * 0.98, 1.5, 0.3), metal);
        wall.position.y = 0.75;
        wall.castShadow = true; wall.receiveShadow = true;
        g.add(wall);
        const stripeMat = new THREE.MeshBasicMaterial({ map: hz.clone(), transparent: true, opacity: 0.65 });
        stripeMat.map.needsUpdate = true;
        stripeMat.map.repeat.set(3, 1);
        const stripe = new THREE.Mesh(new THREE.PlaneGeometry(seg * 0.9, 0.34), stripeMat);
        stripe.position.set(0, 0.45, 0.16);
        g.add(stripe);
        // posts
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.22, 1.9, 0.5), postMat);
        post.position.set(seg / 2, 0.95, 0);
        post.castShadow = true;
        g.add(post);
        if (i % 3 === 0) {
          const light = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), new THREE.MeshBasicMaterial({ color: '#ffb85c' }));
          light.position.set(seg / 2, 1.95, 0);
          g.add(light);
          const gl = makeGlowSprite('#ffb85c', 1.4, 0.4);
          gl.position.copy(light.position);
          g.add(gl);
        }
        this.group.add(g);
      }
    }
    // broadcast speakers on posts
    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 2 + Math.PI / 4;
      const g = new THREE.Group();
      g.position.set(Math.cos(a) * (half + 1.4), 0, Math.sin(a) * (half + 1.4));
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 4.6, 6), postMat);
      pole.position.y = 2.3; g.add(pole);
      for (const y of [4.1, 3.5]) {
        const speaker = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.22, 0.46, 8), new THREE.MeshStandardMaterial({ color: '#3a352c', metalness: 0.6, roughness: 0.6 }));
        speaker.rotation.z = Math.PI / 2;
        speaker.position.set(0, y, 0);
        g.add(speaker);
      }
      this.group.add(g);
    }
  }

  buildDust() {
    const N = 260;
    const pos = new Float32Array(N * 3);
    const speeds = [];
    for (let i = 0; i < N; i++) {
      pos[i * 3] = (Math.random() - 0.5) * this.arena.size * 1.8;
      pos[i * 3 + 1] = Math.random() * 6;
      pos[i * 3 + 2] = (Math.random() - 0.5) * this.arena.size * 1.8;
      speeds.push(0.4 + Math.random() * 0.8);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({
      map: glowTexture(), color: '#d8b98a', size: 0.09, transparent: true, opacity: 0.5,
      blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
    });
    this.dust = new THREE.Points(geo, mat);
    this.dust.userData.speeds = speeds;
    this.group.add(this.dust);
  }

  update(dt, time, snapshot) {
    this.time = time;
    // ambient animation
    for (const c of this.coolers) {
      const arr = c.mist.geometry.attributes.position.array;
      const N = arr.length / 3;
      for (let i = 0; i < N; i++) {
        arr[i * 3 + 1] += dt * (0.4 + (i % 5) * 0.08);
        if (arr[i * 3 + 1] > 1.7) arr[i * 3 + 1] = 0.05;
      }
      c.mist.geometry.attributes.position.needsUpdate = true;
      c.mist.material.opacity = 0.22 + Math.sin(time * 1.8 + c.c.x) * 0.08;
      c.edge.material.opacity = 0.4 + Math.sin(time * 2 + c.c.z) * 0.15;
      c.icon.position.y = 0.8 + Math.sin(time * 1.4) * 0.08;
    }
    for (const a of this.acids) {
      a.texture.offset.x += dt * 0.012;
      a.texture.offset.y += dt * 0.018;
      a.glow.material.opacity = 0.1 + Math.sin(time * 2.4 + a.a.x) * 0.04;
      a.edge.material.opacity = 0.45 + Math.sin(time * 3 + a.a.z) * 0.15;
      a.icon.position.y = 0.85 + Math.sin(time * 1.7 + a.a.x) * 0.07;
    }
    if (this.dust) {
      const arr = this.dust.geometry.attributes.position.array;
      const sp = this.dust.userData.speeds;
      for (let i = 0; i < sp.length; i++) {
        arr[i * 3] += dt * sp[i] * 0.8;
        arr[i * 3 + 1] += Math.sin(time + i) * dt * 0.1;
        arr[i * 3 + 2] += dt * sp[i] * 0.3;
        if (arr[i * 3] > this.arena.half * 0.95) arr[i * 3] = -this.arena.half * 0.95;
        if (arr[i * 3 + 2] > this.arena.half * 0.95) arr[i * 3 + 2] = -this.arena.half * 0.95;
      }
      this.dust.geometry.attributes.position.needsUpdate = true;
    }
    if (this.centerGlow) this.centerGlow.material.opacity = 0.25 + Math.sin(time * 2.2) * 0.12;
  }

  updateWalls(walls) {
    for (const info of walls) {
      const m = this.wallMeshes.get(info.id);
      if (!m) continue;
      const alive = !!info.alive;
      if (alive) {
        m.group.visible = true;
        m.body.visible = true;
        m.cap.visible = true;
        m.rubble.visible = false;
        m.scorch.visible = false;
        const dmg = info.hp / (m.w.maxHp || 3);
        for (let i = 0; i < m.cracks.length; i++) m.cracks[i].visible = dmg <= (i === 0 ? 0.7 : 0.4);
        if (info.hp < m.w.hp) m.w.hp = info.hp;
      } else {
        m.group.visible = true;
        m.body.visible = false;
        m.cap.visible = false;
        m.rubble.visible = true;
        m.scorch.visible = true;
        m.cracks.forEach((c) => c.visible = false);
      }
    }
  }

  updateTowers(towers) {
    for (const info of towers) {
      const tv = this.towers.find((x) => x.t.id === info.id);
      if (!tv) continue;
      const ch = info.charge || 0;
      tv.orb.material.color.setHSL(0.52, 1, 0.55 + ch * 0.35);
      tv.orb.scale.setScalar(1 + ch * 0.7);
      tv.orbGlow.material.opacity = 0.3 + ch * 0.6;
      tv.orbGlow.scale.setScalar(2.8 + ch * 2);
      tv.light.intensity = 0.6 + ch * 2.5;
      tv.zapRing.material.opacity = ch * 0.5;
      tv.icon.material.opacity = 0.5 + ch * 0.5;
      tv.coil.rotation.y += 0.02 + ch * 0.24;
    }
  }

  updateDynamicPlates(plates, time) {
    const seen = new Set();
    for (const p of plates) {
      seen.add(p.id);
      let mesh = this.dynamicPlates.get(p.id);
      if (!mesh) {
        const g = new THREE.Group();
        g.position.set(p.x, 0, p.z);
        g.rotation.y = -((p.angle || 0) + Math.PI / 2);
        const body = new THREE.Mesh(
          new THREE.BoxGeometry(2.3, 1.1, 0.22),
          new THREE.MeshStandardMaterial({ map: metalTexture(), color: '#97a3aa', roughness: 0.5, metalness: 0.8 })
        );
        body.position.y = 0.62;
        body.castShadow = true; body.receiveShadow = true;
        g.add(body);
        const rim = new THREE.Mesh(new THREE.BoxGeometry(2.34, 0.08, 0.26), new THREE.MeshBasicMaterial({ color: '#5ad8ff' }));
        rim.position.y = 1.18;
        g.add(rim);
        const glow = makeGlowSprite('#5ad8ff', 3, 0.3);
        glow.position.y = 0.9;
        g.add(glow);
        this.group.add(g);
        mesh = { g, body, glow };
        this.dynamicPlates.set(p.id, mesh);
      }
      mesh.body.material.color.setRGB(0.6 - p.hp * 0.1, 0.65 - p.hp * 0.1, 0.7);
      mesh.glow.material.opacity = 0.2 + p.ttl / 6 * 0.25;
      mesh.g.visible = true;
    }
    for (const [id, mesh] of this.dynamicPlates) {
      if (!seen.has(id)) {
        this.group.remove(mesh.g);
        mesh.g.traverse((o) => { if (o.isMesh) { o.geometry?.dispose?.(); } });
        this.dynamicPlates.delete(id);
      }
    }
  }

  setQuality(q) {
    this.quality = q;
    // ambient dust and rim props are pure decoration: skip them on low
    if (this.dust) this.dust.visible = q !== 'low';
    if (this.centerGlow) this.centerGlow.visible = q !== 'low';
    for (const g of this.decor || []) g.visible = q !== 'low';
    if (!this.sun) return;
    const size = q === 'high' ? 1024 : q === 'med' ? 512 : 512;
    this.sun.castShadow = q !== 'low';
    if (this.sun.shadow.mapSize.x !== size) {
      this.sun.shadow.mapSize.set(size, size);
      if (this.sun.shadow.map) { this.sun.shadow.map.dispose(); this.sun.shadow.map = null; }
    }
  }

  dispose() {
    this.scene.remove(this.group);
    this.group.traverse((o) => {
      if (o.isMesh || o.isPoints || o.isLine) {
        if (o.isPoints) o.geometry?.dispose?.();
        else if (o.geometry) o.geometry.dispose?.();
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) m?.dispose?.();
      } else if (o.isSprite) {
        o.material?.dispose?.();
      }
    });
  }
}

function makeCrackTexture() {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 256;
  const g = c.getContext('2d');
  g.clearRect(0, 0, 256, 256);
  g.strokeStyle = '#0d0a08';
  g.lineCap = 'round';
  for (let n = 0; n < 6; n++) {
    g.beginPath();
    let x = 128 + (Math.random() - 0.5) * 40, y = 128 + (Math.random() - 0.5) * 40;
    g.moveTo(x, y);
    g.lineWidth = 3 + Math.random() * 5;
    for (let i = 0; i < 5; i++) {
      x += (Math.random() - 0.5) * 80; y += (Math.random() - 0.5) * 80;
      g.lineTo(x, y);
    }
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function makeBubbleTexture() {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 512;
  const g = c.getContext('2d');
  g.clearRect(0, 0, 512, 512);
  for (let i = 0; i < 90; i++) {
    const x = Math.random() * 512, y = Math.random() * 512, r = 2 + Math.random() * 18;
    g.strokeStyle = `rgba(210,255,120,${0.1 + Math.random() * 0.5})`;
    g.lineWidth = 1 + Math.random() * 3;
    g.beginPath(); g.arc(x, y, r, 0, 7); g.stroke();
    g.fillStyle = `rgba(170,255,60,${0.05 + Math.random() * 0.2})`;
    g.beginPath(); g.arc(x - r * 0.2, y - r * 0.2, r * 0.5, 0, 7); g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
