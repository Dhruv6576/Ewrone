## Pull Request Description

### Summary of Changes
<!-- Provide a clear, concise summary of the changes introduced by this PR. -->

### Checklist
- [ ] **No Migration Mutability**: Existing migrations `20260918000001..20260918000025` are byte-unchanged; any database change is introduced via a new migration.
- [ ] **Zero Secrets**: No raw JWTs, `service_role` keys, webhook secrets, or provider credentials committed.
- [ ] **Typecheck**: All apps (`player`, `owner`, `admin`) pass `npm run build` and TypeScript check.
- [ ] **Database Invariants**: `npx supabase test db` passes all 15 test files (251 tests).
- [ ] **Automated Integration Suites**: All suites under `tests/` pass against local Supabase.
- [ ] **Code Ownership**: Code owners reviewed for modified areas per `.github/CODEOWNERS`.
