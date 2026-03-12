
"use client";

import { useState, useRef, Suspense, useEffect, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import type { Split3rPartTransfer } from "@/lib/split3r-transfer";
import { Upload, Loader2, Wand2, Info, Clock, AlertTriangle, CheckCircle2, CreditCard, MapPin, Phone, Mail, User, Building2, FileBox, Layers, Zap, Package, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { QuoteOutput } from "@/ai/flows/quote-generator-flow";
import { generateQuoteFromModel } from "@/app/actions/quote-actions";
import { createCheckoutSession, ShippingInfo } from "@/app/actions/checkout-actions";
import { materials } from "@/app/data/materials";
import pricingMatrix from "@/app/data/pricing-matrix.json";
import { cn } from "@/lib/utils";
import { Switch } from "../ui/switch";
import { Badge } from "../ui/badge";

// Helper to convert file to data URI
const toDataURL = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

const formatCurrency = (amount: number) => {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount);
};

const formatSegmentationTier = (tier: string) => {
  if (tier === "none") return null;
  return `${tier.charAt(0).toUpperCase() + tier.slice(1)} Segmentation`;
};

// Cost breakdown row
const LineItem = ({ label, value }: { label: string; value: number }) => (
  <div className="flex items-center justify-between px-4 py-2.5 text-sm">
    <span className="text-muted-foreground">{label}</span>
    <span className="font-medium tabular-nums">{formatCurrency(value)}</span>
  </div>
);

// Part spec cell
const SpecItem = ({ label, value }: { label: string; value: string }) => (
  <div className="rounded-md bg-muted/50 px-3 py-2">
    <p className="text-xs text-muted-foreground mb-0.5">{label}</p>
    <p className="text-sm font-medium">{value}</p>
  </div>
);

const defaultShipping: ShippingInfo = {
  fullName: "",
  email: "",
  phone: "",
  company: "",
  address1: "",
  address2: "",
  city: "",
  state: "",
  zip: "",
  country: "US",
};

const ACCEPTED_EXTS = ["stl", "obj", "3mf"];
const FORMAT_BADGES = ["STL", "OBJ", "3MF"];

// Category colors for material selector
const CATEGORY_COLORS: Record<string, string> = {
  Standard: "text-blue-400",
  Engineering: "text-orange-400",
  Flexible: "text-purple-400",
  Composite: "text-green-400",
};

function StepCircle({ n }: { n: number }) {
  return (
    <span className="inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold shrink-0"
      style={{ backgroundColor: "hsl(var(--accent))", color: "hsl(var(--accent-foreground))" }}>
      {n}
    </span>
  );
}

function AutomotiveQuoteWizardInner() {
  const searchParams = useSearchParams();
  const materialParam = searchParams.get("material");
  const validMaterialIds = materials.map((m) => m.id);
  const initialMaterial =
    materialParam && validMaterialIds.includes(materialParam) ? materialParam : "PLA";

  // ── Single-file state ───────────────────────────────────────────────────────
  const [file, setFile] = useState<File | null>(null);
  const [material, setMaterial] = useState<string>(initialMaterial);
  const [nozzleSize, setNozzleSize] = useState<string>("0.4");
  const [autoPrinterSelection, setAutoPrinterSelection] = useState(true);
  const [userSelectedPrinter, setUserSelectedPrinter] = useState<string>("");
  const [quote, setQuote] = useState<QuoteOutput | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Multi-part state (Split3r) ──────────────────────────────────────────────
  const [multiParts, setMultiParts] = useState<Split3rPartTransfer[]>([]);
  const [partQuotes, setPartQuotes] = useState<(QuoteOutput | null)[]>([]);
  const [activePartIndex, setActivePartIndex] = useState(0);
  const [quotingIndex, setQuotingIndex] = useState<number | null>(null); // which part is being quoted
  const isMultiMode = multiParts.length > 0;

  // Load parts from the transfer store when arriving from Split3r
  useEffect(() => {
    if (searchParams.get("from") !== "split3r") return;
    import("@/lib/split3r-transfer").then(({ split3rTransfer }) => {
      const parts = split3rTransfer.get();
      if (parts.length > 0) {
        setMultiParts(parts);
        setPartQuotes(new Array(parts.length).fill(null));
        split3rTransfer.clear();
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Checkout dialog state
  const [showCheckout, setShowCheckout] = useState(false);
  const [shipping, setShipping] = useState<ShippingInfo>(defaultShipping);
  const [isCheckingOut, setIsCheckingOut] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);

  const handleFileSelected = (selectedFile: File | null) => {
    if (!selectedFile) return;

    const MAX_MB = 50;
    if (selectedFile.size > MAX_MB * 1024 * 1024) {
      setError(`File too large. Maximum size is ${MAX_MB} MB.`);
      setFile(null);
      return;
    }

    const ext = selectedFile.name.split(".").pop()?.toLowerCase() ?? "";
    if (!ACCEPTED_EXTS.includes(ext)) {
      setError(`Invalid file type. Accepted formats: ${FORMAT_BADGES.join(", ")}`);
      setFile(null);
      return;
    }

    setFile(selectedFile);
    setQuote(null);
    setError(null);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    handleFileSelected(e.target.files?.[0] || null);
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFileSelected(e.dataTransfer.files[0]);
      e.dataTransfer.clearData();
    }
  };

  const handleGenerateQuote = async () => {
    if (!file) {
      setError("Please upload a 3D model file first.");
      return;
    }

    setIsLoading(true);
    setError(null);
    setQuote(null);

    try {
      const fileDataUri = await toDataURL(file);
      const input = {
        fileName: file.name,
        fileDataUri,
        material,
        nozzleSize,
        autoPrinterSelection,
        selectedPrinterKey: userSelectedPrinter,
      };
      const result = await generateQuoteFromModel(input);
      setQuote(result);
    } catch (e: any) {
      console.error(e);
      setError(
        e.message ||
          "An error occurred while generating the quote. Please check the model file or try again."
      );
    } finally {
      setIsLoading(false);
    }
  };

  // Quote all Split3r parts in succession
  const handleQuoteAll = useCallback(async () => {
    if (multiParts.length === 0) return;
    setIsLoading(true);
    setError(null);
    const results: (QuoteOutput | null)[] = new Array(multiParts.length).fill(null);
    for (let i = 0; i < multiParts.length; i++) {
      setQuotingIndex(i);
      setActivePartIndex(i);
      try {
        const fileDataUri = await toDataURL(multiParts[i].file);
        const result = await generateQuoteFromModel({
          fileName: multiParts[i].name,
          fileDataUri,
          material,
          nozzleSize,
          autoPrinterSelection,
          selectedPrinterKey: userSelectedPrinter,
        });
        results[i] = result;
        setPartQuotes([...results]);
      } catch (e: any) {
        setError(`Part ${i + 1} failed: ${e.message ?? "Unknown error"}`);
        break;
      }
    }
    setQuotingIndex(null);
    setIsLoading(false);
    setActivePartIndex(0);
  }, [multiParts, material, nozzleSize, autoPrinterSelection, userSelectedPrinter]);

  const setShippingField = (field: keyof ShippingInfo) =>
    (e: React.ChangeEvent<HTMLInputElement>) =>
      setShipping((prev) => ({ ...prev, [field]: e.target.value }));

  const handleCheckout = async (e: React.FormEvent) => {
    e.preventDefault();
    // In multi-part mode use the combined total; otherwise use the single quote
    const activeQuote = isMultiMode ? partQuotes[activePartIndex] : quote;
    const completedQuotes = isMultiMode ? partQuotes.filter(Boolean) as QuoteOutput[] : [];
    const combinedTotal = isMultiMode
      ? completedQuotes.reduce((s, q) => s + q.costBreakdown.total, 0)
      : (quote?.costBreakdown.total ?? 0);
    if (!activeQuote && !isMultiMode) return;

    setIsCheckingOut(true);
    setCheckoutError(null);

    const representativeQuote = isMultiMode
      ? (completedQuotes[0] ?? activeQuote)
      : quote;
    if (!representativeQuote) { setIsCheckingOut(false); return; }

    try {
      const result = await createCheckoutSession(
        {
          totalCost: isMultiMode ? combinedTotal : representativeQuote.costBreakdown.total,
          material: representativeQuote.selectedFilament,
          jobScale: representativeQuote.jobScale,
          mode: representativeQuote.mode,
          leadTimeMin: representativeQuote.leadTimeDays.min,
          leadTimeMax: representativeQuote.leadTimeDays.max,
          estimatedHours: isMultiMode
            ? completedQuotes.reduce((s, q) => s + q.estimatedHours, 0)
            : representativeQuote.estimatedHours,
          selectedPrinterKey: representativeQuote.selectedPrinterKey,
          fileName: isMultiMode
            ? `${multiParts.length} parts (Split3r)`
            : (file?.name || "3D Model"),
        },
        shipping
      );

      if (result.error || !result.url) {
        setCheckoutError(result.error || "Failed to create checkout session.");
        setIsCheckingOut(false);
        return;
      }

      window.location.href = result.url;
    } catch (err: any) {
      setCheckoutError(err.message || "Checkout failed. Please try again.");
      setIsCheckingOut(false);
    }
  };

  const nozzleSizes = pricingMatrix.nozzles.available_mm.map(String);
  const selectedMaterial = materials.find((m) => m.id === material);
  const completedPartQuotes = partQuotes.filter(Boolean) as QuoteOutput[];
  const allPartsQuoted = isMultiMode && completedPartQuotes.length === multiParts.length;
  const combinedTotal = completedPartQuotes.reduce((s, q) => s + q.costBreakdown.total, 0);
  const activePartQuote = isMultiMode ? partQuotes[activePartIndex] : null;
  const displayQuote = isMultiMode ? activePartQuote : quote;

  return (
    <>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* ── Configure card ─────────────────────────────── */}
        <div className="group relative transform-gpu rounded-lg transition-transform duration-300 ease-in-out will-change-transform hover:scale-[1.02] animate-in fade-in-0 slide-in-from-bottom-4 duration-700">
          <div className="absolute -inset-0.5 rounded-lg bg-gradient-to-br from-primary/70 via-accent/70 to-secondary/70 opacity-20 blur-xl transition-opacity duration-300 group-hover:opacity-100" />
          <Card className="relative h-full flex flex-col teal-frame">
            <CardHeader className="pb-4">
              <div className="flex items-center gap-3">
                <StepCircle n={1} />
                <div>
                  <CardTitle>Configure Your Print</CardTitle>
                  <CardDescription className="mt-0.5">
                    Upload your model and choose print settings.
                  </CardDescription>
                </div>
              </div>
            </CardHeader>

            <CardContent className="space-y-5 flex-grow">
              {/* Multi-part list (Split3r mode) OR single file upload */}
              {isMultiMode ? (
                <div className="space-y-2">
                  <Label className="flex items-center gap-1.5">
                    <Package className="h-3.5 w-3.5 text-muted-foreground" />
                    {multiParts.length} Parts from Split3r
                  </Label>
                  <div className="rounded-lg border border-border divide-y divide-border max-h-44 overflow-y-auto">
                    {multiParts.map((part, i) => {
                      const q = partQuotes[i];
                      const isQuoting = quotingIndex === i;
                      return (
                        <button
                          key={i}
                          type="button"
                          onClick={() => setActivePartIndex(i)}
                          className={cn(
                            "w-full flex items-center justify-between px-3 py-2 text-xs text-left transition-colors",
                            activePartIndex === i ? "bg-accent/10 text-accent" : "hover:bg-muted/40"
                          )}
                        >
                          <span className="font-medium truncate max-w-[180px]">{part.name}</span>
                          <span className="flex items-center gap-1.5 shrink-0 ml-2">
                            {isQuoting ? (
                              <Loader2 className="h-3 w-3 animate-spin text-accent" />
                            ) : q ? (
                              <CheckCircle2 className="h-3 w-3 text-green-400" />
                            ) : (
                              <span className="text-muted-foreground">pending</span>
                            )}
                            {q && <span className="font-mono text-accent">{formatCurrency(q.costBreakdown.total)}</span>}
                            <ChevronRight className="h-3 w-3 text-muted-foreground" />
                          </span>
                        </button>
                      );
                    })}
                  </div>
                  {allPartsQuoted && (
                    <div className="rounded-md bg-accent/5 border border-accent/20 px-3 py-2 flex items-center justify-between text-sm">
                      <span className="text-muted-foreground font-medium">Combined Total</span>
                      <span className="font-bold text-accent text-base">{formatCurrency(combinedTotal)}</span>
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-2">
                  <Label className="flex items-center gap-1.5">
                    <FileBox className="h-3.5 w-3.5 text-muted-foreground" />
                    3D Model File
                  </Label>
                  <div
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                    onClick={() => fileInputRef.current?.click()}
                    className={cn(
                      "relative flex flex-col items-center justify-center w-full h-40 border-2 border-dashed rounded-lg transition-all duration-200 cursor-pointer",
                      isDragging
                        ? "border-accent bg-accent/10 scale-[1.01]"
                        : file
                          ? "border-accent/60 bg-accent/5"
                          : "border-input hover:border-accent/50 hover:bg-accent/5"
                    )}
                  >
                    <div className="text-center text-muted-foreground p-4 pointer-events-none">
                      {file ? (
                        <>
                          <CheckCircle2 className="h-8 w-8 mx-auto mb-2 text-accent" />
                          <p className="font-medium text-foreground text-sm">{file.name}</p>
                          <p className="text-xs mt-0.5">{(file.size / 1024).toFixed(0)} KB · Click to replace</p>
                        </>
                      ) : (
                        <>
                          <Upload className="h-8 w-8 mx-auto mb-2 animate-pulse [animation-duration:2s]" />
                          <p className="font-medium text-sm">Drag & drop or click to browse</p>
                          <div className="flex items-center justify-center gap-1.5 mt-2">
                            {FORMAT_BADGES.map((fmt) => (
                              <span key={fmt} className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded border border-accent/30 bg-accent/5 text-accent/70">
                                {fmt}
                              </span>
                            ))}
                            <span className="text-xs opacity-50">· up to 50 MB</span>
                          </div>
                        </>
                      )}
                    </div>
                    <Input
                      ref={fileInputRef}
                      id="file-upload"
                      type="file"
                      accept=".stl,.obj,.3mf"
                      className="hidden"
                      onChange={handleFileChange}
                      disabled={isLoading}
                    />
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Material */}
                <div className="space-y-2">
                  <Label htmlFor="material" className="flex items-center gap-1.5">
                    <Layers className="h-3.5 w-3.5 text-muted-foreground" />
                    Material
                  </Label>
                  <Select
                    value={material}
                    onValueChange={setMaterial}
                    disabled={isLoading}
                  >
                    <SelectTrigger id="material">
                      <SelectValue placeholder="Select material" />
                    </SelectTrigger>
                    <SelectContent>
                      {materials.map((mat) => (
                        <SelectItem key={mat.id} value={mat.id}>
                          <div className="flex items-center gap-2">
                            <span>{mat.id}</span>
                            <span className={cn("text-xs", CATEGORY_COLORS[mat.category] ?? "text-muted-foreground")}>
                              {mat.category}
                            </span>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {selectedMaterial && (
                    <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2">
                      {selectedMaterial.description}
                    </p>
                  )}
                </div>

                {/* Nozzle */}
                <div className="space-y-2">
                  <Label htmlFor="nozzle" className="flex items-center gap-1.5">
                    <Zap className="h-3.5 w-3.5 text-muted-foreground" />
                    Nozzle Size
                  </Label>
                  <Select
                    value={nozzleSize}
                    onValueChange={setNozzleSize}
                    disabled={isLoading}
                  >
                    <SelectTrigger id="nozzle">
                      <SelectValue placeholder="Select nozzle size" />
                    </SelectTrigger>
                    <SelectContent>
                      {nozzleSizes.map((size) => (
                        <SelectItem key={size} value={size}>
                          {size} mm
                          {size === "0.4" && (
                            <span className="ml-1.5 text-xs text-muted-foreground">· recommended</span>
                          )}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Smaller = finer detail · Larger = faster print
                  </p>
                </div>
              </div>

              <div className="space-y-4">
                <div className="flex items-center justify-between rounded-lg border border-border/50 bg-muted/20 px-4 py-3">
                  <div>
                    <Label htmlFor="auto-printer" className="cursor-pointer font-medium">
                      Auto-select printer
                    </Label>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      We'll pick the most cost-effective machine for your part
                    </p>
                  </div>
                  <Switch
                    id="auto-printer"
                    checked={autoPrinterSelection}
                    onCheckedChange={setAutoPrinterSelection}
                    disabled={isLoading}
                  />
                </div>
                {!autoPrinterSelection && (
                  <div className="space-y-2 animate-in fade-in-0 slide-in-from-top-2 duration-200">
                    <Label htmlFor="printer-select">Preferred Printer</Label>
                    <Select
                      value={userSelectedPrinter}
                      onValueChange={setUserSelectedPrinter}
                      disabled={isLoading}
                    >
                      <SelectTrigger id="printer-select">
                        <SelectValue placeholder="Select a printer" />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.entries(pricingMatrix.printers).map(
                          ([key, printer]) => (
                            <SelectItem key={key} value={key}>
                              {printer.label}
                            </SelectItem>
                          )
                        )}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      If your selection can't fit the part, an eligible printer will be chosen automatically.
                    </p>
                  </div>
                )}
              </div>
            </CardContent>

            <CardFooter>
              <Button
                onClick={isMultiMode ? handleQuoteAll : handleGenerateQuote}
                disabled={isLoading || (!isMultiMode && !file)}
                className="w-full"
                size="lg"
                style={{
                  backgroundColor: "hsl(var(--accent))",
                  color: "hsl(var(--accent-foreground))",
                }}
              >
                {isLoading ? (
                  <>
                    <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                    {isMultiMode && quotingIndex !== null
                      ? `Quoting Part ${quotingIndex + 1} of ${multiParts.length}…`
                      : "Analyzing & Quoting…"}
                  </>
                ) : (
                  <>
                    <Wand2 className="mr-2 h-5 w-5" />
                    {isMultiMode
                      ? allPartsQuoted
                        ? `Re-quote All ${multiParts.length} Parts`
                        : `Quote All ${multiParts.length} Parts`
                      : "Generate AI Quote"}
                  </>
                )}
              </Button>
            </CardFooter>
          </Card>
        </div>

        {/* ── Quote result card ──────────────────────────── */}
        <div className="group relative transform-gpu rounded-lg transition-transform duration-300 ease-in-out will-change-transform hover:scale-[1.02] animate-in fade-in-0 slide-in-from-bottom-4 duration-700 delay-150">
          <div className="absolute -inset-0.5 rounded-lg bg-gradient-to-br from-primary/70 via-accent/70 to-secondary/70 opacity-20 blur-xl transition-opacity duration-300 group-hover:opacity-100" />
          <Card className="relative h-full flex flex-col teal-frame">
            <CardHeader className="pb-4">
              <div className="flex items-center gap-3">
                <StepCircle n={2} />
                <div>
                  <CardTitle>
                    {isMultiMode
                      ? activePartIndex < multiParts.length
                        ? `Part ${activePartIndex + 1} of ${multiParts.length}`
                        : "Instant Quote"
                      : "Instant Quote"}
                  </CardTitle>
                  <CardDescription className="mt-0.5">
                    {isMultiMode
                      ? multiParts[activePartIndex]?.name ?? "Your estimated cost will appear here."
                      : "Your estimated cost will appear here."}
                  </CardDescription>
                </div>
              </div>
            </CardHeader>

            <CardContent className="flex-grow flex flex-col">
              {/* Loading */}
              {isLoading && !displayQuote && (
                <div className="flex flex-col items-center justify-center text-center text-muted-foreground space-y-4 h-full animate-in fade-in-0 duration-300">
                  <div className="relative">
                    <div className="absolute inset-0 rounded-full bg-accent/20 blur-lg scale-150" />
                    <Loader2 className="relative h-10 w-10 animate-spin text-accent" />
                  </div>
                  <p className="font-medium">
                    {isMultiMode && quotingIndex !== null
                      ? `Quoting part ${quotingIndex + 1} of ${multiParts.length}…`
                      : "AI is analyzing your model…"}
                  </p>
                  <p className="text-sm">This may take a moment for complex models.</p>
                </div>
              )}

              {/* Error */}
              {error && (
                <div className="flex flex-col items-center justify-center text-center text-destructive space-y-4 h-full bg-destructive/10 rounded-lg p-4 animate-in fade-in-0 duration-300">
                  <Info className="h-10 w-10" />
                  <p className="font-medium">Error Generating Quote</p>
                  <p className="text-sm">{error}</p>
                </div>
              )}

              {/* Empty state */}
              {!isLoading && !displayQuote && !error && (
                <div className="flex flex-col items-center justify-center text-center text-muted-foreground space-y-4 h-full">
                  <div className="rounded-full border border-accent/20 bg-accent/5 p-5 animate-pulse [animation-duration:3s]">
                    <Wand2 className="h-9 w-9 text-accent/50" />
                  </div>
                  <div className="space-y-1.5">
                    <p className="font-medium">Your quote is just a click away.</p>
                    <p className="text-sm">
                      Upload a model and hit <em>Generate AI Quote</em>.
                    </p>
                  </div>
                  <div className="flex flex-col gap-2 pt-2 text-xs text-muted-foreground/60 w-full max-w-[200px]">
                    {["Instant AI analysis", "Real-time cost breakdown", "Lead time estimate"].map((item) => (
                      <div key={item} className="flex items-center gap-2">
                        <CheckCircle2 className="h-3.5 w-3.5 text-accent/40 shrink-0" />
                        <span>{item}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Quote result */}
              {displayQuote && (
                <div className="space-y-4 animate-in fade-in-0 slide-in-from-bottom-2 duration-500">
                  {/* Multi-part: combined total banner */}
                  {isMultiMode && allPartsQuoted && (
                    <div className="rounded-lg bg-accent/5 border border-accent/30 px-4 py-2.5 flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">{multiParts.length} parts · combined</span>
                      <span className="font-bold text-accent text-base">{formatCurrency(combinedTotal)}</span>
                    </div>
                  )}

                  {/* Status badges */}
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="outline" className="border-accent/50 text-accent bg-accent/5">
                      {displayQuote.jobScale}
                    </Badge>
                    <Badge variant="outline">{displayQuote.mode}</Badge>
                    {formatSegmentationTier(displayQuote.segmentationTier) && (
                      <Badge variant="outline" className="border-amber-500/60 text-amber-500 bg-amber-500/5">
                        {formatSegmentationTier(displayQuote.segmentationTier)}
                      </Badge>
                    )}
                  </div>

                  {/* Total price hero */}
                  <div className="rounded-lg bg-gradient-to-br from-accent/10 via-accent/5 to-transparent border border-accent/30 p-5 text-center">
                    <p className="text-xs font-semibold uppercase tracking-widest text-accent/70 mb-1">
                      {isMultiMode ? `Part ${activePartIndex + 1} Cost` : "Total Estimated Cost"}
                    </p>
                    <p className="text-5xl font-bold tracking-tight text-accent">
                      {formatCurrency(displayQuote.costBreakdown.total)}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1.5">
                      Includes materials, labor &amp; shipping
                    </p>
                  </div>

                  {/* Lead time */}
                  <div className="flex items-center justify-center gap-2 py-0.5 text-sm">
                    <Clock className="h-4 w-4 text-accent flex-shrink-0" />
                    <span className="text-muted-foreground">Est. lead time:</span>
                    <span className="font-semibold">
                      {displayQuote.leadTimeDays.min}–{displayQuote.leadTimeDays.max} business days
                    </span>
                  </div>

                  {/* Cost breakdown */}
                  <div className="rounded-lg border overflow-hidden">
                    <div className="px-4 py-2 bg-muted/40 border-b">
                      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Cost Breakdown</p>
                    </div>
                    <div className="divide-y">
                      <LineItem label="Machine / Print Time" value={displayQuote.costBreakdown.machine} />
                      {displayQuote.costBreakdown.segmentation > 0 && (
                        <LineItem label="Segmentation Labor" value={displayQuote.costBreakdown.segmentation} />
                      )}
                      {displayQuote.costBreakdown.risk > 0 && (
                        <LineItem label="Risk / Contingency" value={displayQuote.costBreakdown.risk} />
                      )}
                      <LineItem label={`Material (${displayQuote.selectedFilament})`} value={displayQuote.costBreakdown.material} />
                      <LineItem
                        label="Shipping & Handling"
                        value={displayQuote.costBreakdown.shippingEmbedded + displayQuote.costBreakdown.handling}
                      />
                      <div className="flex items-center justify-between px-4 py-3 bg-accent/5">
                        <span className="text-sm font-semibold">Total</span>
                        <span className="font-bold text-accent text-base">
                          {formatCurrency(displayQuote.costBreakdown.total)}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Part specs */}
                  <div className="grid grid-cols-2 gap-2">
                    <SpecItem label="Dimensions" value={`${displayQuote.bbox_mm.x.toFixed(0)} × ${displayQuote.bbox_mm.y.toFixed(0)} × ${displayQuote.bbox_mm.z.toFixed(0)} mm`} />
                    <SpecItem label="Volume" value={`${displayQuote.volume_cm3.toFixed(1)} cm³`} />
                    <SpecItem label="Est. Print Time" value={`${displayQuote.estimatedHours.toFixed(1)} hrs`} />
                    <SpecItem label="Printer" value={(pricingMatrix.printers as any)[displayQuote.selectedPrinterKey]?.label ?? displayQuote.selectedPrinterKey} />
                    <SpecItem label="Nozzle" value={`${displayQuote.selectedNozzle} mm`} />
                    {displayQuote.segmentCountEstimate > 1 && (
                      <SpecItem label="Segments" value={`${displayQuote.segmentCountEstimate}`} />
                    )}
                  </div>

                  {/* Warnings */}
                  {displayQuote.warnings.length > 0 && (
                    <div className="rounded-lg bg-amber-500/10 border border-amber-500/30 p-4">
                      <h4 className="text-xs font-semibold uppercase tracking-wider text-amber-600 dark:text-amber-400 mb-2 flex items-center gap-1.5">
                        <AlertTriangle className="h-3.5 w-3.5" />
                        Notes &amp; Warnings
                      </h4>
                      <ul className="text-xs text-amber-700 dark:text-amber-400 space-y-1">
                        {displayQuote.warnings.map((warning, i) => (
                          <li key={i} className="flex gap-1.5">
                            <span className="flex-shrink-0 opacity-60">›</span>
                            <span>{warning}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </CardContent>

            {(displayQuote || allPartsQuoted) && (
              <CardFooter className="flex-col items-stretch space-y-2">
                <Button
                  className="w-full"
                  size="lg"
                  onClick={() => {
                    setCheckoutError(null);
                    setShowCheckout(true);
                  }}
                  style={{
                    backgroundColor: "hsl(var(--accent))",
                    color: "hsl(var(--accent-foreground))",
                  }}
                >
                  <CreditCard className="mr-2 h-5 w-5" />
                  {isMultiMode && allPartsQuoted
                    ? `Proceed to Checkout — ${formatCurrency(combinedTotal)}`
                    : "Proceed to Checkout"}
                </Button>
                <p className="text-xs text-center text-muted-foreground">
                  Shipping included · Secure payment via Stripe
                </p>
              </CardFooter>
            )}
          </Card>
        </div>
      </div>

      {/* ── Checkout / Shipping Dialog ─────────────────── */}
      <Dialog open={showCheckout} onOpenChange={setShowCheckout}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-xl">
              <MapPin className="h-5 w-5 text-accent" />
              Shipping & Payment
            </DialogTitle>
            <DialogDescription>
              Enter your shipping address. You&apos;ll be redirected to Stripe to
              complete payment securely.
            </DialogDescription>
          </DialogHeader>

          {/* Quote summary strip */}
          {(displayQuote || allPartsQuoted) && (
            <div className="rounded-lg bg-accent/5 border border-accent/20 px-4 py-3 flex items-center justify-between text-sm">
              <span className="text-muted-foreground">
                {isMultiMode
                  ? `${multiParts.length} parts · ${material}`
                  : `${displayQuote?.selectedFilament} · ${displayQuote?.jobScale}`}
              </span>
              <span className="font-bold text-accent text-base">
                {formatCurrency(isMultiMode ? combinedTotal : (displayQuote?.costBreakdown.total ?? 0))}
              </span>
            </div>
          )}

          <form onSubmit={handleCheckout} className="space-y-4 mt-2">
            {/* Contact info */}
            <div className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Contact Information
              </p>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="sh-name">Full Name *</Label>
                  <div className="relative">
                    <User className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                    <Input
                      id="sh-name"
                      required
                      placeholder="Your name"
                      value={shipping.fullName}
                      onChange={setShippingField("fullName")}
                      className="pl-8 h-9 text-sm focus-visible:ring-accent"
                      disabled={isCheckingOut}
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="sh-company">Company</Label>
                  <div className="relative">
                    <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                    <Input
                      id="sh-company"
                      placeholder="Optional"
                      value={shipping.company || ""}
                      onChange={setShippingField("company")}
                      className="pl-8 h-9 text-sm focus-visible:ring-accent"
                      disabled={isCheckingOut}
                    />
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="sh-email">Email *</Label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                    <Input
                      id="sh-email"
                      type="email"
                      required
                      placeholder="you@example.com"
                      value={shipping.email}
                      onChange={setShippingField("email")}
                      className="pl-8 h-9 text-sm focus-visible:ring-accent"
                      disabled={isCheckingOut}
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="sh-phone">Phone *</Label>
                  <div className="relative">
                    <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                    <Input
                      id="sh-phone"
                      type="tel"
                      required
                      placeholder="+1 555 000 0000"
                      value={shipping.phone}
                      onChange={setShippingField("phone")}
                      className="pl-8 h-9 text-sm focus-visible:ring-accent"
                      disabled={isCheckingOut}
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Shipping address */}
            <div className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Shipping Address
              </p>

              <div className="space-y-1.5">
                <Label htmlFor="sh-addr1">Address Line 1 *</Label>
                <Input
                  id="sh-addr1"
                  required
                  placeholder="123 Main Street"
                  value={shipping.address1}
                  onChange={setShippingField("address1")}
                  className="h-9 text-sm focus-visible:ring-accent"
                  disabled={isCheckingOut}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="sh-addr2">Address Line 2</Label>
                <Input
                  id="sh-addr2"
                  placeholder="Suite, apt, unit… (optional)"
                  value={shipping.address2 || ""}
                  onChange={setShippingField("address2")}
                  className="h-9 text-sm focus-visible:ring-accent"
                  disabled={isCheckingOut}
                />
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-1 space-y-1.5">
                  <Label htmlFor="sh-city">City *</Label>
                  <Input
                    id="sh-city"
                    required
                    placeholder="City"
                    value={shipping.city}
                    onChange={setShippingField("city")}
                    className="h-9 text-sm focus-visible:ring-accent"
                    disabled={isCheckingOut}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="sh-state">State *</Label>
                  <Input
                    id="sh-state"
                    required
                    placeholder="TX"
                    value={shipping.state}
                    onChange={setShippingField("state")}
                    className="h-9 text-sm focus-visible:ring-accent"
                    disabled={isCheckingOut}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="sh-zip">ZIP *</Label>
                  <Input
                    id="sh-zip"
                    required
                    placeholder="78701"
                    value={shipping.zip}
                    onChange={setShippingField("zip")}
                    className="h-9 text-sm focus-visible:ring-accent"
                    disabled={isCheckingOut}
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="sh-country">Country *</Label>
                <Input
                  id="sh-country"
                  required
                  placeholder="US"
                  value={shipping.country}
                  onChange={setShippingField("country")}
                  className="h-9 text-sm focus-visible:ring-accent"
                  disabled={isCheckingOut}
                />
              </div>
            </div>

            {checkoutError && (
              <div className="rounded-md bg-destructive/10 border border-destructive/20 px-3 py-2.5">
                <p className="text-sm text-destructive">{checkoutError}</p>
              </div>
            )}

            <div className="flex gap-3 pt-1">
              <Button
                type="button"
                variant="outline"
                onClick={() => setShowCheckout(false)}
                disabled={isCheckingOut}
                className="flex-1"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={isCheckingOut}
                className="flex-1"
                style={{
                  backgroundColor: "hsl(var(--accent))",
                  color: "hsl(var(--accent-foreground))",
                }}
              >
                {isCheckingOut ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Redirecting…
                  </>
                ) : (
                  <>
                    <CreditCard className="mr-2 h-4 w-4" />
                    Pay {formatCurrency(isMultiMode ? combinedTotal : (displayQuote?.costBreakdown.total ?? 0))} Securely
                  </>
                )}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function AutomotiveQuoteWizard() {
  return (
    <Suspense fallback={null}>
      <AutomotiveQuoteWizardInner />
    </Suspense>
  );
}
