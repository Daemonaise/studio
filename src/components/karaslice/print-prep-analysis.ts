/**
 * Print-preparation analysis utilities.
 *
 * Computes overhang faces, thin-wall regions, and printability metrics
 * directly from a BufferGeometry. All client-side, no cloud needed
 * for meshes under 2M triangles.
 */

import type { BufferGeometry } from "three";

// ── Overhang Analysis ─────────────────────────────────────────────────────────

export interface OverhangFace {
  /** Triangle index. */
  index: number;
  /** Overhang angle in degrees (0 = vertical, 90 = upside-down ceiling). */
  angle: number;
}

export interface OverhangResult {
  /** Faces exceeding the threshold angle. */
  faces: OverhangFace[];
  /** Float32Array of vertex positions for overhang triangles (9 floats per tri). */
  positions: Float32Array;
  /** Per-triangle overhang severity 0..1 for coloring (1 = worst). */
  severity: Float32Array;
  /** Total overhang face count. */
  count: number;
  /** Percentage of total faces that are overhang. */
  percentOverhang: number;
  /** Max overhang angle found. */
  maxAngle: number;
}

/**
 * Detect faces that overhang beyond a threshold angle from vertical.
 * Build direction is assumed to be +Z (upward).
 *
 * @param geometry - Input mesh
 * @param thresholdDeg - Overhang threshold in degrees (default 45)
 */
export function computeOverhangs(
  geometry: BufferGeometry,
  thresholdDeg = 45,
): OverhangResult {
  const posAttr = geometry.getAttribute("position");
  if (!posAttr) {
    return { faces: [], positions: new Float32Array(0), severity: new Float32Array(0), count: 0, percentOverhang: 0, maxAngle: 0 };
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

  if (triCount > 2_000_000) {
    return { faces: [], positions: new Float32Array(0), severity: new Float32Array(0), count: 0, percentOverhang: 0, maxAngle: 0 };
  }

  const thresholdRad = (thresholdDeg * Math.PI) / 180;
  const cosThreshold = Math.cos(thresholdRad);
  // Build direction: +Z
  // A face overhangs when its downward-facing normal makes angle > threshold with -Z
  // i.e., face normal dot [0,0,-1] > cosThreshold → normal.z < -cosThreshold
  // But more precisely: overhang angle = angle between face normal and down direction
  // If normal points down and face is unsupported: angle from vertical = acos(abs(nz))
  // Overhang faces: face normal has negative Z component and angle from downward > threshold

  const overhangFaces: OverhangFace[] = [];
  const overhangPositions: number[] = [];
  const severities: number[] = [];
  let maxAngle = 0;

  for (let t = 0; t < triCount; t++) {
    const i0 = triIdx(t, 0), i1 = triIdx(t, 1), i2 = triIdx(t, 2);

    // Compute face normal
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
    if (len < 1e-12) continue;

    const nnz = nz / len;

    // Face with downward-facing normal (nz < 0) overhangs
    // Overhang angle = angle between normal and straight-down [0,0,-1]
    // cos(angle) = dot(normal, [0,0,-1]) = -nnz
    // angle = acos(-nnz)
    // Face overhangs if nnz < 0 and angle from support > threshold
    if (nnz >= 0) continue; // face points up, no overhang

    const overhangAngle = Math.acos(Math.min(1, Math.max(-1, -nnz)));
    const angleDeg = (overhangAngle * 180) / Math.PI;

    // Only flag if the face-to-vertical angle exceeds threshold
    // A face pointing straight down (nz = -1) has overhang angle = 0° (directly below)
    // A face at 45° from horizontal with nz < 0 has overhang angle ≈ 45°
    // We flag faces where the angle FROM the build direction exceeds threshold
    // Actually: let's think of it as angle from horizontal
    // A face is an overhang when its normal makes > thresholdDeg from the -Z axis
    // Simpler: angle from horizontal = 90 - angleDeg
    // Standard: overhang angle is measured from vertical (build direction)
    // angle from vertical = acos(|nz|), overhang if this angle > threshold AND nz < 0
    const angleFromVertical = Math.acos(Math.min(1, Math.abs(nnz))) * 180 / Math.PI;

    if (angleFromVertical > thresholdDeg && nnz < 0) {
      overhangFaces.push({ index: t, angle: angleFromVertical });
      maxAngle = Math.max(maxAngle, angleFromVertical);

      // Severity: 0 at threshold, 1 at 90°
      const sev = Math.min(1, (angleFromVertical - thresholdDeg) / (90 - thresholdDeg));
      severities.push(sev);

      overhangPositions.push(
        positions[i0 * 3], positions[i0 * 3 + 1], positions[i0 * 3 + 2],
        positions[i1 * 3], positions[i1 * 3 + 1], positions[i1 * 3 + 2],
        positions[i2 * 3], positions[i2 * 3 + 1], positions[i2 * 3 + 2],
      );
    }
  }

  return {
    faces: overhangFaces,
    positions: new Float32Array(overhangPositions),
    severity: new Float32Array(severities),
    count: overhangFaces.length,
    percentOverhang: triCount > 0 ? (overhangFaces.length / triCount) * 100 : 0,
    maxAngle,
  };
}

// ── Thickness Estimation ──────────────────────────────────────────────────────

export interface ThicknessResult {
  /** Estimated minimum wall thickness in mm. */
  minThickness: number;
  /** Estimated average wall thickness in mm. */
  avgThickness: number;
  /** Number of sample points used. */
  sampleCount: number;
  /** Number of thin regions (below threshold). */
  thinRegionCount: number;
  /** Thin region centroids for visualization [x, y, z, thickness]. */
  thinRegions: { centroid: [number, number, number]; thickness: number }[];
}

/**
 * Estimate wall thickness by sampling rays from face centers along normals.
 * Uses a simple "shoot ray inward, find nearest opposite face" heuristic.
 * This is approximate but fast. For large meshes, we sample.
 *
 * @param geometry - Input mesh
 * @param minThicknessMM - Minimum acceptable thickness in mm (default 0.8)
 * @param maxSamples - Maximum faces to sample (default 5000)
 */
export function estimateThickness(
  geometry: BufferGeometry,
  minThicknessMM = 0.8,
  maxSamples = 5000,
): ThicknessResult {
  const posAttr = geometry.getAttribute("position");
  if (!posAttr) {
    return { minThickness: 0, avgThickness: 0, sampleCount: 0, thinRegionCount: 0, thinRegions: [] };
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

  // Compute bounding box diagonal for max ray distance
  geometry.computeBoundingBox();
  const bb = geometry.boundingBox;
  if (!bb) {
    return { minThickness: 0, avgThickness: 0, sampleCount: 0, thinRegionCount: 0, thinRegions: [] };
  }
  const maxDist = bb.max.distanceTo(bb.min);

  // Sample faces
  const sampleRate = Math.min(1, maxSamples / triCount);
  const sampledFaces: { centroid: [number, number, number]; normal: [number, number, number]; tri: number }[] = [];

  for (let t = 0; t < triCount; t++) {
    if (Math.random() > sampleRate) continue;

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
    if (len < 1e-12) continue;

    sampledFaces.push({
      centroid: [
        (positions[i0 * 3] + positions[i1 * 3] + positions[i2 * 3]) / 3,
        (positions[i0 * 3 + 1] + positions[i1 * 3 + 1] + positions[i2 * 3 + 1]) / 3,
        (positions[i0 * 3 + 2] + positions[i1 * 3 + 2] + positions[i2 * 3 + 2]) / 3,
      ],
      // Inward normal (negate)
      normal: [-nx / len, -ny / len, -nz / len],
      tri: t,
    });
  }

  if (sampledFaces.length === 0) {
    return { minThickness: 0, avgThickness: 0, sampleCount: 0, thinRegionCount: 0, thinRegions: [] };
  }

  // For each sample, shoot a ray inward and find closest intersection with any other triangle
  // This is O(samples * triangles) — we limit samples to keep it fast
  let minThickness = Infinity;
  let sumThickness = 0;
  let hitCount = 0;
  const thinRegions: { centroid: [number, number, number]; thickness: number }[] = [];

  for (const sample of sampledFaces) {
    const [ox, oy, oz] = sample.centroid;
    const [dx, dy, dz] = sample.normal;
    let nearestDist = maxDist;

    // Simple brute-force ray-triangle intersection (Möller–Trumbore)
    // Only check a subset for performance
    const checkLimit = Math.min(triCount, 50000);
    const checkStep = Math.max(1, Math.floor(triCount / checkLimit));

    for (let t = 0; t < triCount; t += checkStep) {
      if (t === sample.tri) continue;

      const ti0 = triIdx(t, 0), ti1 = triIdx(t, 1), ti2 = triIdx(t, 2);
      const v0x = positions[ti0 * 3], v0y = positions[ti0 * 3 + 1], v0z = positions[ti0 * 3 + 2];
      const e1x = positions[ti1 * 3] - v0x, e1y = positions[ti1 * 3 + 1] - v0y, e1z = positions[ti1 * 3 + 2] - v0z;
      const e2x = positions[ti2 * 3] - v0x, e2y = positions[ti2 * 3 + 1] - v0y, e2z = positions[ti2 * 3 + 2] - v0z;

      const hx = dy * e2z - dz * e2y, hy = dz * e2x - dx * e2z, hz = dx * e2y - dy * e2x;
      const a = e1x * hx + e1y * hy + e1z * hz;
      if (Math.abs(a) < 1e-10) continue;

      const f = 1 / a;
      const sx = ox - v0x, sy = oy - v0y, sz = oz - v0z;
      const u = f * (sx * hx + sy * hy + sz * hz);
      if (u < 0 || u > 1) continue;

      const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
      const v = f * (dx * qx + dy * qy + dz * qz);
      if (v < 0 || u + v > 1) continue;

      const dist = f * (e2x * qx + e2y * qy + e2z * qz);
      if (dist > 0.01 && dist < nearestDist) {
        nearestDist = dist;
      }
    }

    if (nearestDist < maxDist) {
      hitCount++;
      sumThickness += nearestDist;
      minThickness = Math.min(minThickness, nearestDist);

      if (nearestDist < minThicknessMM) {
        thinRegions.push({ centroid: sample.centroid, thickness: nearestDist });
      }
    }
  }

  return {
    minThickness: hitCount > 0 ? minThickness : 0,
    avgThickness: hitCount > 0 ? sumThickness / hitCount : 0,
    sampleCount: sampledFaces.length,
    thinRegionCount: thinRegions.length,
    thinRegions: thinRegions.slice(0, 200), // cap for UI
  };
}

// ── Printability Score ────────────────────────────────────────────────────────

export interface PrintabilityScore {
  overall: number; // 0-100
  overhangScore: number;
  thicknessScore: number;
  watertightScore: number;
  warnings: string[];
}

export function computePrintabilityScore(
  overhangPct: number,
  minThickness: number,
  isWatertight: boolean,
  minThicknessMM = 0.8,
): PrintabilityScore {
  const warnings: string[] = [];

  // Overhang score: 100 if <5%, 0 if >50%
  const overhangScore = Math.max(0, Math.min(100, 100 - (overhangPct - 5) * (100 / 45)));
  if (overhangPct > 20) warnings.push(`${overhangPct.toFixed(1)}% overhang faces — consider reorienting or adding supports`);

  // Thickness score
  let thicknessScore = 100;
  if (minThickness > 0 && minThickness < minThicknessMM) {
    thicknessScore = Math.max(0, (minThickness / minThicknessMM) * 100);
    warnings.push(`Min wall thickness ${minThickness.toFixed(2)} mm is below ${minThicknessMM} mm`);
  }

  // Watertight
  const watertightScore = isWatertight ? 100 : 0;
  if (!isWatertight) warnings.push("Mesh is not watertight — may fail to slice");

  const overall = Math.round(overhangScore * 0.3 + thicknessScore * 0.3 + watertightScore * 0.4);

  return { overall, overhangScore: Math.round(overhangScore), thicknessScore: Math.round(thicknessScore), watertightScore, warnings };
}
