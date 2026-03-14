"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import {
  Upload, FileBox, Cpu, Scissors, Package,
  ChevronDown, ChevronRight, Plus, Minus, Download,
  RotateCcw, Info, AlertTriangle, CheckCircle2, Loader2,
  Maximize2, Link2, Eye, ZapOff, Zap, Keyboard, X,
  Target, Scale, Send, Menu, Wrench, ArrowLeft, Ruler, Boxes, Sparkles, Cloud, CloudOff,
} from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
// toast removed — using sidebar notifications instead
import type { MeshInfo, CutPlane, TransformState, SplitPartVisual, ViewportHandle } from "./viewport";
import type { SplitPart } from "./manifold-engine";
import printerProfiles from "@/app/data/printer-profiles.json";
import { cn } from "@/lib/utils";
import { uploadToKaraslice, batchUploadJob, type BatchUploadEntry } from "@/app/actions/storage-actions";
import {
  submitCloudRepairJob,
  getRepairJobStatus,
  getRepairResultUrl,
  type RepairJobStatus,
} from "@/app/actions/cloud-repair-actions";

// Only load Three.js viewport client-side
const Viewport = dynamic(
  () => import("./viewport").then((m) => m.Viewport),
  { ssr: false }
) as React.ForwardRefExoticComponent<
  React.ComponentPropsWithoutRef<typeof import("./viewport").Viewport> &
  React.RefAttributes<ViewportHandle>
>;

// ─── Types ────────────────────────────────────────────────────────────────────

type Tab = "file" | "prepare" | "presplit" | "split" | "export";

interface PrinterProfile {
  id: string; name: string; brand: string;
  x: number; y: number; z: number;
}

interface AnalysisResult {
  triangleCount: number;
  vertexCount: number;
  isWatertight: boolean;
  openEdgeCount: number;
  nonManifoldEdgeCount: number;
  surfaceAreaMM2: number;
  volumeMM3: number;
  issues: string[];
}

// ─── Constants ────────────────────────────────────────────────────────────────

const MATERIAL_DENSITIES = [
  { id: "pla",   label: "PLA",          density: 1.24 },
  { id: "petg",  label: "PETG",         density: 1.27 },
  { id: "abs",   label: "ABS",          density: 1.05 },
  { id: "asa",   label: "ASA",          density: 1.07 },
  { id: "tpu",   label: "TPU",          density: 1.21 },
  { id: "nylon", label: "Nylon (PA12)", density: 1.15 },
  { id: "resin", label: "Resin (std)",  density: 1.10 },
  { id: "cf",    label: "Carbon Fiber", density: 1.30 },
];

const AXIS_COLORS: Record<string, string> = {
  x: "text-red-400",
  y: "text-green-400",
  z: "text-blue-400",
};

const DEFAULT_TRANSFORMS: TransformState = {
  scaleX: 1, scaleY: 1, scaleZ: 1,
  rotX: 0, rotY: 0, rotZ: 0,
};

type DisplayUnit = "mm" | "cm" | "in";

const UNIT_LABELS: Record<DisplayUnit, string> = {
  mm: "mm",
  cm: "cm",
  in: "in",
};

/** Conversion factor: multiply mm value by this to get display value. */
const MM_TO_UNIT: Record<DisplayUnit, number> = {
  mm: 1,
  cm: 0.1,
  in: 1 / 25.4,
};

/** Conversion factor: multiply display value by this to get mm value. */
const UNIT_TO_MM: Record<DisplayUnit, number> = {
  mm: 1,
  cm: 10,
  in: 25.4,
};

/** Format a mm value into the selected display unit. */
function fmtDim(mm: number, unit: DisplayUnit, decimals?: number): string {
  const val = mm * MM_TO_UNIT[unit];
  const d = decimals ?? (unit === "in" ? 2 : unit === "cm" ? 1 : 1);
  return val.toFixed(d);
}

const KEYBOARD_SHORTCUTS = [
  ["E", "Toggle explode view"],
  ["G", "Toggle ghost mode"],
  ["W", "Toggle wireframe"],
  ["?", "Toggle this overlay"],
];

// ─── Sub-components ───────────────────────────────────────────────────────────

function SectionHeader({ icon: Icon, label, open, onToggle }: {
  icon: React.ElementType; label: string; open: boolean; onToggle: () => void;
}) {
  return (
    <button
      onClick={onToggle}
      className="flex w-full items-center gap-2 px-3 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors"
    >
      {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
      <Icon className="h-3 w-3" />
      {label}
    </button>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-2 text-xs">
      <span className="text-muted-foreground shrink-0">{label}</span>
      <span className={cn("text-right break-all", mono && "font-mono text-[10px]")}>{value}</span>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function KarasliceApp() {
  // Sidebar notification — replaces popup toasts
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [sidebarNotice, setSidebarNotice] = useState<{ message: string; variant?: "default" | "destructive" } | null>(null);
  const notify = useCallback((message: string, variant: "default" | "destructive" = "default") => {
    setSidebarNotice({ message, variant });
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setSidebarNotice(null), variant === "destructive" ? 8000 : 4000);
  }, []);
  const router = useRouter();
  const viewportRef = useRef<ViewportHandle>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingUploadFile = useRef<File | null>(null);
  /** Persistent copy of the loaded file — survives upload clearing. Used by Cloud Repair. */
  const loadedFileRef = useRef<File | null>(null);
  const currentJobId = useRef<string>("");

  // ── Core state ──────────────────────────────────────────────────────────────
  const [meshInfo, setMeshInfo] = useState<MeshInfo | null>(null);
  const [fileLoading, setFileLoading] = useState(false);
  const [tab, setTab] = useState<Tab>("file");

  // ── Analysis ────────────────────────────────────────────────────────────────
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeStep, setAnalyzeStep] = useState("");
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);

  // ── Repair (mesh) ───────────────────────────────────────────────────────────
  const [repairing, setRepairing] = useState(false);
  const [repairMessage, setRepairMessage] = useState("");
  const [repairResult, setRepairResult] = useState<import("./manifold-engine").RepairStats | null>(null);

  // ── Repair (parts) ──────────────────────────────────────────────────────────
  const [repairingParts, setRepairingParts] = useState(false);
  const [repairPartsMessage, setRepairPartsMessage] = useState("");

  // ── Voxel reconstruction (severely corrupted meshes) ────────────────────────
  const [reconstructing, setReconstructing] = useState(false);
  const [reconstructMessage, setReconstructMessage] = useState("");
  const [reconstructResolutionMM, setReconstructResolutionMM] = useState(5);
  const [reconstructResult, setReconstructResult] = useState<import("./voxel-reconstruct").VoxelReconstructResult | null>(null);
  const [retryAttempt, setRetryAttempt] = useState(0);

  // ── Cloud repair ──────────────────────────────────────────────────────────
  const [cloudRepairJob, setCloudRepairJob] = useState<RepairJobStatus | null>(null);
  const [cloudRepairSubmitting, setCloudRepairSubmitting] = useState(false);
  const [cloudRepairPolling, setCloudRepairPolling] = useState(false);
  const cloudRepairPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Post-processing (smoothing + simplification) ────────────────────────────
  const [smoothingIterations, setSmoothingIterations] = useState(3);
  const [simplifyEnabled, setSimplifyEnabled] = useState(true);

  // ── AI mesh analysis ─────────────────────────────────────────────────────────
  const [aiAnalysis, setAiAnalysis] = useState<import("@/app/actions/mesh-analysis-actions").AIMeshAnalysisResult | null>(null);
  const [analyzingAI, setAnalyzingAI] = useState(false);
  const [reconstructMode, setReconstructMode] = useState<"solid_voxel" | "shell_voxel" | "point_cloud">("solid_voxel");

  // ── Prepare ─────────────────────────────────────────────────────────────────
  const [transforms, setTransforms] = useState<TransformState>(DEFAULT_TRANSFORMS);
  const [uniformScale, setUniformScale] = useState(true);

  // ── Units ────────────────────────────────────────────────────────────────────
  const [displayUnit, setDisplayUnit] = useState<DisplayUnit>("mm");

  // ── Pre-split ───────────────────────────────────────────────────────────────
  const [cutPlanes, setCutPlanes] = useState<CutPlane[]>([]);
  const [selectedPrinter, setSelectedPrinter] = useState<PrinterProfile | null>(null);
  const [useCustomPrinter, setUseCustomPrinter] = useState(false);
  const [customPrinterX, setCustomPrinterX] = useState(220);
  const [customPrinterY, setCustomPrinterY] = useState(220);
  const [customPrinterZ, setCustomPrinterZ] = useState(250);
  const [tenonType, setTenonType] = useState<"none" | "cylinder" | "dovetail">("none");
  const [tenonSize, setTenonSize] = useState(5);
  const [tenonHollow, setTenonHollow] = useState(false);

  // ── Split ───────────────────────────────────────────────────────────────────
  const [splitParts, setSplitParts] = useState<SplitPart[]>([]);
  const [splitting, setSplitting] = useState(false);
  const [splitProgress, setSplitProgress] = useState(0);
  const [splitMessage, setSplitMessage] = useState("");
  const [selectedPartIndex, setSelectedPartIndex] = useState<number | undefined>(undefined);

  // ── Export ──────────────────────────────────────────────────────────────────
  const [exportFormat, setExportFormat] = useState<"stl" | "obj">("stl");
  const [materialDensityId, setMaterialDensityId] = useState("pla");

  // ── View state ──────────────────────────────────────────────────────────────
  const [explodeAmount, setExplodeAmount] = useState(0);
  const [showSliceLines, setShowSliceLines] = useState(true);
  const [ghostMode, setGhostMode] = useState(false);
  const [wireframe, setWireframe] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // ── Sections ────────────────────────────────────────────────────────────────
  const [openSections, setOpenSections] = useState({
    fileInfo: true, repair: true, basicRepair: false, analysis: true,
    voxelReconstruct: false, cloudRepair: false,
    scale: true, rotate: true,
    printer: true, cutPlanes: true, tenon: false,
    splitResult: true,
  });
  const toggleSection = (key: keyof typeof openSections) =>
    setOpenSections((s) => ({ ...s, [key]: !s[key] }));

  // ── Keyboard shortcuts ──────────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      switch (e.key) {
        case "e": case "E": setExplodeAmount((v) => v > 0 ? 0 : 0.5); break;
        case "g": case "G": setGhostMode((v) => !v); break;
        case "w": case "W": setWireframe((v) => !v); break;
        case "?": setShowShortcuts((v) => !v); break;
        case "Escape": setShowShortcuts(false); break;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // ── Mesh loaded ─────────────────────────────────────────────────────────────
  const handleMeshLoaded = useCallback((info: MeshInfo) => {
    setFileLoading(false);
    setMeshInfo(info);
    setAnalysisResult(null);
    setSplitParts((prev) => { prev.forEach((p) => p.geometry.dispose()); return []; });
    setSelectedPartIndex(undefined);
    setExplodeAmount(0);
    setTab("file");
    setReconstructResult(null);
    setAiAnalysis(null);
    setReconstructMode("solid_voxel");
    // Seed the resolution slider to a sensible default for this model's bbox
    import("./voxel-reconstruct").then(({ autoVoxelResolution, minSafeResolution }) => {
      const auto = autoVoxelResolution(info.boundingBox);
      const floor = minSafeResolution(info.boundingBox);
      setReconstructResolutionMM(Math.round(Math.max(auto, floor) * 2) / 2);
    });
    // Generate a job ID for this session — groups original + all exports
    const jobTs = new Date().toISOString().replace(/[T:\-]/g, "").slice(0, 14);
    const jobRand = Math.random().toString(36).slice(2, 6);
    currentJobId.current = `${jobTs}_${jobRand}`;

    // Upload original file to Cloud Storage (fire-and-forget)
    const file = pendingUploadFile.current;
    if (file) {
      pendingUploadFile.current = null;
      const fd = new FormData();
      fd.append("file", file);
      fd.append("subfolder", "original");
      fd.append("jobId", currentJobId.current);
      uploadToKaraslice(fd).catch(() => {}); // silent — don't block user
    }
  }, []);

  // ── Analysis ────────────────────────────────────────────────────────────────
  // Combined analyze: runs basic geometry analysis + AI classification in one step
  const handleAnalyze = async () => {
    if (!viewportRef.current || !meshInfo) return;
    setAnalyzing(true);
    setAnalyzingAI(true);
    setAiAnalysis(null);
    setAnalyzeStep("Analyzing geometry…");
    await new Promise((r) => setTimeout(r, 0));
    try {
      const geo = viewportRef.current.getRawGeometry();
      if (!geo) return;

      // Step 1: Basic geometry analysis
      const { analyzeGeometry } = await import("./stl-utils");
      const basicResult = analyzeGeometry(geo);
      setAnalysisResult(basicResult);

      // Step 2: Wall thickness estimate
      setAnalyzeStep("Estimating wall thickness…");
      await new Promise((r) => setTimeout(r, 0));
      const { estimateWallThickness } = await import("./voxel-reconstruct");
      const thickness = await estimateWallThickness(geo, 150);

      // Step 3: AI classification (uses basic analysis data)
      setAnalyzeStep("AI classifying mesh…");
      await new Promise((r) => setTimeout(r, 0));
      const screenshot = viewportRef.current.captureScreenshot() ?? undefined;
      const { analyzeMeshWithAI } = await import("@/app/actions/mesh-analysis-actions");
      const aiResult = await analyzeMeshWithAI({
        triangles: meshInfo.triangleCount,
        vertices: basicResult.vertexCount,
        openEdges: basicResult.openEdgeCount,
        nonManifoldEdges: basicResult.nonManifoldEdgeCount,
        boundingBox: meshInfo.boundingBox,
        surfaceAreaMM2: basicResult.surfaceAreaMM2,
        volumeMM3: basicResult.volumeMM3,
        avgWallThicknessMM: thickness.avgMM > 0 ? thickness.avgMM : null,
        fileName: meshInfo.fileName,
        screenshotBase64: screenshot,
        geometryDiagnostics: basicResult.diagnostics,
      });

      setAiAnalysis(aiResult);

      // Auto-select mode, open the relevant repair section, and apply repair plan params.
      // Smart routing: override AI recommendation for near-perfect meshes so users
      // see basic repair first instead of always defaulting to complex reconstruction.
      const hasDefects = basicResult.openEdgeCount > 0 || basicResult.nonManifoldEdgeCount > 0;
      const approxTotalEdges = basicResult.triangleCount * 1.5; // ~3 edges per tri, each shared by 2
      const openEdgePct = approxTotalEdges > 0 ? (basicResult.openEdgeCount / approxTotalEdges) * 100 : 0;
      const isNearPerfect = openEdgePct < 1 && basicResult.nonManifoldEdgeCount < 5;

      if (!hasDefects) {
        // Mesh is clean — no repair section opened
        notify("Mesh is clean — no defects detected, ready for slicing.");
      } else if (isNearPerfect || aiResult.repairStrategy === "topology_repair") {
        // Minor defects — route to basic topology repair
        setOpenSections((s) => ({ ...s, repair: true }));
      } else {
        // Significant defects — route to cloud repair (not client-side reconstruction)
        setOpenSections((s) => ({ ...s, cloudRepair: true }));
        notify("Heavy repair needed — use Cloud Repair for best results.");
      }

      if (aiResult.repairPlan?.params.pointCloud) {
        const pc = aiResult.repairPlan.params.pointCloud;
        setReconstructResolutionMM(pc.resolution);
        setSmoothingIterations(pc.smoothingIterations);
        setSimplifyEnabled(pc.simplifyTarget > 0);
      } else if (aiResult.repairPlan?.params.voxel) {
        const vp = aiResult.repairPlan.params.voxel;
        const bb = meshInfo.boundingBox;
        const maxD = Math.max(bb.x, bb.y, bb.z);
        const floor = Math.ceil(Math.max(maxD / 1000, Math.cbrt(bb.x * bb.y * bb.z / 200_000_000), 0.5) * 2) / 2;
        setReconstructResolutionMM(Math.max(vp.resolution, floor));
        setSmoothingIterations(vp.smoothingIterations);
        setSimplifyEnabled(vp.simplifyTarget > 0);
      }

      notify(`${aiResult.meshType.replace("_", " ")} — ${aiResult.repairStrategy.replace(/_/g, " ")}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      notify(`Analysis failed: ${msg}`, "destructive");
    } finally {
      setAnalyzing(false);
      setAnalyzingAI(false);
      setAnalyzeStep("");
    }
  };

  // ── Repair ────────────────────────────────────────────────────────────────────
  const handleRepair = async () => {
    if (!viewportRef.current || !meshInfo) return;
    setRepairing(true);
    setRepairResult(null);
    setRepairMessage("Starting repair…");
    try {
      const geo = viewportRef.current.getRawGeometry();
      if (!geo) return;
      const { repairMesh } = await import("./manifold-engine");
      const { geometry, stats } = await repairMesh(geo, (step, total, msg) => {
        void step; void total;
        setRepairMessage(msg);
      });
      setRepairResult(stats);
      viewportRef.current.loadRepairedGeometry(geometry, meshInfo.fileName);
      setAnalysisResult(null); // invalidate stale analysis
      notify(stats.isWatertight ? "Repair complete — mesh is watertight. Ready to split." : "Repair complete — some issues may remain.");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      notify(`Repair failed: ${msg}`, "destructive");
    } finally {
      setRepairing(false);
      setRepairMessage("");
    }
  };

  // ── Repair Parts ─────────────────────────────────────────────────────────────
  const handleRepairParts = async () => {
    if (splitParts.length === 0) return;
    setRepairingParts(true);
    try {
      const { repairSplitPart, computeGeometryVolume } = await import("./manifold-engine");
      const THREE = await import("three");
      const repairedParts: SplitPart[] = [];
      for (let i = 0; i < splitParts.length; i++) {
        setRepairPartsMessage(`Repairing part ${i + 1} of ${splitParts.length}…`);
        const { geometry } = await repairSplitPart(splitParts[i].geometry, () => {});
        geometry.computeBoundingBox();
        const size = new THREE.Vector3();
        geometry.boundingBox!.getSize(size);
        repairedParts.push({
          ...splitParts[i],
          geometry,
          triangleCount: geometry.index
            ? geometry.index.count / 3
            : (geometry.attributes.position?.count ?? 0) / 3,
          volumeMM3: parseFloat(computeGeometryVolume(geometry).toFixed(2)),
          bbox: {
            x: parseFloat(size.x.toFixed(1)),
            y: parseFloat(size.y.toFixed(1)),
            z: parseFloat(size.z.toFixed(1)),
          },
        });
      }
      splitParts.forEach((p) => p.geometry.dispose());
      setSplitParts(repairedParts);
      notify(`${repairedParts.length} part${repairedParts.length !== 1 ? "s" : ""} repaired.`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      notify(`Repair failed: ${msg}`, "destructive");
    } finally {
      setRepairingParts(false);
      setRepairPartsMessage("");
    }
  };

  // ── Voxel Reconstruction (with auto-retry) ───────────────────────────────────

  const MAX_RECONSTRUCT_RETRIES = 3;

  /** Run a single reconstruction attempt and return result. */
  const runSingleReconstruction = async (
    geo: import("three").BufferGeometry,
    currentMode: "solid_voxel" | "shell_voxel" | "point_cloud",
    params: {
      voxel?: import("@/app/actions/mesh-analysis-actions").VoxelRepairParams | null;
      pointCloud?: import("@/app/actions/mesh-analysis-actions").PointCloudRepairParams | null;
      postProcess?: import("@/app/actions/mesh-analysis-actions").PostProcessParams | null;
    },
    inputTriCount: number,
  ): Promise<import("./voxel-reconstruct").VoxelReconstructResult> => {
    let result: import("./voxel-reconstruct").VoxelReconstructResult;

    // Pre-reconstruction sanitation: remove duplicate faces, debris, non-manifold edges
    setReconstructMessage("Sanitizing mesh…");
    const { sanitizeMesh } = await import("./mesh-sanitize");
    const sanitized = sanitizeMesh(geo, {
      onProgress: (msg) => setReconstructMessage(msg),
    });
    const cleanGeo = sanitized.geometry;
    const s = sanitized.stats;
    if (s.duplicateFacesRemoved + s.debrisTrianglesRemoved + s.nonManifoldEdgesResolved > 0) {
      notify(
        `Sanitized: ${s.duplicateFacesRemoved} duplicate faces, ${s.debrisComponentsRemoved} debris components (${s.debrisTrianglesRemoved} tri), ${s.nonManifoldEdgesResolved} non-manifold fixes`,
      );
    }

    if (currentMode === "point_cloud") {
      const pc = params.pointCloud;
      const pp = params.postProcess;
      const useResolution = pc?.resolution ?? reconstructResolutionMM;
      const useSmoothing = pp?.smoothingIterations ?? pc?.smoothingIterations ?? smoothingIterations;
      const useSimplifyTarget = simplifyEnabled
        ? (pp?.simplifyTarget ?? pc?.simplifyTarget ?? Math.round(inputTriCount * 0.8))
        : 0;
      const useLambda = pp?.smoothingLambda ?? pc?.smoothingLambda ?? 0.5;
      const useBoundaryPenalty = pp?.boundaryPenalty ?? pc?.boundaryPenalty ?? 1.0;
      const useMu = pp?.taubinMu ?? pc?.taubinMu ?? -0.53;

      const { pointCloudReconstruct } = await import("./poisson-reconstruct");
      result = await pointCloudReconstruct(cleanGeo, (_step, _total, msg) => {
        setReconstructMessage(msg);
      }, {
        resolution: useResolution,
        radiusMultiplier: pc?.radiusMultiplier ?? 2,
        sdfSharpness: pc?.sdfSharpness,
        gapBridgingFactor: pc?.gapBridgingFactor,
        gridPadding: pc?.gridPadding,
        normalSampleDensity: pc?.normalSampleDensity,
        vertexMergePrecision: pc?.vertexMergePrecision,
        outsideBias: pc?.outsideBias,
      });

      if (useSmoothing > 0 || useSimplifyTarget > 0) {
        const { postProcessVoxelOutput } = await import("./voxel-reconstruct");
        setReconstructMessage("Post-processing…");
        const processed = await postProcessVoxelOutput(
          result.geometry,
          { smoothingIterations: useSmoothing, simplifyTarget: useSimplifyTarget, smoothingLambda: useLambda, boundaryPenalty: useBoundaryPenalty, taubinMu: useMu },
          (_step, _total, msg) => setReconstructMessage(msg),
        );
        const finalTris = processed.index
          ? Math.floor(processed.index.count / 3)
          : Math.floor((processed.attributes.position.array as Float32Array).length / 9);
        result.geometry = processed;
        result.outputTriangles = finalTris;
      }
    } else {
      const vp = params.voxel;
      const pp = params.postProcess;
      const useResolution = Math.max(vp?.resolution ?? reconstructResolutionMM, minSafeRes);
      const useDilation = vp?.dilationVoxels;
      const useSmoothing = pp?.smoothingIterations ?? vp?.smoothingIterations ?? smoothingIterations;
      const useSimplifyTarget = simplifyEnabled
        ? (pp?.simplifyTarget ?? vp?.simplifyTarget ?? Math.round(inputTriCount * 0.8))
        : 0;
      const useLambda = pp?.smoothingLambda ?? vp?.smoothingLambda ?? 0.5;
      const useBoundaryPenalty = pp?.boundaryPenalty ?? vp?.boundaryPenalty ?? 1.0;
      const useMu = pp?.taubinMu ?? vp?.taubinMu ?? -0.53;

      const { voxelReconstruct, shellVoxelReconstruct, postProcessVoxelOutput } = await import("./voxel-reconstruct");
      const fn = currentMode === "shell_voxel" ? shellVoxelReconstruct : voxelReconstruct;
      result = await fn(cleanGeo, (_step, _total, msg) => {
        setReconstructMessage(msg);
      }, useResolution, ...(currentMode === "shell_voxel" && useDilation !== undefined ? [useDilation] : []), {
        gridPadding: vp?.gridPadding,
        degenerateThreshold: vp?.degenerateThreshold,
      });

      if (useSmoothing > 0 || useSimplifyTarget > 0) {
        setReconstructMessage("Post-processing…");
        const processed = await postProcessVoxelOutput(
          result.geometry,
          { smoothingIterations: useSmoothing, simplifyTarget: useSimplifyTarget, smoothingLambda: useLambda, boundaryPenalty: useBoundaryPenalty, taubinMu: useMu },
          (_step, _total, msg) => setReconstructMessage(msg),
        );
        const finalTris = processed.index
          ? Math.floor(processed.index.count / 3)
          : Math.floor((processed.attributes.position.array as Float32Array).length / 9);
        result.geometry = processed;
        result.outputTriangles = finalTris;
      }
    }

    return result;
  };

  const handleVoxelReconstruct = async () => {
    if (!viewportRef.current || !meshInfo) return;
    setReconstructing(true);
    setReconstructResult(null);
    setRetryAttempt(0);
    setReconstructMessage("Starting reconstruction…");
    try {
      const geo = viewportRef.current.getRawGeometry();
      if (!geo) return;

      const plan = aiAnalysis?.repairPlan;
      let currentMode: "solid_voxel" | "shell_voxel" | "point_cloud" =
        plan?.pipeline === "shell_voxel" || plan?.pipeline === "solid_voxel" || plan?.pipeline === "point_cloud"
          ? plan.pipeline : reconstructMode;

      const inputTriCount = meshInfo.triangleCount;

      // Build initial params from AI plan + UI controls
      let currentParams: {
        voxel?: import("@/app/actions/mesh-analysis-actions").VoxelRepairParams | null;
        pointCloud?: import("@/app/actions/mesh-analysis-actions").PointCloudRepairParams | null;
        postProcess?: import("@/app/actions/mesh-analysis-actions").PostProcessParams | null;
      } = {
        voxel: plan?.params.voxel ?? null,
        pointCloud: plan?.params.pointCloud ?? null,
        postProcess: plan?.params.postProcess ?? null,
      };

      let result: import("./voxel-reconstruct").VoxelReconstructResult | null = null;
      let lastValidation: import("./validate-reconstruction").ValidationResult | null = null;

      for (let attempt = 1; attempt <= MAX_RECONSTRUCT_RETRIES + 1; attempt++) {
        if (attempt > 1) {
          setRetryAttempt(attempt - 1);
          setReconstructMessage(`Retry ${attempt - 1}/${MAX_RECONSTRUCT_RETRIES}: running with adjusted parameters…`);
        }

        // Run reconstruction + post-processing
        result = await runSingleReconstruction(geo, currentMode, currentParams, inputTriCount);

        // Validate output
        setReconstructMessage("Validating reconstruction output…");
        const { validateReconstructionOutput } = await import("./validate-reconstruction");
        lastValidation = validateReconstructionOutput(result.geometry);

        if (lastValidation.passed) break; // Success!

        if (attempt > MAX_RECONSTRUCT_RETRIES) {
          // Accept with warnings — show what failed
          const warnings = lastValidation.failures.map((f) => f.detail).join("; ");
          notify(`Reconstruction completed with warnings: ${warnings}`, "destructive");
          break;
        }

        // Diagnose failure and get adjusted params from AI
        setReconstructMessage(`Attempt ${attempt} had issues — consulting AI for adjustments…`);
        const { diagnoseReconstructionFailure } = await import("@/app/actions/mesh-analysis-actions");
        const recommendation = await diagnoseReconstructionFailure({
          pipeline: currentMode,
          attempt,
          maxAttempts: MAX_RECONSTRUCT_RETRIES + 1,
          validationFailures: lastValidation.failures,
          currentParams,
          inputStats: {
            triangles: meshInfo.triangleCount,
            vertices: meshInfo.triangleCount * 3,
            boundingBox: meshInfo.boundingBox,
          },
          outputStats: {
            triangles: lastValidation.metrics.triangleCount,
            vertices: lastValidation.metrics.vertexCount,
            nanVertices: lastValidation.metrics.nanVertices,
            degenerateTriangles: lastValidation.metrics.degenerateTriangles,
            nonManifoldEdges: lastValidation.metrics.nonManifoldEdges,
            boundaryEdges: lastValidation.metrics.boundaryEdges,
          },
        });

        // Apply adjusted params for next attempt
        currentParams = recommendation.adjustedParams;
        if (recommendation.switchPipeline) {
          currentMode = recommendation.switchPipeline;
        }

        // Free memory from failed attempt
        result.geometry.dispose();
        result = null;
      }

      if (!result) return;

      const modeLabel = currentMode === "point_cloud" ? "Point cloud" : currentMode === "shell_voxel" ? "Shell" : "Solid";
      setReconstructResult(result);
      viewportRef.current.loadRepairedGeometry(result.geometry, meshInfo.fileName);
      setAnalysisResult(null);
      setAiAnalysis(null);

      if (lastValidation?.passed) {
        notify(`${modeLabel} reconstruction complete — ${result.outputTriangles.toLocaleString()} triangles · ${result.resolution} mm`);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      notify(`Reconstruction failed: ${msg}`, "destructive");
    } finally {
      setReconstructing(false);
      setReconstructMessage("");
      setRetryAttempt(0);
    }
  };

  // ── Cloud Repair ──────────────────────────────────────────────────────────

  const stopCloudPolling = useCallback(() => {
    if (cloudRepairPollRef.current) {
      clearInterval(cloudRepairPollRef.current);
      cloudRepairPollRef.current = null;
    }
    setCloudRepairPolling(false);
  }, []);

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (cloudRepairPollRef.current) clearInterval(cloudRepairPollRef.current);
    };
  }, []);

  const handleCloudRepair = async () => {
    if (!meshInfo) return;

    const uploadFile = loadedFileRef.current;
    if (!uploadFile) {
      notify("No file available for cloud upload. Please re-load the file.", "destructive");
      return;
    }

    setCloudRepairSubmitting(true);
    setCloudRepairJob(null);
    stopCloudPolling();

    try {
      const fd = new FormData();
      fd.append("file", uploadFile);
      fd.append("repairMode", "auto");

      // Include AI-prescribed params if available
      if (aiAnalysis?.repairPlan) {
        fd.append("params", JSON.stringify(aiAnalysis.repairPlan.params));
      }

      const result = await submitCloudRepairJob(fd);

      setCloudRepairJob({
        jobId: result.jobId,
        status: "queued",
        stepMessage: "Job submitted — waiting for worker…",
      });

      // Start polling
      setCloudRepairPolling(true);
      cloudRepairPollRef.current = setInterval(async () => {
        try {
          const status = await getRepairJobStatus(result.jobId);
          if (!status) return;
          setCloudRepairJob(status);

          if (status.status === "finished" || status.status === "failed") {
            stopCloudPolling();

            if (status.status === "finished") {
              // Auto-load repaired mesh into viewport
              try {
                const url = await getRepairResultUrl(result.jobId, "repaired.stl");
                const dlRes = await fetch(url);
                const arrayBuffer = await dlRes.arrayBuffer();
                const { STLLoader } = await import("three/examples/jsm/loaders/STLLoader.js");
                const loader = new STLLoader();
                const geometry = loader.parse(arrayBuffer);
                viewportRef.current?.loadRepairedGeometry(geometry, "cloud_repaired.stl");
                notify("Cloud repair complete — repaired mesh loaded.");
              } catch {
                notify("Cloud repair complete — auto-load failed. Use download buttons.", "destructive");
              }
            } else {
              notify(`Cloud repair failed: ${status.error ?? "Unknown error"}`, "destructive");
            }
          }
        } catch {
          // Polling error — keep trying
        }
      }, 3000);

    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      notify(`Cloud repair submission failed: ${msg}`, "destructive");
    } finally {
      setCloudRepairSubmitting(false);
    }
  };

  const handleDownloadRepairResult = async (fileName: string) => {
    if (!cloudRepairJob?.jobId) return;
    try {
      const url = await getRepairResultUrl(cloudRepairJob.jobId, fileName);
      window.open(url, "_blank");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      notify(`Download failed: ${msg}`, "destructive");
    }
  };

  // handleAIAnalysis removed — merged into handleAnalyze above

  // ── Scale ────────────────────────────────────────────────────────────────────
  const handleScaleChange = (axis: "X" | "Y" | "Z", value: number) => {
    if (uniformScale) {
      setTransforms((prev) => ({ ...prev, scaleX: value, scaleY: value, scaleZ: value }));
    } else {
      setTransforms((prev) => ({ ...prev, [`scale${axis}`]: value }));
    }
  };

  // ── Cut planes ───────────────────────────────────────────────────────────────
  const addCutPlane = (axis: "x" | "y" | "z") =>
    setCutPlanes((prev) => [...prev, { axis, position: 0.5, enabled: true }]);

  const removeCutPlane = (i: number) =>
    setCutPlanes((prev) => prev.filter((_, idx) => idx !== i));

  const updatePlane = (i: number, patch: Partial<CutPlane>) =>
    setCutPlanes((prev) => prev.map((p, idx) => idx === i ? { ...p, ...patch } : p));

  const autoSlice = () => {
    if (!meshInfo || !effectivePrinter) return;
    const planes: CutPlane[] = [];
    const axes: ("x" | "y" | "z")[] = ["x", "y", "z"];
    const meshDims = [meshInfo.boundingBox.x, meshInfo.boundingBox.y, meshInfo.boundingBox.z];
    const pDims = [effectivePrinter.x, effectivePrinter.y, effectivePrinter.z];

    axes.forEach((axis, i) => {
      const count = Math.ceil(meshDims[i] / pDims[i]) - 1;
      for (let n = 1; n <= count; n++) {
        planes.push({ axis, position: n / (count + 1), enabled: true });
      }
    });

    if (planes.length === 0) {
      notify("Model fits your printer — no cuts needed.");
    } else {
      setCutPlanes(planes);
      notify(`${planes.length} cut plane${planes.length > 1 ? "s" : ""} added.`);
    }
  };

  // ── Split ─────────────────────────────────────────────────────────────────────
  const handleRunSplit = async () => {
    if (!meshInfo || !viewportRef.current) return;
    setSplitting(true);
    setSplitProgress(0);
    setSplitMessage("Initializing…");
    splitParts.forEach((p) => p.geometry.dispose());
    setSplitParts([]);

    try {
      const baked = viewportRef.current.getBakedGeometry();
      if (!baked) throw new Error("No geometry loaded");

      const { viewportPlaneToEngine, splitMesh } = await import("./manifold-engine");

      let geo = baked.geo;
      if (!geo.index) {
        const { mergeVertices } = await import("three/examples/jsm/utils/BufferGeometryUtils.js");
        geo = mergeVertices(geo);
      }

      const enginePlanes = cutPlanes
        .filter((p) => p.enabled)
        .map((p) => viewportPlaneToEngine(p.axis, p.position, baked.bbox));

      const parts = await splitMesh(geo, enginePlanes, (step, total, msg) => {
        setSplitProgress(total > 0 ? Math.round((step / total) * 100) : 0);
        setSplitMessage(msg);
      });

      setSplitParts(parts);
      setSplitProgress(100);
      setSplitMessage(`${parts.length} parts ready`);
      setSelectedPartIndex(undefined);
      setExplodeAmount(0);
      setTab("export");
      notify(`Split complete — ${parts.length} part${parts.length !== 1 ? "s" : ""} ready for export.`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      notify(`Split failed: ${msg}`, "destructive");
      setSplitMessage("Error: " + msg);
    } finally {
      setSplitting(false);
    }
  };

  // ── Export ────────────────────────────────────────────────────────────────────
  const getBase = () => meshInfo?.fileName.replace(/\.(stl|obj|3mf)$/i, "") ?? "model";

  /** Build a descriptive filename for a part: base_part03_120x80x45mm_12450tri.stl */
  const partFileName = (base: string, i: number, ext: string) => {
    const part = splitParts[i];
    const padded = String(i + 1).padStart(String(splitParts.length).length, "0");
    const dims = `${Math.round(part.bbox.x)}x${Math.round(part.bbox.y)}x${Math.round(part.bbox.z)}mm`;
    const tris = `${Math.round(part.triangleCount)}tri`;
    return `${base}_part${padded}_${dims}_${tris}.${ext}`;
  };

  const handleDownloadPart = async (i: number) => {
    const base = getBase();
    const name = partFileName(base, i, exportFormat);
    if (exportFormat === "obj") {
      const { geometryToOBJString, downloadText } = await import("./stl-utils");
      const objStr = geometryToOBJString(splitParts[i].geometry, `${base}_part${i + 1}`);
      downloadText(objStr, name, "model/obj");
    } else {
      const { geometryToSTLBuffer, downloadBlob } = await import("./stl-utils");
      const buf = geometryToSTLBuffer(splitParts[i].geometry);
      downloadBlob(buf, name);
    }
    // Single-part upload (fire-and-forget)
    const fd = new FormData();
    const part = splitParts[i];
    if (exportFormat === "obj") {
      const { geometryToOBJString } = await import("./stl-utils");
      const objStr = geometryToOBJString(part.geometry, `${base}_part${i + 1}`);
      fd.append("file", new File([objStr], name, { type: "model/obj" }));
    } else {
      const { geometryToSTLBuffer } = await import("./stl-utils");
      const buf = geometryToSTLBuffer(part.geometry);
      fd.append("file", new File([buf], name, { type: "model/stl" }));
    }
    fd.append("subfolder", "parts");
    fd.append("jobId", currentJobId.current);
    uploadToKaraslice(fd).catch(() => {});
  };

  const handleDownloadZip = async () => {
    const { geometryToSTLBuffer, geometryToOBJString } = await import("./stl-utils");
    const JSZip = (await import("jszip")).default;
    const zip   = new JSZip();
    const base  = getBase();
    const mime  = exportFormat === "obj" ? "model/obj" : "model/stl";

    // Build ZIP + batch upload entries simultaneously
    const batchEntries: BatchUploadEntry[] = [];
    for (let i = 0; i < splitParts.length; i++) {
      const name = partFileName(base, i, exportFormat);
      const part = splitParts[i];
      let bytes: Uint8Array;
      if (exportFormat === "obj") {
        const objStr = geometryToOBJString(part.geometry, `${base}_part${i + 1}`);
        zip.file(name, objStr);
        bytes = new TextEncoder().encode(objStr);
      } else {
        const buf = geometryToSTLBuffer(part.geometry);
        zip.file(name, buf);
        bytes = new Uint8Array(buf);
      }
      // Convert to base64 for batch upload
      let binary = "";
      for (let b = 0; b < bytes.length; b++) binary += String.fromCharCode(bytes[b]);
      batchEntries.push({
        fileName: name,
        base64: btoa(binary),
        mimeType: mime,
        partMeta: {
          partIndex: i,
          label: part.label,
          triangleCount: part.triangleCount,
          volumeMM3: part.volumeMM3,
          bboxX: part.bbox.x,
          bboxY: part.bbox.y,
          bboxZ: part.bbox.z,
        },
      });
    }

    // Download ZIP
    const blob = await zip.generateAsync({ type: "blob" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href = url; a.download = `${base}_karaslice.zip`; a.click();
    URL.revokeObjectURL(url);
    notify(`ZIP downloaded — ${splitParts.length} ${exportFormat.toUpperCase()} files.`);

    // Batch upload all parts to storage (fire-and-forget, throttled server-side)
    batchUploadJob(null, batchEntries, currentJobId.current).then((result) => {
      if (result.failed > 0) {
        console.warn(`Storage: ${result.uploaded}/${result.uploaded + result.failed} parts uploaded`, result.errors);
      }
    }).catch(() => {});
  };

  const handleSendToQuote = async () => {
    const { geometryToSTLBuffer } = await import("./stl-utils");
    const { karasliceTransfer } = await import("@/lib/karaslice-transfer");
    const base = getBase();
    karasliceTransfer.set(splitParts.map((part, i) => {
      const buf  = geometryToSTLBuffer(part.geometry);
      const name = partFileName(base, i, "stl");
      const file = new File([buf], name, { type: "model/stl" });
      return { name: file.name, file, bbox: part.bbox, volumeMM3: part.volumeMM3, triangleCount: part.triangleCount };
    }));
    // router.push keeps the JS context alive so the module-level store persists
    router.push("/quote?from=karaslice");
  };

  // ── Derived ───────────────────────────────────────────────────────────────────
  const isSevere = analysisResult
    ? analysisResult.triangleCount > 0 &&
      (analysisResult.openEdgeCount / (analysisResult.triangleCount * 1.5) > 0.01 ||
       analysisResult.nonManifoldEdgeCount / (analysisResult.triangleCount * 1.5) > 0.005)
    : false;

  // Minimum resolution that fits within grid limits (1000/axis, 200M total)
  const minSafeRes = meshInfo
    ? (() => {
        const bb = meshInfo.boundingBox;
        const maxDim = Math.max(bb.x, bb.y, bb.z);
        const fromAxis = maxDim / 1000;
        const fromTotal = Math.cbrt(bb.x * bb.y * bb.z / 200_000_000);
        const raw = Math.max(fromAxis, fromTotal, 0.5);
        return Math.ceil(raw * 2) / 2; // round up to 0.5 step
      })()
    : 1;

  const estimatedReconstructTris = (() => {
    if (!meshInfo) return 0;
    const gx = Math.ceil(meshInfo.boundingBox.x / reconstructResolutionMM) + 2;
    const gy = Math.ceil(meshInfo.boundingBox.y / reconstructResolutionMM) + 2;
    const gz = Math.ceil(meshInfo.boundingBox.z / reconstructResolutionMM) + 2;
    const raw = 4 * (gx * gy + gy * gz + gz * gx);
    // When simplification is enabled, use the repair plan target (voxel or point cloud) or 80% of input
    const target = simplifyEnabled
      ? (aiAnalysis?.repairPlan?.params.voxel?.simplifyTarget
        ?? aiAnalysis?.repairPlan?.params.pointCloud?.simplifyTarget
        ?? Math.round(meshInfo.triangleCount * 0.8))
      : null;
    return target && target < raw ? target : raw;
  })();

  const brands = Array.from(new Set((printerProfiles as PrinterProfile[]).map((p) => p.brand))).sort();
  const enabledPlaneCount = cutPlanes.filter((p) => p.enabled).length;
  const splitPartsVisual: SplitPartVisual[] = splitParts.map((p) => ({ geometry: p.geometry, label: p.label }));
  const u = displayUnit; // shorthand

  /** Effective printer build volume in mm — either from a preset or custom input. */
  const effectivePrinter: PrinterProfile | null = useCustomPrinter
    ? { id: "custom", name: "Custom", brand: "Custom", x: customPrinterX, y: customPrinterY, z: customPrinterZ }
    : selectedPrinter;

  const tabs: { id: Tab; label: string; icon: React.ElementType }[] = [
    { id: "file",     label: "File",      icon: FileBox },
    { id: "prepare",  label: "Prepare",   icon: Maximize2 },
    { id: "presplit", label: "Pre-Split", icon: Scissors },
    { id: "split",    label: "Split",     icon: Cpu },
    { id: "export",   label: "Export",    icon: Package },
  ];

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background text-foreground">

      {/* Hidden file input — lives at the root (outside any fixed/transformed ancestor)
          so that programmatic .click() works correctly on iOS Safari */}
      <input
        ref={fileInputRef}
        type="file"
        accept="*/*"
        className="sr-only"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          pendingUploadFile.current = file;
          loadedFileRef.current = file;
          setFileLoading(true);
          window.dispatchEvent(new CustomEvent("karaslice:load-file", { detail: file }));
          e.target.value = "";
        }}
      />

      {/* ── Mobile backdrop ─────────────────────────────────────────────────── */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-20 bg-black/50 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* ── Sidebar ─────────────────────────────────────────────────────────── */}
      <aside className={cn(
        "flex w-72 max-w-[85vw] flex-shrink-0 flex-col border-r border-border bg-card transition-transform duration-200",
        // On desktop: always visible (normal flow)
        // On mobile: fixed overlay, slide in/out
        "md:relative md:translate-x-0 md:z-auto",
        "max-md:fixed max-md:inset-y-0 max-md:left-0 max-md:z-30",
        sidebarOpen ? "max-md:translate-x-0" : "max-md:-translate-x-full",
      )}>

        {/* Header */}
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <Link
            href="/"
            className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md text-muted-foreground hover:text-foreground transition-colors"
            title="Back to Karasawa Labs"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-accent/10 text-accent">
            <Scissors className="h-4 w-4" />
          </div>
          <span className="font-semibold tracking-tight">Karaslice</span>
          <Badge variant="secondary" className="ml-auto text-[10px]">Beta</Badge>
          {/* Close button — mobile only */}
          <button
            className="ml-1 flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:text-foreground transition-colors md:hidden"
            onClick={() => setSidebarOpen(false)}
            aria-label="Close menu"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-border">
          {tabs.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={cn(
                "flex flex-1 flex-col items-center gap-1 py-2 text-[10px] font-medium transition-colors",
                tab === id
                  ? "border-b-2 border-accent text-accent"
                  : "text-muted-foreground hover:text-foreground border-b-2 border-transparent"
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </button>
          ))}
        </div>

        {/* Unit selector */}
        <div className="flex items-center justify-between border-b border-border px-3 py-1.5">
          <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
            <Ruler className="h-3 w-3" /> Units
          </span>
          <div className="flex items-center gap-0.5 rounded-md border border-border p-0.5">
            {(["mm", "cm", "in"] as const).map((unit) => (
              <button
                key={unit}
                onClick={() => setDisplayUnit(unit)}
                className={cn(
                  "rounded px-2 py-0.5 text-[10px] font-semibold transition-colors",
                  displayUnit === unit
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {unit}
              </button>
            ))}
          </div>
        </div>

        {/* Panel content */}
        <div className="flex-1 overflow-y-auto py-1 text-sm">

          {/* ── FILE TAB ──────────────────────────────────────────────────── */}
          {tab === "file" && (
            <>
              <div className="px-3 py-2">
                <Button
                  size="sm"
                  className="w-full gap-2"
                  style={{ backgroundColor: "hsl(var(--accent))", color: "hsl(var(--accent-foreground))" }}
                  disabled={fileLoading}
                  onClick={() => fileInputRef.current?.click()}
                >
                  {fileLoading
                    ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    : <Upload className="h-3.5 w-3.5" />}
                  {fileLoading ? "Processing file…" : meshInfo ? "Load New File" : "Upload STL / OBJ / 3MF"}
                </Button>
              </div>
              <Separator className="my-1" />

              <SectionHeader icon={Info} label="File Info" open={openSections.fileInfo} onToggle={() => toggleSection("fileInfo")} />
              {openSections.fileInfo && (
                <div className="px-3 pb-2 space-y-1.5">
                  {meshInfo ? (
                    <>
                      <Row label="Name"      value={meshInfo.fileName} mono />
                      <Row label="Format"    value={meshInfo.format.toUpperCase()} />
                      <Row label="Size"      value={`${meshInfo.fileSizeMB} MB`} />
                      <Row label="Triangles" value={meshInfo.triangleCount.toLocaleString()} />
                      <Row label="Dim X"     value={`${fmtDim(meshInfo.boundingBox.x, u)} ${UNIT_LABELS[u]}`} />
                      <Row label="Dim Y"     value={`${fmtDim(meshInfo.boundingBox.y, u)} ${UNIT_LABELS[u]}`} />
                      <Row label="Dim Z"     value={`${fmtDim(meshInfo.boundingBox.z, u)} ${UNIT_LABELS[u]}`} />
                    </>
                  ) : (
                    <p className="text-xs text-muted-foreground py-2 text-center">No file loaded</p>
                  )}
                </div>
              )}
              <Separator className="my-1" />

              {/* ── STEP 1: ANALYZE ────────────────────────────────────── */}
              <SectionHeader icon={Sparkles} label="Analyze & Repair" open={openSections.analysis} onToggle={() => toggleSection("analysis")} />
              {openSections.analysis && (
                <div className="px-3 pb-3 space-y-3">
                  {/* Analyze button */}
                  {!aiAnalysis ? (
                    <div className="space-y-2">
                      {!analyzing && (
                        <p className="text-[10px] text-muted-foreground">
                          Analyzes mesh geometry, classifies the type, and recommends the best repair path.
                        </p>
                      )}
                      <Button
                        size="sm" className="w-full gap-2"
                        style={{ backgroundColor: "hsl(var(--accent))", color: "hsl(var(--accent-foreground))" }}
                        disabled={!meshInfo || analyzing}
                        onClick={handleAnalyze}
                      >
                        {analyzing
                          ? <Loader2 className="h-3 w-3 animate-spin" />
                          : <Sparkles className="h-3 w-3" />}
                        {analyzing ? (analyzeStep || "Analyzing…") : "Analyze Mesh"}
                      </Button>
                      {analyzing && (
                        <div className="space-y-1.5">
                          <Progress value={
                            analyzeStep.includes("wall") ? 40
                            : analyzeStep.includes("AI") ? 70
                            : 15
                          } className="h-1" />
                          <p className="text-[10px] text-muted-foreground text-center">{analyzeStep}</p>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {/* Analysis results */}
                      <div className="rounded-md border border-border p-2 space-y-2 text-xs">
                        {/* Health status */}
                        <div className="flex items-center gap-1.5">
                          {analysisResult?.isWatertight
                            ? <CheckCircle2 className="h-3.5 w-3.5 text-green-400" />
                            : <AlertTriangle className="h-3.5 w-3.5 text-yellow-400" />}
                          <span className="font-medium">
                            {analysisResult?.isWatertight ? "Mesh is watertight" : "Issues detected"}
                          </span>
                        </div>

                        {/* Basic stats */}
                        {analysisResult && (
                          <div className="pl-5 space-y-0.5 text-muted-foreground text-[11px]">
                            <p>Vertices: {analysisResult.vertexCount.toLocaleString()}</p>
                            <p>Surface: {u === "in"
                              ? (analysisResult.surfaceAreaMM2 / 645.16).toFixed(2) + " in²"
                              : u === "cm"
                              ? (analysisResult.surfaceAreaMM2 / 100).toFixed(1) + " cm²"
                              : analysisResult.surfaceAreaMM2.toFixed(0) + " mm²"
                            }</p>
                            <p>Volume: {u === "in"
                              ? (analysisResult.volumeMM3 / 16387.064).toFixed(2) + " in³"
                              : u === "cm"
                              ? (analysisResult.volumeMM3 / 1000).toFixed(1) + " cm³"
                              : analysisResult.volumeMM3.toFixed(0) + " mm³"
                            }</p>
                            {analysisResult.openEdgeCount > 0 && (
                              <p className="text-yellow-400">{analysisResult.openEdgeCount.toLocaleString()} open edges</p>
                            )}
                            {analysisResult.nonManifoldEdgeCount > 0 && (
                              <p className="text-red-400">{analysisResult.nonManifoldEdgeCount.toLocaleString()} non-manifold edges</p>
                            )}
                          </div>
                        )}

                        {/* AI classification badges */}
                        <div className="flex flex-wrap gap-1.5 pt-1">
                          <span className={cn(
                            "rounded px-1.5 py-0.5 text-[10px] font-semibold",
                            aiAnalysis.meshType === "thin_shell"    && "bg-accent/20 text-accent",
                            aiAnalysis.meshType === "solid_body"    && "bg-blue-900/40 text-blue-300",
                            aiAnalysis.meshType === "multi_body"    && "bg-purple-900/40 text-purple-300",
                            aiAnalysis.meshType === "surface_patch" && "bg-orange-900/40 text-orange-300",
                          )}>
                            {aiAnalysis.meshType.replace("_", " ")}
                          </span>
                          <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold bg-muted text-muted-foreground">
                            {aiAnalysis.repairStrategy.replace(/_/g, " ")}
                          </span>
                          <span className="rounded px-1.5 py-0.5 text-[10px] text-muted-foreground">
                            {Math.round(aiAnalysis.confidence * 100)}%
                          </span>
                        </div>

                        {/* Compact reasoning + model ID */}
                        {aiAnalysis.modelId && (
                          <p className="text-[10px] text-accent font-medium">
                            {aiAnalysis.modelId.description}
                          </p>
                        )}
                        <p className="text-[10px] text-muted-foreground leading-snug">
                          {aiAnalysis.reasoning}
                        </p>
                        {aiAnalysis.warnings.length > 0 && (
                          <div className="space-y-0.5">
                            {aiAnalysis.warnings.slice(0, 2).map((w, i) => (
                              <p key={i} className="text-[10px] text-yellow-400 flex gap-1">
                                <AlertTriangle className="h-3 w-3 shrink-0 mt-0.5" />{w}
                              </p>
                            ))}
                          </div>
                        )}
                        {aiAnalysis.heuristic && !aiAnalysis.error && (
                          <p className="text-[10px] text-muted-foreground">
                            Heuristic analysis — add ANTHROPIC_API_KEY for AI classification.
                          </p>
                        )}
                        {aiAnalysis.error && (
                          <p className="text-[10px] text-yellow-500">{aiAnalysis.error}</p>
                        )}
                      </div>

                      {/* Re-analyze */}
                      <Button
                        size="sm" variant="ghost" className="w-full gap-2 text-[11px] text-muted-foreground"
                        disabled={analyzing || reconstructing || repairing}
                        onClick={handleAnalyze}
                      >
                        <Sparkles className="h-3 w-3" />
                        Re-analyze
                      </Button>
                    </div>
                  )}
                </div>
              )}

              {/* ── STEP 2: REPAIR (routed by analysis) ───────────────── */}
              {meshInfo && (
                <>
                  <Separator className="my-1" />

                  {/* BASIC MESH REPAIR — always available */}
                  <SectionHeader icon={Wrench} label="Basic Mesh Repair" open={openSections.basicRepair} onToggle={() => toggleSection("basicRepair")} />
                  {openSections.basicRepair && (
                    <div className="px-3 pb-3 space-y-2">
                      <p className="text-[10px] text-muted-foreground">
                        Fix topology issues: degenerate triangles, duplicate faces, inconsistent winding, inverted normals, and small holes.
                      </p>
                      <Button
                        size="sm" className="w-full gap-2"
                        style={{ backgroundColor: "hsl(var(--accent))", color: "hsl(var(--accent-foreground))" }}
                        disabled={repairing || reconstructing}
                        onClick={handleRepair}
                      >
                        {repairing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Wrench className="h-3 w-3" />}
                        {repairing ? repairMessage || "Repairing…" : "Repair Mesh"}
                      </Button>

                      {repairResult && (
                        <div className="rounded-md border border-border p-2 space-y-1.5 text-xs">
                          <div className="flex items-center gap-1.5">
                            {repairResult.isWatertight
                              ? <CheckCircle2 className="h-3.5 w-3.5 text-green-400" />
                              : <AlertTriangle className="h-3.5 w-3.5 text-yellow-400" />}
                            <span className="font-medium">
                              {repairResult.isWatertight ? "Mesh is watertight" : "Partial repair"}
                            </span>
                          </div>
                          <div className="pl-5 space-y-0.5 text-muted-foreground">
                            {repairResult.degeneratesRemoved > 0 && (
                              <p className="text-green-400">Removed {repairResult.degeneratesRemoved} degenerate tri{repairResult.degeneratesRemoved !== 1 ? "s" : ""}</p>
                            )}
                            {repairResult.duplicatesRemoved > 0 && (
                              <p className="text-green-400">Removed {repairResult.duplicatesRemoved} duplicate tri{repairResult.duplicatesRemoved !== 1 ? "s" : ""}</p>
                            )}
                            {repairResult.windingFixed > 0 && (
                              <p className="text-green-400">Fixed winding on {repairResult.windingFixed} tri{repairResult.windingFixed !== 1 ? "s" : ""}</p>
                            )}
                            {repairResult.invertedNormalsFixed && (
                              <p className="text-green-400">Corrected inverted normals</p>
                            )}
                            {repairResult.holesFilled > 0 && (
                              <p className="text-green-400">Filled {repairResult.holesFilled} hole{repairResult.holesFilled !== 1 ? "s" : ""}</p>
                            )}
                            {repairResult.weldToleranceMM > 1e-3 && (
                              <p className="text-muted-foreground">Welded vertices ±{repairResult.weldToleranceMM.toFixed(repairResult.weldToleranceMM < 0.01 ? 4 : 2)} mm</p>
                            )}
                            {!repairResult.isWatertight && (
                              <p className="text-yellow-400">Some issues remain — try reconstruction below</p>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* TOPOLOGY REPAIR — shown when AI recommends topology_repair AND mesh has defects */}
                  {aiAnalysis?.repairStrategy === "topology_repair" && analysisResult &&
                   (analysisResult.openEdgeCount > 0 || analysisResult.nonManifoldEdgeCount > 0) && (
                    <>
                      <SectionHeader icon={Wrench} label="Topology Repair" open={openSections.repair} onToggle={() => toggleSection("repair")} />
                      {openSections.repair && (
                        <div className="px-3 pb-3 space-y-2">
                          <p className="text-[10px] text-muted-foreground">
                            Minor defects detected. Fast topology repair should fix this without geometry loss.
                          </p>
                          <Button
                            size="sm" className="w-full gap-2"
                            style={{ backgroundColor: "hsl(var(--accent))", color: "hsl(var(--accent-foreground))" }}
                            disabled={repairing}
                            onClick={handleRepair}
                          >
                            {repairing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Wrench className="h-3 w-3" />}
                            {repairing ? repairMessage || "Repairing…" : "Auto-Repair"}
                          </Button>

                          {repairResult && (
                            <div className="rounded-md border border-border p-2 space-y-1.5 text-xs">
                              <div className="flex items-center gap-1.5">
                                {repairResult.isWatertight
                                  ? <CheckCircle2 className="h-3.5 w-3.5 text-green-400" />
                                  : <AlertTriangle className="h-3.5 w-3.5 text-yellow-400" />}
                                <span className="font-medium">
                                  {repairResult.isWatertight ? "Mesh is watertight" : "Partial repair"}
                                </span>
                              </div>
                              <div className="pl-5 space-y-0.5 text-muted-foreground">
                                {repairResult.degeneratesRemoved > 0 && (
                                  <p className="text-green-400">Removed {repairResult.degeneratesRemoved} degenerate tri{repairResult.degeneratesRemoved !== 1 ? "s" : ""}</p>
                                )}
                                {repairResult.duplicatesRemoved > 0 && (
                                  <p className="text-green-400">Removed {repairResult.duplicatesRemoved} duplicate tri{repairResult.duplicatesRemoved !== 1 ? "s" : ""}</p>
                                )}
                                {repairResult.windingFixed > 0 && (
                                  <p className="text-green-400">Fixed winding on {repairResult.windingFixed} tri{repairResult.windingFixed !== 1 ? "s" : ""}</p>
                                )}
                                {repairResult.invertedNormalsFixed && (
                                  <p className="text-green-400">Corrected inverted normals</p>
                                )}
                                {repairResult.holesFilled > 0 && (
                                  <p className="text-green-400">Filled {repairResult.holesFilled} hole{repairResult.holesFilled !== 1 ? "s" : ""}</p>
                                )}
                                {repairResult.weldToleranceMM > 1e-3 && (
                                  <p className="text-muted-foreground">Welded vertices ±{repairResult.weldToleranceMM.toFixed(repairResult.weldToleranceMM < 0.01 ? 4 : 2)} mm</p>
                                )}
                                {!repairResult.isWatertight && (
                                  <p className="text-yellow-400">Some issues remain — try voxel reconstruction</p>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </>
                  )}

                  {/* RECONSTRUCTION — shown when AI recommends solid_voxel, shell_voxel, or point_cloud */}
                  {(aiAnalysis?.repairStrategy === "solid_voxel" || aiAnalysis?.repairStrategy === "shell_voxel" || aiAnalysis?.repairStrategy === "point_cloud") && (
                    <>
                      <SectionHeader icon={Boxes} label="Mesh Reconstruction" open={openSections.voxelReconstruct} onToggle={() => toggleSection("voxelReconstruct")} />
                      {openSections.voxelReconstruct && (
                        <div className="px-3 pb-3 space-y-3">

                          {/* AI plan summary */}
                          {aiAnalysis?.repairPlan && (
                            <div className="rounded-md border border-accent/30 bg-accent/5 p-2 space-y-1 text-[11px]">
                              <p className="font-medium text-accent flex items-center gap-1.5">
                                <Sparkles className="h-3 w-3" />
                                AI Repair Plan
                              </p>
                              <p className="text-muted-foreground">{aiAnalysis.repairPlan.userMessage}</p>
                            </div>
                          )}

                          {/* Mode toggle */}
                          <div className="space-y-1">
                            <Label className="text-[11px]">Reconstruction mode</Label>
                            <div className="flex rounded-md border border-border overflow-hidden text-[11px] font-semibold">
                              {(["solid_voxel", "shell_voxel", "point_cloud"] as const).map((mode) => (
                                <button
                                  key={mode}
                                  onClick={() => setReconstructMode(mode)}
                                  disabled={reconstructing}
                                  className={cn(
                                    "flex-1 py-1.5 transition-colors",
                                    reconstructMode === mode
                                      ? "bg-accent text-accent-foreground"
                                      : "text-muted-foreground hover:text-foreground",
                                  )}
                                >
                                  {mode === "solid_voxel" ? "Solid" : mode === "shell_voxel" ? "Shell" : "Point Cloud"}
                                </button>
                              ))}
                            </div>
                            <p className="text-[10px] text-muted-foreground">
                              {reconstructMode === "point_cloud"
                                ? "MLS/SDF reconstruction from point cloud. Best for thin shells and car bodies."
                                : reconstructMode === "shell_voxel"
                                ? "Surface rasterization + dilation. Preserves openings."
                                : "Parity fill + flood fill. Best for enclosed solid parts."}
                            </p>
                          </div>

                          {/* Resolution slider */}
                          <div className="space-y-1.5">
                            <div className="flex items-center justify-between text-[11px]">
                              <Label className="text-[11px]">{reconstructMode === "point_cloud" ? "Grid resolution" : "Voxel resolution"}</Label>
                              <span className="font-mono text-accent">{reconstructResolutionMM} mm</span>
                            </div>
                            <Slider
                              min={minSafeRes} max={20} step={0.5}
                              value={[Math.max(reconstructResolutionMM, minSafeRes)]}
                              onValueChange={([v]) => setReconstructResolutionMM(v)}
                              disabled={reconstructing}
                            />
                            <div className="flex justify-between text-[10px] text-muted-foreground">
                              <span>{minSafeRes} mm — finest</span>
                              <span>20 mm — fast</span>
                            </div>
                            {minSafeRes > 1 && (
                              <p className="text-[10px] text-yellow-400">
                                Min {minSafeRes} mm for this mesh size (grid limit).
                              </p>
                            )}
                          </div>

                          {/* Post-processing */}
                          <Separator className="my-0.5" />
                          <p className="text-[11px] font-medium text-muted-foreground">Post-processing</p>

                          <div className="space-y-1.5">
                            <div className="flex items-center justify-between text-[11px]">
                              <Label className="text-[11px]">Taubin smoothing</Label>
                              <span className="font-mono text-accent">
                                {smoothingIterations === 0 ? "off" : `${smoothingIterations} pass${smoothingIterations !== 1 ? "es" : ""}`}
                              </span>
                            </div>
                            <Slider
                              min={0} max={15} step={1}
                              value={[smoothingIterations]}
                              onValueChange={([v]) => setSmoothingIterations(v)}
                              disabled={reconstructing}
                            />
                          </div>

                          <div className="flex items-center justify-between">
                            <div className="space-y-0.5">
                              <Label className="text-[11px]">Simplify mesh</Label>
                              <p className="text-[10px] text-muted-foreground">
                                Reduce to ~{meshInfo ? Math.round(meshInfo.triangleCount * 0.8).toLocaleString() : "80%"} triangles
                              </p>
                            </div>
                            <Switch
                              checked={simplifyEnabled}
                              onCheckedChange={setSimplifyEnabled}
                              disabled={reconstructing}
                            />
                          </div>

                          {/* Estimated output */}
                          <div className="rounded-md border border-border p-2 space-y-0.5 text-[11px] text-muted-foreground">
                            <div className="flex justify-between">
                              <span>Est. output{simplifyEnabled ? " (after simplify)" : ""}</span>
                              <span className="font-mono">{estimatedReconstructTris.toLocaleString()} tris</span>
                            </div>
                            <div className="flex justify-between">
                              <span>Detail loss</span>
                              <span className={reconstructResolutionMM <= 2 ? "text-green-400" : reconstructResolutionMM <= 6 ? "text-yellow-400" : "text-orange-400"}>
                                {reconstructResolutionMM <= 2 ? "minimal" : reconstructResolutionMM <= 6 ? "minor" : "noticeable"}
                              </span>
                            </div>
                          </div>

                          {/* Reconstruct button */}
                          <Button
                            size="sm"
                            className="w-full gap-2"
                            style={{ backgroundColor: "hsl(var(--accent))", color: "hsl(var(--accent-foreground))" }}
                            disabled={!meshInfo || reconstructing}
                            onClick={handleVoxelReconstruct}
                          >
                            {reconstructing
                              ? <Loader2 className="h-3 w-3 animate-spin" />
                              : <Boxes className="h-3 w-3" />}
                            {reconstructing
                              ? "Reconstructing…"
                              : `Reconstruct (${reconstructMode === "point_cloud" ? "Point Cloud" : reconstructMode === "shell_voxel" ? "Shell" : "Solid"})`}
                          </Button>
                          {reconstructing && reconstructMessage && (
                            <div className="space-y-1">
                              <Progress value={
                                reconstructMessage.includes("Validating") ? 90
                                : reconstructMessage.includes("consulting AI") || reconstructMessage.includes("Consulting") ? 95
                                : reconstructMessage.includes("Retry") ? 5
                                : reconstructMessage.includes("Simplif") ? 70
                                : reconstructMessage.includes("Smooth") ? 85
                                : reconstructMessage.includes("Extract") || reconstructMessage.includes("Marching") ? 50
                                : reconstructMessage.includes("Flood") ? 30
                                : reconstructMessage.includes("Voxeliz") || reconstructMessage.includes("Rasteriz") ? 15
                                : reconstructMessage.includes("SDF") || reconstructMessage.includes("distance") ? 40
                                : reconstructMessage.includes("point cloud") || reconstructMessage.includes("spatial") ? 15
                                : reconstructMessage.includes("Re-sorting") ? 75
                                : reconstructMessage.includes("Finaliz") ? 95
                                : 10
                              } className="h-1" />
                              <p className="text-[10px] text-muted-foreground text-center">
                                {retryAttempt > 0 && <span className="font-semibold text-amber-500">Attempt {retryAttempt + 1}/{MAX_RECONSTRUCT_RETRIES + 1} · </span>}
                                {reconstructMessage}
                              </p>
                            </div>
                          )}

                          {/* Result */}
                          {reconstructResult && (
                            <div className="rounded-md border border-border p-2 space-y-1.5 text-xs">
                              <div className="flex items-center gap-1.5">
                                <CheckCircle2 className="h-3.5 w-3.5 text-green-400" />
                                <span className="font-medium text-green-400">Reconstruction complete</span>
                              </div>
                              <div className="pl-5 space-y-0.5 text-muted-foreground">
                                <p className="text-green-400">Mesh is watertight (0 open edges)</p>
                                <p className="text-green-400">0 non-manifold edges</p>
                                <p>Mode: {reconstructMode === "point_cloud" ? "Point Cloud" : reconstructMode === "shell_voxel" ? "Shell" : "Solid"}</p>
                                <p>{reconstructMode === "point_cloud" ? "Grid" : "Voxel"} size: {reconstructResult.resolution} mm</p>
                                <p>Output: {reconstructResult.outputTriangles.toLocaleString()} triangles</p>
                                {smoothingIterations > 0 && <p className="text-green-400">Smoothed ({smoothingIterations} Taubin passes)</p>}
                                {simplifyEnabled && <p className="text-green-400">Simplified (quadric edge collapse)</p>}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </>
                  )}

                  {/* CLOUD REPAIR — offload heavy repair to server */}
                  {meshInfo && (
                    <>
                      <SectionHeader icon={Cloud} label="Cloud Repair" open={openSections.cloudRepair} onToggle={() => toggleSection("cloudRepair")} />
                      {openSections.cloudRepair && (
                        <div className="px-3 pb-3 space-y-3">
                          <p className="text-[10px] text-muted-foreground">
                            Offload heavy mesh repair to the cloud. Uses PyMeshLab, Open3D Poisson reconstruction, and isotropic remeshing — handles meshes that are too large for the browser.
                          </p>

                          {/* Submit button */}
                          <Button
                            size="sm"
                            className="w-full gap-2"
                            style={{ backgroundColor: "hsl(var(--accent))", color: "hsl(var(--accent-foreground))" }}
                            disabled={cloudRepairSubmitting || cloudRepairPolling}
                            onClick={handleCloudRepair}
                          >
                            {cloudRepairSubmitting ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : cloudRepairPolling ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <Cloud className="h-3 w-3" />
                            )}
                            {cloudRepairSubmitting
                              ? "Uploading…"
                              : cloudRepairPolling
                              ? "Processing…"
                              : "Send to Cloud Repair"}
                          </Button>

                          {/* Job status */}
                          {cloudRepairJob && (
                            <div className="rounded-md border border-border p-2 space-y-1.5 text-[11px]">
                              <div className="flex items-center gap-1.5">
                                {cloudRepairJob.status === "finished" ? (
                                  <CheckCircle2 className="h-3.5 w-3.5 text-green-400" />
                                ) : cloudRepairJob.status === "failed" ? (
                                  <AlertTriangle className="h-3.5 w-3.5 text-red-400" />
                                ) : (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin text-accent" />
                                )}
                                <span className={cn(
                                  "font-medium",
                                  cloudRepairJob.status === "finished" && "text-green-400",
                                  cloudRepairJob.status === "failed" && "text-red-400",
                                  (cloudRepairJob.status === "queued" || cloudRepairJob.status === "running") && "text-accent",
                                )}>
                                  {cloudRepairJob.status === "finished"
                                    ? "Repair complete"
                                    : cloudRepairJob.status === "failed"
                                    ? "Repair failed"
                                    : cloudRepairJob.status === "running"
                                    ? "Repairing…"
                                    : "Queued"}
                                </span>
                              </div>

                              {cloudRepairJob.stepMessage && (
                                <p className="text-muted-foreground text-[10px]">{cloudRepairJob.stepMessage}</p>
                              )}

                              {cloudRepairJob.status === "running" && (
                                <Progress value={
                                  cloudRepairJob.step === "parse" ? 3
                                  : cloudRepairJob.step === "analyze" ? 6
                                  : cloudRepairJob.step === "weld" ? 10
                                  : cloudRepairJob.step === "sanitize" ? 15
                                  : cloudRepairJob.step === "components" ? 22
                                  : cloudRepairJob.step === "nonmanifold" ? 30
                                  : cloudRepairJob.step === "normals" ? 35
                                  : cloudRepairJob.step === "holes" ? 40
                                  : cloudRepairJob.step === "selfintersect" ? 48
                                  : cloudRepairJob.step === "reconstruct" ? 58
                                  : cloudRepairJob.step === "post_cleanup" ? 68
                                  : cloudRepairJob.step === "remesh" ? 75
                                  : cloudRepairJob.step === "thinwall" ? 82
                                  : cloudRepairJob.step === "simplify" ? 88
                                  : cloudRepairJob.step === "validate" ? 93
                                  : cloudRepairJob.step === "export" ? 97
                                  : 3
                                } className="h-1" />
                              )}

                              {cloudRepairJob.status === "failed" && cloudRepairJob.error && (
                                <p className="text-[10px] text-red-400">{cloudRepairJob.error}</p>
                              )}

                              {/* Repair report */}
                              {cloudRepairJob.status === "finished" && cloudRepairJob.report && (
                                <div className="pl-4 space-y-0.5 text-muted-foreground text-[10px]">
                                  {/* Quality score bar */}
                                  {cloudRepairJob.report.qualityScore != null && (
                                    <div className="flex items-center gap-2 pb-0.5">
                                      <span>Quality</span>
                                      <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                                        <div
                                          className={cn(
                                            "h-full rounded-full transition-all",
                                            cloudRepairJob.report.qualityScore >= 80 ? "bg-green-400"
                                            : cloudRepairJob.report.qualityScore >= 50 ? "bg-yellow-400"
                                            : "bg-red-400",
                                          )}
                                          style={{ width: `${cloudRepairJob.report.qualityScore}%` }}
                                        />
                                      </div>
                                      <span className="font-mono">{cloudRepairJob.report.qualityScore}%</span>
                                    </div>
                                  )}
                                  {cloudRepairJob.report.damageClassification && (
                                    <p>Damage: <span className="text-accent">{cloudRepairJob.report.damageClassification}</span> → mode: <span className="text-accent">{cloudRepairJob.report.mode}</span></p>
                                  )}
                                  <p>Input: {cloudRepairJob.report.inputFaces?.toLocaleString()} → Output: {cloudRepairJob.report.outputFaces?.toLocaleString()} faces</p>
                                  {(cloudRepairJob.report.verticesWelded ?? 0) > 0 && (
                                    <p className="text-green-400">Welded {cloudRepairJob.report.verticesWelded?.toLocaleString()} duplicate vertices</p>
                                  )}
                                  {cloudRepairJob.report.duplicateFacesRemoved > 0 && (
                                    <p className="text-green-400">Removed {cloudRepairJob.report.duplicateFacesRemoved} duplicate faces</p>
                                  )}
                                  {cloudRepairJob.report.componentsRemoved > 0 && (
                                    <p className="text-green-400">Removed {cloudRepairJob.report.componentsRemoved} debris components</p>
                                  )}
                                  {cloudRepairJob.report.nonManifoldEdgesFixed > 0 && (
                                    <p className="text-green-400">Fixed {cloudRepairJob.report.nonManifoldEdgesFixed} non-manifold edges</p>
                                  )}
                                  {(cloudRepairJob.report.selfIntersectionsRemoved ?? 0) > 0 && (
                                    <p className="text-green-400">Removed {cloudRepairJob.report.selfIntersectionsRemoved} self-intersections</p>
                                  )}
                                  {cloudRepairJob.report.holesFilled > 0 && (
                                    <p className="text-green-400">Filled holes</p>
                                  )}
                                  {cloudRepairJob.report.reconstructionUsed && (
                                    <p className="text-green-400">
                                      Reconstruction: {cloudRepairJob.report.reconstructionMethod ?? "Poisson"}
                                    </p>
                                  )}
                                  {(cloudRepairJob.report.featureEdgesPreserved ?? 0) > 0 && (
                                    <p className="text-blue-400">Preserved {cloudRepairJob.report.featureEdgesPreserved?.toLocaleString()} feature edges</p>
                                  )}
                                  {(cloudRepairJob.report.thinWallsThickened ?? 0) > 0 && (
                                    <p className="text-blue-400">Thickened {cloudRepairJob.report.thinWallsThickened?.toLocaleString()} thin-wall vertices</p>
                                  )}
                                  <p className={cloudRepairJob.report.watertight ? "text-green-400" : "text-yellow-400"}>
                                    {cloudRepairJob.report.watertight ? "Watertight" : "Not watertight"}
                                    {cloudRepairJob.report.manifold != null && (cloudRepairJob.report.manifold ? " · Manifold" : " · Non-manifold")}
                                  </p>
                                  <p>Completed in {cloudRepairJob.report.elapsedSeconds}s</p>
                                </div>
                              )}

                              {/* Download buttons */}
                              {cloudRepairJob.status === "finished" && cloudRepairJob.outputPaths && (
                                <div className="flex gap-2 pt-1">
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="flex-1 gap-1 text-[10px] h-7"
                                    onClick={() => handleDownloadRepairResult("repaired.stl")}
                                  >
                                    <Download className="h-3 w-3" />
                                    STL
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="flex-1 gap-1 text-[10px] h-7"
                                    onClick={() => handleDownloadRepairResult("repaired.obj")}
                                  >
                                    <Download className="h-3 w-3" />
                                    OBJ
                                  </Button>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </>
                  )}

                  {/* WAITING — no analysis yet */}
                  {!aiAnalysis && (
                    <div className="px-3 py-3">
                      <p className="text-[11px] text-muted-foreground text-center">
                        Run analysis above to see repair options.
                      </p>
                    </div>
                  )}
                </>
              )}
            </>
          )}

          {/* ── PREPARE TAB ───────────────────────────────────────────────── */}
          {tab === "prepare" && (
            <>
              {!meshInfo && (
                <p className="px-3 py-4 text-xs text-muted-foreground text-center">
                  Load a file first to use prepare tools.
                </p>
              )}

              <SectionHeader icon={Maximize2} label="Scale" open={openSections.scale} onToggle={() => toggleSection("scale")} />
              {openSections.scale && (
                <div className="px-3 pb-3 space-y-3">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs">Uniform scale</Label>
                    <Switch checked={uniformScale} onCheckedChange={setUniformScale} className="scale-75" />
                  </div>
                  {(["X", "Y", "Z"] as const).map((a) => (
                    <div key={a} className="space-y-1">
                      <div className="flex justify-between text-[10px] text-muted-foreground">
                        <span className={AXIS_COLORS[a.toLowerCase()]}>{a} scale</span>
                        <span className="font-mono">{transforms[`scale${a}`].toFixed(2)}×</span>
                      </div>
                      <Slider
                        min={0.1} max={10} step={0.01}
                        value={[transforms[`scale${a}`]]}
                        onValueChange={([v]) => handleScaleChange(a, v)}
                        disabled={!meshInfo}
                      />
                    </div>
                  ))}
                </div>
              )}
              <Separator className="my-1" />

              <SectionHeader icon={RotateCcw} label="Rotate" open={openSections.rotate} onToggle={() => toggleSection("rotate")} />
              {openSections.rotate && (
                <div className="px-3 pb-3 space-y-3">
                  {(["X", "Y", "Z"] as const).map((a) => (
                    <div key={a} className="space-y-1">
                      <div className="flex justify-between text-[10px] text-muted-foreground">
                        <span className={AXIS_COLORS[a.toLowerCase()]}>{a} rotation</span>
                        <span className="font-mono">{transforms[`rot${a}`]}°</span>
                      </div>
                      <Slider
                        min={-180} max={180} step={1}
                        value={[transforms[`rot${a}`]]}
                        onValueChange={([v]) => setTransforms((prev) => ({ ...prev, [`rot${a}`]: v }))}
                        disabled={!meshInfo}
                      />
                    </div>
                  ))}
                </div>
              )}
              <Separator className="my-1" />

              <div className="px-3 pb-3">
                <Button
                  size="sm" variant="outline" className="w-full gap-1.5"
                  onClick={() => setTransforms(DEFAULT_TRANSFORMS)}
                  disabled={!meshInfo}
                >
                  <RotateCcw className="h-3 w-3" />
                  Reset Transforms
                </Button>
              </div>
            </>
          )}

          {/* ── PRESPLIT TAB ──────────────────────────────────────────────── */}
          {tab === "presplit" && (
            <>
              <SectionHeader icon={FileBox} label="Printer Profile" open={openSections.printer} onToggle={() => toggleSection("printer")} />
              {openSections.printer && (
                <div className="px-3 pb-3 space-y-2">
                  {/* Preset / Custom toggle */}
                  <div className="flex items-center gap-1 rounded-md border border-border p-1">
                    <button
                      onClick={() => setUseCustomPrinter(false)}
                      className={cn(
                        "flex-1 rounded py-1 text-[10px] font-semibold uppercase tracking-wider transition-colors",
                        !useCustomPrinter ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:text-foreground"
                      )}
                    >
                      Preset
                    </button>
                    <button
                      onClick={() => setUseCustomPrinter(true)}
                      className={cn(
                        "flex-1 rounded py-1 text-[10px] font-semibold uppercase tracking-wider transition-colors",
                        useCustomPrinter ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:text-foreground"
                      )}
                    >
                      Custom
                    </button>
                  </div>

                  {!useCustomPrinter ? (
                    <>
                      <Select
                        value={selectedPrinter?.id ?? ""}
                        onValueChange={(id) => {
                          const p = (printerProfiles as PrinterProfile[]).find((x) => x.id === id) ?? null;
                          setSelectedPrinter(p);
                        }}
                      >
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue placeholder="Select printer…" />
                        </SelectTrigger>
                        <SelectContent>
                          {brands.map((brand) => (
                            <div key={brand}>
                              <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                                {brand}
                              </div>
                              {(printerProfiles as PrinterProfile[])
                                .filter((p) => p.brand === brand)
                                .map((p) => (
                                  <SelectItem key={p.id} value={p.id} className="text-xs">
                                    {p.name}
                                  </SelectItem>
                                ))}
                            </div>
                          ))}
                        </SelectContent>
                      </Select>

                      {selectedPrinter && (
                        <div className="rounded-md bg-muted/40 px-2 py-1.5 text-xs space-y-0.5">
                          <p className="text-muted-foreground">Build volume</p>
                          <p className="font-mono font-medium">
                            {fmtDim(selectedPrinter.x, u)} × {fmtDim(selectedPrinter.y, u)} × {fmtDim(selectedPrinter.z, u)} {UNIT_LABELS[u]}
                          </p>
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="space-y-2">
                      <p className="text-[10px] text-muted-foreground">Enter build volume ({UNIT_LABELS[u]})</p>
                      <div className="grid grid-cols-3 gap-1.5">
                        {(["x", "y", "z"] as const).map((axis) => {
                          const mmVal = axis === "x" ? customPrinterX : axis === "y" ? customPrinterY : customPrinterZ;
                          const setter = axis === "x" ? setCustomPrinterX : axis === "y" ? setCustomPrinterY : setCustomPrinterZ;
                          const displayVal = parseFloat(fmtDim(mmVal, u));
                          return (
                            <div key={axis} className="space-y-0.5">
                              <label className={cn("text-[10px] font-semibold font-mono", AXIS_COLORS[axis])}>
                                {axis.toUpperCase()}
                              </label>
                              <input
                                type="number"
                                min={0}
                                step={u === "in" ? 0.1 : 1}
                                value={displayVal}
                                onChange={(e) => {
                                  const raw = parseFloat(e.target.value);
                                  if (!isNaN(raw) && raw >= 0) setter(Math.round(raw * UNIT_TO_MM[u]));
                                }}
                                className="w-full h-7 rounded-md border border-border bg-background px-1.5 text-xs font-mono text-center focus:outline-none focus:ring-1 focus:ring-accent"
                              />
                            </div>
                          );
                        })}
                      </div>
                      <div className="rounded-md bg-muted/40 px-2 py-1.5 text-xs space-y-0.5">
                        <p className="text-muted-foreground">Build volume</p>
                        <p className="font-mono font-medium">
                          {fmtDim(customPrinterX, u)} × {fmtDim(customPrinterY, u)} × {fmtDim(customPrinterZ, u)} {UNIT_LABELS[u]}
                        </p>
                      </div>
                    </div>
                  )}

                  <Button
                    size="sm" variant="outline" className="w-full gap-1.5"
                    disabled={!meshInfo || !effectivePrinter}
                    onClick={autoSlice}
                  >
                    <RotateCcw className="h-3 w-3" />
                    Auto-calculate Cuts
                  </Button>
                </div>
              )}
              <Separator className="my-1" />

              <SectionHeader
                icon={Scissors}
                label={`Cut Planes (${enabledPlaneCount}/${cutPlanes.length})`}
                open={openSections.cutPlanes}
                onToggle={() => toggleSection("cutPlanes")}
              />
              {openSections.cutPlanes && (
                <div className="px-3 pb-3 space-y-2">
                  <div className="flex gap-1">
                    {(["x", "y", "z"] as const).map((axis) => (
                      <button
                        key={axis}
                        onClick={() => addCutPlane(axis)}
                        disabled={!meshInfo}
                        className={cn(
                          "flex flex-1 items-center justify-center gap-1 rounded-md border border-border py-1.5 text-xs font-medium transition-colors hover:bg-muted disabled:opacity-40",
                          AXIS_COLORS[axis]
                        )}
                      >
                        <Plus className="h-3 w-3" />{axis.toUpperCase()}
                      </button>
                    ))}
                  </div>

                  {cutPlanes.length === 0 && (
                    <p className="text-center text-xs text-muted-foreground py-2">
                      No cut planes. Add one above or use Auto-calculate.
                    </p>
                  )}

                  {cutPlanes.map((plane, i) => (
                    <div key={i} className="rounded-md border border-border p-2 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className={cn("text-xs font-semibold font-mono", AXIS_COLORS[plane.axis])}>
                          {plane.axis.toUpperCase()}-axis
                        </span>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => updatePlane(i, { position: 0.5 })}
                            className="text-muted-foreground hover:text-accent transition-colors"
                            title="Snap to center"
                          >
                            <Target className="h-3 w-3" />
                          </button>
                          <Switch
                            checked={plane.enabled}
                            onCheckedChange={(v) => updatePlane(i, { enabled: v })}
                            className="scale-75"
                          />
                          <button
                            onClick={() => removeCutPlane(i)}
                            className="text-muted-foreground hover:text-destructive transition-colors"
                          >
                            <Minus className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                      <div className="space-y-1">
                        <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                          <span>Position</span>
                          <span className="font-mono">{Math.round(plane.position * 100)}%</span>
                        </div>
                        <Slider
                          min={5} max={95} step={1}
                          value={[Math.round(plane.position * 100)]}
                          onValueChange={([v]) => updatePlane(i, { position: v / 100 })}
                          disabled={!plane.enabled}
                          className="h-4"
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <Separator className="my-1" />

              <SectionHeader icon={Link2} label="Tenon / Joinery" open={openSections.tenon} onToggle={() => toggleSection("tenon")} />
              {openSections.tenon && (
                <div className="px-3 pb-3 space-y-3">
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Tenon Type</Label>
                    <Select value={tenonType} onValueChange={(v) => setTenonType(v as typeof tenonType)}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">None</SelectItem>
                        <SelectItem value="cylinder">Cylinder Peg</SelectItem>
                        <SelectItem value="dovetail">Dovetail</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  {tenonType !== "none" && (
                    <>
                      <div className="space-y-1">
                        <div className="flex justify-between text-[10px] text-muted-foreground">
                          <span>Tenon size</span>
                          <span className="font-mono">{fmtDim(tenonSize, u)} {UNIT_LABELS[u]}</span>
                        </div>
                        <Slider
                          min={2} max={20} step={0.5}
                          value={[tenonSize]}
                          onValueChange={([v]) => setTenonSize(v)}
                        />
                      </div>
                      <div className="flex items-center justify-between">
                        <Label className="text-xs">Hollow tenon</Label>
                        <Switch checked={tenonHollow} onCheckedChange={setTenonHollow} className="scale-75" />
                      </div>
                      <p className="text-[10px] text-muted-foreground leading-relaxed">
                        Tenon booleans will be applied automatically during the split. Requires a watertight mesh.
                      </p>
                    </>
                  )}
                </div>
              )}
            </>
          )}

          {/* ── SPLIT TAB ─────────────────────────────────────────────────── */}
          {tab === "split" && (
            <div className="px-3 py-3 space-y-3">
              {!meshInfo && (
                <div className="rounded-md border border-border p-2 text-xs text-muted-foreground">
                  Load a file before splitting.
                </div>
              )}
              {meshInfo && enabledPlaneCount === 0 && (
                <div className="rounded-md border border-yellow-500/30 bg-yellow-500/10 p-2 text-xs text-yellow-400 flex items-center gap-1.5">
                  <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" />
                  Add at least one enabled cut plane in Pre-Split.
                </div>
              )}
              {analysisResult && !analysisResult.isWatertight && (
                <div className="rounded-md border border-yellow-500/30 bg-yellow-500/10 p-2 text-xs text-yellow-400 flex items-center gap-1.5">
                  <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" />
                  Mesh has open edges — split may produce artifacts.
                </div>
              )}

              <Button
                size="sm"
                className="w-full gap-2"
                style={{ backgroundColor: "hsl(var(--accent))", color: "hsl(var(--accent-foreground))" }}
                disabled={!meshInfo || splitting || enabledPlaneCount === 0}
                onClick={handleRunSplit}
              >
                {splitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Cpu className="h-3.5 w-3.5" />}
                {splitting
                  ? "Splitting…"
                  : `Run Split (${enabledPlaneCount} cut${enabledPlaneCount !== 1 ? "s" : ""})`}
              </Button>

              {(splitting || splitMessage) && (
                <div className="space-y-1.5">
                  <Progress value={splitProgress} className="h-1.5" />
                  <p className="text-[10px] text-muted-foreground text-center">{splitMessage}</p>
                </div>
              )}

              {splitParts.length > 0 && !splitting && (
                <>
                  <div className="rounded-md border border-green-500/30 bg-green-500/10 p-2 text-xs text-green-400 flex items-center gap-1.5">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    {splitParts.length} parts generated
                  </div>

                  <Button
                    size="sm" variant="outline" className="w-full gap-2"
                    disabled={repairingParts}
                    onClick={handleRepairParts}
                  >
                    {repairingParts ? <Loader2 className="h-3 w-3 animate-spin" /> : <Wrench className="h-3 w-3" />}
                    {repairingParts ? repairPartsMessage || "Repairing…" : "Repair All Parts"}
                  </Button>

                  <Separator />

                  {/* View controls */}
                  <div className="space-y-2">
                    <div className="space-y-1">
                      <div className="flex justify-between text-[10px] text-muted-foreground">
                        <span>Explode view</span>
                        <span className="font-mono">{Math.round(explodeAmount * 100)}%</span>
                      </div>
                      <Slider
                        min={0} max={1} step={0.01}
                        value={[explodeAmount]}
                        onValueChange={([v]) => setExplodeAmount(v)}
                      />
                    </div>
                    <div className="flex items-center justify-between">
                      <Label className="text-xs flex items-center gap-1.5">
                        <Scissors className="h-3 w-3" /> Slice lines
                      </Label>
                      <Switch checked={showSliceLines} onCheckedChange={setShowSliceLines} className="scale-75" />
                    </div>
                    <div className="flex items-center justify-between">
                      <Label className="text-xs flex items-center gap-1.5">
                        <Eye className="h-3 w-3" /> Ghost mode
                      </Label>
                      <Switch checked={ghostMode} onCheckedChange={setGhostMode} className="scale-75" />
                    </div>
                    <div className="flex items-center justify-between">
                      <Label className="text-xs flex items-center gap-1.5">
                        <ZapOff className="h-3 w-3" /> Wireframe
                      </Label>
                      <Switch checked={wireframe} onCheckedChange={setWireframe} className="scale-75" />
                    </div>
                  </div>

                  <Separator />

                  <SectionHeader
                    icon={Package}
                    label={`Parts (${splitParts.length})`}
                    open={openSections.splitResult}
                    onToggle={() => toggleSection("splitResult")}
                  />
                  {openSections.splitResult && (
                    <div className="px-3 pb-2 space-y-1.5">
                      {splitParts.map((part, i) => (
                        <button
                          key={i}
                          onClick={() => setSelectedPartIndex(i === selectedPartIndex ? undefined : i)}
                          className={cn(
                            "w-full rounded-md border p-2 text-left text-xs transition-colors",
                            selectedPartIndex === i
                              ? "border-accent bg-accent/10 text-accent"
                              : "border-border hover:bg-muted"
                          )}
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-medium">{part.label}</span>
                            <span className="font-mono text-[10px] text-muted-foreground">
                              {part.triangleCount.toLocaleString()} tri
                            </span>
                          </div>
                          <p className="text-[10px] text-muted-foreground mt-0.5">
                            {fmtDim(part.bbox.x, u)} × {fmtDim(part.bbox.y, u)} × {fmtDim(part.bbox.z, u)} {UNIT_LABELS[u]}
                          </p>
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* ── EXPORT TAB ────────────────────────────────────────────────── */}
          {tab === "export" && (
            <div className="px-3 py-3 space-y-3">
              {splitParts.length === 0 ? (
                <div className="rounded-md border border-border p-4 text-xs space-y-3 text-center text-muted-foreground">
                  <Package className="h-8 w-8 mx-auto opacity-20" />
                  <p>Run a split to generate exportable parts.</p>
                  <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setTab("split")}>
                    <Cpu className="h-3 w-3" />
                    Go to Split
                  </Button>
                </div>
              ) : (
                <>
                  {/* Format selector */}
                  <div className="flex items-center gap-1 rounded-md border border-border p-1">
                    {(["stl", "obj"] as const).map((fmt) => (
                      <button
                        key={fmt}
                        onClick={() => setExportFormat(fmt)}
                        className={cn(
                          "flex-1 rounded py-1 text-[10px] font-semibold uppercase tracking-wider transition-colors",
                          exportFormat === fmt
                            ? "bg-accent text-accent-foreground"
                            : "text-muted-foreground hover:text-foreground"
                        )}
                      >
                        {fmt}
                      </button>
                    ))}
                  </div>

                  <Button
                    size="sm"
                    className="w-full gap-2"
                    style={{ backgroundColor: "hsl(var(--accent))", color: "hsl(var(--accent-foreground))" }}
                    onClick={handleDownloadZip}
                  >
                    <Package className="h-3.5 w-3.5" />
                    Download All as ZIP ({splitParts.length} {exportFormat.toUpperCase()} files)
                  </Button>

                  <Button
                    size="sm" variant="outline" className="w-full gap-2"
                    onClick={handleSendToQuote}
                  >
                    <Send className="h-3.5 w-3.5" />
                    Send Parts to Quote
                  </Button>

                  <Button
                    size="sm" variant="outline" className="w-full gap-2"
                    disabled={repairingParts}
                    onClick={handleRepairParts}
                  >
                    {repairingParts ? <Loader2 className="h-3 w-3 animate-spin" /> : <Wrench className="h-3 w-3" />}
                    {repairingParts ? repairPartsMessage || "Repairing…" : "Repair All Parts"}
                  </Button>

                  <Separator />

                  {/* Weight estimate */}
                  <div className="rounded-md bg-muted/40 p-2 space-y-2">
                    <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      <Scale className="h-3 w-3" /> Weight Estimate
                    </div>
                    <Select value={materialDensityId} onValueChange={setMaterialDensityId}>
                      <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {MATERIAL_DENSITIES.map((m) => (
                          <SelectItem key={m.id} value={m.id} className="text-xs">
                            {m.label} ({m.density} g/cm³)
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <div className="text-[10px] space-y-0.5">
                      {splitParts.map((part, i) => {
                        const density = MATERIAL_DENSITIES.find((m) => m.id === materialDensityId)?.density ?? 1.24;
                        const weightG = ((part.volumeMM3 / 1000) * density).toFixed(1);
                        return (
                          <div key={i} className="flex justify-between text-muted-foreground">
                            <span>{part.label}</span>
                            <span className="font-mono">{weightG} g</span>
                          </div>
                        );
                      })}
                      {splitParts.length > 1 && (
                        <div className="flex justify-between pt-1 border-t border-border font-medium text-foreground">
                          <span>Total</span>
                          <span className="font-mono">
                            {splitParts.reduce((sum, p) => {
                              const density = MATERIAL_DENSITIES.find((m) => m.id === materialDensityId)?.density ?? 1.24;
                              return sum + (p.volumeMM3 / 1000) * density;
                            }, 0).toFixed(1)} g
                          </span>
                        </div>
                      )}
                    </div>
                  </div>

                  <Separator />

                  <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Individual Parts
                  </p>

                  {splitParts.map((part, i) => (
                    <div key={i} className="rounded-md border border-border p-2 space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium">{part.label}</span>
                        <Button
                          size="sm" variant="outline"
                          className="h-6 text-[10px] px-2 gap-1"
                          onClick={() => handleDownloadPart(i)}
                        >
                          <Download className="h-2.5 w-2.5" /> {exportFormat.toUpperCase()}
                        </Button>
                      </div>
                      <p className="text-[10px] text-muted-foreground">
                        {part.triangleCount.toLocaleString()} tri ·{" "}
                        {fmtDim(part.bbox.x, u)} × {fmtDim(part.bbox.y, u)} × {fmtDim(part.bbox.z, u)} {UNIT_LABELS[u]}
                      </p>
                    </div>
                  ))}

                  <Separator />

                  <div className="rounded-md bg-muted/40 p-2 text-xs space-y-1">
                    {meshInfo && <Row label="Source" value={meshInfo.fileName} mono />}
                    <Row label="Parts" value={String(splitParts.length)} />
                    {effectivePrinter && <Row label="Printer" value={effectivePrinter.name} />}
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {/* Sidebar notification */}
        {sidebarNotice && (
          <div
            className={cn(
              "mx-2 mb-1 rounded-md px-3 py-2 text-xs font-medium transition-all animate-in fade-in slide-in-from-bottom-2 duration-200",
              sidebarNotice.variant === "destructive"
                ? "bg-destructive/15 text-destructive border border-destructive/30"
                : "bg-accent/15 text-accent-foreground border border-accent/30"
            )}
          >
            <div className="flex items-start justify-between gap-2">
              <span className="leading-snug">{sidebarNotice.message}</span>
              <button onClick={() => setSidebarNotice(null)} className="shrink-0 mt-0.5 opacity-60 hover:opacity-100">
                <X className="h-3 w-3" />
              </button>
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="border-t border-border px-3 py-2 text-[10px] text-muted-foreground/50 flex items-center justify-between">
          <span>Karaslice · All processing is local</span>
          <button
            onClick={() => setShowShortcuts((v) => !v)}
            className="hover:text-muted-foreground transition-colors"
            title="Keyboard shortcuts"
          >
            <Keyboard className="h-3 w-3" />
          </button>
        </div>
      </aside>

      {/* ── Viewport ─────────────────────────────────────────────────────────── */}
      <main className="relative flex-1 overflow-hidden">
        <Viewport
          ref={viewportRef}
          onMeshLoaded={handleMeshLoaded}
          onLoadStart={() => setFileLoading(true)}
          onFileSelected={(file) => { pendingUploadFile.current = file; loadedFileRef.current = file; }}
          cutPlanes={cutPlanes}
          printerVolume={effectivePrinter
            ? { x: effectivePrinter.x, y: effectivePrinter.y, z: effectivePrinter.z }
            : null}
          transforms={transforms}
          splitParts={splitPartsVisual}
          explodeAmount={explodeAmount}
          showSliceLines={showSliceLines}
          ghostMode={ghostMode}
          wireframe={wireframe}
          selectedPartIndex={selectedPartIndex}
          onPartSelect={setSelectedPartIndex}
        />

        {/* Stats overlay */}
        {meshInfo && (
          <div className="absolute top-3 right-3 rounded-md border border-border bg-card px-3 py-2 text-xs font-mono space-y-0.5 pointer-events-none shadow-md">
            <p className="text-muted-foreground truncate max-w-[200px]">{meshInfo.fileName}</p>
            <p><span className="text-accent">{meshInfo.triangleCount.toLocaleString()}</span> triangles</p>
            <p>
              <span className="text-accent">{fmtDim(meshInfo.boundingBox.x, u)}</span> ×{" "}
              <span className="text-accent">{fmtDim(meshInfo.boundingBox.y, u)}</span> ×{" "}
              <span className="text-accent">{fmtDim(meshInfo.boundingBox.z, u)}</span> {UNIT_LABELS[u]}
            </p>
            {enabledPlaneCount > 0 && (
              <p><span className="text-accent">{enabledPlaneCount}</span> cut plane{enabledPlaneCount !== 1 ? "s" : ""}</p>
            )}
            {splitParts.length > 0 && (
              <p><span className="text-accent">{splitParts.length}</span> parts</p>
            )}
          </div>
        )}

        {/* Mobile sidebar toggle */}
        <button
          className="absolute top-3 left-3 z-10 flex h-8 w-8 items-center justify-center rounded-md border border-border bg-card shadow-md text-muted-foreground hover:text-foreground transition-colors md:hidden"
          onClick={() => setSidebarOpen((v) => !v)}
          aria-label={sidebarOpen ? "Close menu" : "Open menu"}
        >
          {sidebarOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
        </button>

        {/* View mode badges */}
        {(ghostMode || wireframe || explodeAmount > 0) && (
          <div className="absolute top-3 left-14 md:left-3 flex gap-1.5">
            {ghostMode && (
              <Badge variant="secondary" className="text-[10px] gap-1">
                <Eye className="h-2.5 w-2.5" /> Ghost
              </Badge>
            )}
            {wireframe && (
              <Badge variant="secondary" className="text-[10px] gap-1">
                <ZapOff className="h-2.5 w-2.5" /> Wireframe
              </Badge>
            )}
            {explodeAmount > 0 && (
              <Badge variant="secondary" className="text-[10px] gap-1">
                <Zap className="h-2.5 w-2.5" /> Explode {Math.round(explodeAmount * 100)}%
              </Badge>
            )}
          </div>
        )}

        {/* Keyboard shortcuts overlay */}
        {showShortcuts && (
          <div className="absolute inset-0 flex items-center justify-center bg-background/60 backdrop-blur-sm z-10">
            <div className="rounded-xl border border-border bg-card/95 p-5 min-w-[240px] shadow-2xl">
              <div className="flex items-center justify-between mb-4">
                <p className="text-sm font-semibold">Keyboard Shortcuts</p>
                <button
                  onClick={() => setShowShortcuts(false)}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="space-y-2.5">
                {KEYBOARD_SHORTCUTS.map(([key, desc]) => (
                  <div key={key} className="flex items-center justify-between gap-8 text-xs">
                    <kbd className="rounded bg-muted px-2 py-0.5 font-mono text-[10px]">{key}</kbd>
                    <span className="text-muted-foreground">{desc}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
