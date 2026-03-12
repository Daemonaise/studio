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

  onProgress(0, planes.length, "Building manifold mesh…");
  await yieldToUI();

  // Ensure geometry is indexed and centered
  let inputGeo = geo;
  if (!inputGeo.index) {
    // Merge duplicate vertices so we get a proper index
    const { mergeVertices } = await import("three/examples/jsm/utils/BufferGeometryUtils.js");
    inputGeo = mergeVertices(geo);
  }

  const { vertProperties, triVerts } = geometryToArrays(inputGeo);
  const { Mesh } = api;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let regions: any[] = [
    new Manifold(new Mesh({ numProp: 3, vertProperties, triVerts })),
  ];

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

  // Convert manifold instances back to Three.js geometries
  const parts: SplitPart[] = regions.map((region, i) => {
    const mesh = region.getMesh();
    const geometry = meshToGeometry(mesh);
    geometry.computeBoundingBox();
    const bb = geometry.boundingBox!;
    const size = new THREE.Vector3();
    bb.getSize(size);

    return {
      geometry,
      label: `Part ${i + 1}`,
      triangleCount: mesh.triVerts.length / 3,
      volumeMM3: parseFloat(computeGeometryVolume(geometry).toFixed(2)),
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

/** Signed-volume divergence theorem on an indexed BufferGeometry. */
function computeGeometryVolume(geo: THREE.BufferGeometry): number {
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
