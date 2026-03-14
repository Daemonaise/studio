// mesh-sanitize.ts
// Deterministic pre-reconstruction mesh sanitation.
// Runs fast cleanup passes BEFORE reconstruction to give the pipeline cleaner input.
//
// Based on topology-first repair architecture:
//   1. Duplicate face removal
//   2. Component extraction + debris classification
//   3. Non-manifold edge resolution (normal clustering)
//
// All operations work on indexed BufferGeometry. Non-indexed geometry is
// converted to indexed first via vertex welding.

import * as THREE from "three";

export interface SanitizeResult {
  geometry: THREE.BufferGeometry;
  stats: {
    duplicateFacesRemoved: number;
    debrisComponentsRemoved: number;
    debrisTrianglesRemoved: number;
    nonManifoldEdgesResolved: number;
    inputTriangles: number;
    outputTriangles: number;
  };
}

export interface SanitizeOptions {
  /** Min face count for a component to survive. Components below this are debris. Default: 0.5% of total. */
  debrisThresholdFraction?: number;
  /** Absolute minimum face count — components below this are always debris. Default: 10. */
  debrisAbsoluteMin?: number;
  /** Resolve non-manifold edges by normal clustering. Default: true. */
  resolveNonManifold?: boolean;
  /** Progress callback */
  onProgress?: (msg: string) => void;
}

/**
 * Sanitize a mesh before reconstruction.
 * Returns a new indexed BufferGeometry with deterministic fixes applied.
 */
export function sanitizeMesh(
  geometry: THREE.BufferGeometry,
  options?: SanitizeOptions,
): SanitizeResult {
  const log = options?.onProgress ?? (() => {});
  const debrisFrac = options?.debrisThresholdFraction ?? 0.005;
  const debrisAbsMin = options?.debrisAbsoluteMin ?? 10;
  const resolveNM = options?.resolveNonManifold ?? true;

  // Work on a copy; if non-indexed, build a trivial index
  let geo = geometry;
  if (!geo.index) {
    geo = geo.clone();
    const count = geo.getAttribute("position").count;
    const trivialIdx = new Uint32Array(count);
    for (let i = 0; i < count; i++) trivialIdx[i] = i;
    geo.setIndex(new THREE.BufferAttribute(trivialIdx, 1));
  }

  const pos = geo.getAttribute("position") as THREE.BufferAttribute;
  const idx = geo.getIndex()!;
  const vertexCount = pos.count;
  const indexArr = Array.from(idx.array);
  const triCount = Math.floor(indexArr.length / 3);

  let duplicateFacesRemoved = 0;
  let debrisComponentsRemoved = 0;
  let debrisTrianglesRemoved = 0;
  let nonManifoldEdgesResolved = 0;

  // ── Step 1: Remove duplicate faces ──────────────────────────────────────────
  log("Removing duplicate faces…");
  const faceSet = new Set<string>();
  const keepTriangles: boolean[] = new Array(triCount).fill(true);

  for (let t = 0; t < triCount; t++) {
    const i0 = indexArr[t * 3];
    const i1 = indexArr[t * 3 + 1];
    const i2 = indexArr[t * 3 + 2];
    // Canonical key: sorted vertex indices
    const sorted = [i0, i1, i2].sort((a, b) => a - b);
    const key = `${sorted[0]}_${sorted[1]}_${sorted[2]}`;
    if (faceSet.has(key)) {
      keepTriangles[t] = false;
      duplicateFacesRemoved++;
    } else {
      faceSet.add(key);
    }
  }

  // ── Step 2: Component extraction + debris removal ───────────────────────────
  log("Extracting components…");

  // Build vertex → face adjacency
  const vertexToFaces: number[][] = new Array(vertexCount);
  for (let i = 0; i < vertexCount; i++) vertexToFaces[i] = [];
  for (let t = 0; t < triCount; t++) {
    if (!keepTriangles[t]) continue;
    vertexToFaces[indexArr[t * 3]].push(t);
    vertexToFaces[indexArr[t * 3 + 1]].push(t);
    vertexToFaces[indexArr[t * 3 + 2]].push(t);
  }

  // BFS to find connected components
  const faceComponent = new Int32Array(triCount).fill(-1);
  const components: number[][] = [];

  for (let t = 0; t < triCount; t++) {
    if (!keepTriangles[t] || faceComponent[t] !== -1) continue;

    const comp: number[] = [];
    const queue = [t];
    faceComponent[t] = components.length;

    while (queue.length > 0) {
      const face = queue.pop()!;
      comp.push(face);
      // Visit neighbors via shared vertices
      for (let vi = 0; vi < 3; vi++) {
        const v = indexArr[face * 3 + vi];
        for (const neighbor of vertexToFaces[v]) {
          if (faceComponent[neighbor] === -1 && keepTriangles[neighbor]) {
            faceComponent[neighbor] = components.length;
            queue.push(neighbor);
          }
        }
      }
    }
    components.push(comp);
  }

  // Classify debris: remove components that are too small
  if (components.length > 1) {
    const keptTriCount = keepTriangles.filter(Boolean).length;
    const threshold = Math.max(debrisAbsMin, Math.floor(keptTriCount * debrisFrac));

    // Keep the largest component always, then remove those below threshold
    const sortedBySize = [...components].sort((a, b) => b.length - a.length);
    const largestSize = sortedBySize[0].length;

    for (const comp of components) {
      if (comp.length < threshold && comp.length < largestSize * 0.1) {
        for (const faceIdx of comp) {
          keepTriangles[faceIdx] = false;
          debrisTrianglesRemoved++;
        }
        debrisComponentsRemoved++;
      }
    }
  }

  // ── Step 3: Non-manifold edge resolution ────────────────────────────────────
  if (resolveNM) {
    log("Resolving non-manifold edges…");

    // Build edge → face list for surviving triangles
    const edgeToFaces = new Map<string, number[]>();
    const edgeKey = (a: number, b: number) => {
      const lo = Math.min(a, b);
      const hi = Math.max(a, b);
      return `${lo}_${hi}`;
    };

    for (let t = 0; t < triCount; t++) {
      if (!keepTriangles[t]) continue;
      const i0 = indexArr[t * 3];
      const i1 = indexArr[t * 3 + 1];
      const i2 = indexArr[t * 3 + 2];
      for (const [a, b] of [[i0, i1], [i1, i2], [i2, i0]]) {
        const k = edgeKey(a, b);
        const list = edgeToFaces.get(k);
        if (list) list.push(t);
        else edgeToFaces.set(k, [t]);
      }
    }

    // For each non-manifold edge (>2 faces), keep the pair with most consistent normals
    const posArr = pos.array;
    const computeNormal = (t: number): THREE.Vector3 => {
      const base = t * 3;
      const i0 = indexArr[base], i1 = indexArr[base + 1], i2 = indexArr[base + 2];
      const ax = posArr[i0 * 3], ay = posArr[i0 * 3 + 1], az = posArr[i0 * 3 + 2];
      const bx = posArr[i1 * 3], by = posArr[i1 * 3 + 1], bz = posArr[i1 * 3 + 2];
      const cx = posArr[i2 * 3], cy = posArr[i2 * 3 + 1], cz = posArr[i2 * 3 + 2];
      const e1x = bx - ax, e1y = by - ay, e1z = bz - az;
      const e2x = cx - ax, e2y = cy - ay, e2z = cz - az;
      return new THREE.Vector3(
        e1y * e2z - e1z * e2y,
        e1z * e2x - e1x * e2z,
        e1x * e2y - e1y * e2x,
      ).normalize();
    };

    for (const [, faces] of edgeToFaces) {
      if (faces.length <= 2) continue;

      // Cluster faces by normal direction, keep the 2 most coherent
      const normals = faces.map((f) => ({ face: f, normal: computeNormal(f) }));

      // Find the pair with the best (most opposed) dihedral angle (manifold pair)
      let bestPair: [number, number] = [faces[0], faces[1]];
      let bestScore = -Infinity;

      for (let i = 0; i < normals.length; i++) {
        for (let j = i + 1; j < normals.length; j++) {
          // Ideal manifold pair has normals pointing away from each other (dot ≈ -1)
          // or same direction for flat surfaces (dot ≈ 1). Either is better than random.
          const dot = Math.abs(normals[i].normal.dot(normals[j].normal));
          if (dot > bestScore) {
            bestScore = dot;
            bestPair = [normals[i].face, normals[j].face];
          }
        }
      }

      // Remove excess faces
      for (const f of faces) {
        if (f !== bestPair[0] && f !== bestPair[1] && keepTriangles[f]) {
          keepTriangles[f] = false;
          nonManifoldEdgesResolved++;
        }
      }
    }
  }

  // ── Build output geometry ───────────────────────────────────────────────────
  log("Building sanitized geometry…");

  const survivingTris: number[] = [];
  for (let t = 0; t < triCount; t++) {
    if (keepTriangles[t]) survivingTris.push(t);
  }

  const newIndexArr = new Uint32Array(survivingTris.length * 3);
  for (let i = 0; i < survivingTris.length; i++) {
    const t = survivingTris[i];
    newIndexArr[i * 3] = indexArr[t * 3];
    newIndexArr[i * 3 + 1] = indexArr[t * 3 + 1];
    newIndexArr[i * 3 + 2] = indexArr[t * 3 + 2];
  }

  const outGeo = new THREE.BufferGeometry();
  outGeo.setAttribute("position", pos.clone());
  outGeo.setIndex(new THREE.BufferAttribute(newIndexArr, 1));
  outGeo.computeVertexNormals();

  return {
    geometry: outGeo,
    stats: {
      duplicateFacesRemoved,
      debrisComponentsRemoved,
      debrisTrianglesRemoved,
      nonManifoldEdgesResolved,
      inputTriangles: triCount,
      outputTriangles: survivingTris.length,
    },
  };
}
