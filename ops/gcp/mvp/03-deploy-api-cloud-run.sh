#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-}"
REGION="${REGION:-europe-north1}"
AR_REPO="${AR_REPO:-frolf}"
API_SERVICE_NAME="${API_SERVICE_NAME:-frolf-tour-api}"
RUNTIME_SERVICE_ACCOUNT="${RUNTIME_SERVICE_ACCOUNT:-frolf-api-runtime}"
CLIENT_ORIGIN="${CLIENT_ORIGIN:-}"
BOOTSTRAP_ADMIN_EMAILS="${BOOTSTRAP_ADMIN_EMAILS:-}"
FIREBASE_WEB_API_KEY_SECRET_NAME="${FIREBASE_WEB_API_KEY_SECRET_NAME:-frolf-firebase-web-api-key}"
IMAGE_TAG="${IMAGE_TAG:-$(date +%Y%m%d-%H%M%S)}"

if [[ -z "${PROJECT_ID}" ]]; then
  echo "PROJECT_ID is required."
  exit 1
fi

if [[ -z "${CLIENT_ORIGIN}" ]]; then
  echo "CLIENT_ORIGIN is required (must be HTTPS in production)."
  exit 1
fi

if [[ "${CLIENT_ORIGIN}" != https://* ]]; then
  echo "CLIENT_ORIGIN must start with https://"
  exit 1
fi

gcloud config set project "${PROJECT_ID}" >/dev/null

IMAGE_URI="${REGION}-docker.pkg.dev/${PROJECT_ID}/${AR_REPO}/frolf-tour-api:${IMAGE_TAG}"
SA_EMAIL="${RUNTIME_SERVICE_ACCOUNT}@${PROJECT_ID}.iam.gserviceaccount.com"

echo "Building API container image: ${IMAGE_URI}"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "${TMP_DIR}"' EXIT

cat > "${TMP_DIR}/cloudbuild.yaml" <<EOF
steps:
  - name: gcr.io/cloud-builders/docker
    args:
      - build
      - -f
      - ops/gcp/mvp/api.Dockerfile
      - -t
      - ${IMAGE_URI}
      - .
images:
  - ${IMAGE_URI}
EOF

gcloud builds submit \
  --project "${PROJECT_ID}" \
  --config "${TMP_DIR}/cloudbuild.yaml" \
  .

echo "Deploying Cloud Run service: ${API_SERVICE_NAME}"
DEPLOY_ARGS=(
  --project "${PROJECT_ID}"
  --region "${REGION}"
  --image "${IMAGE_URI}"
  --platform managed
  --allow-unauthenticated
  --port 8080
  --min-instances 0
  --max-instances 3
  --concurrency 30
  --cpu 1
  --memory 512Mi
  --timeout 30
  --service-account "${SA_EMAIL}"
  --set-env-vars "NODE_ENV=production,CLIENT_ORIGIN=${CLIENT_ORIGIN},BOOTSTRAP_ADMIN_EMAILS=${BOOTSTRAP_ADMIN_EMAILS},ENABLE_RATE_LIMITING=true,RATE_LIMIT_STORAGE=firestore,TRUST_PROXY=1,FIREBASE_PROJECT_ID=${PROJECT_ID}"
)

if gcloud secrets describe "${FIREBASE_WEB_API_KEY_SECRET_NAME}" --project "${PROJECT_ID}" >/dev/null 2>&1; then
  DEPLOY_ARGS+=(--set-secrets "FIREBASE_WEB_API_KEY=${FIREBASE_WEB_API_KEY_SECRET_NAME}:latest")
fi

gcloud run deploy "${API_SERVICE_NAME}" \
  "${DEPLOY_ARGS[@]}"

SERVICE_URL="$(gcloud run services describe "${API_SERVICE_NAME}" --region "${REGION}" --format='value(status.url)')"
echo "API deployed."
echo "Cloud Run URL: ${SERVICE_URL}"
echo "Use this for web build VITE_API_URL until custom domain is configured."
