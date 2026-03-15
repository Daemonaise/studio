import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

import { transformSync } from "esbuild";
import * as THREE from "three";


const repoRoot = process.cwd();
const compiledDir = path.join(repoRoot, "tests/.compiled");
const require = createRequire(import.meta.url);
globalThis.require = require;


function compileAndImport(relativePath, cacheKey) {
  const sourcePath = path.join(repoRoot, relativePath);
  const source = fs.readFileSync(sourcePath, "utf8");
  const { code } = transformSync(source, {
    loader: relativePath.endsWith(".tsx") ? "tsx" : "ts",
    format: "esm",
    target: "es2020",
    sourcemap: false,
  });
  const wrappedCode = 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);\n' + code;

  fs.mkdirSync(compiledDir, { recursive: true });
  const compiledPath = path.join(compiledDir, `${cacheKey}.mjs`);
  fs.writeFileSync(compiledPath, wrappedCode, "utf8");
  return import(`${pathToFileURL(compiledPath).href}?t=${Date.now()}`);
}


async function loadStlUtils() {
  return compileAndImport("src/components/karaslice/stl-utils.ts", "stl-utils");
}


async function loadValidateReconstruction() {
  return compileAndImport("src/components/karaslice/validate-reconstruction.ts", "validate-reconstruction");
}

async function loadPrintPrepAnalysis() {
  return compileAndImport("src/components/karaslice/print-prep-analysis.ts", "print-prep-analysis");
}

async function loadShellAnalysis() {
  return compileAndImport("src/components/karaslice/shell-analysis.ts", "shell-analysis");
}

async function loadSecurity() {
  return compileAndImport("src/lib/security.ts", "security");
}


function makeTetrahedron() {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.BufferAttribute(
      new Float32Array([
        0, 0, 0,
        1, 0, 0,
        0, 1, 0,
        0, 0, 1,
      ]),
      3,
    ),
  );
  geometry.setIndex([
    0, 2, 1,
    0, 1, 3,
    0, 3, 2,
    1, 2, 3,
  ]);
  return geometry;
}


function makeOpenTetrahedron() {
  const geometry = makeTetrahedron();
  geometry.setIndex([
    0, 2, 1,
    0, 1, 3,
    0, 3, 2,
  ]);
  return geometry;
}

function makeDisconnectedTetrahedrons() {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.BufferAttribute(
      new Float32Array([
        0, 0, 0,
        1, 0, 0,
        0, 1, 0,
        0, 0, 1,
        10, 10, 10,
        11, 10, 10,
        10, 11, 10,
        10, 10, 11,
      ]),
      3,
    ),
  );
  geometry.setIndex([
    0, 2, 1,
    0, 1, 3,
    0, 3, 2,
    1, 2, 3,
    4, 6, 5,
    4, 5, 7,
    4, 7, 6,
    5, 6, 7,
  ]);
  return geometry;
}


test("geometryToSTLBuffer writes a valid binary STL header and triangle count", async () => {
  const { geometryToSTLBuffer } = await loadStlUtils();
  const geometry = makeTetrahedron();

  const buffer = geometryToSTLBuffer(geometry);
  const view = new DataView(buffer);
  const header = new TextDecoder().decode(buffer.slice(0, 35));

  assert.equal(buffer.byteLength, 84 + 4 * 50);
  assert.equal(view.getUint32(80, true), 4);
  assert.ok(header.includes("Karaslice export"));
});


test("geometryToOBJString emits object name, vertices, normals, and faces", async () => {
  const { geometryToOBJString } = await loadStlUtils();
  const geometry = new THREE.BoxGeometry(2, 3, 4);

  const obj = geometryToOBJString(geometry, "fixture");
  const lines = obj.split("\n");

  assert.equal(lines[1], "o fixture");
  assert.ok(lines.some((line) => line.startsWith("v ")));
  assert.ok(lines.some((line) => line.startsWith("vn ")));
  assert.ok(lines.some((line) => line.startsWith("f ")));
});


test("analyzeGeometry reports watertight meshes without topology issues", async () => {
  const { analyzeGeometry } = await loadStlUtils();
  const geometry = makeTetrahedron();

  const result = analyzeGeometry(geometry);

  assert.equal(result.isWatertight, true);
  assert.equal(result.openEdgeCount, 0);
  assert.equal(result.nonManifoldEdgeCount, 0);
  assert.deepEqual(result.issues, []);
  assert.equal(result.diagnostics.boundaryLoopCount, 0);
});


test("analyzeGeometry detects visually subtle open boundaries", async () => {
  const { analyzeGeometry } = await loadStlUtils();
  const geometry = makeOpenTetrahedron();

  const result = analyzeGeometry(geometry);

  assert.equal(result.isWatertight, false);
  assert.ok(result.openEdgeCount > 0);
  assert.ok(result.issues.some((issue) => issue.includes("not watertight")));
  assert.ok(result.diagnostics.boundaryLoopCount > 0);
  assert.ok(result.diagnostics.maxGapWidthMM > 0);
});


test("validateReconstructionOutput fails geometry with NaN vertices and degenerate triangles", async () => {
  const { validateReconstructionOutput } = await loadValidateReconstruction();
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.BufferAttribute(
      new Float32Array([
        0, 0, 0,
        1, 0, 0,
        0, 1, 0,
        0, 0, 1,
        2, 0, 0,
        Number.NaN, 0, 0,
      ]),
      3,
    ),
  );
  geometry.setIndex([
    0, 1, 2,
    3, 4, 4,
    0, 1, 5,
  ]);

  const result = validateReconstructionOutput(geometry, {
    degenerateThreshold: 0,
  });

  assert.equal(result.passed, false);
  assert.ok(result.failures.some((failure) => failure.check === "nan_vertices"));
  assert.ok(result.failures.some((failure) => failure.check === "degenerate_triangles"));
  assert.equal(result.metrics.nanVertices, 1);
  assert.equal(result.metrics.degenerateTriangles, 1);
});


test("validateReconstructionOutput flags open boundaries and Euler mismatch on near-valid meshes", async () => {
  const { validateReconstructionOutput } = await loadValidateReconstruction();
  const geometry = makeOpenTetrahedron();

  const result = validateReconstructionOutput(geometry, {
    boundaryThreshold: 0,
  });

  assert.equal(result.passed, true);
  assert.ok(result.failures.some((failure) => failure.check === "boundary_edges"));
  assert.ok(result.failures.some((failure) => failure.check === "euler_characteristic"));
  assert.ok(result.metrics.boundaryEdges > 0);
});


test("validateReconstructionOutput passes clean closed geometry", async () => {
  const { validateReconstructionOutput } = await loadValidateReconstruction();
  const geometry = makeTetrahedron();

  const result = validateReconstructionOutput(geometry);

  assert.equal(result.passed, true);
  assert.deepEqual(result.failures, []);
  assert.equal(result.metrics.boundaryEdges, 0);
  assert.equal(result.metrics.nonManifoldEdges, 0);
});

test("computeOverhangs flags downward-facing faces and tracks severity", async () => {
  const { computeOverhangs } = await loadPrintPrepAnalysis();
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.BufferAttribute(
      new Float32Array([
        0, 0, 0,
        0, 1, 2,
        1, 0, 0,
      ]),
      3,
    ),
  );

  const result = computeOverhangs(geometry, 45);

  assert.equal(result.count, 1);
  assert.equal(result.faces[0].index, 0);
  assert.equal(result.positions.length, 9);
  assert.equal(result.severity.length, 1);
  assert.ok(Math.abs(result.maxAngle - 63.43494882292201) < 1e-9);
});

test("computePrintabilityScore penalizes overhangs, thin walls, and open meshes", async () => {
  const { computePrintabilityScore } = await loadPrintPrepAnalysis();

  const result = computePrintabilityScore(30, 0.4, false, 0.8);

  assert.equal(result.watertightScore, 0);
  assert.equal(result.thicknessScore, 50);
  assert.ok(result.overhangScore < 50);
  assert.ok(result.overall < 50);
  assert.ok(result.warnings.some((warning) => warning.includes("overhang faces")));
  assert.ok(result.warnings.some((warning) => warning.includes("Min wall thickness 0.40 mm")));
  assert.ok(result.warnings.some((warning) => warning.includes("not watertight")));
});

test("analyzeShells separates disconnected components and sorts by size", async () => {
  const { analyzeShells } = await loadShellAnalysis();
  const geometry = makeDisconnectedTetrahedrons();

  const result = analyzeShells(geometry);

  assert.equal(result.shellCount, 2);
  assert.equal(result.largestShellTriangles, 4);
  assert.equal(result.shells[0].triangleCount, 4);
  assert.equal(result.shells[1].triangleCount, 4);
  assert.deepEqual(result.shells[0].bbox, [0, 0, 0, 1, 1, 1]);
  assert.deepEqual(result.shells[1].bbox, [10, 10, 10, 11, 11, 11]);
});

test("removeSmallShells drops shells below the triangle threshold", async () => {
  const { analyzeShells, removeSmallShells } = await loadShellAnalysis();
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.BufferAttribute(
      new Float32Array([
        0, 0, 0,
        1, 0, 0,
        0, 1, 0,
        0, 0, 1,
        10, 10, 10,
        11, 10, 10,
        10, 11, 10,
      ]),
      3,
    ),
  );
  geometry.setIndex([
    0, 2, 1,
    0, 1, 3,
    0, 3, 2,
    1, 2, 3,
    4, 5, 6,
  ]);

  const analysis = analyzeShells(geometry);
  const result = removeSmallShells(geometry, analysis, 2);

  assert.equal(result.removedCount, 1);
  assert.equal(result.geometry.getIndex().count, 12);
});

test("security helpers reject invalid uploads and sanitize user input", async () => {
  const {
    validateUpload,
    validateFileContent,
    sanitizeStoragePath,
    sanitizeName,
  } = await loadSecurity();

  const traversalFile = new File(["mesh"], "../mesh.stl", { type: "model/stl" });
  assert.equal(validateUpload(traversalFile).valid, false);

  const bad3mf = new Uint8Array([0x00, 0x01, 0x02, 0x03]).buffer;
  assert.equal(validateFileContent(bad3mf, "fixture.3mf").valid, false);

  const goodObj = new TextEncoder().encode("v 0 0 0\nv 1 0 0\nf 1 2 2\n").buffer;
  assert.equal(validateFileContent(goodObj, "fixture.obj").valid, true);

  assert.equal(sanitizeStoragePath("Karaslice/jobs/user/job/original/input.stl").valid, true);
  assert.equal(sanitizeStoragePath("../escape.stl").valid, false);

  const sanitized = sanitizeName("  <b>Jane</b>\u0000 Doe  ");
  assert.equal(sanitized.valid, true);
  assert.equal(sanitized.sanitized, "Jane Doe");
});
