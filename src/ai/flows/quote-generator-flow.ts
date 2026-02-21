'use server';
/**
 * @fileOverview An AI-powered 3D print quote generator.
 * - quoteGenerator - A function that analyzes a 3D model's metrics and provides a price quote.
 * - QuoteGeneratorInput - The input type for the quoteGenerator function.
 * - QuoteOutput - The return type for the quoteGenerator function.
 */

import {ai} from '@/ai/genkit';
import {z} from 'zod';
import pricingMatrix from '@/app/data/pricing-matrix.json';
import { MeshMetrics } from '@/lib/mesh-analyzer';

// --- Zod Schemas for Type Safety ---

// Schema for the mesh metrics from the analyzer
const MeshMetricsSchema = z.object({
  format: z.enum(['stl', 'obj', '3mf', 'amf']),
  units: z.string(),
  triangles: z.number(),
  bbox_mm: z.object({ x: z.number(), y: z.number(), z: z.number() }),
  surface_area_mm2: z.number(),
  volume_mm3: z.number(),
  watertight_est: z.boolean(),
  notes: z.array(z.string()),
  file_bytes: z.number(),
  parse_ms: z.number(),
});

// Schema for the input required by the main function
const QuoteGeneratorInputSchema = z.object({
  metrics: MeshMetricsSchema,
  material: z.string().describe('The filament material to be used (e.g., PLA, PETG, ASA).'),
  nozzleSize: z.string().describe('The diameter of the printer nozzle in mm (e.g., "0.4", "0.6").'),
  autoPrinterSelection: z.boolean().describe("Whether to auto-select the most cost-effective printer."),
  selectedPrinterKey: z.string().optional().describe("The printer key selected by the user if auto-selection is off.")
});
export type QuoteGeneratorInput = z.infer<typeof QuoteGeneratorInputSchema>;


// Schema for the AI model's direct output (estimation part)
const EstimationOutputSchema = z.object({
  printTimeHours: z.number().describe('The estimated time to print the object in hours.'),
  materialGrams: z.number().describe('The estimated material needed in grams.'),
});
export type EstimationOutput = z.infer<typeof EstimationOutputSchema>;

// Schema for the final, calculated quote returned to the client
const QuoteOutputSchema = z.object({
  mode: z.string(),
  jobScale: z.string(),
  selectedPrinterKey: z.string(),
  selectedNozzle: z.string(),
  selectedFilament: z.string(),
  bbox_mm: z.object({ x: z.number(), y: z.number(), z: z.number() }),
  volume_cm3: z.number(),
  segmentCountEstimate: z.number(),
  bedCyclesEstimate: z.number(),
  estimatedHours: z.number(),
  leadTimeDays: z.object({ min: z.number(), max: z.number() }),
  costBreakdown: z.object({
    machine: z.number(),
    material: z.number(),
    segmentation: z.number(),
    shippingEmbedded: z.number(),
    risk: z.number(),
    total: z.number(),
  }),
  warnings: z.array(z.string()),
});
export type QuoteOutput = z.infer<typeof QuoteOutputSchema>;


// --- Main Exported Quote Generator Function ---

export async function quoteGenerator(input: QuoteGeneratorInput): Promise<QuoteOutput> {
  // 1. Get AI estimation for time and material (this remains the first crucial step)
  const estimation = await estimationFlow(input);

  // 2. Initial setup and validation from input and pricing matrix
  const warnings: string[] = [];
  const { metrics, material, nozzleSize, autoPrinterSelection, selectedPrinterKey: userSelectedPrinter } = input;
  const maxDim = Math.max(metrics.bbox_mm.x, metrics.bbox_mm.y, metrics.bbox_mm.z);

  // 3. Determine if segmentation is required and find all printers that can handle the material
  const printersSupportingFilament = Object.entries(pricingMatrix.printers).filter(([_, printer]) => 
    printer.supportedFilaments.includes(material)
  ).map(([key, _]) => key);

  if (printersSupportingFilament.length === 0) {
    throw new Error(`No available printer supports the selected material: ${material}.`);
  }

  const eligiblePrintersUnsegmented = printersSupportingFilament.filter(key => {
    const printer = pricingMatrix.printers[key as keyof typeof pricingMatrix.printers];
    return (
      printer.buildVolume_mm.x >= metrics.bbox_mm.x &&
      printer.buildVolume_mm.y >= metrics.bbox_mm.y &&
      printer.buildVolume_mm.z >= metrics.bbox_mm.z
    );
  });
  
  const segmentationRequired = eligiblePrintersUnsegmented.length === 0;
  
  // 4. Determine Job Scale based on size, time, and segmentation
  const { jobScaleRules } = pricingMatrix;
  let jobScale: "Small Part" | "Medium Part" | "Large Assembly";
  if (segmentationRequired || estimation.printTimeHours >= jobScaleRules.largeAssembly.minHours) {
    jobScale = "Large Assembly";
  } else if (maxDim <= jobScaleRules.smallPart.maxDim_mm && estimation.printTimeHours < jobScaleRules.smallPart.maxHours) {
    jobScale = "Small Part";
  } else {
    jobScale = "Medium Part"; // Default for everything in between
  }

  // 5. Determine Mode & Calculate Costs based on Job Scale
  let mode: "Hourly" | "Bed-Cycle";
  let costBreakdown;
  let segmentCountEstimate = 1;
  let bedCyclesEstimate = 0;
  let selectedPrinterKey: string;
  let leadTimeDays;

  if (jobScale === "Large Assembly") {
    mode = "Bed-Cycle";
    warnings.push("Large assembly detected: bed-cycle mode enforced.");
    if(segmentationRequired) warnings.push("Model exceeds build volume: segmentation required.");

    // Select the best printer for segmentation (prefer largest build volume)
    const segmentationPrinterKeys = printersSupportingFilament.sort((a, b) => {
        const printerA = pricingMatrix.printers[a as keyof typeof pricingMatrix.printers];
        const printerB = pricingMatrix.printers[b as keyof typeof pricingMatrix.printers];
        return (printerB.buildVolume_mm.x * printerB.buildVolume_mm.y) - (printerA.buildVolume_mm.x * printerA.buildVolume_mm.y);
    });
    selectedPrinterKey = segmentationPrinterKeys[0];
    let selectedPrinter = pricingMatrix.printers[selectedPrinterKey as keyof typeof pricingMatrix.printers];

    // Estimate segments and bed cycles
    if (segmentationRequired) {
      const sx = Math.ceil(metrics.bbox_mm.x / (selectedPrinter.buildVolume_mm.x * pricingMatrix.segmentation.efficiency));
      const sy = Math.ceil(metrics.bbox_mm.y / (selectedPrinter.buildVolume_mm.y * pricingMatrix.segmentation.efficiency));
      const sz = Math.ceil(metrics.bbox_mm.z / (selectedPrinter.buildVolume_mm.z * pricingMatrix.segmentation.efficiency));
      segmentCountEstimate = Math.max(1, sx * sy * sz);
    }
    bedCyclesEstimate = segmentCountEstimate; // Assumption: 1 segment per bed cycle

    // Failsafe: Check if Bambu is suitable for this many segments
    if (selectedPrinterKey === 'bambu_h2s' && segmentCountEstimate > pricingMatrix.segmentation.maxAutoSegments.bambu_h2s) {
        warnings.push("High segment count for Bambu printer. Forcing selection of a large-format printer.");
        const largeFormatPrinters = segmentationPrinterKeys.filter(p => p !== 'bambu_h2s');
        if (largeFormatPrinters.length === 0) {
          throw new Error("No large format printer available for this high-segment-count job.");
        }
        selectedPrinterKey = largeFormatPrinters[0];
        selectedPrinter = pricingMatrix.printers[selectedPrinterKey as keyof typeof pricingMatrix.printers];
    }
    
    // Calculate costs for Bed-Cycle mode
    const bedCycleRate = selectedPrinter.bedCycleRates_withShippingEmbedded[nozzleSize as keyof typeof selectedPrinter.bedCycleRates_withShippingEmbedded];
    const machineCost = bedCyclesEstimate * bedCycleRate;
    
    const filamentDetails = pricingMatrix.filaments[material as keyof typeof pricingMatrix.filaments];
    const materialCost = estimation.materialGrams * filamentDetails.sellPricePerGram;

    const segmentationCost = segmentCountEstimate * pricingMatrix.segmentation.seamsPerSegmentDefault * pricingMatrix.segmentation.bondingLaborPerSeam;

    const subTotalForRisk = machineCost + materialCost + segmentationCost;
    const riskCost = subTotalForRisk * segmentCountEstimate * pricingMatrix.segmentation.riskMultiplierPerSegment;
    
    let totalCost = subTotalForRisk + riskCost;
    
    if (estimation.printTimeHours > pricingMatrix.multipliers.longJob.thresholdHours) {
        totalCost *= pricingMatrix.multipliers.longJob.multiplier;
        warnings.push("Long job multiplier applied due to extended print time.");
    }
    
    const shippingEmbedded = bedCyclesEstimate * selectedPrinter.bedCycleHours * pricingMatrix.meta.shippingEmbedded.embeddedPerHour;
    
    costBreakdown = { machine: machineCost, material: materialCost, segmentation: segmentationCost, shippingEmbedded, risk: riskCost, total: totalCost };

    // Calculate lead time for large assemblies
    const totalFleetCount = Object.values(pricingMatrix.printer_fleet).reduce((sum, p) => sum + p.count, 0);
    const daysRaw = Math.ceil(bedCyclesEstimate / (totalFleetCount * pricingMatrix.leadTime.utilizationFactor));
    leadTimeDays = {
      min: Math.max(daysRaw, pricingMatrix.leadTime.minDays),
      max: Math.min(daysRaw + Math.ceil(daysRaw * 0.5), pricingMatrix.leadTime.maxDaysCap)
    };

  } else { // Small or Medium Part (Hourly Mode)
    mode = "Hourly";
    
    // Determine the printer to use
    if (userSelectedPrinter && !autoPrinterSelection) {
        if (eligiblePrintersUnsegmented.includes(userSelectedPrinter)) {
            selectedPrinterKey = userSelectedPrinter;
        } else {
            warnings.push(`Your selected printer cannot fit this part. Auto-selecting a suitable printer.`);
            autoPrinterSelection = true; // Force auto-selection
        }
    }
    
    if (!userSelectedPrinter || autoPrinterSelection) {
        // Auto-select cheapest eligible printer
        eligiblePrintersUnsegmented.sort((a, b) => {
            const printerA = pricingMatrix.printers[a as keyof typeof pricingMatrix.printers];
            const printerB = pricingMatrix.printers[b as keyof typeof pricingMatrix.printers];
            const rateA = printerA.hourlyRates_withShippingEmbedded[nozzleSize as keyof typeof printerA.hourlyRates_withShippingEmbedded];
            const rateB = printerB.hourlyRates_withShippingEmbedded[nozzleSize as keyof typeof printerB.hourlyRates_withShippingEmbedded];
            return rateA - rateB;
        });
        selectedPrinterKey = eligiblePrintersUnsegmented[0];
    }

    if (!selectedPrinterKey) {
        throw new Error(`Could not find an eligible printer for material ${material} and part size.`);
    }
    
    // Calculate costs for Hourly mode
    const printer = pricingMatrix.printers[selectedPrinterKey as keyof typeof pricingMatrix.printers];
    const hourlyRate = printer.hourlyRates_withShippingEmbedded[nozzleSize as keyof typeof printer.hourlyRates_withShippingEmbedded];
    
    const machineCost = estimation.printTimeHours * hourlyRate;
    const materialCost = estimation.materialGrams * pricingMatrix.filaments[material as keyof typeof pricingMatrix.filaments].sellPricePerGram;
    let totalCost = machineCost + materialCost;

    // Apply complexity multiplier based on triangle count
    const {triangleCountThresholds, multipliers} = pricingMatrix.multipliers.complexity;
    let complexityMultiplier = multipliers.low;
    if (metrics.triangles > triangleCountThresholds.high) {
        complexityMultiplier = multipliers.high;
        warnings.push("Complexity high: manual review recommended.");
    } else if (metrics.triangles > triangleCountThresholds.medium) {
        complexityMultiplier = multipliers.medium;
    }
    totalCost *= complexityMultiplier;

    const shippingEmbedded = estimation.printTimeHours * pricingMatrix.meta.shippingEmbedded.embeddedPerHour;
    const riskCost = totalCost - (machineCost + materialCost); // Risk/contingency is the amount from the complexity markup
    
    costBreakdown = { machine: machineCost, material: materialCost, segmentation: 0, shippingEmbedded, risk: riskCost, total: totalCost };

    // Simple lead time for smaller jobs
    const daysRaw = Math.ceil(estimation.printTimeHours / 12); // Rough estimate: 12h of printing per day
    leadTimeDays = {
      min: Math.max(daysRaw, pricingMatrix.leadTime.minDays),
      max: Math.min(daysRaw + 2, pricingMatrix.leadTime.maxDaysCap)
    };
  }
  
  // Add common warnings
  if (!metrics.watertight_est) {
      warnings.push("Non-watertight mesh may affect volume/time estimates and print quality.");
  }
  
  // Return the final structured quote
  return {
      mode,
      jobScale,
      selectedPrinterKey,
      selectedNozzle: nozzleSize,
      selectedFilament: material,
      bbox_mm: metrics.bbox_mm,
      volume_cm3: metrics.volume_mm3 / 1000,
      segmentCountEstimate,
      bedCyclesEstimate,
      estimatedHours: estimation.printTimeHours,
      leadTimeDays,
      costBreakdown,
      warnings,
  };
}


// --- Genkit Flow for AI Estimation ---

// Genkit prompt that asks the AI for estimations based on metrics
const estimationPrompt = ai.definePrompt({
  name: '3dPrintEstimatorPrompt',
  input: {schema: z.object({
    metrics: MeshMetricsSchema,
    material: z.string(),
    nozzleSize: z.string()
  })},
  output: {schema: EstimationOutputSchema},
  prompt: `You are an expert 3D printing technician. Your task is to analyze a 3D model's metrics and provide accurate estimations for print time and material consumption.

Analyze the provided metrics. Consider standard print settings for the given material '{{{material}}}' and nozzle size '{{{nozzleSize}}}'.

Model Metrics:
- Format: {{metrics.format}} (units: {{metrics.units}})
- Bounding Box (mm): {{metrics.bbox_mm.x}} x {{metrics.bbox_mm.y}} x {{metrics.bbox_mm.z}}
- Volume (mm³): {{metrics.volume_mm3}}
- Surface Area (mm²): {{metrics.surface_area_mm2}}
- Triangle Count: {{metrics.triangles}}
- Watertight (Est): {{metrics.watertight_est}}
- Parser Notes: {{#each metrics.notes}}{{{this}}}{{/each}}

Based on your analysis of these metrics, estimate:
1.  The total print time in hours.
2.  The total material required in grams.

Respond with ONLY a valid JSON object containing 'printTimeHours' and 'materialGrams' keys.`,
});

// Genkit flow that wraps the AI call
const estimationFlow = ai.defineFlow(
  {
    name: 'estimationFlow',
    inputSchema: QuoteGeneratorInputSchema,
    outputSchema: EstimationOutputSchema,
  },
  async (input) => {
    const { output } = await estimationPrompt(input, { model: 'googleai/gemini-2.5-flash-lite' });
    if (!output) {
      throw new Error('The AI model failed to provide an estimation. Please try again later.');
    }
    return output;
  }
);
