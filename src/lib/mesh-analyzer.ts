'use server';

import JSZip from 'jszip';
import { XMLParser } from 'fast-xml-parser';

// --- Type Definitions ---
type Vec3 = [number, number, number];
type Triangle = [Vec3, Vec3, Vec3];

export interface MeshMetrics {
  format: 'stl' | 'obj' | '3mf';
  units: string;
  triangles: number;
  bbox_mm: { x: number; y: number; z: number };
  surface_area_mm2: number;
  volume_mm3: number;
  watertight_est: boolean;
  notes: string[];
  file_bytes: number;
  parse_ms: number;
}


// --- Vector Math Utilities (reused across parsers) ---
const subtract = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const magnitude = (a: Vec3): number => Math.sqrt(a[0] ** 2 + a[1] ** 2 + a[2] ** 2);

// --- Core Metrics Calculation Logic ---
function calculateMetricsFromTriangles(triangles: Triangle[], unit_conversion_factor: number): Omit<MeshMetrics, 'format' | 'notes' | 'file_bytes' | 'parse_ms' | 'units'> {
    if (triangles.length === 0) {
        return {
            bbox_mm: { x: 0, y: 0, z: 0 },
            volume_mm3: 0,
            surface_area_mm2: 0,
            triangles: 0,
            watertight_est: true,
        };
    }

    let surface_area = 0;
    let volume = 0;
    const edgeCounts = new Map<string, number>();

    const first_vertex = triangles[0][0];
    const min: Vec3 = [...first_vertex];
    const max: Vec3 = [...first_vertex];

    for (const tri of triangles) {
        const [v0, v1, v2] = tri;

        // Bounding Box
        for (let i = 0; i < 3; i++) {
            min[i] = Math.min(min[i], v0[i], v1[i], v2[i]);
            max[i] = Math.max(max[i], v0[i], v1[i], v2[i]);
        }

        // Surface Area
        const edge1 = subtract(v1, v0);
        const edge2 = subtract(v2, v0);
        surface_area += 0.5 * magnitude(cross(edge1, edge2));

        // Volume (Signed Tetrahedron)
        volume += dot(v0, cross(v1, v2)) / 6.0;

        // Watertight Check
        const edges = [[v0, v1], [v1, v2], [v2, v0]];
        for (const edge of edges) {
            const key = edge.map(v => v.join(',')).sort().join('|');
            edgeCounts.set(key, (edgeCounts.get(key) || 0) + 1);
        }
    }

    let is_watertight = true;
    for (const count of edgeCounts.values()) {
        if (count !== 2) {
            is_watertight = false;
            break;
        }
    }

    return {
        bbox_mm: {
            x: (max[0] - min[0]) * unit_conversion_factor,
            y: (max[1] - min[1]) * unit_conversion_factor,
            z: (max[2] - min[2]) * unit_conversion_factor,
        },
        volume_mm3: Math.abs(volume) * (unit_conversion_factor ** 3),
        surface_area_mm2: surface_area * (unit_conversion_factor ** 2),
        triangles: triangles.length,
        watertight_est: is_watertight,
    };
}


// --- STL Parser ---
function analyzeStl(buffer: Buffer): Omit<MeshMetrics, 'file_bytes' | 'parse_ms'> {
    const isBinary = (buf: Buffer): boolean => {
        if (buf.length < 84) return false;
        // Check if the file starts with 'solid'
        const header = buf.toString('ascii', 0, 5);
        if (header === 'solid') return false;

        // A binary STL file has a 4-byte unsigned integer at offset 80
        // representing the number of triangles.
        const numTriangles = buf.readUInt32LE(80);
        const expectedSize = 84 + numTriangles * 50;
        return buf.length >= expectedSize;
    };

    let triangles: Triangle[];
    if (isBinary(buffer)) {
        triangles = parseStlBinary(buffer);
    } else {
        triangles = parseStlAscii(buffer);
    }

    const metrics = calculateMetricsFromTriangles(triangles, 1.0); // STL is unitless, assume mm

    return {
        ...metrics,
        format: 'stl',
        units: 'unknown_assumed_mm',
        notes: [],
    };
}

function parseStlAscii(buffer: Buffer): Triangle[] {
    const text = buffer.toString('utf-8');
    const lines = text.split('\n');
    const triangles: Triangle[] = [];
    let currentTriangle: Vec3[] = [];

    for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        if (parts[0] === 'vertex') {
            const x = parseFloat(parts[1]);
            const y = parseFloat(parts[2]);
            const z = parseFloat(parts[3]);
            currentTriangle.push([x, y, z]);
            if (currentTriangle.length === 3) {
                triangles.push(currentTriangle as Triangle);
                currentTriangle = [];
            }
        }
    }
    return triangles;
}

function parseStlBinary(buffer: Buffer): Triangle[] {
    const numTriangles = buffer.readUInt32LE(80);
    const triangles: Triangle[] = [];
    let offset = 84;

    for (let i = 0; i < numTriangles; i++) {
        const v1_x = buffer.readFloatLE(offset + 12);
        const v1_y = buffer.readFloatLE(offset + 16);
        const v1_z = buffer.readFloatLE(offset + 20);
        const v2_x = buffer.readFloatLE(offset + 24);
        const v2_y = buffer.readFloatLE(offset + 28);
        const v2_z = buffer.readFloatLE(offset + 32);
        const v3_x = buffer.readFloatLE(offset + 36);
        const v3_y = buffer.readFloatLE(offset + 40);
        const v3_z = buffer.readFloatLE(offset + 44);

        triangles.push([
            [v1_x, v1_y, v1_z],
            [v2_x, v2_y, v2_z],
            [v3_x, v3_y, v3_z],
        ]);
        offset += 50;
    }
    return triangles;
}

// --- OBJ Parser ---
function analyzeObj(bufferOrText: Buffer | string): Omit<MeshMetrics, 'file_bytes' | 'parse_ms'> {
    const text = Buffer.isBuffer(bufferOrText) ? bufferOrText.toString('utf-8') : bufferOrText;
    const lines = text.split('\n');
    const vertices: Vec3[] = [];
    const triangles: Triangle[] = [];
    const notes: string[] = [];

    for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        const type = parts.shift();
        if (type === 'v') {
            vertices.push([parseFloat(parts[0]), parseFloat(parts[1]), parseFloat(parts[2])]);
        } else if (type === 'f') {
            const faceVertices: Vec3[] = [];
            for (const part of parts) {
                const indexStr = part.split('/')[0];
                let index = parseInt(indexStr, 10);

                if (isNaN(index)) continue;

                // Handle negative indices
                if (index < 0) {
                    index = vertices.length + index;
                } else {
                    index -= 1; // 1-based to 0-based
                }
                if (vertices[index]) {
                    faceVertices.push(vertices[index]);
                }
            }

            // Triangulate faces with > 3 vertices (ngons) using a fan
            if (faceVertices.length > 2) {
                if (faceVertices.length > 3 && !notes.includes('triangulated_ngons')) {
                    notes.push('triangulated_ngons');
                }
                const v0 = faceVertices[0];
                for (let i = 1; i < faceVertices.length - 1; i++) {
                    const v1 = faceVertices[i];
                    const v2 = faceVertices[i + 1];
                    triangles.push([v0, v1, v2]);
                }
            }
        }
    }
    
    if (text.includes(' -')) { // A simplistic check for negative indices
      notes.push('negative_indices_supported');
    }

    const metrics = calculateMetricsFromTriangles(triangles, 1.0); // OBJ is unitless, assume mm

    return {
        ...metrics,
        format: 'obj',
        units: 'unknown_assumed_mm',
        notes,
    };
}


// --- 3MF Parser ---
async function analyze3mf(buffer: Buffer): Promise<Omit<MeshMetrics, 'file_bytes' | 'parse_ms'>> {
    const MAX_UNCOMPRESSED_SIZE = 100 * 1024 * 1024; // 100 MB
    const MAX_FILES = 1000;
    const notes: string[] = [];

    const zip = await JSZip.loadAsync(buffer);

    let modelFile: JSZip.JSZipObject | null = null;
    let fileCount = 0;
    let totalSize = 0;

    zip.forEach((relativePath, file) => {
        fileCount++;
        // This is a simplified size check; for perfect accuracy, we'd need to decompress first.
        // JSZip doesn't expose compressed size directly in forEach.
        // We'll check the uncompressed size later.
        if (relativePath.toLowerCase().startsWith('3d/') && relativePath.toLowerCase().endsWith('.model')) {
            modelFile = file;
        }
    });

    if (fileCount > MAX_FILES) throw new Error('3MF PARSE_ERROR: Too many files in archive (potential zip bomb).');

    if (!modelFile) {
      // Fallback search
       zip.forEach((relativePath, file) => {
          if (relativePath.toLowerCase().endsWith('.model')) {
            modelFile = file;
          }
      });
    }
    
    if (!modelFile) throw new Error('3MF PARSE_ERROR: No .model file found in archive.');

    const modelXml = await modelFile.async('string');
    totalSize += modelXml.length;
    if (totalSize > MAX_UNCOMPRESSED_SIZE) throw new Error('3MF PARSE_ERROR: Uncompressed file size exceeds limit.');


    const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "" });
    const modelJson = parser.parse(modelXml);

    let unit = modelJson.model?.unit || 'millimeter';
    if (!['millimeter', 'centimeter', 'meter', 'micron', 'inch', 'foot'].includes(unit)) {
        unit = 'millimeter'; // Assume mm if invalid or missing
        notes.push('invalid_or_missing_units_assumed_mm');
    }

    const conversionFactors: { [key: string]: number } = {
        millimeter: 1,
        centimeter: 10,
        meter: 1000,
        micron: 0.001,
        inch: 25.4,
        foot: 304.8,
    };
    const unit_conversion_factor = conversionFactors[unit];
    
    const allVertices: Vec3[] = [];
    const allTriangles: Triangle[] = [];
    let objectCount = 0;

    const resources = Array.isArray(modelJson.model.resources.object) 
      ? modelJson.model.resources.object
      : [modelJson.model.resources.object];
      
    for (const obj of resources) {
      if (obj.mesh) {
        objectCount++;
        const mesh = obj.mesh;
        const currentVertices: Vec3[] = mesh.vertices.vertex.map((v: any) => [
            parseFloat(v.x),
            parseFloat(v.y),
            parseFloat(v.z),
        ]);

        const vertexOffset = allVertices.length;
        allVertices.push(...currentVertices);

        const meshTriangles = mesh.triangles.triangle.map((t: any) => {
            const v1 = allVertices[parseInt(t.v1) + vertexOffset];
            const v2 = allVertices[parseInt(t.v2) + vertexOffset];
            const v3 = allVertices[parseInt(t.v3) + vertexOffset];
            return [v1, v2, v3] as Triangle;
        });
        allTriangles.push(...meshTriangles);
      }
    }
    
    if (objectCount > 1) {
        notes.push('multi_object_combined');
    }
    
    // Check for transforms (MVP)
    if (modelJson.model.build?.item?.transform || modelJson.model.components?.component?.transform) {
        notes.push('transforms_ignored_mvp');
    }

    const metrics = calculateMetricsFromTriangles(allTriangles, unit_conversion_factor);

    return {
        ...metrics,
        format: '3mf',
        units: unit,
        notes,
    };
}


// --- Router ---

interface AnalyzeMeshInput {
    fileName: string;
    buffer: Buffer;
}

export async function analyzeMeshFile({ fileName, buffer }: AnalyzeMeshInput): Promise<MeshMetrics> {
    const startTime = Date.now();
    const extension = fileName.slice(fileName.lastIndexOf('.')).toLowerCase();

    let result: Omit<MeshMetrics, 'file_bytes' | 'parse_ms'>;

    try {
        switch (extension) {
            case '.stl':
                result = analyzeStl(buffer);
                break;
            case '.obj':
                result = analyzeObj(buffer);
                break;
            case '.3mf':
                result = await analyze3mf(buffer);
                break;
            default:
                throw new Error(`UNSUPPORTED_FORMAT: File type '${extension}' is not supported.`);
        }
    } catch(err: any) {
        if (err.message.startsWith('UNSUPPORTED_FORMAT')) throw err;
        throw new Error(`PARSE_ERROR: Failed to parse ${extension} file. The file may be corrupt or malformed. Original error: ${err.message}`);
    }


    const endTime = Date.now();

    return {
        ...result,
        file_bytes: buffer.byteLength,
        parse_ms: endTime - startTime,
    };
}
