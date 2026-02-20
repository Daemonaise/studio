
"use client";

import { useState } from "react";
import { Upload, Loader2, Wand2, Info } from "lucide-react";
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
import { quoteGenerator, QuoteOutput, QuoteGeneratorInput } from "@/ai/flows/quote-generator-flow";
import { materials } from "@/app/data/materials";

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


export function AutomotiveQuoteWizard() {
  const [file, setFile] = useState<File | null>(null);
  const [material, setMaterial] = useState<string>("PLA");
  const [nozzleSize, setNozzleSize] = useState<string>("0.4");
  
  const [quote, setQuote] = useState<QuoteOutput | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0]);
      setQuote(null); // Reset quote on new file
      setError(null);
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
      const input: QuoteGeneratorInput = {
        fileDataUri,
        material,
        nozzleSize,
      };
      const result = await quoteGenerator(input);
      setQuote(result);
    } catch (e) {
      console.error(e);
      setError("An error occurred while generating the quote. The AI model may be busy, please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const nozzleSizes = ["0.2", "0.4", "0.6", "0.8"];
  const availableMaterials = materials.map(m => m.id);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">
      <Card>
        <CardHeader>
          <CardTitle>1. Configure Your Print</CardTitle>
          <CardDescription>Upload your model and select your desired print settings.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="file-upload">3D Model (STL, OBJ, 3MF)</Label>
            <div className="relative flex items-center justify-center w-full h-48 border-2 border-dashed rounded-lg">
              <div className="text-center text-muted-foreground p-4">
                <Upload className="h-10 w-10 mx-auto mb-2" />
                {file ? (
                  <p className="font-medium text-foreground">{file.name}</p>
                ) : (
                  <p>Drag & drop, or click to browse</p>
                )}
              </div>
              <Input
                id="file-upload"
                type="file"
                accept=".stl,.obj,.3mf"
                className="absolute inset-0 z-10 opacity-0 cursor-pointer"
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

        </CardContent>
        <CardFooter>
          <Button
            onClick={handleGenerateQuote}
            disabled={isLoading || !file}
            className="w-full"
            size="lg"
          >
            {isLoading ? (
              <>
                <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                Analyzing Model...
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
      
      <Card className="sticky top-24">
        <CardHeader>
          <CardTitle>2. Instant Quote</CardTitle>
          <CardDescription>Your estimated cost will appear here after analysis.</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading && (
             <div className="flex flex-col items-center justify-center text-center text-muted-foreground space-y-4 h-64">
                <Loader2 className="h-10 w-10 animate-spin text-primary" />
                <p className="font-medium">AI is analyzing your 3D model...</p>
                <p className="text-sm">This may take a moment depending on model complexity.</p>
              </div>
          )}
          {error && (
            <div className="flex flex-col items-center justify-center text-center text-destructive space-y-4 h-64 bg-destructive/10 rounded-lg p-4">
              <Info className="h-10 w-10" />
              <p className="font-medium">Error Generating Quote</p>
              <p className="text-sm">{error}</p>
            </div>
          )}
          {!isLoading && !quote && !error && (
             <div className="flex flex-col items-center justify-center text-center text-muted-foreground space-y-2 h-64">
                <p>Your quote is just a click away.</p>
              </div>
          )}
          {quote && (
            <div className="space-y-4">
              <div className="bg-secondary/50 rounded-lg p-4 text-center">
                <Label className="text-sm font-normal text-muted-foreground">Total Estimated Cost</Label>
                <p className="text-4xl font-bold tracking-tight text-primary">
                  {formatCurrency(quote.totalCost)}
                </p>
              </div>
              
              <div className="space-y-2 text-sm font-mono border-t pt-4">
                <h4 className="text-sm font-sans font-semibold text-foreground mb-2">Cost Breakdown</h4>
                 <div className="flex justify-between">
                  <span className="text-muted-foreground">Machine Time ({quote.printTimeHours.toFixed(1)} hrs):</span>
                  <span>{formatCurrency(quote.machineTimeCost)}</span>
                </div>
                 <div className="flex justify-between">
                  <span className="text-muted-foreground">Material ({quote.materialGrams.toFixed(0)}g):</span>
                  <span>{formatCurrency(quote.materialCost)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Freight Shipping:</span>
                  <span>{formatCurrency(quote.shippingCost)}</span>
                </div>
              </div>

              {quote.warnings.length > 0 && (
                <div className="border-t pt-4">
                    <h4 className="text-sm font-sans font-semibold text-amber-600 mb-2">Warnings</h4>
                    <ul className="text-sm text-amber-600 list-disc list-inside space-y-1">
                      {quote.warnings.map((warning, i) => (
                        <li key={i}>{warning}</li>
                      ))}
                    </ul>
                </div>
              )}
               <Button className="w-full" size="lg" disabled>Proceed to Checkout</Button>
               <p className="text-xs text-center text-muted-foreground">Checkout functionality is coming soon.</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
