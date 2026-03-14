// voxel-reconstruct.ts
// Voxel reconstruction pipeline for severely corrupted meshes.
//
// Pipeline:
//   1. Z-column parity voxelization  — robust against broken topology, uses
//      even-odd ray casting so overlapping / non-manifold surfaces are handled
//      correctly.
//   2. BFS flood-fill from a corner  — marks the exterior; anything unreached
//      becomes "inside".
//   3. Block-mesh surface extraction — for every solid voxel that borders an
//      exterior cell, emit two triangles with outward-facing normals.
//
// All steps yield to the browser every ~50 ms so the UI stays responsive.

import * as THREE from "three";

export type VoxelProgressCallback = (
  step: number,
  total: number,
  msg: string
) => void;

export interface VoxelReconstructResult {
  geometry: THREE.BufferGeometry;
  /** Voxel size used (mm). */
  resolution: number;
  /** Grid dimensions [gx, gy, gz]. */
  gridDims: [number, number, number];
  outputTriangles: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Auto-compute voxel resolution targeting ≤500 voxels along the longest axis. */
export function autoVoxelResolution(bboxMM: {
  x: number;
  y: number;
  z: number;
}): number {
  const maxDim = Math.max(bboxMM.x, bboxMM.y, bboxMM.z, 1);
  return Math.max(1, Math.min(maxDim / 500, 20));
}

/**
 * Rough estimate of output triangle count for UI display.
 *
 * Returns the *intermediate* block-mesh count.  If a `simplifyTarget` is
 * provided (from the AI repair plan), the final output will be capped to
 * that value — so the UI should show `Math.min(estimate, simplifyTarget)`.
 */
export function estimateOutputTriangles(
  bboxMM: { x: number; y: number; z: number },
  resolutionMM: number,
  simplifyTarget?: number,
): number {
  const gx = Math.ceil(bboxMM.x / resolutionMM) + 2;
  const gy = Math.ceil(bboxMM.y / resolutionMM) + 2;
  const gz = Math.ceil(bboxMM.z / resolutionMM) + 2;
  // 2 triangles per face × 2 sides × 3 axis pairs
  const raw = 4 * (gx * gy + gy * gz + gz * gx);
  return simplifyTarget && simplifyTarget > 0 ? Math.min(raw, simplifyTarget) : raw;
}

// ─── Grid overflow guards ─────────────────────────────────────────────────────

const MAX_VOXELS_PER_AXIS = 1000;
const MAX_TOTAL_VOXELS = 200_000_000;   // 200M ≈ 200 MB as Uint8Array
const MAX_BBOX_DIMENSION_MM = 100_000;  // 100 meters

/**
 * Minimum resolution (mm) that keeps the grid within safe limits.
 * Use this to clamp the UI slider so users can't pick values that will fail.
 */
export function minSafeResolution(
  bboxMM: { x: number; y: number; z: number },
  padding = 2,
): number {
  const maxDim = Math.max(bboxMM.x, bboxMM.y, bboxMM.z);
  // Per-axis constraint: (maxDim / res) + padding <= MAX_VOXELS_PER_AXIS
  const fromAxis = maxDim / (MAX_VOXELS_PER_AXIS - padding);
  // Total-voxel constraint (cubic approximation for worst case)
  const vol = bboxMM.x * bboxMM.y * bboxMM.z;
  const fromTotal = Math.cbrt(vol / MAX_TOTAL_VOXELS);
  // Return the binding constraint, rounded up to nearest 0.5mm
  const raw = Math.max(fromAxis, fromTotal, 0.5);
  return Math.ceil(raw * 2) / 2; // round up to 0.5 step
}

/** Guard 1: Validate bounding box before voxelization. */
function validateBBox(bbSize: THREE.Vector3, bbMin: THREE.Vector3): void {
  const vals = [bbMin.x, bbMin.y, bbMin.z, bbSize.x, bbSize.y, bbSize.z];
  for (const v of vals) {
    if (!Number.isFinite(v)) {
      throw new Error(`BBox contains non-finite value: ${v}`);
    }
  }
  if (bbSize.x <= 0 || bbSize.y <= 0 || bbSize.z <= 0) {
    throw new Error(
      `BBox has zero/negative dimension: ${bbSize.x.toFixed(1)} × ${bbSize.y.toFixed(1)} × ${bbSize.z.toFixed(1)}`
    );
  }
  if (bbSize.x > MAX_BBOX_DIMENSION_MM || bbSize.y > MAX_BBOX_DIMENSION_MM || bbSize.z > MAX_BBOX_DIMENSION_MM) {
    throw new Error(
      `BBox suspiciously large: ${bbSize.x.toFixed(1)} × ${bbSize.y.toFixed(1)} × ${bbSize.z.toFixed(1)} mm (max ${MAX_BBOX_DIMENSION_MM} mm per axis)`
    );
  }
}

/** Guard 2: Validate grid dimensions before allocating. */
function validateGridDims(
  gx: number, gy: number, gz: number, resolution: number,
): void {
  if (gx > MAX_VOXELS_PER_AXIS || gy > MAX_VOXELS_PER_AXIS || gz > MAX_VOXELS_PER_AXIS) {
    const maxDim = Math.max(gx, gy, gz);
    const minRes = (maxDim * resolution / MAX_VOXELS_PER_AXIS);
    throw new Error(
      `Grid too large: ${gx} × ${gy} × ${gz} (max ${MAX_VOXELS_PER_AXIS}/axis). ` +
      `Increase resolution to at least ${minRes.toFixed(1)} mm.`
    );
  }
  const totalVoxels = gx * gy * gz;
  const memoryMB = Math.round(totalVoxels / 1_000_000);
  if (totalVoxels > MAX_TOTAL_VOXELS) {
    throw new Error(
      `Grid requires ~${memoryMB} MB (${totalVoxels.toLocaleString()} voxels, max ${MAX_TOTAL_VOXELS.toLocaleString()}). Increase resolution.`
    );
  }
}

/**
 * Guard 3: Validate output positions are finite and within expected bounds.
 * Samples up to 1000 evenly-spaced vertices instead of scanning every one —
 * the overflow bug is systematic (wrong origin/resolution), so if any sample
 * is bad they'll all be bad.
 */
function validateOutputPositions(
  positions: Float32Array,
  bbMin: THREE.Vector3, bbMax: THREE.Vector3,
  resolution: number,
): void {
  const vertCount = Math.floor(positions.length / 3);
  if (vertCount === 0) return;

  const margin = resolution * 5;
  const minX = bbMin.x - margin, maxX = bbMax.x + margin;
  const minY = bbMin.y - margin, maxY = bbMax.y + margin;
  const minZ = bbMin.z - margin, maxZ = bbMax.z + margin;

  // Sample up to 1000 vertices: first, last, and evenly spaced
  const MAX_SAMPLES = 1000;
  const step = Math.max(1, Math.floor(vertCount / MAX_SAMPLES));

  for (let vi = 0; vi < vertCount; vi += step) {
    const i = vi * 3;
    const x = positions[i], y = positions[i + 1], z = positions[i + 2];
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
      throw new Error(`Output contains NaN/Infinity at vertex ${vi}: (${x}, ${y}, ${z})`);
    }
    if (x < minX || x > maxX || y < minY || y > maxY || z < minZ || z > maxZ) {
      throw new Error(
        `Output vertex ${vi} outside expected bounds: ` +
        `(${x.toFixed(1)}, ${y.toFixed(1)}, ${z.toFixed(1)}) vs bbox ` +
        `(${bbMin.x.toFixed(1)}..${bbMax.x.toFixed(1)}, ${bbMin.y.toFixed(1)}..${bbMax.y.toFixed(1)}, ${bbMin.z.toFixed(1)}..${bbMax.z.toFixed(1)})`
      );
    }
  }

  // Always check the very last vertex too
  const lastI = (vertCount - 1) * 3;
  const lx = positions[lastI], ly = positions[lastI + 1], lz = positions[lastI + 2];
  if (!Number.isFinite(lx) || !Number.isFinite(ly) || !Number.isFinite(lz)) {
    throw new Error(`Output contains NaN/Infinity at last vertex ${vertCount - 1}: (${lx}, ${ly}, ${lz})`);
  }
}

/**
 * Guard 4: Pre-flight check on intermediate triangle count.
 *
 * The *intermediate* block-mesh / MC output can be large — the post-processing
 * pipeline (Taubin smooth + QEM simplify) will reduce it.  What matters is
 * whether the Float32Array allocation for positions will exceed the browser's
 * ArrayBuffer limit (~2 GB).  Each triangle = 9 floats × 4 bytes = 36 bytes.
 * 50M triangles ≈ 1.8 GB — use that as the hard ceiling.
 */
const MAX_INTERMEDIATE_TRIANGLES = 50_000_000;

function validateEstimatedTriangles(gx: number, gy: number, gz: number): void {
  const surfaceCubes = 2 * (gx * gy + gy * gz + gx * gz);
  const estimate = surfaceCubes * 2;
  if (estimate > MAX_INTERMEDIATE_TRIANGLES) {
    throw new Error(
      `Estimated ${estimate.toLocaleString()} intermediate triangles would exceed memory limit. Increase resolution.`
    );
  }
}

/** Validate that resolution is a finite positive number. */
function validateResolution(resolution: number): void {
  if (typeof resolution !== "number" || !Number.isFinite(resolution) || resolution <= 0) {
    throw new Error(`Invalid resolution: ${resolution} (must be a finite positive number)`);
  }
}

/**
 * Returns true when a mesh is too broken for topology repair and needs voxel
 * reconstruction instead.
 *
 * Thresholds (from architecture document):
 *   open edges     > 1 %  of total edges
 *   non-manifold   > 0.5% of total edges
 */
export function isSeverelyCorrupted(
  openEdges: number,
  nonManifoldEdges: number,
  triangleCount: number
): boolean {
  if (triangleCount === 0) return false;
  const totalEdges = triangleCount * 1.5;
  return (
    openEdges / totalEdges > 0.01 || nonManifoldEdges / totalEdges > 0.005
  );
}

async function yieldToUI(): Promise<void> {
  await new Promise<void>((r) => setTimeout(r, 0));
}

// ─── Face vertex offsets ──────────────────────────────────────────────────────
// Unit offsets (multiply by resolution/2 to get world offsets from voxel centre).
// Wound CCW when viewed from the face normal direction (outside the solid).
// Verification: normal = normalize(cross(v1-v0, v2-v0)).
const FACE_DIRS = [
  // +X  normal=(1,0,0)
  { dx: 1,  dy: 0,  dz: 0,  v: [[ 1,-1,-1],[ 1, 1,-1],[ 1, 1, 1],[ 1,-1, 1]] },
  // -X  normal=(-1,0,0)
  { dx:-1,  dy: 0,  dz: 0,  v: [[-1,-1, 1],[-1, 1, 1],[-1, 1,-1],[-1,-1,-1]] },
  // +Y  normal=(0,1,0)
  { dx: 0,  dy: 1,  dz: 0,  v: [[-1, 1, 1],[ 1, 1, 1],[ 1, 1,-1],[-1, 1,-1]] },
  // -Y  normal=(0,-1,0)
  { dx: 0,  dy:-1,  dz: 0,  v: [[-1,-1,-1],[ 1,-1,-1],[ 1,-1, 1],[-1,-1, 1]] },
  // +Z  normal=(0,0,1)
  { dx: 0,  dy: 0,  dz: 1,  v: [[ 1,-1, 1],[ 1, 1, 1],[-1, 1, 1],[-1,-1, 1]] },
  // -Z  normal=(0,0,-1)
  { dx: 0,  dy: 0,  dz:-1,  v: [[-1,-1,-1],[-1, 1,-1],[ 1, 1,-1],[ 1,-1,-1]] },
] as const;

// ─── Main pipeline ────────────────────────────────────────────────────────────

export interface VoxelReconstructParams {
  /** Grid resolution in mm. */
  resolution?: number;
  /** Grid padding in voxels around the bounding box. Default 1. Higher = better boundary handling. */
  gridPadding?: number;
  /** Barycentric rejection threshold for degenerate triangles. Default 1e-12. Increase (1e-8) for corrupted meshes. */
  degenerateThreshold?: number;
}

export async function voxelReconstruct(
  geo: THREE.BufferGeometry,
  onProgress: VoxelProgressCallback,
  resolutionMM?: number,
  params?: VoxelReconstructParams,
): Promise<VoxelReconstructResult> {
  // Work with flat (non-indexed) geometry so triangles are consecutive triplets.
  const g = geo.index ? geo.toNonIndexed() : geo.clone();
  g.computeBoundingBox();
  const bb = g.boundingBox!;
  const bbSize = new THREE.Vector3();
  bb.getSize(bbSize);

  const resolution =
    resolutionMM ?? params?.resolution ?? autoVoxelResolution({ x: bbSize.x, y: bbSize.y, z: bbSize.z });
  const degenerateThreshold = params?.degenerateThreshold ?? 1e-12;

  // ── Guards ──────────────────────────────────────────────────────────────────
  validateResolution(resolution);
  validateBBox(bbSize, bb.min);

  // Grid padding on all sides guarantees the BFS corner is always exterior.
  const PAD = Math.max(1, Math.min(5, params?.gridPadding ?? 1));
  const gx = Math.ceil(bbSize.x / resolution) + 2 * PAD;
  const gy = Math.ceil(bbSize.y / resolution) + 2 * PAD;
  const gz = Math.ceil(bbSize.z / resolution) + 2 * PAD;
  const dims: [number, number, number] = [gx, gy, gz];

  validateGridDims(gx, gy, gz, resolution);
  validateEstimatedTriangles(gx, gy, gz);

  // World position of voxel (0, 0, 0)'s corner.
  const ox = bb.min.x - PAD * resolution;
  const oy = bb.min.y - PAD * resolution;
  const oz = bb.min.z - PAD * resolution;

  const SY = gx;
  const SZ = gx * gy;
  const totalVoxels = gx * gy * gz;

  // Grid values: 0 = empty air | 1 = solid (inside) | 2 = confirmed exterior
  const SOLID = 1;
  const EXT = 2;
  const grid = new Uint8Array(totalVoxels);

  // ── Step 1: Z-column parity voxelization ─────────────────────────────────────
  // For each triangle, find every voxel column (ix, iy) whose centre falls inside
  // the triangle's XY projection, then record the Z crossing depth.
  // After all triangles are processed, parity-fill each column: voxels between
  // crossing[0]↔[1], [2]↔[3], … are inside (even-odd rule).
  onProgress(0, 4, "Voxelizing mesh…");
  await yieldToUI();

  const posArr = g.attributes.position.array as Float32Array;
  const triCount = Math.floor(posArr.length / 9);

  // Per-column Z crossing accumulators — [ix * gy + iy] → sorted Z list
  const colCross: number[][] = Array.from({ length: gx * gy }, () => []);

  let lastYieldAt = Date.now();

  for (let t = 0; t < triCount; t++) {
    const b = t * 9;
    const ax = posArr[b],     ay = posArr[b + 1], az = posArr[b + 2];
    const bx = posArr[b + 3], by = posArr[b + 4], bz = posArr[b + 5];
    const cx = posArr[b + 6], cy = posArr[b + 7], cz = posArr[b + 8];

    // XY bounding box of triangle
    const xMin = Math.min(ax, bx, cx), xMax = Math.max(ax, bx, cx);
    const yMin = Math.min(ay, by, cy), yMax = Math.max(ay, by, cy);

    const ixMin = Math.max(0, Math.floor((xMin - ox) / resolution));
    const ixMax = Math.min(gx - 1, Math.ceil((xMax - ox) / resolution));
    const iyMin = Math.max(0, Math.floor((yMin - oy) / resolution));
    const iyMax = Math.min(gy - 1, Math.ceil((yMax - oy) / resolution));

    // Pre-compute edge vectors for barycentric test
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
        // Z depth at the intersection point
        colCross[ix * gy + iy].push(az + u * (bz - az) + v * (cz - az));
      }
    }

    if (t % 10000 === 0 && Date.now() - lastYieldAt > 50) {
      onProgress(0, 4, `Voxelizing… ${Math.round((t / triCount) * 100)}%`);
      await yieldToUI();
      lastYieldAt = Date.now();
    }
  }

  // Parity fill: between pairs of Z crossings → solid
  for (let ix = 0; ix < gx; ix++) {
    for (let iy = 0; iy < gy; iy++) {
      const zs = colCross[ix * gy + iy];
      if (zs.length < 2) continue;
      zs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < zs.length; k += 2) {
        const izMin = Math.max(0, Math.floor((zs[k]     - oz) / resolution));
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

  // ── Step 2: BFS flood fill from corner (0,0,0) — always exterior via padding ──
  onProgress(2, 4, "Flood-filling exterior…");
  await yieldToUI();

  grid[0] = EXT;
  const queue: number[] = [0];
  let qHead = 0;
  lastYieldAt = Date.now();

  while (qHead < queue.length) {
    const cur = queue[qHead++];
    const iz = Math.floor(cur / SZ);
    const iy = Math.floor((cur % SZ) / SY);
    const ix = cur % SY;

    if (ix + 1 < gx  && grid[cur + 1]  === 0) { grid[cur + 1]  = EXT; queue.push(cur + 1);  }
    if (ix - 1 >= 0  && grid[cur - 1]  === 0) { grid[cur - 1]  = EXT; queue.push(cur - 1);  }
    if (iy + 1 < gy  && grid[cur + SY] === 0) { grid[cur + SY] = EXT; queue.push(cur + SY); }
    if (iy - 1 >= 0  && grid[cur - SY] === 0) { grid[cur - SY] = EXT; queue.push(cur - SY); }
    if (iz + 1 < gz  && grid[cur + SZ] === 0) { grid[cur + SZ] = EXT; queue.push(cur + SZ); }
    if (iz - 1 >= 0  && grid[cur - SZ] === 0) { grid[cur - SZ] = EXT; queue.push(cur - SZ); }

    if (qHead % 200000 === 0 && Date.now() - lastYieldAt > 50) {
      onProgress(2, 4, `Flood-filling… ${Math.round((qHead / totalVoxels) * 100)}%`);
      await yieldToUI();
      lastYieldAt = Date.now();
    }
  }

  // After flood fill:
  //   0      = enclosed air (interior cavity — treated as solid for printing)
  //   SOLID  = voxelized solid
  //   EXT    = confirmed exterior air

  // ── Step 3: Block-mesh surface extraction ─────────────────────────────────────
  // For every solid voxel (grid ≠ EXT), emit faces toward any non-solid neighbor.
  // Vertices are wound CCW from outside so normals point outward.
  onProgress(3, 4, "Extracting surface…");
  await yieldToUI();

  const posOut: number[] = [];
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
          if (grid[nx + ny * SY + nz * SZ] === SOLID) continue; // interior face

          const [v0, v1, v2, v3] = f.v;
          // Triangle 1: v0, v1, v2
          posOut.push(
            wx + r * v0[0], wy + r * v0[1], wz + r * v0[2],
            wx + r * v1[0], wy + r * v1[1], wz + r * v1[2],
            wx + r * v2[0], wy + r * v2[1], wz + r * v2[2],
          );
          // Triangle 2: v0, v2, v3
          posOut.push(
            wx + r * v0[0], wy + r * v0[1], wz + r * v0[2],
            wx + r * v2[0], wy + r * v2[1], wz + r * v2[2],
            wx + r * v3[0], wy + r * v3[1], wz + r * v3[2],
          );
        }
      }
    }
    if (iz % 20 === 0 && Date.now() - lastYieldAt > 50) {
      onProgress(3, 4, `Extracting… ${Math.round((iz / gz) * 100)}%`);
      await yieldToUI();
      lastYieldAt = Date.now();
    }
  }

  // ── Build output geometry ─────────────────────────────────────────────────────
  onProgress(4, 4, "Finalizing geometry…");
  await yieldToUI();

  const outGeo = new THREE.BufferGeometry();
  const posFloat = new Float32Array(posOut);

  // Guard 3: validate output positions
  validateOutputPositions(posFloat, bb.min, bb.max, resolution);

  outGeo.setAttribute("position", new THREE.BufferAttribute(posFloat, 3));
  outGeo.computeVertexNormals();

  g.dispose();

  return {
    geometry: outGeo,
    resolution,
    gridDims: dims,
    outputTriangles: Math.floor(posFloat.length / 9),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Post-processing: Taubin smoothing
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build vertex adjacency from a non-indexed BufferGeometry.
 * Returns a Map: vertexIndex → Set<neighborVertexIndex>.
 *
 * Vertices are matched by exact position (uint32 bit-pattern hash) so that
 * shared triangle corners that were duplicated by toNonIndexed() are treated
 * as the same vertex.
 */
function buildAdjacency(pos: Float32Array, vertCount: number): {
  /** canonical vertex index for each of the vertCount entries */
  canon: Uint32Array;
  /** adjacency: canonical index → set of canonical neighbor indices */
  adj: Map<number, Set<number>>;
} {
  // Merge duplicate positions via uint32 bit-pattern hash
  const u32 = new Uint32Array(pos.buffer, pos.byteOffset, pos.length);
  const map = new Map<string, number>(); // "bx,by,bz" → canonical index
  const canon = new Uint32Array(vertCount);

  for (let i = 0; i < vertCount; i++) {
    const key = `${u32[i * 3]},${u32[i * 3 + 1]},${u32[i * 3 + 2]}`;
    const existing = map.get(key);
    if (existing !== undefined) {
      canon[i] = existing;
    } else {
      map.set(key, i);
      canon[i] = i;
    }
  }

  // Build adjacency on canonical indices
  const adj = new Map<number, Set<number>>();
  const triCount = Math.floor(vertCount / 3);

  for (let t = 0; t < triCount; t++) {
    const a = canon[t * 3];
    const b = canon[t * 3 + 1];
    const c = canon[t * 3 + 2];

    if (!adj.has(a)) adj.set(a, new Set());
    if (!adj.has(b)) adj.set(b, new Set());
    if (!adj.has(c)) adj.set(c, new Set());

    adj.get(a)!.add(b); adj.get(a)!.add(c);
    adj.get(b)!.add(a); adj.get(b)!.add(c);
    adj.get(c)!.add(a); adj.get(c)!.add(b);
  }

  return { canon, adj };
}

/**
 * Single-pass Laplacian smooth: move each vertex toward the centroid of its
 * neighbors by `lambda`.  Operates on a flat (non-indexed) position buffer.
 */
function laplacianSmoothPass(
  pos: Float32Array,
  vertCount: number,
  canon: Uint32Array,
  adj: Map<number, Set<number>>,
  lambda: number,
): void {
  // Compute new positions for canonical vertices
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
    newPos[ci * 3]     = pos[ci * 3]     + lambda * (cx - pos[ci * 3]);
    newPos[ci * 3 + 1] = pos[ci * 3 + 1] + lambda * (cy - pos[ci * 3 + 1]);
    newPos[ci * 3 + 2] = pos[ci * 3 + 2] + lambda * (cz - pos[ci * 3 + 2]);
  }

  // Write canonical positions back to all duplicate vertices
  for (let i = 0; i < vertCount; i++) {
    const ci = canon[i];
    pos[i * 3]     = newPos[ci * 3];
    pos[i * 3 + 1] = newPos[ci * 3 + 1];
    pos[i * 3 + 2] = newPos[ci * 3 + 2];
  }
}

/**
 * Taubin smoothing (λ|μ) — removes stair-stepping artifacts from block-mesh
 * / marching-cubes output without shrinking the mesh.
 *
 * Alternates a positive smooth (λ = 0.5) with a negative "inflate" pass
 * (μ = −0.53) each iteration.  This is the standard Taubin 1995 algorithm.
 */
export async function taubinSmooth(
  geo: THREE.BufferGeometry,
  iterations: number,
  onProgress?: VoxelProgressCallback,
  lambda = 0.5,
  mu = -0.53,
): Promise<void> {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const pos = g.attributes.position.array as Float32Array;
  const vertCount = Math.floor(pos.length / 3);

  const { canon, adj } = buildAdjacency(pos, vertCount);

  for (let i = 0; i < iterations; i++) {
    laplacianSmoothPass(pos, vertCount, canon, adj, lambda);  // shrink
    laplacianSmoothPass(pos, vertCount, canon, adj, mu);      // inflate

    if (onProgress) onProgress(i + 1, iterations, `Smoothing… pass ${i + 1}/${iterations}`);
    await yieldToUI();
  }

  g.attributes.position.needsUpdate = true;
  g.computeVertexNormals();

  // If we created a non-indexed copy, transfer the positions back
  if (geo.index) {
    geo.setAttribute("position", g.attributes.position);
    geo.setIndex(null);
    geo.computeVertexNormals();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Post-processing: Quadric edge-collapse simplification
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Quadric error metric (QEM) mesh simplification — Garland & Heckbert 1997.
 *
 * Operates on non-indexed BufferGeometry.  Builds an indexed representation
 * internally, collapses edges with lowest quadric error until the target
 * triangle count is reached, then writes back a non-indexed BufferGeometry.
 *
 * Constraints:
 *   - Never flips a face normal during collapse
 *   - Never creates degenerate triangles
 */
export async function quadricSimplify(
  geo: THREE.BufferGeometry,
  targetTriangles: number,
  onProgress?: VoxelProgressCallback,
  boundaryPenalty = 1.0,
): Promise<THREE.BufferGeometry> {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const srcPos = g.attributes.position.array as Float32Array;
  const srcVertCount = Math.floor(srcPos.length / 3);
  const srcTriCount = Math.floor(srcVertCount / 3);

  if (srcTriCount <= targetTriangles) return g;

  // ── Build indexed representation via exact vertex dedup ──────────────
  const u32 = new Uint32Array(srcPos.buffer, srcPos.byteOffset, srcPos.length);
  const vertMap = new Map<string, number>();
  const remap = new Uint32Array(srcVertCount);
  const positions: number[] = [];
  let uniqueVerts = 0;

  for (let i = 0; i < srcVertCount; i++) {
    const key = `${u32[i * 3]},${u32[i * 3 + 1]},${u32[i * 3 + 2]}`;
    const existing = vertMap.get(key);
    if (existing !== undefined) {
      remap[i] = existing;
    } else {
      vertMap.set(key, uniqueVerts);
      remap[i] = uniqueVerts;
      positions.push(srcPos[i * 3], srcPos[i * 3 + 1], srcPos[i * 3 + 2]);
      uniqueVerts++;
    }
  }

  // Vertex positions (mutable)
  const vx = new Float64Array(uniqueVerts);
  const vy = new Float64Array(uniqueVerts);
  const vz = new Float64Array(uniqueVerts);
  for (let i = 0; i < uniqueVerts; i++) {
    vx[i] = positions[i * 3];
    vy[i] = positions[i * 3 + 1];
    vz[i] = positions[i * 3 + 2];
  }

  // Triangles [v0, v1, v2] — indices into vx/vy/vz
  const tris = new Int32Array(srcTriCount * 3);
  const alive = new Uint8Array(srcTriCount); // 1 = alive
  let liveTriCount = srcTriCount;

  for (let t = 0; t < srcTriCount; t++) {
    tris[t * 3]     = remap[t * 3];
    tris[t * 3 + 1] = remap[t * 3 + 1];
    tris[t * 3 + 2] = remap[t * 3 + 2];
    // Skip degenerate
    if (tris[t * 3] === tris[t * 3 + 1] || tris[t * 3 + 1] === tris[t * 3 + 2] || tris[t * 3] === tris[t * 3 + 2]) {
      alive[t] = 0;
      liveTriCount--;
    } else {
      alive[t] = 1;
    }
  }

  // ── Per-vertex quadric (4×4 symmetric → store as 10 floats) ──────────
  // Q = [q0 q1 q2 q3; q1 q4 q5 q6; q2 q5 q7 q8; q3 q6 q8 q9]
  const Q = new Float64Array(uniqueVerts * 10);

  function addPlaneQuadric(vi: number, a: number, b: number, c: number, d: number) {
    const off = vi * 10;
    Q[off]   += a*a; Q[off+1] += a*b; Q[off+2] += a*c; Q[off+3] += a*d;
    Q[off+4] += b*b; Q[off+5] += b*c; Q[off+6] += b*d;
    Q[off+7] += c*c; Q[off+8] += c*d;
    Q[off+9] += d*d;
  }

  for (let t = 0; t < srcTriCount; t++) {
    if (!alive[t]) continue;
    const i0 = tris[t * 3], i1 = tris[t * 3 + 1], i2 = tris[t * 3 + 2];
    // face normal (not normalised for area weighting)
    const ex1 = vx[i1] - vx[i0], ey1 = vy[i1] - vy[i0], ez1 = vz[i1] - vz[i0];
    const ex2 = vx[i2] - vx[i0], ey2 = vy[i2] - vy[i0], ez2 = vz[i2] - vz[i0];
    let nx = ey1*ez2 - ez1*ey2, ny = ez1*ex2 - ex1*ez2, nz = ex1*ey2 - ey1*ex2;
    const len = Math.sqrt(nx*nx + ny*ny + nz*nz);
    if (len < 1e-20) continue;
    nx /= len; ny /= len; nz /= len;
    const d = -(nx*vx[i0] + ny*vy[i0] + nz*vz[i0]);
    addPlaneQuadric(i0, nx, ny, nz, d);
    addPlaneQuadric(i1, nx, ny, nz, d);
    addPlaneQuadric(i2, nx, ny, nz, d);
  }

  // ── Build edge set + per-vertex triangle list ────────────────────────
  const vertTris: Set<number>[] = Array.from({ length: uniqueVerts }, () => new Set());
  for (let t = 0; t < srcTriCount; t++) {
    if (!alive[t]) continue;
    vertTris[tris[t*3]].add(t);
    vertTris[tris[t*3+1]].add(t);
    vertTris[tris[t*3+2]].add(t);
  }

  // Edge → collapse cost (use min-heap via sorted array rebuilt periodically)
  type EdgeEntry = { v0: number; v1: number; cost: number; mx: number; my: number; mz: number };
  const edgeSet = new Set<string>();
  // Track edge adjacency count to detect boundary edges (1 tri = boundary)
  const edgeTriCount = new Map<string, number>();
  let edges: EdgeEntry[] = [];

  function edgeKey(a: number, b: number): string {
    return a < b ? `${a},${b}` : `${b},${a}`;
  }

  // Pre-compute edge adjacency counts for boundary detection
  for (let t = 0; t < srcTriCount; t++) {
    if (!alive[t]) continue;
    const i0 = tris[t * 3], i1 = tris[t * 3 + 1], i2 = tris[t * 3 + 2];
    for (const ek of [edgeKey(i0, i1), edgeKey(i1, i2), edgeKey(i2, i0)]) {
      edgeTriCount.set(ek, (edgeTriCount.get(ek) ?? 0) + 1);
    }
  }

  // 3×3 determinant — used by Cramer's rule below
  function d3(
    a: number, b: number, c: number,
    d: number, e: number, f: number,
    g: number, h: number, i: number,
  ): number {
    return a*(e*i - f*h) - b*(d*i - f*g) + c*(d*h - e*g);
  }

  function computeEdgeCost(a: number, b: number): EdgeEntry {
    // Sum quadrics
    const qa = a * 10, qb = b * 10;
    const s0 = Q[qa]+Q[qb], s1 = Q[qa+1]+Q[qb+1], s2 = Q[qa+2]+Q[qb+2], s3 = Q[qa+3]+Q[qb+3];
    const s4 = Q[qa+4]+Q[qb+4], s5 = Q[qa+5]+Q[qb+5], s6 = Q[qa+6]+Q[qb+6];
    const s7 = Q[qa+7]+Q[qb+7], s8 = Q[qa+8]+Q[qb+8];
    const s9 = Q[qa+9]+Q[qb+9];

    // Midpoint fallback
    const midX = (vx[a] + vx[b]) * 0.5;
    const midY = (vy[a] + vy[b]) * 0.5;
    const midZ = (vz[a] + vz[b]) * 0.5;
    let mx = midX, my = midY, mz = midZ;

    // Solve Ax = b via Cramer's rule using det3x3 helper
    // A = [[s0,s1,s2],[s1,s4,s5],[s2,s5,s7]], b = [-s3,-s6,-s8]
    const det = d3(s0,s1,s2, s1,s4,s5, s2,s5,s7);

    if (Math.abs(det) > 1e-10) {
      const idet = 1 / det;
      const cx = idet * d3(-s3,s1,s2, -s6,s4,s5, -s8,s5,s7);
      const cy = idet * d3(s0,-s3,s2, s1,-s6,s5, s2,-s8,s7);
      const cz = idet * d3(s0,s1,-s3, s1,s4,-s6, s2,s5,-s8);

      // Validate: optimal position must be near the edge (within 2× edge length)
      const edgeLenSq = (vx[b]-vx[a])**2 + (vy[b]-vy[a])**2 + (vz[b]-vz[a])**2;
      const distSq = (cx-midX)**2 + (cy-midY)**2 + (cz-midZ)**2;
      if (distSq < edgeLenSq * 4) {
        mx = cx; my = cy; mz = cz;
      }
    }

    // Cost = v^T Q v  (using the combined quadric)
    const cost =
      s0*mx*mx + 2*s1*mx*my + 2*s2*mx*mz + 2*s3*mx +
      s4*my*my + 2*s5*my*mz + 2*s6*my +
      s7*mz*mz + 2*s8*mz +
      s9;

    let finalCost = Math.abs(cost);
    // Penalise boundary edges so the simplifier avoids collapsing them.
    // Boundary edges (1 adjacent tri) are at mesh openings (windows, holes).
    if (boundaryPenalty > 1.0) {
      const ek = edgeKey(a, b);
      if ((edgeTriCount.get(ek) ?? 2) < 2) {
        finalCost *= boundaryPenalty;
      }
    }
    return { v0: a, v1: b, cost: finalCost, mx, my, mz };
  }

  for (let t = 0; t < srcTriCount; t++) {
    if (!alive[t]) continue;
    const i0 = tris[t*3], i1 = tris[t*3+1], i2 = tris[t*3+2];
    for (const [a, b] of [[i0,i1],[i1,i2],[i2,i0]]) {
      const k = edgeKey(a, b);
      if (!edgeSet.has(k)) {
        edgeSet.add(k);
        edges.push(computeEdgeCost(a, b));
      }
    }
  }

  // Sort edges by cost (ascending)
  edges.sort((a, b) => a.cost - b.cost);

  // ── Collapse loop ────────────────────────────────────────────────────
  // vertAlias[v] = v means vertex is canonical.  Otherwise follow chain.
  const vertAlias = new Int32Array(uniqueVerts);
  for (let i = 0; i < uniqueVerts; i++) vertAlias[i] = i;

  function resolve(v: number): number {
    while (vertAlias[v] !== v) v = vertAlias[v];
    return v;
  }

  let edgeIdx = 0;
  let lastYield = Date.now();
  const startLive = liveTriCount;
  let rebuilds = 0;

  for (;;) { // outer loop — rebuilds edge list when exhausted

  while (liveTriCount > targetTriangles && edgeIdx < edges.length) {
    const e = edges[edgeIdx++];
    const rv0 = resolve(e.v0), rv1 = resolve(e.v1);
    if (rv0 === rv1) continue; // already collapsed

    // Check for normal flips: for each triangle incident to rv1 that would
    // be moved to rv0, verify the new normal doesn't flip
    let flipDetected = false;
    for (const t of vertTris[rv1]) {
      if (!alive[t]) continue;
      const i0 = resolve(tris[t*3]), i1 = resolve(tris[t*3+1]), i2 = resolve(tris[t*3+2]);
      // Skip triangles that will be deleted (they share both rv0 and rv1)
      if ((i0 === rv0 || i1 === rv0 || i2 === rv0) &&
          (i0 === rv1 || i1 === rv1 || i2 === rv1)) continue;

      // Simulate the collapse: replace rv1 → rv0 position → e.mx/my/mz
      const ti = [i0, i1, i2].map(v => v === rv1 ? -1 : v);
      const px = ti.map(v => v === -1 ? e.mx : vx[v]);
      const py = ti.map(v => v === -1 ? e.my : vy[v]);
      const pz = ti.map(v => v === -1 ? e.mz : vz[v]);

      // Original normal
      const oex1 = vx[i1]-vx[i0], oey1 = vy[i1]-vy[i0], oez1 = vz[i1]-vz[i0];
      const oex2 = vx[i2]-vx[i0], oey2 = vy[i2]-vy[i0], oez2 = vz[i2]-vz[i0];
      const onx = oey1*oez2-oez1*oey2, ony = oez1*oex2-oex1*oez2, onz = oex1*oey2-oey1*oex2;

      // New normal
      const nex1 = px[1]-px[0], ney1 = py[1]-py[0], nez1 = pz[1]-pz[0];
      const nex2 = px[2]-px[0], ney2 = py[2]-py[0], nez2 = pz[2]-pz[0];
      const nnx = ney1*nez2-nez1*ney2, nny = nez1*nex2-nex1*nez2, nnz = nex1*ney2-ney1*nex2;

      if (onx*nnx + ony*nny + onz*nnz < 0) {
        flipDetected = true;
        break;
      }
    }
    if (flipDetected) continue;

    // ── Perform the collapse: merge rv1 into rv0 ──────────────────────
    vertAlias[rv1] = rv0;
    vx[rv0] = e.mx; vy[rv0] = e.my; vz[rv0] = e.mz;

    // Merge quadrics
    const qa = rv0 * 10, qb = rv1 * 10;
    for (let i = 0; i < 10; i++) Q[qa + i] += Q[qb + i];

    // Update triangles: kill degenerate, update vert references
    for (const t of vertTris[rv1]) {
      if (!alive[t]) continue;
      vertTris[rv0].add(t);
      // Resolve all verts
      for (let k = 0; k < 3; k++) {
        tris[t * 3 + k] = resolve(tris[t * 3 + k]);
      }
      // Check degenerate
      const a = tris[t*3], b = tris[t*3+1], c = tris[t*3+2];
      if (a === b || b === c || a === c) {
        alive[t] = 0;
        liveTriCount--;
        vertTris[a]?.delete(t);
        vertTris[b]?.delete(t);
        vertTris[c]?.delete(t);
      }
    }

    // Progress
    if (Date.now() - lastYield > 50) {
      const pct = Math.round(((startLive - liveTriCount) / (startLive - targetTriangles)) * 100);
      if (onProgress) onProgress(pct, 100, `Simplifying… ${liveTriCount.toLocaleString()} triangles`);
      await yieldToUI();
      lastYield = Date.now();
    }
  } // end inner while

  // If target reached or max rebuilds exhausted, stop
  if (liveTriCount <= targetTriangles || ++rebuilds > 3) break;

  // Rebuild edge list from remaining alive triangles (costs are stale after collapses)
  edgeSet.clear();
  edges = [];
  edgeIdx = 0;
  for (let t = 0; t < srcTriCount; t++) {
    if (!alive[t]) continue;
    const ri0 = resolve(tris[t*3]), ri1 = resolve(tris[t*3+1]), ri2 = resolve(tris[t*3+2]);
    for (const [ea, eb] of [[ri0,ri1],[ri1,ri2],[ri2,ri0]] as [number,number][]) {
      if (ea === eb) continue;
      const k = edgeKey(ea, eb);
      if (!edgeSet.has(k)) {
        edgeSet.add(k);
        edges.push(computeEdgeCost(ea, eb));
      }
    }
  }
  edges.sort((a, b) => a.cost - b.cost);
  if (onProgress) onProgress(0, 100, `Re-sorting edges (pass ${rebuilds})…`);
  await yieldToUI();
  lastYield = Date.now();

  } // end outer for(;;) rebuild loop

  // ── Rebuild non-indexed BufferGeometry ────────────────────────────────
  const outPos: number[] = [];
  for (let t = 0; t < srcTriCount; t++) {
    if (!alive[t]) continue;
    const i0 = resolve(tris[t*3]), i1 = resolve(tris[t*3+1]), i2 = resolve(tris[t*3+2]);
    outPos.push(
      vx[i0], vy[i0], vz[i0],
      vx[i1], vy[i1], vz[i1],
      vx[i2], vy[i2], vz[i2],
    );
  }

  const outGeo = new THREE.BufferGeometry();
  outGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(outPos), 3));
  outGeo.computeVertexNormals();

  if (onProgress) onProgress(100, 100, `Simplified to ${liveTriCount.toLocaleString()} triangles`);

  return outGeo;
}

// ─────────────────────────────────────────────────────────────────────────────
// Post-processing pipeline
// ─────────────────────────────────────────────────────────────────────────────

export interface PostProcessParams {
  smoothingIterations: number;
  simplifyTarget: number;
  /** Taubin smoothing intensity per pass (0.1-0.8, default 0.5). Lower = preserve edges. */
  smoothingLambda?: number;
  /** QEM boundary edge penalty (1-10, default 1). High values protect openings during simplification. */
  boundaryPenalty?: number;
  /** Taubin inflate factor (-0.7 to -0.3, default computed from lambda). More negative = stronger inflation. */
  taubinMu?: number;
}

/**
 * Full post-processing pipeline for voxel reconstruction output:
 *   1. Quadric simplification (reduces over-tessellation from 8M → target)
 *   2. Taubin smoothing (removes stair-step artifacts on reduced mesh)
 *
 * Simplification runs FIRST so smoothing operates on the reduced mesh
 * (~410K triangles instead of ~8M), preventing browser hangs.
 */
export async function postProcessVoxelOutput(
  geo: THREE.BufferGeometry,
  params: PostProcessParams,
  onProgress?: VoxelProgressCallback,
): Promise<THREE.BufferGeometry> {
  let result = geo;

  // Step 1: Quadric simplification (reduce bloated voxel output FIRST —
  // voxelization over-tessellates 4-8×, running smoothing on millions of
  // triangles is what causes browser hang/crash)
  const currentTris = result.index
    ? Math.floor(result.index.count / 3)
    : Math.floor((result.attributes.position.array as Float32Array).length / 9);
  if (params.simplifyTarget > 0 && currentTris > params.simplifyTarget) {
    if (onProgress) onProgress(0, 2, "Simplifying mesh…");
    result = await quadricSimplify(result, params.simplifyTarget, onProgress, params.boundaryPenalty ?? 1.0);
  }

  // Step 2: Taubin smoothing (runs on the reduced mesh — much faster)
  if (params.smoothingIterations > 0) {
    if (onProgress) onProgress(1, 2, "Smoothing surface…");
    const lambda = params.smoothingLambda ?? 0.5;
    const mu = params.taubinMu ?? -(lambda + 0.03);
    await taubinSmooth(result, params.smoothingIterations, onProgress, lambda, mu);
  }

  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Wall-thickness estimation
// ─────────────────────────────────────────────────────────────────────────────

export interface WallThicknessEstimate {
  avgMM: number;
  minMM: number;
  /** True when median wall thickness < 1 % of the longest bounding-box dimension. */
  isThinShell: boolean;
}

/**
 * Estimates wall thickness by casting vertical (Z-axis) rays at a grid of
 * sample positions and measuring gaps between consecutive Z-crossings.
 *
 * Works on broken meshes — uses the same barycentric Z-intersection as the
 * voxelizer, so overlapping surfaces / bad winding don't cause wrong readings.
 */
export async function estimateWallThickness(
  geo: THREE.BufferGeometry,
  sampleCount = 200
): Promise<WallThicknessEstimate> {
  const g = geo.index ? geo.toNonIndexed() : geo;
  g.computeBoundingBox();
  const bb = g.boundingBox!;
  const bbSize = new THREE.Vector3();
  bb.getSize(bbSize);
  const maxDim = Math.max(bbSize.x, bbSize.y, bbSize.z, 1);

  const posArr = g.attributes.position.array as Float32Array;
  const triCount = Math.floor(posArr.length / 9);
  const thicknesses: number[] = [];
  const cols = Math.ceil(Math.sqrt(sampleCount));
  let lastYieldAt = Date.now();

  for (let si = 0; si < cols; si++) {
    for (let sj = 0; sj < cols; sj++) {
      // Evenly distribute samples inside the XY extent (5% margin each side)
      const cx = bb.min.x + (0.05 + 0.9 * (si / (cols - 1 || 1))) * bbSize.x;
      const cy = bb.min.y + (0.05 + 0.9 * (sj / (cols - 1 || 1))) * bbSize.y;

      const zCrossings: number[] = [];

      for (let t = 0; t < triCount; t++) {
        const b = t * 9;
        const ax = posArr[b],     ay = posArr[b + 1], az = posArr[b + 2];
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

// ─────────────────────────────────────────────────────────────────────────────
// Shell voxel reconstruction
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Rasterize a single triangle's surface into a voxel grid.
 *
 * For each Z-slice in the triangle's range, computes the XY cross-section
 * (a line segment) and traces it with a DDA line drawer.  Additionally, all
 * three edges are traced as 3-D lines so near-horizontal edges are not missed.
 */
function rasterizeTriangleSurface(
  grid: Uint8Array,
  SY: number, SZ: number,
  gx: number, gy: number, gz: number,
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
  cx: number, cy: number, cz: number,
  ox: number, oy: number, oz: number,
  res: number,
): void {
  const SOLID = 1;

  // ── 3-D edge rasterization (DDA) ──────────────────────────────────────────
  function rasterize3DEdge(
    x0: number, y0: number, z0: number,
    x1: number, y1: number, z1: number,
  ): void {
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

  // ── Z-slice cross-section rasterization ──────────────────────────────────
  const zMin = Math.min(az, bz, cz);
  const zMax = Math.max(az, bz, cz);
  const izMin = Math.max(0, Math.floor((zMin - oz) / res));
  const izMax = Math.min(gz - 1, Math.ceil((zMax - oz) / res));

  const verts = [
    [ax, ay, az], [bx, by, bz], [cx, cy, cz],
  ] as const;

  for (let iz = izMin; iz <= izMax; iz++) {
    const zMid = oz + (iz + 0.5) * res;
    const pts: [number, number][] = [];

    for (let i = 0; i < 3; i++) {
      const j = (i + 1) % 3;
      const vi = verts[i], vj = verts[j];
      const di = vi[2] - zMid, dj = vj[2] - zMid;
      if (Math.abs(di) < 1e-10) {
        pts.push([vi[0], vi[1]]);
        continue;
      }
      if ((di > 0) !== (dj > 0)) {
        const t = di / (di - dj);
        pts.push([vi[0] + t * (vj[0] - vi[0]), vi[1] + t * (vj[1] - vi[1])]);
      }
    }

    if (pts.length < 2) continue;
    // Rasterize the XY line segment (Bresenham-style via DDA)
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

/** Single-pass 6-connected 3-D morphological dilation. */
function dilate3D(
  grid: Uint8Array,
  gx: number, gy: number, gz: number,
  SY: number, SZ: number,
): Uint8Array {
  const out = new Uint8Array(grid.length);
  for (let iz = 0; iz < gz; iz++) {
    for (let iy = 0; iy < gy; iy++) {
      for (let ix = 0; ix < gx; ix++) {
        const i = ix + iy * SY + iz * SZ;
        if (
          grid[i] ||
          (ix > 0     && grid[i - 1])  ||
          (ix < gx-1  && grid[i + 1])  ||
          (iy > 0     && grid[i - SY]) ||
          (iy < gy-1  && grid[i + SY]) ||
          (iz > 0     && grid[i - SZ]) ||
          (iz < gz-1  && grid[i + SZ])
        ) {
          out[i] = 1;
        }
      }
    }
  }
  return out;
}

/**
 * Shell voxel reconstruction — for thin-shell meshes (car bodies, panels,
 * monocoques) where solid flood-fill would fill in intentional openings.
 *
 * Pipeline:
 *   1. Rasterize every triangle's surface into the grid (no flood fill).
 *   2. Dilate by `dilationVoxels` to close small gaps and give the shell
 *      actual wall thickness.
 *   3. Extract a block-mesh surface (faces between marked and empty voxels).
 *
 * Windows / door cutouts wider than 2 × voxel size are preserved intact.
 */
export async function shellVoxelReconstruct(
  geo: THREE.BufferGeometry,
  onProgress: VoxelProgressCallback,
  resolutionMM?: number,
  dilationVoxels = 1,
): Promise<VoxelReconstructResult> {
  const g = geo.index ? geo.toNonIndexed() : geo.clone();
  g.computeBoundingBox();
  const bb = g.boundingBox!;
  const bbSize = new THREE.Vector3();
  bb.getSize(bbSize);

  const resolution =
    resolutionMM ?? autoVoxelResolution({ x: bbSize.x, y: bbSize.y, z: bbSize.z });

  // ── Guards ──────────────────────────────────────────────────────────────────
  validateResolution(resolution);
  validateBBox(bbSize, bb.min);

  // Padding: dilation amount + 1 voxel safety border
  const PAD = dilationVoxels + 1;
  const gx = Math.ceil(bbSize.x / resolution) + 2 * PAD;
  const gy = Math.ceil(bbSize.y / resolution) + 2 * PAD;
  const gz = Math.ceil(bbSize.z / resolution) + 2 * PAD;
  const dims: [number, number, number] = [gx, gy, gz];

  validateGridDims(gx, gy, gz, resolution);
  validateEstimatedTriangles(gx, gy, gz);

  const ox = bb.min.x - PAD * resolution;
  const oy = bb.min.y - PAD * resolution;
  const oz = bb.min.z - PAD * resolution;

  const SY = gx, SZ = gx * gy;
  let grid: Uint8Array = new Uint8Array(gx * gy * gz);

  // ── Step 1: Surface rasterization ────────────────────────────────────────
  onProgress(0, 3, "Rasterizing surface…");
  await yieldToUI();

  const posArr = g.attributes.position.array as Float32Array;
  const triCount = Math.floor(posArr.length / 9);
  let lastYieldAt = Date.now();

  for (let t = 0; t < triCount; t++) {
    const b = t * 9;
    rasterizeTriangleSurface(
      grid, SY, SZ, gx, gy, gz,
      posArr[b],   posArr[b+1], posArr[b+2],
      posArr[b+3], posArr[b+4], posArr[b+5],
      posArr[b+6], posArr[b+7], posArr[b+8],
      ox, oy, oz, resolution,
    );

    if (t % 10000 === 0 && Date.now() - lastYieldAt > 50) {
      onProgress(0, 3, `Rasterizing… ${Math.round((t / triCount) * 100)}%`);
      await yieldToUI();
      lastYieldAt = Date.now();
    }
  }

  // ── Step 2: Dilation ──────────────────────────────────────────────────────
  for (let d = 0; d < dilationVoxels; d++) {
    onProgress(1, 3, `Dilating shell… (pass ${d + 1}/${dilationVoxels})`);
    await yieldToUI();
    grid = dilate3D(grid, gx, gy, gz, SY, SZ);
    lastYieldAt = Date.now();
  }

  // ── Step 3: Block-mesh surface extraction ────────────────────────────────
  // For shell mode: emit faces wherever SOLID borders an EMPTY voxel.
  // Both inner and outer surfaces are emitted, forming a closed solid shell.
  onProgress(2, 3, "Extracting shell surface…");
  await yieldToUI();

  const posOut: number[] = [];
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
          if (grid[nx + ny * SY + nz * SZ] === 1) continue; // interior → skip

          const [v0, v1, v2, v3] = f.v;
          posOut.push(
            wx + r * v0[0], wy + r * v0[1], wz + r * v0[2],
            wx + r * v1[0], wy + r * v1[1], wz + r * v1[2],
            wx + r * v2[0], wy + r * v2[1], wz + r * v2[2],
            wx + r * v0[0], wy + r * v0[1], wz + r * v0[2],
            wx + r * v2[0], wy + r * v2[1], wz + r * v2[2],
            wx + r * v3[0], wy + r * v3[1], wz + r * v3[2],
          );
        }
      }
    }
    if (iz % 20 === 0 && Date.now() - lastYieldAt > 50) {
      onProgress(2, 3, `Extracting… ${Math.round((iz / gz) * 100)}%`);
      await yieldToUI();
      lastYieldAt = Date.now();
    }
  }

  onProgress(3, 3, "Finalizing geometry…");
  await yieldToUI();

  const outGeo = new THREE.BufferGeometry();
  const posFloat = new Float32Array(posOut);

  // Guard 3: validate output positions
  validateOutputPositions(posFloat, bb.min, bb.max, resolution);

  outGeo.setAttribute("position", new THREE.BufferAttribute(posFloat, 3));
  outGeo.computeVertexNormals();
  g.dispose();

  return {
    geometry: outGeo,
    resolution,
    gridDims: dims,
    outputTriangles: Math.floor(posFloat.length / 9),
  };
}
