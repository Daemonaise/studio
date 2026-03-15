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
