'use server';

// mesh-analysis-actions.ts
// Server action: calls the Anthropic API to classify a 3-D mesh, identify what
// the object is, and recommend a repair strategy with rich parameters.
// Falls back to a heuristic result if the key is absent or the call fails.

export type MeshType =
  | "solid_body"    // enclosed solid — has interior volume
  | "thin_shell"    // single-layer surface (car body, panel, monocoque)
  | "multi_body"    // multiple separate bodies in one file
  | "surface_patch";// open surface not meant to be watertight

export type RepairStrategy =
  | "topology_repair" // minor defects — existing half-edge pipeline
  | "solid_voxel"     // broken solid — volume flood-fill reconstruction
  | "shell_voxel"     // broken thin shell — surface rasterisation + dilation
  | "point_cloud"     // broken thin shell — MLS/SDF point cloud reconstruction
  | "manual";         // too ambiguous — present both options to the user

export interface AIMeshAnalysisInput {
  triangles: number;
  vertices: number;
  openEdges: number;
  nonManifoldEdges: number;
  boundingBox: { x: number; y: number; z: number };
  surfaceAreaMM2: number;
  volumeMM3: number;
  avgWallThicknessMM: number | null;
  fileName: string;
  screenshotBase64?: string; // optional viewport capture (PNG)
}

// ─── Model identification ────────────────────────────────────────────────────

export interface ModelIdentification {
  /** What the object is: "car_body", "bracket", "enclosure", "figurine", etc. */
  category: string;
  /** Human-readable description: "Full car body monocoque with window openings and wheel arches" */
  description: string;
  /** Expected geometric features the repair should preserve */
  expectedFeatures: string[];
  /** Mechanical (hard edges, planar faces) vs organic (smooth curves) */
  geometryClass: "mechanical" | "organic" | "architectural" | "mixed";
  /** Whether the model has holes that are intentional, not damage */
  hasIntentionalOpenings: boolean;
  /** Wall character informs smoothing and resolution choices */
  estimatedWallCharacter: "uniform_thin" | "variable_thin" | "solid" | "mixed";
}

// ─── Repair guidance ─────────────────────────────────────────────────────────

export interface RepairGuidance {
  /** Why these specific params were chosen for THIS model */
  strategyRationale: string;
  /** Specific risks: "window openings may partially close", etc. */
  risks: string[];
  /** What to visually verify after repair */
  postRepairChecklist: string[];
}

// ─── Executable repair plan ──────────────────────────────────────────────────

export interface VoxelRepairParams {
  resolution: number;           // mm per voxel
  dilationVoxels: number;       // 0 for solid, 1-2 for shell
  smoothingIterations: number;  // taubin smoothing passes post-reconstruction
  simplifyTarget: number;       // target triangle count (0 = no simplify)
  smoothingLambda?: number;     // taubin lambda (0.1-0.8, default 0.5)
  boundaryPenalty?: number;     // QEM boundary edge penalty (1-10, default 1)
}

export interface PointCloudRepairParams {
  resolution: number;           // mm per grid cell
  smoothingIterations: number;  // taubin smoothing passes post-reconstruction
  simplifyTarget: number;       // target triangle count (0 = no simplify)
  radiusMultiplier: number;     // MLS smoothing radius = resolution * this (default 2)
  sdfSharpness?: number;        // 0.0 = smooth/blobby, 1.0 = sharp edges (default 0.5)
  gapBridgingFactor?: number;   // eval radius multiplier, 1.0 = standard, 2.0+ bridges wider gaps
  smoothingLambda?: number;     // taubin lambda (0.1-0.8, default 0.5)
  boundaryPenalty?: number;     // QEM boundary edge penalty (1-10, default 1)
}

export interface PostProcessParams {
  smoothingIterations: number;
  simplifyTarget: number;
  smoothingLambda: number;      // taubin lambda
  boundaryPenalty: number;      // QEM boundary edge penalty
}

export interface RepairPlan {
  pipeline: "topology" | "solid_voxel" | "shell_voxel" | "point_cloud";
  params: {
    voxel: VoxelRepairParams | null;
    pointCloud?: PointCloudRepairParams | null;
    postProcess?: PostProcessParams | null;
  };
  expect: {
    watertight: boolean;
    maxTriangles: number;
  };
  userMessage: string;
}

export interface AIMeshAnalysisResult {
  meshType: MeshType;
  repairStrategy: RepairStrategy;
  confidence: number;  // 0–1
  reasoning: string;
  warnings: string[];
  /** Executable repair plan — consumed directly by the reconstruction pipeline. */
  repairPlan?: RepairPlan;
  /** What the AI thinks this object is and how to handle it. */
  modelId?: ModelIdentification;
  /** Why these params, risks, and post-repair checklist. */
  repairGuidance?: RepairGuidance;
  /** Set when the AI call was skipped or failed; result is heuristic-only. */
  heuristic?: true;
  error?: string;
}

// ─── Heuristic fallback ───────────────────────────────────────────────────────

function estimateVoxelOutputTris(
  bbox: { x: number; y: number; z: number },
  resolution: number,
): number {
  const gx = Math.ceil(bbox.x / resolution) + 2;
  const gy = Math.ceil(bbox.y / resolution) + 2;
  const gz = Math.ceil(bbox.z / resolution) + 2;
  return 4 * (gx * gy + gy * gz + gz * gx);
}

function gridSafetyFloor(bbox: { x: number; y: number; z: number }): number {
  const maxDim = Math.max(bbox.x, bbox.y, bbox.z, 1);
  return Math.max(
    maxDim / 1000,
    Math.cbrt(bbox.x * bbox.y * bbox.z / 200_000_000),
    0.5,
  );
}

function computeVoxelParams(input: AIMeshAnalysisInput, isShell: boolean): VoxelRepairParams {
  const maxDim = Math.max(input.boundingBox.x, input.boundingBox.y, input.boundingBox.z, 1);
  const totalEdges = input.triangles * 1.5 || 1;
  const openPct = input.openEdges / totalEdges;

  let resolution = isShell ? maxDim / 800 : maxDim / 500;
  resolution = Math.max(0.5, Math.min(resolution, 20));
  resolution = Math.max(resolution, gridSafetyFloor(input.boundingBox));
  resolution = Math.round(resolution * 10) / 10;

  const dilationVoxels = isShell ? (openPct > 0.1 ? 2 : 1) : 0;
  const smoothingIterations =
    resolution < 2 ? 0 : resolution <= 6 ? 3 : resolution <= 10 ? 5 : 10;
  const simplifyTarget = Math.round(input.triangles * 0.8);

  return { resolution, dilationVoxels, smoothingIterations, simplifyTarget };
}

function computePointCloudParams(input: AIMeshAnalysisInput): PointCloudRepairParams {
  const maxDim = Math.max(input.boundingBox.x, input.boundingBox.y, input.boundingBox.z, 1);
  let resolution = maxDim / 600;
  resolution = Math.max(resolution, gridSafetyFloor(input.boundingBox));
  resolution = Math.round(resolution * 10) / 10;

  const smoothingIterations = resolution < 3 ? 0 : resolution <= 5 ? 1 : resolution <= 8 ? 2 : 3;
  const simplifyTarget = Math.round(input.triangles * 1.5);

  return {
    resolution,
    smoothingIterations,
    simplifyTarget,
    radiusMultiplier: 2,
    sdfSharpness: 0.5,
    gapBridgingFactor: 1.0,
    smoothingLambda: 0.5,
    boundaryPenalty: 1.0,
  };
}

/** Clamp AI-returned voxel params to safe ranges. */
function sanitizeVoxelParams(params: VoxelRepairParams, input: AIMeshAnalysisInput): VoxelRepairParams {
  const minRes = Math.ceil(gridSafetyFloor(input.boundingBox) * 2) / 2;
  const resolution = Math.max(minRes, Math.min(Math.round((params.resolution || 1) * 10) / 10, 20));
  const dilationVoxels = Math.max(0, Math.min(Math.round(params.dilationVoxels || 0), 3));
  const smoothingIterations = Math.max(0, Math.min(Math.round(params.smoothingIterations || 0), 20));

  let simplifyTarget = Math.round(params.simplifyTarget || 0);
  if (simplifyTarget <= 0 || simplifyTarget > input.triangles * 2) {
    simplifyTarget = Math.round(input.triangles * 0.8);
  }

  return {
    resolution,
    dilationVoxels,
    smoothingIterations,
    simplifyTarget,
    smoothingLambda: clamp(params.smoothingLambda ?? 0.5, 0.1, 0.8),
    boundaryPenalty: clamp(params.boundaryPenalty ?? 1.0, 1.0, 10.0),
  };
}

/** Clamp AI-returned point cloud params to safe ranges. */
function sanitizePointCloudParams(params: PointCloudRepairParams, input: AIMeshAnalysisInput): PointCloudRepairParams {
  const minRes = Math.ceil(gridSafetyFloor(input.boundingBox) * 2) / 2;
  const resolution = Math.max(minRes, Math.min(Math.round((params.resolution || 1) * 10) / 10, 20));
  const smoothingIterations = Math.max(0, Math.min(Math.round(params.smoothingIterations || 0), 20));

  let simplifyTarget = Math.round(params.simplifyTarget || 0);
  if (simplifyTarget <= 0 || simplifyTarget > input.triangles * 3) {
    simplifyTarget = Math.round(input.triangles * 1.5);
  }

  return {
    resolution,
    smoothingIterations,
    simplifyTarget,
    radiusMultiplier: clamp(params.radiusMultiplier ?? 2, 1, 4),
    sdfSharpness: clamp(params.sdfSharpness ?? 0.5, 0.0, 1.0),
    gapBridgingFactor: clamp(params.gapBridgingFactor ?? 1.0, 1.0, 3.0),
    smoothingLambda: clamp(params.smoothingLambda ?? 0.5, 0.1, 0.8),
    boundaryPenalty: clamp(params.boundaryPenalty ?? 1.0, 1.0, 10.0),
  };
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

/** Infer a model identification from filename heuristics when AI is unavailable. */
function heuristicModelId(input: AIMeshAnalysisInput, thinShell: boolean): ModelIdentification {
  const fn = input.fileName.toLowerCase();
  const isCarBody = /body|monocoque|chassis|shell|panel|skin|fender|hood|bumper/.test(fn);
  const isBracket = /bracket|mount|clamp|holder/.test(fn);
  const isEnclosure = /enclosure|case|box|housing/.test(fn);

  if (isCarBody || (thinShell && input.boundingBox.x > 500)) {
    return {
      category: "car_body",
      description: "Automotive body shell or panel (inferred from filename/dimensions)",
      expectedFeatures: ["panel_surfaces", "potential_openings", "thin_walls"],
      geometryClass: "mixed",
      hasIntentionalOpenings: true,
      estimatedWallCharacter: "uniform_thin",
    };
  }
  if (isBracket) {
    return {
      category: "bracket",
      description: "Mechanical bracket or mounting part",
      expectedFeatures: ["mounting_holes", "sharp_edges", "flat_surfaces"],
      geometryClass: "mechanical",
      hasIntentionalOpenings: true,
      estimatedWallCharacter: "solid",
    };
  }
  if (isEnclosure) {
    return {
      category: "enclosure",
      description: "Electronics enclosure or housing",
      expectedFeatures: ["thin_walls", "snap_fits", "screw_bosses"],
      geometryClass: "mechanical",
      hasIntentionalOpenings: true,
      estimatedWallCharacter: "uniform_thin",
    };
  }
  return {
    category: thinShell ? "shell_part" : "solid_part",
    description: thinShell ? "Thin-walled part (type unknown)" : "Solid part (type unknown)",
    expectedFeatures: [],
    geometryClass: "mixed",
    hasIntentionalOpenings: thinShell,
    estimatedWallCharacter: thinShell ? "uniform_thin" : "solid",
  };
}

function heuristicAnalysis(input: AIMeshAnalysisInput): AIMeshAnalysisResult {
  const totalEdges = input.triangles * 1.5 || 1;
  const openPct = input.openEdges / totalEdges;
  const saVolRatio = input.volumeMM3 > 0
    ? input.surfaceAreaMM2 / input.volumeMM3
    : Infinity;
  const maxDim = Math.max(input.boundingBox.x, input.boundingBox.y, input.boundingBox.z, 1);
  const thinShell =
    (input.avgWallThicknessMM !== null && input.avgWallThicknessMM < maxDim * 0.01) ||
    saVolRatio > 0.05;

  const modelId = heuristicModelId(input, thinShell);

  if (openPct < 0.01) {
    return {
      meshType: thinShell ? "thin_shell" : "solid_body",
      repairStrategy: "topology_repair",
      confidence: 0.8,
      reasoning: "Less than 1% open edges — topology repair should suffice.",
      warnings: [],
      modelId,
      heuristic: true,
    };
  }

  if (thinShell) {
    const pc = computePointCloudParams(input);
    // Apply model-aware defaults
    if (modelId.hasIntentionalOpenings) {
      pc.gapBridgingFactor = 1.0; // don't bridge intentional openings
      pc.boundaryPenalty = 5.0;   // protect opening edges during simplification
    }
    if (modelId.geometryClass === "mechanical") {
      pc.sdfSharpness = 0.7;
      pc.smoothingLambda = 0.3;
    }

    return {
      meshType: "thin_shell",
      repairStrategy: "point_cloud",
      confidence: 0.8,
      reasoning:
        `Thin shell detected (SA/volume ratio ${saVolRatio > 1000 ? ">1000" : saVolRatio.toFixed(2)}). ` +
        `Identified as: ${modelId.description}. ` +
        "Point cloud reconstruction (MLS/SDF) preserves thin surfaces and openings.",
      warnings: modelId.hasIntentionalOpenings
        ? ["Intentional openings (windows, cutouts) will be preserved — verify they are not partially closed after repair."]
        : [],
      repairPlan: {
        pipeline: "point_cloud",
        params: { voxel: null, pointCloud: pc },
        expect: { watertight: true, maxTriangles: pc.simplifyTarget > 0 ? pc.simplifyTarget : input.triangles },
        userMessage: `Point cloud reconstruction at ${pc.resolution} mm | sharpness ${pc.sdfSharpness} | boundary penalty ${pc.boundaryPenalty} | target ${pc.simplifyTarget.toLocaleString()} triangles.`,
      },
      modelId,
      repairGuidance: {
        strategyRationale: `MLS/SDF chosen because wall thickness (${input.avgWallThicknessMM?.toFixed(1) ?? "unknown"} mm) is too thin for voxel methods at safe resolution.`,
        risks: modelId.hasIntentionalOpenings
          ? ["Window/door openings may partially close if gap bridging is too aggressive"]
          : ["Surface detail may be lost at coarse resolution"],
        postRepairChecklist: [
          "Verify all intentional openings are preserved",
          "Check panel edges for excessive smoothing",
          "Confirm watertight status in slicer",
        ],
      },
      heuristic: true,
    };
  }

  const voxel = computeVoxelParams(input, false);
  return {
    meshType: "solid_body",
    repairStrategy: "solid_voxel",
    confidence: 0.7,
    reasoning: `Significant open edges (${(openPct * 100).toFixed(1)}%) on what appears to be a solid body. Identified as: ${modelId.description}.`,
    warnings: [],
    repairPlan: {
      pipeline: "solid_voxel",
      params: { voxel },
      expect: { watertight: true, maxTriangles: voxel.simplifyTarget > 0 ? voxel.simplifyTarget : input.triangles },
      userMessage: `Solid reconstruction at ${voxel.resolution} mm resolution, target ${voxel.simplifyTarget.toLocaleString()} triangles.`,
    },
    modelId,
    repairGuidance: {
      strategyRationale: "Solid voxel reconstruction fills the interior volume and produces a watertight mesh.",
      risks: ["Fine surface detail below voxel resolution will be lost"],
      postRepairChecklist: ["Verify overall shape is correct", "Check for unwanted hole filling"],
    },
    heuristic: true,
  };
}

// ─── AI system prompt ────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are an expert 3D mesh analysis assistant for a 3D printing preparation tool. Given mesh statistics and a viewport screenshot, you must:
1. IDENTIFY what the object actually is
2. CLASSIFY the mesh type and damage level
3. RECOMMEND a repair strategy with precisely tuned parameters
4. EXPLAIN your reasoning and what to watch for after repair

You are the ONLY intelligence in the pipeline. The repair tool is mechanical — it takes your numbers and runs them. If you get the parameters wrong, the output will be garbage. Be thorough.

═══ STEP 1: MODEL IDENTIFICATION ═══

From the screenshot, filename, dimensions, and geometry ratios, determine WHAT this object is. Common categories:

AUTOMOTIVE: car_body, body_panel, fender, hood, bumper, chassis, wheel, interior_trim
  - Signatures: large bbox (>500mm), thin shell, SA/vol>0.05, intentional openings (windows, wheel arches, door cutouts)
  - Expected features: panel surfaces, character lines, wheel arches, window frames, door openings
  - Wall character: uniform_thin (1-3mm sheet metal)

MECHANICAL: bracket, mount, gear, shaft, coupling, housing, enclosure, heatsink
  - Signatures: smaller bbox, solid body or thick walls, mounting holes, sharp edges
  - Expected features: mounting holes, fillets, chamfers, flat mating surfaces
  - Wall character: solid or variable_thin

CONSUMER: figurine, toy, sculpture, vase, container, phone_case
  - Signatures: organic curves, variable wall thickness, fine surface detail
  - Expected features: smooth organic surfaces, undercuts, thin features
  - Wall character: variable_thin

INDUSTRIAL: pipe_fitting, flange, valve_body, manifold, duct, structural_member
  - Signatures: cylindrical/tubular geometry, thick walls, precise dimensions
  - Expected features: pipe connections, bolt patterns, sealing surfaces

SCAN DATA: 3d_scan, photogrammetry, point_cloud_mesh
  - Signatures: very high triangle count, no clean edges, noisy surface, many non-manifold edges
  - Expected features: surface noise, scan artifacts, registration gaps

═══ STEP 2: MESH CLASSIFICATION ═══

MESH TYPES:
- solid_body: Enclosed solid. Has interior volume. SA/volume ratio < 0.05.
- thin_shell: Single-layer surface. No interior volume. SA/volume ratio > 0.05. May have intentional openings.
- multi_body: Multiple disconnected shells in one file.
- surface_patch: Open surface not meant to be watertight.

KEY DIAGNOSTICS:
- SA/volume ratio > 0.05 → thin shell
- Open edges / total edges > 5% → severely broken
- Wall thickness < 1% of max bbox dimension → thin shell
- Non-manifold edges > 1% of total → corrupted topology (normals likely inconsistent)
- Filename hints: "body", "panel", "shell", "skin", "monocoque" → thin shell

═══ STEP 3: REPAIR STRATEGY ═══

STRATEGIES (choose ONE):
- topology_repair: <1% defective edges. Fast, preserves geometry exactly.
- solid_voxel: Broken solid body. Fills interior. NEVER use on thin shells.
- point_cloud: PREFERRED for broken thin shells. MLS/SDF reconstruction. Preserves openings.
- shell_voxel: Fallback for thin shells if point_cloud inappropriate.
- manual: Too ambiguous. Flag for user.

═══ STEP 4: PARAMETER TUNING ═══

Your parameters directly control reconstruction quality. Set them based on what the object IS.

VOXEL PARAMS (solid_voxel or shell_voxel only):
- resolution: maxDim/500 for solids, maxDim/800 for shells
  HARD MIN: max(maxDim/1000, cbrt(bbX*bbY*bbZ/200000000), 0.5)
  MAX: 20mm
- dilationVoxels: 0 solid, 1 shell, 2 shell with >10% open edges
- smoothingIterations: 0 if res<2mm, 3 if 2-6mm, 5 if 6-10mm, 10 if >10mm
- simplifyTarget: inputTriangles * 0.8
- smoothingLambda: 0.3 mechanical (preserve edges), 0.5 default, 0.7 organic
- boundaryPenalty: 1.0 for solids, 3.0 for parts with mounting holes, 5.0+ for shells with openings

POINT CLOUD PARAMS (point_cloud only):
- resolution: maxDim/600
  Same HARD MIN as voxel
- radiusMultiplier: 2.0 default. Lower (1.5) for dense meshes. Higher (2.5) for sparse/gappy.
- sdfSharpness: Controls SDF kernel width.
  0.0 = very smooth, fills gaps aggressively (good for scan data, organic shapes)
  0.5 = balanced (good for mixed geometry like car bodies)
  0.7-0.9 = sharp, preserves hard edges (good for mechanical parts, brackets)
  1.0 = maximum sharpness (only for pristine mechanical CAD)
  SET THIS BASED ON GEOMETRY CLASS. A car body with panel seams = 0.5. A bracket = 0.8. A figurine = 0.3.
- gapBridgingFactor: Multiplier on SDF evaluation radius.
  1.0 = standard (preserves intentional openings like windows, holes)
  1.5-2.0 = bridges moderate gaps (good for scan data with acquisition holes)
  2.5-3.0 = aggressive gap filling (only for heavily damaged meshes with no intentional openings)
  CRITICAL: If the model has intentional openings (car windows, mounting holes), keep this at 1.0!
- smoothingIterations: 0 if res<3mm, 1 if 3-5mm, 2 if 5-8mm, 3 if >8mm
- simplifyTarget: inputTriangles * 1.5
- smoothingLambda: 0.3 mechanical, 0.5 default, 0.7 organic/figurines
- boundaryPenalty: 1.0 for closed surfaces, 5.0-8.0 for car bodies with window/door edges, 3.0 for brackets with holes
  This controls how aggressively the simplifier preserves edges at mesh boundaries.
  HIGH values protect wheel arches, window frames, door edges from being simplified away.

═══ RESPONSE FORMAT ═══

Respond with a JSON object only. No markdown, no backticks, no commentary.

{
  "meshType": "solid_body|thin_shell|multi_body|surface_patch",
  "repairStrategy": "topology_repair|solid_voxel|shell_voxel|point_cloud|manual",
  "confidence": 0.0-1.0,
  "reasoning": "Detailed analysis of what you see and why you chose this strategy",
  "warnings": ["specific risks for this particular model"],
  "modelId": {
    "category": "car_body|bracket|figurine|etc",
    "description": "Full car body monocoque shell with window openings, wheel arches, and panel seams",
    "expectedFeatures": ["window_openings", "wheel_arches", "panel_seams", "door_cutouts"],
    "geometryClass": "mechanical|organic|architectural|mixed",
    "hasIntentionalOpenings": true,
    "estimatedWallCharacter": "uniform_thin|variable_thin|solid|mixed"
  },
  "repairGuidance": {
    "strategyRationale": "Why these specific params for THIS model",
    "risks": ["Window openings may partially close at high gap bridging"],
    "postRepairChecklist": ["Verify wheel arches are open", "Check panel seam definition"]
  },
  "voxelParams": { "resolution": N, "dilationVoxels": N, "smoothingIterations": N, "simplifyTarget": N, "smoothingLambda": N, "boundaryPenalty": N } | null,
  "pointCloudParams": { "resolution": N, "radiusMultiplier": N, "sdfSharpness": N, "gapBridgingFactor": N, "smoothingIterations": N, "simplifyTarget": N, "smoothingLambda": N, "boundaryPenalty": N } | null
}`;

// ─── Main export ──────────────────────────────────────────────────────────────

export async function analyzeMeshWithAI(
  input: AIMeshAnalysisInput
): Promise<AIMeshAnalysisResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return {
      ...heuristicAnalysis(input),
      error: "ANTHROPIC_API_KEY not configured — using heuristic analysis.",
    };
  }

  const saVolRatio =
    input.volumeMM3 > 0
      ? (input.surfaceAreaMM2 / input.volumeMM3).toFixed(4)
      : "N/A (zero volume)";

  const statsText = `File: ${input.fileName}
Triangles: ${input.triangles.toLocaleString()}
Vertices: ${input.vertices.toLocaleString()}
Bounding box: ${input.boundingBox.x.toFixed(1)} × ${input.boundingBox.y.toFixed(1)} × ${input.boundingBox.z.toFixed(1)} mm
Surface area: ${input.surfaceAreaMM2.toFixed(0)} mm²
Volume: ${input.volumeMM3.toFixed(0)} mm³
SA/Volume ratio: ${saVolRatio}
Open edges: ${input.openEdges.toLocaleString()} (${((input.openEdges / (input.triangles * 1.5 || 1)) * 100).toFixed(1)}% of total)
Non-manifold edges: ${input.nonManifoldEdges.toLocaleString()} (${((input.nonManifoldEdges / (input.triangles * 1.5 || 1)) * 100).toFixed(1)}% of total)
${input.avgWallThicknessMM !== null ? `Estimated wall thickness: ${input.avgWallThicknessMM.toFixed(1)} mm` : "Wall thickness: unknown"}
Max dimension: ${Math.max(input.boundingBox.x, input.boundingBox.y, input.boundingBox.z).toFixed(1)} mm`;

  type ContentBlock =
    | { type: "text"; text: string }
    | { type: "image"; source: { type: "base64"; media_type: "image/png"; data: string } };

  const content: ContentBlock[] = [];

  if (input.screenshotBase64) {
    content.push({
      type: "image",
      source: { type: "base64", media_type: "image/png", data: input.screenshotBase64 },
    });
  }

  content.push({
    type: "text",
    text: `Analyze this 3D mesh. Identify what the object is, classify its damage, and return precise repair parameters.\n\n${statsText}`,
  });

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content }],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Anthropic API error ${response.status}: ${errText.slice(0, 200)}`);
    }

    const data = await response.json() as {
      content: Array<{ type: string; text: string }>;
    };

    const rawText = data.content.find((b) => b.type === "text")?.text ?? "";
    const jsonText = rawText.replace(/```[a-z]*\n?/gi, "").trim();
    const parsed = JSON.parse(jsonText) as {
      meshType: MeshType;
      repairStrategy: RepairStrategy;
      confidence: number;
      reasoning: string;
      warnings: string[];
      modelId?: ModelIdentification;
      repairGuidance?: RepairGuidance;
      voxelParams?: VoxelRepairParams | null;
      pointCloudParams?: PointCloudRepairParams | null;
    };

    // Build executable repair plan from AI-returned params
    let repairPlan: RepairPlan | undefined;
    const strategy = parsed.repairStrategy;

    if (strategy === "solid_voxel" || strategy === "shell_voxel") {
      const voxel = parsed.voxelParams
        ? sanitizeVoxelParams(parsed.voxelParams, input)
        : computeVoxelParams(input, strategy === "shell_voxel");
      const label = strategy === "shell_voxel" ? "Shell" : "Solid";
      repairPlan = {
        pipeline: strategy,
        params: {
          voxel,
          postProcess: {
            smoothingIterations: voxel.smoothingIterations,
            simplifyTarget: voxel.simplifyTarget,
            smoothingLambda: voxel.smoothingLambda ?? 0.5,
            boundaryPenalty: voxel.boundaryPenalty ?? 1.0,
          },
        },
        expect: {
          watertight: true,
          maxTriangles: voxel.simplifyTarget > 0 ? voxel.simplifyTarget : input.triangles,
        },
        userMessage: `${label} reconstruction at ${voxel.resolution} mm | λ=${voxel.smoothingLambda ?? 0.5} | boundary penalty ${voxel.boundaryPenalty ?? 1.0} | target ${voxel.simplifyTarget.toLocaleString()} tri.`,
      };
    } else if (strategy === "point_cloud") {
      const pc = parsed.pointCloudParams
        ? sanitizePointCloudParams(parsed.pointCloudParams, input)
        : computePointCloudParams(input);
      repairPlan = {
        pipeline: "point_cloud",
        params: {
          voxel: null,
          pointCloud: pc,
          postProcess: {
            smoothingIterations: pc.smoothingIterations,
            simplifyTarget: pc.simplifyTarget,
            smoothingLambda: pc.smoothingLambda ?? 0.5,
            boundaryPenalty: pc.boundaryPenalty ?? 1.0,
          },
        },
        expect: {
          watertight: true,
          maxTriangles: pc.simplifyTarget > 0 ? pc.simplifyTarget : input.triangles,
        },
        userMessage: `Point cloud at ${pc.resolution} mm | sharpness ${pc.sdfSharpness ?? 0.5} | gap bridge ${pc.gapBridgingFactor ?? 1.0} | λ=${pc.smoothingLambda ?? 0.5} | boundary ${pc.boundaryPenalty ?? 1.0} | target ${pc.simplifyTarget.toLocaleString()} tri.`,
      };
    }

    return {
      meshType: parsed.meshType,
      repairStrategy: parsed.repairStrategy,
      confidence: parsed.confidence ?? 0.8,
      reasoning: parsed.reasoning ?? "",
      warnings: Array.isArray(parsed.warnings) ? parsed.warnings : [],
      repairPlan,
      modelId: parsed.modelId,
      repairGuidance: parsed.repairGuidance,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[mesh-analysis-actions] AI call failed:", msg);
    return {
      ...heuristicAnalysis(input),
      error: `AI call failed (${msg}) — using heuristic analysis.`,
    };
  }
}


// ─── Reconstruction failure diagnosis ─────────────────────────────────────────

export interface ReconstructionDiagnostics {
  pipeline: "solid_voxel" | "shell_voxel" | "point_cloud";
  attempt: number;
  maxAttempts: number;
  validationFailures: Array<{
    check: string;
    severity: string;
    detail: string;
    value: number;
    threshold: number;
  }>;
  currentParams: {
    voxel?: VoxelRepairParams | null;
    pointCloud?: PointCloudRepairParams | null;
    postProcess?: PostProcessParams | null;
  };
  inputStats: {
    triangles: number;
    vertices: number;
    boundingBox: { x: number; y: number; z: number };
  };
  outputStats: {
    triangles: number;
    vertices: number;
    nanVertices: number;
    degenerateTriangles: number;
    nonManifoldEdges: number;
    boundaryEdges: number;
  };
}

export interface RetryRecommendation {
  adjustedParams: {
    voxel?: VoxelRepairParams | null;
    pointCloud?: PointCloudRepairParams | null;
    postProcess?: PostProcessParams | null;
  };
  reasoning: string;
  switchPipeline?: "solid_voxel" | "shell_voxel" | "point_cloud";
}

/**
 * Diagnose why a reconstruction attempt failed validation and recommend
 * adjusted parameters for retry. Calls Claude Haiku for intelligent
 * adjustment; falls back to heuristic rules if the API is unavailable.
 */
export async function diagnoseReconstructionFailure(
  diagnostics: ReconstructionDiagnostics,
): Promise<RetryRecommendation> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return heuristicRetryAdjustment(diagnostics);
  }

  try {
    const failureSummary = diagnostics.validationFailures
      .map((f) => `- ${f.check}: ${f.detail} (value=${f.value}, threshold=${f.threshold})`)
      .join("\n");

    const prompt = `Reconstruction attempt ${diagnostics.attempt}/${diagnostics.maxAttempts} FAILED validation.

Pipeline: ${diagnostics.pipeline}
Input mesh: ${diagnostics.inputStats.triangles} triangles, ${diagnostics.inputStats.vertices} vertices, bbox ${diagnostics.inputStats.boundingBox.x.toFixed(1)}×${diagnostics.inputStats.boundingBox.y.toFixed(1)}×${diagnostics.inputStats.boundingBox.z.toFixed(1)} mm
Output mesh: ${diagnostics.outputStats.triangles} triangles, ${diagnostics.outputStats.vertices} vertices

Validation failures:
${failureSummary}

Current parameters:
${JSON.stringify(diagnostics.currentParams, null, 2)}

Recommend adjusted parameters for retry.`;

    const systemPrompt = `You are a 3D mesh reconstruction parameter tuner. A reconstruction attempt failed validation. Recommend adjusted parameters for the next attempt.

RULES:
- If non_manifold_edges are high → increase resolution (finer grid captures topology better)
- If degenerate_triangles are high → increase smoothingIterations or slightly reduce resolution
- If boundary_edges are high (mesh not closed) → increase gapBridgingFactor for point_cloud, or increase dilationVoxels for shell_voxel
- If nan_vertices appear → numerical instability: reduce sdfSharpness and increase radiusMultiplier for point_cloud, or increase resolution for voxel
- If empty_mesh → switch pipeline entirely (point_cloud ↔ solid_voxel)
- On attempt 2+, make more aggressive changes (30-50% parameter shifts)
- You may recommend switching pipeline if the current one is fundamentally unsuited

Respond with JSON ONLY (no markdown):
{
  "adjustedVoxelParams": { "resolution": number, "dilationVoxels": number, "smoothingIterations": number, "simplifyTarget": number, "smoothingLambda": number, "boundaryPenalty": number } | null,
  "adjustedPointCloudParams": { "resolution": number, "radiusMultiplier": number, "sdfSharpness": number, "gapBridgingFactor": number, "smoothingIterations": number, "simplifyTarget": number, "smoothingLambda": number, "boundaryPenalty": number } | null,
  "adjustedPostProcess": { "smoothingIterations": number, "simplifyTarget": number, "smoothingLambda": number, "boundaryPenalty": number } | null,
  "switchPipeline": null | "solid_voxel" | "shell_voxel" | "point_cloud",
  "reasoning": "brief explanation"
}`;

    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1024,
        system: systemPrompt,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!resp.ok) {
      throw new Error(`Anthropic API returned ${resp.status}`);
    }

    const data = await resp.json();
    const text: string = data.content?.[0]?.text ?? "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON in response");

    const parsed = JSON.parse(jsonMatch[0]);

    // Sanitize AI-recommended params using existing clamp functions
    const fakeInput: AIMeshAnalysisInput = {
      triangles: diagnostics.inputStats.triangles,
      vertices: diagnostics.inputStats.vertices,
      openEdges: 0,
      nonManifoldEdges: 0,
      boundingBox: diagnostics.inputStats.boundingBox,
      surfaceAreaMM2: 0,
      volumeMM3: 0,
      avgWallThicknessMM: null,
      fileName: "",
    };

    const targetPipeline = parsed.switchPipeline ?? diagnostics.pipeline;

    let voxelParams: VoxelRepairParams | null = null;
    let pcParams: PointCloudRepairParams | null = null;

    if (parsed.adjustedVoxelParams && targetPipeline !== "point_cloud") {
      voxelParams = sanitizeVoxelParams(parsed.adjustedVoxelParams, fakeInput);
    }
    if (parsed.adjustedPointCloudParams && targetPipeline === "point_cloud") {
      pcParams = sanitizePointCloudParams(parsed.adjustedPointCloudParams, fakeInput);
    }

    // If AI didn't provide params for the target pipeline, compute defaults
    if (targetPipeline === "point_cloud" && !pcParams) {
      pcParams = computePointCloudParams(fakeInput);
    } else if (targetPipeline !== "point_cloud" && !voxelParams) {
      voxelParams = computeVoxelParams(fakeInput, targetPipeline === "shell_voxel");
    }

    let postProcess: PostProcessParams | null = null;
    const sourceParams = pcParams ?? voxelParams;
    if (parsed.adjustedPostProcess) {
      postProcess = {
        smoothingIterations: clamp(Math.round(parsed.adjustedPostProcess.smoothingIterations ?? 0), 0, 20),
        simplifyTarget: Math.max(0, Math.round(parsed.adjustedPostProcess.simplifyTarget ?? 0)),
        smoothingLambda: clamp(parsed.adjustedPostProcess.smoothingLambda ?? 0.5, 0.1, 0.8),
        boundaryPenalty: clamp(parsed.adjustedPostProcess.boundaryPenalty ?? 1.0, 1.0, 10.0),
      };
    } else if (sourceParams) {
      postProcess = {
        smoothingIterations: sourceParams.smoothingIterations,
        simplifyTarget: sourceParams.simplifyTarget,
        smoothingLambda: sourceParams.smoothingLambda ?? 0.5,
        boundaryPenalty: sourceParams.boundaryPenalty ?? 1.0,
      };
    }

    return {
      adjustedParams: { voxel: voxelParams, pointCloud: pcParams, postProcess },
      reasoning: parsed.reasoning ?? "AI-adjusted parameters",
      switchPipeline: parsed.switchPipeline ?? undefined,
    };
  } catch (err) {
    console.error("[mesh-analysis-actions] Diagnosis AI call failed:", err instanceof Error ? err.message : err);
    return heuristicRetryAdjustment(diagnostics);
  }
}

/**
 * Deterministic parameter adjustment based on which validation checks failed.
 * Used as fallback when AI diagnosis is unavailable.
 */
function heuristicRetryAdjustment(d: ReconstructionDiagnostics): RetryRecommendation {
  const failedChecks = new Set(d.validationFailures.map((f) => f.check));
  const isPointCloud = d.pipeline === "point_cloud";
  const aggressiveness = d.attempt >= 2 ? 1.5 : 1.0; // more aggressive on later attempts

  // Clone current params
  let voxel: VoxelRepairParams | null = d.currentParams.voxel ? { ...d.currentParams.voxel } : null;
  let pc: PointCloudRepairParams | null = d.currentParams.pointCloud ? { ...d.currentParams.pointCloud } : null;
  let postProcess: PostProcessParams | null = d.currentParams.postProcess ? { ...d.currentParams.postProcess } : null;

  const reasons: string[] = [];

  // Empty mesh → switch pipeline entirely
  if (failedChecks.has("empty_mesh")) {
    if (isPointCloud) {
      reasons.push("Empty output from point cloud — switching to solid voxel");
      return {
        adjustedParams: {
          voxel: voxel ?? {
            resolution: (pc?.resolution ?? 2) * 0.8,
            dilationVoxels: 0,
            smoothingIterations: 3,
            simplifyTarget: d.inputStats.triangles,
            smoothingLambda: 0.5,
            boundaryPenalty: 1.0,
          },
          pointCloud: null,
          postProcess,
        },
        reasoning: reasons.join("; "),
        switchPipeline: "solid_voxel",
      };
    } else {
      reasons.push("Empty output from voxel — switching to point cloud");
      return {
        adjustedParams: {
          voxel: null,
          pointCloud: pc ?? {
            resolution: (voxel?.resolution ?? 2) * 0.8,
            radiusMultiplier: 2,
            sdfSharpness: 0.5,
            gapBridgingFactor: 1.5,
            smoothingIterations: 2,
            simplifyTarget: d.inputStats.triangles,
            smoothingLambda: 0.5,
            boundaryPenalty: 1.0,
          },
          postProcess,
        },
        reasoning: reasons.join("; "),
        switchPipeline: "point_cloud",
      };
    }
  }

  // NaN vertices → numerical instability
  if (failedChecks.has("nan_vertices")) {
    if (isPointCloud && pc) {
      pc.sdfSharpness = clamp((pc.sdfSharpness ?? 0.5) - 0.2 * aggressiveness, 0, 1);
      pc.radiusMultiplier = clamp((pc.radiusMultiplier ?? 2) + 0.5 * aggressiveness, 1, 4);
      reasons.push("NaN vertices — reduced sharpness, increased radius");
    } else if (voxel) {
      voxel.resolution = Math.max(0.5, voxel.resolution * (1 + 0.5 * aggressiveness));
      reasons.push("NaN vertices — increased voxel resolution");
    }
  }

  // Non-manifold edges → finer resolution
  if (failedChecks.has("non_manifold_edges")) {
    if (isPointCloud && pc) {
      pc.resolution = Math.max(0.5, pc.resolution * (1 - 0.3 * aggressiveness));
      reasons.push("Non-manifold edges — decreased point cloud resolution (finer grid)");
    } else if (voxel) {
      voxel.resolution = Math.max(0.5, voxel.resolution * (1 - 0.3 * aggressiveness));
      reasons.push("Non-manifold edges — decreased voxel resolution (finer grid)");
    }
  }

  // Boundary edges → close gaps
  if (failedChecks.has("boundary_edges")) {
    if (isPointCloud && pc) {
      pc.gapBridgingFactor = clamp((pc.gapBridgingFactor ?? 1) + 0.5 * aggressiveness, 1, 3);
      reasons.push("Open boundaries — increased gap bridging factor");
    } else if (d.pipeline === "shell_voxel" && voxel) {
      voxel.dilationVoxels = Math.min(3, (voxel.dilationVoxels ?? 1) + 1);
      reasons.push("Open boundaries — increased dilation voxels");
    } else if (voxel) {
      voxel.resolution = Math.max(0.5, voxel.resolution * (1 + 0.2 * aggressiveness));
      reasons.push("Open boundaries — coarsened voxel grid for more fill");
    }
  }

  // Degenerate triangles → more smoothing
  if (failedChecks.has("degenerate_triangles")) {
    if (postProcess) {
      postProcess.smoothingIterations = Math.min(20, postProcess.smoothingIterations + Math.round(3 * aggressiveness));
      postProcess.smoothingLambda = clamp(postProcess.smoothingLambda + 0.1, 0.1, 0.8);
    }
    reasons.push("Degenerate triangles — increased smoothing");
  }

  if (reasons.length === 0) {
    reasons.push("Unknown failure — minor parameter adjustments applied");
    // General: slightly increase resolution and smoothing
    if (isPointCloud && pc) {
      pc.resolution = Math.max(0.5, pc.resolution * 0.9);
      pc.smoothingIterations = Math.min(20, pc.smoothingIterations + 1);
    } else if (voxel) {
      voxel.resolution = Math.max(0.5, voxel.resolution * 0.9);
      voxel.smoothingIterations = Math.min(20, voxel.smoothingIterations + 1);
    }
  }

  return {
    adjustedParams: { voxel, pointCloud: pc, postProcess },
    reasoning: reasons.join("; "),
  };
}
