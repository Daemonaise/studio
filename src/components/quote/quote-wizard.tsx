"use client";

import { useState } from "react";
import Image from "next/image";
import { ArrowLeft, Check, FileUp, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { materials } from "@/app/data/materials";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { PlaceHolderImages } from "@/lib/placeholder-images";
import { cn } from "@/lib/utils";

const steps = [
  { id: 1, name: "Upload Model" },
  { id: 2, name: "Configure Part" },
  { id: 3, name: "Review & Submit" },
];

type FormData = {
  file?: File;
  material?: string;
  infill: number;
  quantity: number;
};

const modelPreviewImage = PlaceHolderImages.find(p => p.id === 'model-preview');

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
                    <span className="ml-4 hidden text-primary md:block">{step.name}</span>
                  </>
                ) : (
                  <>
                    <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full border-2 border-border">
                      <span className="text-muted-foreground">{step.id}</span>
                    </span>
                    <span className="ml-4 hidden text-muted-foreground md:block">{step.name}</span>
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


function Step1Upload({ onFileSelect, file }: { onFileSelect: (file: File) => void; file?: File }) {
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      onFileSelect(e.target.files[0]);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Upload your 3D Model</CardTitle>
        <CardDescription>Accepted formats: STL, OBJ, 3MF. Max size: 100MB.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col items-center justify-center gap-6 text-center">
        <div className="relative flex flex-col items-center justify-center w-full h-64 border-2 border-dashed rounded-lg">
          {file ? (
            <>
              {modelPreviewImage && (
                <Image src={modelPreviewImage.imageUrl} alt="Model preview" width={200} height={150} data-ai-hint={modelPreviewImage.imageHint} />
              )}
              <p className="mt-4 font-medium">{file.name}</p>
            </>
          ) : (
            <>
              <FileUp className="h-12 w-12 text-muted-foreground" />
              <p className="mt-4 text-muted-foreground">Drag & drop your file here, or click to browse.</p>
            </>
          )}
          <Input type="file" className="absolute inset-0 z-10 opacity-0 cursor-pointer" onChange={handleFileChange} />
        </div>
      </CardContent>
    </Card>
  );
}

function Step2Configure({ formData, setFormData }: { formData: FormData; setFormData: (data: Partial<FormData>) => void }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Configure Your Part</CardTitle>
        <CardDescription>Select material, infill, and other manufacturing parameters.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-8">
        <div className="grid gap-2">
          <Label>Material</Label>
          <Select onValueChange={(value) => setFormData({ material: value })} defaultValue={formData.material}>
            <SelectTrigger>
              <SelectValue placeholder="Select a material" />
            </SelectTrigger>
            <SelectContent>
              {materials.map(material => (
                <SelectItem key={material.id} value={material.id}>{material.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-sm text-muted-foreground">
            Need help choosing? Use our <a href="/assistant" target="_blank" className="underline">AI Assistant</a>.
          </p>
        </div>
        <div className="grid gap-4">
          <Label>Infill Density: {formData.infill}%</Label>
          <Slider
            defaultValue={[formData.infill]}
            max={100}
            step={10}
            onValueChange={(value) => setFormData({ infill: value[0] })}
          />
           <p className="text-sm text-muted-foreground">Higher infill increases strength and cost.</p>
        </div>
        <div className="grid gap-2">
          <Label>Quantity</Label>
          <Input type="number" min="1" value={formData.quantity} onChange={e => setFormData({ quantity: parseInt(e.target.value) || 1 })} />
        </div>
      </CardContent>
    </Card>
  );
}

function Step3Review({ formData, isSubmitting }: { formData: FormData; isSubmitting: boolean }) {
    const material = materials.find(m => m.id === formData.material);

    const costs = {
        material: 34.50 * formData.quantity,
        machineTime: 52.10 * formData.quantity,
        reinforcement: (formData.infill / 100) * 20 * formData.quantity,
        handling: 5.00,
        shipping: 12.00,
    }
    const total = Object.values(costs).reduce((sum, cost) => sum + cost, 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Review & Submit</CardTitle>
        <CardDescription>Please review your quote request before submitting.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-4 rounded-md border p-4">
            <h3 className="font-semibold">Part Details</h3>
            <div className="grid grid-cols-2 gap-4 text-sm">
                <div><span className="text-muted-foreground">File:</span> {formData.file?.name}</div>
                <div><span className="text-muted-foreground">Material:</span> {material?.name}</div>
                <div><span className="text-muted-foreground">Infill:</span> {formData.infill}%</div>
                <div><span className="text-muted-foreground">Quantity:</span> {formData.quantity}</div>
            </div>
        </div>
        <div className="space-y-4 rounded-md border p-4">
            <h3 className="font-semibold">Estimated Cost & Lead Time</h3>
            <div className="space-y-2 text-sm font-mono">
                {Object.entries(costs).map(([key, value]) => (
                     <div key={key} className="flex justify-between">
                         <span className="capitalize text-muted-foreground">{key.replace(/([A-Z])/g, ' $1').trim()}:</span>
                         <span>${value.toFixed(2)}</span>
                     </div>
                ))}
                <div className="flex justify-between font-bold border-t pt-2">
                    <span>Total:</span>
                    <span>${total.toFixed(2)}</span>
                </div>
            </div>
             <p className="text-sm text-center text-muted-foreground pt-4">Estimated Lead Time: 5-7 business days</p>
        </div>
        {isSubmitting && (
            <div className="flex items-center justify-center gap-2 text-muted-foreground">
                <Loader2 className="animate-spin h-5 w-5"/>
                <p>Submitting your quote request...</p>
            </div>
        )}
      </CardContent>
    </Card>
  );
}

export function QuoteWizard() {
  const [step, setStep] = useState(1);
  const [formData, setFormDataState] = useState<FormData>({
    infill: 20,
    quantity: 1,
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);

  const updateFormData = (data: Partial<FormData>) => {
    setFormDataState((prev) => ({ ...prev, ...data }));
  };

  const nextStep = () => setStep((s) => Math.min(s + 1, steps.length));
  const prevStep = () => setStep((s) => Math.max(s - 1, 1));
  
  const canGoNext = () => {
    if (step === 1) return !!formData.file;
    if (step === 2) return !!formData.material;
    return true;
  }

  const handleSubmit = () => {
    setIsSubmitting(true);
    setTimeout(() => {
        setIsSubmitting(false);
        setIsSubmitted(true);
    }, 2000);
  }

  if (isSubmitted) {
      return (
          <Card className="max-w-2xl mx-auto text-center">
              <CardHeader>
                  <CardTitle className="text-2xl">Quote Request Submitted!</CardTitle>
                  <CardDescription>Thank you. We have received your request and will get back to you within 24 hours.</CardDescription>
              </CardHeader>
              <CardContent>
                  <p>Your reference number is <span className="font-bold font-mono">KHI-00129</span>.</p>
                  <div className="mt-6">
                    <Button asChild>
                        <a href="/orders">View My Orders</a>
                    </Button>
                  </div>
              </CardContent>
          </Card>
      )
  }

  return (
    <div className="pb-24">
      <div className="max-w-2xl mx-auto mb-8">
        <StepIndicator currentStep={step} />
      </div>

      <div className="max-w-2xl mx-auto">
        {step === 1 && <Step1Upload onFileSelect={(file) => updateFormData({ file })} file={formData.file} />}
        {step === 2 && <Step2Configure formData={formData} setFormData={updateFormData} />}
        {step === 3 && <Step3Review formData={formData} isSubmitting={isSubmitting} />}
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
          <div>
            {step < steps.length ? (
              <Button onClick={nextStep} disabled={!canGoNext()}>
                Next Step
              </Button>
            ) : (
              <Button style={{ backgroundColor: "hsl(var(--accent))", color: "hsl(var(--accent-foreground))" }} onClick={handleSubmit} disabled={isSubmitting}>
                Submit Quote Request
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
