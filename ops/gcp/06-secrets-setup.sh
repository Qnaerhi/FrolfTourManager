#!/usr/bin/env bash
set -euo pipefail

# Create/update Secret Manager entries used by Cloud Run runtime.

PROJECT_ID="${PROJECT_ID:-your-prod-project-id}"
JWT_SECRET_NAME="${JWT_SECRET_NAME:-frolf-jwt-secret}"
MONGODB_URI_SECRET_NAME="${MONGODB_URI_SECRET_NAME:-frolf-mongodb-uri}"
JWT_SECRET_VALUE="${JWT_SECRET_VALUE:-}"
MONGODB_URI_VALUE="${MONGODB_URI_VALUE:-}"

if [[ "${PROJECT_ID}" == "your-prod-project-id" ]]; then
  echo "Set PROJECT_ID before running."
  exit 1
fi

gcloud config set project "${PROJECT_ID}" >/dev/null

if [[ -z "${JWT_SECRET_VALUE}" ]]; then
  read -r -s -p "Enter JWT secret (at least 32 chars): " JWT_SECRET_VALUE
  echo
fi

if [[ ${#JWT_SECRET_VALUE} -lt 32 ]]; then
  echo "JWT secret must be at least 32 characters."
  exit 1
fi

if [[ -z "${MONGODB_URI_VALUE}" ]]; then
  read -r -s -p "Enter MongoDB URI: " MONGODB_URI_VALUE
  echo
fi

if [[ "${MONGODB_URI_VALUE}" != mongodb://* && "${MONGODB_URI_VALUE}" != mongodb+srv://* ]]; then
  echo "MONGODB_URI must start with mongodb:// or mongodb+srv://"
  exit 1
fi

echo "Ensuring secrets exist..."
if ! gcloud secrets describe "${JWT_SECRET_NAME}" >/dev/null 2>&1; then
  gcloud secrets create "${JWT_SECRET_NAME}" --replication-policy=automatic
fi
if ! gcloud secrets describe "${MONGODB_URI_SECRET_NAME}" >/dev/null 2>&1; then
  gcloud secrets create "${MONGODB_URI_SECRET_NAME}" --replication-policy=automatic
fi

echo "Adding secret versions..."
printf "%s" "${JWT_SECRET_VALUE}" | gcloud secrets versions add "${JWT_SECRET_NAME}" --data-file=-
printf "%s" "${MONGODB_URI_VALUE}" | gcloud secrets versions add "${MONGODB_URI_SECRET_NAME}" --data-file=-

echo "Verifying latest secret versions..."
gcloud secrets versions list "${JWT_SECRET_NAME}" --limit=1 --format="value(name,state)"
gcloud secrets versions list "${MONGODB_URI_SECRET_NAME}" --limit=1 --format="value(name,state)"

echo "Secrets updated successfully."
