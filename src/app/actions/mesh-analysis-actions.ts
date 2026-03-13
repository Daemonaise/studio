'use server';

// mesh-analysis-actions.ts
// Server action: calls the Anthropic API to classify a 3-D mesh and recommend
// a repair strategy.  Requires ANTHROPIC_API_KEY in the environment.
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

export interface AIMeshAnalysisResult {
  meshType: MeshType;
  repairStrategy: RepairStrategy;
  confidence: number;  // 0–1
  reasoning: string;
  warnings: string[];
  /** Executable repair plan — consumed directly by the voxel pipeline. */
  repairPlan?: RepairPlan;
  /** Set when the AI call was skipped or failed; result is heuristic-only. */
  heuristic?: true;
  error?: string;
}

// ─── Executable repair plan ──────────────────────────────────────────────────

export interface VoxelRepairParams {
  resolution: number;           // mm per voxel
  dilationVoxels: number;       // 0 for solid, 1-2 for shell
  smoothingIterations: number;  // taubin smoothing passes post-reconstruction
  simplifyTarget: number;       // target triangle count (0 = no simplify)
}

export interface PointCloudRepairParams {
  resolution: number;           // mm per grid cell
  smoothingIterations: number;  // taubin smoothing passes post-reconstruction
  simplifyTarget: number;       // target triangle count (0 = no simplify)
  radiusMultiplier: number;     // MLS smoothing radius = resolution * this (default 2)
}

export interface RepairPlan {
  pipeline: "topology" | "solid_voxel" | "shell_voxel" | "point_cloud";
  params: {
    voxel: VoxelRepairParams | null;
    pointCloud?: PointCloudRepairParams | null;
  };
  expect: {
    watertight: boolean;
    maxTriangles: number;
  };
  userMessage: string;
}

// ─── Heuristic fallback ───────────────────────────────────────────────────────

/**
 * Estimate how many triangles the block-mesh / MC surface extraction will
 * produce for a given bounding box and resolution.  This must match the
 * formula in voxel-reconstruct.ts → estimateOutputTriangles().
 */
function estimateVoxelOutputTris(
  bbox: { x: number; y: number; z: number },
  resolution: number,
): number {
  const gx = Math.ceil(bbox.x / resolution) + 2;
  const gy = Math.ceil(bbox.y / resolution) + 2;
  const gz = Math.ceil(bbox.z / resolution) + 2;
  return 4 * (gx * gy + gy * gz + gz * gx);
}

function computeVoxelParams(input: AIMeshAnalysisInput, isShell: boolean): VoxelRepairParams {
  const maxDim = Math.max(input.boundingBox.x, input.boundingBox.y, input.boundingBox.z, 1);
  const totalEdges = input.triangles * 1.5 || 1;
  const openPct = input.openEdges / totalEdges;

  // Resolution: finer for shells, coarser for solids
  let resolution = isShell ? maxDim / 800 : maxDim / 500;
  resolution = Math.max(0.5, Math.min(resolution, 20));
  // Enforce grid-safety floor: max 1000 voxels/axis, 200M total
  const gridFloor = Math.max(
    maxDim / 1000,
    Math.cbrt(input.boundingBox.x * input.boundingBox.y * input.boundingBox.z / 200_000_000),
  );
  resolution = Math.max(resolution, gridFloor);
  resolution = Math.round(resolution * 10) / 10;

  // Dilation: 0 for solid, 1 normally, 2 if heavily broken
  const dilationVoxels = isShell ? (openPct > 0.1 ? 2 : 1) : 0;

  // Smoothing: more passes for coarser resolution
  const smoothingIterations =
    resolution < 2 ? 0 : resolution <= 6 ? 3 : resolution <= 10 ? 5 : 10;

  // Simplify target: match or slightly reduce the *input* triangle count.
  // Voxelization over-tessellates (often 4-8x), so the simplifier should
  // bring it back down to input-scale complexity, not 80% of the bloated output.
  const simplifyTarget = Math.round(input.triangles * 0.8);

  return { resolution, dilationVoxels, smoothingIterations, simplifyTarget };
}

/** Clamp AI-returned voxel params to safe ranges. */
function sanitizeVoxelParams(params: VoxelRepairParams, input: AIMeshAnalysisInput): VoxelRepairParams {
  // Grid safety floor: same formula as minSafeResolution in voxel-reconstruct.ts
  const maxDim = Math.max(input.boundingBox.x, input.boundingBox.y, input.boundingBox.z, 1);
  const gridFloor = Math.max(
    maxDim / 1000,
    Math.cbrt(input.boundingBox.x * input.boundingBox.y * input.boundingBox.z / 200_000_000),
    0.5,
  );
  const minRes = Math.ceil(gridFloor * 2) / 2; // round up to 0.5 step
  const resolution = Math.max(minRes, Math.min(Math.round((params.resolution || 1) * 10) / 10, 20));
  const dilationVoxels = Math.max(0, Math.min(Math.round(params.dilationVoxels || 0), 3));
  const smoothingIterations = Math.max(0, Math.min(Math.round(params.smoothingIterations || 0), 20));

  // Simplify target: should match input-scale complexity, not voxel output.
  // Voxelization over-tessellates (4-8x), simplifier reduces back down.
  let simplifyTarget = Math.round(params.simplifyTarget || 0);
  const inputScale = Math.round(input.triangles * 0.8);
  if (simplifyTarget <= 0 || simplifyTarget > input.triangles * 2) {
    // AI gave no target or an unreasonably high one — use 80% of input
    simplifyTarget = inputScale;
  }

  return { resolution, dilationVoxels, smoothingIterations, simplifyTarget };
}

function computePointCloudParams(input: AIMeshAnalysisInput): PointCloudRepairParams {
  const maxDim = Math.max(input.boundingBox.x, input.boundingBox.y, input.boundingBox.z, 1);
  // Target ~600 cells on longest axis for high-quality reconstruction
  let resolution = maxDim / 600;
  // Grid safety floor
  const gridFloor = Math.max(
    maxDim / 1000,
    Math.cbrt(input.boundingBox.x * input.boundingBox.y * input.boundingBox.z / 200_000_000),
    0.5,
  );
  resolution = Math.max(resolution, gridFloor);
  resolution = Math.round(resolution * 10) / 10;

  // Lighter smoothing to preserve sharp panel details
  const smoothingIterations = resolution < 3 ? 0 : resolution <= 5 ? 1 : resolution <= 8 ? 2 : 3;
  // Allow more triangles — MC at higher res produces denser meshes
  const simplifyTarget = Math.round(input.triangles * 1.5);
  const radiusMultiplier = 2;

  return { resolution, smoothingIterations, simplifyTarget, radiusMultiplier };
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

  if (openPct < 0.01) {
    return {
      meshType: thinShell ? "thin_shell" : "solid_body",
      repairStrategy: "topology_repair",
      confidence: 0.8,
      reasoning: "Less than 1 % open edges — topology repair should suffice.",
      warnings: [],
      heuristic: true,
    };
  }

  // Thin shells → point cloud reconstruction (MLS/SDF).
  // Shell voxel fails on thin shells where wall thickness < voxel resolution.
  if (thinShell) {
    const pc = computePointCloudParams(input);
    return {
      meshType: "thin_shell",
      repairStrategy: "point_cloud",
      confidence: 0.8,
      reasoning:
        "Thin shell detected (high SA/volume ratio or wall thickness < 1% of max dimension). " +
        "Point cloud reconstruction (MLS/SDF) preserves thin surfaces and openings where voxel methods fail.",
      warnings: [
        "Large openings (windows, doors) will be preserved — no surface is created where there are no input points.",
      ],
      repairPlan: {
        pipeline: "point_cloud",
        params: { voxel: null, pointCloud: pc },
        expect: { watertight: true, maxTriangles: pc.simplifyTarget > 0 ? pc.simplifyTarget : input.triangles },
        userMessage: `Point cloud reconstruction at ${pc.resolution} mm resolution with ${pc.smoothingIterations} smoothing passes, target ${pc.simplifyTarget.toLocaleString()} triangles.`,
      },
      heuristic: true,
    };
  }

  const voxel = computeVoxelParams(input, false);
  return {
    meshType: "solid_body",
    repairStrategy: "solid_voxel",
    confidence: 0.7,
    reasoning: "Significant open edges on what appears to be a solid body.",
    warnings: [],
    repairPlan: {
      pipeline: "solid_voxel",
      params: { voxel },
      expect: { watertight: true, maxTriangles: voxel.simplifyTarget > 0 ? voxel.simplifyTarget : input.triangles },
      userMessage: `Solid reconstruction at ${voxel.resolution} mm resolution with ${voxel.smoothingIterations} smoothing passes, target ${voxel.simplifyTarget.toLocaleString()} triangles.`,
    },
    heuristic: true,
  };
}

// ─── Main export ──────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a 3D mesh analysis assistant. Given mesh statistics and optionally a viewport screenshot, classify the mesh type, recommend a repair strategy, and return executable repair parameters.

MESH TYPES:
- solid_body: Enclosed solid object (engine block, bracket, solid printed part). Has definable interior volume. SA/volume ratio is low.
- thin_shell: Single-layer surface (car body panel, sheet metal, monocoque). No meaningful interior volume. SA/volume ratio is high. May have intentional openings (windows, doors, wheel arches).
- multi_body: Multiple separate solid bodies in one file (assembly export). Multiple disconnected shells.
- surface_patch: Open surface that is not meant to be watertight (aero surface, terrain, scan data). Large percentage of boundary edges.

REPAIR STRATEGIES:
- topology_repair: For meshes with <1% defective edges. Fast, preserves geometry exactly.
- solid_voxel: For broken solid bodies. Parity voxelization + flood-fill + block mesh. Fills interior solid. NEVER use on thin shells — it closes windows and openings.
- point_cloud: PREFERRED for broken thin shells (car bodies, panels, monocoques). Uses MLS/SDF point cloud reconstruction. Extracts oriented points from triangle soup, builds SDF via weighted normal projection, runs marching cubes. Handles thin walls, overlapping patches, and gaps. Preserves large openings (windows, doors). Memory scales with surface area, not bounding volume. Use this instead of shell_voxel for thin shells.
- shell_voxel: Fallback for thin shells only if point_cloud is not appropriate. Surface rasterization + 3D dilation + block mesh. May fail if wall thickness < voxel resolution.
- manual: Too ambiguous or complex. Flag for user intervention.

KEY DIAGNOSTIC RATIOS:
- SA/volume ratio > 0.05: likely thin shell
- Open edges / total edges > 5%: severely broken
- Wall thickness < 1% of max bounding-box dimension: thin shell
- File name contains "body", "panel", "shell", "skin", "cover", "monocoque": strong thin-shell hint

VOXEL PARAMETER RULES (only when repairStrategy is solid_voxel or shell_voxel):
- resolution: Start with maxDimension/500 for solids, maxDimension/800 for shells.
  HARD MINIMUM: resolution must be >= max(maxDimension/1000, cbrt(bbX*bbY*bbZ / 200000000), 0.5), rounded up to nearest 0.5mm.
  This ensures the voxel grid stays under 1000 voxels/axis and 200M total voxels.
  Maximum: 20mm. If your computed resolution is below the hard minimum, use the minimum.
- dilationVoxels: 0 for solid, 1 for shell, 2 for shell with >10% open edges
- smoothingIterations: 0 if resolution<2mm, 3 if 2-6mm, 5 if 6-10mm, 10 if >10mm
- simplifyTarget: originalTriangles * 0.8 (marching-cubes/block-mesh over-tessellates)

POINT CLOUD PARAMETER RULES (only when repairStrategy is point_cloud):
- resolution: maxDimension/600, with the same hard minimum as voxel params.
- radiusMultiplier: 2 (MLS smoothing radius = resolution * radiusMultiplier). Lower values preserve sharper details.
- smoothingIterations: 0 if resolution<3mm, 1 if 3-5mm, 2 if 5-8mm, 3 if >8mm
- simplifyTarget: originalTriangles * 1.5

Respond with a JSON object only. No markdown, no backticks, no commentary. Schema:
{"meshType":"…","repairStrategy":"…","confidence":0.0–1.0,"reasoning":"…","warnings":["…"],"voxelParams":{"resolution":number,"dilationVoxels":number,"smoothingIterations":number,"simplifyTarget":number}|null,"pointCloudParams":{"resolution":number,"smoothingIterations":number,"simplifyTarget":number,"radiusMultiplier":number}|null}`;

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
Non-manifold edges: ${input.nonManifoldEdges.toLocaleString()}
${input.avgWallThicknessMM !== null ? `Estimated wall thickness: ${input.avgWallThicknessMM.toFixed(1)} mm` : "Wall thickness: unknown"}`;

  // Build message content — screenshot first (vision context), then text
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
    text: `Analyze this 3D mesh and classify it:\n\n${statsText}`,
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
        max_tokens: 512,
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
    // Strip any accidental markdown fences
    const jsonText = rawText.replace(/```[a-z]*\n?/gi, "").trim();
    const parsed = JSON.parse(jsonText) as {
      meshType: MeshType;
      repairStrategy: RepairStrategy;
      confidence: number;
      reasoning: string;
      warnings: string[];
      voxelParams?: VoxelRepairParams | null;
      pointCloudParams?: PointCloudRepairParams | null;
    };

    // Build executable repair plan from AI-returned params
    let repairPlan: RepairPlan | undefined;
    const strategy = parsed.repairStrategy;
    if (strategy === "solid_voxel" || strategy === "shell_voxel") {
      // Use AI params (sanitized) if provided, otherwise compute heuristically
      const voxel = parsed.voxelParams
        ? sanitizeVoxelParams(parsed.voxelParams, input)
        : computeVoxelParams(input, strategy === "shell_voxel");
      const label = strategy === "shell_voxel" ? "Shell" : "Solid";
      repairPlan = {
        pipeline: strategy,
        params: { voxel },
        expect: {
          watertight: true,
          maxTriangles: voxel.simplifyTarget > 0 ? voxel.simplifyTarget : input.triangles,
        },
        userMessage: `${label} reconstruction at ${voxel.resolution} mm resolution with ${voxel.smoothingIterations} smoothing passes, target ${voxel.simplifyTarget.toLocaleString()} triangles.`,
      };
    } else if (strategy === "point_cloud") {
      const pc = parsed.pointCloudParams ?? computePointCloudParams(input);
      repairPlan = {
        pipeline: "point_cloud",
        params: { voxel: null, pointCloud: pc },
        expect: {
          watertight: true,
          maxTriangles: pc.simplifyTarget > 0 ? pc.simplifyTarget : input.triangles,
        },
        userMessage: `Point cloud reconstruction at ${pc.resolution} mm resolution with ${pc.smoothingIterations} smoothing passes, target ${pc.simplifyTarget.toLocaleString()} triangles.`,
      };
    }

    return {
      meshType: parsed.meshType,
      repairStrategy: parsed.repairStrategy,
      confidence: parsed.confidence ?? 0.8,
      reasoning: parsed.reasoning ?? "",
      warnings: Array.isArray(parsed.warnings) ? parsed.warnings : [],
      repairPlan,
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
