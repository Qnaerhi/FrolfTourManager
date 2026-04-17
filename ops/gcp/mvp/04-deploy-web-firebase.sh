#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-}"
HOSTING_SITE_ID="${HOSTING_SITE_ID:-${PROJECT_ID}}"
API_BASE_URL="${API_BASE_URL:-}"
FIREBASE_WEB_APP_ID="${FIREBASE_WEB_APP_ID:-}"

if [[ -z "${PROJECT_ID}" ]]; then
  echo "PROJECT_ID is required."
  exit 1
fi

if [[ -z "${API_BASE_URL}" ]]; then
  echo "API_BASE_URL is required (for example: https://frolf-tour-api-xyz.a.run.app)."
  exit 1
fi

if ! command -v firebase >/dev/null 2>&1; then
  echo "firebase CLI is required. Install with: npm install -g firebase-tools"
  exit 1
fi

echo "Ensuring Firebase is enabled for project..."
firebase projects:addfirebase "${PROJECT_ID}" >/dev/null 2>&1 || true

echo "Ensuring hosting site exists..."
firebase hosting:sites:create "${HOSTING_SITE_ID}" --project "${PROJECT_ID}" >/dev/null 2>&1 || true

if [[ -z "${FIREBASE_WEB_APP_ID}" ]]; then
  echo "Resolving Firebase Web App ID..."
  APPS_JSON="$(firebase apps:list --project "${PROJECT_ID}" --json)"
  FIREBASE_WEB_APP_ID="$(
    node -e '
      const payload = JSON.parse(process.argv[1]);
      const app = (payload.result || []).find((entry) => entry.platform === "WEB" && entry.state === "ACTIVE");
      if (!app?.appId) process.exit(1);
      process.stdout.write(app.appId);
    ' "${APPS_JSON}"
  )" || true
fi

if [[ -z "${FIREBASE_WEB_APP_ID}" ]]; then
  echo "No Firebase WEB app found for project ${PROJECT_ID}."
  echo "Create one with: firebase apps:create WEB frolf-web --project ${PROJECT_ID}"
  exit 1
fi

echo "Fetching Firebase Web SDK config for app ${FIREBASE_WEB_APP_ID}..."
SDK_JSON="$(firebase apps:sdkconfig WEB "${FIREBASE_WEB_APP_ID}" --project "${PROJECT_ID}" --json)"
SDK_ENV="$(
  node -e '
    const payload = JSON.parse(process.argv[1]);
    const config = payload.result?.sdkConfig;
    if (!config) process.exit(1);
    const pairs = {
      VITE_FIREBASE_API_KEY: config.apiKey,
      VITE_FIREBASE_AUTH_DOMAIN: config.authDomain,
      VITE_FIREBASE_PROJECT_ID: config.projectId,
      VITE_FIREBASE_STORAGE_BUCKET: config.storageBucket,
      VITE_FIREBASE_MESSAGING_SENDER_ID: config.messagingSenderId,
      VITE_FIREBASE_APP_ID: config.appId,
    };
    for (const [key, value] of Object.entries(pairs)) {
      if (!value) process.exit(2);
      process.stdout.write(`${key}=${value}\n`);
    }
  ' "${SDK_JSON}"
)"

if [[ -z "${SDK_ENV}" ]]; then
  echo "Unable to resolve Firebase SDK env values."
  exit 1
fi

while IFS='=' read -r key value; do
  export "${key}=${value}"
done <<< "${SDK_ENV}"

echo "Building shared and web packages..."
npm run build --workspace @frolf-tour/shared
VITE_API_URL="${API_BASE_URL}" npm run build --workspace @frolf-tour/web

PUBLIC_DIR="$(pwd)/apps/web/dist"
if [[ ! -d "${PUBLIC_DIR}" ]]; then
  echo "Expected build output not found: ${PUBLIC_DIR}"
  exit 1
fi

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "${TMP_DIR}"' EXIT

cat > "${TMP_DIR}/firebase.json" <<EOF
{
  "hosting": {
    "site": "${HOSTING_SITE_ID}",
    "public": "${PUBLIC_DIR}",
    "ignore": [
      "firebase.json",
      "**/.*",
      "**/node_modules/**"
    ],
    "rewrites": [
      {
        "source": "**",
        "destination": "/index.html"
      }
    ],
    "headers": [
      {
        "source": "/index.html",
        "headers": [
          {
            "key": "Cache-Control",
            "value": "no-cache"
          }
        ]
      }
    ]
  }
}
EOF

echo "Deploying web app to Firebase Hosting..."
firebase deploy \
  --project "${PROJECT_ID}" \
  --only hosting \
  --config "${TMP_DIR}/firebase.json"

echo "Web deployment complete."
echo "Default Hosting URL: https://${HOSTING_SITE_ID}.web.app"
