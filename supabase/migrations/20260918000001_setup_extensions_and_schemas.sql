-- Migration: 20260918000001_setup_extensions_and_schemas.sql
-- Description: Creates private & extensions schemas, installs core extensions, sets search path.

create schema if not exists private;
create schema if not exists extensions;

-- Core extensions required for exclusion constraints, geospatial querying, and testing
create extension if not exists btree_gist with schema extensions;
create extension if not exists postgis with schema extensions;
create extension if not exists pgtap with schema extensions;

-- Ensure search_path includes public and extensions by default
alter database postgres set search_path = public, extensions;

-- Schema privileges:
-- private schema contains unexposed internals, raw provider records, and ledger
revoke all on schema private from public;
revoke all on schema private from anon;
grant usage on schema private to authenticated, service_role;
