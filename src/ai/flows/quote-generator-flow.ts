
'use server';
/**
 * @fileOverview An AI-powered 3D print quote generator.
 * - quoteGenerator - A function that analyzes a 3D model and provides a price quote.
 * - QuoteGeneratorInput - The input type for the quoteGenerator function.
 * - QuoteGeneratorOutput - The return type for the quoteGenerator function.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';
import pricingMatrix from '@/app/data/pricing-matrix.json';

// Schema for the input required by the main function
const QuoteGeneratorInputSchema = z.object({
  fileDataUri: z
    .string()
    .describe(
      "A 3D model file (STL, OBJ, 3MF), as a data URI that must include a MIME type and use Base64 encoding. Expected format: 'data:<mimetype>;base64,<encoded_data>'."
    ),
  material: z.string().describe('The filament material to be used (e.g., PLA, PETG, ASA).'),
  nozzleSize: z.string().describe('The diameter of the printer nozzle in mm (e.g., "0.4", "0.6").'),
});
export type QuoteGeneratorInput = z.infer<typeof QuoteGeneratorInputSchema>;

// Schema for the AI model's direct output (estimation part)
const EstimationOutputSchema = z.object({
  printTimeHours: z.number().describe('The estimated time to print the object in hours.'),
  materialGrams: z.number().describe('The estimated material needed in grams.'),
});

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

// The main exported function that the client will call
export async function quoteGenerator(input: QuoteGeneratorInput): Promise<QuoteOutput> {
  // 1. Get the estimation from the AI
  const estimation = await estimationFlow(input);
  const { printTimeHours, materialGrams } = estimation;

  // 2. Perform calculations based on the pricing matrix
  const { material, nozzleSize } = input;
  const warnings: string[] = [];

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
  const nozzleMultiplier = pricingMatrix.nozzleMultipliers[nozzleSize as keyof typeof pricingMatrix.nozzleMultipliers] || 1.0;
  if (!pricingMatrix.nozzleMultipliers[nozzleSize as keyof typeof pricingMatrix.nozzleMultipliers]) {
      warnings.push(`Nozzle size ${nozzleSize} not in matrix, using default multiplier.`);
  }

  // Calculate Machine Time Cost
  const baseRate = printerDetails.baseRatePerHour;
  const finalHourlyRate = (baseRate * nozzleMultiplier) * (1 + pricingMatrix.meta.businessMarkup);
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
  
  // Shipping Cost
  const shippingCost = pricingMatrix.meta.shippingBasis.freightSellPrice;

  // Total Cost
  const totalCost = materialCost + machineTimeCost + shippingCost;

  return {
    materialCost,
    machineTimeCost,
    totalCost,
    shippingCost,
    warnings,
    printTimeHours,
    materialGrams,
  };
}


// Genkit prompt that asks the AI for estimations
const estimationPrompt = ai.definePrompt({
  name: '3dPrintEstimatorPrompt',
  input: { schema: QuoteGeneratorInputSchema },
  output: { schema: EstimationOutputSchema },
  prompt: `You are an expert 3D printing technician. Your task is to analyze a 3D model file and provide accurate estimations for print time and material consumption.

Analyze the geometry, size, and complexity of the provided 3D model. Consider standard print settings for the given material '{{{material}}}' and nozzle size '{{{nozzleSize}}}'.

Based on your analysis, estimate:
1.  The total print time in hours.
2.  The total material required in grams.

The user's model is provided below.
Model: {{media url=fileDataUri}}

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
    const { output } = await estimationPrompt(input);
    return output!;
  }
);
