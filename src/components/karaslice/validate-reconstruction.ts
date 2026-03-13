/**
 * Reconstruction output validation utility.
 *
 * Checks BufferGeometry output from voxel/point-cloud reconstruction for
 * common defects: NaN vertices, degenerate triangles, non-manifold edges,
 * open boundaries, and Euler characteristic mismatches.
 */

import * as THREE from "three";

// ── Types ────────────────────────────────────────────────────────────────────

export interface ValidationFailure {
  check: string;
  severity: "error" | "warning";
  detail: string;
  value: number;
  threshold: number;
}

export interface ValidationMetrics {
  vertexCount: number;
  triangleCount: number;
  nanVertices: number;
  degenerateTriangles: number;
  nonManifoldEdges: number;
  boundaryEdges: number;
  eulerCharacteristic: number;
  expectedEuler: number;
}

export interface ValidationResult {
  passed: boolean;
  failures: ValidationFailure[];
  metrics: ValidationMetrics;
}

interface ValidateOptions {
  /** Max degenerate triangles as fraction of total. Default 0.01 (1%). */
  degenerateThreshold?: number;
  /** Max non-manifold edges allowed. Default 0. */
  nonManifoldThreshold?: number;
  /** Max boundary edges as fraction of total edges. Default 0.01 (1%). */
  boundaryThreshold?: number;
  /** Skip Euler characteristic check. */
  skipEulerCheck?: boolean;
}

// ── Constants ────────────────────────────────────────────────────────────────

const DEGENERATE_AREA_THRESHOLD = 1e-10; // mm²
const LARGE_MESH_TRI_LIMIT = 1_000_000;

// ── Main validation function ─────────────────────────────────────────────────

/**
 * Validate reconstruction output geometry for common defects.
 *
 * Time: O(T) for fast checks, O(T) for edge-map checks where T = triangle count.
 * Memory: O(E) for edge map where E ≈ 1.5T.
 * For meshes > 1M triangles, edge topology checks are skipped (too slow for UI thread).
 */
export function validateReconstructionOutput(
  geometry: THREE.BufferGeometry,
  options?: ValidateOptions,
): ValidationResult {
  const degThresh = options?.degenerateThreshold ?? 0.01;
  const nmThresh = options?.nonManifoldThreshold ?? 0;
  const bdThresh = options?.boundaryThreshold ?? 0.01;
  const skipEuler = options?.skipEulerCheck ?? false;

  const failures: ValidationFailure[] = [];

  // Ensure we have usable position data
  const posAttr = geometry.attributes.position as THREE.BufferAttribute | undefined;
  if (!posAttr) {
    return {
      passed: false,
      failures: [{ check: "no_positions", severity: "error", detail: "Geometry has no position attribute", value: 0, threshold: 1 }],
      metrics: { vertexCount: 0, triangleCount: 0, nanVertices: 0, degenerateTriangles: 0, nonManifoldEdges: 0, boundaryEdges: 0, eulerCharacteristic: 0, expectedEuler: 2 },
    };
  }

  const posArr = posAttr.array;
  const vertexCount = posAttr.count;

  // Build index array (use existing or synthesize sequential)
  let idxArr: Uint32Array | Uint16Array;
  if (geometry.index) {
    idxArr = geometry.index.array as Uint32Array | Uint16Array;
  } else {
    idxArr = new Uint32Array(vertexCount);
    for (let i = 0; i < vertexCount; i++) idxArr[i] = i;
  }
  const triCount = Math.floor(idxArr.length / 3);

  // ── Check 1: Sanity ──────────────────────────────────────────────────────
  if (triCount === 0 || vertexCount < 4) {
    failures.push({
      check: "empty_mesh",
      severity: "error",
      detail: `Output has ${triCount} triangles and ${vertexCount} vertices`,
      value: triCount,
      threshold: 1,
    });
    return {
      passed: false,
      failures,
      metrics: { vertexCount, triangleCount: triCount, nanVertices: 0, degenerateTriangles: 0, nonManifoldEdges: 0, boundaryEdges: 0, eulerCharacteristic: 0, expectedEuler: 2 },
    };
  }

  // ── Check 2: NaN / Infinity vertices ─────────────────────────────────────
  let nanVertices = 0;
  for (let i = 0; i < posArr.length; i++) {
    if (!isFinite(posArr[i])) {
      nanVertices++;
    }
  }
  // Count per-vertex (each vertex has 3 components)
  nanVertices = Math.ceil(nanVertices / 3);
  if (nanVertices > 0) {
    failures.push({
      check: "nan_vertices",
      severity: "error",
      detail: `${nanVertices} vertices contain NaN or Infinity values`,
      value: nanVertices,
      threshold: 0,
    });
  }

  // ── Check 3: Degenerate triangles ────────────────────────────────────────
  let degenerateTriangles = 0;
  for (let t = 0; t < triCount; t++) {
    const t3 = t * 3;
    const ai = idxArr[t3] * 3, bi = idxArr[t3 + 1] * 3, ci = idxArr[t3 + 2] * 3;

    // Edge vectors
    const e1x = posArr[bi] - posArr[ai], e1y = posArr[bi + 1] - posArr[ai + 1], e1z = posArr[bi + 2] - posArr[ai + 2];
    const e2x = posArr[ci] - posArr[ai], e2y = posArr[ci + 1] - posArr[ai + 1], e2z = posArr[ci + 2] - posArr[ai + 2];

    // Cross product magnitude = 2 * triangle area
    const cx = e1y * e2z - e1z * e2y;
    const cy = e1z * e2x - e1x * e2z;
    const cz = e1x * e2y - e1y * e2x;
    const area = 0.5 * Math.sqrt(cx * cx + cy * cy + cz * cz);

    if (area < DEGENERATE_AREA_THRESHOLD) degenerateTriangles++;
  }

  if (degenerateTriangles / triCount > degThresh) {
    failures.push({
      check: "degenerate_triangles",
      severity: "error",
      detail: `${degenerateTriangles} degenerate triangles (${(degenerateTriangles / triCount * 100).toFixed(1)}% of total)`,
      value: degenerateTriangles,
      threshold: Math.ceil(degThresh * triCount),
    });
  }

  // ── Checks 4-5: Edge topology (skip for very large meshes) ──────────────
  let nonManifoldEdges = 0;
  let boundaryEdges = 0;
  let totalEdges = 0;
  let eulerCharacteristic = 0;
  const expectedEuler = 2; // closed genus-0

  if (triCount <= LARGE_MESH_TRI_LIMIT) {
    // Build edge → face-count map with numeric keys
    const edgeCounts = new Map<number, number>();
    for (let t = 0; t < triCount; t++) {
      const t3 = t * 3;
      const a = idxArr[t3], b = idxArr[t3 + 1], c = idxArr[t3 + 2];
      const pairs: [number, number][] = [[a, b], [b, c], [c, a]];
      for (const [u, v] of pairs) {
        const key = u < v ? u * vertexCount + v : v * vertexCount + u;
        edgeCounts.set(key, (edgeCounts.get(key) ?? 0) + 1);
      }
    }

    totalEdges = edgeCounts.size;
    for (const count of edgeCounts.values()) {
      if (count === 1) boundaryEdges++;
      else if (count > 2) nonManifoldEdges++;
    }

    // Check 4: Non-manifold edges
    if (nonManifoldEdges > nmThresh) {
      failures.push({
        check: "non_manifold_edges",
        severity: "error",
        detail: `${nonManifoldEdges} non-manifold edges detected`,
        value: nonManifoldEdges,
        threshold: nmThresh,
      });
    }

    // Check 4b: Boundary edges
    if (totalEdges > 0 && boundaryEdges / totalEdges > bdThresh) {
      failures.push({
        check: "boundary_edges",
        severity: "warning",
        detail: `${boundaryEdges} boundary (open) edges (${(boundaryEdges / totalEdges * 100).toFixed(1)}% of total)`,
        value: boundaryEdges,
        threshold: Math.ceil(bdThresh * totalEdges),
      });
    }

    // Check 5: Euler characteristic
    if (!skipEuler) {
      eulerCharacteristic = vertexCount - totalEdges + triCount;
      if (eulerCharacteristic !== expectedEuler) {
        failures.push({
          check: "euler_characteristic",
          severity: "warning",
          detail: `Euler characteristic V-E+F = ${eulerCharacteristic}, expected ${expectedEuler} for closed genus-0 surface`,
          value: eulerCharacteristic,
          threshold: expectedEuler,
        });
      }
    }
  }

  const hasErrors = failures.some((f) => f.severity === "error");

  return {
    passed: !hasErrors,
    failures,
    metrics: {
      vertexCount,
      triangleCount: triCount,
      nanVertices,
      degenerateTriangles,
      nonManifoldEdges,
      boundaryEdges,
      eulerCharacteristic,
      expectedEuler,
    },
  };
}
