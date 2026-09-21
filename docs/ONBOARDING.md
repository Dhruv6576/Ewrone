# Developer Onboarding Guide

Welcome to Box Codex. This document outlines the initial setup workflow for new team members getting their local environment up and running on Day 1.

---

## First-Day Setup Checklist

Follow these steps in exact numerical order:

### 1. Clone the Repository
```bash
git clone <repository-url> box-codex
cd box-codex
```

### 2. Configure Node.js Runtime
Use Node.js 20 LTS as specified in `.nvmrc`:
```bash
nvm use
# Or ensure node -v returns v20.x
node -v
```

### 3. Install Monorepo Dependencies
Install clean dependencies across all workspaces (`apps/*`, `packages/*`):
```bash
npm ci
```

### 4. Start Local Supabase Stack
Ensure Docker Desktop is running, then boot the local Supabase container cluster:
```bash
npx supabase start
```
*This starts Postgres on port `54322`, PostgREST and Auth on port `54321`, and local Supabase Studio on port `54323`.*

### 5. Seed Local Demo Fixtures
Apply local demo fixtures with the explicit session opt-in guard:
```bash
node scripts/seed_local.mjs
```

### 6. Configure Local Background Cron Worker
Synchronize the local edge notification worker URL and secret in `private.app_config`:
```bash
node scripts/set_worker_config.mjs
```

### 7. Run Portal Applications
Launch development servers for the portal applications you are working on:
```bash
# Player Portal (Port 3000)
npm run dev:player

# Unified Business Console (Owner & Staff, Port 3001)
npm run dev:owner

# Platform Admin Portal (Port 3003)
npm run dev:admin
```

### 8. Run Database Invariant Tests
Verify that your local database schema, policies, and RPC invariants pass:
```bash
npx supabase test db
```
*Expected result: 15 test files passing, 251 assertions.*

---

## Local Demo Accounts

The following demo accounts are provisioned exclusively by `supabase/seed.local.sql` for local portal development and testing.

> [!NOTE]
> All demo accounts share the standard local development password format. In accordance with platform secret safety policies, passwords are masked below.

| Role | Email | Portal Access | Port | Masked Password |
| :--- | :--- | :--- | :--- | :--- |
| **Master Owner** | `demo_owner@boxcodex.internal` | Unified Business Console (`/master/*`) | `3001` | `[len 12, Pass...123!]` |
| **Arena Staff** | `demo_staff@boxcodex.internal` | Unified Business Console (`/owner/*`) | `3001` | `[len 12, Pass...123!]` |
| **Registered Player** | `live_player@example.com` | Player Portal (Booking & Checkout) | `3000` | `[len 12, Pass...123!]` |
| **Platform Admin** | `demo_admin@boxcodex.internal` | Platform Admin Portal (`/admin/*`) | `3003` | `[len 12, Pass...123!]` |

---

## Architecture & Development References

- [README.md](file:///c:/Dhruv/Projectss/Box%20Codex/README.md) — Quick start and test suite execution order.
- [CONTRIBUTING.md](file:///c:/Dhruv/Projectss/Box%20Codex/CONTRIBUTING.md) — Team standards, branching, PR flow, and CODEOWNERS boundaries.
- [docs/STATE.md](file:///c:/Dhruv/Projectss/Box%20Codex/docs/STATE.md) — Architecture invariants, frozen migrations, and single-source secret locations.
- [docs/API.md](file:///c:/Dhruv/Projectss/Box%20Codex/docs/API.md) — Authoritative PostgREST RPC catalog (signatures, parameters, return types).
- [docs/ENVIRONMENTS.md](file:///c:/Dhruv/Projectss/Box%20Codex/docs/ENVIRONMENTS.md) — Secret management and deployment configuration across Local, Staging, and Production.
