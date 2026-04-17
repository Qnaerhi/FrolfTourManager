# GCP MVP Deployment Scripts

This path deploys the MVP stack:

- API to Cloud Run
- Web app to Firebase Hosting
- Data/Auth via Firebase (Firestore + Firebase Auth)

## Prerequisites

- `gcloud` installed and authenticated
- `firebase` CLI installed and authenticated (`firebase login`)
- Existing GCP project with billing enabled

## Required environment variables

```bash
export PROJECT_ID="your-project-id"
export REGION="europe-north1"
export BILLING_ACCOUNT_ID="000000-000000-000000"
export CLIENT_ORIGIN="https://your-web-domain"
export API_DOMAIN="api.your-web-domain" # optional custom domain mapping
export BOOTSTRAP_ADMIN_EMAILS="you@example.com"
```

Optional:

```bash
export AR_REPO="frolf"
export API_SERVICE_NAME="frolf-tour-api"
export RUNTIME_SERVICE_ACCOUNT="frolf-api-runtime"
export HOSTING_SITE_ID="${PROJECT_ID}"
export FIREBASE_WEB_API_KEY="..." # only needed if you want server-side /api/auth/login endpoint
```

## Run order

```bash
bash ops/gcp/mvp/01-bootstrap-project.sh
bash ops/gcp/mvp/02-secrets-and-access.sh
bash ops/gcp/mvp/03-deploy-api-cloud-run.sh
bash ops/gcp/mvp/04-deploy-web-firebase.sh
bash ops/gcp/mvp/05-domain-mapping-guide.sh
```

## Notes

- For MVP, Cloud Run is deployed with `--allow-unauthenticated` so the web app can call the API directly.
- `CLIENT_ORIGIN` must match your frontend URL.
- Cloud Run runtime service account is used for Firestore access (no DB URI needed).
