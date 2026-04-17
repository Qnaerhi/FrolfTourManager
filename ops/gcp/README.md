# GCP deployment guardrails

This folder contains production-oriented commands and checklists for keeping
FrolfTourManager secure and low-cost on Google Cloud.

For a simpler MVP deployment path (Cloud Run API + Firebase Hosting web),
see `ops/gcp/mvp/README.md`.

## Prerequisites

- `gcloud` CLI authenticated to the correct billing account and project.
- `PROJECT_ID`, `PROJECT_NUMBER`, and `REGION` selected.
- Billing API, Cloud Run API, Monitoring API, and Compute API enabled.

## Execution order

1. Run `01-billing-guardrails.sh` to configure budget alerts, quotas, and log retention.
2. Run `06-secrets-setup.sh` to create `JWT_SECRET` and `MONGODB_URI` secrets.
3. Run `02-deploy-cloud-run.sh` to deploy a capped Cloud Run service.
4. Run `03-edge-security.sh` to attach Cloud Armor policy and rate limits.
5. Run `05-log-metrics.sh` to create log-based abuse metrics.
6. Run `04-monitoring-alerts.sh` to create uptime checks and alerting policies.

## Important notes

- Scripts are intentionally conservative and include placeholder values.
- Review every variable block before running in production.
- Keep `dev` and `prod` projects separate to contain accidental cost growth.
- Use the emergency procedures in `runbooks/emergency-cost-kill-switch.md` if spending spikes.
- Scripts now fail fast on missing placeholders and print verification output after changes.
- `02-deploy-cloud-run.sh` defaults to `--no-allow-unauthenticated`; set `ALLOW_UNAUTHENTICATED=true` only if edge controls are in place.
