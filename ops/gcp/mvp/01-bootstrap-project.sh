#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-}"
BILLING_ACCOUNT_ID="${BILLING_ACCOUNT_ID:-}"
REGION="${REGION:-europe-north1}"
FIRESTORE_REGION="${FIRESTORE_REGION:-eur3}"
AR_REPO="${AR_REPO:-frolf}"
API_SERVICE_NAME="${API_SERVICE_NAME:-frolf-tour-api}"
RUNTIME_SERVICE_ACCOUNT="${RUNTIME_SERVICE_ACCOUNT:-frolf-api-runtime}"

if [[ -z "${PROJECT_ID}" ]]; then
  echo "PROJECT_ID is required."
  exit 1
fi

if [[ -z "${BILLING_ACCOUNT_ID}" ]]; then
  echo "BILLING_ACCOUNT_ID is required."
  exit 1
fi

echo "Setting project and account context..."
gcloud config set project "${PROJECT_ID}" >/dev/null

echo "Linking project to billing account (no-op if already linked)..."
gcloud billing projects link "${PROJECT_ID}" --billing-account "${BILLING_ACCOUNT_ID}" >/dev/null

echo "Enabling required services..."
gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  firestore.googleapis.com \
  identitytoolkit.googleapis.com \
  secretmanager.googleapis.com \
  firebase.googleapis.com \
  firebasehosting.googleapis.com \
  iam.googleapis.com \
  logging.googleapis.com \
  monitoring.googleapis.com

echo "Ensuring Artifact Registry repo exists..."
if ! gcloud artifacts repositories describe "${AR_REPO}" --location "${REGION}" >/dev/null 2>&1; then
  gcloud artifacts repositories create "${AR_REPO}" \
    --repository-format=docker \
    --location="${REGION}" \
    --description="Frolf Tour Manager images"
fi

SA_EMAIL="${RUNTIME_SERVICE_ACCOUNT}@${PROJECT_ID}.iam.gserviceaccount.com"

echo "Ensuring runtime service account exists..."
if ! gcloud iam service-accounts describe "${SA_EMAIL}" >/dev/null 2>&1; then
  gcloud iam service-accounts create "${RUNTIME_SERVICE_ACCOUNT}" \
    --display-name="Frolf API Runtime"
fi

echo "Ensuring Firestore database exists..."
if ! gcloud firestore databases describe --database="(default)" >/dev/null 2>&1; then
  gcloud firestore databases create --database="(default)" --location="${FIRESTORE_REGION}" --type=firestore-native
fi

echo "Granting runtime logging/metrics roles..."
gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
  --member="serviceAccount:${SA_EMAIL}" \
  --role="roles/logging.logWriter" >/dev/null

gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
  --member="serviceAccount:${SA_EMAIL}" \
  --role="roles/monitoring.metricWriter" >/dev/null

gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
  --member="serviceAccount:${SA_EMAIL}" \
  --role="roles/datastore.user" >/dev/null

echo "Bootstrap complete."
echo "Project: ${PROJECT_ID}"
echo "Region: ${REGION}"
echo "API service: ${API_SERVICE_NAME}"
echo "Runtime SA: ${SA_EMAIL}"
