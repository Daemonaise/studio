/**
 * Shell / connected-component analysis for mesh geometry.
 *
 * Uses Union-Find on the vertex index to group triangles into connected shells,
 * then returns per-shell metadata (triangle count, vertex count, bounding box, centroid).
 * Runs entirely client-side on the BufferGeometry index.
 */

import type { BufferGeometry } from "three";

export interface ShellInfo {
  /** Shell index (0-based, sorted by descending triangle count). */
  id: number;
  /** Number of triangles in this shell. */
  triangleCount: number;
  /** Number of unique vertices in this shell. */
  vertexCount: number;
  /** Axis-aligned bounding box [minX, minY, minZ, maxX, maxY, maxZ]. */
  bbox: [number, number, number, number, number, number];
  /** Centroid of the shell [x, y, z]. */
  centroid: [number, number, number];
  /** Surface area estimate in mm². */
  surfaceArea: number;
  /** Original triangle indices belonging to this shell. */
  triangleIndices: Uint32Array;
}

export interface ShellAnalysisResult {
  /** Total shell count. */
  shellCount: number;
  /** Shells sorted by descending triangle count. */
  shells: ShellInfo[];
  /** Triangle count of the largest shell. */
  largestShellTriangles: number;
  /** Number of "tiny" shells (< 1% of total triangles). */
  tinyShellCount: number;
}

// ── Union-Find ──────────────────────────────────────────────────────────────

class UnionFind {
  parent: Uint32Array;
  rank: Uint32Array;

  constructor(n: number) {
    this.parent = new Uint32Array(n);
    this.rank = new Uint32Array(n);
    for (let i = 0; i < n; i++) this.parent[i] = i;
  }

  find(x: number): number {
    while (this.parent[x] !== x) {
      this.parent[x] = this.parent[this.parent[x]]; // path halving
      x = this.parent[x];
    }
    return x;
  }

  union(a: number, b: number): void {
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

/**
 * Decompose a BufferGeometry into connected shells.
 * For meshes > 5M triangles this is skipped (returns single shell).
 */
export function analyzeShells(geometry: BufferGeometry): ShellAnalysisResult {
  const posAttr = geometry.getAttribute("position");
  if (!posAttr) {
    return { shellCount: 0, shells: [], largestShellTriangles: 0, tinyShellCount: 0 };
  }

  const positions = posAttr.array as Float32Array;
  const vertexCount = posAttr.count;
  const index = geometry.getIndex();

  let triCount: number;
  let triIdx: (tri: number, corner: number) => number;

  if (index) {
    triCount = Math.floor(index.count / 3);
    const idxArr = index.array;
    triIdx = (tri, corner) => idxArr[tri * 3 + corner];
  } else {
    triCount = Math.floor(vertexCount / 3);
    triIdx = (tri, corner) => tri * 3 + corner;
  }

  // For very large meshes, return single-shell placeholder
  if (triCount > 5_000_000) {
    const bbox: [number, number, number, number, number, number] = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
    for (let i = 0; i < vertexCount; i++) {
      const x = positions[i * 3], y = positions[i * 3 + 1], z = positions[i * 3 + 2];
      bbox[0] = Math.min(bbox[0], x); bbox[1] = Math.min(bbox[1], y); bbox[2] = Math.min(bbox[2], z);
      bbox[3] = Math.max(bbox[3], x); bbox[4] = Math.max(bbox[4], y); bbox[5] = Math.max(bbox[5], z);
    }
    return {
      shellCount: 1,
      shells: [{
        id: 0, triangleCount: triCount, vertexCount,
        bbox,
        centroid: [(bbox[0] + bbox[3]) / 2, (bbox[1] + bbox[4]) / 2, (bbox[2] + bbox[5]) / 2],
        surfaceArea: 0,
        triangleIndices: new Uint32Array(0), // skip for perf
      }],
      largestShellTriangles: triCount,
      tinyShellCount: 0,
    };
  }

  // Union-Find on vertices connected by triangle edges
  const uf = new UnionFind(vertexCount);
  for (let t = 0; t < triCount; t++) {
    const i0 = triIdx(t, 0);
    const i1 = triIdx(t, 1);
    const i2 = triIdx(t, 2);
    uf.union(i0, i1);
    uf.union(i1, i2);
  }

  // Map root → component id
  const rootToId = new Map<number, number>();
  let nextId = 0;

  // Assign each triangle to a component
  const triComponent = new Uint32Array(triCount);
  const componentTriCounts = new Map<number, number>();

  for (let t = 0; t < triCount; t++) {
    const root = uf.find(triIdx(t, 0));
    let compId = rootToId.get(root);
    if (compId === undefined) {
      compId = nextId++;
      rootToId.set(root, compId);
    }
    triComponent[t] = compId;
    componentTriCounts.set(compId, (componentTriCounts.get(compId) ?? 0) + 1);
  }

  // Sort components by triangle count descending
  const sortedIds = [...componentTriCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([id]) => id);

  // Remap ids so largest shell = 0
  const idRemap = new Map<number, number>();
  sortedIds.forEach((oldId, newId) => idRemap.set(oldId, newId));

  // Build per-shell data
  const shellTriIndices: number[][] = Array.from({ length: sortedIds.length }, () => []);
  const shellVertexSets: Set<number>[] = Array.from({ length: sortedIds.length }, () => new Set());
  const shellBboxes: [number, number, number, number, number, number][] = sortedIds.map(
    () => [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]
  );
  const shellAreas: number[] = new Array(sortedIds.length).fill(0);

  for (let t = 0; t < triCount; t++) {
    const newId = idRemap.get(triComponent[t])!;
    shellTriIndices[newId].push(t);

    const i0 = triIdx(t, 0), i1 = triIdx(t, 1), i2 = triIdx(t, 2);
    shellVertexSets[newId].add(i0);
    shellVertexSets[newId].add(i1);
    shellVertexSets[newId].add(i2);

    // Update bbox
    const bb = shellBboxes[newId];
    for (const vi of [i0, i1, i2]) {
      const x = positions[vi * 3], y = positions[vi * 3 + 1], z = positions[vi * 3 + 2];
      bb[0] = Math.min(bb[0], x); bb[1] = Math.min(bb[1], y); bb[2] = Math.min(bb[2], z);
      bb[3] = Math.max(bb[3], x); bb[4] = Math.max(bb[4], y); bb[5] = Math.max(bb[5], z);
    }

    // Compute triangle area (cross product magnitude / 2)
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

  const shells: ShellInfo[] = sortedIds.map((_, newId) => {
    const bb = shellBboxes[newId];
    const tris = shellTriIndices[newId];
    return {
      id: newId,
      triangleCount: tris.length,
      vertexCount: shellVertexSets[newId].size,
      bbox: bb,
      centroid: [(bb[0] + bb[3]) / 2, (bb[1] + bb[4]) / 2, (bb[2] + bb[5]) / 2],
      surfaceArea: shellAreas[newId],
      triangleIndices: new Uint32Array(tris),
    };
  });

  const tinyThreshold = triCount * 0.01;
  const tinyShellCount = shells.filter((s) => s.triangleCount < tinyThreshold).length;

  return {
    shellCount: shells.length,
    shells,
    largestShellTriangles: shells[0]?.triangleCount ?? 0,
    tinyShellCount,
  };
}

/**
 * Remove shells smaller than the given triangle threshold from a geometry.
 * Returns a new BufferGeometry with only the kept shells.
 */
export function removeSmallShells(
  geometry: BufferGeometry,
  shellResult: ShellAnalysisResult,
  minTriangles: number,
): { geometry: BufferGeometry; removedCount: number } {
  const keepShells = shellResult.shells.filter((s) => s.triangleCount >= minTriangles);
  const removedCount = shellResult.shellCount - keepShells.length;

  if (removedCount === 0) {
    return { geometry: geometry.clone(), removedCount: 0 };
  }

  // Gather kept triangle indices
  const keepTriSet = new Set<number>();
  for (const shell of keepShells) {
    for (let i = 0; i < shell.triangleIndices.length; i++) {
      keepTriSet.add(shell.triangleIndices[i]);
    }
  }

  const posAttr = geometry.getAttribute("position");
  const positions = posAttr.array as Float32Array;
  const index = geometry.getIndex();
  const normals = geometry.getAttribute("normal")?.array as Float32Array | undefined;

  let triIdx: (tri: number, corner: number) => number;
  if (index) {
    const idxArr = index.array;
    triIdx = (tri, corner) => idxArr[tri * 3 + corner];
  } else {
    triIdx = (tri, corner) => tri * 3 + corner;
  }

  // Build new vertex & index arrays
  const vertexRemap = new Map<number, number>();
  const newPositions: number[] = [];
  const newNormals: number[] = [];
  const newIndices: number[] = [];

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
      newIndices.push(vertexRemap.get(oldVi)!);
    }
  }

  // Import THREE dynamically to avoid SSR issues
  const THREE = require("three");
  const newGeo = new THREE.BufferGeometry() as BufferGeometry;
  newGeo.setAttribute("position", new THREE.Float32BufferAttribute(newPositions, 3));
  if (newNormals.length > 0) {
    newGeo.setAttribute("normal", new THREE.Float32BufferAttribute(newNormals, 3));
  }
  newGeo.setIndex(newIndices);
  newGeo.computeBoundingBox();
  newGeo.computeBoundingSphere();

  return { geometry: newGeo, removedCount };
}
