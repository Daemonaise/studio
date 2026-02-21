
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
type BBox = { x: number; y: number; z: number };
type Build = { x: number; y: number; z: number };


// --- Helper functions for orientation and segmentation ---
function perms(b: BBox): BBox[] {
  const a = [b.x, b.y, b.z];
  const uniq = new Set<string>();
  const out: BBox[] = [];
  const p = [
    [0,1,2],[0,2,1],[1,0,2],[1,2,0],[2,0,1],[2,1,0]
  ];
  for (const [i,j,k] of p) {
    const bb = { x: a[i], y: a[j], z: a[k] };
    const key = `${bb.x}|${bb.y}|${bb.z}`;
    if (!uniq.has(key)) { uniq.add(key); out.push(bb); }
  }
  return out;
}

function estimateSegmentsForBBox(b: BBox, build: Build, efficiency = 0.70, softenZ = 0.60): number {
  const sx = Math.ceil(b.x / build.x);
  const sy = Math.ceil(b.y / build.y);
  const szRaw = Math.ceil(b.z / build.z);
  const sz = Math.max(1, Math.ceil(szRaw * softenZ));
  const raw = Math.max(1, sx * sy * sz);
  return Math.ceil(raw / efficiency);
}

function bestOrientationSegments(bbox: BBox, build: Build, efficiency = 0.70): { segments: number; orientedBBox: BBox } {
  let best = Infinity;
  let bestBBox = bbox;
  for (const b of perms(bbox)) {
    const seg = estimateSegmentsForBBox(b, build, efficiency);
    if (seg < best) { best = seg; bestBBox = b; }
  }
  return { segments: Math.max(1, best), orientedBBox: bestBBox };
}

function getSegmentationTier(segments: number): SegTier {
  if (segments <= 1) return "none";
  if (segments <= 12) return "moderate";
  return "heavy";
}


// --- Main Exported Quote Generator Function ---

export async function quoteGenerator(input: QuoteGeneratorInput): Promise<QuoteOutput> {
  const { metrics, material, nozzleSize } = input;
  let { autoPrinterSelection, selectedPrinterKey: userSelectedPrinter } = input;
  const warnings: string[] = [];

  // 1. Initial AI estimation for baseline time and material
  const estimation = await estimationFlow(input);
  const estimatedHoursBaseline = estimation.printTimeHours;

  // 2. Unit Sanity Check & Bbox Scaling
  let bbox_mm = { ...metrics.bbox_mm };
  if (pricingMatrix.unitSanity.enabled) {
    let maxDim = Math.max(bbox_mm.x, bbox_mm.y, bbox_mm.z);
    for (const rule of pricingMatrix.unitSanity.scaleRules) {
        if (maxDim > rule.ifMaxDimGreaterThan) {
            bbox_mm.x /= rule.scaleDivisor;
            bbox_mm.y /= rule.scaleDivisor;
            bbox_mm.z /= rule.scaleDivisor;
            warnings.push(rule.label);
            break;
        }
    }
  }
  
  const maxDimAfterScaling = Math.max(bbox_mm.x, bbox_mm.y, bbox_mm.z);

  // 3. Determine Printer Compatibility & Selection
  let selectedPrinterKey: string | undefined = undefined;

  const filamentReqs = pricingMatrix.filaments[material as keyof typeof pricingMatrix.filaments]?.requirements;
  if (!filamentReqs) {
      throw new Error(`Filament requirements not found for ${material}.`);
  }

  const compatiblePrinterKeys = Object.entries(pricingMatrix.printers).filter(([key, printer]) => {
      const caps = (printer as any).capabilities;
      if (!caps) return false;
      return (
        caps.maxNozzleC >= filamentReqs.minNozzleC &&
        caps.maxBedC >= filamentReqs.minBedC &&
        (!filamentReqs.requiresEnclosure || caps.hasEnclosure) &&
        (!filamentReqs.requiresHeatedChamber || caps.hasHeatedChamber) &&
        (filamentReqs.requiresChamberTempC <= 0 || caps.heatedChamberC >= filamentReqs.requiresChamberTempC) &&
        (!filamentReqs.requiresHardenedNozzle || caps.hasHardenedNozzle)
      );
  }).map(([key]) => key);

  if (compatiblePrinterKeys.length === 0) {
      throw new Error(`No available printer is compatible with the requirements for ${material}.`);
  }

  if (!autoPrinterSelection && userSelectedPrinter) {
    if (compatiblePrinterKeys.includes(userSelectedPrinter)) {
      selectedPrinterKey = userSelectedPrinter;
    } else {
      warnings.push(`Your selected printer doesn't support ${material}. Auto-selecting a suitable printer.`);
      autoPrinterSelection = true;
    }
  }

  if (autoPrinterSelection) {
      let bestChoice = { key: '', segments: Infinity };
      for (const key of compatiblePrinterKeys) {
          const printer = (pricingMatrix.printers as any)[key];
          const { segments } = bestOrientationSegments(bbox_mm, printer.buildVolume_mm, pricingMatrix.segmentation.efficiency);
          if (segments < bestChoice.segments) {
              bestChoice = { key, segments };
          }
          // Tie-break with cost if segments are equal (favor cheaper printers)
          else if (segments === bestChoice.segments) {
              const currentBestPrinter = (pricingMatrix.printers as any)[bestChoice.key];
              const rateCurrent = currentBestPrinter.hourlyRates_withShippingEmbedded[nozzleSize as keyof typeof currentBestPrinter.hourlyRates_withShippingEmbedded] || Infinity;
              const rateNew = printer.hourlyRates_withShippingEmbedded[nozzleSize as keyof typeof printer.hourlyRates_withShippingEmbedded] || Infinity;
              if (rateNew < rateCurrent) {
                  bestChoice = { key, segments };
              }
          }
      }
      selectedPrinterKey = bestChoice.key;
  }
  
  if (!selectedPrinterKey) {
    throw new Error('Could not determine a suitable printer for the job.');
  }

  const selectedPrinter = (pricingMatrix.printers as any)[selectedPrinterKey];
  
  // 4. Calculate Segmentation for the *selected* printer
  const { segments: segmentCountEstimate, orientedBBox } = bestOrientationSegments(bbox_mm, selectedPrinter.buildVolume_mm, pricingMatrix.segmentation.efficiency);
  const segmentationRequired = segmentCountEstimate > 1;

  if (segmentationRequired) warnings.push("Model exceeds build volume: segmentation required.");

  // 5. Determine Job Scale & Mode
  const { jobScaleRules } = pricingMatrix;
  
  let jobScale: "Small Part" | "Medium Part" | "Large Assembly";
  let mode: "Hourly" | "Bed-Cycle Mode";

  if (segmentationRequired || maxDimAfterScaling > jobScaleRules.mediumPart.maxDim_mm || estimatedHoursBaseline >= jobScaleRules.largeAssembly.minHours) {
    jobScale = "Large Assembly";
    mode = "Bed-Cycle Mode";
  } else if (maxDimAfterScaling <= jobScaleRules.smallPart.maxDim_mm && estimatedHoursBaseline < jobScaleRules.smallPart.maxHours) {
    jobScale = "Small Part";
    mode = "Hourly";
  } else {
    jobScale = "Medium Part";
    mode = "Hourly";
  }
  
  // 6. Calculate Costs, Tiers, and Final Hours
  let machineCost = 0;
  let segmentationCost = 0;
  let riskCost = 0;
  let bedCyclesEstimate = 0;
  let finalEstimatedHours = estimatedHoursBaseline;
  
  const segmentationTier = getSegmentationTier(segmentCountEstimate);

  if (mode === "Bed-Cycle Mode") {
    warnings.push("Large assembly detected: bed-cycle mode enforced.");
    bedCyclesEstimate = segmentCountEstimate;
    finalEstimatedHours = bedCyclesEstimate * selectedPrinter.bedCycleHours;

    if (segmentationTier === 'heavy') warnings.push("Heavy segmentation: increased seam count and extended lead time.");
    
    // Calculate costs for Bed-Cycle mode
    const bedCycleRate = selectedPrinter.bedCycleRates_withShippingEmbedded[nozzleSize as keyof typeof selectedPrinter.bedCycleRates_withShippingEmbedded];
    machineCost = bedCyclesEstimate * bedCycleRate;
    
    segmentationCost = segmentCountEstimate * pricingMatrix.segmentation.seamsPerSegmentDefault * pricingMatrix.segmentation.bondingLaborPerSeam;
    
  } else { // Hourly Mode
    const hourlyRate = selectedPrinter.hourlyRates_withShippingEmbedded[nozzleSize as keyof typeof selectedPrinter.hourlyRates_withShippingEmbedded];
    machineCost = finalEstimatedHours * hourlyRate;
    segmentationCost = 0;
  }
  
  // NEW: Capped risk model.
  const baseCostForRisk = machineCost + segmentationCost;
  riskCost = mode === "Bed-Cycle Mode"
    ? Math.min(Math.max(baseCostForRisk * 0.12, 250), baseCostForRisk * 0.25)
    : 0;

  // 7. Calculate Material Cost
  const materialInfo = pricingMatrix.filaments[material as keyof typeof pricingMatrix.filaments];
  const materialCost = estimation.materialGrams * materialInfo.sellPricePerGram;

  // 8. Apply Multipliers to Subtotal
  let subtotalForMultipliers = machineCost + segmentationCost + riskCost;
  
  const segTierMultiplier = (pricingMatrix.segmentation.segmentationModeMultipliers as any)[segmentationTier] || 1.0;
  subtotalForMultipliers *= segTierMultiplier;

  let complexityMultiplier = pricingMatrix.multipliers.complexity.multipliers.low;
  if (metrics.triangles > pricingMatrix.multipliers.complexity.triangleCountThresholds.high) {
      complexityMultiplier = pricingMatrix.multipliers.complexity.multipliers.high;
      warnings.push("Complexity high: manual review recommended.");
  } else if (metrics.triangles > pricingMatrix.multipliers.complexity.triangleCountThresholds.medium) {
      complexityMultiplier = pricingMatrix.multipliers.complexity.multipliers.medium;
  }
  subtotalForMultipliers *= complexityMultiplier;
  
  if (finalEstimatedHours > pricingMatrix.multipliers.longJob.thresholdHours) {
      subtotalForMultipliers *= pricingMatrix.multipliers.longJob.multiplier;
      warnings.push("Long job multiplier applied due to extended print time.");
  }

  const totalCost = subtotalForMultipliers + materialCost;

  // 9. Calculate Lead Time
  let eligibleFleetCount = 0;
  if (mode === "Bed-Cycle Mode") {
      if (!autoPrinterSelection && userSelectedPrinter) {
          eligibleFleetCount = (pricingMatrix.printer_fleet[userSelectedPrinter as keyof typeof pricingMatrix.printer_fleet] as any)?.count || 1;
      } else {
          compatiblePrinterKeys.forEach((key) => {
              eligibleFleetCount += (pricingMatrix.printer_fleet[key as keyof typeof pricingMatrix.printer_fleet] as any)?.count || 0;
          });
      }
  }
  const cyclesPerDay = Math.max(1, eligibleFleetCount * pricingMatrix.leadTime.utilizationFactor);
  const baseDays = mode === "Bed-Cycle Mode" 
      ? Math.ceil(bedCyclesEstimate / cyclesPerDay)
      : Math.ceil(finalEstimatedHours / 12);

  const segmentationAddDays = (pricingMatrix.leadTime.segmentationExtraDays as any)[segmentationTier] || 0;
  
  const minLead = Math.max(pricingMatrix.leadTime.minDays, baseDays + segmentationAddDays);
  const maxLead = Math.ceil(minLead * 1.4);

  const leadTimeDays = {
      min: Math.min(minLead, pricingMatrix.leadTime.maxDaysCap),
      max: Math.min(maxLead, pricingMatrix.leadTime.maxDaysCap),
  };
  
  // 10. Finalize
  if (!metrics.watertight_est) {
      warnings.push("Non-watertight mesh may affect volume/time estimates and print quality.");
  }
  if (maxDimAfterScaling > 2000) {
      warnings.push("Part is exceptionally large (>2m). Manual review recommended to confirm quote.");
  }


  return {
      mode,
      jobScale,
      selectedPrinterKey,
      selectedNozzle: nozzleSize,
      selectedFilament: material,
      bbox_mm: bbox_mm,
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
        shippingEmbedded: 0, // This is now included in rates
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
- If maxDim_mm > 6000, the system will assume unit ambiguity and apply an inferred scaling (mm/cm/m).
- A warning will be added any time scaling inference is used.

2) Geometry reliability:
- If mesh is not watertight OR volume_cm3 is missing, the system will mark volume as unreliable and do NOT use volume for pricing.
- It will use bbox-based proxies and may require a manual review.

3) Segment count estimation per printer:
The system will calculate segment counts for each eligible printer after testing 6 rotational permutations to find the optimal orientation.

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
    // For monocoque-scale parts, deterministic calculation is more reliable than AI estimation.
    const { metrics, nozzleSize } = input;
    const maxDim = Math.max(metrics.bbox_mm.x, metrics.bbox_mm.y, metrics.bbox_mm.z);
    
    // If volume data is available and part is large, use deterministic estimation.
    if (metrics.volume_mm3 > 0) {
        const volume_cm3 = metrics.volume_mm3 / 1000;
        const nozzleMultiplier = (pricingMatrix.nozzles.multipliers as any)[nozzleSize] || 1.0;
        
        // Base hours estimate on volume. A simple heuristic.
        // Assume roughly 6 cm³/hr for a 0.4mm nozzle on a standard part.
        let estimatedHours = Math.max(0.3, volume_cm3 / 6.0); 

        // Adjust for nozzle size. Larger nozzles print faster.
        estimatedHours /= (1 / nozzleMultiplier); 

        // Increase time for very complex parts
        if (metrics.triangles > pricingMatrix.multipliers.complexity.triangleCountThresholds.high) {
            estimatedHours *= pricingMatrix.multipliers.complexity.multipliers.high;
        } else if (metrics.triangles > pricingMatrix.multipliers.complexity.triangleCountThresholds.medium) {
            estimatedHours *= pricingMatrix.multipliers.complexity.multipliers.medium;
        }
        
        // Estimate material based on volume and a typical density
        // PLA density is ~1.24 g/cm³. We add a factor for support/infill.
        const materialGrams = volume_cm3 * 1.24 * 1.15;

        return {
            printTimeHours: estimatedHours,
            materialGrams: materialGrams
        };

    } else {
         // Fallback to AI if no volume data is present.
         const { output } = await estimationPrompt(input, { model: 'googleai/gemini-2.5-flash-lite' });
         if (!output) {
           throw new Error('The AI model failed to provide an estimation. Please try again later.');
         }
         return output;
    }
  }
);

    