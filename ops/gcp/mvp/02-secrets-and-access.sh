#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-}"
FIREBASE_WEB_API_KEY_SECRET_NAME="${FIREBASE_WEB_API_KEY_SECRET_NAME:-frolf-firebase-web-api-key}"
FIREBASE_WEB_API_KEY="${FIREBASE_WEB_API_KEY:-}"
RUNTIME_SERVICE_ACCOUNT="${RUNTIME_SERVICE_ACCOUNT:-frolf-api-runtime}"

if [[ -z "${PROJECT_ID}" ]]; then
  echo "PROJECT_ID is required."
  exit 1
fi

gcloud config set project "${PROJECT_ID}" >/dev/null

SA_EMAIL="${RUNTIME_SERVICE_ACCOUNT}@${PROJECT_ID}.iam.gserviceaccount.com"

if [[ -n "${FIREBASE_WEB_API_KEY}" ]]; then
  echo "Ensuring optional Firebase web API key secret exists..."
  if ! gcloud secrets describe "${FIREBASE_WEB_API_KEY_SECRET_NAME}" >/dev/null 2>&1; then
    gcloud secrets create "${FIREBASE_WEB_API_KEY_SECRET_NAME}" --replication-policy=automatic
  fi
  printf "%s" "${FIREBASE_WEB_API_KEY}" | gcloud secrets versions add "${FIREBASE_WEB_API_KEY_SECRET_NAME}" --data-file=-

  echo "Granting runtime secret accessor role..."
  gcloud secrets add-iam-policy-binding "${FIREBASE_WEB_API_KEY_SECRET_NAME}" \
    --member="serviceAccount:${SA_EMAIL}" \
    --role="roles/secretmanager.secretAccessor" >/dev/null
else
  echo "FIREBASE_WEB_API_KEY not set; skipping optional secret creation."
fi

echo "Secret access setup complete."
