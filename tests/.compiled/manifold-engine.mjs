import * as THREE from "three";
let _api = null;
let _loadPromise = null;
async function getManifoldAPI() {
  if (_api) return _api;
  if (_loadPromise) return _loadPromise;
  _loadPromise = (async () => {
    const manifoldLoad = new Function('return import("/manifold/manifold.js")');
    const mod = await manifoldLoad();
    const factory = mod.default ?? mod;
    const api = await factory();
    api.setup();
    _api = api;
    return api;
  })();
  return _loadPromise;
}
function geometryToArrays(geo) {
  const pos = geo.attributes.position;
  const vCount = pos.count;
  const vertProperties = new Float32Array(vCount * 3);
  for (let i = 0; i < vCount; i++) {
    vertProperties[i * 3] = pos.getX(i);
    vertProperties[i * 3 + 1] = pos.getY(i);
    vertProperties[i * 3 + 2] = pos.getZ(i);
  }
  let triVerts;
  if (geo.index) {
    triVerts = new Uint32Array(geo.index.count);
    for (let i = 0; i < geo.index.count; i++) {
      triVerts[i] = geo.index.getX(i);
    }
  } else {
    triVerts = new Uint32Array(vCount);
    for (let i = 0; i < vCount; i++) triVerts[i] = i;
  }
  return { vertProperties, triVerts };
}
function meshToGeometry(mesh) {
  const { numProp, vertProperties, triVerts } = mesh;
  const vertCount = vertProperties.length / numProp;
  let positions;
  if (numProp === 3) {
    positions = new Float32Array(vertProperties);
  } else {
    positions = new Float32Array(vertCount * 3);
    for (let i = 0; i < vertCount; i++) {
      positions[i * 3] = vertProperties[i * numProp];
      positions[i * 3 + 1] = vertProperties[i * numProp + 1];
      positions[i * 3 + 2] = vertProperties[i * numProp + 2];
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setIndex(new THREE.BufferAttribute(new Uint32Array(triVerts), 1));
  geo.computeVertexNormals();
  return geo;
}
function viewportPlaneToEngine(axis, position, bbox) {
  const size = new THREE.Vector3();
  bbox.getSize(size);
  if (axis === "x") {
    const worldX = bbox.min.x + size.x * position;
    return { normal: [1, 0, 0], originOffset: worldX };
  } else if (axis === "y") {
    const worldY = bbox.min.y + size.y * position;
    return { normal: [0, 1, 0], originOffset: worldY };
  } else {
    const worldZ = bbox.min.z + size.z * position;
    return { normal: [0, 0, 1], originOffset: worldZ };
  }
}
async function splitMesh(geo, planes, onProgress) {
  onProgress(0, planes.length, "Loading manifold engine\u2026");
  await yieldToUI();
  const api = await getManifoldAPI();
  const { Manifold } = api;
  onProgress(0, planes.length, "Repairing mesh\u2026");
  await yieldToUI();
  const { mergeVertices, toCreasedNormals } = await import("three/examples/jsm/utils/BufferGeometryUtils.js");
  const { Mesh } = api;
  const nonIndexed = geo.index ? geo.toNonIndexed() : geo;
  let rootManifold = null;
  async function tryBuild(g) {
    const g1 = await removeDegenerates(g);
    const g2 = await deduplicateTris(g1);
    const g3 = await fixWinding(g2);
    const g4 = await ensureOutwardNormals(g3);
    const { vertProperties, triVerts } = geometryToArrays(g4);
    try {
      const c = new Manifold(new Mesh({ numProp: 3, vertProperties, triVerts }));
      return c.isEmpty() ? null : c;
    } catch {
      return null;
    }
  }
  onProgress(0, planes.length, "Inspecting mesh\u2026");
  await yieldToUI();
  const tightMerged = mergeVertices(nonIndexed, 1e-4);
  const dx = await diagnoseMesh(tightMerged);
  if (dx.openEdges > 0) {
    const gapStr = dx.maxGapMM > 0 ? `, max gap ${dx.maxGapMM.toFixed(2)} mm` : "";
    const tolStr = `recommended weld \xB1${dx.recommendedTol.toFixed(dx.recommendedTol < 0.01 ? 4 : dx.recommendedTol < 1 ? 2 : 1)} mm`;
    onProgress(
      0,
      planes.length,
      `Repairing mesh \u2014 ${dx.openEdges} open edges${gapStr}, ${tolStr}\u2026`
    );
  } else {
    onProgress(0, planes.length, "Repairing mesh \u2014 no open edges, checking topology\u2026");
  }
  await yieldToUI();
  const fallbackTols = [0.01, 0.1, 1, 5];
  const orderedTols = [dx.recommendedTol, ...fallbackTols.filter((t) => t > dx.recommendedTol * 1.1)];
  let lastCleaned = null;
  for (let ti = 0; ti < orderedTols.length; ti++) {
    const tol = orderedTols[ti];
    if (ti > 0) {
      onProgress(0, planes.length, `Repairing mesh \u2014 widening weld to \xB1${tol} mm (pass ${ti + 1}/${orderedTols.length})\u2026`);
      await yieldToUI();
    }
    const merged = mergeVertices(nonIndexed, tol);
    lastCleaned = merged;
    rootManifold = await tryBuild(merged);
    if (rootManifold) break;
  }
  if (!rootManifold && lastCleaned) {
    onProgress(0, planes.length, "Repairing mesh \u2014 filling open holes\u2026");
    await yieldToUI();
    const filled = await fillHoles(lastCleaned);
    if (filled !== lastCleaned) {
      const niFilled = filled.index ? filled.toNonIndexed() : filled;
      for (const tol of orderedTols) {
        const merged = mergeVertices(niFilled, tol);
        rootManifold = await tryBuild(merged);
        if (rootManifold) break;
      }
    }
  }
  if (!rootManifold) {
    onProgress(
      0,
      planes.length,
      "Manifold repair failed \u2014 using direct plane-clipping (self-intersecting geometry detected)\u2026"
    );
    await yieldToUI();
    return splitMeshByClipping(geo, planes, onProgress);
  }
  onProgress(0, planes.length, "Building manifold mesh\u2026");
  await yieldToUI();
  let regions = [rootManifold];
  for (let pi = 0; pi < planes.length; pi++) {
    const { normal, originOffset } = planes[pi];
    onProgress(pi, planes.length, `Cutting plane ${pi + 1} of ${planes.length}\u2026`);
    await yieldToUI();
    const negNormal = [-normal[0], -normal[1], -normal[2]];
    const nextRegions = [];
    for (const region of regions) {
      const posHalf = region.trimByPlane(normal, originOffset);
      const negHalf = region.trimByPlane(negNormal, -originOffset);
      if (!posHalf.isEmpty()) nextRegions.push(posHalf);
      else if (posHalf.delete) posHalf.delete();
      if (!negHalf.isEmpty()) nextRegions.push(negHalf);
      else if (negHalf.delete) negHalf.delete();
      if (region.delete) region.delete();
    }
    regions = nextRegions;
  }
  onProgress(planes.length, planes.length, "Converting parts\u2026");
  await yieldToUI();
  const CREASE_ANGLE = Math.PI / 6;
  const parts = [];
  for (let i = 0; i < regions.length; i++) {
    onProgress(planes.length, planes.length, `Converting part ${i + 1} of ${regions.length}\u2026`);
    await yieldToUI();
    const mesh = regions[i].getMesh();
    const rawGeo = meshToGeometry(mesh);
    if (regions[i].delete) regions[i].delete();
    const vol = computeGeometryVolume(rawGeo);
    const geometry = mergeVertices(toCreasedNormals(rawGeo, CREASE_ANGLE));
    rawGeo.dispose();
    geometry.computeBoundingBox();
    const bb = geometry.boundingBox;
    const size = new THREE.Vector3();
    bb.getSize(size);
    parts.push({
      geometry,
      label: `Part ${i + 1}`,
      triangleCount: mesh.triVerts.length / 3,
      volumeMM3: parseFloat(vol.toFixed(2)),
      bbox: {
        x: parseFloat(size.x.toFixed(1)),
        y: parseFloat(size.y.toFixed(1)),
        z: parseFloat(size.z.toFixed(1))
      }
    });
  }
  return parts;
}
let _lastYield = 0;
const YIELD_INTERVAL = 50;
function yieldToUI() {
  _lastYield = performance.now();
  const s = globalThis.scheduler;
  if (s?.yield) return s.yield();
  return new Promise((resolve) => setTimeout(resolve, 0));
}
async function yieldIfNeeded() {
  if (performance.now() - _lastYield >= YIELD_INTERVAL) {
    await yieldToUI();
  }
}
async function clipByPlane(geo, n, offset) {
  const src = geo.index ? geo : await exactMergeVertices(geo);
  const pos = src.attributes.position;
  const idx = src.index;
  const nV = pos.count;
  const nTris = idx.count / 3;
  const EPS = 1e-10;
  const dist = new Float32Array(nV);
  for (let i = 0; i < nV; i++) {
    const d = n.x * pos.getX(i) + n.y * pos.getY(i) + n.z * pos.getZ(i) - offset;
    dist[i] = Math.abs(d) < EPS ? 0 : d;
  }
  const px = [], py = [], pz = [];
  for (let i = 0; i < nV; i++) {
    px.push(pos.getX(i));
    py.push(pos.getY(i));
    pz.push(pos.getZ(i));
  }
  const edgeCache = /* @__PURE__ */ new Map();
  const getOrCreate = (i, j) => {
    if (dist[i] === 0) return i;
    if (dist[j] === 0) return j;
    const lo = i < j ? i : j, hi = i < j ? j : i;
    const key = lo * nV + hi;
    let vi = edgeCache.get(key);
    if (vi === void 0) {
      const t = dist[i] / (dist[i] - dist[j]);
      vi = px.length;
      px.push(pos.getX(i) + t * (pos.getX(j) - pos.getX(i)));
      py.push(pos.getY(i) + t * (pos.getY(j) - pos.getY(i)));
      pz.push(pos.getZ(i) + t * (pos.getZ(j) - pos.getZ(i)));
      edgeCache.set(key, vi);
    }
    return vi;
  };
  const posIdx = [], negIdx = [];
  for (let t = 0; t < nTris; t++) {
    if ((t & 65535) === 0) await yieldIfNeeded();
    const ai = idx.getX(t * 3), bi = idx.getX(t * 3 + 1), ci = idx.getX(t * 3 + 2);
    const da = dist[ai], db = dist[bi], dc = dist[ci];
    const sa = da >= 0, sb = db >= 0, sc = dc >= 0;
    if (sa && sb && sc) {
      posIdx.push(ai, bi, ci);
      continue;
    }
    if (!sa && !sb && !sc) {
      negIdx.push(ai, bi, ci);
      continue;
    }
    const raw = [ai, bi, ci];
    const signs = [sa, sb, sc];
    const nPos = (sa ? 1 : 0) + (sb ? 1 : 0) + (sc ? 1 : 0);
    const si = nPos === 1 ? signs.findIndex((s) => s) : signs.findIndex((s) => !s);
    const i0 = raw[si], i1 = raw[(si + 1) % 3], i2 = raw[(si + 2) % 3];
    const onPos = dist[i0] >= 0;
    const P = getOrCreate(i0, i1);
    const Q = getOrCreate(i0, i2);
    const solo = onPos ? posIdx : negIdx;
    const other = onPos ? negIdx : posIdx;
    if (i0 !== P && P !== Q && Q !== i0) solo.push(i0, P, Q);
    if (i1 !== i2 && i2 !== Q && Q !== i1) other.push(i1, i2, Q);
    if (i1 !== Q && Q !== P && P !== i1) other.push(i1, Q, P);
  }
  const makeCompact = (tris) => {
    if (tris.length < 3) return null;
    const usedMap = /* @__PURE__ */ new Map();
    let nextIdx = 0;
    for (const vi of tris) {
      if (!usedMap.has(vi)) usedMap.set(vi, nextIdx++);
    }
    const compactPos = new Float32Array(nextIdx * 3);
    for (const [oldIdx, newIdx] of usedMap) {
      compactPos[newIdx * 3] = px[oldIdx];
      compactPos[newIdx * 3 + 1] = py[oldIdx];
      compactPos[newIdx * 3 + 2] = pz[oldIdx];
    }
    const compactTris = new Uint32Array(tris.length);
    for (let i = 0; i < tris.length; i++) {
      compactTris[i] = usedMap.get(tris[i]);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(compactPos, 3));
    g.setIndex(new THREE.BufferAttribute(compactTris, 1));
    return g;
  };
  return [makeCompact(posIdx), makeCompact(negIdx)];
}
async function splitMeshByClipping(geo, planes, onProgress) {
  let halves = [geo.index ? geo : await exactMergeVertices(geo)];
  for (let pi = 0; pi < planes.length; pi++) {
    const { normal, originOffset } = planes[pi];
    onProgress(pi, planes.length, `Cutting plane ${pi + 1} of ${planes.length} (direct clipping)\u2026`);
    await yieldToUI();
    const next = [];
    for (const half of halves) {
      const [pos, neg] = await clipByPlane(half, new THREE.Vector3(...normal), originOffset);
      if (pos) next.push(pos);
      if (neg) next.push(neg);
      half.dispose();
    }
    halves = next;
  }
  onProgress(planes.length, planes.length, "Capping cut surfaces\u2026");
  await yieldToUI();
  const { toCreasedNormals: toCreased, mergeVertices: mergeVerts } = await import("three/examples/jsm/utils/BufferGeometryUtils.js");
  const CREASE_ANGLE = Math.PI / 6;
  const parts = [];
  for (let i = 0; i < halves.length; i++) {
    onProgress(planes.length, planes.length, `Converting part ${i + 1} of ${halves.length}\u2026`);
    await yieldToUI();
    const capped = await fillHoles(halves[i]);
    if (capped !== halves[i]) halves[i].dispose();
    const vol = computeGeometryVolume(capped);
    const geometry = mergeVerts(toCreased(capped, CREASE_ANGLE));
    capped.dispose();
    geometry.computeBoundingBox();
    const bb = geometry.boundingBox;
    const size = new THREE.Vector3();
    bb.getSize(size);
    parts.push({
      geometry,
      label: `Part ${i + 1}`,
      triangleCount: capped.index ? capped.index.count / 3 : (capped.attributes.position?.count ?? 0) / 3,
      volumeMM3: parseFloat(vol.toFixed(2)),
      bbox: {
        x: parseFloat(size.x.toFixed(1)),
        y: parseFloat(size.y.toFixed(1)),
        z: parseFloat(size.z.toFixed(1))
      }
    });
  }
  return parts;
}
async function diagnoseMesh(geo) {
  const none = {
    openEdges: 0,
    nonManifoldEdges: 0,
    degenerateTris: 0,
    duplicateTris: 0,
    maxGapMM: 0,
    recommendedTol: 1e-4
  };
  if (!geo.index) return none;
  const pos = geo.attributes.position;
  const idx = geo.index;
  const nVerts = pos.count;
  const nTris = idx.count / 3;
  const edgeFreq = /* @__PURE__ */ new Map();
  for (let t = 0; t < nTris; t++) {
    if ((t & 65535) === 0) await yieldIfNeeded();
    const a = idx.getX(t * 3), b = idx.getX(t * 3 + 1), c = idx.getX(t * 3 + 2);
    for (const [u, v] of [[a, b], [b, c], [c, a]]) {
      const key = Math.min(u, v) * nVerts + Math.max(u, v);
      edgeFreq.set(key, (edgeFreq.get(key) ?? 0) + 1);
    }
  }
  let openEdges = 0, nonManifoldEdges = 0;
  const boundaryVerts = /* @__PURE__ */ new Set();
  for (const [key, count] of edgeFreq) {
    if (count === 1) {
      openEdges++;
      const lo = Math.floor(key / nVerts);
      boundaryVerts.add(lo);
      boundaryVerts.add(key - lo * nVerts);
    } else if (count > 2) {
      nonManifoldEdges++;
    }
  }
  let degenerateTris = 0;
  const dA = new THREE.Vector3(), dB = new THREE.Vector3(), dC = new THREE.Vector3();
  for (let t = 0; t < nTris; t++) {
    const ai = idx.getX(t * 3), bi = idx.getX(t * 3 + 1), ci = idx.getX(t * 3 + 2);
    if (ai === bi || bi === ci || ci === ai) {
      degenerateTris++;
      continue;
    }
    dA.fromBufferAttribute(pos, ai);
    dB.fromBufferAttribute(pos, bi).sub(dA);
    dC.fromBufferAttribute(pos, ci).sub(dA);
    if (dB.cross(dC).length() <= 1e-10) degenerateTris++;
  }
  const triSeen = /* @__PURE__ */ new Set();
  let duplicateTris = 0;
  for (let t = 0; t < nTris; t++) {
    const a = idx.getX(t * 3), b = idx.getX(t * 3 + 1), c = idx.getX(t * 3 + 2);
    const s = [a, b, c].sort((x, y) => x - y);
    const key = s[0] * 4e9 + s[1] * 1e5 + s[2];
    if (triSeen.has(key)) duplicateTris++;
    else triSeen.add(key);
  }
  const bvArr = Array.from(boundaryVerts);
  const gaps = [];
  if (bvArr.length > 1) {
    const maxSample = 500;
    const step = Math.max(1, Math.ceil(bvArr.length / maxSample));
    const sample = bvArr.filter((_, i) => i % step === 0);
    for (const vi of sample) {
      const vx = pos.getX(vi), vy = pos.getY(vi), vz = pos.getZ(vi);
      let minDist = Infinity;
      for (const vj of sample) {
        if (vi === vj) continue;
        const dx = pos.getX(vj) - vx, dy = pos.getY(vj) - vy, dz = pos.getZ(vj) - vz;
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (d > 0 && d < minDist) minDist = d;
      }
      if (minDist < Infinity) gaps.push(minDist);
    }
  }
  gaps.sort((a, b) => a - b);
  const maxGapMM = gaps.at(-1) ?? 0;
  const p5GapMM = gaps.length > 0 ? gaps[Math.floor(gaps.length * 0.05)] : 0;
  const refGap = p5GapMM > 0 ? p5GapMM : maxGapMM;
  const recommendedTol = refGap > 0 ? Math.min(0.1, Math.max(1e-4, refGap * 1.5)) : 1e-4;
  return { openEdges, nonManifoldEdges, degenerateTris, duplicateTris, maxGapMM, recommendedTol };
}
async function ensureOutwardNormals(geo) {
  if (!geo.index) return geo;
  const pos = geo.attributes.position;
  const idx = geo.index;
  let vol = 0;
  for (let t = 0; t < idx.count; t += 3) {
    const ai = idx.getX(t), bi = idx.getX(t + 1), ci = idx.getX(t + 2);
    const ax = pos.getX(ai), ay = pos.getY(ai), az = pos.getZ(ai);
    const bx = pos.getX(bi), by = pos.getY(bi), bz = pos.getZ(bi);
    const cx = pos.getX(ci), cy = pos.getY(ci), cz = pos.getZ(ci);
    vol += ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx);
  }
  if (vol >= 0) return geo;
  const newIdx = new Uint32Array(idx.count);
  for (let t = 0; t < idx.count; t += 3) {
    newIdx[t] = idx.getX(t);
    newIdx[t + 1] = idx.getX(t + 2);
    newIdx[t + 2] = idx.getX(t + 1);
  }
  const out = geo.clone();
  out.setIndex(new THREE.BufferAttribute(newIdx, 1));
  return out;
}
async function deduplicateTris(geo) {
  if (!geo.index) return geo;
  const idx = geo.index;
  const seen = /* @__PURE__ */ new Set();
  const good = [];
  let changed = false;
  for (let t = 0; t < idx.count; t += 3) {
    if ((t & 262140) === 0) await yieldIfNeeded();
    const a = idx.getX(t), b = idx.getX(t + 1), c = idx.getX(t + 2);
    const s = [a, b, c].sort((x, y) => x - y);
    const key = s[0] * 4e9 + s[1] * 1e5 + s[2];
    if (!seen.has(key)) {
      seen.add(key);
      good.push(a, b, c);
    } else {
      changed = true;
    }
  }
  if (!changed) return geo;
  const out = geo.clone();
  out.setIndex(new THREE.BufferAttribute(new Uint32Array(good), 1));
  return out;
}
async function fixWinding(geo) {
  if (!geo.index) return geo;
  const idx = geo.index;
  const nVerts = geo.attributes.position.count;
  const nTris = idx.count / 3;
  const edgeMap = /* @__PURE__ */ new Map();
  for (let t = 0; t < nTris; t++) {
    if ((t & 65535) === 0) await yieldIfNeeded();
    const verts = [idx.getX(t * 3), idx.getX(t * 3 + 1), idx.getX(t * 3 + 2)];
    for (let e = 0; e < 3; e++) {
      const u = verts[e], v = verts[(e + 1) % 3];
      const lo = Math.min(u, v), hi = Math.max(u, v);
      const key = lo * nVerts + hi;
      const arr = edgeMap.get(key);
      const entry = { tri: t, fwd: u === lo };
      if (arr) arr.push(entry);
      else edgeMap.set(key, [entry]);
    }
  }
  const triEdgeKeys = new Array(nTris);
  for (let t = 0; t < nTris; t++) {
    if ((t & 65535) === 0) await yieldIfNeeded();
    const verts = [idx.getX(t * 3), idx.getX(t * 3 + 1), idx.getX(t * 3 + 2)];
    triEdgeKeys[t] = verts.map((u, e) => {
      const v = verts[(e + 1) % 3];
      const lo = Math.min(u, v), hi = Math.max(u, v);
      return lo * nVerts + hi;
    });
  }
  const visited = new Uint8Array(nTris);
  const shouldFlip = new Uint8Array(nTris);
  for (let seed = 0; seed < nTris; seed++) {
    if (visited[seed]) continue;
    visited[seed] = 1;
    const queue = [seed];
    while (queue.length > 0) {
      const t = queue.pop();
      for (const edgeKey of triEdgeKeys[t]) {
        const neighbors = edgeMap.get(edgeKey);
        if (!neighbors || neighbors.length !== 2) continue;
        const me = neighbors[0].tri === t ? neighbors[0] : neighbors[1];
        const nb = neighbors[0].tri === t ? neighbors[1] : neighbors[0];
        if (visited[nb.tri]) continue;
        visited[nb.tri] = 1;
        const sameDir = me.fwd === nb.fwd;
        shouldFlip[nb.tri] = shouldFlip[t] ^ (sameDir ? 1 : 0);
        queue.push(nb.tri);
      }
    }
  }
  let anyFlip = false;
  for (let t = 0; t < nTris; t++) {
    if (shouldFlip[t]) {
      anyFlip = true;
      break;
    }
  }
  if (!anyFlip) return geo;
  const newIdxArr = new Uint32Array(idx.count);
  for (let t = 0; t < nTris; t++) {
    const a = idx.getX(t * 3), b = idx.getX(t * 3 + 1), c = idx.getX(t * 3 + 2);
    if (shouldFlip[t]) {
      newIdxArr[t * 3] = a;
      newIdxArr[t * 3 + 1] = c;
      newIdxArr[t * 3 + 2] = b;
    } else {
      newIdxArr[t * 3] = a;
      newIdxArr[t * 3 + 1] = b;
      newIdxArr[t * 3 + 2] = c;
    }
  }
  const out = geo.clone();
  out.setIndex(new THREE.BufferAttribute(newIdxArr, 1));
  return out;
}
function earClip2D(pts, origIndices, interiorEdges, nVerts) {
  const n = pts.length;
  if (n < 3) return [];
  if (n === 3) return [0, 1, 2];
  let area2 = 0;
  for (let i = 0; i < n; i++) {
    const [ax, ay] = pts[i], [bx, by] = pts[(i + 1) % n];
    area2 += ax * by - bx * ay;
  }
  const ccw = area2 > 0;
  const cross2 = (ax, ay, bx, by, cx, cy) => (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  const inTriangle = (px, py, ax, ay, bx, by, cx, cy) => {
    const eps = 1e-10;
    const d1 = cross2(ax, ay, bx, by, px, py);
    const d2 = cross2(bx, by, cx, cy, px, py);
    const d3 = cross2(cx, cy, ax, ay, px, py);
    return !((d1 < -eps || d2 < -eps || d3 < -eps) && (d1 > eps || d2 > eps || d3 > eps));
  };
  const hasInteriorCheck = origIndices && interiorEdges && interiorEdges.size > 0 && nVerts;
  const poly = Array.from({ length: n }, (_, i) => i);
  const result = [];
  let maxIter = n * n + n + 10;
  while (poly.length > 3 && maxIter-- > 0) {
    let found = false;
    for (let i = 0; i < poly.length; i++) {
      const pi = poly[(i - 1 + poly.length) % poly.length];
      const ci = poly[i];
      const ni = poly[(i + 1) % poly.length];
      const [ax, ay] = pts[pi], [bx, by] = pts[ci], [cx, cy] = pts[ni];
      const c = cross2(ax, ay, bx, by, cx, cy);
      if (ccw ? c <= 0 : c >= 0) continue;
      let inside = false;
      for (let j = 0; j < poly.length; j++) {
        const k = poly[j];
        if (k === pi || k === ci || k === ni) continue;
        if (inTriangle(pts[k][0], pts[k][1], ax, ay, bx, by, cx, cy)) {
          inside = true;
          break;
        }
      }
      if (inside) continue;
      if (hasInteriorCheck) {
        const oi = origIndices[pi], oj = origIndices[ni];
        const lo = Math.min(oi, oj), hi = Math.max(oi, oj);
        if (interiorEdges.has(lo * nVerts + hi)) continue;
      }
      result.push(pi, ci, ni);
      poly.splice(i, 1);
      found = true;
      break;
    }
    if (!found) break;
  }
  if (poly.length === 3) result.push(poly[0], poly[1], poly[2]);
  return result;
}
function triangulatePlanar(loop, pos, interiorEdges, nVerts) {
  const n = loop.length;
  if (n < 3) return [];
  if (n === 3) return [loop[1], loop[0], loop[2]];
  if (n > 8e3) return [];
  let nx = 0, ny = 0, nz = 0;
  for (let i = 0; i < n; i++) {
    const a = loop[i], b = loop[(i + 1) % n];
    const ax = pos.getX(a), ay = pos.getY(a), az = pos.getZ(a);
    const bx = pos.getX(b), by = pos.getY(b), bz = pos.getZ(b);
    nx += (ay - by) * (az + bz);
    ny += (az - bz) * (ax + bx);
    nz += (ax - bx) * (ay + by);
  }
  const nl = Math.sqrt(nx * nx + ny * ny + nz * nz);
  if (nl < 1e-10) return [];
  nx /= nl;
  ny /= nl;
  nz /= nl;
  let ux = 1 - nx * nx, uy = -nx * ny, uz = -nx * nz;
  const ul = Math.sqrt(ux * ux + uy * uy + uz * uz);
  if (ul < 1e-6) {
    ux = 0;
    uy = 1;
    uz = 0;
  } else {
    ux /= ul;
    uy /= ul;
    uz /= ul;
  }
  const vx = ny * uz - nz * uy, vy = nz * ux - nx * uz, vz = nx * uy - ny * ux;
  const pts = loop.map((vi) => [
    pos.getX(vi) * ux + pos.getY(vi) * uy + pos.getZ(vi) * uz,
    pos.getX(vi) * vx + pos.getY(vi) * vy + pos.getZ(vi) * vz
  ]);
  const localTris = earClip2D(pts, loop, interiorEdges, nVerts);
  if (localTris.length === 0) return [];
  const result = [];
  for (let i = 0; i < localTris.length; i += 3) {
    result.push(loop[localTris[i + 1]], loop[localTris[i]], loop[localTris[i + 2]]);
  }
  return result;
}
async function fillHoles(geo) {
  if (!geo.index) return geo;
  const pos = geo.attributes.position;
  const idx = geo.index;
  const nVerts = pos.count;
  const halfEdgeSet = /* @__PURE__ */ new Set();
  for (let t = 0; t < idx.count; t += 3) {
    if ((t & 262140) === 0) await yieldIfNeeded();
    const a = idx.getX(t), b = idx.getX(t + 1), c = idx.getX(t + 2);
    halfEdgeSet.add(a * nVerts + b);
    halfEdgeSet.add(b * nVerts + c);
    halfEdgeSet.add(c * nVerts + a);
  }
  const boundaryAdj = /* @__PURE__ */ new Map();
  for (const key of halfEdgeSet) {
    const from = Math.floor(key / nVerts);
    const to = key - from * nVerts;
    if (!halfEdgeSet.has(to * nVerts + from)) {
      const arr = boundaryAdj.get(from);
      if (arr) arr.push(to);
      else boundaryAdj.set(from, [to]);
    }
  }
  if (boundaryAdj.size === 0) return geo;
  const interiorEdges = /* @__PURE__ */ new Set();
  for (const key of halfEdgeSet) {
    const from = Math.floor(key / nVerts);
    const to = key - from * nVerts;
    if (halfEdgeSet.has(to * nVerts + from)) {
      const lo = Math.min(from, to), hi = Math.max(from, to);
      interiorEdges.add(lo * nVerts + hi);
    }
  }
  const usedEdges = /* @__PURE__ */ new Set();
  const loops = [];
  for (const start of boundaryAdj.keys()) {
    const startAdj = boundaryAdj.get(start);
    for (const firstTo of startAdj) {
      const startEdgeKey = start * nVerts + firstTo;
      if (usedEdges.has(startEdgeKey)) continue;
      const loop = [start];
      usedEdges.add(startEdgeKey);
      let cur = firstTo;
      let safety = 0;
      const maxIter = halfEdgeSet.size;
      while (cur !== start && safety++ < maxIter) {
        loop.push(cur);
        const adj = boundaryAdj.get(cur);
        if (!adj) break;
        let next = -1;
        for (const cand of adj) {
          if (!usedEdges.has(cur * nVerts + cand)) {
            next = cand;
            break;
          }
        }
        if (next === -1) break;
        usedEdges.add(cur * nVerts + next);
        cur = next;
      }
      if (loop.length >= 3 && cur === start) loops.push(loop);
    }
  }
  if (loops.length === 0) return geo;
  const oldPos = pos.array;
  const fillIdx = [];
  const extraPos = [];
  let extraBase = nVerts;
  for (const loop of loops) {
    const tris = triangulatePlanar(loop, pos, interiorEdges, nVerts);
    if (tris.length > 0) {
      for (const vi of tris) fillIdx.push(vi);
    } else {
      let cx = 0, cy = 0, cz = 0;
      for (const vi of loop) {
        cx += oldPos[vi * 3];
        cy += oldPos[vi * 3 + 1];
        cz += oldPos[vi * 3 + 2];
      }
      cx /= loop.length;
      cy /= loop.length;
      cz /= loop.length;
      const centroidIdx = extraBase + extraPos.length / 3;
      extraPos.push(cx, cy, cz);
      for (let i = 0; i < loop.length; i++) {
        const a = loop[i], b = loop[(i + 1) % loop.length];
        fillIdx.push(b, a, centroidIdx);
      }
    }
  }
  const totalVerts = nVerts + extraPos.length / 3;
  const finalPos = new Float32Array(totalVerts * 3);
  finalPos.set(oldPos);
  for (let i = 0; i < extraPos.length; i++) finalPos[nVerts * 3 + i] = extraPos[i];
  const oldIdxArr = idx.array;
  const finalIdx = new Uint32Array(oldIdxArr.length + fillIdx.length);
  finalIdx.set(oldIdxArr);
  for (let i = 0; i < fillIdx.length; i++) finalIdx[oldIdxArr.length + i] = fillIdx[i];
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.BufferAttribute(finalPos, 3));
  out.setIndex(new THREE.BufferAttribute(finalIdx, 1));
  return out;
}
async function exactMergeVertices(geo) {
  if (geo.index) return geo;
  const pos = geo.attributes.position;
  const posArr = pos.array;
  const u32 = new Uint32Array(posArr.buffer, posArr.byteOffset, posArr.length);
  const nVerts = pos.count;
  const hash3 = (a, b, c) => Math.imul(Math.imul(a ^ Math.imul(b, 2654435761), 2246822519) ^ c, 3266489917) >>> 0;
  const hashMap = /* @__PURE__ */ new Map();
  const newPos = new Float32Array(nVerts * 3);
  let uniqueCount = 0;
  const indices = new Uint32Array(nVerts);
  for (let i = 0; i < nVerts; i++) {
    if ((i & 65535) === 0) await yieldIfNeeded();
    const a = u32[i * 3], b = u32[i * 3 + 1], c = u32[i * 3 + 2];
    const h = hash3(a, b, c);
    let found = -1;
    const bucket = hashMap.get(h);
    if (bucket) {
      for (const e of bucket) {
        if (e[1] === a && e[2] === b && e[3] === c) {
          found = e[0];
          break;
        }
      }
    }
    if (found === -1) {
      found = uniqueCount++;
      newPos[found * 3] = posArr[i * 3];
      newPos[found * 3 + 1] = posArr[i * 3 + 1];
      newPos[found * 3 + 2] = posArr[i * 3 + 2];
      const entry = [found, a, b, c];
      if (bucket) bucket.push(entry);
      else hashMap.set(h, [entry]);
    }
    indices[i] = found;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.BufferAttribute(newPos.subarray(0, uniqueCount * 3), 3));
  out.setIndex(new THREE.BufferAttribute(indices, 1));
  return out;
}
async function removeDegenerates(geo) {
  if (!geo.index) return geo;
  const pos = geo.attributes.position;
  const idx = geo.index;
  const goodTris = [];
  const vA = new THREE.Vector3(), vB = new THREE.Vector3(), vC = new THREE.Vector3();
  for (let t = 0; t < idx.count; t += 3) {
    if ((t & 262140) === 0) await yieldIfNeeded();
    const ai = idx.getX(t), bi = idx.getX(t + 1), ci = idx.getX(t + 2);
    if (ai === bi || bi === ci || ci === ai) continue;
    vA.fromBufferAttribute(pos, ai);
    vB.fromBufferAttribute(pos, bi);
    vC.fromBufferAttribute(pos, ci);
    const area = vB.clone().sub(vA).cross(vC.clone().sub(vA)).length();
    if (area > 1e-10) goodTris.push(ai, bi, ci);
  }
  if (goodTris.length === idx.count) return geo;
  const out = geo.clone();
  out.setIndex(new THREE.BufferAttribute(new Uint32Array(goodTris), 1));
  return out;
}
async function repairMesh(geo, onProgress) {
  const { mergeVertices } = await import("three/examples/jsm/utils/BufferGeometryUtils.js");
  const stats = {
    degeneratesRemoved: 0,
    duplicatesRemoved: 0,
    windingFixed: 0,
    invertedNormalsFixed: false,
    weldToleranceMM: 0,
    holesFilled: 0,
    isWatertight: false
  };
  onProgress(0, 6, "Inspecting mesh\u2026");
  await yieldToUI();
  const nonIndexed = geo.index ? geo.toNonIndexed() : geo;
  const exact = await exactMergeVertices(nonIndexed);
  const dxExact = await diagnoseMesh(exact);
  let g;
  let weldTol;
  if (dxExact.openEdges === 0) {
    g = exact;
    weldTol = 0;
    onProgress(1, 6, "Vertices deduplicated (exact match \u2014 no epsilon needed)\u2026");
  } else {
    weldTol = dxExact.recommendedTol;
    onProgress(1, 6, `Welding seams (\xB1${weldTol.toFixed(weldTol < 0.01 ? 4 : 2)} mm)\u2026`);
    g = mergeVertices(nonIndexed, weldTol);
  }
  await yieldToUI();
  stats.weldToleranceMM = weldTol;
  onProgress(2, 6, "Removing degenerate triangles\u2026");
  await yieldToUI();
  const beforeDegen = g.index ? g.index.count / 3 : 0;
  g = await removeDegenerates(g);
  const afterDegen = g.index ? g.index.count / 3 : 0;
  stats.degeneratesRemoved = beforeDegen - afterDegen;
  onProgress(3, 6, "Removing duplicate triangles\u2026");
  await yieldToUI();
  const beforeDup = g.index ? g.index.count / 3 : 0;
  g = await deduplicateTris(g);
  const afterDup = g.index ? g.index.count / 3 : 0;
  stats.duplicatesRemoved = beforeDup - afterDup;
  onProgress(4, 6, "Fixing winding consistency\u2026");
  await yieldToUI();
  const beforeWinding = g.index ? new Uint32Array(g.index.array) : null;
  g = await fixWinding(g);
  if (beforeWinding && g.index) {
    let diffs = 0;
    for (let i = 0; i < beforeWinding.length; i += 3) {
      if (beforeWinding[i + 1] !== g.index.getX(i + 1)) diffs++;
    }
    stats.windingFixed = diffs;
  }
  const gInward = g;
  g = await ensureOutwardNormals(g);
  stats.invertedNormalsFixed = g !== gInward;
  onProgress(5, 6, "Filling holes\u2026");
  await yieldToUI();
  const diagBefore = await diagnoseMesh(g);
  const gFilled = await fillHoles(g);
  const diagAfter = await diagnoseMesh(gFilled);
  stats.holesFilled = diagBefore.openEdges - diagAfter.openEdges;
  g = gFilled;
  stats.isWatertight = diagAfter.openEdges === 0 && diagAfter.nonManifoldEdges === 0;
  onProgress(6, 6, "Applying creased normals\u2026");
  await yieldToUI();
  const { toCreasedNormals, mergeVertices: mergeVerts2 } = await import("three/examples/jsm/utils/BufferGeometryUtils.js");
  const REPAIR_CREASE_ANGLE = Math.PI / 6;
  const indexed = g.index ? g : mergeVerts2(g);
  g = mergeVerts2(toCreasedNormals(indexed, REPAIR_CREASE_ANGLE));
  return { geometry: g, stats };
}
async function repairSplitPart(geo, onProgress) {
  const stats = {
    degeneratesRemoved: 0,
    duplicatesRemoved: 0,
    windingFixed: 0,
    invertedNormalsFixed: false,
    weldToleranceMM: 0,
    holesFilled: 0,
    isWatertight: false
  };
  onProgress(0, 3, "Deduplicating vertices\u2026");
  await yieldToUI();
  let g;
  if (geo.index) {
    g = geo.clone();
  } else {
    g = await exactMergeVertices(geo);
  }
  onProgress(1, 3, "Removing degenerate triangles\u2026");
  await yieldToUI();
  const beforeDegen = g.index ? g.index.count / 3 : 0;
  g = await removeDegenerates(g);
  const afterDegen = g.index ? g.index.count / 3 : 0;
  stats.degeneratesRemoved = beforeDegen - afterDegen;
  onProgress(2, 3, "Removing duplicate triangles\u2026");
  await yieldToUI();
  const beforeDup = g.index ? g.index.count / 3 : 0;
  g = await deduplicateTris(g);
  const afterDup = g.index ? g.index.count / 3 : 0;
  stats.duplicatesRemoved = beforeDup - afterDup;
  const dx = await diagnoseMesh(g);
  stats.isWatertight = dx.openEdges === 0 && dx.nonManifoldEdges === 0;
  onProgress(3, 3, "Done");
  await yieldToUI();
  g.computeVertexNormals();
  return { geometry: g, stats };
}
function computeGeometryVolume(geo) {
  const pos = geo.attributes.position;
  const idx = geo.index;
  const count = pos.count;
  if (count < 3) return 0;
  let cx = 0, cy = 0, cz = 0;
  for (let i = 0; i < count; i++) {
    cx += pos.getX(i);
    cy += pos.getY(i);
    cz += pos.getZ(i);
  }
  cx /= count;
  cy /= count;
  cz /= count;
  let vol = 0;
  if (idx) {
    for (let t = 0; t < idx.count; t += 3) {
      const ai = idx.getX(t), bi = idx.getX(t + 1), ci = idx.getX(t + 2);
      const ax = pos.getX(ai) - cx, ay = pos.getY(ai) - cy, az = pos.getZ(ai) - cz;
      const bx = pos.getX(bi) - cx, by = pos.getY(bi) - cy, bz = pos.getZ(bi) - cz;
      const ex = pos.getX(ci) - cx, ey = pos.getY(ci) - cy, ez = pos.getZ(ci) - cz;
      vol += (ax * (by * ez - bz * ey) + ay * (bz * ex - bx * ez) + az * (bx * ey - by * ex)) / 6;
    }
  } else {
    for (let t = 0; t < count; t += 3) {
      const ax = pos.getX(t) - cx, ay = pos.getY(t) - cy, az = pos.getZ(t) - cz;
      const bx = pos.getX(t + 1) - cx, by = pos.getY(t + 1) - cy, bz = pos.getZ(t + 1) - cz;
      const ex = pos.getX(t + 2) - cx, ey = pos.getY(t + 2) - cy, ez = pos.getZ(t + 2) - cz;
      vol += (ax * (by * ez - bz * ey) + ay * (bz * ex - bx * ez) + az * (bx * ey - by * ex)) / 6;
    }
  }
  geo.computeBoundingBox();
  if (geo.boundingBox) {
    const size = new THREE.Vector3();
    geo.boundingBox.getSize(size);
    const bboxVol = size.x * size.y * size.z;
    return Math.min(Math.abs(vol), bboxVol);
  }
  return Math.abs(vol);
}
export {
  computeGeometryVolume,
  getManifoldAPI,
  repairMesh,
  repairSplitPart,
  splitMesh,
  viewportPlaneToEngine
};
