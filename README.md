# FrolfTourManager

Frolf Tour Manager is a monorepo MVP for running amateur disc golf tours made up of independently organized local competitions.

## What It Includes

- Public home page with announcements, tours, and recent competitions
- Public tour pages with standings and competition listings
- Public competition detail pages with participants and final results
- Firebase Auth-backed authentication (ID tokens) with API-side user profile sync
- Organizer dashboard for creating and editing competitions
- Admin tools for tours, announcements, and user management
- Firestore-backed API with reusable competitor profiles and duplicate merge support
- Shared TypeScript package for schemas, permissions, and standings logic

## Workspace Layout

- `apps/api`: Express + TypeScript + Firebase Admin API
- `apps/web`: React + TypeScript + Vite frontend
- `packages/shared`: shared schemas, types, permissions, and standings logic
- `docs/product-spec.md`: MVP product rules and implementation assumptions

## Local Development

### 1. Install dependencies

```bash
npm install
```

### 2. Configure Firebase Admin access

For local development, authenticate Firebase Admin using either:

- Application Default Credentials (`gcloud auth application-default login`), or
- service account env vars in `apps/api/.env` (`FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`).

If you want `POST /api/auth/login` and `POST /api/auth/register` to return Firebase ID tokens directly, also set `FIREBASE_WEB_API_KEY`.

### 3. Configure environment files

Copy the examples if you want to override defaults:

- `apps/api/.env.example`
- `apps/web/.env.example`

### 4. Run the stack

```bash
npm run dev
```

This starts:

- shared package watcher
- API on `http://localhost:4000`
- web app on `http://localhost:5173`

## Authentication Notes

- Admin bootstrap is explicit via `BOOTSTRAP_ADMIN_EMAILS`; only verified users on that allowlist are promoted.
- Protected API routes now validate Firebase ID tokens from `Authorization: Bearer <idToken>`.
- Email verification is handled in Firebase Auth; the API syncs verification state from Firebase on auth and `/api/auth/verify-email`.

## Seed Test Tour Data

To populate Firestore with deterministic demo data for a `Test Tour`:

```bash
npm run seed:test-tour --workspace @frolf-tour/api
```

This seeds:

- 20 verified users (`Test Player 01` ... `Test Player 20`)
- 8 finalized competitions with full participant lists and scored results
- a `Test Tour` season (`2026 Test`) with a points table

The seed script creates data records only and does not provision Firebase Auth credentials.

## Quality Checks

```bash
npm run typecheck
npm test
npm run build
```

## GCP Guardrails

Production deployment guardrails live in `ops/gcp`:

- budget and quota baseline setup
- capped Cloud Run deployment
- Cloud Armor WAF and rate limit rules
- uptime checks and alert policy scaffolding
- emergency cost kill switch runbook

Start from `ops/gcp/README.md` and execute the scripts in order.

## Current MVP Rules

- Any verified user can create and publish competitions directly.
- Only finalized competitions count toward season standings.
- Scoring rules are configurable per tour and support best-`N` counting.
- Competitors are reusable profiles that can exist without user accounts.
- Admins manage tours, announcements, user roles, and competitor merges.
