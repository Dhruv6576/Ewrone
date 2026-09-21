# Implementation Plan: Owner Portal Phase 1 (Migration 17, Owner Shell & Dashboard)

> [!NOTE]
> **SUPERSEDED — Historical Phase 1 Plan**
> This document describes the retired `web/` monolith implementation.
> The owner and player surfaces have been superseded and migrated to `apps/owner` and `apps/player`.

Implement Phase 1 owner surfaces according to [docs/architecture.txt §16.1](file:///c:/Dhruv/Projectss/Box%20Codex/docs/architecture.txt) without denormalizing `public.turfs`. All onboarding media, amenities, and sports write to the existing normalized tables established in Migration 03 (`public.turf_photos`, `public.turf_amenities`, `public.resource_sports`).

## 1. Schema & Migration 17 Specification

### A. Normalized Storage (No New Columns on `public.turfs`)
- Migration 03 already defines:
  - `public.turf_photos(id, turf_id, storage_path, sort_order, published, created_at)`
  - `public.turf_amenities(turf_id, amenity_code)` with FK -> `public.amenities(code)`
  - `public.resource_sports(resource_id, sport_code)` with FK -> `public.sports(code)`
- Zero new columns will be added to `public.turfs`. The existing columns `description`, `address_text`, and `version` will be maintained.

### B. `public.update_turf_onboarding` RPC
A security definer RPC implementing atomic onboarding updates:
- **Parameters**:
  - `p_turf_id uuid`
  - `p_expected_version bigint default null` (optimistic concurrency against `turfs.version`)
  - `p_description text default null`
  - `p_address_text text default null`
  - `p_amenities text[] default null` (validated against `public.amenities.code`)
  - `p_photos jsonb default null` (array of `{ storage_path, sort_order, published }`)
  - `p_resource_sports jsonb default null` (array of `{ resource_id, sport_codes: text[] }` validated against `public.sports.code` and `public.resources.id`)
- **Guards**:
  - Requires authenticated session (`auth.uid() is not null`).
  - Calls `private.can_turf(p_turf_id, 'listing.edit')`. This strictly rejects foreign turfs and archived turfs with SQLSTATE `42501`.
  - Checks `p_expected_version`: raises `VERSION_MISMATCH` with SQLSTATE `40001` if version does not match.
  - Updates `public.turfs` (`version = version + 1`, `updated_at = now()`).
  - Atomically reconciles `public.turf_amenities`, `public.turf_photos`, and `public.resource_sports`.

### C. Policy Preservation
- `turfs_update` policy remains untouched:
  `using = with_check = private.can_turf(id, 'listing.edit')`.
- Direct cross-tenant `UPDATE public.turfs` returns `rowCount = 0` (filtered by `USING`).
- RPC `public.update_turf_onboarding` raises `42501`.

### D. `public.get_my_capabilities(p_master_owner_id uuid default null)`
- Reconciles with and reuses `public.get_my_context()` resolution:
  - If `p_master_owner_id` is supplied: caller MUST be an owner or active employee of that master owner, or platform admin. Otherwise, raises SQLSTATE `42501` to prevent leaking `business_name`.
  - **Owners**: granted implicit full capabilities (all codes from `private.capabilities`, both turf-scope and owner-scope `payouts.read`, `payouts.request`).
  - **Staff**: granted capabilities unioned from `private.assignment_grants` across active assignments.
  - **Regular players**: returns empty capabilities array.

---

## 2. pgTAP Test Suite (`supabase/tests/12_turf_onboarding_test.sql`)
1. Direct update cross-tenant denial: foreign user `UPDATE public.turfs` returns 0 rows.
2. RPC cross-tenant denial: foreign user calling `public.update_turf_onboarding` raises SQLSTATE `42501`.
3. Owner onboarding update: sets description, address, photos, amenities, and resource sports.
4. Anon visibility: anon can select photos from `public.turf_photos` where `published = true` for approved turfs, but not unpublished photos or draft turfs.
5. Optimistic concurrency: `update_turf_onboarding` with stale `p_expected_version` raises `40001`.
6. Capabilities query: `get_my_capabilities` raises 42501 for foreign tenant query, and returns implicit full capabilities for owner.

---

## 3. Frontend Implementation (Migrated to `apps/owner`)

### A. Next 16 Proxy (Migrated to `apps/owner/src/proxy.ts`)
- Implements Next.js 16 `proxy.ts` (replacing deprecated `middleware.ts`).
- Protects `/dashboard/:path*` and `/owner/:path*`.
- Redirects unauthenticated requests to `/login?redirect=...`.

### B. Owner Shell (Migrated to `apps/owner/src/app/(owner)/layout.tsx`)
- Server component querying `get_my_capabilities()` via `createServerClient`.
- Redirects or denies non-owner / non-staff callers.
- Renders responsive navigation with item visibility derived strictly from actual RPC guards:
  - **Dashboard**: `is_owner || is_admin` (guards `get_owner_dashboard`)
  - **Payouts & Finance**: `is_owner || is_admin` (guards `get_owner_financial_summary`, `get_owner_statement`)
  - **Team**: `is_owner || is_admin` (guards employee management RPCs)
  - **Venues**: `is_owner || is_admin || capabilities.includes('listing.edit') || capabilities.includes('turf.read')`
  - **Bookings & Walk-ins**: `is_owner || is_admin || capabilities.includes('bookings.read') || capabilities.includes('bookings.create_walkin')`
  - **Calendar & Slots**: `is_owner || is_admin || capabilities.includes('calendar.read') || capabilities.includes('slots.block')`
  - **Pricing**: `is_owner || is_admin || capabilities.includes('pricing.read') || capabilities.includes('pricing.edit')`

### C. Owner Dashboard (Migrated to `apps/owner/src/app/(owner)/dashboard/page.tsx`)
- Calls `public.get_owner_dashboard(master_owner_id, start_date, end_date)`.
- Pins exact payload shape:
  - `master_owner_id`, `start_date`, `end_date`
  - `summary`: `total_bookings`, `confirmed_bookings`, `cancelled_bookings`, `gross_booking_minor`, `commission_minor`, `net_owner_minor`
  - `summary.source_breakdown.online.net_payout_eligible_minor`
  - `summary.source_breakdown.walkin.net_retained_minor`
  - `turfs`: array of `{ turf_id, turf_name, approval_status, bookings_count, gross_minor, net_minor }`
- **Explicit Zero-Data Empty States**:
  - `turfs.length === 0`: "No turfs registered yet. Onboard your first turf to start receiving online and walk-in bookings."
  - `total_bookings === 0` (for trailing 30 days): "Zero bookings recorded in this period."
- **Explicit Error State**: retry prompt with exact error message.
- Redirects `/owner` -> `/dashboard` (now in `apps/owner`).

---

## 4. Verification Plan
1. `npx supabase db reset` tail.
2. `npx supabase test db` (all 13 files, per-file ok/notok).
3. `cd web && npm run lint && npm run build`.
4. Zero-turf raw JSON payload captured via temporary zero-turf owner test script.
5. Plain description of dashboard zero-data rendering.
