# EMERGENCY FIX: Grid Dimension Overflow

## The bug
Bounding box after voxel reconstruction shows dimensions in the quadrillions.
Original model: 1870 × 1030 × 2335 mm.
Output shows: 1413972 × 3.4e15 × 1.2e15 mm.

This means either:
A) The grid dimensions (nx, ny, nz) are computed from corrupted values
B) The marching cubes vertex positions use wrong origin/resolution
C) A NaN is propagating through the math and being interpreted as a huge number

## DIAGNOSTIC: Add these guards IMMEDIATELY

### Guard 1: Validate bounding box before voxelization

```typescript
function validateBBox(bbox) {
  const vals = [bbox.minX, bbox.minY, bbox.minZ, bbox.maxX, bbox.maxY, bbox.maxZ];
  
  for (const v of vals) {
    if (!Number.isFinite(v)) {
      throw new Error(`BBox contains non-finite value: ${v}`);
    }
  }
  
  const dx = bbox.maxX - bbox.minX;
  const dy = bbox.maxY - bbox.minY;
  const dz = bbox.maxZ - bbox.minZ;
  
  if (dx <= 0 || dy <= 0 || dz <= 0) {
    throw new Error(`BBox has zero/negative dimension: ${dx} × ${dy} × ${dz}`);
  }
  
  // No mesh should be larger than 100 meters in any direction
  if (dx > 100000 || dy > 100000 || dz > 100000) {
    throw new Error(`BBox suspiciously large: ${dx} × ${dy} × ${dz} mm`);
  }
  
  console.log(`BBox validated: ${dx.toFixed(1)} × ${dy.toFixed(1)} × ${dz.toFixed(1)} mm`);
}
```

### Guard 2: Cap grid dimensions BEFORE allocating

```typescript
function computeGridDimensions(bbox, resolution, padding) {
  const dx = bbox.maxX - bbox.minX + 2 * padding;
  const dy = bbox.maxY - bbox.minY + 2 * padding;
  const dz = bbox.maxZ - bbox.minZ + 2 * padding;
  
  const nx = Math.ceil(dx / resolution) + 1;
  const ny = Math.ceil(dy / resolution) + 1;
  const nz = Math.ceil(dz / resolution) + 1;
  
  // HARD LIMIT: 1000 voxels per axis max (1 billion total max)
  const MAX_VOXELS_PER_AXIS = 1000;
  const MAX_TOTAL_VOXELS = 200_000_000; // 200M = ~25MB as bit array
  
  if (nx > MAX_VOXELS_PER_AXIS || ny > MAX_VOXELS_PER_AXIS || nz > MAX_VOXELS_PER_AXIS) {
    throw new Error(
      `Grid too large: ${nx} × ${ny} × ${nz}. ` +
      `Increase resolution from ${resolution}mm to at least ${(Math.max(dx,dy,dz) / MAX_VOXELS_PER_AXIS).toFixed(1)}mm`
    );
  }
  
  const totalVoxels = nx * ny * nz;
  if (totalVoxels > MAX_TOTAL_VOXELS) {
    throw new Error(
      `Grid has ${totalVoxels.toLocaleString()} voxels (max ${MAX_TOTAL_VOXELS.toLocaleString()}). ` +
      `Increase resolution.`
    );
  }
  
  console.log(`Grid: ${nx} × ${ny} × ${nz} = ${totalVoxels.toLocaleString()} voxels (${(totalVoxels / 8 / 1024 / 1024).toFixed(1)} MB)`);
  
  return { nx, ny, nz };
}
```

### Guard 3: Validate marching cubes output positions

```typescript
function validateMCOutput(positions, bbox, resolution) {
  // Every vertex from marching cubes must be within bbox + small margin
  const margin = resolution * 5;
  
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i], y = positions[i+1], z = positions[i+2];
    
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
      throw new Error(`MC produced NaN/Infinity at vertex ${i/3}: (${x}, ${y}, ${z})`);
    }
    
    if (x < bbox.minX - margin || x > bbox.maxX + margin ||
        y < bbox.minY - margin || y > bbox.maxY + margin ||
        z < bbox.minZ - margin || z > bbox.maxZ + margin) {
      throw new Error(
        `MC vertex ${i/3} outside bbox: (${x.toFixed(1)}, ${y.toFixed(1)}, ${z.toFixed(1)}) ` +
        `vs bbox (${bbox.minX.toFixed(1)}..${bbox.maxX.toFixed(1)}, ${bbox.minY.toFixed(1)}..${bbox.maxY.toFixed(1)}, ${bbox.minZ.toFixed(1)}..${bbox.maxZ.toFixed(1)})`
      );
    }
  }
}
```

### Guard 4: Estimated output triangle count check in the UI

```typescript
function estimateOutputTriangles(nx, ny, nz) {
  // Marching cubes produces at most 5 triangles per cube
  // Surface cubes are roughly proportional to surface area of the grid
  // Rough estimate: 2 * (nx*ny + ny*nz + nx*nz) * 2 triangles
  const surfaceCubes = 2 * (nx*ny + ny*nz + nx*nz);
  const estimate = surfaceCubes * 2; // ~2 tris per surface cube on average
  
  // HARD LIMIT for browser
  const MAX_OUTPUT_TRIANGLES = 10_000_000; // 10M absolute max
  
  if (estimate > MAX_OUTPUT_TRIANGLES) {
    return {
      count: estimate,
      safe: false,
      message: `Estimated ${estimate.toLocaleString()} triangles exceeds safe limit. Increase resolution.`
    };
  }
  
  return { count: estimate, safe: true, message: `~${estimate.toLocaleString()} triangles` };
}
```

## MOST LIKELY ROOT CAUSE

Check the marching cubes vertex position computation. It probably looks like:

```typescript
// BUG: origin or resolution is wrong type, NaN, or uninitialized
const px = origin[0] + (x0 + x1) * 0.5 * resolution;
```

If `origin` is undefined, or `resolution` is a string from the slider 
instead of a number, the multiplication produces NaN or Infinity, which 
then gets stored as vertex positions, which inflates the bounding box 
to astronomical values.

### Check these specific things:

```typescript
// 1. Is resolution a number?
console.log(typeof resolution, resolution); // should be "number", 20

// 2. Is origin an array of finite numbers?
console.log(origin, origin.every(Number.isFinite)); // should be [x,y,z], true

// 3. Are grid dimensions reasonable?
console.log(nx, ny, nz, nx*ny*nz); // should be ~94, 52, 117, ~570K for 20mm res

// 4. After MC, are positions finite?
const positions = mcResult.positions;
let hasNaN = false;
for (let i = 0; i < positions.length; i++) {
  if (!Number.isFinite(positions[i])) { hasNaN = true; break; }
}
console.log("MC positions has NaN:", hasNaN);
```

Put these 4 console.logs in and the broken value will be immediately obvious.
