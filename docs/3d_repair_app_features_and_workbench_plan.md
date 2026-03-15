# 3D Repair Application Feature Plan
### Based on the current `Daemonaise/studio` repo and a proposed second repair module for the same viewport

---

## Current Build Review

Based on the repository README and project structure, the app already has a strong split between an in-browser 3D tool layer and a cloud repair layer.

### Already present in the repo
- Next.js app hosted with Firebase
- Three.js + `manifold-3d` WASM for in-browser 3D work
- A Karaslice in-browser slicer / analyzer flow
- A Cloud Run worker for mesh repair
- A multi-stage cloud repair pipeline
- Boolean splitting with fallback methods
- Mesh analysis actions and repair-job status route
- Firebase Storage + Firestore for artifacts and job state

### What that means strategically
You already have the right primitive pieces for a serious repair app:
- a browser viewport
- local interaction tools
- server-side repair execution
- storage + job orchestration
- a transfer path back into the viewport

The next move is not to replace the current screen, but to evolve it into a **Repair Workbench**.

---

## Product Direction

The screen should become a **single repair cockpit** with:
- one main viewport
- one left or top file / scene panel
- one right-side repair workbench
- one bottom diagnostics / job console
- one toggle or stacked panel for a second repair module

That second module should not feel like a separate page. It should feel like a second brain attached to the same mesh.

---

# Feature Inventory for a 3D Repair Application

## 1. Core File & Scene Tools

### Client-side
These should be instant and local.

- Drag-and-drop upload
- Multi-format preview for STL / OBJ / 3MF / PLY
- Orbit / pan / zoom / focus
- Bounding box display
- Units display and unit conversion preview
- Mesh statistics panel
- Wireframe toggle
- Shaded / normals / x-ray / matcap views
- Section clipping plane
- Face count / triangle density heatmap
- Defect overlays from backend report
- Shell / component visibility toggles
- Undo / redo for local operations
- Selection tools:
  - face select
  - lasso select
  - shell select
  - connected component select

### Advanced cloud processing
These are not worth pretending the browser can own at scale.

- Large file normalization at upload
- Full parse and validation of huge meshes
- High-memory scene indexing
- Persistent scene versions
- Multi-user file collaboration
- Saved repair sessions

---

## 2. Mesh Inspection & Diagnostics

### Client-side
Fast inspections and visual overlays.

- Triangle count
- Bounding volume and dimensions
- Aspect ratio warnings for sliver triangles
- Basic manifold check for smaller files
- Surface normal display
- Open edge highlighting
- Component count preview
- Wall-thin region preview if approximation is cheap
- Scale / printability quick scan
- Volume estimate if mesh is already watertight

### Advanced cloud processing
Heavy diagnostics that need full topology work.

- Robust non-manifold detection
- Boundary loop extraction
- Self-intersection detection
- Interior shell detection
- Thin-wall analysis across large meshes
- Curvature field generation
- Hole classification
- Duplicate / overlapping patch detection
- Ambiguous region scoring
- Printability analysis with material-aware rules

---

## 3. Direct Repair Tools

## A. Fast Local Repair Tools
These should be immediate and reversible.

### Client-side
- Recalculate normals
- Flip normals
- Merge coincident vertices within tolerance
- Remove duplicate faces
- Delete isolated tiny shells
- Basic hole fill for small simple loops
- Smooth selected region
- Laplacian relax on selected region
- Simple remesh on selected patch
- Decimate selected region
- Split into connected shells
- Align to ground
- Center / rotate / scale model
- Plane cut
- Boolean preview for small local cuts
- Export current local working state

These are useful because the user sees instant progress and can clean obvious junk before spending cloud compute.

## B. Heavy Repair Tools
These should be cloud jobs.

### Advanced cloud processing
- Global topology rebuild
- Half-edge / adjacency reconstruction
- Non-manifold resolution
- Large-scale hole patching
- Boundary seam pairing
- Curvature-aware surface continuation
- Thin-wall thickening
- Volumetric reconstruction
- Poisson or SDF-based watertight rebuild
- Feature-preserving remesh
- Mechanical hard-edge preservation
- Self-intersection repair
- Region-by-region confidence scoring
- Multi-hypothesis repair generation
- Structural shell reconstruction
- Rejection of floating artifacts into a separate mesh

---

## 4. Advanced Turning / Orientation / Preparation Tools

The phrase "advanced turning" makes sense as a preparation and repair aid, not just a camera control gimmick.

### Client-side
- Snap rotate 90 / 45 / custom angle
- Align to principal axis
- Auto-lay-flat suggestion
- Rotate around selected face normal
- Pivot to selected region
- Manual transform gizmo
- Slice plane rotation handles
- Compare original vs repaired orientation
- Save orientation preset
- Animation scrub for turntable inspection

### Advanced cloud processing
- Orientation optimization for printability
- Support-aware orientation scoring
- Strength-aware orientation recommendation
- Cost-aware orientation recommendation
- Distortion-risk orientation analysis
- Packing / nesting orientation for multiple parts

---

## 5. Reconstruction & Recovery Tools

### Client-side
- Preview candidate patch region
- Display possible seams
- Toggle candidate reconstructions
- Compare before / after shells
- Visual confidence heatmap
- Manual keep / reject patch selection

### Advanced cloud processing
- Surface inference from incomplete boundaries
- Curvature continuation
- Symmetry-based reconstruction
- Parametric patch fitting
- NURBS-like surface approximation
- Missing region completion
- Organic vs mechanical surface classification
- Candidate reconstruction ranking

---

## 6. Print & Manufacturing Tools

### Client-side
- Bounding box against printer profiles
- Over-limit warnings
- Unit mismatch warnings
- Quick split preview
- Orientation and support preview
- Estimated volume / mass preview
- Visual wall thickness hints

### Advanced cloud processing
- Automatic split planning for printer volume
- Connector planning between split parts
- Alignment key generation
- Tolerance compensation
- Material-aware min wall rules
- Cost / time estimation tied to repaired geometry
- Full slicer-grade manufacturability checks

---

## 7. Export & Versioning

### Client-side
- Export viewed mesh
- Export selected shell
- Save scene settings
- Download local diagnostic JSON
- Snapshot image export

### Advanced cloud processing
- Versioned repaired artifacts
- Original vs repaired diff package
- Rejected fragment package
- Repair report generation
- Audit trail
- Shareable review links
- Batch export for multiple repair candidates

---

# Recommended Second Repair Module

You said you want a second repair module on the same screen and viewport with various buttons for advanced turning and repair.

That is the right move.

## Best UX shape
Use the **same viewport**, but add a second docked work mode:

### Mode 1 — Quick Repair
For immediate local tools:
- normals
- weld
- remove junk shells
- simple fill
- smooth
- rotate
- cut
- split
- export

### Mode 2 — Advanced Repair
For guided cloud-assisted work:
- topology scan
- non-manifold repair
- open seam detection
- classify shells
- reconstruct missing regions
- watertight rebuild
- feature-preserving repair
- wall-thickness correction
- compare repair candidates

This avoids the clown show of sending users to a separate page and losing context.

---

# Recommended On-Screen Layout

## Main viewport
Center of screen. Always persistent.

## Left rail
- file tree
- shell list
- repair versions
- visibility toggles

## Right rail: Repair Workbench
Tabbed or segmented control:

- Inspect
- Quick Repair
- Advanced Repair
- Reconstruct
- Export

## Bottom drawer
- job progress
- pipeline logs
- diagnostics
- repair report
- warnings
- confidence summary

---

# Suggested Button Groups for the New Module

## Inspect
- Scan Mesh
- Show Open Edges
- Show Non-Manifold
- Show Thin Walls
- Show Components
- Show Sliver Triangles
- Show Self-Intersection Risk

## Quick Repair
- Recalc Normals
- Flip Normals
- Merge Close Vertices
- Remove Tiny Islands
- Fill Small Holes
- Split Shells
- Smooth Selection
- Decimate Selection

## Advanced Turning
- Lay Flat
- Auto Orient
- Align to Axis
- Rotate 45°
- Rotate 90°
- Rotate to Selected Face
- Save Orientation
- Compare Orientations

## Advanced Repair
- Full Topology Repair
- Resolve Non-Manifold
- Patch Boundary Loops
- Preserve Hard Edges
- Thickify Thin Walls
- Reconstruct Missing Areas
- Watertight Rebuild
- Generate Repair Variants

## Compare
- Show Original
- Show Repaired
- Side-by-Side Overlay
- Heatmap Difference
- Toggle Candidate A / B / C

## Export
- Export Repaired Mesh
- Export Rejected Fragments
- Export Repair Report
- Send to Quote
- Save Repair Session

---

# What Should Stay Client Side

Keep these client-side because they are immediate, visual, and cheap:

- viewport controls
- selections
- shell visibility
- orientation tools
- local transforms
- instant overlays
- small-file cleanup
- normals and duplicate cleanup
- simple hole patching
- scene and UI state
- compare toggles

---

# What Should Move to Advanced Cloud Processing

Move these to cloud jobs because they are topology-heavy, memory-heavy, or algorithmically expensive:

- full mesh graph reconstruction
- non-manifold repair
- robust hole patching
- seam inference
- volumetric rebuild
- watertight reconstruction
- self-intersection detection and correction
- thin-wall correction
- high-quality remeshing
- symmetry and surface inference
- repair confidence scoring
- multi-candidate repair generation

---

# Suggested Feature Phases

## Phase 1 — Same-Viewport Repair Workbench
- Add second repair module panel
- Keep one viewport
- Add Inspect / Quick Repair / Advanced Repair tabs
- Add shell list and repair report drawer
- Add orientation tool group
- Add compare original vs repaired toggle

## Phase 2 — Guided Cloud Repair
- Submit advanced jobs from same screen
- Show region-level defect overlays
- Stream repair progress into bottom console
- Auto-load returned repair candidate into viewport
- Keep original and repaired as switchable scene states

## Phase 3 — Reconstruction Studio
- Add multiple repair variants
- Add confidence heatmaps
- Add symmetry recovery
- Add feature-preserving rebuild modes
- Add partial repair targeting by selected region

---

# Recommended Naming

The second module could be named one of these:

- Repair Workbench
- Advanced Repair
- Reconstruction
- Mesh Surgery
- Karaslice Repair Lab

The least goofy and most scalable is probably **Repair Workbench**.

---

# Strong Recommendation

Do not create a second page.

Create a **second repair module inside the same viewport workflow**.

That gives you:
- continuity
- faster iteration
- easier compare mode
- shared scene state
- less UI friction
- cleaner mental model

The viewport should be the truth.
The side panels should be tools.
The cloud should be the heavy machinery.

That is the clean architecture.
