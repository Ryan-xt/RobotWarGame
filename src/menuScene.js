import * as THREE from 'three';
import { createMech, updateMech, disposeMech } from './mech.js';
import { metalTexture, hazardTexture, signTexture, glowTexture, groundTexture } from './textures.js';
import { MECH_LIST, mechOf } from '../shared/mechs.js';

export class MenuScene {
  constructor(stage) {
    this.stage = stage;
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2('#171310', 0.026);
    this.camera = new THREE.PerspectiveCamera(38, window.innerWidth / window.innerHeight, 0.1, 200);
    this.camera.position.set(0, 3.1, 8.4);
    this.camera.lookAt(0, 1.25, 0);
    this.time = 0;
    this.hero = null;
    this.heroId = null;
    this.color = '#ff8a3d';
    this.sideMechs = [];
    this.dust = null;
    this.rotation = 0;
    this.build();
  }

  build() {
    const s = this.scene;
    s.background = new THREE.Color('#0c0b0a');
    const hemi = new THREE.HemisphereLight('#6e8d9c', '#33251b', 0.55);
    s.add(hemi);
    const key = new THREE.SpotLight('#ffb877', 60, 26, 0.5, 0.5, 1.6);
    key.position.set(-4, 10, 5);
    key.target.position.set(0, 0.9, 0);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.bias = -0.0005;
    s.add(key); s.add(key.target);
    const rim = new THREE.SpotLight('#5ad8ff', 40, 26, 0.6, 0.6, 1.5);
    rim.position.set(5.5, 7.5, -3);
    rim.target.position.set(0, 1, 0);
    s.add(rim); s.add(rim.target);
    const front = new THREE.DirectionalLight('#ffd9b0', 0.35);
    front.position.set(0, 4, 8);
    s.add(front);
    this.key = key;
    this.rim = rim;

    // floor
    const floorTex = groundTexture().clone();
    floorTex.repeat.set(6, 6); floorTex.needsUpdate = true;
    const floorMat = new THREE.MeshStandardMaterial({ map: floorTex, color: '#6d5e4d', roughness: 0.85, metalness: 0.25 });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.02;
    floor.receiveShadow = true;
    s.add(floor);

    // turntable
    const discMat = new THREE.MeshStandardMaterial({ map: metalTexture(), color: '#7b7368', roughness: 0.5, metalness: 0.75 });
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(2.5, 2.7, 0.22, 40), discMat);
    disc.position.y = 0.11;
    disc.receiveShadow = true; disc.castShadow = true;
    s.add(disc);
    const rimRing = new THREE.Mesh(new THREE.RingGeometry(2.35, 2.5, 48), new THREE.MeshBasicMaterial({ color: '#ffb02e', transparent: true, opacity: 0.6, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }));
    rimRing.rotation.x = -Math.PI / 2; rimRing.position.y = 0.23;
    s.add(rimRing);
    const hz = hazardTexture().clone(); hz.repeat.set(8, 1); hz.needsUpdate = true;
    const stripes = new THREE.Mesh(new THREE.PlaneGeometry(14, 0.5), new THREE.MeshBasicMaterial({ map: hz, transparent: true, opacity: 0.45 }));
    stripes.rotation.x = -Math.PI / 2; stripes.position.set(0, 0.01, 3.6);
    s.add(stripes);
    this.disc = disc;
    this.rimRing = rimRing;

    // back wall
    const wallMat = new THREE.MeshStandardMaterial({ map: metalTexture(), color: '#4a4741', roughness: 0.8, metalness: 0.5 });
    const wall = new THREE.Mesh(new THREE.BoxGeometry(30, 14, 1), wallMat);
    wall.position.set(0, 7, -10.5);
    wall.receiveShadow = true;
    s.add(wall);
    for (let i = 0; i < 5; i++) {
      const col = new THREE.Mesh(new THREE.BoxGeometry(0.8, 14, 0.8), new THREE.MeshStandardMaterial({ color: '#33302b', metalness: 0.7, roughness: 0.5 }));
      col.position.set(-10 + i * 5, 7, -9.8);
      s.add(col);
    }
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(16, 8), new THREE.MeshBasicMaterial({ map: signTexture('OVERLOAD', '废土竞技场 · 直播信号 07', '#ffb02e') }));
    sign.position.set(0, 5.2, -9.85);
    s.add(sign);
    const signGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: '#ff8f2e', transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false }));
    signGlow.scale.set(24, 14, 1);
    signGlow.position.set(0, 5, -9.5);
    s.add(signGlow);

    // gantry + hanging lamps
    const beamMat = new THREE.MeshStandardMaterial({ color: '#2d2a25', metalness: 0.8, roughness: 0.4 });
    for (const y of [7.2, 8.4]) {
      const beam = new THREE.Mesh(new THREE.BoxGeometry(24, 0.35, 0.35), beamMat);
      beam.position.set(0, y, -3.4);
      s.add(beam);
    }
    for (const x of [-8, -4, 0, 4, 8]) {
      const hang = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 2.4, 5), beamMat);
      hang.position.set(x, 6, -3.4);
      s.add(hang);
      const lamp = new THREE.Mesh(new THREE.ConeGeometry(0.45, 0.5, 10, 1, true), new THREE.MeshStandardMaterial({ color: '#24211d', metalness: 0.7, roughness: 0.5, side: THREE.DoubleSide }));
      lamp.position.set(x, 4.75, -3.4);
      s.add(lamp);
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), new THREE.MeshBasicMaterial({ color: x === 0 ? '#5ad8ff' : '#ffb15c' }));
      bulb.position.set(x, 4.55, -3.4);
      s.add(bulb);
      const gl = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: x === 0 ? '#5ad8ff' : '#ffb15c', transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false }));
      gl.scale.set(1.6, 1.6, 1); gl.position.copy(bulb.position);
      s.add(gl);
    }

    // side pods for the next/previous mech silhouettes
    for (const side of [-1, 1]) {
      const pod = new THREE.Group();
      pod.position.set(side * 4.6, 0, -2.4);
      const base = new THREE.Mesh(new THREE.CylinderGeometry(1.35, 1.5, 0.16, 24), discMat);
      base.position.y = 0.08; base.receiveShadow = true;
      pod.add(base);
      const ember = new THREE.PointLight(side < 0 ? '#ff8a3d' : '#46d9ff', 1.2, 6, 2);
      ember.position.y = 1.2;
      pod.add(ember);
      s.add(pod);
      this.sideMechs.push({ pod, side, mech: null, id: null });
    }

    // background props: crates, pipes
    const crateMat = new THREE.MeshStandardMaterial({ map: metalTexture(), color: '#5a4d3c', roughness: 0.8, metalness: 0.3 });
    for (let i = 0; i < 14; i++) {
      const a = -Math.PI * 0.85 + (i / 13) * Math.PI * 0.7;
      const r = 7 + Math.random() * 5;
      const crate = new THREE.Mesh(new THREE.BoxGeometry(0.8 + Math.random(), 0.8 + Math.random(), 0.8 + Math.random()), crateMat);
      crate.position.set(Math.cos(a) * r, 0.4, Math.sin(a) * r - 1);
      crate.rotation.y = Math.random() * 3;
      crate.castShadow = true;
      s.add(crate);
    }
    for (const side of [-1, 1]) {
      for (let i = 0; i < 3; i++) {
        const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 10, 8), new THREE.MeshStandardMaterial({ color: '#4b4034', metalness: 0.7, roughness: 0.5 }));
        pipe.rotation.z = Math.PI / 2;
        pipe.position.set(side * 9, 2.2 + i * 0.5, -5.5 - i * 0.3);
        s.add(pipe);
      }
    }

    // dust / embers
    const N = 220;
    const pos = new Float32Array(N * 3);
    const speeds = [];
    for (let i = 0; i < N; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 26;
      pos[i * 3 + 1] = Math.random() * 8;
      pos[i * 3 + 2] = -8 + Math.random() * 12;
      speeds.push({ y: 0.1 + Math.random() * 0.4, x: (Math.random() - 0.5) * 0.2, p: Math.random() * 6.28 });
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({ map: glowTexture(), color: '#ffb26a', size: 0.07, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false });
    this.dust = new THREE.Points(geo, mat);
    this.dust.userData.speeds = speeds;
    s.add(this.dust);

    this.setMech(MECH_LIST[0].id, this.color);
  }

  setMech(mechId, color) {
    this.color = color || this.color;
    if (this.heroId === mechId && this.hero && this.heroColor === this.color) return;
    this.heroColor = this.color;
    if (this.hero) {
      this.scene.remove(this.hero.group);
      disposeMech(this.hero);
      this.hero = null;
    }
    this.heroId = mechId;
    this.hero = createMech(mechId, this.color, '', { menu: true });
    this.hero.group.scale.setScalar(1.55);
    this.hero.group.position.set(0, 0.22, 0);
    this.hero.baseY = 0.22;
    this.hero.group.rotation.y = -0.5;
    this.scene.add(this.hero.group);
    const mech = mechOf(mechId);
    this.key.color.set(mech.accent);
    this.rim.color.set(mech.hull);

    // update side silhouette mechs
    const idx = MECH_LIST.findIndex((m) => m.id === mechId);
    for (let si = 0; si < this.sideMechs.length; si++) {
      const sm = this.sideMechs[si];
      const other = MECH_LIST[(idx + (si === 0 ? -1 : 1) + MECH_LIST.length) % MECH_LIST.length];
      if (sm.mech) { this.scene.remove(sm.mech.group); disposeMech(sm.mech); }
      const m = createMech(other.id, '#3c4145', '', { menu: true });
      m.group.scale.setScalar(1.15);
      m.group.position.y = 0.1;
      m.group.rotation.y = sm.side * 0.5 + Math.PI * 0.05;
      m.group.traverse((o) => { if (o.isMesh) { o.castShadow = false; } });
      // darken side mechs
      sm.pod.add(m.group);
      sm.mech = m;
      sm.id = other.id;
    }
  }

  update(dt) {
    this.time += dt;
    const t = this.time;
    if (this.hero) {
      updateMech(this.hero, { speed: 0, heat: 22 + Math.sin(t * 0.7) * 12, time: t, alive: true, shield: 0, showName: false }, dt);
      this.hero.group.rotation.y += dt * 0.16;
    }
    for (const sm of this.sideMechs) {
      if (sm.mech) updateMech(sm.mech, { speed: 0, heat: 8, time: t + sm.side, alive: true, shield: 0, showName: false }, dt);
    }
    // camera drift
    const sway = Math.sin(t * 0.16) * 0.35;
    this.camera.position.x = sway;
    this.camera.position.y = 3.15 + Math.sin(t * 0.22) * 0.06;
    this.camera.position.z = 8.5;
    this.camera.lookAt(sway * 0.4, 1.3, 0);
    if (this.rimRing) {
      this.rimRing.material.opacity = 0.4 + Math.sin(t * 2) * 0.18;
      this.disc.rotation.y += dt * 0.03;
    }
    if (this.dust) {
      const arr = this.dust.geometry.attributes.position.array;
      const sp = this.dust.userData.speeds;
      for (let i = 0; i < sp.length; i++) {
        arr[i * 3 + 1] += dt * sp[i].y;
        arr[i * 3] += Math.sin(t + sp[i].p) * dt * 0.12;
        if (arr[i * 3 + 1] > 8.5) { arr[i * 3 + 1] = 0.2; arr[i * 3] = (Math.random() - 0.5) * 26; }
      }
      this.dust.geometry.attributes.position.needsUpdate = true;
    }
    this.stage.setActive(this.scene, this.camera);
  }

  dispose() {
    if (this.hero) { this.scene.remove(this.hero.group); disposeMech(this.hero); this.hero = null; }
    for (const sm of this.sideMechs) if (sm.mech) { sm.pod.remove(sm.mech.group); disposeMech(sm.mech); sm.mech = null; }
    this.scene.traverse((o) => {
      if (o.isMesh || o.isPoints) {
        o.geometry?.dispose?.();
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) m?.dispose?.();
      } else if (o.isSprite) {
        o.material?.dispose?.();
      }
    });
  }
}
