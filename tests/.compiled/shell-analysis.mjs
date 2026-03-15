import { createRequire } from "node:module"; const require = createRequire(import.meta.url);
var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
class UnionFind {
  constructor(n) {
    __publicField(this, "parent");
    __publicField(this, "rank");
    this.parent = new Uint32Array(n);
    this.rank = new Uint32Array(n);
    for (let i = 0; i < n; i++) this.parent[i] = i;
  }
  find(x) {
    while (this.parent[x] !== x) {
      this.parent[x] = this.parent[this.parent[x]];
      x = this.parent[x];
    }
    return x;
  }
  union(a, b) {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra === rb) return;
    if (this.rank[ra] < this.rank[rb]) {
      this.parent[ra] = rb;
    } else if (this.rank[ra] > this.rank[rb]) {
      this.parent[rb] = ra;
    } else {
      this.parent[rb] = ra;
      this.rank[ra]++;
    }
  }
}
function analyzeShells(geometry) {
  const posAttr = geometry.getAttribute("position");
  if (!posAttr) {
    return { shellCount: 0, shells: [], largestShellTriangles: 0, tinyShellCount: 0 };
  }
  const positions = posAttr.array;
  const vertexCount = posAttr.count;
  const index = geometry.getIndex();
  let triCount;
  let triIdx;
  if (index) {
    triCount = Math.floor(index.count / 3);
    const idxArr = index.array;
    triIdx = (tri, corner) => idxArr[tri * 3 + corner];
  } else {
    triCount = Math.floor(vertexCount / 3);
    triIdx = (tri, corner) => tri * 3 + corner;
  }
  if (triCount > 5e6) {
    const bbox = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
    for (let i = 0; i < vertexCount; i++) {
      const x = positions[i * 3], y = positions[i * 3 + 1], z = positions[i * 3 + 2];
      bbox[0] = Math.min(bbox[0], x);
      bbox[1] = Math.min(bbox[1], y);
      bbox[2] = Math.min(bbox[2], z);
      bbox[3] = Math.max(bbox[3], x);
      bbox[4] = Math.max(bbox[4], y);
      bbox[5] = Math.max(bbox[5], z);
    }
    return {
      shellCount: 1,
      shells: [{
        id: 0,
        triangleCount: triCount,
        vertexCount,
        bbox,
        centroid: [(bbox[0] + bbox[3]) / 2, (bbox[1] + bbox[4]) / 2, (bbox[2] + bbox[5]) / 2],
        surfaceArea: 0,
        triangleIndices: new Uint32Array(0)
        // skip for perf
      }],
      largestShellTriangles: triCount,
      tinyShellCount: 0
    };
  }
  const uf = new UnionFind(vertexCount);
  for (let t = 0; t < triCount; t++) {
    const i0 = triIdx(t, 0);
    const i1 = triIdx(t, 1);
    const i2 = triIdx(t, 2);
    uf.union(i0, i1);
    uf.union(i1, i2);
  }
  const rootToId = /* @__PURE__ */ new Map();
  let nextId = 0;
  const triComponent = new Uint32Array(triCount);
  const componentTriCounts = /* @__PURE__ */ new Map();
  for (let t = 0; t < triCount; t++) {
    const root = uf.find(triIdx(t, 0));
    let compId = rootToId.get(root);
    if (compId === void 0) {
      compId = nextId++;
      rootToId.set(root, compId);
    }
    triComponent[t] = compId;
    componentTriCounts.set(compId, (componentTriCounts.get(compId) ?? 0) + 1);
  }
  const sortedIds = [...componentTriCounts.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
  const idRemap = /* @__PURE__ */ new Map();
  sortedIds.forEach((oldId, newId) => idRemap.set(oldId, newId));
  const shellTriIndices = Array.from({ length: sortedIds.length }, () => []);
  const shellVertexSets = Array.from({ length: sortedIds.length }, () => /* @__PURE__ */ new Set());
  const shellBboxes = sortedIds.map(
    () => [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]
  );
  const shellAreas = new Array(sortedIds.length).fill(0);
  for (let t = 0; t < triCount; t++) {
    const newId = idRemap.get(triComponent[t]);
    shellTriIndices[newId].push(t);
    const i0 = triIdx(t, 0), i1 = triIdx(t, 1), i2 = triIdx(t, 2);
    shellVertexSets[newId].add(i0);
    shellVertexSets[newId].add(i1);
    shellVertexSets[newId].add(i2);
    const bb = shellBboxes[newId];
    for (const vi of [i0, i1, i2]) {
      const x = positions[vi * 3], y = positions[vi * 3 + 1], z = positions[vi * 3 + 2];
      bb[0] = Math.min(bb[0], x);
      bb[1] = Math.min(bb[1], y);
      bb[2] = Math.min(bb[2], z);
      bb[3] = Math.max(bb[3], x);
      bb[4] = Math.max(bb[4], y);
      bb[5] = Math.max(bb[5], z);
    }
    const ax = positions[i1 * 3] - positions[i0 * 3];
    const ay = positions[i1 * 3 + 1] - positions[i0 * 3 + 1];
    const az = positions[i1 * 3 + 2] - positions[i0 * 3 + 2];
    const bx = positions[i2 * 3] - positions[i0 * 3];
    const by = positions[i2 * 3 + 1] - positions[i0 * 3 + 1];
    const bz = positions[i2 * 3 + 2] - positions[i0 * 3 + 2];
    const cx = ay * bz - az * by;
    const cy = az * bx - ax * bz;
    const cz = ax * by - ay * bx;
    shellAreas[newId] += Math.sqrt(cx * cx + cy * cy + cz * cz) * 0.5;
  }
  const shells = sortedIds.map((_, newId) => {
    const bb = shellBboxes[newId];
    const tris = shellTriIndices[newId];
    return {
      id: newId,
      triangleCount: tris.length,
      vertexCount: shellVertexSets[newId].size,
      bbox: bb,
      centroid: [(bb[0] + bb[3]) / 2, (bb[1] + bb[4]) / 2, (bb[2] + bb[5]) / 2],
      surfaceArea: shellAreas[newId],
      triangleIndices: new Uint32Array(tris)
    };
  });
  const tinyThreshold = triCount * 0.01;
  const tinyShellCount = shells.filter((s) => s.triangleCount < tinyThreshold).length;
  return {
    shellCount: shells.length,
    shells,
    largestShellTriangles: shells[0]?.triangleCount ?? 0,
    tinyShellCount
  };
}
function removeSmallShells(geometry, shellResult, minTriangles) {
  const keepShells = shellResult.shells.filter((s) => s.triangleCount >= minTriangles);
  const removedCount = shellResult.shellCount - keepShells.length;
  if (removedCount === 0) {
    return { geometry: geometry.clone(), removedCount: 0 };
  }
  const keepTriSet = /* @__PURE__ */ new Set();
  for (const shell of keepShells) {
    for (let i = 0; i < shell.triangleIndices.length; i++) {
      keepTriSet.add(shell.triangleIndices[i]);
    }
  }
  const posAttr = geometry.getAttribute("position");
  const positions = posAttr.array;
  const index = geometry.getIndex();
  const normals = geometry.getAttribute("normal")?.array;
  let triIdx;
  if (index) {
    const idxArr = index.array;
    triIdx = (tri, corner) => idxArr[tri * 3 + corner];
  } else {
    triIdx = (tri, corner) => tri * 3 + corner;
  }
  const vertexRemap = /* @__PURE__ */ new Map();
  const newPositions = [];
  const newNormals = [];
  const newIndices = [];
  for (const tri of keepTriSet) {
    for (let c = 0; c < 3; c++) {
      const oldVi = triIdx(tri, c);
      if (!vertexRemap.has(oldVi)) {
        const newVi = newPositions.length / 3;
        vertexRemap.set(oldVi, newVi);
        newPositions.push(positions[oldVi * 3], positions[oldVi * 3 + 1], positions[oldVi * 3 + 2]);
        if (normals) {
          newNormals.push(normals[oldVi * 3], normals[oldVi * 3 + 1], normals[oldVi * 3 + 2]);
        }
      }
      newIndices.push(vertexRemap.get(oldVi));
    }
  }
  const THREE = require("three");
  const newGeo = new THREE.BufferGeometry();
  newGeo.setAttribute("position", new THREE.Float32BufferAttribute(newPositions, 3));
  if (newNormals.length > 0) {
    newGeo.setAttribute("normal", new THREE.Float32BufferAttribute(newNormals, 3));
  }
  newGeo.setIndex(newIndices);
  newGeo.computeBoundingBox();
  newGeo.computeBoundingSphere();
  return { geometry: newGeo, removedCount };
}
export {
  analyzeShells,
  removeSmallShells
};
