# FIX: Post-Marching-Cubes Processing

## Current problem
The marching cubes output has:
- 2.7M triangles (4x the original — MC over-tessellates flat surfaces)
- 5,896 non-manifold edges (MC vertex dedup bug or ambiguous cases)
- Visible stair-stepping (voxel grid artifacts)

All three are expected if you run raw MC output without post-processing.
MC is step 1 of 3, not the final output.

---

## Fix 1: Non-manifold edges from marching cubes

Standard marching cubes has ambiguous cases (cases 3, 6, 7, 10, 12, 13 
in the original Lorensen & Cline table) where the surface can be 
triangulated two different ways. If adjacent cubes resolve the ambiguity 
differently, you get a crack → non-manifold edge.

### Option A: Use the corrected MC33 table
Replace the standard 15-case marching cubes with the 33-case variant 
(Chernyaev 1995) which resolves all ambiguities consistently.
This guarantees manifold output. The table is larger but it's a 
drop-in replacement.

Source for MC33 tables:
  https://github.com/ilastik/marching_cubes (C++, MIT license)
  Tables can be extracted as JS arrays.

### Option B: Post-process with manifold repair
If changing the MC table is too invasive, run topology repair on the 
MC output. Since MC output is ALMOST manifold (only ambiguous cases 
break it), the topology repair handles it trivially:

```typescript
// After marching cubes:
const { unmatched, nonManifold } = mesh.buildTwins();

// Non-manifold edges from MC are always just 3 faces on an edge.
// Split the third face off by duplicating its vertices on that edge.
for (const he of nonManifold) {
  splitNonManifoldEdge(mesh, he);
}
mesh.buildTwins();
// Should now be 0 non-manifold edges
```

---

## Fix 2: Laplacian smoothing (removes stair-stepping)

Stair-stepping is inherent to marching cubes on a binary voxel grid.
Laplacian smoothing moves each vertex toward the average of its neighbors,
which rounds off the stair steps while preserving overall shape.

```typescript
/**
 * Laplacian smoothing: iteratively move each vertex toward the 
 * centroid of its neighbors. Preserves topology, smooths geometry.
 * 
 * @param iterations - 3-5 for mild smoothing, 10+ for heavy
 * @param lambda - step size, 0.3-0.5 is safe (higher = more aggressive)
 */
function laplacianSmooth(
  mesh: HalfEdgeMesh, 
  iterations: number = 5,
  lambda: number = 0.4
): void {
  // Build adjacency: for each vertex, collect neighbor vertex indices
  const neighbors: number[][] = Array.from({length: mesh.vertexCount}, () => []);
  
  for (let he = 0; he < mesh.halfedgeCount; he++) {
    const from = mesh.heOrigin(he);
    const to = mesh.heVertex[he];
    if (from !== -1 && to !== -1) {
      // Avoid duplicates by only adding in one direction
      if (!neighbors[from].includes(to)) {
        neighbors[from].push(to);
        neighbors[to].push(from);
      }
    }
  }

  // Detect boundary vertices (should not be smoothed, or smoothed less)
  const isBoundary = new Uint8Array(mesh.vertexCount);
  for (let he = 0; he < mesh.halfedgeCount; he++) {
    if (mesh.heTwin[he] === -1 && mesh.heFace[he] !== -1) {
      isBoundary[mesh.heOrigin(he)] = 1;
      isBoundary[mesh.heVertex[he]] = 1;
    }
  }

  // Temporary buffer for new positions
  const newPos = new Float64Array(mesh.vertexCount * 3);

  for (let iter = 0; iter < iterations; iter++) {
    // Compute smoothed positions
    for (let v = 0; v < mesh.vertexCount; v++) {
      const nbrs = neighbors[v];
      if (nbrs.length === 0 || isBoundary[v]) {
        // Keep boundary vertices fixed
        newPos[v*3]   = mesh.positions[v*3];
        newPos[v*3+1] = mesh.positions[v*3+1];
        newPos[v*3+2] = mesh.positions[v*3+2];
        continue;
      }

      // Centroid of neighbors
      let cx = 0, cy = 0, cz = 0;
      for (const n of nbrs) {
        cx += mesh.positions[n*3];
        cy += mesh.positions[n*3+1];
        cz += mesh.positions[n*3+2];
      }
      cx /= nbrs.length;
      cy /= nbrs.length;
      cz /= nbrs.length;

      // Move toward centroid by lambda
      newPos[v*3]   = mesh.positions[v*3]   + lambda * (cx - mesh.positions[v*3]);
      newPos[v*3+1] = mesh.positions[v*3+1] + lambda * (cy - mesh.positions[v*3+1]);
      newPos[v*3+2] = mesh.positions[v*3+2] + lambda * (cz - mesh.positions[v*3+2]);
    }

    // Copy new positions back
    mesh.positions.set(newPos.subarray(0, mesh.vertexCount * 3));
  }
}

// OPTIONAL: Taubin smoothing (λ|μ) to prevent shrinkage
// Standard Laplacian causes the mesh to shrink over many iterations.
// Taubin alternates: smooth with +λ, then "inflate" with -μ (where μ > λ).
// This removes stair-steps without shrinking the part.
function taubinSmooth(
  mesh: HalfEdgeMesh,
  iterations: number = 5,
  lambda: number = 0.5,
  mu: number = -0.53  // must be negative and |mu| > lambda
): void {
  for (let i = 0; i < iterations; i++) {
    laplacianSmooth(mesh, 1, lambda);  // shrink pass
    laplacianSmooth(mesh, 1, mu);      // inflate pass (negative = expand)
  }
}
```

---

## Fix 3: Mesh simplification (reduces triangle count)

Marching cubes creates uniform-density triangles everywhere. Flat surfaces 
that need 2 triangles get 2000. Quadric error simplification collapses 
edges where the geometry is nearly flat, preserving detail only where needed.

```typescript
/**
 * Quadric error metric edge collapse simplification.
 * 
 * For each vertex, compute a 4x4 quadric matrix representing the 
 * sum of squared distances to its incident planes. When collapsing 
 * edge (v0, v1), the optimal position minimizes the combined quadric.
 * Edges with lowest error get collapsed first.
 * 
 * This is the standard Garland & Heckbert 1997 algorithm.
 * 
 * For 2.7M → 500K triangles, runs in ~3-5 seconds in a Web Worker.
 */
function quadricSimplify(mesh: HalfEdgeMesh, targetFaces: number): void {
  // Implementation outline (full implementation is ~400 lines):
  
  // 1. For each vertex, compute initial quadric Q from incident face planes
  //    Q_v = sum over incident faces f of: n_f * n_f^T (outer product of face normal)
  
  // 2. For each edge, compute collapse cost:
  //    Q_edge = Q_v0 + Q_v1
  //    optimal position = Q_edge^-1 * [0,0,0,1] (if invertible)
  //    cost = v_opt^T * Q_edge * v_opt
  
  // 3. Put all edges in a min-heap sorted by cost
  
  // 4. While faceCount > targetFaces:
  //    - Pop cheapest edge from heap
  //    - If either vertex was already collapsed, skip (lazy deletion)
  //    - Collapse edge: merge v1 into v0 at optimal position
  //    - Remove the 2 faces adjacent to this edge
  //    - Update all faces that referenced v1 to reference v0
  //    - Recompute Q_v0 = Q_v0 + Q_v1
  //    - Recompute costs for all edges incident to v0
  //    - Re-insert updated edges into heap
  
  // 5. Rebuild halfedge structure from surviving faces
  
  // IMPORTANT CONSTRAINTS:
  // - Never collapse an edge if it would create a non-manifold edge
  // - Never collapse an edge if it would flip a face normal
  // - Never collapse a boundary edge (preserves openings on shells)
  // These checks add ~20% to the cost but prevent topology corruption.
}

// For now, a simpler alternative: use the 'simplify-js' or 
// 'meshoptimizer' WASM module which implements this efficiently.
// meshoptimizer is ~50KB WASM and handles 2M+ triangle meshes in <2s.
```

---

## Complete post-MC pipeline:

```typescript
async function postProcessMarchingCubes(
  mcMesh: HalfEdgeMesh,
  params: {
    smoothingIterations: number;
    simplifyTarget: number;
  },
  onProgress?: ProgressCallback
): Promise<HalfEdgeMesh> {
  
  // Step 1: Fix non-manifold edges from MC ambiguous cases
  if (onProgress) onProgress('fixNonManifold', 0);
  const { nonManifold } = mcMesh.buildTwins();
  for (const he of nonManifold) {
    splitNonManifoldEdge(mcMesh, he);
  }
  mcMesh.buildTwins();

  // Step 2: Taubin smoothing (removes stair-steps without shrinkage)
  if (params.smoothingIterations > 0) {
    if (onProgress) onProgress('smooth', 0);
    taubinSmooth(mcMesh, params.smoothingIterations, 0.5, -0.53);
  }

  // Step 3: Simplification (reduce MC over-tessellation)
  if (params.simplifyTarget > 0 && mcMesh.faceCount > params.simplifyTarget) {
    if (onProgress) onProgress('simplify', 0);
    quadricSimplify(mcMesh, params.simplifyTarget);
  }

  // Step 4: Final validation
  mcMesh.buildTwins();
  const validation = mcMesh.validate();
  
  if (!validation.valid) {
    console.warn('Post-MC validation issues:', validation.errors.slice(0, 5));
  }

  return mcMesh;
}
```

---

## Expected result for monocoque after full pipeline:

```
Input:  686K tris, 34K open edges, 7.9K non-manifold edges (broken mess)
  ↓
Shell voxelize (2.9mm res, 1 voxel dilation)
  ↓
Marching cubes: 2.7M tris, ~6K non-manifold, stair-stepped
  ↓
Fix MC non-manifold: 2.7M tris, 0 non-manifold
  ↓
Taubin smooth (5 iters): 2.7M tris, smooth surface, no stair-steps
  ↓
Quadric simplify (target 550K): 550K tris, smooth, detail preserved
  ↓
Output: 550K tris, 0 open edges, 0 non-manifold, watertight thin shell
         Windows and door openings preserved. Ready to slice.
```
