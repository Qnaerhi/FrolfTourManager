#!/usr/bin/env bash
set -euo pipefail

# Create and attach Cloud Armor policy with baseline managed protection
# and route-aware rate limiting.

PROJECT_ID="${PROJECT_ID:-your-prod-project-id}"
SECURITY_POLICY_NAME="${SECURITY_POLICY_NAME:-frolf-api-armor}"
BACKEND_SERVICE_NAME="${BACKEND_SERVICE_NAME:-frolf-api-backend-service}"

if [[ "${PROJECT_ID}" == "your-prod-project-id" ]]; then
  echo "Set PROJECT_ID before running."
  exit 1
fi

gcloud config set project "${PROJECT_ID}" >/dev/null

echo "Creating Cloud Armor policy..."
if ! gcloud compute security-policies describe "${SECURITY_POLICY_NAME}" >/dev/null 2>&1; then
  gcloud compute security-policies create "${SECURITY_POLICY_NAME}" --type=CLOUD_ARMOR
fi

echo "Enabling OWASP managed protection..."
if ! gcloud compute security-policies rules describe 1000 --security-policy "${SECURITY_POLICY_NAME}" >/dev/null 2>&1; then
  gcloud compute security-policies rules create 1000 \
    --security-policy "${SECURITY_POLICY_NAME}" \
    --expression "evaluatePreconfiguredWaf('sqli-v33-stable') || evaluatePreconfiguredWaf('xss-v33-stable')" \
    --action deny-403 \
    --description "Block common SQLi/XSS patterns"
fi

echo "Applying stricter auth endpoint rate limit..."
if ! gcloud compute security-policies rules describe 1100 --security-policy "${SECURITY_POLICY_NAME}" >/dev/null 2>&1; then
  gcloud compute security-policies rules create 1100 \
    --security-policy "${SECURITY_POLICY_NAME}" \
    --expression "request.path.matches('/api/auth/(login|register)')" \
    --action throttle \
    --rate-limit-threshold-count 20 \
    --rate-limit-threshold-interval-sec 60 \
    --conform-action allow \
    --exceed-action deny-429 \
    --enforce-on-key IP \
    --description "Auth route brute-force protection"
fi

echo "Applying baseline public API rate limit..."
if ! gcloud compute security-policies rules describe 1200 --security-policy "${SECURITY_POLICY_NAME}" >/dev/null 2>&1; then
  gcloud compute security-policies rules create 1200 \
    --security-policy "${SECURITY_POLICY_NAME}" \
    --expression "request.path.matches('/api/(home|tours|competitions).*')" \
    --action throttle \
    --rate-limit-threshold-count 120 \
    --rate-limit-threshold-interval-sec 60 \
    --conform-action allow \
    --exceed-action deny-429 \
    --enforce-on-key IP \
    --description "Public route abuse protection"
fi

echo "Attaching policy to backend service..."
gcloud compute backend-services update "${BACKEND_SERVICE_NAME}" \
  --global \
  --security-policy "${SECURITY_POLICY_NAME}"

echo "Cloud Armor baseline complete."
gcloud compute security-policies rules list --security-policy "${SECURITY_POLICY_NAME}" --format="table(priority,action,description)"
