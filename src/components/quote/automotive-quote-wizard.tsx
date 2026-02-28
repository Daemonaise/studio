
"use client";

import { useState, useRef, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Upload, Loader2, Wand2, Info, Clock, AlertTriangle, CheckCircle2, CreditCard, MapPin, Phone, Mail, User, Building2, X } from "lucide-react";
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

function AutomotiveQuoteWizardInner() {
  const searchParams = useSearchParams();
  const materialParam = searchParams.get("material");
  const validMaterialIds = materials.map((m) => m.id);
  const initialMaterial =
    materialParam && validMaterialIds.includes(materialParam) ? materialParam : "PLA";

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

    const acceptedExts = ["stl", "obj", "3mf", "amf"];
    const ext = selectedFile.name.split(".").pop()?.toLowerCase() ?? "";
    if (!acceptedExts.includes(ext)) {
      setError(`Invalid file type. Accepted formats: ${acceptedExts.join(", ").toUpperCase()}`);
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

  const setShippingField = (field: keyof ShippingInfo) =>
    (e: React.ChangeEvent<HTMLInputElement>) =>
      setShipping((prev) => ({ ...prev, [field]: e.target.value }));

  const handleCheckout = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!quote) return;

    setIsCheckingOut(true);
    setCheckoutError(null);

    try {
      const result = await createCheckoutSession(
        {
          totalCost: quote.costBreakdown.total,
          material: quote.selectedFilament,
          jobScale: quote.jobScale,
          mode: quote.mode,
          leadTimeMin: quote.leadTimeDays.min,
          leadTimeMax: quote.leadTimeDays.max,
          estimatedHours: quote.estimatedHours,
          selectedPrinterKey: quote.selectedPrinterKey,
          fileName: file?.name || "3D Model",
        },
        shipping
      );

      if (result.error || !result.url) {
        setCheckoutError(result.error || "Failed to create checkout session.");
        setIsCheckingOut(false);
        return;
      }

      // Redirect to Stripe Checkout
      window.location.href = result.url;
    } catch (err: any) {
      setCheckoutError(err.message || "Checkout failed. Please try again.");
      setIsCheckingOut(false);
    }
  };

  const nozzleSizes = pricingMatrix.nozzles.available_mm.map(String);
  const availableMaterials = materials.map((m) => m.id);

  return (
    <>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* ── Configure card ─────────────────────────────── */}
        <div className="group relative transform-gpu rounded-lg transition-transform duration-300 ease-in-out will-change-transform hover:scale-[1.02]">
          <div className="absolute -inset-0.5 rounded-lg bg-gradient-to-br from-primary/70 via-accent/70 to-secondary/70 opacity-20 blur-xl transition-opacity duration-300 group-hover:opacity-100" />
          <Card className="relative h-full flex flex-col teal-frame">
            <CardHeader>
              <CardTitle>1. Configure Your Print</CardTitle>
              <CardDescription>
                Upload your model and select your desired print settings.
              </CardDescription>
            </CardHeader>

            <CardContent className="space-y-6 flex-grow">
              {/* File upload zone */}
              <div className="space-y-2">
                <Label>3D Model (STL, OBJ, 3MF, AMF)</Label>
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
                        <p className="font-medium text-foreground text-sm">
                          {file.name}
                        </p>
                        <p className="text-xs mt-0.5">
                          {(file.size / 1024).toFixed(0)} KB · Click to replace
                        </p>
                      </>
                    ) : (
                      <>
                        <Upload className="h-8 w-8 mx-auto mb-2" />
                        <p className="font-medium text-sm">
                          Drag & drop or click to browse
                        </p>
                        <p className="text-xs mt-0.5 opacity-70">
                          STL · OBJ · 3MF · AMF
                        </p>
                      </>
                    )}
                  </div>
                  <Input
                    ref={fileInputRef}
                    id="file-upload"
                    type="file"
                    accept=".stl,.obj,.3mf,.amf"
                    className="hidden"
                    onChange={handleFileChange}
                    disabled={isLoading}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="material">Material</Label>
                  <Select
                    value={material}
                    onValueChange={setMaterial}
                    disabled={isLoading}
                  >
                    <SelectTrigger id="material">
                      <SelectValue placeholder="Select material" />
                    </SelectTrigger>
                    <SelectContent>
                      {availableMaterials.map((mat) => (
                        <SelectItem key={mat} value={mat}>
                          {mat}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="nozzle">Nozzle Size</Label>
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
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-4">
                <div className="flex items-center space-x-2">
                  <Switch
                    id="auto-printer"
                    checked={autoPrinterSelection}
                    onCheckedChange={setAutoPrinterSelection}
                    disabled={isLoading}
                  />
                  <Label htmlFor="auto-printer">
                    Auto-select most cost-effective printer
                  </Label>
                </div>
                {!autoPrinterSelection && (
                  <div className="space-y-2">
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
                      Note: An eligible printer will be chosen if your selection
                      cannot fit the part.
                    </p>
                  </div>
                )}
              </div>
            </CardContent>

            <CardFooter>
              <Button
                onClick={handleGenerateQuote}
                disabled={isLoading || !file}
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
                    Analyzing & Quoting…
                  </>
                ) : (
                  <>
                    <Wand2 className="mr-2 h-5 w-5" />
                    Generate AI Quote
                  </>
                )}
              </Button>
            </CardFooter>
          </Card>
        </div>

        {/* ── Quote result card ──────────────────────────── */}
        <div className="group relative transform-gpu rounded-lg transition-transform duration-300 ease-in-out will-change-transform hover:scale-[1.02]">
          <div className="absolute -inset-0.5 rounded-lg bg-gradient-to-br from-primary/70 via-accent/70 to-secondary/70 opacity-20 blur-xl transition-opacity duration-300 group-hover:opacity-100" />
          <Card className="relative h-full flex flex-col teal-frame">
            <CardHeader>
              <CardTitle>2. Instant Quote</CardTitle>
              <CardDescription>
                Your estimated cost will appear here.
              </CardDescription>
            </CardHeader>

            <CardContent className="flex-grow flex flex-col">
              {/* Loading */}
              {isLoading && (
                <div className="flex flex-col items-center justify-center text-center text-muted-foreground space-y-4 h-full">
                  <div className="relative">
                    <div className="absolute inset-0 rounded-full bg-accent/20 blur-lg scale-150" />
                    <Loader2 className="relative h-10 w-10 animate-spin text-accent" />
                  </div>
                  <p className="font-medium">AI is analyzing your model…</p>
                  <p className="text-sm">
                    This may take a moment for complex models.
                  </p>
                </div>
              )}

              {/* Error */}
              {error && (
                <div className="flex flex-col items-center justify-center text-center text-destructive space-y-4 h-full bg-destructive/10 rounded-lg p-4">
                  <Info className="h-10 w-10" />
                  <p className="font-medium">Error Generating Quote</p>
                  <p className="text-sm">{error}</p>
                </div>
              )}

              {/* Empty state */}
              {!isLoading && !quote && !error && (
                <div className="flex flex-col items-center justify-center text-center text-muted-foreground space-y-3 h-full">
                  <div className="rounded-full border border-accent/20 bg-accent/5 p-4">
                    <Wand2 className="h-8 w-8 text-accent/50" />
                  </div>
                  <p className="font-medium">Your quote is just a click away.</p>
                  <p className="text-sm">
                    Upload a model and hit <em>Generate AI Quote</em>.
                  </p>
                </div>
              )}

              {/* Quote result */}
              {quote && (
                <div className="space-y-4">
                  {/* Status badges */}
                  <div className="flex flex-wrap gap-2">
                    <Badge
                      variant="outline"
                      className="border-accent/50 text-accent bg-accent/5"
                    >
                      {quote.jobScale}
                    </Badge>
                    <Badge variant="outline">{quote.mode}</Badge>
                    {formatSegmentationTier(quote.segmentationTier) && (
                      <Badge
                        variant="outline"
                        className="border-amber-500/60 text-amber-500 bg-amber-500/5"
                      >
                        {formatSegmentationTier(quote.segmentationTier)}
                      </Badge>
                    )}
                  </div>

                  {/* Total price hero */}
                  <div className="rounded-lg bg-gradient-to-br from-accent/10 via-accent/5 to-transparent border border-accent/30 p-5 text-center">
                    <p className="text-xs font-semibold uppercase tracking-widest text-accent/70 mb-1">
                      Total Estimated Cost
                    </p>
                    <p className="text-5xl font-bold tracking-tight text-accent">
                      {formatCurrency(quote.costBreakdown.total)}
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
                      {quote.leadTimeDays.min}–{quote.leadTimeDays.max} business
                      days
                    </span>
                  </div>

                  {/* Cost breakdown */}
                  <div className="rounded-lg border overflow-hidden">
                    <div className="px-4 py-2 bg-muted/40 border-b">
                      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Cost Breakdown
                      </p>
                    </div>
                    <div className="divide-y">
                      <LineItem
                        label="Machine / Print Time"
                        value={quote.costBreakdown.machine}
                      />
                      {quote.costBreakdown.segmentation > 0 && (
                        <LineItem
                          label="Segmentation Labor"
                          value={quote.costBreakdown.segmentation}
                        />
                      )}
                      {quote.costBreakdown.risk > 0 && (
                        <LineItem
                          label="Risk / Contingency"
                          value={quote.costBreakdown.risk}
                        />
                      )}
                      <LineItem
                        label={`Material (${quote.selectedFilament})`}
                        value={quote.costBreakdown.material}
                      />
                      <LineItem
                        label="Shipping & Handling"
                        value={
                          quote.costBreakdown.shippingEmbedded +
                          quote.costBreakdown.handling
                        }
                      />
                      <div className="flex items-center justify-between px-4 py-3 bg-accent/5">
                        <span className="text-sm font-semibold">Total</span>
                        <span className="font-bold text-accent text-base">
                          {formatCurrency(quote.costBreakdown.total)}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Part specs */}
                  <div className="grid grid-cols-2 gap-2">
                    <SpecItem
                      label="Dimensions"
                      value={`${quote.bbox_mm.x.toFixed(0)} × ${quote.bbox_mm.y.toFixed(0)} × ${quote.bbox_mm.z.toFixed(0)} mm`}
                    />
                    <SpecItem
                      label="Volume"
                      value={`${quote.volume_cm3.toFixed(1)} cm³`}
                    />
                    <SpecItem
                      label="Est. Print Time"
                      value={`${quote.estimatedHours.toFixed(1)} hrs`}
                    />
                    <SpecItem
                      label="Printer"
                      value={
                        (pricingMatrix.printers as any)[quote.selectedPrinterKey]
                          ?.label ?? quote.selectedPrinterKey
                      }
                    />
                    <SpecItem label="Nozzle" value={`${quote.selectedNozzle} mm`} />
                    {quote.segmentCountEstimate > 1 && (
                      <SpecItem
                        label="Segments"
                        value={`${quote.segmentCountEstimate}`}
                      />
                    )}
                  </div>

                  {/* Warnings */}
                  {quote.warnings.length > 0 && (
                    <div className="rounded-lg bg-amber-500/10 border border-amber-500/30 p-4">
                      <h4 className="text-xs font-semibold uppercase tracking-wider text-amber-600 dark:text-amber-400 mb-2 flex items-center gap-1.5">
                        <AlertTriangle className="h-3.5 w-3.5" />
                        Notes &amp; Warnings
                      </h4>
                      <ul className="text-xs text-amber-700 dark:text-amber-400 space-y-1">
                        {quote.warnings.map((warning, i) => (
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

            {quote && (
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
                  Proceed to Checkout
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
          {quote && (
            <div className="rounded-lg bg-accent/5 border border-accent/20 px-4 py-3 flex items-center justify-between text-sm">
              <span className="text-muted-foreground">
                {quote.selectedFilament} · {quote.jobScale}
              </span>
              <span className="font-bold text-accent text-base">
                {formatCurrency(quote.costBreakdown.total)}
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
                    Pay{" "}
                    {quote ? formatCurrency(quote.costBreakdown.total) : ""} Securely
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
