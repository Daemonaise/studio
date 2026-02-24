'use server';
/**
 * @fileOverview An AI engineering assistant that recommends optimal materials and explains trade-offs for 3D printing projects.
 *
 * - aiEngineeringAssistant - A function that handles queries about 3D printing material recommendations and trade-offs.
 * - AiEngineeringAssistantInput - The input type for the aiEngineeringAssistant function.
 * - AiEngineeringAssistantOutput - The return type for the aiEngineeringAssistant function.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';

// Schema for the STL metrics
const MeshMetricsSchema = z.object({
  format: z.enum(['stl', 'obj', '3mf']),
  units: z.string(),
  triangles: z.number(),
  bbox_mm: z.object({ x: z.number(), y: z.number(), z: z.number() }),
  surface_area_mm2: z.number(),
  volume_mm3: z.number(),
  watertight_est: z.boolean(),
  notes: z.array(z.string()),
  file_bytes: z.number(),
  parse_ms: z.number(),
}).optional();


const AiEngineeringAssistantInputSchema = z.object({
  query: z
    .string()
    .describe("The user's question about optimal material recommendations or trade-offs for a 3D printing part's intended use."),
  metrics: MeshMetricsSchema.describe("Optional metrics of a 3D model file if one was provided."),
});
export type AiEngineeringAssistantInput = z.infer<typeof AiEngineeringAssistantInputSchema>;

const AiEngineeringAssistantOutputSchema = z.object({
  recommendations: z.string().describe('Optimal material recommendations based on the part usage.'),
  tradeOffExplanation:
    z.string().describe('Explanation of complex trade-offs between strength, print time, and cost for the recommended materials.'),
});
export type AiEngineeringAssistantOutput = z.infer<typeof AiEngineeringAssistantOutputSchema>;

export async function aiEngineeringAssistant(input: AiEngineeringAssistantInput): Promise<AiEngineeringAssistantOutput> {
  return aiEngineeringAssistantFlow(input);
}

const aiEngineeringAssistantPrompt = ai.definePrompt({
  name: 'aiEngineeringAssistantPrompt',
  input: {schema: AiEngineeringAssistantInputSchema},
  output: {schema: AiEngineeringAssistantOutputSchema},
  prompt: `You are an expert engineering assistant specializing in 3D printing materials. Your task is to recommend optimal materials based on a part's intended use and explain the complex trade-offs between strength, print time, and cost.

{{#if metrics}}
Analyze the provided 3D model's metrics to understand its geometry, size, and potential use cases.
Model Metrics:
- Bounding Box (mm): {{metrics.bbox_mm.x}} x {{metrics.bbox_mm.y}} x {{metrics.bbox_mm.z}}
- Volume (mm³): {{metrics.volume_mm3}}
- Surface Area (mm²): {{metrics.surface_area_mm2}}
- Triangle Count: {{metrics.triangles}}
- Watertight (Est): {{metrics.watertight_est}}
- Notes: {{#each metrics.notes}}{{{this}}}{{/each}}
{{/if}}

User's query: {{{query}}}

Based on the user's query{{#if metrics}} and the provided 3D model metrics{{/if}}, please provide:
1.  Optimal material recommendations, considering the part's intended use and specific requirements.
2.  A clear and concise explanation of the trade-offs between strength, print time, and cost for the recommended materials, helping the user make an informed decision and optimize their 3D printing project.`,
});

const aiEngineeringAssistantFlow = ai.defineFlow(
  {
    name: 'aiEngineeringAssistantFlow',
    inputSchema: AiEngineeringAssistantInputSchema,
    outputSchema: AiEngineeringAssistantOutputSchema,
  },
  async input => {
    const {output} = await aiEngineeringAssistantPrompt(input);
    if (!output) {
        throw new Error('The AI model failed to provide a response. Please try again later.');
    }
    return output;
  }
);
