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
  const header = "Karaslice export — karasawalabs.com";
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
    "# Karaslice export — karasawalabs.com",
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

export interface GeometryDiagnostics {
  /** Average edge length across all triangles (mm) */
  avgEdgeLengthMM: number;
  /** Median edge length (mm) — more robust than mean for mixed meshes */
  medianEdgeLengthMM: number;
  /** Number of boundary loops (connected chains of open edges) */
  boundaryLoopCount: number;
  /** Average gap width: mean length of open edges (mm) */
  avgGapWidthMM: number;
  /** Max gap width among open edges (mm) */
  maxGapWidthMM: number;
  /** How clustered are the open edges? 0 = evenly spread, 1 = highly concentrated */
  corruptionClustering: number;
  /** Number of degenerate triangles (near-zero area) */
  degenerateTriCount: number;
  /** Normal consistency: fraction of triangles whose normals agree with neighbors (0–1) */
  normalConsistency: number;
}

export interface MeshAnalysisResult {
  triangleCount: number;
  vertexCount: number;
  isWatertight: boolean;
  openEdgeCount: number;
  nonManifoldEdgeCount: number;
  surfaceAreaMM2: number;
  volumeMM3: number;
  issues: string[];
  diagnostics: GeometryDiagnostics;
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

  // Compute centroid for origin-centering — reduces divergence-theorem error on open meshes
  let centX = 0, centY = 0, centZ = 0;
  for (let i = 0; i < vertCount; i++) {
    const i3 = i * 3;
    centX += posArr[i3]; centY += posArr[i3 + 1]; centZ += posArr[i3 + 2];
  }
  centX /= vertCount; centY /= vertCount; centZ /= vertCount;

  for (let t = 0; t < triCount; t++) {
    const t3 = t * 3;
    const ai = idxArr[t3], bi = idxArr[t3 + 1], ci = idxArr[t3 + 2];

    // Read positions directly from typed array — avoids .getX() method overhead.
    const a3 = ai * 3, b3 = bi * 3, c3 = ci * 3;
    vA.set(posArr[a3] - centX, posArr[a3 + 1] - centY, posArr[a3 + 2] - centZ);
    vB.set(posArr[b3] - centX, posArr[b3 + 1] - centY, posArr[b3 + 2] - centZ);
    vC.set(posArr[c3] - centX, posArr[c3 + 1] - centY, posArr[c3 + 2] - centZ);

    // Surface area (position-independent, centroid offset doesn't matter)
    e1.subVectors(vB, vA);
    e2.subVectors(vC, vA);
    cross.crossVectors(e1, e2);
    surfaceArea += 0.5 * cross.length();

    // Signed volume (divergence theorem) — centered at centroid
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

  // ── Detailed geometry diagnostics ────────────────────────────────────────────

  // Edge lengths (all edges, for avg/median)
  const edgeLengths: number[] = [];
  const openEdgeLengths: number[] = [];
  const openEdgeVertices = new Set<number>(); // vertices touching open edges
  let degenerateTriCount = 0;
  const DEGEN_AREA_THRESHOLD = 1e-8;

  for (const [key, count] of edgeCounts.entries()) {
    const u = Math.floor(key / vertCount);
    const v = key % vertCount;
    const u3 = u * 3, v3 = v * 3;
    const dx = posArr[u3] - posArr[v3];
    const dy = posArr[u3 + 1] - posArr[v3 + 1];
    const dz = posArr[u3 + 2] - posArr[v3 + 2];
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    edgeLengths.push(len);
    if (count === 1) {
      openEdgeLengths.push(len);
      openEdgeVertices.add(u);
      openEdgeVertices.add(v);
    }
  }

  // Degenerate triangle count
  for (let t = 0; t < triCount; t++) {
    const t3 = t * 3;
    const ai = idxArr[t3], bi = idxArr[t3 + 1], ci = idxArr[t3 + 2];
    const a3 = ai * 3, b3 = bi * 3, c3 = ci * 3;
    vA.set(posArr[a3], posArr[a3 + 1], posArr[a3 + 2]);
    vB.set(posArr[b3], posArr[b3 + 1], posArr[b3 + 2]);
    vC.set(posArr[c3], posArr[c3 + 1], posArr[c3 + 2]);
    e1.subVectors(vB, vA);
    e2.subVectors(vC, vA);
    cross.crossVectors(e1, e2);
    if (cross.lengthSq() < DEGEN_AREA_THRESHOLD) degenerateTriCount++;
  }

  // Edge length stats
  edgeLengths.sort((a, b) => a - b);
  const avgEdgeLengthMM = edgeLengths.length > 0
    ? edgeLengths.reduce((s, l) => s + l, 0) / edgeLengths.length
    : 0;
  const medianEdgeLengthMM = edgeLengths.length > 0
    ? edgeLengths[Math.floor(edgeLengths.length / 2)]
    : 0;

  // Open edge gap stats
  const avgGapWidthMM = openEdgeLengths.length > 0
    ? openEdgeLengths.reduce((s, l) => s + l, 0) / openEdgeLengths.length
    : 0;
  const maxGapWidthMM = openEdgeLengths.length > 0
    ? Math.max(...openEdgeLengths)
    : 0;

  // Boundary loop count: walk open edges to count connected chains
  let boundaryLoopCount = 0;
  if (openEdges > 0) {
    // Build adjacency for open-edge vertices only
    const adj = new Map<number, number[]>();
    for (const [key, count] of edgeCounts.entries()) {
      if (count !== 1) continue;
      const u = Math.floor(key / vertCount);
      const v = key % vertCount;
      if (!adj.has(u)) adj.set(u, []);
      if (!adj.has(v)) adj.set(v, []);
      adj.get(u)!.push(v);
      adj.get(v)!.push(u);
    }
    const visited = new Set<number>();
    for (const start of adj.keys()) {
      if (visited.has(start)) continue;
      boundaryLoopCount++;
      const stack = [start];
      while (stack.length > 0) {
        const n = stack.pop()!;
        if (visited.has(n)) continue;
        visited.add(n);
        for (const nb of adj.get(n) ?? []) {
          if (!visited.has(nb)) stack.push(nb);
        }
      }
    }
  }

  // Corruption clustering: how spatially concentrated are open-edge vertices?
  // 0 = spread across whole mesh, 1 = all in one spot
  let corruptionClustering = 0;
  if (openEdgeVertices.size > 1) {
    // Compute centroid of open-edge vertices
    let cx = 0, cy = 0, cz = 0;
    for (const vi of openEdgeVertices) {
      cx += posArr[vi * 3]; cy += posArr[vi * 3 + 1]; cz += posArr[vi * 3 + 2];
    }
    const n = openEdgeVertices.size;
    cx /= n; cy /= n; cz /= n;

    // Std dev of open-edge vertices from their centroid
    let sumSq = 0;
    for (const vi of openEdgeVertices) {
      const dx = posArr[vi * 3] - cx, dy = posArr[vi * 3 + 1] - cy, dz = posArr[vi * 3 + 2] - cz;
      sumSq += dx * dx + dy * dy + dz * dz;
    }
    const openStdDev = Math.sqrt(sumSq / n);

    // Compare to mesh bounding box diagonal
    const bb = new THREE.Box3();
    bb.setFromBufferAttribute(pos);
    const diag = bb.getSize(new THREE.Vector3()).length();
    // If open edges span < 10% of mesh diagonal → highly clustered
    corruptionClustering = diag > 0 ? Math.max(0, Math.min(1, 1 - (openStdDev / (diag * 0.5)))) : 0;
  }

  // Normal consistency: check if adjacent triangles agree on winding
  // Sample up to 50k edges for performance
  let consistentCount = 0;
  let checkedCount = 0;
  const maxCheck = 50000;
  // Build edge→triangle adjacency for consistency check
  const edgeTris = new Map<number, number[]>();
  for (let t = 0; t < triCount && edgeTris.size < maxCheck * 3; t++) {
    const t3 = t * 3;
    const ai2 = idxArr[t3], bi2 = idxArr[t3 + 1], ci2 = idxArr[t3 + 2];
    for (const [eu, ev] of [[ai2, bi2], [bi2, ci2], [ci2, ai2]] as [number, number][]) {
      const ek = eu < ev ? eu * vertCount + ev : ev * vertCount + eu;
      if (!edgeTris.has(ek)) edgeTris.set(ek, []);
      edgeTris.get(ek)!.push(t);
    }
  }

  const nA = new THREE.Vector3();
  const nB2 = new THREE.Vector3();
  const eA1 = new THREE.Vector3(), eA2 = new THREE.Vector3();
  const eB1 = new THREE.Vector3(), eB2 = new THREE.Vector3();
  const cA = new THREE.Vector3(), cB = new THREE.Vector3();

  for (const tris of edgeTris.values()) {
    if (tris.length !== 2) continue;
    if (checkedCount >= maxCheck) break;
    const [t1, t2] = tris;
    // Compute normals of both triangles
    const t1_3 = t1 * 3, t2_3 = t2 * 3;
    vA.set(posArr[idxArr[t1_3] * 3], posArr[idxArr[t1_3] * 3 + 1], posArr[idxArr[t1_3] * 3 + 2]);
    vB.set(posArr[idxArr[t1_3 + 1] * 3], posArr[idxArr[t1_3 + 1] * 3 + 1], posArr[idxArr[t1_3 + 1] * 3 + 2]);
    vC.set(posArr[idxArr[t1_3 + 2] * 3], posArr[idxArr[t1_3 + 2] * 3 + 1], posArr[idxArr[t1_3 + 2] * 3 + 2]);
    eA1.subVectors(vB, vA); eA2.subVectors(vC, vA); cA.crossVectors(eA1, eA2);
    nA.copy(cA).normalize();

    vA.set(posArr[idxArr[t2_3] * 3], posArr[idxArr[t2_3] * 3 + 1], posArr[idxArr[t2_3] * 3 + 2]);
    vB.set(posArr[idxArr[t2_3 + 1] * 3], posArr[idxArr[t2_3 + 1] * 3 + 1], posArr[idxArr[t2_3 + 1] * 3 + 2]);
    vC.set(posArr[idxArr[t2_3 + 2] * 3], posArr[idxArr[t2_3 + 2] * 3 + 1], posArr[idxArr[t2_3 + 2] * 3 + 2]);
    eB1.subVectors(vB, vA); eB2.subVectors(vC, vA); cB.crossVectors(eB1, eB2);
    nB2.copy(cB).normalize();

    // Adjacent triangles should have normals pointing roughly the same way
    if (nA.dot(nB2) > 0) consistentCount++;
    checkedCount++;
  }
  const normalConsistency = checkedCount > 0 ? consistentCount / checkedCount : 1;

  const diagnostics: GeometryDiagnostics = {
    avgEdgeLengthMM: parseFloat(avgEdgeLengthMM.toFixed(3)),
    medianEdgeLengthMM: parseFloat(medianEdgeLengthMM.toFixed(3)),
    boundaryLoopCount,
    avgGapWidthMM: parseFloat(avgGapWidthMM.toFixed(3)),
    maxGapWidthMM: parseFloat(maxGapWidthMM.toFixed(3)),
    corruptionClustering: parseFloat(corruptionClustering.toFixed(3)),
    degenerateTriCount,
    normalConsistency: parseFloat(normalConsistency.toFixed(3)),
  };

  // Bounding box volume as upper bound — divergence theorem can overshoot on open meshes
  indexed.computeBoundingBox();
  const bboxSize = new THREE.Vector3();
  indexed.boundingBox!.getSize(bboxSize);
  const bboxVol = bboxSize.x * bboxSize.y * bboxSize.z;
  const clampedVolume = Math.min(Math.abs(volume), bboxVol);

  return {
    triangleCount: triCount,
    vertexCount: vertCount,
    isWatertight,
    openEdgeCount: openEdges,
    nonManifoldEdgeCount: nonManifoldEdges,
    surfaceAreaMM2: parseFloat(surfaceArea.toFixed(2)),
    volumeMM3: parseFloat(clampedVolume.toFixed(2)),
    issues,
    diagnostics,
  };
}
