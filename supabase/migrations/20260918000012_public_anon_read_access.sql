-- Migration 12: Public Anon Read Access Permissions
-- Author: Antigravity IDE
-- Date: 2026-09-19
-- Description: Grant usage on private schema and execute on private.can_turf to anon role.
-- Resolves RLS evaluation for public catalogue browsing (approved turfs, resources, operating hours).

grant usage on schema private to anon;
grant execute on function private.can_turf(uuid, text) to anon;
grant execute on function private.can_turf(uuid, uuid, text) to anon;
