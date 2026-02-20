
"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import Image from "next/image";
import { ArrowLeft, Check, FileUp, Loader2, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
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
import { Textarea } from "@/components/ui/textarea";
import { PlaceHolderImages } from "@/lib/placeholder-images";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

const steps = [
  { id: 1, name: "Scope" },
  { id: 2, name: "Upload" },
  { id: 3, name: "Engineering" },
  { id: 4, name: "Finish & Logistics" },
  { id: 5, name: "Review & Submit" },
];

type FormData = {
  package?: string;
  scope?: string;
  files?: File[];
  noFiles?: boolean;
  designHelp?: {
    vehicleType: string;
    wheelbase: string;
    cockpitWidth: string;
    intendedUse: string;
    targetWeight: string;
    reinforcementPlan: string;
  };
  engineering?: {
    segmentStrategy: string;
    alignmentFeatures: string;
    bondingMethod: string;
    seamAllowance: string;
    material: string;
    nozzleSize: string;
    layerHeight: string;
    walls: string;
    infill: string;
    ribbing: string;
  };
  reinforcementPlan?: string;
  finish?: string;
  logistics?: {
    shipping: string;
    packaging: string;
    zip: string;
    leadTime: string;
  };
};

const modelPreviewImage = PlaceHolderImages.find(
  (p) => p.id === "model-preview"
);

function Disclaimer({
  text,
  show,
}: {
  text: string;
  show: boolean;
}) {
  if (!show) return null;
  return (
    <div className="flex items-start gap-2 rounded-lg border border-amber-500/50 bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-400">
      <Info className="h-5 w-5 flex-shrink-0" />
      <p>{text}</p>
    </div>
  );
}

function StepIndicator({ currentStep }: { currentStep: number }) {
  return (
    <nav aria-label="Progress">
      <ol role="list" className="flex items-center">
        {steps.map((step, stepIdx) => (
          <li
            key={step.name}
            className={cn("relative", { "flex-1": stepIdx !== steps.length - 1 })}
          >
            <div className="flex items-center">
              <div className="flex items-center text-sm font-medium">
                {step.id < currentStep ? (
                  <>
                    <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
                      <Check className="h-6 w-6" />
                    </span>
                    <span className="ml-4 hidden md:block">{step.name}</span>
                  </>
                ) : step.id === currentStep ? (
                  <>
                    <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full border-2 border-primary">
                      <span className="text-primary">{step.id}</span>
                    </span>
                    <span className="ml-4 hidden text-primary md:block">
                      {step.name}
                    </span>
                  </>
                ) : (
                  <>
                    <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full border-2 border-border">
                      <span className="text-muted-foreground">{step.id}</span>
                    </span>
                    <span className="ml-4 hidden text-muted-foreground md:block">
                      {step.name}
                    </span>
                  </>
                )}
              </div>
              {stepIdx !== steps.length - 1 && (
                <div className="absolute right-0 top-1/2 -z-10 h-0.5 w-full -translate-y-1/2 bg-gray-200" />
              )}
            </div>
          </li>
        ))}
      </ol>
    </nav>
  );
}

function Step1Scope({
  formData,
  setFormData,
}: {
  formData: FormData;
  setFormData: (data: Partial<FormData>) => void;
}) {
  const scopes = [
    "Body only",
    "Monocoque only",
    "Body + monocoque",
    "Panels only (doors/hood/fenders)",
    "Aero kit (splitter/wing/diffuser)",
  ];
  return (
    <Card>
      <CardHeader>
        <CardTitle>Choose Scope</CardTitle>
        <CardDescription>
          What part of the vehicle are you building?
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Select
          onValueChange={(value) => setFormData({ scope: value })}
          defaultValue={formData.scope}
        >
          <SelectTrigger>
            <SelectValue placeholder="Select project scope" />
          </SelectTrigger>
          <SelectContent>
            {scopes.map((s) => (
              <SelectItem key={s} value={s}>
                {s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </CardContent>
    </Card>
  );
}

function Step2Upload({
  formData,
  setFormData,
}: {
  formData: FormData;
  setFormData: (data: Partial<FormData>) => void;
}) {
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      setFormData({ files: Array.from(e.target.files) });
    }
  };

  const handleDesignHelpChange = (
    field: keyof NonNullable<FormData["designHelp"]>,
    value: string
  ) => {
    setFormData({
      designHelp: { ...formData.designHelp!, [field]: value },
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Upload Your Files</CardTitle>
        <CardDescription>
          Upload your STL, OBJ, or 3MF files. You can also upload a ZIP archive.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="relative flex flex-col items-center justify-center w-full h-64 border-2 border-dashed rounded-lg">
          {formData.files && formData.files.length > 0 ? (
            <div className="text-center">
              {modelPreviewImage && (
                <Image
                  src={modelPreviewImage.imageUrl}
                  alt="Model preview"
                  width={150}
                  height={112}
                  data-ai-hint={modelPreviewImage.imageHint}
                />
              )}
              <p className="mt-4 font-medium">
                {formData.files.length} file(s) selected
              </p>
              <ul className="text-sm text-muted-foreground">
                {formData.files.map((f) => (
                  <li key={f.name}>{f.name}</li>
                ))}
              </ul>
            </div>
          ) : (
            <div className="text-center text-muted-foreground">
              <FileUp className="h-12 w-12 mx-auto" />
              <p className="mt-4">
                Drag & drop your file here, or click to browse.
              </p>
            </div>
          )}
          <Input
            type="file"
            multiple
            className="absolute inset-0 z-10 opacity-0 cursor-pointer"
            onChange={handleFileChange}
            disabled={formData.noFiles}
          />
        </div>
        <div className="relative flex items-center">
          <div className="flex-grow border-t border-gray-300"></div>
          <span className="flex-shrink mx-4 text-gray-500">OR</span>
          <div className="flex-grow border-t border-gray-300"></div>
        </div>
        <div>
          <label className="flex items-center gap-2">
            <Input
              type="checkbox"
              className="h-4 w-4"
              checked={formData.noFiles}
              onChange={(e) => {
                setFormData({ noFiles: e.target.checked, files: [] });
                if (e.target.checked && !formData.designHelp) {
                  setFormData({
                    designHelp: {
                      vehicleType: "",
                      wheelbase: "",
                      cockpitWidth: "",
                      intendedUse: "",
                      targetWeight: "",
                      reinforcementPlan: "",
                    },
                  });
                }
              }}
            />
            <span>I don't have files yet and need design help.</span>
          </label>
        </div>
        {formData.noFiles && (
          <Card className="bg-secondary/50">
            <CardHeader>
              <CardTitle>Design Help Intake Form</CardTitle>
              <CardDescription>
                Please provide as much detail as possible.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label>Vehicle Type</Label>
                <Input
                  placeholder="e.g., Sports car, UTV, etc."
                  value={formData.designHelp?.vehicleType}
                  onChange={(e) =>
                    handleDesignHelpChange("vehicleType", e.target.value)
                  }
                />
              </div>
              <div className="grid gap-2">
                <Label>Target Wheelbase</Label>
                <Input
                  placeholder="e.g., 100 inches"
                  value={formData.designHelp?.wheelbase}
                  onChange={(e) =>
                    handleDesignHelpChange("wheelbase", e.target.value)
                  }
                />
              </div>
              <div className="grid gap-2">
                <Label>Target Cockpit Width</Label>
                <Input
                  placeholder="e.g., 50 inches"
                  value={formData.designHelp?.cockpitWidth}
                  onChange={(e) =>
                    handleDesignHelpChange("cockpitWidth", e.target.value)
                  }
                />
              </div>
              <div className="grid gap-2">
                <Label>Intended Use</Label>
                <Input
                  placeholder="e.g., Track, street, show"
                  value={formData.designHelp?.intendedUse}
                  onChange={(e) =>
                    handleDesignHelpChange("intendedUse", e.target.value)
                  }
                />
              </div>
              <div className="grid gap-2">
                <Label>Target Weight</Label>
                <Input
                  placeholder="e.g., 200 lbs"
                  value={formData.designHelp?.targetWeight}
                  onChange={(e) =>
                    handleDesignHelpChange("targetWeight", e.target.value)
                  }
                />
              </div>
              <div className="grid gap-2">
                <Label>Reinforcement Plan</Label>
                <Input
                  placeholder="e.g., Fiberglass, carbon fiber"
                  value={formData.designHelp?.reinforcementPlan}
                  onChange={(e) =>
                    handleDesignHelpChange("reinforcementPlan", e.target.value)
                  }
                />
              </div>
            </CardContent>
          </Card>
        )}
      </CardContent>
    </Card>
  );
}

function Step3Engineering({
  formData,
  setFormData,
}: {
  formData: FormData;
  setFormData: (data: Partial<FormData>) => void;
}) {
  const handleEngineeringChange = (
    field: keyof NonNullable<FormData["engineering"]>,
    value: string
  ) => {
    setFormData({
      engineering: { ...formData.engineering!, [field]: value },
    });
  };

  const isMonocoque =
    formData.scope?.includes("Monocoque") ||
    formData.scope?.includes("monocoque");

  return (
    <Card>
      <CardHeader>
        <CardTitle>Engineering Options</CardTitle>
        <CardDescription>
          Define the build strategy and structural settings for your parts.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <fieldset className="grid md:grid-cols-2 gap-6 border p-4 rounded-lg">
          <legend className="px-2 font-semibold text-sm">
            Geometry & Build Strategy
          </legend>
          <div className="grid gap-2">
            <Label>Segment Strategy</Label>
            <Select
              onValueChange={(v) => handleEngineeringChange("segmentStrategy", v)}
              defaultValue={formData.engineering?.segmentStrategy}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select strategy" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="standard">Standard</SelectItem>
                <SelectItem value="fewer-seams">Fewer seams</SelectItem>
                <SelectItem value="transport-friendly">
                  Transport-friendly
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label>Alignment Features</Label>
            <Select
              onValueChange={(v) =>
                handleEngineeringChange("alignmentFeatures", v)
              }
              defaultValue={formData.engineering?.alignmentFeatures}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select features" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="pins">Pins + sockets</SelectItem>
                <SelectItem value="dovetails">Dovetails</SelectItem>
                <SelectItem value="both">Both</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label>Bonding Method</Label>
            <Select
              onValueChange={(v) => handleEngineeringChange("bondingMethod", v)}
              defaultValue={formData.engineering?.bondingMethod}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select method" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="adhesive">Structural adhesive</SelectItem>
                <SelectItem value="weld">Plastic weld</SelectItem>
                <SelectItem value="hybrid">Hybrid</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label>Seam Allowance</Label>
            <Select
              onValueChange={(v) => handleEngineeringChange("seamAllowance", v)}
              defaultValue={formData.engineering?.seamAllowance}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select allowance" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="minimal">Minimal</SelectItem>
                <SelectItem value="standard">Standard</SelectItem>
                <SelectItem value="extra">Extra for sanding</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </fieldset>

        <fieldset className="grid md:grid-cols-2 lg:grid-cols-3 gap-6 border p-4 rounded-lg">
          <legend className="px-2 font-semibold text-sm">
            Material & Structural Settings
          </legend>
          <div className="grid gap-2">
            <Label>Material</Label>
            <Select
              onValueChange={(v) => handleEngineeringChange("material", v)}
              defaultValue={formData.engineering?.material}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select material" />
              </SelectTrigger>
              <SelectContent>
                {[
                  "PLA",
                  "PETG",
                  "ASA",
                  "Nylon (PA)",
                  "PLA-CF",
                  "PETG-CF",
                  "Nylon-CF",
                  "ASA-CF",
                ].map((m) => (
                  <SelectItem key={m} value={m}>
                    {m}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
           <div className="grid gap-2">
            <Label>Nozzle Size</Label>
            <Select onValueChange={v => handleEngineeringChange('nozzleSize', v)} defaultValue={formData.engineering?.nozzleSize}>
              <SelectTrigger><SelectValue placeholder="Select size" /></SelectTrigger>
              <SelectContent>
                {["0.4", "0.6", "0.8"].map(s => <SelectItem key={s} value={s}>{s} mm</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label>Layer Height</Label>
            <Select onValueChange={v => handleEngineeringChange('layerHeight', v)} defaultValue={formData.engineering?.layerHeight}>
              <SelectTrigger><SelectValue placeholder="Select height" /></SelectTrigger>
              <SelectContent>
                {["0.16", "0.20", "0.28"].map(s => <SelectItem key={s} value={s}>{s} mm</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label>Walls</Label>
            <Select onValueChange={v => handleEngineeringChange('walls', v)} defaultValue={formData.engineering?.walls}>
              <SelectTrigger><SelectValue placeholder="Select wall count" /></SelectTrigger>
              <SelectContent>
                {["2", "3", "4", "5"].map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label>Infill</Label>
            <Select onValueChange={v => handleEngineeringChange('infill', v)} defaultValue={formData.engineering?.infill}>
              <SelectTrigger><SelectValue placeholder="Select infill %" /></SelectTrigger>
              <SelectContent>
                {["10", "15", "20", "30", "40", "60"].map(s => <SelectItem key={s} value={s}>{s}%</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label>Ribbing Option</Label>
            <Select onValueChange={v => handleEngineeringChange('ribbing', v)} defaultValue={formData.engineering?.ribbing}>
              <SelectTrigger><SelectValue placeholder="Select ribbing" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None</SelectItem>
                <SelectItem value="light">Light</SelectItem>
                <SelectItem value="aggressive">Aggressive</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </fieldset>
         <fieldset className="grid md:grid-cols-1 gap-6 border p-4 rounded-lg">
          <legend className="px-2 font-semibold text-sm">Reinforcement</legend>
            <div className="grid gap-2">
              <Label>Reinforcement Plan {isMonocoque && <span className="text-destructive">*</span>}</Label>
              <Select onValueChange={(v) => setFormData({ reinforcementPlan: v })} defaultValue={formData.reinforcementPlan}>
                <SelectTrigger>
                  <SelectValue placeholder="Select reinforcement plan" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  <SelectItem value="fiberglass">Fiberglass overlay</SelectItem>
                  <SelectItem value="carbon">Carbon fiber overlay</SelectItem>
                  <SelectItem value="carbon-core">Carbon + core (foam/honeycomb)</SelectItem>
                </SelectContent>
              </Select>
              <Disclaimer
                text="Warning: No reinforcement selected. This is not recommended for structural parts."
                show={formData.reinforcementPlan === 'none'}
              />
               <Disclaimer
                text="Reinforcement (fiberglass or carbon fiber) is required for rigidity and durability."
                show={isMonocoque && formData.reinforcementPlan !== 'none'}
              />
            </div>
        </fieldset>
      </CardContent>
    </Card>
  );
}

function Step4FinishLogistics({
  formData,
  setFormData,
}: {
  formData: FormData;
  setFormData: (data: Partial<FormData>) => void;
}) {

  const handleLogisticsChange = (
    field: keyof NonNullable<FormData["logistics"]>,
    value: string
  ) => {
    setFormData({
      logistics: { ...formData.logistics!, [field]: value },
    });
  };

  return (
     <Card>
      <CardHeader>
        <CardTitle>Finish & Logistics</CardTitle>
        <CardDescription>
          Choose the final finish for your parts and how you want to receive them.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <fieldset className="grid md:grid-cols-1 gap-6 border p-4 rounded-lg">
          <legend className="px-2 font-semibold text-sm">Finish</legend>
           <div className="grid gap-2">
              <Label>Part Finish</Label>
              <Select onValueChange={(v) => setFormData({ finish: v })} defaultValue={formData.finish}>
                <SelectTrigger>
                  <SelectValue placeholder="Select finish level" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="raw">Raw print</SelectItem>
                  <SelectItem value="sanded">Sanded seams</SelectItem>
                  <SelectItem value="primed">Filler + prime-ready</SelectItem>
                  <SelectItem value="show">Show-ready (manual review)</SelectItem>
                </SelectContent>
              </Select>
              {formData.finish === 'show' && (
                <div className="text-sm text-primary flex items-center gap-2 mt-2">
                  <span className="font-semibold py-1 px-2.5 rounded-full bg-primary/10 text-primary text-xs">Manual Review Required</span>
                </div>
              )}
            </div>
        </fieldset>

        <fieldset className="grid md:grid-cols-2 lg:grid-cols-3 gap-6 border p-4 rounded-lg">
          <legend className="px-2 font-semibold text-sm">Logistics</legend>
           <div className="grid gap-2">
            <Label>Shipping</Label>
            <Select onValueChange={v => handleLogisticsChange('shipping', v)} defaultValue={formData.logistics?.shipping}>
              <SelectTrigger><SelectValue placeholder="Select shipping" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="freight">Freight</SelectItem>
                <SelectItem value="ground">Ground</SelectItem>
                <SelectItem value="pickup">Pickup</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label>Packaging</Label>
            <Select onValueChange={v => handleLogisticsChange('packaging', v)} defaultValue={formData.logistics?.packaging}>
              <SelectTrigger><SelectValue placeholder="Select packaging" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="standard">Standard</SelectItem>
                <SelectItem value="crate">Reinforced crate</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label>Zip/Postal Code</Label>
            <Input placeholder="For shipping estimate" value={formData.logistics?.zip} onChange={e => handleLogisticsChange('zip', e.target.value)} />
          </div>
          <div className="grid gap-2 md:col-span-2 lg:col-span-1">
            <Label>Lead Time Preference</Label>
            <Select onValueChange={v => handleLogisticsChange('leadTime', v)} defaultValue={formData.logistics?.leadTime}>
              <SelectTrigger><SelectValue placeholder="Select preference" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="standard">Standard</SelectItem>
                <SelectItem value="rush">Rush</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </fieldset>
        <Disclaimer
            text="Final fitment depends on assembly, bonding, reinforcement, and finishing processes."
            show={true}
          />
      </CardContent>
    </Card>
  )
}

function Step5Review({
  formData,
  isSubmitting,
}: {
  formData: FormData;
  isSubmitting: boolean;
}) {
  const isManualReview = formData.finish === 'show' || (formData.reinforcementPlan === 'carbon-core');

  const costs = {
    material: 1250.0,
    machineTime: 2100.0,
    handling: 150.0,
    segmentationAssembly: formData.package === 'digital-file' ? 0 : 800.0,
    packaging: 250.0,
    shipping: 400.0,
  };
  const total = Object.values(costs).reduce((sum, cost) => sum + cost, 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Review & Submit</CardTitle>
        <CardDescription>
          Please review your quote request before submitting.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-4 rounded-md border p-4">
          <h3 className="font-semibold">Configuration Summary</h3>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
            <div>
              <span className="text-muted-foreground">Scope:</span> {formData.scope}
            </div>
            <div>
              <span className="text-muted-foreground">Files:</span>{" "}
              {formData.noFiles
                ? "Design help requested"
                : `${formData.files?.length || 0} file(s)`}
            </div>
            <div>
              <span className="text-muted-foreground">Material:</span>{" "}
              {formData.engineering?.material}
            </div>
             <div>
              <span className="text-muted-foreground">Finish:</span>{" "}
              {formData.finish}
            </div>
             <div>
              <span className="text-muted-foreground">Reinforcement:</span>{" "}
              {formData.reinforcementPlan}
            </div>
            <div>
              <span className="text-muted-foreground">Shipping:</span>{" "}
              {formData.logistics?.shipping}
            </div>
          </div>
        </div>
        <Card className="bg-secondary/50 relative">
           <CardHeader>
            <CardTitle>Estimated Cost & Lead Time</CardTitle>
           </CardHeader>
           <CardContent>
            {isManualReview && (
              <div className="absolute inset-0 bg-background/80 flex items-center justify-center rounded-lg">
                  <div className="text-center p-4">
                     <p className="font-bold text-lg">Manual Review Required</p>
                     <p className="text-sm text-muted-foreground">Your selection requires a manual review for an accurate quote. Please submit your request.</p>
                  </div>
              </div>
            )}
            <div className="space-y-2 text-sm font-mono">
              {Object.entries(costs).map(([key, value]) => (
                <div key={key} className="flex justify-between">
                  <span className="capitalize text-muted-foreground">
                    {key.replace(/([A-Z])/g, " $1").trim()}:
                  </span>
                  <span>${value.toFixed(2)}</span>
                </div>
              ))}
              <div className="flex justify-between font-bold border-t pt-2">
                <span>Total:</span>
                <span>${total.toFixed(2)}</span>
              </div>
            </div>
            <p className="text-sm text-center text-muted-foreground pt-4">
              Estimated Lead Time: 2-3 weeks
            </p>
           </CardContent>
        </Card>
        {isSubmitting && (
          <div className="flex items-center justify-center gap-2 text-muted-foreground">
            <Loader2 className="animate-spin h-5 w-5" />
            <p>Submitting your quote request...</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function AutomotiveQuoteWizard() {
  const searchParams = useSearchParams();
  const [step, setStep] = useState(1);
  const [formData, setFormDataState] = useState<FormData>({
    package: searchParams.get("package") || undefined,
    engineering: {
      segmentStrategy: "standard",
      alignmentFeatures: "pins",
      bondingMethod: "adhesive",
      seamAllowance: "standard",
      material: "PETG",
      nozzleSize: "0.6",
      layerHeight: "0.20",
      walls: "3",
      infill: "15",
      ribbing: "none",
    },
    logistics: {
      shipping: 'freight',
      packaging: 'standard',
      zip: '',
      leadTime: 'standard'
    }
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);

  const updateFormData = (data: Partial<FormData>) => {
    setFormDataState((prev) => ({ ...prev, ...data }));
  };

  const nextStep = () => setStep((s) => Math.min(s + 1, steps.length));
  const prevStep = () => setStep((s) => Math.max(s - 1, 1));

  const canGoNext = () => {
    if (step === 1) return !!formData.scope;
    if (step === 2) return (formData.files && formData.files.length > 0) || formData.noFiles;
    if (step === 3) return !!formData.engineering?.material && !!formData.reinforcementPlan;
    if (step === 4) return !!formData.finish && !!formData.logistics?.zip;
    return true;
  };

  const handleSubmit = () => {
    setIsSubmitting(true);
    setTimeout(() => {
      setIsSubmitting(false);
      setIsSubmitted(true);
    }, 2000);
  };
  
  if (isSubmitted) {
    return (
      <Card className="max-w-2xl mx-auto text-center">
        <CardHeader>
          <CardTitle className="text-2xl">Quote Request Submitted!</CardTitle>
          <CardDescription>
            Thank you. We have received your request and will get back to you
            within 24 hours.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p>
            Your reference number is{" "}
            <span className="font-bold font-mono">KHI-00129</span>.
          </p>
          <div className="mt-6">
            <Button asChild>
              <a href="/orders">View My Orders</a>
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <TooltipProvider>
      <div className="pb-24">
        <div className="max-w-4xl mx-auto mb-8">
          <StepIndicator currentStep={step} />
        </div>

        <div className="max-w-4xl mx-auto">
          {step === 1 && (
            <Step1Scope formData={formData} setFormData={updateFormData} />
          )}
          {step === 2 && (
            <Step2Upload formData={formData} setFormData={updateFormData} />
          )}
          {step === 3 && (
            <Step3Engineering formData={formData} setFormData={updateFormData} />
          )}
          {step === 4 && (
            <Step4FinishLogistics formData={formData} setFormData={updateFormData} />
          )}
          {step === 5 && <Step5Review formData={formData} isSubmitting={isSubmitting} />}
        </div>
      </div>
      <div className="fixed bottom-0 left-0 w-full border-t bg-background">
        <div className="container flex items-center justify-between h-20">
          <div>
            {step > 1 && (
              <Button variant="ghost" onClick={prevStep} disabled={isSubmitting}>
                <ArrowLeft className="mr-2 h-4 w-4" />
                Previous
              </Button>
            )}
          </div>
          <div className="flex items-center gap-4">
             {/* Persistent estimate would go here */}
            {step < steps.length ? (
              <Button onClick={nextStep} disabled={!canGoNext()}>
                Next Step
              </Button>
            ) : (
              <div className="flex gap-2">
                 <Button
                    style={{
                      backgroundColor: "hsl(var(--accent))",
                      color: "hsl(var(--accent-foreground))",
                    }}
                    onClick={handleSubmit}
                    disabled={isSubmitting}
                  >
                    Submit Quote
                  </Button>
                  <Button variant="outline" onClick={() => alert("Paying deposit...")} disabled={isSubmitting}>Pay Deposit</Button>
              </div>

            )}
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
}
