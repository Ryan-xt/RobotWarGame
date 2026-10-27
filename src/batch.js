import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * Two materials that look the same should *be* the same material.
 *
 * The arena builds a fresh `MeshStandardMaterial` per crate and per rivet
 * (846 distinct materials on the big map!), which both breaks batching and
 * costs a shader-program/uniform upload per object. This signature lets the
 * batcher fold identical-looking materials together.
 */
function materialSignature(m) {
  if (!m) return 'none';
  const c = (x) => (x && x.isColor ? x.getHexString() : String(x ?? ''));
  return [
    m.type, c(m.color), m.map?.uuid || '', m.normalMap?.uuid || '', m.roughnessMap?.uuid || '',
    c(m.emissive), m.emissiveIntensity ?? 1, m.roughness ?? 1, m.metalness ?? 0,
    m.transparent ? 1 : 0, m.opacity ?? 1, m.alphaTest ?? 0, m.side ?? 0,
    m.depthWrite === false ? 0 : 1, m.blending ?? 1, m.vertexColors ? 1 : 0,
    m.flatShading ? 1 : 0, m.toneMapped === false ? 0 : 1,
  ].join('|');
}

/**
 * Merge sibling meshes that share a material.
 *
 * The arena and the mechs are built from a lot of small boxes (a cooler is 14
 * meshes, a mech 45, the 48 m map ~1300 in total). Every mesh is a draw call,
 * and every draw call is also replayed into the shadow map — at that point the
 * GPU is bound by *submission*, not by triangles, which is why the frame rate
 * dropped on the big map and with more players even though the CPU was idle.
 *
 * Merging only ever happens *between siblings*, so an animation driven by a
 * parent's transform (a leg swinging, a wall group being hidden, a crate
 * group rotating) keeps working exactly as before: the merged mesh lives in
 * the same parent. Anything a system animates individually must be flagged
 * with `userData.noBatch = true` (createMech does that for every named part).
 *
 * @param {THREE.Object3D} root   subtree to compress
 * @param {{ minVerts?: number }} [opts]
 * @returns {{ before: number, after: number, merged: number }} mesh counts
 */
export function batchStatic(root, opts = {}) {
  const minVerts = opts.minVerts ?? 0;
  const canonical = new Map(); // material uuid -> first material with that look
  let before = 0;
  let after = 0;
  let merged = 0;

  const parents = [];
  root.traverse((o) => {
    if (o.isMesh) before++;
    if (o.children && o.children.length > 1) parents.push(o);
  });

  for (const parent of parents) {
    const groups = new Map();
    for (const child of parent.children) {
      if (!child.isMesh || child.isInstancedMesh || child.isSkinnedMesh) continue;
      if (child.userData.noBatch) continue;
      if (!child.visible) continue;
      if (!child.geometry || child.geometry.morphAttributes?.position) continue;
      if (Array.isArray(child.material)) continue;
      const mat = child.material;
      if (!mat || mat.transparent || mat.alphaTest > 0) continue; // sorting per-mesh
      if (child.geometry.attributes.position?.count < minVerts) continue;
      const attrs = Object.keys(child.geometry.attributes).sort().join(',');
      const sig = materialSignature(mat);
      if (!canonical.has(sig)) canonical.set(sig, mat);
      const key = `${sig}|${attrs}|${child.castShadow ? 1 : 0}${child.receiveShadow ? 1 : 0}|${child.renderOrder}|${child.geometry.index ? 1 : 0}`;
      let list = groups.get(key);
      if (!list) { list = []; groups.set(key, list); }
      list.push(child);
    }

    for (const list of groups.values()) {
      if (list.length < 2) continue;
      mergeGroup: {
        const geos = [];
        for (const child of list) {
          child.updateMatrix();
          const geo = child.geometry.clone();
          geo.applyMatrix4(child.matrix);
          // strip everything that mergeGeometries cannot reconcile
          for (const name of Object.keys(geo.attributes)) {
            if (!['position', 'normal', 'uv'].includes(name)) geo.deleteAttribute(name);
          }
          if (!geo.attributes.normal) geo.computeVertexNormals();
          if (!geo.attributes.uv) {
            const n = geo.attributes.position.count;
            geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
          }
          geos.push(geo);
        }
        let mergedGeo = null;
        try {
          mergedGeo = mergeGeometries(geos, false);
        } catch {
          mergedGeo = null;
        }
        for (const g of geos) if (g !== mergedGeo) g.dispose();
        if (!mergedGeo) break mergeGroup;
        mergedGeo.computeBoundingSphere();
        const first = list[0];
        const mesh = new THREE.Mesh(mergedGeo, canonical.get(materialSignature(first.material)) || first.material);
        mesh.castShadow = first.castShadow;
        mesh.receiveShadow = first.receiveShadow;
        mesh.renderOrder = first.renderOrder;
        mesh.frustumCulled = false; // it spans the whole merged cluster
        mesh.userData.batched = list.length;
        for (const child of list) parent.remove(child);
        parent.add(mesh);
        merged += list.length - 1;
      }
    }
  }

  root.traverse((o) => { if (o.isMesh) after++; });
  return { before, after, merged };
}

/**
 * Merge *always-static* decoration across the whole subtree into world-space
 * meshes (one per material).
 *
 * `batchStatic` only merges siblings; the arena's props, fences, signs and
 * silhouettes are one or two meshes each in their own little group, so sibling
 * merging saves almost nothing there. None of them ever move or toggle, so
 * they can all be baked into a handful of draws. Groups that animate (cooling
 * vents, acids, towers, walls, plates) are passed in `exclude` and stay as
 * they are.
 */
export function batchWorld(root, { exclude = [] } = {}) {
  const excluded = new Set(exclude);
  const isExcluded = (o) => {
    for (let p = o; p; p = p.parent) if (excluded.has(p)) return true;
    return false;
  };
  root.updateMatrixWorld(true);
  const invRoot = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const groups = new Map();
  const victims = [];
  const m4 = new THREE.Matrix4();
  root.traverse((o) => {
    if (!o.isMesh || o.isInstancedMesh || o.isSkinnedMesh) return;
    if (o.userData.noBatch || o.userData.worldBatched) return;
    if (!o.visible) return;
    if (!o.geometry || o.geometry.morphAttributes?.position) return;
    if (Array.isArray(o.material)) return;
    const mat = o.material;
    if (!mat || mat.transparent || mat.alphaTest > 0) return;
    if (isExcluded(o)) return;
    const attrs = Object.keys(o.geometry.attributes).filter((a) => ['position', 'normal', 'uv'].includes(a)).sort().join(',');
    const key = `${materialSignature(mat)}|${attrs}|${o.castShadow ? 1 : 0}${o.receiveShadow ? 1 : 0}|${o.geometry.index ? 1 : 0}`;
    let list = groups.get(key);
    if (!list) { list = []; groups.set(key, list); }
    list.push({ o, m: m4.copy(invRoot).multiply(o.matrixWorld).clone() });
  });

  for (const list of groups.values()) {
    if (list.length >= 2) for (const { o } of list) victims.push(o);
  }

  let merged = 0;
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    const geos = [];
    let ok = true;
    for (const { o, m } of list) {
      const geo = o.geometry.clone();
      geo.applyMatrix4(m);
      for (const name of Object.keys(geo.attributes)) {
        if (!['position', 'normal', 'uv'].includes(name)) geo.deleteAttribute(name);
      }
      if (!geo.attributes.normal) geo.computeVertexNormals();
      if (!geo.attributes.uv) {
        const n = geo.attributes.position.count;
        geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
      }
      geos.push(geo);
    }
    let mergedGeo = null;
    try { mergedGeo = mergeGeometries(geos, false); } catch { ok = false; }
    for (const g of geos) if (g !== mergedGeo) g.dispose();
    if (!ok || !mergedGeo) continue;
    mergedGeo.computeBoundingSphere();
    const first = list[0].o;
    const mesh = new THREE.Mesh(mergedGeo, first.material);
    mesh.castShadow = first.castShadow;
    mesh.receiveShadow = first.receiveShadow;
    mesh.userData.worldBatched = list.length;
    mesh.frustumCulled = false;
    root.add(mesh);
    for (const { o } of list) o.parent?.remove(o);
    merged += list.length - 1;
  }
  return { merged };
}

/** Count meshes / sprites / points / lights below `root` (diagnostics + tests). */
export function sceneCost(root) {
  const out = { meshes: 0, sprites: 0, points: 0, lights: 0, triangles: 0, materials: new Set() };
  root.traverse((o) => {
    if (o.isMesh) {
      out.meshes++;
      const g = o.geometry;
      if (g) {
        const n = g.index ? g.index.count : (g.attributes.position?.count || 0);
        out.triangles += (n / 3) * (o.isInstancedMesh ? o.count : 1);
      }
    } else if (o.isSprite) out.sprites++;
    else if (o.isPoints) out.points++;
    else if (o.isLight) out.lights++;
    if (o.material) {
      const ms = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of ms) out.materials.add(m.uuid);
    }
  });
  out.materials = out.materials.size;
  out.triangles = Math.round(out.triangles);
  return out;
}
