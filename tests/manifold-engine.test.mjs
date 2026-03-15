import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

import { transformSync } from "esbuild";
import * as THREE from "three";


const repoRoot = process.cwd();
const sourcePath = path.join(repoRoot, "src/components/karaslice/manifold-engine.ts");
const compiledDir = path.join(repoRoot, "tests/.compiled");
const compiledPath = path.join(compiledDir, "manifold-engine.mjs");


async function loadModule() {
  const source = fs.readFileSync(sourcePath, "utf8");
  const { code } = transformSync(source, {
    loader: "ts",
    format: "esm",
    target: "es2020",
    sourcemap: false,
  });

  fs.mkdirSync(compiledDir, { recursive: true });
  fs.writeFileSync(compiledPath, code, "utf8");

  return import(`${pathToFileURL(compiledPath).href}?t=${Date.now()}`);
}


function makeGeometry(positions, indices) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(positions), 3));
  if (indices) {
    geometry.setIndex(indices);
  }
  return geometry;
}


function makeClosedTetrahedron() {
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
      1, 2, 3,
    ],
  );
}


test("viewportPlaneToEngine maps normalized positions into bbox space", async () => {
  const { viewportPlaneToEngine } = await loadModule();
  const bbox = new THREE.Box3(
    new THREE.Vector3(-10, -20, 5),
    new THREE.Vector3(30, 20, 45),
  );

  assert.deepEqual(viewportPlaneToEngine("x", 0.25, bbox), {
    normal: [1, 0, 0],
    originOffset: 0,
  });
  assert.deepEqual(viewportPlaneToEngine("y", 0.5, bbox), {
    normal: [0, 1, 0],
    originOffset: 0,
  });
  assert.deepEqual(viewportPlaneToEngine("z", 1, bbox), {
    normal: [0, 0, 1],
    originOffset: 45,
  });
});


test("computeGeometryVolume returns box volume for indexed and non-indexed geometry", async () => {
  const { computeGeometryVolume } = await loadModule();
  const indexed = new THREE.BoxGeometry(2, 3, 4);
  const nonIndexed = indexed.toNonIndexed();

  assert.ok(Math.abs(computeGeometryVolume(indexed) - 24) < 1e-6);
  assert.ok(Math.abs(computeGeometryVolume(nonIndexed) - 24) < 1e-6);
});


test("repairSplitPart removes degenerate and duplicate triangles and reports progress", async () => {
  const { repairSplitPart } = await loadModule();

  const geometry = makeGeometry(
    [
      0, 0, 0,
      1, 0, 0,
      0, 1, 0,
      0, 0, 1,
    ],
    [
      0, 1, 2,
      0, 1, 2,
      0, 0, 3,
    ],
  );

  const progress = [];
  const { geometry: repaired, stats } = await repairSplitPart(geometry, (step, total, message) => {
    progress.push({ step, total, message });
  });

  assert.equal(stats.degeneratesRemoved, 1);
  assert.equal(stats.duplicatesRemoved, 1);
  assert.equal(stats.isWatertight, false);
  assert.equal(repaired.index.count, 3);
  assert.deepEqual(
    progress.map((entry) => entry.message),
    [
      "Deduplicating vertices…",
      "Removing degenerate triangles…",
      "Removing duplicate triangles…",
      "Done",
    ],
  );
});


test("repairSplitPart preserves watertight solids", async () => {
  const { repairSplitPart, computeGeometryVolume } = await loadModule();
  const geometry = makeClosedTetrahedron();

  const { geometry: repaired, stats } = await repairSplitPart(geometry, () => {});

  assert.equal(stats.degeneratesRemoved, 0);
  assert.equal(stats.duplicatesRemoved, 0);
  assert.equal(stats.isWatertight, true);
  assert.ok(Math.abs(computeGeometryVolume(repaired) - (1 / 6)) < 1e-6);
});


test("repairMesh seals a subtle open hole and returns a watertight result", async () => {
  const { repairMesh } = await loadModule();
  const geometry = makeGeometry(
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

  const { stats } = await repairMesh(geometry, () => {});

  assert.ok(stats.holesFilled > 0);
  assert.equal(stats.isWatertight, true);
});


test("repairMesh fixes a single flipped face on an otherwise closed solid", async () => {
  const { repairMesh } = await loadModule();
  const geometry = makeGeometry(
    [
      0, 0, 0,
      1, 0, 0,
      0, 1, 0,
      0, 0, 1,
    ],
    [
      0, 2, 1,
      0, 1, 3,
      0, 2, 3,
      1, 2, 3,
    ],
  );

  const { stats } = await repairMesh(geometry, () => {});

  assert.ok(stats.windingFixed > 0);
  assert.equal(stats.isWatertight, true);
});


test("repairMesh detects and corrects globally inverted winding", async () => {
  const { repairMesh, computeGeometryVolume } = await loadModule();
  const geometry = makeGeometry(
    [
      0, 0, 0,
      1, 0, 0,
      0, 1, 0,
      0, 0, 1,
    ],
    [
      0, 1, 2,
      0, 3, 1,
      0, 2, 3,
      1, 3, 2,
    ],
  );

  const { geometry: repaired, stats } = await repairMesh(geometry, () => {});

  assert.equal(stats.invertedNormalsFixed, true);
  assert.equal(stats.isWatertight, true);
  assert.ok(Math.abs(computeGeometryVolume(repaired) - (1 / 6)) < 1e-6);
});


test("repairMesh welds a tiny positional seam before repairing topology", async () => {
  const { repairMesh, computeGeometryVolume } = await loadModule();
  const seamOffset = 0.001;
  const geometry = makeGeometry(
    [
      0, 0, 0,
      1, 0, 0,
      0, 1, 0,
      0, 0, 1,
      1 + seamOffset, 0, 0,
    ],
    [
      0, 2, 1,
      0, 4, 3,
      0, 3, 2,
      1, 2, 3,
    ],
  );

  const { geometry: repaired, stats } = await repairMesh(geometry, () => {});

  assert.ok(stats.weldToleranceMM > 0);
  assert.equal(stats.holesFilled, 0);
  assert.equal(stats.isWatertight, true);
  assert.ok(Math.abs(computeGeometryVolume(repaired) - (1 / 6)) < 1e-6);
});
