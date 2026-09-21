# Contributing to Box Codex

Welcome to the Box Codex team! This guide establishes the development standards, code ownership boundaries, migration safety rules, and test protocols for all engineers working across this monorepo.

---

## 1. Branch Naming Conventions

All branches must follow standard prefix conventions:
- `feat/<scope>-<description>`: New portal features or capabilities (e.g. `feat/player-booking-filters`)
- `fix/<scope>-<description>`: Bug fixes and defect corrections (e.g. `fix/owner-calendar-tz`)
- `refactor/<scope>-<description>`: Code restructuring without feature changes (e.g. `refactor/shared-validators`)
- `chore/<scope>-<description>`: Tooling, dependency, or configuration updates (e.g. `chore/bump-next`)
- `docs/<scope>-<description>`: Documentation additions or updates (e.g. `docs/api-catalog-refresh`)

---

## 2. Pull Request Flow & Quality Gates

1. **Branch off `main`**: Always ensure your local `main` is up to date before branching.
2. **Commit Hygiene**: Write atomic, descriptive commit messages. Never commit secrets, `.env` files, or generated build caches.
3. **Automated CI Validation**: Every Pull Request triggers `.github/workflows/ci.yml`:
   - **Migration Immutability Check**: Blocks any commit modifying existing base migrations.
   - **Seed & Secret Safety Check**: Prohibits `--include-seed` and prevents tracking `.env` secrets.
   - **Stale-Contract Guard**: Regenerates database types and ensures `packages/shared/src/database.types.ts` is committed and up to date.
   - **Typecheck & Build**: Compiles all three portal applications (`apps/player`, `apps/owner`, `apps/admin`).
   - **Supabase pgTAP & Automated Test Suites**: Boots the local stack, seeds safe fixtures, and executes all 15 pgTAP test suites and 11 JavaScript integration/concurrency suites.
4. **PR Template**: Fill out all sections of `.github/pull_request_template.md`.
5. **Code Review & Approval**: PRs must be approved by the designated code owners before merging.

---

## 3. CODEOWNERS & Area Boundaries

Repository areas are divided between core backend governance and team portal applications:

| Area / Directory | Code Owner | Responsibility |
| :--- | :--- | :--- |
| `supabase/` | User (`@Dhruv6576`) | Database schema, migrations, RLS policies, security-definer RPCs, edge functions |
| `packages/shared/` | User (`@Dhruv6576`) | Type contracts (`database.types.ts`), client factories, role resolvers, config tokens |
| `tests/` | User (`@Dhruv6576`) | Automated pgTAP unit suites, concurrency suites, mathematical proofs, E2E harnesses |
| `scripts/` | User (`@Dhruv6576`) | Operational automation, seed runners, verification harnesses |
| `apps/` | Team | Frontend portals: `apps/player`, `apps/owner` (Unified Business Console), `apps/admin` |

Frontend team members have autonomous ownership of UI components, routing, and user experiences within `apps/`, adhering to shared contracts from `@boxcodex/shared`. Any change affecting database schema, shared interfaces, or test harnesses requires review from the core owner.

---

## 4. Migration Immutability Rule

> [!IMPORTANT]
> **Never edit an applied migration.** Migrations `20260918000001` through `20260918000025` are permanently frozen and cryptographically hashed in CI. Any modification to an applied migration will fail CI immediately.

- **New Work Rule**: All subsequent database changes must strictly be introduced as a new migration timestamped **`20260918000026` or later**:
  `supabase/migrations/20260918000026_<feature_name>.sql`
- **Contract Workflow**:
  1. Add the new migration `20260918000026+`.
  2. Add corresponding pgTAP tests in `supabase/tests/` verifying behavior and explicit denial cases.
  3. Run `npm run gen:types` to update `packages/shared/src/database.types.ts`.
  4. Run `node scripts/generate_api_docs.mjs` to document RPCs in `docs/API.md`.

---

## 5. Local Stack & Test Suite Execution Order

To run the local stack and execute tests, always follow this exact order:

```bash
# 1. Start local Supabase containers (PostgreSQL, PostgREST, Auth, Storage)
npx supabase start

# 2. Reset database to a clean, authoritative state
npx supabase db reset

# 3. Apply local demo fixtures and configure background cron worker
node scripts/seed_local.mjs
node scripts/set_worker_config.mjs

# 4. Run pgTAP database invariant test suites (15 suites, 251 assertions)
npx supabase test db

# 5. Run the 11 automated integration, concurrency, and proof suites in order
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

---

## 6. Live Test Credentials Policy

> [!CAUTION]
> Test files under `tests/live/*` (e.g. `razorpay_live_checkout_test.js`) require live external third-party payment provider credentials.
> - **Never execute `tests/live/*` in CI**: These suites make real network calls against external sandbox or live payment gateways.
> - **Execution**: These tests are intended strictly for manual, offline integration testing by authorized maintainers with valid test keys.
> - **Secrets**: Never commit live API keys, tokens, or customer credentials to the repository.
