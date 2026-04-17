#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-}"
REGION="${REGION:-europe-north1}"
API_SERVICE_NAME="${API_SERVICE_NAME:-frolf-tour-api}"
API_DOMAIN="${API_DOMAIN:-}"
WEB_DOMAIN="${WEB_DOMAIN:-}"
HOSTING_SITE_ID="${HOSTING_SITE_ID:-${PROJECT_ID}}"

if [[ -z "${PROJECT_ID}" ]]; then
  echo "PROJECT_ID is required."
  exit 1
fi

echo "=== Domain mapping guide ==="
echo "1) API custom domain (Cloud Run):"
if [[ -n "${API_DOMAIN}" ]]; then
  cat <<EOF
gcloud run domain-mappings create \
  --project "${PROJECT_ID}" \
  --region "${REGION}" \
  --service "${API_SERVICE_NAME}" \
  --domain "${API_DOMAIN}"

gcloud run domain-mappings describe \
  --project "${PROJECT_ID}" \
  --region "${REGION}" \
  --domain "${API_DOMAIN}"
EOF
else
  echo "Set API_DOMAIN to print exact command."
fi

echo
echo "2) Web custom domain (Firebase Hosting):"
if [[ -n "${WEB_DOMAIN}" ]]; then
  cat <<EOF
firebase hosting:sites:create "${HOSTING_SITE_ID}" --project "${PROJECT_ID}" # if needed
firebase target:apply hosting live "${HOSTING_SITE_ID}" --project "${PROJECT_ID}" # optional
firebase hosting:channel:deploy live --project "${PROJECT_ID}" # optional smoke deploy
firebase hosting:sites:update "${HOSTING_SITE_ID}" --project "${PROJECT_ID}" # optional metadata update

# In Firebase Console -> Hosting -> Add custom domain:
# ${WEB_DOMAIN}
EOF
else
  echo "Set WEB_DOMAIN to print exact guidance."
fi

echo
echo "After DNS propagation, set:"
echo "CLIENT_ORIGIN=https://<your-web-domain>"
echo "Then re-run:"
echo "bash ops/gcp/mvp/03-deploy-api-cloud-run.sh"
