# Karasawa Labs

Precision 3D printing and automotive manufacturing platform — from rapid prototyping to full-scale production. Customers upload 3D models, get an AI-powered instant quote, and checkout directly through Stripe.

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 15.5 (App Router) |
| UI | React 19, Tailwind CSS v3, shadcn/ui |
| AI | Google Genkit + Gemini 3.1 Pro, Anthropic Claude (fallback) |
| Payments | Stripe Checkout |
| Shipping | Shippo REST API |
| 3D Engine | Three.js + manifold-3d (WASM) |
| Cloud Repair | Python (PyMeshLab + Open3D + trimesh) on Cloud Run |
| Storage | Firebase Storage + Firestore |
| Hosting | Firebase App Hosting |

## Key Features

- **AI Quote Wizard** — Upload STL/OBJ/3MF, pick a material and nozzle size, receive an AI-generated cost breakdown and lead time estimate
- **Karaslice** — In-browser 3D mesh slicer and analyzer: AI-driven mesh repair with auto-retry, boolean splits via manifold-3d, OBJ/STL/ZIP export, unit conversion (mm/cm/in), custom printer volume input, and send-to-quote integration
- **Cloud Mesh Repair** — Server-side 15-stage repair pipeline with feature edge preservation, thin wall detection/thickening, and 4-method reconstruction fallback chain; auto-loads results into the Karaslice viewport
- **Stripe Checkout** — Full payment flow with shipping info collected pre-checkout; metadata forwarded to fulfilment
- **Shippo Integration** — Automatic shipment creation and label purchase on order success; tracking info surfaced in the customer portal
- **Customer Portal** — Order history, status badges, and shipment tracking stored client-side (localStorage)
- **AI Engineering Assistant** — Chat interface powered by Gemini for material and design advice
- **Splash Screen and Page Transitions** — Futuristic animated loading screen on every visit; teal sweep transition between routes

## Project Structure

```
src/
├── ai/
│   ├── flows/
│   │   ├── ai-engineering-assistant-flow.ts
│   │   └── quote-generator-flow.ts
│   └── genkit.ts
├── app/
│   ├── (auth)/               # Login and register routes
│   ├── (main)/               # All public-facing pages
│   │   ├── assistant/
│   │   ├── automotive/
│   │   ├── checkout/success/
│   │   ├── contact/
│   │   ├── faq/
│   │   ├── materials/
│   │   ├── portal/           # Customer order portal
│   │   └── quote/
│   ├── (tools)/              # Tool pages (bare layout, no site header)
│   │   └── karaslice/        # Karaslice page (shell + dynamic client)
│   ├── actions/
│   │   ├── assistant-actions.ts      # AI assistant server action
│   │   ├── checkout-actions.ts       # Stripe + Shippo server actions
│   │   ├── cloud-repair-actions.ts   # Cloud mesh repair + split server actions
│   │   ├── mesh-analysis-actions.ts  # Mesh file analysis server action
│   │   └── quote-actions.ts          # Quote generation server action
│   ├── api/
│   │   └── repair-job/[jobId]/route.ts  # Job status GET + worker PATCH endpoint
│   ├── data/
│   │   ├── materials.ts
│   │   ├── pricing-matrix.json
│   │   └── printer-profiles.json     # Printer build volumes for Karaslice
│   ├── globals.css
│   ├── icon.svg              # Favicon (auto-detected by Next.js)
│   ├── layout.tsx
│   └── opengraph-image.tsx   # Dynamic OG image 1200x630
├── components/
│   ├── assistant/            # Floating chat bubble and interface
│   ├── karaslice/            # Karaslice 3D slicer (see below)
│   ├── layout/               # Header, footer, splash screen, page transition
│   ├── quote/                # AutomotiveQuoteWizard
│   └── ui/                   # shadcn/ui primitives
├── hooks/
└── lib/
    ├── firebase-admin.ts     # Firebase Admin SDK (Storage + Firestore singletons)
    ├── karaslice-transfer.ts # Module-level store for passing split parts to quote
    ├── mesh-analyzer.ts      # Mesh file parsing and metrics (STL, OBJ, 3MF, AMF)
    └── utils.ts

cloud-worker/                 # Cloud Run mesh repair worker (Python)
├── Dockerfile
├── deploy.sh                 # Build + deploy to Cloud Run
├── requirements.txt
├── main.py                   # Flask server (/health, /repair, /split)
├── repair_pipeline.py        # 15-stage repair pipeline
└── boolean_split.py          # Robust boolean split with 4-method fallback

public/
├── manifold/                 # manifold-3d WASM bundle (copied from node_modules)
│   └── manifold.js
├── images/
│   └── logo.svg              # Full Karasawa Labs wordmark SVG
└── index.html                # Firebase Hosting static fallback

docs/
├── ai-provider-reference.md       # AI provider models and Genkit integration patterns
├── ai-repair-plan.md              # AI-driven executable repair plan spec
├── blueprint.md                   # Original project blueprint
├── flipped-faces-nonmanifold-fix.md
├── grid-overflow-fix.md
├── karaslice-architecture.md      # Karaslice webapp architecture overview
├── mesh-pipeline.md               # Mesh processing pipeline architecture
├── mesh_repair_cloud_architecture.md  # Cloud repair architecture spec
├── mesh_repair_spec.md            # Topology-first mesh repair architecture spec
├── performance-analysis.md
├── poisson-reconstruction.md
├── post-mc-processing.md
├── shell-reconstruction.md
├── slicer-debugging.md
├── slicer-fix.md
└── voxel-reconstruction.md
```

## Architecture Overview

```
┌──────────────────────────────────────────────────────────────┐
│                     Browser Client                           │
│  Three.js viewport · AI analysis · basic topology repair     │
│  manifold-3d booleans · file upload/download                 │
└──────────────────┬───────────────────────────────────────────┘
                   │  Firebase Storage (mesh upload)
                   │  Firestore (job metadata)
                   ▼
┌──────────────────────────────────────────────────────────────┐
│                Next.js Server Actions                         │
│  cloud-repair-actions.ts · checkout-actions.ts               │
│  Triggers Cloud Run · Polls job status · Returns signed URLs │
└──────────────────┬───────────────────────────────────────────┘
                   │  Authenticated HTTP (identity token)
                   ▼
┌──────────────────────────────────────────────────────────────┐
│             Cloud Run Worker (Python)                         │
│  PyMeshLab · Open3D · trimesh                                │
│  8GB RAM · 4 CPU · 15min timeout · scale-to-zero             │
│  /repair endpoint · /split endpoint                          │
└──────────────────────────────────────────────────────────────┘
```

## Cloud Mesh Repair

The cloud repair system handles meshes too damaged or complex for browser-side repair. It runs on Cloud Run with scale-to-zero pricing.

### 15-Stage Repair Pipeline (`repair_pipeline.py`)

```
 1. Parse           — Load mesh via trimesh (STL/OBJ/3MF/PLY)
 2. Weld            — Vertex welding to close micro-gaps
 3. Sanitize        — Remove zero-area and degenerate triangles
 4. Components      — Extract connected components, remove debris
 5. Non-Manifold    — Iterative non-manifold edge/vertex removal (3 passes)
 6. Normals         — Consistent winding + outward normal correction
 7. Holes           — Progressive hole filling (small → medium → large, 3 passes)
 8. Self-Intersect  — Detect and resolve self-intersecting faces
 9. Reconstruct     — 4-method fallback chain (if needed):
                       Screened Poisson → Ball Pivoting → Alpha Shape → PyMeshLab Poisson
10. Post-Cleanup    — Remove reconstruction artifacts
11. Remesh          — Feature-preserving remesh (sharp edges untouched)
12. Thin Walls      — Ray-cast thickness detection + auto-thickening (< 0.8mm)
13. Simplify        — QEM decimation to target face count
14. Validate        — Quality score 0–100%, topology checks
15. Export          — Write repaired STL + JSON report
```

### Damage Classification

The pipeline classifies input meshes into severity levels:

| Level | Criteria | Action |
|---|---|---|
| Clean | Watertight, manifold, no issues | Skip repair |
| Minor | < 5% open edges, small holes | Topology fix only |
| Moderate | Non-manifold edges, medium holes | Full pipeline |
| Severe | > 30% open edges, self-intersections | Pipeline + reconstruction |
| Destroyed | Disconnected fragments, no usable topology | Full reconstruction |

### Competitive Features

Three capabilities that close the gap with commercial tools (Autodesk Netfabb, Materialise Magics):

1. **Feature Edge Preservation** — Dihedral angle analysis (`trimesh.face_adjacency_angles`) classifies sharp edges at a configurable threshold (default 30°). Remeshing only applies to smooth regions; sharp creases, chamfers, and fillets are preserved.

2. **Robust Boolean Split** — 4-method fallback chain for splitting meshes along cut planes:
   - Trimesh direct slice
   - Perturbed plane (3 jitter attempts)
   - Vertex classification with edge-cached intersections
   - Manual triangle clipping (always succeeds)

3. **Thin Wall Detection & Thickening** — Open3D `RaycastingScene` casts rays inward from each vertex along the inverted normal. Regions below the minimum thickness (0.8mm default) are automatically thickened by displacing vertices outward.

### Auto-Load into Viewport

When cloud repair completes, the client automatically:
1. Polls Firestore job status via server action
2. Detects `status: "finished"`
3. Fetches signed download URL from Firebase Storage
4. Downloads the repaired STL
5. Parses with `STLLoader` and calls `viewportRef.current.loadRepairedGeometry()`

No manual download or reload required — the repaired mesh appears seamlessly in the Karaslice viewport.

### AI Routing

When Gemini 3.1 Pro analyzes a mesh and recommends heavy reconstruction (`solid_voxel`, `shell_voxel`, or `point_cloud`), the UI automatically opens the Cloud Repair section instead of client-side reconstruction, with a notification: "Heavy repair needed — use Cloud Repair for best results."

## Karaslice Architecture

Karaslice is a 3D mesh slicer and analyzer at `/karaslice`. Basic topology repair runs client-side; heavy reconstruction routes to the cloud worker.

```
src/components/karaslice/
├── karaslice-app.tsx          # Main UI (sidebar tabs, state, cloud repair polling)
├── viewport.tsx               # Three.js WebGL viewport (forwardRef, OrbitControls)
├── manifold-engine.ts         # Core geometry engine (repair, split, booleans)
├── stl-utils.ts               # Binary STL / OBJ export, mesh analysis + diagnostics
├── voxel-reconstruct.ts       # Voxel-based mesh reconstruction (solid + shell)
├── poisson-reconstruct.ts     # Point cloud / MLS / SDF reconstruction
├── mesh-sanitize.ts           # Pre-reconstruction sanitation (dedup, debris, non-manifold)
└── validate-reconstruction.ts # Output validation (NaN, degenerates, topology, Euler)
```

### Client-Side Geometry Pipeline

```
File (STL / OBJ / 3MF)
  └─► Three.js BufferGeometry
        └─► AI Analysis (Gemini 3.1 Pro)
              ├── Geometry diagnostics (boundary loops, corruption clustering,
              │   normal consistency, gap widths, degenerate triangles)
              ├── Object identification + damage classification
              └── Prescribe 15+ reconstruction parameters
                    └─► Smart Routing
                          ├── Clean mesh → no repair needed
                          ├── Minor defects → client-side topology repair
                          └── Severe damage → Cloud Repair (server-side)
        └─► Client Repair Pipeline (manifold-engine)
              ├── Exact vertex dedup (uint32 bit-pattern hash, zero epsilon)
              ├── Epsilon weld fallback (only if open edges remain)
              ├── Remove degenerate triangles
              ├── Remove duplicate triangles
              ├── BFS winding consistency fix
              ├── Outward normal correction
              └── Ear-clip hole filling
                    └─► manifold-3d boolean split
                          └─► SplitPart[] → STL / OBJ / ZIP export
```

### Karaslice UI Features

- **Unit selector** — Global mm / cm / in toggle; all dimensions, volumes, and surface areas convert in real-time
- **Custom printer volume** — Preset / Custom toggle in Pre-Split tab; manual X/Y/Z input in the current display unit, stored internally as mm
- **Auto-calculate cuts** — Compares mesh bounding box to printer volume and places cut planes where needed
- **Weight estimate** — Material density selector (PLA, PETG, ABS, ASA, TPU, Nylon, Resin, CF) with per-part and total weight
- **Cloud Repair panel** — Submit to cloud, live 15-stage progress bar, full repair report with quality score, damage classification, feature edge count, thin wall stats, and download buttons
- **AI-Driven Reconstruction** — Gemini 3.1 Pro analyzes geometry diagnostics and prescribes exact parameters; auto-retry loop validates output and adjusts on failure
- **Pre-Reconstruction Sanitation** — Deterministic cleanup: duplicate face removal, debris component classification, non-manifold edge resolution via normal clustering
- **Slice Lines Toggle** — Show/hide cut plane lines in the 3D viewport

### manifold-engine exports

| Export | Description |
|---|---|
| `splitMesh` | Split a geometry along N planes using manifold-3d boolean ops |
| `repairMesh` | Run the full repair pipeline; returns `RepairStats` |
| `viewportPlaneToEngine` | Convert normalized viewport plane to world-space `EngineCutPlane` |
| `getManifoldAPI` | Lazy singleton loader for the manifold-3d WASM module |
| `computeGeometryVolume` | Signed-volume (divergence theorem) for a `BufferGeometry` |

### Client Repair Pipeline Detail

`repairMesh` and the internal pre-split repair both run these steps:

1. **Exact vertex dedup** — `exactMergeVertices` uses a `Uint32Array` view of the `Float32Array` position buffer and Knuth multiplicative hashing (`Math.imul`) to group vertices by identical IEEE 754 bit patterns — zero epsilon. If open edges still remain afterward, `diagnoseMesh` computes a `recommendedTol` and `mergeVertices` is called as a minimal-epsilon fallback for genuine CAD seams only.
2. **Degenerate removal** — zero-area and collapsed triangles removed
3. **Duplicate removal** — canonical-key deduplication (rotation-invariant)
4. **Winding fix** — BFS flood-fill propagates consistent winding across each connected component; inconsistent edges are flipped
5. **Normal correction** — signed-volume check; if negative, every triangle is globally reversed
6. **Hole filling** — boundary half-edges are walked into loops; each loop is triangulated with `earClip2D` (2D ear-clipping after Newell's-method projection), with centroid-fan fallback for degenerate/oversized loops (> 500 vertices)

If manifold construction still fails after repair, `splitMeshByClipping` is used as a fallback: each triangle is clipped directly against the plane using edge-cached intersection vertices (canonical key `min(vi,vj)*N+max(vi,vj)` ensures shared edges get identical cut points), then `fillHoles` caps the open cross-sections with ear-clip triangulation.

### ViewportHandle interface

```ts
interface ViewportHandle {
  getBakedGeometry(): { geo: BufferGeometry; bbox: Box3 } | null;
  getRawGeometry(): BufferGeometry | null;
  loadRepairedGeometry(geo: BufferGeometry, fileName: string): void;
}
```

### Viewport Rendering

The Three.js viewport uses physically-based rendering throughout:

| Setting | Value |
|---|---|
| Renderer | `WebGLRenderer` with `antialias: true`, `logarithmicDepthBuffer: true` |
| Pixel ratio | `min(devicePixelRatio, 2)` — sharp on HiDPI while capping GPU load |
| Color space | `SRGBColorSpace` |
| Tone mapping | `ACESFilmicToneMapping` (exposure 1.05) |
| Camera | `PerspectiveCamera` near=0.5, far=50000 |
| Mesh material | `MeshStandardMaterial` (PBR — roughness 0.45, metalness 0.15) |
| Lighting | `HemisphereLight` + warm key directional + cool fill directional |
| Resize | `ResizeObserver` on the mount div; `window resize` as fallback |
| Post-split normals | `toCreasedNormals` (30° crease angle) + `mergeVertices` for sharp cap edges |

## Cloud Worker Deployment

```bash
cd cloud-worker
./deploy.sh              # Local Docker build + deploy to Cloud Run
./deploy.sh --cloud-build  # Use Cloud Build instead of local Docker
```

Cloud Run configuration:
- **Memory**: 8GB
- **CPU**: 4 vCPU
- **Timeout**: 900s (15 minutes)
- **Concurrency**: 1 (one mesh per instance)
- **Max instances**: 5
- **Min instances**: 0 (scale-to-zero)
- **Auth**: `--no-allow-unauthenticated` (identity token required)

After deployment, set the `MESH_REPAIR_WORKER_URL` environment variable to the Cloud Run service URL.

## Required Environment Variables

```bash
# AI (primary: Gemini 3.1 Pro for mesh analysis, fallback: Anthropic Claude)
GEMINI_API_KEY=
ANTHROPIC_API_KEY=              # optional — fallback for mesh analysis + retry diagnosis

# Stripe (test keys: sk_test_ / pk_test_)
STRIPE_SECRET_KEY=
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=

# Shippo
SHIPPO_API_KEY=                    # shippo_test_... or shippo_live_...

# Shippo from-address for labels
SHIPPO_FROM_STREET=
SHIPPO_FROM_CITY=
SHIPPO_FROM_STATE=
SHIPPO_FROM_ZIP=
SHIPPO_FROM_PHONE=                 # E.164 format e.g. +15551234567
SHIPPO_FROM_EMAIL=

# Cloud Repair
MESH_REPAIR_WORKER_URL=            # Cloud Run service URL (set after deploy)

# App
NEXT_PUBLIC_BASE_URL=https://your-domain.com
```

## Development

```bash
npm install
npm run dev        # starts on http://localhost:9002
```

## Checkout Flow

1. User uploads model and AI generates a quote
2. User clicks **Proceed to Checkout** and fills in shipping details
3. `createCheckoutSession` builds a Stripe Checkout Session with full order metadata
4. Stripe redirects to `/checkout/success?session_id=cs_...`
5. `verifyAndFulfillOrder` confirms payment, then creates a Shippo shipment and purchases a shipping label
6. Order saved to `localStorage` key `kl_orders` for the customer portal
7. Customer profile (name, email) saved to `localStorage` key `kl_customer`

## Karaslice → Quote Flow

1. User splits a model in Karaslice
2. **Send Parts to Quote** serialises each part to binary STL and stores it in `karasliceTransfer` (module-level store in `src/lib/karaslice-transfer.ts`)
3. Router navigates to `/quote?from=karaslice`
4. The Quote Wizard detects the `from=karaslice` param and pre-loads the transferred files
5. The module-level store survives the client-side navigation (no page reload) and is cleared after pickup

## CI/CD

A GitHub Actions workflow (`.github/workflows/reconstruct-autofix.yml`) runs on pushes to reconstruction pipeline files. It:

1. Runs TypeScript type-checking
2. Runs reconstruction validation tests
3. If either fails, invokes a Claude agent to diagnose and auto-fix the issue, opening a PR with the fix

The workflow only triggers on changes to `voxel-reconstruct.ts`, `poisson-reconstruct.ts`, `validate-reconstruction.ts`, or `mesh-analysis-actions.ts` — keeping cloud costs minimal.

**Required secret:** `ANTHROPIC_API_KEY` in GitHub repo settings.

## Deployment

Deployed via Firebase App Hosting (`apphosting.yaml`). The `public/` directory is the Firebase Hosting static fallback — the live Next.js app is served by the App Hosting backend.

### Cloud Worker Prerequisite

Before the cloud repair feature works end-to-end:

1. Enable Firestore API in the GCP project
2. Deploy the worker: `cd cloud-worker && ./deploy.sh`
3. Set `MESH_REPAIR_WORKER_URL` in `apphosting.yaml` or `.env`
