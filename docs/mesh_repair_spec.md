
# Mesh Repair & Reconstruction Specification
### Target: Corrupted or Hand-Repaired Triangle Meshes (OBJ/STL/PLY)

Author: Generated specification for topology-first mesh repair engines.

---

# Overview

Many meshes that appear visually correct in viewers are **topologically corrupted**. 
Common issues include:

- Open boundaries
- Non‑manifold edges
- Fragmented components
- Sliver triangles
- Duplicate faces
- Interior floating geometry
- Patch artifacts from manual editing

A robust repair engine must prioritize **topology reconstruction and geometric inference**, 
not just vertex welding.

The architecture described below is designed for:

- corrupted CAD exports
- hand‑patched meshes
- photogrammetry artifacts
- Netfabb / manual STL repairs
- partially reconstructed engineering models

---

# High Level Architecture

The engine should consist of three major layers:

1. Deterministic Mesh Sanitation
2. Geometric Inference
3. Surface Reconstruction

```
          Raw Mesh Input
                 │
                 ▼
      ┌────────────────────────┐
      │ Layer 1: Sanitation    │
      │ Connectivity Repair    │
      └────────────────────────┘
                 │
                 ▼
      ┌────────────────────────┐
      │ Layer 2: Inference     │
      │ Surface Intent         │
      └────────────────────────┘
                 │
                 ▼
      ┌────────────────────────┐
      │ Layer 3: Reconstruction│
      │ Patch + Remesh         │
      └────────────────────────┘
                 │
                 ▼
            Final Mesh
```

---

# Data Structures

Recommended internal representation:

### Half Edge Mesh
Allows fast access to:

- edge adjacency
- boundary detection
- face neighborhood
- manifold validation

Key Structures:

```
Vertex
Edge
HalfEdge
Face
Component
BoundaryLoop
```

Auxiliary structures:

```
NonManifoldEdgeRegistry
BoundaryLoopGraph
ComponentHierarchy
SurfaceCluster
```

---

# Processing Pipeline

## Stage 1 — Canonical Import

### Module: `MeshParser`

Responsibilities:

- Parse OBJ/STL/PLY
- Normalize vertex list
- Resolve face indices
- Build half-edge structure

Algorithms:

- Face winding normalization
- Vertex index validation
- Edge incidence counting

Outputs:

```
MeshGraph
VertexList
FaceList
EdgeList
```

---

# Stage 2 — Deterministic Sanitation

## Module: `DuplicateFaceResolver`

Purpose:

Remove exact face duplicates.

Algorithm:

```
hash(face.vertex_ids)
remove duplicates
```

Complexity:

```
O(F)
```

---

## Module: `ComponentExtractor`

Purpose:

Identify disconnected shells.

Algorithm:

Breadth First Search over face adjacency.

```
for each unvisited face:
    BFS across shared edges
    mark component
```

Outputs:

```
ComponentSet
ComponentBoundingBoxes
ComponentVolumes
```

---

## Module: `ComponentClassifier`

Purpose:

Separate meaningful geometry from debris.

Classification metrics:

- face count
- bounding box volume
- centroid distance
- surface area

Heuristics:

```
if face_count < threshold:
    mark as debris

if bounding_volume << main_body:
    mark as scrap
```

---

## Module: `NonManifoldDetector`

Purpose:

Identify edges shared by more than two faces.

Algorithm:

```
for edge in edges:
    if incident_faces > 2:
        register nonmanifold
```

Outputs:

```
NonManifoldEdgeRegistry
```

---

## Module: `NonManifoldResolver`

Purpose:

Resolve ambiguous edge connectivity.

Strategy:

1. Cluster incident faces by normal direction
2. Compute angular deviation
3. Select the most coherent cluster

Pseudocode:

```
cluster faces by normal similarity
choose cluster with lowest curvature variance
detach remaining faces
```

---

# Stage 3 — Boundary Analysis

## Module: `BoundaryEdgeDetector`

Purpose:

Find open edges.

```
if edge.incident_faces == 1:
    mark boundary
```

---

## Module: `BoundaryLoopExtractor`

Purpose:

Group boundary edges into loops.

Algorithm:

Edge traversal.

```
while boundary edges remain:
    walk until loop closes
```

Outputs:

```
BoundaryLoopSet
```

---

## Module: `LoopClassifier`

Purpose:

Determine meaning of each boundary.

Possible categories:

- design opening
- seam tear
- failed patch
- trim boundary

Features used:

- loop length
- curvature continuity
- planar deviation
- proximity to other loops

---

# Stage 4 — Mesh Conditioning

## Module: `SliverTriangleDetector`

Purpose:

Find degenerate triangles.

Metric:

```
edge_ratio = longest_edge / shortest_edge
```

Thresholds:

```
ratio > 20 : bad
ratio > 50 : severe
```

---

## Module: `EdgeCollapseOptimizer`

Purpose:

Improve triangle quality.

Algorithm:

Iterative edge collapse:

```
if edge_length < tolerance:
    collapse
```

Constraints:

- preserve sharp features
- avoid boundary damage

---

## Module: `FeatureEdgeDetector`

Purpose:

Detect hard edges.

Metric:

```
dihedral_angle > threshold
```

Used for preserving mechanical features.

---

# Stage 5 — Surface Inference

## Module: `SeamPairingEngine`

Purpose:

Detect loops that represent the same missing surface.

Features:

- loop shape similarity
- normal direction
- centroid distance
- perimeter similarity

Algorithm:

```
compare loops
compute similarity score
pair likely seams
```

---

## Module: `CurvatureEstimator`

Purpose:

Estimate intended surface shape.

Methods:

- quadric fitting
- MLS (Moving Least Squares)
- local tangent plane solve

Outputs:

```
surface field
curvature map
```

---

# Stage 6 — Reconstruction

## Module: `HolePatchSolver`

Purpose:

Fill missing surfaces.

Strategies:

Small holes:

```
triangle fan
minimal surface
```

Large holes:

```
curvature aware patching
Poisson surface reconstruction
MLS surface continuation
```

---

## Module: `LocalRemesher`

Purpose:

Improve mesh quality after patching.

Algorithms:

- isotropic remeshing
- edge flipping
- vertex relocation

Goal:

Maintain curvature while improving triangle quality.

---

## Module: `FairingSolver`

Purpose:

Smooth repaired surfaces.

Method:

Laplacian smoothing with feature constraints.

```
v_new = average(neighbor vertices)
```

Feature edges remain fixed.

---

# Stage 7 — Validation

## Module: `MeshValidator`

Checks:

- manifoldness
- watertightness
- triangle quality
- normal consistency
- self intersections

---

# Stage 8 — Export

## Module: `MeshExporter`

Outputs:

```
RepairedMesh.obj
RejectedFragments.obj
RepairReport.json
```

---

# Repair Report

The engine should generate a diagnostic report.

Example:

```
Vertices: 275201
Faces: 512895

Components detected: 504
Components removed: 285

Duplicate faces removed: 46
Non-manifold edges fixed: 2315

Boundary loops detected: 41653
Holes patched: 312
Unresolved regions: 12

Mesh status: WATERTIGHT
Confidence score: 0.87
```

---

# Recommended Algorithms Summary

| Task | Algorithm |
|-----|-----|
Component detection | BFS / DFS |
Non-manifold resolution | normal clustering |
Hole filling | minimal surface / Poisson |
Surface inference | MLS / quadric fitting |
Remeshing | isotropic remesh |
Feature detection | dihedral threshold |
Triangle quality | edge ratio metric |

---

# Future Extensions

Advanced engines may also include:

- symmetry detection
- parametric surface fitting
- CAD surface reconstruction (NURBS)
- ML-based repair prediction
- volumetric reconstruction (SDF)

---

# Key Principle

The most important concept:

**Repair topology before geometry.**

Meshes that look visually correct often fail computationally because the underlying topology is inconsistent.

A topology‑first repair pipeline produces far more reliable results than simple vertex welding or blind hole filling.

