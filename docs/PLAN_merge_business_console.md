# Plan: Merge Master Owner and Staff Owner Portals into Unified Business Console (Port 3001)

## 1. Decision and Architectural Context
- **Target Architecture**: `apps/owner` becomes the single unified "Business Console" running on **port 3001**.
- **Retirement**: `apps/master-owner` (port 3002) is retired.
- **Unchanged**: `apps/player` (port 3000) and `apps/admin` (port 3003) remain completely separate.
- **Rationale**: `public.get_my_context()` returns `master_owner_accounts[]` and `employee_memberships[]`, and `public.get_my_capabilities(p_master_owner_id uuid DEFAULT NULL)` returns `is_owner`, `is_staff`, `is_admin`, `capabilities[]`, and `turf_ids[]`. Role routing is purely an application-layer concern; no database migrations are needed.

---

## 2. Accepted Trade-Offs
- **Single Portal Cookie**: One portal on port 3001 uses a single cookie (`sb-boxcodex-owner-auth-token`) and storageKey (`boxcodex_owner_auth`). A Master Owner and a Staff Member can no longer be signed in simultaneously in the same browser profile (which was previously possible across ports 3001 and 3002).
- **Testing Approach**: Cross-group acceptance verification will be executed in separate browser profiles or sequentially.

---

## 3. P0 — Byte-Verified External Backup
1. Before any move or deletion, create an external backup directory:
   `C:\Dhruv\Projectss\Box Codex-backup\apps-owner-master-merge-<UTC timestamp>\`
2. Copy the complete directory trees of `apps/owner` and `apps/master-owner`.
3. Generate a SHA256 manifest file `manifest.sha256` of all backed-up files.
4. Report:
   - Manifest path
   - Total file count
   - Manifest file's own SHA256 hash
5. **Retention**: `apps/master-owner` directory remains in place; no folder deletion occurs until explicit user approval is granted after backup manifest reporting.

---

## 4. P1 — Shared Configuration (`packages/shared`)
1. **`packages/shared/src/config.ts`**:
   - Reduce `PORTAL_CONFIGS` portal map from `Record<'admin' | 'masterOwner' | 'owner' | 'player', PortalClientConfig>` to `Record<'admin' | 'owner' | 'player', PortalClientConfig>`.
   - Remove `masterOwner` configuration block entirely.
   - Ensure `owner` uses cookie `sb-boxcodex-owner-auth-token`, storageKey `boxcodex_owner_auth`, and port `3001`.
2. **`packages/shared/src/server.ts` & `packages/shared/src/client.ts`**:
   - Update `portalKey` union in `createServerClient` and `createBrowserClient` to `'admin' | 'owner' | 'player'`.
3. **`packages/shared/src/roles.ts`**:
   - Close disabled-employee hole:
     `isStaffOwner = Boolean(context.employee_memberships && context.employee_memberships.some(m => m.status === 'active'))`
   - Master Owner status check:
     `isMasterOwner = Boolean(context.master_owner_accounts && context.master_owner_accounts.some(mo => ['onboarding', 'active'].includes(mo.status)))`
4. Report exact counts of `masterOwner` portal-key call sites with `rg -c "masterOwner"` before and after.

---

## 5. P2 — Move Master-Owner Surface to `apps/owner`
1. **Move Surface**:
   - `apps/master-owner/src/app/(master)/{layout.tsx,dashboard,turfs,turfs/new,team,payouts}` into `apps/owner/src/app/(master)/master/*`:
     - `/master/dashboard`
     - `/master/turfs`
     - `/master/turfs/new`
     - `/master/turfs/[id]` (P5 item 18)
     - `/master/team`
     - `/master/payouts`
   - Rewrite internal links in moved components to use `/master/*` prefix.
2. **Components**:
   - Move `MasterOwnerSidebar.tsx` and `TenantSwitcher.tsx` into `apps/owner/src/components/`.
   - Update `MasterOwnerSidebar.tsx` to use `createBrowserClient('owner')` and `/master/*` navigation targets.
   - Reuse existing `NotificationBell.tsx` in `apps/owner/src/components/`: export both default (`export default NotificationBell`) and named (`export { NotificationBell }`).
3. **Resolve Route Collision**:
   - Move staff dashboard to `apps/owner/src/app/(owner)/owner/dashboard/page.tsx` (resolving to `/owner/dashboard`).
   - Create single `apps/owner/src/app/dashboard/page.tsx` outside any route group:
     - Performs its own server-side context check (A8).
     - If `isMasterOwner`: redirects to `/master/dashboard`.
     - Else if `isStaffOwner`: redirects to `/owner/dashboard`.
     - Else: redirects to `/login?reason=forbidden`.
4. **Package & Dependencies**:
   - Verify dependencies in `apps/owner/package.json` match `apps/master-owner/package.json` (Next.js 16.3.5, React 19.2.8, Tailwind 4, Lucide-react 1.47.0, `@boxcodex/shared`).
5. **Retained Source Cleanup (A6)**:
   - Remove obsolete configuration files from `apps/master-owner`:
     - `package.json`
     - `next.config.ts`
     - `tsconfig.json`
     - `tsconfig.tsbuildinfo`
     - `postcss.config.mjs`
     - `next-env.d.ts`
     - `.env*`
     - `src/app/globals.css`
     - `src/lib/utils.ts`
     - `src/app/login/page.tsx`
     - `src/app/page.tsx`
     - `src/proxy.ts` (after merging logic into `apps/owner/src/proxy.ts`)
   - Leave `apps/master-owner` directory in place pending explicit user approval.

---

## 6. P3 — Server-Side Gates (Fail-Closed, Defense-in-Depth)
1. **`apps/owner/src/proxy.ts`**:
   - **Matcher**: `['/master/:path*', '/owner/:path*', '/dashboard']` (A2: `/login` and `/invite` omitted to prevent redirect loops and allow unauthenticated invite viewing).
   - **Gating Rules**:
     - `/master/*`: Allow `is_owner` or `is_admin`; deny all others.
     - `/owner/*`: Allow `is_owner`, `is_admin`, or `is_staff` with `status === 'active'`; deny all others.
     - `/dashboard`: Allow `is_owner`, `is_admin`, or `is_staff` (`active`); deny all others.
   - **Response Format**:
     - HTML requests: Redirect to `/login?redirect=...` (anonymous) or `/login?reason=forbidden` + clear cookie header (forbidden).
     - Non-HTML/API/curl requests: Return literal `401 Unauthorized` or `403 Forbidden` text.
2. **Layout Defense-in-Depth**:
   - `apps/owner/src/app/(master)/layout.tsx`: Independently verify `role.canAccessMasterOwner || role.isPlatformAdmin`. Redirect to `/login?reason=forbidden` if unauthorized.
   - `apps/owner/src/app/(owner)/layout.tsx`: Independently verify `role.canAccessStaffOwner || role.canAccessMasterOwner || role.isPlatformAdmin`. Redirect to `/login?reason=forbidden` if unauthorized.
3. **Single `/dashboard` Route (A8)**:
   - Outside route groups, `apps/owner/src/app/dashboard/page.tsx` runs independent server-side context verification via `getMyContext(supabase)` and `resolveUserRole(context)` before issuing redirect.

---

## 7. P4 — Unified Login and Role-Aware Landing
1. **Single `/login`**:
   - Located at `apps/owner/src/app/login/page.tsx`.
   - After `signInWithPassword`:
     - Fetch `getMyContext(supabase)`.
     - If user has both hats: redirect to `/master/dashboard` (or allowed `?redirect=`).
     - If Master Owner only: redirect to `/master/dashboard` (or allowed `?redirect=`).
     - If Staff only: redirect to `/owner/dashboard` (or allowed `?redirect=`).
     - If unaffiliated: purge local session and redirect to `/login?reason=forbidden`.
2. **Workspace Switcher**:
   - In `MasterOwnerSidebar.tsx`: Render "Switch to Venue Operations" (`/owner/dashboard`) button if user holds both master owner and staff roles.
   - In Staff layout (`apps/owner/src/app/(owner)/layout.tsx`): Render "Switch to Master Owner" (`/master/dashboard`) button if user holds both roles.

---

## 8. P5 — Absorb Known Defects
1. **Remove Staff Venue Creation Wizard**:
   - Delete `apps/owner/src/app/(owner)/owner/turfs/new/` because `public.create_turf` enforces `mo.owner_user_id = auth.uid()`.
   - Remove CTA link to `/owner/turfs/new` and copy from `apps/owner/src/app/(owner)/owner/turfs/TurfsClient.tsx:143` (A5).
2. **Staff Surface Route Cleanup (A7)**:
   - Remove `/owner/walkin` (does not exist).
   - Drop `/owner/payouts` for staff because `get_owner_statement` and `get_owner_financial_summary` are owner-scoped and refused for staff grants. Payouts live only at `/master/payouts`.
3. **Delete Staff Team Surface (A3)**:
   - `employee.manage` does not exist in `private.capabilities` (all 25 capabilities verified: 2 owner, 6 platform, 17 turf).
   - Staff cannot hold employee management. Delete `apps/owner/src/app/(owner)/owner/team/`.
4. **Master Owner Team Management (`/master/team`)**:
   - Implement full employee management UI in `apps/owner/src/app/(master)/master/team/page.tsx` using:
     - `get_pending_employee_invites(p_master_owner_id)`
     - `invite_employee(p_master_owner_id, p_email, p_turf_ids, p_capabilities)`
     - `update_employee_assignments(p_employee_id, p_turf_id, p_capabilities, p_active)`
     - `disable_employee(p_employee_id)`
5. **Implement Missing `/invite` Route**:
   - Create `apps/owner/src/app/invite/page.tsx`:
     - Reads `?token=...`.
     - If authenticated: calls `public.accept_employee_invite(p_token)`. On success, redirects to `/owner/dashboard`. On error, surfaces error.
     - If unauthenticated: displays invite acceptance UI prompting user to sign in or register while preserving `?token=...`.
6. **Add `/master/turfs/[id]`**:
   - Create `apps/owner/src/app/(master)/master/turfs/[id]/page.tsx`:
     - Operating hours configuration via `public.set_resource_operating_hours`.
     - Pricing rule list and editing via `public.upsert_pricing_rule`.
7. **Fix Error Swallowing in Venue Creation Wizard**:
   - In `apps/owner/src/app/(master)/master/turfs/new/page.tsx`:
     - Replace `console.warn` on `resource_sports` and `upsert_pricing_rule` failures with `throw sportErr` and `throw priceErr` so failures surface through `extractDatabaseError` and fail the wizard cleanly.

---

## 9. P6 — Port Reference Cleanup
1. **Remove Port 3002 References**:
   - `package.json`: Remove `dev:master-owner` and `build:master-owner`.
   - `README.md`: Update lines 11 and 31.
   - `apps/{owner,player,admin}/.env.example`: Update `NEXT_PUBLIC_MASTER_OWNER_URL` to `http://localhost:3001` or `NEXT_PUBLIC_OWNER_URL=http://localhost:3001`.
   - `apps/player/src/components/Navbar.tsx:81`: Update chip to link via `NEXT_PUBLIC_OWNER_URL` (fallback `http://localhost:3001`) for any user holding either hat, letting `/dashboard` route by role (A9).
   - `docs/STATE.md:137`: Document port 3002 retirement and merged console on port 3001.
2. **Supabase Auth Redirect URLs (A11)**:
   - `supabase/config.toml`: Add `http://127.0.0.1:3001`, `http://localhost:3001`, `http://127.0.0.1:3003`, `http://localhost:3003` to `additional_redirect_urls`.
   - **Critical**: Must run `npx supabase stop` then `npx supabase start` to load `supabase/config.toml` changes (db reset does not reload config.toml).
3. **Zero-Hit Verification (A4)**:
   - Run `rg -n "3002|masterOwner" apps/owner apps/player apps/admin packages supabase` and verify **0 live hits**.
   - Retained source in `apps/master-owner` reported separately.

---

## 10. Acceptance Evidence Plan (A12)

All evidence files will be captured to `scratch/evidence/round16/`. For every artifact, report: command, evidence path, SHA256, line count via `(Get-Content -Path $p).Count`, and full byte-identical contents.

1. **P0 External Backup**:
   - Backup directory: `C:\Dhruv\Projectss\Box Codex-backup\apps-owner-master-merge-<timestamp>\`
   - Manifest: `manifest.sha256`
   - Report manifest path, total file count, and manifest's own SHA256 before modifying any file.
2. **Ports & Startup**:
   - Verify ports 3000, 3001, 3003 start and respond; port 3002 does not listen.
   - `npm run dev:master-owner` confirmed removed from `package.json`.
3. **Authentication & Authorization Matrix**:
   - `live_player` -> 3001 refused (`403 Forbidden` / `/login?reason=forbidden`, session cleared).
   - `demo_staff` -> lands `/owner/dashboard`; `/master/turfs` refused by route and RPC (`42501`).
   - `demo_owner` -> lands `/master/dashboard`; can open `/master/{turfs,turfs/new,team,payouts}` and `/owner/*`.
   - `demo_admin` -> allowed per chosen policy.
   - Dual-hat fixture -> create temporary user with both roles, verify workspace switcher, tear down fixture.
   - Disabled employee fixture -> create employee, set status='disabled', verify refused, tear down fixture.
4. **Non-HTML Assertions**:
   - Curl `/master/dashboard` and `/owner/dashboard` without HTML Accept header; capture literal `401 Unauthorized` and `403 Forbidden` bodies.
5. **Zero Migrations Guarantee**:
   - Explicit confirmation: no new migration file created (`20260918000025+`), no applied migration (`01`-`24`) edited.
6. **Regression Tests**:
   - `npx supabase test db` (report file count and test count).
   - 12 JS test suites executed sequentially by name:
     1. `tests/proofs/owner_payout_reproducibility.js`
     2. `tests/proofs/owner_audit_proofs.js`
     3. `tests/e2e/full_system_lifecycle.js`
     4. `tests/live/razorpay_live_checkout_test.js`
     5. `tests/concurrency/booking_hold_concurrency.js`
     6. `tests/concurrency/payment_webhook_concurrency.js`
     7. `tests/concurrency/slot_release_concurrency.js`
     8. `tests/security/payment_security_matrix.js`
     9. `tests/security/payout_tamper_matrix.js`
     10. `tests/security/ledger_tamper_matrix.js`
     11. `tests/security/audit_tamper_matrix.js`
     12. `tests/security/rls_matrix_comprehensive.js`
7. **Post-Run Residue & Portals**:
   - `node scratch/check_residue.js` (confirm 0 residue).
   - Regression verification on port 3000 (player browse/book path) and port 3003 (admin queue/payouts/audit).
