# Box Codex — Live Turf Arena & Multi-Tenant Booking Platform

Multi-tenant turf arena booking platform built with Next.js 16 (App Router), Supabase Postgres, and shared packages.

## Monorepo Layout

The repository is organized into three primary layers:

```text
├── apps/
│   ├── player/          # Port 3000: Player discovery, slot selection, checkout & bookings
│   ├── owner/           # Port 3001: Unified Business Console for master owners & venue staff
│   └── admin/           # Port 3003: Platform administration, turf approvals & global payouts
├── packages/
│   └── shared/          # Monorepo contract: role resolution, shared types, portal configs, database.types.ts
├── supabase/
│   ├── migrations/      # 25 immutable database migrations (RBAC, ledger, inventory, cron, etc.)
│   ├── functions/       # Edge functions: checkout, payment-webhook, notification-worker
│   ├── tests/           # 15 pgTAP database unit suites (251 tests)
│   ├── seed.sql         # Production/hosted safe seed (0 demo users)
│   ├── seed.local.sql   # Local development demo seed with fail-closed session opt-in guard
│   └── seed.bootstrap.sql # Template for hosted platform administrator provisioning
├── tests/
│   ├── e2e/             # Full system lifecycle end-to-end integration suite
│   ├── concurrency/     # Race-condition acceptance suites (holds, ledger, webhooks, payouts)
│   ├── monitoring/      # Operational alerts and system health test harness
│   ├── proofs/          # Mathematical ledger and payout reproducibility proofs
│   ├── api/             # Payout release and administrative RPC RBAC tests
│   └── live/            # Manual live provider verification suites (requires external credentials)
├── scripts/             # Operational, verification, and documentation scripts
└── docs/                # Architecture specifications, API catalog, environments & operational state
```

## Local Development & Quick Start

### Default Path: Hosted Backend (No Docker Required)

Frontend engineers do not need Docker or a local Supabase instance. Work directly against the hosted staging backend:

1. **Clone the repository**:
   ```bash
   git clone https://github.com/Dhruv6576/Ewrone.git
   cd Ewrone
   ```
2. **Install / Select Node.js 22**:
   ```bash
   # Verify with:
   node -v
   # (nvm-windows users: provide the full version, e.g. 'nvm use 22.11.0', because nvm-windows does not read .nvmrc)
   ```
3. **Install Dependencies**:
   ```bash
   npm ci
   ```
4. **Bootstrap Staging Environment**:
   ```bash
   node scripts/bootstrap.mjs --target=staging
   ```
5. **Run Portal Applications**:
   ```bash
   npm run dev:player   # http://localhost:3000 (Player Portal)
   npm run dev:owner    # http://localhost:3001 (Unified Business Console)
   npm run dev:admin    # http://localhost:3003 (Platform Admin)
   ```

---

### Running the full stack locally (only needed for DB tests)

If you are developing database migrations, running pgTAP tests, or executing the automated concurrency/proof test suites, Docker is required:

1. **Prerequisites**: Docker Desktop running, Supabase CLI (`v2.115.0+`).
2. **Start Local Supabase Backend**:
   ```bash
   npx supabase start
   ```
3. **Seed Local Demo Fixtures & Worker**:
   ```bash
   node scripts/seed_local.mjs
   node scripts/set_worker_config.mjs --target=local
   ```
4. **Bootstrap Local Environment**:
   ```bash
   node scripts/bootstrap.mjs --target=local
   ```
5. **Run Database Tests**:
   ```bash
   npx supabase test db
   ```

## Test Suite Execution Order

Database fixtures and automated test suites must be executed in this exact sequential order:
```bash
# 1. Reset database to clean migrations
npx supabase db reset

# 2. Seed test fixtures and configure background cron worker
node scripts/seed_local.mjs
node scripts/set_worker_config.mjs

# 3. Run pgTAP database invariant test suites (Files=15, Tests=251)
npx supabase test db

# 4. Run automated integration, concurrency, monitoring, and proof suites
node tests/e2e/full_system_lifecycle.js
node tests/concurrency/booking_hold_concurrency.js
node tests/concurrency/ledger_concurrency_and_immutability.js
node tests/concurrency/payment_webhook_lifecycle.js
node tests/concurrency/payout_settlement_lifecycle.js
node tests/concurrency/walkin_vs_online_collision.js
node tests/concurrency/audit_notification_admin_lifecycle.js
node tests/monitoring/operational_alerts_test.js
node tests/proofs/owner_payout_reproducibility.js
node tests/proofs/owner_audit_proofs.js
node tests/api/payout_release_api_test.js
```
*Note: Test files under `tests/live/*` require live external third-party payment provider credentials and are excluded from CI.*

## Contract Workflow

When modifying or introducing database schema or RPCs, follow this required developer workflow:
1. **New Migration**: Create `supabase/migrations/<timestamp>_<feature_name>.sql` (never edit applied migrations `01..25`).
2. **New pgTAP Test**: Add a test file in `supabase/tests/` verifying functionality and including explicit denial cases for unauthorized roles.
3. **Regenerate Contract**: Run `npm run gen:types` to regenerate `packages/shared/src/database.types.ts`.
4. **Update Catalog**: Run `node scripts/generate_api_docs.mjs` to catalog RPC signatures and error states in `docs/API.md`.
5. **Pull Request**: Open a PR adhering to `.github/pull_request_template.md`.
