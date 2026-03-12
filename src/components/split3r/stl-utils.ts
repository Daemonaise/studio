// stl-utils.ts — Binary STL export + client-side mesh analysis
// Pure browser utilities, no Node.js APIs.

import * as THREE from "three";

// ─── Binary STL Export ────────────────────────────────────────────────────────
// Format: 80-byte header + uint32 count + 50 bytes/triangle
// (12 normal + 36 vertices + 2 attribute bytes)

export function geometryToSTLBuffer(geo: THREE.BufferGeometry): ArrayBuffer {
  // Work on non-indexed (every triangle has 3 vertex slots)
  const g = geo.index ? geo.toNonIndexed() : geo.clone();
  g.computeVertexNormals();

  const pos = g.attributes.position as THREE.BufferAttribute;
  const nrm = g.attributes.normal as THREE.BufferAttribute;
  const triCount = pos.count / 3;

  const buf = new ArrayBuffer(84 + triCount * 50);
  const view = new DataView(buf);

  // 80-byte ASCII header
  const header = "Split3r export — karasawalabs.com";
  for (let i = 0; i < Math.min(header.length, 80); i++) {
    view.setUint8(i, header.charCodeAt(i));
  }

  // Triangle count at offset 80
  view.setUint32(80, triCount, true);

  let offset = 84;
  for (let t = 0; t < triCount; t++) {
    const base = t * 3;

    // Face normal from first vertex's normal
    view.setFloat32(offset,      nrm.getX(base), true); offset += 4;
    view.setFloat32(offset,      nrm.getY(base), true); offset += 4;
    view.setFloat32(offset,      nrm.getZ(base), true); offset += 4;

    // 3 vertices
    for (let v = 0; v < 3; v++) {
      view.setFloat32(offset,     pos.getX(base + v), true); offset += 4;
      view.setFloat32(offset,     pos.getY(base + v), true); offset += 4;
      view.setFloat32(offset,     pos.getZ(base + v), true); offset += 4;
    }

    // Attribute byte count (always 0)
    view.setUint16(offset, 0, true); offset += 2;
  }

  return buf;
}

export function downloadBlob(buf: ArrayBuffer, fileName: string, mime = "model/stl") {
  const blob = new Blob([buf], { type: mime });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href     = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── OBJ Export ───────────────────────────────────────────────────────────────

/**
 * Serialise a BufferGeometry to a Wavefront OBJ string.
 * Each vertex has a paired normal; faces use v//vn syntax (no UV).
 */
export function geometryToOBJString(geo: THREE.BufferGeometry, name = "model"): string {
  const g = geo.index ? geo.toNonIndexed() : geo.clone();
  g.computeVertexNormals();
  const pos = g.attributes.position as THREE.BufferAttribute;
  const nrm = g.attributes.normal as THREE.BufferAttribute;
  const triCount = pos.count / 3;

  const lines: string[] = [
    "# Split3r export — karasawalabs.com",
    `o ${name}`,
    "",
  ];

  for (let i = 0; i < pos.count; i++) {
    lines.push(`v ${pos.getX(i).toFixed(6)} ${pos.getY(i).toFixed(6)} ${pos.getZ(i).toFixed(6)}`);
  }
  if (nrm) {
    for (let i = 0; i < nrm.count; i++) {
      lines.push(`vn ${nrm.getX(i).toFixed(6)} ${nrm.getY(i).toFixed(6)} ${nrm.getZ(i).toFixed(6)}`);
    }
  }
  lines.push("");
  for (let t = 0; t < triCount; t++) {
    const a = t * 3 + 1;
    lines.push(`f ${a}//${a} ${a + 1}//${a + 1} ${a + 2}//${a + 2}`);
  }

  return lines.join("\n");
}

export function downloadText(text: string, fileName: string, mime = "text/plain") {
  const blob = new Blob([text], { type: mime });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Mesh Analysis ────────────────────────────────────────────────────────────

export interface MeshAnalysisResult {
  triangleCount: number;
  vertexCount: number;
  isWatertight: boolean;
  openEdgeCount: number;
  nonManifoldEdgeCount: number;
  surfaceAreaMM2: number;
  volumeMM3: number;
  issues: string[];
}

// Analyze mesh watertightness and manifold property.
// Cap at MAX_TRIS to avoid blocking the main thread too long.
const MAX_ANALYSIS_TRIS = 200_000;

export function analyzeGeometry(geo: THREE.BufferGeometry): MeshAnalysisResult {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const pos = g.attributes.position as THREE.BufferAttribute;
  const triCount = pos.count / 3;
  const analyzedTris = Math.min(triCount, MAX_ANALYSIS_TRIS);
  const truncated = triCount > MAX_ANALYSIS_TRIS;

  const issues: string[] = [];
  if (truncated) {
    issues.push(`Analysis limited to first ${MAX_ANALYSIS_TRIS.toLocaleString()} triangles (mesh has ${triCount.toLocaleString()})`);
  }

  // Edge map: canonical edge key → count of adjacent triangles
  const edgeCounts = new Map<string, number>();
  let surfaceArea = 0;
  let volume = 0;

  const vA = new THREE.Vector3();
  const vB = new THREE.Vector3();
  const vC = new THREE.Vector3();
  const e1 = new THREE.Vector3();
  const e2 = new THREE.Vector3();
  const cross = new THREE.Vector3();

  for (let t = 0; t < analyzedTris; t++) {
    const b = t * 3;
    vA.set(pos.getX(b),     pos.getY(b),     pos.getZ(b));
    vB.set(pos.getX(b + 1), pos.getY(b + 1), pos.getZ(b + 1));
    vC.set(pos.getX(b + 2), pos.getY(b + 2), pos.getZ(b + 2));

    // Surface area
    e1.subVectors(vB, vA);
    e2.subVectors(vC, vA);
    cross.crossVectors(e1, e2);
    surfaceArea += 0.5 * cross.length();

    // Signed volume (divergence theorem)
    volume += vA.dot(new THREE.Vector3().crossVectors(vB, vC)) / 6;

    // Register 3 undirected edges (sorted vertex coords as key)
    const verts = [vA, vB, vC];
    for (let i = 0; i < 3; i++) {
      const va = verts[i];
      const vb = verts[(i + 1) % 3];
      const ka = `${va.x.toFixed(5)},${va.y.toFixed(5)},${va.z.toFixed(5)}`;
      const kb = `${vb.x.toFixed(5)},${vb.y.toFixed(5)},${vb.z.toFixed(5)}`;
      const key = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
      edgeCounts.set(key, (edgeCounts.get(key) ?? 0) + 1);
    }
  }

  let openEdges = 0;
  let nonManifoldEdges = 0;
  for (const count of edgeCounts.values()) {
    if (count === 1) openEdges++;
    else if (count > 2) nonManifoldEdges++;
  }

  const isWatertight = openEdges === 0 && nonManifoldEdges === 0 && !truncated;

  if (openEdges > 0) {
    issues.push(`${openEdges} open edge${openEdges > 1 ? "s" : ""} — mesh is not watertight`);
  }
  if (nonManifoldEdges > 0) {
    issues.push(`${nonManifoldEdges} non-manifold edge${nonManifoldEdges > 1 ? "s" : ""}`);
  }

  return {
    triangleCount: triCount,
    vertexCount: pos.count,
    isWatertight,
    openEdgeCount: openEdges,
    nonManifoldEdgeCount: nonManifoldEdges,
    surfaceAreaMM2: parseFloat(surfaceArea.toFixed(2)),
    volumeMM3: parseFloat(Math.abs(volume).toFixed(2)),
    issues,
  };
}
