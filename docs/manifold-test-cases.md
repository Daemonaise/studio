# Manifold Test Cases

This document summarizes the test coverage added for the Manifold integration in [tests/manifold-engine.test.mjs](/home/user/studio/tests/manifold-engine.test.mjs).

Run the suite with:

```bash
npm run test:manifold
```

## Covered Cases

### `viewportPlaneToEngine` maps normalized cut planes into world-space offsets

- Verifies `x`, `y`, and `z` viewport cut planes are converted into the correct `EngineCutPlane`.
- Confirms normalized positions are applied relative to the mesh bounding box.

### `computeGeometryVolume` returns consistent volume for indexed and non-indexed meshes

- Uses a simple box mesh.
- Verifies the volume calculation is stable regardless of geometry indexing layout.

### `repairSplitPart` removes duplicate and degenerate triangles

- Uses a synthetic mesh containing:
  - one duplicated triangle
  - one degenerate triangle
- Verifies:
  - `degeneratesRemoved`
  - `duplicatesRemoved`
  - progress callback sequencing

### `repairSplitPart` preserves valid watertight solids

- Uses a closed tetrahedron with valid topology.
- Verifies:
  - no unnecessary cleanup is reported
  - `isWatertight === true`
  - volume remains correct after repair

### `repairMesh` seals a subtle open hole

- Uses a tetrahedron with one face missing.
- This models a mesh that can appear visually reasonable while still being open.
- Verifies:
  - `holesFilled > 0`
  - `isWatertight === true` after repair

### `repairMesh` fixes a single flipped face on an otherwise closed solid

- Uses a closed tetrahedron where one triangle has inconsistent winding.
- This models geometry that can render plausibly but fail manifold validation.
- Verifies:
  - `windingFixed > 0`
  - `isWatertight === true`

### `repairMesh` detects and corrects globally inverted winding

- Uses a fully closed tetrahedron with all triangle winding reversed.
- Verifies:
  - `invertedNormalsFixed === true`
  - `isWatertight === true`
  - volume remains correct after repair

### `repairMesh` welds tiny positional seams before further repair

- Uses a tetrahedron where one face references a near-duplicate vertex offset by `0.001 mm`.
- This models CAD/STL seams that are visually closed but topologically open.
- Verifies:
  - `weldToleranceMM > 0`
  - no hole fill is needed once the seam is welded
  - `isWatertight === true`
  - volume remains correct after repair

## Why These Cases Matter

These tests are aimed at meshes that may look fine in a viewport but are structurally corrupted:

- hidden open boundaries
- inconsistent face winding
- globally inverted normals
- duplicate faces
- degenerate triangles

They do not yet cover every failure mode. Notably still uncovered:

- self-intersections
- non-manifold edges shared by 3+ triangles
- multi-component corrupted meshes
