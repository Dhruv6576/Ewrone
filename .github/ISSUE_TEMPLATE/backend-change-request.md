---
name: Backend Change Request
about: Propose a database schema, RPC, or backend architecture modification
title: "[BACKEND]: "
labels: backend, migration
assignees: Dhruv6576
---

### Problem Statement
<!-- Describe the business requirement or bug that requires a backend change. -->

### Proposed Database / Schema Modifications
- **New Migration**: `supabase/migrations/<timestamp>_<feature_name>.sql`
- **Affected Tables / Views / Functions**:
- **Capability / RBAC Implications**:
  - [ ] Requires Platform Admin (`private.platform_admins`)
  - [ ] Requires Master Owner / Employee
  - [ ] Public / Anonymous Access

### Financial Ledger or Invariant Impact
- Does this change affect double-entry ledger journals, holds, or payments? (Yes/No)
- If yes, describe how immutability and balance invariants are preserved.

### Verification Plan
- [ ] New pgTAP test in `supabase/tests/`
- [ ] Automated JS concurrency / lifecycle verification suite
