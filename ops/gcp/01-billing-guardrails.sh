#!/usr/bin/env bash
set -euo pipefail

# Configure baseline billing and quota guardrails for production.
# Review all values before executing.

PROJECT_ID="${PROJECT_ID:-your-prod-project-id}"
BILLING_ACCOUNT_ID="${BILLING_ACCOUNT_ID:-000000-000000-000000}"
BUDGET_DISPLAY_NAME="${BUDGET_DISPLAY_NAME:-frolf-prod-monthly-budget}"
MONTHLY_BUDGET_UNITS="${MONTHLY_BUDGET_UNITS:-30}" # USD
NOTIFICATION_CHANNEL_ID="${NOTIFICATION_CHANNEL_ID:-1234567890123456789}"
REGION="${REGION:-europe-north1}"
RUN_SERVICE="${RUN_SERVICE:-frolf-tour-api}"
LOG_BUCKET="${LOG_BUCKET:-_Default}"

if [[ "${PROJECT_ID}" == "your-prod-project-id" ]]; then
  echo "Set PROJECT_ID before running."
  exit 1
fi

if [[ "${BILLING_ACCOUNT_ID}" == "000000-000000-000000" ]]; then
  echo "Set BILLING_ACCOUNT_ID before running."
  exit 1
fi

if [[ "${NOTIFICATION_CHANNEL_ID}" == "1234567890123456789" ]]; then
  echo "Set NOTIFICATION_CHANNEL_ID before running."
  exit 1
fi

echo "Using project: ${PROJECT_ID}"
gcloud config set project "${PROJECT_ID}" >/dev/null

echo "Enabling required APIs..."
gcloud services enable cloudbilling.googleapis.com serviceusage.googleapis.com logging.googleapis.com run.googleapis.com

echo "Creating budget with threshold notifications..."
if ! gcloud billing budgets list --billing-account="${BILLING_ACCOUNT_ID}" --format="value(displayName)" | rg -Fxq "${BUDGET_DISPLAY_NAME}"; then
  gcloud billing budgets create \
    --billing-account="${BILLING_ACCOUNT_ID}" \
    --display-name="${BUDGET_DISPLAY_NAME}" \
    --budget-amount="${MONTHLY_BUDGET_UNITS}" \
    --threshold-rule=percent=0.25 \
    --threshold-rule=percent=0.50 \
    --threshold-rule=percent=0.75 \
    --threshold-rule=percent=0.90 \
    --threshold-rule=percent=1.00 \
    --all-updates-rule-monitoring-notification-channels="projects/${PROJECT_ID}/notificationChannels/${NOTIFICATION_CHANNEL_ID}" \
    --filter-projects="projects/${PROJECT_ID}"
else
  echo "Budget ${BUDGET_DISPLAY_NAME} already exists; skipping create."
fi

echo "Applying conservative Cloud Run quota overrides (if org policy allows)..."
# Values should reflect your target max traffic and can be tuned later.
if ! gcloud beta services quota override list \
  --consumer="projects/${PROJECT_ID}" \
  --service=run.googleapis.com \
  --format="value(override.name)" | rg -q "container_instance_count"; then
  gcloud beta services quota override create \
    --consumer="projects/${PROJECT_ID}" \
    --service=run.googleapis.com \
    --metric=run.googleapis.com/container_instance_count \
    --unit=1/{project}/{region} \
    --value=8 \
    --dimensions=region="${REGION}"
else
  echo "Quota override already exists; skipping create."
fi

echo "Reducing log retention to 14 days to control storage costs..."
gcloud logging buckets update "${LOG_BUCKET}" --location=global --retention-days=14

echo "Guardrail baseline complete."
