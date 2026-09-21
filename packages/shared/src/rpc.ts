import type { SupabaseClient } from '@supabase/supabase-js';
import type { UserContext } from './roles';

export interface TurfQueueItem {
  id: string;
  master_owner_id: string;
  business_name: string;
  owner_email: string;
  name: string;
  slug: string;
  city: string;
  address_text: string;
  approval_status: 'draft' | 'pending' | 'approved' | 'rejected' | 'suspended';
  created_at: string;
  updated_at: string;
  total_count: number;
}

export interface PayoutItem {
  id: string;
  master_owner_id: string;
  business_name: string;
  financial_account_id: string;
  provider: string;
  provider_account_id: string;
  masked_bank_label: string;
  currency: string;
  amount_minor: number;
  status: 'planned' | 'processing' | 'settled' | 'failed';
  provider_settlement_id: string | null;
  idempotency_key: string | null;
  period_start: string | null;
  period_end: string | null;
  created_at: string;
  settled_at: string | null;
  total_count: number;
}

export interface TenantItem {
  id: string;
  owner_user_id: string;
  owner_email: string;
  business_name: string;
  status: 'active' | 'suspended';
  created_at: string;
  turf_count: number;
  total_count: number;
}

export interface CommissionRuleItem {
  id: string;
  master_owner_id: string | null;
  business_name: string | null;
  basis_points: number;
  fixed_minor: number;
  effective_from: string;
  effective_until: string | null;
  version: number;
}

export interface AuditEventItem {
  id: string;
  master_owner_id: string | null;
  turf_id: string | null;
  actor_user_id: string | null;
  actor_type: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  before_data: any;
  after_data: any;
  reason: string | null;
  created_at: string;
}

// Typed RPC Wrappers

export async function getMyContext(client: SupabaseClient): Promise<{ data: UserContext | null; error: any }> {
  return await client.rpc('get_my_context');
}

export async function isPlatformAdmin(client: SupabaseClient): Promise<{ data: boolean | null; error: any }> {
  return await client.rpc('is_platform_admin');
}

export async function adminGetTurfQueue(
  client: SupabaseClient,
  params?: { p_status?: string | null; p_limit?: number; p_offset?: number }
): Promise<{ data: TurfQueueItem[] | null; error: any }> {
  return await client.rpc('admin_get_turf_queue', {
    p_status: params?.p_status ?? null,
    p_limit: params?.p_limit ?? 50,
    p_offset: params?.p_offset ?? 0,
  });
}

export async function adminReviewTurf(
  client: SupabaseClient,
  params: { p_turf_id: string; p_decision: 'approved' | 'rejected' | 'suspended'; p_reason: string }
): Promise<{ data: any; error: any }> {
  return await client.rpc('admin_review_turf', params);
}

export async function adminGetPayouts(
  client: SupabaseClient,
  params?: { p_status?: string | null; p_limit?: number; p_offset?: number }
): Promise<{ data: PayoutItem[] | null; error: any }> {
  return await client.rpc('admin_get_payouts', {
    p_status: params?.p_status ?? null,
    p_limit: params?.p_limit ?? 50,
    p_offset: params?.p_offset ?? 0,
  });
}

export async function adminGetCommissionRules(
  client: SupabaseClient
): Promise<{ data: CommissionRuleItem[] | null; error: any }> {
  return await client.rpc('admin_get_commission_rules');
}

export async function adminSetCommissionRule(
  client: SupabaseClient,
  params: { p_master_owner_id?: string | null; p_basis_points?: number; p_fixed_minor?: number }
): Promise<{ data: any; error: any }> {
  return await client.rpc('admin_set_commission_rule', {
    p_master_owner_id: params.p_master_owner_id ?? null,
    p_basis_points: params.p_basis_points ?? 1000,
    p_fixed_minor: params.p_fixed_minor ?? 0,
  });
}

export async function adminGetTenants(
  client: SupabaseClient,
  params?: { p_limit?: number; p_offset?: number }
): Promise<{ data: TenantItem[] | null; error: any }> {
  return await client.rpc('admin_get_tenants', {
    p_limit: params?.p_limit ?? 50,
    p_offset: params?.p_offset ?? 0,
  });
}

export async function getAuditEvents(
  client: SupabaseClient,
  params?: { p_turf_id?: string | null; p_limit?: number; p_offset?: number }
): Promise<{ data: AuditEventItem[] | null; error: any }> {
  return await client.rpc('get_audit_events', {
    p_turf_id: params?.p_turf_id ?? null,
    p_limit: params?.p_limit ?? 50,
    p_offset: params?.p_offset ?? 0,
  });
}

export async function settleOwnerPayout(
  client: SupabaseClient,
  params: { p_payout_id: string; p_provider_settlement_id: string; p_settled_at?: string | null }
): Promise<{ data: any; error: any }> {
  return await client.rpc('settle_owner_payout', {
    p_payout_id: params.p_payout_id,
    p_provider_settlement_id: params.p_provider_settlement_id,
    p_settled_at: params.p_settled_at ?? null,
  });
}

export async function requestRefund(
  client: SupabaseClient,
  params: { p_payment_id: string; p_amount_minor: number; p_reason: string; p_requested_by?: string | null; p_idempotency_key?: string | null }
): Promise<{ data: any; error: any }> {
  return await client.rpc('request_refund', {
    p_payment_id: params.p_payment_id,
    p_amount_minor: params.p_amount_minor,
    p_reason: params.p_reason,
    p_requested_by: params.p_requested_by ?? null,
    p_idempotency_key: params.p_idempotency_key ?? null,
  });
}
