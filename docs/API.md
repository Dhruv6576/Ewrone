# Box Codex — Database API & RPC Catalog

Generated automatically from the database schema via `scripts/generate_api_docs.mjs`.

> [!NOTE]
> The `Capability / Caller` and `Typical Error SQLSTATEs` columns represent architectural conventions based on schema and function-naming rules (not directly derived from pg_proc / AST analysis). Always verify the specific SQL function implementation for exact error conditions and caller capabilities.

## 1. Remote Procedure Calls (RPCs)

| Schema | Function Name | Arguments | Returns | Security | Capability / Caller (Convention) | Typical Error SQLSTATEs (Convention) |
|:---|:---|:---|:---|:---|:---|:---|
| `private` | `assert_within_operating_hours` | `p_resource_id uuid, p_starts_at timestamp with time zone, p_ends_at timestamp with time zone` | `void` | SECURITY DEFINER | service_role / internal | 42501 |
| `private` | `can_turf` | `p_user_id uuid, p_turf_id uuid, p_capability text` | `boolean` | SECURITY DEFINER | service_role / internal | 42501 |
| `private` | `can_turf` | `p_turf_id uuid, p_capability text` | `boolean` | SECURITY DEFINER | service_role / internal | 42501 |
| `private` | `check_journal_balance_record` | `p_journal_id uuid` | `void` | SECURITY DEFINER | service_role / internal | 42501 |
| `private` | `check_ledger_invariants` | *none* | `jsonb` | SECURITY DEFINER | service_role / internal | 42501 |
| `private` | `check_operational_health` | `p_stuck_threshold interval DEFAULT '00:15:00'::interval` | `jsonb` | SECURITY DEFINER | service_role / internal | 42501 |
| `private` | `claim_outbox_batch` | `p_worker_id text, p_batch_size integer DEFAULT 10, p_lease_duration interval DEFAULT '00:00:30'::interval, p_topic text DEFAULT NULL::text` | `TABLE(id uuid, topic text, aggregate_type text, aggregate_id uuid, dedupe_key text, payload jsonb, attempts integer)` | SECURITY DEFINER | service_role / internal | 42501 |
| `private` | `complete_outbox_event` | `p_event_id uuid, p_worker_id text DEFAULT NULL::text` | `boolean` | SECURITY DEFINER | service_role / internal | 42501 |
| `private` | `confirm_booking_payment` | `p_provider text, p_provider_order_id text, p_provider_payment_id text, p_amount_minor bigint, p_currency text DEFAULT 'INR'::text, p_event_type text DEFAULT 'payment.captured'::text, p_captured_at timestamp with time zone DEFAULT NULL::timestamp with time zone` | `jsonb` | SECURITY DEFINER | service_role / internal | 42501 |
| `private` | `create_or_get_payment_order` | `p_booking_id uuid, p_idempotency_key text, p_purpose text DEFAULT 'initial'::text` | `jsonb` | SECURITY DEFINER | service_role / internal | 42501 |
| `private` | `dispatch_admin_alert` | `p_title text, p_body text, p_severity text, p_details jsonb DEFAULT '{}'::jsonb` | `integer` | SECURITY DEFINER | service_role / internal | 42501 |
| `private` | `emit_outbox_event` | `p_topic text, p_aggregate_type text, p_aggregate_id uuid, p_dedupe_key text, p_payload jsonb, p_available_at timestamp with time zone DEFAULT now()` | `uuid` | SECURITY DEFINER | service_role / internal | 42501 |
| `private` | `expire_booking_holds` | *none* | `integer` | SECURITY DEFINER | service_role / internal | 42501 |
| `private` | `fail_outbox_event` | `p_event_id uuid, p_error text, p_backoff interval DEFAULT '00:01:00'::interval` | `boolean` | SECURITY DEFINER | service_role / internal | 42501 |
| `private` | `generate_resource_slots` | `p_resource_id uuid, p_start_date date, p_end_date date` | `integer` | SECURITY DEFINER | service_role / internal | 42501 |
| `private` | `get_or_create_owner_account` | `p_master_owner_id uuid, p_code text, p_currency text DEFAULT 'INR'::text` | `uuid` | SECURITY DEFINER | service_role / internal | 42501 |
| `private` | `is_business_employee` | `p_master_owner_id uuid, p_user_id uuid` | `boolean` | SECURITY DEFINER | service_role / internal | 42501 |
| `private` | `is_master_owner_user` | `p_master_owner_id uuid, p_user_id uuid` | `boolean` | SECURITY DEFINER | service_role / internal | 42501 |
| `private` | `is_platform_admin` | `p_uid uuid` | `boolean` | SECURITY DEFINER | service_role / internal | 42501 |
| `private` | `log_audit_event` | `p_master_owner_id uuid, p_turf_id uuid, p_actor_user_id uuid, p_actor_type text, p_action text, p_entity_type text, p_entity_id uuid, p_before_data jsonb DEFAULT NULL::jsonb, p_after_data jsonb DEFAULT NULL::jsonb, p_reason text DEFAULT NULL::text, p_request_id text DEFAULT NULL::text` | `uuid` | SECURITY DEFINER | service_role / internal | 42501 |
| `private` | `persist_webhook_event` | `p_provider text, p_scope text, p_event_id text, p_event_type text, p_raw_body text, p_body_hash text` | `jsonb` | SECURITY DEFINER | service_role / internal | 42501 |
| `private` | `plan_owner_payout` | `p_master_owner_id uuid, p_period_start timestamp with time zone DEFAULT NULL::timestamp with time zone, p_period_end timestamp with time zone DEFAULT NULL::timestamp with time zone, p_idempotency_key text DEFAULT NULL::text` | `jsonb` | SECURITY DEFINER | service_role / internal | 42501 |
| `private` | `post_journal` | `p_event_key text, p_event_type text, p_currency text, p_booking_id uuid, p_entries jsonb, p_reversal_of uuid DEFAULT NULL::uuid` | `jsonb` | SECURITY DEFINER | service_role / internal | 42501 |
| `private` | `prevent_ledger_mutation` | *none* | `trigger` | SECURITY INVOKER | service_role / internal | 42501 |
| `private` | `process_webhook_event` | `p_webhook_event_id uuid` | `jsonb` | SECURITY DEFINER | service_role / internal | 42501 |
| `private` | `queue_notification` | `p_user_id uuid, p_kind text, p_title text, p_body text, p_deep_link text DEFAULT NULL::text, p_channels text[] DEFAULT ARRAY['push'::text], p_recipient_contacts jsonb DEFAULT '{}'::jsonb` | `uuid` | SECURITY DEFINER | service_role / internal | 42501 |
| `private` | `register_owner_financial_account` | `p_master_owner_id uuid, p_provider text, p_provider_account_id text, p_masked_bank_label text, p_active boolean DEFAULT true` | `jsonb` | SECURITY DEFINER | service_role / internal | 42501 |
| `private` | `request_refund` | `p_payment_id uuid, p_amount_minor bigint, p_reason text, p_requested_by uuid DEFAULT NULL::uuid, p_idempotency_key text DEFAULT NULL::text` | `jsonb` | SECURITY DEFINER | service_role / internal | 42501 |
| `private` | `retry_unprocessed_webhooks` | *none* | `integer` | SECURITY DEFINER | service_role / internal | 42501 |
| `private` | `reverse_journal` | `p_journal_id uuid, p_reversal_event_key text, p_reason text DEFAULT 'Correction Reversal'::text` | `jsonb` | SECURITY DEFINER | service_role / internal | 42501 |
| `private` | `settle_owner_payout` | `p_payout_id uuid, p_provider_settlement_id text, p_settled_at timestamp with time zone DEFAULT NULL::timestamp with time zone` | `jsonb` | SECURITY DEFINER | service_role / internal | 42501 |
| `private` | `trg_check_ledger_entry_balance` | *none* | `trigger` | SECURITY DEFINER | service_role / internal | 42501 |
| `private` | `trg_check_ledger_journal_balance` | *none* | `trigger` | SECURITY DEFINER | service_role / internal | 42501 |
| `private` | `trg_prevent_audit_mutation` | *none* | `trigger` | SECURITY INVOKER | service_role / internal | 42501 |
| `private` | `trigger_notification_worker` | `p_edge_url text DEFAULT NULL::text` | `bigint` | SECURITY DEFINER | service_role / internal | 42501 |
| `private` | `update_payment_order_provider` | `p_order_id uuid, p_provider_order_id text, p_status text DEFAULT 'ready'::text` | `void` | SECURITY DEFINER | service_role / internal | 42501 |
| `public` | `accept_employee_invite` | `p_token text` | `jsonb` | SECURITY DEFINER | authenticated | 42501 (Unauthorized) |
| `public` | `admin_get_commission_rules` | *none* | `TABLE(id uuid, master_owner_id uuid, business_name text, basis_points integer, fixed_minor bigint, effective_from timestamp with time zone, effective_until timestamp with time zone, version integer)` | SECURITY DEFINER | platform_admin | 42501 (Forbidden) |
| `public` | `admin_get_payouts` | `p_status text DEFAULT NULL::text, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0` | `TABLE(id uuid, master_owner_id uuid, business_name text, financial_account_id uuid, provider text, provider_account_id text, masked_bank_label text, currency text, amount_minor bigint, status text, provider_settlement_id text, idempotency_key text, period_start timestamp with time zone, period_end timestamp with time zone, created_at timestamp with time zone, settled_at timestamp with time zone, total_count bigint)` | SECURITY DEFINER | platform_admin | 42501 (Forbidden) |
| `public` | `admin_get_tenants` | `p_limit integer DEFAULT 50, p_offset integer DEFAULT 0` | `TABLE(id uuid, owner_user_id uuid, owner_email text, business_name text, status text, created_at timestamp with time zone, turf_count bigint, total_count bigint)` | SECURITY DEFINER | platform_admin | 42501 (Forbidden) |
| `public` | `admin_get_turf_queue` | `p_status text DEFAULT NULL::text, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0` | `TABLE(id uuid, master_owner_id uuid, business_name text, owner_email text, name text, slug text, city text, address_text text, approval_status text, created_at timestamp with time zone, updated_at timestamp with time zone, total_count bigint)` | SECURITY DEFINER | platform_admin | 42501 (Forbidden) |
| `public` | `admin_review_turf` | `p_turf_id uuid, p_decision text, p_reason text` | `jsonb` | SECURITY DEFINER | platform_admin | 42501 (Forbidden) |
| `public` | `admin_set_commission_rule` | `p_master_owner_id uuid DEFAULT NULL::uuid, p_basis_points integer DEFAULT 1000, p_fixed_minor bigint DEFAULT 0` | `jsonb` | SECURITY DEFINER | platform_admin | 42501 (Forbidden) |
| `public` | `authorize_realtime_channel` | `p_topic text` | `boolean` | SECURITY DEFINER | authenticated | 42501 (Unauthorized) |
| `public` | `block_resource_time` | `p_resource_id uuid, p_starts_at timestamp with time zone, p_ends_at timestamp with time zone, p_reason text DEFAULT 'Maintenance Block'::text` | `jsonb` | SECURITY DEFINER | authenticated | 42501 (Unauthorized) |
| `public` | `cancel_booking` | `p_booking_id uuid, p_reason text DEFAULT 'Player requested cancellation'::text` | `jsonb` | SECURITY DEFINER | player (authenticated) | 42501, 23P01 (Slot unavailable) |
| `public` | `create_booking_hold` | `p_resource_id uuid, p_starts_at timestamp with time zone, p_ends_at timestamp with time zone, p_idempotency_key text, p_contact_name text DEFAULT NULL::text, p_contact_phone text DEFAULT NULL::text, p_contact_email text DEFAULT NULL::text, p_payment_mode text DEFAULT 'auto'::text` | `jsonb` | SECURITY DEFINER | player (authenticated) | 42501, 23P01 (Slot unavailable) |
| `public` | `create_or_get_payment_order` | `p_booking_id uuid, p_idempotency_key text, p_purpose text DEFAULT 'initial'::text` | `jsonb` | SECURITY DEFINER | authenticated | 42501 (Unauthorized) |
| `public` | `create_turf` | `p_master_owner_id uuid, p_name text, p_city text, p_address_text text, p_location geography DEFAULT st_setsrid(st_makepoint((77.6413)::double precision, (12.9716)::double precision), 4326), p_description text DEFAULT ''::text, p_timezone text DEFAULT 'Asia/Kolkata'::text` | `uuid` | SECURITY DEFINER | authenticated | 42501 (Unauthorized) |
| `public` | `create_walkin_booking` | `p_resource_id uuid, p_starts_at timestamp with time zone, p_ends_at timestamp with time zone, p_contact_name text, p_contact_phone text, p_contact_email text DEFAULT NULL::text, p_payment_method text DEFAULT 'cash'::text, p_notes text DEFAULT NULL::text, p_idempotency_key text DEFAULT NULL::text` | `jsonb` | SECURITY DEFINER | authenticated | 42501 (Unauthorized) |
| `public` | `disable_employee` | `p_employee_id uuid` | `jsonb` | SECURITY DEFINER | authenticated | 42501 (Unauthorized) |
| `public` | `get_audit_events` | `p_turf_id uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0` | `TABLE(id uuid, master_owner_id uuid, turf_id uuid, actor_user_id uuid, actor_type text, action text, entity_type text, entity_id uuid, before_data jsonb, after_data jsonb, reason text, created_at timestamp with time zone)` | SECURITY DEFINER | authenticated | 42501 (Unauthorized) |
| `public` | `get_booking_contact` | `p_booking_id uuid` | `jsonb` | SECURITY DEFINER | authenticated | 42501 (Unauthorized) |
| `public` | `get_booking_payment_summary` | `p_booking_id uuid` | `jsonb` | SECURITY DEFINER | authenticated | 42501 (Unauthorized) |
| `public` | `get_my_capabilities` | `p_master_owner_id uuid DEFAULT NULL::uuid` | `jsonb` | SECURITY DEFINER | authenticated | 42501 (Unauthorized) |
| `public` | `get_my_context` | *none* | `jsonb` | SECURITY DEFINER | authenticated | 42501 (Unauthorized) |
| `public` | `get_my_notifications` | `p_limit integer DEFAULT 50, p_offset integer DEFAULT 0` | `TABLE(id uuid, kind text, title text, body text, deep_link text, read_at timestamp with time zone, created_at timestamp with time zone)` | SECURITY DEFINER | authenticated | 42501 (Unauthorized) |
| `public` | `get_owner_dashboard` | `p_master_owner_id uuid, p_start_date date DEFAULT NULL::date, p_end_date date DEFAULT NULL::date` | `jsonb` | SECURITY DEFINER | authenticated | 42501 (Unauthorized) |
| `public` | `get_owner_financial_summary` | `p_master_owner_id uuid` | `jsonb` | SECURITY DEFINER | authenticated | 42501 (Unauthorized) |
| `public` | `get_owner_statement` | `p_master_owner_id uuid, p_start_date date DEFAULT NULL::date, p_end_date date DEFAULT NULL::date` | `jsonb` | SECURITY DEFINER | authenticated | 42501 (Unauthorized) |
| `public` | `get_pending_employee_invites` | `p_master_owner_id uuid` | `jsonb` | SECURITY DEFINER | authenticated | 42501 (Unauthorized) |
| `public` | `get_public_slot_allocations` | `p_resource_id uuid, p_starts_at timestamp with time zone, p_ends_at timestamp with time zone` | `TABLE(starts_at timestamp with time zone, ends_at timestamp with time zone)` | SECURITY DEFINER | authenticated | 42501 (Unauthorized) |
| `public` | `handle_new_user` | *none* | `trigger` | SECURITY DEFINER | authenticated | 42501 (Unauthorized) |
| `public` | `invite_employee` | `p_master_owner_id uuid, p_email text, p_turf_ids uuid[], p_capabilities text[]` | `jsonb` | SECURITY DEFINER | authenticated | 42501 (Unauthorized) |
| `public` | `is_platform_admin` | *none* | `boolean` | SECURITY DEFINER | authenticated | 42501 (Unauthorized) |
| `public` | `mark_notification_read` | `p_notification_id uuid` | `boolean` | SECURITY DEFINER | authenticated | 42501 (Unauthorized) |
| `public` | `owner_record_balance_collection` | `p_booking_id uuid, p_amount_minor bigint, p_method text, p_idempotency_key text` | `jsonb` | SECURITY DEFINER | master_owner / employee | 42501 (Forbidden) |
| `public` | `owner_upsert_booking_settings` | `p_turf_id uuid, p_advance_basis_points integer, p_advance_fixed_per_slot_minor bigint, p_booking_horizon_days integer DEFAULT NULL::integer, p_minimum_lead_minutes integer DEFAULT NULL::integer, p_hold_seconds integer DEFAULT NULL::integer` | `jsonb` | SECURITY DEFINER | master_owner / employee | 42501 (Forbidden) |
| `public` | `persist_webhook_event` | `p_provider text, p_scope text, p_event_id text, p_event_type text, p_raw_body text, p_body_hash text` | `jsonb` | SECURITY DEFINER | authenticated | 42501 (Unauthorized) |
| `public` | `plan_owner_payout` | `p_master_owner_id uuid, p_period_start timestamp with time zone DEFAULT NULL::timestamp with time zone, p_period_end timestamp with time zone DEFAULT NULL::timestamp with time zone, p_idempotency_key text DEFAULT NULL::text` | `jsonb` | SECURITY DEFINER | authenticated | 42501 (Unauthorized) |
| `public` | `process_webhook_event` | `p_webhook_event_id uuid` | `jsonb` | SECURITY DEFINER | authenticated | 42501 (Unauthorized) |
| `public` | `quote_booking` | `p_resource_id uuid, p_starts_at timestamp with time zone, p_ends_at timestamp with time zone, p_payment_mode text DEFAULT 'auto'::text` | `jsonb` | SECURITY DEFINER | authenticated | 42501 (Unauthorized) |
| `public` | `register_device_token` | `p_app_id text, p_token text, p_platform text` | `uuid` | SECURITY DEFINER | authenticated | 42501 (Unauthorized) |
| `public` | `register_owner_financial_account` | `p_master_owner_id uuid, p_provider text, p_provider_account_id text, p_masked_bank_label text, p_active boolean DEFAULT true` | `jsonb` | SECURITY DEFINER | authenticated | 42501 (Unauthorized) |
| `public` | `release_resource_block` | `p_allocation_id uuid` | `jsonb` | SECURITY DEFINER | authenticated | 42501 (Unauthorized) |
| `public` | `request_refund` | `p_payment_id uuid, p_amount_minor bigint, p_reason text, p_requested_by uuid DEFAULT NULL::uuid, p_idempotency_key text DEFAULT NULL::text` | `jsonb` | SECURITY DEFINER | platform_admin | 42501 (Forbidden) |
| `public` | `set_resource_operating_hours` | `p_resource_id uuid, p_hours jsonb, p_valid_from date DEFAULT NULL::date, p_valid_until date DEFAULT NULL::date` | `SETOF operating_hours` | SECURITY DEFINER | authenticated | 42501 (Unauthorized) |
| `public` | `settle_owner_payout` | `p_payout_id uuid, p_provider_settlement_id text, p_settled_at timestamp with time zone DEFAULT NULL::timestamp with time zone` | `jsonb` | SECURITY DEFINER | platform_admin | 42501 (Forbidden) |
| `public` | `submit_turf_for_approval` | `p_turf_id uuid` | `jsonb` | SECURITY DEFINER | authenticated | 42501 (Unauthorized) |
| `public` | `trg_bookings_default_balance_mode` | *none* | `trigger` | SECURITY INVOKER | authenticated | 42501 (Unauthorized) |
| `public` | `update_employee_assignments` | `p_employee_id uuid, p_turf_id uuid, p_capabilities text[], p_active boolean DEFAULT true` | `jsonb` | SECURITY DEFINER | authenticated | 42501 (Unauthorized) |
| `public` | `update_payment_order_provider` | `p_order_id uuid, p_provider_order_id text, p_status text DEFAULT 'ready'::text` | `void` | SECURITY DEFINER | authenticated | 42501 (Unauthorized) |
| `public` | `update_turf_onboarding` | `p_turf_id uuid, p_expected_version bigint DEFAULT NULL::bigint, p_description text DEFAULT NULL::text, p_address_text text DEFAULT NULL::text, p_amenities text[] DEFAULT NULL::text[], p_photos jsonb DEFAULT NULL::jsonb, p_resource_sports jsonb DEFAULT NULL::jsonb` | `turfs` | SECURITY DEFINER | authenticated | 42501 (Unauthorized) |
| `public` | `upsert_pricing_rule` | `p_rule_id uuid, p_resource_id uuid, p_valid_from date, p_valid_until date, p_iso_weekdays smallint[], p_starts_local time without time zone, p_ends_local time without time zone, p_amount_per_increment_minor bigint, p_priority integer DEFAULT 0, p_active boolean DEFAULT true, p_expected_version bigint DEFAULT NULL::bigint` | `jsonb` | SECURITY DEFINER | authenticated | 42501 (Unauthorized) |

## 2. Row Level Security (RLS) Table Policies

| Schema | Table | Policy Name | Command | Roles Permitted | Permissive |
|:---|:---|:---|:---|:---|:---|
| `public` | `amenities` | `amenities_select` | `SELECT` | `{anon,authenticated}` | PERMISSIVE |
| `public` | `booking_events` | `booking_events_select` | `SELECT` | `{authenticated}` | PERMISSIVE |
| `public` | `booking_slots` | `booking_slots_select` | `SELECT` | `{authenticated}` | PERMISSIVE |
| `public` | `bookings` | `bookings_select` | `SELECT` | `{authenticated}` | PERMISSIVE |
| `public` | `cancellation_policies` | `cancellation_policies_select` | `SELECT` | `{anon,authenticated}` | PERMISSIVE |
| `public` | `cancellation_policies` | `cancellation_policies_write` | `ALL` | `{authenticated}` | PERMISSIVE |
| `public` | `employee_turf_assignments` | `assignments_select` | `SELECT` | `{authenticated}` | PERMISSIVE |
| `public` | `employee_turf_assignments` | `assignments_write` | `ALL` | `{authenticated}` | PERMISSIVE |
| `public` | `employees` | `employees_select` | `SELECT` | `{authenticated}` | PERMISSIVE |
| `public` | `inventory_allocations` | `inventory_allocations_select` | `SELECT` | `{authenticated}` | PERMISSIVE |
| `public` | `master_owners` | `master_owners_insert` | `INSERT` | `{authenticated}` | PERMISSIVE |
| `public` | `master_owners` | `master_owners_select` | `SELECT` | `{authenticated}` | PERMISSIVE |
| `public` | `notifications` | `Users can mark own notifications read` | `UPDATE` | `{authenticated}` | PERMISSIVE |
| `public` | `notifications` | `Users can view own notifications` | `SELECT` | `{authenticated}` | PERMISSIVE |
| `public` | `operating_exceptions` | `operating_exceptions_select` | `SELECT` | `{anon,authenticated}` | PERMISSIVE |
| `public` | `operating_exceptions` | `operating_exceptions_write` | `ALL` | `{authenticated}` | PERMISSIVE |
| `public` | `operating_hours` | `operating_hours_select` | `SELECT` | `{anon,authenticated}` | PERMISSIVE |
| `public` | `operating_hours` | `operating_hours_write` | `ALL` | `{authenticated}` | PERMISSIVE |
| `public` | `players` | `players_select_self` | `SELECT` | `{authenticated}` | PERMISSIVE |
| `public` | `players` | `players_update_self` | `UPDATE` | `{authenticated}` | PERMISSIVE |
| `public` | `pricing_rules` | `pricing_rules_anon_select` | `SELECT` | `{anon,authenticated}` | PERMISSIVE |
| `public` | `pricing_rules` | `pricing_rules_select` | `SELECT` | `{authenticated}` | PERMISSIVE |
| `public` | `pricing_rules` | `pricing_rules_write` | `ALL` | `{authenticated}` | PERMISSIVE |
| `public` | `profiles` | `profiles_select_self` | `SELECT` | `{authenticated}` | PERMISSIVE |
| `public` | `profiles` | `profiles_update_self` | `UPDATE` | `{authenticated}` | PERMISSIVE |
| `public` | `resource_sports` | `resource_sports_select` | `SELECT` | `{anon,authenticated}` | PERMISSIVE |
| `public` | `resource_sports` | `resource_sports_write` | `ALL` | `{authenticated}` | PERMISSIVE |
| `public` | `resources` | `resources_select` | `SELECT` | `{anon,authenticated}` | PERMISSIVE |
| `public` | `resources` | `resources_write` | `ALL` | `{authenticated}` | PERMISSIVE |
| `public` | `slots` | `slots_select` | `SELECT` | `{anon,authenticated}` | PERMISSIVE |
| `public` | `sports` | `sports_select` | `SELECT` | `{anon,authenticated}` | PERMISSIVE |
| `public` | `turf_amenities` | `turf_amenities_select` | `SELECT` | `{anon,authenticated}` | PERMISSIVE |
| `public` | `turf_amenities` | `turf_amenities_write` | `ALL` | `{authenticated}` | PERMISSIVE |
| `public` | `turf_booking_settings` | `turf_booking_settings_select` | `SELECT` | `{anon,authenticated}` | PERMISSIVE |
| `public` | `turf_booking_settings` | `turf_booking_settings_write` | `ALL` | `{authenticated}` | PERMISSIVE |
| `public` | `turf_photos` | `turf_photos_select` | `SELECT` | `{anon,authenticated}` | PERMISSIVE |
| `public` | `turf_photos` | `turf_photos_write` | `ALL` | `{authenticated}` | PERMISSIVE |
| `public` | `turfs` | `turfs_insert` | `INSERT` | `{authenticated}` | PERMISSIVE |
| `public` | `turfs` | `turfs_select` | `SELECT` | `{anon,authenticated}` | PERMISSIVE |
| `public` | `turfs` | `turfs_update` | `UPDATE` | `{authenticated}` | PERMISSIVE |
