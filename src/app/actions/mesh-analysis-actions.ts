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

export interface GeometryDiagnosticsInput {
  avgEdgeLengthMM: number;
  medianEdgeLengthMM: number;
  boundaryLoopCount: number;
  avgGapWidthMM: number;
  maxGapWidthMM: number;
  corruptionClustering: number;  // 0 = spread, 1 = concentrated
  degenerateTriCount: number;
  normalConsistency: number;     // 0–1
}

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
  screenshotBase64?: string;
  geometryDiagnostics?: GeometryDiagnosticsInput;
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
  taubinMu?: number;            // taubin inflate factor (-0.7 to -0.3, default -0.53)
  gridPadding?: number;         // voxel grid padding (1-5 voxels, default 1)
  degenerateThreshold?: number; // barycentric rejection threshold (1e-14 to 1e-6, default 1e-12)
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
  taubinMu?: number;            // taubin inflate factor (-0.7 to -0.3, default -0.53)
  gridPadding?: number;         // grid padding multiplier (1-10, default 3)
  normalSampleDensity?: number; // normal seed sampling density (0.0001-0.1, default 0.001)
  vertexMergePrecision?: number;// vertex dedup precision in mm (0.0001-1, default 0.001)
  outsideBias?: number;         // SDF outside bias (0.01-2, default 1.0)
}

export interface PostProcessParams {
  smoothingIterations: number;
  simplifyTarget: number;
  smoothingLambda: number;      // taubin lambda
  boundaryPenalty: number;      // QEM boundary edge penalty
  taubinMu: number;             // taubin inflate factor (default -0.53)
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
    Math.cbrt(bbox.x * bbox.y * bbox.z / 50_000_000),
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
  const diag = input.geometryDiagnostics;

  // Use median edge length for resolution when diagnostics available
  let resolution = diag && diag.medianEdgeLengthMM > 0
    ? diag.medianEdgeLengthMM * 2
    : maxDim / 600;
  resolution = Math.max(resolution, gridSafetyFloor(input.boundingBox));
  resolution = Math.min(resolution, 20);
  resolution = Math.round(resolution * 10) / 10;

  // Smoothing based on degenerate tri ratio
  const degenRatio = diag ? diag.degenerateTriCount / Math.max(input.triangles, 1) : 0;
  const smoothingIterations = degenRatio > 0.01 ? 5 : degenRatio > 0.001 ? 2 : resolution < 3 ? 0 : 1;

  const simplifyTarget = Math.min(Math.round(input.triangles * 0.8), input.triangles);

  // Sharpness from normal consistency
  let sdfSharpness = 0.5;
  if (diag) {
    if (diag.normalConsistency > 0.95) sdfSharpness = 0.7;
    else if (diag.normalConsistency > 0.8) sdfSharpness = 0.5;
    else sdfSharpness = 0.3;
  }

  // Gap bridging from max gap width
  let gapBridgingFactor = 1.0;
  if (diag && diag.maxGapWidthMM > 0) {
    const gapToRes = diag.maxGapWidthMM / resolution;
    if (gapToRes > 8) gapBridgingFactor = 2.0;
    else if (gapToRes > 3) gapBridgingFactor = 1.5;
  }

  // Boundary penalty from loop count
  let boundaryPenalty = 1.0;
  if (diag) {
    if (diag.boundaryLoopCount > 5) boundaryPenalty = 5.0;
    else if (diag.boundaryLoopCount > 0) boundaryPenalty = 3.0;
  }

  // Radius from edge density
  let radiusMultiplier = 2.0;
  if (diag && diag.avgEdgeLengthMM > 0) {
    if (diag.avgGapWidthMM > 2 * resolution) radiusMultiplier = 2.5;
    else if (diag.avgEdgeLengthMM < resolution / 2) radiusMultiplier = 1.5;
  }

  return {
    resolution,
    smoothingIterations,
    simplifyTarget,
    radiusMultiplier,
    sdfSharpness,
    gapBridgingFactor,
    smoothingLambda: 0.5,
    boundaryPenalty,
  };
}

/** Clamp AI-returned voxel params to safe ranges. */
function sanitizeVoxelParams(params: VoxelRepairParams, input: AIMeshAnalysisInput): VoxelRepairParams {
  const minRes = Math.ceil(gridSafetyFloor(input.boundingBox) * 2) / 2;
  const resolution = Math.max(minRes, Math.min(Math.round((params.resolution || 1) * 10) / 10, 20));
  const dilationVoxels = Math.max(0, Math.min(Math.round(params.dilationVoxels || 0), 3));
  const smoothingIterations = Math.max(0, Math.min(Math.round(params.smoothingIterations || 0), 20));

  let simplifyTarget = Math.round(params.simplifyTarget || 0);
  // Hard ceiling: output must never exceed input triangle count
  if (simplifyTarget <= 0 || simplifyTarget > input.triangles) {
    simplifyTarget = Math.round(input.triangles * 0.8);
  }
  simplifyTarget = Math.min(simplifyTarget, input.triangles);

  return {
    resolution,
    dilationVoxels,
    smoothingIterations,
    simplifyTarget,
    smoothingLambda: clamp(params.smoothingLambda ?? 0.5, 0.1, 0.8),
    boundaryPenalty: clamp(params.boundaryPenalty ?? 1.0, 1.0, 10.0),
    taubinMu: clamp(params.taubinMu ?? -0.53, -0.7, -0.3),
    gridPadding: Math.max(1, Math.min(5, Math.round(params.gridPadding ?? 1))),
    degenerateThreshold: clamp(params.degenerateThreshold ?? 1e-12, 1e-14, 1e-6),
  };
}

/** Clamp AI-returned point cloud params to safe ranges. */
function sanitizePointCloudParams(params: PointCloudRepairParams, input: AIMeshAnalysisInput): PointCloudRepairParams {
  const minRes = Math.ceil(gridSafetyFloor(input.boundingBox) * 2) / 2;
  const resolution = Math.max(minRes, Math.min(Math.round((params.resolution || 1) * 10) / 10, 20));
  const smoothingIterations = Math.max(0, Math.min(Math.round(params.smoothingIterations || 0), 20));

  let simplifyTarget = Math.round(params.simplifyTarget || 0);
  // Hard ceiling: output must never exceed input triangle count
  if (simplifyTarget <= 0 || simplifyTarget > input.triangles) {
    simplifyTarget = Math.round(input.triangles * 0.8);
  }
  simplifyTarget = Math.min(simplifyTarget, input.triangles);

  return {
    resolution,
    smoothingIterations,
    simplifyTarget,
    radiusMultiplier: clamp(params.radiusMultiplier ?? 2, 1, 4),
    sdfSharpness: clamp(params.sdfSharpness ?? 0.5, 0.0, 1.0),
    gapBridgingFactor: clamp(params.gapBridgingFactor ?? 1.0, 1.0, 3.0),
    smoothingLambda: clamp(params.smoothingLambda ?? 0.5, 0.1, 0.8),
    boundaryPenalty: clamp(params.boundaryPenalty ?? 1.0, 1.0, 10.0),
    taubinMu: clamp(params.taubinMu ?? -0.53, -0.7, -0.3),
    gridPadding: Math.max(1, Math.min(10, Math.round(params.gridPadding ?? 3))),
    normalSampleDensity: clamp(params.normalSampleDensity ?? 0.001, 0.0001, 0.1),
    vertexMergePrecision: clamp(params.vertexMergePrecision ?? 0.001, 0.0001, 1),
    outsideBias: clamp(params.outsideBias ?? 1.0, 0.01, 2.0),
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

const SYSTEM_PROMPT = `You are a 3D mesh geometry analyzer. You receive mesh statistics, geometry diagnostics, and a viewport screenshot. Your job is to mathematically analyze the corruption and prescribe exact reconstruction parameters. Return ONLY a JSON object.

CLASSIFICATION RULES:
- SA/volume > 0.05 OR wall < 1% maxDim → thin_shell
- Open edges > 5% of total → severely damaged
- Non-manifold > 1% → corrupted topology
- Open edges < 1% → topology_repair only (do NOT reconstruct healthy meshes)

STRATEGY RULES:
- topology_repair: <1% defective edges. Preserves geometry exactly.
- solid_voxel: Broken solid (SA/vol < 0.05). Fills interior. NEVER on thin shells.
- point_cloud: Broken thin shell. MLS/SDF. Preserves openings.
- shell_voxel: Thin shell fallback if point_cloud fails.

USE GEOMETRY DIAGNOSTICS TO SET PARAMETERS:
- resolution: Set to 2× medianEdgeLength for detail preservation. Clamp to [FLOOR, 20mm].
  FLOOR: max(maxDim/1000, cbrt(X*Y*Z/5e7), 0.5)
- gapBridgingFactor: Based on maxGapWidth vs resolution.
  If maxGapWidth < 3×resolution → 1.0 (gaps close naturally)
  If maxGapWidth < 8×resolution → 1.5 (moderate bridging)
  If maxGapWidth > 8×resolution → 2.0+ (aggressive bridging)
  BUT if hasIntentionalOpenings → cap at 1.0
- sdfSharpness: Based on normalConsistency.
  normalConsistency > 0.95 → 0.7-0.9 (normals are clean, preserve sharp edges)
  normalConsistency 0.8-0.95 → 0.4-0.6 (some noise, moderate smoothing)
  normalConsistency < 0.8 → 0.2-0.4 (noisy, needs smoothing)
- smoothingIterations: Based on degenerateTriCount / totalTriangles.
  <0.1% degenerate → 0-1 passes
  0.1-1% → 2-3 passes
  >1% → 5+ passes
- boundaryPenalty: Based on boundaryLoopCount.
  0 loops → 1.0 (watertight, no boundaries to protect)
  1-5 loops → 3.0 (few openings, moderate protection)
  >5 loops → 5.0-8.0 (many boundaries, strong protection)
- corruptionClustering > 0.7 means damage is localized — use finer resolution to capture detail in the damaged region
- simplifyTarget: floor(inputTriangles × 0.8). MUST NEVER exceed inputTriangles.
- smoothingLambda: 0.3 mechanical, 0.5 mixed, 0.7 organic
- dilationVoxels: 0 solid, 1 shell, 2 shell >10% open
- radiusMultiplier: 2.0 default. If avgGapWidth > 2×resolution, increase to 2.5. If mesh is dense (avgEdgeLength < resolution/2), reduce to 1.5.

ADVANCED TUNING (set based on diagnostics):
- taubinMu: Controls inflation after smoothing. Default -0.53.
  More negative (-0.6 to -0.7) = stronger inflation (use when volume preservation matters, e.g. solid bodies).
  Less negative (-0.3 to -0.4) = weaker inflation (use for thin shells to avoid puffing).
- gridPadding: Voxel: 1-5 (default 1). Point cloud: 1-10 (default 3).
  Increase for meshes with geometry at bounding box edges.
  If boundaryLoopCount > 3, increase by 1-2 to capture edge gaps.
- normalSampleDensity: 0.001 default. Increase to 0.01-0.05 for noisy meshes (normalConsistency < 0.85).
- vertexMergePrecision: 0.001mm default. For scan data (noisy), use 0.01-0.1. For CAD, use 0.0001.
- outsideBias: 1.0 default. Lower (0.3-0.5) biases SDF toward filling — good for meshes with many small holes.
  If corruptionClustering > 0.7 (damage localized), keep at 1.0 (don't over-fill healthy regions).
- degenerateThreshold: 1e-12 default. For meshes with high degenerateTriCount, increase to 1e-8 to skip more bad triangles during voxelization.

Keep "reasoning" under 30 words. Keep "warnings" to max 2 items, under 15 words each.

{
  "meshType": "solid_body|thin_shell|multi_body|surface_patch",
  "repairStrategy": "topology_repair|solid_voxel|shell_voxel|point_cloud|manual",
  "confidence": 0.0-1.0,
  "reasoning": "Brief: what it is, what's wrong, why this strategy",
  "warnings": ["max 2 short warnings"],
  "modelId": {
    "category": "car_body|bracket|figurine|etc",
    "description": "One-line identification",
    "expectedFeatures": ["feature1", "feature2"],
    "geometryClass": "mechanical|organic|architectural|mixed",
    "hasIntentionalOpenings": true,
    "estimatedWallCharacter": "uniform_thin|variable_thin|solid|mixed"
  },
  "repairGuidance": {
    "strategyRationale": "One sentence max",
    "risks": ["max 2 short risks"],
    "postRepairChecklist": ["max 2 items"]
  },
  "voxelParams": { "resolution": N, "dilationVoxels": N, "smoothingIterations": N, "simplifyTarget": N, "smoothingLambda": N, "boundaryPenalty": N, "taubinMu": N, "gridPadding": N, "degenerateThreshold": N } | null,
  "pointCloudParams": { "resolution": N, "radiusMultiplier": N, "sdfSharpness": N, "gapBridgingFactor": N, "smoothingIterations": N, "simplifyTarget": N, "smoothingLambda": N, "boundaryPenalty": N, "taubinMu": N, "gridPadding": N, "normalSampleDensity": N, "vertexMergePrecision": N, "outsideBias": N } | null
}`;

// ─── AI Provider Helpers ─────────────────────────────────────────────────────

/** Call Google Gemini 2.5 Pro for primary mesh analysis (best math/geometry reasoning). */
async function callGemini(apiKey: string, prompt: string, screenshotBase64?: string): Promise<string> {
  const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [];

  if (screenshotBase64) {
    parts.push({ inlineData: { mimeType: "image/png", data: screenshotBase64 } });
  }
  parts.push({ text: prompt });

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-pro-preview:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [{ role: "user", parts }],
        generationConfig: {
          responseMimeType: "application/json",
          maxOutputTokens: 4096,
        },
      }),
    },
  );

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Gemini API error ${response.status}: ${errText.slice(0, 200)}`);
  }

  const data = await response.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
}

/** Call Anthropic Claude as fallback for mesh analysis. */
async function callAnthropic(apiKey: string, prompt: string, screenshotBase64?: string): Promise<string> {
  type ContentBlock =
    | { type: "text"; text: string }
    | { type: "image"; source: { type: "base64"; media_type: "image/png"; data: string } };

  const content: ContentBlock[] = [];
  if (screenshotBase64) {
    content.push({ type: "image", source: { type: "base64", media_type: "image/png", data: screenshotBase64 } });
  }
  content.push({ type: "text", text: prompt });

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content }],
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Anthropic API error ${response.status}: ${errText.slice(0, 200)}`);
  }

  const data = await response.json() as { content: Array<{ type: string; text: string }> };
  return data.content.find((b) => b.type === "text")?.text ?? "";
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function analyzeMeshWithAI(
  input: AIMeshAnalysisInput
): Promise<AIMeshAnalysisResult> {
  const geminiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;

  if (!geminiKey && !anthropicKey) {
    return {
      ...heuristicAnalysis(input),
      error: "No AI API key configured — using heuristic analysis.",
    };
  }

  const saVolRatio =
    input.volumeMM3 > 0
      ? (input.surfaceAreaMM2 / input.volumeMM3).toFixed(4)
      : "N/A (zero volume)";

  const diag = input.geometryDiagnostics;
  const statsText = `File: ${input.fileName}
Triangles: ${input.triangles.toLocaleString()}
Vertices: ${input.vertices.toLocaleString()}
Bounding box: ${input.boundingBox.x.toFixed(1)} × ${input.boundingBox.y.toFixed(1)} × ${input.boundingBox.z.toFixed(1)} mm
Surface area: ${input.surfaceAreaMM2.toFixed(0)} mm²
Volume: ${input.volumeMM3.toFixed(0)} mm³
SA/Volume ratio: ${saVolRatio}
Open edges: ${input.openEdges.toLocaleString()} (${((input.openEdges / (input.triangles * 1.5 || 1)) * 100).toFixed(1)}% of total)
Non-manifold edges: ${input.nonManifoldEdges.toLocaleString()} (${((input.nonManifoldEdges / (input.triangles * 1.5 || 1)) * 100).toFixed(1)}% of total)
${input.avgWallThicknessMM !== null ? `Wall thickness: ${input.avgWallThicknessMM.toFixed(1)} mm` : "Wall thickness: unknown"}
Max dimension: ${Math.max(input.boundingBox.x, input.boundingBox.y, input.boundingBox.z).toFixed(1)} mm${diag ? `
--- GEOMETRY DIAGNOSTICS ---
Avg edge length: ${diag.avgEdgeLengthMM} mm
Median edge length: ${diag.medianEdgeLengthMM} mm
Boundary loops: ${diag.boundaryLoopCount}
Avg gap width: ${diag.avgGapWidthMM} mm
Max gap width: ${diag.maxGapWidthMM} mm
Corruption clustering: ${diag.corruptionClustering} (0=spread, 1=concentrated)
Degenerate triangles: ${diag.degenerateTriCount}
Normal consistency: ${diag.normalConsistency} (1.0=perfect)` : ""}`;

  const userPrompt = `Analyze this 3D mesh. Identify what the object is, classify its damage, and return precise repair parameters.\n\n${statsText}`;

  try {
    let rawText: string;

    if (geminiKey) {
      // Primary: Gemini 2.5 Pro — best for heavy geometry math and parameter calculations
      rawText = await callGemini(geminiKey, userPrompt, input.screenshotBase64);
    } else {
      // Fallback: Anthropic Claude
      rawText = await callAnthropic(anthropicKey!, userPrompt, input.screenshotBase64);
    }

    let jsonText = rawText.replace(/```[a-z]*\n?/gi, "").trim();
    // Extract the outermost JSON object even if there's trailing garbage
    const jsonStart = jsonText.indexOf("{");
    if (jsonStart >= 0) {
      jsonText = jsonText.slice(jsonStart);
      // Find the matching closing brace
      let depth = 0;
      let end = -1;
      for (let i = 0; i < jsonText.length; i++) {
        if (jsonText[i] === "{") depth++;
        else if (jsonText[i] === "}") { depth--; if (depth === 0) { end = i; break; } }
      }
      if (end > 0) jsonText = jsonText.slice(0, end + 1);
    }
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
            taubinMu: voxel.taubinMu ?? -0.53,
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
            taubinMu: pc.taubinMu ?? -0.53,
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
        taubinMu: clamp(parsed.adjustedPostProcess.taubinMu ?? -0.53, -0.7, -0.3),
      };
    } else if (sourceParams) {
      postProcess = {
        smoothingIterations: sourceParams.smoothingIterations,
        simplifyTarget: sourceParams.simplifyTarget,
        smoothingLambda: sourceParams.smoothingLambda ?? 0.5,
        boundaryPenalty: sourceParams.boundaryPenalty ?? 1.0,
        taubinMu: (sourceParams as PointCloudRepairParams).taubinMu ?? -0.53,
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
