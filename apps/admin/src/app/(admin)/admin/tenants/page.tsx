'use client';

import { useState, useEffect, useCallback } from 'react';
import { createBrowserClient, extractDatabaseError } from '@boxcodex/shared';
import {
  Building2,
  Percent,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  AlertCircle,
  CheckCircle2,
  Plus,
  Store,
  Mail,
  Shield,
  Clock,
  Settings
} from 'lucide-react';

interface TenantItem {
  id: string;
  owner_user_id: string;
  owner_email: string;
  business_name: string;
  status: string;
  created_at: string;
  turf_count: number;
  total_count: number;
}

interface CommissionRule {
  id: string;
  master_owner_id: string | null;
  business_name: string | null;
  basis_points: number;
  fixed_minor: number;
  effective_from: string;
  effective_until: string | null;
  version: number;
}

export default function AdminTenantsPage() {
  const [tenants, setTenants] = useState<TenantItem[]>([]);
  const [rules, setRules] = useState<CommissionRule[]>([]);
  const [loadingTenants, setLoadingTenants] = useState(true);
  const [loadingRules, setLoadingRules] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const pageSize = 10;
  const [totalCount, setTotalCount] = useState(0);

  // Commission Rule Modal / Form State
  const [showRuleModal, setShowRuleModal] = useState(false);
  const [targetOwnerId, setTargetOwnerId] = useState<string>('global');
  const [basisPoints, setBasisPoints] = useState<number>(1000);
  const [fixedMinor, setFixedMinor] = useState<number>(0);
  const [savingRule, setSavingRule] = useState(false);
  const [ruleSuccess, setRuleSuccess] = useState<string | null>(null);
  const [ruleError, setRuleError] = useState<string | null>(null);

  const fetchTenants = useCallback(async () => {
    setLoadingTenants(true);
    try {
      const supabase = createBrowserClient('admin');
      const { data, error: rpcErr } = await supabase.rpc('admin_get_tenants', {
        p_limit: pageSize,
        p_offset: page * pageSize
      });

      if (rpcErr) throw rpcErr;

      const items = (data || []) as TenantItem[];
      setTenants(items);
      setTotalCount(items.length > 0 ? Number(items[0].total_count) : 0);
    } catch (err: unknown) {
      setError(extractDatabaseError(err, 'Failed to fetch tenants'));
    } finally {
      setLoadingTenants(false);
    }
  }, [page]);

  const fetchCommissionRules = useCallback(async () => {
    setLoadingRules(true);
    try {
      const supabase = createBrowserClient('admin');
      const { data, error: rpcErr } = await supabase.rpc('admin_get_commission_rules');

      if (rpcErr) throw rpcErr;

      setRules((data || []) as CommissionRule[]);
    } catch (err: unknown) {
      setError(extractDatabaseError(err, 'Failed to fetch commission rules'));
    } finally {
      setLoadingRules(false);
    }
  }, []);

  useEffect(() => {
    fetchTenants();
    fetchCommissionRules();
  }, [fetchTenants, fetchCommissionRules]);

  const handleSaveCommissionRule = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingRule(true);
    setRuleError(null);
    setRuleSuccess(null);
    try {
      const supabase = createBrowserClient('admin');
      const ownerIdParam = targetOwnerId === 'global' ? null : targetOwnerId;

      const { data, error: rpcErr } = await supabase.rpc('admin_set_commission_rule', {
        p_master_owner_id: ownerIdParam,
        p_basis_points: Number(basisPoints),
        p_fixed_minor: Number(fixedMinor)
      });

      if (rpcErr) throw rpcErr;

      setRuleSuccess(`Commission rule successfully configured (Version: ${(data as any)?.version || 'new'})`);
      setShowRuleModal(false);
      await fetchCommissionRules();
    } catch (err: any) {
      setRuleError(err.message || 'Failed to update commission rule');
    } finally {
      setSavingRule(false);
    }
  };

  const activeRule = rules.find((r) => r.effective_until === null && r.master_owner_id === null);

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight flex items-center gap-3">
            <Store className="w-6 h-6 text-emerald-400" />
            Tenants & Commission Configuration
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            Manage Master Owner tenants, listings footprint, and platform revenue take-rates.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => {
              setShowRuleModal(true);
              setRuleError(null);
              setRuleSuccess(null);
            }}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-slate-950 text-sm font-bold transition-colors"
          >
            <Plus className="w-4 h-4" />
            Configure Commission
          </button>
          <button
            onClick={() => {
              fetchTenants();
              fetchCommissionRules();
            }}
            disabled={loadingTenants || loadingRules}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-900 border border-slate-800 text-slate-300 hover:text-white text-sm font-medium transition-colors"
          >
            <RefreshCw className={`w-4 h-4 ${loadingTenants || loadingRules ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm flex items-center gap-3">
          <AlertCircle className="w-5 h-5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {ruleSuccess && (
        <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-sm flex items-center gap-3">
          <CheckCircle2 className="w-5 h-5 flex-shrink-0" />
          <span>{ruleSuccess}</span>
        </div>
      )}

      {/* SECTION 1: Commission Rules Summary & History */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <Percent className="w-5 h-5 text-emerald-400" />
            Active Platform Commission Rate
          </h2>
        </div>

        {/* Highlight Card */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="glass-panel rounded-2xl border border-slate-800/80 p-5 bg-gradient-to-br from-slate-900/80 to-slate-950/80">
            <div className="text-xs uppercase tracking-wider font-semibold text-slate-400">Default Take Rate</div>
            <div className="text-3xl font-extrabold text-emerald-400 mt-2">
              {activeRule ? `${(activeRule.basis_points / 100).toFixed(2)}%` : '10.00%'}
            </div>
            <div className="text-xs text-slate-500 mt-1">
              {activeRule ? `${activeRule.basis_points} basis points` : '1000 bps'}
            </div>
          </div>
          <div className="glass-panel rounded-2xl border border-slate-800/80 p-5 bg-gradient-to-br from-slate-900/80 to-slate-950/80">
            <div className="text-xs uppercase tracking-wider font-semibold text-slate-400">Fixed Fee per Booking</div>
            <div className="text-3xl font-extrabold text-white mt-2">
              ₹{activeRule ? (activeRule.fixed_minor / 100).toFixed(2) : '0.00'}
            </div>
            <div className="text-xs text-slate-500 mt-1">Applied before percentage split</div>
          </div>
          <div className="glass-panel rounded-2xl border border-slate-800/80 p-5 bg-gradient-to-br from-slate-900/80 to-slate-950/80">
            <div className="text-xs uppercase tracking-wider font-semibold text-slate-400">Active Rule Version</div>
            <div className="text-3xl font-extrabold text-slate-300 mt-2">
              v{activeRule ? activeRule.version : 1}
            </div>
            <div className="text-xs text-slate-500 mt-1">
              Effective from {activeRule ? new Date(activeRule.effective_from).toLocaleDateString() : 'Baseline'}
            </div>
          </div>
        </div>

        {/* History Table */}
        <div className="glass-panel rounded-2xl border border-slate-800/80 overflow-hidden">
          <div className="p-4 bg-slate-900/40 border-b border-slate-800/80 text-xs font-semibold text-slate-400 uppercase tracking-wider">
            Commission Rules Audit & Version History
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-800/80 text-xs uppercase tracking-wider text-slate-400 font-semibold bg-slate-900/20">
                  <th className="p-3.5">Version</th>
                  <th className="p-3.5">Scope</th>
                  <th className="p-3.5">Take Rate</th>
                  <th className="p-3.5">Fixed Fee</th>
                  <th className="p-3.5">Effective Window</th>
                  <th className="p-3.5 text-right">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 text-xs">
                {rules.map((rule) => {
                  const isActive = rule.effective_until === null;
                  return (
                    <tr key={rule.id} className="hover:bg-slate-900/40 transition-colors">
                      <td className="p-3.5 font-bold text-slate-200">v{rule.version}</td>
                      <td className="p-3.5 text-slate-300">
                        {rule.master_owner_id ? rule.business_name || rule.master_owner_id : 'Platform Default (Global)'}
                      </td>
                      <td className="p-3.5 font-semibold text-emerald-400">
                        {(rule.basis_points / 100).toFixed(2)}% ({rule.basis_points} bps)
                      </td>
                      <td className="p-3.5 text-slate-200">
                        ₹{(rule.fixed_minor / 100).toFixed(2)}
                      </td>
                      <td className="p-3.5 text-slate-400">
                        {new Date(rule.effective_from).toLocaleDateString()} —{' '}
                        {rule.effective_until ? new Date(rule.effective_until).toLocaleDateString() : 'Present'}
                      </td>
                      <td className="p-3.5 text-right">
                        {isActive ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-500/10 text-emerald-400 font-semibold border border-emerald-500/20">
                            Active
                          </span>
                        ) : (
                          <span className="text-slate-500 font-medium">Superseded</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* SECTION 2: Master Owner Tenants List */}
      <div className="space-y-4">
        <h2 className="text-lg font-bold text-white flex items-center gap-2">
          <Building2 className="w-5 h-5 text-emerald-400" />
          Master Owner Tenants
        </h2>

        <div className="glass-panel rounded-2xl border border-slate-800/80 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-800/80 bg-slate-900/40 text-xs uppercase tracking-wider text-slate-400 font-semibold">
                  <th className="p-4">Business / Tenant</th>
                  <th className="p-4">Owner Email</th>
                  <th className="p-4">Status</th>
                  <th className="p-4">Venues Count</th>
                  <th className="p-4">Registered Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 text-sm">
                {loadingTenants && tenants.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="p-8 text-center text-slate-500">
                      <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2 text-emerald-500" />
                      Loading tenants...
                    </td>
                  </tr>
                ) : tenants.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="p-8 text-center text-slate-500">
                      No tenants registered on the platform.
                    </td>
                  </tr>
                ) : (
                  tenants.map((t) => (
                    <tr key={t.id} className="hover:bg-slate-900/40 transition-colors">
                      <td className="p-4">
                        <div className="font-semibold text-white">{t.business_name}</div>
                        <div className="text-[11px] text-slate-600 font-mono mt-0.5">{t.id}</div>
                      </td>
                      <td className="p-4 text-xs text-slate-300">
                        <div className="flex items-center gap-1.5">
                          <Mail className="w-3.5 h-3.5 text-slate-500" />
                          {t.owner_email || 'Unattached'}
                        </div>
                      </td>
                      <td className="p-4">
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 capitalize">
                          <CheckCircle2 className="w-3 h-3" /> {t.status}
                        </span>
                      </td>
                      <td className="p-4 text-xs">
                        <span className="font-bold text-white">{t.turf_count}</span> venues
                      </td>
                      <td className="p-4 text-xs text-slate-400">
                        {new Date(t.created_at).toLocaleDateString()}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination Footer */}
          <div className="p-4 border-t border-slate-800/80 bg-slate-900/30 flex items-center justify-between text-xs text-slate-400">
            <div>
              Showing <span className="text-slate-200 font-semibold">{tenants.length > 0 ? page * pageSize + 1 : 0}</span> to{' '}
              <span className="text-slate-200 font-semibold">{Math.min((page + 1) * pageSize, totalCount)}</span> of{' '}
              <span className="text-slate-200 font-semibold">{totalCount}</span> tenants
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
                className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-40 disabled:hover:bg-slate-800 transition-colors text-slate-300"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="px-2 font-medium text-slate-300">Page {page + 1}</span>
              <button
                onClick={() => setPage((p) => p + 1)}
                disabled={(page + 1) * pageSize >= totalCount}
                className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-40 disabled:hover:bg-slate-800 transition-colors text-slate-300"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Commission Configuration Modal */}
      {showRuleModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="max-w-md w-full glass-panel rounded-2xl border border-slate-800 p-6 space-y-5 shadow-2xl">
            <div>
              <h3 className="text-lg font-bold text-white">Configure Commission Take-Rate</h3>
              <p className="text-xs text-slate-400 mt-1">
                Updates immutable <code className="text-emerald-400 font-mono">private.commission_rules</code> via guarded PostgREST RPC.
              </p>
            </div>

            {ruleError && (
              <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs">
                {ruleError}
              </div>
            )}

            <form onSubmit={handleSaveCommissionRule} className="space-y-4">
              <div>
                <label className="text-xs font-semibold text-slate-300 block mb-1.5">Scope</label>
                <select
                  value={targetOwnerId}
                  onChange={(e) => setTargetOwnerId(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 rounded-xl p-3 text-xs text-white focus:outline-none focus:border-emerald-500"
                >
                  <option value="global">Platform Default (Global)</option>
                  {tenants.map((t) => (
                    <option key={t.id} value={t.id}>
                      Tenant: {t.business_name} ({t.id.substring(0, 8)}...)
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-300 block mb-1.5">
                  Basis Points (100 bps = 1.0%)
                </label>
                <div className="relative">
                  <input
                    type="number"
                    min="0"
                    max="10000"
                    required
                    value={basisPoints}
                    onChange={(e) => setBasisPoints(Number(e.target.value))}
                    className="w-full bg-slate-900 border border-slate-800 rounded-xl p-3 text-xs text-white focus:outline-none focus:border-emerald-500"
                  />
                  <div className="absolute right-3 top-3 text-xs font-semibold text-emerald-400">
                    {(basisPoints / 100).toFixed(2)}%
                  </div>
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-300 block mb-1.5">
                  Fixed Minor Fee (paise, 0 for none)
                </label>
                <input
                  type="number"
                  min="0"
                  required
                  value={fixedMinor}
                  onChange={(e) => setFixedMinor(Number(e.target.value))}
                  className="w-full bg-slate-900 border border-slate-800 rounded-xl p-3 text-xs text-white focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowRuleModal(false)}
                  disabled={savingRule}
                  className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingRule}
                  className="px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-slate-950 text-xs font-bold transition-colors flex items-center gap-2"
                >
                  {savingRule && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                  Save Commission Rule
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
