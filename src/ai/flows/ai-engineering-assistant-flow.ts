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

const AiEngineeringAssistantInputSchema = z.object({
  query: z
    .string()
    .describe("The user's question about optimal material recommendations or trade-offs for a 3D printing part's intended use."),
  fileDataUri: z
    .string()
    .optional()
    .describe(
      "An optional 3D model file (STL, OBJ, 3MF), as a data URI that must include a MIME type and use Base64 encoding. Expected format: 'data:<mimetype>;base64,<encoded_data>'."
    ),
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

{{#if fileDataUri}}
Analyze the provided 3D model to understand its geometry, size, and potential use cases.
Model: {{media url=fileDataUri}}
{{/if}}

User's query: {{{query}}}

Based on the user's query{{#if fileDataUri}} and the provided 3D model{{/if}}, please provide:
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
    return output!;
  }
);
