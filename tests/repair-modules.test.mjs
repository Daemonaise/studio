import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

import { transformSync } from "esbuild";
import * as THREE from "three";


const repoRoot = process.cwd();
const compiledDir = path.join(repoRoot, "tests/.compiled");


function compileAndImport(relativePath, cacheKey) {
  const sourcePath = path.join(repoRoot, relativePath);
  const source = fs.readFileSync(sourcePath, "utf8");
  const { code } = transformSync(source, {
    loader: relativePath.endsWith(".tsx") ? "tsx" : "ts",
    format: "esm",
    target: "es2020",
    sourcemap: false,
  });

  fs.mkdirSync(compiledDir, { recursive: true });
  const compiledPath = path.join(compiledDir, `${cacheKey}.mjs`);
  fs.writeFileSync(compiledPath, code, "utf8");
  return import(`${pathToFileURL(compiledPath).href}?t=${Date.now()}`);
}


async function loadMeshSanitize() {
  return compileAndImport("src/components/karaslice/mesh-sanitize.ts", "mesh-sanitize");
}


async function loadDefectOverlays() {
  return compileAndImport("src/components/karaslice/defect-overlays.ts", "defect-overlays");
}


async function loadVoxelReconstruct() {
  return compileAndImport("src/components/karaslice/voxel-reconstruct.ts", "voxel-reconstruct");
}


function makeGeometry(positions, indices) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(positions), 3));
  if (indices) {
    geometry.setIndex(indices);
  }
  return geometry;
}


function makeOpenTetrahedron() {
  return makeGeometry(
    [
      0, 0, 0,
      1, 0, 0,
      0, 1, 0,
      0, 0, 1,
    ],
    [
      0, 2, 1,
      0, 1, 3,
      0, 3, 2,
    ],
  );
}


test("sanitizeMesh removes duplicate faces and tiny debris components", async () => {
  const { sanitizeMesh } = await loadMeshSanitize();
  const progress = [];
  const geometry = makeGeometry(
    [
      -1, -1, -1,
       1, -1, -1,
       1,  1, -1,
      -1,  1, -1,
      -1, -1,  1,
       1, -1,  1,
       1,  1,  1,
      -1,  1,  1,
      10, 10, 10,
      11, 10, 10,
      10, 11, 10,
    ],
    [
      0, 2, 1,
      0, 3, 2,
      4, 5, 6,
      4, 6, 7,
      0, 1, 5,
      0, 5, 4,
      1, 2, 6,
      1, 6, 5,
      2, 3, 7,
      2, 7, 6,
      3, 0, 4,
      3, 4, 7,
      0, 2, 1,
      8, 9, 10,
    ],
  );

  const { stats, geometry: sanitized } = sanitizeMesh(geometry, {
    debrisThresholdFraction: 0,
    debrisAbsoluteMin: 2,
    resolveNonManifold: false,
    onProgress: (msg) => progress.push(msg),
  });

  assert.equal(stats.duplicateFacesRemoved, 1);
  assert.equal(stats.debrisComponentsRemoved, 1);
  assert.equal(stats.debrisTrianglesRemoved, 1);
  assert.equal(stats.nonManifoldEdgesResolved, 0);
  assert.equal(stats.inputTriangles, 14);
  assert.equal(stats.outputTriangles, 12);
  assert.equal(sanitized.index.count / 3, 12);
  assert.deepEqual(progress, [
    "Removing duplicate faces…",
    "Extracting components…",
    "Building sanitized geometry…",
  ]);
});


test("sanitizeMesh resolves extra faces on a non-manifold edge", async () => {
  const { sanitizeMesh } = await loadMeshSanitize();
  const geometry = makeGeometry(
    [
      0, 0, 0,
      1, 0, 0,
      0, 1, 0,
      0, 0, 1,
      0, -1, 0,
    ],
    [
      0, 1, 2,
      1, 0, 3,
      0, 1, 4,
    ],
  );

  const { stats, geometry: sanitized } = sanitizeMesh(geometry, {
    debrisThresholdFraction: 0,
    debrisAbsoluteMin: 0,
    resolveNonManifold: true,
  });

  assert.equal(stats.nonManifoldEdgesResolved, 1);
  assert.equal(stats.outputTriangles, 2);
  assert.equal(sanitized.index.count / 3, 2);
});


test("computeEdgeDefects finds open edges on a subtly open mesh", async () => {
  const { computeEdgeDefects } = await loadDefectOverlays();
  const defects = computeEdgeDefects(makeOpenTetrahedron());

  assert.equal(defects.openEdgeCount, 3);
  assert.equal(defects.nonManifoldEdgeCount, 0);
  assert.equal(defects.openEdges.length, 18);
  assert.equal(defects.nonManifoldEdges.length, 0);
});


test("computeEdgeDefects finds non-manifold edges shared by three triangles", async () => {
  const { computeEdgeDefects } = await loadDefectOverlays();
  const geometry = makeGeometry(
    [
      0, 0, 0,
      1, 0, 0,
      0, 1, 0,
      0, 0, 1,
      0, -1, 0,
    ],
    [
      0, 1, 2,
      1, 0, 3,
      0, 1, 4,
    ],
  );

  const defects = computeEdgeDefects(geometry);

  assert.equal(defects.openEdgeCount, 6);
  assert.equal(defects.nonManifoldEdgeCount, 1);
  assert.equal(defects.nonManifoldEdges.length, 6);
});


test("voxel reconstruction helpers clamp resolutions and corruption thresholds", async () => {
  const {
    autoVoxelResolution,
    estimateOutputTriangles,
    minSafeResolution,
    isSeverelyCorrupted,
  } = await loadVoxelReconstruct();

  assert.equal(autoVoxelResolution({ x: 50, y: 20, z: 10 }), 1);
  assert.equal(autoVoxelResolution({ x: 10000, y: 10, z: 10 }), 20);
  assert.equal(estimateOutputTriangles({ x: 40, y: 20, z: 10 }, 2), 2008);
  assert.equal(estimateOutputTriangles({ x: 40, y: 20, z: 10 }, 2, 500), 500);
  assert.equal(minSafeResolution({ x: 100, y: 100, z: 100 }), 0.5);
  assert.equal(minSafeResolution({ x: 5000, y: 100, z: 100 }), 5.5);
  assert.equal(isSeverelyCorrupted(2, 0, 200), false);
  assert.equal(isSeverelyCorrupted(4, 0, 200), true);
  assert.equal(isSeverelyCorrupted(0, 2, 200), true);
});


test("estimateWallThickness measures a thin box panel", async () => {
  const { estimateWallThickness } = await loadVoxelReconstruct();
  const geometry = new THREE.BoxGeometry(10, 10, 1);

  const result = await estimateWallThickness(geometry, 64);

  assert.ok(result.avgMM > 0.9 && result.avgMM < 1.1);
  assert.ok(result.minMM > 0.9 && result.minMM < 1.1);
  assert.equal(result.isThinShell, false);
});


test("postProcessVoxelOutput applies creased normals even when smoothing and simplification are disabled", async () => {
  const { postProcessVoxelOutput } = await loadVoxelReconstruct();
  const geometry = new THREE.BoxGeometry(2, 2, 2).toNonIndexed();

  const result = await postProcessVoxelOutput(geometry, {
    smoothingIterations: 0,
    simplifyTarget: 0,
  });

  // Creased normals always runs, so the result is a new geometry with split normals at sharp edges
  assert.ok(result.attributes.position.count > 0);
  assert.ok(result.attributes.normal);
});


test("pointCloudReconstruct rejects meshes with no valid triangles", async () => {
  const { pointCloudReconstruct } = await compileAndImport(
    "src/components/karaslice/poisson-reconstruct.ts",
    "poisson-reconstruct",
  );
  const geometry = makeGeometry(
    [
      0, 0, 0,
      1, 0, 0,
      2, 0, 0,
    ],
    [
      0, 1, 2,
    ],
  );

  await assert.rejects(
    pointCloudReconstruct(geometry, () => {}),
    /No valid triangles found in mesh/,
  );
});


test("voxelReconstruct produces a bounded mesh for a simple box", async () => {
  const { voxelReconstruct } = await loadVoxelReconstruct();
  const geometry = new THREE.BoxGeometry(4, 4, 4);
  const progress = [];

  const result = await voxelReconstruct(
    geometry,
    (step, total, msg) => progress.push({ step, total, msg }),
    2,
  );

  result.geometry.computeBoundingBox();
  const bb = result.geometry.boundingBox;

  assert.equal(result.resolution, 2);
  assert.deepEqual(result.gridDims, [4, 4, 4]);
  assert.ok(result.outputTriangles > 0);
  assert.ok(result.geometry.attributes.position.count > 0);
  assert.ok(bb);
  assert.ok(bb.min.x >= -4 && bb.max.x <= 4);
  assert.equal(progress.at(0).msg, "Voxelizing mesh…");
  assert.equal(progress.at(-1).msg, "Finalizing geometry…");
});


test("shellVoxelReconstruct produces shell geometry for a simple box", async () => {
  const { shellVoxelReconstruct } = await loadVoxelReconstruct();
  const geometry = new THREE.BoxGeometry(4, 4, 1);
  const progress = [];

  const result = await shellVoxelReconstruct(
    geometry,
    (step, total, msg) => progress.push({ step, total, msg }),
    1,
    1,
  );

  result.geometry.computeBoundingBox();
  const bb = result.geometry.boundingBox;

  assert.equal(result.resolution, 1);
  assert.deepEqual(result.gridDims, [8, 8, 5]);
  assert.ok(result.outputTriangles > 0);
  assert.ok(result.geometry.attributes.position.count > 0);
  assert.ok(bb);
  assert.ok(bb.min.z >= -3 && bb.max.z <= 3);
  assert.equal(progress.at(0).msg, "Rasterizing surface…");
  assert.equal(progress.at(-1).msg, "Finalizing geometry…");
});


test("pointCloudReconstruct returns indexed geometry for a simple box", async () => {
  const { pointCloudReconstruct } = await compileAndImport(
    "src/components/karaslice/poisson-reconstruct.ts",
    "poisson-reconstruct",
  );
  const geometry = new THREE.BoxGeometry(4, 4, 4);
  const progress = [];

  const result = await pointCloudReconstruct(geometry, (step, total, msg) => {
    progress.push({ step, total, msg });
  }, {
    resolution: 2,
    radiusMultiplier: 1,
    sdfSharpness: 0.6,
    gapBridgingFactor: 1,
    gridPadding: 1,
    normalSampleDensity: 0.01,
    vertexMergePrecision: 0.001,
    outsideBias: 1,
  });

  result.geometry.computeBoundingBox();
  const bb = result.geometry.boundingBox;

  assert.equal(result.resolution, 2);
  assert.ok(Array.isArray(result.gridDims));
  assert.ok(result.gridDims[0] > 0 && result.gridDims[1] > 0 && result.gridDims[2] > 0);
  assert.ok(result.outputTriangles > 0);
  assert.ok(result.geometry.index);
  assert.ok(result.geometry.index.count > 0);
  assert.ok(bb);
  assert.ok(bb.min.x >= -4 && bb.max.x <= 4);
  assert.equal(progress.at(0).msg, "Extracting point cloud…");
  assert.equal(progress.at(-1).msg, "Finalizing geometry…");
});
