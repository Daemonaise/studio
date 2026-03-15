/**
 * Defect overlay computation for mesh diagnostics.
 *
 * Scans a BufferGeometry to locate boundary (open) edges and non-manifold edges,
 * returning Float32Array line-segment buffers ready for Three.js LineSegments.
 */

import type { BufferGeometry } from "three";

export interface DefectEdges {
  /** Pairs of xyz coords for open/boundary edges (6 floats per edge). */
  openEdges: Float32Array;
  /** Pairs of xyz coords for non-manifold edges (6 floats per edge). */
  nonManifoldEdges: Float32Array;
  openEdgeCount: number;
  nonManifoldEdgeCount: number;
}

export interface SliverTriangle {
  /** Triangle index. */
  index: number;
  /** Aspect ratio (longest edge / shortest altitude). Higher = worse. */
  aspectRatio: number;
  /** Centroid [x, y, z]. */
  centroid: [number, number, number];
  /** Three vertex positions (9 floats). */
  vertices: Float32Array;
}

export interface InvertedNormalFace {
  /** Triangle index. */
  index: number;
  /** Face centroid [x, y, z]. */
  centroid: [number, number, number];
  /** Face normal [nx, ny, nz]. */
  normal: [number, number, number];
}

export interface ExtendedDefects extends DefectEdges {
  /** Triangles with very high aspect ratio (slivers). */
  sliverTriangles: SliverTriangle[];
  /** Faces whose normal is inconsistent with neighbors (likely inverted). */
  invertedNormals: InvertedNormalFace[];
  /** Vertex positions for sliver triangle rendering (9 floats per tri). */
  sliverPositions: Float32Array;
  /** Vertex positions for inverted normal rendering (9 floats per tri). */
  invertedPositions: Float32Array;
}

/**
 * Build an edge→face-count map from the geometry's index (or implicit triangles).
 * Returns DefectEdges with position buffers suitable for LineSegments rendering.
 *
 * For very large meshes (>2M triangles) we sample to keep this interactive.
 */
export function computeEdgeDefects(geometry: BufferGeometry): DefectEdges {
  const posAttr = geometry.getAttribute("position");
  if (!posAttr) {
    return { openEdges: new Float32Array(0), nonManifoldEdges: new Float32Array(0), openEdgeCount: 0, nonManifoldEdgeCount: 0 };
  }

  const positions = posAttr.array as Float32Array;
  const vertexCount = posAttr.count;
  const index = geometry.getIndex();

  // Determine triangle count and accessor
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

  // For very large meshes, skip computation to keep UI responsive
  if (triCount > 2_000_000) {
    return { openEdges: new Float32Array(0), nonManifoldEdges: new Float32Array(0), openEdgeCount: 0, nonManifoldEdgeCount: 0 };
  }

  // Edge key: pack two vertex indices into a canonical string "min-max"
  // Using a Map<string, number> for face-count per edge
  const edgeFaceCount = new Map<string, number>();

  const edgeKey = (a: number, b: number): string => {
    return a < b ? `${a}-${b}` : `${b}-${a}`;
  };

  for (let t = 0; t < triCount; t++) {
    const i0 = triIdx(t, 0);
    const i1 = triIdx(t, 1);
    const i2 = triIdx(t, 2);

    const k0 = edgeKey(i0, i1);
    const k1 = edgeKey(i1, i2);
    const k2 = edgeKey(i2, i0);

    edgeFaceCount.set(k0, (edgeFaceCount.get(k0) ?? 0) + 1);
    edgeFaceCount.set(k1, (edgeFaceCount.get(k1) ?? 0) + 1);
    edgeFaceCount.set(k2, (edgeFaceCount.get(k2) ?? 0) + 1);
  }

  // Classify edges
  const openEdgeCoords: number[] = [];
  const nonManifoldCoords: number[] = [];

  for (const [key, count] of edgeFaceCount) {
    if (count === 2) continue; // manifold interior edge — skip

    const dashIdx = key.indexOf("-");
    const a = parseInt(key.substring(0, dashIdx), 10);
    const b = parseInt(key.substring(dashIdx + 1), 10);

    const ax = positions[a * 3], ay = positions[a * 3 + 1], az = positions[a * 3 + 2];
    const bx = positions[b * 3], by = positions[b * 3 + 1], bz = positions[b * 3 + 2];

    if (count === 1) {
      // Boundary / open edge
      openEdgeCoords.push(ax, ay, az, bx, by, bz);
    } else {
      // Non-manifold edge (shared by >2 faces)
      nonManifoldCoords.push(ax, ay, az, bx, by, bz);
    }
  }

  return {
    openEdges: new Float32Array(openEdgeCoords),
    nonManifoldEdges: new Float32Array(nonManifoldCoords),
    openEdgeCount: openEdgeCoords.length / 6,
    nonManifoldEdgeCount: nonManifoldCoords.length / 6,
  };
}

/**
 * Detect sliver (degenerate) triangles — those with extremely high aspect ratio.
 * Threshold default: aspect ratio > 20.
 * Skips meshes > 2M triangles.
 */
export function computeSliverTriangles(
  geometry: BufferGeometry,
  threshold = 20,
): SliverTriangle[] {
  const posAttr = geometry.getAttribute("position");
  if (!posAttr) return [];

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

  if (triCount > 2_000_000) return [];

  const slivers: SliverTriangle[] = [];

  for (let t = 0; t < triCount; t++) {
    const i0 = triIdx(t, 0), i1 = triIdx(t, 1), i2 = triIdx(t, 2);

    const p0x = positions[i0 * 3], p0y = positions[i0 * 3 + 1], p0z = positions[i0 * 3 + 2];
    const p1x = positions[i1 * 3], p1y = positions[i1 * 3 + 1], p1z = positions[i1 * 3 + 2];
    const p2x = positions[i2 * 3], p2y = positions[i2 * 3 + 1], p2z = positions[i2 * 3 + 2];

    // Edge lengths
    const e0 = Math.sqrt((p1x - p0x) ** 2 + (p1y - p0y) ** 2 + (p1z - p0z) ** 2);
    const e1 = Math.sqrt((p2x - p1x) ** 2 + (p2y - p1y) ** 2 + (p2z - p1z) ** 2);
    const e2 = Math.sqrt((p0x - p2x) ** 2 + (p0y - p2y) ** 2 + (p0z - p2z) ** 2);

    const longestEdge = Math.max(e0, e1, e2);
    if (longestEdge < 1e-12) continue;

    // Area via cross product
    const ax = p1x - p0x, ay = p1y - p0y, az = p1z - p0z;
    const bx = p2x - p0x, by = p2y - p0y, bz = p2z - p0z;
    const cx = ay * bz - az * by;
    const cy = az * bx - ax * bz;
    const cz = ax * by - ay * bx;
    const area = Math.sqrt(cx * cx + cy * cy + cz * cz) * 0.5;

    // Shortest altitude = 2 * area / longest edge
    const shortestAlt = (2 * area) / longestEdge;
    if (shortestAlt < 1e-12) continue;

    const aspectRatio = longestEdge / shortestAlt;

    if (aspectRatio > threshold) {
      slivers.push({
        index: t,
        aspectRatio,
        centroid: [(p0x + p1x + p2x) / 3, (p0y + p1y + p2y) / 3, (p0z + p1z + p2z) / 3],
        vertices: new Float32Array([p0x, p0y, p0z, p1x, p1y, p1z, p2x, p2y, p2z]),
      });
    }
  }

  return slivers;
}

/**
 * Detect faces with normals inconsistent with their neighbors (likely inverted).
 * Uses an edge-adjacency approach: for each edge shared by exactly 2 faces,
 * check if the face normals point in roughly the same direction (dot > 0).
 * Faces where a majority of neighbor-pair dot products are negative are flagged.
 * Skips meshes > 2M triangles.
 */
export function computeInvertedNormals(geometry: BufferGeometry): InvertedNormalFace[] {
  const posAttr = geometry.getAttribute("position");
  if (!posAttr) return [];

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

  if (triCount > 2_000_000) return [];

  // Compute per-face normals
  const faceNormals = new Float32Array(triCount * 3);
  for (let t = 0; t < triCount; t++) {
    const i0 = triIdx(t, 0), i1 = triIdx(t, 1), i2 = triIdx(t, 2);
    const ax = positions[i1 * 3] - positions[i0 * 3];
    const ay = positions[i1 * 3 + 1] - positions[i0 * 3 + 1];
    const az = positions[i1 * 3 + 2] - positions[i0 * 3 + 2];
    const bx = positions[i2 * 3] - positions[i0 * 3];
    const by = positions[i2 * 3 + 1] - positions[i0 * 3 + 1];
    const bz = positions[i2 * 3 + 2] - positions[i0 * 3 + 2];
    const nx = ay * bz - az * by;
    const ny = az * bx - ax * bz;
    const nz = ax * by - ay * bx;
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (len > 1e-12) {
      faceNormals[t * 3] = nx / len;
      faceNormals[t * 3 + 1] = ny / len;
      faceNormals[t * 3 + 2] = nz / len;
    }
  }

  // Build edge → [face indices] adjacency (only for manifold edges with exactly 2 faces)
  const edgeFaces = new Map<string, number[]>();
  const edgeKey = (a: number, b: number) => a < b ? `${a}-${b}` : `${b}-${a}`;

  for (let t = 0; t < triCount; t++) {
    const i0 = triIdx(t, 0), i1 = triIdx(t, 1), i2 = triIdx(t, 2);
    for (const [a, b] of [[i0, i1], [i1, i2], [i2, i0]]) {
      const key = edgeKey(a, b);
      const arr = edgeFaces.get(key);
      if (arr) arr.push(t);
      else edgeFaces.set(key, [t]);
    }
  }

  // Count inconsistent neighbor pairs per face
  const inconsistentCount = new Uint16Array(triCount);
  const neighborCount = new Uint16Array(triCount);

  for (const faces of edgeFaces.values()) {
    if (faces.length !== 2) continue;
    const [f0, f1] = faces;
    neighborCount[f0]++;
    neighborCount[f1]++;

    const dot =
      faceNormals[f0 * 3] * faceNormals[f1 * 3] +
      faceNormals[f0 * 3 + 1] * faceNormals[f1 * 3 + 1] +
      faceNormals[f0 * 3 + 2] * faceNormals[f1 * 3 + 2];

    if (dot < -0.1) {
      inconsistentCount[f0]++;
      inconsistentCount[f1]++;
    }
  }

  // Flag faces where majority of neighbors disagree
  const inverted: InvertedNormalFace[] = [];
  for (let t = 0; t < triCount; t++) {
    if (neighborCount[t] < 2) continue;
    if (inconsistentCount[t] > neighborCount[t] / 2) {
      const i0 = triIdx(t, 0), i1 = triIdx(t, 1), i2 = triIdx(t, 2);
      inverted.push({
        index: t,
        centroid: [
          (positions[i0 * 3] + positions[i1 * 3] + positions[i2 * 3]) / 3,
          (positions[i0 * 3 + 1] + positions[i1 * 3 + 1] + positions[i2 * 3 + 1]) / 3,
          (positions[i0 * 3 + 2] + positions[i1 * 3 + 2] + positions[i2 * 3 + 2]) / 3,
        ],
        normal: [faceNormals[t * 3], faceNormals[t * 3 + 1], faceNormals[t * 3 + 2]],
      });
    }
  }

  return inverted;
}

/**
 * Compute all extended defects in one call (edges + slivers + inverted normals).
 */
export function computeExtendedDefects(
  geometry: BufferGeometry,
  sliverThreshold = 20,
): ExtendedDefects {
  const edges = computeEdgeDefects(geometry);
  const sliverTriangles = computeSliverTriangles(geometry, sliverThreshold);
  const invertedNormals = computeInvertedNormals(geometry);

  // Build render buffers
  const sliverPositions = new Float32Array(sliverTriangles.length * 9);
  for (let i = 0; i < sliverTriangles.length; i++) {
    sliverPositions.set(sliverTriangles[i].vertices, i * 9);
  }

  const posAttr = geometry.getAttribute("position");
  const positions = posAttr?.array as Float32Array | undefined;
  const index = geometry.getIndex();
  const invertedPositions = new Float32Array(invertedNormals.length * 9);

  if (positions) {
    let triIdx: (tri: number, corner: number) => number;
    if (index) {
      const idxArr = index.array;
      triIdx = (tri, corner) => idxArr[tri * 3 + corner];
    } else {
      triIdx = (tri, corner) => tri * 3 + corner;
    }

    for (let i = 0; i < invertedNormals.length; i++) {
      const t = invertedNormals[i].index;
      for (let c = 0; c < 3; c++) {
        const vi = triIdx(t, c);
        invertedPositions[i * 9 + c * 3] = positions[vi * 3];
        invertedPositions[i * 9 + c * 3 + 1] = positions[vi * 3 + 1];
        invertedPositions[i * 9 + c * 3 + 2] = positions[vi * 3 + 2];
      }
    }
  }

  return {
    ...edges,
    sliverTriangles,
    invertedNormals,
    sliverPositions,
    invertedPositions,
  };
}
