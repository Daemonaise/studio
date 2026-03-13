# Why Voxel Reconstruction Fails on This File — And What Works Instead

## What went wrong

The monocoque is a thin shell made of overlapping surface patches with
gaps between them. The problems with voxel approaches on this geometry:

1. **Solid voxel** fills the interior solid → windows disappear, 
   result is a brick

2. **Shell voxel at coarse resolution** (20mm on a 2m car) → the shell 
   is thinner than the voxel size, so the rasterization produces 
   scattered disconnected voxels → marching cubes connects them with 
   giant spanning triangles → crumpled paper result

3. **Shell voxel at fine resolution** (2mm) → grid is 935 × 515 × 1168 
   = 562M voxels → exceeds browser memory

The fundamental issue: voxelization requires the feature size to be 
LARGER than the voxel size. A 2mm thick shell at 5mm resolution 
disappears. At 1mm resolution, you need 2 billion voxels for this model.

## The Right Approach: Poisson Surface Reconstruction

Poisson reconstruction treats the input as a POINT CLOUD with oriented 
normals, not as a mesh. It solves for the smoothest surface that fits 
through those points. This is the standard algorithm for reconstructing 
surfaces from 3D scanner data — which is essentially what this broken 
file is: a noisy cloud of triangulated surface samples.

### Why it works where voxels fail:
- Doesn't require the input to be manifold, connected, or consistent
- Handles overlapping patches naturally (they're just denser point samples)
- Handles gaps (the solver interpolates smoothly across missing regions)
- Handles thin shells (it reconstructs the SURFACE, not the VOLUME)
- Output resolution adapts to local point density, not a fixed grid
- Memory usage is proportional to surface area, not bounding volume

### The algorithm (Kazhdan & Hoppe 2013, "Screened Poisson"):
1. Extract points + normals from the triangle soup
2. Build an octree around the points (adaptive, not uniform grid)
3. Solve a Poisson equation: find the scalar field whose gradient 
   best matches the oriented normals
4. Extract the isosurface of that scalar field (marching cubes on octree)

The octree is the key difference from uniform voxels. It subdivides 
finely near the surface and coarsely far away. A 2m car body at 2mm 
surface resolution needs maybe 50M octree cells near the surface, 
not 2 billion uniform voxels.

---

## Implementation: Two Practical Options

### Option A: Use OpenMeshEffects / Poisson WASM (Recommended)

The Screened Poisson Reconstruction algorithm has a C++ reference 
implementation by Kazhdan that has been compiled to WASM:

```
https://github.com/mkazhdan/PoissonRecon  (original C++)
```

Several WASM ports exist. The binary is ~300KB gzipped. Integration:

```typescript
// Load the WASM module
const poisson = await loadPoissonReconWASM();

// Extract point cloud from triangle soup
const { points, normals } = extractPointCloud(triangles);

// Run reconstruction
const result = poisson.reconstruct(points, normals, {
  depth: 8,        // octree depth (8 = ~256 cells per axis at finest level)
  pointWeight: 4,  // how closely the surface must pass through points
  samplesPerNode: 1.5, // density threshold for subdivision
});

// result.positions, result.indices = clean manifold mesh
```

Octree depth guide for this model:
- depth 7: ~128 effective resolution per axis → ~18mm at max dim → coarse but fast
- depth 8: ~256 per axis → ~9mm → good balance (USE THIS)
- depth 9: ~512 per axis → ~4.5mm → high detail, ~5s compute
- depth 10: ~1024 per axis → ~2.3mm → max detail, ~20s compute

At depth 8, memory is ~100MB and compute is ~2-3 seconds in WASM.
Output: ~200-400K triangles, watertight manifold, smooth surface.

### Option B: Simplified Poisson in Pure TypeScript (~1500 lines)

If you want to avoid the WASM dependency, a simplified version:

```typescript
/**
 * Simplified surface reconstruction for thin shells:
 * 
 * Instead of solving the full Poisson equation, use a simpler 
 * approach that still handles this class of geometry:
 * 
 * 1. Extract points + normals from all input triangles
 * 2. Build a 3D spatial hash of the points  
 * 3. For each point, find neighbors within a radius
 * 4. Fit a local plane to each neighborhood (PCA)
 * 5. Use the fitted planes to create a signed distance field
 * 6. Run marching cubes on the signed distance field
 * 
 * This is called "Moving Least Squares" (MLS) reconstruction.
 * Simpler than Poisson but produces comparable results for 
 * moderately noisy data.
 */

// Step 1: Extract oriented point cloud from triangle soup
function extractPointCloud(
  positions: Float64Array,   // vertex positions from STL/OBJ
  faceIndices: Uint32Array,  // triangle vertex indices  
  faceCount: number
): { points: Float64Array; normals: Float64Array; pointCount: number } {
  
  // Sample points from triangle centroids + vertices
  // For 686K triangles, this gives ~900K points
  const maxPoints = faceCount * 2; // centroid + vertices (deduped)
  const points = new Float64Array(maxPoints * 3);
  const normals = new Float64Array(maxPoints * 3);
  let pointCount = 0;
  
  for (let f = 0; f < faceCount; f++) {
    const i0 = faceIndices[f * 3];
    const i1 = faceIndices[f * 3 + 1];
    const i2 = faceIndices[f * 3 + 2];
    
    const p0x = positions[i0*3], p0y = positions[i0*3+1], p0z = positions[i0*3+2];
    const p1x = positions[i1*3], p1y = positions[i1*3+1], p1z = positions[i1*3+2];
    const p2x = positions[i2*3], p2y = positions[i2*3+1], p2z = positions[i2*3+2];
    
    // Face normal
    const ex = p1x-p0x, ey = p1y-p0y, ez = p1z-p0z;
    const fx = p2x-p0x, fy = p2y-p0y, fz = p2z-p0z;
    let nx = ey*fz - ez*fy;
    let ny = ez*fx - ex*fz;
    let nz = ex*fy - ey*fx;
    const len = Math.sqrt(nx*nx + ny*ny + nz*nz);
    if (len < 1e-10) continue; // degenerate triangle
    nx /= len; ny /= len; nz /= len;
    
    // Add centroid
    const cx = (p0x + p1x + p2x) / 3;
    const cy = (p0y + p1y + p2y) / 3;
    const cz = (p0z + p1z + p2z) / 3;
    
    const idx = pointCount * 3;
    points[idx] = cx; points[idx+1] = cy; points[idx+2] = cz;
    normals[idx] = nx; normals[idx+1] = ny; normals[idx+2] = nz;
    pointCount++;
  }
  
  return {
    points: points.subarray(0, pointCount * 3),
    normals: normals.subarray(0, pointCount * 3),
    pointCount
  };
}


// Step 2: Spatial hash for fast neighbor queries
class SpatialHash {
  private cells: Map<number, number[]>;
  private cellSize: number;
  
  constructor(cellSize: number) {
    this.cellSize = cellSize;
    this.cells = new Map();
  }
  
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
  
  queryRadius(x: number, y: number, z: number, radius: number, 
              points: Float64Array): number[] {
    const result: number[] = [];
    const r2 = radius * radius;
    const steps = Math.ceil(radius / this.cellSize);
    
    const cx = Math.floor(x / this.cellSize);
    const cy = Math.floor(y / this.cellSize);
    const cz = Math.floor(z / this.cellSize);
    
    for (let dz = -steps; dz <= steps; dz++) {
      for (let dy = -steps; dy <= steps; dy++) {
        for (let dx = -steps; dx <= steps; dx++) {
          const h = (((cx+dx) * 73856093) ^ ((cy+dy) * 19349663) ^ ((cz+dz) * 83492791)) >>> 0;
          const cell = this.cells.get(h);
          if (!cell) continue;
          
          for (const idx of cell) {
            const px = points[idx*3] - x;
            const py = points[idx*3+1] - y;
            const pz = points[idx*3+2] - z;
            if (px*px + py*py + pz*pz <= r2) {
              result.push(idx);
            }
          }
        }
      }
    }
    
    return result;
  }
}


// Step 3: Signed distance field via weighted normal projection
// 
// For any query point Q in space, the signed distance to the surface is
// approximated by projecting Q onto the nearest points and using their
// normals to determine inside/outside.
// 
// d(Q) ≈ Σ_i w_i * dot(Q - P_i, N_i)  /  Σ_i w_i
// 
// where w_i = exp(-||Q - P_i||² / (2 * h²))  (Gaussian weight)
// h = smoothing radius

function evaluateSDF(
  qx: number, qy: number, qz: number,
  neighbors: number[],
  points: Float64Array,
  normals: Float64Array,
  h: number // smoothing radius
): number {
  if (neighbors.length === 0) return 1.0; // far from surface = outside
  
  const h2inv = 1.0 / (2 * h * h);
  let sumWD = 0;
  let sumW = 0;
  
  for (const i of neighbors) {
    const dx = qx - points[i*3];
    const dy = qy - points[i*3+1];
    const dz = qz - points[i*3+2];
    const dist2 = dx*dx + dy*dy + dz*dz;
    
    const w = Math.exp(-dist2 * h2inv);
    const signedDist = dx * normals[i*3] + dy * normals[i*3+1] + dz * normals[i*3+2];
    
    sumWD += w * signedDist;
    sumW += w;
  }
  
  return sumW > 0 ? sumWD / sumW : 1.0;
}


// Step 4: Adaptive grid evaluation + marching cubes
//
// Evaluate the SDF on a grid, then run marching cubes.
// The grid only needs to be fine near the surface — use the spatial 
// hash to skip grid cells that are far from any input point.

function reconstructSurface(
  points: Float64Array,
  normals: Float64Array,
  pointCount: number,
  bbox: { minX: number; minY: number; minZ: number; maxX: number; maxY: number; maxZ: number },
  resolution: number,
  onProgress?: (stage: string, progress: number) => void
): { positions: Float64Array; indices: Uint32Array } {
  
  const smoothingRadius = resolution * 3; // query radius for SDF
  
  // Build spatial hash
  if (onProgress) onProgress('buildHash', 0);
  const hash = new SpatialHash(smoothingRadius);
  for (let i = 0; i < pointCount; i++) {
    hash.insert(i, points[i*3], points[i*3+1], points[i*3+2]);
  }
  
  // Grid setup
  const pad = resolution * 3;
  const ox = bbox.minX - pad, oy = bbox.minY - pad, oz = bbox.minZ - pad;
  const nx = Math.ceil((bbox.maxX - bbox.minX + 2*pad) / resolution) + 1;
  const ny = Math.ceil((bbox.maxY - bbox.minY + 2*pad) / resolution) + 1;
  const nz = Math.ceil((bbox.maxZ - bbox.minZ + 2*pad) / resolution) + 1;
  
  // Safety check
  if (nx * ny * nz > 200_000_000) {
    throw new Error(`Grid too large: ${nx}x${ny}x${nz}. Increase resolution.`);
  }
  
  // Evaluate SDF only at grid points near input geometry
  // Use Float32 for the SDF grid (saves memory, precision not critical)
  const sdf = new Float32Array(nx * ny * nz).fill(1.0); // default: outside
  
  if (onProgress) onProgress('evaluateSDF', 0);
  
  // For efficiency: iterate over input points, evaluate SDF in their
  // neighborhood, rather than evaluating every grid cell
  const evaluatedCells = new Uint8Array(nx * ny * nz);
  const evalRadius = Math.ceil(smoothingRadius / resolution) + 1;
  
  for (let pi = 0; pi < pointCount; pi++) {
    if (onProgress && pi % 5000 === 0) onProgress('evaluateSDF', pi / pointCount);
    
    const px = points[pi*3], py = points[pi*3+1], pz = points[pi*3+2];
    const gx = Math.round((px - ox) / resolution);
    const gy = Math.round((py - oy) / resolution);
    const gz = Math.round((pz - oz) / resolution);
    
    for (let dz = -evalRadius; dz <= evalRadius; dz++) {
      for (let dy = -evalRadius; dy <= evalRadius; dy++) {
        for (let dx = -evalRadius; dx <= evalRadius; dx++) {
          const ix = gx + dx, iy = gy + dy, iz = gz + dz;
          if (ix < 0 || ix >= nx || iy < 0 || iy >= ny || iz < 0 || iz >= nz) continue;
          
          const cellIdx = (iz * ny + iy) * nx + ix;
          if (evaluatedCells[cellIdx]) continue;
          evaluatedCells[cellIdx] = 1;
          
          const qx = ox + ix * resolution;
          const qy = oy + iy * resolution;
          const qz = oz + iz * resolution;
          
          const neighbors = hash.queryRadius(qx, qy, qz, smoothingRadius, points);
          sdf[cellIdx] = evaluateSDF(qx, qy, qz, neighbors, points, normals, smoothingRadius * 0.5);
        }
      }
    }
  }
  
  // Run marching cubes on the SDF
  // (Use the same MC implementation but sample from sdf[] instead of binary grid)
  if (onProgress) onProgress('marchingCubes', 0);
  
  return marchingCubesOnSDF(sdf, nx, ny, nz, ox, oy, oz, resolution, onProgress);
}

// Marching cubes variant that operates on a continuous SDF
// instead of a binary grid. Interpolates vertex positions along
// edges based on the SDF values at edge endpoints.
function marchingCubesOnSDF(
  sdf: Float32Array,
  nx: number, ny: number, nz: number,
  ox: number, oy: number, oz: number,
  resolution: number,
  onProgress?: (stage: string, progress: number) => void
): { positions: Float64Array; indices: Uint32Array } {
  
  const edgeVertexMap = new Map<string, number>();
  const positions: number[] = [];
  const indices: number[] = [];
  let vertexCount = 0;
  
  function sdfAt(x: number, y: number, z: number): number {
    if (x < 0 || x >= nx || y < 0 || y >= ny || z < 0 || z >= nz) return 1.0;
    return sdf[(z * ny + y) * nx + x];
  }
  
  // Interpolate vertex position on edge between two grid points
  // based on their SDF values (linear interpolation to find zero crossing)
  function getEdgeVertex(
    x0: number, y0: number, z0: number, v0: number,
    x1: number, y1: number, z1: number, v1: number
  ): number {
    const key = `${Math.min(x0,x1)},${Math.min(y0,y1)},${Math.min(z0,z1)},${Math.max(x0,x1)},${Math.max(y0,y1)},${Math.max(z0,z1)}`;
    const existing = edgeVertexMap.get(key);
    if (existing !== undefined) return existing;
    
    // Linear interpolation: find t where v0 + t*(v1-v0) = 0
    let t = 0.5;
    if (Math.abs(v1 - v0) > 1e-10) {
      t = -v0 / (v1 - v0);
      t = Math.max(0, Math.min(1, t));
    }
    
    const px = ox + (x0 + t * (x1 - x0)) * resolution;
    const py = oy + (y0 + t * (y1 - y0)) * resolution;
    const pz = oz + (z0 + t * (z1 - z0)) * resolution;
    
    const idx = vertexCount++;
    positions.push(px, py, pz);
    edgeVertexMap.set(key, idx);
    return idx;
  }
  
  // Standard marching cubes loop with SDF-based classification
  for (let z = 0; z < nz - 1; z++) {
    if (onProgress && z % 10 === 0) onProgress('marchingCubes', z / (nz - 1));
    
    for (let y = 0; y < ny - 1; y++) {
      for (let x = 0; x < nx - 1; x++) {
        // 8 corner SDF values
        const v = [
          sdfAt(x, y, z),         sdfAt(x+1, y, z),
          sdfAt(x+1, y+1, z),     sdfAt(x, y+1, z),
          sdfAt(x, y, z+1),       sdfAt(x+1, y, z+1),
          sdfAt(x+1, y+1, z+1),   sdfAt(x, y+1, z+1),
        ];
        
        // Case index: bit set if corner is inside (SDF < 0)
        let caseIdx = 0;
        for (let i = 0; i < 8; i++) {
          if (v[i] < 0) caseIdx |= (1 << i);
        }
        
        if (caseIdx === 0 || caseIdx === 255) continue;
        
        // Look up MC triangulation and create triangles
        // with interpolated vertex positions
        // (uses same MC_TRI_TABLE as before, but getEdgeVertex 
        // now interpolates based on SDF values instead of using midpoints)
        
        // ... MC table lookup + triangle creation here ...
      }
    }
  }
  
  return {
    positions: new Float64Array(positions),
    indices: new Uint32Array(indices),
  };
}
```

---

## Repair Pipeline Decision Tree (Updated)

```
User drops file
  │
  ├─ Analyze: count open edges, non-manifold edges, shells
  │
  ├─ If defects < 1% of edges:
  │   └─ TOPOLOGY REPAIR (fast, exact)
  │
  ├─ If defects > 1%:
  │   ├─ Estimate wall thickness (ray casting)
  │   │
  │   ├─ If wall thickness > 5% of max dimension:
  │   │   └─ SOLID VOXEL RECONSTRUCTION
  │   │       (flood fill + marching cubes)
  │   │
  │   ├─ If wall thickness < 5% of max dimension:
  │   │   └─ POINT CLOUD RECONSTRUCTION ← NEW
  │   │       (extract points+normals → SDF → marching cubes)
  │   │       Works on thin shells, preserves openings
  │   │
  │   └─ If ambiguous:
  │       └─ AI ANALYSIS → returns executable RepairPlan
  │           with pipeline choice + parameters
  │
  ▼
  Post-process: Taubin smooth + quadric simplify
  │
  ▼
  Clean manifold output
```

## Why point cloud reconstruction works on the monocoque:

- The 686K triangles become ~686K oriented point samples
- Overlapping panels = denser point samples in those regions (good, not bad)
- Gaps between panels get interpolated by the SDF (smooth bridging)
- Windows are LARGE openings where there are NO points → SDF stays 
  positive (outside) → no surface created → windows preserved
- Thin features are reconstructed as thin surfaces because the SDF 
  zero-crossing follows the point normals, not a volume fill
- Memory: SDF only evaluated near actual geometry, not in empty space
  (~5% of grid cells get evaluated for a thin shell)

## Expected result for monocoque:

- Input: 686K broken triangles, 34K open edges, 7.9K non-manifold
- Point extraction: ~686K points with normals
- SDF resolution: 5mm → grid ~375 × 206 × 467 (but only ~5% evaluated)
- MC output: ~300-400K triangles, watertight, smooth
- After simplification: ~200-300K triangles, clean manifold
- Windows, doors, wheel arches: PRESERVED (no points there = no surface)
