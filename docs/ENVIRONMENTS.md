# Environment Configuration Matrix

This document defines all environment variables across environments (`local`, `staging`, `production`) and applications.

> [!IMPORTANT]
> **Client Security Rules**:
> 1. Next.js applications (`apps/player`, `apps/owner`, `apps/admin`) MUST only receive public credentials (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_RAZORPAY_KEY_ID`).
> 2. `SUPABASE_SERVICE_ROLE_KEY`, `RAZORPAY_KEY_SECRET`, and database superuser passwords MUST NEVER be supplied to client applications or committed to source control.
> 3. Private secrets are injected into Edge Runtime exclusively via `supabase secrets set --env-file <env_file>`.

---

## 1. Application Environment Variables

### `apps/player` (Port 3000)

| Variable | Local (`.env.local`) | Staging (`.env.local`) | Production (`.env.local`) | Description |
|---|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `http://127.0.0.1:54321` | `https://akbndqzrnqxyckldboaw.supabase.co` | `https://<prod-ref>.supabase.co` | Supabase API gateway URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `eyJ...` (local anon key) | `sb_publishable_HcrvIrWuqmb41nfRhwWaFQ_2ieAjEsp` | `<prod-anon-key>` | Public client key (note: staging uses the modern `sb_publishable_` format, not a JWT) |
| `NEXT_PUBLIC_RAZORPAY_KEY_ID` | `rzp_test_...` (test key) | `rzp_test_...` (staging key) | `rzp_live_...` (production key) | Public Razorpay checkout key |
| `NEXT_PUBLIC_OWNER_URL` | `http://localhost:3001` | `TBD — set when the frontend is deployed` | `https://owner.boxcodex.com` | Link to Business Console |

---

### `apps/owner` (Port 3001 — Unified Business Console)

| Variable | Local (`.env.local`) | Staging (`.env.local`) | Production (`.env.local`) | Description |
|---|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `http://127.0.0.1:54321` | `https://akbndqzrnqxyckldboaw.supabase.co` | `https://<prod-ref>.supabase.co` | Supabase API gateway URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `eyJ...` (local anon key) | `sb_publishable_HcrvIrWuqmb41nfRhwWaFQ_2ieAjEsp` | `<prod-anon-key>` | Public client key (note: staging uses the modern `sb_publishable_` format, not a JWT) |
| `NEXT_PUBLIC_PLAYER_URL` | `http://localhost:3000` | `TBD — set when the frontend is deployed` | `https://play.boxcodex.com` | Link to Player portal |

---

### `apps/admin` (Port 3003 — Platform Administration)

| Variable | Local (`.env.local`) | Staging (`.env.local`) | Production (`.env.local`) | Description |
|---|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `http://127.0.0.1:54321` | `https://akbndqzrnqxyckldboaw.supabase.co` | `https://<prod-ref>.supabase.co` | Supabase API gateway URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `eyJ...` (local anon key) | `sb_publishable_HcrvIrWuqmb41nfRhwWaFQ_2ieAjEsp` | `<prod-anon-key>` | Public client key (note: staging uses the modern `sb_publishable_` format, not a JWT) |
| `NEXT_PUBLIC_OWNER_URL` | `http://localhost:3001` | `TBD — set when the frontend is deployed` | `https://owner.boxcodex.com` | Link to Business Console |

---

## 2. Supabase Backend & Edge Runtime Secrets

These variables are held by Edge Functions in Supabase:

| Secret Name | Local (`supabase/functions/.env`) | Staging / Prod Secret Management | Description |
|---|---|---|---|
| `SUPABASE_URL` | `http://127.0.0.1:54321` | Injected automatically by Supabase | Platform REST/Auth URL |
| `SUPABASE_ANON_KEY` | `eyJ...` (local) | Injected automatically by Supabase | Public anonymous key |
| `SUPABASE_SERVICE_ROLE_KEY` | `eyJ...` (local service role) | Injected automatically by Supabase | Elevated administrative key |
| `RAZORPAY_KEY_ID` | `rzp_test_...` | `npx supabase secrets set RAZORPAY_KEY_ID=...` | Razorpay Merchant Key ID |
| `RAZORPAY_KEY_SECRET` | `secret_...` | `npx supabase secrets set RAZORPAY_KEY_SECRET=...` | Razorpay Merchant API Secret |
| `RAZORPAY_WEBHOOK_SECRET` | `whsec_...` | `npx supabase secrets set RAZORPAY_WEBHOOK_SECRET=...` | Secret for HMAC-SHA256 signature validation |
| `INTERNAL_WORKER_SECRET` | `secret_...` | `npx supabase secrets set INTERNAL_WORKER_SECRET=...` | Secret authenticating pg_cron notification worker |

---

## 3. Database In-Database Worker Configuration (`private.app_config`)

Configured via `scripts/set_worker_config.mjs` against each target database:

| Config Key | Local Value | Staging Value | Production Value |
|---|---|---|---|
| `notification_worker_url` | `http://kong:8000/functions/v1/notification-worker` | `https://akbndqzrnqxyckldboaw.supabase.co/functions/v1/notification-worker` | `https://<prod-ref>.functions.supabase.co/notification-worker` |
| `worker_secret` | Matches `INTERNAL_WORKER_SECRET` | Matches `INTERNAL_WORKER_SECRET` | Matches `INTERNAL_WORKER_SECRET` |

---

## 4. Platform Administrator Provisioning on Hosted Environments

To create the initial platform administrator on staging or production:
1. Navigate to the deployed Player or Owner portal and complete user registration using the admin's email.
2. Run the query in Supabase SQL Editor:
   ```sql
   SELECT id, email FROM auth.users WHERE email = 'admin@yourcompany.com';
   ```
3. Use template `supabase/seed.bootstrap.sql` or run:
   ```sql
   INSERT INTO private.platform_admins (user_id, active)
   VALUES ('<USER_UUID_FROM_STEP_2>', true)
   ON CONFLICT (user_id) DO UPDATE SET active = true;
   ```
4. Verify by querying:
   ```sql
   SELECT pa.user_id, u.email, pa.active
   FROM private.platform_admins pa
   JOIN auth.users u ON u.id = pa.user_id
   WHERE pa.user_id = '<USER_UUID_FROM_STEP_2>';
   ```
   Expected: 1 row with `active = true`.
