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
 * Identity of the *picture* behind a texture.
 *
 * `texture.clone()` is how the arena gives one hazard-stripe sheet a different
 * repeat per wall (`.clone()` shares the canvas but not the transform), so the
 * uuid is unique per object even though every stripe looks the same. The
 * canvas itself is the thing they share, so stamp an id on it.
 */
let imageId = 0;
function imageKey(t) {
  const img = t.image;
  if (!img) return t.uuid;
  if (img.__mergeId == null) {
    Object.defineProperty(img, '__mergeId', { value: ++imageId, enumerable: false });
  }
  return 'img' + img.__mergeId;
}

/** Can this texture's repeat/offset be multiplied into the uv attribute? */
function canBakeUv(t) {
  if (!t) return false;
  if (t.rotation) return false;
  if (t.center && (t.center.x || t.center.y)) return false;
  return t.matrixAutoUpdate !== false;
}

/** uv' = uv * repeat + offset  (exactly what the shader would do). */
function bakeUv(geo, t) {
  const uv = geo.attributes.uv;
  if (!uv) return;
  const r = t.repeat, o = t.offset;
  if (r.x === 1 && r.y === 1 && !o.x && !o.y) return;
  const a = uv.array;
  for (let i = 0; i < a.length; i += 2) {
    a[i] = a[i] * r.x + o.x;
    a[i + 1] = a[i + 1] * r.y + o.y;
  }
  uv.needsUpdate = true;
}

/**
 * Material identity for batching.
 *
 * Same idea as `materialSignature`, but the map is identified by its picture
 * (plus its uv transform unless that has been baked into the geometry), which
 * lets 48 separately-cloned hazard stripes collapse into one material.
 */
function lookSignature(m, { baked = false } = {}) {
  const c = (x) => (x && x.isColor ? x.getHexString() : String(x ?? ''));
  const t = m.map;
  const tex = t
    ? `${imageKey(t)}|${baked ? '' : `${t.repeat.x},${t.repeat.y},${t.offset.x},${t.offset.y}`}`
    : '';
  return [
    m.type, c(m.color), c(m.emissive), m.emissiveIntensity ?? 1,
    m.roughness ?? 1, m.metalness ?? 0,
    m.transparent ? 1 : 0, m.opacity ?? 1, m.alphaTest ?? 0, m.side ?? 0,
    m.depthWrite === false ? 0 : 1, m.blending ?? 1, m.vertexColors ? 1 : 0,
    m.flatShading ? 1 : 0, m.toneMapped === false ? 0 : 1,
    tex, m.normalMap ? imageKey(m.normalMap) : '', m.roughnessMap ? imageKey(m.roughnessMap) : '',
  ].join('|');
}

/** A copy of `m` whose map tiles exactly once (uvs were baked to match). */
function bakedMaterial(m) {
  const copy = m.clone();
  if (copy.map) {
    copy.map = copy.map.clone();
    copy.map.repeat.set(1, 1);
    copy.map.offset.set(0, 0);
    copy.map.needsUpdate = true;
  }
  copy.needsUpdate = true;
  return copy;
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
      if (!mat) continue;
      if (child.geometry.attributes.position?.count < minVerts) continue;
      const attrs = Object.keys(child.geometry.attributes).sort().join(',');
      // Transparent siblings are only merged when they literally share one
      // material: same instance means identical look *and* identical sort key,
      // so a wall's two hazard stripes become one draw instead of two without
      // any chance of a depth/alpha change.
      const sig = mat.transparent || mat.alphaTest > 0
        ? `t:${mat.uuid}`
        : materialSignature(mat);
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
export function batchWorld(root, {
  exclude = [], chunk = 0, transparent = false, includeMap = true, minGroup = 2,
} = {}) {
  const excluded = new Set(exclude);
  const isExcluded = (o) => {
    for (let p = o; p; p = p.parent) if (excluded.has(p)) return true;
    return false;
  };
  root.updateMatrixWorld(true);
  const invRoot = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const groups = new Map();
  const m4 = new THREE.Matrix4();
  root.traverse((o) => {
    if (!o.isMesh || o.isInstancedMesh || o.isSkinnedMesh) return;
    if (o.userData.noBatch || o.userData.worldBatched) return;
    if (!o.visible) return;
    if (!o.geometry || o.geometry.morphAttributes?.position) return;
    if (Array.isArray(o.material)) return;
    const mat = o.material;
    if (!mat) return;
    if (isExcluded(o)) return;
    const isTrans = !!(mat.transparent || mat.alphaTest > 0);
    if (isTrans && !transparent) return;
    // A map whose uv transform cannot be baked keeps the transform in its key,
    // so only meshes that already tile identically end up in the same group.
    const t = includeMap ? mat.map : null;
    const bake = !!(t && canBakeUv(t));
    const attrs = Object.keys(o.geometry.attributes).filter((a) => ['position', 'normal', 'uv'].includes(a)).sort().join(',');
    // `chunk > 0` splits the merge into a grid of map cells. One giant mesh is
    // a single draw call but it can never be culled, so the whole arena is
    // submitted even when two thirds of it is behind the camera. Per-cell
    // meshes keep the draw-call count low *and* let the renderer skip the
    // cells that are off screen.
    let cell = '';
    if (chunk > 0) {
      const p = o.matrixWorld;
      cell = `|${Math.floor(p.elements[12] / chunk)},${Math.floor(p.elements[14] / chunk)}`;
    }
    // Transparent meshes are merged per renderOrder too: three.js sorts the
    // transparent queue by (renderOrder, distance), so folding two different
    // renderOrders into one mesh could change what is drawn on top of what.
    const key = `${lookSignature(mat, { baked: bake })}|${attrs}|${o.castShadow ? 1 : 0}${o.receiveShadow ? 1 : 0}|${o.geometry.index ? 1 : 0}|${isTrans ? o.renderOrder : ''}${cell}`;
    let list = groups.get(key);
    if (!list) { list = []; groups.set(key, list); }
    list.push({ o, m: m4.copy(invRoot).multiply(o.matrixWorld).clone(), bake, t });
  });

  let merged = 0;
  const materials = new Map();
  for (const list of groups.values()) {
    if (list.length < minGroup) continue;
    const geos = [];
    let ok = true;
    for (const { o, m, bake, t } of list) {
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
      if (bake) bakeUv(geo, t);
      geos.push(geo);
    }
    let mergedGeo = null;
    try { mergedGeo = mergeGeometries(geos, false); } catch { ok = false; }
    for (const g of geos) if (g !== mergedGeo) g.dispose();
    if (!ok || !mergedGeo) continue;
    mergedGeo.computeBoundingSphere();
    mergedGeo.computeBoundingBox();
    const first = list[0];
    let material = first.o.material;
    if (first.bake) {
      // share one adjusted material between every group that needs the same one
      const msig = lookSignature(material, { baked: true });
      if (!materials.has(msig)) materials.set(msig, bakedMaterial(material));
      material = materials.get(msig);
    }
    const mesh = new THREE.Mesh(mergedGeo, material);
    mesh.castShadow = first.o.castShadow;
    mesh.receiveShadow = first.o.receiveShadow;
    mesh.renderOrder = first.o.renderOrder;
    mesh.userData.worldBatched = list.length;
    // Chunked merges are compact, so the ordinary frustum test is a win;
    // without chunks the mesh spans the map and must never be culled.
    mesh.frustumCulled = chunk > 0;
    root.add(mesh);
    for (const { o } of list) o.parent?.remove(o);
    merged += list.length - 1;
  }
  return { merged, groups: groups.size };
}

/**
 * Stop tiny decorations from being drawn into the shadow map.
 *
 * Every caster is a second draw call in the shadow pass, and a 20 cm rivet
 * covers a couple of shadow texels that are invisible at this camera height.
 * Meshes whose world-space radius is below `minRadius` keep their own shading
 * but stop casting.
 */
export function limitShadowCasters(root, { minRadius = 0, maxCount = Infinity, keep = [] } = {}) {
  const keepSet = new Set(keep);
  root.updateMatrixWorld(true);
  const sphere = new THREE.Sphere();
  const casters = [];
  root.traverse((o) => {
    if (!o.isMesh || !o.castShadow) return;
    const g = o.geometry;
    if (!g) return;
    for (let p = o; p; p = p.parent) if (keepSet.has(p)) return;
    if (!g.boundingSphere) g.computeBoundingSphere();
    if (!g.boundingSphere) return;
    sphere.copy(g.boundingSphere).applyMatrix4(o.matrixWorld);
    casters.push({ o, r: sphere.radius });
  });
  let dropped = 0;
  for (const { o, r } of casters) {
    if (r < minRadius) { o.castShadow = false; dropped++; }
  }
  if (casters.length > maxCount) {
    // Keep the shapes that actually form the silhouette: a mech's shadow only
    // needs its biggest parts, not the 20 rivets riding on them.
    const live = casters.filter((c) => c.o.castShadow).sort((a, b) => b.r - a.r);
    for (const { o } of live.slice(Math.max(0, maxCount))) {
      o.castShadow = false;
      dropped++;
    }
  }
  return { dropped, casters: casters.length - dropped };
}

/**
 * Draw-call budget of a scene, the way the renderer sees it.
 *
 * The colour pass submits everything whose bounds survive the camera frustum
 * (plus anything with `frustumCulled = false`); the shadow pass submits every
 * caster inside the sun's box. Rendering it for real needs a GPU, but this
 * model tracks `renderer.info.render.calls` closely and gives the perf test a
 * number to guard.
 */
export function drawBudget(scene, camera, { shadowEvery = 1 } = {}) {
  if (!camera) return { colors: 0, shadows: 0, total: 0 };
  camera.updateMatrixWorld(true);
  const matrix = new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  const frustum = new THREE.Frustum().setFromProjectionMatrix(matrix);
  const sphere = new THREE.Sphere();
  const vec = new THREE.Vector3();
  let colors = 0;
  let shadows = 0;
  scene.updateMatrixWorld(true);
  scene.traverseVisible((o) => {
    const drawable = o.isMesh || o.isSprite || o.isPoints || o.isLine;
    if (!drawable) return;
    if (o.isMesh && Object.keys(o.geometry.attributes).length === 0) return; // line-like helpers
    let inside = true;
    if (o.frustumCulled !== false) {
      if (o.isSprite) {
        vec.setFromMatrixPosition(o.matrixWorld);
        const r = Math.max(Math.abs(o.scale.x), Math.abs(o.scale.y)) * 0.75;
        sphere.set(vec, r);
      } else if (o.geometry) {
        if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere();
        if (!o.geometry.boundingSphere) return;
        sphere.copy(o.geometry.boundingSphere).applyMatrix4(o.matrixWorld);
      } else return;
      inside = frustum.intersectsSphere(sphere);
    }
    if (inside) colors++;
    if (inside && o.castShadow) shadows++;
  });
  return { colors, shadows, total: colors + Math.round(shadows / Math.max(1, shadowEvery)) };
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
