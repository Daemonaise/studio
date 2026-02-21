'use server';

import { quoteGenerator } from '@/ai/flows/quote-generator-flow';
import { analyzeMeshFile } from '@/lib/mesh-analyzer';

interface QuoteActionInput {
    fileName: string;
    fileDataUri: string;
    material: string;
    nozzleSize: string;
}

export async function generateQuoteFromModel(input: QuoteActionInput) {
    const { fileName, fileDataUri, material, nozzleSize } = input;

    if (!fileDataUri) {
        throw new Error('File data URI is missing.');
    }
    
    // Convert data URI to Buffer
    const base64Data = fileDataUri.split(',')[1];
    if (!base64Data) {
        throw new Error('Invalid data URI format.');
    }
    const buffer = Buffer.from(base64Data, 'base64');
    
    // Analyze Mesh
    const metrics = await analyzeMeshFile({
        fileName,
        buffer
    });

    // Call the quote generator flow with the metrics
    const quote = await quoteGenerator({
        metrics,
        material,
        nozzleSize,
    });

    return quote;
}
