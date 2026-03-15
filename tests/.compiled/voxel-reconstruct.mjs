import * as THREE from "three";
function autoVoxelResolution(bboxMM) {
  const maxDim = Math.max(bboxMM.x, bboxMM.y, bboxMM.z, 1);
  return Math.max(1, Math.min(maxDim / 500, 20));
}
function estimateOutputTriangles(bboxMM, resolutionMM, simplifyTarget) {
  const gx = Math.ceil(bboxMM.x / resolutionMM) + 2;
  const gy = Math.ceil(bboxMM.y / resolutionMM) + 2;
  const gz = Math.ceil(bboxMM.z / resolutionMM) + 2;
  const raw = 4 * (gx * gy + gy * gz + gz * gx);
  return simplifyTarget && simplifyTarget > 0 ? Math.min(raw, simplifyTarget) : raw;
}
const MAX_VOXELS_PER_AXIS = 1e3;
const MAX_TOTAL_VOXELS = 2e8;
const MAX_BBOX_DIMENSION_MM = 1e5;
function minSafeResolution(bboxMM, padding = 2) {
  const maxDim = Math.max(bboxMM.x, bboxMM.y, bboxMM.z);
  const fromAxis = maxDim / (MAX_VOXELS_PER_AXIS - padding);
  const vol = bboxMM.x * bboxMM.y * bboxMM.z;
  const fromTotal = Math.cbrt(vol / MAX_TOTAL_VOXELS);
  const raw = Math.max(fromAxis, fromTotal, 0.5);
  return Math.ceil(raw * 2) / 2;
}
function validateBBox(bbSize, bbMin) {
  const vals = [bbMin.x, bbMin.y, bbMin.z, bbSize.x, bbSize.y, bbSize.z];
  for (const v of vals) {
    if (!Number.isFinite(v)) {
      throw new Error(`BBox contains non-finite value: ${v}`);
    }
  }
  if (bbSize.x <= 0 || bbSize.y <= 0 || bbSize.z <= 0) {
    throw new Error(
      `BBox has zero/negative dimension: ${bbSize.x.toFixed(1)} \xD7 ${bbSize.y.toFixed(1)} \xD7 ${bbSize.z.toFixed(1)}`
    );
  }
  if (bbSize.x > MAX_BBOX_DIMENSION_MM || bbSize.y > MAX_BBOX_DIMENSION_MM || bbSize.z > MAX_BBOX_DIMENSION_MM) {
    throw new Error(
      `BBox suspiciously large: ${bbSize.x.toFixed(1)} \xD7 ${bbSize.y.toFixed(1)} \xD7 ${bbSize.z.toFixed(1)} mm (max ${MAX_BBOX_DIMENSION_MM} mm per axis)`
    );
  }
}
function validateGridDims(gx, gy, gz, resolution) {
  if (gx > MAX_VOXELS_PER_AXIS || gy > MAX_VOXELS_PER_AXIS || gz > MAX_VOXELS_PER_AXIS) {
    const maxDim = Math.max(gx, gy, gz);
    const minRes = maxDim * resolution / MAX_VOXELS_PER_AXIS;
    throw new Error(
      `Grid too large: ${gx} \xD7 ${gy} \xD7 ${gz} (max ${MAX_VOXELS_PER_AXIS}/axis). Increase resolution to at least ${minRes.toFixed(1)} mm.`
    );
  }
  const totalVoxels = gx * gy * gz;
  const memoryMB = Math.round(totalVoxels / 1e6);
  if (totalVoxels > MAX_TOTAL_VOXELS) {
    throw new Error(
      `Grid requires ~${memoryMB} MB (${totalVoxels.toLocaleString()} voxels, max ${MAX_TOTAL_VOXELS.toLocaleString()}). Increase resolution.`
    );
  }
}
function validateOutputPositions(positions, bbMin, bbMax, resolution) {
  const vertCount = Math.floor(positions.length / 3);
  if (vertCount === 0) return;
  const margin = resolution * 5;
  const minX = bbMin.x - margin, maxX = bbMax.x + margin;
  const minY = bbMin.y - margin, maxY = bbMax.y + margin;
  const minZ = bbMin.z - margin, maxZ = bbMax.z + margin;
  const MAX_SAMPLES = 1e3;
  const step = Math.max(1, Math.floor(vertCount / MAX_SAMPLES));
  for (let vi = 0; vi < vertCount; vi += step) {
    const i = vi * 3;
    const x = positions[i], y = positions[i + 1], z = positions[i + 2];
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
      throw new Error(`Output contains NaN/Infinity at vertex ${vi}: (${x}, ${y}, ${z})`);
    }
    if (x < minX || x > maxX || y < minY || y > maxY || z < minZ || z > maxZ) {
      throw new Error(
        `Output vertex ${vi} outside expected bounds: (${x.toFixed(1)}, ${y.toFixed(1)}, ${z.toFixed(1)}) vs bbox (${bbMin.x.toFixed(1)}..${bbMax.x.toFixed(1)}, ${bbMin.y.toFixed(1)}..${bbMax.y.toFixed(1)}, ${bbMin.z.toFixed(1)}..${bbMax.z.toFixed(1)})`
      );
    }
  }
  const lastI = (vertCount - 1) * 3;
  const lx = positions[lastI], ly = positions[lastI + 1], lz = positions[lastI + 2];
  if (!Number.isFinite(lx) || !Number.isFinite(ly) || !Number.isFinite(lz)) {
    throw new Error(`Output contains NaN/Infinity at last vertex ${vertCount - 1}: (${lx}, ${ly}, ${lz})`);
  }
}
const MAX_INTERMEDIATE_TRIANGLES = 5e7;
function validateEstimatedTriangles(gx, gy, gz) {
  const surfaceCubes = 2 * (gx * gy + gy * gz + gx * gz);
  const estimate = surfaceCubes * 2;
  if (estimate > MAX_INTERMEDIATE_TRIANGLES) {
    throw new Error(
      `Estimated ${estimate.toLocaleString()} intermediate triangles would exceed memory limit. Increase resolution.`
    );
  }
}
function validateResolution(resolution) {
  if (typeof resolution !== "number" || !Number.isFinite(resolution) || resolution <= 0) {
    throw new Error(`Invalid resolution: ${resolution} (must be a finite positive number)`);
  }
}
function isSeverelyCorrupted(openEdges, nonManifoldEdges, triangleCount) {
  if (triangleCount === 0) return false;
  const totalEdges = triangleCount * 1.5;
  return openEdges / totalEdges > 0.01 || nonManifoldEdges / totalEdges > 5e-3;
}
async function yieldToUI() {
  await new Promise((r) => setTimeout(r, 0));
}
const FACE_DIRS = [
  // +X  normal=(1,0,0)
  { dx: 1, dy: 0, dz: 0, v: [[1, -1, -1], [1, 1, -1], [1, 1, 1], [1, -1, 1]] },
  // -X  normal=(-1,0,0)
  { dx: -1, dy: 0, dz: 0, v: [[-1, -1, 1], [-1, 1, 1], [-1, 1, -1], [-1, -1, -1]] },
  // +Y  normal=(0,1,0)
  { dx: 0, dy: 1, dz: 0, v: [[-1, 1, 1], [1, 1, 1], [1, 1, -1], [-1, 1, -1]] },
  // -Y  normal=(0,-1,0)
  { dx: 0, dy: -1, dz: 0, v: [[-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1]] },
  // +Z  normal=(0,0,1)
  { dx: 0, dy: 0, dz: 1, v: [[1, -1, 1], [1, 1, 1], [-1, 1, 1], [-1, -1, 1]] },
  // -Z  normal=(0,0,-1)
  { dx: 0, dy: 0, dz: -1, v: [[-1, -1, -1], [-1, 1, -1], [1, 1, -1], [1, -1, -1]] }
];
async function voxelReconstruct(geo, onProgress, resolutionMM, params) {
  const g = geo.index ? geo.toNonIndexed() : geo.clone();
  g.computeBoundingBox();
  const bb = g.boundingBox;
  const bbSize = new THREE.Vector3();
  bb.getSize(bbSize);
  const resolution = resolutionMM ?? params?.resolution ?? autoVoxelResolution({ x: bbSize.x, y: bbSize.y, z: bbSize.z });
  const degenerateThreshold = params?.degenerateThreshold ?? 1e-12;
  validateResolution(resolution);
  validateBBox(bbSize, bb.min);
  const PAD = Math.max(1, Math.min(5, params?.gridPadding ?? 1));
  const gx = Math.ceil(bbSize.x / resolution) + 2 * PAD;
  const gy = Math.ceil(bbSize.y / resolution) + 2 * PAD;
  const gz = Math.ceil(bbSize.z / resolution) + 2 * PAD;
  const dims = [gx, gy, gz];
  validateGridDims(gx, gy, gz, resolution);
  validateEstimatedTriangles(gx, gy, gz);
  const ox = bb.min.x - PAD * resolution;
  const oy = bb.min.y - PAD * resolution;
  const oz = bb.min.z - PAD * resolution;
  const SY = gx;
  const SZ = gx * gy;
  const totalVoxels = gx * gy * gz;
  const SOLID = 1;
  const EXT = 2;
  const grid = new Uint8Array(totalVoxels);
  onProgress(0, 4, "Voxelizing mesh\u2026");
  await yieldToUI();
  const posArr = g.attributes.position.array;
  const triCount = Math.floor(posArr.length / 9);
  const colCross = Array.from({ length: gx * gy }, () => []);
  let lastYieldAt = Date.now();
  for (let t = 0; t < triCount; t++) {
    const b = t * 9;
    const ax = posArr[b], ay = posArr[b + 1], az = posArr[b + 2];
    const bx = posArr[b + 3], by = posArr[b + 4], bz = posArr[b + 5];
    const cx = posArr[b + 6], cy = posArr[b + 7], cz = posArr[b + 8];
    const xMin = Math.min(ax, bx, cx), xMax = Math.max(ax, bx, cx);
    const yMin = Math.min(ay, by, cy), yMax = Math.max(ay, by, cy);
    const ixMin = Math.max(0, Math.floor((xMin - ox) / resolution));
    const ixMax = Math.min(gx - 1, Math.ceil((xMax - ox) / resolution));
    const iyMin = Math.max(0, Math.floor((yMin - oy) / resolution));
    const iyMax = Math.min(gy - 1, Math.ceil((yMax - oy) / resolution));
    const e1x = bx - ax, e1y = by - ay;
    const e2x = cx - ax, e2y = cy - ay;
    const denom = e1x * e2y - e1y * e2x;
    if (Math.abs(denom) < degenerateThreshold) continue;
    const inv = 1 / denom;
    for (let ix = ixMin; ix <= ixMax; ix++) {
      const px = ox + (ix + 0.5) * resolution - ax;
      for (let iy = iyMin; iy <= iyMax; iy++) {
        const py = oy + (iy + 0.5) * resolution - ay;
        const u = (px * e2y - py * e2x) * inv;
        const v = (e1x * py - e1y * px) * inv;
        if (u < 0 || v < 0 || u + v > 1) continue;
        colCross[ix * gy + iy].push(az + u * (bz - az) + v * (cz - az));
      }
    }
    if (t % 1e4 === 0 && Date.now() - lastYieldAt > 50) {
      onProgress(0, 4, `Voxelizing\u2026 ${Math.round(t / triCount * 100)}%`);
      await yieldToUI();
      lastYieldAt = Date.now();
    }
  }
  for (let ix = 0; ix < gx; ix++) {
    for (let iy = 0; iy < gy; iy++) {
      const zs = colCross[ix * gy + iy];
      if (zs.length < 2) continue;
      zs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < zs.length; k += 2) {
        const izMin = Math.max(0, Math.floor((zs[k] - oz) / resolution));
        const izMax = Math.min(gz - 1, Math.ceil((zs[k + 1] - oz) / resolution));
        for (let iz = izMin; iz <= izMax; iz++) {
          grid[ix + iy * SY + iz * SZ] = SOLID;
        }
      }
    }
    if (ix % 100 === 0 && Date.now() - lastYieldAt > 50) {
      await yieldToUI();
      lastYieldAt = Date.now();
    }
  }
  onProgress(2, 4, "Flood-filling exterior\u2026");
  await yieldToUI();
  grid[0] = EXT;
  const queue = [0];
  let qHead = 0;
  lastYieldAt = Date.now();
  while (qHead < queue.length) {
    const cur = queue[qHead++];
    const iz = Math.floor(cur / SZ);
    const iy = Math.floor(cur % SZ / SY);
    const ix = cur % SY;
    if (ix + 1 < gx && grid[cur + 1] === 0) {
      grid[cur + 1] = EXT;
      queue.push(cur + 1);
    }
    if (ix - 1 >= 0 && grid[cur - 1] === 0) {
      grid[cur - 1] = EXT;
      queue.push(cur - 1);
    }
    if (iy + 1 < gy && grid[cur + SY] === 0) {
      grid[cur + SY] = EXT;
      queue.push(cur + SY);
    }
    if (iy - 1 >= 0 && grid[cur - SY] === 0) {
      grid[cur - SY] = EXT;
      queue.push(cur - SY);
    }
    if (iz + 1 < gz && grid[cur + SZ] === 0) {
      grid[cur + SZ] = EXT;
      queue.push(cur + SZ);
    }
    if (iz - 1 >= 0 && grid[cur - SZ] === 0) {
      grid[cur - SZ] = EXT;
      queue.push(cur - SZ);
    }
    if (qHead % 2e5 === 0 && Date.now() - lastYieldAt > 50) {
      onProgress(2, 4, `Flood-filling\u2026 ${Math.round(qHead / totalVoxels * 100)}%`);
      await yieldToUI();
      lastYieldAt = Date.now();
    }
  }
  onProgress(3, 4, "Extracting surface\u2026");
  await yieldToUI();
  const posOut = [];
  const r = resolution * 0.5;
  lastYieldAt = Date.now();
  for (let iz = 0; iz < gz; iz++) {
    for (let iy = 0; iy < gy; iy++) {
      for (let ix = 0; ix < gx; ix++) {
        if (grid[ix + iy * SY + iz * SZ] !== SOLID) continue;
        const wx = ox + (ix + 0.5) * resolution;
        const wy = oy + (iy + 0.5) * resolution;
        const wz = oz + (iz + 0.5) * resolution;
        for (const f of FACE_DIRS) {
          const nx = ix + f.dx, ny = iy + f.dy, nz = iz + f.dz;
          if (nx < 0 || nx >= gx || ny < 0 || ny >= gy || nz < 0 || nz >= gz) continue;
          if (grid[nx + ny * SY + nz * SZ] === SOLID) continue;
          const [v0, v1, v2, v3] = f.v;
          posOut.push(
            wx + r * v0[0],
            wy + r * v0[1],
            wz + r * v0[2],
            wx + r * v1[0],
            wy + r * v1[1],
            wz + r * v1[2],
            wx + r * v2[0],
            wy + r * v2[1],
            wz + r * v2[2]
          );
          posOut.push(
            wx + r * v0[0],
            wy + r * v0[1],
            wz + r * v0[2],
            wx + r * v2[0],
            wy + r * v2[1],
            wz + r * v2[2],
            wx + r * v3[0],
            wy + r * v3[1],
            wz + r * v3[2]
          );
        }
      }
    }
    if (iz % 20 === 0 && Date.now() - lastYieldAt > 50) {
      onProgress(3, 4, `Extracting\u2026 ${Math.round(iz / gz * 100)}%`);
      await yieldToUI();
      lastYieldAt = Date.now();
    }
  }
  onProgress(4, 4, "Finalizing geometry\u2026");
  await yieldToUI();
  const outGeo = new THREE.BufferGeometry();
  const posFloat = new Float32Array(posOut);
  validateOutputPositions(posFloat, bb.min, bb.max, resolution);
  outGeo.setAttribute("position", new THREE.BufferAttribute(posFloat, 3));
  outGeo.computeVertexNormals();
  g.dispose();
  return {
    geometry: outGeo,
    resolution,
    gridDims: dims,
    outputTriangles: Math.floor(posFloat.length / 9)
  };
}
function buildAdjacency(pos, vertCount) {
  const u32 = new Uint32Array(pos.buffer, pos.byteOffset, pos.length);
  const map = /* @__PURE__ */ new Map();
  const canon = new Uint32Array(vertCount);
  for (let i = 0; i < vertCount; i++) {
    const key = `${u32[i * 3]},${u32[i * 3 + 1]},${u32[i * 3 + 2]}`;
    const existing = map.get(key);
    if (existing !== void 0) {
      canon[i] = existing;
    } else {
      map.set(key, i);
      canon[i] = i;
    }
  }
  const adj = /* @__PURE__ */ new Map();
  const triCount = Math.floor(vertCount / 3);
  for (let t = 0; t < triCount; t++) {
    const a = canon[t * 3];
    const b = canon[t * 3 + 1];
    const c = canon[t * 3 + 2];
    if (!adj.has(a)) adj.set(a, /* @__PURE__ */ new Set());
    if (!adj.has(b)) adj.set(b, /* @__PURE__ */ new Set());
    if (!adj.has(c)) adj.set(c, /* @__PURE__ */ new Set());
    adj.get(a).add(b);
    adj.get(a).add(c);
    adj.get(b).add(a);
    adj.get(b).add(c);
    adj.get(c).add(a);
    adj.get(c).add(b);
  }
  return { canon, adj };
}
function laplacianSmoothPass(pos, vertCount, canon, adj, lambda) {
  const newPos = new Float64Array(vertCount * 3);
  for (const [ci, nbrs] of adj) {
    if (nbrs.size === 0) continue;
    let cx = 0, cy = 0, cz = 0;
    for (const n of nbrs) {
      cx += pos[n * 3];
      cy += pos[n * 3 + 1];
      cz += pos[n * 3 + 2];
    }
    cx /= nbrs.size;
    cy /= nbrs.size;
    cz /= nbrs.size;
    newPos[ci * 3] = pos[ci * 3] + lambda * (cx - pos[ci * 3]);
    newPos[ci * 3 + 1] = pos[ci * 3 + 1] + lambda * (cy - pos[ci * 3 + 1]);
    newPos[ci * 3 + 2] = pos[ci * 3 + 2] + lambda * (cz - pos[ci * 3 + 2]);
  }
  for (let i = 0; i < vertCount; i++) {
    const ci = canon[i];
    pos[i * 3] = newPos[ci * 3];
    pos[i * 3 + 1] = newPos[ci * 3 + 1];
    pos[i * 3 + 2] = newPos[ci * 3 + 2];
  }
}
async function taubinSmooth(geo, iterations, onProgress, lambda = 0.5, mu = -0.53) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const pos = g.attributes.position.array;
  const vertCount = Math.floor(pos.length / 3);
  const { canon, adj } = buildAdjacency(pos, vertCount);
  for (let i = 0; i < iterations; i++) {
    laplacianSmoothPass(pos, vertCount, canon, adj, lambda);
    laplacianSmoothPass(pos, vertCount, canon, adj, mu);
    if (onProgress) onProgress(i + 1, iterations, `Smoothing\u2026 pass ${i + 1}/${iterations}`);
    await yieldToUI();
  }
  g.attributes.position.needsUpdate = true;
  g.computeVertexNormals();
  if (geo.index) {
    geo.setAttribute("position", g.attributes.position);
    geo.setIndex(null);
    geo.computeVertexNormals();
  }
}
async function quadricSimplify(geo, targetTriangles, onProgress, boundaryPenalty = 1) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const srcPos = g.attributes.position.array;
  const srcVertCount = Math.floor(srcPos.length / 3);
  const srcTriCount = Math.floor(srcVertCount / 3);
  if (srcTriCount <= targetTriangles) return g;
  const u32 = new Uint32Array(srcPos.buffer, srcPos.byteOffset, srcPos.length);
  const vertMap = /* @__PURE__ */ new Map();
  const remap = new Uint32Array(srcVertCount);
  const positions = [];
  let uniqueVerts = 0;
  for (let i = 0; i < srcVertCount; i++) {
    const key = `${u32[i * 3]},${u32[i * 3 + 1]},${u32[i * 3 + 2]}`;
    const existing = vertMap.get(key);
    if (existing !== void 0) {
      remap[i] = existing;
    } else {
      vertMap.set(key, uniqueVerts);
      remap[i] = uniqueVerts;
      positions.push(srcPos[i * 3], srcPos[i * 3 + 1], srcPos[i * 3 + 2]);
      uniqueVerts++;
    }
  }
  const vx = new Float64Array(uniqueVerts);
  const vy = new Float64Array(uniqueVerts);
  const vz = new Float64Array(uniqueVerts);
  for (let i = 0; i < uniqueVerts; i++) {
    vx[i] = positions[i * 3];
    vy[i] = positions[i * 3 + 1];
    vz[i] = positions[i * 3 + 2];
  }
  const tris = new Int32Array(srcTriCount * 3);
  const alive = new Uint8Array(srcTriCount);
  let liveTriCount = srcTriCount;
  for (let t = 0; t < srcTriCount; t++) {
    tris[t * 3] = remap[t * 3];
    tris[t * 3 + 1] = remap[t * 3 + 1];
    tris[t * 3 + 2] = remap[t * 3 + 2];
    if (tris[t * 3] === tris[t * 3 + 1] || tris[t * 3 + 1] === tris[t * 3 + 2] || tris[t * 3] === tris[t * 3 + 2]) {
      alive[t] = 0;
      liveTriCount--;
    } else {
      alive[t] = 1;
    }
  }
  const Q = new Float64Array(uniqueVerts * 10);
  function addPlaneQuadric(vi, a, b, c, d) {
    const off = vi * 10;
    Q[off] += a * a;
    Q[off + 1] += a * b;
    Q[off + 2] += a * c;
    Q[off + 3] += a * d;
    Q[off + 4] += b * b;
    Q[off + 5] += b * c;
    Q[off + 6] += b * d;
    Q[off + 7] += c * c;
    Q[off + 8] += c * d;
    Q[off + 9] += d * d;
  }
  for (let t = 0; t < srcTriCount; t++) {
    if (!alive[t]) continue;
    const i0 = tris[t * 3], i1 = tris[t * 3 + 1], i2 = tris[t * 3 + 2];
    const ex1 = vx[i1] - vx[i0], ey1 = vy[i1] - vy[i0], ez1 = vz[i1] - vz[i0];
    const ex2 = vx[i2] - vx[i0], ey2 = vy[i2] - vy[i0], ez2 = vz[i2] - vz[i0];
    let nx = ey1 * ez2 - ez1 * ey2, ny = ez1 * ex2 - ex1 * ez2, nz = ex1 * ey2 - ey1 * ex2;
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (len < 1e-20) continue;
    nx /= len;
    ny /= len;
    nz /= len;
    const d = -(nx * vx[i0] + ny * vy[i0] + nz * vz[i0]);
    addPlaneQuadric(i0, nx, ny, nz, d);
    addPlaneQuadric(i1, nx, ny, nz, d);
    addPlaneQuadric(i2, nx, ny, nz, d);
  }
  const vertTris = Array.from({ length: uniqueVerts }, () => /* @__PURE__ */ new Set());
  for (let t = 0; t < srcTriCount; t++) {
    if (!alive[t]) continue;
    vertTris[tris[t * 3]].add(t);
    vertTris[tris[t * 3 + 1]].add(t);
    vertTris[tris[t * 3 + 2]].add(t);
  }
  const edgeSet = /* @__PURE__ */ new Set();
  const edgeTriCount = /* @__PURE__ */ new Map();
  let edges = [];
  function edgeKey(a, b) {
    return a < b ? `${a},${b}` : `${b},${a}`;
  }
  for (let t = 0; t < srcTriCount; t++) {
    if (!alive[t]) continue;
    const i0 = tris[t * 3], i1 = tris[t * 3 + 1], i2 = tris[t * 3 + 2];
    for (const ek of [edgeKey(i0, i1), edgeKey(i1, i2), edgeKey(i2, i0)]) {
      edgeTriCount.set(ek, (edgeTriCount.get(ek) ?? 0) + 1);
    }
  }
  function d3(a, b, c, d, e, f, g2, h, i) {
    return a * (e * i - f * h) - b * (d * i - f * g2) + c * (d * h - e * g2);
  }
  function computeEdgeCost(a, b) {
    const qa = a * 10, qb = b * 10;
    const s0 = Q[qa] + Q[qb], s1 = Q[qa + 1] + Q[qb + 1], s2 = Q[qa + 2] + Q[qb + 2], s3 = Q[qa + 3] + Q[qb + 3];
    const s4 = Q[qa + 4] + Q[qb + 4], s5 = Q[qa + 5] + Q[qb + 5], s6 = Q[qa + 6] + Q[qb + 6];
    const s7 = Q[qa + 7] + Q[qb + 7], s8 = Q[qa + 8] + Q[qb + 8];
    const s9 = Q[qa + 9] + Q[qb + 9];
    const midX = (vx[a] + vx[b]) * 0.5;
    const midY = (vy[a] + vy[b]) * 0.5;
    const midZ = (vz[a] + vz[b]) * 0.5;
    let mx = midX, my = midY, mz = midZ;
    const det = d3(s0, s1, s2, s1, s4, s5, s2, s5, s7);
    if (Math.abs(det) > 1e-10) {
      const idet = 1 / det;
      const cx = idet * d3(-s3, s1, s2, -s6, s4, s5, -s8, s5, s7);
      const cy = idet * d3(s0, -s3, s2, s1, -s6, s5, s2, -s8, s7);
      const cz = idet * d3(s0, s1, -s3, s1, s4, -s6, s2, s5, -s8);
      const edgeLenSq = (vx[b] - vx[a]) ** 2 + (vy[b] - vy[a]) ** 2 + (vz[b] - vz[a]) ** 2;
      const distSq = (cx - midX) ** 2 + (cy - midY) ** 2 + (cz - midZ) ** 2;
      if (distSq < edgeLenSq * 4) {
        mx = cx;
        my = cy;
        mz = cz;
      }
    }
    const cost = s0 * mx * mx + 2 * s1 * mx * my + 2 * s2 * mx * mz + 2 * s3 * mx + s4 * my * my + 2 * s5 * my * mz + 2 * s6 * my + s7 * mz * mz + 2 * s8 * mz + s9;
    let finalCost = Math.abs(cost);
    if (boundaryPenalty > 1) {
      const ek = edgeKey(a, b);
      if ((edgeTriCount.get(ek) ?? 2) < 2) {
        finalCost *= boundaryPenalty;
      }
    }
    return { v0: a, v1: b, cost: finalCost, mx, my, mz };
  }
  for (let t = 0; t < srcTriCount; t++) {
    if (!alive[t]) continue;
    const i0 = tris[t * 3], i1 = tris[t * 3 + 1], i2 = tris[t * 3 + 2];
    for (const [a, b] of [[i0, i1], [i1, i2], [i2, i0]]) {
      const k = edgeKey(a, b);
      if (!edgeSet.has(k)) {
        edgeSet.add(k);
        edges.push(computeEdgeCost(a, b));
      }
    }
  }
  edges.sort((a, b) => a.cost - b.cost);
  const vertAlias = new Int32Array(uniqueVerts);
  for (let i = 0; i < uniqueVerts; i++) vertAlias[i] = i;
  function resolve(v) {
    while (vertAlias[v] !== v) v = vertAlias[v];
    return v;
  }
  let edgeIdx = 0;
  let lastYield = Date.now();
  const startLive = liveTriCount;
  let rebuilds = 0;
  for (; ; ) {
    while (liveTriCount > targetTriangles && edgeIdx < edges.length) {
      const e = edges[edgeIdx++];
      const rv0 = resolve(e.v0), rv1 = resolve(e.v1);
      if (rv0 === rv1) continue;
      let flipDetected = false;
      for (const t of vertTris[rv1]) {
        if (!alive[t]) continue;
        const i0 = resolve(tris[t * 3]), i1 = resolve(tris[t * 3 + 1]), i2 = resolve(tris[t * 3 + 2]);
        if ((i0 === rv0 || i1 === rv0 || i2 === rv0) && (i0 === rv1 || i1 === rv1 || i2 === rv1)) continue;
        const ti = [i0, i1, i2].map((v) => v === rv1 ? -1 : v);
        const px = ti.map((v) => v === -1 ? e.mx : vx[v]);
        const py = ti.map((v) => v === -1 ? e.my : vy[v]);
        const pz = ti.map((v) => v === -1 ? e.mz : vz[v]);
        const oex1 = vx[i1] - vx[i0], oey1 = vy[i1] - vy[i0], oez1 = vz[i1] - vz[i0];
        const oex2 = vx[i2] - vx[i0], oey2 = vy[i2] - vy[i0], oez2 = vz[i2] - vz[i0];
        const onx = oey1 * oez2 - oez1 * oey2, ony = oez1 * oex2 - oex1 * oez2, onz = oex1 * oey2 - oey1 * oex2;
        const nex1 = px[1] - px[0], ney1 = py[1] - py[0], nez1 = pz[1] - pz[0];
        const nex2 = px[2] - px[0], ney2 = py[2] - py[0], nez2 = pz[2] - pz[0];
        const nnx = ney1 * nez2 - nez1 * ney2, nny = nez1 * nex2 - nex1 * nez2, nnz = nex1 * ney2 - ney1 * nex2;
        if (onx * nnx + ony * nny + onz * nnz < 0) {
          flipDetected = true;
          break;
        }
      }
      if (flipDetected) continue;
      vertAlias[rv1] = rv0;
      vx[rv0] = e.mx;
      vy[rv0] = e.my;
      vz[rv0] = e.mz;
      const qa = rv0 * 10, qb = rv1 * 10;
      for (let i = 0; i < 10; i++) Q[qa + i] += Q[qb + i];
      for (const t of vertTris[rv1]) {
        if (!alive[t]) continue;
        vertTris[rv0].add(t);
        for (let k = 0; k < 3; k++) {
          tris[t * 3 + k] = resolve(tris[t * 3 + k]);
        }
        const a = tris[t * 3], b = tris[t * 3 + 1], c = tris[t * 3 + 2];
        if (a === b || b === c || a === c) {
          alive[t] = 0;
          liveTriCount--;
          vertTris[a]?.delete(t);
          vertTris[b]?.delete(t);
          vertTris[c]?.delete(t);
        }
      }
      if (Date.now() - lastYield > 50) {
        const pct = Math.round((startLive - liveTriCount) / (startLive - targetTriangles) * 100);
        if (onProgress) onProgress(pct, 100, `Simplifying\u2026 ${liveTriCount.toLocaleString()} triangles`);
        await yieldToUI();
        lastYield = Date.now();
      }
    }
    if (liveTriCount <= targetTriangles || ++rebuilds > 3) break;
    edgeSet.clear();
    edges = [];
    edgeIdx = 0;
    for (let t = 0; t < srcTriCount; t++) {
      if (!alive[t]) continue;
      const ri0 = resolve(tris[t * 3]), ri1 = resolve(tris[t * 3 + 1]), ri2 = resolve(tris[t * 3 + 2]);
      for (const [ea, eb] of [[ri0, ri1], [ri1, ri2], [ri2, ri0]]) {
        if (ea === eb) continue;
        const k = edgeKey(ea, eb);
        if (!edgeSet.has(k)) {
          edgeSet.add(k);
          edges.push(computeEdgeCost(ea, eb));
        }
      }
    }
    edges.sort((a, b) => a.cost - b.cost);
    if (onProgress) onProgress(0, 100, `Re-sorting edges (pass ${rebuilds})\u2026`);
    await yieldToUI();
    lastYield = Date.now();
  }
  const outPos = [];
  for (let t = 0; t < srcTriCount; t++) {
    if (!alive[t]) continue;
    const i0 = resolve(tris[t * 3]), i1 = resolve(tris[t * 3 + 1]), i2 = resolve(tris[t * 3 + 2]);
    outPos.push(
      vx[i0],
      vy[i0],
      vz[i0],
      vx[i1],
      vy[i1],
      vz[i1],
      vx[i2],
      vy[i2],
      vz[i2]
    );
  }
  const outGeo = new THREE.BufferGeometry();
  outGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(outPos), 3));
  outGeo.computeVertexNormals();
  if (onProgress) onProgress(100, 100, `Simplified to ${liveTriCount.toLocaleString()} triangles`);
  return outGeo;
}
async function postProcessVoxelOutput(geo, params, onProgress) {
  let result = geo;
  const currentTris = result.index ? Math.floor(result.index.count / 3) : Math.floor(result.attributes.position.array.length / 9);
  if (params.simplifyTarget > 0 && currentTris > params.simplifyTarget) {
    if (onProgress) onProgress(0, 2, "Simplifying mesh\u2026");
    result = await quadricSimplify(result, params.simplifyTarget, onProgress, params.boundaryPenalty ?? 1);
  }
  if (params.smoothingIterations > 0) {
    if (onProgress) onProgress(1, 2, "Smoothing surface\u2026");
    const lambda = params.smoothingLambda ?? 0.5;
    const mu = params.taubinMu ?? -(lambda + 0.03);
    await taubinSmooth(result, params.smoothingIterations, onProgress, lambda, mu);
  }
  const { toCreasedNormals, mergeVertices } = await import("three/examples/jsm/utils/BufferGeometryUtils.js");
  const CREASE_ANGLE = Math.PI / 6;
  const indexed = result.index ? result : mergeVertices(result);
  result = mergeVertices(toCreasedNormals(indexed, CREASE_ANGLE));
  return result;
}
async function estimateWallThickness(geo, sampleCount = 200) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  g.computeBoundingBox();
  const bb = g.boundingBox;
  const bbSize = new THREE.Vector3();
  bb.getSize(bbSize);
  const maxDim = Math.max(bbSize.x, bbSize.y, bbSize.z, 1);
  const posArr = g.attributes.position.array;
  const triCount = Math.floor(posArr.length / 9);
  const thicknesses = [];
  const cols = Math.ceil(Math.sqrt(sampleCount));
  let lastYieldAt = Date.now();
  for (let si = 0; si < cols; si++) {
    for (let sj = 0; sj < cols; sj++) {
      const cx = bb.min.x + (0.05 + 0.9 * (si / (cols - 1 || 1))) * bbSize.x;
      const cy = bb.min.y + (0.05 + 0.9 * (sj / (cols - 1 || 1))) * bbSize.y;
      const zCrossings = [];
      for (let t = 0; t < triCount; t++) {
        const b = t * 9;
        const ax = posArr[b], ay = posArr[b + 1], az = posArr[b + 2];
        const bx = posArr[b + 3], by = posArr[b + 4], bz = posArr[b + 5];
        const dx = posArr[b + 6], dy = posArr[b + 7], dz = posArr[b + 8];
        const e1x = bx - ax, e1y = by - ay;
        const e2x = dx - ax, e2y = dy - ay;
        const denom = e1x * e2y - e1y * e2x;
        if (Math.abs(denom) < 1e-12) continue;
        const px = cx - ax, py = cy - ay;
        const u = (px * e2y - py * e2x) / denom;
        const v = (e1x * py - e1y * px) / denom;
        if (u < 0 || v < 0 || u + v > 1) continue;
        zCrossings.push(az + u * (bz - az) + v * (dz - az));
      }
      zCrossings.sort((a, b) => a - b);
      for (let k = 0; k + 1 < zCrossings.length; k += 2) {
        const t = zCrossings[k + 1] - zCrossings[k];
        if (t > 0) thicknesses.push(t);
      }
    }
    if (Date.now() - lastYieldAt > 50) {
      await yieldToUI();
      lastYieldAt = Date.now();
    }
  }
  if (thicknesses.length === 0) return { avgMM: 0, minMM: 0, isThinShell: true };
  thicknesses.sort((a, b) => a - b);
  const avg = thicknesses.reduce((s, v) => s + v, 0) / thicknesses.length;
  const min = thicknesses[0];
  const median = thicknesses[Math.floor(thicknesses.length / 2)];
  return { avgMM: avg, minMM: min, isThinShell: median < maxDim * 0.01 };
}
function rasterizeTriangleSurface(grid, SY, SZ, gx, gy, gz, ax, ay, az, bx, by, bz, cx, cy, cz, ox, oy, oz, res) {
  const SOLID = 1;
  function rasterize3DEdge(x0, y0, z0, x1, y1, z1) {
    const vx0 = (x0 - ox) / res, vy0 = (y0 - oy) / res, vz0 = (z0 - oz) / res;
    const dx = (x1 - ox) / res - vx0;
    const dy = (y1 - oy) / res - vy0;
    const dz = (z1 - oz) / res - vz0;
    const steps = Math.ceil(Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)));
    const n = Math.max(steps, 1);
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const ix = Math.floor(vx0 + t * dx);
      const iy = Math.floor(vy0 + t * dy);
      const iz = Math.floor(vz0 + t * dz);
      if (ix >= 0 && ix < gx && iy >= 0 && iy < gy && iz >= 0 && iz < gz) {
        grid[ix + iy * SY + iz * SZ] = SOLID;
      }
    }
  }
  rasterize3DEdge(ax, ay, az, bx, by, bz);
  rasterize3DEdge(bx, by, bz, cx, cy, cz);
  rasterize3DEdge(cx, cy, cz, ax, ay, az);
  const zMin = Math.min(az, bz, cz);
  const zMax = Math.max(az, bz, cz);
  const izMin = Math.max(0, Math.floor((zMin - oz) / res));
  const izMax = Math.min(gz - 1, Math.ceil((zMax - oz) / res));
  const verts = [
    [ax, ay, az],
    [bx, by, bz],
    [cx, cy, cz]
  ];
  for (let iz = izMin; iz <= izMax; iz++) {
    const zMid = oz + (iz + 0.5) * res;
    const pts = [];
    for (let i = 0; i < 3; i++) {
      const j = (i + 1) % 3;
      const vi = verts[i], vj = verts[j];
      const di = vi[2] - zMid, dj = vj[2] - zMid;
      if (Math.abs(di) < 1e-10) {
        pts.push([vi[0], vi[1]]);
        continue;
      }
      if (di > 0 !== dj > 0) {
        const t = di / (di - dj);
        pts.push([vi[0] + t * (vj[0] - vi[0]), vi[1] + t * (vj[1] - vi[1])]);
      }
    }
    if (pts.length < 2) continue;
    const ix0 = Math.floor((pts[0][0] - ox) / res);
    const iy0 = Math.floor((pts[0][1] - oy) / res);
    const ix1 = Math.floor((pts[pts.length - 1][0] - ox) / res);
    const iy1 = Math.floor((pts[pts.length - 1][1] - oy) / res);
    const ddx = ix1 - ix0, ddy = iy1 - iy0;
    const steps = Math.max(Math.abs(ddx), Math.abs(ddy), 1);
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const ix = Math.floor(ix0 + t * ddx);
      const iy = Math.floor(iy0 + t * ddy);
      if (ix >= 0 && ix < gx && iy >= 0 && iy < gy) {
        grid[ix + iy * SY + iz * SZ] = SOLID;
      }
    }
  }
}
function dilate3D(grid, gx, gy, gz, SY, SZ) {
  const out = new Uint8Array(grid.length);
  for (let iz = 0; iz < gz; iz++) {
    for (let iy = 0; iy < gy; iy++) {
      for (let ix = 0; ix < gx; ix++) {
        const i = ix + iy * SY + iz * SZ;
        if (grid[i] || ix > 0 && grid[i - 1] || ix < gx - 1 && grid[i + 1] || iy > 0 && grid[i - SY] || iy < gy - 1 && grid[i + SY] || iz > 0 && grid[i - SZ] || iz < gz - 1 && grid[i + SZ]) {
          out[i] = 1;
        }
      }
    }
  }
  return out;
}
async function shellVoxelReconstruct(geo, onProgress, resolutionMM, dilationVoxels = 1) {
  const g = geo.index ? geo.toNonIndexed() : geo.clone();
  g.computeBoundingBox();
  const bb = g.boundingBox;
  const bbSize = new THREE.Vector3();
  bb.getSize(bbSize);
  const resolution = resolutionMM ?? autoVoxelResolution({ x: bbSize.x, y: bbSize.y, z: bbSize.z });
  validateResolution(resolution);
  validateBBox(bbSize, bb.min);
  const PAD = dilationVoxels + 1;
  const gx = Math.ceil(bbSize.x / resolution) + 2 * PAD;
  const gy = Math.ceil(bbSize.y / resolution) + 2 * PAD;
  const gz = Math.ceil(bbSize.z / resolution) + 2 * PAD;
  const dims = [gx, gy, gz];
  validateGridDims(gx, gy, gz, resolution);
  validateEstimatedTriangles(gx, gy, gz);
  const ox = bb.min.x - PAD * resolution;
  const oy = bb.min.y - PAD * resolution;
  const oz = bb.min.z - PAD * resolution;
  const SY = gx, SZ = gx * gy;
  let grid = new Uint8Array(gx * gy * gz);
  onProgress(0, 3, "Rasterizing surface\u2026");
  await yieldToUI();
  const posArr = g.attributes.position.array;
  const triCount = Math.floor(posArr.length / 9);
  let lastYieldAt = Date.now();
  for (let t = 0; t < triCount; t++) {
    const b = t * 9;
    rasterizeTriangleSurface(
      grid,
      SY,
      SZ,
      gx,
      gy,
      gz,
      posArr[b],
      posArr[b + 1],
      posArr[b + 2],
      posArr[b + 3],
      posArr[b + 4],
      posArr[b + 5],
      posArr[b + 6],
      posArr[b + 7],
      posArr[b + 8],
      ox,
      oy,
      oz,
      resolution
    );
    if (t % 1e4 === 0 && Date.now() - lastYieldAt > 50) {
      onProgress(0, 3, `Rasterizing\u2026 ${Math.round(t / triCount * 100)}%`);
      await yieldToUI();
      lastYieldAt = Date.now();
    }
  }
  for (let d = 0; d < dilationVoxels; d++) {
    onProgress(1, 3, `Dilating shell\u2026 (pass ${d + 1}/${dilationVoxels})`);
    await yieldToUI();
    grid = dilate3D(grid, gx, gy, gz, SY, SZ);
    lastYieldAt = Date.now();
  }
  onProgress(2, 3, "Extracting shell surface\u2026");
  await yieldToUI();
  const posOut = [];
  const r = resolution * 0.5;
  lastYieldAt = Date.now();
  for (let iz = 0; iz < gz; iz++) {
    for (let iy = 0; iy < gy; iy++) {
      for (let ix = 0; ix < gx; ix++) {
        if (grid[ix + iy * SY + iz * SZ] !== 1) continue;
        const wx = ox + (ix + 0.5) * resolution;
        const wy = oy + (iy + 0.5) * resolution;
        const wz = oz + (iz + 0.5) * resolution;
        for (const f of FACE_DIRS) {
          const nx = ix + f.dx, ny = iy + f.dy, nz = iz + f.dz;
          if (nx < 0 || nx >= gx || ny < 0 || ny >= gy || nz < 0 || nz >= gz) continue;
          if (grid[nx + ny * SY + nz * SZ] === 1) continue;
          const [v0, v1, v2, v3] = f.v;
          posOut.push(
            wx + r * v0[0],
            wy + r * v0[1],
            wz + r * v0[2],
            wx + r * v1[0],
            wy + r * v1[1],
            wz + r * v1[2],
            wx + r * v2[0],
            wy + r * v2[1],
            wz + r * v2[2],
            wx + r * v0[0],
            wy + r * v0[1],
            wz + r * v0[2],
            wx + r * v2[0],
            wy + r * v2[1],
            wz + r * v2[2],
            wx + r * v3[0],
            wy + r * v3[1],
            wz + r * v3[2]
          );
        }
      }
    }
    if (iz % 20 === 0 && Date.now() - lastYieldAt > 50) {
      onProgress(2, 3, `Extracting\u2026 ${Math.round(iz / gz * 100)}%`);
      await yieldToUI();
      lastYieldAt = Date.now();
    }
  }
  onProgress(3, 3, "Finalizing geometry\u2026");
  await yieldToUI();
  const outGeo = new THREE.BufferGeometry();
  const posFloat = new Float32Array(posOut);
  validateOutputPositions(posFloat, bb.min, bb.max, resolution);
  outGeo.setAttribute("position", new THREE.BufferAttribute(posFloat, 3));
  outGeo.computeVertexNormals();
  g.dispose();
  return {
    geometry: outGeo,
    resolution,
    gridDims: dims,
    outputTriangles: Math.floor(posFloat.length / 9)
  };
}
export {
  autoVoxelResolution,
  estimateOutputTriangles,
  estimateWallThickness,
  isSeverelyCorrupted,
  minSafeResolution,
  postProcessVoxelOutput,
  quadricSimplify,
  shellVoxelReconstruct,
  taubinSmooth,
  voxelReconstruct
};
