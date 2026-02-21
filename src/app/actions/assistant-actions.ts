'use server';

import { aiEngineeringAssistant } from '@/ai/flows/ai-engineering-assistant-flow';
import { analyzeMeshFile, MeshMetrics } from '@/lib/mesh-analyzer';

interface AssistantActionInput {
    query: string;
    fileName?: string;
    fileDataUri?: string;
}

export async function getAssistantResponse(input: AssistantActionInput) {
    const { query, fileName, fileDataUri } = input;
    
    let metrics: MeshMetrics | undefined = undefined;

    if (fileDataUri && fileName) {
        try {
            const base64Data = fileDataUri.split(',')[1];
            if (!base64Data) {
                throw new Error('Invalid data URI format.');
            }
            const buffer = Buffer.from(base64Data, 'base64');
            metrics = await analyzeMeshFile({ fileName, buffer });
        } catch (error) {
            console.error("Failed to analyze mesh for assistant:", error);
            // Don't block the request if analysis fails, just proceed without metrics
        }
    }

    const assistantResponse = await aiEngineeringAssistant({
        query,
        metrics,
    });

    return assistantResponse;
}
