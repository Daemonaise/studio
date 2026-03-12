// manifold-engine.ts — manifold-3d lazy loader and mesh splitting engine
// All operations run on the main thread with setTimeout(0) yields between
// heavy steps so the UI spinner can render.

import * as THREE from "three";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SplitPart {
  geometry: THREE.BufferGeometry;
  label: string;
  triangleCount: number;
  volumeMM3: number;
  bbox: { x: number; y: number; z: number };
}

export interface EngineCutPlane {
  /** Unit normal pointing toward the half-space to keep (positive side). */
  normal: [number, number, number];
  /** Scalar: dot(normal, point_on_plane) */
  originOffset: number;
}

export type ProgressCallback = (step: number, total: number, message: string) => void;

// ─── Lazy singleton ───────────────────────────────────────────────────────────

// Use `any` for the manifold API to avoid fighting the library's complex internal types.
// Runtime correctness is validated by the actual WASM operations.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ManifoldAPI = any;

let _api: ManifoldAPI | null = null;
let _loadPromise: Promise<ManifoldAPI> | null = null;

export async function getManifoldAPI(): Promise<ManifoldAPI> {
  if (_api) return _api;
  if (_loadPromise) return _loadPromise;

  _loadPromise = (async () => {
    // Load manifold from /public/manifold/manifold.js (copied from node_modules).
    // Using a URL string in new Function() bypasses webpack AND turbopack static
    // analysis so neither bundler tries to parse manifold's Node.js-only imports.
    // At runtime the browser loads the file natively; the Node.js import("module")
    // inside manifold.js is behind an ENVIRONMENT_IS_NODE guard and never executes.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const manifoldLoad = new Function('return import("/manifold/manifold.js")') as () => Promise<any>;
    const mod = await manifoldLoad();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const factory = (mod.default ?? mod) as (opts?: object) => Promise<any>;
    const api = await factory();
    api.setup();
    _api = api;
    return api;
  })();

  return _loadPromise;
}

// ─── Geometry conversion ──────────────────────────────────────────────────────

/** Convert a Three.js BufferGeometry to flat typed arrays for manifold. */
function geometryToArrays(geo: THREE.BufferGeometry): {
  vertProperties: Float32Array;
  triVerts: Uint32Array;
} {
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const vCount = pos.count;

  const vertProperties = new Float32Array(vCount * 3);
  for (let i = 0; i < vCount; i++) {
    vertProperties[i * 3]     = pos.getX(i);
    vertProperties[i * 3 + 1] = pos.getY(i);
    vertProperties[i * 3 + 2] = pos.getZ(i);
  }

  let triVerts: Uint32Array;
  if (geo.index) {
    triVerts = new Uint32Array(geo.index.count);
    for (let i = 0; i < geo.index.count; i++) {
      triVerts[i] = geo.index.getX(i);
    }
  } else {
    // Non-indexed: sequential indices
    triVerts = new Uint32Array(vCount);
    for (let i = 0; i < vCount; i++) triVerts[i] = i;
  }

  return { vertProperties, triVerts };
}

/** Convert a manifold getMesh() result back to a Three.js BufferGeometry. */
function meshToGeometry(mesh: { vertProperties: Float32Array; triVerts: Uint32Array; numProp: number }): THREE.BufferGeometry {
  const { numProp, vertProperties, triVerts } = mesh;
  const vertCount = vertProperties.length / numProp;

  // Extract XYZ (first 3 components, in case numProp > 3)
  let positions: Float32Array;
  if (numProp === 3) {
    positions = new Float32Array(vertProperties);
  } else {
    positions = new Float32Array(vertCount * 3);
    for (let i = 0; i < vertCount; i++) {
      positions[i * 3]     = vertProperties[i * numProp];
      positions[i * 3 + 1] = vertProperties[i * numProp + 1];
      positions[i * 3 + 2] = vertProperties[i * numProp + 2];
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setIndex(new THREE.BufferAttribute(new Uint32Array(triVerts), 1));
  geo.computeVertexNormals();
  return geo;
}

// ─── Cut plane helpers ────────────────────────────────────────────────────────

/** Convert a viewport CutPlane (0–1 normalized) to world-space EngineCutPlane. */
export function viewportPlaneToEngine(
  axis: "x" | "y" | "z",
  position: number,
  bbox: THREE.Box3
): EngineCutPlane {
  const size = new THREE.Vector3();
  bbox.getSize(size);

  if (axis === "x") {
    const worldX = bbox.min.x + size.x * position;
    return { normal: [1, 0, 0], originOffset: worldX };
  } else if (axis === "y") {
    const worldY = bbox.min.y + size.y * position;
    return { normal: [0, 1, 0], originOffset: worldY };
  } else {
    const worldZ = bbox.min.z + size.z * position;
    return { normal: [0, 0, 1], originOffset: worldZ };
  }
}

// ─── Main split function ──────────────────────────────────────────────────────

/**
 * Split a Three.js BufferGeometry along N planes using manifold-3d boolean ops.
 *
 * Each plane divides every existing region into two halves. Runs on the main
 * thread; yields via setTimeout(0) between planes so the spinner stays visible.
 *
 * @returns Array of SplitPart, one per generated region.
 */
export async function splitMesh(
  geo: THREE.BufferGeometry,
  planes: EngineCutPlane[],
  onProgress: ProgressCallback
): Promise<SplitPart[]> {
  onProgress(0, planes.length, "Loading manifold engine…");
  await yieldToUI();

  const api = await getManifoldAPI();
  const { Manifold } = api;

  onProgress(0, planes.length, "Repairing mesh…");
  await yieldToUI();

  const { mergeVertices, toCreasedNormals } = await import("three/examples/jsm/utils/BufferGeometryUtils.js");
  const { Mesh } = api;

  // Always start from non-indexed so mergeVertices can find ALL duplicate vertices.
  // (Indexed geometries may already group distant vertices under the same index,
  //  causing mergeVertices to miss close-but-unshared pairs.)
  const nonIndexed = geo.index ? geo.toNonIndexed() : geo;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let rootManifold: any = null;

  /** Run all repair steps on an indexed geometry and attempt Manifold construction. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function tryBuild(g: THREE.BufferGeometry): any | null {
    const g1 = removeDegenerates(g);
    const g2 = deduplicateTris(g1);
    const g3 = fixWinding(g2);
    // fixWinding makes winding CONSISTENT within each component but doesn't know
    // which direction is "outward".  If the BFS seed was an inverted triangle the
    // whole component ends up inside-out → manifold returns isEmpty()=true.
    const g4 = ensureOutwardNormals(g3);
    const { vertProperties, triVerts } = geometryToArrays(g4);
    try {
      const c = new Manifold(new Mesh({ numProp: 3, vertProperties, triVerts }));
      return c.isEmpty() ? null : c;
    } catch {
      return null;
    }
  }

  // ── Phase 0: Diagnose ──────────────────────────────────────────────────────
  // Do a tight weld first so we're working with an indexed geometry, then
  // measure the actual gap distances between boundary vertices.  This tells us
  // exactly what weld tolerance is needed instead of blind trial-and-error.
  onProgress(0, planes.length, "Inspecting mesh…");
  await yieldToUI();

  const tightMerged = mergeVertices(nonIndexed, 1e-4);
  const dx = diagnoseMesh(tightMerged);

  if (dx.openEdges > 0) {
    const gapStr = dx.maxGapMM > 0 ? `, max gap ${dx.maxGapMM.toFixed(2)} mm` : "";
    const tolStr = `recommended weld ±${dx.recommendedTol.toFixed(dx.recommendedTol < 0.01 ? 4 : dx.recommendedTol < 1 ? 2 : 1)} mm`;
    onProgress(0, planes.length,
      `Repairing mesh — ${dx.openEdges} open edges${gapStr}, ${tolStr}…`
    );
  } else {
    onProgress(0, planes.length, "Repairing mesh — no open edges, checking topology…");
  }
  await yieldToUI();

  // ── Phase 1: Smart weld using diagnosed tolerance ──────────────────────────
  // Try the diagnosed tolerance first (jump straight to the answer), then walk
  // upward through coarser tolerances in case the gap sample was unrepresentative.
  const fallbackTols = [0.01, 0.1, 1.0, 5.0];
  const orderedTols  = [dx.recommendedTol, ...fallbackTols.filter(t => t > dx.recommendedTol * 1.1)];

  let lastCleaned: THREE.BufferGeometry | null = null;
  for (let ti = 0; ti < orderedTols.length; ti++) {
    const tol = orderedTols[ti];
    if (ti > 0) {
      onProgress(0, planes.length, `Repairing mesh — widening weld to ±${tol} mm (pass ${ti + 1}/${orderedTols.length})…`);
      await yieldToUI();
    }
    const merged = mergeVertices(nonIndexed, tol);
    lastCleaned = merged;
    rootManifold = tryBuild(merged);
    if (rootManifold) break;
  }

  // ── Phase 2: Hole filling + re-weld ───────────────────────────────────────
  if (!rootManifold && lastCleaned) {
    onProgress(0, planes.length, "Repairing mesh — filling open holes…");
    await yieldToUI();

    const filled = fillHoles(lastCleaned);
    if (filled !== lastCleaned) {
      const niFilled = filled.index ? filled.toNonIndexed() : filled;
      for (const tol of orderedTols) {
        const merged = mergeVertices(niFilled, tol);
        rootManifold = tryBuild(merged);
        if (rootManifold) break;
      }
    }
  }

  // ── Phase 3: Direct plane-clipping fallback ───────────────────────────────
  // Manifold-3d requires topologically perfect input; other slicers don't.
  // Self-intersecting geometry (scan data, organic shapes) can never pass
  // manifold validation, but can still be split correctly by clipping each
  // triangle individually against the plane without needing a solid manifold.
  if (!rootManifold) {
    onProgress(0, planes.length,
      "Manifold repair failed — using direct plane-clipping (self-intersecting geometry detected)…"
    );
    await yieldToUI();
    return splitMeshByClipping(geo, planes, onProgress);
  }

  onProgress(0, planes.length, "Building manifold mesh…");
  await yieldToUI();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let regions: any[] = [rootManifold];

  // Apply each cut plane
  for (let pi = 0; pi < planes.length; pi++) {
    const { normal, originOffset } = planes[pi];
    onProgress(pi, planes.length, `Cutting plane ${pi + 1} of ${planes.length}…`);
    await yieldToUI();

    const negNormal: [number, number, number] = [-normal[0], -normal[1], -normal[2]];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const nextRegions: any[] = [];

    for (const region of regions) {
      // trimByPlane keeps: dot(normal, point) >= originOffset
      const posHalf = region.trimByPlane(normal, originOffset);
      const negHalf = region.trimByPlane(negNormal, -originOffset);

      if (!posHalf.isEmpty()) nextRegions.push(posHalf);
      if (!negHalf.isEmpty()) nextRegions.push(negHalf);
    }

    regions = nextRegions;
  }

  onProgress(planes.length, planes.length, "Converting parts…");
  await yieldToUI();

  // Convert manifold instances back to Three.js geometries.
  // toCreasedNormals splits vertices at sharp edges (cap↔surface boundary)
  // so normals don't get averaged across the cut seam → eliminates jagged edges.
  const CREASE_ANGLE = Math.PI / 6; // 30° — sharp cap edges split, smooth surfaces preserved
  const parts: SplitPart[] = regions.map((region, i) => {
    const mesh = region.getMesh();
    const rawGeo = meshToGeometry(mesh);
    // Compute volume on indexed geometry BEFORE toCreasedNormals (which produces non-indexed)
    const vol = computeGeometryVolume(rawGeo);
    // toCreasedNormals → non-indexed; mergeVertices re-indexes for GPU efficiency
    // while preserving split normals at crease edges (same pos + different normal = kept separate)
    const geometry = mergeVertices(toCreasedNormals(rawGeo, CREASE_ANGLE));
    geometry.computeBoundingBox();
    const bb = geometry.boundingBox!;
    const size = new THREE.Vector3();
    bb.getSize(size);

    return {
      geometry,
      label: `Part ${i + 1}`,
      triangleCount: mesh.triVerts.length / 3,
      volumeMM3: parseFloat(vol.toFixed(2)),
      bbox: {
        x: parseFloat(size.x.toFixed(1)),
        y: parseFloat(size.y.toFixed(1)),
        z: parseFloat(size.z.toFixed(1)),
      },
    };
  });

  return parts;
}

function yieldToUI(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

// ─── Direct plane-clipping fallback (works on any mesh) ──────────────────────

/**
 * Clip a geometry against a half-space n·x ≥ offset.
 *
 * Returns [positive half, negative half] as indexed geometries whose cut
 * boundary is open (boundary edges have no twin).  fillHoles() caps them.
 *
 * T-junction fix: the geometry is first indexed via exactMergeVertices so
 * every vertex has a unique index.  Intersection points are stored in a
 * Map keyed on the canonical edge pair (min(vi,vj), max(vi,vj)).  When two
 * triangles share edge (V1,V2) and both are cut, they query the same cache
 * key and receive the identical vertex index — one vertex, not two nearly-
 * identical copies.  No post-hoc weld needed to close the cut boundary.
 */
function clipByPlane(
  geo: THREE.BufferGeometry,
  n: THREE.Vector3,
  offset: number,
): [THREE.BufferGeometry | null, THREE.BufferGeometry | null] {
  // Ensure indexed so every vertex has a stable index for edge-key lookup.
  const src  = geo.index ? geo : exactMergeVertices(geo);
  const pos  = src.attributes.position as THREE.BufferAttribute;
  const idx  = src.index!;
  const nV   = pos.count;
  const nTris = idx.count / 3;

  // Signed distance per vertex; snap near-zero to zero for robust on-plane
  // classification (avoids creating a redundant intersection vertex for
  // vertices that already sit on the cut plane).
  const EPS  = 1e-10;
  const dist = new Float32Array(nV);
  for (let i = 0; i < nV; i++) {
    const d = n.x * pos.getX(i) + n.y * pos.getY(i) + n.z * pos.getZ(i) - offset;
    dist[i] = Math.abs(d) < EPS ? 0 : d;
  }

  // Shared position pool — both output halves reference the same array, so
  // intersection vertices added here are identical objects in memory.
  const px: number[] = [], py: number[] = [], pz: number[] = [];
  for (let i = 0; i < nV; i++) {
    px.push(pos.getX(i)); py.push(pos.getY(i)); pz.push(pos.getZ(i));
  }

  // Edge cache: canonical key lo*nV+hi → index into px/py/pz.
  // Safe for vertex counts up to √(Number.MAX_SAFE_INTEGER) ≈ 94M.
  const edgeCache = new Map<number, number>();

  const getOrCreate = (i: number, j: number): number => {
    // If either endpoint is exactly on the plane, reuse it directly —
    // no new vertex needed, no cache entry.
    if (dist[i] === 0) return i;
    if (dist[j] === 0) return j;
    const lo = i < j ? i : j, hi = i < j ? j : i;
    const key = lo * nV + hi;
    let vi = edgeCache.get(key);
    if (vi === undefined) {
      const t = dist[i] / (dist[i] - dist[j]);
      vi = px.length;
      px.push(pos.getX(i) + t * (pos.getX(j) - pos.getX(i)));
      py.push(pos.getY(i) + t * (pos.getY(j) - pos.getY(i)));
      pz.push(pos.getZ(i) + t * (pos.getZ(j) - pos.getZ(i)));
      edgeCache.set(key, vi);
    }
    return vi;
  };

  const posIdx: number[] = [], negIdx: number[] = [];

  for (let t = 0; t < nTris; t++) {
    const ai = idx.getX(t * 3), bi = idx.getX(t * 3 + 1), ci = idx.getX(t * 3 + 2);
    const da = dist[ai], db = dist[bi], dc = dist[ci];
    const sa = da >= 0, sb = db >= 0, sc = dc >= 0;

    if (sa && sb && sc) { posIdx.push(ai, bi, ci); continue; }
    if (!sa && !sb && !sc) { negIdx.push(ai, bi, ci); continue; }

    // Mixed — rotate so the solo vertex (opposite sign from the other two) is first.
    const raw   = [ai, bi, ci];
    const signs = [sa, sb, sc];
    const nPos  = (sa ? 1 : 0) + (sb ? 1 : 0) + (sc ? 1 : 0);
    const si    = nPos === 1 ? signs.findIndex(s => s) : signs.findIndex(s => !s);
    const i0 = raw[si], i1 = raw[(si + 1) % 3], i2 = raw[(si + 2) % 3];
    const onPos = dist[i0] >= 0;

    // P = intersection on edge i0→i1, Q = intersection on edge i0→i2.
    // getOrCreate ensures both triangles sharing edge (i0,i1) get the same P.
    const P = getOrCreate(i0, i1);
    const Q = getOrCreate(i0, i2);

    const solo  = onPos ? posIdx : negIdx;
    const other = onPos ? negIdx : posIdx;

    // Solo side: one triangle preserving winding.
    // Skip degenerate triangles — when a vertex is exactly on the cut plane,
    // getOrCreate returns the original index, which can collapse an edge to
    // a point.  The zero-area triangle would inject false twin edges into
    // the half-edge set, hiding real boundary edges from fillHoles and
    // producing incomplete caps (visible as jagged/sawtooth cut boundaries).
    if (i0 !== P && P !== Q && Q !== i0) solo.push(i0, P, Q);
    // Other side: quad split into two triangles preserving winding
    if (i1 !== i2 && i2 !== Q && Q !== i1) other.push(i1, i2, Q);
    if (i1 !== Q  && Q !== P  && P !== i1) other.push(i1, Q,  P);
  }

  // Build the shared Float32Array from the position pool once.
  const posF32 = new Float32Array(px.length * 3);
  for (let i = 0; i < px.length; i++) {
    posF32[i * 3] = px[i]; posF32[i * 3 + 1] = py[i]; posF32[i * 3 + 2] = pz[i];
  }

  const make = (tris: number[]): THREE.BufferGeometry | null => {
    if (tris.length < 3) return null;
    const g = new THREE.BufferGeometry();
    // Each half gets its own Float32Array view so they can be disposed independently.
    g.setAttribute("position", new THREE.BufferAttribute(posF32.slice(), 3));
    g.setIndex(new THREE.BufferAttribute(new Uint32Array(tris), 1));
    return g;
  };
  return [make(posIdx), make(negIdx)];
}

/** Split geo using direct triangle-plane clipping — no manifold required. */
async function splitMeshByClipping(
  geo: THREE.BufferGeometry,
  planes: EngineCutPlane[],
  onProgress: ProgressCallback,
): Promise<SplitPart[]> {
  // Pre-index with exact vertex dedup so clipByPlane's edge-cache keys are
  // reliable: two adjacent triangles sharing edge (V1,V2) get the same vertex
  // indices and therefore the same cache key → identical intersection vertex.
  let halves: THREE.BufferGeometry[] = [geo.index ? geo : exactMergeVertices(geo)];

  for (let pi = 0; pi < planes.length; pi++) {
    const { normal, originOffset } = planes[pi];
    onProgress(pi, planes.length, `Cutting plane ${pi + 1} of ${planes.length} (direct clipping)…`);
    await yieldToUI();

    const next: THREE.BufferGeometry[] = [];
    for (const half of halves) {
      const [pos, neg] = clipByPlane(half, new THREE.Vector3(...normal), originOffset);
      if (pos) next.push(pos);
      if (neg) next.push(neg);
    }
    halves = next;
  }

  onProgress(planes.length, planes.length, "Capping cut surfaces…");
  await yieldToUI();

  // toCreasedNormals splits vertices at sharp edges (cap↔surface boundary)
  // so normals don't get averaged across the cut seam → eliminates jagged edges.
  const { toCreasedNormals: toCreased, mergeVertices: mergeVerts } = await import("three/examples/jsm/utils/BufferGeometryUtils.js");
  const CREASE_ANGLE = Math.PI / 6; // 30°

  const parts: SplitPart[] = [];
  for (let i = 0; i < halves.length; i++) {
    const capped = fillHoles(halves[i]);
    // Compute volume on indexed geometry BEFORE toCreasedNormals (which produces non-indexed)
    const vol = computeGeometryVolume(capped);
    // toCreasedNormals → non-indexed; mergeVertices re-indexes for GPU efficiency
    const geometry = mergeVerts(toCreased(capped, CREASE_ANGLE));
    geometry.computeBoundingBox();
    const bb = geometry.boundingBox!;
    const size = new THREE.Vector3();
    bb.getSize(size);
    parts.push({
      geometry,
      label: `Part ${i + 1}`,
      triangleCount: capped.index
        ? capped.index.count / 3
        : (capped.attributes.position?.count ?? 0) / 3,
      volumeMM3: parseFloat(vol.toFixed(2)),
      bbox: {
        x: parseFloat(size.x.toFixed(1)),
        y: parseFloat(size.y.toFixed(1)),
        z: parseFloat(size.z.toFixed(1)),
      },
    });
  }
  return parts;
}

// ─── Mesh Diagnostics ────────────────────────────────────────────────────────

interface MeshDiagnosis {
  openEdges: number;          // boundary edges (each missing its reverse half-edge)
  nonManifoldEdges: number;   // edges shared by 3+ triangles
  degenerateTris: number;     // zero-area faces
  duplicateTris: number;      // faces sharing the same 3 vertices
  maxGapMM: number;           // largest gap between boundary vertex pairs (mm)
  recommendedTol: number;     // 1.5 × p5 gap, clamped to [1e-4, 0.1]
}

/**
 * Inspect an indexed geometry and measure all the ways it might fail manifold
 * validation.  The key output is `recommendedTol`: the smallest weld radius
 * likely to close every open seam, computed from the actual gap distances
 * between boundary vertices rather than blind guessing.
 *
 * Gap measurement samples up to 500 boundary vertices so it stays O(250 k)
 * even on million-triangle meshes.
 */
function diagnoseMesh(geo: THREE.BufferGeometry): MeshDiagnosis {
  const none: MeshDiagnosis = {
    openEdges: 0, nonManifoldEdges: 0, degenerateTris: 0, duplicateTris: 0,
    maxGapMM: 0, recommendedTol: 1e-4,
  };
  if (!geo.index) return none;

  const pos    = geo.attributes.position as THREE.BufferAttribute;
  const idx    = geo.index;
  const nVerts = pos.count;
  const nTris  = idx.count / 3;

  // ── Edge frequency (undirected) ──────────────────────────────────────────
  const edgeFreq = new Map<number, number>();
  for (let t = 0; t < nTris; t++) {
    const a = idx.getX(t * 3), b = idx.getX(t * 3 + 1), c = idx.getX(t * 3 + 2);
    for (const [u, v] of [[a, b], [b, c], [c, a]] as [number, number][]) {
      const key = Math.min(u, v) * nVerts + Math.max(u, v);
      edgeFreq.set(key, (edgeFreq.get(key) ?? 0) + 1);
    }
  }

  let openEdges = 0, nonManifoldEdges = 0;
  const boundaryVerts = new Set<number>();
  for (const [key, count] of edgeFreq) {
    if (count === 1) {
      openEdges++;
      const lo = Math.floor(key / nVerts);
      boundaryVerts.add(lo);
      boundaryVerts.add(key - lo * nVerts);
    } else if (count > 2) {
      nonManifoldEdges++;
    }
  }

  // ── Degenerate triangles ─────────────────────────────────────────────────
  let degenerateTris = 0;
  const dA = new THREE.Vector3(), dB = new THREE.Vector3(), dC = new THREE.Vector3();
  for (let t = 0; t < nTris; t++) {
    const ai = idx.getX(t * 3), bi = idx.getX(t * 3 + 1), ci = idx.getX(t * 3 + 2);
    if (ai === bi || bi === ci || ci === ai) { degenerateTris++; continue; }
    dA.fromBufferAttribute(pos, ai);
    dB.fromBufferAttribute(pos, bi).sub(dA);
    dC.fromBufferAttribute(pos, ci).sub(dA);
    if (dB.cross(dC).length() <= 1e-10) degenerateTris++;
  }

  // ── Duplicate triangles ──────────────────────────────────────────────────
  const triSeen = new Set<number>();
  let duplicateTris = 0;
  for (let t = 0; t < nTris; t++) {
    const a = idx.getX(t * 3), b = idx.getX(t * 3 + 1), c = idx.getX(t * 3 + 2);
    const s = [a, b, c].sort((x, y) => x - y);
    const key = s[0] * 4_000_000_000 + s[1] * 100_000 + s[2];
    if (triSeen.has(key)) duplicateTris++; else triSeen.add(key);
  }

  // ── Gap measurement between boundary vertices ────────────────────────────
  // Sample up to 500 boundary verts → at most 250 k distance checks
  const bvArr = Array.from(boundaryVerts);
  const gaps: number[] = [];

  if (bvArr.length > 1) {
    const maxSample = 500;
    const step = Math.max(1, Math.ceil(bvArr.length / maxSample));
    const sample = bvArr.filter((_, i) => i % step === 0);

    for (const vi of sample) {
      const vx = pos.getX(vi), vy = pos.getY(vi), vz = pos.getZ(vi);
      let minDist = Infinity;
      for (const vj of sample) {
        if (vi === vj) continue;
        const dx = pos.getX(vj) - vx, dy = pos.getY(vj) - vy, dz = pos.getZ(vj) - vz;
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (d > 0 && d < minDist) minDist = d;
      }
      if (minDist < Infinity) gaps.push(minDist);
    }
  }

  gaps.sort((a, b) => a - b);
  const maxGapMM = gaps.at(-1) ?? 0;

  // 1.5× the minimum gap — use p5 (5th percentile) so we capture actual seam gaps,
  // not edge-length distances between adjacent boundary vertices.
  // Cap at 0.1 mm: real STL seam gaps are always < 0.1 mm; edge lengths aren't.
  // splitMesh has its own fallback ladder (0.01 → 0.1 → 1.0 → 5.0) for larger gaps.
  const p5GapMM = gaps.length > 0 ? gaps[Math.floor(gaps.length * 0.05)] : 0;
  const refGap = p5GapMM > 0 ? p5GapMM : maxGapMM;
  const recommendedTol = refGap > 0
    ? Math.min(0.1, Math.max(1e-4, refGap * 1.5))
    : 1e-4;

  return { openEdges, nonManifoldEdges, degenerateTris, duplicateTris, maxGapMM, recommendedTol };
}

/**
 * If the mesh's signed volume is negative (all normals point inward), flip
 * every triangle so normals face outward.  This corrects meshes that become
 * globally inside-out after fixWinding() picks an inverted seed triangle.
 */
function ensureOutwardNormals(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  if (!geo.index) return geo;
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const idx = geo.index;
  let vol = 0;
  for (let t = 0; t < idx.count; t += 3) {
    const ai = idx.getX(t), bi = idx.getX(t + 1), ci = idx.getX(t + 2);
    const ax = pos.getX(ai), ay = pos.getY(ai), az = pos.getZ(ai);
    const bx = pos.getX(bi), by = pos.getY(bi), bz = pos.getZ(bi);
    const cx = pos.getX(ci), cy = pos.getY(ci), cz = pos.getZ(ci);
    vol += ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx);
  }
  if (vol >= 0) return geo; // already outward-facing
  // Inside-out: swap b↔c for every triangle
  const newIdx = new Uint32Array(idx.count);
  for (let t = 0; t < idx.count; t += 3) {
    newIdx[t]     = idx.getX(t);
    newIdx[t + 1] = idx.getX(t + 2);
    newIdx[t + 2] = idx.getX(t + 1);
  }
  const out = geo.clone();
  out.setIndex(new THREE.BufferAttribute(newIdx, 1));
  return out;
}

/** Remove triangles whose 3 vertex indices are identical to a previously seen triangle. */
function deduplicateTris(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  if (!geo.index) return geo;
  const idx = geo.index;
  const seen = new Set<number>();
  const good: number[] = [];
  let changed = false;

  for (let t = 0; t < idx.count; t += 3) {
    const a = idx.getX(t), b = idx.getX(t + 1), c = idx.getX(t + 2);
    // Canonical key independent of rotation: sort the three indices
    const s = [a, b, c].sort((x, y) => x - y);
    // Pack into a single number (safe for vertex counts up to ~2M)
    const key = s[0] * 4_000_000_000 + s[1] * 100_000 + s[2];
    if (!seen.has(key)) {
      seen.add(key);
      good.push(a, b, c);
    } else {
      changed = true;
    }
  }
  if (!changed) return geo;
  const out = geo.clone();
  out.setIndex(new THREE.BufferAttribute(new Uint32Array(good), 1));
  return out;
}

/**
 * Make triangle winding consistent across the mesh via BFS flood-fill.
 *
 * For each connected component, starts at a seed triangle and propagates:
 * if two adjacent triangles use a shared edge in the SAME direction they have
 * inconsistent winding (one is flipped); we flip it so all triangles in the
 * component face the same way.  Skips non-manifold edges (shared by 3+ tris).
 */
function fixWinding(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  if (!geo.index) return geo;

  const idx    = geo.index;
  const nVerts = (geo.attributes.position as THREE.BufferAttribute).count;
  const nTris  = idx.count / 3;

  // Map undirected edge key → list of { tri, directedForward }
  // directedForward=true means this tri uses the edge as (min→max)
  type EdgeEntry = { tri: number; fwd: boolean };
  const edgeMap = new Map<number, EdgeEntry[]>();

  for (let t = 0; t < nTris; t++) {
    const verts = [idx.getX(t * 3), idx.getX(t * 3 + 1), idx.getX(t * 3 + 2)];
    for (let e = 0; e < 3; e++) {
      const u = verts[e], v = verts[(e + 1) % 3];
      const lo = Math.min(u, v), hi = Math.max(u, v);
      const key = lo * nVerts + hi;
      const arr = edgeMap.get(key);
      const entry: EdgeEntry = { tri: t, fwd: u === lo };
      if (arr) arr.push(entry); else edgeMap.set(key, [entry]);
    }
  }

  // Build per-triangle edge key list for BFS traversal
  const triEdgeKeys: number[][] = new Array(nTris);
  for (let t = 0; t < nTris; t++) {
    const verts = [idx.getX(t * 3), idx.getX(t * 3 + 1), idx.getX(t * 3 + 2)];
    triEdgeKeys[t] = verts.map((u, e) => {
      const v = verts[(e + 1) % 3];
      const lo = Math.min(u, v), hi = Math.max(u, v);
      return lo * nVerts + hi;
    });
  }

  const visited   = new Uint8Array(nTris);
  const shouldFlip = new Uint8Array(nTris);

  // BFS over all components
  for (let seed = 0; seed < nTris; seed++) {
    if (visited[seed]) continue;
    visited[seed] = 1;
    const queue = [seed];

    while (queue.length > 0) {
      const t = queue.pop()!;
      for (const edgeKey of triEdgeKeys[t]) {
        const neighbors = edgeMap.get(edgeKey);
        if (!neighbors || neighbors.length !== 2) continue; // skip non-manifold or boundary
        const me  = neighbors[0].tri === t ? neighbors[0] : neighbors[1];
        const nb  = neighbors[0].tri === t ? neighbors[1] : neighbors[0];
        if (visited[nb.tri]) continue;
        visited[nb.tri] = 1;
        // Same direction = inconsistent winding → neighbor needs flip XOR of parent
        const sameDir = me.fwd === nb.fwd;
        shouldFlip[nb.tri] = (shouldFlip[t] ^ (sameDir ? 1 : 0)) as 0 | 1;
        queue.push(nb.tri);
      }
    }
  }

  let anyFlip = false;
  for (let t = 0; t < nTris; t++) { if (shouldFlip[t]) { anyFlip = true; break; } }
  if (!anyFlip) return geo;

  const newIdxArr = new Uint32Array(idx.count);
  for (let t = 0; t < nTris; t++) {
    const a = idx.getX(t * 3), b = idx.getX(t * 3 + 1), c = idx.getX(t * 3 + 2);
    if (shouldFlip[t]) {
      newIdxArr[t * 3] = a; newIdxArr[t * 3 + 1] = c; newIdxArr[t * 3 + 2] = b;
    } else {
      newIdxArr[t * 3] = a; newIdxArr[t * 3 + 1] = b; newIdxArr[t * 3 + 2] = c;
    }
  }
  const out = geo.clone();
  out.setIndex(new THREE.BufferAttribute(newIdxArr, 1));
  return out;
}

/**
 * Ear-clip a 2D polygon.  Preserves the polygon's winding order in the output.
 * Returns a flat array of indices into pts (triplets = triangles).
 */
function earClip2D(pts: [number, number][]): number[] {
  const n = pts.length;
  if (n < 3) return [];
  if (n === 3) return [0, 1, 2];

  // Signed area: positive = CCW, negative = CW
  let area2 = 0;
  for (let i = 0; i < n; i++) {
    const [ax, ay] = pts[i], [bx, by] = pts[(i + 1) % n];
    area2 += ax * by - bx * ay;
  }
  const ccw = area2 > 0;

  const cross2 = (ax: number, ay: number, bx: number, by: number, cx: number, cy: number) =>
    (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);

  const inTriangle = (px: number, py: number,
                      ax: number, ay: number, bx: number, by: number, cx: number, cy: number) => {
    const eps = 1e-10;
    const d1 = cross2(ax, ay, bx, by, px, py);
    const d2 = cross2(bx, by, cx, cy, px, py);
    const d3 = cross2(cx, cy, ax, ay, px, py);
    return !((d1 < -eps || d2 < -eps || d3 < -eps) && (d1 > eps || d2 > eps || d3 > eps));
  };

  const poly = Array.from({ length: n }, (_, i) => i);
  const result: number[] = [];
  let maxIter = n * n + n + 10;

  while (poly.length > 3 && maxIter-- > 0) {
    let found = false;
    for (let i = 0; i < poly.length; i++) {
      const pi = poly[(i - 1 + poly.length) % poly.length];
      const ci = poly[i];
      const ni = poly[(i + 1) % poly.length];
      const [ax, ay] = pts[pi], [bx, by] = pts[ci], [cx, cy] = pts[ni];
      // Vertex ci must be convex for this polygon's winding
      const c = cross2(ax, ay, bx, by, cx, cy);
      if (ccw ? c <= 0 : c >= 0) continue; // reflex or flat
      // No other polygon vertex strictly inside the ear triangle
      let inside = false;
      for (let j = 0; j < poly.length; j++) {
        const k = poly[j];
        if (k === pi || k === ci || k === ni) continue;
        if (inTriangle(pts[k][0], pts[k][1], ax, ay, bx, by, cx, cy)) { inside = true; break; }
      }
      if (inside) continue;
      result.push(pi, ci, ni);
      poly.splice(i, 1);
      found = true;
      break;
    }
    if (!found) break; // degenerate — caller falls back to centroid fan
  }
  if (poly.length === 3) result.push(poly[0], poly[1], poly[2]);
  return result;
}

/**
 * Triangulate a planar boundary loop using 2D ear clipping.
 * Projects the loop onto its own best-fit plane, ear-clips, then maps back.
 * Output triangles are wound outward (CCW from outside the mesh).
 * Returns [] on degenerate input or loops with > 500 vertices (use centroid fan fallback).
 */
function triangulatePlanar(loop: number[], pos: THREE.BufferAttribute): number[] {
  const n = loop.length;
  if (n < 3) return [];
  if (n === 3) return [loop[1], loop[0], loop[2]]; // single triangle, reversed for outward winding
  if (n > 8000) return []; // ear-clip is O(n²); fall back to centroid fan beyond 8 k verts

  // Newell's method: area-weighted normal of the polygon
  let nx = 0, ny = 0, nz = 0;
  for (let i = 0; i < n; i++) {
    const a = loop[i], b = loop[(i + 1) % n];
    const ax = pos.getX(a), ay = pos.getY(a), az = pos.getZ(a);
    const bx = pos.getX(b), by = pos.getY(b), bz = pos.getZ(b);
    nx += (ay - by) * (az + bz);
    ny += (az - bz) * (ax + bx);
    nz += (ax - bx) * (ay + by);
  }
  const nl = Math.sqrt(nx * nx + ny * ny + nz * nz);
  if (nl < 1e-10) return [];
  nx /= nl; ny /= nl; nz /= nl;

  // Orthonormal basis (u, v) perpendicular to n
  let ux = 1 - nx * nx, uy = -nx * ny, uz = -nx * nz;
  const ul = Math.sqrt(ux * ux + uy * uy + uz * uz);
  if (ul < 1e-6) { ux = 0; uy = 1; uz = 0; } else { ux /= ul; uy /= ul; uz /= ul; }
  const vx = ny * uz - nz * uy, vy = nz * ux - nx * uz, vz = nx * uy - ny * ux;

  // Project loop to 2D
  const pts: [number, number][] = loop.map(vi => [
    pos.getX(vi) * ux + pos.getY(vi) * uy + pos.getZ(vi) * uz,
    pos.getX(vi) * vx + pos.getY(vi) * vy + pos.getZ(vi) * vz,
  ]);

  const localTris = earClip2D(pts);
  if (localTris.length === 0) return [];

  // earClip2D preserves the polygon's winding (CW from outside for boundary loops).
  // Reverse each triangle so fill normals point outward (CCW from outside).
  const result: number[] = [];
  for (let i = 0; i < localTris.length; i += 3) {
    result.push(loop[localTris[i + 1]], loop[localTris[i]], loop[localTris[i + 2]]);
  }
  return result;
}

/**
 * Fill open boundary loops with triangulated patches.
 *
 * Finds every "boundary edge" (a directed half-edge whose reverse is missing),
 * walks each boundary loop, and caps it.  Uses 2D ear-clip triangulation for
 * correct results on non-convex cross-sections (e.g. car body cuts).
 * Falls back to centroid fan for degenerate or oversized loops.
 *
 * Winding convention: boundary half-edge from→to belongs to a CCW-wound face,
 * so the boundary loop is CW from outside.  Fill triangles are output reversed
 * (CCW from outside) so patch normals point outward consistently.
 */
function fillHoles(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  if (!geo.index) return geo;

  const pos   = geo.attributes.position as THREE.BufferAttribute;
  const idx   = geo.index;
  const nVerts = pos.count;

  // Build directed half-edge set: key = from * nVerts + to
  // (safe up to ~94 M verts which is well beyond any realistic STL)
  const halfEdgeSet = new Set<number>();
  for (let t = 0; t < idx.count; t += 3) {
    const a = idx.getX(t), b = idx.getX(t + 1), c = idx.getX(t + 2);
    halfEdgeSet.add(a * nVerts + b);
    halfEdgeSet.add(b * nVerts + c);
    halfEdgeSet.add(c * nVerts + a);
  }

  // Collect boundary directed edges: from → [to, …] where reverse (to→from) is absent.
  // A vertex can have multiple outgoing boundary edges when two cut planes intersect
  // inside the mesh, so we store a list of successors, not a single one.
  const boundaryAdj = new Map<number, number[]>(); // from → [to, …]
  for (const key of halfEdgeSet) {
    const from = Math.floor(key / nVerts);
    const to   = key - from * nVerts;
    if (!halfEdgeSet.has(to * nVerts + from)) {
      const arr = boundaryAdj.get(from);
      if (arr) arr.push(to); else boundaryAdj.set(from, [to]);
    }
  }

  if (boundaryAdj.size === 0) return geo; // already closed

  // Walk boundary loops — consume each directed boundary edge exactly once.
  const usedEdges = new Set<number>(); // key = from * nVerts + to
  const loops: number[][] = [];
  for (const start of boundaryAdj.keys()) {
    // A vertex can anchor multiple loops; try each unused outgoing edge.
    const startAdj = boundaryAdj.get(start)!;
    for (const firstTo of startAdj) {
      const startEdgeKey = start * nVerts + firstTo;
      if (usedEdges.has(startEdgeKey)) continue;

      const loop: number[] = [start];
      usedEdges.add(startEdgeKey);
      let cur = firstTo;
      let safety = 0;
      const maxIter = halfEdgeSet.size;
      while (cur !== start && safety++ < maxIter) {
        loop.push(cur);
        const adj = boundaryAdj.get(cur);
        if (!adj) break;
        // Pick the first unused outgoing boundary edge from cur
        let next = -1;
        for (const cand of adj) {
          if (!usedEdges.has(cur * nVerts + cand)) { next = cand; break; }
        }
        if (next === -1) break;
        usedEdges.add(cur * nVerts + next);
        cur = next;
      }
      if (loop.length >= 3 && cur === start) loops.push(loop);
    }
  }
  if (loops.length === 0) return geo;

  // Build new position array and index array with fill patches appended
  const oldPos = pos.array as Float32Array;
  const newPos: number[] = Array.from(oldPos);
  const newIdx: number[] = Array.from(idx.array as Uint32Array);

  for (const loop of loops) {
    // Prefer proper 2D triangulation — correct for non-convex cross-sections.
    const tris = triangulatePlanar(loop, pos);
    if (tris.length > 0) {
      for (const vi of tris) newIdx.push(vi);
    } else {
      // Centroid fan fallback (degenerate or oversized loops)
      let cx = 0, cy = 0, cz = 0;
      for (const vi of loop) {
        cx += oldPos[vi * 3]; cy += oldPos[vi * 3 + 1]; cz += oldPos[vi * 3 + 2];
      }
      cx /= loop.length; cy /= loop.length; cz /= loop.length;
      const centroidIdx = newPos.length / 3;
      newPos.push(cx, cy, cz);
      for (let i = 0; i < loop.length; i++) {
        const a = loop[i], b = loop[(i + 1) % loop.length];
        newIdx.push(b, a, centroidIdx);
      }
    }
  }

  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.BufferAttribute(new Float32Array(newPos), 3));
  out.setIndex(new THREE.BufferAttribute(new Uint32Array(newIdx), 1));
  return out;
}

// ─── Exact vertex dedup ───────────────────────────────────────────────────────

/**
 * Build an indexed geometry from a non-indexed vertex soup using exact
 * float32 bit-pattern matching — zero epsilon.
 *
 * Two vertex positions are merged if and only if all three coordinates share
 * the same IEEE754 float32 bit pattern.  Positions that are merely close but
 * differ by even one ULP are kept separate, preventing the epsilon-welding
 * collapse that destroys fine geometry details.
 *
 * Algorithm: fast uint32 hash (Knuth multiplicative hashing) with bucket-scan
 * collision resolution.  No string allocation, no BigInt — O(n) expected time.
 *
 * Per the mesh-pipeline-architecture doc: "Two vertices are shared if and only
 * if all three coordinates are bitwise identical.  No epsilon.  No tolerance.
 * If the original file intended them to be the same vertex, they'll have the
 * same bits."
 */
function exactMergeVertices(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  if (geo.index) return geo; // already indexed — caller must toNonIndexed() first

  const pos    = geo.attributes.position as THREE.BufferAttribute;
  const posArr = pos.array as Float32Array;
  const u32    = new Uint32Array(posArr.buffer, posArr.byteOffset, posArr.length);
  const nVerts = pos.count;

  // uint32 hash of three uint32 values — Knuth multiplicative with mixing
  const hash3 = (a: number, b: number, c: number): number =>
    Math.imul(Math.imul(a ^ Math.imul(b, 2654435761), 2246822519) ^ c, 3266489917) >>> 0;

  // hashMap: hash → list of (newIdx, u32_a, u32_b, u32_c)
  type Entry = [number, number, number, number]; // [ni, a, b, c]
  const hashMap = new Map<number, Entry[]>();
  const newPos  = new Float32Array(nVerts * 3); // pre-alloc, may over-allocate
  let   uniqueCount = 0;
  const indices = new Uint32Array(nVerts);

  for (let i = 0; i < nVerts; i++) {
    const a = u32[i * 3], b = u32[i * 3 + 1], c = u32[i * 3 + 2];
    const h = hash3(a, b, c);

    let found = -1;
    const bucket = hashMap.get(h);
    if (bucket) {
      for (const e of bucket) {
        if (e[1] === a && e[2] === b && e[3] === c) { found = e[0]; break; }
      }
    }

    if (found === -1) {
      found = uniqueCount++;
      newPos[found * 3]     = posArr[i * 3];
      newPos[found * 3 + 1] = posArr[i * 3 + 1];
      newPos[found * 3 + 2] = posArr[i * 3 + 2];
      const entry: Entry = [found, a, b, c];
      if (bucket) bucket.push(entry); else hashMap.set(h, [entry]);
    }
    indices[i] = found;
  }

  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.BufferAttribute(newPos.subarray(0, uniqueCount * 3), 3));
  out.setIndex(new THREE.BufferAttribute(indices, 1));
  return out;
}

/** Remove zero-area (degenerate) triangles from an indexed geometry. */
function removeDegenerates(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  if (!geo.index) return geo;
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const idx = geo.index;
  const goodTris: number[] = [];
  const vA = new THREE.Vector3(), vB = new THREE.Vector3(), vC = new THREE.Vector3();
  for (let t = 0; t < idx.count; t += 3) {
    const ai = idx.getX(t), bi = idx.getX(t + 1), ci = idx.getX(t + 2);
    if (ai === bi || bi === ci || ci === ai) continue; // collapsed triangle
    vA.fromBufferAttribute(pos, ai);
    vB.fromBufferAttribute(pos, bi);
    vC.fromBufferAttribute(pos, ci);
    const area = vB.clone().sub(vA).cross(vC.clone().sub(vA)).length();
    if (area > 1e-10) goodTris.push(ai, bi, ci);
  }
  if (goodTris.length === idx.count) return geo; // nothing removed
  const out = geo.clone();
  out.setIndex(new THREE.BufferAttribute(new Uint32Array(goodTris), 1));
  return out;
}

// ─── Public repair API ────────────────────────────────────────────────────────

export interface RepairStats {
  /** Number of degenerate (zero-area) triangles removed. */
  degeneratesRemoved: number;
  /** Number of duplicate triangles removed. */
  duplicatesRemoved: number;
  /** Number of triangles whose winding was flipped for consistency. */
  windingFixed: number;
  /** Whether the entire mesh was globally inverted (inside-out) and corrected. */
  invertedNormalsFixed: boolean;
  /** Weld tolerance used to close seams, in mm. 0 if no welding was needed. */
  weldToleranceMM: number;
  /** Number of open boundary loops that were filled. */
  holesFilled: number;
  /** Whether the mesh is watertight after repair. */
  isWatertight: boolean;
}

/**
 * Run the full repair pipeline on a geometry and return the repaired geometry
 * plus a report of what was changed.  Does NOT mutate the input geometry.
 *
 * Steps:
 *   1. Exact vertex dedup (bit-pattern match, no epsilon); epsilon weld only for genuine seams
 *   2. Degenerate triangle removal
 *   3. Duplicate triangle removal
 *   4. Winding consistency fix (BFS flood-fill)
 *   5. Outward normal correction (global inversion fix)
 *   6. Hole filling (ear-clip triangulation)
 */
export async function repairMesh(
  geo: THREE.BufferGeometry,
  onProgress: ProgressCallback,
): Promise<{ geometry: THREE.BufferGeometry; stats: RepairStats }> {
  const { mergeVertices } = await import("three/examples/jsm/utils/BufferGeometryUtils.js");

  const stats: RepairStats = {
    degeneratesRemoved: 0,
    duplicatesRemoved: 0,
    windingFixed: 0,
    invertedNormalsFixed: false,
    weldToleranceMM: 0,
    holesFilled: 0,
    isWatertight: false,
  };

  onProgress(0, 6, "Inspecting mesh…");
  await yieldToUI();

  // Step 1: Exact vertex dedup (no epsilon — only merge bit-identical positions)
  // Per architecture doc: exact matching first so we never accidentally collapse
  // distinct features.  Epsilon welding is used ONLY as a fallback for meshes
  // with genuine positional seams (e.g. two bodies snapped together in CAD).
  const nonIndexed = geo.index ? geo.toNonIndexed() : geo;
  const exact = exactMergeVertices(nonIndexed);
  const dxExact = diagnoseMesh(exact);

  let g: THREE.BufferGeometry;
  let weldTol: number;
  if (dxExact.openEdges === 0) {
    // Exact matching closed all edges — safest path, no epsilon needed
    g = exact;
    weldTol = 0;
    onProgress(1, 6, "Vertices deduplicated (exact match — no epsilon needed)…");
  } else {
    // Genuine seams remain after exact match → minimal epsilon weld to close them
    weldTol = dxExact.recommendedTol;
    onProgress(1, 6, `Welding seams (±${weldTol.toFixed(weldTol < 0.01 ? 4 : 2)} mm)…`);
    g = mergeVertices(nonIndexed, weldTol);
  }
  await yieldToUI();
  stats.weldToleranceMM = weldTol;

  // Step 2: Remove degenerates
  onProgress(2, 6, "Removing degenerate triangles…");
  await yieldToUI();

  const beforeDegen = g.index ? g.index.count / 3 : 0;
  g = removeDegenerates(g);
  const afterDegen = g.index ? g.index.count / 3 : 0;
  stats.degeneratesRemoved = beforeDegen - afterDegen;

  // Step 3: Remove duplicates
  onProgress(3, 6, "Removing duplicate triangles…");
  await yieldToUI();

  const beforeDup = g.index ? g.index.count / 3 : 0;
  g = deduplicateTris(g);
  const afterDup = g.index ? g.index.count / 3 : 0;
  stats.duplicatesRemoved = beforeDup - afterDup;

  // Step 4: Fix winding
  onProgress(4, 6, "Fixing winding consistency…");
  await yieldToUI();

  const beforeWinding = g.index ? new Uint32Array(g.index.array) : null;
  g = fixWinding(g);
  if (beforeWinding && g.index) {
    let diffs = 0;
    for (let i = 0; i < beforeWinding.length; i += 3) {
      if (beforeWinding[i + 1] !== g.index.getX(i + 1)) diffs++;
    }
    stats.windingFixed = diffs;
  }

  // Step 5: Outward normals
  const gInward = g;
  g = ensureOutwardNormals(g);
  stats.invertedNormalsFixed = g !== gInward;

  // Step 6: Fill holes
  onProgress(5, 6, "Filling holes…");
  await yieldToUI();

  const diagBefore = diagnoseMesh(g);
  const gFilled = fillHoles(g);
  const diagAfter = diagnoseMesh(gFilled);
  stats.holesFilled = diagBefore.openEdges - diagAfter.openEdges;
  g = gFilled;

  stats.isWatertight = diagAfter.openEdges === 0 && diagAfter.nonManifoldEdges === 0;

  onProgress(6, 6, "Done");
  await yieldToUI();

  g.computeVertexNormals();
  return { geometry: g, stats };
}

/** Signed-volume divergence theorem on an indexed BufferGeometry. */
export function computeGeometryVolume(geo: THREE.BufferGeometry): number {
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const idx = geo.index;
  if (!idx) return 0;
  let vol = 0;
  for (let t = 0; t < idx.count; t += 3) {
    const ai = idx.getX(t), bi = idx.getX(t + 1), ci = idx.getX(t + 2);
    const ax = pos.getX(ai), ay = pos.getY(ai), az = pos.getZ(ai);
    const bx = pos.getX(bi), by = pos.getY(bi), bz = pos.getZ(bi);
    const cx = pos.getX(ci), cy = pos.getY(ci), cz = pos.getZ(ci);
    vol += (ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx)) / 6;
  }
  return Math.abs(vol);
}
