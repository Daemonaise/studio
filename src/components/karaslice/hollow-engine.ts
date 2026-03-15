/**
 * Hollowing & escape-hole engine using manifold-3d boolean operations.
 *
 * - hollowMesh: creates a thin-walled shell by boolean-subtracting a scaled inner copy
 * - addEscapeHole: boolean-subtracts a cylinder at a user-specified location
 * - generateSupportPreview: builds simple column geometry from overhang centroids
 *
 * All operations run client-side using the manifold-3d WASM module.
 */

import * as THREE from "three";
import { getManifoldAPI, computeGeometryVolume } from "./manifold-engine";
import type { OverhangResult } from "./print-prep-analysis";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface HollowResult {
  geometry: THREE.BufferGeometry;
  wallThickness: number;
  originalVolumeMM3: number;
  hollowVolumeMM3: number;
  materialSavedPercent: number;
}

export interface EscapeHoleSpec {
  /** Center position on the mesh surface [x, y, z]. */
  position: [number, number, number];
  /** Hole radius in mm. */
  radius: number;
  /** Direction the hole punches through (unit vector). Defaults to [0, 0, -1] (downward). */
  direction?: [number, number, number];
}

export interface EscapeHoleResult {
  geometry: THREE.BufferGeometry;
  holesAdded: number;
}

export interface SupportColumn {
  /** Base position [x, y, z] at the build plate (z=0). */
  base: [number, number, number];
  /** Top position [x, y, z] at the overhang face. */
  top: [number, number, number];
  /** Column height in mm. */
  height: number;
}

export interface SupportPreviewResult {
  /** Three.js geometry for all support columns (for viewport rendering). */
  geometry: THREE.BufferGeometry;
  /** Individual column data. */
  columns: SupportColumn[];
  /** Estimated support volume in mm³. */
  volumeMM3: number;
}

export interface PrinterFitResult {
  fits: boolean;
  meshSize: { x: number; y: number; z: number };
  buildVolume: { x: number; y: number; z: number };
  overflowAxes: string[];
  suggestions: string[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Convert BufferGeometry to manifold-3d arrays. */
function geometryToArrays(geo: THREE.BufferGeometry): { vertProperties: Float32Array; triVerts: Uint32Array } {
  const pos = geo.getAttribute("position") as THREE.BufferAttribute;
  const vCount = pos.count;
  const vertProperties = new Float32Array(vCount * 3);
  for (let i = 0; i < vCount; i++) {
    vertProperties[i * 3] = pos.getX(i);
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
    triVerts = new Uint32Array(vCount);
    for (let i = 0; i < vCount; i++) triVerts[i] = i;
  }
  return { vertProperties, triVerts };
}

/** Convert manifold getMesh() result back to Three.js BufferGeometry. */
function meshToGeometry(mesh: { vertProperties: Float32Array; triVerts: Uint32Array; numProp: number }): THREE.BufferGeometry {
  const { numProp, vertProperties, triVerts } = mesh;
  const vertCount = vertProperties.length / numProp;
  let positions: Float32Array;
  if (numProp === 3) {
    positions = new Float32Array(vertProperties);
  } else {
    positions = new Float32Array(vertCount * 3);
    for (let i = 0; i < vertCount; i++) {
      positions[i * 3] = vertProperties[i * numProp];
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

// ─── Hollowing ───────────────────────────────────────────────────────────────

/**
 * Create a hollow shell from a solid mesh by boolean-subtracting
 * a uniformly scaled-down inner copy.
 *
 * The inner mesh is scaled from the mesh centroid by a factor that
 * approximates the desired wall thickness based on the shortest
 * bounding box dimension.
 *
 * @param geo - Input solid geometry (should be watertight)
 * @param wallThicknessMM - Desired wall thickness in mm (default 2.0)
 */
export async function hollowMesh(
  geo: THREE.BufferGeometry,
  wallThicknessMM = 2.0,
): Promise<HollowResult> {
  const api = await getManifoldAPI();
  const { Manifold, Mesh } = api;

  // Prepare indexed geometry
  const { mergeVertices } = await import("three/examples/jsm/utils/BufferGeometryUtils.js");
  const indexed = geo.index ? geo : mergeVertices(geo.toNonIndexed ? geo.toNonIndexed() : geo, 1e-4);

  const { vertProperties, triVerts } = geometryToArrays(indexed);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let outer: any;
  try {
    outer = new Manifold(new Mesh({ numProp: 3, vertProperties, triVerts }));
  } catch {
    throw new Error("Mesh must be watertight/manifold for hollowing. Run repair first.");
  }
  if (outer.isEmpty()) {
    if (outer.delete) outer.delete();
    throw new Error("Mesh must be watertight/manifold for hollowing. Run repair first.");
  }

  // Compute centroid and bounding box
  geo.computeBoundingBox();
  const bb = geo.boundingBox!;
  const center = new THREE.Vector3();
  bb.getCenter(center);
  const size = new THREE.Vector3();
  bb.getSize(size);

  // Scale factor: shrink toward centroid so the gap ≈ wallThickness
  // Use the shortest bbox dimension to determine scale
  const minDim = Math.min(size.x, size.y, size.z);
  if (wallThicknessMM * 2 >= minDim) {
    if (outer.delete) outer.delete();
    throw new Error(`Wall thickness ${wallThicknessMM} mm is too large for this mesh (min dimension: ${minDim.toFixed(1)} mm). Max wall thickness: ${(minDim / 2 - 0.1).toFixed(1)} mm.`);
  }

  // Create the inner offset: translate to origin, scale, translate back
  const scaleFactor = 1 - (2 * wallThicknessMM) / minDim;

  // Build inner manifold: translate centroid to origin → scale → translate back
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let inner: any = new Manifold(new Mesh({ numProp: 3, vertProperties: new Float32Array(vertProperties), triVerts: new Uint32Array(triVerts) }));

  inner = inner.translate([-center.x, -center.y, -center.z]);
  inner = inner.scale([scaleFactor, scaleFactor, scaleFactor]);
  inner = inner.translate([center.x, center.y, center.z]);

  // Boolean subtract: outer - inner = shell
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let shell: any;
  try {
    shell = outer.subtract(inner);
  } catch {
    if (outer.delete) outer.delete();
    if (inner.delete) inner.delete();
    throw new Error("Boolean subtraction failed. Try a smaller wall thickness or repair the mesh first.");
  }

  if (outer.delete) outer.delete();
  if (inner.delete) inner.delete();

  if (shell.isEmpty()) {
    if (shell.delete) shell.delete();
    throw new Error("Hollowing produced an empty result. Try a smaller wall thickness.");
  }

  const meshResult = shell.getMesh();
  const resultGeo = meshToGeometry(meshResult);
  if (shell.delete) shell.delete();

  const originalVol = Math.abs(computeGeometryVolume(geo));
  const hollowVol = Math.abs(computeGeometryVolume(resultGeo));
  const saved = originalVol > 0 ? ((originalVol - hollowVol) / originalVol) * 100 : 0;

  return {
    geometry: resultGeo,
    wallThickness: wallThicknessMM,
    originalVolumeMM3: originalVol,
    hollowVolumeMM3: hollowVol,
    materialSavedPercent: Math.round(saved * 10) / 10,
  };
}

// ─── Escape Holes ────────────────────────────────────────────────────────────

/**
 * Punch escape holes into a (hollowed) mesh by boolean-subtracting cylinders.
 *
 * @param geo - Input geometry (should be hollowed first)
 * @param holes - Array of hole specifications
 */
export async function addEscapeHoles(
  geo: THREE.BufferGeometry,
  holes: EscapeHoleSpec[],
): Promise<EscapeHoleResult> {
  if (holes.length === 0) return { geometry: geo, holesAdded: 0 };

  const api = await getManifoldAPI();
  const { Manifold, Mesh } = api;

  const { mergeVertices } = await import("three/examples/jsm/utils/BufferGeometryUtils.js");
  const indexed = geo.index ? geo : mergeVertices(geo.toNonIndexed ? geo.toNonIndexed() : geo, 1e-4);

  const { vertProperties, triVerts } = geometryToArrays(indexed);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mesh: any;
  try {
    mesh = new Manifold(new Mesh({ numProp: 3, vertProperties, triVerts }));
  } catch {
    throw new Error("Mesh must be manifold for escape hole placement.");
  }

  geo.computeBoundingBox();
  const bb = geo.boundingBox!;
  const bboxDiag = bb.max.distanceTo(bb.min);

  let holesAdded = 0;

  for (const hole of holes) {
    const { position, radius, direction = [0, 0, -1] } = hole;

    // Create cylinder tall enough to punch through the entire mesh
    const cylHeight = bboxDiag * 1.5;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let cyl: any = Manifold.cylinder(cylHeight, radius, radius, 24);

    // Manifold.cylinder creates a cylinder along Z-axis centered at origin.
    // We need to orient it along the hole direction and position it.

    // Build rotation: align Z-axis to hole direction
    const dir = new THREE.Vector3(...direction).normalize();
    const up = new THREE.Vector3(0, 0, 1);

    if (Math.abs(dir.dot(up)) < 0.999) {
      // Need rotation
      const axis = new THREE.Vector3().crossVectors(up, dir).normalize();
      const angle = Math.acos(Math.max(-1, Math.min(1, up.dot(dir))));
      const q = new THREE.Quaternion().setFromAxisAngle(axis, angle);
      const m = new THREE.Matrix4().makeRotationFromQuaternion(q);
      const e = m.elements;
      // manifold-3d transform takes a 4x3 column-major matrix
      cyl = cyl.transform([
        e[0], e[1], e[2],
        e[4], e[5], e[6],
        e[8], e[9], e[10],
        0, 0, 0,
      ]);
    }

    // Center cylinder at hole position, extending in both directions
    cyl = cyl.translate([
      position[0] - dir.x * cylHeight * 0.5,
      position[1] - dir.y * cylHeight * 0.5,
      position[2] - dir.z * cylHeight * 0.5,
    ]);

    try {
      const next = mesh.subtract(cyl);
      if (!next.isEmpty()) {
        if (mesh.delete) mesh.delete();
        mesh = next;
        holesAdded++;
      } else {
        if (next.delete) next.delete();
      }
    } catch {
      // Skip this hole if boolean fails
    }
    if (cyl.delete) cyl.delete();
  }

  const result = mesh.getMesh();
  const resultGeo = meshToGeometry(result);
  if (mesh.delete) mesh.delete();

  return { geometry: resultGeo, holesAdded };
}

// ─── Support Preview ──────────────────────────────────────────────────────────

/**
 * Generate simple cylindrical support column previews from overhang analysis.
 * Groups nearby overhang faces into clusters, places one column per cluster.
 *
 * @param overhangResult - Result from computeOverhangs()
 * @param columnRadius - Radius of support columns in mm (default 1.5)
 * @param minHeight - Minimum column height to include (default 2.0)
 * @param buildPlateZ - Z coordinate of the build plate (default: mesh min Z)
 * @param meshBbox - Mesh bounding box for build plate detection
 */
export function generateSupportPreview(
  overhangResult: OverhangResult,
  columnRadius = 1.5,
  minHeight = 2.0,
  meshBbox?: THREE.Box3,
): SupportPreviewResult {
  const empty: SupportPreviewResult = { geometry: new THREE.BufferGeometry(), columns: [], volumeMM3: 0 };

  if (overhangResult.count === 0 || overhangResult.positions.length === 0) {
    return empty;
  }

  const buildPlateZ = meshBbox ? meshBbox.min.z : 0;

  // Extract overhang face centroids
  const centroids: [number, number, number][] = [];
  const pos = overhangResult.positions;
  for (let i = 0; i < pos.length; i += 9) {
    const cx = (pos[i] + pos[i + 3] + pos[i + 6]) / 3;
    const cy = (pos[i + 1] + pos[i + 4] + pos[i + 7]) / 3;
    const cz = (pos[i + 2] + pos[i + 5] + pos[i + 8]) / 3;
    centroids.push([cx, cy, cz]);
  }

  // Grid-based clustering: group centroids into cells of 5×columnRadius
  const cellSize = columnRadius * 5;
  const clusters = new Map<string, { sumX: number; sumY: number; sumZ: number; count: number }>();

  for (const [x, y, z] of centroids) {
    const key = `${Math.floor(x / cellSize)},${Math.floor(y / cellSize)}`;
    const c = clusters.get(key);
    if (c) {
      c.sumX += x; c.sumY += y; c.sumZ += z; c.count++;
    } else {
      clusters.set(key, { sumX: x, sumY: y, sumZ: z, count: 1 });
    }
  }

  // Build columns from cluster centers
  const columns: SupportColumn[] = [];
  const segments = 8; // octagonal columns for preview

  for (const c of clusters.values()) {
    const cx = c.sumX / c.count;
    const cy = c.sumY / c.count;
    const cz = c.sumZ / c.count;
    const height = cz - buildPlateZ;

    if (height < minHeight) continue;

    columns.push({
      base: [cx, cy, buildPlateZ],
      top: [cx, cy, cz],
      height,
    });
  }

  if (columns.length === 0) return empty;

  // Cap at 500 columns for performance
  if (columns.length > 500) {
    columns.sort((a, b) => b.height - a.height);
    columns.length = 500;
  }

  // Build merged geometry for all columns
  const vertsPerCol = (segments + 1) * 2; // top ring + bottom ring + centers
  const trisPerCol = segments * 4; // top cap + bottom cap + 2 sides per segment
  const totalVerts = columns.length * vertsPerCol;
  const totalTris = columns.length * trisPerCol;
  const positions = new Float32Array(totalVerts * 3);
  const indices: number[] = [];

  let vOffset = 0;
  let totalVolume = 0;

  for (const col of columns) {
    const [bx, by, bz] = col.base;
    const [, , tz] = col.top;
    const baseIdx = vOffset;

    // Bottom center
    positions[vOffset * 3] = bx;
    positions[vOffset * 3 + 1] = by;
    positions[vOffset * 3 + 2] = bz;
    vOffset++;

    // Top center
    positions[vOffset * 3] = bx;
    positions[vOffset * 3 + 1] = by;
    positions[vOffset * 3 + 2] = tz;
    vOffset++;

    // Bottom ring + top ring
    for (let s = 0; s < segments; s++) {
      const angle = (s / segments) * Math.PI * 2;
      const dx = Math.cos(angle) * columnRadius;
      const dy = Math.sin(angle) * columnRadius;

      // Bottom ring vertex
      positions[vOffset * 3] = bx + dx;
      positions[vOffset * 3 + 1] = by + dy;
      positions[vOffset * 3 + 2] = bz;
      vOffset++;

      // Top ring vertex
      positions[vOffset * 3] = bx + dx;
      positions[vOffset * 3 + 1] = by + dy;
      positions[vOffset * 3 + 2] = tz;
      vOffset++;
    }

    // Indices
    const bc = baseIdx; // bottom center
    const tc = baseIdx + 1; // top center

    for (let s = 0; s < segments; s++) {
      const b0 = baseIdx + 2 + s * 2; // bottom ring vertex
      const t0 = baseIdx + 3 + s * 2; // top ring vertex
      const b1 = baseIdx + 2 + ((s + 1) % segments) * 2;
      const t1 = baseIdx + 3 + ((s + 1) % segments) * 2;

      // Bottom cap triangle
      indices.push(bc, b1, b0);
      // Top cap triangle
      indices.push(tc, t0, t1);
      // Side quad (2 triangles)
      indices.push(b0, b1, t1);
      indices.push(b0, t1, t0);
    }

    totalVolume += Math.PI * columnRadius * columnRadius * col.height;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  return {
    geometry,
    columns,
    volumeMM3: Math.round(totalVolume),
  };
}

// ─── Printer Fit Check ──────────────────────────────────────────────────────

/**
 * Check if a mesh fits within a printer's build volume and generate warnings.
 *
 * @param meshBbox - Mesh bounding box
 * @param printerVolume - Printer build volume { x, y, z } in mm
 * @param overhangPct - Overhang percentage from analysis (optional)
 * @param isWatertight - Whether the mesh is watertight (optional)
 */
export function checkPrinterFit(
  meshBbox: { x: number; y: number; z: number },
  printerVolume: { x: number; y: number; z: number },
  overhangPct?: number,
  isWatertight?: boolean,
): PrinterFitResult {
  const overflowAxes: string[] = [];
  const suggestions: string[] = [];

  if (meshBbox.x > printerVolume.x) overflowAxes.push("X");
  if (meshBbox.y > printerVolume.y) overflowAxes.push("Y");
  if (meshBbox.z > printerVolume.z) overflowAxes.push("Z");

  const fits = overflowAxes.length === 0;

  if (!fits) {
    suggestions.push(`Mesh exceeds build volume on ${overflowAxes.join(", ")} axis — use the Split tool to divide it`);

    // Check if rotation could help
    const dims = [meshBbox.x, meshBbox.y, meshBbox.z].sort((a, b) => b - a);
    const vol = [printerVolume.x, printerVolume.y, printerVolume.z].sort((a, b) => b - a);
    if (dims[0] <= vol[0] && dims[1] <= vol[1] && dims[2] <= vol[2]) {
      suggestions.push("Try rotating the model — it may fit in a different orientation");
    }
  }

  if (overhangPct !== undefined && overhangPct > 30) {
    suggestions.push(`${overhangPct.toFixed(0)}% overhang — consider adding supports or reorienting to reduce overhangs`);
  } else if (overhangPct !== undefined && overhangPct > 15) {
    suggestions.push(`${overhangPct.toFixed(0)}% overhang — supports recommended for best print quality`);
  }

  if (isWatertight === false) {
    suggestions.push("Mesh is not watertight — most slicers will fail. Run repair first.");
  }

  // Check if mesh is very close to build volume (>90% utilization)
  if (fits) {
    const utilX = meshBbox.x / printerVolume.x;
    const utilY = meshBbox.y / printerVolume.y;
    const utilZ = meshBbox.z / printerVolume.z;
    if (utilX > 0.95 || utilY > 0.95 || utilZ > 0.95) {
      suggestions.push("Mesh nearly fills build volume — ensure there's room for brim/raft if needed");
    }
  }

  return {
    fits,
    meshSize: { ...meshBbox },
    buildVolume: { ...printerVolume },
    overflowAxes,
    suggestions,
  };
}
