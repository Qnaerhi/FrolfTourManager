#!/usr/bin/env bash
set -euo pipefail

# Create log-based metrics used by security/abuse alerts.

PROJECT_ID="${PROJECT_ID:-your-prod-project-id}"

if [[ "${PROJECT_ID}" == "your-prod-project-id" ]]; then
  echo "Set PROJECT_ID before running."
  exit 1
fi

gcloud config set project "${PROJECT_ID}" >/dev/null

echo "Creating auth failure metric..."
if ! gcloud logging metrics describe auth_failed_count >/dev/null 2>&1; then
  gcloud logging metrics create auth_failed_count \
    --description="Count of failed login/register responses from API" \
    --log-filter='resource.type="cloud_run_revision" AND jsonPayload.error=~"Email or password is incorrect|Too many authentication attempts"'
fi

echo "Creating high-volume public request metric..."
if ! gcloud logging metrics describe public_route_request_count >/dev/null 2>&1; then
  gcloud logging metrics create public_route_request_count \
    --description="Count of public route hits used for abuse trend monitoring" \
    --log-filter='resource.type="http_load_balancer" AND httpRequest.requestUrl=~"/api/(home|tours|competitions)"'
fi

echo "Log metrics setup complete."
gcloud logging metrics list \
  --filter='name=("auth_failed_count" OR "public_route_request_count")' \
  --format="table(name,description)"
