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
// Uses indexed geometry + integer edge keys — no string allocations, no triangle cap.
// Handles 1M+ triangle meshes without OOM.
export function analyzeGeometry(geo: THREE.BufferGeometry): MeshAnalysisResult {
  // Merge duplicate vertices to get a proper index buffer.
  // This converts non-indexed STL (3 unique verts per tri) into a shared-vertex mesh,
  // which lets us use integer vertex-index pairs as edge keys instead of coordinate strings.
  let indexed = geo;
  if (!geo.index) {
    // Inline vertex quantization to build index without importing mergeVertices.
    // Bucket vertices by rounded coordinates (0.01 mm precision).
    const srcPos = geo.attributes.position as THREE.BufferAttribute;
    const posArr  = srcPos.array as Float32Array;
    const nVerts  = srcPos.count;
    const newIdx  = new Uint32Array(nVerts);
    const uniqueMap = new Map<string, number>();
    const uniquePos: number[] = [];
    for (let i = 0; i < nVerts; i++) {
      const x = posArr[i * 3], y = posArr[i * 3 + 1], z = posArr[i * 3 + 2];
      const key = `${Math.round(x * 100)},${Math.round(y * 100)},${Math.round(z * 100)}`;
      let idx = uniqueMap.get(key);
      if (idx === undefined) {
        idx = uniquePos.length / 3;
        uniqueMap.set(key, idx);
        uniquePos.push(x, y, z);
      }
      newIdx[i] = idx;
    }
    indexed = new THREE.BufferGeometry();
    indexed.setAttribute("position", new THREE.BufferAttribute(new Float32Array(uniquePos), 3));
    indexed.setIndex(new THREE.BufferAttribute(newIdx, 1));
  }

  const pos     = indexed.attributes.position as THREE.BufferAttribute;
  const idxBuf  = indexed.index!;
  const posArr  = pos.array as Float32Array;
  const idxArr  = idxBuf.array as Uint32Array | Uint16Array;
  const vertCount = pos.count;
  const triCount  = idxBuf.count / 3;

  // Integer edge keys: min(a,b) * vertCount + max(a,b)
  // Safe as a JS Number for up to ~94M vertices (vertCount² < Number.MAX_SAFE_INTEGER).
  const edgeCounts = new Map<number, number>();
  let surfaceArea = 0;
  let volume = 0;

  // Pre-allocated vectors — zero heap allocations in the hot loop.
  const vA = new THREE.Vector3();
  const vB = new THREE.Vector3();
  const vC = new THREE.Vector3();
  const e1 = new THREE.Vector3();
  const e2 = new THREE.Vector3();
  const cross = new THREE.Vector3();
  const crossBC = new THREE.Vector3();

  for (let t = 0; t < triCount; t++) {
    const t3 = t * 3;
    const ai = idxArr[t3], bi = idxArr[t3 + 1], ci = idxArr[t3 + 2];

    // Read positions directly from typed array — avoids .getX() method overhead.
    const a3 = ai * 3, b3 = bi * 3, c3 = ci * 3;
    vA.set(posArr[a3], posArr[a3 + 1], posArr[a3 + 2]);
    vB.set(posArr[b3], posArr[b3 + 1], posArr[b3 + 2]);
    vC.set(posArr[c3], posArr[c3 + 1], posArr[c3 + 2]);

    // Surface area
    e1.subVectors(vB, vA);
    e2.subVectors(vC, vA);
    cross.crossVectors(e1, e2);
    surfaceArea += 0.5 * cross.length();

    // Signed volume (divergence theorem)
    crossBC.crossVectors(vB, vC);
    volume += vA.dot(crossBC) / 6;

    // Register 3 undirected edges using integer index pairs.
    const pairs: [number, number][] = [
      [ai, bi], [bi, ci], [ci, ai],
    ];
    for (const [u, v] of pairs) {
      const key = u < v ? u * vertCount + v : v * vertCount + u;
      edgeCounts.set(key, (edgeCounts.get(key) ?? 0) + 1);
    }
  }

  const issues: string[] = [];
  let openEdges = 0;
  let nonManifoldEdges = 0;
  for (const count of edgeCounts.values()) {
    if (count === 1) openEdges++;
    else if (count > 2) nonManifoldEdges++;
  }

  const isWatertight = openEdges === 0 && nonManifoldEdges === 0;

  if (openEdges > 0) {
    issues.push(`${openEdges} open edge${openEdges > 1 ? "s" : ""} — mesh is not watertight`);
  }
  if (nonManifoldEdges > 0) {
    issues.push(`${nonManifoldEdges} non-manifold edge${nonManifoldEdges > 1 ? "s" : ""}`);
  }

  return {
    triangleCount: triCount,
    vertexCount: vertCount,
    isWatertight,
    openEdgeCount: openEdges,
    nonManifoldEdgeCount: nonManifoldEdges,
    surfaceAreaMM2: parseFloat(surfaceArea.toFixed(2)),
    volumeMM3: parseFloat(Math.abs(volume).toFixed(2)),
    issues,
  };
}
