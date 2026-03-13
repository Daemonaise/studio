# Fix: Shell-Aware Reconstruction + AI Pre-Analysis

## Why solid voxelization fails on this file

The monocoque is a THIN SHELL — a single layer of surface with intentional 
openings (windows, doors, wheel arches). Solid voxelization assumes the mesh 
encloses a volume. When it flood-fills from outside, any opening blocked by 
broken geometry becomes unreachable → treated as interior → filled solid.

Result: windows filled in, interior cavity becomes a solid block, 1.3M 
triangles of solid brick instead of a thin car body.

## Solution: Two-path reconstruction with AI-assisted routing

```
User drops file
  │
  ├─ Initial topology analysis (edge counts, shell detection)
  │
  ├─ AI ANALYSIS (Anthropic API call with mesh stats + viewport screenshot)
  │   │
  │   ├─ Returns: { meshType, repairStrategy, notes }
  │   │   meshType: "solid_body" | "thin_shell" | "multi_body" | "surface_patch"
  │   │   repairStrategy: "topology_repair" | "solid_voxel" | "shell_voxel" | "manual"
  │   │
  │   ▼
  ├─ Route to correct repair:
  │   ├─ topology_repair → existing halfedge pipeline (minor defects)
  │   ├─ solid_voxel    → volume flood fill + marching cubes (solid parts)
  │   ├─ shell_voxel    → surface-only voxelization (thin shells, THIS FIX)
  │   └─ manual         → flag for user, too ambiguous to auto-repair
  │
  ▼
  Clean manifold output
```

---

## Part 1: AI Pre-Analysis (Anthropic API call)

Call Claude from the app with mesh statistics and optionally a viewport 
screenshot. Claude classifies the mesh and recommends a repair strategy.

```typescript
async function analyzeMeshWithAI(
  stats: {
    triangles: number;
    vertices: number;
    openEdges: number;
    nonManifoldEdges: number;
    boundingBox: { x: number; y: number; z: number };
    surfaceArea: number;
    volume: number;
    shells: number;
    avgWallThickness: number | null; // estimated from ray casting
    fileName: string;
  },
  screenshotBase64?: string  // optional viewport capture
): Promise<{
  meshType: "solid_body" | "thin_shell" | "multi_body" | "surface_patch";
  repairStrategy: "topology_repair" | "solid_voxel" | "shell_voxel" | "manual";
  confidence: number;
  reasoning: string;
  warnings: string[];
}> {

  const systemPrompt = `You are a 3D mesh analysis assistant. Given mesh statistics 
and optionally a screenshot, classify the mesh type and recommend a repair strategy.

MESH TYPES:
- solid_body: Enclosed solid object (engine block, bracket, solid part). 
  Has definable interior volume. Surface area to volume ratio is low.
- thin_shell: Single-layer surface (car body panel, sheet metal, monocoque). 
  No meaningful interior volume. Surface area to volume ratio is very high.
  May have intentional openings (windows, doors, cutouts).
- multi_body: Multiple separate solid bodies in one file (assembly export).
  Multiple disconnected shells, each roughly manifold.
- surface_patch: Open surface that isn't meant to be watertight (aerodynamic 
  surface, terrain mesh, scan data). Large percentage of boundary edges.

REPAIR STRATEGIES:
- topology_repair: For meshes with <1% defective edges. Fast, preserves geometry exactly.
- solid_voxel: For broken solid bodies. Voxelize + flood fill + marching cubes. 
  Fills interior solid. NEVER use on thin shells (fills windows/openings).
- shell_voxel: For broken thin shells. Surface-only voxelization + dilation + 
  marching cubes. Preserves openings, thickens shell to make watertight.
- manual: Too ambiguous or complex. Flag for user intervention.

KEY DIAGNOSTIC RATIOS:
- Surface area / volume ratio: High = thin shell, Low = solid body
- Open edges / total edges: >5% = severely broken, <0.1% = minor defects
- Wall thickness estimate: <2 voxels at any resolution = thin shell

Respond with a JSON object only. No markdown, no backticks.`;

  const userContent: any[] = [
    {
      type: "text",
      text: `Analyze this 3D mesh:
File: ${stats.fileName}
Triangles: ${stats.triangles}
Vertices: ${stats.vertices}
Bounding box: ${stats.boundingBox.x.toFixed(1)} x ${stats.boundingBox.y.toFixed(1)} x ${stats.boundingBox.z.toFixed(1)} mm
Surface area: ${stats.surfaceArea.toFixed(0)} mm²
Volume: ${stats.volume.toFixed(0)} mm³
SA/Volume ratio: ${(stats.surfaceArea / stats.volume).toFixed(4)}
Open edges: ${stats.openEdges} (${(stats.openEdges / (stats.triangles * 1.5) * 100).toFixed(1)}% of total)
Non-manifold edges: ${stats.nonManifoldEdges}
Disconnected shells: ${stats.shells}
${stats.avgWallThickness ? `Estimated wall thickness: ${stats.avgWallThickness.toFixed(1)} mm` : 'Wall thickness: unknown'}

Classify this mesh and recommend a repair strategy.`
    }
  ];

  // Add screenshot if available
  if (screenshotBase64) {
    userContent.unshift({
      type: "image",
      source: {
        type: "base64",
        media_type: "image/png",
        data: screenshotBase64,
      }
    });
  }

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1000,
      system: systemPrompt,
      messages: [{ role: "user", content: userContent }],
    }),
  });

  const data = await response.json();
  const text = data.content[0].text;
  return JSON.parse(text);
}
```

### What the AI catches that heuristics miss:

- A file named "monocoque.obj" with SA/Volume ratio of 0.093 → thin shell
- A viewport screenshot showing a car body with windows → definitely thin shell
- An ambiguous box-like shape → AI can reason about whether openings are 
  intentional (windows) or defects (missing faces)
- Multi-body assemblies where some parts are solid and others are shells

---

## Part 2: Shell-Aware Voxelization (the actual fix)

Instead of volume-based flood fill, do SURFACE-ONLY reconstruction:

### Algorithm: Surface Voxelization + Dilation + Surface Extraction

```
1. Mark voxels that original triangles pass through (surface voxels only)
   - Do NOT flood fill interior
   - Just rasterize each triangle into the grid

2. Dilate the surface by 1 voxel in all directions
   - This closes small gaps (< 2 voxels wide)
   - Bridges discontinuities between overlapping patches
   - Gives the shell actual thickness (1-2 voxels)

3. Extract surface via marching cubes on the dilated shell
   - The output is a thickened version of the original surface
   - Windows and openings wider than 2 voxels are preserved
   - The shell is watertight because dilation closes all small gaps
```

### Why this works:

- Windows are typically 500+ mm wide. At 5mm resolution = 100 voxels.
  Dilation of 1 voxel doesn't come close to filling a 100-voxel opening.
- Small gaps between overlapping panels are typically 0-2mm.
  At 5mm resolution, these fall within 1 voxel and get bridged by dilation.
- The output has actual wall thickness (1-2 voxels = 5-10mm), which makes
  it a valid solid for slicing and printing.

```typescript
/**
 * Surface-only voxelization: marks voxels that triangles pass through
 * without flood-filling any interior. Then dilates to close gaps.
 */
export function shellVoxelize(
  triangles: Triangle[],
  bbox: BBox,
  resolution: number,
  dilationVoxels: number = 1,
  onProgress?: ProgressCallback
): BitArray3D {
  const pad = resolution * (dilationVoxels + 2);
  const ox = bbox.minX - pad;
  const oy = bbox.minY - pad;
  const oz = bbox.minZ - pad;

  const nx = Math.ceil((bbox.maxX - bbox.minX + 2 * pad) / resolution) + 1;
  const ny = Math.ceil((bbox.maxY - bbox.minY + 2 * pad) / resolution) + 1;
  const nz = Math.ceil((bbox.maxZ - bbox.minZ + 2 * pad) / resolution) + 1;

  const grid = new BitArray3D(nx, ny, nz);

  // Step 1: Rasterize each triangle into the grid
  // For each triangle, find all voxels it intersects
  for (let ti = 0; ti < triangles.length; ti++) {
    if (onProgress && ti % 10000 === 0) {
      onProgress('shellVoxelize', ti / triangles.length);
    }
    rasterizeTriangle(grid, triangles[ti], ox, oy, oz, resolution);
  }

  // Step 2: Dilate by N voxels (3D morphological dilation)
  if (dilationVoxels > 0) {
    if (onProgress) onProgress('dilate', 0);
    return dilate3D(grid, dilationVoxels, onProgress);
  }

  return grid;
}

/**
 * Rasterize a single triangle into the voxel grid.
 * Marks every voxel the triangle passes through.
 * Uses scanline rasterization on each Z-slice.
 */
function rasterizeTriangle(
  grid: BitArray3D,
  tri: Triangle,
  ox: number, oy: number, oz: number,
  res: number
): void {
  // Find Z range of triangle
  const zMin = Math.min(tri.v0[2], tri.v1[2], tri.v2[2]);
  const zMax = Math.max(tri.v0[2], tri.v1[2], tri.v2[2]);
  const izMin = Math.max(0, Math.floor((zMin - oz) / res));
  const izMax = Math.min(grid.nz - 1, Math.ceil((zMax - oz) / res));

  for (let iz = izMin; iz <= izMax; iz++) {
    const z = oz + (iz + 0.5) * res;

    // Intersect triangle with Z plane → get 2D segment or polygon
    const pts = triangleZSlice(tri, z);
    if (pts.length < 2) continue;

    // Rasterize the 2D line segment/polygon into the XY grid
    if (pts.length === 2) {
      rasterizeLine2D(grid, iz, pts[0], pts[1], ox, oy, res);
    } else {
      // Triangle is nearly coplanar with Z slice — rasterize filled triangle
      rasterizeFilledTriangle2D(grid, iz, pts, ox, oy, res);
    }
  }

  // Also mark voxels at the triangle's actual vertex positions
  for (const v of [tri.v0, tri.v1, tri.v2]) {
    const ix = Math.floor((v[0] - ox) / res);
    const iy = Math.floor((v[1] - oy) / res);
    const iz = Math.floor((v[2] - oz) / res);
    if (ix >= 0 && ix < grid.nx && iy >= 0 && iy < grid.ny && iz >= 0 && iz < grid.nz) {
      grid.set(ix, iy, iz);
    }
  }
}

// Simplified Z-slice intersection (returns 2D points on the slice)
function triangleZSlice(tri: Triangle, z: number): [number, number][] {
  const verts = [tri.v0, tri.v1, tri.v2];
  const dists = verts.map(v => v[2] - z);
  const pts: [number, number][] = [];

  for (let i = 0; i < 3; i++) {
    const j = (i + 1) % 3;
    if (Math.abs(dists[i]) < 1e-10) {
      pts.push([verts[i][0], verts[i][1]]);
    }
    if ((dists[i] > 0) !== (dists[j] > 0)) {
      const t = dists[i] / (dists[i] - dists[j]);
      pts.push([
        verts[i][0] + t * (verts[j][0] - verts[i][0]),
        verts[i][1] + t * (verts[j][1] - verts[i][1]),
      ]);
    }
  }
  return pts;
}

function rasterizeLine2D(
  grid: BitArray3D, iz: number,
  p0: [number, number], p1: [number, number],
  ox: number, oy: number, res: number
): void {
  // Bresenham-style line rasterization in the XY grid
  const ix0 = Math.floor((p0[0] - ox) / res);
  const iy0 = Math.floor((p0[1] - oy) / res);
  const ix1 = Math.floor((p1[0] - ox) / res);
  const iy1 = Math.floor((p1[1] - oy) / res);

  const dx = Math.abs(ix1 - ix0);
  const dy = Math.abs(iy1 - iy0);
  const sx = ix0 < ix1 ? 1 : -1;
  const sy = iy0 < iy1 ? 1 : -1;
  let err = dx - dy;
  let cx = ix0, cy = iy0;

  while (true) {
    if (cx >= 0 && cx < grid.nx && cy >= 0 && cy < grid.ny) {
      grid.set(cx, cy, iz);
    }
    if (cx === ix1 && cy === iy1) break;
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; cx += sx; }
    if (e2 < dx) { err += dx; cy += sy; }
  }
}

function rasterizeFilledTriangle2D(
  grid: BitArray3D, iz: number,
  pts: [number, number][],
  ox: number, oy: number, res: number
): void {
  // Simple scanline fill for a 2D triangle in the XY grid
  if (pts.length < 3) return;

  const iyMin = Math.max(0, Math.floor((Math.min(pts[0][1], pts[1][1], pts[2][1]) - oy) / res));
  const iyMax = Math.min(grid.ny - 1, Math.ceil((Math.max(pts[0][1], pts[1][1], pts[2][1]) - oy) / res));

  for (let iy = iyMin; iy <= iyMax; iy++) {
    const y = oy + (iy + 0.5) * res;
    const xIntersections: number[] = [];

    for (let i = 0; i < 3; i++) {
      const j = (i + 1) % 3;
      const y0 = pts[i][1], y1 = pts[j][1];
      if ((y0 <= y && y1 > y) || (y1 <= y && y0 > y)) {
        const t = (y - y0) / (y1 - y0);
        xIntersections.push(pts[i][0] + t * (pts[j][0] - pts[i][0]));
      }
    }

    xIntersections.sort((a, b) => a - b);

    for (let h = 0; h + 1 < xIntersections.length; h += 2) {
      const ixStart = Math.max(0, Math.floor((xIntersections[h] - ox) / res));
      const ixEnd = Math.min(grid.nx - 1, Math.ceil((xIntersections[h + 1] - ox) / res));
      for (let ix = ixStart; ix <= ixEnd; ix++) {
        grid.set(ix, iy, iz);
      }
    }
  }
}

/**
 * 3D morphological dilation: expand every set voxel by N voxels
 * in all directions. Uses iterative single-voxel dilation.
 */
function dilate3D(
  grid: BitArray3D,
  iterations: number,
  onProgress?: ProgressCallback
): BitArray3D {
  let current = grid;

  for (let iter = 0; iter < iterations; iter++) {
    if (onProgress) onProgress('dilate', iter / iterations);

    const next = new BitArray3D(current.nx, current.ny, current.nz);

    for (let z = 0; z < current.nz; z++) {
      for (let y = 0; y < current.ny; y++) {
        for (let x = 0; x < current.nx; x++) {
          // A voxel is set in the dilated grid if it OR any of its
          // 6-connected neighbors is set in the current grid
          if (
            current.get(x, y, z) ||
            (x > 0 && current.get(x - 1, y, z)) ||
            (x < current.nx - 1 && current.get(x + 1, y, z)) ||
            (y > 0 && current.get(x, y - 1, z)) ||
            (y < current.ny - 1 && current.get(x, y + 1, z)) ||
            (z > 0 && current.get(x, y, z - 1)) ||
            (z < current.nz - 1 && current.get(x, y, z + 1))
          ) {
            next.set(x, y, z);
          }
        }
      }
    }

    current = next;
  }

  return current;
}
```

---

## Part 3: Wall Thickness Estimation (for auto-detection)

This helps the AI and the heuristic decide between solid vs shell:

```typescript
/**
 * Estimate average wall thickness by casting rays through the mesh
 * and measuring distances between entry and exit points.
 * 
 * For a solid body: rays cross thick sections (10mm+ typically)
 * For a thin shell: rays cross very thin sections (0.5-3mm)
 */
function estimateWallThickness(
  triangles: Triangle[],
  bbox: BBox,
  sampleCount: number = 200
): { avgThickness: number; minThickness: number; maxThickness: number; isThinShell: boolean } {
  const thicknesses: number[] = [];

  for (let i = 0; i < sampleCount; i++) {
    // Random ray origin on bounding box face, direction inward
    const axis = i % 3; // cycle X, Y, Z
    const origin = randomPointOnBBoxFace(bbox, axis);
    const direction = axisDirection(axis);

    // Find all intersection distances with the triangle soup
    const hits = castRayAllHits(origin, direction, triangles);
    hits.sort((a, b) => a - b);

    // Wall thickness = distance between consecutive pairs of hits
    // Entry at hits[0], exit at hits[1] → thickness = hits[1] - hits[0]
    for (let h = 0; h + 1 < hits.length; h += 2) {
      thicknesses.push(hits[h + 1] - hits[h]);
    }
  }

  if (thicknesses.length === 0) {
    return { avgThickness: 0, minThickness: 0, maxThickness: 0, isThinShell: true };
  }

  thicknesses.sort((a, b) => a - b);
  const avg = thicknesses.reduce((s, t) => s + t, 0) / thicknesses.length;
  const median = thicknesses[Math.floor(thicknesses.length / 2)];
  const maxDim = Math.max(bbox.maxX - bbox.minX, bbox.maxY - bbox.minY, bbox.maxZ - bbox.minZ);

  return {
    avgThickness: avg,
    minThickness: thicknesses[0],
    maxThickness: thicknesses[thicknesses.length - 1],
    // Thin shell: median thickness < 1% of max dimension
    isThinShell: median < maxDim * 0.01,
  };
}
```

---

## Part 4: Integrated Decision Logic

```typescript
async function autoRepair(mesh, triangles, bbox, stats, screenshot?) {
  // Step 1: Quick heuristics
  const totalEdges = stats.triangles * 1.5;
  const openPct = stats.openEdges / totalEdges;
  const nonManifoldPct = stats.nonManifoldEdges / totalEdges;

  // Minor defects → topology repair
  if (openPct < 0.01 && nonManifoldPct < 0.005) {
    return topologyRepair(mesh);
  }

  // Step 2: Wall thickness estimation
  const thickness = estimateWallThickness(triangles, bbox);

  // Step 3: AI analysis for ambiguous cases
  const aiResult = await analyzeMeshWithAI({
    ...stats,
    avgWallThickness: thickness.avgThickness,
  }, screenshot);

  console.log(`AI classification: ${aiResult.meshType} → ${aiResult.repairStrategy}`);
  console.log(`Confidence: ${aiResult.confidence}, Reasoning: ${aiResult.reasoning}`);

  // Step 4: Execute recommended strategy
  switch (aiResult.repairStrategy) {
    case 'topology_repair':
      return topologyRepair(mesh);

    case 'solid_voxel':
      // Original approach: flood fill + marching cubes
      return solidVoxelReconstruct(triangles, bbox);

    case 'shell_voxel':
      // NEW: surface-only voxelization + dilation
      return shellVoxelReconstruct(triangles, bbox);

    case 'manual':
      // Show both options to user, let them choose
      return { needsUserInput: true, aiNotes: aiResult.warnings };
  }
}
```

---

## For the monocoque specifically:

AI would receive:
- SA/Volume ratio: 16,571,075 / 177,143,233 = 0.094 (high for this scale)
- Open edges: 3.5% 
- File name: "monocoque.obj" (strong hint)
- Screenshot: clearly a thin car body shell with windows
- Wall thickness estimate: ~2-3mm (thin shell confirmed)

AI response:
```json
{
  "meshType": "thin_shell",
  "repairStrategy": "shell_voxel",
  "confidence": 0.95,
  "reasoning": "High SA/volume ratio, thin wall thickness, file name indicates car monocoque, screenshot shows open windows and door cutouts that must be preserved",
  "warnings": ["Windows and door openings will be preserved", "Shell will be thickened to ~10mm for watertight output"]
}
```

Result: shell_voxel path → surface rasterization + 1-voxel dilation → 
windows stay open, small gaps close, output is watertight thin shell.
