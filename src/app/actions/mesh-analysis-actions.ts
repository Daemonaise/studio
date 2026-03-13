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

export interface RepairPlan {
  pipeline: "topology" | "solid_voxel" | "shell_voxel";
  params: {
    voxel: VoxelRepairParams | null;
  };
  expect: {
    watertight: boolean;
    maxTriangles: number;
  };
  userMessage: string;
}

// ─── Heuristic fallback ───────────────────────────────────────────────────────

function computeVoxelParams(input: AIMeshAnalysisInput, isShell: boolean): VoxelRepairParams {
  const maxDim = Math.max(input.boundingBox.x, input.boundingBox.y, input.boundingBox.z, 1);
  const totalEdges = input.triangles * 1.5 || 1;
  const openPct = input.openEdges / totalEdges;

  // Resolution: finer for shells, coarser for solids
  let resolution = isShell ? maxDim / 800 : maxDim / 500;
  resolution = Math.max(0.5, Math.min(resolution, 20));
  resolution = Math.round(resolution * 10) / 10;

  // Dilation: 0 for solid, 1 normally, 2 if heavily broken
  const dilationVoxels = isShell ? (openPct > 0.1 ? 2 : 1) : 0;

  // Smoothing: more passes for coarser resolution
  const smoothingIterations =
    resolution < 2 ? 0 : resolution <= 6 ? 3 : resolution <= 10 ? 5 : 10;

  // Simplify target: aim for ~80% of original
  const simplifyTarget = Math.round(input.triangles * 0.8);

  return { resolution, dilationVoxels, smoothingIterations, simplifyTarget };
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

  if (thinShell) {
    const voxel = computeVoxelParams(input, true);
    return {
      meshType: "thin_shell",
      repairStrategy: "shell_voxel",
      confidence: 0.7,
      reasoning:
        "High SA/volume ratio or thin wall estimate suggests a shell mesh. " +
        "Solid flood-fill would close intentional openings.",
      warnings: ["Shell will be thickened by the dilation pass (~1–2× voxel size)."],
      repairPlan: {
        pipeline: "shell_voxel",
        params: { voxel },
        expect: { watertight: true, maxTriangles: voxel.simplifyTarget > 0 ? voxel.simplifyTarget : input.triangles },
        userMessage: `Shell reconstruction at ${voxel.resolution} mm resolution with ${voxel.smoothingIterations} smoothing passes.`,
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
      userMessage: `Solid reconstruction at ${voxel.resolution} mm resolution with ${voxel.smoothingIterations} smoothing passes.`,
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
- shell_voxel: For broken thin shells. Surface rasterization + 3D dilation + block mesh. Preserves openings, thickens shell to make watertight.
- manual: Too ambiguous or complex. Flag for user intervention.

KEY DIAGNOSTIC RATIOS:
- SA/volume ratio > 0.05: likely thin shell
- Open edges / total edges > 5%: severely broken
- Wall thickness < 1% of max bounding-box dimension: thin shell
- File name contains "body", "panel", "shell", "skin", "cover", "monocoque": strong thin-shell hint

VOXEL PARAMETER RULES (only when repairStrategy is solid_voxel or shell_voxel):
- resolution: maxDimension/500 for solids, maxDimension/800 for shells, clamped to [0.5, 20] mm
- dilationVoxels: 0 for solid, 1 for shell, 2 for shell with >10% open edges
- smoothingIterations: 0 if resolution<2mm, 3 if 2-6mm, 5 if 6-10mm, 10 if >10mm
- simplifyTarget: originalTriangles * 0.8 (marching-cubes/block-mesh over-tessellates)

Respond with a JSON object only. No markdown, no backticks, no commentary. Schema:
{"meshType":"…","repairStrategy":"…","confidence":0.0–1.0,"reasoning":"…","warnings":["…"],"voxelParams":{"resolution":number,"dilationVoxels":number,"smoothingIterations":number,"simplifyTarget":number}|null}`;

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
    };

    // Build executable repair plan from AI-returned params
    let repairPlan: RepairPlan | undefined;
    const strategy = parsed.repairStrategy;
    if ((strategy === "solid_voxel" || strategy === "shell_voxel") && parsed.voxelParams) {
      repairPlan = {
        pipeline: strategy,
        params: { voxel: parsed.voxelParams },
        expect: {
          watertight: true,
          maxTriangles: parsed.voxelParams.simplifyTarget > 0
            ? parsed.voxelParams.simplifyTarget
            : input.triangles,
        },
        userMessage: `${strategy === "shell_voxel" ? "Shell" : "Solid"} reconstruction at ${parsed.voxelParams.resolution} mm resolution with ${parsed.voxelParams.smoothingIterations} smoothing passes, target ${parsed.voxelParams.simplifyTarget.toLocaleString()} triangles.`,
      };
    } else if ((strategy === "solid_voxel" || strategy === "shell_voxel") && !parsed.voxelParams) {
      // AI didn't return params — compute heuristically
      const voxel = computeVoxelParams(input, strategy === "shell_voxel");
      repairPlan = {
        pipeline: strategy,
        params: { voxel },
        expect: { watertight: true, maxTriangles: voxel.simplifyTarget > 0 ? voxel.simplifyTarget : input.triangles },
        userMessage: `${strategy === "shell_voxel" ? "Shell" : "Solid"} reconstruction at ${voxel.resolution} mm resolution.`,
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
