'use server';

import { quoteGenerator } from '@/ai/flows/quote-generator-flow';
import { analyzeMeshFile } from '@/lib/mesh-analyzer';

interface QuoteActionInput {
    fileName: string;
    fileDataUri: string;
    material: string;
    nozzleSize: string;
    autoPrinterSelection: boolean;
    selectedPrinterKey?: string;
}

export async function generateQuoteFromModel(input: QuoteActionInput) {
    const { fileName, fileDataUri, material, nozzleSize, autoPrinterSelection, selectedPrinterKey } = input;

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
        autoPrinterSelection,
        selectedPrinterKey
    });

    return quote;
}

/**
 * Fast-path quote generation for Karaslice parts.
 *
 * Karaslice already computed bbox, volume, and triangle count during the split.
 * This action skips the expensive file→base64→server→parse round-trip and
 * feeds pre-computed metrics directly into the quote generator.
 */
interface QuoteFromMetricsInput {
    bbox_mm: { x: number; y: number; z: number };
    volumeMM3: number;
    triangleCount: number;
    material: string;
    nozzleSize: string;
    autoPrinterSelection: boolean;
    selectedPrinterKey?: string;
}

export async function generateQuoteFromMetrics(input: QuoteFromMetricsInput) {
    const { bbox_mm, volumeMM3, triangleCount, material, nozzleSize, autoPrinterSelection, selectedPrinterKey } = input;

    const metrics = {
        format: 'stl' as const,
        units: 'mm',
        triangles: triangleCount,
        bbox_mm,
        surface_area_mm2: 0, // not needed for cost calc
        volume_mm3: volumeMM3,
        watertight_est: true, // split parts are capped
        notes: ['karaslice_precomputed'],
        file_bytes: 0,
        parse_ms: 0,
    };

    const quote = await quoteGenerator({
        metrics,
        material,
        nozzleSize,
        autoPrinterSelection,
        selectedPrinterKey,
    });

    return quote;
}
