# FrolfTourManager

Frolf Tour Manager is a monorepo MVP for running amateur disc golf tours made up of independently organized local competitions.

## What It Includes

- Public home page with announcements, tours, and recent competitions
- Public tour pages with standings and competition listings
- Public competition detail pages with participants and final results
- Email/password auth with development-friendly email verification
- Organizer dashboard for creating and editing competitions
- Admin tools for tours, announcements, and user management
- MongoDB-backed API with reusable competitor profiles and duplicate merge support
- Shared TypeScript package for schemas, permissions, and standings logic

## Workspace Layout

- `apps/api`: Express + TypeScript + Mongoose API
- `apps/web`: React + TypeScript + Vite frontend
- `packages/shared`: shared schemas, types, permissions, and standings logic
- `docs/product-spec.md`: MVP product rules and implementation assumptions

## Local Development

### 1. Install dependencies

```bash
npm install
```

### 2. Start MongoDB

If you have Docker available, you can run the included compose file:

```bash
docker compose up -d
```

If you already run MongoDB locally, use `mongodb://127.0.0.1:27017/frolf-tour-manager` or set a custom `MONGODB_URI`.

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
- In development, the API returns the email verification token in auth responses so the frontend dashboard can complete the flow without a real mail provider.

## Seed Test Tour Data

To populate local MongoDB with deterministic demo data for a `Test Tour`:

```bash
npm run seed:test-tour --workspace @frolf-tour/api
```

This seeds:

- 20 verified users (`Test Player 01` ... `Test Player 20`)
- 8 finalized competitions with full participant lists and scored results
- a `Test Tour` season (`2026 Test`) with a points table

All seeded users share password `password123` for local testing.

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
