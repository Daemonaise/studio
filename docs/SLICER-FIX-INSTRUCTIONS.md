# SLICER FIX: Jagged Edges at Cut Boundaries

## The Bug
After slicing, the cap faces and the mesh faces along the cut line reference DIFFERENT vertex indices that happen to be at the same position. They must reference the SAME vertex index. Two vertices at the same position with different indices = gap = sawtooth.

## Fix 1: Edge Intersection Cache (MOST IMPORTANT)

When splitting triangles against the cut plane, NEVER compute an intersection point without first checking a cache keyed on the edge's vertex indices.

```
const intersectionCache = new Map<string, number>(); // key → vertex index

function getOrCreateIntersection(v0: number, v1: number, mesh, plane): number {
  // Canonical key: always min first so (v0,v1) and (v1,v0) produce same key
  const key = Math.min(v0, v1) + "," + Math.max(v0, v1);
  
  if (intersectionCache.has(key)) {
    return intersectionCache.get(key); // REUSE existing vertex index
  }
  
  const point = computeEdgePlaneIntersection(v0, v1, plane);
  const vertexIndex = mesh.addVertex(point.x, point.y, point.z);
  intersectionCache.set(key, vertexIndex);
  return vertexIndex; // Return INDEX, not position
}
```

Every triangle sharing an edge MUST get the same vertex index from this cache. No exceptions.

## Fix 2: Cap Must Use Existing Vertex Indices, Never Create New Ones

When building cap faces from boundary loops:

WRONG:
```
// Extracts positions, creates NEW vertices → different indices → gap
for (const he of boundaryLoop) {
  const pos = mesh.getPosition(mesh.heVertex[he]);
  capVertices.push(mesh.addVertex(pos.x, pos.y, pos.z)); // BUG: new index
}
```

RIGHT:
```
// Uses the EXISTING vertex indices directly
const capVertices = boundaryLoop.map(he => mesh.heVertex[he]); // same indices
```

The ear clipper receives these indices and returns triangles using them. It never calls addVertex.

## Fix 3: Cap Winding Must Be Opposite to Boundary

The boundary loop has a direction (e.g., clockwise viewed from above the cut plane). Cap faces must wind the OPPOSITE direction so that when twins are built, cap edge (A→B) pairs with mesh edge (B→A).

Test: after adding caps and rebuilding twins, count boundary halfedges on the cut plane. Should be ZERO. If not, the winding is wrong — flip it.

```
// If ear clipping produces triangle (a, b, c) from boundary loop order,
// and twin building still shows unmatched edges, swap to (a, c, b).
```

## Fix 4: Rebuild Twins After Adding Cap Faces

After ALL cap faces are added to the mesh, rebuild the entire twin pointer structure. This is what actually connects cap edges to mesh edges.

```
mesh.addFace(capTri[0], capTri[1], capTri[2]); // for each cap triangle
// ... after all cap faces added:
mesh.buildTwins(); // pairs cap edges with mesh boundary edges
```

## Verification

After slicing + capping, run this check:

```
let unstitched = 0;
for (let he = 0; he < mesh.halfedgeCount; he++) {
  if (mesh.heTwin[he] === -1 && mesh.heFace[he] !== -1) {
    const v0 = mesh.heOrigin(he);
    const v1 = mesh.heVertex[he];
    if (isOnCutPlane(v0) && isOnCutPlane(v1)) {
      unstitched++;
    }
  }
}
console.log("Unstitched cut edges:", unstitched); // must be 0
```

If unstitched > 0, the cap and mesh are using different vertex indices along the cut. Trace which vertex indices the cap references vs which the mesh boundary references at the same positions.
