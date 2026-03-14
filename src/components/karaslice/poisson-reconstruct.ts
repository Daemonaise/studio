// poisson-reconstruct.ts
// Point-cloud / MLS surface reconstruction for thin-shell meshes.
//
// Voxel reconstruction fails on thin shells (car bodies, panels, monocoques)
// because the shell thickness is smaller than any safe voxel resolution.
// This module instead:
//   1. Extracts oriented points from the triangle soup (centroids + normals).
//   2. Builds a spatial hash for fast neighbor queries.
//   3. Evaluates a signed distance field (SDF) via weighted normal projection
//      (Moving Least Squares).
//   4. Runs marching cubes on the SDF to extract a clean manifold surface.
//
// Memory usage scales with surface area, not bounding volume.

import * as THREE from "three";
import type { VoxelProgressCallback, VoxelReconstructResult } from "./voxel-reconstruct";

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function yieldToUI(): Promise<void> {
  await new Promise<void>((r) => setTimeout(r, 0));
}

// ─── Ring-buffer queue (O(1) push/shift) ─────────────────────────────────────

class RingQueue {
  private buf: Int32Array;
  private head = 0;
  private tail = 0;
  private mask: number;

  constructor(capacity: number) {
    // Round up to next power of 2
    let n = 1;
    while (n < capacity) n <<= 1;
    this.buf = new Int32Array(n);
    this.mask = n - 1;
  }

  push(val: number): void {
    this.buf[this.tail & this.mask] = val;
    this.tail++;
  }

  shift(): number {
    return this.buf[this.head++ & this.mask];
  }

  get length(): number {
    return this.tail - this.head;
  }
}

// ─── BitArray (1 bit per flag, 8× less memory than Uint8Array) ───────────────

class BitArray {
  private data: Uint32Array;
  constructor(size: number) {
    this.data = new Uint32Array(Math.ceil(size / 32));
  }
  get(i: number): boolean {
    return (this.data[i >>> 5] & (1 << (i & 31))) !== 0;
  }
  set(i: number): void {
    this.data[i >>> 5] |= 1 << (i & 31);
  }
}

// ─── Step 1: Extract oriented point cloud ────────────────────────────────────

interface PointCloud {
  points: Float64Array;   // xyz interleaved
  normals: Float64Array;  // xyz interleaved
  count: number;
}

function extractPointCloud(geo: THREE.BufferGeometry, mergePrecision = 0.001): PointCloud {
  const pos = geo.attributes.position.array as Float32Array;
  const triCount = Math.floor(pos.length / 9);
  // Centroids (always unique) + deduplicated vertices
  const maxPts = triCount * 4;
  const points = new Float64Array(maxPts * 3);
  const normals = new Float64Array(maxPts * 3);
  let count = 0;

  // Vertex dedup via quantized position key
  const vertexMap = new Map<string, number>();

  for (let f = 0; f < triCount; f++) {
    const b = f * 9;
    const p0x = pos[b], p0y = pos[b + 1], p0z = pos[b + 2];
    const p1x = pos[b + 3], p1y = pos[b + 4], p1z = pos[b + 5];
    const p2x = pos[b + 6], p2y = pos[b + 7], p2z = pos[b + 8];

    // Face normal
    const ex = p1x - p0x, ey = p1y - p0y, ez = p1z - p0z;
    const fx = p2x - p0x, fy = p2y - p0y, fz = p2z - p0z;
    let nx = ey * fz - ez * fy;
    let ny = ez * fx - ex * fz;
    let nz = ex * fy - ey * fx;
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (len < 1e-10) continue; // degenerate
    nx /= len; ny /= len; nz /= len;

    // Add centroid (always unique)
    const cx = (p0x + p1x + p2x) / 3;
    const cy = (p0y + p1y + p2y) / 3;
    const cz = (p0z + p1z + p2z) / 3;
    let idx = count * 3;
    points[idx] = cx; points[idx + 1] = cy; points[idx + 2] = cz;
    normals[idx] = nx; normals[idx + 1] = ny; normals[idx + 2] = nz;
    count++;

    // Add vertices (deduplicated — last-write-wins for normal, orientNormals fixes consistency)
    const verts = [p0x, p0y, p0z, p1x, p1y, p1z, p2x, p2y, p2z];
    for (let v = 0; v < 3; v++) {
      const vx = verts[v * 3], vy = verts[v * 3 + 1], vz = verts[v * 3 + 2];
      const scale = 1 / mergePrecision;
      const key = `${(vx * scale) | 0},${(vy * scale) | 0},${(vz * scale) | 0}`;
      const existing = vertexMap.get(key);
      if (existing !== undefined) {
        // Update normal of existing vertex
        const ei = existing * 3;
        normals[ei] = nx; normals[ei + 1] = ny; normals[ei + 2] = nz;
        continue;
      }
      vertexMap.set(key, count);
      idx = count * 3;
      points[idx] = vx; points[idx + 1] = vy; points[idx + 2] = vz;
      normals[idx] = nx; normals[idx + 1] = ny; normals[idx + 2] = nz;
      count++;
    }
  }

  return {
    points: points.subarray(0, count * 3),
    normals: normals.subarray(0, count * 3),
    count,
  };
}

// ─── Step 2: Spatial hash ────────────────────────────────────────────────────

class SpatialHash {
  private cells = new Map<number, number[]>();
  constructor(private cellSize: number) {}

  private hash(x: number, y: number, z: number): number {
    const ix = Math.floor(x / this.cellSize);
    const iy = Math.floor(y / this.cellSize);
    const iz = Math.floor(z / this.cellSize);
    return ((ix * 73856093) ^ (iy * 19349663) ^ (iz * 83492791)) >>> 0;
  }

  insert(index: number, x: number, y: number, z: number): void {
    const h = this.hash(x, y, z);
    let cell = this.cells.get(h);
    if (!cell) { cell = []; this.cells.set(h, cell); }
    cell.push(index);
  }

  queryRadius(
    qx: number, qy: number, qz: number,
    radius: number, points: Float64Array,
  ): number[] {
    const result: number[] = [];
    const r2 = radius * radius;
    const steps = Math.ceil(radius / this.cellSize);

    const cx = Math.floor(qx / this.cellSize);
    const cy = Math.floor(qy / this.cellSize);
    const cz = Math.floor(qz / this.cellSize);

    for (let dz = -steps; dz <= steps; dz++) {
      for (let dy = -steps; dy <= steps; dy++) {
        for (let dx = -steps; dx <= steps; dx++) {
          const h = (((cx + dx) * 73856093) ^ ((cy + dy) * 19349663) ^ ((cz + dz) * 83492791)) >>> 0;
          const cell = this.cells.get(h);
          if (!cell) continue;
          for (const idx of cell) {
            const px = points[idx * 3] - qx;
            const py = points[idx * 3 + 1] - qy;
            const pz = points[idx * 3 + 2] - qz;
            if (px * px + py * py + pz * pz <= r2) {
              result.push(idx);
            }
          }
        }
      }
    }
    return result;
  }
}

// ─── Step 2b: Orient normals consistently ────────────────────────────────────

function orientNormals(
  points: Float64Array,
  normals: Float64Array,
  count: number,
  hash: SpatialHash,
  radius: number,
  sampleDensity = 0.001,
): void {
  const visited = new Uint8Array(count);
  const queue = new RingQueue(count);

  // ── Pass 1: Find best seed — point with highest neighbor normal agreement ──
  let bestSeed = 0;
  let bestScore = -1;
  const sampleStep = Math.max(1, Math.floor(count * sampleDensity > 0 ? 1 / sampleDensity : 1000));
  for (let i = 0; i < count; i += sampleStep) {
    const neighbors = hash.queryRadius(
      points[i * 3], points[i * 3 + 1], points[i * 3 + 2],
      radius, points,
    );
    let agree = 0;
    const nix = normals[i * 3], niy = normals[i * 3 + 1], niz = normals[i * 3 + 2];
    for (const j of neighbors) {
      if (j === i) continue;
      const dot = nix * normals[j * 3] + niy * normals[j * 3 + 1] + niz * normals[j * 3 + 2];
      if (dot > 0) agree++;
    }
    if (agree > bestScore) {
      bestScore = agree;
      bestSeed = i;
    }
  }

  // ── Pass 2: BFS from seed, propagating orientation ──
  queue.push(bestSeed);
  visited[bestSeed] = 1;

  while (queue.length > 0) {
    const idx = queue.shift();
    const nix = normals[idx * 3], niy = normals[idx * 3 + 1], niz = normals[idx * 3 + 2];

    const neighbors = hash.queryRadius(
      points[idx * 3], points[idx * 3 + 1], points[idx * 3 + 2],
      radius, points,
    );

    for (const j of neighbors) {
      if (visited[j]) continue;
      visited[j] = 1;

      const dot = nix * normals[j * 3] + niy * normals[j * 3 + 1] + niz * normals[j * 3 + 2];
      if (dot < 0) {
        normals[j * 3] = -normals[j * 3];
        normals[j * 3 + 1] = -normals[j * 3 + 1];
        normals[j * 3 + 2] = -normals[j * 3 + 2];
      }

      queue.push(j);
    }
  }

  // ── Pass 3: Handle disconnected regions — orient by nearest visited neighbor ──
  for (let i = 0; i < count; i++) {
    if (visited[i]) continue;
    visited[i] = 1;

    const neighbors = hash.queryRadius(
      points[i * 3], points[i * 3 + 1], points[i * 3 + 2],
      radius * 2, points,
    );

    let nearestVisited = -1;
    let nearestDist = Infinity;
    for (const j of neighbors) {
      if (!visited[j] || j === i) continue;
      const dx = points[i * 3] - points[j * 3];
      const dy = points[i * 3 + 1] - points[j * 3 + 1];
      const dz = points[i * 3 + 2] - points[j * 3 + 2];
      const d = dx * dx + dy * dy + dz * dz;
      if (d < nearestDist) { nearestDist = d; nearestVisited = j; }
    }

    if (nearestVisited >= 0) {
      const dot = normals[i * 3] * normals[nearestVisited * 3] +
        normals[i * 3 + 1] * normals[nearestVisited * 3 + 1] +
        normals[i * 3 + 2] * normals[nearestVisited * 3 + 2];
      if (dot < 0) {
        normals[i * 3] = -normals[i * 3];
        normals[i * 3 + 1] = -normals[i * 3 + 1];
        normals[i * 3 + 2] = -normals[i * 3 + 2];
      }
    }
  }

  // ── Pass 4: Global orientation — ensure normals point outward ──
  let cx = 0, cy = 0, cz = 0;
  for (let i = 0; i < count; i++) {
    cx += points[i * 3]; cy += points[i * 3 + 1]; cz += points[i * 3 + 2];
  }
  cx /= count; cy /= count; cz /= count;

  let farthestIdx = 0;
  let farthestDist = 0;
  for (let i = 0; i < count; i++) {
    const dx = points[i * 3] - cx;
    const dy = points[i * 3 + 1] - cy;
    const dz = points[i * 3 + 2] - cz;
    const d = dx * dx + dy * dy + dz * dz;
    if (d > farthestDist) { farthestDist = d; farthestIdx = i; }
  }

  const dx = points[farthestIdx * 3] - cx;
  const dy = points[farthestIdx * 3 + 1] - cy;
  const dz = points[farthestIdx * 3 + 2] - cz;
  const dot = dx * normals[farthestIdx * 3] +
    dy * normals[farthestIdx * 3 + 1] +
    dz * normals[farthestIdx * 3 + 2];

  if (dot < 0) {
    // All normals pointing inward — flip all
    for (let i = 0; i < count * 3; i++) {
      normals[i] = -normals[i];
    }
  }
}

// ─── Step 3: SDF evaluation ──────────────────────────────────────────────────

function evaluateSDF(
  qx: number, qy: number, qz: number,
  neighbors: number[],
  points: Float64Array, normals: Float64Array,
  h: number,
): number {
  if (neighbors.length === 0) return 1.0; // far from surface = outside

  const h2inv = 1.0 / (2 * h * h);
  let sumWD = 0, sumW = 0;

  for (const i of neighbors) {
    const dx = qx - points[i * 3];
    const dy = qy - points[i * 3 + 1];
    const dz = qz - points[i * 3 + 2];
    const dist2 = dx * dx + dy * dy + dz * dz;

    const w = Math.exp(-dist2 * h2inv);
    const sd = dx * normals[i * 3] + dy * normals[i * 3 + 1] + dz * normals[i * 3 + 2];

    sumWD += w * sd;
    sumW += w;
  }

  return sumW > 0 ? sumWD / sumW : 1.0;
}

// ─── Marching cubes tables ───────────────────────────────────────────────────
// Standard MC edge table + tri table (Lorensen & Cline 1987).
// EDGE_TABLE: for each of the 256 cube configurations, a bitmask indicating
// which of the 12 edges have a zero crossing.
// TRI_TABLE: for each config, up to 5 triangles specified as edge index triples.
// -1 terminates the list.

// Cube corners:    Edges:
//     4-------5     4: 4-5    8:  0-4
//    /|      /|     5: 5-6    9:  1-5
//   7-+-----6 |     6: 6-7   10:  2-6
//   | 0-----+-1     7: 7-4   11:  3-7
//   |/      |/      0: 0-1
//   3-------2       1: 1-2
//                    2: 2-3
//                    3: 3-0

const EDGE_TABLE: readonly number[] = [
  0x0,0x109,0x203,0x30a,0x406,0x50f,0x605,0x70c,0x80c,0x905,0xa0f,0xb06,0xc0a,0xd03,0xe09,0xf00,
  0x190,0x99,0x393,0x29a,0x596,0x49f,0x795,0x69c,0x99c,0x895,0xb9f,0xa96,0xd9a,0xc93,0xf99,0xe90,
  0x230,0x339,0x33,0x13a,0x636,0x73f,0x435,0x53c,0xa3c,0xb35,0x83f,0x936,0xe3a,0xf33,0xc39,0xd30,
  0x3a0,0x2a9,0x1a3,0xaa,0x7a6,0x6af,0x5a5,0x4ac,0xbac,0xaa5,0x9af,0x8a6,0xfaa,0xea3,0xda9,0xca0,
  0x460,0x569,0x663,0x76a,0x66,0x16f,0x265,0x36c,0xc6c,0xd65,0xe6f,0xf66,0x86a,0x963,0xa69,0xb60,
  0x5f0,0x4f9,0x7f3,0x6fa,0x1f6,0xff,0x3f5,0x2fc,0xdfc,0xcf5,0xfff,0xef6,0x9fa,0x8f3,0xbf9,0xaf0,
  0x650,0x759,0x453,0x55a,0x256,0x35f,0x55,0x15c,0xe5c,0xf55,0xc5f,0xd56,0xa5a,0xb53,0x859,0x950,
  0x7c0,0x6c9,0x5c3,0x4ca,0x3c6,0x2cf,0x1c5,0xcc,0xfcc,0xec5,0xdcf,0xcc6,0xbca,0xac3,0x9c9,0x8c0,
  0x8c0,0x9c9,0xac3,0xbca,0xcc6,0xdcf,0xec5,0xfcc,0xcc,0x1c5,0x2cf,0x3c6,0x4ca,0x5c3,0x6c9,0x7c0,
  0x950,0x859,0xb53,0xa5a,0xd56,0xc5f,0xf55,0xe5c,0x15c,0x55,0x35f,0x256,0x55a,0x453,0x759,0x650,
  0xaf0,0xbf9,0x8f3,0x9fa,0xef6,0xfff,0xcf5,0xdfc,0x2fc,0x3f5,0xff,0x1f6,0x6fa,0x7f3,0x4f9,0x5f0,
  0xb60,0xa69,0x963,0x86a,0xf66,0xe6f,0xd65,0xc6c,0x36c,0x265,0x16f,0x66,0x76a,0x663,0x569,0x460,
  0xca0,0xda9,0xea3,0xfaa,0x8a6,0x9af,0xaa5,0xbac,0x4ac,0x5a5,0x6af,0x7a6,0xaa,0x1a3,0x2a9,0x3a0,
  0xd30,0xc39,0xf33,0xe3a,0x936,0x83f,0xb35,0xa3c,0x53c,0x435,0x73f,0x636,0x13a,0x33,0x339,0x230,
  0xe90,0xf99,0xc93,0xd9a,0xa96,0xb9f,0x895,0x99c,0x69c,0x795,0x49f,0x596,0x29a,0x393,0x99,0x190,
  0xf00,0xe09,0xd03,0xc0a,0xb06,0xa0f,0x905,0x80c,0x70c,0x605,0x50f,0x406,0x30a,0x203,0x109,0x0,
] as const;

/* eslint-disable @typescript-eslint/no-loss-of-precision */
const TRI_TABLE: readonly (readonly number[])[] = [
  [],
  [0,8,3],
  [0,1,9],
  [1,8,3,9,8,1],
  [1,2,10],
  [0,8,3,1,2,10],
  [9,2,10,0,2,9],
  [2,8,3,2,10,8,10,9,8],
  [3,11,2],
  [0,11,2,8,11,0],
  [1,9,0,2,3,11],
  [1,11,2,1,9,11,9,8,11],
  [3,10,1,11,10,3],
  [0,10,1,0,8,10,8,11,10],
  [3,9,0,3,11,9,11,10,9],
  [9,8,10,10,8,11],
  [4,7,8],
  [4,3,0,7,3,4],
  [0,1,9,8,4,7],
  [4,1,9,4,7,1,7,3,1],
  [1,2,10,8,4,7],
  [3,4,7,3,0,4,1,2,10],
  [9,2,10,9,0,2,8,4,7],
  [2,10,9,2,9,7,2,7,3,7,9,4],
  [8,4,7,3,11,2],
  [11,4,7,11,2,4,2,0,4],
  [9,0,1,8,4,7,2,3,11],
  [4,7,11,9,4,11,9,11,2,9,2,1],
  [3,10,1,3,11,10,7,8,4],
  [1,11,10,1,4,11,1,0,4,7,11,4],
  [4,7,8,9,0,11,9,11,10,11,0,3],
  [4,7,11,4,11,9,9,11,10],
  [9,5,4],
  [9,5,4,0,8,3],
  [0,5,4,1,5,0],
  [8,5,4,8,3,5,3,1,5],
  [1,2,10,9,5,4],
  [3,0,8,1,2,10,4,9,5],
  [5,2,10,5,4,2,4,0,2],
  [2,10,5,3,2,5,3,5,4,3,4,8],
  [9,5,4,2,3,11],
  [0,11,2,0,8,11,4,9,5],
  [0,5,4,0,1,5,2,3,11],
  [2,1,5,2,5,8,2,8,11,4,8,5],
  [10,3,11,10,1,3,9,5,4],
  [4,9,5,0,8,1,8,10,1,8,11,10],
  [5,4,0,5,0,11,5,11,10,11,0,3],
  [5,4,8,5,8,10,10,8,11],
  [9,7,8,5,7,9],
  [9,3,0,9,5,3,5,7,3],
  [0,7,8,0,1,7,1,5,7],
  [1,5,3,3,5,7],
  [9,7,8,9,5,7,10,1,2],
  [10,1,2,9,5,0,5,3,0,5,7,3],
  [8,0,2,8,2,5,8,5,7,10,5,2],
  [2,10,5,2,5,3,3,5,7],
  [7,9,5,7,8,9,3,11,2],
  [9,5,7,9,7,2,9,2,0,2,7,11],
  [2,3,11,0,1,8,1,7,8,1,5,7],
  [11,2,1,11,1,7,7,1,5],
  [9,5,8,8,5,7,10,1,3,10,3,11],
  [5,7,0,5,0,9,7,11,0,1,0,10,11,10,0],
  [11,10,0,11,0,3,10,5,0,8,0,7,5,7,0],
  [11,10,5,7,11,5],
  [10,6,5],
  [0,8,3,5,10,6],
  [9,0,1,5,10,6],
  [1,8,3,1,9,8,5,10,6],
  [1,6,5,2,6,1],
  [1,6,5,1,2,6,3,0,8],
  [9,6,5,9,0,6,0,2,6],
  [5,9,8,5,8,2,5,2,6,3,2,8],
  [2,3,11,10,6,5],
  [11,0,8,11,2,0,10,6,5],
  [0,1,9,2,3,11,5,10,6],
  [5,10,6,1,9,2,9,11,2,9,8,11],
  [6,3,11,6,5,3,5,1,3],
  [0,8,11,0,11,5,0,5,1,5,11,6],
  [3,11,6,0,3,6,0,6,5,0,5,9],
  [6,5,9,6,9,11,11,9,8],
  [5,10,6,4,7,8],
  [4,3,0,4,7,3,6,5,10],
  [1,9,0,5,10,6,8,4,7],
  [10,6,5,1,9,7,1,7,3,7,9,4],
  [6,1,2,6,5,1,4,7,8],
  [1,2,5,5,2,6,3,0,4,3,4,7],
  [8,4,7,9,0,5,0,6,5,0,2,6],
  [7,3,9,7,9,4,3,2,9,5,9,6,2,6,9],
  [3,11,2,7,8,4,10,6,5],
  [5,10,6,4,7,2,4,2,0,2,7,11],
  [0,1,9,4,7,8,2,3,11,5,10,6],
  [9,2,1,9,11,2,9,4,11,7,11,4,5,10,6],
  [8,4,7,3,11,5,3,5,1,5,11,6],
  [5,1,11,5,11,6,1,0,11,7,11,4,0,4,11],
  [0,5,9,0,6,5,0,3,6,11,6,3,8,4,7],
  [6,5,9,6,9,11,4,7,9,7,11,9],
  [10,4,9,6,4,10],
  [4,10,6,4,9,10,0,8,3],
  [10,0,1,10,6,0,6,4,0],
  [8,3,1,8,1,6,8,6,4,6,1,10],
  [1,4,9,1,2,4,2,6,4],
  [3,0,8,1,2,9,2,4,9,2,6,4],
  [0,2,4,4,2,6],
  [8,3,2,8,2,4,4,2,6],
  [10,4,9,10,6,4,11,2,3],
  [0,8,2,2,8,11,4,9,10,4,10,6],
  [3,11,2,0,1,6,0,6,4,6,1,10],
  [6,4,1,6,1,10,4,8,1,2,1,11,8,11,1],
  [9,6,4,9,3,6,9,1,3,11,6,3],
  [8,11,1,8,1,0,11,6,1,9,1,4,6,4,1],
  [3,11,6,3,6,0,0,6,4],
  [6,4,8,11,6,8],
  [7,10,6,7,8,10,8,9,10],
  [0,7,3,0,10,7,0,9,10,6,7,10],
  [10,6,7,1,10,7,1,7,8,1,8,0],
  [10,6,7,10,7,1,1,7,3],
  [1,2,6,1,6,8,1,8,9,8,6,7],
  [2,6,9,2,9,1,6,7,9,0,9,3,7,3,9],
  [7,8,0,7,0,6,6,0,2],
  [7,3,2,6,7,2],
  [2,3,11,10,6,8,10,8,9,8,6,7],
  [2,0,7,2,7,11,0,9,7,6,7,10,9,10,7],
  [1,8,0,1,7,8,1,10,7,6,7,10,2,3,11],
  [11,2,1,11,1,7,10,6,1,6,7,1],
  [8,9,6,8,6,7,9,1,6,11,6,3,1,3,6],
  [0,9,1,11,6,7],
  [7,8,0,7,0,6,3,11,0,11,6,0],
  [7,11,6],
  [7,6,11],
  [3,0,8,11,7,6],
  [0,1,9,11,7,6],
  [8,1,9,8,3,1,11,7,6],
  [10,1,2,6,11,7],
  [1,2,10,3,0,8,6,11,7],
  [2,9,0,2,10,9,6,11,7],
  [6,11,7,2,10,3,10,8,3,10,9,8],
  [7,2,3,6,2,7],
  [7,0,8,7,6,0,6,2,0],
  [2,7,6,2,3,7,0,1,9],
  [1,6,2,1,8,6,1,9,8,8,7,6],
  [10,7,6,10,1,7,1,3,7],
  [10,7,6,1,7,10,1,8,7,1,0,8],
  [0,3,7,0,7,10,0,10,9,6,10,7],
  [7,6,10,7,10,8,8,10,9],
  [6,8,4,11,8,6],
  [3,6,11,3,0,6,0,4,6],
  [8,6,11,8,4,6,9,0,1],
  [9,4,6,9,6,3,9,3,1,11,3,6],
  [6,8,4,6,11,8,2,10,1],
  [1,2,10,3,0,11,0,6,11,0,4,6],
  [4,11,8,4,6,11,0,2,9,2,10,9],
  [10,9,3,10,3,2,9,4,3,11,3,6,4,6,3],
  [8,2,3,8,4,2,4,6,2],
  [0,4,2,4,6,2],
  [1,9,0,2,3,4,2,4,6,4,3,8],
  [1,9,4,1,4,2,2,4,6],
  [8,1,3,8,6,1,8,4,6,6,10,1],
  [10,1,0,10,0,6,6,0,4],
  [4,6,3,4,3,8,6,10,3,0,3,9,10,9,3],
  [10,9,4,6,10,4],
  [4,9,5,7,6,11],
  [0,8,3,4,9,5,11,7,6],
  [5,0,1,5,4,0,7,6,11],
  [11,7,6,8,3,4,3,5,4,3,1,5],
  [9,5,4,10,1,2,7,6,11],
  [6,11,7,1,2,10,0,8,3,4,9,5],
  [7,6,11,5,4,10,4,2,10,4,0,2],
  [3,4,8,3,5,4,3,2,5,10,5,2,11,7,6],
  [7,2,3,7,6,2,5,4,9],
  [9,5,4,0,8,6,0,6,2,6,8,7],
  [3,6,2,3,7,6,1,5,0,5,4,0],
  [6,2,8,6,8,7,2,1,8,4,8,5,1,5,8],
  [9,5,4,10,1,6,1,7,6,1,3,7],
  [1,6,10,1,7,6,1,0,7,8,7,0,9,5,4],
  [4,0,10,4,10,5,0,3,10,6,10,7,3,7,10],
  [7,6,10,7,10,8,5,4,10,4,8,10],
  [6,9,5,6,11,9,11,8,9],
  [3,6,11,0,6,3,0,5,6,0,9,5],
  [0,11,8,0,5,11,0,1,5,5,6,11],
  [6,11,3,6,3,5,5,3,1],
  [1,2,10,9,5,11,9,11,8,11,5,6],
  [0,11,3,0,6,11,0,9,6,5,6,9,1,2,10],
  [11,8,5,11,5,6,8,0,5,10,5,2,0,2,5],
  [6,11,3,6,3,5,2,10,3,10,5,3],
  [5,8,9,5,2,8,5,6,2,3,8,2],
  [9,5,6,9,6,0,0,6,2],
  [1,5,8,1,8,0,5,6,8,3,8,2,6,2,8],
  [1,5,6,2,1,6],
  [1,3,6,1,6,10,3,8,6,5,6,9,8,9,6],
  [10,1,0,10,0,6,9,5,0,5,6,0],
  [0,3,8,5,6,10],
  [10,5,6],
  [11,5,10,7,5,11],
  [11,5,10,11,7,5,8,3,0],
  [5,11,7,5,10,11,1,9,0],
  [10,7,5,10,11,7,9,8,1,8,3,1],
  [11,1,2,11,7,1,7,5,1],
  [0,8,3,1,2,7,1,7,5,7,2,11],
  [9,7,5,9,2,7,9,0,2,2,11,7],
  [7,5,2,7,2,11,5,9,2,3,2,8,9,8,2],
  [2,5,10,2,3,5,3,7,5],
  [8,2,0,8,5,2,8,7,5,10,2,5],
  [9,0,1,5,10,3,5,3,7,3,10,2],
  [9,8,2,9,2,1,8,7,2,10,2,5,7,5,2],
  [1,3,5,3,7,5],
  [0,8,7,0,7,1,1,7,5],
  [9,0,3,9,3,5,5,3,7],
  [9,8,7,5,9,7],
  [5,8,4,5,10,8,10,11,8],
  [5,0,4,5,11,0,5,10,11,11,3,0],
  [0,1,9,8,4,10,8,10,11,10,4,5],
  [10,11,4,10,4,5,11,3,4,9,4,1,3,1,4],
  [2,5,1,2,8,5,2,11,8,4,5,8],
  [0,4,11,0,11,3,4,5,11,2,11,1,5,1,11],
  [0,2,5,0,5,9,2,11,5,4,5,8,11,8,5],
  [9,4,5,2,11,3],
  [2,5,10,3,5,2,3,4,5,3,8,4],
  [5,10,2,5,2,4,4,2,0],
  [3,10,2,3,5,10,3,8,5,4,5,8,0,1,9],
  [5,10,2,5,2,4,1,9,2,9,4,2],
  [8,4,5,8,5,3,3,5,1],
  [0,4,5,1,0,5],
  [8,4,5,8,5,3,9,0,5,0,3,5],
  [9,4,5],
  [4,11,7,4,9,11,9,10,11],
  [0,8,3,4,9,7,9,11,7,9,10,11],
  [1,10,11,1,11,4,1,4,0,7,4,11],
  [3,1,4,3,4,8,1,10,4,7,4,11,10,11,4],
  [4,11,7,9,11,4,9,2,11,9,1,2],
  [9,7,4,9,11,7,9,1,11,2,11,1,0,8,3],
  [11,7,4,11,4,2,2,4,0],
  [11,7,4,11,4,2,8,3,4,3,2,4],
  [2,9,10,2,7,9,2,3,7,7,4,9],
  [9,10,7,9,7,4,10,2,7,0,7,8,2,8,7],
  [3,7,10,3,10,2,7,4,10,1,10,0,4,0,10],
  [1,10,2,8,7,4],
  [4,9,1,4,1,7,7,1,3],
  [4,9,1,4,1,7,0,8,1,8,7,1],
  [4,0,3,7,4,3],
  [4,8,7],
  [9,10,8,10,11,8],
  [3,0,9,3,9,11,11,9,10],
  [0,1,10,0,10,8,8,10,11],
  [3,1,10,11,3,10],
  [1,2,11,1,11,9,9,11,8],
  [3,0,9,3,9,11,1,2,9,2,11,9],
  [0,2,11,8,0,11],
  [3,2,11],
  [2,3,8,2,8,10,10,8,9],
  [9,10,2,0,9,2],
  [2,3,8,2,8,10,0,1,8,1,10,8],
  [1,10,2],
  [1,3,8,9,1,8],
  [0,9,1],
  [0,3,8],
  [],
] as const;

// Edge endpoint corner indices: edge i goes from EDGE_CORNERS[i][0] to EDGE_CORNERS[i][1]
const EDGE_CORNERS: readonly [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 0],
  [4, 5], [5, 6], [6, 7], [7, 4],
  [0, 4], [1, 5], [2, 6], [3, 7],
];

// Corner offsets: (dx, dy, dz) for corners 0–7
const CORNER_OFFSETS: readonly [number, number, number][] = [
  [0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0],
  [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1],
];

// ─── Marching cubes on SDF ───────────────────────────────────────────────────

function marchingCubesOnSDF(
  sdfGet: (idx: number) => number,
  nx: number, ny: number, nz: number,
  ox: number, oy: number, oz: number,
  resolution: number,
  onProgress?: VoxelProgressCallback,
): { positions: Float32Array; indices: Uint32Array; triCount: number; vertexCount: number } {
  const edgeVertexMap = new Map<number, number>();
  const positionsList: number[] = [];
  let vertexCount = 0;

  function sdfAt(x: number, y: number, z: number): number {
    if (x < 0 || x >= nx || y < 0 || y >= ny || z < 0 || z >= nz) return 1.0;
    return sdfGet((z * ny + y) * nx + x);
  }

  // Compact edge key using grid coordinates (avoids string hashing)
  function edgeKey(
    x0: number, y0: number, z0: number,
    x1: number, y1: number, z1: number,
  ): number {
    // Encode: min corner first, then axis direction (0=x, 1=y, 2=z)
    const ax = Math.min(x0, x1), ay = Math.min(y0, y1), az = Math.min(z0, z1);
    const axis = x0 !== x1 ? 0 : y0 !== y1 ? 1 : 2;
    return ((az * ny + ay) * nx + ax) * 3 + axis;
  }

  function getEdgeVertex(
    x0: number, y0: number, z0: number, v0: number,
    x1: number, y1: number, z1: number, v1: number,
  ): number {
    const key = edgeKey(x0, y0, z0, x1, y1, z1);
    const existing = edgeVertexMap.get(key);
    if (existing !== undefined) return existing;

    let t = 0.5;
    if (Math.abs(v1 - v0) > 1e-10) {
      t = -v0 / (v1 - v0);
      t = Math.max(0, Math.min(1, t));
    }

    positionsList.push(
      ox + (x0 + t * (x1 - x0)) * resolution,
      oy + (y0 + t * (y1 - y0)) * resolution,
      oz + (z0 + t * (z1 - z0)) * resolution,
    );
    const idx = vertexCount++;
    edgeVertexMap.set(key, idx);
    return idx;
  }

  const indices: number[] = [];

  for (let z = 0; z < nz - 1; z++) {
    if (onProgress && z % 20 === 0) {
      onProgress(z, nz - 1, `Marching cubes… ${Math.round((z / (nz - 1)) * 100)}%`);
    }

    for (let y = 0; y < ny - 1; y++) {
      for (let x = 0; x < nx - 1; x++) {
        // 8 corner SDF values
        const v: number[] = [];
        for (let c = 0; c < 8; c++) {
          const [cdx, cdy, cdz] = CORNER_OFFSETS[c];
          v.push(sdfAt(x + cdx, y + cdy, z + cdz));
        }

        // Case index
        let caseIdx = 0;
        for (let c = 0; c < 8; c++) {
          if (v[c] < 0) caseIdx |= (1 << c);
        }

        if (caseIdx === 0 || caseIdx === 255) continue;

        const edgeMask = EDGE_TABLE[caseIdx];
        if (edgeMask === 0) continue;

        // Compute interpolated vertices on active edges
        const edgeVerts: number[] = new Array(12).fill(-1);
        for (let e = 0; e < 12; e++) {
          if (!(edgeMask & (1 << e))) continue;
          const [c0, c1] = EDGE_CORNERS[e];
          const [dx0, dy0, dz0] = CORNER_OFFSETS[c0];
          const [dx1, dy1, dz1] = CORNER_OFFSETS[c1];
          edgeVerts[e] = getEdgeVertex(
            x + dx0, y + dy0, z + dz0, v[c0],
            x + dx1, y + dy1, z + dz1, v[c1],
          );
        }

        // Emit triangles
        const triList = TRI_TABLE[caseIdx];
        for (let i = 0; i < triList.length; i += 3) {
          indices.push(edgeVerts[triList[i]], edgeVerts[triList[i + 1]], edgeVerts[triList[i + 2]]);
        }
      }
    }
  }

  // Return indexed geometry directly (Bug 6 fix — avoids 3× vertex expansion)
  const triCount = Math.floor(indices.length / 3);
  const positions = new Float32Array(positionsList);

  return { positions, indices: new Uint32Array(indices), triCount, vertexCount };
}

// ─── Main pipeline ───────────────────────────────────────────────────────────

const MAX_GRID_CELLS = 200_000_000;

export interface PointCloudReconstructParams {
  /** Grid resolution in mm. Smaller = finer detail, more memory. */
  resolution?: number;
  /** Multiplier for the smoothing / neighbor-query radius. Default 2. */
  radiusMultiplier?: number;
  /** SDF sharpness: 0.0 = smooth/blobby, 1.0 = sharp edges. Default 0.5. */
  sdfSharpness?: number;
  /** Eval radius multiplier: 1.0 = standard, 2.0+ bridges wider gaps. Default 1.0. */
  gapBridgingFactor?: number;
  /** Grid padding in multiples of resolution. Default 3. Higher = better boundary handling. */
  gridPadding?: number;
  /** Normal orientation sample density: fraction of points to sample for seed selection. Default 0.001 (1/1000). Higher = better normals on noisy meshes, slower. */
  normalSampleDensity?: number;
  /** Vertex merge precision in mm. Default 0.001. Increase for scan data (0.01-0.1), decrease for precision CAD (0.0001). */
  vertexMergePrecision?: number;
  /** SDF outside bias: default value for unevaluated cells. Default 1.0 (outside). Lower (0.1-0.5) biases toward filling gaps. */
  outsideBias?: number;
}

/**
 * Auto-compute a grid resolution for point cloud reconstruction.
 * Targets ~600 cells along the longest axis for high-quality output.
 */
function autoResolution(bbox: { x: number; y: number; z: number }): number {
  const maxDim = Math.max(bbox.x, bbox.y, bbox.z, 1);
  const res = maxDim / 600;
  // Enforce grid safety: same limits as voxel pipeline
  const floor = Math.max(
    maxDim / 1000,
    Math.cbrt(bbox.x * bbox.y * bbox.z / MAX_GRID_CELLS),
    0.5,
  );
  return Math.max(res, floor);
}

/**
 * Point cloud / MLS surface reconstruction — for thin-shell meshes where
 * voxel reconstruction fails (car bodies, panels, monocoques).
 *
 * Pipeline:
 *   1. Extract oriented point cloud from triangle soup (centroids + normals)
 *   2. Build spatial hash for fast neighbor queries
 *   3. Evaluate SDF on a grid near the input geometry (not the full volume)
 *   4. Run marching cubes to extract clean manifold surface
 *
 * The SDF is only evaluated in cells near input points (~5% of grid for
 * thin shells), so memory scales with surface area, not bounding volume.
 */
export async function pointCloudReconstruct(
  geo: THREE.BufferGeometry,
  onProgress: VoxelProgressCallback,
  params?: PointCloudReconstructParams,
): Promise<VoxelReconstructResult> {
  const g = geo.index ? geo.toNonIndexed() : geo.clone();
  g.computeBoundingBox();
  const bb = g.boundingBox!;
  const bbSize = new THREE.Vector3();
  bb.getSize(bbSize);

  const resolution = params?.resolution ??
    autoResolution({ x: bbSize.x, y: bbSize.y, z: bbSize.z });
  const radiusMult = params?.radiusMultiplier ?? 2;
  const smoothingRadius = resolution * radiusMult;
  const sdfSharpness = Math.max(0, Math.min(1, params?.sdfSharpness ?? 0.5));
  const gapBridgingFactor = Math.max(1, Math.min(3, params?.gapBridgingFactor ?? 1.0));
  const gridPadding = Math.max(1, Math.min(10, params?.gridPadding ?? 3));
  const normalSampleDensity = Math.max(0.0001, Math.min(0.1, params?.normalSampleDensity ?? 0.001));
  const vertexMergePrecision = Math.max(0.0001, Math.min(1, params?.vertexMergePrecision ?? 0.001));
  const outsideBias = Math.max(0.01, Math.min(2, params?.outsideBias ?? 1.0));

  // ── Step 1: Extract point cloud ──────────────────────────────────────────
  onProgress(0, 6, "Extracting point cloud…");
  await yieldToUI();

  const pc = extractPointCloud(g, vertexMergePrecision);

  if (pc.count === 0) {
    throw new Error("No valid triangles found in mesh");
  }

  // ── Step 2: Build spatial hash ───────────────────────────────────────────
  onProgress(1, 6, `Building spatial index (${pc.count.toLocaleString()} points)…`);
  await yieldToUI();

  const hash = new SpatialHash(smoothingRadius);
  for (let i = 0; i < pc.count; i++) {
    hash.insert(i, pc.points[i * 3], pc.points[i * 3 + 1], pc.points[i * 3 + 2]);
  }

  // ── Step 2b: Orient normals consistently ───────────────────────────────
  onProgress(2, 6, "Orienting normals…");
  await yieldToUI();

  orientNormals(pc.points, pc.normals, pc.count, hash, smoothingRadius, normalSampleDensity);

  // ── Step 3: Evaluate SDF on grid near geometry ───────────────────────────
  onProgress(3, 6, "Evaluating signed distance field…");
  await yieldToUI();

  const pad = resolution * gridPadding;
  const ox = bb.min.x - pad, oy = bb.min.y - pad, oz = bb.min.z - pad;
  const nx = Math.ceil((bbSize.x + 2 * pad) / resolution) + 1;
  const ny = Math.ceil((bbSize.y + 2 * pad) / resolution) + 1;
  const nz = Math.ceil((bbSize.z + 2 * pad) / resolution) + 1;
  const dims: [number, number, number] = [nx, ny, nz];

  const totalCells = nx * ny * nz;
  if (totalCells > MAX_GRID_CELLS) {
    throw new Error(
      `SDF grid too large: ${nx}×${ny}×${nz} = ${totalCells.toLocaleString()} cells ` +
      `(max ${MAX_GRID_CELLS.toLocaleString()}). Increase resolution.`
    );
  }

  // Sparse SDF: only store cells that are actually evaluated.
  // Unevaluated cells return +1.0 (outside). For thin shells, typically <10%
  // of the grid is near the surface, so this saves 90%+ memory vs dense array.
  // e.g. 80M cells × 4 bytes = 320MB dense → ~5M entries × ~40 bytes = ~200MB sparse,
  // but more importantly avoids the upfront 320MB allocation that can crash the tab.
  const sdf = new Map<number, number>();
  const sdfGet = (idx: number) => sdf.get(idx) ?? outsideBias;

  // Evaluate SDF only in cells near input points
  // gapBridgingFactor widens the eval radius to bridge larger gaps (at compute cost)
  const baseEvalRadius = Math.ceil(smoothingRadius / resolution) + 1;
  const evalRadius = Math.ceil(baseEvalRadius * gapBridgingFactor);
  // sdfSharpness controls Gaussian sigma: sharp = tight kernel (local), smooth = wide kernel
  // sharpness 0.0 → h = smoothingRadius (very smooth), 1.0 → h = smoothingRadius * 0.3 (very sharp)
  const h = smoothingRadius * (1.0 - sdfSharpness * 0.7);
  let lastYieldAt = Date.now();
  let evaluatedCount = 0;

  for (let pi = 0; pi < pc.count; pi++) {
    const px = pc.points[pi * 3], py = pc.points[pi * 3 + 1], pz = pc.points[pi * 3 + 2];
    const gx = Math.round((px - ox) / resolution);
    const gy = Math.round((py - oy) / resolution);
    const gz = Math.round((pz - oz) / resolution);

    for (let dz = -evalRadius; dz <= evalRadius; dz++) {
      const iz = gz + dz;
      if (iz < 0 || iz >= nz) continue;
      for (let dy = -evalRadius; dy <= evalRadius; dy++) {
        const iy = gy + dy;
        if (iy < 0 || iy >= ny) continue;
        for (let dx = -evalRadius; dx <= evalRadius; dx++) {
          const ix = gx + dx;
          if (ix < 0 || ix >= nx) continue;

          const cellIdx = (iz * ny + iy) * nx + ix;
          if (sdf.has(cellIdx)) continue;
          evaluatedCount++;

          const qx = ox + ix * resolution;
          const qy = oy + iy * resolution;
          const qz = oz + iz * resolution;

          const neighbors = hash.queryRadius(qx, qy, qz, smoothingRadius, pc.points);
          sdf.set(cellIdx, evaluateSDF(qx, qy, qz, neighbors, pc.points, pc.normals, h));
        }
      }
    }

    if (pi % 2000 === 0 && Date.now() - lastYieldAt > 50) {
      const pct = Math.round((pi / pc.count) * 100);
      onProgress(3, 6, `Evaluating SDF… ${pct}% (${evaluatedCount.toLocaleString()} cells)`);
      await yieldToUI();
      lastYieldAt = Date.now();
    }
  }

  const sparsePct = totalCells > 0 ? Math.round((evaluatedCount / totalCells) * 100) : 0;
  onProgress(4, 6, `SDF complete: ${evaluatedCount.toLocaleString()} / ${totalCells.toLocaleString()} cells evaluated (${sparsePct}% sparse)`);
  await yieldToUI();

  // ── Step 4: Marching cubes ───────────────────────────────────────────────
  onProgress(5, 6, "Running marching cubes…");
  await yieldToUI();

  const mc = marchingCubesOnSDF(sdfGet, nx, ny, nz, ox, oy, oz, resolution, onProgress);

  // ── Build output geometry (indexed — saves ~3× memory) ─────────────────
  onProgress(6, 6, "Finalizing geometry…");
  await yieldToUI();

  const outGeo = new THREE.BufferGeometry();
  outGeo.setAttribute("position", new THREE.BufferAttribute(mc.positions, 3));
  outGeo.setIndex(new THREE.BufferAttribute(mc.indices, 1));
  outGeo.computeVertexNormals();

  g.dispose();

  return {
    geometry: outGeo,
    resolution,
    gridDims: dims,
    outputTriangles: mc.triCount,
  };
}
