
# Cloud Architecture for Mesh Repair & Reconstruction Engine

Target platform:
- Firebase Studio
- Google Cloud
- Claude Code assisted development

Primary language for core engine: **C++**
Deployment model: **Dockerized compute workers on Google Cloud**

---

# System Overview

The system separates responsibilities into three layers:

1. Browser Client (Visualization & Control)
2. Cloud Orchestration Layer
3. Native Geometry Compute Layer

```
                Browser Client
                     │
                     ▼
              Firebase Hosting
                     │
                     ▼
                API Gateway
                     │
                     ▼
           Cloud Task / PubSub Queue
                     │
                     ▼
             Docker Repair Workers
                     │
                     ▼
               Object Storage
```

---

# Layer 1: Browser Client

Purpose:
User interface for uploading models, visualizing mesh defects, and managing repair jobs.

Recommended stack:

- Firebase Hosting
- Next.js / React
- Three.js or Babylon.js
- WebGL / WebGPU rendering

Responsibilities:

- Upload meshes
- Display mesh previews
- Highlight detected defects
- Submit repair jobs
- Monitor job status
- Compare repair outputs
- Download repaired meshes

Browser tasks only include **lightweight operations**.

Never perform:

- topology repair
- remeshing
- reconstruction
- volumetric algorithms

Those run server-side.

---

# Layer 2: Cloud Orchestration

Managed by Google Cloud.

Core services:

| Service | Purpose |
|------|------|
| Firebase Hosting | Web frontend |
| Firebase Auth | User authentication |
| Cloud Functions / Cloud Run | API layer |
| Pub/Sub or Cloud Tasks | Job queue |
| Cloud Storage | Mesh storage |
| Firestore | Job metadata |
| Cloud Logging | Repair logs |

---

# API Layer

Recommended deployment:

Cloud Run service.

Responsibilities:

- Receive mesh uploads
- Generate signed upload URLs
- Submit repair jobs
- Store metadata
- Dispatch workers
- Track job progress
- Return repair reports

Example endpoints:

```
POST /upload-url
POST /submit-job
GET  /job-status/{jobId}
GET  /job-result/{jobId}
GET  /repair-report/{jobId}
```

---

# Job Queue

Mesh repair is asynchronous.

Use:

- **Google Cloud Pub/Sub** or
- **Cloud Tasks**

Job payload:

```
{
  jobId: string
  inputMesh: gs://bucket/input.obj
  repairMode: "conservative | watertight | reconstruct"
  userId: string
}
```

Workers subscribe to the queue and process jobs independently.

---

# Layer 3: Native Geometry Engine

Runs inside Docker containers.

Language:

**C++**

Reasons:

- high performance
- memory control
- geometry libraries
- large mesh capability

Recommended libraries:

| Library | Use |
|------|------|
| CGAL | geometric algorithms |
| OpenMesh | half-edge mesh |
| libigl | mesh processing |
| OpenVDB | volumetric reconstruction |
| Eigen | linear algebra |

---

# Worker Execution Environment

Workers run using:

- Cloud Run Jobs
or
- GKE (later scale stage)

Docker container responsibilities:

1. Fetch mesh from Cloud Storage
2. Execute repair pipeline
3. Write outputs to storage
4. Publish job completion event

---

# Mesh Repair Pipeline

Worker runs stages sequentially.

```
1 Parse Mesh
2 Sanitize Topology
3 Extract Components
4 Resolve Non-Manifold Edges
5 Detect Boundary Loops
6 Condition Triangle Quality
7 Surface Inference
8 Hole Reconstruction
9 Remesh + Fairing
10 Validation
11 Export
```

Artifacts produced:

```
repaired.obj
rejected_fragments.obj
repair_report.json
preview_mesh.obj
```

---

# Storage Layout

Cloud Storage buckets:

```
/mesh-input
/mesh-output
/mesh-preview
/repair-reports
/debug-snapshots
```

Example path:

```
gs://mesh-repair/input/{jobId}.obj
gs://mesh-repair/output/{jobId}_repaired.obj
gs://mesh-repair/reports/{jobId}.json
```

---

# Firestore Schema

Collection: `repair_jobs`

Example document:

```
{
  jobId: string
  userId: string
  status: "queued | running | finished | failed"
  inputMesh: string
  outputMesh: string
  repairReport: string
  createdAt: timestamp
  finishedAt: timestamp
}
```

---

# Repair Report Format

Example JSON:

```
{
  vertices: 275201,
  faces: 512895,
  componentsDetected: 504,
  componentsRemoved: 285,
  duplicateFacesRemoved: 46,
  nonManifoldEdgesFixed: 2315,
  boundaryLoopsDetected: 41653,
  holesPatched: 312,
  unresolvedRegions: 12,
  meshStatus: "watertight",
  confidenceScore: 0.87
}
```

---

# Claude Code Integration

Claude Code can assist development with:

- algorithm generation
- geometry debugging
- mesh diagnostics
- pipeline generation
- repair heuristics
- performance tuning

Typical workflow:

1. Engineer writes C++ module.
2. Claude assists with algorithm improvements.
3. Modules compiled inside Docker container.
4. Container pushed to Google Artifact Registry.

---

# Deployment Flow

```
Developer → Claude Code assistance
          ↓
   Local C++ Engine
          ↓
     Docker Image
          ↓
Artifact Registry
          ↓
Cloud Run Worker
          ↓
Queue Execution
```

---

# Security

Important protections:

- signed upload URLs
- mesh size limits
- job quotas
- container sandboxing
- resource limits

---

# Scaling Strategy

Initial version:

- single Cloud Run worker
- Pub/Sub queue
- Cloud Storage

Scaling stage:

- multiple workers
- autoscaling
- GKE cluster
- regional storage

---

# Performance Optimization

Future improvements:

- GPU remeshing kernels
- parallel topology analysis
- spatial partitioning
- region-based repair
- streaming mesh processing

---

# Future Capabilities

Possible upgrades:

- symmetry detection
- CAD surface reconstruction
- ML-based repair prediction
- automatic feature edge classification
- partial repair tools
- real-time defect visualization

---

# Key Principle

The browser provides **control and visualization**.

The cloud provides **compute**.

The C++ engine performs **topology repair and reconstruction**.
