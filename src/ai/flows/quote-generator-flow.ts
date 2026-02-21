'use server';
/**
 * @fileOverview An AI-powered 3D print quote generator.
 * - quoteGenerator - A function that analyzes a 3D model's metrics and provides a price quote.
 * - QuoteGeneratorInput - The input type for the quoteGenerator function.
 * - QuoteOutput - The return type for the quoteGenerator function.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';
import pricingMatrix from '@/app/data/pricing-matrix.json';
import { MeshMetrics } from '@/lib/mesh-analyzer';
import { EstimationOutput } from '@/ai/flows/quote-generator-flow';

// Schema for the STL metrics
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

// Schema for the input required by the main function, now using metrics
const QuoteGeneratorInputSchema = z.object({
  metrics: MeshMetricsSchema,
  material: z.string().describe('The filament material to be used (e.g., PLA, PETG, ASA).'),
  nozzleSize: z.string().describe('The diameter of the printer nozzle in mm (e.g., "0.4", "0.6").'),
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
  materialCost: z.number(),
  machineTimeCost: z.number(),
  totalCost: z.number(),
  shippingCost: z.number(),
  warnings: z.array(z.string()),
  printTimeHours: z.number(),
  materialGrams: z.number(),
});
export type QuoteOutput = z.infer<typeof QuoteOutputSchema>;

// The main exported function that the client-action will call
export async function quoteGenerator(input: QuoteGeneratorInput): Promise<QuoteOutput> {
  // 1. Get the estimation from the AI based on metrics
  const estimation = await estimationFlow(input);
  const {printTimeHours, materialGrams} = estimation;

  // 2. Perform calculations based on the pricing matrix
  const {material, nozzleSize, metrics} = input;
  const warnings: string[] = [];

  if (!metrics.watertight_est) {
      warnings.push("Model is not watertight, which may cause printing issues. Please check your model.");
  }
  // This is a very rough estimation. The AI will likely be more accurate.
  const overhang_pct_est_rough = (metrics.notes.includes('overhangs_present_basic') ? 40 : 0);
  if (overhang_pct_est_rough > 30) { 
      warnings.push(`Model may have significant overhangs which may require support material and increase print time/cost.`);
  }
  warnings.push(...metrics.notes.map(note => `Analysis Note: ${note}`));


  // Find a suitable printer that supports the filament
  const supportedPrinter = Object.entries(pricingMatrix.printers).find(([_, printerDetails]) =>
    printerDetails.supportedFilaments.includes(material)
  );

  if (!supportedPrinter) {
    warnings.push(`No available printer supports ${material}. Quote is based on default rates.`);
    // Fallback logic or error could be here. For now, we'll calculate with some default to avoid crashing.
    return {
      materialCost: 0,
      machineTimeCost: 0,
      totalCost: 0,
      shippingCost: 0,
      warnings,
      printTimeHours,
      materialGrams,
    };
  }

  const [printerName, printerDetails] = supportedPrinter;

  // Get nozzle multiplier
  const nozzleMultiplier =
    pricingMatrix.nozzleMultipliers[nozzleSize as keyof typeof pricingMatrix.nozzleMultipliers] || 1.0;
  if (!pricingMatrix.nozzleMultipliers[nozzleSize as keyof typeof pricingMatrix.nozzleMultipliers]) {
    warnings.push(`Nozzle size ${nozzleSize} not in matrix, using default multiplier.`);
  }

  // Calculate Machine Time Cost (with embedded shipping)
  const baseRate = printerDetails.baseRatePerHour;
  const finalHourlyRate = (baseRate + pricingMatrix.meta.shippingEmbeddedPerHour) * nozzleMultiplier * (1 + pricingMatrix.meta.businessMarkup);
  const machineTimeCost = printTimeHours * finalHourlyRate;

  // Calculate Material Cost
  const filamentDetails = pricingMatrix.filaments[material as keyof typeof pricingMatrix.filaments];
  if (!filamentDetails) {
    warnings.push(`Material ${material} not in pricing matrix.`);
    return {
      materialCost: 0,
      machineTimeCost,
      totalCost: machineTimeCost,
      shippingCost: 0,
      warnings,
      printTimeHours,
      materialGrams,
    };
  }
  const materialCost = materialGrams * filamentDetails.sellPricePerGram;

  // Shipping Cost is now baked into the hourly rate
  const shippingCost = 0;

  // Total Cost
  const totalCost = materialCost + machineTimeCost;

  return {
    materialCost,
    machineTimeCost,
    totalCost,
    shippingCost: 0, // Return 0 for consistency
    warnings,
    printTimeHours,
    materialGrams,
  };
}

// Genkit prompt that asks the AI for estimations based on metrics
const estimationPrompt = ai.definePrompt({
  name: '3dPrintEstimatorPrompt',
  input: {schema: QuoteGeneratorInputSchema},
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
    const models = [
      ai.model('googleai/gemini-2.5-pro'),
      ai.model('googleai/gemini-1.5-pro'),
      ai.model('googleai/gemini-1.5-flash'),
    ];

    const promises = models.map(model => 
        estimationPrompt(input, { model })
    );

    const results = await Promise.allSettled(promises);

    const validResults: EstimationOutput[] = [];
    results.forEach((result, index) => {
      if (result.status === 'fulfilled' && result.value.output) {
        validResults.push(result.value.output);
      } else {
        // Don't log the model object, just its name.
        const modelName = (models[index] as any)?.name || `Model ${index}`;
        console.error(`Model ${modelName} failed:`, result.status === 'rejected' ? result.reason : 'No output');
      }
    });

    if (validResults.length === 0) {
      throw new Error('All AI models failed to provide an estimation. Please try again later.');
    }

    // Calculate the average
    const totalPrintTime = validResults.reduce((acc, r) => acc + r.printTimeHours, 0);
    const totalMaterial = validResults.reduce((acc, r) => acc + r.materialGrams, 0);
    
    return {
      printTimeHours: totalPrintTime / validResults.length,
      materialGrams: totalMaterial / validResults.length,
    };
  }
);
