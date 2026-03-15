import { createRequire } from "node:module"; const require = createRequire(import.meta.url);
function computeOverhangs(geometry, thresholdDeg = 45) {
  const posAttr = geometry.getAttribute("position");
  if (!posAttr) {
    return { faces: [], positions: new Float32Array(0), severity: new Float32Array(0), count: 0, percentOverhang: 0, maxAngle: 0 };
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
  if (triCount > 2e6) {
    return { faces: [], positions: new Float32Array(0), severity: new Float32Array(0), count: 0, percentOverhang: 0, maxAngle: 0 };
  }
  const thresholdRad = thresholdDeg * Math.PI / 180;
  const cosThreshold = Math.cos(thresholdRad);
  const overhangFaces = [];
  const overhangPositions = [];
  const severities = [];
  let maxAngle = 0;
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
    if (len < 1e-12) continue;
    const nnz = nz / len;
    if (nnz >= 0) continue;
    const overhangAngle = Math.acos(Math.min(1, Math.max(-1, -nnz)));
    const angleDeg = overhangAngle * 180 / Math.PI;
    const angleFromVertical = Math.acos(Math.min(1, Math.abs(nnz))) * 180 / Math.PI;
    if (angleFromVertical > thresholdDeg && nnz < 0) {
      overhangFaces.push({ index: t, angle: angleFromVertical });
      maxAngle = Math.max(maxAngle, angleFromVertical);
      const sev = Math.min(1, (angleFromVertical - thresholdDeg) / (90 - thresholdDeg));
      severities.push(sev);
      overhangPositions.push(
        positions[i0 * 3],
        positions[i0 * 3 + 1],
        positions[i0 * 3 + 2],
        positions[i1 * 3],
        positions[i1 * 3 + 1],
        positions[i1 * 3 + 2],
        positions[i2 * 3],
        positions[i2 * 3 + 1],
        positions[i2 * 3 + 2]
      );
    }
  }
  return {
    faces: overhangFaces,
    positions: new Float32Array(overhangPositions),
    severity: new Float32Array(severities),
    count: overhangFaces.length,
    percentOverhang: triCount > 0 ? overhangFaces.length / triCount * 100 : 0,
    maxAngle
  };
}
function estimateThickness(geometry, minThicknessMM = 0.8, maxSamples = 5e3) {
  const posAttr = geometry.getAttribute("position");
  if (!posAttr) {
    return { minThickness: 0, avgThickness: 0, sampleCount: 0, thinRegionCount: 0, thinRegions: [] };
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
  geometry.computeBoundingBox();
  const bb = geometry.boundingBox;
  if (!bb) {
    return { minThickness: 0, avgThickness: 0, sampleCount: 0, thinRegionCount: 0, thinRegions: [] };
  }
  const maxDist = bb.max.distanceTo(bb.min);
  const sampleRate = Math.min(1, maxSamples / triCount);
  const sampledFaces = [];
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
        (positions[i0 * 3 + 2] + positions[i1 * 3 + 2] + positions[i2 * 3 + 2]) / 3
      ],
      // Inward normal (negate)
      normal: [-nx / len, -ny / len, -nz / len],
      tri: t
    });
  }
  if (sampledFaces.length === 0) {
    return { minThickness: 0, avgThickness: 0, sampleCount: 0, thinRegionCount: 0, thinRegions: [] };
  }
  let minThickness = Infinity;
  let sumThickness = 0;
  let hitCount = 0;
  const thinRegions = [];
  for (const sample of sampledFaces) {
    const [ox, oy, oz] = sample.centroid;
    const [dx, dy, dz] = sample.normal;
    let nearestDist = maxDist;
    const checkLimit = Math.min(triCount, 5e4);
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
    thinRegions: thinRegions.slice(0, 200)
    // cap for UI
  };
}
function computePrintabilityScore(overhangPct, minThickness, isWatertight, minThicknessMM = 0.8) {
  const warnings = [];
  const overhangScore = Math.max(0, Math.min(100, 100 - (overhangPct - 5) * (100 / 45)));
  if (overhangPct > 20) warnings.push(`${overhangPct.toFixed(1)}% overhang faces \u2014 consider reorienting or adding supports`);
  let thicknessScore = 100;
  if (minThickness > 0 && minThickness < minThicknessMM) {
    thicknessScore = Math.max(0, minThickness / minThicknessMM * 100);
    warnings.push(`Min wall thickness ${minThickness.toFixed(2)} mm is below ${minThicknessMM} mm`);
  }
  const watertightScore = isWatertight ? 100 : 0;
  if (!isWatertight) warnings.push("Mesh is not watertight \u2014 may fail to slice");
  const overall = Math.round(overhangScore * 0.3 + thicknessScore * 0.3 + watertightScore * 0.4);
  return { overall, overhangScore: Math.round(overhangScore), thicknessScore: Math.round(thicknessScore), watertightScore, warnings };
}
export {
  computeOverhangs,
  computePrintabilityScore,
  estimateThickness
};
