# Karaslice Geometry Pipeline — Remaining Fixes

Based on actual code review of `Daemonaise/studio` at HEAD (94 commits).

## Already Implemented (no action needed)

These were discussed earlier but are already in the codebase:

- MLS normal orientation via 4-pass BFS (`poisson-reconstruct.ts:197-321`)
- MLS sparse SDF via Map (`poisson-reconstruct.ts:906`)
- MLS vertex + centroid sampling with dedup (`poisson-reconstruct.ts:77-140`)
- MLS RingQueue for BFS (`poisson-reconstruct.ts:26-52`)
- MLS indexed output with `setIndex` (`poisson-reconstruct.ts:984`)
- MLS auto-coarsening when grid exceeds limit (`poisson-reconstruct.ts:886-898`)
- MLS SDF 60-second timeout (`poisson-reconstruct.ts:922,956`)
- Slicer edge cache with `lo*nV+hi` canonical key (`manifold-engine.ts:411-431`)
- Slicer on-plane vertex snapping at eps 1e-10 (`manifold-engine.ts:397-401`)
- Slicer degenerate sub-triangle filter (`manifold-engine.ts:467-470`)
- Slicer per-half vertex compaction (`manifold-engine.ts:477-499`)
- Slicer 30° `toCreasedNormals` on split parts (`manifold-engine.ts:536-549`)
- Ear clipping with 2D projection via Newell's method (`manifold-engine.ts:840-946`)
- Boundary loop walking via directed half-edges (`manifold-engine.ts:960-1072`)
- Exact vertex dedup with uint32 bit-pattern hash (`manifold-engine.ts:1093-1195`)
- Repair: exact dedup first, epsilon weld only as fallback (`manifold-engine.ts:1225-1235`)
- Voxel grid overflow guards with MAX constants (`voxel-reconstruct.ts:66-68`)

## What's Still Broken (4 items)

### Fix 1: Reconstruction output missing creased normals

**Files:** `viewport.tsx:330`, `viewport.tsx:462-468`

**Problem:** `loadRepairedGeometry` calls `loadGeometry` which does `computeVertexNormals()` (line 330). This averages normals across all incident faces including sharp edges, producing the bent/wavy edges seen on repaired parts. The split path applies `toCreasedNormals` at 30° (manifold-engine.ts:536-549) but the reconstruction and repair paths do not.

Same issue in `repairMesh` (line 1291) — ends with `computeVertexNormals()`.

**Fix:** Apply creased normals at the end of `repairMesh`, `pointCloudReconstruct`, and `voxelReconstruct` before returning:

```typescript
const { toCreasedNormals, mergeVertices } = await import(
  "three/examples/jsm/utils/BufferGeometryUtils.js"
);
const merged = g.index ? g : mergeVertices(g);
g = toCreasedNormals(merged, Math.PI / 6);
```

### Fix 2: Ear clipper interior edge conflict

**File:** `manifold-engine.ts:840-946`, `manifold-engine.ts:960-1072`

**Problem:** `earClip2D` checks convexity and point-in-triangle but not whether the diagonal edge (prev → next) already exists as an interior mesh edge. If two cut-plane boundary vertices are already connected by an interior edge, the cap adds a third face → non-manifold. Source of the 12 non-manifold edges on body_part71.

**Fix:** In `fillHoles`, before calling `triangulatePlanar`, build a set of interior edges (edges where both half-edge directions exist in `halfEdgeSet`) whose both vertices lie on the cut plane. Pass this set to `triangulatePlanar` → `earClip2D`. Reject ears whose diagonal matches an interior edge.

```typescript
// Build interior edge set (add after line 989 in fillHoles):
const interiorEdges = new Set<number>();
for (const key of halfEdgeSet) {
  const from = Math.floor(key / nVerts);
  const to = key - from * nVerts;
  if (halfEdgeSet.has(to * nVerts + from)) {
    const lo = Math.min(from, to), hi = Math.max(from, to);
    interiorEdges.add(lo * nVerts + hi);
  }
}

// In earClip2D, before accepting ear (prev, curr, next):
const lo = Math.min(pts_orig_indices[pi], pts_orig_indices[ni]);
const hi = Math.max(pts_orig_indices[pi], pts_orig_indices[ni]);
if (interiorEdges.has(lo * nVerts + hi)) continue; // would create non-manifold
```

### Fix 3: Post-reconstruction processing

**New file:** `taubin-smooth.ts`

**Problem:** Voxel output (block mesh) has stair-stepping and too many triangles. MLS output over-tessellates flat regions. Neither pipeline has smoothing or simplification.

**Implementation:**

1. Taubin smoothing (~80 lines) — alternating lambda/mu passes. Apply to voxel output only (MLS is already smooth from SDF interpolation).

2. Quadric simplification (~400 lines or use meshoptimizer WASM at ~50KB) — reduce flat-region triangles by 60-80% while preserving curvature.

Both controlled by the AI repair plan parameters (`smoothingIterations`, `simplifyTarget`).

### Fix 4: MC ambiguous cases

**File:** `poisson-reconstruct.ts:369-785`

**Problem:** Standard Lorensen & Cline MC table has ambiguous face configurations in cases 3, 6, 7, 10, 12, 13. Adjacent cubes resolving differently produce cracks → non-manifold edges (5,896 on the monocoque).

**Quick fix:** Post-MC scan for edges with 3+ faces, remove lowest-area triangle per conflict. ~50 lines, handles >95% of cases.

**Full fix:** Replace TRI_TABLE with MC33 (Chernyaev 1995) which resolves all ambiguities. Same MC loop, larger table.

## Notes

- `manifold-engine.ts` (1,417 lines) handles repair, splitting, diagnosis, dedup, hole filling, and manifold interop in one file. Consider splitting for maintainability.
- `karaslice-app.tsx` is 181KB. Agents working on geometry vs UI will conflict.
- `repairSplitPart` (line 1312) correctly avoids the full repair pipeline on split parts — good defensive code.
- `diagnoseMesh` gap measurement with percentile-based `recommendedTol` (line 592) is well designed.
