# Platform Admin Bootstrap Procedure

## Purpose & Security Boundary
Platform administrator access is enforced by `private.is_platform_admin(auth.uid())`, which checks membership in `private.platform_admins`.
The `private` schema has no grants to `anon` or `authenticated` roles, and no public self-service RPC exists to promote users. Bootstrapping a platform administrator must be performed out-of-band via direct database superuser access.

---

## Preconditions
1. **Existing User Account**:
   The target user must have already signed up and exist in `auth.users`.
   Query to locate the target `user_id`:
   ```sql
   SELECT id, email, created_at FROM auth.users WHERE email = 'target_admin@example.com';
   ```
2. **Superuser Connection**:
   The operator must execute the SQL using a role with direct access to the `private` schema (e.g., `supabase_admin` or `postgres` superuser via connection string or the Supabase Hosted SQL Editor).

---

## Bootstrap Procedure (Grant Platform Admin)

Execute the following idempotent SQL command:

```sql
INSERT INTO private.platform_admins (user_id, active)
VALUES ('<TARGET_USER_UUID>', true)
ON CONFLICT (user_id) DO UPDATE SET active = true;
```

### Verification Query
Confirm the grant is active:
```sql
SELECT pa.user_id, u.email, pa.active, pa.created_at
FROM private.platform_admins pa
JOIN auth.users u ON u.id = pa.user_id
WHERE pa.user_id = '<TARGET_USER_UUID>';
```
Expected output: 1 row with `active = true`.

---

## Revocation Procedure

To deactivate a platform administrator:

```sql
-- Option A: Soft-deactivate (preserves audit association)
UPDATE private.platform_admins
SET active = false
WHERE user_id = '<TARGET_USER_UUID>';

-- Option B: Hard removal
DELETE FROM private.platform_admins
WHERE user_id = '<TARGET_USER_UUID>';
```

---

## Downstream Capability Access
Once active in `private.platform_admins`, `public.is_platform_admin()` returns `true` for that user's JWT, granting access to:
- `/admin/turfs` (`public.admin_get_turf_queue`, `public.admin_review_turf`)
- `/admin/payouts` (`public.admin_get_payouts`, `public.settle_owner_payout`, `public.request_refund`)
- `/admin/tenants` (`public.admin_get_tenants`, `public.admin_get_commission_rules`, `public.admin_set_commission_rule`)
- `/admin/audit` (`public.get_audit_events(p_turf_id => NULL)`)
