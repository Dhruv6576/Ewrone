# Box Codex — Operational Next Steps & Security Roadmap

This document catalogs the outstanding operational and infrastructure actions for the **Box Codex** platform in strict priority order.

---

## Priority Order of Operations

### 1. Rotate Razorpay Webhook Secret
- **Context:** The staging environment currently utilizes the test webhook secret `DjK_6JYFWcsBfmL`.
- **Action:** Generate a fresh webhook secret in the Razorpay Dashboard, update `RAZORPAY_WEBHOOK_SECRET` in `supabase/functions/.env.staging`, deploy edge secrets via `npx supabase secrets set`, and synchronize the `RAZORPAY_TEST_WEBHOOK_SECRET` GitHub Repository / Environment secret.

---

### 2. Rotate All Staging Keys
- **Context:** Staging API keys and tokens were previously exposed in local development context.
- **Action:**
  - Rotate the Supabase `anon` public key and `service_role` private key in project `akbndqzrnqxyckldboaw`.
  - Rotate the personal `SUPABASE_ACCESS_TOKEN`.
  - Update GitHub Action secrets (`SUPABASE_STAGING_ANON_KEY`, `SUPABASE_STAGING_SERVICE_ROLE_KEY`, `SUPABASE_ACCESS_TOKEN`).
  - Run `node scripts/bootstrap.mjs --target=staging` to update local client configs.

---

### 3. Rotate Database Password
- **Context:** Staging Postgres password (`SUPABASE_DB_PASSWORD`) must be rotated periodically and isolated from team distribution.
- **Action:** Update the database password in the Supabase Dashboard (Database Settings), and update `SUPABASE_DB_URL` / `SUPABASE_STAGING_DB_URL` in CI secrets and `supabase/.env.hosted`.

---

### 4. Deploy Frontend Applications
- **Context:** Frontends are currently run locally via Turbopack (`npm run dev:*`). There are no live production URLs.
- **Action:**
  - Deploy `apps/player` (Player discovery & booking portal) to Vercel or Cloudflare Pages.
  - Deploy `apps/owner` (Unified Business Console) to dedicated domain/subdomain.
  - Deploy `apps/admin` (Platform Administration dashboard) with restricted access.
  - Configure production environment variables (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, etc.).

---

### 5. Configure Auth Site URL & Redirect Whitelists
- **Context:** The staging Supabase Auth `site_url` configuration currently defaults to `http://localhost:3000`.
- **Action:**
  - Update `site_url` to the production player portal URL.
  - Add deployed portal URLs (`https://player...`, `https://owner...`, `https://admin...`) to `uri_allow_list` via Supabase Management API or Dashboard (`Authentication -> URL Configuration`).

---

### 6. Provision Production Environment
- **Context:** The `production` environment in GitHub Actions is intentionally unprovisioned (`SUPABASE_PROD_PROJECT_REF` is unset), causing the production deploy workflow step to safely skip.
- **Action:**
  - Provision a dedicated production Supabase project.
  - Run baseline migrations (`001` through `025+`) against the production instance.
  - Set production GitHub Environment secrets: `SUPABASE_PROD_PROJECT_REF`, `SUPABASE_PROD_DB_URL`, `SUPABASE_PROD_ANON_KEY`, `SUPABASE_PROD_SERVICE_ROLE_KEY`.
  - Ensure zero demo accounts or test seeds are provisioned in production.

---

### 7. Branch Protection Required Review Gate
- **Context:** Branch protection on `main` enforces required pull requests and status checks (`Code Quality & Invariant Guards` and `Supabase pgTAP & Automated Test Suites`), but `required_approving_review_count` is 0 to allow single-operator workflows.
- **Action:** If the operator wishes to enforce mandatory peer reviews across the invited team, enable `required_approving_review_count = 1` or higher under GitHub Settings -> Branches -> `main`.
