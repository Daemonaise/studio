
# SDLC Hardening Plan for Daemonaise Studio (AI‑Driven Development Model)

## Context

The current platform already has a substantial architecture:

- Next.js 15.5 (App Router)
- React 19
- Three.js + manifold‑3d WASM
- Firebase (App Hosting, Storage, Firestore)
- Cloud Run mesh repair worker
- Python repair pipeline (PyMeshLab, Open3D, trimesh)
- Stripe payments
- Shippo shipping integration
- Karaslice mesh slicing and analysis tools
- Multi‑stage mesh repair pipeline

Modern AI tooling dramatically reduces the effort required to build software like this.

Tasks that historically required large engineering teams are now heavily automated:

- writing code
- generating infrastructure configs
- fixing build errors
- wiring cloud services
- writing documentation
- generating bash commands

This means a single builder can create complex systems much faster than before.

The remaining focus is not engineering bureaucracy — it is simply making the system easier to run, observe, and maintain as it grows.

This document focuses on practical improvements that increase reliability and visibility without slowing development.

---

# 1. Practical Gaps to Address

## 1.1 Testing Critical Workflows

You do not need massive enterprise testing infrastructure.

What matters is verifying that the core product flows still work after changes.

Important workflows:

Upload → Analyze → Repair → Compare → Quote → Checkout

### Recommended Approach

Create a small automated suite that runs these flows.

Tools:

- Playwright (browser testing)
- Vitest (logic tests)

### Mesh Regression Corpus

Maintain a folder of intentionally broken meshes:

examples:

- open edges
- non‑manifold geometry
- inverted normals
- sliver triangles
- thin walls
- self intersections

Each file becomes a test case for the repair pipeline.

---

# 2. Observability

When a system performs heavy processing (like mesh repair), visibility is essential.

Without it, diagnosing failures becomes guesswork.

### Structured Logging

Every repair job should log:

- jobId
- userId
- meshHash
- stage
- stageDuration
- result

### Distributed Tracing

Track request paths across:

Browser → API → Cloud Run worker

Tools:

- OpenTelemetry
- Google Cloud Trace

### Metrics

Track basic system behavior:

- repair success rate
- average repair runtime
- file size vs runtime
- stage failure rate

### Dashboards

Useful dashboards:

- repair pipeline health
- compute usage
- queue backlog

---

# 3. Basic Security Controls

Since the system processes uploaded files and runs compute jobs, some safeguards prevent abuse.

### Upload Validation

Validate:

- file type
- file size
- mesh integrity

### Rate Limits

Limit:

- uploads
- repair jobs
- AI assistant requests

### Secrets Management

Store secrets using:

- Google Secret Manager

Rotate:

- API keys
- payment tokens

### Access Controls

Use least‑privilege roles for:

- Cloud Run
- Firebase admin
- storage buckets

---

# 4. Release and Deployment Structure

Even for solo projects, clean deployment pipelines reduce mistakes.

### Branch Strategy

Recommended structure:

main – production  
develop – active work

### Pull Requests

Every change should:

- build successfully
- pass automated tests

### Preview Deployments

Each PR can deploy a preview environment automatically.

Tools:

- Firebase preview channels
- GitHub Actions

### Rollbacks

Ensure you can quickly revert:

- frontend deploy
- worker container version

---

# 5. Product Telemetry

Understanding how the system is used helps guide improvements.

Track the product funnel:

Upload → Repair → Export → Quote → Checkout

Useful metrics:

- repair retries
- feature usage
- time to successful repair

Tools:

- PostHog
- Amplitude
- analytics dashboards

---

# 6. Geometry Pipeline Validation

Repair software benefits from domain‑specific validation metrics.

Track:

- watertightness improvement
- manifoldness improvement
- triangle count change
- dimensional drift
- topology preservation

### Repair Confidence Score

Compute a confidence score for each repair based on:

- number of corrections applied
- reconstruction size
- topology changes

This allows automated comparison of repair results.

---

# 7. Cost Monitoring

Even if development was inexpensive, infrastructure usage can grow.

Track:

- compute cost per repair job
- storage cost per mesh
- AI token usage
- shipping API calls

Implement:

- cost dashboards
- budget alerts

---

# 8. Backup and Data Recovery

User files and orders should be recoverable.

Implement:

- Firestore scheduled backups
- storage versioning
- periodic restore testing

---

# 9. Documentation

Good documentation prevents future confusion.

Add:

- architecture overview
- service responsibilities
- repair pipeline stages
- operational notes

---

# CI/CD Architecture

## Goals

Automate the following:

1. build verification
2. automated tests
3. preview environments
4. deployment to production

## Pipeline Overview

Developer Push  
↓  
GitHub Actions  
↓  
Run Tests  
↓  
Build Application  
↓  
Deploy Preview Environment  
↓  
Manual Merge  
↓  
Production Deployment

## CI Pipeline Steps

1. install dependencies
2. run lint
3. run type checks
4. run unit tests
5. run E2E tests
6. build application

If all steps pass, deployment proceeds.

## CD Pipeline Steps

1. build container images
2. push to container registry
3. deploy frontend
4. deploy Cloud Run worker
5. run smoke tests

---

# Example GitHub Actions Workflow

Stages:

setup  
lint  
test  
build  
deploy

Each stage runs automatically on pull requests.

---

# Suggested Repository Structure

Organizing the repository improves maintainability.

Example structure:

/apps  
    /frontend  
        Next.js UI  
    /repair-worker  
        Cloud Run mesh repair pipeline  

/packages  
    /mesh-utils  
    /repair-algorithms  
    /geometry-core  

/services  
    /repair-service  
    /analysis-service  

/infrastructure  
    Terraform / deployment configs  

/tests  
    /mesh-corpus  
    /repair-regression  
    /e2e  

/docs  
    architecture  
    pipeline design  
    repair algorithms  

/scripts  
    dev tools  
    build helpers

---

# Development Workflow

1. implement feature
2. run local tests
3. open pull request
4. CI verifies build
5. preview environment created
6. merge to main
7. automatic deployment

---

# Future Improvements

Potential future upgrades:

- native C++ repair modules for heavy geometry tasks
- GPU acceleration for mesh analysis
- automated mesh quality scoring
- repair recommendation AI
- advanced viewport editing tools

---

# Summary

Modern AI tools significantly lower the barrier to building complex software systems.

The remaining focus is not process overhead but ensuring:

- the system is observable
- critical workflows remain stable
- infrastructure stays manageable

By adding lightweight testing, logging, CI/CD automation, and telemetry, the platform can remain fast to develop while becoming increasingly reliable as usage grows.
