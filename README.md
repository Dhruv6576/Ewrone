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

1. **Prerequisites**: Node.js 20+, Docker Desktop, Supabase CLI (`v2.115.0+`).
2. **Start Local Supabase Backend**:
   ```bash
   npx supabase start
   ```
3. **Seed Local Demo Fixtures**:
   ```bash
   node scripts/seed_local.mjs
   node scripts/set_worker_config.mjs
   ```
   > [!NOTE]
   > The `app.allow_demo_seed` guard prevents accidental execution, not a determined one — any role that can connect can set it in its own session. The real controls are the CI prohibition on `--include-seed` and the file's absence from hosted contexts.
4. **Run pgTAP Database Invariants**:
   ```bash
   npx supabase test db
   ```
5. **Run Portal Applications**:
   ```bash
   npm run dev:player   # http://localhost:3000
   npm run dev:owner    # http://localhost:3001 (Unified Business Console)
   npm run dev:admin    # http://localhost:3003 (Platform Admin)
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
