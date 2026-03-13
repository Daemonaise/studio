'use server';
/**
 * @fileOverview AI engineering assistant for Karasawa Labs — answers questions
 * about 3D printing materials, print settings, design trade-offs, and quoting.
 *
 * Key improvements over original:
 *   - Multi-turn conversation history (system + user + assistant messages)
 *   - Full knowledge of the printer fleet, materials, and pricing from pricing-matrix.json
 *   - Free-form markdown output (not rigid two-field schema)
 *   - Can answer general 3D printing questions, not just material recommendations
 */

import { ai } from '@/ai/genkit';
import { z } from 'genkit';
import pricingMatrix from '@/app/data/pricing-matrix.json';

// ── Schemas ──────────────────────────────────────────────────────────────────

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
}).optional();

const MessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string(),
});

const AiEngineeringAssistantInputSchema = z.object({
  query: z.string().describe("The user's current message."),
  metrics: MeshMetricsSchema.describe("Optional metrics of a 3D model file if one was provided with this message."),
  history: z.array(MessageSchema).optional().describe("Previous conversation messages for multi-turn context."),
});
export type AiEngineeringAssistantInput = z.infer<typeof AiEngineeringAssistantInputSchema>;

// Output is now a single markdown string — much more flexible.
const AiEngineeringAssistantOutputSchema = z.object({
  response: z.string().describe('The assistant response in markdown format.'),
});
export type AiEngineeringAssistantOutput = z.infer<typeof AiEngineeringAssistantOutputSchema>;

// ── Build system context from pricing matrix ─────────────────────────────────

function buildSystemContext(): string {
  const printers = Object.entries(pricingMatrix.printers).map(([key, p]: [string, any]) => {
    const build = p.buildVolume_mm;
    return `  - ${p.label} (${key}): ${build.x}×${build.y}×${build.z} mm, ` +
      `materials: ${p.supportedFilaments.join(', ')}, ` +
      `${p.capabilities.hasEnclosure ? 'enclosed' : 'open-frame'}, ` +
      `${p.capabilities.hasHeatedChamber ? `heated chamber ${p.capabilities.heatedChamberC}°C` : 'no heated chamber'}, ` +
      `${p.capabilities.hasHardenedNozzle ? 'hardened nozzle' : 'brass nozzle'}, ` +
      `quality tier ${p.qualityTier}, ` +
      `hourly rate $${p.hourlyRates_withShippingEmbedded['0.4']}/hr (0.4mm)`;
  }).join('\n');

  const fleet = Object.entries(pricingMatrix.printer_fleet).map(([key, v]: [string, any]) => {
    const label = (pricingMatrix.printers as any)[key]?.label ?? key;
    return `  - ${label}: ${v.count} unit${v.count > 1 ? 's' : ''}`;
  }).join('\n');

  const filaments = Object.entries(pricingMatrix.filaments).map(([name, f]: [string, any]) => {
    const reqs = f.requirements;
    const traits: string[] = [];
    if (reqs.requiresEnclosure) traits.push('needs enclosure');
    if (reqs.requiresHeatedChamber) traits.push(`heated chamber ≥${reqs.requiresChamberTempC}°C`);
    if (reqs.requiresHardenedNozzle) traits.push('hardened nozzle');
    return `  - ${name}: density ${f.densityGPerCm3} g/cm³, $${f.sellPricePerKg}/kg` +
      (traits.length ? ` (${traits.join(', ')})` : '');
  }).join('\n');

  return `KARASAWA LABS PRINTER FLEET & CAPABILITIES:
${fleet}

PRINTERS:
${printers}

AVAILABLE MATERIALS:
${filaments}

NOZZLE SIZES: ${pricingMatrix.nozzles.available_mm.join(', ')} mm

SEGMENTATION: Parts larger than the build volume are segmented (cut into pieces), bonded, and finished. Bonding labor: $${pricingMatrix.segmentation.bondingLaborPerSeam}/seam.

LEAD TIME: ${pricingMatrix.leadTime.minDays}–${pricingMatrix.leadTime.maxDaysCap} business days depending on job size.`;
}

// ── Prompt & Flow ────────────────────────────────────────────────────────────

const systemContext = buildSystemContext();

const aiEngineeringAssistantFlow = ai.defineFlow(
  {
    name: 'aiEngineeringAssistantFlow',
    inputSchema: AiEngineeringAssistantInputSchema,
    outputSchema: AiEngineeringAssistantOutputSchema,
  },
  async (input) => {
    // Build message array for multi-turn conversation
    const messages: { role: 'system' | 'user' | 'model'; content: { text: string }[] }[] = [];

    // System message with full context
    let systemPrompt = `You are an expert 3D printing engineering assistant for Karasawa Labs, a professional 3D printing service. You help customers with material selection, print settings, design optimization, part orientation, segmentation strategy, and general 3D printing questions.

${systemContext}

GUIDELINES:
- Always reference the actual printers, materials, and capabilities listed above when making recommendations.
- When recommending materials, explain WHY in terms of the part's use case (mechanical loads, temperature, UV, flexibility, etc.).
- For large parts that exceed build volumes, explain segmentation and how it affects cost and lead time.
- Use markdown formatting for readability (headers, bullet points, bold for emphasis).
- Be concise but thorough. Prefer actionable advice over generic information.
- If the user uploads a model, analyze the metrics to give specific recommendations for THAT part.
- You can answer general 3D printing questions too — you're not limited to material recommendations.`;

    messages.push({ role: 'system', content: [{ text: systemPrompt }] });

    // Add conversation history
    if (input.history) {
      for (const msg of input.history) {
        messages.push({
          role: msg.role === 'assistant' ? 'model' : 'user',
          content: [{ text: msg.content }],
        });
      }
    }

    // Build current user message
    let userMsg = input.query;
    if (input.metrics) {
      const m = input.metrics;
      userMsg += `\n\n[Attached 3D model metrics]\n` +
        `- Format: ${m.format} (${m.units})\n` +
        `- Bounding Box: ${m.bbox_mm.x.toFixed(1)} × ${m.bbox_mm.y.toFixed(1)} × ${m.bbox_mm.z.toFixed(1)} mm\n` +
        `- Volume: ${m.volume_mm3.toFixed(1)} mm³ (${(m.volume_mm3 / 1000).toFixed(2)} cm³)\n` +
        `- Surface Area: ${m.surface_area_mm2.toFixed(1)} mm²\n` +
        `- Triangles: ${m.triangles.toLocaleString()}\n` +
        `- Watertight: ${m.watertight_est ? 'Yes' : 'No'}\n` +
        (m.notes.length ? `- Notes: ${m.notes.join(', ')}` : '');
    }
    messages.push({ role: 'user', content: [{ text: userMsg }] });

    const { text } = await ai.generate({
      messages,
      model: 'googleai/gemini-2.5-flash',
    });

    return { response: text ?? 'I apologize, but I was unable to generate a response. Please try again.' };
  }
);

export async function aiEngineeringAssistant(input: AiEngineeringAssistantInput): Promise<AiEngineeringAssistantOutput> {
  return aiEngineeringAssistantFlow(input);
}
