#!/usr/bin/env bash
set -euo pipefail

# Deploy API with conservative Cloud Run scaling controls.

PROJECT_ID="${PROJECT_ID:-your-prod-project-id}"
REGION="${REGION:-europe-north1}"
SERVICE_NAME="${SERVICE_NAME:-frolf-tour-api}"
IMAGE_URI="${IMAGE_URI:-europe-north1-docker.pkg.dev/${PROJECT_ID}/frolf/frolf-tour-api:latest}"
RUNTIME_SERVICE_ACCOUNT="${RUNTIME_SERVICE_ACCOUNT:-frolf-api-runtime@${PROJECT_ID}.iam.gserviceaccount.com}"
CLIENT_ORIGIN="${CLIENT_ORIGIN:-https://example.com}"
ALLOW_UNAUTHENTICATED="${ALLOW_UNAUTHENTICATED:-false}"

JWT_SECRET_NAME="${JWT_SECRET_NAME:-frolf-jwt-secret}"
MONGODB_URI_SECRET_NAME="${MONGODB_URI_SECRET_NAME:-frolf-mongodb-uri}"
BOOTSTRAP_ADMIN_EMAILS="${BOOTSTRAP_ADMIN_EMAILS:-}"

if [[ "${PROJECT_ID}" == "your-prod-project-id" ]]; then
  echo "Set PROJECT_ID before running."
  exit 1
fi

if [[ "${CLIENT_ORIGIN}" == "https://example.com" ]]; then
  echo "Set CLIENT_ORIGIN before running."
  exit 1
fi

if ! gcloud iam service-accounts describe "${RUNTIME_SERVICE_ACCOUNT}" --project "${PROJECT_ID}" >/dev/null 2>&1; then
  echo "Runtime service account ${RUNTIME_SERVICE_ACCOUNT} was not found."
  exit 1
fi

if [[ "${ALLOW_UNAUTHENTICATED}" != "true" && "${ALLOW_UNAUTHENTICATED}" != "false" ]]; then
  echo "ALLOW_UNAUTHENTICATED must be true or false."
  exit 1
fi

AUTH_FLAG="--no-allow-unauthenticated"
if [[ "${ALLOW_UNAUTHENTICATED}" == "true" ]]; then
  AUTH_FLAG="--allow-unauthenticated"
fi

echo "Deploying Cloud Run service ${SERVICE_NAME} in ${PROJECT_ID}/${REGION}..."
gcloud run deploy "${SERVICE_NAME}" \
  --project "${PROJECT_ID}" \
  --region "${REGION}" \
  --image "${IMAGE_URI}" \
  --platform managed \
  "${AUTH_FLAG}" \
  --port 8080 \
  --min-instances 0 \
  --max-instances 4 \
  --concurrency 30 \
  --cpu 1 \
  --memory 512Mi \
  --timeout 30 \
  --ingress internal-and-cloud-load-balancing \
  --service-account "${RUNTIME_SERVICE_ACCOUNT}" \
  --set-env-vars "NODE_ENV=production,CLIENT_ORIGIN=${CLIENT_ORIGIN},BOOTSTRAP_ADMIN_EMAILS=${BOOTSTRAP_ADMIN_EMAILS}" \
  --set-secrets "JWT_SECRET=${JWT_SECRET_NAME}:latest,MONGODB_URI=${MONGODB_URI_SECRET_NAME}:latest"

echo "Cloud Run deploy complete."

echo "Deployment verification:"
gcloud run services describe "${SERVICE_NAME}" --region "${REGION}" --project "${PROJECT_ID}" \
  --format="table(spec.template.spec.serviceAccountName,spec.template.metadata.annotations.'run.googleapis.com/ingress')"
