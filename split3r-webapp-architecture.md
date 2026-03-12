# Split3r Web — Architecture & Phased Build Plan

## Project Overview

Browser-based 3D model splitter that replicates Split3r's core functionality. Upload oversized STL/OBJ files, analyze/repair meshes, configure cutting planes with real-time preview, generate interlocking tenon joints, and export print-ready split parts — all client-side.

**Stack:** React (Vite SPA) · Three.js · Manifold 3D (WASM) · Firebase Hosting

---

## Tech Stack & Key Libraries

| Layer | Technology | Purpose |
|-------|-----------|---------|
| Framework | React 18 + Vite | SPA, fast HMR, tree-shaking |
| 3D Engine | Three.js r168+ | STL/OBJ rendering, scene management |
| CSG/Boolean | manifold-3d (WASM) | Mesh splitting, boolean operations, tenon subtraction/union |
| Mesh Analysis | Custom + manifold-3d | Watertight checks, manifold validation, self-intersection detection |
| UI | Tailwind CSS + shadcn/ui | Utility-first styling, accessible components |
| State | Zustand | Lightweight global state (project, mesh, cut planes) |
| Persistence | localStorage + IndexedDB | Project saves, printer profiles, user settings (all local) |
| Hosting | Firebase Hosting | SPA deployment |
| Workers | Web Workers | Offload heavy mesh processing from main thread |

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────┐
│                    BROWSER (Client)                      │
│                                                         │
│  ┌──────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │  React   │  │  Three.js    │  │  Web Worker(s)   │  │
│  │  UI/UX   │──│  Viewport    │  │                  │  │
│  │  Panels  │  │  + Controls  │  │  ┌────────────┐  │  │
│  │          │  │              │  │  │ Manifold   │  │  │
│  │ - Import │  │ - Mesh Render│  │  │ 3D (WASM)  │  │  │
│  │ - Analyze│  │ - Cut Planes │  │  │            │  │  │
│  │ - Repair │  │ - Tenon Prev │  │  │ - Boolean  │  │  │
│  │ - Scale  │  │ - Explode    │  │  │ - Split    │  │  │
│  │ - Shell  │  │ - Labels     │  │  │ - Tenons   │  │  │
│  │ - PreSplit│  │              │  │  │ - Repair   │  │  │
│  │ - Split  │  │              │  │  │ - Analysis │  │  │
│  │ - Export │  │              │  │  └────────────┘  │  │
│  └────┬─────┘  └──────────────┘  └────────┬─────────┘  │
│       │            Zustand Store           │            │
│       └────────────────┬───────────────────┘            │
│                        │                                │
│       ┌────────────────┴────────────────┐               │
│       │  localStorage + IndexedDB       │               │
│       │  (projects, settings, profiles) │               │
│       └─────────────────────────────────┘               │
└─────────────────────────────────────────────────────────┘
                         │
              ┌──────────┴──────────┐
              │  Firebase Hosting   │
              └─────────────────────┘
```

---

## Data Models

### Local Storage Schema (IndexedDB + localStorage)

All data lives in the browser. No server-side persistence. Projects and meshes stored in IndexedDB (handles large binary blobs); settings and printer profiles in localStorage.

```
IndexedDB: "split3r-db"
├── objectStore: "projects"
│   key: projectId (uuid)
│   ├── name: string
│   ├── createdAt: number (epoch ms)
│   ├── updatedAt: number (epoch ms)
│   ├── originalFile: {
│   │     name: string,
│   │     arrayBuffer: ArrayBuffer,       // raw STL/OBJ bytes
│   │     format: "stl" | "obj",
│   │     fileSizeMB: number,
│   │     boundingBox: { x: number, y: number, z: number },
│   │     triangleCount: number
│   │   }
│   ├── analysisResult: {
│   │     isWatertight: boolean,
│   │     isManifold: boolean,
│   │     hasSelfIntersections: boolean,
│   │     bodyCount: number,
│   │     issues: string[]
│   │   }
│   ├── printerProfile: string (profile id)
│   ├── cutConfig: {
│   │     maxPartSize: { x: number, y: number, z: number },
│   │     moveStep: number,
│   │     planes: [
│   │       { axis: "x"|"y"|"z", position: number, enabled: boolean }
│   │     ]
│   │   }
│   ├── tenonConfig: {
│   │     type: "pyramid" | "round" | "rectangular" | "custom",
│   │     size: number (mm),
│   │     hollow: boolean,
│   │     clearance: number (mm),
│   │     countPerFace: number
│   │   }
│   ├── splitResult: {
│   │     partCount: number,
│   │     parts: [
│   │       { index: number, label: string, arrayBuffer: ArrayBuffer,
│   │         boundingBox: { x, y, z }, triangleCount: number }
│   │     ],
│   │     completedAt: number
│   │   }
│   └── transforms: {
│         scale: { x: number, y: number, z: number },
│         rotation: { x: number, y: number, z: number },
│         shellThickness: number | null
│       }

localStorage:
├── "split3r-settings": JSON {
│     defaultPrinter: string,
│     defaultTenonSize: number (mm),
│     defaultClearance: number (mm),
│     units: "mm" | "inches"
│   }
├── "split3r-custom-printers": JSON [] (user-added printer profiles)
└── "split3r-recent-projects": JSON [] (project id + name + date for quick access)

Bundled (static JSON, imported at build time):
└── printerProfiles.json — 150+ printer profiles with build volumes
```

### Client State (Zustand)

```typescript
interface AppState {
  // Current Project
  project: Project | null;
  meshData: {
    geometry: THREE.BufferGeometry;
    manifoldMesh: ManifoldMesh; // WASM reference
    boundingBox: THREE.Box3;
    triangleCount: number;
  } | null;
  
  // Workflow Mode
  mode: "prepare" | "presplit" | "split" | "explode";
  
  // Prepare State
  analysisResult: AnalysisResult | null;
  transforms: TransformStack; // non-destructive pipeline
  
  // PreSplit State
  selectedPrinter: PrinterProfile | null;
  cutPlanes: CutPlane[];
  activePlaneIndex: number | null;
  moveStep: number;
  ghostView: boolean;
  
  // Tenon Config
  tenonConfig: TenonConfig;
  
  // Split State
  splitProgress: number; // 0-100
  splitParts: SplitPart[];
  
  // Explode State
  explodeAmount: number; // 0-1
  labelVisibility: boolean;
  selectedParts: number[];
}
```

---

## Feature Breakdown by Phase

### Phase 1: Foundation (Weeks 1–2)
**Goal:** File import, 3D viewport, local project persistence

- [ ] Vite + React project scaffold with Tailwind + shadcn/ui
- [ ] Firebase Hosting config
- [ ] IndexedDB wrapper (idb library) for project storage
- [ ] localStorage for settings and custom printer profiles
- [ ] STL file import via drag-and-drop (Three.js STLLoader)
- [ ] OBJ file import (Three.js OBJLoader)
- [ ] 3D viewport with OrbitControls (rotate, pan, zoom)
- [ ] Bounding box display + model dimensions overlay
- [ ] Triangle count + file size display
- [ ] Basic project save/load to IndexedDB
- [ ] Printer profiles bundled as static JSON (150+ profiles with build volumes)
- [ ] Recent projects list on landing page
- [ ] Responsive sidebar layout (file tree / properties / viewport)

### Phase 2: Mesh Analysis & Repair (Weeks 3–4)
**Goal:** Analyze mesh health, repair common issues

- [ ] Web Worker setup for Manifold WASM operations
- [ ] **Analyze** function:
  - Watertight check (open edges detection)
  - Manifold validation
  - Self-intersection detection
  - Multi-body detection (disconnected components)
  - Body count enumeration
  - Visual highlighting of problem areas (red overlay on bad faces/edges)
- [ ] **Repair** functions:
  - Algorithm 1: Standard — merge bodies, fix holes, remove duplicate faces, fix normals
  - Algorithm 2: Manifold-based — use manifold-3d's built-in mesh repair
  - Algorithm 3: Aggressive — remesh/simplify for heavily damaged meshes
- [ ] Repair result comparison (before/after stats)
- [ ] Non-destructive pipeline: each operation creates a new version in the file tree
- [ ] Workzone tree panel (active file tracking, visibility toggle, version history)

### Phase 3: Prepare Tools (Weeks 5–6)
**Goal:** Scale, rotate, shell — all non-destructive

- [ ] **Rotate** — 3-axis gizmo with 5°/1°/free step modes
  - Visual rotation arcs (X=red, Y=orange, Z=green matching Split3r)
  - Keyboard modifiers: Ctrl=1°, Shift=free
- [ ] **Scale** — by percentage, absolute mm, or factor
  - Per-axis independent scaling
  - Lock aspect ratio toggle
  - Real-time bounding box preview
- [ ] **AutoShell** (Hollowing):
  - Configurable wall thickness (mm)
  - Voxel-based approach using Manifold's offset operations
  - Preview in ghost/transparent view
  - Memory estimation before execution
  - Minimum thickness warnings (< 15mm for tenon compatibility)
- [ ] File tree with versioned outputs (-Ori, -Rep, -Sca, -She suffixes)
- [ ] Active file indicator (bold) with double-click to activate

### Phase 4: Pre-Split & Cut Plane Configuration (Weeks 7–9)
**Goal:** Printer selection, cut plane placement, real-time preview

- [ ] Printer profile selector dropdown (150+ profiles from bundled JSON)
- [ ] Custom printer profile creation (saved to localStorage)
- [ ] Auto-calculate cut plane grid from build volume + model size
- [ ] Manual cut plane adjustment:
  - Per-axis plane add/remove/move
  - Draggable plane handles in 3D viewport
  - Keyboard shortcuts (numpad 2/4/6/8/3/9 for axis movement)
  - Configurable move step size
- [ ] Real-time slice preview (transparent planes with intersection lines)
- [ ] Ghost view toggle (G key) — semi-transparent model
- [ ] Part count estimator (updates live as planes move)
- [ ] Plane position snapping to grid
- [ ] Cut size constraints enforcement (warn if part exceeds build volume)
- [ ] **Tenon Configuration:**
  - Type selector: pyramid, round, rectangular
  - Size slider (2mm – 20mm+)
  - Hollow vs. solid toggle
  - Clearance/tolerance adjustment (press-fit to loose)
  - Count per face control
  - Tenon preview on cut surfaces
- [ ] Pre-split state save to IndexedDB project record

### Phase 5: Split Engine (Weeks 10–12)
**Goal:** Execute the split, generate labeled interlocking parts

- [ ] Split execution pipeline (Web Worker):
  1. Take active mesh + plane configuration
  2. For each cutting plane, perform boolean intersection/difference
  3. Generate tenon geometry (pyramidal/round/rectangular)
  4. Boolean union tenons onto positive-side parts
  5. Boolean subtract tenon cavities from negative-side parts
  6. Apply clearance offset to female joints
  7. Engrave part labels (X.Y.Z-n format) as geometry
  8. Generate individual STL buffers for each part
- [ ] Progress indicator with part-by-part updates
- [ ] Multi-threaded splitting (multiple Web Workers for parallel plane cuts)
- [ ] Part labeling:
  - Automatic X.Y.Z coordinate-based naming
  - Engraved number geometry on each part surface
  - Logical filename generation
- [ ] Split result storage (individual STL buffers saved to IndexedDB project record)
- [ ] Error handling for failed boolean operations (non-manifold results)

### Phase 6: Explode View & Export (Weeks 13–14)
**Goal:** Review split parts, export for slicers

- [ ] **Explode mode:**
  - Animated explosion (E key toggle)
  - Configurable explode distance slider
  - Tighten (T key) — reverse animation
  - Per-part color coding
  - Part label overlay (L key toggle)
  - Camera reset to fit all (R key)
- [ ] Parts tree panel:
  - Multi-select parts
  - Show/hide individual parts
  - Highlight selected part in viewport
  - Part dimensions + triangle count
- [ ] **Export:**
  - Individual STL download per part
  - Batch ZIP download (all parts)
  - Assembly guide image export (exploded view screenshot)
  - Project file export (.json equivalent of .s3r)
- [ ] Slicer compatibility notes (file naming convention for auto-arrangement)

### Phase 7: Polish & Advanced Features (Weeks 15–16)
**Goal:** UX refinement, performance, edge cases

- [ ] Keyboard shortcut overlay/help panel
- [ ] Undo/redo across all operations
- [ ] Dark mode / light mode toggle
- [ ] Viewport performance optimization (LOD, instancing for many parts)
- [ ] Large file handling (progressive loading, mesh decimation for preview)
- [ ] Custom tenon STL import
- [ ] Manual single-plane cut tool (beta feature from Split3r)
- [ ] Project import/export (.json file for portability between browsers)
- [ ] PWA support for offline use
- [ ] Mobile-responsive viewport (touch controls)

---

## Key Technical Decisions

### Why Manifold 3D (WASM)?
- Google-backed, production-grade CSG library compiled to WASM
- Handles boolean operations (split = intersection/difference) reliably
- Built-in mesh repair and manifold enforcement
- ~10-50x faster than pure JS alternatives (three-bvh-csg)
- npm package: `manifold-3d`

### Why Web Workers?
- Mesh operations on 250MB files will freeze the main thread
- Manifold WASM runs in a worker, posts results back as transferable ArrayBuffers
- Split operations can be parallelized across multiple workers

### Why Zustand over Redux?
- Minimal boilerplate for a project this size
- Direct mutation-style API works well with Three.js scene state
- Easy middleware for persistence (IndexedDB sync)

### File Size Limits
- IndexedDB browser quota: typically 50% of available disk (varies by browser)
- Individual file import limit: 250MB (matching Split3r)
- Recommend clearing old projects if storage quota approached

---

## Firebase Configuration (Hosting Only)

### firebase.json
```json
{
  "hosting": {
    "public": "dist",
    "ignore": ["firebase.json", "**/.*", "**/node_modules/**"],
    "rewrites": [{ "source": "**", "destination": "/index.html" }],
    "headers": [
      {
        "source": "**/*.wasm",
        "headers": [{ "key": "Content-Type", "value": "application/wasm" }]
      },
      {
        "source": "**",
        "headers": [
          { "key": "Cross-Origin-Opener-Policy", "value": "same-origin" },
          { "key": "Cross-Origin-Embedder-Policy", "value": "require-corp" }
        ]
      }
    ]
  }
}
```

> **Note:** The COOP/COEP headers are required for `SharedArrayBuffer`, which enables multi-threaded WASM (Manifold) via Web Workers with shared memory.

---

## Printer Profiles Seed Data (Sample)

| Printer | Build Volume (mm) |
|---------|-------------------|
| Bambu Lab X1C | 256 × 256 × 256 |
| Bambu Lab P1S | 256 × 256 × 256 |
| Bambu Lab A1 | 256 × 256 × 256 |
| Bambu Lab A1 Mini | 180 × 180 × 180 |
| Prusa MK4/S | 250 × 210 × 220 |
| Prusa XL (single) | 360 × 360 × 360 |
| Prusa MINI+ | 180 × 180 × 180 |
| Creality Ender 3 V3 | 220 × 220 × 250 |
| Creality K1 Max | 300 × 300 × 300 |
| Creality Ender 5 S1 | 220 × 220 × 280 |
| Elegoo Neptune 4 Pro | 225 × 225 × 265 |
| Elegoo Neptune 4 Max | 420 × 420 × 480 |
| Anycubic Kobra 2 Max | 420 × 420 × 500 |
| Anycubic Kobra 3 | 250 × 250 × 260 |
| Voron 2.4 (350) | 350 × 350 × 340 |
| Voron Trident (300) | 300 × 300 × 250 |
| Artillery Sidewinder X4+ | 300 × 300 × 400 |
| FlashForge Adventurer 5M Pro | 220 × 220 × 220 |
| Qidi Tech Q1 Pro | 245 × 245 × 245 |
| Sovol SV08 | 350 × 350 × 400 |

---

## Deployment

```bash
# Build
npm run build

# Deploy to Firebase Hosting
firebase deploy --only hosting
```

---

## Risk Register

| Risk | Mitigation |
|------|-----------|
| Manifold WASM boolean ops fail on dirty meshes | Repair pipeline runs before split; fallback to simplified mesh |
| Large files crash browser tab | Web Worker isolation; progressive loading; file size warnings > 100MB |
| Tenon geometry intersects thin walls | Wall thickness validation before tenon placement; auto-reduce tenon count |
| Label engraving fails on curved surfaces | Project text onto nearest flat face; fallback to filename-only labeling |
| IndexedDB quota exceeded | Prompt user to delete old projects; show storage usage in settings; compress STL buffers (binary format) |
| WASM module size (Manifold ~2MB) | Lazy-load on first mesh operation; cache with service worker |

---

## Directory Structure

```
split3r-web/
├── public/
│   └── manifold.wasm
├── src/
│   ├── components/
│   │   ├── layout/
│   │   │   ├── Sidebar.tsx
│   │   │   ├── Toolbar.tsx
│   │   │   └── StatusBar.tsx
│   │   ├── viewport/
│   │   │   ├── ThreeViewport.tsx
│   │   │   ├── CutPlaneHelper.tsx
│   │   │   ├── TenonPreview.tsx
│   │   │   ├── ExplodeController.tsx
│   │   │   └── LabelOverlay.tsx
│   │   ├── panels/
│   │   │   ├── WorkzoneTree.tsx
│   │   │   ├── AnalysisPanel.tsx
│   │   │   ├── PreparePanel.tsx
│   │   │   ├── PreSplitPanel.tsx
│   │   │   ├── SplitPanel.tsx
│   │   │   ├── ExplodePanel.tsx
│   │   │   └── PrinterSelector.tsx
│   │   └── shared/
│   │       ├── FileDropzone.tsx
│   │       ├── ProgressBar.tsx
│   │       └── KeyboardShortcuts.tsx
│   ├── workers/
│   │   ├── manifold.worker.ts
│   │   ├── analysis.worker.ts
│   │   └── split.worker.ts
│   ├── lib/
│   │   ├── db.ts                    # IndexedDB wrapper (idb)
│   │   ├── manifold-bridge.ts      # Main thread <-> Worker messaging
│   │   ├── mesh-analysis.ts        # Watertight, manifold, intersection checks
│   │   ├── mesh-repair.ts          # 3 repair algorithms
│   │   ├── split-engine.ts         # Orchestrates plane cuts + tenon generation
│   │   ├── tenon-generator.ts      # Pyramid, round, rectangular tenon geometry
│   │   ├── label-engraver.ts       # Part number geometry generation
│   │   ├── stl-exporter.ts         # Binary STL export
│   │   └── project-manager.ts      # IndexedDB CRUD for projects
│   ├── store/
│   │   ├── appStore.ts             # Zustand root store
│   │   ├── meshSlice.ts
│   │   ├── cutPlaneSlice.ts
│   │   └── projectSlice.ts
│   ├── data/
│   │   └── printerProfiles.json    # 150+ printer build volumes
│   ├── hooks/
│   │   ├── useThreeScene.ts
│   │   ├── useManifold.ts
│   │   ├── useKeyboardShortcuts.ts
│   │   └── useProject.ts
│   ├── App.tsx
│   ├── main.tsx
│   └── index.css
├── firebase.json
├── vite.config.ts
├── tailwind.config.ts
├── tsconfig.json
└── package.json
```
