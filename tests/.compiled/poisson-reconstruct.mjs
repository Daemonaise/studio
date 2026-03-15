var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
import * as THREE from "three";
async function yieldToUI() {
  await new Promise((r) => setTimeout(r, 0));
}
class RingQueue {
  constructor(capacity) {
    __publicField(this, "buf");
    __publicField(this, "head", 0);
    __publicField(this, "tail", 0);
    __publicField(this, "mask");
    let n = 1;
    while (n < capacity) n <<= 1;
    this.buf = new Int32Array(n);
    this.mask = n - 1;
  }
  push(val) {
    this.buf[this.tail & this.mask] = val;
    this.tail++;
  }
  shift() {
    return this.buf[this.head++ & this.mask];
  }
  get length() {
    return this.tail - this.head;
  }
}
class BitArray {
  constructor(size) {
    __publicField(this, "data");
    this.data = new Uint32Array(Math.ceil(size / 32));
  }
  get(i) {
    return (this.data[i >>> 5] & 1 << (i & 31)) !== 0;
  }
  set(i) {
    this.data[i >>> 5] |= 1 << (i & 31);
  }
}
function extractPointCloud(geo, mergePrecision = 1e-3) {
  const pos = geo.attributes.position.array;
  const triCount = Math.floor(pos.length / 9);
  const maxPts = triCount * 4;
  const points = new Float64Array(maxPts * 3);
  const normals = new Float64Array(maxPts * 3);
  let count = 0;
  const vertexMap = /* @__PURE__ */ new Map();
  for (let f = 0; f < triCount; f++) {
    const b = f * 9;
    const p0x = pos[b], p0y = pos[b + 1], p0z = pos[b + 2];
    const p1x = pos[b + 3], p1y = pos[b + 4], p1z = pos[b + 5];
    const p2x = pos[b + 6], p2y = pos[b + 7], p2z = pos[b + 8];
    const ex = p1x - p0x, ey = p1y - p0y, ez = p1z - p0z;
    const fx = p2x - p0x, fy = p2y - p0y, fz = p2z - p0z;
    let nx = ey * fz - ez * fy;
    let ny = ez * fx - ex * fz;
    let nz = ex * fy - ey * fx;
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (len < 1e-10) continue;
    nx /= len;
    ny /= len;
    nz /= len;
    const cx = (p0x + p1x + p2x) / 3;
    const cy = (p0y + p1y + p2y) / 3;
    const cz = (p0z + p1z + p2z) / 3;
    let idx = count * 3;
    points[idx] = cx;
    points[idx + 1] = cy;
    points[idx + 2] = cz;
    normals[idx] = nx;
    normals[idx + 1] = ny;
    normals[idx + 2] = nz;
    count++;
    const verts = [p0x, p0y, p0z, p1x, p1y, p1z, p2x, p2y, p2z];
    for (let v = 0; v < 3; v++) {
      const vx = verts[v * 3], vy = verts[v * 3 + 1], vz = verts[v * 3 + 2];
      const scale = 1 / mergePrecision;
      const key = `${vx * scale | 0},${vy * scale | 0},${vz * scale | 0}`;
      const existing = vertexMap.get(key);
      if (existing !== void 0) {
        const ei = existing * 3;
        normals[ei] = nx;
        normals[ei + 1] = ny;
        normals[ei + 2] = nz;
        continue;
      }
      vertexMap.set(key, count);
      idx = count * 3;
      points[idx] = vx;
      points[idx + 1] = vy;
      points[idx + 2] = vz;
      normals[idx] = nx;
      normals[idx + 1] = ny;
      normals[idx + 2] = nz;
      count++;
    }
  }
  return {
    points: points.subarray(0, count * 3),
    normals: normals.subarray(0, count * 3),
    count
  };
}
class SpatialHash {
  constructor(cellSize) {
    this.cellSize = cellSize;
    __publicField(this, "cells", /* @__PURE__ */ new Map());
  }
  hash(x, y, z) {
    const ix = Math.floor(x / this.cellSize);
    const iy = Math.floor(y / this.cellSize);
    const iz = Math.floor(z / this.cellSize);
    return (ix * 73856093 ^ iy * 19349663 ^ iz * 83492791) >>> 0;
  }
  insert(index, x, y, z) {
    const h = this.hash(x, y, z);
    let cell = this.cells.get(h);
    if (!cell) {
      cell = [];
      this.cells.set(h, cell);
    }
    cell.push(index);
  }
  queryRadius(qx, qy, qz, radius, points) {
    const result = [];
    const r2 = radius * radius;
    const steps = Math.ceil(radius / this.cellSize);
    const cx = Math.floor(qx / this.cellSize);
    const cy = Math.floor(qy / this.cellSize);
    const cz = Math.floor(qz / this.cellSize);
    for (let dz = -steps; dz <= steps; dz++) {
      for (let dy = -steps; dy <= steps; dy++) {
        for (let dx = -steps; dx <= steps; dx++) {
          const h = ((cx + dx) * 73856093 ^ (cy + dy) * 19349663 ^ (cz + dz) * 83492791) >>> 0;
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
function orientNormals(points, normals, count, hash, radius, sampleDensity = 1e-3) {
  const visited = new Uint8Array(count);
  const queue = new RingQueue(count);
  let bestSeed = 0;
  let bestScore = -1;
  const sampleStep = Math.max(1, Math.floor(count * sampleDensity > 0 ? 1 / sampleDensity : 1e3));
  for (let i = 0; i < count; i += sampleStep) {
    const neighbors = hash.queryRadius(
      points[i * 3],
      points[i * 3 + 1],
      points[i * 3 + 2],
      radius,
      points
    );
    let agree = 0;
    const nix = normals[i * 3], niy = normals[i * 3 + 1], niz = normals[i * 3 + 2];
    for (const j of neighbors) {
      if (j === i) continue;
      const dot2 = nix * normals[j * 3] + niy * normals[j * 3 + 1] + niz * normals[j * 3 + 2];
      if (dot2 > 0) agree++;
    }
    if (agree > bestScore) {
      bestScore = agree;
      bestSeed = i;
    }
  }
  queue.push(bestSeed);
  visited[bestSeed] = 1;
  while (queue.length > 0) {
    const idx = queue.shift();
    const nix = normals[idx * 3], niy = normals[idx * 3 + 1], niz = normals[idx * 3 + 2];
    const neighbors = hash.queryRadius(
      points[idx * 3],
      points[idx * 3 + 1],
      points[idx * 3 + 2],
      radius,
      points
    );
    for (const j of neighbors) {
      if (visited[j]) continue;
      visited[j] = 1;
      const dot2 = nix * normals[j * 3] + niy * normals[j * 3 + 1] + niz * normals[j * 3 + 2];
      if (dot2 < 0) {
        normals[j * 3] = -normals[j * 3];
        normals[j * 3 + 1] = -normals[j * 3 + 1];
        normals[j * 3 + 2] = -normals[j * 3 + 2];
      }
      queue.push(j);
    }
  }
  for (let i = 0; i < count; i++) {
    if (visited[i]) continue;
    visited[i] = 1;
    const neighbors = hash.queryRadius(
      points[i * 3],
      points[i * 3 + 1],
      points[i * 3 + 2],
      radius * 2,
      points
    );
    let nearestVisited = -1;
    let nearestDist = Infinity;
    for (const j of neighbors) {
      if (!visited[j] || j === i) continue;
      const dx2 = points[i * 3] - points[j * 3];
      const dy2 = points[i * 3 + 1] - points[j * 3 + 1];
      const dz2 = points[i * 3 + 2] - points[j * 3 + 2];
      const d = dx2 * dx2 + dy2 * dy2 + dz2 * dz2;
      if (d < nearestDist) {
        nearestDist = d;
        nearestVisited = j;
      }
    }
    if (nearestVisited >= 0) {
      const dot2 = normals[i * 3] * normals[nearestVisited * 3] + normals[i * 3 + 1] * normals[nearestVisited * 3 + 1] + normals[i * 3 + 2] * normals[nearestVisited * 3 + 2];
      if (dot2 < 0) {
        normals[i * 3] = -normals[i * 3];
        normals[i * 3 + 1] = -normals[i * 3 + 1];
        normals[i * 3 + 2] = -normals[i * 3 + 2];
      }
    }
  }
  let cx = 0, cy = 0, cz = 0;
  for (let i = 0; i < count; i++) {
    cx += points[i * 3];
    cy += points[i * 3 + 1];
    cz += points[i * 3 + 2];
  }
  cx /= count;
  cy /= count;
  cz /= count;
  let farthestIdx = 0;
  let farthestDist = 0;
  for (let i = 0; i < count; i++) {
    const dx2 = points[i * 3] - cx;
    const dy2 = points[i * 3 + 1] - cy;
    const dz2 = points[i * 3 + 2] - cz;
    const d = dx2 * dx2 + dy2 * dy2 + dz2 * dz2;
    if (d > farthestDist) {
      farthestDist = d;
      farthestIdx = i;
    }
  }
  const dx = points[farthestIdx * 3] - cx;
  const dy = points[farthestIdx * 3 + 1] - cy;
  const dz = points[farthestIdx * 3 + 2] - cz;
  const dot = dx * normals[farthestIdx * 3] + dy * normals[farthestIdx * 3 + 1] + dz * normals[farthestIdx * 3 + 2];
  if (dot < 0) {
    for (let i = 0; i < count * 3; i++) {
      normals[i] = -normals[i];
    }
  }
}
function evaluateSDF(qx, qy, qz, neighbors, points, normals, h) {
  if (neighbors.length === 0) return 1;
  const h2inv = 1 / (2 * h * h);
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
  return sumW > 0 ? sumWD / sumW : 1;
}
const EDGE_TABLE = [
  0,
  265,
  515,
  778,
  1030,
  1295,
  1541,
  1804,
  2060,
  2309,
  2575,
  2822,
  3082,
  3331,
  3593,
  3840,
  400,
  153,
  915,
  666,
  1430,
  1183,
  1941,
  1692,
  2460,
  2197,
  2975,
  2710,
  3482,
  3219,
  3993,
  3728,
  560,
  825,
  51,
  314,
  1590,
  1855,
  1077,
  1340,
  2620,
  2869,
  2111,
  2358,
  3642,
  3891,
  3129,
  3376,
  928,
  681,
  419,
  170,
  1958,
  1711,
  1445,
  1196,
  2988,
  2725,
  2479,
  2214,
  4010,
  3747,
  3497,
  3232,
  1120,
  1385,
  1635,
  1898,
  102,
  367,
  613,
  876,
  3180,
  3429,
  3695,
  3942,
  2154,
  2403,
  2665,
  2912,
  1520,
  1273,
  2035,
  1786,
  502,
  255,
  1013,
  764,
  3580,
  3317,
  4095,
  3830,
  2554,
  2291,
  3065,
  2800,
  1616,
  1881,
  1107,
  1370,
  598,
  863,
  85,
  348,
  3676,
  3925,
  3167,
  3414,
  2650,
  2899,
  2137,
  2384,
  1984,
  1737,
  1475,
  1226,
  966,
  719,
  453,
  204,
  4044,
  3781,
  3535,
  3270,
  3018,
  2755,
  2505,
  2240,
  2240,
  2505,
  2755,
  3018,
  3270,
  3535,
  3781,
  4044,
  204,
  453,
  719,
  966,
  1226,
  1475,
  1737,
  1984,
  2384,
  2137,
  2899,
  2650,
  3414,
  3167,
  3925,
  3676,
  348,
  85,
  863,
  598,
  1370,
  1107,
  1881,
  1616,
  2800,
  3065,
  2291,
  2554,
  3830,
  4095,
  3317,
  3580,
  764,
  1013,
  255,
  502,
  1786,
  2035,
  1273,
  1520,
  2912,
  2665,
  2403,
  2154,
  3942,
  3695,
  3429,
  3180,
  876,
  613,
  367,
  102,
  1898,
  1635,
  1385,
  1120,
  3232,
  3497,
  3747,
  4010,
  2214,
  2479,
  2725,
  2988,
  1196,
  1445,
  1711,
  1958,
  170,
  419,
  681,
  928,
  3376,
  3129,
  3891,
  3642,
  2358,
  2111,
  2869,
  2620,
  1340,
  1077,
  1855,
  1590,
  314,
  51,
  825,
  560,
  3728,
  3993,
  3219,
  3482,
  2710,
  2975,
  2197,
  2460,
  1692,
  1941,
  1183,
  1430,
  666,
  915,
  153,
  400,
  3840,
  3593,
  3331,
  3082,
  2822,
  2575,
  2309,
  2060,
  1804,
  1541,
  1295,
  1030,
  778,
  515,
  265,
  0
];
const TRI_TABLE = [
  [],
  [0, 8, 3],
  [0, 1, 9],
  [1, 8, 3, 9, 8, 1],
  [1, 2, 10],
  [0, 8, 3, 1, 2, 10],
  [9, 2, 10, 0, 2, 9],
  [2, 8, 3, 2, 10, 8, 10, 9, 8],
  [3, 11, 2],
  [0, 11, 2, 8, 11, 0],
  [1, 9, 0, 2, 3, 11],
  [1, 11, 2, 1, 9, 11, 9, 8, 11],
  [3, 10, 1, 11, 10, 3],
  [0, 10, 1, 0, 8, 10, 8, 11, 10],
  [3, 9, 0, 3, 11, 9, 11, 10, 9],
  [9, 8, 10, 10, 8, 11],
  [4, 7, 8],
  [4, 3, 0, 7, 3, 4],
  [0, 1, 9, 8, 4, 7],
  [4, 1, 9, 4, 7, 1, 7, 3, 1],
  [1, 2, 10, 8, 4, 7],
  [3, 4, 7, 3, 0, 4, 1, 2, 10],
  [9, 2, 10, 9, 0, 2, 8, 4, 7],
  [2, 10, 9, 2, 9, 7, 2, 7, 3, 7, 9, 4],
  [8, 4, 7, 3, 11, 2],
  [11, 4, 7, 11, 2, 4, 2, 0, 4],
  [9, 0, 1, 8, 4, 7, 2, 3, 11],
  [4, 7, 11, 9, 4, 11, 9, 11, 2, 9, 2, 1],
  [3, 10, 1, 3, 11, 10, 7, 8, 4],
  [1, 11, 10, 1, 4, 11, 1, 0, 4, 7, 11, 4],
  [4, 7, 8, 9, 0, 11, 9, 11, 10, 11, 0, 3],
  [4, 7, 11, 4, 11, 9, 9, 11, 10],
  [9, 5, 4],
  [9, 5, 4, 0, 8, 3],
  [0, 5, 4, 1, 5, 0],
  [8, 5, 4, 8, 3, 5, 3, 1, 5],
  [1, 2, 10, 9, 5, 4],
  [3, 0, 8, 1, 2, 10, 4, 9, 5],
  [5, 2, 10, 5, 4, 2, 4, 0, 2],
  [2, 10, 5, 3, 2, 5, 3, 5, 4, 3, 4, 8],
  [9, 5, 4, 2, 3, 11],
  [0, 11, 2, 0, 8, 11, 4, 9, 5],
  [0, 5, 4, 0, 1, 5, 2, 3, 11],
  [2, 1, 5, 2, 5, 8, 2, 8, 11, 4, 8, 5],
  [10, 3, 11, 10, 1, 3, 9, 5, 4],
  [4, 9, 5, 0, 8, 1, 8, 10, 1, 8, 11, 10],
  [5, 4, 0, 5, 0, 11, 5, 11, 10, 11, 0, 3],
  [5, 4, 8, 5, 8, 10, 10, 8, 11],
  [9, 7, 8, 5, 7, 9],
  [9, 3, 0, 9, 5, 3, 5, 7, 3],
  [0, 7, 8, 0, 1, 7, 1, 5, 7],
  [1, 5, 3, 3, 5, 7],
  [9, 7, 8, 9, 5, 7, 10, 1, 2],
  [10, 1, 2, 9, 5, 0, 5, 3, 0, 5, 7, 3],
  [8, 0, 2, 8, 2, 5, 8, 5, 7, 10, 5, 2],
  [2, 10, 5, 2, 5, 3, 3, 5, 7],
  [7, 9, 5, 7, 8, 9, 3, 11, 2],
  [9, 5, 7, 9, 7, 2, 9, 2, 0, 2, 7, 11],
  [2, 3, 11, 0, 1, 8, 1, 7, 8, 1, 5, 7],
  [11, 2, 1, 11, 1, 7, 7, 1, 5],
  [9, 5, 8, 8, 5, 7, 10, 1, 3, 10, 3, 11],
  [5, 7, 0, 5, 0, 9, 7, 11, 0, 1, 0, 10, 11, 10, 0],
  [11, 10, 0, 11, 0, 3, 10, 5, 0, 8, 0, 7, 5, 7, 0],
  [11, 10, 5, 7, 11, 5],
  [10, 6, 5],
  [0, 8, 3, 5, 10, 6],
  [9, 0, 1, 5, 10, 6],
  [1, 8, 3, 1, 9, 8, 5, 10, 6],
  [1, 6, 5, 2, 6, 1],
  [1, 6, 5, 1, 2, 6, 3, 0, 8],
  [9, 6, 5, 9, 0, 6, 0, 2, 6],
  [5, 9, 8, 5, 8, 2, 5, 2, 6, 3, 2, 8],
  [2, 3, 11, 10, 6, 5],
  [11, 0, 8, 11, 2, 0, 10, 6, 5],
  [0, 1, 9, 2, 3, 11, 5, 10, 6],
  [5, 10, 6, 1, 9, 2, 9, 11, 2, 9, 8, 11],
  [6, 3, 11, 6, 5, 3, 5, 1, 3],
  [0, 8, 11, 0, 11, 5, 0, 5, 1, 5, 11, 6],
  [3, 11, 6, 0, 3, 6, 0, 6, 5, 0, 5, 9],
  [6, 5, 9, 6, 9, 11, 11, 9, 8],
  [5, 10, 6, 4, 7, 8],
  [4, 3, 0, 4, 7, 3, 6, 5, 10],
  [1, 9, 0, 5, 10, 6, 8, 4, 7],
  [10, 6, 5, 1, 9, 7, 1, 7, 3, 7, 9, 4],
  [6, 1, 2, 6, 5, 1, 4, 7, 8],
  [1, 2, 5, 5, 2, 6, 3, 0, 4, 3, 4, 7],
  [8, 4, 7, 9, 0, 5, 0, 6, 5, 0, 2, 6],
  [7, 3, 9, 7, 9, 4, 3, 2, 9, 5, 9, 6, 2, 6, 9],
  [3, 11, 2, 7, 8, 4, 10, 6, 5],
  [5, 10, 6, 4, 7, 2, 4, 2, 0, 2, 7, 11],
  [0, 1, 9, 4, 7, 8, 2, 3, 11, 5, 10, 6],
  [9, 2, 1, 9, 11, 2, 9, 4, 11, 7, 11, 4, 5, 10, 6],
  [8, 4, 7, 3, 11, 5, 3, 5, 1, 5, 11, 6],
  [5, 1, 11, 5, 11, 6, 1, 0, 11, 7, 11, 4, 0, 4, 11],
  [0, 5, 9, 0, 6, 5, 0, 3, 6, 11, 6, 3, 8, 4, 7],
  [6, 5, 9, 6, 9, 11, 4, 7, 9, 7, 11, 9],
  [10, 4, 9, 6, 4, 10],
  [4, 10, 6, 4, 9, 10, 0, 8, 3],
  [10, 0, 1, 10, 6, 0, 6, 4, 0],
  [8, 3, 1, 8, 1, 6, 8, 6, 4, 6, 1, 10],
  [1, 4, 9, 1, 2, 4, 2, 6, 4],
  [3, 0, 8, 1, 2, 9, 2, 4, 9, 2, 6, 4],
  [0, 2, 4, 4, 2, 6],
  [8, 3, 2, 8, 2, 4, 4, 2, 6],
  [10, 4, 9, 10, 6, 4, 11, 2, 3],
  [0, 8, 2, 2, 8, 11, 4, 9, 10, 4, 10, 6],
  [3, 11, 2, 0, 1, 6, 0, 6, 4, 6, 1, 10],
  [6, 4, 1, 6, 1, 10, 4, 8, 1, 2, 1, 11, 8, 11, 1],
  [9, 6, 4, 9, 3, 6, 9, 1, 3, 11, 6, 3],
  [8, 11, 1, 8, 1, 0, 11, 6, 1, 9, 1, 4, 6, 4, 1],
  [3, 11, 6, 3, 6, 0, 0, 6, 4],
  [6, 4, 8, 11, 6, 8],
  [7, 10, 6, 7, 8, 10, 8, 9, 10],
  [0, 7, 3, 0, 10, 7, 0, 9, 10, 6, 7, 10],
  [10, 6, 7, 1, 10, 7, 1, 7, 8, 1, 8, 0],
  [10, 6, 7, 10, 7, 1, 1, 7, 3],
  [1, 2, 6, 1, 6, 8, 1, 8, 9, 8, 6, 7],
  [2, 6, 9, 2, 9, 1, 6, 7, 9, 0, 9, 3, 7, 3, 9],
  [7, 8, 0, 7, 0, 6, 6, 0, 2],
  [7, 3, 2, 6, 7, 2],
  [2, 3, 11, 10, 6, 8, 10, 8, 9, 8, 6, 7],
  [2, 0, 7, 2, 7, 11, 0, 9, 7, 6, 7, 10, 9, 10, 7],
  [1, 8, 0, 1, 7, 8, 1, 10, 7, 6, 7, 10, 2, 3, 11],
  [11, 2, 1, 11, 1, 7, 10, 6, 1, 6, 7, 1],
  [8, 9, 6, 8, 6, 7, 9, 1, 6, 11, 6, 3, 1, 3, 6],
  [0, 9, 1, 11, 6, 7],
  [7, 8, 0, 7, 0, 6, 3, 11, 0, 11, 6, 0],
  [7, 11, 6],
  [7, 6, 11],
  [3, 0, 8, 11, 7, 6],
  [0, 1, 9, 11, 7, 6],
  [8, 1, 9, 8, 3, 1, 11, 7, 6],
  [10, 1, 2, 6, 11, 7],
  [1, 2, 10, 3, 0, 8, 6, 11, 7],
  [2, 9, 0, 2, 10, 9, 6, 11, 7],
  [6, 11, 7, 2, 10, 3, 10, 8, 3, 10, 9, 8],
  [7, 2, 3, 6, 2, 7],
  [7, 0, 8, 7, 6, 0, 6, 2, 0],
  [2, 7, 6, 2, 3, 7, 0, 1, 9],
  [1, 6, 2, 1, 8, 6, 1, 9, 8, 8, 7, 6],
  [10, 7, 6, 10, 1, 7, 1, 3, 7],
  [10, 7, 6, 1, 7, 10, 1, 8, 7, 1, 0, 8],
  [0, 3, 7, 0, 7, 10, 0, 10, 9, 6, 10, 7],
  [7, 6, 10, 7, 10, 8, 8, 10, 9],
  [6, 8, 4, 11, 8, 6],
  [3, 6, 11, 3, 0, 6, 0, 4, 6],
  [8, 6, 11, 8, 4, 6, 9, 0, 1],
  [9, 4, 6, 9, 6, 3, 9, 3, 1, 11, 3, 6],
  [6, 8, 4, 6, 11, 8, 2, 10, 1],
  [1, 2, 10, 3, 0, 11, 0, 6, 11, 0, 4, 6],
  [4, 11, 8, 4, 6, 11, 0, 2, 9, 2, 10, 9],
  [10, 9, 3, 10, 3, 2, 9, 4, 3, 11, 3, 6, 4, 6, 3],
  [8, 2, 3, 8, 4, 2, 4, 6, 2],
  [0, 4, 2, 4, 6, 2],
  [1, 9, 0, 2, 3, 4, 2, 4, 6, 4, 3, 8],
  [1, 9, 4, 1, 4, 2, 2, 4, 6],
  [8, 1, 3, 8, 6, 1, 8, 4, 6, 6, 10, 1],
  [10, 1, 0, 10, 0, 6, 6, 0, 4],
  [4, 6, 3, 4, 3, 8, 6, 10, 3, 0, 3, 9, 10, 9, 3],
  [10, 9, 4, 6, 10, 4],
  [4, 9, 5, 7, 6, 11],
  [0, 8, 3, 4, 9, 5, 11, 7, 6],
  [5, 0, 1, 5, 4, 0, 7, 6, 11],
  [11, 7, 6, 8, 3, 4, 3, 5, 4, 3, 1, 5],
  [9, 5, 4, 10, 1, 2, 7, 6, 11],
  [6, 11, 7, 1, 2, 10, 0, 8, 3, 4, 9, 5],
  [7, 6, 11, 5, 4, 10, 4, 2, 10, 4, 0, 2],
  [3, 4, 8, 3, 5, 4, 3, 2, 5, 10, 5, 2, 11, 7, 6],
  [7, 2, 3, 7, 6, 2, 5, 4, 9],
  [9, 5, 4, 0, 8, 6, 0, 6, 2, 6, 8, 7],
  [3, 6, 2, 3, 7, 6, 1, 5, 0, 5, 4, 0],
  [6, 2, 8, 6, 8, 7, 2, 1, 8, 4, 8, 5, 1, 5, 8],
  [9, 5, 4, 10, 1, 6, 1, 7, 6, 1, 3, 7],
  [1, 6, 10, 1, 7, 6, 1, 0, 7, 8, 7, 0, 9, 5, 4],
  [4, 0, 10, 4, 10, 5, 0, 3, 10, 6, 10, 7, 3, 7, 10],
  [7, 6, 10, 7, 10, 8, 5, 4, 10, 4, 8, 10],
  [6, 9, 5, 6, 11, 9, 11, 8, 9],
  [3, 6, 11, 0, 6, 3, 0, 5, 6, 0, 9, 5],
  [0, 11, 8, 0, 5, 11, 0, 1, 5, 5, 6, 11],
  [6, 11, 3, 6, 3, 5, 5, 3, 1],
  [1, 2, 10, 9, 5, 11, 9, 11, 8, 11, 5, 6],
  [0, 11, 3, 0, 6, 11, 0, 9, 6, 5, 6, 9, 1, 2, 10],
  [11, 8, 5, 11, 5, 6, 8, 0, 5, 10, 5, 2, 0, 2, 5],
  [6, 11, 3, 6, 3, 5, 2, 10, 3, 10, 5, 3],
  [5, 8, 9, 5, 2, 8, 5, 6, 2, 3, 8, 2],
  [9, 5, 6, 9, 6, 0, 0, 6, 2],
  [1, 5, 8, 1, 8, 0, 5, 6, 8, 3, 8, 2, 6, 2, 8],
  [1, 5, 6, 2, 1, 6],
  [1, 3, 6, 1, 6, 10, 3, 8, 6, 5, 6, 9, 8, 9, 6],
  [10, 1, 0, 10, 0, 6, 9, 5, 0, 5, 6, 0],
  [0, 3, 8, 5, 6, 10],
  [10, 5, 6],
  [11, 5, 10, 7, 5, 11],
  [11, 5, 10, 11, 7, 5, 8, 3, 0],
  [5, 11, 7, 5, 10, 11, 1, 9, 0],
  [10, 7, 5, 10, 11, 7, 9, 8, 1, 8, 3, 1],
  [11, 1, 2, 11, 7, 1, 7, 5, 1],
  [0, 8, 3, 1, 2, 7, 1, 7, 5, 7, 2, 11],
  [9, 7, 5, 9, 2, 7, 9, 0, 2, 2, 11, 7],
  [7, 5, 2, 7, 2, 11, 5, 9, 2, 3, 2, 8, 9, 8, 2],
  [2, 5, 10, 2, 3, 5, 3, 7, 5],
  [8, 2, 0, 8, 5, 2, 8, 7, 5, 10, 2, 5],
  [9, 0, 1, 5, 10, 3, 5, 3, 7, 3, 10, 2],
  [9, 8, 2, 9, 2, 1, 8, 7, 2, 10, 2, 5, 7, 5, 2],
  [1, 3, 5, 3, 7, 5],
  [0, 8, 7, 0, 7, 1, 1, 7, 5],
  [9, 0, 3, 9, 3, 5, 5, 3, 7],
  [9, 8, 7, 5, 9, 7],
  [5, 8, 4, 5, 10, 8, 10, 11, 8],
  [5, 0, 4, 5, 11, 0, 5, 10, 11, 11, 3, 0],
  [0, 1, 9, 8, 4, 10, 8, 10, 11, 10, 4, 5],
  [10, 11, 4, 10, 4, 5, 11, 3, 4, 9, 4, 1, 3, 1, 4],
  [2, 5, 1, 2, 8, 5, 2, 11, 8, 4, 5, 8],
  [0, 4, 11, 0, 11, 3, 4, 5, 11, 2, 11, 1, 5, 1, 11],
  [0, 2, 5, 0, 5, 9, 2, 11, 5, 4, 5, 8, 11, 8, 5],
  [9, 4, 5, 2, 11, 3],
  [2, 5, 10, 3, 5, 2, 3, 4, 5, 3, 8, 4],
  [5, 10, 2, 5, 2, 4, 4, 2, 0],
  [3, 10, 2, 3, 5, 10, 3, 8, 5, 4, 5, 8, 0, 1, 9],
  [5, 10, 2, 5, 2, 4, 1, 9, 2, 9, 4, 2],
  [8, 4, 5, 8, 5, 3, 3, 5, 1],
  [0, 4, 5, 1, 0, 5],
  [8, 4, 5, 8, 5, 3, 9, 0, 5, 0, 3, 5],
  [9, 4, 5],
  [4, 11, 7, 4, 9, 11, 9, 10, 11],
  [0, 8, 3, 4, 9, 7, 9, 11, 7, 9, 10, 11],
  [1, 10, 11, 1, 11, 4, 1, 4, 0, 7, 4, 11],
  [3, 1, 4, 3, 4, 8, 1, 10, 4, 7, 4, 11, 10, 11, 4],
  [4, 11, 7, 9, 11, 4, 9, 2, 11, 9, 1, 2],
  [9, 7, 4, 9, 11, 7, 9, 1, 11, 2, 11, 1, 0, 8, 3],
  [11, 7, 4, 11, 4, 2, 2, 4, 0],
  [11, 7, 4, 11, 4, 2, 8, 3, 4, 3, 2, 4],
  [2, 9, 10, 2, 7, 9, 2, 3, 7, 7, 4, 9],
  [9, 10, 7, 9, 7, 4, 10, 2, 7, 0, 7, 8, 2, 8, 7],
  [3, 7, 10, 3, 10, 2, 7, 4, 10, 1, 10, 0, 4, 0, 10],
  [1, 10, 2, 8, 7, 4],
  [4, 9, 1, 4, 1, 7, 7, 1, 3],
  [4, 9, 1, 4, 1, 7, 0, 8, 1, 8, 7, 1],
  [4, 0, 3, 7, 4, 3],
  [4, 8, 7],
  [9, 10, 8, 10, 11, 8],
  [3, 0, 9, 3, 9, 11, 11, 9, 10],
  [0, 1, 10, 0, 10, 8, 8, 10, 11],
  [3, 1, 10, 11, 3, 10],
  [1, 2, 11, 1, 11, 9, 9, 11, 8],
  [3, 0, 9, 3, 9, 11, 1, 2, 9, 2, 11, 9],
  [0, 2, 11, 8, 0, 11],
  [3, 2, 11],
  [2, 3, 8, 2, 8, 10, 10, 8, 9],
  [9, 10, 2, 0, 9, 2],
  [2, 3, 8, 2, 8, 10, 0, 1, 8, 1, 10, 8],
  [1, 10, 2],
  [1, 3, 8, 9, 1, 8],
  [0, 9, 1],
  [0, 3, 8],
  []
];
const EDGE_CORNERS = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 0],
  [4, 5],
  [5, 6],
  [6, 7],
  [7, 4],
  [0, 4],
  [1, 5],
  [2, 6],
  [3, 7]
];
const CORNER_OFFSETS = [
  [0, 0, 0],
  [1, 0, 0],
  [1, 1, 0],
  [0, 1, 0],
  [0, 0, 1],
  [1, 0, 1],
  [1, 1, 1],
  [0, 1, 1]
];
function marchingCubesOnSDF(sdfGet, nx, ny, nz, ox, oy, oz, resolution, onProgress) {
  const edgeVertexMap = /* @__PURE__ */ new Map();
  const positionsList = [];
  let vertexCount = 0;
  function sdfAt(x, y, z) {
    if (x < 0 || x >= nx || y < 0 || y >= ny || z < 0 || z >= nz) return 1;
    return sdfGet((z * ny + y) * nx + x);
  }
  function edgeKey(x0, y0, z0, x1, y1, z1) {
    const ax = Math.min(x0, x1), ay = Math.min(y0, y1), az = Math.min(z0, z1);
    const axis = x0 !== x1 ? 0 : y0 !== y1 ? 1 : 2;
    return ((az * ny + ay) * nx + ax) * 3 + axis;
  }
  function getEdgeVertex(x0, y0, z0, v0, x1, y1, z1, v1) {
    const key = edgeKey(x0, y0, z0, x1, y1, z1);
    const existing = edgeVertexMap.get(key);
    if (existing !== void 0) return existing;
    let t = 0.5;
    if (Math.abs(v1 - v0) > 1e-10) {
      t = -v0 / (v1 - v0);
      t = Math.max(0, Math.min(1, t));
    }
    positionsList.push(
      ox + (x0 + t * (x1 - x0)) * resolution,
      oy + (y0 + t * (y1 - y0)) * resolution,
      oz + (z0 + t * (z1 - z0)) * resolution
    );
    const idx = vertexCount++;
    edgeVertexMap.set(key, idx);
    return idx;
  }
  const indices = [];
  for (let z = 0; z < nz - 1; z++) {
    if (onProgress && z % 20 === 0) {
      onProgress(z, nz - 1, `Marching cubes\u2026 ${Math.round(z / (nz - 1) * 100)}%`);
    }
    for (let y = 0; y < ny - 1; y++) {
      for (let x = 0; x < nx - 1; x++) {
        const v = [];
        for (let c = 0; c < 8; c++) {
          const [cdx, cdy, cdz] = CORNER_OFFSETS[c];
          v.push(sdfAt(x + cdx, y + cdy, z + cdz));
        }
        let caseIdx = 0;
        for (let c = 0; c < 8; c++) {
          if (v[c] < 0) caseIdx |= 1 << c;
        }
        if (caseIdx === 0 || caseIdx === 255) continue;
        const edgeMask = EDGE_TABLE[caseIdx];
        if (edgeMask === 0) continue;
        const edgeVerts = new Array(12).fill(-1);
        for (let e = 0; e < 12; e++) {
          if (!(edgeMask & 1 << e)) continue;
          const [c0, c1] = EDGE_CORNERS[e];
          const [dx0, dy0, dz0] = CORNER_OFFSETS[c0];
          const [dx1, dy1, dz1] = CORNER_OFFSETS[c1];
          edgeVerts[e] = getEdgeVertex(
            x + dx0,
            y + dy0,
            z + dz0,
            v[c0],
            x + dx1,
            y + dy1,
            z + dz1,
            v[c1]
          );
        }
        const triList = TRI_TABLE[caseIdx];
        for (let i = 0; i < triList.length; i += 3) {
          indices.push(edgeVerts[triList[i]], edgeVerts[triList[i + 1]], edgeVerts[triList[i + 2]]);
        }
      }
    }
  }
  const triCount = Math.floor(indices.length / 3);
  const positions = new Float32Array(positionsList);
  const rawIndices = new Uint32Array(indices);
  const cleanedIndices = fixMCNonManifoldEdges(positions, rawIndices, vertexCount);
  return {
    positions,
    indices: cleanedIndices,
    triCount: Math.floor(cleanedIndices.length / 3),
    vertexCount
  };
}
function fixMCNonManifoldEdges(positions, indices, vertexCount) {
  const triCount = Math.floor(indices.length / 3);
  if (triCount === 0) return indices;
  const edgeTris = /* @__PURE__ */ new Map();
  for (let t = 0; t < triCount; t++) {
    const a = indices[t * 3], b = indices[t * 3 + 1], c = indices[t * 3 + 2];
    for (const [u, v] of [[a, b], [b, c], [c, a]]) {
      const lo = Math.min(u, v), hi = Math.max(u, v);
      const key = lo * vertexCount + hi;
      const arr = edgeTris.get(key);
      if (arr) arr.push(t);
      else edgeTris.set(key, [t]);
    }
  }
  const removedTris = /* @__PURE__ */ new Set();
  for (const [, tris] of edgeTris) {
    if (tris.length <= 2) continue;
    const triAreas = [];
    for (const t of tris) {
      if (removedTris.has(t)) continue;
      const i0 = indices[t * 3], i1 = indices[t * 3 + 1], i2 = indices[t * 3 + 2];
      const ax = positions[i1 * 3] - positions[i0 * 3];
      const ay = positions[i1 * 3 + 1] - positions[i0 * 3 + 1];
      const az = positions[i1 * 3 + 2] - positions[i0 * 3 + 2];
      const bx = positions[i2 * 3] - positions[i0 * 3];
      const by = positions[i2 * 3 + 1] - positions[i0 * 3 + 1];
      const bz = positions[i2 * 3 + 2] - positions[i0 * 3 + 2];
      const cx = ay * bz - az * by, cy = az * bx - ax * bz, cz = ax * by - ay * bx;
      const area = Math.sqrt(cx * cx + cy * cy + cz * cz);
      triAreas.push({ tri: t, area });
    }
    triAreas.sort((a, b) => a.area - b.area);
    while (triAreas.length > 2) {
      removedTris.add(triAreas.shift().tri);
    }
  }
  if (removedTris.size === 0) return indices;
  const newIndices = [];
  for (let t = 0; t < triCount; t++) {
    if (!removedTris.has(t)) {
      newIndices.push(indices[t * 3], indices[t * 3 + 1], indices[t * 3 + 2]);
    }
  }
  return new Uint32Array(newIndices);
}
const MAX_GRID_CELLS = 5e7;
function autoResolution(bbox) {
  const maxDim = Math.max(bbox.x, bbox.y, bbox.z, 1);
  const res = maxDim / 400;
  const paddedVol = bbox.x * 1.5 * (bbox.y * 1.5) * (bbox.z * 1.5);
  const floor = Math.max(
    maxDim / 500,
    Math.cbrt(paddedVol / MAX_GRID_CELLS),
    0.5
  );
  return Math.max(res, floor);
}
async function pointCloudReconstruct(geo, onProgress, params) {
  const g = geo.index ? geo.toNonIndexed() : geo.clone();
  g.computeBoundingBox();
  const bb = g.boundingBox;
  const bbSize = new THREE.Vector3();
  bb.getSize(bbSize);
  const resolution = params?.resolution ?? autoResolution({ x: bbSize.x, y: bbSize.y, z: bbSize.z });
  const radiusMult = params?.radiusMultiplier ?? 2;
  const smoothingRadius = resolution * radiusMult;
  const sdfSharpness = Math.max(0, Math.min(1, params?.sdfSharpness ?? 0.5));
  const gapBridgingFactor = Math.max(1, Math.min(3, params?.gapBridgingFactor ?? 1));
  const gridPadding = Math.max(1, Math.min(10, params?.gridPadding ?? 3));
  const normalSampleDensity = Math.max(1e-4, Math.min(0.1, params?.normalSampleDensity ?? 1e-3));
  const vertexMergePrecision = Math.max(1e-4, Math.min(1, params?.vertexMergePrecision ?? 1e-3));
  const outsideBias = Math.max(0.01, Math.min(2, params?.outsideBias ?? 1));
  onProgress(0, 6, "Extracting point cloud\u2026");
  await yieldToUI();
  const pc = extractPointCloud(g, vertexMergePrecision);
  if (pc.count === 0) {
    throw new Error("No valid triangles found in mesh");
  }
  onProgress(1, 6, `Building spatial index (${pc.count.toLocaleString()} points)\u2026`);
  await yieldToUI();
  const hash = new SpatialHash(smoothingRadius);
  for (let i = 0; i < pc.count; i++) {
    hash.insert(i, pc.points[i * 3], pc.points[i * 3 + 1], pc.points[i * 3 + 2]);
  }
  onProgress(2, 6, "Orienting normals\u2026");
  await yieldToUI();
  orientNormals(pc.points, pc.normals, pc.count, hash, smoothingRadius, normalSampleDensity);
  onProgress(3, 6, "Evaluating signed distance field\u2026");
  await yieldToUI();
  let useRes = resolution;
  let pad = useRes * gridPadding;
  let ox = bb.min.x - pad, oy = bb.min.y - pad, oz = bb.min.z - pad;
  let nx = Math.ceil((bbSize.x + 2 * pad) / useRes) + 1;
  let ny = Math.ceil((bbSize.y + 2 * pad) / useRes) + 1;
  let nz = Math.ceil((bbSize.z + 2 * pad) / useRes) + 1;
  let totalCells = nx * ny * nz;
  while (totalCells > MAX_GRID_CELLS) {
    useRes *= 1.25;
    pad = useRes * gridPadding;
    ox = bb.min.x - pad;
    oy = bb.min.y - pad;
    oz = bb.min.z - pad;
    nx = Math.ceil((bbSize.x + 2 * pad) / useRes) + 1;
    ny = Math.ceil((bbSize.y + 2 * pad) / useRes) + 1;
    nz = Math.ceil((bbSize.z + 2 * pad) / useRes) + 1;
    totalCells = nx * ny * nz;
  }
  if (useRes !== resolution) {
    onProgress(3, 6, `Grid too large at ${resolution.toFixed(1)} mm \u2014 auto-coarsened to ${useRes.toFixed(1)} mm (${totalCells.toLocaleString()} cells)`);
    await yieldToUI();
  }
  const dims = [nx, ny, nz];
  const sdf = /* @__PURE__ */ new Map();
  const sdfGet = (idx) => sdf.get(idx) ?? outsideBias;
  const actualSmoothingRadius = useRes * radiusMult;
  const baseEvalRadius = Math.ceil(actualSmoothingRadius / useRes) + 1;
  const evalRadius = Math.min(5, Math.ceil(baseEvalRadius * gapBridgingFactor));
  const h = actualSmoothingRadius * (1 - sdfSharpness * 0.7);
  let lastYieldAt = Date.now();
  let evaluatedCount = 0;
  const sdfStartTime = Date.now();
  const SDF_TIMEOUT_MS = 6e4;
  for (let pi = 0; pi < pc.count; pi++) {
    const px = pc.points[pi * 3], py = pc.points[pi * 3 + 1], pz = pc.points[pi * 3 + 2];
    const gx = Math.round((px - ox) / useRes);
    const gy = Math.round((py - oy) / useRes);
    const gz = Math.round((pz - oz) / useRes);
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
          const qx = ox + ix * useRes;
          const qy = oy + iy * useRes;
          const qz = oz + iz * useRes;
          const neighbors = hash.queryRadius(qx, qy, qz, actualSmoothingRadius, pc.points);
          sdf.set(cellIdx, evaluateSDF(qx, qy, qz, neighbors, pc.points, pc.normals, h));
        }
      }
    }
    if (pi % 2e3 === 0 && Date.now() - lastYieldAt > 50) {
      if (Date.now() - sdfStartTime > SDF_TIMEOUT_MS) {
        onProgress(3, 6, `SDF timed out after 60s \u2014 using ${evaluatedCount.toLocaleString()} evaluated cells`);
        await yieldToUI();
        break;
      }
      const pct = Math.round(pi / pc.count * 100);
      onProgress(3, 6, `Evaluating SDF\u2026 ${pct}% (${evaluatedCount.toLocaleString()} cells)`);
      await yieldToUI();
      lastYieldAt = Date.now();
    }
  }
  const sparsePct = totalCells > 0 ? Math.round(evaluatedCount / totalCells * 100) : 0;
  onProgress(4, 6, `SDF complete: ${evaluatedCount.toLocaleString()} / ${totalCells.toLocaleString()} cells evaluated (${sparsePct}% sparse)`);
  await yieldToUI();
  onProgress(5, 6, "Running marching cubes\u2026");
  await yieldToUI();
  const mc = marchingCubesOnSDF(sdfGet, nx, ny, nz, ox, oy, oz, useRes, onProgress);
  onProgress(6, 6, "Finalizing geometry\u2026");
  await yieldToUI();
  let outGeo = new THREE.BufferGeometry();
  outGeo.setAttribute("position", new THREE.BufferAttribute(mc.positions, 3));
  outGeo.setIndex(new THREE.BufferAttribute(mc.indices, 1));
  const { toCreasedNormals, mergeVertices } = await import("three/examples/jsm/utils/BufferGeometryUtils.js");
  const CREASE_ANGLE = Math.PI / 6;
  outGeo = mergeVertices(toCreasedNormals(outGeo, CREASE_ANGLE));
  g.dispose();
  return {
    geometry: outGeo,
    resolution: useRes,
    gridDims: dims,
    outputTriangles: mc.triCount
  };
}
export {
  pointCloudReconstruct
};
