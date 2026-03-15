import { createRequire } from "node:module"; const require = createRequire(import.meta.url);
const DEGENERATE_AREA_THRESHOLD = 1e-10;
const LARGE_MESH_TRI_LIMIT = 1e6;
function validateReconstructionOutput(geometry, options) {
  const degThresh = options?.degenerateThreshold ?? 0.01;
  const nmThresh = options?.nonManifoldThreshold ?? 0;
  const bdThresh = options?.boundaryThreshold ?? 0.01;
  const skipEuler = options?.skipEulerCheck ?? false;
  const failures = [];
  const posAttr = geometry.attributes.position;
  if (!posAttr) {
    return {
      passed: false,
      failures: [{ check: "no_positions", severity: "error", detail: "Geometry has no position attribute", value: 0, threshold: 1 }],
      metrics: { vertexCount: 0, triangleCount: 0, nanVertices: 0, degenerateTriangles: 0, nonManifoldEdges: 0, boundaryEdges: 0, eulerCharacteristic: 0, expectedEuler: 2 }
    };
  }
  const posArr = posAttr.array;
  const vertexCount = posAttr.count;
  let idxArr;
  if (geometry.index) {
    idxArr = geometry.index.array;
  } else {
    idxArr = new Uint32Array(vertexCount);
    for (let i = 0; i < vertexCount; i++) idxArr[i] = i;
  }
  const triCount = Math.floor(idxArr.length / 3);
  if (triCount === 0 || vertexCount < 4) {
    failures.push({
      check: "empty_mesh",
      severity: "error",
      detail: `Output has ${triCount} triangles and ${vertexCount} vertices`,
      value: triCount,
      threshold: 1
    });
    return {
      passed: false,
      failures,
      metrics: { vertexCount, triangleCount: triCount, nanVertices: 0, degenerateTriangles: 0, nonManifoldEdges: 0, boundaryEdges: 0, eulerCharacteristic: 0, expectedEuler: 2 }
    };
  }
  let nanVertices = 0;
  for (let i = 0; i < posArr.length; i++) {
    if (!isFinite(posArr[i])) {
      nanVertices++;
    }
  }
  nanVertices = Math.ceil(nanVertices / 3);
  if (nanVertices > 0) {
    failures.push({
      check: "nan_vertices",
      severity: "error",
      detail: `${nanVertices} vertices contain NaN or Infinity values`,
      value: nanVertices,
      threshold: 0
    });
  }
  let degenerateTriangles = 0;
  for (let t = 0; t < triCount; t++) {
    const t3 = t * 3;
    const ai = idxArr[t3] * 3, bi = idxArr[t3 + 1] * 3, ci = idxArr[t3 + 2] * 3;
    const e1x = posArr[bi] - posArr[ai], e1y = posArr[bi + 1] - posArr[ai + 1], e1z = posArr[bi + 2] - posArr[ai + 2];
    const e2x = posArr[ci] - posArr[ai], e2y = posArr[ci + 1] - posArr[ai + 1], e2z = posArr[ci + 2] - posArr[ai + 2];
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
      threshold: Math.ceil(degThresh * triCount)
    });
  }
  let nonManifoldEdges = 0;
  let boundaryEdges = 0;
  let totalEdges = 0;
  let eulerCharacteristic = 0;
  const expectedEuler = 2;
  if (triCount <= LARGE_MESH_TRI_LIMIT) {
    const edgeCounts = /* @__PURE__ */ new Map();
    for (let t = 0; t < triCount; t++) {
      const t3 = t * 3;
      const a = idxArr[t3], b = idxArr[t3 + 1], c = idxArr[t3 + 2];
      const pairs = [[a, b], [b, c], [c, a]];
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
    if (nonManifoldEdges > nmThresh) {
      failures.push({
        check: "non_manifold_edges",
        severity: "error",
        detail: `${nonManifoldEdges} non-manifold edges detected`,
        value: nonManifoldEdges,
        threshold: nmThresh
      });
    }
    if (totalEdges > 0 && boundaryEdges / totalEdges > bdThresh) {
      failures.push({
        check: "boundary_edges",
        severity: "warning",
        detail: `${boundaryEdges} boundary (open) edges (${(boundaryEdges / totalEdges * 100).toFixed(1)}% of total)`,
        value: boundaryEdges,
        threshold: Math.ceil(bdThresh * totalEdges)
      });
    }
    if (!skipEuler) {
      eulerCharacteristic = vertexCount - totalEdges + triCount;
      if (eulerCharacteristic !== expectedEuler) {
        failures.push({
          check: "euler_characteristic",
          severity: "warning",
          detail: `Euler characteristic V-E+F = ${eulerCharacteristic}, expected ${expectedEuler} for closed genus-0 surface`,
          value: eulerCharacteristic,
          threshold: expectedEuler
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
      expectedEuler
    }
  };
}
export {
  validateReconstructionOutput
};
