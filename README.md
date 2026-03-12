# Karasawa Labs

Precision 3D printing and automotive manufacturing platform — from rapid prototyping to full-scale production. Customers upload 3D models, get an AI-powered instant quote, and checkout directly through Stripe.

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 15.5 (App Router) |
| UI | React 19, Tailwind CSS v3, shadcn/ui |
| AI | Google Genkit + Gemini 2.5 Flash |
| Payments | Stripe Checkout |
| Shipping | Shippo REST API |
| 3D Engine | Three.js + manifold-3d (WASM) |
| Hosting | Firebase App Hosting |

## Key Features

- **AI Quote Wizard** — Upload STL/OBJ/3MF, pick a material and nozzle size, receive an AI-generated cost breakdown and lead time estimate
- **Split3r** — In-browser 3D model slicer: mesh repair, boolean splits via manifold-3d, OBJ/STL/ZIP export, unit conversion (mm/cm/in), custom printer volume input, and send-to-quote integration
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
│   │   └── split3r/          # Split3r page (shell + dynamic client)
│   ├── actions/
│   │   ├── checkout-actions.ts   # Stripe + Shippo server actions
│   │   ├── quote-actions.ts
│   │   └── assistant-actions.ts
│   ├── data/
│   │   ├── materials.ts
│   │   ├── pricing-matrix.json
│   │   └── printer-profiles.json # Printer build volumes for Split3r
│   ├── globals.css
│   ├── icon.svg              # Favicon (auto-detected by Next.js)
│   ├── layout.tsx
│   └── opengraph-image.tsx   # Dynamic OG image 1200x630
├── components/
│   ├── assistant/            # Floating chat bubble and interface
│   ├── layout/               # Header, footer, splash screen, page transition
│   ├── quote/                # AutomotiveQuoteWizard
│   ├── split3r/              # Split3r 3D slicer (see below)
│   └── ui/                   # shadcn/ui primitives
├── hooks/
└── lib/
    ├── split3r-transfer.ts   # Module-level store for passing split parts to quote
    └── utils.ts

public/
├── manifold/                 # manifold-3d WASM bundle (copied from node_modules)
│   └── manifold.js
├── images/
│   └── logo.svg              # Full Karasawa Labs wordmark SVG
└── index.html                # Firebase Hosting static fallback
```

## Split3r Architecture

Split3r is a fully client-side 3D model slicer at `/split3r`. All geometry processing runs in the browser — no server round-trips, no file uploads.

```
src/components/split3r/
├── split3r-app.tsx       # Main UI component (sidebar tabs + state)
├── viewport.tsx          # Three.js WebGL viewport (forwardRef, OrbitControls)
├── manifold-engine.ts    # Core geometry engine
└── stl-utils.ts          # Binary STL / OBJ export, mesh analysis
```

### Geometry Pipeline

```
File (STL / OBJ / 3MF)
  └─► Three.js BufferGeometry
        └─► Repair Pipeline (manifold-engine)
              ├── Exact vertex dedup (uint32 bit-pattern hash, zero epsilon)
              ├── Epsilon weld fallback (only if open edges remain after exact pass)
              ├── Remove degenerate triangles
              ├── Remove duplicate triangles
              ├── BFS winding consistency fix
              ├── Outward normal correction
              └── Ear-clip hole filling
                    └─► manifold-3d boolean split
                          └─► SplitPart[] → STL / OBJ / ZIP export
```

### Split3r UI Features

- **Unit selector** — Global mm / cm / in toggle; all dimensions, volumes, and surface areas convert in real-time
- **Custom printer volume** — Preset / Custom toggle in Pre-Split tab; manual X/Y/Z input in the current display unit, stored internally as mm
- **Auto-calculate cuts** — Compares mesh bounding box to printer volume and places cut planes where needed
- **Weight estimate** — Material density selector (PLA, PETG, ABS, ASA, TPU, Nylon, Resin, CF) with per-part and total weight

### manifold-engine exports

| Export | Description |
|---|---|
| `splitMesh` | Split a geometry along N planes using manifold-3d boolean ops |
| `repairMesh` | Run the full repair pipeline; returns `RepairStats` |
| `viewportPlaneToEngine` | Convert normalized viewport plane to world-space `EngineCutPlane` |
| `getManifoldAPI` | Lazy singleton loader for the manifold-3d WASM module |
| `computeGeometryVolume` | Signed-volume (divergence theorem) for a `BufferGeometry` |

### Repair Pipeline Detail

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
| Post-split normals | `toCreasedNormals` (30° crease angle) + `mergeVertices` for sharp cap edges without jagged seam artifacts |

## Required Environment Variables

```bash
# AI
GEMINI_API_KEY=

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

## Split3r → Quote Flow

1. User splits a model in Split3r
2. **Send Parts to Quote** serialises each part to binary STL and stores it in `split3rTransfer` (module-level store in `src/lib/split3r-transfer.ts`)
3. Router navigates to `/quote?from=split3r`
4. The Quote Wizard detects the `from=split3r` param and pre-loads the transferred files
5. The module-level store survives the client-side navigation (no page reload) and is cleared after pickup

## Deployment

Deployed via Firebase App Hosting (`apphosting.yaml`). The `public/` directory is the Firebase Hosting static fallback — the live Next.js app is served by the App Hosting backend.
