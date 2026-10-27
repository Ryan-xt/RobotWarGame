import * as THREE from 'three';
import { mechOf } from '../shared/mechs.js';
import { glowTexture, hazardTexture, nameTexture } from './textures.js';

const GEO = {
  box: new THREE.BoxGeometry(1, 1, 1),
  cyl8: new THREE.CylinderGeometry(1, 1, 1, 8),
  cyl12: new THREE.CylinderGeometry(1, 1, 1, 12),
  sphere: new THREE.SphereGeometry(1, 16, 12),
  cone: new THREE.ConeGeometry(1, 1, 8),
  torus: new THREE.TorusGeometry(1, 0.12, 6, 16),
  plane: new THREE.PlaneGeometry(1, 1),
};

const heatColors = [
  new THREE.Color('#2fe6ff'),
  new THREE.Color('#ffcf4d'),
  new THREE.Color('#ff6a2a'),
  new THREE.Color('#ff2820'),
];

function heatColor(t) {
  const k = Math.max(0, Math.min(3, t));
  const i = Math.min(2, Math.floor(k));
  return heatColors[i].clone().lerp(heatColors[i + 1], k - i);
}

export function createMech(mechId, playerColor, playerName = '', opts = {}) {
  const mech = mechOf(mechId);
  const color = new THREE.Color(playerColor || mech.accent);
  const group = new THREE.Group();
  group.name = 'mech-' + mechId;

  const hullMat = new THREE.MeshStandardMaterial({ color: mech.hull, metalness: 0.55, roughness: 0.62 });
  const trimMat = new THREE.MeshStandardMaterial({ color: mech.trim, metalness: 0.6, roughness: 0.5 });
  const darkMat = new THREE.MeshStandardMaterial({ color: '#22282b', metalness: 0.8, roughness: 0.4 });
  const blackMat = new THREE.MeshStandardMaterial({ color: '#121517', metalness: 0.7, roughness: 0.5 });
  const accentMat = new THREE.MeshStandardMaterial({ color: mech.accent, emissive: new THREE.Color(mech.accent), emissiveIntensity: 0.25, metalness: 0.4, roughness: 0.5 });
  const playerMat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.35, metalness: 0.35, roughness: 0.45 });
  const coreMat = new THREE.MeshStandardMaterial({ color: '#0a0e10', emissive: new THREE.Color('#2fe6ff'), emissiveIntensity: 1.4, metalness: 0.3, roughness: 0.3 });
  const visorMat = new THREE.MeshBasicMaterial({ color: color.clone().multiplyScalar(1.5) });
  const hazardMat = new THREE.MeshStandardMaterial({ map: hazardTexture(), roughness: 0.6, metalness: 0.3 });

  const add = (parent, geo, mat, pos, scale, rot, cast = true) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(pos[0], pos[1], pos[2]);
    if (scale) m.scale.set(scale[0], scale[1], scale[2]);
    if (rot) m.rotation.set(rot[0], rot[1], rot[2]);
    m.castShadow = cast;
    m.receiveShadow = false;
    parent.add(m);
    return m;
  };

  // ---------------------------------------------------------------- pelvis / legs
  const pelvis = new THREE.Group();
  pelvis.position.y = 0.82;
  group.add(pelvis);
  add(pelvis, GEO.box, darkMat, [0, 0, 0], [0.5, 0.26, 0.62]);
  add(pelvis, GEO.box, hullMat, [0.02, 0.1, 0], [0.42, 0.2, 0.7]);

  const legs = [];
  const legZs = mech.shape === 'miner' ? [-0.3, 0.3] : [-0.26, 0.26];
  for (const z of legZs) {
    const pivot = new THREE.Group();
    pivot.position.set(0, 0.02, z);
    pelvis.add(pivot);
    const thick = mech.shape === 'guardian' ? 1.25 : mech.shape === 'grappler' || mech.shape === 'sniper' ? 0.8 : 1;
    add(pivot, GEO.box, hullMat, [0, -0.24, 0], [0.24 * thick, 0.44, 0.24 * thick]);
    add(pivot, GEO.cyl8, darkMat, [0.02, -0.1, 0], [0.11, 0.16, 0.11], [0, 0, Math.PI / 2]);
    add(pivot, GEO.box, darkMat, [0.03, -0.46, 0], [0.22, 0.18, 0.24]);
    add(pivot, GEO.box, trimMat, [0.1, -0.58, 0], [0.42, 0.14, 0.3 * thick]);
    legs.push(pivot);
  }

  if (mech.shape === 'miner') {
    // extra rear legs for the low, spider-like silhouette
    for (const z of [-0.52, 0.52]) {
      const hinge = new THREE.Group();
      hinge.position.set(-0.18, 0.1, z);
      hinge.rotation.z = 0.6;
      pelvis.add(hinge);
      add(hinge, GEO.box, darkMat, [0, -0.32, 0], [0.14, 0.66, 0.14]);
      add(hinge, GEO.box, trimMat, [0.12, -0.66, 0], [0.38, 0.12, 0.2]);
    }
  }

  // ---------------------------------------------------------------- torso
  const torso = new THREE.Group();
  torso.position.set(0, 0.24, 0);
  pelvis.add(torso);
  const bodyW = { assault: 0.95, grappler: 0.66, guardian: 1.08, miner: 0.9, sniper: 0.62, furnace: 0.86 }[mech.shape];
  const bodyH = { assault: 0.5, grappler: 0.5, guardian: 0.56, miner: 0.48, sniper: 0.58, furnace: 0.6 }[mech.shape];
  const bodyD = { assault: 0.72, grappler: 0.5, guardian: 0.82, miner: 0.74, sniper: 0.46, furnace: 0.7 }[mech.shape];

  add(torso, GEO.box, hullMat, [0, 0.34, 0], [bodyW, bodyH, bodyD]);
  add(torso, GEO.box, trimMat, [0.06, 0.34, 0], [bodyW * 0.82, bodyH * 0.55, bodyD * 1.03]);
  // chest core housing
  add(torso, GEO.cyl12, blackMat, [0.02, 0.36, 0], [bodyD * 0.3, bodyW * 0.55, bodyD * 0.3], [0, 0, Math.PI / 2]);
  const core = add(torso, GEO.sphere, coreMat, [bodyD * 0.19, 0.36, 0], [0.14, 0.14, 0.14], null, false);

  // head
  const head = new THREE.Group();
  head.position.set(0.02, 0.64, 0);
  torso.add(head);
  add(head, GEO.box, darkMat, [0, 0.09, 0], [0.3, 0.24, 0.3]);
  add(head, GEO.box, hullMat, [0.01, 0.15, 0], [0.24, 0.12, 0.26]);
  const visor = add(head, GEO.box, visorMat, [0.16, 0.1, 0], [0.04, 0.07, 0.2], null, false);
  add(head, GEO.cyl8, darkMat, [-0.13, 0.21, 0.11], [0.02, 0.22, 0.02]);
  add(head, GEO.box, accentMat, [-0.13, 0.33, 0.11], [0.04, 0.05, 0.04]);

  // back reactor
  add(torso, GEO.box, darkMat, [-bodyD * 0.55, 0.38, 0], [0.18, 0.34, bodyD * 0.62]);
  add(torso, GEO.cyl8, accentMat, [-bodyD * 0.62, 0.46, 0], [0.1, 0.28, 0.1], [0, 0, Math.PI / 2]);
  // Reactor glow: a sprite, not a PointLight. A light per mech meant the scene
  // light count changed whenever somebody died or respawned — three.js then
  // recompiles every material in the scene, which is the freeze players felt
  // right after a respawn — and 8 of them made the big map very expensive.
  const reactor = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTexture(), color, transparent: true, opacity: 0.55,
    blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  reactor.scale.set(1.5, 1.5, 1);
  reactor.position.set(-bodyD * 0.72, 0.5, 0);
  torso.add(reactor);

  // shoulder pads
  const padZ = bodyD / 2 + 0.1;
  for (const z of [-padZ, padZ]) {
    const pad = new THREE.Group();
    pad.position.set(0, 0.58, z);
    torso.add(pad);
    const wide = mech.shape === 'guardian' ? 1.3 : mech.shape === 'assault' ? 1.45 : 1;
    add(pad, GEO.box, hullMat, [0, 0, 0], [0.5 * wide, 0.26, 0.34]);
    add(pad, GEO.box, playerMat, [0.06, 0.12, z > 0 ? 0.02 : -0.02], [0.34 * wide, 0.06, 0.24]);
    add(pad, GEO.cyl8, darkMat, [0, 0, 0], [0.16, 0.12, 0.16], [0, 0, Math.PI / 2]);
  }

  // arms + weapon
  const weapon = new THREE.Group();
  weapon.position.set(0.18, 0.44, -padZ - 0.05);
  torso.add(weapon);
  add(weapon, GEO.box, darkMat, [0.06, -0.22, 0], [0.18, 0.44, 0.18]);
  const gunLength = { sniper: 1.5, assault: 0.92, grappler: 0.75, guardian: 0.8, miner: 0.7, furnace: 0.82 }[mech.shape];
  const gun = new THREE.Group();
  gun.position.set(0.12, -0.42, 0);
  weapon.add(gun);
  add(gun, GEO.box, blackMat, [gunLength * 0.35, 0, 0], [gunLength * 0.7, 0.15, 0.17]);
  add(gun, GEO.cyl8, darkMat, [gunLength * 0.35, -0.02, 0], [0.06, gunLength * 0.7, 0.06], [0, 0, Math.PI / 2]);
  add(gun, GEO.box, accentMat, [gunLength * 0.62, 0.02, 0], [gunLength * 0.16, 0.11, 0.12]);
  if (mech.shape === 'sniper') {
    add(gun, GEO.cyl8, blackMat, [gunLength * 0.5, 0.16, 0], [0.06, 0.42, 0.06], [0, 0, Math.PI / 2]);
    add(gun, GEO.cyl12, darkMat, [gunLength * 0.25, 0.24, 0], [0.08, 0.3, 0.08], [0, 0, Math.PI / 2]);
    add(gun, GEO.box, accentMat, [gunLength * 0.9, 0, 0], [0.22, 0.08, 0.1]);
  }
  const muzzle = new THREE.Object3D();
  muzzle.position.set(gunLength * 0.78, 0, 0);
  gun.add(muzzle);

  // left arm + signature device
  const leftArm = new THREE.Group();
  leftArm.position.set(0.02, 0.5, padZ + 0.12);
  torso.add(leftArm);
  add(leftArm, GEO.box, hullMat, [0.02, -0.28, 0], [0.18, 0.5, 0.2]);
  add(leftArm, GEO.box, darkMat, [0.05, -0.54, 0], [0.16, 0.14, 0.18]);
  if (mech.shape === 'assault') {
    // ram plate
    const plate = add(torso, GEO.box, hullMat, [0.62, 0.26, 0], [0.18, 0.62, 0.86]);
    add(torso, GEO.box, hazardMat, [0.72, 0.1, 0], [0.03, 0.16, 0.8]);
    add(torso, GEO.box, playerMat, [0.72, 0.46, 0], [0.03, 0.1, 0.7]);
    add(torso, GEO.sphere, blackMat, [0.5, 0.26, 0], [0.14, 0.14, 0.14]);
    // exhaust stacks
    for (const z of [-0.3, 0.3]) add(torso, GEO.cyl8, darkMat, [-0.42, 0.72, z], [0.09, 0.36, 0.09]);
  } else if (mech.shape === 'grappler') {
    // cable drum + hook claw
    const drum = add(torso, GEO.cyl12, darkMat, [-0.38, 0.5, 0], [0.24, 0.34, 0.24], [Math.PI / 2, 0, 0]);
    add(torso, GEO.cyl8, accentMat, [-0.38, 0.5, 0], [0.12, 0.36, 0.12], [Math.PI / 2, 0, 0]);
    add(leftArm, GEO.box, darkMat, [0.14, -0.6, 0], [0.2, 0.2, 0.2]);
    add(leftArm, GEO.cone, accentMat, [0.24, -0.68, 0], [0.09, 0.24, 0.09], [0, 0, -Math.PI / 2]);
    add(leftArm, GEO.box, accentMat, [0.36, -0.6, 0.1], [0.1, 0.06, 0.06], [0, 0.5, 0]);
    add(leftArm, GEO.box, accentMat, [0.36, -0.76, -0.1], [0.1, 0.06, 0.06], [0, -0.5, 0]);
    add(torso, GEO.torus, accentMat, [-0.44, 0.5, 0], [0.28, 0.28, 0.28], [0, Math.PI / 2, 0]);
  } else if (mech.shape === 'guardian') {
    // emitter shield disc
    const disc = new THREE.Group();
    disc.position.set(0.28, 0.3, 0);
    torso.add(disc);
    add(disc, GEO.cyl12, darkMat, [0, 0, 0], [0.46, 0.08, 0.46], [0, 0, 0]);
    add(disc, GEO.torus, accentMat, [0, 0, 0], [0.36, 0.36, 0.36], [Math.PI / 2, 0, 0]);
    add(disc, GEO.cyl12, playerMat, [0, 0.06, 0], [0.12, 0.04, 0.12]);
    add(torso, GEO.box, trimMat, [-0.44, 0.52, 0], [0.16, 0.24, 0.6]);
  } else if (mech.shape === 'miner') {
    // mine drum + drill
    add(torso, GEO.cyl12, darkMat, [-0.4, 0.42, 0], [0.3, 0.36, 0.3]);
    add(torso, GEO.cyl12, accentMat, [-0.4, 0.42, 0.32], [0.14, 0.06, 0.14], [Math.PI / 2, 0, 0]);
    add(torso, GEO.box, hazardMat, [-0.42, 0.26, 0], [0.24, 0.08, 0.42]);
    add(leftArm, GEO.cone, trimMat, [0.16, -0.66, 0], [0.16, 0.44, 0.16], [0, 0, -Math.PI / 2 - 0.4]);
    add(torso, GEO.box, accentMat, [0.42, 0.68, 0.32], [0.12, 0.12, 0.12]);
  } else if (mech.shape === 'sniper') {
    // antenna / rangefinder
    add(torso, GEO.cyl8, darkMat, [-0.3, 0.8, 0], [0.025, 0.5, 0.025]);
    add(torso, GEO.box, accentMat, [-0.3, 1.05, 0], [0.08, 0.06, 0.08]);
    add(leftArm, GEO.box, trimMat, [0.08, -0.5, 0], [0.14, 0.4, 0.18], [0, 0, -0.2]);
  } else if (mech.shape === 'furnace') {
    // exposed furnace core + vents
    add(torso, GEO.cyl12, blackMat, [-0.28, 0.42, 0], [0.42, 0.42, 0.42]);
    const ring = add(torso, GEO.torus, accentMat, [-0.34, 0.42, 0], [0.3, 0.3, 0.3], [0, Math.PI / 2, 0]);
    const core2 = add(torso, GEO.sphere, coreMat, [-0.36, 0.42, 0], [0.22, 0.22, 0.22], null, false);
    for (const z of [-0.26, 0.26]) add(torso, GEO.box, darkMat, [-0.44, 0.66, z], [0.16, 0.26, 0.12]);
    add(torso, GEO.cyl8, darkMat, [0, 0.9, 0], [0.18, 0.18, 0.18]);
    leftArm.userData.furnaceRing = ring;
    core2.userData.isCore = true;
  }

  // ---------------------------------------------------------------- facing
  // A 3D mech reads as a blob from the top-down camera: silhouette, ring and
  // glow are all symmetric. These three cues make "which way is it looking"
  // obvious at a glance: a bright chevron on the floor, a front arc on the
  // ring, and a thin aim line on the ground.
  const facingMat = new THREE.MeshBasicMaterial({
    color, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending,
    depthWrite: false, side: THREE.DoubleSide,
  });
  const chevronGeo = new THREE.BufferGeometry();
  chevronGeo.setAttribute('position', new THREE.Float32BufferAttribute([
    1.12, 0, 0, 0.42, 0, 0.46, 0.58, 0, 0,
    0.42, 0, 0.46, 0.42, 0, -0.46, 0.58, 0,
    0.42, 0, -0.46, 1.12, 0, 0, 0.58, 0,
  ], 3));
  chevronGeo.computeVertexNormals();
  const chevron = new THREE.Mesh(chevronGeo, facingMat);
  chevron.position.y = 0.05;
  group.add(chevron);

  const frontArc = new THREE.Mesh(
    new THREE.RingGeometry(0.72, 0.9, 20, 1, -0.5, 1.0),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })
  );
  frontArc.rotation.x = -Math.PI / 2;
  frontArc.position.y = 0.045;
  group.add(frontArc);

  const aimLine = new THREE.Mesh(
    new THREE.PlaneGeometry(3.2, 0.09),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.28, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })
  );
  aimLine.rotation.x = -Math.PI / 2;
  aimLine.position.set(0.6 + 1.6, 0.04, 0);
  group.add(aimLine);

  // small lamp at the very front of the cockpit, visible from above
  // extra white ring so you can always find your own mech in a brawl
  const selfRing = new THREE.Mesh(
    new THREE.RingGeometry(0.95, 1.02, 32),
    new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })
  );
  selfRing.rotation.x = -Math.PI / 2;
  selfRing.position.y = 0.05;
  selfRing.visible = false;
  group.add(selfRing);

  const frontLamp = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTexture(), color, transparent: true, opacity: 0.85,
    blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  frontLamp.scale.set(0.9, 0.9, 1);
  frontLamp.position.set(0.5, 1.05, 0);
  group.add(frontLamp);

  // colored ground ring
  const ringMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false });
  const ringMesh = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.68, 28), ringMat);
  ringMesh.rotation.x = -Math.PI / 2;
  ringMesh.position.y = 0.03;
  group.add(ringMesh);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false }));
  glow.scale.set(2.6, 2.6, 1);
  glow.position.y = 0.6;
  group.add(glow);

  // muzzle flash
  const flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: '#ffe0a0', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  flash.scale.set(1.4, 1.4, 1);
  flash.visible = false;
  group.add(flash);

  // shield bubble (guardian skill)
  const shieldMat = new THREE.MeshStandardMaterial({
    color: '#5ad8ff', emissive: new THREE.Color('#5ad8ff'), emissiveIntensity: 0.8,
    transparent: true, opacity: 0.22, roughness: 0.2, metalness: 0.1, side: THREE.DoubleSide, depthWrite: false,
  });
  const shield = new THREE.Mesh(new THREE.SphereGeometry(1.72, 24, 16), shieldMat);
  shield.position.y = 1.1;
  shield.visible = false;
  group.add(shield);

  // nameplate
  let nameSprite = null;
  if (playerName) {
    const mat = new THREE.SpriteMaterial({ map: nameTexture(playerName, playerColor || mech.accent), transparent: true, depthWrite: false });
    nameSprite = new THREE.Sprite(mat);
    nameSprite.scale.set(2.6, 0.65, 1);
    nameSprite.position.y = 2.45;
    group.add(nameSprite);
  }

  const parts = {
    group, pelvis, torso, head, legs, gun, muzzle, weapon, leftArm, core, visor,
    ring: ringMesh, ringMat, glow, flash, shield, shieldMat, nameSprite,
    chevron, frontArc, aimLine, frontLamp, facingMat, selfRing,
    hullMat, trimMat, darkMat, accentMat, playerMat, coreMat, visorMat, reactor,
    shape: mech.shape, mech, color,
    walkPhase: Math.random() * 10, recoil: 0, flashT: 0, heat: 0, dead: false,
    baseY: 0, bob: 0,
  };
  group.userData.mech = parts;
  return parts;
}

export function updateMech(parts, look, dt) {
  const p = parts;
  const speed = look.speed || 0;
  const heat = look.heat || 0;
  p.heat = heat;
  const t = look.time || 0;
  p.walkPhase += dt * (3 + speed * 1.8);
  const moving = speed > 0.4 && look.alive;
  const swing = moving ? Math.sin(p.walkPhase) * 0.55 : Math.sin(t * 1.4) * 0.04;
  if (p.legs[0]) p.legs[0].rotation.z = swing;
  if (p.legs[1]) p.legs[1].rotation.z = -swing;
  const bob = moving ? Math.abs(Math.sin(p.walkPhase)) * 0.06 : Math.sin(t * 1.6) * 0.025;
  p.pelvis.position.y = 0.82 + bob;
  p.pelvis.rotation.z = moving ? Math.sin(p.walkPhase) * 0.03 : 0;
  p.torso.rotation.x = moving ? Math.sin(p.walkPhase) * 0.02 : 0;
  // recoil
  if (p.recoil > 0) {
    p.recoil = Math.max(0, p.recoil - dt * 9);
  }
  p.weapon.position.x = 0.18 - p.recoil * 0.14;
  p.torso.position.x = -p.recoil * 0.06;
  if (p.flashT > 0) {
    p.flashT -= dt;
    p.flash.visible = p.flashT > 0;
    p.flash.material.opacity = Math.max(0, p.flashT / 0.07);
  } else p.flash.visible = false;

  // heat visuals
  const hk = Math.max(0, Math.min(100, heat)) / 100;
  const c = heatColor(Math.max(0, (heat - 30) / 30));
  p.coreMat.emissive.copy(c);
  p.coreMat.emissiveIntensity = 1.0 + hk * 2.6 + Math.sin(t * 9) * 0.2 * hk;
  p.core.scale.setScalar(0.14 + hk * 0.04 + Math.sin(t * (5 + hk * 15)) * 0.008 * hk);
  p.visorMat.color.copy(p.color).lerp(new THREE.Color('#ff5030'), hk * 0.8).multiplyScalar(1.4);
  p.reactor.material.color.copy(p.color).lerp(new THREE.Color('#ff4020'), hk * 0.7);
  p.reactor.material.opacity = 0.4 + hk * 0.5 + Math.sin(t * 6) * 0.06;
  p.reactor.scale.setScalar(1.35 + hk * 0.7);
  p.ringMat.opacity = 0.5 + hk * 0.5;
  p.ringMat.color.copy(p.color).lerp(new THREE.Color('#ff4020'), hk * 0.7);
  // facing cues: pulse the chevron a little so a still mech still reads
  const aimPulse = 0.72 + Math.sin(t * 3.2) * 0.1;
  if (p.chevron) {
    p.chevron.material.color.copy(p.color).lerp(new THREE.Color('#ff4020'), hk * 0.5);
    p.chevron.material.opacity = (look.aimLine ?? 0.55) * aimPulse;
    p.chevron.visible = look.alive !== false;
  }
  if (p.frontArc) {
    p.frontArc.material.color.copy(p.color).lerp(new THREE.Color('#ff4020'), hk * 0.5);
    p.frontArc.material.opacity = (look.aimLine ?? 0.55) * aimPulse;
    p.frontArc.visible = look.alive !== false;
  }
  if (p.aimLine) {
    p.aimLine.material.color.copy(p.color);
    p.aimLine.material.opacity = (look.aimLine ?? 0.55) * 0.34;
    p.aimLine.scale.x = look.isSelf ? 1.5 : 1;
    p.aimLine.position.x = 0.6 + 1.6 * (look.isSelf ? 1.5 : 1);
    p.aimLine.visible = look.alive !== false;
  }
  if (p.selfRing) {
    p.selfRing.visible = !!look.isSelf && look.alive !== false;
    p.selfRing.material.opacity = 0.35 + Math.sin(t * 2.4) * 0.1;
  }
  if (p.frontLamp) p.frontLamp.material.opacity = 0.55 + hk * 0.35;
  p.glow.material.opacity = 0.18 + hk * 0.25;
  if (p.glow.material.color) p.glow.material.color.copy(p.color).lerp(new THREE.Color('#ff4020'), hk * 0.7);
  // shield
  if (look.shield > 0) {
    p.shield.visible = true;
    const pulse = 1 + Math.sin(t * 20) * 0.02;
    p.shield.scale.setScalar(pulse);
    p.shieldMat.opacity = 0.16 + 0.12 * Math.min(1, look.shield * 2);
  } else p.shield.visible = false;
  // death
  if (look.alive === false) {
    p.group.visible = false;
  } else {
    p.group.visible = true;
    p.group.position.y = p.baseY;
  }
  // stun shake
  if (look.stunned) {
    p.torso.position.z = Math.sin(t * 70) * 0.03;
  } else p.torso.position.z = 0;
  // nameplate
  if (p.nameSprite) p.nameSprite.visible = !!look.showName && look.alive !== false;
}

export function muzzleWorld(parts) {
  const v = new THREE.Vector3();
  parts.muzzle.getWorldPosition(v);
  return v;
}

export function disposeMech(parts) {
  parts.group.traverse((o) => {
    if (o.isMesh) {
      if (o.geometry && !Object.values(GEO).includes(o.geometry)) o.geometry.dispose?.();
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) m?.dispose?.();
    } else if (o.isSprite) {
      o.material?.dispose?.();
    }
  });
}
