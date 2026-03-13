# SLICER DEBUG: Jagged Edges Still Present

## The sawtooth is still there. That means vertex indices are STILL not shared between cap faces and mesh faces along the cut line. One of the following is true:

---

## DIAGNOSTIC: Add this logging IMMEDIATELY after slicing + capping, before rendering.

```typescript
// After slice + cap + buildTwins, run this on the resulting mesh:
function debugCutBoundary(mesh, plane) {
  const EPSILON = 1e-6;
  
  function isOnPlane(vIdx) {
    const x = mesh.positions[vIdx * 3];
    const y = mesh.positions[vIdx * 3 + 1];  
    const z = mesh.positions[vIdx * 3 + 2];
    const dist = plane.normal[0]*x + plane.normal[1]*y + plane.normal[2]*z - plane.d;
    return Math.abs(dist) < EPSILON;
  }

  let totalBoundary = 0;
  let cutPlaneBoundary = 0;
  
  for (let he = 0; he < mesh.halfedgeCount; he++) {
    if (mesh.heTwin[he] === -1 && mesh.heFace[he] !== -1) {
      totalBoundary++;
      const v0 = mesh.heOrigin(he);
      const v1 = mesh.heVertex[he];
      if (isOnPlane(v0) && isOnPlane(v1)) {
        cutPlaneBoundary++;
        if (cutPlaneBoundary <= 5) {
          console.log(`Unstitched cut edge: v${v0} (${mesh.positions[v0*3].toFixed(6)}, ${mesh.positions[v0*3+1].toFixed(6)}, ${mesh.positions[v0*3+2].toFixed(6)}) → v${v1}`);
        }
      }
    }
  }

  // CHECK FOR DUPLICATE VERTICES AT SAME POSITION
  const posMap = new Map();
  let duplicates = 0;
  for (let v = 0; v < mesh.vertexCount; v++) {
    if (!isOnPlane(v)) continue;
    const key = mesh.positions[v*3].toFixed(10) + "," + mesh.positions[v*3+1].toFixed(10) + "," + mesh.positions[v*3+2].toFixed(10);
    if (posMap.has(key)) {
      duplicates++;
      if (duplicates <= 5) {
        console.log(`DUPLICATE VERTEX on cut plane: index ${posMap.get(key)} and index ${v} both at ${key}`);
      }
    } else {
      posMap.set(key, v);
    }
  }

  console.log(`Total boundary halfedges: ${totalBoundary}`);
  console.log(`Boundary halfedges on cut plane: ${cutPlaneBoundary}`);  
  console.log(`Duplicate vertices on cut plane: ${duplicates}`);
  console.log(`Expected: all three should be 0`);
}
```

## RUN THE DIAGNOSTIC FIRST. The output tells you exactly which fix to apply:

### If "Duplicate vertices on cut plane" > 0:
The cap is creating new vertices instead of reusing existing ones. Find where cap vertices are created and replace with index reuse. Search the codebase for any call to `addVertex` or `push(new Vector3` or `positions.push` that happens AFTER triangle splitting during the cap creation phase. That call must be removed. The cap must only use vertex indices that already exist from the splitting step.

### If "Boundary halfedges on cut plane" > 0 but "Duplicate vertices" = 0:
The vertices are shared but the cap winding is wrong. The cap faces are wound in the same direction as the mesh boundary instead of the opposite direction. Flip the cap triangle winding: swap the second and third vertex of every cap triangle.

### If BOTH are 0 but jagged edges still visible:
The geometry is correct. The problem is the NORMALS. The vertex normals at the cut boundary are being averaged between the cap face (normal = cut plane normal) and the mesh faces (normals pointing outward along the surface). This average creates tilted normals that cause shading artifacts.

Fix: Use FLAT SHADING along the cut boundary, or split the normals:
```typescript
// Option A: Use flat shading for the entire mesh (simplest)
// In Three.js:
material.flatShading = true;

// Option B: Split vertices at cut boundary for separate normals
// During render buffer creation, vertices on the cut plane that are shared 
// between cap faces and mesh faces need to be DUPLICATED in the render buffer
// (not in the halfedge mesh) with different normals:
// - Copy 1: normal from mesh face averaging (for mesh triangles)
// - Copy 2: normal = cut plane normal (for cap triangles)
// This is purely a rendering split, not a topology split.
```

---

## MOST LIKELY ROOT CAUSE IF PREVIOUS FIXES WERE APPLIED:

The code probably builds the sliced mesh as a Three.js BufferGeometry using NON-INDEXED mode (every triangle gets its own 3 vertices). In non-indexed mode, there ARE no shared vertices at the GPU level — every triangle is independent. Even if the halfedge structure shares vertices perfectly, converting to a non-indexed render buffer destroys that sharing.

**Check your BufferGeometry construction.** If you see anything like this:

```typescript
// NON-INDEXED (causes jagged edges even with correct topology)
for each face:
  positions.push(v0.x, v0.y, v0.z)  // vertex copy 1
  positions.push(v1.x, v1.y, v1.z)  // vertex copy 2  
  positions.push(v2.x, v2.y, v2.z)  // vertex copy 3
geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
// NO geometry.setIndex() call = non-indexed = no vertex sharing
```

**Replace with indexed rendering:**

```typescript
// INDEXED (preserves vertex sharing, smooth normals at shared edges)
const positions = new Float32Array(vertexCount * 3);
const normals = new Float32Array(vertexCount * 3);  
const indices = new Uint32Array(faceCount * 3);

// One entry per unique vertex
for (let v = 0; v < vertexCount; v++) {
  positions[v*3] = mesh.positions[v*3];
  positions[v*3+1] = mesh.positions[v*3+1]; 
  positions[v*3+2] = mesh.positions[v*3+2];
}

// Face indices reference shared vertices
for (let f = 0; f < faceCount; f++) {
  indices[f*3] = face[f].v0;
  indices[f*3+1] = face[f].v1;
  indices[f*3+2] = face[f].v2;
}

// Compute per-vertex normals (area-weighted average of incident faces)
for (let f = 0; f < faceCount; f++) {
  const faceNormal = computeFaceNormal(f);
  normals[indices[f*3]*3] += faceNormal.x;     // accumulate onto shared vertex
  normals[indices[f*3]*3+1] += faceNormal.y;
  normals[indices[f*3]*3+2] += faceNormal.z;
  // ... same for other two vertices
}
// normalize all vertex normals

geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
geometry.setAttribute('normal', new Float32BufferAttribute(normals, 3));
geometry.setIndex(new BufferAttribute(indices, 1));  // THIS LINE IS CRITICAL
```

The `setIndex()` call is what tells Three.js that multiple faces share the same vertex. Without it, every face gets independent vertices and independent normals, which means the cut boundary will always have discontinuous normals → sawtooth shading.
