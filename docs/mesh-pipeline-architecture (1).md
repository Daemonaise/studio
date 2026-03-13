# Client-Side Mesh Repair & Slicing Pipeline — Architecture

## Design Principles

1. **Zero cloud dependency** — everything runs in-browser via Web Workers + optional WASM
2. **Float64 canonical representation** — only downcast to Float32 at the WebGL render boundary
3. **Halfedge as the single source of truth** — all operations (repair, slice, CSG) read/write the same structure
4. **Manifold invariants enforced at the data structure level** — operations that would break manifold-ness fail explicitly rather than producing corrupt output
5. **Manifold Engine used ONLY for CSG** — never for repair

---

## System Architecture

```
┌─────────────────────────────────────────────────────────┐
│  React UI Layer                                         │
│  ┌──────────┐  ┌──────────┐  ┌──────────────────────┐  │
│  │ File     │  │ Viewport │  │ Slice/Repair         │  │
│  │ Import   │  │ (Three)  │  │ Controls             │  │
│  └────┬─────┘  └────▲─────┘  └──────────┬───────────┘  │
│       │              │                   │              │
│  ─────┼──────────────┼───────────────────┼──────────────│
│       ▼              │                   ▼              │
│  ┌─────────────────────────────────────────────────┐    │
│  │  MeshManager (main thread)                      │    │
│  │  - Holds render buffers (Float32)               │    │
│  │  - Dispatches operations to worker              │    │
│  │  - Receives updated buffers for Three.js        │    │
│  └────────────────────┬────────────────────────────┘    │
│                       │ postMessage (Transferable)      │
└───────────────────────┼─────────────────────────────────┘
                        │
┌───────────────────────┼─────────────────────────────────┐
│  Web Worker           ▼                                 │
│  ┌─────────────────────────────────────────────────┐    │
│  │  GeometryKernel (Float64 throughout)            │    │
│  │                                                 │    │
│  │  ┌──────────────┐                               │    │
│  │  │  HalfEdgeMesh │◄── canonical representation  │    │
│  │  └──────┬───────┘                               │    │
│  │         │                                       │    │
│  │  ┌──────┴───────────────────────────────┐       │    │
│  │  │          Pipeline Stages             │       │    │
│  │  │                                      │       │    │
│  │  │  1. Import & Indexing                │       │    │
│  │  │  2. Topology Analysis                │       │    │
│  │  │  3. Winding Repair                   │       │    │
│  │  │  4. Hole Detection & Fill            │       │    │
│  │  │  5. Non-Manifold Resolution          │       │    │
│  │  │  6. Validation                       │       │    │
│  │  │                                      │       │    │
│  │  │  7. Slice (plane intersection)       │       │    │
│  │  │  8. Contour Extraction               │       │    │
│  │  │  9. Cap Triangulation                │       │    │
│  │  │ 10. Post-Slice Validation            │       │    │
│  │  └──────────────────────────────────────┘       │    │
│  │                                                 │    │
│  │  ┌──────────────┐                               │    │
│  │  │  Manifold    │◄── CSG only, clean mesh in    │    │
│  │  │  (WASM)      │                               │    │
│  │  └──────────────┘                               │    │
│  └─────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────┘
```

---

## Data Structures

### HalfEdgeMesh (Float64)

```
Vertex:
  position: [f64; 3]
  halfedge: index        // one outgoing halfedge

HalfEdge:
  vertex: index           // vertex this HE points TO
  face: index | -1        // face to the left (-1 = boundary)
  next: index             // next HE in face loop
  prev: index             // previous HE in face loop
  twin: index | -1        // opposite HE (-1 = boundary/non-manifold)

Face:
  halfedge: index         // one HE on this face
```

All stored in flat typed arrays for cache locality:
- `vertexPositions: Float64Array`   (n * 3)
- `vertexHalfedge: Int32Array`      (n)
- `heVertex: Int32Array`            (m)
- `heFace: Int32Array`              (m)
- `heNext: Int32Array`              (m)
- `hePrev: Int32Array`              (m)
- `heTwin: Int32Array`              (m)
- `faceHalfedge: Int32Array`        (f)

### Why flat arrays instead of objects

A 100K-triangle mesh = ~150K halfedges. Object-based HE representations create ~450K heap objects (vertex + HE + face), which kills GC and cache performance in JS. Flat typed arrays are transferable between worker and main thread at zero copy cost.

---

## Repair Pipeline — Stage Details

### Stage 1: Import & Exact Indexing

**Problem:** STL/OBJ files store per-face vertices. We need shared vertices, but epsilon welding destroys precision.

**Solution:** Hash-based exact matching on raw float64 bit patterns.

```
key = bitCast(x) ^ (bitCast(y) * 73856093) ^ (bitCast(z) * 19349663)
```

Use `BigInt64Array` view of the `Float64Array` to get exact bit patterns. Two vertices are shared if and only if all three coordinates are bitwise identical. No epsilon. No tolerance. If the original file intended them to be the same vertex, they'll have the same bits.

**Why this works:** STL/OBJ exporters write the same float value for shared vertices. They don't add noise. If two vertices were the same in the source CAD model, they got the same IEEE754 bits written to disk.

### Stage 2: Topology Analysis

Build the halfedge structure and classify every edge:

| Edge type | HE twin count | Action |
|---|---|---|
| Manifold interior | 2 | None needed |
| Boundary (open) | 1 | Mark for hole filling |
| Non-manifold | 3+ | Split to resolve |
| Isolated (dangling) | 0 | Delete |

Also detect:
- Disconnected components (flood-fill via face adjacency)
- Self-intersecting face pairs (BVH broad phase → triangle–triangle narrow phase)

### Stage 3: Winding Repair

Flood-fill from a seed face, propagating winding order through twin halfedges:

```
for each unvisited face F:
  seed F into queue
  while queue not empty:
    F = dequeue
    for each halfedge H in F:
      T = twin(H)
      if T.face unvisited:
        if H.vertex == T.vertex:  // same direction = inconsistent
          flip T.face winding
        mark T.face visited, enqueue
```

After component winding is consistent internally, determine outward orientation:
- Cast a ray from the centroid of any face along its normal
- Count intersections with the rest of the mesh (using BVH)
- Odd count = normal points inward → flip entire component

### Stage 4: Hole Detection & Filling

Walk boundary halfedges (those with twin == -1) to extract closed loops:

```
start at any boundary HE
follow next until you return to start
collect the loop
```

Triangulate each loop:
- **Small holes (≤ 8 edges):** Ear clipping. O(n²) but n is small.
- **Large holes (> 8 edges):** Project loop onto best-fit plane, run constrained Delaunay on the 2D projection, map triangles back to 3D. This avoids skinny triangles.

**Critical:** After filling, insert new halfedges and twins for the new triangles. Verify every new edge has exactly 2 faces.

### Stage 5: Non-Manifold Resolution

For edges shared by 3+ faces:
1. Identify the cluster of faces sharing the edge
2. For each pair, compute dihedral angle to the reference face
3. Sort by angle, pair faces into manifold pairs (adjacent in angle order)
4. Duplicate the edge vertices for extra pairs, creating separate manifold edges

For non-manifold vertices (vertex shared by two+ separate fan components):
1. Walk the face-fan around the vertex via halfedge next/twin
2. If the fan doesn't close (you can't traverse all incident faces), the vertex connects separate surface patches
3. Duplicate the vertex, one copy per connected fan component

### Stage 6: Validation

Run a full consistency check:
- Every halfedge has a valid twin, and twin(twin(he)) == he
- Every edge has exactly 2 faces
- Every vertex has a closed fan (or is marked as intentional boundary)
- Euler characteristic check: V - E + F = 2 * (num_shells - num_holes)
- No self-intersections (BVH re-check)

If validation fails, report exactly which invariant broke and which elements are involved. Do NOT silently "fix" — surface the error.

---

## Slicing Pipeline — Stage Details

### The non-manifold problem in slicing

When you cut a closed mesh with a plane, you create two open meshes. The open boundary is the cut contour. If you don't cap it, you have boundary edges (non-manifold for printing). If you cap naively, you can create:

1. **T-junctions** — cap triangles that share an edge with a split triangle but not at its exact split point
2. **Duplicate edges** — cap shares an edge with the mesh, creating 3 faces on that edge
3. **Self-intersecting caps** — concave cross-sections triangulated without constraints

### Stage 7: Plane Intersection

For each triangle, classify its three vertices against the plane `dot(normal, vertex) - d`:

| Classification | Action |
|---|---|
| All positive | Keep (or discard, depending on which half) |
| All negative | Discard (or keep) |
| Mixed | Split triangle along plane |

**Robustness:** Use a signed-distance epsilon of ~1e-10 (Float64 gives you room). Vertices within epsilon are snapped exactly onto the plane. This prevents sliver triangles at the cut boundary.

**Split mechanics:** For a triangle with vertices (A+, B+, C-) where + is above and - is below:

```
P1 = intersect(edge AC, plane)
P2 = intersect(edge BC, plane)

Above half:  triangle(A, B, P2), triangle(A, P2, P1)
Below half:  triangle(C, P1, P2)
```

Insert P1, P2 as new vertices. Create proper halfedges for all new triangles. The edge P1→P2 is the cut edge and will become part of the cap boundary.

### Stage 8: Contour Extraction

After splitting, collect all edges that lie on the cut plane. These form one or more closed loops (the cross-section contour).

**Method:**
1. All new edges created during splitting whose both endpoints are on the plane → contour edges
2. Walk these edges into closed loops (same algorithm as boundary detection in Stage 4)
3. Handle nested loops: if the cross-section has holes (e.g., slicing a hollow cylinder), you'll get an outer loop and inner loops. Determine nesting by point-in-polygon tests on the 2D projection.

### Stage 9: Cap Triangulation

**This is where most slicers introduce non-manifold garbage.**

Correct approach:
1. Project all contour loops onto the cut plane (already coplanar, just need a 2D coordinate system)
2. Run **constrained Delaunay triangulation** on the 2D points with the contour edges as constraints
   - Use a robust CDT library or implement ear clipping with constraint edges
   - For nested loops (holes), include inner loops as hole boundaries in the CDT
3. Map resulting triangles back to 3D (they're on the plane, so just apply the inverse projection)
4. **Orient cap faces** so their normal points outward (away from the kept half)
5. **Stitch cap edges to the mesh boundary** — every cap boundary edge must become the twin of the corresponding mesh boundary halfedge from the split. Do NOT create new edges; reuse the existing boundary halfedges.

**The critical stitching step in detail:**

```
for each cap boundary edge (v1, v2):
  find the mesh boundary halfedge H where H goes from v2 to v1
    (opposite direction because the cap faces the other way)
  set twin(cap_he) = H
  set twin(H) = cap_he
```

After stitching, there should be zero boundary edges on the capped half. Every edge has exactly 2 faces.

### Stage 10: Post-Slice Validation

Run the same validation as Stage 6 on each resulting half:
- No boundary edges (all capped)
- No non-manifold edges
- Consistent winding
- Euler characteristic check

---

## Keeping It Lightweight — Recommended Stack

### Core (must have)
| Component | Purpose | Size |
|---|---|---|
| Custom HalfEdgeMesh (TS) | Canonical geometry kernel | ~15KB gzipped |
| Web Worker | Off-main-thread compute | 0KB (built-in) |
| Three.js (tree-shaken) | Render only | ~80KB gzipped (core + WebGLRenderer + BufferGeometry) |
| three-mesh-bvh | Spatial queries, raycasting | ~25KB gzipped |

### Optional (add only if needed)
| Component | Purpose | Size |
|---|---|---|
| Manifold WASM | CSG boolean ops on clean meshes | ~200KB gzipped |
| earcut | 2D triangulation for cap filling | ~3KB gzipped |
| robust-predicates | Exact orientation/incircle tests | ~2KB gzipped |

### What to skip entirely
- **OpenCascade.js / OCCT WASM** — 5+ MB, massively overkill
- **libigl WASM ports** — large, fragile, limited JS interop
- **Server-side anything** — unnecessary for this pipeline

### Performance architecture

```
Main Thread                          Worker Thread
─────────────                        ─────────────
User drops STL
  │
  ├─ parse header, get byte length
  │
  ├─ Transfer ArrayBuffer ──────────► Receive ArrayBuffer
  │   (zero copy)                     │
  │                                   ├─ Parse into Float64 HalfEdgeMesh
  │                                   ├─ Run repair pipeline
  │                                   ├─ Build Float32 render buffer
  │                                   │
  │  ◄── Transfer Float32 buffer ─────┤  (zero copy back)
  │
  ├─ Set as Three.js BufferGeometry
  │
  ▼
User requests slice
  │
  ├─ Send plane params ─────────────► Receive plane params
  │                                   │
  │                                   ├─ Run slice on Float64 HalfEdgeMesh
  │                                   ├─ Run post-slice validation
  │                                   ├─ Build Float32 render buffers (×2 halves)
  │                                   │
  │  ◄── Transfer both buffers ───────┤
  │
  ├─ Update Three.js scene (two meshes)
  ▼
```

**Key:** `ArrayBuffer.transfer()` / `postMessage` with transferable list. No serialization, no copying. The Float64 canonical mesh lives permanently in the worker. The main thread only ever sees Float32 render buffers.

---

## File Structure

```
src/
  geometry/
    halfedge.ts          // HalfEdgeMesh class, flat typed arrays
    topology.ts          // boundary detection, component analysis, edge classification
    winding.ts           // flood-fill winding repair + ray-cast orientation
    holes.ts             // boundary loop extraction + ear clipping / CDT fill
    nonmanifold.ts       // edge/vertex splitting for non-manifold resolution
    validate.ts          // full invariant checker
    bvh.ts               // thin wrapper around three-mesh-bvh for intersection queries
    slice.ts             // plane intersection, contour extraction, cap triangulation, stitching
    importers/
      stl.ts             // binary + ASCII STL → indexed Float64 mesh
      obj.ts             // OBJ → indexed Float64 mesh
      threemf.ts         // 3MF XML → indexed Float64 mesh (if needed)
    exporters/
      stl.ts             // HalfEdgeMesh → binary STL
      obj.ts             // HalfEdgeMesh → OBJ
  worker/
    geometry.worker.ts   // Web Worker entry, message handler, orchestrates pipeline
  render/
    MeshManager.ts       // Main thread: holds Three.js objects, dispatches to worker
    viewport.tsx         // React component: Three.js canvas, orbit controls
  ui/
    RepairPanel.tsx      // Repair controls + diagnostic readout
    SlicePanel.tsx       // Slice plane controls (position, normal, preview)
    FileImport.tsx       // Drag-and-drop import
```

---

## What This Replaces

| Before (Manifold self-union hack) | After (this pipeline) |
|---|---|
| Retessellates entire mesh | Modifies only defective regions |
| Destroys sharp features | Preserves original triangulation where valid |
| Uncontrolled vertex explosion | Vertex count changes only at repaired sites |
| Float32 round-trips through Three.js | Float64 until final render buffer |
| Silent corruption | Explicit validation with error reporting |
| Slicing re-runs repair (more damage) | Slicing operates on already-validated HE mesh with guaranteed stitching |
