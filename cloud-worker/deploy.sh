#!/usr/bin/env bash
# Deploy the mesh repair Cloud Run worker.
#
# Prerequisites:
#   - gcloud CLI authenticated (`gcloud auth login`)
#   - Docker installed (or use Cloud Build with --cloud-build flag)
#
# Usage:
#   ./deploy.sh                     # Deploy to default project (local Docker build)
#   ./deploy.sh --cloud-build       # Build with Cloud Build (no local Docker needed)
#   REGION=us-east1 ./deploy.sh     # Deploy to specific region

set -euo pipefail

PROJECT_ID="${GOOGLE_CLOUD_PROJECT:-studio-4705021877-a1dff}"
REGION="${REGION:-us-central1}"
SERVICE_NAME="mesh-repair-worker"
AR_REPO="${AR_REPO:-cloud-run-source-deploy}"
IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/${AR_REPO}/${SERVICE_NAME}"

if [[ "${1:-}" == "--cloud-build" ]]; then
  echo "=== Building with Cloud Build ==="
  gcloud builds submit \
    --project "${PROJECT_ID}" \
    --region "${REGION}" \
    --tag "${IMAGE}"
else
  echo "=== Building Docker image locally ==="
  docker build --platform linux/amd64 -t "${IMAGE}" .

  echo "=== Pushing to Artifact Registry ==="
  docker push "${IMAGE}"
fi

echo "=== Deploying to Cloud Run ==="
gcloud run deploy "${SERVICE_NAME}" \
  --project "${PROJECT_ID}" \
  --region "${REGION}" \
  --image "${IMAGE}" \
  --platform managed \
  --memory 8Gi \
  --cpu 4 \
  --timeout 900 \
  --max-instances 5 \
  --min-instances 0 \
  --concurrency 1 \
  --set-env-vars "GOOGLE_CLOUD_PROJECT=${PROJECT_ID},STORAGE_BUCKET=studio-4705021877-a1dff.firebasestorage.app" \
  --no-allow-unauthenticated

echo ""
echo "=== Deployment complete ==="
SERVICE_URL=$(gcloud run services describe "${SERVICE_NAME}" \
  --project "${PROJECT_ID}" \
  --region "${REGION}" \
  --format 'value(status.url)')
echo "Service URL: ${SERVICE_URL}"
echo ""
echo "Add to your .env or apphosting.yaml:"
echo "  MESH_REPAIR_WORKER_URL=${SERVICE_URL}"
