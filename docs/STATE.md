# System State & Frozen Architecture Contract

## 1. Migrations
- **Total Migration Count**: 22 files
- **Max Version**: `20260918000022_admin_portal_rpc_and_read_paths.sql`
- **Rule**: Any further schema, RPC, or policy changes must strictly be authored in a new migration (`20260918000023_*.sql`). Never modify applied migrations.

## 2. Callable Public RPC Surface & Per-Function Guards

All functions reside in schema `public` with `SECURITY DEFINER` semantics:

| RPC Name | Purpose | Caller Authorization Guard |
| :--- | :--- | :--- |
| `get_my_context()` | Session bootstrap & role resolution | `auth.uid()` (authenticated or anon) |
| `get_my_capabilities(p_master_owner_id)` | Owner tenant capability resolution | `auth.uid()` matching tenant owner or assigned employee |
| `is_platform_admin()` | Boolean check for platform administration | Returns boolean via `private.is_platform_admin(auth.uid())` |
| `get_public_slot_allocations(...)` | Anonymous & player schedule reads | Public / Unrestricted |
| `quote_booking(...)` | Slot pricing quote calculation | Public / Unrestricted |
| `create_booking_hold(...)` | Hold reservation on slot | Authenticated / Registered Player (`auth.uid()`) |
| `create_or_get_payment_order(...)` | Prepare order for booking hold | Authenticated booking holder |
| `cancel_booking(...)` | Player-initiated cancellation with refund policy | Authenticated booking owner |
| `create_walkin_booking(...)` | Counter walk-in booking creation | `turf.create_walkin` capability or Master Owner |
| `block_resource_time(...)` | Maintenance time block | `turf.block_time` capability or Master Owner |
| `release_resource_block(...)` | Release maintenance block | `turf.block_time` capability or Master Owner |
| `set_resource_operating_hours(...)` | Turf schedule configuration | Master Owner or assigned employee with hours permissions |
| `upsert_pricing_rule(...)` | Base/peak pricing rules | Master Owner |
| `submit_turf_for_approval(...)` | Transition turf to pending review | Master Owner |
| `update_turf_onboarding(...)` | Edit draft/pending turf metadata | Master Owner |
| `invite_employee(...)` | Invite business employee | `employee.manage` capability or Master Owner |
| `accept_employee_invite(...)` | Redeem employee invitation token | Authenticated recipient matching invited email |
| `disable_employee(...)` | Deactivate employee access | `employee.manage` capability or Master Owner |
| `update_employee_assignments(...)` | Turf assignments & capabilities | `employee.manage` capability or Master Owner |
| `get_pending_employee_invites(...)` | View outstanding invites | Master Owner |
| `get_owner_dashboard(...)` | Aggregated owner KPI metrics | Master Owner |
| `get_owner_financial_summary(...)` | Statement summary | Master Owner (`private.is_master_owner_user`) |
| `get_owner_statement(...)` | Ledger accounting statement | Master Owner (`private.is_master_owner_user`) |
| `register_owner_financial_account(...)`| Bank account registration | Master Owner (`private.is_master_owner_user`) |
| `plan_owner_payout(...)` | Calculate and freeze payout batch | Master Owner |
| `admin_get_turf_queue(...)` | Platform admin queue inspection | `private.is_platform_admin(auth.uid())` (clamped 1-100) |
| `admin_review_turf(...)` | Approve/reject/suspend turf | `private.is_platform_admin(auth.uid())` |
| `admin_get_payouts(...)` | Platform admin payout queue | `private.is_platform_admin(auth.uid())` (clamped 1-100) |
| `admin_get_tenants(...)` | Platform admin tenant list | `private.is_platform_admin(auth.uid())` (clamped 1-100) |
| `admin_get_commission_rules(...)` | Read platform fee rules | `private.is_platform_admin(auth.uid())` |
| `admin_set_commission_rule(...)` | Configure platform fee rules | `private.is_platform_admin(auth.uid())` |
| `get_audit_events(...)` | System & turf audit log reads | Tenant Owner (scoped) or Platform Admin (unscoped) |
| `settle_owner_payout(...)` | Mark payout settled and post ledger | `private.is_platform_admin(auth.uid())` |
| `request_refund(...)` | Execute refund against payment | `private.is_platform_admin(auth.uid())` or Master Owner |
| `update_payment_order_provider(...)` | Update provider order reference | `authenticated` (internal checkout bridge) |
| `register_device_token(...)` | Register device push token | `auth.uid()` |
| `get_my_notifications(...)` | Read in-app notification inbox | `auth.uid()` |
| `mark_notification_read(...)` | Mark notification as read | `auth.uid()` |
| `authorize_realtime_channel(...)` | Verify socket channel authorization | `auth.uid()` |
| `persist_webhook_event(...)` | Webhook receiver persistence | Internal service / edge function |
| `process_webhook_event(...)` | Webhook event processing | Internal service / edge function |

## 3. Environment & Secrets Single-Sourcing

| File | Role & Ownership | Keys Held |
| :--- | :--- | :--- |
| `supabase/functions/.env` | **Canonical Runner Source** for Edge Runtime | `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `RAZORPAY_WEBHOOK_SECRET`, `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `INTERNAL_WORKER_SECRET` |
| `supabase/functions/.env.example`| Sanitized template | Placeholder keys matching exact canonical names |
| `apps/*/.env.local` | Next.js frontend client environments | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` |
| `supabase/.env` | Deprecated / sanitized | Empty or non-secret local dev comments |
| `.env` (root) | Deprecated / sanitized | Empty or non-secret local dev comments |
| `private.app_config` table | Environment-Agnostic Cron Worker Config | `notification_worker_url`, `worker_secret` (populated via `scripts/set_worker_config.mjs` per environment; must match `INTERNAL_WORKER_SECRET`) |
| `supabase/seed.local.sql` | Local development fixtures | Guarded by fail-closed `app.allow_demo_seed = 'on'` session opt-in |

> [!NOTE]
> The `app.allow_demo_seed` guard prevents accidental execution, not a determined one — any role that can connect can set it in its own session. The real controls are the CI prohibition on `--include-seed` and the file's absence from hosted contexts.

> [!CAUTION]
> **Edge Runtime Environment Reload Operational Trap**:
> Modifying `supabase/functions/.env` on disk does **NOT** automatically update the running Edge Runtime container (`supabase_edge_runtime_Box_Codex`). Furthermore, running `npx supabase db reset` only resets the PostgreSQL database and does **NOT** reload environment variables into Edge Runtime.
> To pick up new environment variables or secret updates in Edge Functions, you must recreate the Edge Runtime container:
> `docker rm -f supabase_edge_runtime_Box_Codex; npx supabase start`
> Failure to restart the container will leave the Edge Functions running stale credentials in memory.

## 4. Cron Jobs and Schedules

Configured in `cron.job` via `pg_cron`:

| Job ID | Job Name | Schedule | Command |
| :--- | :--- | :--- | :--- |
| 1 | `expire-booking-holds` | `* * * * *` | `select private.expire_booking_holds();` |
| 2 | `retry-unprocessed-webhooks` | `*/2 * * * *` | `select private.retry_unprocessed_webhooks();` |
| 3 | `trigger-notification-worker` | `* * * * *` | `select private.trigger_notification_worker();` |
| 4 | `check-ledger-invariants` | `*/5 * * * *` | `select private.check_ledger_invariants();` |
| 5 | `check-operational-health` | `*/5 * * * *` | `select private.check_operational_health();` |

## 5. Test Matrix Execution Order

The full automated test matrix must be executed sequentially in this order:

1. **pgTAP Database Invariants**:
   ```bash
   npx supabase test db
   ```
   *(Expect 14 files / 241 tests passing)*
2. **E2E Full System Lifecycle**:
   ```bash
   node tests/e2e/full_system_lifecycle.js
   ```
3. **Walkin vs Online Collision Concurrency**:
   ```bash
   node tests/concurrency/walkin_vs_online_collision.js
   ```
4. **Payment Webhook Lifecycle**:
   ```bash
   node tests/concurrency/payment_webhook_lifecycle.js
   ```
5. **Payout Settlement Lifecycle**:
   ```bash
   node tests/concurrency/payout_settlement_lifecycle.js
   ```
6. **API Payout Settlement & Refund PostgREST RPC**:
   ```bash
   node tests/api/payout_release_api_test.js
   ```

## 6. Known-But-Accepted Design Decisions

1. **`payout-reconcile` Deleted**:
   The standalone edge function was dead code and has been removed. Payout settlement is handled directly and atomically by the PostgREST RPC `public.settle_owner_payout` (and refund requests via `public.request_refund`).
2. **`/admin` Entry Point**:
   `/admin` is accessible via URL and conditionally rendered via a discreet `<ShieldCheck /> Admin` badge in the global navigation bar (`Navbar.tsx`) strictly when `get_my_context().is_platform_admin` evaluates to true. Route handlers and database RPCs enforce `private.is_platform_admin(auth.uid())`.
3. **Platform Admin Bootstrap**:
   Platform administration rights are assigned manually via authoritative database SQL (`INSERT INTO private.platform_admins (user_id) ...`) as documented in [docs/platform_admin_bootstrap.md](file:///c:/Dhruv/Projectss/Box%20Codex/docs/platform_admin_bootstrap.md). There is intentionally no public sign-up or automated elevation endpoint for platform admins.

## 7. Multi-Portal Workspace & Client Invariant Rules

1. **Client & Role Single-Sourcing**:
   No app may create its own Supabase client or re-implement role resolution. All apps must consume the browser factory (`createBrowserClient`), server factory (`createServerClient`), and role resolver (`resolveUserRole`) exclusively from `@boxcodex/shared`.
2. **Session Isolation & Port Map**:
   Each web application runs on a dedicated port and utilizes its own distinct cookie name and `supabase-js` `storageKey` defined in `@boxcodex/shared`'s `PORTAL_CONFIGS`:
    - `apps/player`: Port 3000 | Cookie: `sb-boxcodex-player-auth-token` | StorageKey: `boxcodex_player_auth`
      - Scripts: `npm run dev:player`, `npm run build:player` (also root default `dev` / `build`)
      - Gate Predicate: `role.canAccessPlayer` (`true` per `resolveUserRole`, public catalog browsing allowed; authenticated session required for checkout/bookings).
    - `apps/owner`: Port 3001 | Cookie: `sb-boxcodex-owner-auth-token` | StorageKey: `boxcodex_owner_auth`
      - Scripts: `npm run dev:owner`, `npm run build:owner`
      - Description: **Unified Business Console** (Master Owner + Staff). Single unified business app running on Port 3001.
      - Sub-trees:
        - `/login`: Unified role-aware authentication landing.
        - `/master/*`: Master Owner portfolio, venues, team, payouts, and onboarding.
        - `/owner/*`: Staff arena operations (calendar, slots, bookings, audit).
        - Workspace Switcher: Visible in the sidebar exclusively when a user holds both hats (`canAccessMasterOwner && canAccessStaffOwner`).
      - Gate Predicate: Dual-gated edge proxy + server layout (`role.canAccessStaffOwner || role.canAccessMasterOwner || role.isPlatformAdmin`).
    - `apps/master-owner`: **DEPRECATED as of Phase 15** | Port 3002 (legacy)
      - Retained in codebase for reference; all routing consolidated into `apps/owner` on Port 3001.
    - `apps/admin`: Port 3003 | Cookie: `sb-boxcodex-admin-auth-token` | StorageKey: `boxcodex_admin_auth`
      - Scripts: `npm run dev:admin`, `npm run build:admin`
      - Gate Predicate: `role.canAccessAdmin` (`Boolean(context.is_platform_admin)`).
3. **Proxy-Plus-Layout Dual-Gate Pattern**:
   Security enforcement operates across two complementary server-side layers:
   - **Layer 1 (Edge Proxy / Middleware)**: Next.js edge proxy inspects incoming requests before route resolution, checks session cookies via `createServerClient`, and redirects unauthenticated callers to `/login` or unauthorized callers to `/login?reason=forbidden`.
   - **Layer 2 (Server Layout Gate)**: Each protected portal layout (`(portal)/layout.tsx`) is an async Server Component invoking `cookies()` and authoritative database RPC `getMyContext()`. Callers failing the portal's gate predicate are refused at the layout boundary prior to rendering child routes or portal chrome.
4. **Master-Owner Server Layout Gate Parity (Phase 5 Fix)**:
   `apps/master-owner/src/app/(master)/layout.tsx` was originally implemented as a client component (`'use client'`), which caused all master-owner routes to compile as `○ (Static)` and risked rendering chrome on RPC errors. It has been converted to an async Server Component with server-side identity resolution via `createServerClient('masterOwner', cookieStore)` + `getMyContext` + `resolveUserRole`. Interactive chrome (sidebar toggle, tenant switcher dropdown, notification bell) has been isolated into client leaf component `MasterOwnerSidebar.tsx`. All master-owner routes now compile as `ƒ (Dynamic)` with fail-closed rejection at the layout boundary.
5. **Legacy `web/` Monolith Retirement & Backup**:
   The transitional monolith `web/` was retired and deleted in Phase 9 following verified cutover. An independent, byte-verified backup of all 1608 files is archived outside the repository tree at:
   - Archive Destination: `C:\Dhruv\Projectss\Box Codex-backup\web-backup-20260920T110500Z`
   - Hash Manifest: `C:\Dhruv\Projectss\Box Codex-backup\web-backup-20260920T110500Z-sha256.txt`
   - Manifest SHA256: `952A8570378C52DB1CCFAB8EDD4B250B242484A62AD0AA1875F6FB3CC89FA797`
6. **Audit & Evidence Convention**:
   All verification outputs, raw terminal stdout captures, test runner results, and build logs are captured in per-round evidence directories on disk under `scratch/evidence/roundN/` (round6/ … round10/ to date). Each evidence artifact is verified with uppercase SHA256 checksums and line counts. The `scratch/` directory is gitignored to maintain a clean repository tree while preserving an immutable local audit trail.



