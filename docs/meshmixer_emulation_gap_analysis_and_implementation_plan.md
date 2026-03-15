# Meshmixer-Style Feature Gap Analysis & Implementation Plan
## Based on the current `Daemonaise/studio` architecture

---

## Executive Summary

Your current application already has the correct **high-level architecture** for a Meshmixer-class product:

- **Next.js / Firebase-hosted browser app**
- **Three.js + manifold-3d WASM** for in-browser 3D operations
- **Karaslice** as an existing tool surface
- **Cloud mesh repair worker** running on Cloud Run
- **Server actions** for mesh analysis and repair orchestration
- **Firebase Storage + Firestore** for artifacts and job state

That means you are **not starting from zero**. You already have the foundation of a modern browser + cloud mesh workflow.

What you do **not yet appear to have** is the deeper **interactive mesh surgery layer** that made Meshmixer useful:

- defect visualization
- shell/object management
- instant local repair tools
- sculpt and brush editing
- richer orientation / turning tools
- print-prep tools like thickness / overhang / hollowing
- compare/history/version workflows
- a stronger native geometry core for future advanced reconstruction

The path forward is to evolve the current Karaslice experience into a **single-screen Repair Workbench** with one persistent viewport and multiple docked tool modules.

---

# 1. What the Current Repo Already Gives You

## Present architecture
From the current repository structure and README, the platform already includes:

- Next.js 15.5 with App Router
- React 19, Tailwind, shadcn/ui
- Three.js + `manifold-3d` WASM as the browser 3D engine
- Python cloud repair worker on Cloud Run
- PyMeshLab + Open3D + trimesh in the cloud worker
- Firebase Storage + Firestore for assets and state
- Karaslice as the existing in-browser mesh slicer / analyzer
- mesh analysis server actions
- cloud repair actions
- a repair-job route for job state polling / patching
- printer profile data
- boolean split pipeline with fallback methods
- a cloud repair pipeline described as 15-stage with thin-wall detection / thickening, feature edge preservation, and reconstruction fallback chain

## Strategic meaning
That stack is already stronger than a basic desktop-only tool in one important way:

- browser for visualization and user interaction
- cloud for heavy geometry work
- storage and job state already wired
- returned repaired artifacts can already flow back into the viewport

So the next job is not to invent the platform.  
The next job is to **deepen the tool surface**.

---

# 2. Target Product Vision

You said you want a **full Meshmixer emulation**.

The cleanest product direction is:

## A. Keep one viewport
Do not split the user into separate pages and disconnected repair screens.

The viewport should remain the truth.

## B. Turn the current tool page into a Repair Workbench
Use one shared scene and add docked modules around it:

- **Inspect**
- **Quick Repair**
- **Advanced Repair**
- **Sculpt**
- **Prepare**
- **Compare / Export**

## C. Add a second repair module in the same screen
This is the right move.

That second module should share:
- the same loaded mesh
- the same camera
- the same selection state
- the same shell/component state
- the same repair history

That avoids UI fragmentation and preserves context.

---

# 3. What Meshmixer-Class Capability Really Requires

A full Meshmixer-style application is not just “repair.”

It is a combination of:

1. Mesh inspection and defect visualization  
2. Local editing and direct manipulation  
3. Automated repair and reconstruction  
4. Print-prep and manufacturing tools  
5. Version comparison and export flows  

Your current repo appears strongest in category 3, and partially in 4 via Karaslice and printer profile support.

The biggest gaps are categories 1, 2, and 5.

---

# 4. Missing Tool Categories

## 4.1 Inspector-Style Defect Visualization

This is one of the highest-value missing systems.

### Tools to add
- open-edge overlay
- non-manifold edge overlay
- disconnected component overlay
- inverted-normal highlighting
- sliver triangle heatmap
- thin-wall heatmap
- curvature / sharp-edge visualization
- self-intersection risk overlay
- duplicate / overlapping patch visualization

### Why this matters
Meshmixer felt useful because it showed the user where the mesh was broken, not just that it was broken.

### Client-side
- render overlays
- toggles for defect categories
- color legends
- selection / click-to-focus on defect region
- viewport annotation markers

### Cloud-side
- robust topology analysis for large meshes
- self-intersection testing
- full non-manifold detection
- large-scale thin-wall analysis
- curvature field computation
- overlap / patch conflict detection

---

## 4.2 Shell / Object Browser

A proper repair app needs shell awareness.

### Tools to add
- connected component list
- visibility toggle per shell
- isolate selected shell
- delete selected shell
- auto-remove tiny shells
- shell statistics
- shell naming or tagging
- rejected fragment collection

### Why this matters
Broken meshes are often really a crowd of suspicious fragments pretending to be one object.

### Client-side
- shell tree/list UI
- isolate/show/hide/delete actions
- per-shell metadata panel

### Cloud-side
- authoritative component extraction on large meshes
- shell scoring / debris classification
- fragment quarantine export

---

## 4.3 Quick Local Repair Tools

Your app likely needs many more instant repair tools before the user submits a heavy cloud job.

### Tools to add
- recalculate normals
- flip normals
- merge close vertices with tolerance
- remove duplicate faces
- remove tiny disconnected islands
- simple local hole fill
- split into shells
- local smooth
- local remesh on selected patch
- local decimate on selected patch
- align to plane / ground
- center pivot
- reset transform
- plane cut with capping
- simple local boolean cut preview

### Why this matters
These tools make the app feel alive and reduce needless cloud jobs.

### Client-side
Most of these should be client-side for immediate response on modest meshes.

### Cloud-side
Run fallback or large-file versions in cloud when:
- mesh size is too large
- topology is too corrupted
- user requests a higher-quality operation

---

## 4.4 Sculpt / Brush Editing

This is one of the biggest missing categories if you truly want Meshmixer emulation.

### Tools to add
- smooth brush
- inflate brush
- flatten brush
- drag brush
- pinch brush
- relax brush
- robust surface deform brush
- brush masking / freeze
- brush symmetry
- brush radius / falloff / strength controls

### Why this matters
Meshmixer was not only a repair tool; it was also a mesh shaping tool.

### Client-side
Brush interaction and preview should feel real-time in the viewport.

### Cloud-side
Heavy brush remeshing or high-resolution surface cleanup can have a cloud fallback.

### Architecture note
This likely needs a dedicated dynamic mesh editing layer, not just raw Three.js scene manipulation.

---

## 4.5 Advanced Turning / Orientation Tools

You specifically mentioned advanced turning.

This should become a dedicated orientation and preparation toolset.

### Tools to add
- snap rotate 45° / 90°
- rotate by custom angle
- align to principal axis
- align to selected face normal
- set pivot to selection
- auto-lay-flat
- transform gizmo
- turntable inspection mode
- save orientation preset
- compare original vs repaired orientation

### Client-side
These should mostly be client-side because they are visual and interactive.

### Cloud-side
Use cloud for:
- support-aware orientation optimization
- printability-aware orientation scoring
- strength-aware orientation suggestions
- cost-aware orientation recommendations

---

## 4.6 Print-Prep & Manufacturing Tools

Karaslice already points in this direction, but a full Meshmixer-style product goes deeper.

### Tools to add
- thickness analysis
- overhang analysis
- stability analysis
- hollowing
- escape-hole placement
- support preview
- support generation
- split planning for build volume
- connector / alignment key generation
- tolerance compensation tools
- material-aware wall rules

### Client-side
- visual warnings
- printer-volume previews
- simple support previews
- layout and orientation previews

### Cloud-side
- hollowing for large meshes
- support generation
- connector generation
- split planning
- manufacturability scoring
- material-aware checks

---

## 4.7 Compare / History / Variants

This category is often ignored and then the UX turns into mud.

### Tools to add
- original vs repaired toggle
- overlay comparison
- side-by-side compare mode
- repair candidate A / B / C chooser
- repair history timeline
- revert to earlier version
- repair confidence summary
- rejected fragment viewer
- diff heatmap

### Why this matters
Repair software needs trust.  
Trust comes from letting users compare results.

### Client-side
- toggles
- visual overlays
- timeline UI
- viewport compare modes

### Cloud-side
- candidate generation
- confidence reports
- repair artifact versioning
- diff package generation

---

## 4.8 Stronger Native Geometry Core

Your current cloud worker stack is useful and pragmatic, but it is not yet the strongest foundation for the deepest future capabilities.

### Current cloud stack
- Python
- PyMeshLab
- Open3D
- trimesh

### Recommended additions over time
- CGAL
- OpenMesh
- libigl
- OpenVDB
- Eigen
- Embree for fast spatial queries if needed

### Why this matters
For:
- robust topology work
- deterministic non-manifold handling
- volumetric reconstruction
- high-performance remeshing
- more controllable repair algorithms

### Recommendation
Keep the current Python worker as orchestration and transitional glue, but plan a native geometry core for advanced stages.

---

# 5. Client-Side vs Cloud-Side Responsibility Split

## Keep Client-Side
These should be immediate, visual, and interactive:

- viewport controls
- selection tools
- shell visibility toggles
- local transforms
- snap rotate / orientation controls
- defect overlay rendering
- local normals tools
- tiny-island deletion on small meshes
- simple local hole fill
- section planes
- wireframe / x-ray / matcap modes
- compare toggles
- scene state and workbench state

## Move to Cloud
These are heavy, topology-rich, or memory-hungry:

- full mesh graph reconstruction
- non-manifold repair
- robust boundary loop extraction
- self-intersection detection and correction
- thin-wall correction
- high-quality hole patching
- seam pairing
- volumetric reconstruction
- watertight rebuild
- feature-preserving remeshing
- support-aware orientation analysis
- split planning with connectors
- candidate repair generation
- repair confidence scoring

---

# 6. Recommended Same-Screen Workbench Layout

## Main viewport
Center of screen. Persistent at all times.

## Left rail
- file tree
- shell/component list
- repair versions
- visibility toggles

## Right rail
Tabbed repair workbench:

- Inspect
- Quick Repair
- Advanced Repair
- Sculpt
- Prepare
- Compare
- Export

## Bottom drawer
- cloud job progress
- stage logs
- diagnostics
- repair report
- warnings
- confidence summary

---

# 7. Recommended Button Groups

## Inspect
- Scan Mesh
- Show Open Edges
- Show Non-Manifold
- Show Thin Walls
- Show Components
- Show Sliver Triangles
- Show Curvature
- Show Self-Intersection Risk

## Quick Repair
- Recalc Normals
- Flip Normals
- Merge Close Vertices
- Remove Tiny Islands
- Remove Duplicate Faces
- Fill Small Holes
- Split Shells
- Smooth Selection
- Decimate Selection
- Plane Cut

## Advanced Turning
- Rotate 45°
- Rotate 90°
- Custom Rotate
- Align to Axis
- Align to Face
- Lay Flat
- Save Orientation
- Compare Orientations

## Advanced Repair
- Full Topology Scan
- Resolve Non-Manifold
- Patch Boundary Loops
- Preserve Hard Edges
- Thickify Thin Walls
- Reconstruct Missing Areas
- Watertight Rebuild
- Generate Repair Variants

## Sculpt
- Smooth Brush
- Inflate Brush
- Flatten Brush
- Drag Brush
- Pinch Brush
- Mask
- Symmetry

## Prepare
- Hollow
- Add Escape Holes
- Show Overhangs
- Generate Supports
- Split for Printer
- Add Alignment Keys

## Compare
- Show Original
- Show Repaired
- Overlay Difference
- Candidate A / B / C
- Confidence Heatmap
- Rejected Fragments

## Export
- Export Current Mesh
- Export Repaired Mesh
- Export Rejected Fragments
- Export Repair Report
- Save Repair Session
- Send to Quote

---

# 8. Implementation Plan Based on Current Architecture

## Phase 1 — Turn Karaslice into a Repair Workbench
Goal: upgrade the current same-screen experience without changing the fundamental architecture.

### Build
- add docked right-side workbench tabs
- add left-side shell/component browser
- add bottom diagnostics drawer
- add original/repaired compare toggle
- add advanced turning controls
- add quick repair button group

### Use current architecture
- extend `components/karaslice/`
- keep current tool route
- reuse existing mesh loading and viewport state
- reuse `mesh-analysis-actions.ts`
- reuse `cloud-repair-actions.ts`
- reuse `repair-job/[jobId]/route.ts`

### Deliverable
A more Meshmixer-like UI using the architecture you already have.

---

## Phase 2 — Inspector & Defect Overlay System
Goal: make broken geometry visible.

### Build
- overlay model for open edges, shells, slivers, normals, thin walls
- toggles and legends
- viewport markers
- click-to-focus on defect group

### Client-side
- rendering overlays
- defect state panel
- selection integration

### Cloud-side
- extend cloud analysis responses
- add richer report schema
- add region-level defect metadata

### Deliverable
An Inspector mode that makes repair actionable instead of blind.

---

## Phase 3 — Local Quick Repair Layer
Goal: reduce the need to fire heavy jobs for obvious fixes.

### Build
- recalc/flip normals
- weld / merge close vertices
- remove tiny islands
- split shells
- remove duplicate faces
- local fill small holes
- local smooth / decimate on selected region
- plane cut with capping

### Technical note
Use browser-side mesh utility modules that operate on modest mesh sizes, and fall back to cloud when thresholds are exceeded.

### Deliverable
The app feels immediate instead of queue-only.

---

## Phase 4 — Advanced Cloud Repair Expansion
Goal: deepen the existing cloud pipeline into a true advanced repair engine.

### Build
- explicit topology scan endpoint/report
- richer boundary loop extraction
- better non-manifold repair reporting
- repair candidate generation
- confidence scoring
- rejected fragment output
- compareable repair artifacts

### Use current architecture
- extend Cloud Run worker
- extend artifact storage schema
- extend Firestore job documents
- extend repair result transfer back into viewport

### Deliverable
A true advanced repair module on the same screen.

---

## Phase 5 — Print-Prep Workbench
Goal: push beyond “repair” into manufacturability.

### Build
- overhang analysis
- thickness analysis UI
- hollowing
- escape-hole placement
- split planning
- connector generation
- support preview/generation
- printer-profile-aware warnings

### Use current architecture
- leverage existing `printer-profiles.json`
- tie repaired meshes directly into prepare/export flow
- feed final result into quote system

### Deliverable
A prepare module worthy of production workflows.

---

## Phase 6 — Compare / History / Variants
Goal: add trust and reviewability.

### Build
- original vs repaired toggle
- candidate A / B / C
- overlay difference mode
- repair history timeline
- versioned artifacts
- confidence report viewer

### Use current architecture
- artifact storage in Firebase
- state documents in Firestore
- current viewport can swap scene states without changing pages

### Deliverable
Users can inspect what changed instead of trusting a black box.

---

## Phase 7 — Sculpt Layer
Goal: reach closer to actual Meshmixer parity.

### Build
- brush framework
- dynamic surface editing
- smoothing / flatten / inflate / drag / pinch
- masking and symmetry
- optional cloud-assisted remesh cleanup

### Technical note
This is one of the hardest phases and should not be phase 1.
It likely needs a dedicated mesh-edit subsystem, not just simple viewport tooling.

### Deliverable
The app becomes a real direct-manipulation mesh tool.

---

## Phase 8 — Native Geometry Core (Longer-Term)
Goal: strengthen the heaviest algorithms.

### Build
- native C++ repair modules
- library integration:
  - CGAL
  - OpenMesh
  - libigl
  - OpenVDB
  - Eigen

### Migration plan
- keep Python worker as orchestration layer
- move specific advanced stages into native modules first:
  - topology graph construction
  - non-manifold resolution
  - volumetric reconstruction
  - feature-preserving remesh

### Deliverable
Industrial-grade geometry horsepower.

---

# 9. Recommended Technical Sequence

If you want the highest ROI without wandering into architecture theater, do this in order:

1. Same-screen Repair Workbench UI  
2. Inspector / overlay system  
3. Shell browser  
4. Quick local repair tools  
5. Advanced turning / orientation tools  
6. Expanded cloud repair reports and candidate outputs  
7. Compare / history / versions  
8. Print-prep tools  
9. Sculpt tools  
10. Native geometry core migration  

That sequence fits your current architecture and avoids trying to build the moon in one sprint.

---

# 10. Strongest Product Recommendation

Do not branch into a second page or a separate tool universe.

Use the current architecture to create a **single persistent viewport with multiple docked modules**.

That gives you:
- shared mesh state
- shared camera state
- cleaner compare workflows
- less user confusion
- easier cloud-to-viewport result loading
- a much more Meshmixer-like experience

The viewport should be the truth.  
The side panels should be the tools.  
The cloud should be the heavy machinery.

That is the clean path from your current repo to a real Meshmixer-style workbench.
