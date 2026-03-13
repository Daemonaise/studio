# Handling Severely Corrupted Meshes

## Why topology repair fails on files like this

The monocoque file is not a broken manifold — it was never a manifold to begin with.
It's a collection of overlapping surface patches exported as one STL. Think of it
as 50 separate sheets of metal thrown into one file, some overlapping, some with gaps.

Topology repair (winding fix, hole fill, non-manifold splitting) assumes there IS a 
coherent surface with a few defects. On this file:
- Hole filling bridges surfaces that shouldn't be connected
- 276K holes filled = the filler is going berserk connecting everything to everything
- Each filled hole creates new non-manifold edges where the fill meets other surfaces
- The repair loop never converges because each fix creates new problems

## The right approach: Voxel Reconstruction

For files this broken, you need to abandon the existing topology entirely and
reconstruct a clean surface from scratch. The algorithm:

### Step 1: Voxelization
Convert the triangle soup into a 3D voxel grid.
For each triangle, mark all voxels it passes through as "surface".

```
Grid resolution: choose based on model size and desired detail.
For the monocoque (1859 x 1017 x 2322 mm):
  At 2mm resolution: 930 x 509 x 1161 = ~550M voxels (too many)
  At 5mm resolution: 372 x 204 x 465  = ~35M voxels (feasible, ~35MB as bit array)
  At 10mm resolution: 186 x 102 x 233 = ~4.4M voxels (fast, coarser)

Use a bit array (1 bit per voxel) to keep memory manageable.
```

### Step 2: Flood Fill Interior
Cast rays or flood fill from the grid boundary inward.
Every voxel reachable from outside without crossing a surface voxel = exterior.
Everything else = interior or surface.

```
Start from a corner voxel (guaranteed exterior for a car body).
BFS/flood fill marking all connected empty voxels as "exterior".
Remaining unmarked empty voxels = interior cavities (keep or discard).
Surface voxels = the boundary between interior and exterior.
```

### Step 3: Marching Cubes
Extract an isosurface from the voxel grid using marching cubes.
The output is a clean, watertight manifold triangle mesh.

```
For each cube of 8 adjacent voxels:
  Classify each corner as inside or outside.
  Look up the edge configuration in the marching cubes table (256 cases).
  Create triangles at the edges between inside and outside corners.
```

### Step 4: Mesh Simplification (optional)
Marching cubes produces a LOT of triangles (mostly on flat surfaces where 
you don't need them). Run quadric edge collapse to reduce triangle count 
while preserving shape.

## Client-Side Implementation Plan

### Option A: Pure TypeScript (recommended for your stack)

Total implementation: ~800 lines of TypeScript in the Web Worker.

```
src/geometry/
  voxelize.ts        // Triangle → voxel grid (ray casting per-slice)
  floodfill3d.ts     // 3D BFS flood fill on bit array
  marchingcubes.ts   // Isosurface extraction → HalfEdgeMesh
  simplify.ts        // Quadric error metric edge collapse
```

Memory budget at 5mm resolution for the monocoque:
- Voxel grid (bit array): 35M bits = 4.4 MB
- Flood fill visited array: 4.4 MB
- Marching cubes output: ~200K triangles = ~25 MB as HalfEdgeMesh
- Total peak: ~35 MB (fine for browser)

Performance estimate (Web Worker, single thread):
- Voxelization: ~2-3 seconds (686K triangles against grid)
- Flood fill: ~1 second (BFS over ~35M voxels)
- Marching cubes: ~1 second
- Total: ~5 seconds

### Option B: Use an existing WASM library

OpenVDB has a WASM port but it's 5MB+ and complex to integrate.
Not recommended for your lightweight-first approach.

## Adaptive Resolution

The user shouldn't have to pick a voxel size. Auto-detect based on:

```typescript
function autoResolution(bbox: BoundingBox, triangleCount: number): number {
  const maxDim = Math.max(bbox.x, bbox.y, bbox.z);
  
  // Target: ~500 voxels along the longest axis
  // This gives good detail without blowing up memory
  const resolution = maxDim / 500;
  
  // Clamp to reasonable range
  return Math.max(0.5, Math.min(resolution, 20)); // 0.5mm to 20mm
}
```

For the monocoque (max dim 2322mm): resolution = ~4.6mm, grid = ~500³ = 125M voxels.
At 1 bit each = 15 MB. Feasible.

## Detail Preservation Tradeoff

Voxel reconstruction trades detail for correctness:
- At 5mm resolution, features smaller than 5mm disappear
- Sharp edges become slightly rounded (by ~half a voxel)
- Thin walls thinner than the voxel size may disappear or merge

This is acceptable for a file this broken because:
1. The alternative is a non-manifold mesh that can't be sliced or printed
2. The user can increase resolution if they need more detail
3. A 5mm voxel on a 2-meter car body preserves 99.7% of the visible shape

## Integration with Existing Pipeline

```
User drops file
  │
  ├─ Import → topology analysis
  │
  ├─ Decision point:
  │   Open edges < 1% of total edges AND non-manifold < 0.5%?
  │     YES → Run topology repair (existing pipeline)
  │     NO  → Run voxel reconstruction (new pipeline)
  │
  ├─ Output: clean HalfEdgeMesh (same format either way)
  │
  ├─ Proceed to slicing, export, etc.
```

The decision threshold is key. For the monocoque:
  - Total edges: ~1M (686K tris × 1.5 edges/tri)
  - Open edges: 34,830 = 3.5% of total
  - Non-manifold: 7,911 = 0.8% of total
  Both exceed threshold → voxel path.

For a typical slightly-broken CAD export:
  - Open edges: 50 = 0.005%
  - Non-manifold: 0
  Topology repair handles it fine.

## Voxelization Algorithm Detail

The fastest approach for triangle soup → voxel grid:

### Slice-based ray casting (parallelizable)

For each Z-slice of the grid:
1. Find all triangles that intersect this Z plane
2. For each triangle, compute intersection with the Z plane → line segment
3. For each row (Y) in the slice, cast a ray along X
4. Find all ray-segment intersections
5. Sort intersections by X
6. Fill voxels between pairs of intersections (even-odd rule)

This naturally handles overlapping surfaces correctly:
- Two overlapping surfaces at the same location = even number of crossings = exterior
- Single surface = odd crossing = one side is interior

The even-odd rule is why voxelization works on broken meshes where topology 
repair doesn't: it doesn't care about connectivity, winding, or manifold-ness.
It only cares about "how many surfaces did I cross to get here?"

### Handling the edge cases

- Triangles parallel to the slice plane: skip (they contribute no crossings)
- Triangles exactly on a grid boundary: nudge by epsilon
- Very thin features: if wall thickness < voxel size, both surfaces fall in 
  the same voxel and the feature disappears. Warn the user if many triangles
  map to the same voxel.

## User-Facing UI Suggestion

```
┌─ REPAIR MESH ─────────────────────────────────┐
│                                                │
│  [Auto-Repair]                                 │
│                                                │
│  ⚠ Mesh is severely damaged (3.5% open edges) │
│  Topology repair cannot fix this file.         │
│  Switching to volumetric reconstruction.       │
│                                                │
│  Resolution: [━━━━━●━━━━━━] 5.0 mm            │
│  Estimated triangles: ~180,000                 │
│  Detail loss: minimal at this resolution       │
│                                                │
│  [Reconstruct Mesh]                            │
│                                                │
│  ✓ Reconstruction complete                     │
│  ✓ Mesh is watertight (0 open edges)           │
│  ✓ 0 non-manifold edges                        │
│                                                │
└────────────────────────────────────────────────┘
```

## Summary

For files like this monocoque, you need TWO repair paths:

1. **Topology repair** (existing pipeline) — for meshes that are mostly correct
   with minor defects. Fast, preserves original geometry exactly.

2. **Voxel reconstruction** (new pipeline) — for meshes that are fundamentally 
   broken. Slower, trades sub-voxel detail for guaranteed manifold output.
   
Auto-detect which path based on the ratio of defective edges to total edges.
Both output the same HalfEdgeMesh format, so slicing and export work identically.
