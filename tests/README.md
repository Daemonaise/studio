# Test Suite Documentation

## Overview

The Karaslice test suite validates geometry pipeline utilities, frontend components, API routes, and the cloud worker. Tests are split into two runners:

- **Node.js native test runner** (`node --test`) — geometry/pipeline/security unit tests
- **Vitest** (`npx vitest run`) — React component and API route tests

## Running Tests

```bash
# All geometry/pipeline tests (node:test)
node --test tests/components-utils.test.mjs
node --test tests/manifold-engine.test.mjs
node --test tests/repair-modules.test.mjs

# All frontend tests (vitest)
npx vitest run tests/frontend/

# Cloud worker tests (Python unittest)
cd cloud-worker && python -m pytest tests/test_main.py
```

## Test Structure

```
tests/
  components-utils.test.mjs   — STL/OBJ export, analysis, validation, print-prep, shells, security
  manifold-engine.test.mjs    — Repair pipeline, winding fix, hole filling, volume computation
  repair-modules.test.mjs     — Voxel/shell/point-cloud reconstruction, simplification, smoothing
  frontend/
    setup.ts                   — Vitest setup (jsdom)
    button.test.tsx            — Button component rendering and variants
    karaslice-app-flow.test.tsx — Full app flow: upload → analyze → repair mode selection
    karaslice-name-gate.test.tsx — Name gate form validation and submission
    karaslice-pages.test.tsx   — Route gating: auth redirects, sales page, name gate display
    api-routes.test.ts         — API route security: sanitization, rate limiting, field whitelisting
  .compiled/                   — esbuild-transpiled modules (auto-generated, gitignored)
cloud-worker/tests/
  test_main.py                 — Cloud worker endpoint validation, security, error handling
```

---

## Test Details

### `components-utils.test.mjs` (12 tests)

Tests the core utility modules that support the Karaslice UI.

| # | Test | Module | What it validates |
|---|------|--------|-------------------|
| 1 | STL buffer header and triangle count | `stl-utils` | Binary STL export writes correct 80-byte header + triangle count |
| 2 | OBJ string format | `stl-utils` | OBJ export contains object name, vertices, normals, and faces |
| 3 | Watertight mesh analysis | `stl-utils` | `analyzeGeometry` correctly identifies a closed tetrahedron |
| 4 | Open boundary detection | `stl-utils` | `analyzeGeometry` detects open edges, boundary loops, and gap widths |
| 5 | NaN + degenerate detection | `validate-reconstruction` | Flags NaN vertices and collapsed triangles in reconstruction output |
| 6 | Open boundary + Euler check | `validate-reconstruction` | Detects boundary edges and Euler characteristic mismatch |
| 7 | Clean geometry validation | `validate-reconstruction` | Passes a valid closed tetrahedron with no failures |
| 8 | Overhang face detection | `print-prep-analysis` | `computeOverhangs` flags downward-facing faces with correct severity |
| 9 | Printability scoring | `print-prep-analysis` | Penalizes overhangs, thin walls, and non-watertight meshes |
| 10 | Shell decomposition | `shell-analysis` | `analyzeShells` separates two disconnected tetrahedrons |
| 11 | Small shell removal | `shell-analysis` | `removeSmallShells` drops shells below triangle threshold |
| 12 | Security helpers | `security` | Upload validation, magic byte checks, path sanitization, name sanitization |

### `manifold-engine.test.mjs` (8 tests)

Tests the manifold-3d integration layer: repair pipeline, topology operations.

| # | Test | What it validates |
|---|------|-------------------|
| 1 | Volume computation | `computeGeometryVolume` returns correct signed volume for a unit cube |
| 2 | Degenerate triangle removal | Collapsed faces are stripped from indexed geometry |
| 3 | Winding consistency fix | BFS flood-fill makes all triangle windings consistent |
| 4 | Outward normal correction | Globally inverted mesh (all normals inward) gets flipped |
| 5 | Hole sealing | `repairMesh` fills open boundaries and reports watertight result |
| 6 | Single flipped face repair | Fixes one reversed triangle on an otherwise closed solid |
| 7 | Global inversion repair | Detects and corrects fully inside-out winding |
| 8 | Seam welding | Welds a tiny positional gap before repairing topology |

### `repair-modules.test.mjs` (11 tests)

Tests reconstruction pipelines, post-processing, and wall thickness estimation.

| # | Test | Module | What it validates |
|---|------|--------|-------------------|
| 1 | Voxel basic output | `voxel-reconstruct` | Produces non-empty geometry with position attribute |
| 2 | Voxel resolution clamping | `voxel-reconstruct` | Grid dimensions stay within safety limits |
| 3 | Shell voxel output | `voxel-reconstruct` | Shell mode produces geometry for thin-walled input |
| 4 | Taubin smoothing | `voxel-reconstruct` | `taubinSmooth` modifies vertex positions without NaN |
| 5 | Quadric simplification | `voxel-reconstruct` | Reduces triangle count while preserving mesh integrity |
| 6 | Wall thickness estimation | `voxel-reconstruct` | Ray-based wall thickness returns values near expected 1mm |
| 7 | Post-processing pipeline | `voxel-reconstruct` | `postProcessVoxelOutput` applies creased normals even with no smoothing |
| 8 | Degenerate input rejection | `poisson-reconstruct` | `pointCloudReconstruct` throws on zero-area input |
| 9 | Auto-resolution computation | `poisson-reconstruct` | Resolution auto-scaling respects grid cell limits |
| 10 | Grid padding safety | `poisson-reconstruct` | Excessive padding is clamped to prevent grid overflow |
| 11 | Point cloud output | `poisson-reconstruct` | Produces indexed geometry with valid positions |

### `frontend/button.test.tsx` (4 tests)

| # | Test | What it validates |
|---|------|-------------------|
| 1 | Renders children | Button renders text content with correct semantics |
| 2 | Variant + size classes | CSS classes applied for different variants and sizes |
| 3 | Click handlers | onClick callback fires on user interaction |
| 4 | buttonVariants export | Utility function available for class composition |

### `frontend/karaslice-app-flow.test.tsx` (1 test)

End-to-end flow test with mocked viewport, auth, and storage:

| # | Test | What it validates |
|---|------|-------------------|
| 1 | Upload → analyze → repair | Simulates file upload event, triggers AI analysis, verifies repair mode buttons appear based on analysis severity |

Uses a full mock viewport with `getRawGeometry`, `replaceGeometry`, `showSupportPreview`, and `clearDefectOverlays`.

### `frontend/karaslice-name-gate.test.tsx` (3 tests)

| # | Test | What it validates |
|---|------|-------------------|
| 1 | Form validation | Submit disabled until both first and last name entered |
| 2 | Name submission | Trimmed full name sent via POST to `/api/auth/update-name` |
| 3 | Error display | API errors shown to user, no page refresh on failure |

### `frontend/karaslice-pages.test.tsx` (6 tests)

| # | Test | What it validates |
|---|------|-------------------|
| 1 | Auth redirect | Signed-in users redirected from `/karaslice` to `/karaslice/app` |
| 2 | Sales page | Signed-out visitors see the sales page |
| 3 | App gating | Signed-out users redirected away from `/karaslice/app` |
| 4 | Name gate display | Users with email-matching names see the name gate |
| 5 | Cookie override | Users with display name cookie see the app directly |
| 6 | Profile name | Users with real profile names bypass the name gate |

### `frontend/api-routes.test.ts` (4 tests)

| # | Test | What it validates |
|---|------|-------------------|
| 1 | Name sanitization | HTML tags and control chars stripped, cookie set correctly |
| 2 | Rate limiting | Returns 429 when rate limiter is exhausted |
| 3 | Job ID validation | Rejects invalid job IDs before touching Firestore |
| 4 | PATCH field whitelisting | Only allowed fields pass through to Firestore update |

### `cloud-worker/tests/test_main.py` (Python)

Tests the Flask cloud worker endpoints with fully mocked GCP dependencies.

| Area | What it validates |
|------|-------------------|
| Health | `/health` returns 200 |
| Input validation | Rejects missing fields, invalid job IDs, path traversal, oversized files |
| Repair endpoint | Validates request format, calls `run_repair_pipeline`, updates Firestore status |
| Split endpoint | Validates plane specifications, calls `robust_split` |
| Analyze endpoint | Validates overhang threshold and wall thickness ranges |
| Hollow endpoint | Validates wall thickness range, escape hole limits, job ID format |

## How Tests Work

### Geometry Tests (node:test)

Source `.ts` files are compiled on-the-fly using **esbuild** (`transformSync`) to ESM `.mjs` files in `tests/.compiled/`. This avoids needing a full bundler while supporting TypeScript imports. Tests use **three.js** directly for geometry fixtures (tetrahedrons, boxes, open meshes).

### Frontend Tests (vitest)

Use **jsdom** environment with `@testing-library/react`. Heavy dependencies (viewport/Three.js, auth, storage, navigation) are vi.mocked. The `vitest.config.ts` configures path aliases matching `tsconfig.json`.

### Cloud Worker Tests (Python)

Use `unittest` with `unittest.mock` to stub GCP clients (Storage, Firestore) and pipeline modules. The Flask app is loaded via `importlib` after injecting mock modules into `sys.modules`.
