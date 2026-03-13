# FIX: Flipped Faces + Non-Manifold Edges After Slicing

## Bug 1: Dark streaks = flipped face normals during triangle splitting

When splitting a straddling triangle into sub-triangles, the winding order
of EVERY sub-triangle must match the original face's winding.

The original triangle has vertices in order (A, B, C) which defines a 
specific winding (counterclockwise when viewed from outside).

When you split it, the sub-triangles must preserve that orientation.
The most common bug: the two intersection points P1 and P2 get swapped
in one of the sub-triangles.

### Fix: enforce winding consistency after splitting

After creating each sub-triangle from a split, verify its normal points 
the same direction as the original face normal. If not, swap two vertices.

```typescript
function splitTriangle(mesh, faceIdx, plane) {
  // Get original face normal BEFORE splitting
  const originalNormal = computeFaceNormal(mesh, faceIdx);
  
  // ... perform the split, create sub-triangles ...
  
  // For EACH sub-triangle created:
  for (const subTri of newSubTriangles) {
    const subNormal = computeFaceNormal(subTri.v0, subTri.v1, subTri.v2);
    const dot = originalNormal.x * subNormal.x + 
                originalNormal.y * subNormal.y + 
                originalNormal.z * subNormal.z;
    
    if (dot < 0) {
      // Normal is flipped — swap two vertices to fix winding
      const tmp = subTri.v1;
      subTri.v1 = subTri.v2;
      subTri.v2 = tmp;
    }
  }
}
```

This catches ALL winding errors regardless of which split case produced them.
Compute the original normal once, check every sub-triangle against it, done.

---

## Bug 2: 12 non-manifold edges = cap shares internal edges with mesh

The cap triangulation creates triangles to fill the boundary loop on the
cut plane. If two boundary vertices happen to also be connected by an edge
INSIDE the mesh (not a boundary edge, but an interior edge whose both 
vertices lie on the cut plane), and the ear clipper creates a triangle 
edge between those same two vertices, that edge now has 3 faces:
- face 1: original mesh face (above the cut)
- face 2: original mesh face (below the cut, but kept because both verts on plane)
- face 3: cap face

### Fix: constrain the ear clipper to only use boundary edges

The cap should ONLY create triangles whose perimeter edges are either:
1. Boundary loop edges (these will stitch to the mesh boundary), or
2. Interior cap edges that connect two non-adjacent boundary vertices

It must NEVER create an edge between two vertices that are already 
connected by an interior (non-boundary) mesh edge.

```typescript
function earClipWithConstraints(mesh, boundaryLoop, plane) {
  // Build set of existing interior edges on the cut plane
  const interiorEdges = new Set<string>();
  
  for (let he = 0; he < mesh.halfedgeCount; he++) {
    // Skip boundary halfedges — those are fine to overlap with
    if (mesh.heTwin[he] === -1) continue;
    
    const v0 = mesh.heOrigin(he);
    const v1 = mesh.heVertex[he];
    
    // Check if both vertices are on the cut plane
    if (isOnPlane(mesh, v0, plane) && isOnPlane(mesh, v1, plane)) {
      const key = Math.min(v0, v1) + "," + Math.max(v0, v1);
      interiorEdges.add(key);
    }
  }
  
  // During ear clipping, before accepting an ear triangle (prev, curr, next):
  // Check that the diagonal edge (prev → next) doesn't conflict
  function isValidEar(prev, curr, next) {
    // ... normal convexity and point-in-triangle checks ...
    
    // ADDITIONAL CHECK: the diagonal must not be an existing interior edge
    const diagKey = Math.min(prev, next) + "," + Math.max(prev, next);
    if (interiorEdges.has(diagKey)) {
      return false; // skip this ear, it would create a non-manifold edge
    }
    
    return true;
  }
  
  // Run ear clipping with this additional constraint
  // If an ear is rejected due to the interior edge check,
  // move to the next candidate vertex in the loop
}
```

### Alternative simpler fix if constraining ear clipping is complex:

After capping, find and remove the non-manifold edges:

```typescript
function fixNonManifoldCapEdges(mesh) {
  // Find edges with 3+ faces where all vertices are on cut plane
  for (let he = 0; he < mesh.halfedgeCount; he++) {
    // Check if this edge has a twin, and the twin also has a twin
    // (meaning 3+ halfedges on this edge)
    const twin = mesh.heTwin[he];
    if (twin === -1) continue;
    
    // Walk all halfedges on this edge
    // If count > 2, identify which face is the cap face and remove it
    // Then re-triangulate that region of the cap without the offending edge
  }
}
```

---

## Verification after both fixes

```typescript
// Check 1: No flipped faces
let flippedCount = 0;
for (let f = 0; f < mesh.faceCount; f++) {
  const normal = computeFaceNormal(mesh, f);
  // Cast ray from face centroid along normal
  // If it immediately hits another face of the same mesh, the normal points inward
  // (simplified: check that face normal dots positively with outward direction)
}

// Check 2: No non-manifold edges  
const edgeFaceCount = new Map<string, number>();
for (let he = 0; he < mesh.halfedgeCount; he++) {
  if (mesh.heFace[he] === -1) continue;
  const v0 = mesh.heOrigin(he);
  const v1 = mesh.heVertex[he];
  const key = Math.min(v0, v1) + "," + Math.max(v0, v1);
  edgeFaceCount.set(key, (edgeFaceCount.get(key) || 0) + 1);
}
let nonManifold = 0;
for (const [edge, count] of edgeFaceCount) {
  if (count > 2) { nonManifold++; }
}
console.log("Non-manifold edges:", nonManifold); // must be 0
```
