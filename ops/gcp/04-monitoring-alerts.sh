#!/usr/bin/env bash
set -euo pipefail

# Configure baseline uptime checks and alerting channels.

PROJECT_ID="${PROJECT_ID:-your-prod-project-id}"
API_HOST="${API_HOST:-api.example.com}"
WEB_HOST="${WEB_HOST:-example.com}"
NOTIFICATION_CHANNEL_ID="${NOTIFICATION_CHANNEL_ID:-1234567890123456789}"

if [[ "${PROJECT_ID}" == "your-prod-project-id" ]]; then
  echo "Set PROJECT_ID before running."
  exit 1
fi

gcloud config set project "${PROJECT_ID}" >/dev/null

if [[ "${NOTIFICATION_CHANNEL_ID}" == "1234567890123456789" ]]; then
  echo "Set NOTIFICATION_CHANNEL_ID before running."
  exit 1
fi

if ! gcloud monitoring channels describe "projects/${PROJECT_ID}/notificationChannels/${NOTIFICATION_CHANNEL_ID}" >/dev/null 2>&1; then
  echo "Notification channel projects/${PROJECT_ID}/notificationChannels/${NOTIFICATION_CHANNEL_ID} was not found."
  exit 1
fi

echo "Creating API health uptime check..."
if ! gcloud monitoring uptime list-configs --filter='displayName="frolf-api-health"' --format="value(name)" | rg -q .; then
  gcloud monitoring uptime create "frolf-api-health" \
    --resource-type="uptime-url" \
    --resource-labels=host="${API_HOST}",project_id="${PROJECT_ID}" \
    --path="/api/health" \
    --protocol="https" \
    --period="60s" \
    --timeout="10s"
fi

echo "Creating frontend uptime check..."
if ! gcloud monitoring uptime list-configs --filter='displayName="frolf-web-home"' --format="value(name)" | rg -q .; then
  gcloud monitoring uptime create "frolf-web-home" \
    --resource-type="uptime-url" \
    --resource-labels=host="${WEB_HOST}",project_id="${PROJECT_ID}" \
    --path="/" \
    --protocol="https" \
    --period="60s" \
    --timeout="10s"
fi

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "${TMP_DIR}"' EXIT

render_policy() {
  local source_file="$1"
  local target_file="$2"
  sed "s/PROJECT_ID/${PROJECT_ID}/g; s/CHANNEL_ID/${NOTIFICATION_CHANNEL_ID}/g" "${source_file}" >"${target_file}"
}

echo "Creating API error-rate alert policy..."
if ! gcloud monitoring policies list --filter='displayName="frolf-api-high-5xx-rate"' --format="value(name)" | rg -q .; then
  render_policy "ops/gcp/policies/api-error-rate-policy.json" "${TMP_DIR}/api-error-rate-policy.json"
  gcloud alpha monitoring policies create --policy-from-file="${TMP_DIR}/api-error-rate-policy.json"
fi

echo "Creating API latency alert policy..."
if ! gcloud monitoring policies list --filter='displayName="frolf-api-high-latency"' --format="value(name)" | rg -q .; then
  render_policy "ops/gcp/policies/api-latency-policy.json" "${TMP_DIR}/api-latency-policy.json"
  gcloud alpha monitoring policies create --policy-from-file="${TMP_DIR}/api-latency-policy.json"
fi

echo "Creating auth-failure spike alert policy..."
if ! gcloud monitoring policies list --filter='displayName="frolf-api-auth-failure-spike"' --format="value(name)" | rg -q .; then
  render_policy "ops/gcp/policies/auth-failure-policy.json" "${TMP_DIR}/auth-failure-policy.json"
  gcloud alpha monitoring policies create --policy-from-file="${TMP_DIR}/auth-failure-policy.json"
fi

echo "Monitoring baseline complete."
gcloud monitoring policies list \
  --filter='displayName=("frolf-api-high-5xx-rate" OR "frolf-api-high-latency" OR "frolf-api-auth-failure-spike")' \
  --format="table(displayName,enabled)"
