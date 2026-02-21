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
  segmentationTier: z.string(),
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

type SegTier = "none" | "moderate" | "heavy";


// --- Main Exported Quote Generator Function ---

export async function quoteGenerator(input: QuoteGeneratorInput): Promise<QuoteOutput> {
  const { metrics, material, nozzleSize, autoPrinterSelection: initialAutoSelection, selectedPrinterKey: userSelectedPrinter } = input;
  const warnings: string[] = [];

  // 1. Get AI estimation for time and material. This is our baseline.
  const estimation = await estimationFlow(input);
  const estimatedHours = estimation.printTimeHours;

  // 2. Unit Sanity Check & Bbox Scaling
  if (pricingMatrix.unitSanity.enabled) {
    let maxDim = Math.max(metrics.bbox_mm.x, metrics.bbox_mm.y, metrics.bbox_mm.z);
    for (const rule of pricingMatrix.unitSanity.scaleRules) {
        if (maxDim > rule.ifMaxDimGreaterThan) {
            metrics.bbox_mm.x /= rule.scaleDivisor;
            metrics.bbox_mm.y /= rule.scaleDivisor;
            metrics.bbox_mm.z /= rule.scaleDivisor;
            warnings.push(`Unit scale adjusted (likely ${rule.label})`);
            break; // Apply only the first matching rule
        }
    }
  }
  
  const bboxAfterScaling = metrics.bbox_mm;
  const maxDimAfterScaling = Math.max(bboxAfterScaling.x, bboxAfterScaling.y, bboxAfterScaling.z);


  // 3. Determine Printer Compatibility & Selection
  let autoPrinterSelection = initialAutoSelection;
  let selectedPrinterKey: string | undefined = undefined;

  // NEW: Determine compatible printers based on material requirements
  const filamentReqs = pricingMatrix.filaments[material as keyof typeof pricingMatrix.filaments]?.requirements;
  if (!filamentReqs) {
      throw new Error(`Filament requirements not found for ${material}. The selected material may not be configured for this system.`);
  }

  const compatiblePrinters = Object.entries(pricingMatrix.printers).filter(([key, printer]) => {
      const caps = (printer as any).capabilities;
      if (!caps) { 
          warnings.push(`Printer ${(printer as any).label} is missing capabilities data and was excluded.`);
          return false;
      }
      if (caps.maxNozzleC < filamentReqs.minNozzleC) return false;
      if (caps.maxBedC < filamentReqs.minBedC) return false;
      if (filamentReqs.requiresEnclosure && !caps.hasEnclosure) return false;
      if (filamentReqs.requiresHeatedChamber && !caps.hasHeatedChamber) return false;
      if (filamentReqs.requiresChamberTempC > 0 && caps.heatedChamberC < filamentReqs.requiresChamberTempC) return false;
      if (filamentReqs.requiresHardenedNozzle && !caps.hasHardenedNozzle) return false;
      return true;
  });

  if (compatiblePrinters.length === 0) {
      throw new Error(`No available printer is compatible with the requirements for ${material}.`);
  }

  // Honor user's choice if possible
  if (!autoPrinterSelection && userSelectedPrinter) {
    if (compatiblePrinters.some(([key]) => key === userSelectedPrinter)) {
      selectedPrinterKey = userSelectedPrinter;
    } else {
      warnings.push(`Your selected printer doesn't support ${material} or its requirements. Auto-selecting a suitable printer.`);
      autoPrinterSelection = true;
    }
  }

  // Auto-select printer if no valid user choice
  if (autoPrinterSelection) {
    const eligiblePrintersUnsegmented = compatiblePrinters.filter(([_, printer]) => 
      (printer as any).buildVolume_mm.x >= bboxAfterScaling.x &&
      (printer as any).buildVolume_mm.y >= bboxAfterScaling.y &&
      (printer as any).buildVolume_mm.z >= bboxAfterScaling.z
    );

    if (eligiblePrintersUnsegmented.length > 0) {
      eligiblePrintersUnsegmented.sort((a, b) => {
        const printerA = a[1] as any;
        const printerB = b[1] as any;
        const rateA = printerA.hourlyRates_withShippingEmbedded[nozzleSize as keyof typeof printerA.hourlyRates_withShippingEmbedded] || Infinity;
        const rateB = printerB.hourlyRates_withShippingEmbedded[nozzleSize as keyof typeof printerB.hourlyRates_withShippingEmbedded] || Infinity;
        return rateA - rateB;
      });
      selectedPrinterKey = eligiblePrintersUnsegmented[0][0];
    } else {
      // If all require segmentation, pick the one with the largest build volume
      compatiblePrinters.sort((a, b) => {
        const volA = (a[1] as any).buildVolume_mm.x * (a[1] as any).buildVolume_mm.y;
        const volB = (b[1] as any).buildVolume_mm.x * (b[1] as any).buildVolume_mm.y;
        return volB - volA;
      });
      selectedPrinterKey = compatiblePrinters[0][0];
    }
  }
  
  if (!selectedPrinterKey) {
    throw new Error('Could not determine a suitable printer for the job.');
  }

  const selectedPrinter = pricingMatrix.printers[selectedPrinterKey as keyof typeof pricingMatrix.printers] as any;
  
  // 4. Determine if segmentation is required for the *selected* printer
  const segmentationRequired = !(
    selectedPrinter.buildVolume_mm.x >= bboxAfterScaling.x &&
    selectedPrinter.buildVolume_mm.y >= bboxAfterScaling.y &&
    selectedPrinter.buildVolume_mm.z >= bboxAfterScaling.z
  );

  // 5. Determine Job Scale & Mode
  const { jobScaleRules } = pricingMatrix;
  
  let jobScale: "Small Part" | "Medium Part" | "Large Assembly";
  let mode: "Hourly" | "Bed-Cycle Mode";

  if (segmentationRequired || maxDimAfterScaling > 380 || estimatedHours >= jobScaleRules.largeAssembly.minHours) {
    jobScale = "Large Assembly";
    mode = "Bed-Cycle Mode";
  } else if (maxDimAfterScaling <= jobScaleRules.smallPart.maxDim_mm && estimatedHours < jobScaleRules.smallPart.maxHours) {
    jobScale = "Small Part";
    mode = "Hourly";
  } else {
    jobScale = "Medium Part";
    mode = "Hourly";
  }
  
  // 6. Calculate Costs, Segments, and Tiers
  let machineCost = 0;
  let segmentationCost = 0;
  let riskCost = 0;
  let segmentCountEstimate = 1;
  let bedCyclesEstimate = 0;
  let finalEstimatedHours = estimatedHours;
  let segmentationTier: SegTier = 'none';

  if (mode === "Bed-Cycle Mode") {
    warnings.push("Large assembly detected: bed-cycle mode enforced.");
    if (segmentationRequired) {
      warnings.push("Model exceeds build volume: segmentation required.");
      const sx = Math.ceil(bboxAfterScaling.x / (selectedPrinter.buildVolume_mm.x * pricingMatrix.segmentation.efficiency));
      const sy = Math.ceil(bboxAfterScaling.y / (selectedPrinter.buildVolume_mm.y * pricingMatrix.segmentation.efficiency));
      const sz = Math.ceil(bboxAfterScaling.z / (selectedPrinter.buildVolume_mm.z * pricingMatrix.segmentation.efficiency * 0.6));
      segmentCountEstimate = Math.max(2, sx * sy * Math.max(1, sz));
    }
    bedCyclesEstimate = segmentCountEstimate;
    finalEstimatedHours = bedCyclesEstimate * selectedPrinter.bedCycleHours;

    // Check against max segments for the printer
    const maxSegments = pricingMatrix.segmentation.maxAutoSegments[selectedPrinterKey as keyof typeof pricingMatrix.segmentation.maxAutoSegments] || 999;
    if (segmentCountEstimate > maxSegments) {
        warnings.push(`High segment count (${segmentCountEstimate}) for ${selectedPrinter.label}. Manual review may be required.`);
    }
    
    // Determine segmentation tier
    if (segmentCountEstimate > 12) segmentationTier = 'heavy';
    else if (segmentCountEstimate > 1) segmentationTier = 'moderate';
    else segmentationTier = 'none';
    
    if (segmentationTier === 'heavy') warnings.push("Heavy segmentation: increased seam count and extended lead time.");


    // Calculate costs for Bed-Cycle mode
    const bedCycleRate = selectedPrinter.bedCycleRates_withShippingEmbedded[nozzleSize as keyof typeof selectedPrinter.bedCycleRates_withShippingEmbedded];
    machineCost = bedCyclesEstimate * bedCycleRate;
    
    segmentationCost = segmentCountEstimate * pricingMatrix.segmentation.seamsPerSegmentDefault * pricingMatrix.segmentation.bondingLaborPerSeam;
    
    // Capped Risk Model
    const baseCostForRisk = machineCost + segmentationCost;
    const { baseRiskPercent, tierBump, capPercentOfBase, minRisk } = pricingMatrix.riskModel;
    const riskPercent = baseRiskPercent + (tierBump as any)[segmentationTier];
    const maxRisk = baseCostForRisk * capPercentOfBase;
    const rawRisk = baseCostForRisk * riskPercent;
    riskCost = Math.max(minRisk, Math.min(rawRisk, maxRisk));

  } else { // Hourly Mode
    bedCyclesEstimate = 0;
    segmentationTier = 'none';
    const hourlyRate = selectedPrinter.hourlyRates_withShippingEmbedded[nozzleSize as keyof typeof selectedPrinter.hourlyRates_withShippingEmbedded];
    machineCost = finalEstimatedHours * hourlyRate;
    segmentationCost = 0;
    riskCost = 0; // No risk cost in hourly mode as per original logic
  }

  // 7. Calculate Material Cost (common for both modes)
  const materialCost = estimation.materialGrams * (pricingMatrix.filaments[material as keyof typeof pricingMatrix.filaments] as any).sellPricePerGram;

  // 8. Apply Multipliers
  let subtotalForMultipliers = machineCost + segmentationCost + riskCost;
  
  // Apply segmentation tier multiplier
  const segTierMultiplier = (pricingMatrix.segmentation.segmentationModeMultipliers as any)[segmentationTier];
  subtotalForMultipliers *= segTierMultiplier;

  // Apply complexity multiplier
  let complexityMultiplier = pricingMatrix.multipliers.complexity.multipliers.low;
  if (metrics.triangles > pricingMatrix.multipliers.complexity.triangleCountThresholds.high) {
      complexityMultiplier = pricingMatrix.multipliers.complexity.multipliers.high;
      warnings.push("Complexity high: manual review recommended.");
  } else if (metrics.triangles > pricingMatrix.multipliers.complexity.triangleCountThresholds.medium) {
      complexityMultiplier = pricingMatrix.multipliers.complexity.multipliers.medium;
  }
  subtotalForMultipliers *= complexityMultiplier;
  
  // Apply long job multiplier
  if (finalEstimatedHours > pricingMatrix.multipliers.longJob.thresholdHours) {
      subtotalForMultipliers *= pricingMatrix.multipliers.longJob.multiplier;
      warnings.push("Long job multiplier applied due to extended print time.");
  }

  const totalCost = subtotalForMultipliers + materialCost;

  // 9. Calculate Lead Time
  let eligibleFleetCount = 0;
  if (mode === "Bed-Cycle Mode") {
      if (!autoPrinterSelection) {
          eligibleFleetCount = (pricingMatrix.printer_fleet[selectedPrinterKey as keyof typeof pricingMatrix.printer_fleet] as any)?.count || 1;
      } else {
          // Sum counts of all compatible printers
          compatiblePrinters.forEach(([key, _]) => {
              eligibleFleetCount += (pricingMatrix.printer_fleet[key as keyof typeof pricingMatrix.printer_fleet] as any)?.count || 0;
          });
      }
  }
  const cyclesPerDay = Math.max(1, eligibleFleetCount * pricingMatrix.leadTime.utilizationFactor);
  const baseDays = mode === "Bed-Cycle Mode" 
      ? Math.ceil(bedCyclesEstimate / cyclesPerDay)
      : Math.ceil(finalEstimatedHours / 12); // Simple heuristic for hourly

  const segmentationAddDays = (pricingMatrix.leadTime.segmentationExtraDays as any)[segmentationTier] || 0;
  
  const minLead = Math.max(pricingMatrix.leadTime.minDays, baseDays + segmentationAddDays);
  const maxLead = Math.ceil(minLead * 1.4);

  const leadTimeDays = {
      min: Math.min(minLead, pricingMatrix.leadTime.maxDaysCap),
      max: Math.min(maxLead, pricingMatrix.leadTime.maxDaysCap),
  };
  
  // 10. Add common warnings & Finalize
  if (!metrics.watertight_est) {
      warnings.push("Non-watertight mesh may affect volume/time estimates and print quality.");
  }

  return {
      mode,
      jobScale,
      selectedPrinterKey,
      selectedNozzle: nozzleSize,
      selectedFilament: material,
      bbox_mm: bboxAfterScaling,
      volume_cm3: metrics.volume_mm3 / 1000,
      segmentCountEstimate,
      bedCyclesEstimate,
      estimatedHours: finalEstimatedHours,
      segmentationTier,
      leadTimeDays,
      costBreakdown: {
        machine: machineCost,
        material: materialCost,
        segmentation: segmentationCost,
        risk: riskCost,
        shippingEmbedded: finalEstimatedHours * pricingMatrix.meta.shippingEmbedded.embeddedPerHour,
        total: totalCost,
      },
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
  prompt: `You are an expert 3D printing technician providing initial estimates. The system will use your estimates to perform detailed cost calculations based on a set of strict business rules. Use the following rules to guide your estimation for print time and material usage.

Analyze the provided metrics. Consider standard print settings for the given material '{{{material}}}' and nozzle size '{{{nozzleSize}}}'.

Model Metrics:
- Format: {{metrics.format}} (units: {{metrics.units}})
- Bounding Box (mm): {{metrics.bbox_mm.x}} x {{metrics.bbox_mm.y}} x {{metrics.bbox_mm.z}}
- Volume (mm³): {{metrics.volume_mm3}}
- Surface Area (mm²): {{metrics.surface_area_mm2}}
- Triangle Count: {{metrics.triangles}}
- Watertight (Est): {{metrics.watertight_est}}
- Parser Notes: {{#each metrics.notes}}{{{this}}}{{/each}}

GUARDRAIL CONTEXT: Before outputting a final price the system MUST compute and validate:

1) Unit sanity:
- If maxDim_mm > 6000, the system will assume unit ambiguity and apply an inferred scaling (mm/cm/m/in).
- A warning will be added any time scaling inference is used.

2) Geometry reliability:
- If mesh is not watertight OR volume_cm3 is missing, the system will mark volume as unreliable and do NOT use volume for pricing.
- It will use bbox-based proxies and may require a manual review.

3) Segment count estimation per printer:
The system will calculate segment counts for each eligible printer.

4) Bed cycles and calendar time:
- The system will calculate bed cycles and lead time in days.

5) Risk/contingency must be bounded:
- Risk is computed as a capped percent of base cost, not proportional to segment count.

6) Single-price rule:
- The final customer-facing output is a single Total Price and lead time.

YOUR TASK:
Based on your analysis of the metrics and being mindful of the system's guardrails, estimate:
1.  The total print time in hours.
2.  The total material required in grams.

Before providing the final JSON output, fully review your numbers. Ensure your estimations for printTimeHours and materialGrams are reasonable and logical based on the model's volume, dimensions, and complexity.

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
