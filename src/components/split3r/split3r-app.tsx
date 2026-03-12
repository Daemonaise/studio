"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import {
  Upload, FileBox, Cpu, Scissors, Package,
  ChevronDown, ChevronRight, Plus, Minus, Download,
  RotateCcw, Info, AlertTriangle, CheckCircle2, Loader2,
  Maximize2, Link2, Eye, ZapOff, Zap, Keyboard, X,
  Target, Scale, Send, Menu, Wrench, ArrowLeft, Ruler,
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
import { useToast } from "@/hooks/use-toast";
import type { MeshInfo, CutPlane, TransformState, SplitPartVisual, ViewportHandle } from "./viewport";
import type { SplitPart } from "./manifold-engine";
import printerProfiles from "@/app/data/printer-profiles.json";
import { cn } from "@/lib/utils";

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

export function Split3rApp() {
  const { toast } = useToast();
  const router = useRouter();
  const viewportRef = useRef<ViewportHandle>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Core state ──────────────────────────────────────────────────────────────
  const [meshInfo, setMeshInfo] = useState<MeshInfo | null>(null);
  const [tab, setTab] = useState<Tab>("file");

  // ── Analysis ────────────────────────────────────────────────────────────────
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);

  // ── Repair (mesh) ───────────────────────────────────────────────────────────
  const [repairing, setRepairing] = useState(false);
  const [repairMessage, setRepairMessage] = useState("");
  const [repairResult, setRepairResult] = useState<import("./manifold-engine").RepairStats | null>(null);

  // ── Repair (parts) ──────────────────────────────────────────────────────────
  const [repairingParts, setRepairingParts] = useState(false);
  const [repairPartsMessage, setRepairPartsMessage] = useState("");

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
  const [ghostMode, setGhostMode] = useState(false);
  const [wireframe, setWireframe] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // ── Sections ────────────────────────────────────────────────────────────────
  const [openSections, setOpenSections] = useState({
    fileInfo: true, repair: true, analysis: true,
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
    setMeshInfo(info);
    setAnalysisResult(null);
    setSplitParts((prev) => { prev.forEach((p) => p.geometry.dispose()); return []; });
    setSelectedPartIndex(undefined);
    setExplodeAmount(0);
    setTab("file");
  }, []);

  // ── Analysis ────────────────────────────────────────────────────────────────
  const handleAnalyze = async () => {
    if (!viewportRef.current) return;
    setAnalyzing(true);
    await new Promise((r) => setTimeout(r, 0));
    try {
      const geo = viewportRef.current.getRawGeometry();
      if (!geo) return;
      const { analyzeGeometry } = await import("./stl-utils");
      setAnalysisResult(analyzeGeometry(geo));
    } finally {
      setAnalyzing(false);
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
      toast({
        title: stats.isWatertight ? "Repair complete — mesh is watertight" : "Repair complete",
        description: stats.isWatertight
          ? "All issues resolved. Ready to split."
          : "Some issues may remain. Check analysis for details.",
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast({ title: "Repair failed", description: msg, variant: "destructive" });
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
      const { repairMesh, computeGeometryVolume } = await import("./manifold-engine");
      const THREE = await import("three");
      const repairedParts: SplitPart[] = [];
      for (let i = 0; i < splitParts.length; i++) {
        setRepairPartsMessage(`Repairing part ${i + 1} of ${splitParts.length}…`);
        const { geometry } = await repairMesh(splitParts[i].geometry, () => {});
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
      toast({ title: "Parts repaired", description: `${repairedParts.length} part${repairedParts.length !== 1 ? "s" : ""} repaired.` });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast({ title: "Repair failed", description: msg, variant: "destructive" });
    } finally {
      setRepairingParts(false);
      setRepairPartsMessage("");
    }
  };

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
      toast({ title: "Model fits your printer", description: "No cuts needed." });
    } else {
      setCutPlanes(planes);
      toast({ title: `${planes.length} cut plane${planes.length > 1 ? "s" : ""} added` });
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
      toast({ title: "Split complete", description: `${parts.length} part${parts.length !== 1 ? "s" : ""} ready for export.` });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast({ title: "Split failed", description: msg, variant: "destructive" });
      setSplitMessage("Error: " + msg);
    } finally {
      setSplitting(false);
    }
  };

  // ── Export ────────────────────────────────────────────────────────────────────
  const getBase = () => meshInfo?.fileName.replace(/\.(stl|obj|3mf)$/i, "") ?? "model";

  const handleDownloadPart = async (i: number) => {
    const base = getBase();
    if (exportFormat === "obj") {
      const { geometryToOBJString, downloadText } = await import("./stl-utils");
      downloadText(
        geometryToOBJString(splitParts[i].geometry, `${base}_part${i + 1}`),
        `${base}_part${i + 1}.obj`,
        "model/obj"
      );
    } else {
      const { geometryToSTLBuffer, downloadBlob } = await import("./stl-utils");
      downloadBlob(geometryToSTLBuffer(splitParts[i].geometry), `${base}_part${i + 1}.stl`);
    }
  };

  const handleDownloadZip = async () => {
    const { geometryToSTLBuffer, geometryToOBJString } = await import("./stl-utils");
    const JSZip = (await import("jszip")).default;
    const zip   = new JSZip();
    const base  = getBase();
    for (let i = 0; i < splitParts.length; i++) {
      if (exportFormat === "obj") {
        zip.file(`${base}_part${i + 1}.obj`, geometryToOBJString(splitParts[i].geometry, `${base}_part${i + 1}`));
      } else {
        zip.file(`${base}_part${i + 1}.stl`, geometryToSTLBuffer(splitParts[i].geometry));
      }
    }
    const blob = await zip.generateAsync({ type: "blob" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href = url; a.download = `${base}_split3r.zip`; a.click();
    URL.revokeObjectURL(url);
    toast({ title: "ZIP downloaded", description: `${splitParts.length} ${exportFormat.toUpperCase()} files.` });
  };

  const handleSendToQuote = async () => {
    const { geometryToSTLBuffer } = await import("./stl-utils");
    const { split3rTransfer } = await import("@/lib/split3r-transfer");
    const base = getBase();
    split3rTransfer.set(splitParts.map((part, i) => {
      const buf  = geometryToSTLBuffer(part.geometry);
      const file = new File([buf], `${base}_part${i + 1}.stl`, { type: "model/stl" });
      return { name: file.name, file, bbox: part.bbox, volumeMM3: part.volumeMM3 };
    }));
    // router.push keeps the JS context alive so the module-level store persists
    router.push("/quote?from=split3r");
  };

  // ── Derived ───────────────────────────────────────────────────────────────────
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
        accept=".stl,.obj,.3mf"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          window.dispatchEvent(new CustomEvent("split3r:load-file", { detail: file }));
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
        "flex w-72 max-w-[85vw] flex-shrink-0 flex-col border-r border-border bg-card/50 transition-transform duration-200",
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
          <span className="font-semibold tracking-tight">Split3r</span>
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
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Upload className="h-3.5 w-3.5" />
                  {meshInfo ? "Load New File" : "Upload STL / OBJ / 3MF"}
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

              {/* ── Repair ──────────────────────────────────────────────── */}
              <SectionHeader icon={Wrench} label="Repair Mesh" open={openSections.repair} onToggle={() => toggleSection("repair")} />
              {openSections.repair && (
                <div className="px-3 pb-3 space-y-2">
                  <Button
                    size="sm" className="w-full gap-2"
                    style={{ backgroundColor: "hsl(var(--accent))", color: "hsl(var(--accent-foreground))" }}
                    disabled={!meshInfo || repairing}
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
                          <p className="text-yellow-400">Some issues remain — run analysis for details</p>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}
              <Separator className="my-1" />

              <SectionHeader icon={Cpu} label="Mesh Analysis" open={openSections.analysis} onToggle={() => toggleSection("analysis")} />
              {openSections.analysis && (
                <div className="px-3 pb-3 space-y-2">
                  <Button
                    size="sm" variant="outline" className="w-full gap-2"
                    disabled={!meshInfo || analyzing}
                    onClick={handleAnalyze}
                  >
                    {analyzing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Cpu className="h-3 w-3" />}
                    {analyzing ? "Analyzing…" : "Run Analysis"}
                  </Button>

                  {analysisResult && (
                    <div className="rounded-md border border-border p-2 space-y-1.5 text-xs">
                      <div className="flex items-center gap-1.5">
                        {analysisResult.isWatertight
                          ? <CheckCircle2 className="h-3.5 w-3.5 text-green-400" />
                          : <AlertTriangle className="h-3.5 w-3.5 text-yellow-400" />}
                        <span>{analysisResult.isWatertight ? "Mesh is watertight" : "Issues detected"}</span>
                      </div>
                      <div className="pl-5 space-y-0.5 text-muted-foreground">
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
                          <p className="text-yellow-400">{analysisResult.openEdgeCount} open edges</p>
                        )}
                        {analysisResult.nonManifoldEdgeCount > 0 && (
                          <p className="text-red-400">{analysisResult.nonManifoldEdgeCount} non-manifold edges</p>
                        )}
                      </div>
                      {analysisResult.issues.map((iss, i) => (
                        <p key={i} className="text-[10px] text-muted-foreground pl-5">{iss}</p>
                      ))}
                    </div>
                  )}
                </div>
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

        {/* Footer */}
        <div className="border-t border-border px-3 py-2 text-[10px] text-muted-foreground/50 flex items-center justify-between">
          <span>Split3r · All processing is local</span>
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
          cutPlanes={cutPlanes}
          printerVolume={effectivePrinter
            ? { x: effectivePrinter.x, y: effectivePrinter.y, z: effectivePrinter.z }
            : null}
          transforms={transforms}
          splitParts={splitPartsVisual}
          explodeAmount={explodeAmount}
          ghostMode={ghostMode}
          wireframe={wireframe}
          selectedPartIndex={selectedPartIndex}
          onPartSelect={setSelectedPartIndex}
        />

        {/* Stats overlay */}
        {meshInfo && (
          <div className="absolute top-3 right-3 rounded-md border border-border bg-card/80 backdrop-blur-sm px-3 py-2 text-xs font-mono space-y-0.5 pointer-events-none">
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
          className="absolute top-3 left-3 z-10 flex h-8 w-8 items-center justify-center rounded-md border border-border bg-card/80 backdrop-blur-sm text-muted-foreground hover:text-foreground transition-colors md:hidden"
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
