# Code Review: poisson-reconstruct.ts — Critical Bugs

## Bug 1: INCONSISTENT NORMALS (Root cause of broken output)

The SDF is computed as:
```
d(Q) = Σ w_i * dot(Q - P_i, N_i) / Σ w_i
```

This ONLY works if all normals N_i point consistently outward.

On the monocoque with 34K open edges and 7.9K non-manifold edges,
face winding is random → normals point in random directions.
Two adjacent points might have normals pointing opposite ways.
The SDF sees: "positive here, negative 2mm away, positive again"
→ marching cubes creates a surface at every sign change
→ hundreds of thousands of tiny random surfaces = chaos.

### Fix: Add a normal consensus/propagation step after extraction

Before building the spatial hash, orient all normals consistently
using a voting scheme:

```typescript
function orientNormals(
  points: Float64Array,
  normals: Float64Array,
  count: number,
  hash: SpatialHash,
  radius: number
): void {
  // Pass 1: Build a spanning tree via BFS from the point with
  // the most confident normal (highest agreement with neighbors).
  // At each step, flip the neighbor's normal if it disagrees with
  // the current point's normal.

  const visited = new Uint8Array(count);
  const queue: number[] = [];

  // Seed: find the point whose normal has highest agreement
  // with its neighbors (most neighbors have similar normals)
  let bestSeed = 0;
  let bestScore = -1;

  // Sample a subset for seed selection (checking all is O(n²))
  const sampleStep = Math.max(1, Math.floor(count / 1000));
  for (let i = 0; i < count; i += sampleStep) {
    const neighbors = hash.queryRadius(
      points[i*3], points[i*3+1], points[i*3+2],
      radius, points
    );
    let agree = 0;
    for (const j of neighbors) {
      const dot = normals[i*3]*normals[j*3] +
                  normals[i*3+1]*normals[j*3+1] +
                  normals[i*3+2]*normals[j*3+2];
      if (dot > 0) agree++;
    }
    if (agree > bestScore) {
      bestScore = agree;
      bestSeed = i;
    }
  }

  // BFS from seed, propagating orientation
  queue.push(bestSeed);
  visited[bestSeed] = 1;

  while (queue.length > 0) {
    const idx = queue.shift()!;

    const neighbors = hash.queryRadius(
      points[idx*3], points[idx*3+1], points[idx*3+2],
      radius, points
    );

    for (const j of neighbors) {
      if (visited[j]) continue;
      visited[j] = 1;

      // Check if neighbor's normal agrees with current point's normal
      const dot = normals[idx*3]*normals[j*3] +
                  normals[idx*3+1]*normals[j*3+1] +
                  normals[idx*3+2]*normals[j*3+2];

      if (dot < 0) {
        // Flip neighbor's normal
        normals[j*3]   = -normals[j*3];
        normals[j*3+1] = -normals[j*3+1];
        normals[j*3+2] = -normals[j*3+2];
      }

      queue.push(j);
    }
  }

  // Handle disconnected regions: any unvisited points get oriented
  // by their nearest visited neighbor
  for (let i = 0; i < count; i++) {
    if (visited[i]) continue;
    visited[i] = 1;

    const neighbors = hash.queryRadius(
      points[i*3], points[i*3+1], points[i*3+2],
      radius * 2, points  // wider search for disconnected regions
    );

    // Find nearest visited neighbor
    let nearestVisited = -1;
    let nearestDist = Infinity;
    for (const j of neighbors) {
      if (!visited[j] && j !== i) continue;
      const dx = points[i*3] - points[j*3];
      const dy = points[i*3+1] - points[j*3+1];
      const dz = points[i*3+2] - points[j*3+2];
      const d = dx*dx + dy*dy + dz*dz;
      if (d < nearestDist) { nearestDist = d; nearestVisited = j; }
    }

    if (nearestVisited >= 0) {
      const dot = normals[i*3]*normals[nearestVisited*3] +
                  normals[i*3+1]*normals[nearestVisited*3+1] +
                  normals[i*3+2]*normals[nearestVisited*3+2];
      if (dot < 0) {
        normals[i*3]   = -normals[i*3];
        normals[i*3+1] = -normals[i*3+1];
        normals[i*3+2] = -normals[i*3+2];
      }
    }
  }

  // Pass 2: Global orientation — ensure normals point OUTWARD.
  // Heuristic: find the point furthest from the centroid.
  // Its normal should point away from the centroid.
  let cx = 0, cy = 0, cz = 0;
  for (let i = 0; i < count; i++) {
    cx += points[i*3]; cy += points[i*3+1]; cz += points[i*3+2];
  }
  cx /= count; cy /= count; cz /= count;

  let farthestIdx = 0;
  let farthestDist = 0;
  for (let i = 0; i < count; i++) {
    const dx = points[i*3] - cx;
    const dy = points[i*3+1] - cy;
    const dz = points[i*3+2] - cz;
    const d = dx*dx + dy*dy + dz*dz;
    if (d > farthestDist) { farthestDist = d; farthestIdx = i; }
  }

  // The farthest point's normal should point AWAY from centroid
  const dx = points[farthestIdx*3] - cx;
  const dy = points[farthestIdx*3+1] - cy;
  const dz = points[farthestIdx*3+2] - cz;
  const dot = dx * normals[farthestIdx*3] +
              dy * normals[farthestIdx*3+1] +
              dz * normals[farthestIdx*3+2];

  if (dot < 0) {
    // All normals are pointing inward — flip ALL of them
    for (let i = 0; i < count * 3; i++) {
      normals[i] = -normals[i];
    }
  }
}
```

### Where to insert this in the pipeline:

```typescript
// After building the spatial hash (Step 2), BEFORE evaluating SDF (Step 3):

onProgress(2, 6, "Orienting normals…");
await yieldToUI();
orientNormals(pc.points, pc.normals, pc.count, hash, smoothingRadius);
```

---

## Bug 2: ONLY SAMPLING CENTROIDS

`extractPointCloud` only takes triangle centroids. This undersamples
large triangles and creates gaps in the point cloud where the SDF
has no data → defaults to +1 (outside) → holes in reconstruction.

### Fix: Sample centroids AND vertices, deduplicated

```typescript
function extractPointCloud(geo: THREE.BufferGeometry): PointCloud {
  const pos = geo.attributes.position.array as Float32Array;
  const triCount = Math.floor(pos.length / 9);
  
  // Sample centroids + all 3 vertices per triangle
  // Vertices get the face normal of their triangle
  // (Vertices shared by multiple triangles get whichever normal comes last,
  //  which is fine because orientNormals will fix consistency)
  const maxPts = triCount * 4; // centroid + 3 vertices per face
  const points = new Float64Array(maxPts * 3);
  const normals = new Float64Array(maxPts * 3);
  let count = 0;
  
  // Vertex dedup via position hash
  const vertexMap = new Map<string, number>();

  for (let f = 0; f < triCount; f++) {
    const b = f * 9;
    const p0x = pos[b], p0y = pos[b+1], p0z = pos[b+2];
    const p1x = pos[b+3], p1y = pos[b+4], p1z = pos[b+5];
    const p2x = pos[b+6], p2y = pos[b+7], p2z = pos[b+8];

    const ex = p1x-p0x, ey = p1y-p0y, ez = p1z-p0z;
    const fx = p2x-p0x, fy = p2y-p0y, fz = p2z-p0z;
    let nx = ey*fz - ez*fy;
    let ny = ez*fx - ex*fz;
    let nz = ex*fy - ey*fx;
    const len = Math.sqrt(nx*nx + ny*ny + nz*nz);
    if (len < 1e-10) continue;
    nx /= len; ny /= len; nz /= len;

    // Add centroid (always unique)
    const cx = (p0x + p1x + p2x) / 3;
    const cy = (p0y + p1y + p2y) / 3;
    const cz = (p0z + p1z + p2z) / 3;
    let idx = count * 3;
    points[idx] = cx; points[idx+1] = cy; points[idx+2] = cz;
    normals[idx] = nx; normals[idx+1] = ny; normals[idx+2] = nz;
    count++;

    // Add vertices (deduplicated)
    for (const [vx, vy, vz] of [[p0x,p0y,p0z], [p1x,p1y,p1z], [p2x,p2y,p2z]]) {
      // Quantize to avoid floating point key issues
      const key = `${(vx*1000)|0},${(vy*1000)|0},${(vz*1000)|0}`;
      if (vertexMap.has(key)) {
        // Update normal of existing vertex (last-write-wins, fine for now)
        const existingIdx = vertexMap.get(key)! * 3;
        normals[existingIdx] = nx;
        normals[existingIdx+1] = ny;
        normals[existingIdx+2] = nz;
        continue;
      }
      vertexMap.set(key, count);
      idx = count * 3;
      points[idx] = vx; points[idx+1] = vy; points[idx+2] = vz;
      normals[idx] = nx; normals[idx+1] = ny; normals[idx+2] = nz;
      count++;
    }
  }

  return {
    points: points.subarray(0, count * 3),
    normals: normals.subarray(0, count * 3),
    count,
  };
}
```

---

## Bug 3: MEMORY BLOWUP ON EVALUATED ARRAY

```typescript
const evaluated = new Uint8Array(totalCells); // up to 200M bytes!
```

For a 200M cell grid, this is 200MB just for the flags. Combined with
the Float32 SDF (800MB), total is 1GB. Browser will OOM or slow to crawl.

### Fix: Use a Set instead of a flat array, or use a BitArray

```typescript
// Option A: BitArray (same as voxel-reconstruct)
class BitArray {
  private data: Uint32Array;
  constructor(size: number) {
    this.data = new Uint32Array(Math.ceil(size / 32));
  }
  get(i: number): boolean {
    return (this.data[i >>> 5] & (1 << (i & 31))) !== 0;
  }
  set(i: number): void {
    this.data[i >>> 5] |= (1 << (i & 31));
  }
}

// Replaces: const evaluated = new Uint8Array(totalCells);
// Memory: 200M bits = 25MB instead of 200MB
const evaluated = new BitArray(totalCells);
```

---

## Bug 4: THE SDF GRID ITSELF CAN BE TOO LARGE

```typescript
const sdf = new Float32Array(totalCells).fill(1.0);
```

At 200M cells × 4 bytes = 800MB. This alone can crash the tab.

### Fix: Use a sparse SDF — only store cells that are actually evaluated

```typescript
// Instead of a dense Float32Array, use a Map for evaluated cells
// and return +1.0 for non-evaluated cells
class SparseSDF {
  private data = new Map<number, number>();
  
  get(index: number): number {
    return this.data.get(index) ?? 1.0; // default: outside
  }
  
  set(index: number, value: number): void {
    this.data.set(index, value);
  }
  
  get size(): number { return this.data.size; }
}

// For the monocoque at 5mm resolution:
// Grid: 375 × 206 × 467 = 36M total cells
// Evaluated: ~5% = 1.8M cells
// Dense Float32Array: 36M × 4 = 144MB
// Sparse Map: 1.8M entries × ~60 bytes = ~108MB (Map overhead)
// 
// The sparse approach wins when <30% of cells are evaluated.
// For thin shells, typically <10% are evaluated → clear win.
//
// Even better: use a Float32Array but only allocate for the
// EVALUATED cells, with an index mapping:

class CompactSDF {
  private indexMap = new Map<number, number>();
  private values: number[] = [];
  
  get(cellIndex: number): number {
    const compactIdx = this.indexMap.get(cellIndex);
    return compactIdx !== undefined ? this.values[compactIdx] : 1.0;
  }
  
  set(cellIndex: number, value: number): void {
    const existing = this.indexMap.get(cellIndex);
    if (existing !== undefined) {
      this.values[existing] = value;
    } else {
      this.indexMap.set(cellIndex, this.values.length);
      this.values.push(value);
    }
  }
}
```

BUT: the marching cubes loop iterates ALL cells and calls sdfAt().
With a sparse SDF, non-evaluated cells return 1.0 (outside).
MC skips cubes where all 8 corners are positive (case 0).
So MC naturally skips the vast majority of the grid. This works.

---

## Bug 5: QUEUE.SHIFT() IN NORMAL ORIENTATION BFS

Same problem as before: Array.shift() is O(n) for the normal
orientation BFS. With 686K points, this is O(n²).

### Fix: Use the ring buffer queue from the halfedge module.

---

## Bug 6: MARCHING CUBES EXPANDS BACK TO NON-INDEXED

At the end of marchingCubesOnSDF, the code converts from indexed
to non-indexed (per-face vertices):

```typescript
const positions = new Float32Array(triCount * 9);
for (let t = 0; t < triCount; t++) { ... }
```

This TRIPLES the vertex count and memory. For 400K triangles,
that's 400K × 9 × 4 = 14.4MB instead of ~6MB indexed.

### Fix: Return indexed geometry directly

```typescript
// Instead of expanding, return the indexed data:
return {
  positions: new Float32Array(positionsList),
  indices: new Uint32Array(indices),
  triCount: Math.floor(indices.length / 3),
  vertexCount,
};

// Then in the caller:
const outGeo = new THREE.BufferGeometry();
outGeo.setAttribute("position", new THREE.BufferAttribute(
  new Float32Array(mc.positions), 3
));
outGeo.setIndex(new THREE.BufferAttribute(
  new Uint32Array(mc.indices), 1
));
outGeo.computeVertexNormals();
```

---

## Priority Order for Fixes

1. **Normal orientation** (Bug 1) — this is why the output is broken.
   Without consistent normals, the SDF is random noise. MUST FIX FIRST.

2. **Sparse SDF** (Bug 4) — prevents OOM on large models.
   Switch to CompactSDF or at minimum validate grid size more strictly.

3. **BitArray for evaluated flags** (Bug 3) — 8x memory reduction.

4. **Sample vertices too** (Bug 2) — better coverage, fewer gaps.

5. **Indexed output** (Bug 6) — memory and GPU performance.

6. **Ring buffer queue** (Bug 5) — performance on large point clouds.

## After fixing Bug 1, the expected pipeline behavior:

```
Input: 686K broken triangles, inconsistent normals
  ↓
Extract point cloud: 686K centroids + ~300K unique vertices = ~1M points
  ↓
Orient normals: BFS propagation, ~1 second, all normals now consistent
  ↓
Build spatial hash: instant
  ↓
Evaluate sparse SDF: ~2M cells near surface (of 36M total), ~3 seconds
  ↓
Marching cubes: ~300-400K triangles, smooth, watertight
  ↓
computeVertexNormals: smooth shading from consistent oriented faces
  ↓
Output: clean manifold, windows preserved, ready to slice
```
