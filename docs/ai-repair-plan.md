# FIX: AI Analysis Must Return Executable Parameters

## Problem
The AI analysis returns a text description like "this is a thin shell, use 
shell voxelization." The software can't do anything with that. The AI needs 
to return a structured JSON object that the repair pipeline consumes directly 
as configuration — no human in the loop.

## The AI call should return THIS:

```typescript
interface RepairPlan {
  // Which pipeline to run
  pipeline: "topology" | "solid_voxel" | "shell_voxel";
  
  // Pipeline-specific parameters
  params: {
    // For topology pipeline
    topology?: {
      weldEpsilon: number;        // 0 for exact match, >0 for epsilon welding
      fillHolesMaxEdges: number;  // only fill holes smaller than this
      removeSmallShells: boolean; // discard tiny disconnected pieces
      smallShellThreshold: number;// mm³ below which a shell is "small"
    };
    
    // For voxel pipelines
    voxel?: {
      resolution: number;           // mm per voxel
      dilationVoxels: number;       // 0 for solid, 1-2 for shell
      smoothingIterations: number;  // laplacian smoothing passes post-MC
      simplifyTarget: number;       // target triangle count (0 = no simplify)
      preserveOpenings: boolean;    // true for shells with windows/doors
      minOpeningSize: number;       // mm — openings smaller than this get closed
    };
  };
  
  // Post-repair validation expectations
  expect: {
    watertight: boolean;
    maxNonManifoldEdges: number;
    maxTriangles: number;
  };
  
  // Human-readable explanation (for UI display only, NOT for the pipeline)
  userMessage: string;
}
```

## Updated AI call that returns executable config:

```typescript
async function getRepairPlan(
  stats: MeshStats,
  screenshotBase64?: string
): Promise<RepairPlan> {
  
  const systemPrompt = `You are a 3D mesh repair planner. Given mesh statistics and 
optionally a screenshot, return a JSON repair plan that will be executed directly 
by the software. No markdown, no backticks, only valid JSON matching this schema:

{
  "pipeline": "topology" | "solid_voxel" | "shell_voxel",
  "params": {
    "topology": { ... } | null,
    "voxel": { ... } | null
  },
  "expect": { "watertight": bool, "maxNonManifoldEdges": int, "maxTriangles": int },
  "userMessage": "Brief explanation for the user"
}

RULES FOR PARAMETER SELECTION:

pipeline selection:
- "topology" if open edges < 1% AND non-manifold < 0.5% of total edges
- "solid_voxel" if wall thickness > 5% of max bounding box dimension
- "shell_voxel" if wall thickness < 5% of max bounding box dimension

voxel.resolution:
- Start with maxDimension / 500
- Clamp between 0.5mm and 20mm
- For thin shells, use maxDimension / 800 (finer to capture sheet detail)

voxel.dilationVoxels:
- 0 for solid_voxel pipeline
- 1 for shell_voxel on most parts  
- 2 for shell_voxel on very noisy/gapped data (open edges > 10%)

voxel.smoothingIterations:
- 0 if resolution < 2mm (already fine enough)
- 3-5 if resolution 2-10mm (removes stair stepping)
- 10 if resolution > 10mm (heavy smoothing needed)

voxel.simplifyTarget:
- Target roughly the original triangle count
- Marching cubes over-tessellates flat regions; simplification recovers this
- Set to originalTriangleCount * 0.8 as default

voxel.preserveOpenings:
- true for shell_voxel pipeline always
- false for solid_voxel pipeline always

voxel.minOpeningSize:
- For shell_voxel: resolution * 4 (openings smaller than 4 voxels close)
- This ensures windows (500mm+) stay open while tiny gaps (5mm) close

topology.weldEpsilon:
- ALWAYS 0 (exact match only) unless AI specifically identifies coordinate noise
- If file is from a 3D scanner, set to 0.01mm
- NEVER above 0.1mm

topology.fillHolesMaxEdges:
- 50 for CAD parts (small holes only)
- 200 for organic/scan data (larger patches acceptable)
- 0 to disable hole filling entirely

IMPORTANT: The smoothingIterations and simplifyTarget are critical.
Marching cubes output has stair-step artifacts and 3-10x more triangles 
than needed. The plan MUST include smoothing and simplification to 
produce a usable result.`;

  const userContent: any[] = [{
    type: "text",
    text: `Generate repair plan for:
File: ${stats.fileName}
Triangles: ${stats.triangles.toLocaleString()}
Vertices: ${stats.vertices.toLocaleString()}
BBox: ${stats.bboxX.toFixed(1)} x ${stats.bboxY.toFixed(1)} x ${stats.bboxZ.toFixed(1)} mm
Surface area: ${stats.surfaceArea.toFixed(0)} mm²
Volume: ${stats.volume.toFixed(0)} mm³
SA/Vol ratio: ${(stats.surfaceArea / stats.volume).toFixed(4)}
Open edges: ${stats.openEdges.toLocaleString()} (${(stats.openEdges / (stats.triangles * 1.5) * 100).toFixed(1)}%)
Non-manifold edges: ${stats.nonManifoldEdges.toLocaleString()}
Shells: ${stats.shells}
Wall thickness (median): ${stats.wallThickness?.toFixed(2) ?? 'unknown'} mm
Wall thickness / max dim: ${stats.wallThickness ? (stats.wallThickness / Math.max(stats.bboxX, stats.bboxY, stats.bboxZ) * 100).toFixed(3) + '%' : 'unknown'}`
  }];

  if (screenshotBase64) {
    userContent.unshift({
      type: "image",
      source: { type: "base64", media_type: "image/png", data: screenshotBase64 }
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
  const text = data.content[0].text.replace(/```json|```/g, '').trim();
  return JSON.parse(text) as RepairPlan;
}
```

## The software executes the plan directly:

```typescript
async function executeRepairPlan(plan: RepairPlan, mesh, triangles, bbox) {
  switch (plan.pipeline) {
    case 'topology':
      return executeTopologyRepair(mesh, plan.params.topology!);
      
    case 'solid_voxel':
      return executeVoxelRepair(triangles, bbox, plan.params.voxel!, false);
      
    case 'shell_voxel':
      return executeVoxelRepair(triangles, bbox, plan.params.voxel!, true);
  }
}

async function executeVoxelRepair(triangles, bbox, params, isShell) {
  // Step 1: Voxelize
  let grid;
  if (isShell) {
    grid = shellVoxelize(triangles, bbox, params.resolution, params.dilationVoxels);
  } else {
    const result = voxelize(triangles, bbox, params.resolution);
    const exterior = floodFillExterior(result.grid);
    grid = invertExterior(result.grid, exterior);
  }

  // Step 2: Marching cubes
  let mesh = marchingCubes(grid, params.resolution);

  // Step 3: Laplacian smoothing (REMOVES STAIR STEPPING)
  if (params.smoothingIterations > 0) {
    mesh = laplacianSmooth(mesh, params.smoothingIterations);
  }

  // Step 4: Simplification (REDUCES TRIANGLE COUNT)
  if (params.simplifyTarget > 0 && mesh.faceCount > params.simplifyTarget) {
    mesh = quadricSimplify(mesh, params.simplifyTarget);
  }

  // Step 5: Final cleanup
  mesh.buildTwins();
  const validation = mesh.validate();
  
  return { mesh, validation };
}
```

---

## For the monocoque, the AI would return:

```json
{
  "pipeline": "shell_voxel",
  "params": {
    "voxel": {
      "resolution": 2.9,
      "dilationVoxels": 1,
      "smoothingIterations": 5,
      "simplifyTarget": 550000,
      "preserveOpenings": true,
      "minOpeningSize": 12
    }
  },
  "expect": {
    "watertight": true,
    "maxNonManifoldEdges": 0,
    "maxTriangles": 600000
  },
  "userMessage": "Thin shell detected (car monocoque). Reconstructing surface with 2.9mm resolution, preserving window and door openings. Output will be smoothed and simplified to ~550K triangles."
}
```

The software receives this, calls executeVoxelRepair with those exact params, 
and the user sees a progress bar followed by a clean result. No manual steps.
